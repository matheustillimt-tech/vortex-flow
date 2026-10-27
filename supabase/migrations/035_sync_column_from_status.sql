-- ============================================================
-- Migration 035: sync reverso status → coluna do kanban
-- ============================================================
-- Complementa a 025 (coluna → status). Agora quando o status muda por
-- outra via (painel da tarefa, kanban global "Todas as tarefas",
-- toggle concluir), a tarefa é movida pra coluna do PROJETO que casa
-- com o novo status. Deixa os kanbans (projeto ↔ global) 100% em sincronia.
--
-- Anti-loop: as duas triggers disparam em colunas diferentes do UPDATE:
--   - 025 dispara em UPDATE OF kanban_column_id
--   - 035 dispara em UPDATE OF status
-- Um UPDATE normal só mexe numa delas, então nunca se auto-disparam.
-- Guard extra: se a coluna também mudou na mesma operação, 035 não faz nada.

-- Helper de normalização (lower + remove acentos) reutilizável.
create or replace function public.vf_norm(txt text)
returns text
language sql
immutable
as $$
  select lower(translate(
    coalesce(txt, ''),
    'áàâãäéèêëíìîïóòôõöúùûüç',
    'aaaaaeeeeiiiiooooouuuuc'
  ));
$$;

create or replace function public.tg_sync_column_from_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_col uuid;
begin
  -- Só reage quando o status REALMENTE mudou.
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  -- Se a coluna também foi movida na mesma operação, a 025 já cuidou —
  -- a coluna é a fonte da verdade nesse caso.
  if tg_op = 'UPDATE'
    and new.kanban_column_id is distinct from old.kanban_column_id then
    return new;
  end if;
  if new.project_id is null then
    return new;
  end if;

  -- Acha a coluna do projeto que casa com o novo status (nome normalizado).
  select id into v_col
  from public.kanban_columns c
  where c.project_id = new.project_id
    and (
      case
        when new.status = 'em_andamento' then
          public.vf_norm(c.nome) like '%andamento%'
          or public.vf_norm(c.nome) like '%progresso%'
          or public.vf_norm(c.nome) like '%fazendo%'
        when new.status = 'em_revisao' then
          public.vf_norm(c.nome) like '%revis%'
          or public.vf_norm(c.nome) like '%teste%'
          or public.vf_norm(c.nome) like '%review%'
        when new.status = 'concluido' then
          public.vf_norm(c.nome) like '%conclu%'
          or public.vf_norm(c.nome) like '%feito%'
          or public.vf_norm(c.nome) like '%pronto%'
        when new.status = 'travado' then
          public.vf_norm(c.nome) like '%travad%'
          or public.vf_norm(c.nome) like '%bloque%'
          or public.vf_norm(c.nome) like '%blocked%'
        when new.status = 'pendente' then
          public.vf_norm(c.nome) like '%demanda%'
          or public.vf_norm(c.nome) like '%pendente%'
          or public.vf_norm(c.nome) like '%a fazer%'
          or public.vf_norm(c.nome) like '%backlog%'
        else false
      end
    )
  order by c.ordem
  limit 1;

  -- Pendente sem coluna dedicada → cai na primeira coluna (menor ordem).
  if v_col is null and new.status = 'pendente' then
    select id into v_col
    from public.kanban_columns
    where project_id = new.project_id
    order by ordem
    limit 1;
  end if;

  if v_col is not null and new.kanban_column_id is distinct from v_col then
    new.kanban_column_id := v_col;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_column_from_status on public.tasks;
create trigger trg_sync_column_from_status
  before update of status on public.tasks
  for each row execute function public.tg_sync_column_from_status();
