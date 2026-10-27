-- ============================================================
-- Migration 023: kanban liberado pra TODOS os tipos de projeto
-- ============================================================
-- Mudanças:
--   1. As colunas padrão viram: Demandas / Em andamento / Em revisão /
--      Concluídas (antes eram específicas pra SaaS).
--   2. Trigger de seed fira pra QUALQUER projeto novo (não só SaaS).
--   3. Os triggers que sincronizam kanban_columns ↔ map nodes passam a
--      rodar APENAS pra projetos SaaS (em outros tipos, o kanban é
--      metadata e não mexe na hierarquia do mapa mental).
--   4. Backfill:
--      - Projetos sem nenhuma coluna ganham as 4 padrão.
--      - Tarefas SEM kanban_column_id em projetos NÃO-SaaS são alocadas
--        à 1ª coluna (Demandas) — sem disparar os triggers de map sync.

-- ------------------------------------------------------------
-- 1) Atualiza função de seed com os novos defaults
-- ------------------------------------------------------------
create or replace function public.seed_kanban_columns(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  defaults text[] := array[
    'Demandas',
    'Em andamento',
    'Em revisão',
    'Concluídas'
  ];
  colors text[] := array[
    '#94a3b8', -- cinza (Demandas)
    '#3b82f6', -- azul (Em andamento)
    '#eab308', -- amarelo (Em revisão)
    '#10b981'  -- verde (Concluídas)
  ];
  i int;
begin
  -- Idempotente: se já tem qualquer coluna, não mexe
  if exists (select 1 from public.kanban_columns where project_id = p_project_id) then
    return;
  end if;
  for i in 1..array_length(defaults, 1) loop
    insert into public.kanban_columns (project_id, nome, ordem, cor)
    values (p_project_id, defaults[i], i - 1, colors[i]);
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- 2) Trigger de seed: fira pra QUALQUER projeto novo
-- ------------------------------------------------------------
create or replace function public.tg_seed_kanban_on_project_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_kanban_columns(new.id);
  return new;
end;
$$;

drop trigger if exists trg_seed_kanban_on_insert on public.projects;
create trigger trg_seed_kanban_on_insert
  after insert on public.projects
  for each row execute function public.tg_seed_kanban_on_project_insert();

-- (Mantém o trigger antigo tg_seed_kanban_on_tipo_change que dispara
--  quando tipo vira saas — fica como rede de segurança, mas a função
--  seed agora é idempotente e tem o mesmo conjunto de defaults.)

-- ------------------------------------------------------------
-- 3) Sync kanban_columns ↔ nodes: APENAS em projetos SaaS
-- ------------------------------------------------------------
create or replace function public.tg_kanban_column_after_insert()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tipo project_tipo;
begin
  select tipo into v_tipo from public.projects where id = new.project_id;
  if v_tipo is distinct from 'saas' then
    return new; -- nada de criar nó-bloco no mapa pra não-SaaS
  end if;
  perform public.ensure_kanban_column_node(new.id);
  return new;
end;
$$;

create or replace function public.tg_kanban_column_sync_node()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tipo project_tipo;
begin
  if new.node_id is null then return new; end if;
  select tipo into v_tipo from public.projects where id = new.project_id;
  if v_tipo is distinct from 'saas' then return new; end if;
  if new.nome is distinct from old.nome then
    update public.nodes set titulo = new.nome where id = new.node_id;
  end if;
  return new;
end;
$$;

create or replace function public.tg_kanban_column_before_delete()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tipo project_tipo;
begin
  if old.node_id is null then return old; end if;
  select tipo into v_tipo from public.projects where id = old.project_id;
  if v_tipo is distinct from 'saas' then return old; end if;
  delete from public.nodes where id = old.node_id;
  return old;
end;
$$;

create or replace function public.tg_task_sync_kanban_to_node()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_task_node_id uuid;
  v_task_map_id uuid;
  v_new_col_node uuid;
  v_tipo project_tipo;
begin
  if new.kanban_column_id is not distinct from old.kanban_column_id then
    return new;
  end if;
  -- Só sincroniza com o mapa em projetos SaaS
  select tipo into v_tipo from public.projects where id = new.project_id;
  if v_tipo is distinct from 'saas' then
    return new;
  end if;
  select n.id, n.map_id into v_task_node_id, v_task_map_id
    from public.nodes n
    join public.maps m on m.id = n.map_id
    where n.task_id = new.id
      and m.project_id = new.project_id
      and m.is_default = true
    limit 1;
  if v_task_node_id is null then return new; end if;
  if new.kanban_column_id is not null then
    select node_id into v_new_col_node
      from public.kanban_columns
      where id = new.kanban_column_id;
  end if;
  delete from public.edges where target_node_id = v_task_node_id;
  if v_new_col_node is not null then
    insert into public.edges (map_id, source_node_id, target_node_id)
    values (v_task_map_id, v_new_col_node, v_task_node_id);
  end if;
  return new;
end;
$$;

create or replace function public.tg_edge_sync_to_kanban_column()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_target_task_id uuid;
  v_target_node_id uuid;
  v_source_node_id uuid;
  v_col_id uuid;
  v_tipo project_tipo;
begin
  v_target_node_id := coalesce(new.target_node_id, old.target_node_id);
  v_source_node_id := coalesce(new.source_node_id, old.source_node_id);
  select task_id into v_target_task_id from public.nodes where id = v_target_node_id;
  if v_target_task_id is null then return coalesce(new, old); end if;
  -- Só sincroniza pra SaaS
  select p.tipo into v_tipo
    from public.tasks t
    join public.projects p on p.id = t.project_id
    where t.id = v_target_task_id;
  if v_tipo is distinct from 'saas' then return coalesce(new, old); end if;

  if tg_op = 'INSERT' then
    select id into v_col_id from public.kanban_columns where node_id = v_source_node_id;
    if v_col_id is not null then
      update public.tasks set kanban_column_id = v_col_id where id = v_target_task_id;
    end if;
  elsif tg_op = 'DELETE' then
    select id into v_col_id from public.kanban_columns where node_id = v_source_node_id;
    if v_col_id is not null then
      if not exists (
        select 1 from public.edges e
        where e.target_node_id = v_target_node_id
          and e.source_node_id = v_source_node_id
      ) then
        update public.tasks
          set kanban_column_id = null
          where id = v_target_task_id and kanban_column_id = v_col_id;
      end if;
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

-- ------------------------------------------------------------
-- 4) Backfill: cria as colunas padrão pros projetos que não têm
-- ------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.id
    from public.projects p
    where not exists (
      select 1 from public.kanban_columns c where c.project_id = p.id
    )
  loop
    perform public.seed_kanban_columns(r.id);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 5) Backfill: tarefas NÃO-SaaS sem kanban_column_id → 1ª coluna
--    (em SaaS, o trigger acima reparenteizaria nós no mapa — então
--     deixamos como estão. Usuário pode mover manualmente.)
-- ------------------------------------------------------------
update public.tasks t
set kanban_column_id = (
  select c.id from public.kanban_columns c
  where c.project_id = t.project_id
  order by c.ordem asc
  limit 1
)
from public.projects p
where p.id = t.project_id
  and p.tipo is distinct from 'saas'
  and t.kanban_column_id is null
  and t.project_id is not null;
