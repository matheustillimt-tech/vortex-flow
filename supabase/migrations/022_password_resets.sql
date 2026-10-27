-- ============================================================
-- Migration 022: códigos de redefinição de senha (OTP por email)
-- ============================================================
-- Fluxo:
--  1) Usuário pede "esqueci minha senha" → API gera código 6 dígitos,
--     persiste aqui e envia por email.
--  2) Usuário entra na página de reset, digita email + código + nova
--     senha → API valida o código e atualiza a senha via admin.
--  3) Código fica válido por 60 min e só pode ser usado UMA vez.

create table if not exists public.password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  email text not null,
  code text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists password_resets_email_idx
  on public.password_resets(email);
create index if not exists password_resets_user_idx
  on public.password_resets(user_id);

-- RLS: ninguém acessa direto. Tudo passa pelo service_role nas rotas /api.
alter table public.password_resets enable row level security;
-- (sem policies — bloqueia leitura/escrita de qualquer client autenticado)
