-- ============================================================
-- Migration 017: corrige nós de 1º nível que viraram tasks por engano
-- ============================================================
-- O comportamento "TAB = sempre tarefa" criou tasks em nós de primeiro
-- nível (filhos diretos do root do mapa), quando o correto é que esses
-- blocos sejam APENAS funis (sem task_id). Aqui revertemos.
--
-- Critério: nó tem task_id E não tem nenhuma edge incoming dentro do
-- mesmo map → é "filho direto do root" e deve ser um bloco de funil.
-- Estratégia:
--   1) Copia o título da task para o título do nó (mantém o rótulo
--      visível no bloco).
--   2) Zera node.task_id.
--   3) Deleta tasks órfãs que sobraram.

with affected as (
  select n.id as node_id, n.task_id, t.titulo as task_titulo
  from public.nodes n
  join public.tasks t on t.id = n.task_id
  where n.task_id is not null
    and not exists (
      select 1 from public.edges e
      where e.map_id = n.map_id
        and e.target_node_id = n.id
    )
)
update public.nodes n
set
  titulo = coalesce(a.task_titulo, n.titulo),
  task_id = null
from affected a
where n.id = a.node_id;

-- Tasks que ficaram sem nó apontando → órfãs, limpa.
delete from public.tasks
where id not in (
  select task_id from public.nodes where task_id is not null
);
