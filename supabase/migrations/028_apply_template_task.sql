-- ============================================================
-- Migration 028: RPC pra aplicar UMA tarefa do modelo de cada vez
-- ============================================================
-- Permite enviar tarefas do template uma a uma (ou em lote selecionado),
-- ao invés de aplicar o processo inteiro. Retorna o uuid da task criada
-- pra UI conseguir referenciar/abrir.

create or replace function public.apply_template_task(
  p_template_task_id uuid,
  p_project_id uuid,
  p_anchor_date date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task record;
  v_new_task_id uuid;
  v_kanban_first_col uuid;
  v_user uuid;
begin
  v_user := auth.uid();

  select * into v_task
    from public.template_tasks
    where id = p_template_task_id;
  if v_task.id is null then
    raise exception 'template_task % não encontrada', p_template_task_id;
  end if;

  select id into v_kanban_first_col
    from public.kanban_columns
    where project_id = p_project_id
    order by ordem asc
    limit 1;

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

  insert into public.task_checklist_items (task_id, titulo, ordem, done)
  select v_new_task_id, titulo, ordem, false
  from public.template_checklist_items
  where template_task_id = v_task.id
  order by ordem;

  return v_new_task_id;
end $$;

revoke all on function public.apply_template_task(uuid, uuid, date) from public;
grant execute on function public.apply_template_task(uuid, uuid, date) to authenticated;
