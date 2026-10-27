"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GripVertical,
  Loader2,
  Plus,
  Trash2,
  User as UserIcon
} from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  arrayMove,
  useSortable
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createClient } from "@/lib/supabase/client";
import { TaskPanel } from "@/components/side-panel/task-panel";
import { PriorityBadge } from "@/components/ui/badge";
import { PrazoBadge } from "@/components/ui/prazo-badge";
import { TaskDeleteButton } from "@/components/tasks/task-delete-button";
import { initials } from "@/lib/utils";
import { STATUS_LABEL } from "@/lib/types";
import type {
  KanbanColumn,
  Task,
  TaskAssignee,
  TaskPriority,
  TaskStatus,
  UserProfile
} from "@/lib/types";
import { useCan } from "@/components/permissions/permissions-provider";

const COLORS = [
  "#94a3b8", "#3b82f6", "#10b981", "#eab308",
  "#f97316", "#ef4444", "#a855f7", "#06b6d4",
  "#ec4899", "#84cc16"
];

interface Props {
  projectId: string;
  /** Filtro controlado externamente (botão fica no header do ProjectView). */
  filterAssigneeId: string | null;
  /** Reporta os usuários que têm pelo menos 1 task neste projeto — usado
   *  pra montar o dropdown no header. */
  onUsersInProjectChange?: (users: UserProfile[]) => void;
  /** Abre o modal completo de criar tarefa, pré-selecionando a coluna. */
  onRequestCreate?: (columnId: string) => void;
  /** Bump pra recarregar o board (ex: após criar tarefa pelo modal). */
  refreshKey?: number;
}

export function KanbanBoard({
  projectId,
  filterAssigneeId,
  onUsersInProjectChange,
  onRequestCreate,
  refreshKey
}: Props) {
  const supabaseRef = useRef(createClient());
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [assigneesByTask, setAssigneesByTask] = useState<Map<string, string[]>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);
  // Estrutura das colunas (criar, renomear, cor, status, ordenar, excluir) segue
  // projetos:edit — antes era decidida pelo role legado de admin.
  const canEditStructure = useCan("projetos", "edit");
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [colorPickerColumnId, setColorPickerColumnId] = useState<string | null>(
    null
  );
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = supabaseRef.current;
    const [c, t, u, a] = await Promise.all([
      supabase
        .from("kanban_columns")
        .select("*")
        .eq("project_id", projectId)
        .order("ordem"),
      supabase
        .from("tasks")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at"),
      supabase.from("users").select("*").eq("ativo", true).order("nome"),
      supabase
        .from("task_assignees")
        .select("task_id, user_id, primary_assignee")
    ]);
    setColumns((c.data as KanbanColumn[]) ?? []);
    setTasks((t.data as Task[]) ?? []);
    setUsers((u.data as UserProfile[]) ?? []);
    const m = new Map<string, string[]>();
    for (const r of (a.data as TaskAssignee[]) ?? []) {
      const arr = m.get(r.task_id) ?? [];
      if (r.primary_assignee) arr.unshift(r.user_id);
      else arr.push(r.user_id);
      m.set(r.task_id, arr);
    }
    setAssigneesByTask(m);
    setLoading(false);
  }, [projectId]);


  useEffect(() => {
    void load();
  }, [load]);

  // Recarrega quando o pai bumpa refreshKey (ex: task criada pelo modal).
  useEffect(() => {
    if (refreshKey === undefined) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Ref pra task ids do projeto (pra filtrar task_assignees no callback
  // sem ficar preso à closure).
  const taskIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    taskIdsRef.current = new Set(tasks.map((t) => t.id));
  }, [tasks]);

  // Realtime: aplicação incremental do payload (sem refetch global).
  // Outros usuários veem em tempo real: drags de cards entre colunas,
  // renames, adição/remoção de colunas, criação/edição/exclusão de tasks
  // e alterações de assignees.
  useEffect(() => {
    const supabase = supabaseRef.current;

    const ch = supabase
      .channel(`kanban:${projectId}:${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "kanban_columns",
          filter: `project_id=eq.${projectId}`
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const c = payload.new as KanbanColumn;
            setColumns((prev) =>
              prev.some((x) => x.id === c.id)
                ? prev
                : [...prev, c].sort((a, b) => a.ordem - b.ordem)
            );
          } else if (payload.eventType === "UPDATE") {
            const c = payload.new as KanbanColumn;
            setColumns((prev) =>
              prev
                .map((x) => (x.id === c.id ? c : x))
                .sort((a, b) => a.ordem - b.ordem)
            );
          } else if (payload.eventType === "DELETE") {
            const old = payload.old as { id: string };
            setColumns((prev) => prev.filter((x) => x.id !== old.id));
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tasks",
          filter: `project_id=eq.${projectId}`
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const t = payload.new as Task;
            setTasks((prev) =>
              prev.some((x) => x.id === t.id) ? prev : [...prev, t]
            );
          } else if (payload.eventType === "UPDATE") {
            const t = payload.new as Task;
            setTasks((prev) => prev.map((x) => (x.id === t.id ? t : x)));
          } else if (payload.eventType === "DELETE") {
            const old = payload.old as { id: string };
            setTasks((prev) => prev.filter((x) => x.id !== old.id));
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "task_assignees" },
        async (payload) => {
          const taskId =
            (payload.new as { task_id?: string } | null)?.task_id ??
            (payload.old as { task_id?: string } | null)?.task_id;
          if (!taskId) return;
          // Ref pra evitar processar tasks de outros projetos
          if (!taskIdsRef.current.has(taskId)) return;
          const { data } = await supabase
            .from("task_assignees")
            .select("user_id, primary_assignee")
            .eq("task_id", taskId);
          const sorted = ((data as TaskAssignee[]) ?? []).slice().sort(
            (a, b) => Number(b.primary_assignee) - Number(a.primary_assignee)
          );
          setAssigneesByTask((prev) => {
            const m = new Map(prev);
            if (sorted.length > 0) {
              m.set(
                taskId,
                sorted.map((r) => r.user_id)
              );
            } else {
              m.delete(taskId);
            }
            return m;
          });
        }
      )
      .subscribe((status, err) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn(`[kanban realtime] ${status}`, err);
        }
      });

    return () => {
      void supabase.removeChannel(ch);
    };
  }, [projectId]);

  // ============================================================
  // Coluna CRUD
  // ============================================================
  async function addColumn() {
    const supabase = supabaseRef.current;
    const ordem = (columns[columns.length - 1]?.ordem ?? -1) + 1;
    const { data, error } = await supabase
      .from("kanban_columns")
      .insert({
        project_id: projectId,
        nome: "Nova coluna",
        ordem,
        cor: COLORS[columns.length % COLORS.length]
      })
      .select()
      .single();
    if (error || !data) {
      toast.error("Erro: " + (error?.message ?? "falhou"));
      return;
    }
    const newCol = data as KanbanColumn;
    setColumns((prev) => [...prev, newCol]);
    setEditingColumnId(newCol.id);
    setEditingName(newCol.nome);
  }

  async function renameColumn(c: KanbanColumn, nome: string) {
    const supabase = supabaseRef.current;
    const trimmed = nome.trim();
    if (!trimmed) return;
    setColumns((prev) => prev.map((x) => (x.id === c.id ? { ...x, nome: trimmed } : x)));
    const { error } = await supabase
      .from("kanban_columns")
      .update({ nome: trimmed })
      .eq("id", c.id);
    if (error) toast.error("Erro: " + error.message);
  }

  async function changeColumnColor(c: KanbanColumn, cor: string) {
    const supabase = supabaseRef.current;
    setColumns((prev) => prev.map((x) => (x.id === c.id ? { ...x, cor } : x)));
    const { error } = await supabase
      .from("kanban_columns")
      .update({ cor })
      .eq("id", c.id);
    if (error) toast.error("Erro: " + error.message);
  }

  /**
   * Define o que a coluna faz com o status ao receber um card.
   * null = coluna puramente organizacional (não mexe no status).
   * Aplica também às tarefas que já estão na coluna, pra não ficar
   * inconsistente com o que a configuração promete.
   */
  async function changeColumnStatus(
    c: KanbanColumn,
    status: TaskStatus | null
  ) {
    const supabase = supabaseRef.current;
    setColumns((prev) =>
      prev.map((x) => (x.id === c.id ? { ...x, status_ao_mover: status } : x))
    );
    const { error } = await supabase
      .from("kanban_columns")
      .update({ status_ao_mover: status })
      .eq("id", c.id);
    if (error) {
      toast.error("Erro: " + error.message);
      void load();
      return;
    }

    if (!status) {
      toast.success(`"${c.nome}" não altera mais o status das tarefas.`);
      return;
    }

    // Alinha as tarefas que já estavam na coluna.
    const naColuna = tasks.filter(
      (t) => t.kanban_column_id === c.id && t.status !== status
    );
    if (naColuna.length === 0) {
      toast.success(`"${c.nome}" agora marca como ${STATUS_LABEL[status]}.`);
      return;
    }
    const { error: tErr } = await supabase
      .from("tasks")
      .update({
        status,
        data_conclusao:
          status === "concluido" ? new Date().toISOString() : null
      })
      .in(
        "id",
        naColuna.map((t) => t.id)
      );
    if (tErr) {
      toast.error("Status da coluna salvo, mas as tarefas não: " + tErr.message);
      return;
    }
    setTasks((prev) =>
      prev.map((t) =>
        t.kanban_column_id === c.id
          ? {
              ...t,
              status,
              data_conclusao:
                status === "concluido"
                  ? (t.data_conclusao ?? new Date().toISOString())
                  : null
            }
          : t
      )
    );
    toast.success(
      `"${c.nome}" agora marca como ${STATUS_LABEL[status]} — ${naColuna.length} tarefa(s) atualizada(s).`
    );
  }

  async function deleteColumn(c: KanbanColumn) {
    const tasksInColumn = tasks.filter((t) => t.kanban_column_id === c.id);
    const confirmed = confirm(
      tasksInColumn.length > 0
        ? `Excluir a coluna "${c.nome}"?\n\n${tasksInColumn.length} tarefa(s) ficam sem coluna (mas não são excluídas).`
        : `Excluir a coluna "${c.nome}"?`
    );
    if (!confirmed) return;
    const supabase = supabaseRef.current;
    const { error } = await supabase
      .from("kanban_columns")
      .delete()
      .eq("id", c.id);
    if (error) {
      toast.error("Erro: " + error.message);
      return;
    }
    setColumns((prev) => prev.filter((x) => x.id !== c.id));
    setTasks((prev) =>
      prev.map((t) => (t.kanban_column_id === c.id ? { ...t, kanban_column_id: null } : t))
    );
    toast.success("Coluna excluída");
  }

  // ============================================================
  // Reordenar colunas (DnD via @dnd-kit/sortable)
  // ============================================================
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Pequeno threshold antes de iniciar o drag — evita iniciar drag em
      // cliques curtos no header (renomear, editar cor).
      activationConstraint: { distance: 6 }
    })
  );
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null);

  function onColumnDragStart(e: DragStartEvent) {
    setActiveColumnId(String(e.active.id));
  }

  async function onColumnDragEnd(e: DragEndEvent) {
    setActiveColumnId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = columns.findIndex((c) => c.id === active.id);
    const newIdx = columns.findIndex((c) => c.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const next = arrayMove(columns, oldIdx, newIdx).map((c, i) => ({
      ...c,
      ordem: i
    }));
    // Optimistic
    setColumns(next);
    // Persiste só o que mudou
    const changed = next.filter((c, i) => columns[i]?.id !== c.id || columns[i]?.ordem !== c.ordem);
    const supabase = supabaseRef.current;
    await Promise.all(
      changed.map((c) =>
        supabase
          .from("kanban_columns")
          .update({ ordem: c.ordem })
          .eq("id", c.id)
      )
    );
  }

  // ============================================================
  // Drag de tasks entre colunas
  // ============================================================
  function onTaskDragStart(taskId: string, e: React.DragEvent) {
    setDragTaskId(taskId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", taskId);
  }
  function onTaskDragEnd() {
    setDragTaskId(null);
    setDragOverColumnId(null);
  }
  function onColumnDragOver(columnId: string, e: React.DragEvent) {
    if (!dragTaskId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverColumnId !== columnId) setDragOverColumnId(columnId);
  }
  async function onColumnDrop(columnId: string, e: React.DragEvent) {
    e.preventDefault();
    const taskId = dragTaskId ?? e.dataTransfer.getData("text/plain");
    setDragOverColumnId(null);
    setDragTaskId(null);
    if (!taskId) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.kanban_column_id === columnId) return;
    // Optimistic
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, kanban_column_id: columnId } : t))
    );
    const supabase = supabaseRef.current;
    // `.select()` devolve a linha JÁ processada pelos triggers — inclusive
    // o status que a coluna define (coluna verde ⇒ concluída). Assim o card
    // reflete a conclusão na hora, sem duplicar a regra aqui no cliente.
    const { data, error } = await supabase
      .from("tasks")
      .update({ kanban_column_id: columnId })
      .eq("id", taskId)
      .select()
      .single();
    if (error) {
      toast.error("Erro: " + error.message);
      void load();
      return;
    }
    if (data) {
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? (data as Task) : t))
      );
    }
  }

  // ============================================================
  // Renderização
  // ============================================================
  // Usuários que aparecem em pelo menos uma task do projeto — reportados
  // pra fora pra montar o dropdown de filtro no header do ProjectView.
  const usersInProject = useMemo(() => {
    const ids = new Set<string>();
    for (const arr of assigneesByTask.values()) {
      for (const id of arr) ids.add(id);
    }
    return users.filter((u) => ids.has(u.id));
  }, [assigneesByTask, users]);

  useEffect(() => {
    onUsersInProjectChange?.(usersInProject);
  }, [usersInProject, onUsersInProjectChange]);

  const tasksByColumn = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      // Concluídas continuam aparecendo na coluna onde estão (geralmente
      // "Concluídas") — o card só fica visualmente diferente.
      if (filterAssigneeId) {
        const assignees = assigneesByTask.get(t.id) ?? [];
        if (!assignees.includes(filterAssigneeId)) continue;
      }
      const k = t.kanban_column_id ?? "_none";
      const arr = m.get(k) ?? [];
      arr.push(t);
      m.set(k, arr);
    }
    return m;
  }, [tasks, assigneesByTask, filterAssigneeId]);

  const orphanTasks = tasksByColumn.get("_none") ?? [];

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-fg-muted">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando kanban...
      </div>
    );
  }

  return (
    <>
      <div className="h-full flex flex-col">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onColumnDragStart}
          onDragEnd={onColumnDragEnd}
        >
          <SortableContext
            items={columns.map((c) => c.id)}
            strategy={horizontalListSortingStrategy}
          >
            <div className="flex flex-1 min-h-0 overflow-x-auto overflow-y-hidden gap-3 p-4 bg-bg-subtle/30">
            {columns.map((c) => (
              <SortableColumnWrapper key={c.id} columnId={c.id} active={activeColumnId === c.id}>
                {(handleProps) => {
                  const colTasks = tasksByColumn.get(c.id) ?? [];
                  const isDropTarget = dragOverColumnId === c.id;
                  return (
            <div
              onDragOver={(e) => {
                if (dragTaskId) onColumnDragOver(c.id, e);
              }}
              onDrop={(e) => {
                void onColumnDrop(c.id, e);
              }}
              className={`h-full min-h-0 flex flex-col rounded-xl bg-bg-subtle border ${
                isDropTarget ? "border-brand shadow-lg" : "border-border"
              } transition`}
            >
              <div
                className="flex items-center gap-2 px-3 py-2 border-b border-border rounded-t-xl"
                style={{ backgroundColor: c.cor + "1a" }}
              >
                {/* Único elemento draggable da coluna: o handle */}
                {canEditStructure && (
                  <span
                    ref={handleProps.ref}
                    {...handleProps.attributes}
                    {...handleProps.listeners}
                    title="Arraste para reordenar"
                    className="shrink-0 p-1 -m-1 cursor-grab active:cursor-grabbing touch-none select-none"
                  >
                    <GripVertical className="w-3.5 h-3.5 text-fg-subtle" />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setColorPickerColumnId(c.id)}
                  disabled={!canEditStructure}
                  className="w-3 h-3 rounded-full shrink-0 ring-1 ring-border hover:scale-110 transition"
                  style={{ backgroundColor: c.cor }}
                  title="Configurar coluna (cor e status)"
                />
                {editingColumnId === c.id ? (
                  <input
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => {
                      void renameColumn(c, editingName);
                      setEditingColumnId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void renameColumn(c, editingName);
                        setEditingColumnId(null);
                      } else if (e.key === "Escape") {
                        setEditingColumnId(null);
                      }
                    }}
                    className="flex-1 min-w-0 bg-bg border border-border rounded px-2 py-0.5 text-sm font-semibold focus:outline-none focus:border-brand"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingColumnId(c.id);
                      setEditingName(c.nome);
                    }}
                    className="flex-1 min-w-0 text-left text-sm font-semibold truncate hover:underline"
                    disabled={!canEditStructure}
                    title={canEditStructure ? "Clique para renomear" : undefined}
                  >
                    {c.nome}
                  </button>
                )}
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-muted text-fg-muted">
                  {colTasks.length}
                </span>
                {canEditStructure && (
                  <button
                    type="button"
                    onClick={() => deleteColumn(c)}
                    className="p-1 rounded text-fg-subtle hover:text-priority-urgent hover:bg-priority-urgent/10 transition"
                    title="Excluir coluna"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Configurações da coluna: cor + status ao mover */}
              {colorPickerColumnId === c.id && (
                <div className="px-3 py-2.5 border-b border-border bg-bg space-y-2.5">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-fg-subtle mb-1.5">
                      Cor
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {COLORS.map((col) => (
                        <button
                          key={col}
                          type="button"
                          onClick={() => void changeColumnColor(c, col)}
                          className={`w-5 h-5 rounded-full border-2 transition hover:scale-110 ${
                            c.cor === col ? "border-fg" : "border-transparent"
                          }`}
                          style={{ backgroundColor: col }}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-fg-subtle mb-1">
                      Ao mover um card para cá
                    </p>
                    <select
                      value={c.status_ao_mover ?? ""}
                      onChange={(e) =>
                        void changeColumnStatus(
                          c,
                          e.target.value === ""
                            ? null
                            : (e.target.value as TaskStatus)
                        )
                      }
                      className="w-full px-2 py-1.5 bg-bg-subtle border border-border rounded-md text-xs"
                    >
                      <option value="">Não alterar o status</option>
                      <option value="pendente">Marcar como Pendente</option>
                      <option value="em_andamento">Marcar como Em andamento</option>
                      <option value="em_revisao">Marcar como Em revisão</option>
                      <option value="travado">Marcar como Travado</option>
                      <option value="concluido">Marcar como Concluída</option>
                    </select>
                    <p className="text-[10px] text-fg-subtle mt-1 leading-snug">
                      {c.status_ao_mover
                        ? "Cards soltos aqui recebem esse status automaticamente."
                        : "Esta coluna é só organizacional — o status da tarefa não muda."}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setColorPickerColumnId(null)}
                    className="w-full text-[10px] text-fg-subtle hover:text-fg py-0.5"
                  >
                    fechar
                  </button>
                </div>
              )}

              {/* Lista de tasks */}
              <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
                {colTasks.map((t) => (
                  <KanbanCard
                    key={t.id}
                    task={t}
                    users={users}
                    assigneeIds={assigneesByTask.get(t.id) ?? []}
                    onOpen={() => setSelectedTask(t.id)}
                    onDragStart={(e) => onTaskDragStart(t.id, e)}
                    onDragEnd={onTaskDragEnd}
                    onDeleted={(id) => setTasks((prev) => prev.filter((x) => x.id !== id))}
                    isDragging={dragTaskId === t.id}
                  />
                ))}
                {colTasks.length === 0 && (
                  <p className="text-[11px] text-fg-subtle text-center py-3 italic">
                    Arraste tarefas aqui
                  </p>
                )}
              </div>

              {/* Criar task — abre o modal completo já na coluna certa */}
              <div className="p-2 border-t border-border bg-bg-subtle/60 rounded-b-xl">
                {/* Só aparece quando a tela liberou a criação (perfil com Criar). */}
                {onRequestCreate && (
                  <button
                    type="button"
                    onClick={() => onRequestCreate(c.id)}
                    className="w-full flex items-center justify-center gap-1.5 text-xs text-fg-muted hover:text-fg hover:bg-bg-muted py-1.5 rounded transition"
                  >
                    <Plus className="w-3 h-3" /> Adicionar tarefa
                  </button>
                )}
              </div>
            </div>
                  );
                }}
              </SortableColumnWrapper>
            ))}

        {/* Coluna "Sem coluna" (tasks órfãs) */}
        {orphanTasks.length > 0 && (
          <div
            onDragOver={(e) => onColumnDragOver("_none", e)}
            onDrop={(e) => void onColumnDrop("_none", e)}
            className="shrink-0 w-72 h-full min-h-0 flex flex-col rounded-xl bg-bg border border-dashed border-border"
          >
            <div className="px-3 py-2 border-b border-border">
              <p className="text-sm font-semibold text-fg-muted">Sem coluna</p>
              <p className="text-[10px] text-fg-subtle">
                Tarefas criadas no mapa que ainda não foram organizadas
              </p>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
              {orphanTasks.map((t) => (
                <KanbanCard
                  key={t.id}
                  task={t}
                  users={users}
                  assigneeIds={assigneesByTask.get(t.id) ?? []}
                  onOpen={() => setSelectedTask(t.id)}
                  onDragStart={(e) => onTaskDragStart(t.id, e)}
                  onDragEnd={onTaskDragEnd}
                  onDeleted={(id) => setTasks((prev) => prev.filter((x) => x.id !== id))}
                  isDragging={dragTaskId === t.id}
                />
              ))}
            </div>
          </div>
        )}

        {/* Botão "+ Adicionar coluna" no final — só admin */}
        {canEditStructure && (
          <button
            type="button"
            onClick={addColumn}
            className="shrink-0 w-72 self-start flex items-center justify-center gap-1.5 text-xs text-fg-muted hover:text-fg hover:bg-bg-muted bg-bg-subtle/30 border-2 border-dashed border-border hover:border-border-strong rounded-xl py-3 transition"
          >
            <Plus className="w-3.5 h-3.5" /> Adicionar coluna
          </button>
        )}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <TaskPanel
        taskId={selectedTask}
        onClose={() => setSelectedTask(null)}
        onDeleted={(id) => {
          // Remoção otimista — some do board na hora, sem precisar dar refresh.
          setTasks((prev) => prev.filter((x) => x.id !== id));
        }}
        onUpdated={async () => {
          // Patch cirúrgico pra quem editou ver a mudança IMEDIATAMENTE
          // (realtime cobre outros usuários mas tem latência de ~ms).
          // Atualiza a task E os responsáveis (avatares do card vêm do
          // Map de assignees, não do objeto task).
          if (!selectedTask) return;
          const supabase = supabaseRef.current;
          const [taskRes, assignRes] = await Promise.all([
            supabase
              .from("tasks")
              .select("*")
              .eq("id", selectedTask)
              .maybeSingle(),
            supabase
              .from("task_assignees")
              .select("user_id, primary_assignee")
              .eq("task_id", selectedTask)
          ]);
          if (taskRes.data) {
            setTasks((prev) =>
              prev.map((x) =>
                x.id === selectedTask ? (taskRes.data as Task) : x
              )
            );
          }
          const sorted = ((assignRes.data as TaskAssignee[]) ?? [])
            .slice()
            .sort(
              (a, b) =>
                Number(b.primary_assignee) - Number(a.primary_assignee)
            );
          setAssigneesByTask((prev) => {
            const m = new Map(prev);
            if (sorted.length > 0) {
              m.set(
                selectedTask,
                sorted.map((r) => r.user_id)
              );
            } else {
              m.delete(selectedTask);
            }
            return m;
          });
        }}
      />
    </>
  );
}

function KanbanCard({
  task,
  users,
  assigneeIds,
  onOpen,
  onDragStart,
  onDragEnd,
  isDragging,
  onDeleted
}: {
  task: Task;
  users: UserProfile[];
  assigneeIds: string[];
  onOpen: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  isDragging: boolean;
  onDeleted: (id: string) => void;
}) {
  const assignees = assigneeIds
    .map((id) => users.find((u) => u.id === id))
    .filter((u): u is UserProfile => !!u)
    .slice(0, 3);
  const extra = Math.max(0, assigneeIds.length - 3);
  const isDone = task.status === "concluido";
  // Arrastar muda o status; sem Editar o card não sai do lugar.
  const canEdit = useCan("tarefas", "edit");
  return (
    <div
      draggable={canEdit}
      onDragStart={canEdit ? onDragStart : undefined}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={`group bg-bg border rounded-lg p-2.5 cursor-pointer hover:shadow-sm transition ${
        isDone
          ? "border-status-done/40 bg-status-done/5 hover:border-status-done/60"
          : "border-border hover:border-border-strong"
      } ${isDragging ? "opacity-40" : ""}`}
    >
      <div className="flex items-start gap-1 mb-2">
        <p className="flex-1 min-w-0 text-xs font-medium leading-snug line-clamp-3">
          {task.titulo}
        </p>
        <TaskDeleteButton taskId={task.id} titulo={task.titulo} onDeleted={onDeleted} />
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <PriorityBadge value={task.prioridade as TaskPriority} />
        <PrazoBadge prazo={task.prazo} prazo_has_time={task.prazo_has_time} status={task.status as TaskStatus} size="sm" />
        <div className="flex items-center ml-auto -space-x-1.5">
          {assignees.length === 0 ? (
            <span className="text-[10px] text-fg-subtle inline-flex items-center gap-1">
              <UserIcon className="w-3 h-3" /> Sem responsável
            </span>
          ) : (
            <>
              {assignees.map((u) => (
                <span
                  key={u.id}
                  className="w-5 h-5 rounded-full bg-brand/20 text-brand flex items-center justify-center text-[8px] font-bold uppercase ring-2 ring-bg"
                  title={u.nome}
                >
                  {initials(u.nome)}
                </span>
              ))}
              {extra > 0 && (
                <span className="w-5 h-5 rounded-full bg-bg-muted text-fg-muted flex items-center justify-center text-[8px] font-bold ring-2 ring-bg">
                  +{extra}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Wrapper sortable: aplica os refs/styles do dnd-kit num container w-72
 * e expõe `attributes`+`listeners` como `handleProps` pra acoplar no grip.
 * Filhos recebem essas props via render prop.
 */
function SortableColumnWrapper({
  columnId,
  active,
  children
}: {
  columnId: string;
  active: boolean;
  children: (handleProps: {
    ref: (el: HTMLElement | null) => void;
    listeners: ReturnType<typeof useSortable>["listeners"];
    attributes: ReturnType<typeof useSortable>["attributes"];
  }) => React.ReactNode;
}) {
  // Reordenar colunas é editar a estrutura do projeto.
  const canEditStructure = useCan("projetos", "edit");
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: columnId, disabled: !canEditStructure });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`shrink-0 w-72 h-full flex flex-col min-h-0 ${
        active ? "z-10" : ""
      }`}
    >
      {children({
        ref: setActivatorNodeRef,
        listeners,
        attributes
      })}
    </div>
  );
}

