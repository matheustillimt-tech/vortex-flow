import { montarPayload, type DadosEntrega } from "@/lib/webhooks/payload";
import type { FetchLike } from "@/lib/webhooks/send";
import { canalPronto, enviarPeloCanal, normalizarConfig, type ConfigCanais } from "@/lib/webhooks/canais";

export { normalizarConfig };
import { ehEventoAviso, type EventoAviso } from "@/lib/avisos/template";

/**
 * Envia o lote de entregas pendentes. O acesso ao banco fica atrás de
 * WebhookRepo para as regras de status serem testadas sem Supabase.
 */

export const MAX_TENTATIVAS = 3;
/** 5 × 10 s de timeout cabe no maxDuration = 60 da rota. */
export const LOTE = 5;

export type StatusEntrega = "pendente" | "processando" | "enviado" | "erro" | "sem_telefone" | "cancelado";

export interface EntregaReservada {
  id: string;
  task_id: string;
  user_id: string;
  atribuido_por: string | null;
  /** Já inclui a tentativa atual (a reserva incrementa). */
  tentativas: number;
  /** Ausente nas linhas antigas: vale tarefa.atribuida. */
  evento?: EventoAviso | string | null;
  payload_extra?: Record<string, unknown> | null;
}

/** Segredos já descriptografados. Campos ausentes = canal webhook (formato de 051). */
export type WebhookConfigLida = Partial<ConfigCanais> & {
  url: string | null;
  token: string | null;
  ativo: boolean;
  templates?: Partial<Record<EventoAviso, string>> | null;
};

export function eventoDa(e: Pick<EntregaReservada, "evento">): EventoAviso {
  return ehEventoAviso(e.evento) ? e.evento : "tarefa.atribuida";
}

export interface Finalizacao {
  status: StatusEntrega;
  http_status: number | null;
  erro: string | null;
  enviado_em: string | null;
}

export interface WebhookRepo {
  lerConfig(): Promise<WebhookConfigLida | null>;
  reservarPendentes(limite: number): Promise<EntregaReservada[]>;
  /**
   * null: tarefa ou pessoa não existe mais; "sem_telefone": número apagado;
   * "cancelada": prazo/atraso de tarefa que já foi concluída.
   */
  carregarDados(e: EntregaReservada): Promise<DadosEntrega | "sem_telefone" | "cancelada" | null>;
  finalizar(id: string, f: Finalizacao): Promise<void>;
}

/** Determina o status após uma falha, respeitando o limite de tentativas. */
function statusAposFailure(tentativas: number): StatusEntrega {
  return tentativas >= MAX_TENTATIVAS ? "erro" : "pendente";
}

export async function despacharPendentes(
  repo: WebhookRepo,
  opts: { appUrl: string; fetchImpl?: FetchLike; agora?: () => Date }
): Promise<{ processadas: number }> {
  const agora = opts.agora ?? (() => new Date());
  const cfg = await repo.lerConfig();
  if (!cfg || !cfg.ativo) return { processadas: 0 };
  const canal = normalizarConfig(cfg);
  if (!canalPronto(canal)) return { processadas: 0 };

  const lote = await repo.reservarPendentes(LOTE);
  for (const entrega of lote) {
    /** true assim que o envio deu certo — a partir daí nunca mais regredimos o status. */
    let postOk = false;
    try {
      const dados = await repo.carregarDados(entrega);
      if (dados === null) {
        await repo.finalizar(entrega.id, {
          status: "erro",
          http_status: null,
          erro: "Tarefa ou responsável não encontrado.",
          enviado_em: null
        });
        continue;
      }
      if (dados === "cancelada") {
        await repo.finalizar(entrega.id, {
          status: "cancelado",
          http_status: null,
          erro: "A tarefa foi concluída antes do envio.",
          enviado_em: null
        });
        continue;
      }
      if (dados === "sem_telefone") {
        await repo.finalizar(entrega.id, {
          status: "sem_telefone",
          http_status: null,
          erro: null,
          enviado_em: null
        });
        continue;
      }

      const quando = agora();
      const payload = montarPayload(eventoDa(entrega), dados, {
        agora: quando,
        appUrl: opts.appUrl,
        entregaId: entrega.id,
        templates: cfg.templates
      });
      const r = await enviarPeloCanal(
        canal,
        { telefone: dados.responsavel.whatsapp },
        payload.mensagem,
        payload,
        { fetchImpl: opts.fetchImpl }
      );
      postOk = r.ok;
      await repo.finalizar(
        entrega.id,
        r.ok
          ? { status: "enviado", http_status: r.httpStatus, erro: null, enviado_em: quando.toISOString() }
          : {
              status: statusAposFailure(entrega.tentativas),
              http_status: r.httpStatus,
              erro: r.erro,
              enviado_em: null
            }
      );
    } catch (err) {
      if (postOk) {
        // A mensagem já saiu; só a gravação do resultado falhou.
        // Nunca regredir para pendente/erro aqui — isso reenviaria uma mensagem já entregue.
        console.error("[webhook] POST enviado, mas falhou ao gravar o resultado:", err);
        continue;
      }
      const erroMsg = err instanceof Error ? err.message : "Falha inesperada";
      try {
        await repo.finalizar(entrega.id, {
          status: statusAposFailure(entrega.tentativas),
          http_status: null,
          erro: erroMsg,
          enviado_em: null
        });
      } catch (finalizeErr) {
        console.error("[webhook] Falha ao finalizar entrega após erro:", finalizeErr);
      }
    }
  }
  return { processadas: lote.length };
}
