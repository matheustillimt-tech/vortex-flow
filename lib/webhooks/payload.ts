import { PRIORITY_LABEL, type TaskPriority } from "@/lib/types";
import { toBrasiliaDateInputValue } from "@/lib/utils";

/**
 * JSON enviado à ferramenta de disparo de WhatsApp. A ferramenta monta a
 * mensagem; aqui só entregamos os dados, já formatados para leitura.
 */

export type WebhookEvento = "tarefa.atribuida" | "teste";

export interface DadosEntrega {
  responsavel: { id: string; nome: string; whatsapp: string };
  tarefa: {
    id: string;
    titulo: string;
    descricao: string | null;
    prioridade: TaskPriority;
    /** timestamptz em ISO, como vem do banco. */
    prazo: string | null;
    prazoTemHora: boolean;
  };
  projeto: { id: string; nome: string } | null;
  atribuidoPorNome: string | null;
}

export interface WebhookPayload {
  evento: WebhookEvento;
  /** Id da linha em webhook_entregas — permite a ferramenta de disparo deduplicar reentregas (at-least-once). Null no evento de teste. */
  entrega_id: string | null;
  enviado_em: string;
  responsavel: { id: string; nome: string; whatsapp: string };
  tarefa: {
    id: string;
    titulo: string;
    descricao: string | null;
    prioridade: TaskPriority;
    prioridade_label: string;
    prazo: string | null;
    prazo_formatado: string | null;
    link: string;
    link_projeto: string | null;
  };
  projeto: { id: string; nome: string } | null;
  atribuido_por: { nome: string } | null;
}

const FUSO = "America/Sao_Paulo";

/** ISO 8601 com o offset de Brasília (sem horário de verão desde 2019). */
function horarioBrasilia(d: Date): string {
  return new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 19) + "-03:00";
}

function horaBrasilia(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(iso));
}

export function montarPayload(
  evento: WebhookEvento,
  dados: DadosEntrega,
  opts: { agora: Date; appUrl: string; entregaId?: string | null }
): WebhookPayload {
  const base = opts.appUrl.replace(/\/+$/, "");
  const { tarefa, projeto } = dados;

  const prazo = tarefa.prazo ? toBrasiliaDateInputValue(tarefa.prazo) : null;
  let prazoFormatado: string | null = null;
  if (tarefa.prazo && prazo) {
    const [a, m, d] = prazo.split("-");
    prazoFormatado = `${d}/${m}/${a}`;
    if (tarefa.prazoTemHora) prazoFormatado += ` às ${horaBrasilia(tarefa.prazo)}`;
  }

  return {
    evento,
    entrega_id: opts.entregaId ?? null,
    enviado_em: horarioBrasilia(opts.agora),
    responsavel: dados.responsavel,
    tarefa: {
      id: tarefa.id,
      titulo: tarefa.titulo,
      descricao: tarefa.descricao?.trim() ? tarefa.descricao : null,
      prioridade: tarefa.prioridade,
      prioridade_label: PRIORITY_LABEL[tarefa.prioridade],
      prazo,
      prazo_formatado: prazoFormatado,
      link: `${base}/minha-area?task=${tarefa.id}`,
      link_projeto: projeto ? `${base}/projetos/${projeto.id}` : null
    },
    projeto,
    atribuido_por: dados.atribuidoPorNome ? { nome: dados.atribuidoPorNome } : null
  };
}
