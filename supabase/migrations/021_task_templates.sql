-- ============================================================
-- Migration 021: tarefas como template (reutilizáveis em outros projetos)
-- ============================================================
-- A task continua no projeto original; o flag is_template apenas a
-- expõe na lista de templates pra ser CLONADA em outros projetos.

alter table public.tasks
  add column if not exists is_template boolean not null default false;

-- Index parcial pra acelerar a lista de templates (são raros).
create index if not exists tasks_templates_idx
  on public.tasks(is_template)
  where is_template = true;
