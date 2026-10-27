-- ============================================================
-- Migration 034: flag "usa_prazos" por processo modelo
-- ============================================================
-- Chave (toggle) no próprio processo: quando OFF, o processo é aplicado
-- sem prazos (tarefas sem data) e o editor esconde os campos D±. Quando
-- ON, os prazos relativos (dias_offset) são usados ao aplicar.
-- Default OFF — prazos são opcionais por padrão.

alter table public.process_templates
  add column if not exists usa_prazos boolean not null default false;
