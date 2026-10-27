"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Circle, ListTodo, User } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { ensureMe, ensureProjects, ensureSectors, snapshot } from "@/lib/cache";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { PrazoBadge } from "@/components/ui/prazo-badge";
import { TaskPanel } from "@/components/side-panel/task-panel";
import { isOverdue } from "@/lib/utils";
import { celebrate } from "@/lib/celebrate";
import type {
  Project,
  Sector,
  Task,
  TaskPriority,
  TaskStatus,
  UserProfile
} from "@/lib/types";
import { useCan } from "@/components/permissions/permissions-provider";

type Filter =
  | "todas"
  | "hoje"
  | "semana"
  | "atrasadas"
  | "urgentes"
  | "concluidas";

export function MyAreaView() {
  const snap = snapshot();
  const [me, setMe] = useState<UserProfile | null>(snap.me);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>(snap.projects);
  const [sectors, setSectors] = useState<Sector[]>(snap.sectors);
  const [filter, setFilter] = useState<Filter>("todas");
  const [filterPrior, setFilterPrior] = useState<TaskPriority | "">("");
  const [filterStatus, setFilterStatus] = useState<TaskStatus | "">("");
  const [filterSetor, setFilterSetor] = useState<string>("");
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    void load();
  }, []);

  // Deep-link: ?task=<id> abre o painel direto (vindo da notificação)
  useEffect(() => {
    const tid = searchParams.get("task");
    if (tid) {
      setSelectedTask(tid);
      // limpa a URL para não reabrir em refreshes
      router.replace(pathname, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function load() {
    setLoading(true);
    const supabase = createClient();
    // `me` vem do cache (warmCache no Sidebar) — quase sempre instantâneo.
    const profile = await ensureMe();
    if (!profile) {
      setLoading(false);
      return;
    }
    setMe(profile);
    // Tudo em paralelo (4 chamadas → 1 round-trip)
    const [aRes, tRes, pRes, sRes] = await Promise.all([
      supabase
        .from("task_assignees")
        .select("task_id")
        .eq("user_id", profile.id),
      supabase
        .from("tasks")
        .select("*")
        .eq("responsavel_id", profile.id),
      ensureProjects(),
      ensureSectors()
    ]);
    const assignedIds = new Set(
      ((aRes.data as Array<{ task_id: string }>) ?? []).map((r) => r.task_id)
    );
    // Se há assignees, busca também as tasks onde sou assignee (mas não
    // dono). Só dispara quando necessário.
    let allTasks = (tRes.data as Task[]) ?? [];
    if (assignedIds.size > 0) {
      const missing = Array.from(assignedIds).filter(
        (id) => !allTasks.some((t) => t.id === id)
      );
      if (missing.length > 0) {
        const { data: more } = await supabase
          .from("tasks")
          .select("*")
          .in("id", missing);
        allTasks = allTasks.concat((more as Task[]) ?? []);
      }
    }
    setTasks(allTasks);
    setProjects(pRes);
    setSectors(sRes);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekEnd = new Date(today);
    weekEnd.setDate(today.getDate() + 7);
    return tasks.filter((t) => {
      if (filterPrior && t.prioridade !== filterPrior) return false;
      if (filterSetor && t.sector_id !== filterSetor) return false;

      const isDone = t.status === "concluido";
      // Regra global: por padrão tarefas concluídas NÃO aparecem.
      // Só aparecem quando o filtro "Concluídas" está ativo (ou quando
      // o usuário escolheu manualmente status=concluído no select).
      if (filter !== "concluidas" && filterStatus !== "concluido" && isDone) {
        return false;
      }
      if (filterStatus && t.status !== filterStatus) return false;

      if (filter === "todas") return true;
      if (filter === "concluidas") return isDone;
      if (filter === "hoje") {
        if (!t.prazo) return false;
        const d = new Date(t.prazo);
        return d.toDateString() === today.toDateString();
      }
      if (filter === "semana") {
        if (!t.prazo) return false;
        const d = new Date(t.prazo);
        return d >= today && d <= weekEnd;
      }
      if (filter === "atrasadas") return isOverdue(t.prazo, t.status);
      if (filter === "urgentes")
        return t.prioridade === "urgente" && t.status !== "concluido";
      return true;
    });
  }, [tasks, filter, filterPrior, filterStatus, filterSetor]);

  const projectName = (id: string | null | undefined) =>
    projects.find((p) => p.id === id)?.nome ?? "—";
  const sectorOf = (id: string | null | undefined) =>
    sectors.find((s) => s.id === id);

  // Concluir ou reabrir é editar a tarefa: sem Editar, o botão fica travado.
  const canEdit = useCan("tarefas", "edit");

  async function toggleDone(t: Task, anchor: HTMLElement | null) {
    const next: TaskStatus = t.status === "concluido" ? "pendente" : "concluido";
    // Captura posição AGORA — a linha vai sumir antes do await terminar
    // (concluída sai da lista por padrão), então o anchor estaria detached.
    const rect = anchor?.getBoundingClientRect();
    const origin =
      rect && rect.width > 0
        ? {
            x: (rect.left + rect.width / 2) / window.innerWidth,
            y: (rect.top + rect.height / 2) / window.innerHeight
          }
        : null;
    // Optimistic UI
    setTasks((prev) =>
      prev.map((x) =>
        x.id === t.id
          ? {
              ...x,
              status: next,
              data_conclusao: next === "concluido" ? new Date().toISOString() : null
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
      // Rollback
      setTasks((prev) =>
        prev.map((x) => (x.id === t.id ? { ...x, status: t.status } : x))
      );
      toast.error(error.message);
      return;
    }
    if (next === "concluido") {
      // Passa o anchor (ainda no DOM no momento do clique) OU coords salvas
      celebrate(anchor, origin);
    }
  }

  return (
    <>
      <PageHeader
        title="Minhas Tarefas"
        subtitle={
          me ? `${me.nome} · ${me.cargo || me.role}` : "Minhas atribuições"
        }
      />

      <div className="px-6 pt-4 flex flex-wrap items-center gap-2">
        {(
          [
            "todas",
            "hoje",
            "semana",
            "atrasadas",
            "urgentes",
            "concluidas"
          ] as Filter[]
        ).map((f) => {
          const isDone = f === "concluidas";
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition border ${
                filter === f
                  ? isDone
                    ? "bg-status-done text-white border-status-done"
                    : "bg-brand text-white border-brand"
                  : "bg-bg-subtle border-border text-fg-muted hover:text-fg"
              }`}
            >
              {isDone ? "Concluídas" : f[0].toUpperCase() + f.slice(1)}
            </button>
          );
        })}
        <div className="w-px h-5 bg-border mx-1" />
        <select
          value={filterPrior}
          onChange={(e) => setFilterPrior(e.target.value as TaskPriority | "")}
          className="px-2.5 py-1 bg-bg-subtle border border-border rounded-md text-xs"
        >
          <option value="">Prioridade</option>
          <option value="urgente">Urgente</option>
          <option value="alta">Alta</option>
          <option value="media">Média</option>
          <option value="baixa">Baixa</option>
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as TaskStatus | "")}
          className="px-2.5 py-1 bg-bg-subtle border border-border rounded-md text-xs"
        >
          <option value="">Status</option>
          <option value="pendente">Pendente</option>
          <option value="em_andamento">Em andamento</option>
          <option value="em_revisao">Em revisão</option>
          <option value="concluido">Concluído</option>
          <option value="travado">Travado</option>
        </select>
        <select
          value={filterSetor}
          onChange={(e) => setFilterSetor(e.target.value)}
          className="px-2.5 py-1 bg-bg-subtle border border-border rounded-md text-xs"
        >
          <option value="">Setor</option>
          {sectors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nome}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-fg-subtle">
          {filtered.length} item(s)
        </span>
      </div>

      <div className="p-6">
        {loading ? (
          <p className="text-sm text-fg-muted">Carregando...</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ListTodo}
            title="Nada por aqui"
            description="Não há tarefas correspondentes aos filtros selecionados."
          />
        ) : (
          <div className="bg-bg-subtle border border-border rounded-2xl overflow-hidden">
            <ul className="divide-y divide-border">
              {filtered.map((t) => {
                const setor = sectorOf(t.sector_id);
                const done = t.status === "concluido";
                return (
                  <li key={t.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedTask(t.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedTask(t.id);
                        }
                      }}
                      className="w-full cursor-pointer text-left px-5 py-3 hover:bg-bg-muted/50 transition flex items-center gap-3"
                    >
                      {setor && (
                        <span
                          className="w-1 h-8 rounded-full shrink-0"
                          style={{ backgroundColor: setor.cor }}
                        />
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleDone(t, e.currentTarget as HTMLElement);
                        }}
                        disabled={!canEdit}
                        title={!canEdit ? "Seu perfil não permite alterar tarefas" : done ? "Marcar como pendente" : "Concluir tarefa"}
                        className={`shrink-0 rounded-full p-0.5 transition hover:scale-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 ${
                          done
                            ? "text-status-done"
                            : "text-fg-subtle hover:text-status-done"
                        }`}
                      >
                        {done ? (
                          <CheckCircle2 className="w-5 h-5" />
                        ) : (
                          <Circle className="w-5 h-5" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {t.titulo}
                        </p>
                        <p className="text-xs text-fg-subtle truncate">
                          {projectName(t.project_id)}
                          {setor && ` · ${setor.nome}`}
                        </p>
                      </div>
                      <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                        <PriorityBadge value={t.prioridade} />
                        <StatusBadge value={t.status} />
                      </div>
                      <PrazoBadge
                        prazo={t.prazo}
                        prazo_has_time={t.prazo_has_time}
                        status={t.status}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <TaskPanel
        taskId={selectedTask}
        onClose={() => setSelectedTask(null)}
        onUpdated={async () => {
          // Em vez de reload completo (que pisca a lista inteira), patcha
          // só a task editada na lista local.
          if (!selectedTask) return;
          const supabase = createClient();
          const { data } = await supabase
            .from("tasks")
            .select("*")
            .eq("id", selectedTask)
            .maybeSingle();
          if (data) {
            setTasks((prev) =>
              prev.map((t) => (t.id === selectedTask ? (data as Task) : t))
            );
          }
        }}
      />
    </>
  );
}
