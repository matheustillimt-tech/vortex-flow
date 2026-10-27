-- ============================================================
-- Migration 019: Kanban para projetos SaaS
-- ============================================================
-- Cada projeto SaaS ganha um quadro Kanban com colunas customizáveis.
-- A mesma task aparece tanto no mapa mental quanto no kanban; a coluna
-- (kanban_column_id) representa "em que andamento" ela está.
--
-- Para projetos não-SaaS (infoproduto, produto_físico) a tabela existe
-- mas vazia — o front nem mostra o kanban pra esses tipos.

create table if not exists public.kanban_columns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  nome text not null,
  ordem int not null default 0,
  cor text not null default '#94a3b8',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kanban_columns_project_idx
  on public.kanban_columns(project_id, ordem);

-- Trigger updated_at
drop trigger if exists trg_kanban_columns_updated on public.kanban_columns;
create trigger trg_kanban_columns_updated
  before update on public.kanban_columns
  for each row execute function public.set_updated_at();

-- Tasks ganham coluna kanban opcional
alter table public.tasks
  add column if not exists kanban_column_id uuid references public.kanban_columns(id) on delete set null;
create index if not exists tasks_kanban_column_idx on public.tasks(kanban_column_id);

-- ============================================================
-- RLS: respeitar acesso por projeto
-- ============================================================
alter table public.kanban_columns enable row level security;

drop policy if exists "kanban_columns_select_scoped" on public.kanban_columns;
create policy "kanban_columns_select_scoped" on public.kanban_columns
  for select using (
    auth.role() = 'authenticated'
    and public.user_can_see_project(auth.uid(), project_id)
  );

drop policy if exists "kanban_columns_write_scoped" on public.kanban_columns;
create policy "kanban_columns_write_scoped" on public.kanban_columns
  for all using (
    auth.role() = 'authenticated'
    and public.user_can_see_project(auth.uid(), project_id)
  )
  with check (
    auth.role() = 'authenticated'
    and public.user_can_see_project(auth.uid(), project_id)
  );

-- Realtime
alter table public.kanban_columns replica identity full;
do $$
begin
  begin
    alter publication supabase_realtime add table public.kanban_columns;
  exception when duplicate_object then null;
  end;
end $$;

-- ============================================================
-- Seed: cria colunas padrão num projeto SaaS
-- ============================================================
create or replace function public.seed_kanban_columns(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  defaults text[] := array[
    'Banco de ideias',
    'Priorizado',
    'Em teste',
    'Concluído',
    'Bug',
    'Corrigido'
  ];
  colors text[] := array[
    '#94a3b8',
    '#3b82f6',
    '#eab308',
    '#10b981',
    '#ef4444',
    '#a855f7'
  ];
  i int;
begin
  if exists (select 1 from public.kanban_columns where project_id = p_project_id) then
    return;
  end if;
  for i in 1..array_length(defaults, 1) loop
    insert into public.kanban_columns (project_id, nome, ordem, cor)
    values (p_project_id, defaults[i], i - 1, colors[i]);
  end loop;
end;
$$;

-- Trigger: seed automático ao criar projeto SaaS
create or replace function public.tg_seed_kanban_on_saas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tipo = 'saas' then
    perform public.seed_kanban_columns(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_seed_kanban_on_insert on public.projects;
create trigger trg_seed_kanban_on_insert
  after insert on public.projects
  for each row execute function public.tg_seed_kanban_on_saas();

-- Trigger: seed automático se um projeto vira SaaS depois (update do tipo)
create or replace function public.tg_seed_kanban_on_tipo_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tipo = 'saas' and old.tipo is distinct from 'saas' then
    perform public.seed_kanban_columns(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_seed_kanban_on_update on public.projects;
create trigger trg_seed_kanban_on_update
  after update of tipo on public.projects
  for each row execute function public.tg_seed_kanban_on_tipo_change();

-- Semeia para projetos SaaS já existentes
do $$
declare r record;
begin
  for r in select id from public.projects where tipo = 'saas' loop
    perform public.seed_kanban_columns(r.id);
  end loop;
end $$;
