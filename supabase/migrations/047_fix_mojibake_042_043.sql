-- Corrige acentos gravados errados na aplicação das migrations 042 e 043.
--
-- As duas foram coladas no SQL Editor a partir de uma área de transferência que
-- converteu os acentos como MacRoman: "ã" virou "√£", "õ" virou "√µ", "ç" virou
-- "√ß". A lógica das permissões não usa acento, então as travas funcionaram; o
-- que ficou errado foram textos — o nome do perfil "Sem permissões", as
-- descrições dos perfis de sistema e as mensagens de erro das funções.
--
-- Esta migration corrige os dados e recria a função da 042 que tem mensagem.
-- As funções da 043 são corrigidas REAPLICANDO A PRÓPRIA 043 logo em seguida
-- (ela é idempotente).
--
-- Prevenção: copiar SQL com `LANG=en_US.UTF-8 pbcopy` e conferir o round-trip.

begin;

-- ---------------------------------------------------------------- dados

update public.permission_profiles
set nome = 'Sem permissões',
    descricao = 'Ponto de partida, sem nenhum acesso. Atribua um perfil configurado no lugar deste.'
where is_system and not full_access and nome like 'Sem permiss%';

update public.permission_profiles
set descricao = 'Acesso irrestrito a todos os menus, abas e ações.'
where is_system and full_access and nome = 'Super Admin';

-- ---------------------------------------------------------------- função da 042

create or replace function public.prevent_system_profile_delete()
returns trigger language plpgsql as $$
begin
  if old.is_system then
    raise exception 'Perfis de sistema não podem ser excluídos.' using errcode = '42501';
  end if;
  return old;
end;
$$;

-- ---------------------------------------------------------------- trava

-- Se sobrou a marca da corrupção (U+221A) em algum perfil, aborta: melhor parar
-- do que declarar corrigido o que não foi.
do $$
begin
  if exists (
    select 1 from public.permission_profiles
    where position(chr(8730) in nome) > 0
       or position(chr(8730) in coalesce(descricao, '')) > 0
  ) then
    raise exception 'Ainda há perfil com acento corrompido. Revise antes de seguir.';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
