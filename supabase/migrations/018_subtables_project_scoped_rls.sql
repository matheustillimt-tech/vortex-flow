-- ============================================================
-- Migration 018: subtabelas de task respeitam acesso por projeto
-- ============================================================
-- Antes (migration 016), task_links/comments/checklist/dependencies estavam
-- liberadas pra qualquer autenticado. Isso significa que um usuário restrito
-- a 1 projeto podia ler links/comments/etc de tasks de projetos que ele NÃO
-- tem acesso (basta conhecer o task_id). Aqui amarramos via tasks→project.
-- Mesma lógica pra task_attachments e task_assignees.

create or replace function public.user_can_see_task(uid uuid, tid uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  pid uuid;
begin
  if uid is null or tid is null then return false; end if;
  if public.is_admin(uid) then return true; end if;
  select project_id into pid from public.tasks where id = tid;
  if pid is null then return true;            -- task órfã: visível (raro)
  end if;
  return public.user_can_see_project(uid, pid);
end;
$$;

revoke all on function public.user_can_see_task(uuid, uuid) from public;
grant execute on function public.user_can_see_task(uuid, uuid) to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'task_links',
    'task_comments',
    'task_checklist_items',
    'task_dependencies',
    'task_attachments',
    'task_assignees'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    -- Drop policies antigas (abertas)
    execute format('drop policy if exists "%I_select_authenticated" on public.%I', t, t);
    execute format('drop policy if exists "%I_write_authenticated" on public.%I', t, t);
    execute format('drop policy if exists "%I_select" on public.%I', t, t);
    execute format('drop policy if exists "%I_write" on public.%I', t, t);

    -- Policies estritas: respeitam acesso por projeto via tasks
    execute format(
      'create policy "%I_select_scoped" on public.%I for select using (auth.role() = ''authenticated'' and public.user_can_see_task(auth.uid(), task_id))',
      t, t
    );
    execute format(
      'create policy "%I_write_scoped" on public.%I for all using (auth.role() = ''authenticated'' and public.user_can_see_task(auth.uid(), task_id)) with check (auth.role() = ''authenticated'' and public.user_can_see_task(auth.uid(), task_id))',
      t, t
    );
  end loop;
end $$;
