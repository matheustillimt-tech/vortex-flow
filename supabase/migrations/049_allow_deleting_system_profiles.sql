-- Qualquer perfil de permissão pode ser excluído, menos o de acesso total.
--
-- Até aqui, os perfis de sistema (Super Admin e "Sem permissões") eram
-- intocáveis. "Sem permissões" passa a poder ser excluído como qualquer perfil
-- criado na tela. Duas travas continuam:
--
--   - o perfil com acesso total não se exclui: sem ele, ninguém administra o
--     sistema — nem para desfazer o engano;
--   - perfil em uso não se exclui: a FK users.permission_profile_id é
--     ON DELETE RESTRICT, então as pessoas precisam ser movidas antes.
--
-- Sem "Sem permissões", quem entra no sistema fica sem perfil até alguém
-- atribuir um, e sem perfil não há acesso a nenhuma tela. A busca por nome da
-- 043 (users_privileges_guard) não encontra o perfil e grava nulo, sem erro.
--
-- A função mantém o nome prevent_system_profile_delete para não mexer no
-- gatilho que a usa; o que muda é a regra.

begin;

create or replace function public.prevent_system_profile_delete()
returns trigger language plpgsql as $$
begin
  if old.full_access then
    raise exception
      'O perfil de acesso total não pode ser excluído: sem ele, ninguém administra o sistema.'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

notify pgrst, 'reload schema';
commit;
