"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Eye, EyeOff, KeyRound, Lock, Mail } from "lucide-react";
import { toast } from "sonner";

export function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Pré-preenche do link do email
    const emailFromUrl = searchParams.get("email");
    const codeFromUrl = searchParams.get("code");
    if (emailFromUrl) setEmail(emailFromUrl);
    if (codeFromUrl) setCode(codeFromUrl);
  }, [searchParams]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) {
      toast.error("Digite um e-mail válido.");
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      toast.error("Digite o código de 6 dígitos do e-mail.");
      return;
    }
    if (password.length < 6) {
      toast.error("A senha precisa ter ao menos 6 caracteres.");
      return;
    }
    if (password !== confirm) {
      toast.error("As senhas não conferem.");
      return;
    }
    setLoading(true);
    try {
      const r = await fetch("/api/usuarios/reset-with-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          code: code.trim(),
          password
        })
      });
      const data = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !data.ok) throw new Error(data.error ?? "Falha");
      setDone(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 p-4 bg-status-done/10 border border-status-done/30 rounded-lg">
          <CheckCircle2 className="w-5 h-5 text-status-done mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-status-done">
              Senha redefinida!
            </p>
            <p className="text-xs text-fg-muted mt-1">
              Agora é só entrar com a sua nova senha.
            </p>
          </div>
        </div>
        <Link
          href="/login"
          className="block w-full text-center py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-white font-medium text-sm transition"
        >
          Ir para o login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="text-xs font-medium text-fg-muted mb-1.5 block">
          E-mail
        </label>
        <div className="relative">
          <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full pl-9 pr-3.5 py-2.5 rounded-lg bg-bg border border-border focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 transition text-sm"
            placeholder="voce@empresa.com"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-fg-muted mb-1.5 block">
          Código (6 dígitos do e-mail)
        </label>
        <div className="relative">
          <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            required
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            className="w-full pl-9 pr-3.5 py-2.5 rounded-lg bg-bg border border-border focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 transition font-mono text-center text-base tracking-[0.4em]"
            placeholder="000000"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-fg-muted mb-1.5 block">
          Nova senha
        </label>
        <div className="relative">
          <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            type={showPwd ? "text" : "password"}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full pl-9 pr-10 py-2.5 rounded-lg bg-bg border border-border focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 transition text-sm"
            placeholder="Mínimo 6 caracteres"
          />
          <button
            type="button"
            onClick={() => setShowPwd((v) => !v)}
            title={showPwd ? "Esconder senha" : "Mostrar senha"}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-fg-subtle hover:text-fg"
          >
            {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-fg-muted mb-1.5 block">
          Confirmar senha
        </label>
        <div className="relative">
          <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            type={showConfirm ? "text" : "password"}
            required
            minLength={6}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full pl-9 pr-10 py-2.5 rounded-lg bg-bg border border-border focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 transition text-sm"
            placeholder="Repita a senha"
          />
          <button
            type="button"
            onClick={() => setShowConfirm((v) => !v)}
            title={showConfirm ? "Esconder senha" : "Mostrar senha"}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-fg-subtle hover:text-fg"
          >
            {showConfirm ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {password.length > 0 && password === confirm && (
        <div className="flex items-center gap-1.5 text-xs text-status-done">
          <CheckCircle2 className="w-3.5 h-3.5" /> Senhas conferem
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !password || password !== confirm || code.length !== 6}
        className="w-full py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-white font-medium text-sm transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-brand/30"
      >
        {loading ? "Salvando..." : "Salvar nova senha"}
      </button>

      <Link
        href="/forgot-password"
        className="block w-full text-center text-xs text-fg-muted hover:text-fg transition"
      >
        Não recebi o código — pedir de novo
      </Link>
    </form>
  );
}
