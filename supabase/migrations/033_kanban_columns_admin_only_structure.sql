-- ============================================================
-- Migration 033: só admin adiciona/exclui colunas do kanban
-- ============================================================
-- Antes: qualquer membro do projeto podia inserir/atualizar/excluir
-- colunas (policy "for all"). Agora:
--   - SELECT  : qualquer membro do projeto (inalterado)
--   - UPDATE  : qualquer membro (renomear, cor, reordenar) — inalterado
--   - INSERT  : só admin
--   - DELETE  : só admin
-- Mover um card NÃO mexe em kanban_columns (é update em tasks), então
-- continua livre pra todos.

alter table public.kanban_columns enable row level security;

-- Remove a policy ampla "for all"
drop policy if exists "kanban_columns_write_scoped" on public.kanban_columns;

-- UPDATE continua liberado pra membros do projeto (rename/cor/reorder)
drop policy if exists "kanban_columns_update_scoped" on public.kanban_columns;
create policy "kanban_columns_update_scoped" on public.kanban_columns
  for update using (
    auth.role() = 'authenticated'
    and public.user_can_see_project(auth.uid(), project_id)
  )
  with check (
    auth.role() = 'authenticated'
    and public.user_can_see_project(auth.uid(), project_id)
  );

-- INSERT só admin
drop policy if exists "kanban_columns_insert_admin" on public.kanban_columns;
create policy "kanban_columns_insert_admin" on public.kanban_columns
  for insert with check (public.is_admin(auth.uid()));

-- DELETE só admin
drop policy if exists "kanban_columns_delete_admin" on public.kanban_columns;
create policy "kanban_columns_delete_admin" on public.kanban_columns
  for delete using (public.is_admin(auth.uid()));
