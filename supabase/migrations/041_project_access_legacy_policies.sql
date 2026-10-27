-- Policies permissivas são combinadas com OR. As policies abertas do schema
-- original sobrevivem à migration 015 e anulam suas restrições por projeto.
-- Guardas RESTRICTIVE somam a restrição (AND) sem conceder novas operações.
begin;

drop policy if exists "projects_access_guard" on public.projects;
create policy "projects_access_guard" on public.projects as restrictive
  for all to authenticated
  using (public.user_can_see_project(auth.uid(), id))
  with check (public.user_can_see_project(auth.uid(), id));

do $$
declare t text;
begin
  foreach t in array array['tasks', 'maps', 'funnels', 'products'] loop
    execute format('drop policy if exists project_access_guard on public.%I', t);
    execute format(
      'create policy project_access_guard on public.%I as restrictive for all to authenticated
       using (project_id is null or public.user_can_see_project(auth.uid(), project_id))
       with check (project_id is null or public.user_can_see_project(auth.uid(), project_id))', t);
  end loop;
  foreach t in array array['nodes', 'edges'] loop
    execute format('drop policy if exists project_access_guard on public.%I', t);
    execute format(
      'create policy project_access_guard on public.%1$I as restrictive for all to authenticated
       using (exists (select 1 from public.maps m where m.id = %1$I.map_id
         and (m.project_id is null or public.user_can_see_project(auth.uid(), m.project_id))))
       with check (exists (select 1 from public.maps m where m.id = %1$I.map_id
         and (m.project_id is null or public.user_can_see_project(auth.uid(), m.project_id))))', t);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
