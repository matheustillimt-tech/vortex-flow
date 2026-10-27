-- ============================================================
-- Migration: collapse de nós + prazo com hora (Brasília)
-- ============================================================

-- Expand/collapse de nós no mapa mental
alter table public.nodes
  add column if not exists collapsed boolean not null default false;

-- Prazos passam a aceitar data + horário (timezone-aware)
alter table public.tasks
  alter column prazo type timestamptz
  using case when prazo is null then null else (prazo::text || ' 23:59-03')::timestamptz end;

alter table public.projects
  alter column prazo type timestamptz
  using case when prazo is null then null else (prazo::text || ' 23:59-03')::timestamptz end;

-- (data_inicio em projects permanece date)
