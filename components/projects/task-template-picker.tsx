"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, Sparkles, Star } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PriorityBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cloneTaskTemplate, listTaskTemplates } from "@/lib/task-templates";
import type { TaskPriority } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  targetProjectId: string;
  /** Para projetos SaaS — qual coluna do kanban receber a clonagem. */
  defaultKanbanColumnId?: string | null;
  /** Disparado após sucesso pra parente refrescar o que precisa. */
  onCloned: (newTaskId: string) => void;
}

interface TemplateRow {
  id: string;
  titulo: string;
  descricao: string | null;
  prioridade: TaskPriority;
  project_id: string | null;
  projects: { nome: string } | null;
}

export function TaskTemplatePicker({
  open,
  onClose,
  targetProjectId,
  defaultKanbanColumnId,
  onCloned
}: Props) {
  const [items, setItems] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [cloning, setCloning] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setLoading(true);
    listTaskTemplates()
      .then((data) => setItems(data as TemplateRow[]))
      .catch((e: unknown) =>
        toast.error(e instanceof Error ? e.message : "Falha ao carregar")
      )
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((t) => {
      const hay = [t.titulo, t.descricao, t.projects?.nome]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [items, search]);

  async function pick(t: TemplateRow) {
    setCloning(t.id);
    try {
      const newId = await cloneTaskTemplate(t.id, targetProjectId, {
        kanbanColumnId: defaultKanbanColumnId ?? null
      });
      toast.success(`"${t.titulo}" foi adicionada ao projeto.`);
      onCloned(newId);
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao clonar");
    } finally {
      setCloning(null);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Carregar de template"
      size="lg"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-brand-subtle/40 border border-brand/20 text-xs text-fg-muted">
          <Sparkles className="w-4 h-4 text-brand mt-0.5 shrink-0" />
          <p>
            Estes são as tarefas marcadas como template em outros projetos.
            Ao escolher uma, ela é <strong>clonada</strong> nesse projeto —
            com checklist, links e anexos. A original não é alterada.
          </p>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar template..."
            className="pl-8"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-fg-muted">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando...
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Star}
            title="Nenhum template ainda"
            description="Crie uma tarefa, abra o painel dela e ative a opção 'Usar como template'."
          />
        ) : filtered.length === 0 ? (
          <p className="text-center text-xs text-fg-muted py-6">
            Nenhum template corresponde à busca.
          </p>
        ) : (
          <ul className="max-h-[55vh] overflow-y-auto rounded-xl border border-border bg-bg divide-y divide-border">
            {filtered.map((t) => {
              const isCloning = cloning === t.id;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => void pick(t)}
                    disabled={isCloning || !!cloning}
                    className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-bg-muted/40 transition disabled:opacity-50"
                  >
                    <Star className="w-3.5 h-3.5 text-priority-medium fill-priority-medium/30 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{t.titulo}</p>
                      {t.descricao && (
                        <p className="text-[11px] text-fg-muted line-clamp-2 mt-0.5">
                          {t.descricao}
                        </p>
                      )}
                      <p className="text-[10px] text-fg-subtle mt-1">
                        de{" "}
                        <span className="text-fg">
                          {t.projects?.nome ?? "Projeto removido"}
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <PriorityBadge value={t.prioridade} />
                      {isCloning && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-fg-muted" />
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex justify-end pt-2 border-t border-border">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
