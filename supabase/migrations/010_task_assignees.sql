-- ============================================================
-- Migration 010: múltiplos responsáveis por tarefa
-- ============================================================
-- Mantém tasks.responsavel_id como "responsável principal" (compat com
-- código existente); adiciona task_assignees como tabela canônica de
-- TODOS os responsáveis (1 ou mais).

create table if not exists public.task_assignees (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  primary_assignee boolean not null default false,
  assigned_by uuid references public.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

-- Garante colunas mesmo se a tabela já existia de uma versão antiga
alter table public.task_assignees
  add column if not exists primary_assignee boolean not null default false;
alter table public.task_assignees
  add column if not exists assigned_by uuid references public.users(id) on delete set null;
alter table public.task_assignees
  add column if not exists assigned_at timestamptz not null default now();

create index if not exists task_assignees_user_idx
  on public.task_assignees(user_id);
create index if not exists task_assignees_task_idx
  on public.task_assignees(task_id);

-- Backfill: cada task com responsavel_id ganha uma linha como primary.
insert into public.task_assignees (task_id, user_id, primary_assignee)
select id, responsavel_id, true
from public.tasks
where responsavel_id is not null
on conflict (task_id, user_id) do update
  set primary_assignee = true;

-- RLS
alter table public.task_assignees enable row level security;

drop policy if exists "task_assignees_select" on public.task_assignees;
create policy "task_assignees_select" on public.task_assignees
  for select using (auth.role() = 'authenticated');

drop policy if exists "task_assignees_write" on public.task_assignees;
create policy "task_assignees_write" on public.task_assignees
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Realtime
alter table public.task_assignees replica identity full;
do $$
begin
  begin
    alter publication supabase_realtime add table public.task_assignees;
  exception when duplicate_object then null;
  end;
end $$;

-- Trigger: quando tasks.responsavel_id muda (paths antigos), espelha em
-- task_assignees marcando aquele user como primary e desmarcando outros.
-- Caminhos novos atualizam direto task_assignees + responsavel_id em
-- transação no app — esse trigger é só rede de segurança pra updates legados.
create or replace function public.sync_responsavel_to_assignees()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.responsavel_id is distinct from old.responsavel_id then
    -- Desmarca primários atuais dessa task
    update public.task_assignees
      set primary_assignee = false
      where task_id = new.id and primary_assignee = true;
    -- Insere/atualiza o novo primary (idempotente)
    if new.responsavel_id is not null then
      insert into public.task_assignees (task_id, user_id, primary_assignee)
      values (new.id, new.responsavel_id, true)
      on conflict (task_id, user_id)
      do update set primary_assignee = true;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_responsavel_assignees on public.tasks;
create trigger trg_sync_responsavel_assignees
  after update of responsavel_id on public.tasks
  for each row execute function public.sync_responsavel_to_assignees();
