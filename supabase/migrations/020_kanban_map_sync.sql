-- ============================================================
-- Migration 020: sincroniza kanban_columns ↔ blocos do mapa mental
-- ============================================================
-- Em projetos SaaS, cada coluna do kanban tem um bloco de 1º nível no
-- mapa mental. Tasks dentro de uma coluna do kanban ficam embaixo desse
-- bloco no mapa. As duas visões são reflexo uma da outra.

alter table public.kanban_columns
  add column if not exists node_id uuid references public.nodes(id) on delete set null;

-- ============================================================
-- Função: garante node correspondente a uma coluna
-- ============================================================
create or replace function public.ensure_kanban_column_node(p_column_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_col record;
  v_map_id uuid;
  v_node_id uuid;
  v_existing_node uuid;
begin
  select * into v_col from public.kanban_columns where id = p_column_id;
  if not found then return null; end if;
  if v_col.node_id is not null then return v_col.node_id; end if;

  select id into v_map_id
  from public.maps
  where project_id = v_col.project_id and is_default = true
  limit 1;
  if v_map_id is null then return null; end if;

  -- Tenta reusar um node de 1º nível existente com mesmo nome
  -- (matching case-insens) — evita duplicatas quando o usuário já tinha
  -- criado manualmente blocos com os mesmos nomes.
  select n.id into v_existing_node
  from public.nodes n
  where n.map_id = v_map_id
    and lower(trim(n.titulo)) = lower(trim(v_col.nome))
    and n.task_id is null
    and not exists (
      select 1 from public.edges e where e.target_node_id = n.id
    )
  limit 1;

  if v_existing_node is not null then
    update public.kanban_columns
      set node_id = v_existing_node
      where id = p_column_id;
    return v_existing_node;
  end if;

  -- Cria novo node
  insert into public.nodes (map_id, titulo, tipo, pos_x, pos_y)
  values (
    v_map_id,
    v_col.nome,
    'etapa',
    280,
    v_col.ordem * 140
  )
  returning id into v_node_id;

  update public.kanban_columns set node_id = v_node_id where id = p_column_id;
  return v_node_id;
end $$;

-- ============================================================
-- Trigger: ao criar column, garantir node correspondente
-- ============================================================
create or replace function public.tg_kanban_column_after_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.ensure_kanban_column_node(new.id);
  return new;
end $$;

drop trigger if exists trg_kanban_column_after_insert on public.kanban_columns;
create trigger trg_kanban_column_after_insert
  after insert on public.kanban_columns
  for each row execute function public.tg_kanban_column_after_insert();

-- ============================================================
-- Trigger: ao renomear column, atualizar título do node
-- ============================================================
create or replace function public.tg_kanban_column_sync_node()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.node_id is not null and new.nome is distinct from old.nome then
    update public.nodes set titulo = new.nome where id = new.node_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_kanban_column_sync_node on public.kanban_columns;
create trigger trg_kanban_column_sync_node
  after update on public.kanban_columns
  for each row execute function public.tg_kanban_column_sync_node();

-- ============================================================
-- Trigger: ao deletar column, deletar node (cascade limpa edges)
-- ============================================================
create or replace function public.tg_kanban_column_before_delete()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.node_id is not null then
    delete from public.nodes where id = old.node_id;
  end if;
  return old;
end $$;

drop trigger if exists trg_kanban_column_before_delete on public.kanban_columns;
create trigger trg_kanban_column_before_delete
  before delete on public.kanban_columns
  for each row execute function public.tg_kanban_column_before_delete();

-- ============================================================
-- Trigger: task.kanban_column_id muda → reparenteia o node da task
-- ============================================================
create or replace function public.tg_task_sync_kanban_to_node()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_task_node_id uuid;
  v_task_map_id uuid;
  v_new_col_node uuid;
begin
  if new.kanban_column_id is not distinct from old.kanban_column_id then
    return new;
  end if;

  -- Pega node da task (no map default do projeto)
  select n.id, n.map_id into v_task_node_id, v_task_map_id
  from public.nodes n
  join public.maps m on m.id = n.map_id
  where n.task_id = new.id
    and m.project_id = new.project_id
    and m.is_default = true
  limit 1;

  if v_task_node_id is null then return new; end if;

  -- Pega node da nova coluna
  if new.kanban_column_id is not null then
    select node_id into v_new_col_node
      from public.kanban_columns
      where id = new.kanban_column_id;
  end if;

  -- Limpa edges incoming antigas
  delete from public.edges where target_node_id = v_task_node_id;

  -- Cria edge da nova coluna pro task node
  if v_new_col_node is not null then
    insert into public.edges (map_id, source_node_id, target_node_id)
    values (v_task_map_id, v_new_col_node, v_task_node_id);
  end if;

  return new;
end $$;

drop trigger if exists trg_task_sync_kanban_to_node on public.tasks;
create trigger trg_task_sync_kanban_to_node
  after update of kanban_column_id on public.tasks
  for each row execute function public.tg_task_sync_kanban_to_node();

-- ============================================================
-- Trigger: edge muda → atualiza kanban_column_id da task
-- ============================================================
create or replace function public.tg_edge_sync_to_kanban_column()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_target_task_id uuid;
  v_target_node_id uuid;
  v_source_node_id uuid;
  v_col_id uuid;
begin
  v_target_node_id := coalesce(new.target_node_id, old.target_node_id);
  v_source_node_id := coalesce(new.source_node_id, old.source_node_id);

  select task_id into v_target_task_id
    from public.nodes
    where id = v_target_node_id;
  if v_target_task_id is null then return coalesce(new, old); end if;

  if tg_op = 'INSERT' then
    select id into v_col_id from public.kanban_columns where node_id = v_source_node_id;
    if v_col_id is not null then
      update public.tasks set kanban_column_id = v_col_id where id = v_target_task_id;
    end if;
  elsif tg_op = 'DELETE' then
    select id into v_col_id from public.kanban_columns where node_id = v_source_node_id;
    if v_col_id is not null then
      -- Se sobrou outra edge da mesma coluna, ignora; senão limpa.
      if not exists (
        select 1 from public.edges e
        where e.target_node_id = v_target_node_id
          and e.source_node_id = v_source_node_id
          and (tg_op = 'INSERT' or e.id <> old.id)
      ) then
        update public.tasks
          set kanban_column_id = null
          where id = v_target_task_id and kanban_column_id = v_col_id;
      end if;
    end if;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_edge_sync_to_kanban_column on public.edges;
create trigger trg_edge_sync_to_kanban_column
  after insert or delete on public.edges
  for each row execute function public.tg_edge_sync_to_kanban_column();

-- ============================================================
-- Backfill: cria/linka nodes pras colunas existentes
-- ============================================================
do $$
declare r record;
begin
  for r in select id from public.kanban_columns where node_id is null loop
    perform public.ensure_kanban_column_node(r.id);
  end loop;
end $$;

-- ============================================================
-- Backfill: tasks com kanban_column_id ganham edge do node da coluna
-- ============================================================
do $$
declare r record;
begin
  for r in
    select
      t.id as task_id,
      c.node_id as col_node_id,
      n.id as task_node_id,
      n.map_id
    from public.tasks t
    join public.kanban_columns c on c.id = t.kanban_column_id
    join public.nodes n on n.task_id = t.id
    join public.maps m on m.id = n.map_id and m.project_id = t.project_id and m.is_default = true
    where c.node_id is not null
  loop
    if not exists (
      select 1 from public.edges e
      where e.target_node_id = r.task_node_id
        and e.source_node_id = r.col_node_id
    ) then
      delete from public.edges where target_node_id = r.task_node_id;
      insert into public.edges (map_id, source_node_id, target_node_id)
      values (r.map_id, r.col_node_id, r.task_node_id);
    end if;
  end loop;
end $$;
