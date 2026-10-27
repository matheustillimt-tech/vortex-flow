-- ============================================================
-- Migration 025: ao mover tarefa de coluna no kanban, atualiza status
-- ============================================================
-- Mapeamento por nome de coluna (case-insensitive, sem acento):
--   "andamento" / "progresso"     → em_andamento
--   "revis" / "teste"             → em_revisao
--   "conclu" (concluído, concluídas) → concluido
--   "travad" / "bloque"           → travado
--   demais (Demandas, Bug, etc.)  → mantém status atual

create or replace function public.tg_sync_status_from_kanban_column()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_col_name text;
  v_norm text;
  v_new_status task_status;
begin
  -- Só reage quando kanban_column_id REALMENTE mudou (em UPDATE)
  -- ou em INSERT com coluna definida.
  if tg_op = 'UPDATE'
    and new.kanban_column_id is not distinct from old.kanban_column_id then
    return new;
  end if;
  if new.kanban_column_id is null then
    return new;
  end if;

  select nome into v_col_name
    from public.kanban_columns
    where id = new.kanban_column_id;
  if v_col_name is null then return new; end if;

  v_norm := lower(v_col_name);
  -- Remove acentos comuns
  v_norm := translate(
    v_norm,
    'áàâãäéèêëíìîïóòôõöúùûüç',
    'aaaaaeeeeiiiiooooouuuuc'
  );

  if v_norm like '%andamento%'
    or v_norm like '%progresso%'
    or v_norm like 'em progresso%'
    or v_norm like 'fazendo%' then
    v_new_status := 'em_andamento';
  elsif v_norm like '%conclu%' or v_norm like 'feito%' or v_norm like 'pronto%' then
    v_new_status := 'concluido';
  elsif v_norm like '%revis%' or v_norm like '%teste%' or v_norm like '%review%' then
    v_new_status := 'em_revisao';
  elsif v_norm like '%travad%' or v_norm like '%bloque%' or v_norm like '%blocked%' then
    v_new_status := 'travado';
  end if;

  if v_new_status is null then
    return new;
  end if;

  if new.status is distinct from v_new_status then
    new.status := v_new_status;
    -- Concluindo agora → carimba data_conclusao
    if v_new_status = 'concluido' and new.data_conclusao is null then
      new.data_conclusao := now();
    end if;
    -- Saindo de concluido → limpa data_conclusao
    if v_new_status <> 'concluido' and tg_op = 'UPDATE'
      and old.status = 'concluido' then
      new.data_conclusao := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_status_from_kanban on public.tasks;
create trigger trg_sync_status_from_kanban
  before insert or update of kanban_column_id on public.tasks
  for each row execute function public.tg_sync_status_from_kanban_column();

-- ------------------------------------------------------------
-- Backfill: aplica a mesma lógica nas tarefas que JÁ estão alocadas
-- a uma coluna (corrige status pra refletir onde elas estão hoje).
-- ------------------------------------------------------------
update public.tasks t
set status = (
  case
    when (
      lower(translate(c.nome, 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'))
    ) like '%andamento%' then 'em_andamento'::task_status
    when (
      lower(translate(c.nome, 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'))
    ) like '%conclu%' then 'concluido'::task_status
    when (
      lower(translate(c.nome, 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'))
    ) like '%revis%' then 'em_revisao'::task_status
    when (
      lower(translate(c.nome, 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'))
    ) like '%teste%' then 'em_revisao'::task_status
    when (
      lower(translate(c.nome, 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'))
    ) like '%travad%' then 'travado'::task_status
    else t.status
  end
),
data_conclusao = (
  case
    when (
      lower(translate(c.nome, 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'))
    ) like '%conclu%' and t.data_conclusao is null then now()
    else t.data_conclusao
  end
)
from public.kanban_columns c
where c.id = t.kanban_column_id;
