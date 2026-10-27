import { createClient } from "@/lib/supabase/client";

export type TaskDeleteResult = { ok: true } | { ok: false; message: string };

export function taskDeleteConfirm(titulo?: string | null): string {
  const alvo = titulo ? `a tarefa "${titulo}"` : "esta tarefa";
  return `Excluir ${alvo}? Isso remove a tarefa do banco e dos mapas mentais que a referenciam.`;
}

/**
 * Exclui uma tarefa. Quem decide é o banco (migration 044): sem "Excluir" no
 * perfil, a RLS não apaga nada e não devolve erro — por isso a contagem.
 */
export async function deleteTaskById(id: string): Promise<TaskDeleteResult> {
  const { error, count } = await createClient()
    .from("tasks")
    .delete({ count: "exact" })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  if (count === 0) return { ok: false, message: "Sem permissão para excluir essa tarefa." };
  return { ok: true };
}
