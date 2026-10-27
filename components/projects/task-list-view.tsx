"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle, ListTodo, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { PrazoBadge } from "@/components/ui/prazo-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TaskPanel } from "@/components/side-panel/task-panel";
import { celebrate } from "@/lib/celebrate";
import { initials } from "@/lib/utils";
import type {
  Sector,
  Task,
  TaskPriority,
  TaskStatus,
  UserProfile
} from "@/lib/types";
import { useCan } from "@/components/permissions/permissions-provider";

interface Props {
  projectId: string;
  users: UserProfile[];
  sectors: Sector[];
  /** Bump pra re-load externo (ex: após o modal global criar uma task). */
  refreshKey?: number;
}

type SortKey = "titulo" | "prazo" | "prioridade" | "status" | "responsavel";

export function TaskListView({
  projectId,
  users,
  sectors,
  refreshKey
}: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [assignees, setAssignees] = useState<Map<string, string[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Filtros
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState<TaskStatus | "">("");
  const [filterPrior, setFilterPrior] = useState<TaskPriority | "">("");
  const [filterResp, setFilterResp] = useState<string>("");
  const [showCompleted, setShowCompleted] = useState(false);

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>("prazo");
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, refreshKey]);

  async function load() {
    setLoading(true);
    const supabase = createClient();
    const [tRes, aRes] = await Promise.all([
      supabase
        .from("tasks")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true }),
      supabase
        .from("task_assignees")
        .select("task_id, user_id")
    ]);
    const taskList = (tRes.data as Task[]) ?? [];
    setTasks(taskList);
    const map = new Map<string, string[]>();
    const taskIds = new Set(taskList.map((t) => t.id));
    for (const row of (aRes.data as Array<{
      task_id: string;
      user_id: string;
    }>) ?? []) {
      if (!taskIds.has(row.task_id)) continue;
      const arr = map.get(row.task_id) ?? [];
      arr.push(row.user_id);
      map.set(row.task_id, arr);
    }
    setAssignees(map);
    setLoading(false);
  }

  async function patchTask(id: string) {
    const supabase = createClient();
    // Task + responsáveis (avatares vêm do Map de assignees).
    const [taskRes, assignRes] = await Promise.all([
      supabase.from("tasks").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("task_assignees")
        .select("user_id, primary_assignee")
        .eq("task_id", id)
    ]);
    if (taskRes.data) {
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? (taskRes.data as Task) : t))
      );
    }
    const sorted = ((assignRes.data as Array<{
      user_id: string;
      primary_assignee: boolean;
    }>) ?? [])
      .slice()
      .sort((a, b) => Number(b.primary_assignee) - Number(a.primary_assignee));
    setAssignees((prev) => {
      const m = new Map(prev);
      if (sorted.length > 0) m.set(id, sorted.map((r) => r.user_id));
      else m.delete(id);
      return m;
    });
  }

  // Concluir ou reabrir é editar a tarefa: sem Editar, o botão fica travado.
  const canEdit = useCan("tarefas", "edit");

  async function toggleDone(t: Task, anchor: HTMLElement | null) {
    const next: TaskStatus = t.status === "concluido" ? "pendente" : "concluido";
    const rect = anchor?.getBoundingClientRect();
    const origin =
      rect && rect.width > 0
        ? {
            x: (rect.left + rect.width / 2) / window.innerWidth,
            y: (rect.top + rect.height / 2) / window.innerHeight
          }
        : null;
    setTasks((prev) =>
      prev.map((x) =>
        x.id === t.id
          ? {
              ...x,
              status: next,
              data_conclusao:
                next === "concluido" ? new Date().toISOString() : null
            }
          : x
      )
    );
    const supabase = createClient();
    const { error } = await supabase
      .from("tasks")
      .update({
        status: next,
        data_conclusao: next === "concluido" ? new Date().toISOString() : null
      })
      .eq("id", t.id);
    if (error) {
      setTasks((prev) =>
        prev.map((x) => (x.id === t.id ? { ...x, status: t.status } : x))
      );
      toast.error(error.message);
      return;
    }
    if (next === "concluido") celebrate(anchor, origin);
  }

  function userOf(id: string) {
    return users.find((u) => u.id === id);
  }
  function sectorOf(id: string | null | undefined) {
    if (!id) return null;
    return sectors.find((s) => s.id === id) ?? null;
  }

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(k);
      setSortDir(1);
    }
  }

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return tasks
      .filter((t) => {
        if (!showCompleted && t.status === "concluido") return false;
        if (filterStatus && t.status !== filterStatus) return false;
        if (filterPrior && t.prioridade !== filterPrior) return false;
        if (filterResp) {
          const arr = assignees.get(t.id) ?? [];
          if (
            t.responsavel_id !== filterResp &&
            !arr.includes(filterResp)
          )
            return false;
        }
        if (ql && !t.titulo.toLowerCase().includes(ql)) return false;
        return true;
      })
      .sort((a, b) => {
        const dir = sortDir;
        if (sortKey === "titulo") return a.titulo.localeCompare(b.titulo) * dir;
        if (sortKey === "prazo") {
          const av = a.prazo ? new Date(a.prazo).getTime() : Infinity;
          const bv = b.prazo ? new Date(b.prazo).getTime() : Infinity;
          return (av - bv) * dir;
        }
        if (sortKey === "prioridade") {
          const order: Record<TaskPriority, number> = {
            urgente: 0,
            alta: 1,
            media: 2,
            baixa: 3
          };
          return (order[a.prioridade] - order[b.prioridade]) * dir;
        }
        if (sortKey === "status") {
          const order: Record<TaskStatus, number> = {
            pendente: 0,
            em_andamento: 1,
            em_revisao: 2,
            travado: 3,
            concluido: 4
          };
          return (order[a.status] - order[b.status]) * dir;
        }
        if (sortKey === "responsavel") {
          const aname =
            userOf((assignees.get(a.id) ?? [])[0] ?? a.responsavel_id ?? "")
              ?.nome ?? "";
          const bname =
            userOf((assignees.get(b.id) ?? [])[0] ?? b.responsavel_id ?? "")
              ?.nome ?? "";
          return aname.localeCompare(bname) * dir;
        }
        return 0;
      });
  }, [
    tasks,
    q,
    filterStatus,
    filterPrior,
    filterResp,
    showCompleted,
    sortKey,
    sortDir,
    assignees
  ]);

  const respInProject = useMemo(() => {
    const ids = new Set<string>();
    for (const arr of assignees.values()) for (const u of arr) ids.add(u);
    for (const t of tasks) if (t.responsavel_id) ids.add(t.responsavel_id);
    return users.filter((u) => ids.has(u.id));
  }, [assignees, tasks, users]);


  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-4 py-2 border-b border-border bg-bg flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar tarefa..."
            className="w-full pl-7 pr-2 py-1.5 bg-bg-subtle border border-border rounded-md text-xs"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as TaskStatus | "")}
          className="px-2 py-1.5 bg-bg-subtle border border-border rounded-md text-xs"
        >
          <option value="">Todos status</option>
          <option value="pendente">Pendente</option>
          <option value="em_andamento">Em andamento</option>
          <option value="em_revisao">Em revisão</option>
          <option value="concluido">Concluído</option>
          <option value="travado">Travado</option>
        </select>
        <select
          value={filterPrior}
          onChange={(e) => setFilterPrior(e.target.value as TaskPriority | "")}
          className="px-2 py-1.5 bg-bg-subtle border border-border rounded-md text-xs"
        >
          <option value="">Todas prioridades</option>
          <option value="urgente">Urgente</option>
          <option value="alta">Alta</option>
          <option value="media">Média</option>
          <option value="baixa">Baixa</option>
        </select>
        <select
          value={filterResp}
          onChange={(e) => setFilterResp(e.target.value)}
          className="px-2 py-1.5 bg-bg-subtle border border-border rounded-md text-xs"
        >
          <option value="">Todos responsáveis</option>
          {respInProject.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nome}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1 text-xs text-fg-muted cursor-pointer">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(e) => setShowCompleted(e.target.checked)}
            className="w-3.5 h-3.5"
          />
          Mostrar concluídas
        </label>
        <span className="ml-auto text-xs text-fg-subtle">
          {filtered.length} de {tasks.length}
        </span>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="p-6 text-sm text-fg-muted">Carregando...</p>
        ) : filtered.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={ListTodo}
              title="Nenhuma tarefa"
              description={
                tasks.length === 0
                  ? "Crie a primeira tarefa para este projeto."
                  : "Nada corresponde aos filtros selecionados."
              }
            />
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-bg-subtle border-b border-border z-10">
              <tr className="text-left text-fg-muted">
                <th className="w-8 px-3 py-2"></th>
                <SortableTh
                  label="Status"
                  active={sortKey === "status"}
                  dir={sortDir}
                  onClick={() => toggleSort("status")}
                  className="w-32"
                />
                <SortableTh
                  label="Tarefa"
                  active={sortKey === "titulo"}
                  dir={sortDir}
                  onClick={() => toggleSort("titulo")}
                />
                <SortableTh
                  label="Responsável"
                  active={sortKey === "responsavel"}
                  dir={sortDir}
                  onClick={() => toggleSort("responsavel")}
                  className="w-36"
                />
                <SortableTh
                  label="Prazo"
                  active={sortKey === "prazo"}
                  dir={sortDir}
                  onClick={() => toggleSort("prazo")}
                  className="w-32"
                />
                <SortableTh
                  label="Prioridade"
                  active={sortKey === "prioridade"}
                  dir={sortDir}
                  onClick={() => toggleSort("prioridade")}
                  className="w-28"
                />
                <th className="px-3 py-2 w-28">Setor</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const done = t.status === "concluido";
                const aIds = assignees.get(t.id) ?? [];
                const respIds = aIds.length
                  ? aIds
                  : t.responsavel_id
                    ? [t.responsavel_id]
                    : [];
                const sec = sectorOf(t.sector_id);
                return (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className="border-b border-border hover:bg-bg-subtle/60 cursor-pointer group"
                  >
                    <td
                      className="px-3 py-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleDone(t, e.currentTarget as HTMLElement);
                        }}
                        disabled={!canEdit}
                        title={!canEdit ? "Seu perfil não permite alterar tarefas" : done ? "Reabrir" : "Concluir"}
                        className={`shrink-0 rounded-full p-0.5 transition hover:scale-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 ${
                          done
                            ? "text-status-done"
                            : "text-fg-subtle hover:text-status-done"
                        }`}
                      >
                        {done ? (
                          <CheckCircle2 className="w-4 h-4" />
                        ) : (
                          <Circle className="w-4 h-4" />
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge value={t.status} />
                    </td>
                    <td className="px-3 py-2 text-fg">
                      {t.titulo}
                    </td>
                    <td className="px-3 py-2">
                      {respIds.length === 0 ? (
                        <span className="inline-flex items-center gap-1 text-fg-subtle">
                          <Users className="w-3 h-3" /> —
                        </span>
                      ) : (
                        <div className="flex items-center -space-x-1.5">
                          {respIds.slice(0, 3).map((id) => {
                            const u = userOf(id);
                            if (!u) return null;
                            return (
                              <span
                                key={id}
                                className="w-5 h-5 rounded-full border-2 border-bg text-[9px] text-white font-semibold flex items-center justify-center"
                                style={{ backgroundColor: "#64748b" }}
                                title={u.nome}
                              >
                                {initials(u.nome)}
                              </span>
                            );
                          })}
                          {respIds.length > 3 && (
                            <span className="w-5 h-5 rounded-full border-2 border-bg bg-bg-muted text-[9px] text-fg-muted font-semibold flex items-center justify-center">
                              +{respIds.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <PrazoBadge
                        prazo={t.prazo}
                        prazo_has_time={t.prazo_has_time}
                        status={t.status}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <PriorityBadge value={t.prioridade} />
                    </td>
                    <td className="px-3 py-2 text-fg-muted">
                      {sec ? (
                        <span
                          className="inline-flex items-center gap-1.5"
                          title={sec.nome}
                        >
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: sec.cor }}
                          />
                          {sec.nome}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <TaskPanel
        taskId={selectedId}
        onClose={() => setSelectedId(null)}
        onDeleted={(id) => setTasks((prev) => prev.filter((t) => t.id !== id))}
        onUpdated={() => {
          if (selectedId) void patchTask(selectedId);
        }}
      />
    </div>
  );
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
  className
}: {
  label: string;
  active: boolean;
  dir: 1 | -1;
  onClick: () => void;
  className?: string;
}) {
  return (
    <th
      className={`px-3 py-2 cursor-pointer select-none hover:text-fg ${
        className ?? ""
      }`}
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && (
          <span className="text-fg-subtle">{dir === 1 ? "↑" : "↓"}</span>
        )}
      </span>
    </th>
  );
}
