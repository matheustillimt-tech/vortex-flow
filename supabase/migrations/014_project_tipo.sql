-- ============================================================
-- Migration 014: tipo de projeto (infoproduto / saas / produto_fisico)
-- ============================================================
-- Projetos existentes ficam como "infoproduto" (comportamento atual com
-- funis, tickets low/medium/high). Os novos tipos NÃO usam essa estrutura,
-- são só mapas mentais de tarefas.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'project_tipo') then
    create type project_tipo as enum ('infoproduto', 'saas', 'produto_fisico');
  end if;
end $$;

alter table public.projects
  add column if not exists tipo project_tipo not null default 'infoproduto';

-- Compat: tudo que já existe vira infoproduto (default da coluna garante
-- isso, mas reforçamos pra deixar explícito).
update public.projects set tipo = 'infoproduto' where tipo is null;
