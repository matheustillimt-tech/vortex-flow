-- Corrige instalações criadas por schema.sql antes da migration 015.
-- CREATE TABLE IF NOT EXISTS não acrescenta colunas à tabela existente.
begin;

alter table public.project_members
  add column if not exists granted_by uuid references public.users(id) on delete set null,
  add column if not exists granted_at timestamptz;

-- Preserva a data histórica quando disponível; não inventa o autor de acessos antigos.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'project_members'
      and column_name = 'created_at'
  ) then
    execute 'update public.project_members set granted_at = created_at where granted_at is null';
  end if;
end;
$$;
update public.project_members set granted_at = now() where granted_at is null;
alter table public.project_members
  alter column granted_at set default now(),
  alter column granted_at set not null;

-- A policy antiga permitia também a gestores alterar restrições diretamente.
drop policy if exists "project_members_write" on public.project_members;

create or replace function public.set_user_project_access(
  p_user_id uuid,
  p_project_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.user_role;
  v_ids uuid[];
begin
  if v_actor is null or not coalesce(public.is_admin(v_actor), false) then
    raise exception 'Apenas administradores' using errcode = '42501';
  end if;
  if p_user_id is null or p_project_ids is null
     or array_position(p_project_ids, null) is not null then
    raise exception 'Informe o membro e uma lista válida de projetos' using errcode = '22023';
  end if;

  -- Serializa alterações concorrentes do mesmo membro, inclusive na lista vazia.
  select role into v_role from public.users where id = p_user_id for update;
  if not found then
    raise exception 'Membro não encontrado' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct id), '{}'::uuid[]) into v_ids
  from unnest(p_project_ids) as requested(id);

  -- Admins ignoram project_members na regra de leitura; não prometemos restringi-los.
  if v_role = 'admin' and cardinality(v_ids) > 0 then
    raise exception 'Administradores sempre têm acesso a todos os projetos' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_ids) as requested(id)
    where not exists (select 1 from public.projects p where p.id = requested.id)
  ) then
    raise exception 'Um dos projetos não existe mais. Recarregue a lista.' using errcode = '22023';
  end if;

  -- Mantém autoria/data dos acessos que continuam selecionados.
  insert into public.project_members (project_id, user_id, granted_by)
    select id, p_user_id, v_actor from unnest(v_ids) as requested(id)
    on conflict (project_id, user_id) do nothing;
  delete from public.project_members
    where user_id = p_user_id and not (project_id = any(v_ids));

  -- Lista vazia mantém a semântica existente: acesso a projetos atuais e futuros.
  return jsonb_build_object('ok', true, 'restricted', cardinality(v_ids) > 0,
                           'count', cardinality(v_ids));
end;
$$;

revoke all on function public.set_user_project_access(uuid, uuid[]) from public, anon;
grant execute on function public.set_user_project_access(uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';
commit;
