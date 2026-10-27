-- ============================================================
-- Migration 016: RLS aberta nas subtabelas de task
-- ============================================================
-- task_links, task_comments, task_checklist_items, task_dependencies
-- estavam com RLS habilitada mas SEM policies, o que silenciosamente bloqueava
-- SELECT (e às vezes INSERT). Sintoma: usuário adicionava link na tarefa,
-- o INSERT "passava" sem erro óbvio, mas ao reabrir a tarefa o link sumia.
--
-- A regra é a mesma do resto das subtabelas: qualquer autenticado pode
-- ler/escrever. O acesso à tarefa pai já é gateado pela RLS de public.tasks
-- (migration 015) — então quem não vê a tarefa, não consegue criar relação
-- pra ela mesmo assim por causa do FK + leitura encadeada.

do $$
declare
  t text;
begin
  foreach t in array array[
    'task_links',
    'task_comments',
    'task_checklist_items',
    'task_dependencies'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%I_select_authenticated" on public.%I', t, t);
    execute format(
      'create policy "%I_select_authenticated" on public.%I for select using (auth.role() = ''authenticated'')',
      t, t
    );
    execute format('drop policy if exists "%I_write_authenticated" on public.%I', t, t);
    execute format(
      'create policy "%I_write_authenticated" on public.%I for all using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'')',
      t, t
    );
  end loop;
end $$;
