"use client";

import { useEffect, useMemo, useState } from "react";
import { FolderKanban, Search } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Project, UserProfile } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  user: UserProfile | null;
}

/**
 * Modal para o admin definir quais projetos um membro pode ver.
 * - Lista vazia (nenhum marcado) = SEM restrição (vê tudo).
 * - Lista preenchida = vê apenas os projetos marcados.
 */
export function ProjectAccessModal({ open, onClose, user }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !user) return;
    const userId = user.id;
    let cancelled = false;
    const controller = new AbortController();
    setSearch("");
    setProjects([]);
    setSelected(new Set());
    setLoadedUserId(null);
    setLoadError(null);
    setLoading(true);
    void (async () => {
      try {
        const supabase = createClient();
        // Inclui arquivados: permissões existentes não podem ficar invisíveis.
        const [{ data: ps, error }, res] = await Promise.all([
          supabase.from("projects").select("*").order("nome"),
          fetch(`/api/admin/usuarios/${userId}/projects`, { signal: controller.signal })
        ]);
        if (error) throw new Error("Não foi possível carregar a lista de projetos.");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Falha ao carregar permissões");
        if (!Array.isArray(json.project_ids) || !json.project_ids.every((id: unknown) => typeof id === "string")) {
          throw new Error("Resposta inválida ao carregar permissões.");
        }
        if (cancelled) return;
        setProjects((ps as Project[]) ?? []);
        setSelected(new Set(json.project_ids));
        setLoadedUserId(userId);
      } catch (err: unknown) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Erro ao carregar permissões";
        setLoadError(message);
        toast.error(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; controller.abort(); };
    // A carga pertence ao ID, não à referência do perfil.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.id]);

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function clearAll() {
    setSelected(new Set());
  }

  function selectAll() {
    setSelected(new Set(projects.map((p) => p.id)));
  }

  async function save() {
    if (!user || saving || loading || loadedUserId !== user.id || loadError) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/usuarios/${user.id}/projects`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_ids: Array.from(selected) })
      });
      const json = (await res.json()) as {
        ok?: boolean;
        restricted?: boolean;
        count?: number;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Falha ao salvar");
      }
      toast.success(
        json.restricted
          ? `${user.nome} agora vê apenas ${json.count} projeto(s).`
          : `${user.nome} agora tem acesso a TODOS os projetos.`
      );
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) =>
      [p.nome, p.descricao].filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }, [projects, search]);

  const unrestricted = selected.size === 0;
  const ready = !!user && loadedUserId === user.id && !loading && !loadError;
  const controlsDisabled = !ready || saving || user?.role === "admin";

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title={`Acesso a projetos · ${user?.nome ?? ""}`}
      size="lg"
    >
      <div className="space-y-4">
        <div
          className={`p-3 rounded-xl border text-xs ${
            unrestricted
              ? "bg-status-done/10 border-status-done/30 text-status-done"
              : "bg-status-progress/10 border-status-progress/30 text-status-progress"
          }`}
        >
          {loadError ? (
            <p role="alert">{loadError} Feche e abra novamente para tentar carregar.</p>
          ) : !ready ? (
            <>Carregando permissões...</>
          ) : user?.role === "admin" ? (
            <>Administradores sempre têm acesso a todos os projetos.</>
          ) : unrestricted ? (
            <>
              <strong>Acesso total:</strong> sem nenhum projeto marcado, este
              membro vê todos os projetos atuais e futuros.
            </>
          ) : (
            <>
              <strong>Restrito:</strong> este membro vai ver APENAS os{" "}
              {selected.size} projeto(s) marcado(s) — todos os outros ficam
              invisíveis para ele.
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar projeto..."
              className="pl-8"
              disabled={controlsDisabled}
            />
          </div>
          <button
            type="button"
            onClick={clearAll}
            disabled={controlsDisabled}
            className="text-xs text-fg-muted hover:text-fg px-2 py-1.5 rounded hover:bg-bg-muted"
            title="Liberar todos (sem restrições)"
          >
            Liberar tudo
          </button>
          <button
            type="button"
            onClick={selectAll}
            disabled={controlsDisabled}
            className="text-xs text-fg-muted hover:text-fg px-2 py-1.5 rounded hover:bg-bg-muted"
          >
            Marcar todos
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto rounded-xl border border-border bg-bg divide-y divide-border">
          {loading ? (
            <p className="p-6 text-center text-xs text-fg-muted">
              Carregando...
            </p>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-center text-xs text-fg-muted">
              Nenhum projeto encontrado.
            </p>
          ) : (
            filtered.map((p) => {
              const checked = selected.has(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  disabled={controlsDisabled}
                  aria-pressed={checked}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition ${
                    checked
                      ? "bg-brand-subtle/30 text-fg"
                      : "hover:bg-bg-muted text-fg-muted"
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                      checked
                        ? "bg-brand border-brand text-white"
                        : "border-border"
                    }`}
                  >
                    {checked && (
                      <svg
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="w-3 h-3"
                      >
                        <path d="M16.7 5.3a1 1 0 010 1.4l-7 7a1 1 0 01-1.4 0l-3-3a1 1 0 011.4-1.4L9 11.6l6.3-6.3a1 1 0 011.4 0z" />
                      </svg>
                    )}
                  </span>
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: p.cor }}
                  />
                  <FolderKanban className="w-3.5 h-3.5 shrink-0 opacity-70" />
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm truncate ${
                        checked ? "font-semibold text-fg" : ""
                      }`}
                    >
                      {p.nome}
                      {p.status === "arquivado" && " (arquivado)"}
                    </p>
                    {p.descricao && (
                      <p className="text-[10px] text-fg-subtle truncate">
                        {p.descricao}
                      </p>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving || !ready || user?.role === "admin"}>
            {saving ? "Salvando..." : "Salvar permissões"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
