"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Search, ShieldCheck, Users, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { FormField, Input, Textarea } from "@/components/ui/input";
import { initials } from "@/lib/utils";
import type { Tool, UserProfile } from "@/lib/types";

const COLORS = [
  "#3b82f6", "#10b981", "#f97316", "#ec4899",
  "#a855f7", "#eab308", "#06b6d4", "#ef4444",
  "#14b8a6", "#f59e0b", "#84cc16", "#8b5cf6"
];

interface Props {
  open: boolean;
  onClose: () => void;
  /** Quando editing → Tool COM url/login/senha (vem da rota admin) */
  tool: Tool | null;
  users: UserProfile[];
  /** IDs autorizados atuais (apenas relevantes em edição) */
  initialUserIds: string[];
  onSaved: () => void;
  /** Sem acesso total: a senha salva não é exibida e o campo só sobrescreve. */
  hidePassword?: boolean;
}

export function ToolModal({
  open,
  onClose,
  tool,
  users,
  initialUserIds,
  onSaved,
  hidePassword = false
}: Props) {
  const [nome, setNome] = useState("");
  const [url, setUrl] = useState("");
  const [descricao, setDescricao] = useState("");
  const [icon, setIcon] = useState("");
  const [cor, setCor] = useState(COLORS[0]);
  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");
  const [showSenha, setShowSenha] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNome(tool?.nome ?? "");
    setUrl(tool?.url ?? "");
    setDescricao(tool?.descricao ?? "");
    setIcon(tool?.icon ?? "");
    setCor(tool?.cor ?? COLORS[0]);
    setLogin(tool?.login ?? "");
    // Quem não pode ver a senha começa com o campo vazio (a API nem a envia).
    setSenha(hidePassword ? "" : (tool?.senha ?? ""));
    setShowSenha(false);
    setSelectedUserIds(new Set(initialUserIds));
    setSearch("");
  }, [open, tool, initialUserIds, hidePassword]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.nome.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.cargo ?? "").toLowerCase().includes(q)
    );
  }, [users, search]);

  function toggleUser(id: string) {
    setSelectedUserIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function save() {
    if (!nome.trim()) return toast.error("Nome obrigatório");
    if (!url.trim()) return toast.error("URL obrigatória");
    setSaving(true);
    const payload = {
      nome: nome.trim(),
      url: url.trim(),
      descricao: descricao.trim() || null,
      icon: icon.trim() || null,
      cor,
      login: login.trim() || null,
      // Com a senha oculta, campo em branco significa "manter": não envia nada.
      // Com acesso total, esvaziar o campo remove a senha, como sempre foi.
      ...(hidePassword ? (senha ? { senha } : {}) : { senha: senha || null }),
      allowed_user_ids: Array.from(selectedUserIds)
    };
    try {
      const res = await fetch(
        tool ? `/api/admin/tools/${tool.id}` : "/api/admin/tools",
        {
          method: tool ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }
      );
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Falha ao salvar");
      }
      toast.success(tool ? "Ferramenta atualizada" : "Ferramenta criada");
      onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tool ? "Editar ferramenta" : "Nova ferramenta"}
      size="lg"
    >
      <div className="space-y-4">
        {/* Identidade */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="Nome">
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: Banco do Brasil, Shopify..."
              autoFocus
            />
          </FormField>
          <FormField label="URL de acesso">
            <Input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
            />
          </FormField>
        </div>

        <FormField label="Descrição">
          <Textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Para que serve esta ferramenta?"
          />
        </FormField>

        {/* Credenciais */}
        <div className="rounded-2xl bg-bg-subtle/60 border border-border p-3 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-status-done" />
            <p className="text-sm font-semibold">Credenciais de acesso</p>
            <span className="ml-auto text-[10px] text-fg-subtle">
              Reveladas apenas após 2FA
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Login / e-mail">
              <Input
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder="usuario@empresa.com"
                autoComplete="off"
              />
            </FormField>
            <FormField
              label="Senha"
              hint={
                hidePassword && tool
                  ? "Por segurança, a senha salva não é exibida para o seu perfil."
                  : undefined
              }
            >
              <div className="relative">
                <Input
                  type={showSenha ? "text" : "password"}
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  placeholder={
                    hidePassword && tool
                      ? tool.tem_senha
                        ? "Senha salva — digite para substituir"
                        : "Sem senha — digite para definir"
                      : "••••••••"
                  }
                  autoComplete="new-password"
                  className="pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowSenha((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-fg-muted hover:text-fg"
                >
                  {showSenha ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </FormField>
          </div>
        </div>

        {/* Aparência */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="Iniciais do ícone (máx 2)" hint="Ex: BB, SP, NB">
            <Input
              value={icon}
              onChange={(e) => setIcon(e.target.value.slice(0, 2).toUpperCase())}
              maxLength={2}
              className="uppercase"
            />
          </FormField>
          <FormField label="Cor">
            <div className="flex flex-wrap gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCor(c)}
                  className={`w-7 h-7 rounded-lg border-2 transition ${
                    cor === c ? "border-fg scale-110" : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </FormField>
        </div>

        {/* Permissão */}
        <FormField
          label={
            <span className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              Pessoas com acesso
              <span className="text-fg-subtle font-normal">
                ({selectedUserIds.size} selecionada
                {selectedUserIds.size === 1 ? "" : "s"})
              </span>
            </span>
          }
          hint="Apenas as pessoas marcadas verão e poderão acessar esta ferramenta. Admins sempre veem tudo."
        >
          <div className="relative mb-2">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar pessoa..."
              className="pl-8"
            />
          </div>
          <div className="max-h-56 overflow-y-auto rounded-xl border border-border bg-bg divide-y divide-border">
            {filteredUsers.length === 0 ? (
              <p className="p-4 text-xs text-fg-muted text-center">
                Nenhum usuário encontrado.
              </p>
            ) : (
              filteredUsers.map((u) => {
                const checked = selectedUserIds.has(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggleUser(u.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left transition ${
                      checked
                        ? "bg-brand-subtle/40"
                        : "hover:bg-bg-muted/50"
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-brand/20 text-brand flex items-center justify-center text-[10px] font-bold uppercase shrink-0">
                      {initials(u.nome)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm truncate ${
                          checked ? "font-semibold text-brand" : ""
                        }`}
                      >
                        {u.nome}
                      </p>
                      <p className="text-[10px] text-fg-subtle truncate">
                        {u.cargo || u.email}
                      </p>
                    </div>
                    <div
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
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </FormField>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? (
              "Salvando..."
            ) : (
              <>
                <Wrench className="w-3.5 h-3.5" /> Salvar
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
