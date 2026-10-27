-- Tarefas seguem o perfil de permissão.
--
-- Até aqui, qualquer pessoa logada que enxergasse o projeto podia criar, alterar
-- e excluir tarefas e suas subtabelas. As permissões do perfil passam a valer
-- no banco, e não só na tela — o navegador grava direto nessas tabelas.
--
-- Decisão de produto: tudo segue o perfil. Sem "Editar" em Todas as tarefas, a
-- pessoa não altera nenhuma tarefa, nem as atribuídas a ela.
--
-- As políticas novas são RESTRICTIVE: somam-se (AND) às de acesso por projeto
-- (015/018/041) sem conceder nada novo. As funções de sincronização do kanban e
-- de remoção de tarefa órfã são security definer e seguem funcionando.
--
-- has_permission() entra dentro de (select ...) para ser avaliada uma vez por
-- comando, e não uma vez por linha.

begin;

-- ---------------------------------------------------------------- tasks

drop policy if exists "tasks_perm_insert" on public.tasks;
create policy "tasks_perm_insert" on public.tasks as restrictive
  for insert to authenticated
  with check ((select public.has_permission(auth.uid(), 'tarefas', 'create')));

drop policy if exists "tasks_perm_update" on public.tasks;
create policy "tasks_perm_update" on public.tasks as restrictive
  for update to authenticated
  using ((select public.has_permission(auth.uid(), 'tarefas', 'edit')))
  with check ((select public.has_permission(auth.uid(), 'tarefas', 'edit')));

drop policy if exists "tasks_perm_delete" on public.tasks;
create policy "tasks_perm_delete" on public.tasks as restrictive
  for delete to authenticated
  using ((select public.has_permission(auth.uid(), 'tarefas', 'delete')));

-- ---------------------------------------------------------------- subtabelas

-- Responsáveis, checklist, links, dependências e anexos fazem parte da tarefa.
-- Inserir aceita Criar OU Editar: o fluxo de criação grava a tarefa e, em
-- seguida, responsáveis e checklist. Alterar e excluir exigem Editar.
--
-- Comentários ficam de fora de propósito: comentar é conversa, não edição, e
-- continua liberado a quem enxerga a tarefa.
do $$
declare
  t text;
begin
  foreach t in array array[
    'task_assignees',
    'task_checklist_items',
    'task_links',
    'task_dependencies',
    'task_attachments'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_perm_insert', t);
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated
       with check ((select public.has_permission(auth.uid(), ''tarefas'', ''create''))
                or (select public.has_permission(auth.uid(), ''tarefas'', ''edit'')))',
      t || '_perm_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_perm_update', t);
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated
       using ((select public.has_permission(auth.uid(), ''tarefas'', ''edit'')))
       with check ((select public.has_permission(auth.uid(), ''tarefas'', ''edit'')))',
      t || '_perm_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_perm_delete', t);
    execute format(
      'create policy %I on public.%I as restrictive for delete to authenticated
       using ((select public.has_permission(auth.uid(), ''tarefas'', ''edit'')))',
      t || '_perm_delete', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- brecha das RPCs

-- apply_template_task e apply_process_template são security definer, estavam
-- liberadas a qualquer pessoa logada e não conferem permissão: criavam tarefas
-- por cima da RLS. Sobraram da área de Processos, removida do app, e não são
-- chamadas em lugar nenhum. Revoga a execução.
do $$
begin
  if to_regprocedure('public.apply_template_task(uuid, uuid, date)') is not null then
    revoke execute on function public.apply_template_task(uuid, uuid, date)
      from public, anon, authenticated;
  end if;
  if to_regprocedure('public.apply_process_template(uuid, uuid, date)') is not null then
    revoke execute on function public.apply_process_template(uuid, uuid, date)
      from public, anon, authenticated;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
