-- ============================================================
-- Migration 009: prazo opcionalmente sem horário
-- ============================================================
-- Quando false, a UI mostra apenas a data (sem horas) e o prazo é gravado
-- como 23:59:59 de Brasília — fim do dia útil. Quando true (padrão para
-- compatibilidade com tarefas pré-existentes), mostra data + hora.

alter table public.tasks
  add column if not exists prazo_has_time boolean not null default true;
