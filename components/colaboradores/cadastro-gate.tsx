"use client";

import { useEffect, useState } from "react";
import { ClipboardList, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ensureSectors } from "@/lib/cache";
import { CadastroForm } from "@/components/colaboradores/cadastro-form";
import type { Sector, UserProfile } from "@/lib/types";

interface Props {
  /** Vem do servidor: perfil ainda sem cadastro completo. */
  pending: boolean;
}

/**
 * Popup obrigatório de cadastro. Aparece no primeiro acesso de quem ainda
 * não preencheu os dados (users.cadastro_completo = false) e só fecha
 * depois de salvar — o financeiro depende desses dados.
 */
export function CadastroGate({ pending }: Props) {
  const [open, setOpen] = useState(pending);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function load() {
    setLoading(true);
    const supabase = createClient();
    const {
      data: { user: authUser }
    } = await supabase.auth.getUser();
    if (!authUser) {
      setOpen(false);
      return;
    }
    const [meRes, secs] = await Promise.all([
      supabase.from("users").select("*").eq("id", authUser.id).maybeSingle(),
      ensureSectors()
    ]);
    const me = meRes.data as UserProfile | null;
    // Se outro dispositivo já completou, não trava o usuário.
    if (me?.cadastro_completo) {
      setOpen(false);
      return;
    }
    setUser(me);
    setSectors(secs.filter((s) => s.status === "ativo"));
    setLoading(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-bg w-full max-w-2xl my-8 rounded-2xl border border-border shadow-2xl overflow-hidden">
        <header className="p-5 border-b border-border flex items-start gap-3 bg-bg-subtle">
          <div className="w-10 h-10 rounded-xl bg-brand/15 text-brand flex items-center justify-center shrink-0">
            <ClipboardList className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-fg">
              Complete seu cadastro
            </h2>
            <p className="text-xs text-fg-muted mt-0.5">
              Precisamos dos seus dados para o financeiro processar pagamentos.
              Leva menos de 2 minutos e é uma vez só.
            </p>
          </div>
        </header>

        <div className="p-5">
          {loading || !user ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-fg-subtle" />
            </div>
          ) : (
            <CadastroForm
              user={user}
              sectors={sectors}
              submitLabel="Concluir cadastro"
              onSaved={() => {
                setOpen(false);
                // Recarrega pra sidebar/topbar pegarem nome e foto novos.
                if (typeof window !== "undefined") window.location.reload();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
