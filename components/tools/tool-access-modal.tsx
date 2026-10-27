"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Lock,
  ShieldAlert,
  ShieldCheck,
  X
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Tool } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  tool: Tool | null;
  /** Coords obtidas do navegador (opcional, melhora o log) */
  coords?: { lat: number; lng: number } | null;
}

type Stage = "totp" | "revealed";

/**
 * Modal de acesso à ferramenta:
 *  1) Pede código TOTP do Google Authenticator (factor já configurado).
 *  2) Faz mfa.challenge + mfa.verify (sessão sobe pra AAL2).
 *  3) Chama /api/tools/access (server checa AAL2 + permissão + loga + devolve credenciais).
 *  4) Mostra URL/login/senha com botões "copiar" + "abrir".
 */
export function ToolAccessModal({ open, onClose, tool, coords }: Props) {
  const [stage, setStage] = useState<Stage>("totp");
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [hasFactor, setHasFactor] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{
    url: string;
    login: string | null;
    senha: string | null;
  } | null>(null);
  const [showSenha, setShowSenha] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset ao abrir
  useEffect(() => {
    if (!open) return;
    setStage("totp");
    setCode("");
    setRevealed(null);
    setShowSenha(false);
    setError(null);
    setBusy(false);
    void loadFactor();
    setTimeout(() => inputRef.current?.focus(), 80);
    // log do tentativa de acesso (abertura do modal)
    if (tool) {
      void fetch("/api/tools/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "tool_view_attempt",
          tool_id: tool.id,
          latitude: coords?.lat ?? null,
          longitude: coords?.lng ?? null
        })
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tool]);

  async function loadFactor() {
    const supabase = createClient();
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      setHasFactor(false);
      return;
    }
    const verified = data.totp?.find((f) => f.status === "verified");
    if (verified) {
      setFactorId(verified.id);
      setHasFactor(true);
    } else {
      setHasFactor(false);
    }
  }

  async function submitCode() {
    if (!tool || !factorId) return;
    const clean = code.replace(/\s/g, "");
    if (clean.length !== 6) {
      setError("Digite os 6 dígitos.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    try {
      const ch = await supabase.auth.mfa.challenge({ factorId });
      if (ch.error || !ch.data) {
        throw new Error(ch.error?.message ?? "Falha no challenge");
      }
      const v = await supabase.auth.mfa.verify({
        factorId,
        challengeId: ch.data.id,
        code: clean
      });
      if (v.error) {
        // log de tentativa falha
        void fetch("/api/tools/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "tool_view_failed_totp",
            tool_id: tool.id,
            latitude: coords?.lat ?? null,
            longitude: coords?.lng ?? null,
            metadata: { error: v.error.message }
          })
        }).catch(() => {});
        throw new Error("Código inválido. Tente novamente.");
      }

      // Agora a sessão está AAL2 — chama API que devolve credenciais
      const res = await fetch("/api/tools/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool_id: tool.id,
          latitude: coords?.lat ?? null,
          longitude: coords?.lng ?? null
        })
      });
      const json = (await res.json()) as {
        ok?: boolean;
        tool?: { url: string; login: string | null; senha: string | null };
        error?: string;
      };
      if (!res.ok || !json.ok || !json.tool) {
        throw new Error(json.error ?? "Falha ao liberar acesso");
      }

      setRevealed({
        url: json.tool.url,
        login: json.tool.login,
        senha: json.tool.senha
      });
      setStage("revealed");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string | null, label: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copiado(a)`);
    } catch {
      toast.error("Não foi possível copiar");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={tool?.nome ?? ""} size="md">
      {!tool ? null : stage === "totp" ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 rounded-xl bg-brand-subtle/40 border border-brand/20">
            <Lock className="w-5 h-5 text-brand mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold">Verificação em duas etapas</p>
              <p className="text-xs text-fg-muted mt-0.5">
                Para revelar as credenciais desta ferramenta, digite o código de 6
                dígitos do <strong>Google Authenticator</strong>. Cada acesso é
                registrado.
              </p>
            </div>
          </div>

          {hasFactor === false && (
            <div className="flex items-start gap-3 p-3 rounded-xl bg-priority-urgent/10 border border-priority-urgent/30">
              <ShieldAlert className="w-5 h-5 text-priority-urgent mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-priority-urgent">
                  Você ainda não configurou o 2FA
                </p>
                <p className="text-xs text-fg-muted mt-0.5">
                  Vá em <strong>Segurança → 2 Fatores</strong> e configure o Google
                  Authenticator antes de acessar ferramentas.
                </p>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-fg-muted mb-1.5">
              Código de 6 dígitos
            </label>
            <Input
              ref={inputRef}
              value={code}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(v);
                setError(null);
                if (v.length === 6) {
                  // auto-submit
                  setTimeout(() => void submitCode(), 50);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitCode();
              }}
              placeholder="••••••"
              inputMode="numeric"
              maxLength={6}
              disabled={busy || hasFactor === false}
              className="text-center text-2xl tracking-[0.5em] font-mono"
            />
            {error && (
              <p className="mt-1.5 text-xs text-priority-urgent">{error}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              onClick={() => void submitCode()}
              disabled={busy || code.length !== 6 || hasFactor === false}
            >
              {busy ? "Validando..." : "Liberar acesso"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-3 rounded-xl bg-status-done/10 border border-status-done/30">
            <ShieldCheck className="w-5 h-5 text-status-done mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-status-done">
                Acesso liberado
              </p>
              <p className="text-xs text-fg-muted mt-0.5">
                Este acesso foi registrado no log de auditoria. Não compartilhe as
                credenciais.
              </p>
            </div>
          </div>

          <CredField
            label="URL"
            value={revealed?.url ?? ""}
            onCopy={() => copy(revealed?.url ?? null, "URL")}
            extra={
              revealed?.url ? (
                <a
                  href={revealed.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-brand text-white hover:bg-brand-hover transition"
                >
                  <ExternalLink className="w-3 h-3" /> Abrir
                </a>
              ) : null
            }
          />
          <CredField
            label="Login"
            value={revealed?.login ?? "—"}
            onCopy={() => copy(revealed?.login ?? null, "Login")}
            mono
          />
          <CredField
            label="Senha"
            value={revealed?.senha ?? "—"}
            mono
            mask={!showSenha}
            onCopy={() => copy(revealed?.senha ?? null, "Senha")}
            extra={
              <button
                onClick={() => setShowSenha((s) => !s)}
                className="p-1.5 rounded-md text-fg-muted hover:text-fg hover:bg-bg-muted transition"
                title={showSenha ? "Ocultar" : "Mostrar"}
              >
                {showSenha ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
              </button>
            }
          />

          <div className="flex justify-end pt-2">
            <Button onClick={onClose}>
              <X className="w-3.5 h-3.5" /> Fechar
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function CredField({
  label,
  value,
  onCopy,
  mono,
  mask,
  extra
}: {
  label: string;
  value: string;
  onCopy: () => void;
  mono?: boolean;
  mask?: boolean;
  extra?: React.ReactNode;
}) {
  const display = mask ? "•".repeat(Math.min(value.length, 14)) || "—" : value;
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wider text-fg-subtle">
        {label}
      </p>
      <div className="flex items-center gap-1.5">
        <div
          className={`flex-1 min-w-0 px-3 py-2 bg-bg-subtle border border-border rounded-lg text-sm truncate ${
            mono ? "font-mono" : ""
          }`}
        >
          {display}
        </div>
        <button
          onClick={onCopy}
          className="p-2 rounded-md text-fg-muted hover:text-fg hover:bg-bg-muted transition"
          title={`Copiar ${label.toLowerCase()}`}
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
        {extra}
      </div>
    </div>
  );
}
