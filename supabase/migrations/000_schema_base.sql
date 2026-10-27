-- ============================================================
-- Migration 000: estrutura base do banco (Postgres / Supabase)
-- ============================================================
-- Primeira da fila: cria as tabelas principais. As migrações 001 em diante
-- vão acrescentando o resto, sempre nesta ordem (`supabase db push`).

-- Extensões
create extension if not exists "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

create type user_role as enum ('admin', 'gestor', 'colaborador');
create type project_status as enum ('ativo', 'pausado', 'concluido', 'arquivado');
create type task_status as enum ('pendente', 'em_andamento', 'em_revisao', 'concluido', 'travado');
create type task_priority as enum ('baixa', 'media', 'alta', 'urgente');
create type node_type as enum (
  'setor', 'etapa', 'tarefa', 'subtarefa',
  'anotacao', 'ideia', 'checklist', 'problema',
  'prioridade', 'projeto'
);
create type sector_status as enum ('ativo', 'arquivado');
create type map_scope as enum ('company', 'project');

-- ============================================================
-- USERS (perfil — referencia auth.users do Supabase)
-- ============================================================

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  nome text not null,
  avatar_url text,
  cargo text,
  setor_principal_id uuid,
  ativo boolean not null default true,
  role user_role not null default 'colaborador',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index users_setor_idx on public.users(setor_principal_id);
create index users_role_idx on public.users(role);

-- ============================================================
-- SECTORS
-- ============================================================

create table public.sectors (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  cor text not null default '#6366f1',
  status sector_status not null default 'ativo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index sectors_status_idx on public.sectors(status);

-- FK pós-criação para evitar dependência circular
alter table public.users
  add constraint users_setor_principal_fk
  foreign key (setor_principal_id) references public.sectors(id) on delete set null;

-- ============================================================
-- SECTOR MEMBERS (N:N)
-- ============================================================

create table public.sector_members (
  sector_id uuid not null references public.sectors(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (sector_id, user_id)
);

create index sector_members_user_idx on public.sector_members(user_id);

-- ============================================================
-- PROJECTS
-- ============================================================

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  setor_principal_id uuid references public.sectors(id) on delete set null,
  responsavel_id uuid references public.users(id) on delete set null,
  status project_status not null default 'ativo',
  prioridade task_priority not null default 'media',
  cor text not null default '#3b82f6',
  tags text[] not null default '{}',
  data_inicio date,
  prazo date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index projects_status_idx on public.projects(status);
create index projects_setor_idx on public.projects(setor_principal_id);
create index projects_resp_idx on public.projects(responsavel_id);

-- ============================================================
-- PROJECT MEMBERS (N:N)
-- ============================================================

create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  granted_by uuid references public.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index project_members_user_idx on public.project_members(user_id);

-- ============================================================
-- MAPS — mapas mentais (escopo company OU project)
-- ============================================================

create table public.maps (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  scope map_scope not null,
  project_id uuid references public.projects(id) on delete cascade,
  is_default boolean not null default false,
  view_mode text,
  filters jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maps_scope_chk check (
    (scope = 'company' and project_id is null) or
    (scope = 'project' and project_id is not null)
  )
);

create index maps_project_idx on public.maps(project_id);
create index maps_scope_idx on public.maps(scope);

-- ============================================================
-- TASKS
-- ============================================================

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text,
  project_id uuid references public.projects(id) on delete cascade,
  sector_id uuid references public.sectors(id) on delete set null,
  responsavel_id uuid references public.users(id) on delete set null,
  status task_status not null default 'pendente',
  prioridade task_priority not null default 'media',
  prazo date,
  data_conclusao timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_project_idx on public.tasks(project_id);
create index tasks_sector_idx on public.tasks(sector_id);
create index tasks_resp_idx on public.tasks(responsavel_id);
create index tasks_status_idx on public.tasks(status);
create index tasks_priority_idx on public.tasks(prioridade);
create index tasks_prazo_idx on public.tasks(prazo);

-- ============================================================
-- NODES (mapa mental)
-- ============================================================

create table public.nodes (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.maps(id) on delete cascade,
  parent_node_id uuid references public.nodes(id) on delete cascade,
  tipo node_type not null default 'etapa',
  titulo text not null,
  descricao text,
  cor text,
  pos_x double precision not null default 0,
  pos_y double precision not null default 0,
  width double precision,
  height double precision,
  task_id uuid references public.tasks(id) on delete set null,
  project_ref_id uuid references public.projects(id) on delete set null,
  sector_ref_id uuid references public.sectors(id) on delete set null,
  user_ref_id uuid references public.users(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index nodes_map_idx on public.nodes(map_id);
create index nodes_task_idx on public.nodes(task_id);
create index nodes_parent_idx on public.nodes(parent_node_id);

-- ============================================================
-- EDGES (ligações do mapa mental)
-- ============================================================

create table public.edges (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.maps(id) on delete cascade,
  source_node_id uuid not null references public.nodes(id) on delete cascade,
  target_node_id uuid not null references public.nodes(id) on delete cascade,
  label text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index edges_map_idx on public.edges(map_id);
create index edges_source_idx on public.edges(source_node_id);
create index edges_target_idx on public.edges(target_node_id);

-- ============================================================
-- TASK ASSIGNEES (envolvidos além do responsável)
-- ============================================================

create table public.task_assignees (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  primary key (task_id, user_id)
);

create index task_assignees_user_idx on public.task_assignees(user_id);

-- ============================================================
-- TASK CHECKLIST ITEMS
-- ============================================================

create table public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  titulo text not null,
  done boolean not null default false,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);

create index checklist_task_idx on public.task_checklist_items(task_id);

-- ============================================================
-- TASK COMMENTS
-- ============================================================

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  conteudo text not null,
  created_at timestamptz not null default now()
);

create index comments_task_idx on public.task_comments(task_id);

-- ============================================================
-- TASK LINKS
-- ============================================================

create table public.task_links (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  url text not null,
  titulo text,
  created_at timestamptz not null default now()
);

create index links_task_idx on public.task_links(task_id);

-- ============================================================
-- TASK ACTIVITY LOG
-- ============================================================

create table public.task_activity_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  acao text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index activity_task_idx on public.task_activity_logs(task_id);

-- ============================================================
-- UPDATED_AT triggers
-- ============================================================

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger trg_users_updated      before update on public.users      for each row execute function set_updated_at();
create trigger trg_sectors_updated    before update on public.sectors    for each row execute function set_updated_at();
create trigger trg_projects_updated   before update on public.projects   for each row execute function set_updated_at();
create trigger trg_maps_updated       before update on public.maps       for each row execute function set_updated_at();
create trigger trg_tasks_updated      before update on public.tasks      for each row execute function set_updated_at();
create trigger trg_nodes_updated      before update on public.nodes      for each row execute function set_updated_at();

-- ============================================================
-- Trigger: criar perfil em public.users quando user é criado em auth.users
-- ============================================================

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, email, nome, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    'colaborador'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ============================================================
-- Trigger: registrar log + setar data_conclusao quando task vira "concluido"
-- ============================================================

create or replace function public.handle_task_status_change()
returns trigger language plpgsql as $$
begin
  if new.status = 'concluido' and (old.status is distinct from 'concluido') then
    new.data_conclusao := now();
  elsif new.status <> 'concluido' then
    new.data_conclusao := null;
  end if;
  return new;
end $$;

create trigger trg_task_status_change
  before update on public.tasks
  for each row execute function public.handle_task_status_change();

-- ============================================================
-- RLS
-- ============================================================

alter table public.users                 enable row level security;
alter table public.sectors               enable row level security;
alter table public.sector_members        enable row level security;
alter table public.projects              enable row level security;
alter table public.project_members       enable row level security;
alter table public.maps                  enable row level security;
alter table public.nodes                 enable row level security;
alter table public.edges                 enable row level security;
alter table public.tasks                 enable row level security;
alter table public.task_assignees        enable row level security;
alter table public.task_checklist_items  enable row level security;
alter table public.task_comments         enable row level security;
alter table public.task_links            enable row level security;
alter table public.task_activity_logs    enable row level security;

-- Função helper: é admin?
create or replace function public.is_admin(uid uuid)
returns boolean language sql stable security definer as $$
  select exists (select 1 from public.users where id = uid and role = 'admin' and ativo = true);
$$;

create or replace function public.is_admin_or_gestor(uid uuid)
returns boolean language sql stable security definer as $$
  select exists (select 1 from public.users where id = uid and role in ('admin','gestor') and ativo = true);
$$;

-- ---------- POLICIES MVP (autenticados acessam; mutações exigem admin/gestor) ----------
-- Para MVP: simplificar — qualquer usuário autenticado lê e cria; admin/gestor podem editar/arquivar tudo.

-- USERS
create policy "users_select" on public.users
  for select using (auth.role() = 'authenticated');
create policy "users_update_self" on public.users
  for update using (auth.uid() = id);
create policy "users_admin_all" on public.users
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- SECTORS
create policy "sectors_select" on public.sectors
  for select using (auth.role() = 'authenticated');
create policy "sectors_write" on public.sectors
  for all using (public.is_admin_or_gestor(auth.uid())) with check (public.is_admin_or_gestor(auth.uid()));

-- SECTOR MEMBERS
create policy "sector_members_select" on public.sector_members
  for select using (auth.role() = 'authenticated');
create policy "sector_members_write" on public.sector_members
  for all using (public.is_admin_or_gestor(auth.uid())) with check (public.is_admin_or_gestor(auth.uid()));

-- PROJECTS
create policy "projects_select" on public.projects
  for select using (auth.role() = 'authenticated');
create policy "projects_write" on public.projects
  for all using (public.is_admin_or_gestor(auth.uid())) with check (public.is_admin_or_gestor(auth.uid()));

-- PROJECT MEMBERS
create policy "project_members_select" on public.project_members
  for select using (auth.role() = 'authenticated');
create policy "project_members_write" on public.project_members
  for all using (public.is_admin_or_gestor(auth.uid())) with check (public.is_admin_or_gestor(auth.uid()));

-- MAPS
create policy "maps_select" on public.maps
  for select using (auth.role() = 'authenticated');
create policy "maps_write" on public.maps
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- NODES
create policy "nodes_select" on public.nodes
  for select using (auth.role() = 'authenticated');
create policy "nodes_write" on public.nodes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- EDGES
create policy "edges_select" on public.edges
  for select using (auth.role() = 'authenticated');
create policy "edges_write" on public.edges
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- TASKS
create policy "tasks_select" on public.tasks
  for select using (auth.role() = 'authenticated');
create policy "tasks_write" on public.tasks
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- TASK relations
create policy "task_assignees_all" on public.task_assignees
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "task_checklist_all" on public.task_checklist_items
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "task_comments_all" on public.task_comments
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "task_links_all" on public.task_links
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "task_logs_all" on public.task_activity_logs
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
