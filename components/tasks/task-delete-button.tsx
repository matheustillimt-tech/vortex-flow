"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useCan } from "@/components/permissions/permissions-provider";
import { deleteTaskById, taskDeleteConfirm } from "@/lib/task-delete";

interface Props {
  taskId: string;
  titulo: string;
  onDeleted: (id: string) => void;
}

/**
 * Lixeira no card do quadro: exclui sem abrir a tarefa. Aparece ao passar o
 * mouse (em telas de toque, sempre) e só para perfis com "Excluir".
 */
export function TaskDeleteButton({ taskId, titulo, onDeleted }: Props) {
  const canDelete = useCan("tarefas", "delete");
  const [excluindo, setExcluindo] = useState(false);
  if (!canDelete) return null;

  async function excluir(e: React.MouseEvent) {
    // O card inteiro abre a tarefa; o clique na lixeira não pode chegar nele.
    e.stopPropagation();
    if (excluindo || !confirm(taskDeleteConfirm(titulo))) return;
    setExcluindo(true);
    const resultado = await deleteTaskById(taskId);
    if (!resultado.ok) {
      setExcluindo(false);
      toast.error(resultado.message);
      return;
    }
    toast.success("Tarefa excluída");
    onDeleted(taskId);
  }

  return (
    <button
      type="button"
      onClick={(e) => void excluir(e)}
      disabled={excluindo}
      title="Excluir tarefa"
      aria-label={`Excluir tarefa ${titulo}`}
      className={`shrink-0 -mt-0.5 -mr-1 p-1 rounded-md text-fg-subtle hover:text-priority-urgent hover:bg-priority-urgent/15 transition ${
        excluindo
          ? "opacity-100"
          : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
      }`}
    >
      {excluindo ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Trash2 className="w-3.5 h-3.5" />
      )}
    </button>
  );
}
