-- Projetos e Setores seguem o perfil de permissão.
--
-- Até aqui, qualquer pessoa que enxergasse um projeto podia editar, arquivar e
-- excluir esse projeto (projects_admin_write libera is_admin OR "vê o projeto"),
-- e o mesmo valia para funis, produtos e a configuração das colunas do kanban.
-- Criar e excluir coluna exigia Super Admin; setores exigiam a caixa "gerir
-- conteúdo" (can_manage). As ações do perfil passam a decidir.
--
-- Mapeamento:
--   projects                  criar → projetos:create · alterar (inclui arquivar e
--                             restaurar, reversíveis) → projetos:edit · excluir → projetos:delete
--   funnels, products         qualquer escrita → projetos:edit
--   kanban_columns            inserir → projetos:create OU edit (colunas padrão podem
--                             nascer junto com um projeto novo) · alterar e excluir → edit
--   sectors                   criar/alterar/excluir → configuracoes.setores:create/edit/delete
--
-- Mapas, nós e arestas ficam de fora: nenhuma tela ativa grava neles além do mapa
-- padrão criado com o projeto, e os gatilhos que os sincronizavam com o kanban
-- foram removidos na 036.

begin;

-- ---------------------------------------------------------------- projects

drop policy if exists "projects_perm_insert" on public.projects;
create policy "projects_perm_insert" on public.projects as restrictive
  for insert to authenticated
  with check ((select public.has_permission(auth.uid(), 'projetos', 'create')));

drop policy if exists "projects_perm_update" on public.projects;
create policy "projects_perm_update" on public.projects as restrictive
  for update to authenticated
  using ((select public.has_permission(auth.uid(), 'projetos', 'edit')))
  with check ((select public.has_permission(auth.uid(), 'projetos', 'edit')));

drop policy if exists "projects_perm_delete" on public.projects;
create policy "projects_perm_delete" on public.projects as restrictive
  for delete to authenticated
  using ((select public.has_permission(auth.uid(), 'projetos', 'delete')));

-- ---------------------------------------------------------------- funis e produtos

do $$
declare
  t text;
begin
  foreach t in array array['funnels', 'products']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_perm_insert', t);
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated
       with check ((select public.has_permission(auth.uid(), ''projetos'', ''edit'')))',
      t || '_perm_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_perm_update', t);
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated
       using ((select public.has_permission(auth.uid(), ''projetos'', ''edit'')))
       with check ((select public.has_permission(auth.uid(), ''projetos'', ''edit'')))',
      t || '_perm_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_perm_delete', t);
    execute format(
      'create policy %I on public.%I as restrictive for delete to authenticated
       using ((select public.has_permission(auth.uid(), ''projetos'', ''edit'')))',
      t || '_perm_delete', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- colunas do kanban

-- As políticas antigas de inserir e excluir eram PERMISSIVAS e só aceitavam Super
-- Admin: somar uma trava não bastaria para delegar. São substituídas por
-- equivalentes que mantêm o escopo por projeto e passam a olhar o perfil.
drop policy if exists "kanban_columns_insert_admin" on public.kanban_columns;
drop policy if exists "kanban_columns_insert_perm" on public.kanban_columns;
create policy "kanban_columns_insert_perm" on public.kanban_columns
  for insert to authenticated
  with check (
    public.user_can_see_project(auth.uid(), project_id)
    and (
      (select public.has_permission(auth.uid(), 'projetos', 'create'))
      or (select public.has_permission(auth.uid(), 'projetos', 'edit'))
    )
  );

drop policy if exists "kanban_columns_delete_admin" on public.kanban_columns;
drop policy if exists "kanban_columns_delete_perm" on public.kanban_columns;
create policy "kanban_columns_delete_perm" on public.kanban_columns
  for delete to authenticated
  using (
    public.user_can_see_project(auth.uid(), project_id)
    and (select public.has_permission(auth.uid(), 'projetos', 'edit'))
  );

-- Renomear, trocar cor, status ao mover e ordem: soma a trava à política de escopo.
drop policy if exists "kanban_columns_perm_update" on public.kanban_columns;
create policy "kanban_columns_perm_update" on public.kanban_columns as restrictive
  for update to authenticated
  using ((select public.has_permission(auth.uid(), 'projetos', 'edit')))
  with check ((select public.has_permission(auth.uid(), 'projetos', 'edit')));

-- ---------------------------------------------------------------- setores

-- sectors_write liberava tudo a quem tivesse acesso total ou "gerir conteúdo".
-- Dá lugar a uma política por ação, ligada à aba Setores.
drop policy if exists "sectors_write" on public.sectors;

drop policy if exists "sectors_perm_insert" on public.sectors;
create policy "sectors_perm_insert" on public.sectors
  for insert to authenticated
  with check ((select public.has_permission(auth.uid(), 'configuracoes.setores', 'create')));

drop policy if exists "sectors_perm_update" on public.sectors;
create policy "sectors_perm_update" on public.sectors
  for update to authenticated
  using ((select public.has_permission(auth.uid(), 'configuracoes.setores', 'edit')))
  with check ((select public.has_permission(auth.uid(), 'configuracoes.setores', 'edit')));

drop policy if exists "sectors_perm_delete" on public.sectors;
create policy "sectors_perm_delete" on public.sectors
  for delete to authenticated
  using ((select public.has_permission(auth.uid(), 'configuracoes.setores', 'delete')));

notify pgrst, 'reload schema';
commit;
