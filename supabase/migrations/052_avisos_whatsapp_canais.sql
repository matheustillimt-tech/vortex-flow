-- supabase/migrations/052_avisos_whatsapp_canais.sql
-- ============================================================
-- Migration 052: avisos no WhatsApp com canal próprio e novos eventos
-- ============================================================
--
-- * webhook_config ganha o canal (crm | zapi | webhook), as credenciais de cada
--   um (criptografadas pela aplicação, lib/crypto.ts), os textos por evento e
--   quais eventos estão ligados.
-- * webhook_entregas vira a fila de todos os avisos: tarefa.atribuida,
--   tarefa.prazo, tarefa.atrasada e tarefa.comentario, com chave de
--   deduplicação.
-- * task_lembretes guarda horários extras de lembrete; o das 08:00 do dia do
--   prazo é implícito (tasks.lembrete_padrao).
-- * avisos_cron() roda a cada 5 minutos (pg_cron) e enfileira prazo e atraso.
--
-- Instalações existentes continuam no canal webhook e só com o aviso de nova
-- tarefa ligado: a ferramenta de disparo de hoje monta o texto de "nova
-- tarefa" sem olhar o evento, e ligar os outros mandaria mensagem errada.
-- Pode rodar mais de uma vez.

-- ------------------------------------------------------------ configuração
alter table public.webhook_config add column if not exists canal text not null default 'webhook';
alter table public.webhook_config drop constraint if exists webhook_config_canal_valido;
alter table public.webhook_config add constraint webhook_config_canal_valido
  check (canal in ('webhook', 'crm', 'zapi'));

alter table public.webhook_config add column if not exists crm_url text;
alter table public.webhook_config add column if not exists crm_chave text;          -- criptografada
alter table public.webhook_config add column if not exists zapi_instancia text;
alter table public.webhook_config add column if not exists zapi_token text;         -- criptografado
alter table public.webhook_config add column if not exists zapi_client_token text;  -- criptografado
alter table public.webhook_config add column if not exists zapi_base_url text;
alter table public.webhook_config add column if not exists templates jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'webhook_config' and column_name = 'eventos_ativos'
  ) then
    alter table public.webhook_config add column eventos_ativos jsonb not null default
      '{"tarefa.atribuida": true, "tarefa.prazo": true, "tarefa.atrasada": true, "tarefa.comentario": true}'::jsonb;
    -- Só as linhas que já existiam: mantêm o comportamento de antes.
    update public.webhook_config set eventos_ativos =
      '{"tarefa.atribuida": true, "tarefa.prazo": false, "tarefa.atrasada": false, "tarefa.comentario": false}'::jsonb;
  end if;
end $$;

create or replace function public.avisos_canal_pronto()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select ativo and case canal
      when 'crm' then coalesce(btrim(crm_url), '') <> '' and coalesce(btrim(crm_chave), '') <> ''
      when 'zapi' then coalesce(btrim(zapi_instancia), '') <> '' and coalesce(btrim(zapi_token), '') <> ''
      else coalesce(btrim(url), '') <> ''
    end
    from public.webhook_config where id
  ), false);
$$;

create or replace function public.avisos_evento_ativo(ev text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case when jsonb_typeof(eventos_ativos -> ev) = 'boolean'
                then (eventos_ativos ->> ev)::boolean else false end
      from public.webhook_config where id
  ), false);
$$;

-- ------------------------------------------------------------ fila
alter table public.webhook_entregas add column if not exists dedup_key text;
alter table public.webhook_entregas add column if not exists payload_extra jsonb;
alter table public.webhook_entregas add column if not exists agendado_para timestamptz;
create unique index if not exists webhook_entregas_dedup_idx on public.webhook_entregas (dedup_key);

-- "cancelado": prazo/atraso de tarefa que foi concluída antes do envio.
alter table public.webhook_entregas drop constraint if exists webhook_entregas_status_check;
alter table public.webhook_entregas add constraint webhook_entregas_status_check
  check (status in ('pendente', 'processando', 'enviado', 'erro', 'sem_telefone', 'cancelado'));

alter table public.webhook_entregas drop constraint if exists webhook_entregas_evento_valido;
alter table public.webhook_entregas add constraint webhook_entregas_evento_valido
  check (evento in ('tarefa.atribuida', 'tarefa.prazo', 'tarefa.atrasada', 'tarefa.comentario'));

-- ------------------------------------------------------------ lembretes
alter table public.tasks add column if not exists lembrete_padrao boolean not null default true;

create table if not exists public.task_lembretes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  horario timestamptz not null,
  criado_por uuid references public.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  unique (task_id, horario)
);
create index if not exists task_lembretes_horario_idx on public.task_lembretes (horario);

alter table public.task_lembretes enable row level security;
grant select, insert, delete on public.task_lembretes to authenticated;

drop policy if exists "task_lembretes_select" on public.task_lembretes;
create policy "task_lembretes_select" on public.task_lembretes
  for select to authenticated
  using (exists (
    select 1 from public.tasks t
     where t.id = task_id and public.user_can_see_project(auth.uid(), t.project_id)
  ));

-- Quem criou a tarefa, ou quem pode editar tarefas.
drop policy if exists "task_lembretes_insert" on public.task_lembretes;
create policy "task_lembretes_insert" on public.task_lembretes
  for insert to authenticated
  with check (
    criado_por = auth.uid()
    and exists (
      select 1 from public.tasks t
       where t.id = task_id
         and public.user_can_see_project(auth.uid(), t.project_id)
         and (t.created_by = auth.uid() or public.has_permission(auth.uid(), 'tarefas', 'edit'))
    )
  );

drop policy if exists "task_lembretes_delete" on public.task_lembretes;
create policy "task_lembretes_delete" on public.task_lembretes
  for delete to authenticated
  using (exists (
    select 1 from public.tasks t
     where t.id = task_id
       and public.user_can_see_project(auth.uid(), t.project_id)
       and (t.created_by = auth.uid() or public.has_permission(auth.uid(), 'tarefas', 'edit'))
  ));

-- ------------------------------------------------------------ nova tarefa (051, agora por canal e evento)
create or replace function public.webhook_registrar_atribuicao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  criador uuid;
  numero text;
begin
  if not public.avisos_canal_pronto() or not public.avisos_evento_ativo('tarefa.atribuida') then
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

  insert into public.webhook_entregas (task_id, user_id, atribuido_por, evento, status)
  values (
    new.task_id,
    new.user_id,
    coalesce(new.assigned_by, criador),
    'tarefa.atribuida',
    case when numero is null then 'sem_telefone' else 'pendente' end
  );
  return new;
exception when others then
  -- O aviso nunca pode impedir uma atribuição.
  raise warning 'webhook_registrar_atribuicao: %', sqlerrm;
  return new;
end $$;

-- ------------------------------------------------------------ comentário
-- Não há menção estruturada: procura "@Nome completo" e "@PrimeiroNome" quando
-- o primeiro nome é único entre os ativos. Só recebe quem enxerga o projeto.
create or replace function public.avisos_regex_literal(s text)
returns text
language sql
immutable
set search_path = public
as $$
  -- Toda letra/dígito/espaço fica como está; o resto ganha "\" (literal em ARE).
  select regexp_replace(s, '([^[:alnum:][:space:]_])', '\\\1', 'g');
$$;

create or replace function public.avisos_registrar_comentario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  projeto uuid;
  texto text := lower(coalesce(new.conteudo, ''));
begin
  if not public.avisos_canal_pronto() or not public.avisos_evento_ativo('tarefa.comentario') then
    return new;
  end if;
  select project_id into projeto from public.tasks where id = new.task_id;

  insert into public.webhook_entregas
    (task_id, user_id, atribuido_por, evento, status, dedup_key, payload_extra)
  select new.task_id, d.user_id, new.user_id, 'tarefa.comentario',
         case when cd.whatsapp is null then 'sem_telefone' else 'pendente' end,
         'tarefa.comentario:' || new.id || ':' || d.user_id,
         jsonb_build_object('comentario_id', new.id, 'comentario', left(new.conteudo, 500))
    from (
      select a.user_id from public.task_assignees a where a.task_id = new.task_id
      union
      select u.id
        from public.users u
       where u.ativo is not false
         and position('@' in texto) > 0
         and public.user_can_see_project(u.id, projeto)
         and (
           texto ~ ('@' || public.avisos_regex_literal(lower(btrim(u.nome))) || '($|[^[:alnum:]_])')
           or (
             position(' ' in btrim(u.nome)) > 0
             and texto ~ ('@' || public.avisos_regex_literal(lower(split_part(btrim(u.nome), ' ', 1))) || '($|[^[:alnum:]_])')
             and (select count(*) from public.users u2
                   where u2.ativo is not false
                     and lower(split_part(btrim(u2.nome), ' ', 1)) = lower(split_part(btrim(u.nome), ' ', 1))) = 1
           )
         )
    ) d
    join public.users dest on dest.id = d.user_id and dest.ativo is not false
    left join public.colaborador_dados cd on cd.user_id = d.user_id
   where d.user_id is distinct from new.user_id
  on conflict (dedup_key) do nothing;
  return new;
exception when others then
  raise warning 'avisos_registrar_comentario: %', sqlerrm;
  return new;
end $$;

drop trigger if exists trg_avisos_comentario on public.task_comments;
create trigger trg_avisos_comentario
  after insert on public.task_comments
  for each row execute function public.avisos_registrar_comentario();

-- ------------------------------------------------------------ acionamento
-- Separado do gatilho para o agendador poder chamar uma vez por lote.
create or replace function public.webhook_chamar_despacho()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  base text;
  segredo text;
begin
  if to_regnamespace('net') is null or to_regnamespace('vault') is null then
    return;
  end if;
  select decrypted_secret into base from vault.decrypted_secrets where name = 'webhook_app_url';
  select decrypted_secret into segredo from vault.decrypted_secrets where name = 'webhook_dispatch_secret';
  if base is null or segredo is null then
    return;
  end if;
  perform net.http_post(
    url := rtrim(base, '/') || '/api/webhooks/despachar',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', segredo),
    timeout_milliseconds := 55000
  );
exception when others then
  raise warning 'webhook_chamar_despacho: %', sqlerrm;
end $$;

create or replace function public.webhook_acionar_despacho()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- O agendador enfileira em lote e aciona o despacho ele mesmo.
  if coalesce(current_setting('avisos.em_lote', true), '') = '1' then
    return null;
  end if;
  perform public.webhook_chamar_despacho();
  return null;
exception when others then
  raise warning 'webhook_acionar_despacho: %', sqlerrm;
  return null;
end $$;

-- ------------------------------------------------------------ reserva
-- Envio parado em "processando" há mais de 5 minutos: a rota caiu no meio e
-- não dá para saber se a mensagem saiu. No canal webhook a ferramenta
-- deduplica por entrega_id, então volta para a fila enquanto houver tentativa.
-- No CRM e na Z-API não há deduplicação do outro lado: vira erro (com
-- "Reenviar" na tela) para não mandar WhatsApp repetido. Com 3 tentativas
-- gastas, vira erro em qualquer canal.
create or replace function public.webhook_reservar_pendentes(limite int default 5)
returns setof public.webhook_entregas
language plpgsql
security definer
set search_path = public
as $$
declare
  canal_atual text;
begin
  select canal into canal_atual from public.webhook_config where id;

  update public.webhook_entregas
     set status = 'erro',
         erro = 'O envio foi interrompido e não deu para confirmar se a mensagem saiu. Use Reenviar se precisar.'
   where status = 'processando'
     and reservado_em < now() - interval '5 minutes'
     and (tentativas >= 3 or coalesce(canal_atual, 'webhook') <> 'webhook');

  return query
  update public.webhook_entregas e
     set status = 'processando',
         reservado_em = now(),
         tentativas = e.tentativas + 1
   where e.id in (
     select id from public.webhook_entregas
      where (status = 'pendente' and (agendado_para is null or agendado_para <= now()))
         or (status = 'processando' and reservado_em < now() - interval '5 minutes' and tentativas < 3)
      order by criado_em
      limit limite
      for update skip locked
   )
  returning e.*;
end $$;

revoke all on function public.webhook_reservar_pendentes(int) from public, anon, authenticated;
grant execute on function public.webhook_reservar_pendentes(int) to service_role;

-- ------------------------------------------------------------ agendador (prazo e atraso)
-- Horário de Brasília. Recupera no mesmo dia se o cron ficou parado.
create or replace function public.avisos_enfileirar_agendados(agora timestamptz default now())
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  hoje date := (agora at time zone 'America/Sao_Paulo')::date;
  oito timestamptz := (hoje + time '08:00') at time zone 'America/Sao_Paulo';
  total int := 0;
  n int;
begin
  if not public.avisos_canal_pronto() then
    return 0;
  end if;
  perform set_config('avisos.em_lote', '1', true);

  if public.avisos_evento_ativo('tarefa.prazo') then
    -- 08:00 do dia do prazo (tarefa criada antes desse horário).
    if agora >= oito then
      insert into public.webhook_entregas
        (task_id, user_id, atribuido_por, evento, status, dedup_key, agendado_para, payload_extra)
      select t.id, a.user_id, t.created_by, 'tarefa.prazo',
             case when cd.whatsapp is null then 'sem_telefone' else 'pendente' end,
             -- Mesmo formato do lembrete extra: um extra às 08:00 não duplica.
             'tarefa.prazo:' || t.id || ':' || a.user_id || ':'
               || to_char(oito at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'),
             oito,
             jsonb_build_object('horario', oito)
        from public.tasks t
        join public.task_assignees a on a.task_id = t.id
        join public.users u on u.id = a.user_id and u.ativo is not false
        left join public.colaborador_dados cd on cd.user_id = a.user_id
       where t.status::text <> 'concluido'
         and t.lembrete_padrao
         and t.prazo is not null
         and (t.prazo at time zone 'America/Sao_Paulo')::date = hoje
         and t.created_at < oito
      on conflict (dedup_key) do nothing;
      get diagnostics n = row_count;
      total := total + n;
    end if;

    -- Horários extras que venceram nas últimas 12 horas.
    insert into public.webhook_entregas
      (task_id, user_id, atribuido_por, evento, status, dedup_key, agendado_para, payload_extra)
    select t.id, a.user_id, coalesce(l.criado_por, t.created_by), 'tarefa.prazo',
           case when cd.whatsapp is null then 'sem_telefone' else 'pendente' end,
           'tarefa.prazo:' || t.id || ':' || a.user_id || ':'
             || to_char(l.horario at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'),
           l.horario,
           jsonb_build_object('horario', l.horario, 'lembrete_id', l.id)
      from public.task_lembretes l
      join public.tasks t on t.id = l.task_id
      join public.task_assignees a on a.task_id = t.id
      join public.users u on u.id = a.user_id and u.ativo is not false
      left join public.colaborador_dados cd on cd.user_id = a.user_id
     where t.status::text <> 'concluido'
       and l.horario <= agora
       and l.horario > agora - interval '12 hours'
    on conflict (dedup_key) do nothing;
    get diagnostics n = row_count;
    total := total + n;
  end if;

  -- Atrasada: a partir do dia seguinte ao do prazo, todo dia às 08:00.
  if public.avisos_evento_ativo('tarefa.atrasada') and agora >= oito then
    insert into public.webhook_entregas
      (task_id, user_id, atribuido_por, evento, status, dedup_key, agendado_para, payload_extra)
    select d.task_id, d.user_id, d.created_by, 'tarefa.atrasada',
           case when cd.whatsapp is null then 'sem_telefone' else 'pendente' end,
           'tarefa.atrasada:' || d.task_id || ':' || d.user_id || ':' || to_char(hoje, 'YYYY-MM-DD'),
           oito,
           jsonb_build_object('dias_atraso', d.dias)
      from (
        select x.task_id, a.user_id, x.created_by, x.dias
          from (
            select t.id as task_id, t.created_by,
                   (hoje - (t.prazo at time zone 'America/Sao_Paulo')::date) as dias
              from public.tasks t
             where t.status::text <> 'concluido'
               and t.prazo is not null
               and (t.prazo at time zone 'America/Sao_Paulo')::date < hoje
          ) x
          join public.task_assignees a on a.task_id = x.task_id
        union
        select t.id, t.created_by, t.created_by, 1
          from public.tasks t
         where t.status::text <> 'concluido'
           and t.prazo is not null
           and t.created_by is not null
           and (t.prazo at time zone 'America/Sao_Paulo')::date = hoje - 1
      ) d
      join public.users u on u.id = d.user_id and u.ativo is not false
      left join public.colaborador_dados cd on cd.user_id = d.user_id
    on conflict (dedup_key) do nothing;
    get diagnostics n = row_count;
    total := total + n;
  end if;

  perform set_config('avisos.em_lote', '', true);
  return total;
end $$;

-- Chamado pelo pg_cron: enfileira e aciona o despacho uma vez por lote de 5
-- pendentes (no máximo 10), o que também cobre novas tentativas.
create or replace function public.avisos_cron()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pendentes int;
begin
  perform public.avisos_enfileirar_agendados(now());
  select count(*) into pendentes
    from public.webhook_entregas
   where status = 'pendente' and (agendado_para is null or agendado_para <= now());
  for i in 1 .. least(10, ceil(pendentes / 5.0)::int) loop
    perform public.webhook_chamar_despacho();
  end loop;
exception when others then
  raise warning 'avisos_cron: %', sqlerrm;
end $$;

revoke all on function public.avisos_canal_pronto() from public, anon, authenticated;
revoke all on function public.avisos_evento_ativo(text) from public, anon, authenticated;
revoke all on function public.webhook_chamar_despacho() from public, anon, authenticated;
revoke all on function public.avisos_enfileirar_agendados(timestamptz) from public, anon, authenticated;
revoke all on function public.avisos_cron() from public, anon, authenticated;

-- ------------------------------------------------------------ pg_cron
-- Só agenda se a extensão já estiver ligada. Senão, ver README (Avisos no WhatsApp).
do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('avisos-whatsapp', '*/5 * * * *', 'select public.avisos_cron()');
  else
    raise notice 'pg_cron não está ligado: os avisos de prazo e atraso ficam parados até agendar avisos_cron().';
  end if;
exception when others then
  raise notice 'Não foi possível agendar avisos_cron(): %', sqlerrm;
end $$;
