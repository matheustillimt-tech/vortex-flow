"use client";

import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, Edit3, Layers, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { FormField, Input, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import type { Sector } from "@/lib/types";
import { useCan } from "@/components/permissions/permissions-provider";

const COLORS = [
  "#3b82f6", "#8b5cf6", "#10b981", "#ec4899",
  "#f97316", "#eab308", "#6366f1", "#06b6d4",
  "#64748b", "#ef4444", "#14b8a6", "#a855f7"
];

export function SectorsView({ headerless = false }: { headerless?: boolean } = {}) {
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"ativo" | "arquivado">("ativo");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Sector | null>(null);
  // Mesma regra do banco (migration 045): ações da aba Setores no perfil.
  const canCreate = useCan("configuracoes.setores", "create");
  const canEdit = useCan("configuracoes.setores", "edit");
  const canDelete = useCan("configuracoes.setores", "delete");

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("sectors")
      .select("*")
      .order("nome");
    if (error) toast.error(error.message);
    setSectors((data as Sector[]) ?? []);
    setLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }
  function openEdit(s: Sector) {
    setEditing(s);
    setModalOpen(true);
  }

  async function archive(s: Sector) {
    const supabase = createClient();
    const { error } = await supabase
      .from("sectors")
      .update({ status: "arquivado", archived_at: new Date().toISOString() })
      .eq("id", s.id);
    if (error) return toast.error(error.message);
    toast.success("Setor arquivado");
    void load();
  }

  async function restore(s: Sector) {
    const supabase = createClient();
    const { error } = await supabase
      .from("sectors")
      .update({ status: "ativo", archived_at: null })
      .eq("id", s.id);
    if (error) return toast.error(error.message);
    toast.success("Setor reativado");
    void load();
  }

  async function remove(s: Sector) {
    const supabase = createClient();
    const [{ count: tasksCount }, { count: projectsCount }] = await Promise.all([
      supabase
        .from("tasks")
        .select("*", { count: "exact", head: true })
        .eq("sector_id", s.id),
      supabase
        .from("projects")
        .select("*", { count: "exact", head: true })
        .eq("setor_principal_id", s.id)
    ]);
    if ((tasksCount ?? 0) > 0 || (projectsCount ?? 0) > 0) {
      toast.error(
        "Não é possível excluir: existem tarefas ou projetos vinculados. Arquive ou mova-os antes."
      );
      return;
    }
    if (!confirm(`Excluir definitivamente o setor "${s.nome}"?`)) return;
    const { error } = await supabase.from("sectors").delete().eq("id", s.id);
    if (error) return toast.error(error.message);
    toast.success("Setor excluído");
    void load();
  }

  const filtered = sectors.filter((s) => s.status === tab);

  return (
    <>
      {!headerless && (
        <PageHeader
          title="Setores"
          subtitle="Áreas da empresa. Cada setor pode ter cor, descrição e membros."
          actions={
            canCreate && (
              <Button onClick={openCreate}>
                <Plus className="w-4 h-4" /> Novo setor
              </Button>
            )
          }
        />
      )}
      {headerless && canCreate && (
        <div className="px-6 pt-4 flex items-center justify-end">
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4" /> Novo setor
          </Button>
        </div>
      )}

      <div className="px-6 pt-4">
        <div className="inline-flex bg-bg-subtle border border-border rounded-lg p-0.5">
          {(["ativo", "arquivado"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition ${
                tab === t
                  ? "bg-bg text-fg shadow-sm"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              {t === "ativo" ? "Ativos" : "Arquivados"}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {loading ? (
          <p className="text-sm text-fg-muted">Carregando...</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Layers}
            title={tab === "ativo" ? "Sem setores ainda" : "Nenhum setor arquivado"}
            description="Crie setores para organizar projetos, tarefas e responsáveis."
            action={
              tab === "ativo" && canCreate && (
                <Button onClick={openCreate}>
                  <Plus className="w-4 h-4" /> Criar primeiro setor
                </Button>
              )
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((s) => (
              <div
                key={s.id}
                className="group bg-bg-subtle border border-border rounded-2xl p-4 hover:border-border-strong transition relative overflow-hidden"
              >
                <div
                  className="absolute top-0 left-0 right-0 h-1"
                  style={{ backgroundColor: s.cor }}
                />
                <div className="flex items-start gap-2.5">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: s.cor + "22", color: s.cor }}
                  >
                    <Layers className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{s.nome}</p>
                    <p className="text-xs text-fg-muted line-clamp-2 mt-0.5">
                      {s.descricao || "Sem descrição"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 mt-3 opacity-0 group-hover:opacity-100 transition">
                  {canEdit && (
                    <button
                      onClick={() => openEdit(s)}
                      className="p-1.5 rounded-md hover:bg-bg-muted text-fg-muted hover:text-fg transition"
                      title="Editar"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {!canEdit ? null : tab === "ativo" ? (
                    <button
                      onClick={() => archive(s)}
                      className="p-1.5 rounded-md hover:bg-bg-muted text-fg-muted hover:text-fg transition"
                      title="Arquivar"
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => restore(s)}
                      className="p-1.5 rounded-md hover:bg-bg-muted text-fg-muted hover:text-fg transition"
                      title="Reativar"
                    >
                      <ArchiveRestore className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => remove(s)}
                      className="p-1.5 rounded-md hover:bg-priority-urgent/15 text-fg-muted hover:text-priority-urgent transition ml-auto"
                      title="Excluir"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <SectorModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        sector={editing}
        onSaved={() => {
          setModalOpen(false);
          void load();
        }}
      />
    </>
  );
}

function SectorModal({
  open,
  onClose,
  sector,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  sector: Sector | null;
  onSaved: () => void;
}) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [cor, setCor] = useState(COLORS[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setNome(sector?.nome ?? "");
      setDescricao(sector?.descricao ?? "");
      setCor(sector?.cor ?? COLORS[0]);
    }
  }, [open, sector]);

  async function save() {
    if (!nome.trim()) return toast.error("Nome é obrigatório");
    setSaving(true);
    const supabase = createClient();
    const payload = {
      nome: nome.trim(),
      descricao: descricao.trim() || null,
      cor
    };
    const { error } = sector
      ? await supabase.from("sectors").update(payload).eq("id", sector.id)
      : await supabase.from("sectors").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(sector ? "Setor atualizado" : "Setor criado");
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title={sector ? "Editar setor" : "Novo setor"}>
      <div className="space-y-4">
        <FormField label="Nome">
          <Input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex: Tráfego Pago"
            autoFocus
          />
        </FormField>
        <FormField label="Descrição">
          <Textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Para que serve este setor?"
          />
        </FormField>
        <FormField label="Cor">
          <div className="flex flex-wrap gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setCor(c)}
                className={`w-7 h-7 rounded-lg border-2 transition ${
                  cor === c ? "border-fg scale-110" : "border-transparent"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </FormField>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
