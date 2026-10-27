-- ============================================================
-- Migration: notificações e dependências entre tarefas
-- ============================================================

-- Dependências entre tarefas (A depende de B → A só pode rodar quando B estiver concluída)
create table public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);
create index task_deps_task_idx on public.task_dependencies(task_id);
create index task_deps_depends_idx on public.task_dependencies(depends_on_task_id);

-- Notificações para usuários
create type notification_kind as enum (
  'task_assigned',
  'task_completed',
  'dependency_completed',
  'task_due_soon',
  'mention'
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind notification_kind not null,
  title text not null,
  body text,
  task_id uuid references public.tasks(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  actor_id uuid references public.users(id) on delete set null,
  read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);
create index notifications_unread_idx on public.notifications(user_id) where read = false;

-- ============================================================
-- RLS
-- ============================================================
alter table public.task_dependencies enable row level security;
alter table public.notifications     enable row level security;

create policy "task_dependencies_all_auth" on public.task_dependencies
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "notifications_select_own" on public.notifications
  for select using (user_id = auth.uid());
create policy "notifications_insert_authenticated" on public.notifications
  for insert with check (auth.role() = 'authenticated');
create policy "notifications_update_own" on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "notifications_delete_own" on public.notifications
  for delete using (user_id = auth.uid());

-- ============================================================
-- Realtime
-- ============================================================
alter table public.notifications     replica identity full;
alter table public.task_dependencies replica identity full;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.task_dependencies;

-- ============================================================
-- Trigger: ao concluir uma tarefa, notifica responsáveis das tarefas que dependiam dela
-- ============================================================
create or replace function public.notify_dependency_completed()
returns trigger language plpgsql security definer as $$
declare
  dep record;
  finisher_name text;
begin
  if new.status = 'concluido' and (old.status is distinct from 'concluido') then
    select nome into finisher_name from public.users where id = new.responsavel_id;
    for dep in
      select t.id, t.titulo, t.responsavel_id
      from public.task_dependencies td
      join public.tasks t on t.id = td.task_id
      where td.depends_on_task_id = new.id
        and t.responsavel_id is not null
    loop
      insert into public.notifications
        (user_id, kind, title, body, task_id, actor_id)
      values (
        dep.responsavel_id,
        'dependency_completed',
        'Dependência concluída — você já pode seguir',
        'A tarefa "' || new.titulo || '"' ||
          coalesce(' foi marcada como concluída por ' || finisher_name, ' foi concluída') ||
          '. Sua tarefa "' || dep.titulo || '" está liberada.',
        dep.id,
        new.responsavel_id
      );
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_dependency_completed on public.tasks;
create trigger trg_notify_dependency_completed
  after update on public.tasks
  for each row execute function public.notify_dependency_completed();

-- ============================================================
-- Trigger: ao atribuir um responsável a uma tarefa, notificar
-- ============================================================
create or replace function public.notify_task_assigned()
returns trigger language plpgsql security definer as $$
declare
  proj_name text;
  actor_name text;
begin
  -- só notifica em INSERT se já vier com responsavel, ou em UPDATE quando muda
  if (tg_op = 'INSERT' and new.responsavel_id is not null)
     or (tg_op = 'UPDATE' and new.responsavel_id is not null
         and new.responsavel_id is distinct from old.responsavel_id) then

    -- não notifica se for quem criou (self-assign)
    if new.responsavel_id <> coalesce(new.created_by, '00000000-0000-0000-0000-000000000000'::uuid) then
      select nome into proj_name from public.projects where id = new.project_id;
      select nome into actor_name from public.users where id = new.created_by;
      insert into public.notifications
        (user_id, kind, title, body, task_id, project_id, actor_id)
      values (
        new.responsavel_id,
        'task_assigned',
        'Nova tarefa atribuída a você',
        coalesce(actor_name, 'Alguém') ||
          ' atribuiu "' || new.titulo || '"' ||
          coalesce(' no projeto ' || proj_name, '') || ' para você.',
        new.id,
        new.project_id,
        new.created_by
      );
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_task_assigned on public.tasks;
create trigger trg_notify_task_assigned
  after insert or update on public.tasks
  for each row execute function public.notify_task_assigned();
