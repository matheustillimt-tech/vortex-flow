-- ============================================================
-- Migration: senha padrão + MFA + ferramentas com permissão por setor
-- ============================================================

-- 1) Flags de segurança em users
alter table public.users
  add column if not exists password_changed boolean not null default false;
alter table public.users
  add column if not exists mfa_enabled boolean not null default false;

-- Usuários que já existem não devem ser obrigados a trocar (já têm senha conhecida)
update public.users set password_changed = true where password_changed = false;

-- 2) Tabela de ferramentas (links externos: banco, loja, plataforma de pagamento...)
create table if not exists public.tools (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  url text not null,
  descricao text,
  icon text,
  cor text not null default '#3b82f6',
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tools_nome_idx on public.tools(nome);

-- 3) N:N tools x setores (quem pode ver cada ferramenta)
-- Se uma ferramenta não tem nenhuma linha aqui = visível pra todo mundo (autenticado)
create table if not exists public.tool_sectors (
  tool_id uuid not null references public.tools(id) on delete cascade,
  sector_id uuid not null references public.sectors(id) on delete cascade,
  primary key (tool_id, sector_id)
);
create index if not exists tool_sectors_sector_idx on public.tool_sectors(sector_id);

-- 4) Trigger de updated_at
drop trigger if exists trg_tools_updated on public.tools;
create trigger trg_tools_updated
  before update on public.tools
  for each row execute function set_updated_at();

-- 5) RLS
alter table public.tools enable row level security;
alter table public.tool_sectors enable row level security;

-- SELECT: admin vê tudo; demais veem ferramentas com pelo menos 1 setor em comum,
-- ou ferramentas sem restrição (sem linhas em tool_sectors).
drop policy if exists "tools_select" on public.tools;
create policy "tools_select" on public.tools
  for select using (
    auth.role() = 'authenticated'
    and (
      public.is_admin(auth.uid())
      or not exists (select 1 from public.tool_sectors ts where ts.tool_id = tools.id)
      or exists (
        select 1 from public.tool_sectors ts
        join public.users u on u.id = auth.uid()
        where ts.tool_id = tools.id
          and (
            ts.sector_id = u.setor_principal_id
            or ts.sector_id in (
              select sector_id from public.sector_members sm where sm.user_id = auth.uid()
            )
          )
      )
    )
  );

-- Mutations: só admin
drop policy if exists "tools_admin_write" on public.tools;
create policy "tools_admin_write" on public.tools
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "tool_sectors_select" on public.tool_sectors;
create policy "tool_sectors_select" on public.tool_sectors
  for select using (auth.role() = 'authenticated');

drop policy if exists "tool_sectors_admin_write" on public.tool_sectors;
create policy "tool_sectors_admin_write" on public.tool_sectors
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- 6) Realtime
alter table public.tools replica identity full;
alter table public.tool_sectors replica identity full;
alter publication supabase_realtime add table public.tools;
alter publication supabase_realtime add table public.tool_sectors;
