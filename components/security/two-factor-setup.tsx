"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { ArrowRight, Check, Copy, ShieldCheck, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";
import { APP_NAME } from "@/lib/brand";

const ISSUER = APP_NAME;

/** Monta otpauth:// URL com issuer customizado (nome no app). */
function buildOtpAuthUrl(secret: string, accountLabel: string) {
  const issuer = encodeURIComponent(ISSUER);
  const label = encodeURIComponent(accountLabel);
  return `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

export function TwoFactorSetup() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [alreadyEnabled, setAlreadyEnabled] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void init();
  }, []);

  async function init() {
    setLoading(true);
    const supabase = createClient();

    // Já tem factor verificado?
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const verified = factors?.totp?.find((f) => f.status === "verified");
    if (verified) {
      setAlreadyEnabled(true);
      // AUTO-HEAL: o factor está verificado no Supabase Auth, mas pode ser que
      // a flag `mfa_enabled` na tabela `public.users` esteja desincronizada
      // (ex: chamada anterior à API falhou silenciosamente). Reforça aqui.
      try {
        await fetch("/api/usuarios/me/mfa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true })
        });
        // Limpa cache do middleware pra próxima navegação reconhecer
        document.cookie = "vf-flags=; max-age=0; path=/";
        document.cookie =
          "vf-flags=; expires=Thu, 01 Jan 1970 00:00:01 GMT; path=/";
      } catch (e) {
        console.warn("[2fa] auto-heal falhou:", e);
      }
      setLoading(false);
      return;
    }

    // Limpa qualquer factor unverified antigo
    for (const f of factors?.totp ?? []) {
      if ((f.status as string) !== "verified") {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
    }

    // Cria novo factor
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: ISSUER
    });
    if (error) {
      toast.error("Falha ao iniciar 2FA: " + error.message);
      setLoading(false);
      return;
    }
    if (data) {
      setFactorId(data.id);
      setSecret(data.totp.secret);
      // Gera QR custom com issuer = APP_NAME (ignora o QR padrão do
      // Supabase que viria com o hostname do projeto)
      const { data: { user: u } } = await supabase.auth.getUser();
      const otpauth = buildOtpAuthUrl(data.totp.secret, u?.email ?? "user");
      try {
        const url = await QRCode.toDataURL(otpauth, {
          margin: 1,
          width: 220,
          color: { dark: "#0f172a", light: "#ffffff" }
        });
        setQrDataUrl(url);
      } catch (e) {
        console.error("QR gen failed", e);
      }
    }
    setLoading(false);
  }

  async function verify() {
    if (!factorId) return;
    if (code.replace(/\s/g, "").length !== 6) {
      toast.error("Digite o código de 6 dígitos do app.");
      return;
    }
    setVerifying(true);
    const supabase = createClient();
    const ch = await supabase.auth.mfa.challenge({ factorId });
    if (ch.error || !ch.data) {
      toast.error("Erro: " + ch.error?.message);
      setVerifying(false);
      return;
    }
    const v = await supabase.auth.mfa.verify({
      factorId,
      challengeId: ch.data.id,
      code: code.replace(/\s/g, "")
    });
    if (v.error) {
      toast.error("Código inválido. Tente de novo.");
      setVerifying(false);
      return;
    }

    // Marca mfa_enabled=true via API admin (evita problemas de RLS após
    // verify do TOTP, quando a sessão ainda pode estar AAL1).
    // Retry simples: se o sync falhar o usuário fica preso pelo middleware.
    async function syncMfaFlag(): Promise<boolean> {
      try {
        const r = await fetch("/api/usuarios/me/mfa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true })
        });
        return r.ok;
      } catch {
        return false;
      }
    }
    let synced = await syncMfaFlag();
    if (!synced) {
      // Tenta uma vez mais antes de avisar.
      await new Promise((r) => setTimeout(r, 600));
      synced = await syncMfaFlag();
    }
    if (!synced) {
      toast.error(
        "2FA verificado, mas falhou ao sincronizar com o servidor. Recarregue a página."
      );
      setVerifying(false);
      return;
    }

    // Invalida o cache de flags do middleware
    document.cookie = "vf-flags=; max-age=0; path=/";
    document.cookie = "vf-flags=; expires=Thu, 01 Jan 1970 00:00:01 GMT; path=/";

    toast.success("2FA ativado!");
    setVerifying(false);
    // Pequeno delay para garantir que o cookie foi limpo antes do reload
    setTimeout(() => {
      window.location.href = "/dashboard";
    }, 100);
  }

  async function disable() {
    if (
      !confirm("Desativar 2FA? Sua conta ficará menos protegida.")
    )
      return;
    const supabase = createClient();
    const { data: factors } = await supabase.auth.mfa.listFactors();
    for (const f of factors?.totp ?? []) {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    try {
      await fetch("/api/usuarios/me/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false })
      });
    } catch (e) {
      console.warn("[2fa] falha ao marcar mfa_enabled=false:", e);
    }
    document.cookie = "vf-flags=; max-age=0; path=/";
    document.cookie = "vf-flags=; expires=Thu, 01 Jan 1970 00:00:01 GMT; path=/";
    toast.success("2FA desativado");
    void init();
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      toast.success("Código copiado");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Não foi possível copiar");
    }
  }

  return (
    <div className="min-h-[calc(100vh-var(--topbar-h))] flex items-start justify-center p-6">
      <div className="w-full max-w-md mt-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-brand/15 text-brand flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Verificação em duas etapas
            </h1>
            <p className="text-xs text-fg-muted">
              {alreadyEnabled
                ? "2FA está ativo na sua conta."
                : "Aumenta a segurança usando o Google Authenticator."}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="bg-bg-subtle border border-border rounded-2xl p-8 text-center text-sm text-fg-muted">
            Carregando...
          </div>
        ) : alreadyEnabled ? (
          <div className="bg-bg-subtle border border-border rounded-2xl p-5 space-y-4">
            <div className="flex items-start gap-2.5 p-3 bg-status-done/15 border border-status-done/40 rounded-lg">
              <Check className="w-4 h-4 text-status-done mt-0.5 shrink-0" />
              <p className="text-sm text-fg-muted">
                Sua conta exige código do Google Authenticator a cada login.
              </p>
            </div>
            <Button
              onClick={() => {
                // Limpa cookie de cache antes de navegar — garante que o
                // middleware veja o flag atualizado.
                document.cookie = "vf-flags=; max-age=0; path=/";
                document.cookie =
                  "vf-flags=; expires=Thu, 01 Jan 1970 00:00:01 GMT; path=/";
                window.location.href = "/dashboard";
              }}
              className="w-full"
            >
              Ir para o Dashboard <ArrowRight className="w-3.5 h-3.5" />
            </Button>
            <Button variant="danger" onClick={disable} className="w-full">
              Desativar 2FA
            </Button>
          </div>
        ) : (
          <div className="bg-bg-subtle border border-border rounded-2xl p-5 space-y-5">
            <ol className="text-sm text-fg-muted space-y-2 list-decimal pl-5">
              <li>
                Abra o <strong>Google Authenticator</strong> (ou app TOTP equivalente — Authy, 1Password, etc.) no celular.
              </li>
              <li>
                Toque em adicionar e <strong>escaneie o QR code</strong> abaixo.
              </li>
              <li>
                Digite o código de <strong>6 dígitos</strong> que o app gerar.
              </li>
            </ol>

            {qrDataUrl && (
              <div className="bg-white rounded-xl p-4 flex flex-col items-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrDataUrl}
                  alt="QR Code para Google Authenticator"
                  className="w-44 h-44"
                />
                {secret && (
                  <button
                    onClick={copySecret}
                    className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-slate-600 hover:text-slate-900 font-mono"
                    title="Caso não consiga escanear, digite este código manualmente no app."
                  >
                    {copied ? (
                      <Check className="w-3 h-3" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    {secret}
                  </button>
                )}
              </div>
            )}

            <FormField
              label="Código do app (6 dígitos)"
              hint="O código muda a cada 30 segundos."
            >
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="000000"
                className="font-mono text-lg text-center tracking-widest"
                autoComplete="one-time-code"
              />
            </FormField>

            <Button
              onClick={verify}
              disabled={verifying || code.length !== 6}
              className="w-full"
            >
              {verifying ? (
                "Verificando..."
              ) : (
                <>
                  <Smartphone className="w-3.5 h-3.5" /> Ativar 2FA
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
