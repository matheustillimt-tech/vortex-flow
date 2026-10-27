-- ============================================================
-- Migration 036: remove sync kanban↔mapa mental (feature descontinuada)
-- ============================================================
-- O mapa mental foi removido, mas os triggers da 020/023 que sincronizavam
-- kanban_columns ↔ nodes continuaram ativos. Ao excluir uma coluna:
--   1. trg_kanban_column_before_delete deletava o node vinculado
--   2. kanban_columns.node_id (FK ON DELETE SET NULL) disparava um UPDATE
--      na MESMA coluna que estava sendo deletada
--   3. Postgres: "tuple to be deleted was already modified by an operation
--      triggered by the current command"
-- Removemos todos esses triggers/funções e a coluna node_id.

-- Triggers em kanban_columns
drop trigger if exists trg_kanban_column_after_insert on public.kanban_columns;
drop trigger if exists trg_kanban_column_sync_node on public.kanban_columns;
drop trigger if exists trg_kanban_column_before_delete on public.kanban_columns;

-- Trigger em tasks (sincronizava a coluna com o node da task)
drop trigger if exists trg_task_sync_kanban_to_node on public.tasks;

-- Trigger em edges (existe só se a tabela edges existir)
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'edges'
  ) then
    execute 'drop trigger if exists trg_edge_sync_to_kanban_column on public.edges';
  end if;
end $$;

-- Funções agora órfãs
drop function if exists public.tg_kanban_column_after_insert() cascade;
drop function if exists public.tg_kanban_column_sync_node() cascade;
drop function if exists public.tg_kanban_column_before_delete() cascade;
drop function if exists public.tg_task_sync_kanban_to_node() cascade;
drop function if exists public.tg_edge_sync_to_kanban_column() cascade;
drop function if exists public.ensure_kanban_column_node(uuid) cascade;

-- Remove a coluna node_id (a FK que causava o conflito na deleção)
alter table public.kanban_columns drop column if exists node_id;
