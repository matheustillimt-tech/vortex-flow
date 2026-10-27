"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, KeyRound, Shield } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";

export function ChangePasswordView() {
  const router = useRouter();
  const [me, setMe] = useState<{ email: string; password_changed: boolean } | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const supabase = createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }
    const { data } = await supabase
      .from("users")
      .select("email, password_changed")
      .eq("id", user.id)
      .maybeSingle();
    setMe(data as { email: string; password_changed: boolean } | null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 8) {
      toast.error("Senha deve ter no mínimo 8 caracteres.");
      return;
    }
    if (next !== confirmPw) {
      toast.error("As senhas não conferem.");
      return;
    }
    setSaving(true);
    const supabase = createClient();

    // Para users que ainda não trocaram, current = senha temporária (e nem validamos;
    // o Supabase já recusa repetir a mesma senha).
    // Para users já trocados, validamos a senha atual reautenticando.
    if (me?.password_changed) {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: me.email,
        password: current
      });
      if (signInErr) {
        setSaving(false);
        toast.error("Senha atual incorreta.");
        return;
      }
    }

    const { error } = await supabase.auth.updateUser({ password: next });
    if (error) {
      setSaving(false);
      // Caso clássico: usuário tem 2FA antigo e está com password_changed=false.
      // O Supabase recusa updateUser sem AAL2. Avisamos o admin via toast longo.
      if (error.message.includes("AAL2")) {
        toast.error(
          "Sua conta tem 2FA ativo. Peça a um admin para remover o 2FA antes de resetar a senha — ou use o link de Resetar do painel.",
          { duration: 10000 }
        );
      } else {
        toast.error("Falha ao atualizar: " + error.message);
      }
      return;
    }

    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from("users")
        .update({ password_changed: true })
        .eq("id", user.id);
    }

    // Invalida o cache de flags do middleware (cookie e qualquer variação)
    document.cookie = "vf-flags=; max-age=0; path=/";
    document.cookie = "vf-flags=; expires=Thu, 01 Jan 1970 00:00:01 GMT; path=/";

    toast.success("Senha atualizada com sucesso");
    setSaving(false);

    // Usa navegação full-page (não SPA) para garantir que o middleware
    // re-execute do zero com os cookies/flags atualizados.
    // Se ainda não ativou 2FA, vai direto para o setup; caso contrário, dashboard.
    const {
      data: { user: u }
    } = await supabase.auth.getUser();
    let nextPath = "/dashboard";
    if (u) {
      const { data: p } = await supabase
        .from("users")
        .select("mfa_enabled")
        .eq("id", u.id)
        .maybeSingle();
      if (!p?.mfa_enabled) nextPath = "/seguranca/2fa";
    }
    window.location.href = nextPath;
  }

  const firstChange = me && !me.password_changed;

  return (
    <div className="min-h-[calc(100vh-var(--topbar-h))] flex items-start justify-center p-6">
      <div className="w-full max-w-md mt-12">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-brand/15 text-brand flex items-center justify-center">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {firstChange ? "Defina sua senha" : "Trocar senha"}
            </h1>
            <p className="text-xs text-fg-muted">
              {firstChange
                ? "Primeiro acesso — escolha uma senha pessoal para continuar."
                : "Mantenha sua conta segura."}
            </p>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="bg-bg-subtle border border-border rounded-2xl p-5 space-y-4"
        >
          {!firstChange && (
            <FormField label="Senha atual">
              <div className="relative">
                <Input
                  type={show ? "text" : "password"}
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
            </FormField>
          )}

          <FormField label="Nova senha" hint="Mínimo 8 caracteres. Use uma senha diferente da temporária.">
            <div className="relative">
              <Input
                type={show ? "text" : "password"}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-fg-muted hover:text-fg"
                title={show ? "Ocultar" : "Mostrar"}
              >
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </FormField>

          <FormField label="Confirmar nova senha">
            <Input
              type={show ? "text" : "password"}
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </FormField>

          <Button type="submit" disabled={saving} className="w-full">
            {saving ? (
              "Salvando..."
            ) : (
              <>
                <KeyRound className="w-3.5 h-3.5" /> Atualizar senha
              </>
            )}
          </Button>
        </form>

        {firstChange && (
          <p className="text-[11px] text-fg-subtle mt-4 text-center">
            Você entrou com uma senha temporária. Após esta troca o acesso é seu.
          </p>
        )}
      </div>
    </div>
  );
}
