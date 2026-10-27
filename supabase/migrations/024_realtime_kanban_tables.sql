-- ============================================================
-- Migration 024: garante que kanban + tasks + assignees estão no
-- publication supabase_realtime (necessário pra o frontend receber
-- eventos de outros usuários).
-- ============================================================

alter table public.tasks replica identity full;
alter table public.kanban_columns replica identity full;
alter table public.task_assignees replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.tasks;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.kanban_columns;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.task_assignees;
  exception when duplicate_object then null;
  end;
end $$;
