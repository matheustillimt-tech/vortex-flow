"use client";

import { useEffect, useState } from "react";
import { Loader2, MessageCircle, X } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { maskTelefone, toWhatsappE164, validateWhatsapp } from "@/lib/br-validations";

const CHAVE = "vortex:whatsapp-banner-fechado";

interface Props {
  userId: string;
  /** Vem do servidor: cadastro completo, mas sem WhatsApp. */
  show: boolean;
}

/**
 * Aviso não bloqueante para quem completou o cadastro antes do campo
 * WhatsApp existir. O número é salvo aqui mesmo — depois de completo, o
 * colaborador não tem outra tela para editar o próprio cadastro.
 */
export function WhatsappBanner({ userId, show }: Props) {
  const [visivel, setVisivel] = useState(show);
  const [numero, setNumero] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(CHAVE) === "1") setVisivel(false);
    } catch {
      // sessionStorage bloqueado: o aviso só não lembra que foi fechado.
    }
  }, []);

  if (!visivel) return null;

  function fechar() {
    try {
      sessionStorage.setItem(CHAVE, "1");
    } catch {
      // idem
    }
    setVisivel(false);
  }

  async function salvar() {
    const e = validateWhatsapp(numero);
    setErro(e);
    if (e) return;
    setSalvando(true);
    const { error } = await createClient()
      .from("colaborador_dados")
      .upsert({ user_id: userId, whatsapp: toWhatsappE164(numero) }, { onConflict: "user_id" });
    setSalvando(false);
    if (error) {
      toast.error("Não foi possível salvar: " + error.message);
      return;
    }
    toast.success("WhatsApp salvo. Você vai receber os avisos de tarefas.");
    setVisivel(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-6 py-2.5 border-b border-border bg-brand-subtle text-sm">
      <MessageCircle className="w-4 h-4 text-brand shrink-0" />
      <span className="text-fg">Cadastre seu WhatsApp para receber avisos de novas tarefas.</span>
      <div className="flex items-center gap-2">
        <input
          value={numero}
          onChange={(e) => setNumero(maskTelefone(e.target.value))}
          placeholder="(00) 00000-0000"
          inputMode="tel"
          className="h-8 w-40 rounded-md border border-border bg-bg px-2 text-sm"
        />
        <button
          type="button"
          onClick={salvar}
          disabled={salvando}
          className="h-8 px-3 rounded-md bg-brand hover:bg-brand-hover text-white text-xs font-medium disabled:opacity-60"
        >
          {salvando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Salvar"}
        </button>
      </div>
      {erro && <span className="text-xs text-priority-urgent">{erro}</span>}
      <button
        type="button"
        onClick={fechar}
        aria-label="Fechar aviso"
        className="ml-auto text-fg-muted hover:text-fg"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
