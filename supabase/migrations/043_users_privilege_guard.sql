-- Fecha a escalada de privilégio em public.users e amarra role ao perfil.
--
-- A policy users_update_self (schema.sql) deixa cada pessoa atualizar QUALQUER
-- coluna da própria linha. Com isso um colaborador podia se promover sozinho:
-- antes via role = 'admin' (que as rotas de admin conferem antes de usar a
-- service-role key) e, desde a 042, via permission_profile_id. Esta migration
-- impede que colunas de privilégio sejam alteradas por quem não administra.
--
-- role deixa de ser escrita diretamente e passa a ser DERIVADA do perfil, para
-- que as checagens legadas (role === 'admin' na aplicação) sigam coerentes até
-- serem migradas para permissões.
--
-- Também impede que a equipe fique sem ninguém com acesso total: o último
-- Super Admin ativo não pode ser rebaixado, desativado nem excluído.

begin;

-- ---------------------------------------------------------------- derivação

create or replace function public.role_for_profile(p_profile_id uuid)
returns public.user_role
language sql stable security definer
set search_path = ''
as $$
  select case
    when p.full_access then 'admin'::public.user_role
    when p.can_manage then 'gestor'::public.user_role
    else 'colaborador'::public.user_role
  end
  from public.permission_profiles p
  where p.id = p_profile_id;
$$;

-- Verdadeiro se, tirando `p_excluir`, ainda sobra alguém ativo com acesso total.
create or replace function public.other_full_access_exists(p_excluir uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    join public.permission_profiles p on p.id = u.permission_profile_id
    where u.id <> p_excluir and u.ativo and p.full_access
  );
$$;

-- ---------------------------------------------------------------- insert/update

create or replace function public.users_privileges_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_era_total boolean;
  v_fica_total boolean;
begin
  if tg_op = 'INSERT' then
    -- Quem nasce sem perfil (ex.: o gatilho de auth.users) recebe o
    -- equivalente ao role informado.
    if new.permission_profile_id is null then
      select id into new.permission_profile_id
      from public.permission_profiles
      where nome = case when new.role = 'admin' then 'Super Admin'
                        else 'Sem permissões' end;
    end if;

  else
    -- Colunas de privilégio só mudam por administrador ou pelo servidor.
    -- A service-role key chega sem auth.uid(); as rotas fazem a própria checagem.
    if (new.permission_profile_id is distinct from old.permission_profile_id
        or new.role is distinct from old.role
        or new.ativo is distinct from old.ativo)
       and v_actor is not null
       and not coalesce(public.is_admin(v_actor), false) then
      raise exception
        'Apenas administradores podem alterar perfil de permissão, tipo ou status de acesso'
        using errcode = '42501';
    end if;

    -- Compatibilidade: código antigo que ainda grava role sem mexer no perfil.
    if new.role is distinct from old.role
       and new.permission_profile_id is not distinct from old.permission_profile_id then
      if new.role = 'admin' then
        select id into new.permission_profile_id
        from public.permission_profiles where nome = 'Super Admin';
      elsif old.role = 'admin' then
        select id into new.permission_profile_id
        from public.permission_profiles where nome = 'Sem permissões';
      end if;
    end if;

    -- Não deixa a operação sem ninguém com acesso total.
    select coalesce(bool_or(p.full_access), false) into v_era_total
    from public.permission_profiles p where p.id = old.permission_profile_id;
    select coalesce(bool_or(p.full_access), false) into v_fica_total
    from public.permission_profiles p where p.id = new.permission_profile_id;

    if old.ativo and v_era_total
       and not (new.ativo and v_fica_total)
       and not public.other_full_access_exists(old.id) then
      raise exception
        'Não é possível remover o último Super Admin ativo. Promova outra pessoa antes.'
        using errcode = '42501';
    end if;
  end if;

  -- role é sempre o reflexo do perfil.
  if new.permission_profile_id is not null then
    new.role := public.role_for_profile(new.permission_profile_id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_users_privileges on public.users;
create trigger trg_users_privileges
  before insert or update on public.users
  for each row execute function public.users_privileges_guard();

-- ---------------------------------------------------------------- delete

create or replace function public.users_last_admin_delete_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if old.ativo
     and exists (
       select 1 from public.permission_profiles p
       where p.id = old.permission_profile_id and p.full_access
     )
     and not public.other_full_access_exists(old.id) then
    raise exception
      'Não é possível excluir o último Super Admin ativo.'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_users_last_admin_delete on public.users;
create trigger trg_users_last_admin_delete
  before delete on public.users
  for each row execute function public.users_last_admin_delete_guard();

-- ---------------------------------------------------------------- perfil muda

-- Se as capacidades de um perfil mudarem, o role de quem o usa acompanha.
create or replace function public.permission_profiles_resync_roles()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.full_access is distinct from old.full_access
     or new.can_manage is distinct from old.can_manage then
    -- Não toca em colunas de privilégio: o gatilho de users recalcula o role.
    update public.users
    set permission_profile_id = permission_profile_id
    where permission_profile_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_permission_profiles_resync on public.permission_profiles;
create trigger trg_permission_profiles_resync
  after update on public.permission_profiles
  for each row execute function public.permission_profiles_resync_roles();

-- ---------------------------------------------------------------- alinhamento

-- Garante que o role de todo mundo já reflete o perfil atual.
update public.users set permission_profile_id = permission_profile_id;

notify pgrst, 'reload schema';
commit;
