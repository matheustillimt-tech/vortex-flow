"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { fromBrasiliaInputValue } from "@/lib/utils";

interface Lembrete {
  id: string;
  horario: string;
}

interface Props {
  taskId: string;
  userId: string | null;
  temPrazo: boolean;
  lembretePadrao: boolean;
  /** Ligar/desligar o das 08:00 grava na tarefa: precisa de Editar. */
  podeEditarTarefa: boolean;
  /** Quem criou a tarefa ou quem pode editar (mesma regra do banco). */
  podeAdicionar: boolean;
  onChangePadrao: (v: boolean) => void;
}

function formatar(iso: string): string {
  const p = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("day")}/${g("month")}/${g("year")} às ${g("hour")}:${g("minute")}`;
}

/** Lembretes da tarefa no WhatsApp: o das 08:00 do dia do prazo e horários extras. */
export function TaskReminders({
  taskId,
  userId,
  temPrazo,
  lembretePadrao,
  podeEditarTarefa,
  podeAdicionar,
  onChangePadrao
}: Props) {
  const [lembretes, setLembretes] = useState<Lembrete[]>([]);
  const [novo, setNovo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void createClient()
      .from("task_lembretes")
      .select("id, horario")
      .eq("task_id", taskId)
      .order("horario")
      .then(({ data }) => {
        if (vivo) setLembretes((data as Lembrete[]) ?? []);
      });
    return () => {
      vivo = false;
    };
  }, [taskId]);

  async function adicionar() {
    const horario = fromBrasiliaInputValue(novo);
    if (!horario || !userId) return;
    if (new Date(horario).getTime() <= Date.now()) {
      setErro("Escolha um horário no futuro.");
      return;
    }
    setErro(null);
    setSalvando(true);
    const { data, error } = await createClient()
      .from("task_lembretes")
      .insert({ task_id: taskId, horario, criado_por: userId })
      .select("id, horario")
      .single();
    setSalvando(false);
    if (error || !data) {
      toast.error(
        error?.message?.includes("duplicate")
          ? "Já existe um lembrete nesse horário."
          : "Não foi possível adicionar o lembrete."
      );
      return;
    }
    setLembretes((l) => [...l, data as Lembrete].sort((a, b) => a.horario.localeCompare(b.horario)));
    setNovo("");
  }

  async function remover(id: string) {
    const antes = lembretes;
    setLembretes((l) => l.filter((x) => x.id !== id));
    // A RLS barra em silêncio (0 linhas): confere quantas saíram.
    const { error, count } = await createClient()
      .from("task_lembretes")
      .delete({ count: "exact" })
      .eq("id", id);
    if (error || count === 0) {
      setLembretes(antes);
      toast.error("Não foi possível remover o lembrete.");
    }
  }

  return (
    <div className="space-y-2 text-sm">
      <label className="flex items-start gap-2 text-fg">
        <input
          type="checkbox"
          className="mt-1"
          checked={lembretePadrao}
          disabled={!podeEditarTarefa}
          onChange={(e) => onChangePadrao(e.target.checked)}
        />
        <span>
          Avisar os responsáveis às 08:00 do dia do prazo
          {!temPrazo && (
            <span className="block text-[11px] text-fg-muted">
              Esse aviso só vale quando a tarefa tem prazo.
            </span>
          )}
        </span>
      </label>

      {lembretes.length > 0 && (
        <ul className="space-y-1">
          {lembretes.map((l) => {
            const quando = formatar(l.horario);
            return (
              <li key={l.id} className="flex items-center justify-between gap-2 text-xs text-fg">
                <span>{quando}</span>
                {podeAdicionar && (
                  <button
                    type="button"
                    aria-label={`Remover lembrete de ${quando}`}
                    onClick={() => void remover(l.id)}
                    className="text-fg-subtle hover:text-priority-urgent"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {podeAdicionar && (
        <div className="flex items-center gap-2">
          <input
            type="datetime-local"
            aria-label="Novo lembrete"
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            className="h-8 flex-1 rounded-md border border-border bg-bg px-2 text-xs"
          />
          <button
            type="button"
            onClick={() => void adicionar()}
            disabled={!novo || salvando}
            className="h-8 px-3 rounded-md bg-brand hover:bg-brand-hover text-white text-xs font-medium disabled:opacity-60"
          >
            Adicionar
          </button>
        </div>
      )}
      {erro && <p className="text-xs text-priority-urgent">{erro}</p>}
      <p className="text-[11px] text-fg-subtle">
        Os lembretes vão pelo WhatsApp para os responsáveis, no horário de Brasília.
      </p>
    </div>
  );
}
