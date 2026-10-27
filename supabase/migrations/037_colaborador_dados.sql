-- ============================================================
-- Migration 037: cadastro completo de colaboradores
-- ============================================================
-- Dados sensíveis (CPF, PIX, endereço, data de nascimento) ficam numa
-- tabela SEPARADA de `users`, porque o app faz `select("*")` em users em
-- vários lugares (listas de responsáveis) — se estivessem lá, qualquer
-- colaborador leria o CPF/PIX de todo mundo.
--
-- RLS aqui: SELECT/INSERT/UPDATE só do PRÓPRIO usuário ou de admin.
-- Nome, foto, função (cargo) e setor seguem em `users` (já são públicos
-- no app — aparecem em avatares e cards).

-- ------------------------------------------------------------
-- Flag de completude (fica em users pra o gate ser barato de checar)
-- ------------------------------------------------------------
alter table public.users
  add column if not exists cadastro_completo boolean not null default false;

-- ------------------------------------------------------------
-- Tabela de dados sensíveis (1-1 com users)
-- ------------------------------------------------------------
create table if not exists public.colaborador_dados (
  user_id uuid primary key references public.users(id) on delete cascade,

  cpf text,
  data_nascimento date,

  -- Endereço
  cep text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  estado text,

  -- Pagamento
  chave_pix text,
  tipo_chave_pix text check (
    tipo_chave_pix is null
    or tipo_chave_pix in ('cpf', 'email', 'telefone', 'aleatoria')
  ),

  preenchido_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- CPF único quando informado (evita duplicidade no financeiro)
create unique index if not exists colaborador_dados_cpf_uniq
  on public.colaborador_dados (cpf)
  where cpf is not null;

-- ------------------------------------------------------------
-- RLS: só o próprio dono ou admin
-- ------------------------------------------------------------
alter table public.colaborador_dados enable row level security;

drop policy if exists "colaborador_dados_select_own_or_admin" on public.colaborador_dados;
create policy "colaborador_dados_select_own_or_admin" on public.colaborador_dados
  for select using (
    user_id = auth.uid() or public.is_admin(auth.uid())
  );

drop policy if exists "colaborador_dados_insert_own_or_admin" on public.colaborador_dados;
create policy "colaborador_dados_insert_own_or_admin" on public.colaborador_dados
  for insert with check (
    user_id = auth.uid() or public.is_admin(auth.uid())
  );

drop policy if exists "colaborador_dados_update_own_or_admin" on public.colaborador_dados;
create policy "colaborador_dados_update_own_or_admin" on public.colaborador_dados
  for update using (
    user_id = auth.uid() or public.is_admin(auth.uid())
  ) with check (
    user_id = auth.uid() or public.is_admin(auth.uid())
  );

-- Exclusão só admin (histórico do financeiro não deve sumir por engano)
drop policy if exists "colaborador_dados_delete_admin" on public.colaborador_dados;
create policy "colaborador_dados_delete_admin" on public.colaborador_dados
  for delete using (public.is_admin(auth.uid()));

-- ------------------------------------------------------------
-- updated_at automático
-- ------------------------------------------------------------
create or replace function public.tg_colaborador_dados_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_colaborador_dados_touch on public.colaborador_dados;
create trigger trg_colaborador_dados_touch
  before update on public.colaborador_dados
  for each row execute function public.tg_colaborador_dados_touch();

-- ------------------------------------------------------------
-- Bucket de fotos de perfil
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

-- Leitura pública (a foto aparece em avatares pelo app inteiro)
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

-- Upload/atualização/remoção: qualquer autenticado no bucket avatars
-- (o caminho do arquivo é prefixado com o id do usuário pela aplicação).
drop policy if exists "avatars_auth_insert" on storage.objects;
create policy "avatars_auth_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars');

drop policy if exists "avatars_auth_update" on storage.objects;
create policy "avatars_auth_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars');

drop policy if exists "avatars_auth_delete" on storage.objects;
create policy "avatars_auth_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars');
