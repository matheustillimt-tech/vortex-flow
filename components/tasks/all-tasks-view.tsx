"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Kanban, List } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ensureProjects, ensureUsers, snapshot } from "@/lib/cache";
import { ResponsavelFilter } from "@/components/projects/responsavel-filter";
import { AllTasksKanban } from "@/components/tasks/all-tasks-kanban";
import { AllTasksList } from "@/components/tasks/all-tasks-list";
import { TaskPanel } from "@/components/side-panel/task-panel";
import { isOverdue } from "@/lib/utils";
import type { Project, Task, UserProfile } from "@/lib/types";

type ViewMode = "kanban" | "lista";
export type PrazoFilter =
  | "todos"
  | "atrasadas"
  | "hoje"
  | "semana"
  | "sem_prazo";

export function AllTasksView() {
  const supabaseRef = useRef(createClient());
  const snap = snapshot();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>(snap.projects);
  const [users, setUsers] = useState<UserProfile[]>(snap.users);
  const [assignees, setAssignees] = useState<Map<string, string[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "kanban";
    return window.localStorage.getItem("vf-alltasks-view") === "lista"
      ? "lista"
      : "kanban";
  });

  // Filtros
  const [filterResp, setFilterResp] = useState<string | null>(null);
  const [filterProject, setFilterProject] = useState<string>("");
  const [filterPrazo, setFilterPrazo] = useState<PrazoFilter>("todos");

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("vf-alltasks-view", viewMode);
    }
  }, [viewMode]);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = supabaseRef.current;
    const [tRes, aRes, prjList, uList] = await Promise.all([
      supabase
        .from("tasks")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase.from("task_assignees").select("task_id, user_id, primary_assignee"),
      ensureProjects(),
      ensureUsers()
    ]);
    const taskList = (tRes.data as Task[]) ?? [];
    setTasks(taskList);
    setProjects(prjList);
    setUsers(uList);

    const taskIds = new Set(taskList.map((t) => t.id));
    const m = new Map<string, string[]>();
    for (const r of (aRes.data as Array<{
      task_id: string;
      user_id: string;
      primary_assignee: boolean;
    }>) ?? []) {
      if (!taskIds.has(r.task_id)) continue;
      const arr = m.get(r.task_id) ?? [];
      if (r.primary_assignee) arr.unshift(r.user_id);
      else arr.push(r.user_id);
      m.set(r.task_id, arr);
    }
    setAssignees(m);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime: reflete mudanças de status/coluna/edições de qualquer projeto.
  const taskIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    taskIdsRef.current = new Set(tasks.map((t) => t.id));
  }, [tasks]);

  useEffect(() => {
    const supabase = supabaseRef.current;
    const ch = supabase
      .channel(`all-tasks:${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const t = payload.new as Task;
            setTasks((prev) =>
              prev.some((x) => x.id === t.id) ? prev : [t, ...prev]
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
          if (!taskId || !taskIdsRef.current.has(taskId)) return;
          const { data } = await supabase
            .from("task_assignees")
            .select("user_id, primary_assignee")
            .eq("task_id", taskId);
          const sorted = (
            (data as Array<{ user_id: string; primary_assignee: boolean }>) ??
            []
          )
            .slice()
            .sort(
              (a, b) =>
                Number(b.primary_assignee) - Number(a.primary_assignee)
            );
          setAssignees((prev) => {
            const m = new Map(prev);
            if (sorted.length > 0) m.set(taskId, sorted.map((r) => r.user_id));
            else m.delete(taskId);
            return m;
          });
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, []);

  // Usuários que aparecem em alguma task (pro filtro).
  const usersWithTasks = useMemo(() => {
    const ids = new Set<string>();
    for (const arr of assignees.values()) for (const u of arr) ids.add(u);
    for (const t of tasks) if (t.responsavel_id) ids.add(t.responsavel_id);
    return users.filter((u) => ids.has(u.id));
  }, [assignees, tasks, users]);

  // Projetos que têm pelo menos uma task (pro filtro).
  const projectsWithTasks = useMemo(() => {
    const ids = new Set(tasks.map((t) => t.project_id).filter(Boolean));
    return projects.filter((p) => ids.has(p.id));
  }, [projects, tasks]);

  const filtered = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekEnd = new Date(today);
    weekEnd.setDate(today.getDate() + 7);

    return tasks.filter((t) => {
      if (filterProject && t.project_id !== filterProject) return false;
      if (filterResp) {
        const arr = assignees.get(t.id) ?? [];
        if (t.responsavel_id !== filterResp && !arr.includes(filterResp))
          return false;
      }
      if (filterPrazo === "atrasadas" && !isOverdue(t.prazo, t.status))
        return false;
      if (filterPrazo === "sem_prazo" && t.prazo) return false;
      if (filterPrazo === "hoje") {
        if (!t.prazo) return false;
        const d = new Date(t.prazo);
        if (d.toDateString() !== today.toDateString()) return false;
      }
      if (filterPrazo === "semana") {
        if (!t.prazo) return false;
        const d = new Date(t.prazo);
        if (d < today || d > weekEnd) return false;
      }
      return true;
    });
  }, [tasks, filterProject, filterResp, filterPrazo, assignees]);

  const projectById = useMemo(() => {
    const m = new Map<string, Project>();
    for (const p of projects) m.set(p.id, p);
    return m;
  }, [projects]);

  async function patchTask(id: string) {
    const supabase = supabaseRef.current;
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
    const sorted = (
      (assignRes.data as Array<{ user_id: string; primary_assignee: boolean }>) ??
      []
    )
      .slice()
      .sort((a, b) => Number(b.primary_assignee) - Number(a.primary_assignee));
    setAssignees((prev) => {
      const m = new Map(prev);
      if (sorted.length > 0) m.set(id, sorted.map((r) => r.user_id));
      else m.delete(id);
      return m;
    });
  }

  // Otimista: usado pelo kanban ao arrastar (muda status).
  function patchStatusLocal(taskId: string, status: Task["status"]) {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status } : t))
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-var(--topbar-h))]">
      {/* Toolbar compacta com título inline — sem PageHeader gigante */}
      <div className="px-6 py-2 flex flex-wrap items-center gap-2 border-b border-border">
        <h1 className="text-sm font-semibold text-fg shrink-0 mr-1">
          Todas as tarefas
        </h1>
        <select
          value={filterProject}
          onChange={(e) => setFilterProject(e.target.value)}
          className="shrink-0 px-2 py-1.5 bg-bg-subtle border border-border rounded-md text-xs max-w-[180px]"
        >
          <option value="">Todos os projetos</option>
          {projectsWithTasks.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>

        {usersWithTasks.length > 0 && (
          <ResponsavelFilter
            users={usersWithTasks}
            value={filterResp}
            onChange={setFilterResp}
            compact
          />
        )}

        <select
          value={filterPrazo}
          onChange={(e) => setFilterPrazo(e.target.value as PrazoFilter)}
          className="shrink-0 px-2 py-1.5 bg-bg-subtle border border-border rounded-md text-xs"
        >
          <option value="todos">Qualquer prazo</option>
          <option value="atrasadas">Atrasadas</option>
          <option value="hoje">Vencem hoje</option>
          <option value="semana">Próximos 7 dias</option>
          <option value="sem_prazo">Sem prazo</option>
        </select>

        <span className="shrink-0 text-xs text-fg-subtle tabular-nums">
          {filtered.length} de {tasks.length}
        </span>

        <div className="ml-auto shrink-0 inline-flex bg-bg-subtle border border-border rounded-lg p-0.5 shadow-sm">
          <ViewTab
            active={viewMode === "kanban"}
            onClick={() => setViewMode("kanban")}
            icon={Kanban}
            label="Kanban"
          />
          <ViewTab
            active={viewMode === "lista"}
            onClick={() => setViewMode("lista")}
            icon={List}
            label="Lista"
          />
        </div>
      </div>

      {/* Conteúdo */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-fg-muted">Carregando tarefas...</p>
        ) : viewMode === "kanban" ? (
          <AllTasksKanban
            tasks={filtered}
            users={users}
            assignees={assignees}
            projectById={projectById}
            onOpenTask={setSelectedId}
            onOptimisticStatus={patchStatusLocal}
            onTaskDeleted={(id) => setTasks((prev) => prev.filter((t) => t.id !== id))}
          />
        ) : (
          <AllTasksList
            tasks={filtered}
            users={users}
            assignees={assignees}
            projectById={projectById}
            onOpenTask={setSelectedId}
          />
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

function ViewTab({
  active,
  onClick,
  icon: Icon,
  label
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${
        active ? "bg-bg text-fg shadow-sm" : "text-fg-muted hover:text-fg"
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}
