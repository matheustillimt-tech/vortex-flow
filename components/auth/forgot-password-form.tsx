"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail, MailCheck } from "lucide-react";
import { toast } from "sonner";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) {
      toast.error("Digite um e-mail válido.");
      return;
    }
    setLoading(true);
    try {
      const r = await fetch("/api/usuarios/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() })
      });
      // O endpoint sempre devolve 200 (não revela se a conta existe).
      if (!r.ok) throw new Error("Falha ao processar pedido");
      setSent(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 p-4 bg-status-done/10 border border-status-done/30 rounded-lg">
          <MailCheck className="w-5 h-5 text-status-done mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-status-done">
              Pedido recebido
            </p>
            <p className="text-xs text-fg-muted mt-1 leading-relaxed">
              Se houver uma conta com esse e-mail, você receberá um link em
              instantes. <strong>Confira também a pasta de spam.</strong> O
              link expira em 1 hora.
            </p>
          </div>
        </div>
        <Link
          href="/login"
          className="block w-full text-center py-2.5 rounded-lg bg-bg border border-border hover:bg-bg-muted text-sm font-medium transition"
        >
          Voltar para o login
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
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full pl-9 pr-3.5 py-2.5 rounded-lg bg-bg border border-border focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 transition text-sm"
            placeholder="voce@empresa.com"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-white font-medium text-sm transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-brand/30"
      >
        {loading ? "Enviando..." : "Enviar link de redefinição"}
      </button>

      <Link
        href="/login"
        className="block w-full text-center text-xs text-fg-muted hover:text-fg transition"
      >
        ← Voltar para o login
      </Link>
    </form>
  );
}
