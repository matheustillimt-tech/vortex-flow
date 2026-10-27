"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  FolderKanban,
  KeyRound,
  Mail,
  Send
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select } from "@/components/ui/input";
import { usePermissions } from "@/components/permissions/permissions-provider";
import type { PermissionProfile, Project, Sector } from "@/lib/types";
import { APP_NAME } from "@/lib/brand";

interface Props {
  open: boolean;
  onClose: () => void;
  sectors: Sector[];
  onCreated: () => void;
}

interface CreatedUser {
  email: string;
  nome: string;
  password: string;
  emailSent: boolean;
  emailSkipped: boolean;
}

export function InviteMemberModal({ open, onClose, sectors, onCreated }: Props) {
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [cargo, setCargo] = useState("");
  const [profiles, setProfiles] = useState<PermissionProfile[]>([]);
  const [profileId, setProfileId] = useState("");
  // Carrega os perfis ao abrir. O padrão é o mesmo que o banco dá a quem entra
  // sem perfil, para o convite nunca criar alguém com mais acesso por descuido.
  useEffect(() => {
    if (!open) return;
    void createClient()
      .from("permission_profiles")
      .select("*")
      .order("full_access", { ascending: false })
      .order("nome")
      .then(({ data }) => {
        const lista = (data as PermissionProfile[]) ?? [];
        setProfiles(lista);
        setProfileId(
          (atual) => atual || lista.find((p) => p.nome === "Sem permissões")?.id || ""
        );
      });
  }, [open]);
  const selectedProfile = profiles.find((p) => p.id === profileId);
  // Quem não tem acesso total não concede acesso total pelo convite.
  const actorFull = usePermissions()?.fullAccess ?? false;
  const [setor, setSetor] = useState("");
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<CreatedUser | null>(null);
  const [copied, setCopied] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [allowedProjectIds, setAllowedProjectIds] = useState<Set<string>>(
    new Set()
  );
  const [restrictAccess, setRestrictAccess] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");

  // Carrega lista de projetos ao abrir
  useEffect(() => {
    if (!open) return;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("projects")
        .select("*")
        .neq("status", "arquivado")
        .order("nome");
      setProjects((data as Project[]) ?? []);
    })();
  }, [open]);

  const filteredProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) =>
      [p.nome, p.descricao].filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }, [projects, projectSearch]);

  function toggleProject(id: string) {
    setAllowedProjectIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  useEffect(() => {
    if (open) {
      setEmail("");
      setNome("");
      setCargo("");
      setProfileId(profiles.find((p) => p.nome === "Sem permissões")?.id ?? "");
      setSetor("");
      setCreated(null);
      setCopied(false);
      setRestrictAccess(false);
      setAllowedProjectIds(new Set());
      setProjectSearch("");
    }
  }, [open]);

  async function submit() {
    if (!email.trim() || !email.includes("@"))
      return toast.error("E-mail inválido");
    if (!nome.trim()) return toast.error("Nome obrigatório");
    setSaving(true);
    try {
      const r = await fetch("/api/usuarios/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          nome: nome.trim(),
          cargo: cargo.trim() || null,
          permission_profile_id: profileId || null,
          setor_principal_id: setor || null
        })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Erro");

      // Se admin pediu pra restringir, grava project_members do novo usuário
      const newUserId: string | undefined = data.userId ?? data.id;
      if (restrictAccess && newUserId && allowedProjectIds.size > 0) {
        try {
          const pr = await fetch(
            `/api/admin/usuarios/${newUserId}/projects`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                project_ids: Array.from(allowedProjectIds)
              })
            }
          );
          if (!pr.ok) {
            const j = await pr.json().catch(() => ({}));
            toast.error(
              `Usuário criado, mas não consegui aplicar restrição de projetos: ${
                j.error ?? pr.status
              }`
            );
          }
        } catch {
          toast.error(
            "Usuário criado, mas falha ao aplicar restrição de projetos."
          );
        }
      }

      setCreated({
        email: email.trim().toLowerCase(),
        nome: nome.trim(),
        password: data.password,
        emailSent: !!data.emailSent,
        emailSkipped: !!data.emailSkipped
      });
      onCreated();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Falha");
    } finally {
      setSaving(false);
    }
  }

  async function copyAccess() {
    if (!created) return;
    const text = `Acesso ao ${APP_NAME}\n\nE-mail: ${created.email}\nSenha temporária: ${created.password}\n\n${window.location.origin}/login`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copiado");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Não foi possível copiar");
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={created ? "Membro adicionado" : "Adicionar membro"}
      size="md"
    >
      {!created ? (
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 p-3 bg-brand-subtle/40 border border-brand/30 rounded-lg">
            <Mail className="w-4 h-4 text-brand mt-0.5 shrink-0" />
            <p className="text-xs text-fg-muted leading-snug">
              O usuário é criado com uma senha temporária (gerada na hora e mostrada só agora) e é obrigado a trocá-la no primeiro acesso. Se o envio de e-mail estiver configurado, recebe automaticamente.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Nome">
              <Input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Nome completo"
                autoFocus
              />
            </FormField>
            <FormField label="E-mail">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="pessoa@empresa.com"
              />
            </FormField>
            <FormField label="Cargo">
              <Input
                value={cargo}
                onChange={(e) => setCargo(e.target.value)}
                placeholder="Ex: Gestor de Tráfego"
              />
            </FormField>
            <FormField label="Setor principal">
              <Select value={setor} onChange={(e) => setSetor(e.target.value)}>
                <option value="">—</option>
                {sectors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Perfil de permissão">
              <Select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                {/* Sem esta opção, a lista mostraria o primeiro perfil como
                    selecionado enquanto enviaria vazio. */}
                <option value="">Sem perfil (sem acesso até atribuir)</option>
                {profiles.filter((p) => actorFull || !p.full_access).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          {/* ---------- Restrição de acesso a projetos ---------- */}
          {!selectedProfile?.full_access && (
            <div className="rounded-xl border border-border bg-bg-subtle/40 p-3 space-y-2">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={restrictAccess}
                  onChange={(e) => setRestrictAccess(e.target.checked)}
                  className="mt-1 accent-brand"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium inline-flex items-center gap-1.5">
                    <FolderKanban className="w-3.5 h-3.5 text-brand" />
                    Limitar a projetos específicos
                  </p>
                  <p className="text-[11px] text-fg-muted leading-snug">
                    Se desmarcado, o membro vê todos os projetos. Marque pra
                    liberar apenas os projetos selecionados abaixo.
                  </p>
                </div>
              </label>
              {restrictAccess && (
                <div className="pt-1 space-y-1.5">
                  <Input
                    value={projectSearch}
                    onChange={(e) => setProjectSearch(e.target.value)}
                    placeholder="Buscar projeto..."
                    className="text-xs"
                  />
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-bg divide-y divide-border">
                    {filteredProjects.length === 0 ? (
                      <p className="p-3 text-center text-[11px] text-fg-muted">
                        Nenhum projeto.
                      </p>
                    ) : (
                      filteredProjects.map((p) => {
                        const checked = allowedProjectIds.has(p.id);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => toggleProject(p.id)}
                            className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition ${
                              checked
                                ? "bg-brand-subtle/40"
                                : "hover:bg-bg-muted"
                            }`}
                          >
                            <span
                              className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center shrink-0 ${
                                checked
                                  ? "bg-brand border-brand text-white"
                                  : "border-border"
                              }`}
                            >
                              {checked && (
                                <svg
                                  viewBox="0 0 20 20"
                                  fill="currentColor"
                                  className="w-2.5 h-2.5"
                                >
                                  <path d="M16.7 5.3a1 1 0 010 1.4l-7 7a1 1 0 01-1.4 0l-3-3a1 1 0 011.4-1.4L9 11.6l6.3-6.3a1 1 0 011.4 0z" />
                                </svg>
                              )}
                            </span>
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: p.cor }}
                            />
                            <span
                              className={`text-xs truncate ${
                                checked ? "font-semibold" : ""
                              }`}
                            >
                              {p.nome}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                  <p className="text-[10px] text-fg-subtle">
                    {allowedProjectIds.size} projeto(s) selecionado(s)
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? "Adicionando..." : (
                <>
                  <Send className="w-3.5 h-3.5" /> Adicionar
                </>
              )}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 p-3 bg-status-done/15 border border-status-done/40 rounded-lg">
            <Check className="w-4 h-4 text-status-done mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium">
                {created.nome} foi adicionado(a) ao time.
              </p>
              <p className="text-xs text-fg-muted mt-0.5">
                {created.emailSent
                  ? "Um e-mail com as credenciais foi enviado automaticamente."
                  : created.emailSkipped
                    ? "Envio de e-mail desativado — compartilhe as credenciais manualmente."
                    : "Não foi possível enviar o e-mail — compartilhe manualmente."}
              </p>
            </div>
          </div>

          <div className="bg-bg border border-border rounded-xl p-4 space-y-2 font-mono text-sm">
            <div className="flex items-center gap-2">
              <Mail className="w-3.5 h-3.5 text-fg-subtle" />
              <span className="text-fg-subtle">E-mail:</span>
              <span className="font-medium">{created.email}</span>
            </div>
            <div className="flex items-center gap-2">
              <KeyRound className="w-3.5 h-3.5 text-fg-subtle" />
              <span className="text-fg-subtle">Senha:</span>
              <span className="font-medium">{created.password}</span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={copyAccess}>
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" /> Copiado
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" /> Copiar acesso
                </>
              )}
            </Button>
            <Button onClick={onClose}>Fechar</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
