-- ============================================================
-- Migration 011: notifica todos os assignees (não só responsavel_id)
-- ============================================================

create or replace function public.notify_task_assignee_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  proj_name text;
  task_titulo text;
  task_project uuid;
  task_creator uuid;
  actor_name text;
begin
  -- Quem está logado nessa transação (quem fez o assign)
  -- (auth.uid() funciona dentro de SECURITY DEFINER ao ser chamado via RLS)
  perform set_config('row_security', 'on', true);

  select titulo, project_id, created_by
    into task_titulo, task_project, task_creator
  from public.tasks
  where id = new.task_id;

  if task_titulo is null then
    return new;
  end if;

  -- Não notifica quando a própria pessoa se atribui (assigned_by = user_id)
  if new.assigned_by is not null and new.assigned_by = new.user_id then
    return new;
  end if;
  -- Nem se for quem criou a task (self-assignment do criador)
  if task_creator is not null and task_creator = new.user_id then
    return new;
  end if;

  select nome into proj_name from public.projects where id = task_project;
  select nome into actor_name from public.users where id = coalesce(new.assigned_by, task_creator);

  insert into public.notifications
    (user_id, kind, title, body, task_id, project_id, actor_id)
  values (
    new.user_id,
    'task_assigned',
    'Nova tarefa atribuída a você',
    coalesce(actor_name, 'Alguém') ||
      ' atribuiu "' || task_titulo || '"' ||
      coalesce(' no projeto ' || proj_name, '') || ' para você.',
    new.task_id,
    task_project,
    coalesce(new.assigned_by, task_creator)
  );
  return new;
end $$;

drop trigger if exists trg_notify_task_assignee_added on public.task_assignees;
create trigger trg_notify_task_assignee_added
  after insert on public.task_assignees
  for each row execute function public.notify_task_assignee_added();
