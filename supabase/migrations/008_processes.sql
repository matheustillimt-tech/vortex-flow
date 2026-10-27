-- ============================================================
-- Migration 008: Processos (POPs + Central de Ajuda)
-- ============================================================

create table if not exists public.processes (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('pop', 'tutorial')),
  title text not null,
  slug text not null,
  category text,
  summary text,
  content text,                       -- markdown
  cover_url text,                     -- thumbnail
  video_url text,                     -- youtube/vimeo/loom embed (opcional)
  tags text[] not null default '{}',
  sector_id uuid references public.sectors(id) on delete set null,
  owner_id uuid references public.users(id) on delete set null,
  version text,                       -- "v1.0", "Rev. 03 - Maio/26"
  last_reviewed_at timestamptz,
  view_count int not null default 0,
  pinned boolean not null default false,
  published boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists processes_kind_idx on public.processes(kind);
create index if not exists processes_category_idx on public.processes(category);
create index if not exists processes_pinned_idx on public.processes(pinned);
create index if not exists processes_published_idx on public.processes(published);
create index if not exists processes_slug_idx on public.processes(slug);
create index if not exists processes_tags_gin on public.processes using gin(tags);

-- Slug único por kind
create unique index if not exists processes_kind_slug_unique
  on public.processes(kind, slug);

-- updated_at trigger
drop trigger if exists trg_processes_updated on public.processes;
create trigger trg_processes_updated
  before update on public.processes
  for each row execute function set_updated_at();

-- RLS
alter table public.processes enable row level security;

-- SELECT: qualquer autenticado vê publicados; admin vê tudo.
drop policy if exists "processes_select" on public.processes;
create policy "processes_select" on public.processes
  for select using (
    auth.role() = 'authenticated'
    and (public.is_admin(auth.uid()) or published = true)
  );

-- INSERT/UPDATE/DELETE: somente admin.
drop policy if exists "processes_admin_write" on public.processes;
create policy "processes_admin_write" on public.processes
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- Realtime (idempotente)
alter table public.processes replica identity full;
do $$
begin
  begin
    alter publication supabase_realtime add table public.processes;
  exception when duplicate_object then null;
  end;
end $$;

-- Função: incrementar view_count (qualquer autenticado pode chamar)
create or replace function public.increment_process_views(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.processes
     set view_count = view_count + 1
   where id = p_id;
end;
$$;

revoke all on function public.increment_process_views(uuid) from public;
grant execute on function public.increment_process_views(uuid) to authenticated;
