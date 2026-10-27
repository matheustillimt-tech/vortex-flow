-- Remove a área de Processos do banco.
--
-- A tela, as rotas e os tipos saíram do app, e nenhum código usa mais
-- estas tabelas nem estas funções. IRREVERSÍVEL: apaga POPs, tutoriais e modelos
-- de processo, com etapas, tarefas-modelo e checklists.
--
-- Sem CASCADE de propósito. As dependências conhecidas são removidas uma a uma;
-- se existir alguma que não foi mapeada (uma view, uma FK nova), a migration
-- falha e nada é apagado — em vez de levar junto, em silêncio, o que não se viu.
--
-- Dependências mapeadas:
--   - FKs apenas entre as próprias tabelas (etapas e tarefas-modelo → modelo,
--     tarefa-modelo → etapa, checklist → tarefa-modelo): removidas filhos antes.
--   - trg_processes_updated vai junto com a tabela. A função set_updated_at é
--     COMPARTILHADA (users, projetos, tarefas...) e fica.
--   - processes sai da publicação supabase_realtime ao ser removida.

begin;

-- ---------------------------------------------------------------- funções

drop function if exists public.apply_process_template(uuid, uuid, date);
drop function if exists public.apply_template_task(uuid, uuid, date);
drop function if exists public.increment_process_views(uuid);

-- ---------------------------------------------------------------- tabelas

-- Filhos antes dos pais.
drop table if exists public.template_checklist_items;
drop table if exists public.template_tasks;
drop table if exists public.template_etapas;
drop table if exists public.process_templates;
drop table if exists public.processes;

notify pgrst, 'reload schema';
commit;
