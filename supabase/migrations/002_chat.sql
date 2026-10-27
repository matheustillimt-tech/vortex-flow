-- ============================================================
-- Migration: chat (Empresa / Setor / Individual)
-- ============================================================

create type chat_channel_kind as enum ('company', 'sector', 'direct');

create table public.chat_channels (
  id uuid primary key default gen_random_uuid(),
  kind chat_channel_kind not null,
  sector_id uuid references public.sectors(id) on delete cascade,
  name text,
  created_at timestamptz not null default now()
);
-- garante apenas 1 canal empresa e 1 por setor
create unique index chat_channels_company_unique
  on public.chat_channels (kind)
  where kind = 'company';
create unique index chat_channels_sector_unique
  on public.chat_channels (sector_id)
  where kind = 'sector';

create table public.chat_channel_members (
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create index chat_channel_members_user_idx on public.chat_channel_members(user_id);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete set null,
  content text,
  attachments jsonb not null default '[]'::jsonb,
  mentions jsonb not null default '{"users": [], "tasks": []}'::jsonb,
  reply_to_id uuid references public.chat_messages(id) on delete set null,
  edited_at timestamptz,
  created_at timestamptz not null default now()
);
create index chat_messages_channel_idx on public.chat_messages(channel_id, created_at desc);
create index chat_messages_user_idx on public.chat_messages(user_id);

-- ============================================================
-- RLS
-- ============================================================
alter table public.chat_channels        enable row level security;
alter table public.chat_channel_members enable row level security;
alter table public.chat_messages        enable row level security;

create policy "chat_channels_select" on public.chat_channels
  for select using (auth.role() = 'authenticated');
create policy "chat_channels_write" on public.chat_channels
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "chat_channel_members_all" on public.chat_channel_members
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "chat_messages_select" on public.chat_messages
  for select using (auth.role() = 'authenticated');
create policy "chat_messages_insert" on public.chat_messages
  for insert with check (auth.role() = 'authenticated' and user_id = auth.uid());
create policy "chat_messages_update_own" on public.chat_messages
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "chat_messages_delete_own" on public.chat_messages
  for delete using (user_id = auth.uid() or public.is_admin(auth.uid()));

-- ============================================================
-- Realtime
-- ============================================================
alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.chat_channels;
alter publication supabase_realtime add table public.chat_channel_members;

-- ============================================================
-- Seed automático
-- ============================================================

-- canal "Empresa" (único)
insert into public.chat_channels (kind, name)
values ('company', 'Empresa')
on conflict do nothing;

-- canais por setor (para setores existentes)
insert into public.chat_channels (kind, sector_id, name)
select 'sector', s.id, s.nome
from public.sectors s
where not exists (
  select 1 from public.chat_channels c where c.sector_id = s.id and c.kind = 'sector'
);

-- trigger: ao criar setor, cria canal
create or replace function public.handle_new_sector_chat_channel()
returns trigger language plpgsql security definer as $$
begin
  insert into public.chat_channels (kind, sector_id, name)
  values ('sector', new.id, new.nome)
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists trg_sector_chat_channel on public.sectors;
create trigger trg_sector_chat_channel
  after insert on public.sectors
  for each row execute function public.handle_new_sector_chat_channel();

-- Função: pega ou cria um DM entre 2 usuários
create or replace function public.get_or_create_direct_channel(other_user uuid)
returns uuid language plpgsql security definer as $$
declare
  ch_id uuid;
  me uuid := auth.uid();
begin
  if me is null then return null; end if;
  if me = other_user then return null; end if;

  select c.id into ch_id
  from public.chat_channels c
  join public.chat_channel_members ma on ma.channel_id = c.id and ma.user_id = me
  join public.chat_channel_members mb on mb.channel_id = c.id and mb.user_id = other_user
  where c.kind = 'direct'
  group by c.id
  having count(distinct ma.user_id) >= 1 and count(distinct mb.user_id) >= 1
  limit 1;

  if ch_id is null then
    insert into public.chat_channels (kind) values ('direct') returning id into ch_id;
    insert into public.chat_channel_members (channel_id, user_id)
    values (ch_id, me), (ch_id, other_user);
  end if;

  return ch_id;
end $$;

-- ============================================================
-- Storage bucket para anexos
-- ============================================================
insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', true)
on conflict do nothing;

create policy "chat_media_select" on storage.objects
  for select using (bucket_id = 'chat-media');
create policy "chat_media_insert" on storage.objects
  for insert with check (bucket_id = 'chat-media' and auth.role() = 'authenticated');
create policy "chat_media_delete" on storage.objects
  for delete using (bucket_id = 'chat-media' and auth.role() = 'authenticated');
