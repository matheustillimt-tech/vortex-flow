"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup" | "mfa";

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nome, setNome] = useState("");
  const [otp, setOtp] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();

    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        if (error) throw error;

        // Verifica se há 2FA exigido
        const { data: aal } =
          await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
          const { data: factors } = await supabase.auth.mfa.listFactors();
          const verified = factors?.totp?.find((f) => f.status === "verified");
          if (verified) {
            setFactorId(verified.id);
            setMode("mfa");
            setLoading(false);
            return;
          }
        }

        toast.success("Bem-vindo de volta!");
        router.push("/dashboard");
        router.refresh();
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { nome } }
        });
        if (error) throw error;
        toast.success("Conta criada! Verifique seu e-mail caso necessário.");
        setMode("signin");
      } else if (mode === "mfa") {
        if (!factorId) throw new Error("Fator MFA ausente");
        const code = otp.replace(/\s/g, "");
        if (code.length !== 6) throw new Error("Digite o código de 6 dígitos");
        const ch = await supabase.auth.mfa.challenge({ factorId });
        if (ch.error || !ch.data) throw ch.error ?? new Error("Erro no desafio");
        const v = await supabase.auth.mfa.verify({
          factorId,
          challengeId: ch.data.id,
          code
        });
        if (v.error) throw new Error("Código inválido");
        toast.success("Acesso liberado");
        router.push("/dashboard");
        router.refresh();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro ao autenticar";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  if (mode === "mfa") {
    return (
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="flex items-start gap-2.5 p-3 bg-brand-subtle/40 border border-brand/30 rounded-lg">
          <ShieldCheck className="w-4 h-4 text-brand mt-0.5 shrink-0" />
          <p className="text-xs text-fg-muted leading-snug">
            Digite o código de 6 dígitos exibido no seu Google Authenticator.
          </p>
        </div>
        <div>
          <label className="text-xs font-medium text-fg-muted mb-1.5 block">
            Código
          </label>
          <input
            type="text"
            autoFocus
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            required
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-lg bg-bg border border-border focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 transition text-lg text-center font-mono tracking-widest"
            placeholder="000000"
          />
        </div>
        <button
          type="submit"
          disabled={loading || otp.length !== 6}
          className="w-full py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-white font-medium text-sm transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-brand/30"
        >
          {loading ? "Verificando..." : "Verificar"}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("signin");
            setOtp("");
            setFactorId(null);
          }}
          className="w-full text-xs text-fg-muted hover:text-fg transition"
        >
          Voltar
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {mode === "signup" && (
        <div>
          <label className="text-xs font-medium text-fg-muted mb-1.5 block">
            Nome
          </label>
          <input
            type="text"
            required
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-lg bg-bg border border-border focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 transition text-sm"
            placeholder="Seu nome"
          />
        </div>
      )}

      <div>
        <label className="text-xs font-medium text-fg-muted mb-1.5 block">
          E-mail
        </label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3.5 py-2.5 rounded-lg bg-bg border border-border focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 transition text-sm"
          placeholder="voce@empresa.com"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-fg-muted mb-1.5 block">
          Senha
        </label>
        <div className="relative">
          <input
            type={showPwd ? "text" : "password"}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full pl-3.5 pr-10 py-2.5 rounded-lg bg-bg border border-border focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 transition text-sm"
            placeholder="••••••••"
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

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-white font-medium text-sm transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-brand/30"
      >
        {loading ? "Carregando..." : mode === "signin" ? "Entrar" : "Criar conta"}
      </button>

      {mode === "signin" && (
        <Link
          href="/forgot-password"
          className="block w-full text-center text-xs text-fg-muted hover:text-fg transition"
        >
          Esqueci minha senha
        </Link>
      )}

      <button
        type="button"
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        className="w-full text-xs text-fg-muted hover:text-fg transition"
      >
        {mode === "signin"
          ? "Não tem conta? Criar agora"
          : "Já tem conta? Entrar"}
      </button>
    </form>
  );
}
