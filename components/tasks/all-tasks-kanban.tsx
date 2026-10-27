"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { PriorityBadge } from "@/components/ui/badge";
import { PrazoBadge } from "@/components/ui/prazo-badge";
import { TaskDeleteButton } from "@/components/tasks/task-delete-button";
import { initials } from "@/lib/utils";
import {
  STATUS_COLOR,
  STATUS_LABEL,
  type Project,
  type Task,
  type TaskStatus,
  type UserProfile
} from "@/lib/types";
import { useCan } from "@/components/permissions/permissions-provider";

interface Props {
  tasks: Task[];
  users: UserProfile[];
  assignees: Map<string, string[]>;
  projectById: Map<string, Project>;
  onOpenTask: (id: string) => void;
  onOptimisticStatus: (taskId: string, status: TaskStatus) => void;
  onTaskDeleted: (id: string) => void;
}

// Colunas padrão do kanban global (iguais às colunas default dos projetos).
const COLUMNS: TaskStatus[] = [
  "pendente",
  "em_andamento",
  "em_revisao",
  "concluido"
];

// Status sem coluna própria caem numa coluna existente (não somem do board).
// "travado" aparece em "Em andamento" (na lista o status real segue visível).
function columnForStatus(status: TaskStatus): TaskStatus {
  return status === "travado" ? "em_andamento" : status;
}

export function AllTasksKanban({
  tasks,
  users,
  assignees,
  projectById,
  onOpenTask,
  onOptimisticStatus,
  onTaskDeleted
}: Props) {
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);

  const byStatus = useMemo(() => {
    const m = new Map<TaskStatus, Task[]>();
    for (const s of COLUMNS) m.set(s, []);
    for (const t of tasks) {
      const arr = m.get(columnForStatus(t.status));
      if (arr) arr.push(t);
    }
    return m;
  }, [tasks]);

  // Arrastar muda o status; sem Editar os cards ficam parados.
  const canEdit = useCan("tarefas", "edit");

  async function moveToStatus(taskId: string, status: TaskStatus) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === status) return;
    // Otimista
    onOptimisticStatus(taskId, status);
    const supabase = createClient();
    const patch: Record<string, unknown> = { status };
    if (status === "concluido") patch.data_conclusao = new Date().toISOString();
    else if (task.status === "concluido") patch.data_conclusao = null;
    // O trigger reverso reposiciona a task na coluna certa do projeto
    // (concluída ⇒ coluna verde). `.select()` confirma o resultado final.
    const { error } = await supabase
      .from("tasks")
      .update(patch)
      .eq("id", taskId)
      .select()
      .single();
    if (error) {
      onOptimisticStatus(taskId, task.status); // rollback
      toast.error("Não foi possível mover: " + error.message);
    }
  }

  return (
    <div className="h-full flex gap-3 overflow-x-auto p-4 bg-bg-subtle/30">
      {COLUMNS.map((status) => {
        const colTasks = byStatus.get(status) ?? [];
        const isOver = dragOverStatus === status;
        return (
          <div
            key={status}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverStatus(status);
            }}
            onDragLeave={() => setDragOverStatus((s) => (s === status ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverStatus(null);
              if (dragTaskId) void moveToStatus(dragTaskId, status);
              setDragTaskId(null);
            }}
            className={`shrink-0 w-72 h-full flex flex-col min-h-0 rounded-xl border bg-bg-subtle transition ${
              isOver ? "border-brand ring-2 ring-brand/20" : "border-border"
            }`}
          >
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border rounded-t-xl">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: STATUS_COLOR[status] }}
              />
              <h3 className="text-sm font-semibold text-fg flex-1 truncate">
                {STATUS_LABEL[status]}
              </h3>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-muted text-fg-muted">
                {colTasks.length}
              </span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
              {colTasks.map((t) => {
                const project = t.project_id
                  ? projectById.get(t.project_id)
                  : null;
                const aIds = assignees.get(t.id) ?? [];
                const respIds = aIds.length
                  ? aIds
                  : t.responsavel_id
                    ? [t.responsavel_id]
                    : [];
                const isDone = t.status === "concluido";
                return (
                  <div
                    key={t.id}
                    draggable={canEdit}
                    onDragStart={canEdit ? () => setDragTaskId(t.id) : undefined}
                    onDragEnd={() => {
                      setDragTaskId(null);
                      setDragOverStatus(null);
                    }}
                    onClick={() => onOpenTask(t.id)}
                    className={`group bg-bg border rounded-lg p-2.5 cursor-pointer hover:shadow-sm transition ${
                      isDone
                        ? "border-status-done/40 bg-status-done/5"
                        : "border-border hover:border-border-strong"
                    } ${dragTaskId === t.id ? "opacity-40" : ""}`}
                  >
                    <div className="flex items-start gap-1 mb-2">
                      <p className="flex-1 min-w-0 text-xs font-medium leading-snug line-clamp-3">
                        {t.titulo}
                      </p>
                      <TaskDeleteButton taskId={t.id} titulo={t.titulo} onDeleted={onTaskDeleted} />
                    </div>

                    {project && (
                      <div className="flex items-center gap-1 mb-2">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: project.cor || "#64748b" }}
                        />
                        <span className="text-[10px] text-fg-subtle truncate">
                          {project.nome}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <PriorityBadge value={t.prioridade} />
                      <PrazoBadge
                        prazo={t.prazo}
                        prazo_has_time={t.prazo_has_time}
                        status={t.status}
                        size="sm"
                      />
                      {respIds.length > 0 && (
                        <div className="flex items-center -space-x-1.5 ml-auto">
                          {respIds.slice(0, 3).map((id) => {
                            const u = users.find((x) => x.id === id);
                            if (!u) return null;
                            return (
                              <span
                                key={id}
                                className="w-5 h-5 rounded-full border-2 border-bg bg-brand/20 text-brand text-[9px] font-bold flex items-center justify-center uppercase"
                                title={u.nome}
                              >
                                {initials(u.nome)}
                              </span>
                            );
                          })}
                          {respIds.length > 3 && (
                            <span className="w-5 h-5 rounded-full border-2 border-bg bg-bg-muted text-fg-muted text-[9px] font-bold flex items-center justify-center">
                              +{respIds.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {colTasks.length === 0 && (
                <p className="text-[11px] text-fg-subtle text-center py-6 italic">
                  Sem tarefas
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
