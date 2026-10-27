-- ============================================================
-- Migration: limpa tasks órfãs e instala trigger automático
-- Garante: ao apagar um nó com task_id (e nenhum outro nó referencia
-- essa task), a task também é apagada — mantendo Mapa Geral consistente.
-- ============================================================

create or replace function public.delete_orphan_task()
returns trigger language plpgsql security definer as $$
begin
  if old.task_id is not null then
    if not exists (
      select 1 from public.nodes
      where task_id = old.task_id and id <> old.id
    ) then
      delete from public.tasks where id = old.task_id;
    end if;
  end if;
  return old;
end $$;

drop trigger if exists trg_delete_orphan_task on public.nodes;
create trigger trg_delete_orphan_task
  after delete on public.nodes
  for each row execute function public.delete_orphan_task();

-- Limpa tasks já órfãs do banco (sem nenhum nó referenciando)
delete from public.tasks
where id not in (
  select task_id from public.nodes where task_id is not null
);
