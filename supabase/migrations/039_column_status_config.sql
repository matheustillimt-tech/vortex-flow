-- ============================================================
-- Migration 039: status por coluna é CONFIGURÁVEL (fim da adivinhação)
-- ============================================================
-- Antes o status era deduzido do NOME e da COR da coluna. Isso quebrava
-- em casos legítimos: "Pronto p/ postar" casava com '%pronto%' e marcava
-- a tarefa como concluída, sendo que a conclusão só acontece lá em
-- "Postado".
--
-- Agora cada coluna diz explicitamente o que fazer:
--   status_ao_mover = NULL  -> não mexe no status (padrão seguro)
--   status_ao_mover = <task_status> -> aplica esse status ao soltar o card
--
-- O backfill abaixo preserva o comportamento atual das colunas onde a
-- intenção é inequívoca, e deixa NULL nas ambíguas.

alter table public.kanban_columns
  add column if not exists status_ao_mover task_status;

comment on column public.kanban_columns.status_ao_mover is
  'Status aplicado à tarefa ao mover o card para esta coluna. NULL = não altera o status.';

-- ------------------------------------------------------------
-- Backfill: converte a heurística antiga em configuração explícita
-- ------------------------------------------------------------
-- Regras inequívocas apenas. "pronto"/"feito" saem de cena porque são
-- ambíguos ("Pronto p/ postar", "Pronto para revisão").
update public.kanban_columns
set status_ao_mover = case
  when public.vf_is_green(cor)                     then 'concluido'::task_status
  when public.vf_norm(nome) like '%conclu%'        then 'concluido'::task_status
  when public.vf_norm(nome) like '%andamento%'
    or public.vf_norm(nome) like '%progresso%'
    or public.vf_norm(nome) like '%fazendo%'       then 'em_andamento'::task_status
  when public.vf_norm(nome) like '%revis%'
    or public.vf_norm(nome) like '%review%'
    or public.vf_norm(nome) like '%teste%'         then 'em_revisao'::task_status
  when public.vf_norm(nome) like '%travad%'
    or public.vf_norm(nome) like '%bloque%'
    or public.vf_norm(nome) like '%blocked%'       then 'travado'::task_status
  when public.vf_norm(nome) like '%demanda%'
    or public.vf_norm(nome) like '%pendente%'
    or public.vf_norm(nome) like '%a fazer%'
    or public.vf_norm(nome) like '%backlog%'       then 'pendente'::task_status
  else null
end
where status_ao_mover is null;

-- ------------------------------------------------------------
-- Coluna → status: usa SÓ a configuração explícita
-- ------------------------------------------------------------
create or replace function public.tg_sync_status_from_kanban_column()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status task_status;
begin
  if tg_op = 'UPDATE'
    and new.kanban_column_id is not distinct from old.kanban_column_id then
    return new;
  end if;
  if new.kanban_column_id is null then
    return new;
  end if;

  select status_ao_mover into v_status
    from public.kanban_columns
    where id = new.kanban_column_id;

  -- Coluna sem configuração: não mexe em nada.
  if v_status is null then
    return new;
  end if;

  if new.status is distinct from v_status then
    new.status := v_status;
    if v_status = 'concluido' then
      new.data_conclusao := coalesce(new.data_conclusao, now());
    else
      new.data_conclusao := null;
    end if;
  end if;

  return new;
end $$;

-- ------------------------------------------------------------
-- Status → coluna: acha a coluna configurada para aquele status
-- ------------------------------------------------------------
create or replace function public.tg_sync_column_from_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_col uuid;
  v_atual task_status;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  if tg_op = 'UPDATE'
    and new.kanban_column_id is distinct from old.kanban_column_id then
    return new;
  end if;
  if new.project_id is null then
    return new;
  end if;

  -- Se a coluna atual já produz o novo status, não move o card. Evita
  -- pular entre colunas que compartilham o mesmo status.
  if new.kanban_column_id is not null then
    select status_ao_mover into v_atual
      from public.kanban_columns
      where id = new.kanban_column_id;
    if v_atual is not distinct from new.status then
      return new;
    end if;
  end if;

  select id into v_col
    from public.kanban_columns
    where project_id = new.project_id
      and status_ao_mover = new.status
    order by ordem
    limit 1;

  if v_col is not null and new.kanban_column_id is distinct from v_col then
    new.kanban_column_id := v_col;
  end if;

  return new;
end $$;
