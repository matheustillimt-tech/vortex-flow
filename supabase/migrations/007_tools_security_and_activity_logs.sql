-- ============================================================
-- Migration 007: ferramentas com credenciais protegidas + permissão por usuário
-- + Registro de Atividades (logs de auditoria)
-- ============================================================

-- 1) Credenciais (secretas) em tools
alter table public.tools
  add column if not exists login text,
  add column if not exists senha text;

-- Esconde os campos secretos do client SELECT.
-- A leitura passa a depender de RPC/API com service_role.
revoke select on public.tools from authenticated, anon;
grant select (
  id, nome, descricao, icon, cor,
  created_by, created_at, updated_at
) on public.tools to authenticated;
-- Mantém INSERT/UPDATE/DELETE acessível para o role authenticated;
-- a RLS já restringe quem pode escrever (apenas admin).
grant insert, update, delete on public.tools to authenticated;

-- 2) Permissão por usuário (autoritativa)
create table if not exists public.tool_user_access (
  tool_id uuid not null references public.tools(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  granted_by uuid references public.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (tool_id, user_id)
);
create index if not exists tool_user_access_user_idx on public.tool_user_access(user_id);

alter table public.tool_user_access enable row level security;

drop policy if exists "tool_user_access_select" on public.tool_user_access;
create policy "tool_user_access_select" on public.tool_user_access
  for select using (
    auth.role() = 'authenticated'
    and (public.is_admin(auth.uid()) or user_id = auth.uid())
  );

drop policy if exists "tool_user_access_admin_write" on public.tool_user_access;
create policy "tool_user_access_admin_write" on public.tool_user_access
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- 3) RLS de tools: admin vê tudo; demais veem tools onde existe acesso explícito
--    (tool_user_access) OU acesso por setor (tool_sectors — compat) OU sem restrição
--    nenhuma (ferramenta livre).
drop policy if exists "tools_select" on public.tools;
create policy "tools_select" on public.tools
  for select using (
    auth.role() = 'authenticated'
    and (
      public.is_admin(auth.uid())
      or exists (
        select 1 from public.tool_user_access tua
        where tua.tool_id = tools.id and tua.user_id = auth.uid()
      )
      or (
        not exists (select 1 from public.tool_user_access tua where tua.tool_id = tools.id)
        and (
          not exists (select 1 from public.tool_sectors ts where ts.tool_id = tools.id)
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
      )
    )
  );

-- 4) Registro de atividades (auditoria)
create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  user_nome text,
  user_email text,
  action text not null,            -- 'tools_page_open' | 'tool_view_attempt' | 'tool_view_success' | 'tool_view_failed_totp'
  tool_id uuid references public.tools(id) on delete set null,
  tool_nome text,
  ip_address text,
  user_agent text,
  country text,
  region text,
  city text,
  latitude double precision,
  longitude double precision,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_logs_created_at_idx on public.activity_logs(created_at desc);
create index if not exists activity_logs_user_idx on public.activity_logs(user_id);
create index if not exists activity_logs_action_idx on public.activity_logs(action);
create index if not exists activity_logs_tool_idx on public.activity_logs(tool_id);

alter table public.activity_logs enable row level security;

-- SELECT: somente admin.
drop policy if exists "activity_logs_admin_select" on public.activity_logs;
create policy "activity_logs_admin_select" on public.activity_logs
  for select using (public.is_admin(auth.uid()));

-- INSERT: qualquer usuário autenticado pode gravar a própria atividade,
-- mas o servidor (service_role) é quem efetivamente loga (bypassa RLS).
drop policy if exists "activity_logs_self_insert" on public.activity_logs;
create policy "activity_logs_self_insert" on public.activity_logs
  for insert with check (
    auth.role() = 'authenticated'
    and (user_id is null or user_id = auth.uid())
  );

-- 5) Realtime
alter table public.tool_user_access replica identity full;
alter table public.activity_logs replica identity full;
-- guarded inserts (idempotente)
do $$
begin
  begin
    alter publication supabase_realtime add table public.tool_user_access;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.activity_logs;
  exception when duplicate_object then null;
  end;
end $$;
