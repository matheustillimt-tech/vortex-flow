"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  fromWhatsappE164,
  maskTelefone,
  toWhatsappE164,
  validateWhatsapp
} from "@/lib/br-validations";

/**
 * O próprio colaborador cadastra ou troca o WhatsApp que recebe os avisos.
 * Fica numa tela pessoal (Conector do Claude), aberta a qualquer pessoa logada:
 * depois do cadastro completo não havia outro lugar para trocar o número.
 * A RLS de colaborador_dados (migration 046) libera a própria linha.
 */
export function MeuWhatsapp() {
  const [userId, setUserId] = useState<string | null>(null);
  const [numero, setNumero] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      const {
        data: { user }
      } = await supabase.auth.getUser();
      if (!user) {
        setCarregando(false);
        return;
      }
      setUserId(user.id);
      const { data } = await supabase
        .from("colaborador_dados")
        .select("whatsapp")
        .eq("user_id", user.id)
        .maybeSingle();
      setNumero(maskTelefone(fromWhatsappE164((data as { whatsapp: string | null } | null)?.whatsapp)));
      setCarregando(false);
    })();
  }, []);

  async function salvar() {
    const e = validateWhatsapp(numero);
    setErro(e);
    if (e || !userId) return;
    setSalvando(true);
    const { error } = await createClient()
      .from("colaborador_dados")
      .upsert({ user_id: userId, whatsapp: toWhatsappE164(numero) }, { onConflict: "user_id" });
    setSalvando(false);
    if (error) {
      toast.error("Não foi possível salvar: " + error.message);
      return;
    }
    toast.success("WhatsApp salvo. Os avisos de tarefas vão para esse número.");
  }

  return (
    <section className="bg-bg-subtle border border-border rounded-xl p-4">
      <h2 className="text-sm font-semibold text-fg mb-1">Seu WhatsApp para avisos</h2>
      <p className="text-xs text-fg-muted mb-3">
        É para esse número que o sistema manda os avisos de tarefa nova, prazo, atraso e comentário.
      </p>
      {carregando ? (
        <Loader2 className="w-4 h-4 animate-spin text-fg-subtle" />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="meu-whatsapp" className="sr-only">
            Seu WhatsApp
          </label>
          <input
            id="meu-whatsapp"
            value={numero}
            onChange={(e) => setNumero(maskTelefone(e.target.value))}
            placeholder="(00) 00000-0000"
            inputMode="tel"
            className="h-8 w-44 rounded-md border border-border bg-bg px-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={salvando}
            className="h-8 px-3 rounded-md bg-brand hover:bg-brand-hover text-white text-xs font-medium disabled:opacity-60"
          >
            {salvando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Salvar WhatsApp"}
          </button>
          {erro && <span className="text-xs text-priority-urgent">{erro}</span>}
        </div>
      )}
    </section>
  );
}
