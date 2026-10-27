-- Colaboradores e Chat seguem o perfil de permissão; can_manage deixa de valer.
--
-- Colaboradores: os dados sensíveis (CPF, PIX, endereço) só eram visíveis ao
-- próprio dono ou a quem tinha acesso total. A tela já obedece ao perfil (3a),
-- mas o banco ainda exigia acesso total, então liberar a tela a um perfil comum
-- mostrava a lista vazia. As ações do perfil passam a decidir, e o dono continua
-- sempre lendo e gravando o próprio cadastro (o formulário obrigatório depende
-- disso).
--
-- O mesmo formulário edita o cadastro de outra pessoa pela tela de Colaboradores,
-- gravando em users e em colaborador_dados. Por isso users também ganha uma
-- política de edição para quem tem "Editar colaboradores". Role, perfil e status
-- continuam travados pelo gatilho da 043.
--
-- Regra anti-escalada: quem não tem acesso total não grava no cadastro (nem no
-- perfil público) de quem tem. Ler segue liberado a "Ver" — o financeiro precisa
-- dos dados de todos para pagar.
--
-- ATENÇÃO de produto: "Editar colaboradores" permite alterar a chave PIX de
-- qualquer colega sem acesso total. Conceder só a quem cuida do financeiro.
--
-- Chat: as tabelas estavam abertas a qualquer pessoa logada. Ler e escrever
-- canais, membros e mensagens passa a exigir chat:view. A função de canal direto
-- e o gatilho de canal por setor são security definer e seguem funcionando.

begin;

-- ---------------------------------------------------------------- can_manage

-- A caixa saiu do editor de perfis. Zera o valor nos perfis sem acesso total
-- para não sobrar efeito residual (is_admin_or_gestor ainda o consulta). O
-- gatilho da 043 recalcula o role de quem usa esses perfis.
update public.permission_profiles
set can_manage = false
where can_manage and not full_access;

-- ---------------------------------------------------------------- colaborador_dados

drop policy if exists "colaborador_dados_select_own_or_admin" on public.colaborador_dados;
drop policy if exists "colaborador_dados_insert_own_or_admin" on public.colaborador_dados;
drop policy if exists "colaborador_dados_update_own_or_admin" on public.colaborador_dados;
drop policy if exists "colaborador_dados_delete_admin" on public.colaborador_dados;

drop policy if exists "colaborador_dados_select_perm" on public.colaborador_dados;
create policy "colaborador_dados_select_perm" on public.colaborador_dados
  for select to authenticated
  using (
    user_id = auth.uid()
    or (select public.has_permission(auth.uid(), 'colaboradores', 'view'))
  );

-- Inserir para outra pessoa acontece ao "editar" quem ainda não preencheu.
drop policy if exists "colaborador_dados_insert_perm" on public.colaborador_dados;
create policy "colaborador_dados_insert_perm" on public.colaborador_dados
  for insert to authenticated
  with check (
    user_id = auth.uid()
    or (
      (
        (select public.has_permission(auth.uid(), 'colaboradores', 'create'))
        or (select public.has_permission(auth.uid(), 'colaboradores', 'edit'))
      )
      and (not public.is_admin(user_id) or public.is_admin(auth.uid()))
    )
  );

drop policy if exists "colaborador_dados_update_perm" on public.colaborador_dados;
create policy "colaborador_dados_update_perm" on public.colaborador_dados
  for update to authenticated
  using (
    user_id = auth.uid()
    or (
      (select public.has_permission(auth.uid(), 'colaboradores', 'edit'))
      and (not public.is_admin(user_id) or public.is_admin(auth.uid()))
    )
  )
  with check (
    user_id = auth.uid()
    or (
      (select public.has_permission(auth.uid(), 'colaboradores', 'edit'))
      and (not public.is_admin(user_id) or public.is_admin(auth.uid()))
    )
  );

-- Excluir segue fora do alcance do próprio dono: o histórico do financeiro não
-- deve sumir por engano.
drop policy if exists "colaborador_dados_delete_perm" on public.colaborador_dados;
create policy "colaborador_dados_delete_perm" on public.colaborador_dados
  for delete to authenticated
  using (
    (select public.has_permission(auth.uid(), 'colaboradores', 'delete'))
    and (not public.is_admin(user_id) or public.is_admin(auth.uid()))
  );

-- ---------------------------------------------------------------- users

-- Nome, cargo, setor e foto de outra pessoa, gravados pelo formulário de cadastro
-- aberto na tela de Colaboradores. Colunas de privilégio seguem barradas pela 043.
drop policy if exists "users_update_colaboradores_perm" on public.users;
create policy "users_update_colaboradores_perm" on public.users
  for update to authenticated
  using (
    (select public.has_permission(auth.uid(), 'colaboradores', 'edit'))
    and (not public.is_admin(id) or public.is_admin(auth.uid()))
  )
  with check (
    (select public.has_permission(auth.uid(), 'colaboradores', 'edit'))
    and (not public.is_admin(id) or public.is_admin(auth.uid()))
  );

-- ---------------------------------------------------------------- chat

do $$
declare
  t text;
begin
  foreach t in array array['chat_channels', 'chat_channel_members', 'chat_messages']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_perm', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
       using ((select public.has_permission(auth.uid(), ''chat'', ''view'')))
       with check ((select public.has_permission(auth.uid(), ''chat'', ''view'')))',
      t || '_perm', t);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
