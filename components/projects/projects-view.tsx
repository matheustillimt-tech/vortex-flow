"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  Copy,
  Edit3,
  FolderKanban,
  Plus,
  Trash2,
  ChevronRight
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  ensureProjects,
  ensureSectors,
  ensureUsers,
  invalidate,
  snapshot
} from "@/lib/cache";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PriorityBadge } from "@/components/ui/badge";
import { ProjectModal } from "@/components/projects/project-modal";
import { formatDate } from "@/lib/utils";
import {
  PROJECT_STATUS_LABEL,
  type Project,
  type ProjectStatus,
  type Sector,
  type UserProfile
} from "@/lib/types";
import { useCan } from "@/components/permissions/permissions-provider";

export function ProjectsView() {
  const router = useRouter();
  const snap = snapshot();
  const [projects, setProjects] = useState<Project[]>(snap.projects);
  const [sectors, setSectors] = useState<Sector[]>(snap.sectors);
  const [users, setUsers] = useState<UserProfile[]>(snap.users);
  const [counts, setCounts] = useState<Record<string, { pendentes: number; atrasadas: number; total: number }>>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ProjectStatus | "todos">("ativo");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  // O banco (migration 045) recusa o que o perfil não permite; aqui a tela
  // deixa de oferecer. Arquivar e restaurar são reversíveis: contam como editar.
  const canCreate = useCan("projetos", "create");
  const canEdit = useCan("projetos", "edit");
  const canDelete = useCan("projetos", "delete");

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    const supabase = createClient();
    // Esta lista precisa de TODOS os projetos (inclui arquivados pra aba
    // "Todos") — não usa ensureProjects que filtra por ativo. Mas o cache
    // de ativos é populado de quebra ao salvar/arquivar.
    const [pRes, sList, uList, tRes] = await Promise.all([
      supabase
        .from("projects")
        .select("*")
        .order("updated_at", { ascending: false }),
      ensureSectors(),
      ensureUsers(),
      supabase.from("tasks").select("id, project_id, status, prazo")
    ]);

    const newCounts: Record<string, { pendentes: number; atrasadas: number; total: number }> = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const t of (tRes.data ?? []) as Array<{ id: string; project_id: string | null; status: string; prazo: string | null }>) {
      if (!t.project_id) continue;
      const c = newCounts[t.project_id] ?? { pendentes: 0, atrasadas: 0, total: 0 };
      c.total++;
      if (t.status !== "concluido") c.pendentes++;
      if (t.prazo && t.status !== "concluido" && new Date(t.prazo) < today) c.atrasadas++;
      newCounts[t.project_id] = c;
    }
    setCounts(newCounts);
    setProjects((pRes.data as Project[]) ?? []);
    setSectors(sList);
    setUsers(uList);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    if (tab === "todos") return projects;
    return projects.filter((p) => p.status === tab);
  }, [projects, tab]);

  async function archive(p: Project) {
    const supabase = createClient();
    const { error } = await supabase
      .from("projects")
      .update({ status: "arquivado", archived_at: new Date().toISOString() })
      .eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("Projeto arquivado");
    void load();
  }
  async function restore(p: Project) {
    const supabase = createClient();
    const { error } = await supabase
      .from("projects")
      .update({ status: "ativo", archived_at: null })
      .eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("Projeto reativado");
    void load();
  }
  async function duplicate(p: Project) {
    const supabase = createClient();
    const { error } = await supabase.from("projects").insert({
      nome: p.nome + " (cópia)",
      descricao: p.descricao,
      setor_principal_id: p.setor_principal_id,
      responsavel_id: p.responsavel_id,
      status: "ativo",
      prioridade: p.prioridade,
      cor: p.cor,
      tags: p.tags
    });
    if (error) return toast.error(error.message);
    toast.success("Projeto duplicado");
    void load();
  }
  async function remove(p: Project) {
    const c = counts[p.id];
    if (c && c.total > 0) {
      toast.error(
        "Não é possível excluir: existem tarefas vinculadas. Arquive o projeto."
      );
      return;
    }
    if (!confirm(`Excluir definitivamente "${p.nome}"?`)) return;
    const supabase = createClient();
    const { error } = await supabase.from("projects").delete().eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("Projeto excluído");
    void load();
  }

  return (
    <>
      <PageHeader
        title="Projetos"
        subtitle="Customizáveis. Arquive em vez de excluir quando houver histórico."
        actions={
          canCreate && (
            <Button
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
            >
              <Plus className="w-4 h-4" /> Novo projeto
            </Button>
          )
        }
      />

      <div className="px-6 pt-4">
        <div className="inline-flex bg-bg-subtle border border-border rounded-lg p-0.5">
          {(["ativo", "arquivado", "todos"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition ${
                tab === t
                  ? "bg-bg text-fg shadow-sm"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              {t === "todos"
                ? "Todos"
                : PROJECT_STATUS_LABEL[t as ProjectStatus] + "s"}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {loading ? (
          <p className="text-sm text-fg-muted">Carregando...</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="Nenhum projeto"
            description="Crie projetos para começar a organizar mapas mentais e tarefas."
            action={
              canCreate && (
                <Button
                  onClick={() => {
                    setEditing(null);
                    setModalOpen(true);
                  }}
                >
                  <Plus className="w-4 h-4" /> Criar projeto
                </Button>
              )
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((p) => {
              const setor = sectors.find((s) => s.id === p.setor_principal_id);
              const resp = users.find((u) => u.id === p.responsavel_id);
              const c = counts[p.id];
              return (
                <div
                  key={p.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => router.push(`/projetos/${p.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(`/projetos/${p.id}`);
                    }
                  }}
                  className="group bg-bg-subtle border border-border rounded-2xl overflow-hidden hover:border-border-strong hover:shadow-md transition relative cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand/30"
                >
                  <div
                    className="h-1"
                    style={{ backgroundColor: p.cor }}
                  />
                  <div className="p-4">
                    <div className="flex items-start gap-2">
                      <p className="flex-1 min-w-0 font-semibold truncate">
                        {p.nome}
                      </p>
                      <PriorityBadge value={p.prioridade} />
                    </div>
                    <p className="text-xs text-fg-muted mt-1 line-clamp-2 min-h-[2rem]">
                      {p.descricao || "Sem descrição"}
                    </p>

                    <div className="flex items-center gap-2 mt-3 text-xs text-fg-subtle">
                      {setor && (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: setor.cor + "20", color: setor.cor }}
                        >
                          {setor.nome}
                        </span>
                      )}
                      <span>{PROJECT_STATUS_LABEL[p.status]}</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                      <Metric label="Pendentes" value={c?.pendentes ?? 0} />
                      <Metric label="Atrasadas" value={c?.atrasadas ?? 0} danger={!!c?.atrasadas} />
                      <Metric label="Prazo" value={formatDate(p.prazo)} small />
                    </div>

                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                      <p className="text-xs text-fg-subtle truncate">
                        {resp?.nome ?? "Sem responsável"}
                      </p>
                      <div
                        className="flex items-center gap-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {canEdit && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditing(p);
                              setModalOpen(true);
                            }}
                            className="p-1.5 rounded-md hover:bg-bg-muted text-fg-muted hover:text-fg transition"
                            title="Editar"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {/* Duplicar cria um projeto novo. */}
                        {canCreate && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              duplicate(p);
                            }}
                            className="p-1.5 rounded-md hover:bg-bg-muted text-fg-muted hover:text-fg transition"
                            title="Duplicar"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {!canEdit ? null : p.status === "arquivado" ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              restore(p);
                            }}
                            className="p-1.5 rounded-md hover:bg-bg-muted text-fg-muted hover:text-fg transition"
                            title="Reativar"
                          >
                            <ArchiveRestore className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              archive(p);
                            }}
                            className="p-1.5 rounded-md hover:bg-bg-muted text-fg-muted hover:text-fg transition"
                            title="Arquivar"
                          >
                            <Archive className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              remove(p);
                            }}
                            className="p-1.5 rounded-md hover:bg-priority-urgent/15 text-fg-muted hover:text-priority-urgent transition"
                            title="Excluir"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <ChevronRight className="w-4 h-4 text-fg-subtle group-hover:text-brand group-hover:translate-x-0.5 transition ml-1" />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ProjectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        project={editing}
        sectors={sectors}
        users={users}
        onSaved={() => {
          setModalOpen(false);
          invalidate("projects");
          void load();
        }}
      />
    </>
  );
}

function Metric({
  label,
  value,
  danger,
  small
}: {
  label: string;
  value: string | number;
  danger?: boolean;
  small?: boolean;
}) {
  return (
    <div className="bg-bg border border-border rounded-lg px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-wider text-fg-subtle">
        {label}
      </p>
      <p
        className={`font-semibold ${danger ? "text-priority-urgent" : ""} ${small ? "text-xs" : "text-sm"}`}
      >
        {value}
      </p>
    </div>
  );
}
