"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Kanban, List, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ensureProjects, ensureSectors, ensureUsers, snapshot } from "@/lib/cache";
import { Button } from "@/components/ui/button";
import { ProjectSwitcher } from "@/components/projects/project-switcher";
import { KanbanBoard } from "@/components/projects/kanban-board";
import { TaskListView } from "@/components/projects/task-list-view";
import { ResponsavelFilter } from "@/components/projects/responsavel-filter";
import { TaskCreateModal } from "@/components/projects/task-create-modal";
import { useCan } from "@/components/permissions/permissions-provider";
import type { Project, Sector, UserProfile } from "@/lib/types";

type ViewMode = "kanban" | "lista";

interface Props {
  projectId: string;
}

export function ProjectView({ projectId }: Props) {
  const router = useRouter();
  const cachedSnap = snapshot();
  // Se o projeto já está no cache `projects` (warmCache), renderiza imediato
  // SEM esperar nenhuma query — corta o "Carregando projeto..." inteiro.
  const projectFromCache =
    cachedSnap.projects.find((p) => p.id === projectId) ?? null;
  const [project, setProject] = useState<Project | null>(projectFromCache);
  const [projects, setProjects] = useState<Project[]>(cachedSnap.projects);
  const [users, setUsers] = useState<UserProfile[]>(cachedSnap.users);
  const [sectors, setSectors] = useState<Sector[]>(cachedSnap.sectors);
  // Só vira true se NÃO tiver projeto no cache — caso contrário UI já tá pronta.
  const [loading, setLoading] = useState(!projectFromCache);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "kanban";
    const saved = window.localStorage.getItem(`vf-view-${projectId}`);
    return saved === "lista" ? "lista" : "kanban";
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [createColumnId, setCreateColumnId] = useState<string | undefined>(
    undefined
  );
  const [filterAssigneeId, setFilterAssigneeId] = useState<string | null>(null);
  const [kanbanUsers, setKanbanUsers] = useState<UserProfile[]>([]);
  /** Bump pra forçar refetch nas views após criar uma task. */
  const [refreshKey, setRefreshKey] = useState(0);
  const canCreate = useCan("tarefas", "create");

  const loadShell = useCallback(async () => {
    const supabase = createClient();
    // Tudo do cache em paralelo. A query do projeto específico SÓ acontece
    // se ele não estiver na lista cacheada (raro — só quando recém-criado).
    const [prjs, us, secs] = await Promise.all([
      ensureProjects(),
      ensureUsers(),
      ensureSectors()
    ]);
    setProjects(prjs);
    setUsers(us);
    setSectors(secs);
    const cached = prjs.find((p) => p.id === projectId);
    if (cached) {
      setProject(cached);
      setLoading(false);
      return;
    }
    // Fallback: projeto não está na lista ativa (talvez arquivado).
    const { data: prj } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .maybeSingle();
    setProject((prj as Project) ?? null);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void loadShell();
  }, [loadShell]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`vf-view-${projectId}`, viewMode);
  }, [projectId, viewMode]);

  if (loading && !project) {
    // Fica em branco enquanto o Next.js ainda mostra o loading.tsx
    // (skeleton do Kanban). Sem texto pra evitar piscar duas mensagens.
    return null;
  }

  if (!project) {
    return (
      <div className="p-8 text-sm text-fg-muted flex flex-col items-start gap-3">
        <p>Projeto não encontrado ou sem acesso.</p>
        <button
          onClick={() => router.push("/projetos")}
          className="px-3 py-1.5 bg-bg-subtle border border-border rounded-md text-xs hover:border-border-strong"
        >
          ← Voltar para projetos
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-var(--topbar-h))]">
      {/* Header */}
      <header
        className="px-3 sm:px-6 py-3 border-b border-border bg-bg flex flex-wrap items-center gap-3 shrink-0"
        aria-label={`Projeto ${project.nome}`}
        style={
          project.cor ? { borderTopColor: project.cor, borderTopWidth: 3 } : undefined
        }
      >
        <div className="w-full min-w-0 sm:w-auto sm:max-w-full">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <button
              onClick={() => router.push("/projetos")}
              className="text-fg-subtle hover:text-fg p-1 rounded shrink-0"
              title="Voltar"
              aria-label="Voltar para projetos"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <ProjectSwitcher
              projects={projects.some((p) => p.id === projectId) ? projects : [project, ...projects]}
              currentId={projectId}
            />
            {canCreate && (
              <Button
                size="sm"
                className="shrink-0"
                onClick={() => {
                  setCreateColumnId(undefined);
                  setCreateOpen(true);
                }}
                title="Nova tarefa"
              >
                <Plus className="w-3.5 h-3.5" /> Tarefa
              </Button>
            )}
          </div>
          {project.descricao && (
            <p className="mt-1 pl-8 sm:pl-9 text-[11px] text-fg-subtle truncate" title={project.descricao}>
              {project.descricao}
            </p>
          )}
        </div>

        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
          {/* View tabs */}
          <div className="inline-flex bg-bg-subtle border border-border rounded-lg p-0.5 shadow-sm">
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

          {viewMode === "kanban" && kanbanUsers.length > 0 && (
            <ResponsavelFilter
              users={kanbanUsers}
              value={filterAssigneeId}
              onChange={setFilterAssigneeId}
              compact
            />
          )}

        </div>
      </header>

      {/* View */}
      <div className="flex-1 overflow-hidden">
        {viewMode === "kanban" ? (
          <KanbanBoard
            projectId={projectId}
            filterAssigneeId={filterAssigneeId}
            onUsersInProjectChange={setKanbanUsers}
            refreshKey={refreshKey}
            onRequestCreate={
              canCreate
                ? (columnId) => {
                    setCreateColumnId(columnId);
                    setCreateOpen(true);
                  }
                : undefined
            }
          />
        ) : (
          <TaskListView
            projectId={projectId}
            users={users}
            sectors={sectors}
            refreshKey={refreshKey}
          />
        )}
      </div>

      <TaskCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        projectId={projectId}
        users={users}
        sectors={sectors}
        defaultKanbanColumnId={createColumnId}
        onCreated={() => {
          setCreateOpen(false);
          setRefreshKey((k) => k + 1);
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
