-- ============================================================
-- Migration 012: remove trigger legado de notify_task_assigned
-- ============================================================
-- Antes existia um trigger em public.tasks que disparava notificação
-- toda vez que responsavel_id mudava. Agora a fonte canônica é
-- task_assignees (migração 010 + trigger de 011), então o trigger
-- legado vira fonte de notificações DUPLICADAS para o responsável
-- principal — vamos removê-lo.

drop trigger if exists trg_notify_task_assigned on public.tasks;
-- Mantemos a função (notify_task_assigned) para histórico/rollback fácil.
