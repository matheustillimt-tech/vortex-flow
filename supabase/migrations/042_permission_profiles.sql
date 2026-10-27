-- Perfis de permissão.
--
-- Substitui o enum user_role como AUTORIDADE de acesso. As ~36 policies de RLS
-- não são reescritas aqui: elas chamam is_admin() / is_admin_or_gestor(), e são
-- essas duas funções que passam a consultar o perfil em vez do enum. Reescrever
-- as policies uma a uma fica para depois, com o modelo já em produção e testado.
--
-- A coluna users.role NÃO é removida ainda: a aplicação ainda a lê em vários
-- pontos. Ela deixa de mandar aqui; a remoção vem quando a UI terminar de migrar.
--
-- SEGURANÇA: a transação aborta se qualquer usuário ativo terminar sem perfil.
-- É a trava que impede a migration de trancar todo mundo para fora.

begin;

-- ---------------------------------------------------------------- tabelas

create table if not exists public.permission_profiles (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  descricao text,
  -- Perfil de sistema: não pode ser excluído nem ter o nome trocado.
  is_system boolean not null default false,
  -- Acesso irrestrito. Curto-circuita qualquer concessão (o Super Admin).
  -- Herda o que role='admin' fazia.
  full_access boolean not null default false,
  -- Pode editar/arquivar conteúdo de qualquer projeto.
  -- Herda o que role in ('admin','gestor') fazia.
  can_manage boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- resource/action são texto livre de propósito: o catálogo vive em
-- lib/permissions.ts, então renomear um menu não exige migration.
create table if not exists public.permission_grants (
  profile_id uuid not null references public.permission_profiles(id) on delete cascade,
  resource text not null,
  action text not null check (action in ('view', 'create', 'edit', 'delete')),
  primary key (profile_id, resource, action)
);

alter table public.users
  add column if not exists permission_profile_id uuid
    references public.permission_profiles(id) on delete restrict;

create index if not exists idx_users_permission_profile
  on public.users(permission_profile_id);

-- ---------------------------------------------------------------- perfis base

-- Apenas dois perfis nascem aqui. Super Admin responde por tudo via
-- full_access; "Sem permissões" nasce em branco, de propósito: os perfis reais
-- (Suporte, Tráfego, Financeiro...) serão desenhados na tela, com o catálogo
-- à vista, em vez de adivinhados numa migration.
insert into public.permission_profiles (nome, descricao, is_system, full_access, can_manage)
values
  ('Super Admin',
   'Acesso irrestrito a todos os menus, abas e ações.',
   true, true, true),
  ('Sem permissões',
   'Ponto de partida, sem nenhum acesso. Atribua um perfil configurado no lugar deste.',
   true, false, false)
on conflict (nome) do nothing;

-- ---------------------------------------------------------------- backfill

-- Quem é admin hoje continua com tudo. Todo o resto entra em branco e recebe
-- um perfil configurado depois, pela tela.
update public.users u
set permission_profile_id = p.id
from public.permission_profiles p
where u.permission_profile_id is null
  and p.nome = case when u.role = 'admin' then 'Super Admin'
                    else 'Sem permissões' end;

-- TRAVA: se sobrou alguém ativo sem perfil, aborta tudo. Sem isso, a
-- redefinição de is_admin() abaixo trancaria essa pessoa para fora.
do $$
declare
  v_orfaos int;
  v_admins int;
  v_gestores int;
begin
  -- Aviso: "Sem permissões" não tem can_manage. Quem for gestor hoje deixa de
  -- editar/arquivar conteúdo de qualquer projeto assim que esta migration
  -- passar, porque is_admin_or_gestor() para de considerar o enum.
  select count(*) into v_gestores
  from public.users where ativo = true and role = 'gestor';
  if v_gestores > 0 then
    raise notice
      'ATENÇÃO: % gestor(es) ativo(s) perderão o poder de editar/arquivar em todos os projetos até receberem um perfil com can_manage.', v_gestores;
  end if;

  select count(*) into v_orfaos
  from public.users
  where ativo = true and permission_profile_id is null;
  if v_orfaos > 0 then
    raise exception
      'Migration abortada: % usuário(s) ativo(s) ficaram sem perfil de permissão.', v_orfaos;
  end if;

  -- E precisa sobrar pelo menos um Super Admin ativo, ou ninguém administra.
  -- Numa instalação nova ainda não existe ninguém: aí não há o que travar
  -- (o primeiro administrador é promovido depois, pelo passo do INSTALACAO.md).
  select count(*) into v_admins
  from public.users u
  join public.permission_profiles p on p.id = u.permission_profile_id
  where u.ativo = true and p.full_access = true;
  if v_admins = 0 and exists (select 1 from public.users where ativo = true) then
    raise exception
      'Migration abortada: nenhum usuário ativo ficaria com acesso total.';
  end if;
end;
$$;

-- ---------------------------------------------------------------- funções

-- Consulta granular, usada pela aplicação (e disponível para policies futuras).
create or replace function public.has_permission(
  uid uuid,
  p_resource text,
  p_action text
) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    join public.permission_profiles p on p.id = u.permission_profile_id
    where u.id = uid
      and u.ativo = true
      and (
        p.full_access
        or exists (
          select 1 from public.permission_grants g
          where g.profile_id = p.id
            and g.resource = p_resource
            and g.action = p_action
        )
      )
  );
$$;

revoke all on function public.has_permission(uuid, text, text) from public, anon;
grant execute on function public.has_permission(uuid, text, text) to authenticated;

-- AQUI o perfil passa a mandar: as duas funções que sustentam a RLS deixam de
-- ler o enum. Nenhuma policy precisa mudar.
create or replace function public.is_admin(uid uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    join public.permission_profiles p on p.id = u.permission_profile_id
    where u.id = uid and u.ativo = true and p.full_access = true
  );
$$;

create or replace function public.is_admin_or_gestor(uid uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    join public.permission_profiles p on p.id = u.permission_profile_id
    where u.id = uid and u.ativo = true and (p.full_access or p.can_manage)
  );
$$;

-- ---------------------------------------------------------------- RLS

alter table public.permission_profiles enable row level security;
alter table public.permission_grants enable row level security;

-- Todo autenticado LÊ os perfis: a aplicação precisa saber o que pode exibir.
drop policy if exists "permission_profiles_read" on public.permission_profiles;
create policy "permission_profiles_read" on public.permission_profiles
  for select to authenticated using (true);

drop policy if exists "permission_profiles_write" on public.permission_profiles;
create policy "permission_profiles_write" on public.permission_profiles
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "permission_grants_read" on public.permission_grants;
create policy "permission_grants_read" on public.permission_grants
  for select to authenticated using (true);

drop policy if exists "permission_grants_write" on public.permission_grants;
create policy "permission_grants_write" on public.permission_grants
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- Guarda: perfil de sistema não pode ser excluído.
create or replace function public.prevent_system_profile_delete()
returns trigger language plpgsql as $$
begin
  if old.is_system then
    raise exception 'Perfis de sistema não podem ser excluídos.' using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_permission_profiles_no_system_delete on public.permission_profiles;
create trigger trg_permission_profiles_no_system_delete
  before delete on public.permission_profiles
  for each row execute function public.prevent_system_profile_delete();

drop trigger if exists trg_permission_profiles_updated on public.permission_profiles;
create trigger trg_permission_profiles_updated
  before update on public.permission_profiles
  for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';
commit;
