-- supabase/migrations/051_webhook_whatsapp.sql
-- ============================================================
-- Migration 051: aviso de WhatsApp quando alguém vira responsável
-- ============================================================
-- Fluxo: INSERT em task_assignees → webhook_entregas (pendente) →
-- pg_net chama /api/webhooks/despachar → a rota envia e grava o resultado.
-- O gatilho de registro não usa pg_net, para ser testável no PGlite.

-- ------------------------------------------------------------ telefone
alter table public.colaborador_dados add column if not exists whatsapp text;
alter table public.colaborador_dados drop constraint if exists colaborador_dados_whatsapp_formato;
alter table public.colaborador_dados add constraint colaborador_dados_whatsapp_formato
  check (whatsapp is null or whatsapp ~ '^55[0-9]{10,11}$');

-- ------------------------------------------------------------ configuração (linha única)
create table if not exists public.webhook_config (
  id boolean primary key default true check (id),
  url text,
  token text, -- criptografado pela aplicação (lib/crypto.ts)
  ativo boolean not null default false,
  atualizado_em timestamptz,
  atualizado_por uuid references public.users(id) on delete set null
);
-- RLS sem policies: só service role e funções security definer leem.
alter table public.webhook_config enable row level security;

-- ------------------------------------------------------------ fila / histórico
create table if not exists public.webhook_entregas (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  atribuido_por uuid references public.users(id) on delete set null,
  evento text not null default 'tarefa.atribuida',
  status text not null default 'pendente'
    check (status in ('pendente', 'processando', 'enviado', 'erro', 'sem_telefone')),
  tentativas int not null default 0,
  http_status int,
  erro text,
  criado_em timestamptz not null default now(),
  reservado_em timestamptz,
  enviado_em timestamptz
);
create index if not exists webhook_entregas_status_idx
  on public.webhook_entregas (status, criado_em);
create index if not exists webhook_entregas_criado_idx
  on public.webhook_entregas (criado_em desc);

alter table public.webhook_entregas enable row level security;
drop policy if exists "webhook_entregas_select_admin" on public.webhook_entregas;
create policy "webhook_entregas_select_admin" on public.webhook_entregas
  for select using (public.is_admin(auth.uid()));

-- ------------------------------------------------------------ remoções recentes (evita re-notificação fantasma)
-- Painel/quadro/MCP trocam a lista de responsáveis apagando todas as linhas de
-- task_assignees do card e reinserindo a lista inteira. Sem isso, todo mundo que
-- já era responsável recebia um novo aviso de WhatsApp a cada edição da lista.
-- Sem FK: a exclusão da tarefa já cascateia em task_assignees, e esta tabela é só
-- um debounce efêmero (limpo sozinho depois de 1h).
create table if not exists public.webhook_remocoes_recentes (
  task_id uuid not null,
  user_id uuid not null,
  removido_em timestamptz not null default now(),
  primary key (task_id, user_id)
);
alter table public.webhook_remocoes_recentes enable row level security;

create or replace function public.webhook_registrar_remocao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.webhook_remocoes_recentes (task_id, user_id, removido_em)
  values (old.task_id, old.user_id, now())
  on conflict (task_id, user_id) do update set removido_em = now();

  delete from public.webhook_remocoes_recentes where removido_em < now() - interval '1 hour';

  return old;
exception when others then
  raise warning 'webhook_registrar_remocao: %', sqlerrm;
  return old;
end $$;

drop trigger if exists trg_webhook_task_assignee_removed on public.task_assignees;
create trigger trg_webhook_task_assignee_removed
  after delete on public.task_assignees
  for each row execute function public.webhook_registrar_remocao();

-- ------------------------------------------------------------ registro na atribuição
create or replace function public.webhook_registrar_atribuicao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg_ativo boolean;
  cfg_url text;
  criador uuid;
  numero text;
begin
  select ativo, url into cfg_ativo, cfg_url from public.webhook_config where id;
  if cfg_ativo is not true or coalesce(btrim(cfg_url), '') = '' then
    return new;
  end if;

  -- Mesma regra da notificação no app (migration 011).
  if new.assigned_by is not null and new.assigned_by = new.user_id then
    return new;
  end if;
  select created_by into criador from public.tasks where id = new.task_id;
  if criador is not null and criador = new.user_id then
    return new;
  end if;

  -- Delete+reinsert (troca de lista de responsáveis) não é uma atribuição nova.
  if exists (
    select 1 from public.webhook_remocoes_recentes
     where task_id = new.task_id and user_id = new.user_id
       and removido_em > now() - interval '2 minutes'
  ) then
    return new;
  end if;

  select whatsapp into numero from public.colaborador_dados where user_id = new.user_id;

  insert into public.webhook_entregas (task_id, user_id, atribuido_por, status)
  values (
    new.task_id,
    new.user_id,
    coalesce(new.assigned_by, criador),
    case when numero is null then 'sem_telefone' else 'pendente' end
  );
  return new;
exception when others then
  -- O webhook nunca pode impedir uma atribuição.
  raise warning 'webhook_registrar_atribuicao: %', sqlerrm;
  return new;
end $$;

drop trigger if exists trg_webhook_task_assignee_added on public.task_assignees;
create trigger trg_webhook_task_assignee_added
  after insert on public.task_assignees
  for each row execute function public.webhook_registrar_atribuicao();

-- ------------------------------------------------------------ reserva atômica do lote
create or replace function public.webhook_reservar_pendentes(limite int default 5)
returns setof public.webhook_entregas
language sql
security definer
set search_path = public
as $$
  update public.webhook_entregas e
     set status = 'processando',
         reservado_em = now(),
         tentativas = e.tentativas + 1
   where e.id in (
     select id from public.webhook_entregas
      where status = 'pendente'
         or (status = 'processando' and reservado_em < now() - interval '5 minutes')
      order by criado_em
      limit limite
      for update skip locked
   )
  returning e.*;
$$;

revoke all on function public.webhook_reservar_pendentes(int) from public, anon, authenticated;
grant execute on function public.webhook_reservar_pendentes(int) to service_role;

-- ------------------------------------------------------------ acionamento
-- O gatilho é sempre criado (ordem de setup não importa mais); a função sai
-- cedo, sem tocar em net/vault, quando essas extensões ainda não existem —
-- é o caso do PGlite nos testes, e de uma instalação antes do passo 1 do
-- setup em produção.
create or replace function public.webhook_acionar_despacho()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base text;
  segredo text;
begin
  if to_regnamespace('net') is null or to_regnamespace('vault') is null then
    return null;
  end if;

  select decrypted_secret into base from vault.decrypted_secrets where name = 'webhook_app_url';
  select decrypted_secret into segredo from vault.decrypted_secrets where name = 'webhook_dispatch_secret';
  if base is null or segredo is null then
    return null;
  end if;
  perform net.http_post(
    url := rtrim(base, '/') || '/api/webhooks/despachar',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret', segredo
    ),
    timeout_milliseconds := 55000
  );
  return null;
exception when others then
  raise warning 'webhook_acionar_despacho: %', sqlerrm;
  return null;
end $$;

drop trigger if exists trg_webhook_entrega_despachar on public.webhook_entregas;
create trigger trg_webhook_entrega_despachar
  after insert on public.webhook_entregas
  for each row when (new.status = 'pendente')
  execute function public.webhook_acionar_despacho();
