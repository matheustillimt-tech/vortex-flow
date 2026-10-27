-- ============================================================
-- Migration 026: Biblioteca de Processos (modelos reutilizáveis)
-- ============================================================
-- Conceito: separa "processo modelo" de "projeto em execução".
-- Cada modelo é uma estrutura hierárquica:
--   Processo → Etapas → Tarefas (com dias_offset relativo) → Checklist
-- Aplicado a um projeto via RPC apply_process_template (project_id +
-- anchor_date), o sistema cria todas as tasks com prazos calculados.

-- ------------------------------------------------------------
-- Tabelas
-- ------------------------------------------------------------
create table if not exists public.process_templates (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  /** Rótulo da data-âncora (ex: "Data do evento", "Data de lançamento"). */
  anchor_label text not null default 'Data de referência',
  cor text not null default '#6366f1',
  icon text,
  ativo boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists process_templates_ativo_idx on public.process_templates(ativo);

create table if not exists public.template_etapas (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.process_templates(id) on delete cascade,
  nome text not null,
  descricao text,
  ordem int not null default 0,
  cor text not null default '#94a3b8',
  created_at timestamptz not null default now()
);
create index if not exists template_etapas_template_idx on public.template_etapas(template_id, ordem);

create table if not exists public.template_tasks (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.process_templates(id) on delete cascade,
  etapa_id uuid references public.template_etapas(id) on delete set null,
  nome text not null,
  descricao text,
  /** Critério objetivo pra marcar como concluída ("só conclui quando..."). */
  criterio_conclusao text,
  /** Prazo relativo em dias: negativo = antes da âncora (D-21 = -21). */
  dias_offset int,
  prioridade task_priority not null default 'media',
  ordem int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists template_tasks_template_idx on public.template_tasks(template_id);
create index if not exists template_tasks_etapa_idx on public.template_tasks(etapa_id, ordem);

create table if not exists public.template_checklist_items (
  id uuid primary key default gen_random_uuid(),
  template_task_id uuid not null references public.template_tasks(id) on delete cascade,
  titulo text not null,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists template_checklist_template_task_idx
  on public.template_checklist_items(template_task_id, ordem);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.process_templates enable row level security;
alter table public.template_etapas enable row level security;
alter table public.template_tasks enable row level security;
alter table public.template_checklist_items enable row level security;

-- Qualquer autenticado lê. Só admin escreve.
do $$
declare t text;
begin
  foreach t in array array[
    'process_templates',
    'template_etapas',
    'template_tasks',
    'template_checklist_items'
  ]
  loop
    execute format(
      'drop policy if exists "%I_read" on public.%I',
      t, t
    );
    execute format(
      'create policy "%I_read" on public.%I for select using (auth.role() = ''authenticated'')',
      t, t
    );
    execute format(
      'drop policy if exists "%I_admin_write" on public.%I',
      t, t
    );
    execute format(
      'create policy "%I_admin_write" on public.%I for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()))',
      t, t
    );
  end loop;
end $$;

-- ------------------------------------------------------------
-- RPC: aplica um template num projeto, gerando todas as tasks
-- ------------------------------------------------------------
create or replace function public.apply_process_template(
  p_template_id uuid,
  p_project_id uuid,
  p_anchor_date date
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kanban_first_col uuid;
  v_etapa record;
  v_task record;
  v_new_task_id uuid;
  v_created_count int := 0;
  v_user uuid;
begin
  -- Pega o user autenticado pra registrar created_by
  v_user := auth.uid();

  -- 1ª coluna do kanban do projeto (Demandas) — pra alocar as tasks
  select id into v_kanban_first_col
    from public.kanban_columns
    where project_id = p_project_id
    order by ordem asc
    limit 1;

  for v_etapa in
    select * from public.template_etapas
    where template_id = p_template_id
    order by ordem
  loop
    for v_task in
      select * from public.template_tasks
      where template_id = p_template_id
        and (etapa_id = v_etapa.id or (etapa_id is null and v_etapa.id is null))
      order by ordem
    loop
      insert into public.tasks (
        titulo,
        descricao,
        project_id,
        status,
        prioridade,
        prazo,
        prazo_has_time,
        kanban_column_id,
        created_by
      ) values (
        v_task.nome,
        case
          when v_task.descricao is not null and v_task.criterio_conclusao is not null
            then v_task.descricao || E'\n\n**Critério de conclusão:**\n' || v_task.criterio_conclusao
          when v_task.descricao is not null then v_task.descricao
          when v_task.criterio_conclusao is not null
            then E'**Critério de conclusão:**\n' || v_task.criterio_conclusao
          else null
        end,
        p_project_id,
        'pendente',
        v_task.prioridade,
        case when v_task.dias_offset is not null and p_anchor_date is not null
          then (p_anchor_date + (v_task.dias_offset || ' days')::interval)::timestamptz
          else null
        end,
        false,
        v_kanban_first_col,
        v_user
      )
      returning id into v_new_task_id;

      insert into public.task_checklist_items (task_id, titulo, ordem, concluido)
      select v_new_task_id, titulo, ordem, false
      from public.template_checklist_items
      where template_task_id = v_task.id
      order by ordem;

      v_created_count := v_created_count + 1;
    end loop;
  end loop;

  return v_created_count;
end $$;

revoke all on function public.apply_process_template(uuid, uuid, date) from public;
grant execute on function public.apply_process_template(uuid, uuid, date) to authenticated;

-- Esta versão não traz modelos prontos. (Os modelos de processo saem do
-- sistema na migração 048; as tabelas ficam aqui só pelo histórico.)
