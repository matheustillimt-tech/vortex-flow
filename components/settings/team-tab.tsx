"use client";

import { useEffect, useRef, useState } from "react";
import {
  FolderKanban,
  KeyRound,
  Lock,
  Mail,
  MoreHorizontal,
  Power,
  PowerOff,
  Trash2,
  UserPlus,
  Loader2,
  Copy
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { APP_NAME } from "@/lib/brand";
import { InviteMemberModal } from "@/components/settings/invite-member-modal";
import { ProjectAccessModal } from "@/components/settings/project-access-modal";
import { useCan, usePermissions } from "@/components/permissions/permissions-provider";
import type { PermissionProfile, Project, Sector, UserProfile } from "@/lib/types";

export function TeamTab() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectIdsByUser, setProjectIdsByUser] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  // Senha temporária recém-gerada: mostrada uma vez só, para o admin repassar.
  const [senhaGerada, setSenhaGerada] = useState<{ nome: string; email: string; senha: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [permissionProfiles, setPermissionProfiles] = useState<PermissionProfile[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [changingProfileId, setChangingProfileId] = useState<string | null>(null);
  // O que o perfil de quem está logado permite fazer nesta tela. O servidor
  // aplica as mesmas regras; aqui é para não oferecer o que seria recusado.
  const perms = usePermissions();
  const canCreate = useCan("configuracoes.time", "create");
  const canEdit = useCan("configuracoes.time", "edit");
  const canDelete = useCan("configuracoes.time", "delete");
  const actorFull = perms?.fullAccess ?? false;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [accessUser, setAccessUser] = useState<UserProfile | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  /** Posição do dropdown calculada a partir do bounding rect do botão clicado. */
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(
    null
  );
  // Ref pro próprio dropdown — usado pra detectar clique fora.
  const menuRef = useRef<HTMLDivElement>(null);

  function openMenuFor(u: UserProfile, btn: HTMLElement) {
    const rect = btn.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right
    });
    setOpenMenuId(u.id);
  }

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!menuRef.current) return;
      const t = e.target as Node;
      // Clicar no próprio dropdown não fecha (cliques nos itens já chamam
      // setOpenMenuId(null)). Clicar no botão de trigger também não — esse
      // já é tratado pelo onClick do botão.
      if (menuRef.current.contains(t)) return;
      if ((t as HTMLElement).closest?.("[data-team-menu-trigger]")) return;
      setOpenMenuId(null);
    }
    function onScrollOrResize() {
      setOpenMenuId(null);
    }
    if (openMenuId) {
      document.addEventListener("mousedown", onDoc);
      window.addEventListener("scroll", onScrollOrResize, true);
      window.addEventListener("resize", onScrollOrResize);
    }
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [openMenuId]);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    const supabase = createClient();
    const [u, s, access, perfis, sessao] = await Promise.all([
      supabase.from("users").select("*").order("nome"),
      supabase.from("sectors").select("*").eq("status", "ativo").order("nome"),
      fetch("/api/admin/project-access").then((r) => r.ok ? r.json() : null),
      supabase
        .from("permission_profiles")
        .select("*")
        .order("full_access", { ascending: false })
        .order("nome"),
      supabase.auth.getUser()
    ]);
    setUsers((u.data as UserProfile[]) ?? []);
    setSectors((s.data as Sector[]) ?? []);
    setPermissionProfiles((perfis.data as PermissionProfile[]) ?? []);
    setCurrentUserId(sessao.data.user?.id ?? null);
    setProjects((access?.projects as Project[]) ?? []);
    setProjectIdsByUser((access?.project_ids_by_user as Record<string, string[]>) ?? {});
    setSelectedIds(new Set());
    setLoading(false);
  }

  /** Edição otimista via servidor; se for recusada, recarrega o estado real. */
  async function updateUser(u: UserProfile, patch: Partial<UserProfile>) {
    setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, ...patch } : x)));
    try {
      const r = await fetch(`/api/usuarios/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Falha ao salvar");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
      void load();
    }
  }

  /** O perfil de `u` tem acesso total? */
  function temAcessoTotal(u: UserProfile) {
    return permissionProfiles.some((p) => p.id === u.permission_profile_id && p.full_access);
  }

  /** Só quem tem acesso total mexe em quem tem — mesma regra do servidor. */
  function podeMexer(u: UserProfile) {
    return actorFull || !temAcessoTotal(u);
  }

  /**
   * Troca o perfil de permissão pela API, que aplica as guardas (não alterar o
   * próprio perfil, não rebaixar o último Super Admin). O select é controlado:
   * se a chamada falhar, ele volta sozinho para o perfil anterior.
   */
  async function changeProfile(u: UserProfile, profileId: string) {
    if (!profileId || profileId === u.permission_profile_id) return;
    const perfil = permissionProfiles.find((p) => p.id === profileId);
    setChangingProfileId(u.id);
    try {
      const r = await fetch(`/api/admin/usuarios/${u.id}/permission-profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile_id: profileId })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Falha ao trocar o perfil");
      // O role vem recalculado pelo banco; mantém "Projetos liberados" coerente.
      setUsers((prev) =>
        prev.map((x) =>
          x.id === u.id
            ? { ...x, permission_profile_id: profileId, role: data.role ?? x.role }
            : x
        )
      );
      toast.success(`${u.nome} agora usa o perfil ${perfil?.nome ?? "selecionado"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao trocar o perfil");
    } finally {
      setChangingProfileId(null);
    }
  }

  async function resendInvite(u: UserProfile) {
    const msg =
      `Reenviar o acesso a ${u.nome}? Uma NOVA senha temporária será gerada ` +
      `(a anterior deixa de valer) e o 2FA atual será removido.`;
    if (!confirm(msg)) return;
    setResendingId(u.id);
    try {
      const r = await fetch("/api/usuarios/resend-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: u.id })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Falha");
      if (data.emailSkipped) {
        toast.error(
          "Envio de e-mail desativado (RESEND_API_KEY ausente). Compartilhe manualmente."
        );
      } else if (data.emailSent) {
        toast.success(`Nova senha gerada e e-mail reenviado a ${u.email}`);
      } else {
        toast.error("Não foi possível enviar o e-mail: " + (data.error ?? ""));
      }
      if (data.password) {
        setSenhaGerada({ nome: u.nome, email: u.email, senha: data.password });
      }
      setUsers((prev) =>
        prev.map((x) =>
          x.id === u.id
            ? { ...x, password_changed: false, mfa_enabled: false }
            : x
        )
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Falha");
    } finally {
      setResendingId(null);
    }
  }

  async function deleteUser(u: UserProfile) {
    // Dupla confirmação — operação destrutiva e irreversível.
    if (
      !confirm(
        `Excluir PERMANENTEMENTE o usuário "${u.nome}" (${u.email})?\n\n` +
          `Isso vai:\n` +
          `• Apagar o acesso dele (auth)\n` +
          `• Apagar o perfil em users\n` +
          `• Liberar e-mail/login para uso futuro\n\n` +
          `Esta ação NÃO pode ser desfeita.`
      )
    )
      return;
    const typed = prompt(
      `Para confirmar, digite o nome completo do usuário:\n\n${u.nome}`
    );
    if (typed?.trim() !== u.nome.trim()) {
      if (typed != null) toast.error("Nome não confere. Exclusão cancelada.");
      return;
    }
    setDeletingId(u.id);
    try {
      const r = await fetch(`/api/usuarios/${u.id}`, { method: "DELETE" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Falha");
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
      toast.success(`Usuário "${u.nome}" excluído`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Falha ao excluir");
    } finally {
      setDeletingId(null);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const selecionaveis = users.filter(podeMexer);
    setSelectedIds((prev) => prev.size === selecionaveis.length ? new Set() : new Set(selecionaveis.map((u) => u.id)));
  }

  async function deleteSelected() {
    const selected = users.filter((u) => selectedIds.has(u.id));
    if (!selected.length || !confirm(`Excluir permanentemente ${selected.length} pessoa(s) selecionada(s)? Esta ação não pode ser desfeita.`)) return;
    setBulkDeleting(true);
    try {
      const results = await Promise.all(selected.map(async (u) => {
        const r = await fetch(`/api/usuarios/${u.id}`, { method: "DELETE" });
        const data = await r.json();
        return { id: u.id, error: r.ok ? null : data.error ?? "Falha" };
      }));
      const failed = results.filter((r) => r.error);
      const removed = new Set(results.filter((r) => !r.error).map((r) => r.id));
      setUsers((prev) => prev.filter((u) => !removed.has(u.id)));
      setSelectedIds(new Set());
      failed.length ? toast.error(`${failed.length} pessoa(s) não puderam ser excluídas.`) : toast.success(`${removed.size} pessoa(s) excluída(s).`);
    } finally {
      setBulkDeleting(false);
    }
  }

  function projectAccessLabel(u: UserProfile) {
    if (u.role === "admin") return "Todos os projetos";
    const ids = projectIdsByUser[u.id] ?? [];
    if (!ids.length) return "Todos os projetos";
    const names = ids.map((id) => projects.find((p) => p.id === id)?.nome).filter(Boolean);
    return names.length ? names.join(", ") : `${ids.length} projeto(s)`;
  }

  async function resetPassword(u: UserProfile) {
    if (
      !confirm(
        `Gerar uma nova senha temporária para ${u.nome}? A senha atual deixa de valer e a pessoa será obrigada a trocar no próximo acesso.`
      )
    )
      return;
    setResettingId(u.id);
    try {
      const r = await fetch("/api/usuarios/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: u.id })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Falha");
      toast.success(`Senha de ${u.nome} resetada`);
      if (data.password) {
        setSenhaGerada({ nome: u.nome, email: u.email, senha: data.password });
      }
      setUsers((prev) =>
        prev.map((x) =>
          x.id === u.id ? { ...x, password_changed: false, mfa_enabled: false } : x
        )
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Falha");
    } finally {
      setResettingId(null);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="bg-bg-subtle border border-border rounded-2xl overflow-hidden">
        <header className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h2 className="font-medium text-sm">Membros da equipe</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-fg-subtle">{users.length} membro(s)</span>
            {canDelete && selectedIds.size > 0 && (
              <Button size="sm" variant="outline" onClick={() => void deleteSelected()} disabled={bulkDeleting} className="text-priority-urgent">
                {bulkDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Excluir {selectedIds.size}
              </Button>
            )}
            {canCreate && (
              <Button size="sm" onClick={() => setInviteOpen(true)}>
                <UserPlus className="w-3.5 h-3.5" /> Adicionar membro
              </Button>
            )}
          </div>
        </header>
        {loading ? (
          <p className="p-5 text-sm text-fg-muted">Carregando...</p>
        ) : users.length === 0 ? (
          <p className="p-5 text-sm text-fg-muted">Sem membros ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wider text-fg-subtle">
                  {canDelete && (
                    <th className="px-3 py-2.5 w-10">
                      <input type="checkbox" checked={selectedIds.size > 0 && selectedIds.size === users.filter(podeMexer).length} onChange={toggleAll} aria-label="Selecionar todos os membros" />
                    </th>
                  )}
                  <th className="text-left px-5 py-2.5 font-medium">Nome</th>
                  <th className="text-left px-5 py-2.5 font-medium">E-mail</th>
                  <th className="text-left px-5 py-2.5 font-medium">Cargo</th>
                  <th className="text-left px-5 py-2.5 font-medium">Setor</th>
                  <th className="text-left px-5 py-2.5 font-medium">Perfil de permissão</th>
                  <th className="text-left px-5 py-2.5 font-medium">Senha</th>
                  <th className="text-left px-5 py-2.5 font-medium">Status</th>
                  <th className="text-left px-5 py-2.5 font-medium min-w-56">Projetos liberados</th>
                  <th className="text-right px-5 py-2.5 font-medium w-12">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((u) => (
                  <tr key={u.id}>
                    {canDelete && (
                      <td className="px-3 py-2.5 text-center"><input type="checkbox" checked={selectedIds.has(u.id)} disabled={!podeMexer(u)} onChange={() => toggleSelected(u.id)} aria-label={`Selecionar ${u.nome}`} /></td>
                    )}
                    <td className="px-5 py-2.5">
                      <input
                        defaultValue={u.nome}
                        disabled={!canEdit || !podeMexer(u)}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== u.nome) updateUser(u, { nome: v });
                          else e.target.value = u.nome;
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") {
                            (e.target as HTMLInputElement).value = u.nome;
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        className="w-full bg-transparent border-0 font-medium px-1.5 py-0.5 rounded hover:bg-bg-muted focus:bg-bg focus:ring-2 focus:ring-brand/30 focus:outline-none transition"
                      />
                    </td>
                    <td className="px-5 py-2.5 text-fg-muted">{u.email}</td>
                    <td className="px-5 py-2.5">
                      <input
                        defaultValue={u.cargo ?? ""}
                        disabled={!canEdit || !podeMexer(u)}
                        placeholder="—"
                        onBlur={(e) => {
                          const v = e.target.value.trim() || null;
                          if (v !== u.cargo) updateUser(u, { cargo: v });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") {
                            (e.target as HTMLInputElement).value = u.cargo ?? "";
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        className="w-full bg-transparent border-0 px-1.5 py-0.5 rounded hover:bg-bg-muted focus:bg-bg focus:ring-2 focus:ring-brand/30 focus:outline-none transition placeholder:text-fg-subtle"
                      />
                    </td>
                    <td className="px-5 py-2.5">
                      <select
                        value={u.setor_principal_id ?? ""}
                        disabled={!canEdit || !podeMexer(u)}
                        onChange={(e) =>
                          updateUser(u, {
                            setor_principal_id: e.target.value || null
                          })
                        }
                        className="px-2 py-0.5 bg-bg border border-border rounded text-xs"
                      >
                        <option value="">—</option>
                        {sectors.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.nome}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-5 py-2.5">
                      <select
                        value={u.permission_profile_id ?? ""}
                        onChange={(e) => void changeProfile(u, e.target.value)}
                        disabled={
                          !canEdit ||
                          !podeMexer(u) ||
                          u.id === currentUserId ||
                          changingProfileId === u.id
                        }
                        title={
                          u.id === currentUserId
                            ? "Você não pode alterar o próprio perfil"
                            : undefined
                        }
                        className="px-2 py-0.5 bg-bg border border-border rounded text-xs max-w-[170px] disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {!u.permission_profile_id && <option value="">—</option>}
                        {permissionProfiles
                          .filter((p) => actorFull || !p.full_access || p.id === u.permission_profile_id)
                          .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nome}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-5 py-2.5">
                      {u.password_changed ? (
                        <span
                          className="inline-flex items-center gap-1 text-xs text-fg-muted"
                          title="A pessoa já definiu uma senha pessoal — por segurança não é exibida."
                        >
                          <Lock className="w-3 h-3" />
                          Trocada
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1.5 text-xs font-mono text-priority-high"
                          title="Senha temporária. A pessoa será obrigada a trocar no próximo acesso."
                        >
                          <KeyRound className="w-3 h-3" />
                          Temporária
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-md ${
                          u.ativo
                            ? "bg-status-done/15 text-status-done"
                            : "bg-priority-urgent/15 text-priority-urgent"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            u.ativo ? "bg-status-done" : "bg-priority-urgent"
                          }`}
                        />
                        {u.ativo ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-xs text-fg-muted max-w-80">
                      <span className="line-clamp-2" title={projectAccessLabel(u)}>{projectAccessLabel(u)}</span>
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      {(canEdit || canDelete) && podeMexer(u) && (
                      <button
                        type="button"
                        data-team-menu-trigger
                        onClick={(e) => {
                          if (openMenuId === u.id) {
                            setOpenMenuId(null);
                          } else {
                            openMenuFor(u, e.currentTarget);
                          }
                        }}
                        className="p-1.5 rounded-md hover:bg-bg-muted text-fg-muted hover:text-fg transition"
                        title="Ações"
                        aria-haspopup="menu"
                        aria-expanded={openMenuId === u.id}
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="text-xs text-fg-subtle space-y-1">
        <p>
          Novos membros entram com uma senha temporária (gerada na hora e mostrada uma vez só) e são obrigados a trocá-la no primeiro acesso.
        </p>
        <p>
          Por segurança, depois de trocada, a senha pessoal não é exibida nem para administradores — use o botão <strong>resetar</strong> se a pessoa esquecer.
        </p>
      </div>

      <InviteMemberModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        sectors={sectors}
        onCreated={load}
      />

      <ProjectAccessModal
        open={!!accessUser}
        onClose={() => setAccessUser(null)}
        user={accessUser}
      />

      <Modal
        open={!!senhaGerada}
        onClose={() => setSenhaGerada(null)}
        title="Nova senha temporária"
        size="sm"
      >
        {senhaGerada && (
          <div className="space-y-3">
            <p className="text-xs text-fg-muted leading-snug">
              Repasse este acesso para <strong>{senhaGerada.nome}</strong>. A senha
              aparece só agora; no primeiro acesso a pessoa cria a própria senha.
            </p>
            <div className="bg-bg border border-border rounded-xl p-3 space-y-1 font-mono text-sm">
              <div>
                <span className="text-fg-subtle">E-mail:</span> {senhaGerada.email}
              </div>
              <div>
                <span className="text-fg-subtle">Senha:</span>{" "}
                <span className="font-medium">{senhaGerada.senha}</span>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  const texto =
                    `Acesso ao ${APP_NAME}\n\nE-mail: ${senhaGerada.email}\n` +
                    `Senha temporária: ${senhaGerada.senha}\n\n${window.location.origin}/login`;
                  try {
                    await navigator.clipboard.writeText(texto);
                    toast.success("Copiado");
                  } catch {
                    toast.error("Não foi possível copiar");
                  }
                }}
              >
                <Copy className="w-3.5 h-3.5" /> Copiar acesso
              </Button>
              <Button onClick={() => setSenhaGerada(null)}>Fechar</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Dropdown global: position:fixed escapa de overflow-hidden do card
          e overflow-x-auto do wrapper da tabela. */}
      {openMenuId && menuPos &&
        (() => {
          const u = users.find((x) => x.id === openMenuId);
          if (!u) return null;
          return (
            <div
              ref={menuRef}
              role="menu"
              style={{
                position: "fixed",
                top: menuPos.top,
                right: menuPos.right
              }}
              className="z-[100] w-56 bg-bg-subtle border border-border rounded-xl shadow-2xl overflow-hidden animate-fadeIn text-left"
            >
              {canEdit && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenuId(null);
                      void resendInvite(u);
                    }}
                    disabled={resendingId === u.id}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-bg-muted text-fg disabled:opacity-50 transition"
                  >
                    <Mail className="w-3.5 h-3.5 text-brand" />
                    Reenviar e-mail de acesso
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenuId(null);
                      void resetPassword(u);
                    }}
                    disabled={resettingId === u.id}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-bg-muted text-fg disabled:opacity-50 transition"
                  >
                    <KeyRound className="w-3.5 h-3.5 text-priority-high" />
                    Resetar senha
                  </button>
                </>
              )}
              {/* A gravação de restrições de projeto ainda exige acesso total no banco. */}
              {canEdit && actorFull && (
                <>
                  <div className="h-px bg-border" />
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenuId(null);
                      setAccessUser(u);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-bg-muted text-fg transition"
                  >
                    <FolderKanban className="w-3.5 h-3.5 text-brand" />
                    Acesso a projetos
                  </button>
                </>
              )}
              {canEdit && (
                <>
                  <div className="h-px bg-border" />
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenuId(null);
                      updateUser(u, { ativo: !u.ativo });
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-bg-muted text-fg transition"
                  >
                    {u.ativo ? (
                      <>
                        <PowerOff className="w-3.5 h-3.5 text-priority-urgent" />
                        Desativar usuário
                      </>
                    ) : (
                      <>
                        <Power className="w-3.5 h-3.5 text-status-done" />
                        Ativar usuário
                      </>
                    )}
                  </button>
                </>
              )}
              {canDelete && (
                <>
                  {canEdit && <div className="h-px bg-border" />}
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenuId(null);
                      void deleteUser(u);
                    }}
                    disabled={deletingId === u.id}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-priority-urgent hover:bg-priority-urgent/10 disabled:opacity-50 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {deletingId === u.id ? "Excluindo..." : "Excluir usuário"}
                  </button>
                </>
              )}
            </div>
          );
        })()}
    </div>
  );
}
