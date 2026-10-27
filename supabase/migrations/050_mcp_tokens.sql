-- ============================================================
-- Migration 040: tokens pessoais para o conector MCP
-- ============================================================
-- Cada colaborador gera um token e cola a URL do conector no Claude.
-- O MCP identifica a pessoa pelo token e aplica as MESMAS permissões
-- que ela tem no app (projetos que enxerga, etc).
--
-- Guardamos apenas o HASH (sha256) do token — o valor em claro é
-- mostrado uma única vez, no momento da criação.

create table if not exists public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  -- sha256 do token, em hex
  token_hash text not null unique,
  -- primeiros caracteres, só para o usuário reconhecer na lista
  prefixo text not null,
  nome text not null default 'Claude',
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists mcp_tokens_user_idx on public.mcp_tokens(user_id);
create index if not exists mcp_tokens_hash_idx on public.mcp_tokens(token_hash)
  where revoked_at is null;

alter table public.mcp_tokens enable row level security;

-- Cada um enxerga e gerencia só os próprios tokens; admin enxerga todos
-- (para conseguir revogar o acesso de alguém que saiu da empresa).
drop policy if exists "mcp_tokens_select_own_or_admin" on public.mcp_tokens;
create policy "mcp_tokens_select_own_or_admin" on public.mcp_tokens
  for select using (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "mcp_tokens_insert_own" on public.mcp_tokens;
create policy "mcp_tokens_insert_own" on public.mcp_tokens
  for insert with check (user_id = auth.uid());

drop policy if exists "mcp_tokens_update_own_or_admin" on public.mcp_tokens;
create policy "mcp_tokens_update_own_or_admin" on public.mcp_tokens
  for update using (user_id = auth.uid() or public.is_admin(auth.uid()))
  with check (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "mcp_tokens_delete_own_or_admin" on public.mcp_tokens;
create policy "mcp_tokens_delete_own_or_admin" on public.mcp_tokens
  for delete using (user_id = auth.uid() or public.is_admin(auth.uid()));
