import { createClient } from "@/lib/supabase/client";
import type { TaskPriority, TaskStatus } from "@/lib/types";

export interface TaskCreationInput {
  project_id: string;
  titulo: string;
  descricao: string | null;
  prioridade: TaskPriority;
  status: TaskStatus;
  sector_id: string | null;
  kanban_column_id: string | null;
  prazo: string | null;
  prazo_has_time: boolean;
  responsavel_id: string | null;
  created_by: string;
}

export function createTaskDraft(input: TaskCreationInput, assignees: string[], checklist: string[]) {
  const id = crypto.randomUUID();
  return {
    task: { ...input, id },
    assignees: assignees.map((user_id, i) => ({ task_id: id, user_id, primary_assignee: i === 0 })),
    checklist: checklist.map((titulo, ordem) => ({ id: crypto.randomUUID(), task_id: id, titulo, ordem, done: false })),
    taskSaved: false,
    assigneesSaved: assignees.length === 0,
    checklistSaved: checklist.length === 0
  };
}
export type TaskCreationDraft = ReturnType<typeof createTaskDraft>;

/** IDs mantidos durante todo o formulário: retries não duplicam tarefa nem subtarefas. */
export async function saveTaskDraft(draft: TaskCreationDraft, onTaskSaved: () => void) {
  const supabase = createClient();
  if (!draft.taskSaved) {
    const { error } = await supabase.from("tasks").upsert(draft.task, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw error;
    const confirmed = await supabase.from("tasks").select("id").eq("id", draft.task.id).single();
    if (confirmed.error || !confirmed.data) throw confirmed.error ?? new Error("Não foi possível confirmar a criação da tarefa.");
    draft.taskSaved = true;
    onTaskSaved();
  }
  if (!draft.assigneesSaved) {
    const { error } = await supabase.from("task_assignees").upsert(draft.assignees, { onConflict: "task_id,user_id", ignoreDuplicates: true });
    if (error) throw error;
    draft.assigneesSaved = true;
  }
  if (!draft.checklistSaved) {
    const { error } = await supabase.from("task_checklist_items").upsert(draft.checklist, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw error;
    draft.checklistSaved = true;
  }
}
