"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Edit3,
  KeyRound,
  Lock,
  Plus,
  ScrollText,
  Search,
  ShieldCheck,
  Trash2,
  Users as UsersIcon,
  Wrench
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { ensureMe, ensureUsers, snapshot } from "@/lib/cache";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ToolModal } from "@/components/tools/tool-modal";
import { ToolAccessModal } from "@/components/tools/tool-access-modal";
import { useCan, usePermissions } from "@/components/permissions/permissions-provider";
import type { Tool, ToolUserAccess, UserProfile } from "@/lib/types";

export function ToolsView() {
  const snap = snapshot();
  const [me, setMe] = useState<UserProfile | null>(snap.me);
  const [tools, setTools] = useState<Tool[]>([]);
  const [users, setUsers] = useState<UserProfile[]>(snap.users);
  const [access, setAccess] = useState<ToolUserAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Tool | null>(null);
  const [accessOpen, setAccessOpen] = useState(false);
  const [accessing, setAccessing] = useState<Tool | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [search, setSearch] = useState("");

  useEffect(() => {
    void load();
    // Tenta capturar coords precisas (silenciosamente — só funciona se já tiver
    // dado permissão antes). Browser pode rejeitar.
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          setCoords({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
          }),
        () => {},
        { timeout: 5000, maximumAge: 60_000 }
      );
    }
  }, []);

  // Log da abertura da página
  useEffect(() => {
    if (loading) return;
    void fetch("/api/tools/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "tools_page_open",
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null
      })
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, coords?.lat, coords?.lng]);

  async function load() {
    setLoading(true);
    // ensureMe usa cache (TTL 60s) — já aquecido pelo Sidebar.
    const profile = await ensureMe();
    if (!profile) {
      setLoading(false);
      return;
    }
    setMe(profile);

    if (gere) {
      // Quem gere: lista completa e acessos (rota de servidor) e usuários em PARALELO.
      const [json, usersList] = await Promise.all([
        fetch("/api/admin/tools", { cache: "no-store" })
          .then((r) => r.json() as Promise<{
            tools?: Tool[];
            access?: ToolUserAccess[];
          }>)
          .catch(() => ({ tools: [], access: [] })),
        ensureUsers()
      ]);
      setTools(json.tools ?? []);
      setAccess(json.access ?? []);
      setUsers(usersList);
    } else {
      // Usuário comum: só metadados (RLS faz a filtragem).
      const supabase = createClient();
      const { data: ts } = await supabase
        .from("tools")
        .select("id, nome, descricao, icon, cor, created_by, created_at, updated_at")
        .order("nome");
      setTools(((ts as Tool[]) ?? []) as Tool[]);
      setAccess([]);
      setUsers([]);
    }
    setLoading(false);
  }

  // O que o perfil permite nesta tela. O servidor aplica as mesmas regras.
  const perms = usePermissions();
  const canCreate = useCan("ferramentas", "create");
  const canEdit = useCan("ferramentas", "edit");
  const canDelete = useCan("ferramentas", "delete");
  const canLogs = useCan("configuracoes.atividades");
  const gere = canCreate || canEdit || canDelete;

  const accessByTool = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of access) {
      if (!m.has(a.tool_id)) m.set(a.tool_id, []);
      m.get(a.tool_id)!.push(a.user_id);
    }
    return m;
  }, [access]);

  const filteredTools = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter((t) => {
      const allowedNames = (accessByTool.get(t.id) ?? [])
        .map((uid) => users.find((u) => u.id === uid)?.nome ?? "")
        .join(" ");
      const hay = [t.nome, t.descricao, t.icon, allowedNames]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [tools, search, accessByTool, users]);

  async function remove(t: Tool) {
    if (!confirm(`Excluir a ferramenta "${t.nome}"? Esta ação não pode ser desfeita.`))
      return;
    try {
      const res = await fetch(`/api/admin/tools/${t.id}`, { method: "DELETE" });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Falha ao excluir");
      }
      setTools((prev) => prev.filter((x) => x.id !== t.id));
      toast.success("Ferramenta excluída");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro inesperado");
    }
  }

  function openAccess(t: Tool) {
    setAccessing(t);
    setAccessOpen(true);
  }

  return (
    <>
      <PageHeader
        title="Ferramentas"
        subtitle="Acessos críticos da empresa — protegidos por verificação em duas etapas."
        actions={
          <div className="flex items-center gap-2">
            {canLogs && (
              <Link
                href="/registro-atividades"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-bg-subtle border border-border hover:border-border-strong text-fg-muted hover:text-fg transition"
              >
                <ScrollText className="w-3.5 h-3.5" /> Registro de atividades
              </Link>
            )}
            {canCreate && (
              <Button
                onClick={() => {
                  setEditing(null);
                  setModalOpen(true);
                }}
              >
                <Plus className="w-4 h-4" /> Nova ferramenta
              </Button>
            )}
          </div>
        }
      />

      <div className="px-6 pt-4 space-y-3">
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-status-progress/10 border border-status-progress/20 text-xs text-fg-muted">
          <ShieldCheck className="w-4 h-4 text-status-progress mt-0.5 shrink-0" />
          <p>
            Toda visualização desta tela é registrada (nome, email, IP,
            localização aproximada e horário). Para revelar credenciais, será
            solicitado o código do <strong>Google Authenticator</strong>.
          </p>
        </div>
        {!loading && tools.length > 0 && (
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar ferramenta..."
                className="w-full pl-9 pr-9 py-2 bg-bg-subtle border border-border rounded-lg text-sm focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-fg-subtle hover:text-fg px-1.5 py-0.5 rounded hover:bg-bg-muted"
                  title="Limpar"
                >
                  ×
                </button>
              )}
            </div>
            <span className="text-xs text-fg-subtle">
              {filteredTools.length} de {tools.length}
            </span>
          </div>
        )}
      </div>

      <div className="p-6">
        {loading ? (
          <p className="text-sm text-fg-muted">Carregando...</p>
        ) : tools.length === 0 ? (
          <EmptyState
            icon={Wrench}
            title="Nenhuma ferramenta disponível"
            description={
              gere
                ? "Cadastre as ferramentas críticas (bancos, plataformas de venda...) e libere o acesso só a quem precisa."
                : "Você ainda não tem acesso a nenhuma ferramenta. Fale com um administrador."
            }
            action={
              canCreate && (
                <Button
                  onClick={() => {
                    setEditing(null);
                    setModalOpen(true);
                  }}
                >
                  <Plus className="w-4 h-4" /> Cadastrar primeira ferramenta
                </Button>
              )
            }
          />
        ) : filteredTools.length === 0 ? (
          <div className="bg-bg-subtle border border-border rounded-2xl p-10 text-center text-sm text-fg-muted">
            Nenhuma ferramenta encontrada para &quot;{search}&quot;.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredTools.map((t) => {
              const allowedIds = accessByTool.get(t.id) ?? [];
              const allowedUsers = users.filter((u) => allowedIds.includes(u.id));
              return (
                <div
                  key={t.id}
                  className="group bg-bg-subtle border border-border rounded-2xl overflow-hidden hover:border-border-strong hover:shadow-md transition flex flex-col"
                >
                  <div className="h-1" style={{ backgroundColor: t.cor }} />
                  <div className="p-4 flex-1">
                    <div className="flex items-start gap-3">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                        style={{
                          backgroundColor: t.cor + "22",
                          color: t.cor
                        }}
                      >
                        {t.icon ? (
                          <span className="text-base font-bold uppercase">
                            {t.icon.slice(0, 2)}
                          </span>
                        ) : (
                          <Wrench className="w-5 h-5" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{t.nome}</p>
                        <p className="text-xs text-fg-muted line-clamp-2 mt-0.5">
                          {t.descricao || "Sem descrição"}
                        </p>
                      </div>
                    </div>

                    {/* Admin: mostra chips de usuários autorizados */}
                    {gere && allowedUsers.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-3">
                        <span className="text-[10px] text-fg-subtle inline-flex items-center gap-1">
                          <UsersIcon className="w-3 h-3" />
                          {allowedUsers.length}
                        </span>
                        {allowedUsers.slice(0, 3).map((u) => (
                          <span
                            key={u.id}
                            className="text-[10px] px-1.5 py-0.5 rounded-md bg-brand-subtle text-brand truncate max-w-[90px]"
                            title={u.nome}
                          >
                            {u.nome.split(" ")[0]}
                          </span>
                        ))}
                        {allowedUsers.length > 3 && (
                          <span className="text-[10px] text-fg-subtle">
                            +{allowedUsers.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                    {gere && allowedUsers.length === 0 && (
                      <p className="mt-3 text-[10px] text-fg-subtle">
                        Sem usuários autorizados ainda
                      </p>
                    )}
                  </div>

                  <div className="px-4 pb-3 pt-2 border-t border-border flex items-center gap-2">
                    <button
                      onClick={() => openAccess(t)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-brand text-white hover:bg-brand-hover transition"
                    >
                      <KeyRound className="w-3.5 h-3.5" /> Acessar ferramenta
                    </button>
                    {canEdit && (
                      <button
                        onClick={() => {
                          setEditing(t);
                          setModalOpen(true);
                        }}
                        className="p-1.5 rounded-md hover:bg-bg-muted text-fg-muted hover:text-fg transition"
                        title="Editar"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        onClick={() => remove(t)}
                        className="p-1.5 rounded-md hover:bg-priority-urgent/15 text-fg-muted hover:text-priority-urgent transition"
                        title="Excluir"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {(canCreate || canEdit) && (
        <ToolModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          tool={editing}
          // Sem acesso total, a senha salva não é exibida: o campo só sobrescreve.
          hidePassword={!(perms?.fullAccess ?? false)}
          users={users}
          initialUserIds={editing ? accessByTool.get(editing.id) ?? [] : []}
          onSaved={() => {
            setModalOpen(false);
            void load();
          }}
        />
      )}

      <ToolAccessModal
        open={accessOpen}
        onClose={() => setAccessOpen(false)}
        tool={accessing}
        coords={coords}
      />
    </>
  );
}
