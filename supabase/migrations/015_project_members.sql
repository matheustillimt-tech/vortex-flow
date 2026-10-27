-- ============================================================
-- Migration 015: acesso opcional por projeto
-- ============================================================
-- Regra:
--   - Usuário sem nenhuma linha em project_members → vê TODOS os projetos
--     (mantém compat com membros antigos).
--   - Usuário com pelo menos uma linha → vê SOMENTE os projetos listados.
--   - Admin SEMPRE vê tudo, ignorando essa tabela.

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  granted_by uuid references public.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists project_members_user_idx
  on public.project_members(user_id);
create index if not exists project_members_project_idx
  on public.project_members(project_id);

-- RLS desta tabela
alter table public.project_members enable row level security;

drop policy if exists "project_members_select" on public.project_members;
create policy "project_members_select" on public.project_members
  for select using (
    auth.role() = 'authenticated'
    and (public.is_admin(auth.uid()) or user_id = auth.uid())
  );

drop policy if exists "project_members_admin_write" on public.project_members;
create policy "project_members_admin_write" on public.project_members
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ============================================================
-- Helper: o usuário pode ver este projeto?
-- ============================================================
create or replace function public.user_can_see_project(
  uid uuid,
  pid uuid
) returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_count int;
begin
  if uid is null or pid is null then
    return false;
  end if;
  -- Admin vê tudo
  if public.is_admin(uid) then
    return true;
  end if;
  -- Conta restrições: se 0, acesso "aberto" (compat com membros antigos)
  select count(*) into v_count
  from public.project_members where user_id = uid;
  if v_count = 0 then
    return true;
  end if;
  -- Se tem restrições, precisa estar listado
  return exists (
    select 1 from public.project_members
    where user_id = uid and project_id = pid
  );
end;
$$;

revoke all on function public.user_can_see_project(uuid, uuid) from public;
grant execute on function public.user_can_see_project(uuid, uuid) to authenticated;

-- ============================================================
-- Aplicar restrição em SELECT de projects, tasks, maps, nodes, edges,
-- funnels, products
-- ============================================================
alter table public.projects enable row level security;

drop policy if exists "projects_select_scoped" on public.projects;
create policy "projects_select_scoped" on public.projects
  for select using (
    auth.role() = 'authenticated'
    and public.user_can_see_project(auth.uid(), id)
  );

drop policy if exists "projects_admin_write" on public.projects;
create policy "projects_admin_write" on public.projects
  for all using (
    auth.role() = 'authenticated'
    and (public.is_admin(auth.uid()) or public.user_can_see_project(auth.uid(), id))
  )
  with check (
    auth.role() = 'authenticated'
    and (public.is_admin(auth.uid()) or public.user_can_see_project(auth.uid(), id))
  );

-- tasks
alter table public.tasks enable row level security;

drop policy if exists "tasks_select_scoped" on public.tasks;
create policy "tasks_select_scoped" on public.tasks
  for select using (
    auth.role() = 'authenticated'
    and (
      project_id is null
      or public.user_can_see_project(auth.uid(), project_id)
    )
  );

drop policy if exists "tasks_write_scoped" on public.tasks;
create policy "tasks_write_scoped" on public.tasks
  for all using (
    auth.role() = 'authenticated'
    and (
      project_id is null
      or public.user_can_see_project(auth.uid(), project_id)
    )
  )
  with check (
    auth.role() = 'authenticated'
    and (
      project_id is null
      or public.user_can_see_project(auth.uid(), project_id)
    )
  );

-- maps (escopo project)
alter table public.maps enable row level security;

drop policy if exists "maps_select_scoped" on public.maps;
create policy "maps_select_scoped" on public.maps
  for select using (
    auth.role() = 'authenticated'
    and (
      project_id is null
      or public.user_can_see_project(auth.uid(), project_id)
    )
  );

drop policy if exists "maps_write_scoped" on public.maps;
create policy "maps_write_scoped" on public.maps
  for all using (
    auth.role() = 'authenticated'
    and (
      project_id is null
      or public.user_can_see_project(auth.uid(), project_id)
    )
  )
  with check (
    auth.role() = 'authenticated'
    and (
      project_id is null
      or public.user_can_see_project(auth.uid(), project_id)
    )
  );

-- nodes (depende do map → project)
alter table public.nodes enable row level security;

drop policy if exists "nodes_select_scoped" on public.nodes;
create policy "nodes_select_scoped" on public.nodes
  for select using (
    auth.role() = 'authenticated'
    and exists (
      select 1 from public.maps m
      where m.id = nodes.map_id
        and (
          m.project_id is null
          or public.user_can_see_project(auth.uid(), m.project_id)
        )
    )
  );

drop policy if exists "nodes_write_scoped" on public.nodes;
create policy "nodes_write_scoped" on public.nodes
  for all using (
    auth.role() = 'authenticated'
    and exists (
      select 1 from public.maps m
      where m.id = nodes.map_id
        and (
          m.project_id is null
          or public.user_can_see_project(auth.uid(), m.project_id)
        )
    )
  )
  with check (
    auth.role() = 'authenticated'
    and exists (
      select 1 from public.maps m
      where m.id = nodes.map_id
        and (
          m.project_id is null
          or public.user_can_see_project(auth.uid(), m.project_id)
        )
    )
  );

-- edges (depende do map → project)
alter table public.edges enable row level security;

drop policy if exists "edges_select_scoped" on public.edges;
create policy "edges_select_scoped" on public.edges
  for select using (
    auth.role() = 'authenticated'
    and exists (
      select 1 from public.maps m
      where m.id = edges.map_id
        and (
          m.project_id is null
          or public.user_can_see_project(auth.uid(), m.project_id)
        )
    )
  );

drop policy if exists "edges_write_scoped" on public.edges;
create policy "edges_write_scoped" on public.edges
  for all using (
    auth.role() = 'authenticated'
    and exists (
      select 1 from public.maps m
      where m.id = edges.map_id
        and (
          m.project_id is null
          or public.user_can_see_project(auth.uid(), m.project_id)
        )
    )
  )
  with check (
    auth.role() = 'authenticated'
    and exists (
      select 1 from public.maps m
      where m.id = edges.map_id
        and (
          m.project_id is null
          or public.user_can_see_project(auth.uid(), m.project_id)
        )
    )
  );

-- funnels
alter table public.funnels enable row level security;

drop policy if exists "funnels_select_scoped" on public.funnels;
create policy "funnels_select_scoped" on public.funnels
  for select using (
    auth.role() = 'authenticated'
    and public.user_can_see_project(auth.uid(), project_id)
  );

drop policy if exists "funnels_write_scoped" on public.funnels;
create policy "funnels_write_scoped" on public.funnels
  for all using (
    auth.role() = 'authenticated'
    and public.user_can_see_project(auth.uid(), project_id)
  )
  with check (
    auth.role() = 'authenticated'
    and public.user_can_see_project(auth.uid(), project_id)
  );

-- products
alter table public.products enable row level security;

drop policy if exists "products_select_scoped" on public.products;
create policy "products_select_scoped" on public.products
  for select using (
    auth.role() = 'authenticated'
    and public.user_can_see_project(auth.uid(), project_id)
  );

drop policy if exists "products_write_scoped" on public.products;
create policy "products_write_scoped" on public.products
  for all using (
    auth.role() = 'authenticated'
    and public.user_can_see_project(auth.uid(), project_id)
  )
  with check (
    auth.role() = 'authenticated'
    and public.user_can_see_project(auth.uid(), project_id)
  );

-- Realtime
alter table public.project_members replica identity full;
do $$
begin
  begin
    alter publication supabase_realtime add table public.project_members;
  exception when duplicate_object then null;
  end;
end $$;
