-- ============================================================
-- Migration 038: coluna VERDE conclui a tarefa
-- ============================================================
-- Regra de negócio: arrastar um card para qualquer coluna de cor verde
-- marca a tarefa como concluída — independente do nome da coluna
-- ("DEPLOY", "CORRIGIDO", "Publicado"...).
--
-- A detecção é por matiz (HSL), não por lista de hex: funciona com
-- qualquer tom de verde que o admin escolher no color picker.

-- ------------------------------------------------------------
-- vf_is_green: true quando o hex é um tom de verde
-- ------------------------------------------------------------
-- Faixa de matiz 75°–175° cobre lime (#84cc16 ≈ 84°) até emerald
-- (#10b981 ≈ 160°), e exclui amarelo (#eab308 ≈ 45°) e ciano
-- (#06b6d4 ≈ 189°). Exige saturação/luminosidade mínimas pra não
-- classificar cinzas quase-neutros como verde.
create or replace function public.vf_is_green(hex text)
returns boolean
language plpgsql
immutable
as $$
declare
  h text;
  r numeric; g numeric; b numeric;
  mx numeric; mn numeric; d numeric;
  hue numeric; sat numeric; lig numeric;
begin
  if hex is null then return false; end if;
  h := lower(regexp_replace(hex, '[^0-9a-fA-F]', '', 'g'));
  -- Aceita forma curta (#0b8 → 00bb88)
  if length(h) = 3 then
    h := substr(h,1,1) || substr(h,1,1)
      || substr(h,2,1) || substr(h,2,1)
      || substr(h,3,1) || substr(h,3,1);
  end if;
  if length(h) <> 6 then return false; end if;

  r := ('x' || substr(h,1,2))::bit(8)::int / 255.0;
  g := ('x' || substr(h,3,2))::bit(8)::int / 255.0;
  b := ('x' || substr(h,5,2))::bit(8)::int / 255.0;

  mx := greatest(r,g,b);
  mn := least(r,g,b);
  d  := mx - mn;
  lig := (mx + mn) / 2.0;

  if d = 0 then return false; end if;  -- cinza puro

  sat := d / (1 - abs(2*lig - 1));

  if mx = r then
    hue := 60 * (((g - b) / d)::numeric % 6);
  elsif mx = g then
    hue := 60 * (((b - r) / d) + 2);
  else
    hue := 60 * (((r - g) / d) + 4);
  end if;
  if hue < 0 then hue := hue + 360; end if;

  return hue >= 75 and hue <= 175
     and sat >= 0.15
     and lig between 0.12 and 0.92;
end $$;

-- ------------------------------------------------------------
-- Coluna → status (substitui a versão da 025)
-- ------------------------------------------------------------
create or replace function public.tg_sync_status_from_kanban_column()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
  v_cor text;
  v_norm text;
  v_new_status task_status;
begin
  if tg_op = 'UPDATE'
    and new.kanban_column_id is not distinct from old.kanban_column_id then
    return new;
  end if;
  if new.kanban_column_id is null then
    return new;
  end if;

  select nome, cor into v_nome, v_cor
    from public.kanban_columns
    where id = new.kanban_column_id;
  if v_nome is null then return new; end if;

  v_norm := public.vf_norm(v_nome);

  -- 1) COR VERDE tem prioridade: conclui a tarefa.
  if public.vf_is_green(v_cor) then
    v_new_status := 'concluido';
  -- 2) Senão, deduz pelo nome da coluna.
  elsif v_norm like '%andamento%'
     or v_norm like '%progresso%'
     or v_norm like '%fazendo%' then
    v_new_status := 'em_andamento';
  elsif v_norm like '%conclu%'
     or v_norm like '%feito%'
     or v_norm like '%pronto%' then
    v_new_status := 'concluido';
  elsif v_norm like '%revis%'
     or v_norm like '%teste%'
     or v_norm like '%review%' then
    v_new_status := 'em_revisao';
  elsif v_norm like '%travad%'
     or v_norm like '%bloque%'
     or v_norm like '%blocked%' then
    v_new_status := 'travado';
  end if;

  -- 3) Saiu de "concluído" para uma coluna que não é verde nem tem nome
  --    de conclusão → reabre a tarefa (simétrico à regra da cor).
  if v_new_status is null
    and tg_op = 'UPDATE'
    and old.status = 'concluido' then
    v_new_status := 'pendente';
  end if;

  if v_new_status is null then
    return new;
  end if;

  if new.status is distinct from v_new_status then
    new.status := v_new_status;
    if v_new_status = 'concluido' and new.data_conclusao is null then
      new.data_conclusao := now();
    end if;
    if v_new_status <> 'concluido' then
      new.data_conclusao := null;
    end if;
  end if;

  return new;
end $$;

-- ------------------------------------------------------------
-- Status → coluna (substitui a da 035): concluído prefere coluna VERDE
-- ------------------------------------------------------------
create or replace function public.tg_sync_column_from_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_col uuid;
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

  -- Concluído: primeiro tenta uma coluna verde do projeto.
  if new.status = 'concluido' then
    select id into v_col
    from public.kanban_columns
    where project_id = new.project_id
      and public.vf_is_green(cor)
    order by ordem desc   -- a mais à direita costuma ser a final
    limit 1;
  end if;

  -- Senão (ou se não há coluna verde), casa pelo nome.
  if v_col is null then
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
      -- Reabrir não pode mandar a task de volta pra uma coluna verde.
      and (new.status = 'concluido' or not public.vf_is_green(c.cor))
    order by c.ordem
    limit 1;
  end if;

  if v_col is null and new.status = 'pendente' then
    select id into v_col
    from public.kanban_columns
    where project_id = new.project_id
      and not public.vf_is_green(cor)
    order by ordem
    limit 1;
  end if;

  if v_col is not null and new.kanban_column_id is distinct from v_col then
    new.kanban_column_id := v_col;
  end if;

  return new;
end $$;

-- ------------------------------------------------------------
-- Backfill: tarefas que já estão em colunas verdes viram concluídas
-- ------------------------------------------------------------
update public.tasks t
set status = 'concluido',
    data_conclusao = coalesce(t.data_conclusao, now())
from public.kanban_columns c
where c.id = t.kanban_column_id
  and public.vf_is_green(c.cor)
  and t.status is distinct from 'concluido';
