import { PRIORITY_LABEL, type TaskPriority } from "@/lib/types";
import { toBrasiliaDateInputValue } from "@/lib/utils";
import { APP_NAME } from "@/lib/brand";
import {
  renderTemplate,
  textoDoEvento,
  type CamposMensagem,
  type EventoAviso
} from "@/lib/avisos/template";

/**
 * Dados de um aviso. No canal webhook vão inteiros como JSON (com `mensagem`
 * já montada); nos canais CRM e Z-API só a `mensagem` vai para o WhatsApp.
 */

export type WebhookEvento = EventoAviso | "teste";

export const MENSAGEM_TESTE =
  `Teste do ${APP_NAME}: se esta mensagem chegou, os avisos no WhatsApp estão funcionando.`;

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
  /** Quem atribuiu, comentou ou criou a tarefa (conforme o evento). */
  atribuidoPorNome: string | null;
  /** tarefa.comentario */
  comentario?: string | null;
  /** tarefa.atrasada */
  diasAtraso?: number | null;
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
  comentario: string | null;
  dias_atraso: number | null;
  /** Texto pronto, montado pelo template do evento. */
  mensagem: string;
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
  opts: {
    agora: Date;
    appUrl: string;
    entregaId?: string | null;
    templates?: Partial<Record<EventoAviso, string>> | null;
  }
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

  const semMensagem: Omit<WebhookPayload, "mensagem"> = {
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
    atribuido_por: dados.atribuidoPorNome ? { nome: dados.atribuidoPorNome } : null,
    comentario: dados.comentario?.trim() ? dados.comentario : null,
    dias_atraso: typeof dados.diasAtraso === "number" ? dados.diasAtraso : null
  };
  const mensagem =
    evento === "teste"
      ? MENSAGEM_TESTE
      : renderTemplate(textoDoEvento(evento, opts.templates), camposDaMensagem(semMensagem));
  return { ...semMensagem, mensagem };
}

/** Valores dos campos {nome}, {tarefa}... a partir do payload. */
export function camposDaMensagem(p: Omit<WebhookPayload, "mensagem">): CamposMensagem {
  return {
    nome: p.responsavel.nome.split(" ")[0] || p.responsavel.nome,
    tarefa: p.tarefa.titulo,
    prazo: p.tarefa.prazo_formatado,
    prioridade: p.tarefa.prioridade_label,
    projeto: p.projeto?.nome ?? null,
    link: p.tarefa.link,
    quem_criou: p.atribuido_por?.nome ?? null,
    comentario: p.comentario,
    dias_atraso: p.dias_atraso
  };
}
