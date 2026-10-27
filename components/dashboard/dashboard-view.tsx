"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FolderKanban,
  ListTodo,
  Zap
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  ensureMe,
  ensureProjects,
  ensureSectors,
  ensureUsers,
  snapshot
} from "@/lib/cache";
import { PageHeader } from "@/components/ui/page-header";
import { PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { TaskPanel } from "@/components/side-panel/task-panel";
import { HealthCard } from "@/components/dashboard/health-card";
import { formatPrazo, isOverdue } from "@/lib/utils";
import type {
  Project,
  Sector,
  Task,
  UserProfile
} from "@/lib/types";

export function DashboardView() {
  const snap = snapshot();
  const [me, setMe] = useState<UserProfile | null>(snap.me);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>(snap.projects);
  const [sectors, setSectors] = useState<Sector[]>(snap.sectors);
  const [users, setUsers] = useState<UserProfile[]>(snap.users);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
  }, []);

  const [myAssignedIds, setMyAssignedIds] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    const supabase = createClient();
    // `me` (cache) precisa vir primeiro pra filtrar task_assignees pelo
    // user_id correto. ensureMe é instantâneo se já tá no cache.
    const profile = await ensureMe();
    if (!profile) {
      setLoading(false);
      return;
    }

    const [
      tasksRes,
      allTasksRes,
      projectsList,
      sectorsList,
      usersList,
      myAssignRes
    ] = await Promise.all([
      supabase
        .from("tasks")
        .select("*")
        .neq("status", "concluido")
        .order("prazo", { ascending: true, nullsFirst: false })
        .limit(200),
      supabase.from("tasks").select("id, status, prazo, prioridade"),
      ensureProjects(),
      ensureSectors(),
      ensureUsers(),
      supabase
        .from("task_assignees")
        .select("task_id")
        .eq("user_id", profile.id)
    ]);

    setMe(profile);
    setTasks((tasksRes.data as Task[]) ?? []);
    setAllTasks((allTasksRes.data as Task[]) ?? []);
    setProjects(projectsList);
    setSectors(sectorsList.filter((s) => s.status === "ativo"));
    setUsers(usersList);
    setMyAssignedIds(
      new Set(
        ((myAssignRes.data as Array<{ task_id: string }>) ?? []).map(
          (r) => r.task_id
        )
      )
    );
    setLoading(false);

    if (tasksRes.error) toast.error(tasksRes.error.message);
  }

  // Considera tanto responsavel_id (legado/principal) quanto task_assignees
  // (múltiplos responsáveis).
  const isMine = (t: Task) =>
    t.responsavel_id === me?.id || myAssignedIds.has(t.id);

  const myTasks = tasks.filter(isMine);
  // Os outros 3 cards do topo agora também são SOMENTE das minhas tarefas:
  const overdue = myTasks.filter((t) => isOverdue(t.prazo, t.status));
  const urgent = myTasks.filter(
    (t) => t.prioridade === "urgente" && t.status !== "concluido"
  );
  const inProgress = myTasks.filter((t) => t.status === "em_andamento");

  const userName = (id: string | null | undefined) =>
    users.find((u) => u.id === id)?.nome ?? "—";
  const projectName = (id: string | null | undefined) =>
    projects.find((p) => p.id === id)?.nome ?? "—";
  const sectorOf = (id: string | null | undefined) =>
    sectors.find((s) => s.id === id);

  return (
    <>
      <PageHeader
        title={`Olá, ${me?.nome?.split(" ")[0] ?? "time"}`}
        subtitle="Visão rápida do que está acontecendo agora."
      />

      <div className="p-6 space-y-6">
        <HealthCard tasks={allTasks} />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            icon={ListTodo}
            label="Minhas tarefas"
            value={myTasks.length}
            color="brand"
          />
          <StatCard
            icon={Clock}
            label="Em andamento"
            value={inProgress.length}
            color="blue"
          />
          <StatCard
            icon={AlertTriangle}
            label="Atrasadas"
            value={overdue.length}
            color="red"
          />
          <StatCard
            icon={Zap}
            label="Urgentes"
            value={urgent.length}
            color="orange"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-bg-subtle border border-border rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h2 className="font-medium text-sm">Minhas tarefas</h2>
              <span className="text-xs text-fg-subtle">
                {myTasks.length} item(s)
              </span>
            </div>
            {loading ? (
              <div className="p-8 text-center text-fg-muted text-sm">
                Carregando...
              </div>
            ) : myTasks.length === 0 ? (
              <div className="p-8 text-center text-fg-muted text-sm">
                Nenhuma tarefa atribuída a você. 🎉
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {myTasks.slice(0, 10).map((t) => {
                  const setor = sectorOf(t.sector_id);
                  const overdueFlag = isOverdue(t.prazo, t.status);
                  return (
                    <li key={t.id}>
                      <button
                        onClick={() => setSelectedTask(t.id)}
                        className="w-full text-left px-5 py-3 hover:bg-bg-muted/50 transition flex items-center gap-3"
                      >
                        {setor && (
                          <span
                            className="w-1 h-8 rounded-full shrink-0"
                            style={{ backgroundColor: setor.cor }}
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {t.titulo}
                          </p>
                          <p className="text-xs text-fg-subtle truncate">
                            {projectName(t.project_id)}
                            {setor && ` · ${setor.nome}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <PriorityBadge value={t.prioridade} />
                          <StatusBadge value={t.status} />
                          {t.prazo && (
                            <span
                              className={`text-xs ${overdueFlag ? "text-priority-urgent font-medium" : "text-fg-subtle"}`}
                            >
                              {formatPrazo(t.prazo, t.prazo_has_time)}
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="space-y-4">
            <div className="bg-bg-subtle border border-border rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border">
                <h2 className="font-medium text-sm flex items-center gap-2">
                  <FolderKanban className="w-4 h-4 text-fg-muted" />
                  Projetos ativos
                </h2>
              </div>
              {projects.length === 0 ? (
                <div className="p-5 text-center text-fg-muted text-xs">
                  Nenhum projeto ativo.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {projects.slice(0, 6).map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/projetos/${p.id}`}
                        className="flex items-center gap-2.5 px-5 py-2.5 hover:bg-bg-muted/50 transition"
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: p.cor }}
                        />
                        <span className="text-sm flex-1 truncate">{p.nome}</span>
                        <PriorityBadge value={p.prioridade} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {overdue.length > 0 && (
          <div className="bg-bg-subtle border border-border rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-priority-urgent" />
              <h2 className="font-medium text-sm">Tarefas atrasadas</h2>
              <span className="text-xs text-fg-subtle ml-auto">
                {overdue.length} item(s)
              </span>
            </div>
            <ul className="divide-y divide-border">
              {overdue.slice(0, 8).map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => setSelectedTask(t.id)}
                    className="w-full text-left px-5 py-3 hover:bg-bg-muted/50 transition flex items-center gap-3"
                  >
                    <CheckCircle2 className="w-4 h-4 text-priority-urgent shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{t.titulo}</p>
                      <p className="text-xs text-fg-subtle truncate">
                        {userName(t.responsavel_id)} ·{" "}
                        {projectName(t.project_id)}
                      </p>
                    </div>
                    <span className="text-xs text-priority-urgent font-medium">
                      {formatPrazo(t.prazo, t.prazo_has_time)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <TaskPanel
        taskId={selectedTask}
        onClose={() => setSelectedTask(null)}
        onUpdated={load}
      />
    </>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: "brand" | "blue" | "red" | "orange";
}) {
  const colorMap = {
    brand: "text-brand bg-brand/10",
    blue: "text-blue-400 bg-blue-500/10",
    red: "text-priority-urgent bg-red-500/10",
    orange: "text-priority-high bg-orange-500/10"
  };
  return (
    <div className="bg-bg-subtle border border-border rounded-2xl p-4 flex items-center gap-3">
      <div
        className={`w-10 h-10 rounded-xl flex items-center justify-center ${colorMap[color]}`}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-xs text-fg-muted">{label}</p>
        <p className="text-xl font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  );
}
