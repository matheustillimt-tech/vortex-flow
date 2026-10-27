-- ============================================================
-- Migration 027: fix apply_process_template (coluna do checklist)
-- ============================================================
-- A migration 026 escrevia "concluido" em task_checklist_items, mas a coluna
-- real é "done". Causava: Falha ao aplicar: column "concluido" of relation
-- "task_checklist_items" does not exist.

create or replace function public.apply_process_template(
  p_template_id uuid,
  p_project_id uuid,
  p_anchor_date date
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kanban_first_col uuid;
  v_etapa record;
  v_task record;
  v_new_task_id uuid;
  v_created_count int := 0;
  v_user uuid;
begin
  v_user := auth.uid();

  select id into v_kanban_first_col
    from public.kanban_columns
    where project_id = p_project_id
    order by ordem asc
    limit 1;

  for v_etapa in
    select * from public.template_etapas
    where template_id = p_template_id
    order by ordem
  loop
    for v_task in
      select * from public.template_tasks
      where template_id = p_template_id
        and (etapa_id = v_etapa.id or (etapa_id is null and v_etapa.id is null))
      order by ordem
    loop
      insert into public.tasks (
        titulo,
        descricao,
        project_id,
        status,
        prioridade,
        prazo,
        prazo_has_time,
        kanban_column_id,
        created_by
      ) values (
        v_task.nome,
        case
          when v_task.descricao is not null and v_task.criterio_conclusao is not null
            then v_task.descricao || E'\n\n**Critério de conclusão:**\n' || v_task.criterio_conclusao
          when v_task.descricao is not null then v_task.descricao
          when v_task.criterio_conclusao is not null
            then E'**Critério de conclusão:**\n' || v_task.criterio_conclusao
          else null
        end,
        p_project_id,
        'pendente',
        v_task.prioridade,
        case when v_task.dias_offset is not null and p_anchor_date is not null
          then (p_anchor_date + (v_task.dias_offset || ' days')::interval)::timestamptz
          else null
        end,
        false,
        v_kanban_first_col,
        v_user
      )
      returning id into v_new_task_id;

      -- ✅ Coluna correta é `done`, não `concluido`.
      insert into public.task_checklist_items (task_id, titulo, ordem, done)
      select v_new_task_id, titulo, ordem, false
      from public.template_checklist_items
      where template_task_id = v_task.id
      order by ordem;

      v_created_count := v_created_count + 1;
    end loop;
  end loop;

  return v_created_count;
end $$;
