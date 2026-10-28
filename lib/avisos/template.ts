/**
 * Texto dos avisos de WhatsApp. Cada evento tem um texto padrão e o
 * administrador pode trocar por um seu, usando os campos entre chaves.
 * Pode ser importado no navegador (prévia) e no servidor (envio).
 */

import { APP_NAME } from "@/lib/brand";

export type EventoAviso =
  | "tarefa.atribuida"
  | "tarefa.prazo"
  | "tarefa.atrasada"
  | "tarefa.comentario";

export const EVENTOS: { id: EventoAviso; titulo: string; descricao: string }[] = [
  {
    id: "tarefa.atribuida",
    titulo: "Nova tarefa",
    descricao: "Quando alguém vira responsável por uma tarefa."
  },
  {
    id: "tarefa.prazo",
    titulo: "Prazo chegando",
    descricao:
      "Às 08:00 do dia do prazo, para os responsáveis. Dá para marcar outros horários dentro de cada tarefa."
  },
  {
    id: "tarefa.atrasada",
    titulo: "Tarefa atrasada",
    descricao:
      "Todo dia às 08:00 enquanto não for concluída. No primeiro dia, quem criou a tarefa também recebe."
  },
  {
    id: "tarefa.comentario",
    titulo: "Novo comentário",
    descricao: "Para os responsáveis e para quem foi marcado com @Nome no comentário."
  }
];

export const TEMPLATES_PADRAO: Record<EventoAviso, string> = {
  "tarefa.atribuida":
    `Olá, {nome}! Você tem uma nova tarefa no ${APP_NAME}.\n\n` +
    "*{tarefa}*\nProjeto: {projeto}\nPrazo: {prazo}\nPrioridade: {prioridade}\nQuem passou: {quem_criou}\n\nAbrir: {link}",
  "tarefa.prazo":
    "{nome}, lembrete da tarefa *{tarefa}*.\nPrazo: {prazo}\nProjeto: {projeto}\n\nAbrir: {link}",
  "tarefa.atrasada":
    "{nome}, a tarefa *{tarefa}* está atrasada há {dias_atraso} dia(s). O prazo era {prazo}.\nProjeto: {projeto}\n\nAbrir: {link}",
  "tarefa.comentario":
    "{nome}, {quem_criou} comentou na tarefa *{tarefa}*:\n\n\"{comentario}\"\n\nAbrir: {link}"
};

export type ChaveCampo =
  | "nome"
  | "tarefa"
  | "prazo"
  | "prioridade"
  | "projeto"
  | "link"
  | "quem_criou"
  | "comentario"
  | "dias_atraso";

export const CAMPOS: { chave: ChaveCampo; descricao: string }[] = [
  { chave: "nome", descricao: "Primeiro nome de quem recebe" },
  { chave: "tarefa", descricao: "Título da tarefa" },
  { chave: "prazo", descricao: "Prazo da tarefa" },
  { chave: "prioridade", descricao: "Prioridade" },
  { chave: "projeto", descricao: "Projeto" },
  { chave: "link", descricao: "Link que abre a tarefa" },
  { chave: "quem_criou", descricao: "Quem passou a tarefa ou comentou" },
  { chave: "comentario", descricao: "Texto do comentário" },
  { chave: "dias_atraso", descricao: "Dias de atraso" }
];

export type CamposMensagem = Partial<Record<ChaveCampo, string | number | null>>;

export const EXEMPLO_CAMPOS: Record<ChaveCampo, string> = {
  nome: "Ana",
  tarefa: "Criar os criativos da campanha",
  prazo: "25/09/2026 às 18:00",
  prioridade: "Alta",
  projeto: "Lançamento de Setembro",
  link: "https://seu-flow.com/minha-area?task=123",
  quem_criou: "Bruno",
  comentario: "Subi a primeira versão, pode revisar?",
  dias_atraso: "2"
};

export function renderTemplate(texto: string, campos: CamposMensagem): string {
  const dados = campos as Record<string, string | number | null | undefined>;
  const pronto = texto.replace(/\{\s*([a-z_]+)\s*\}/g, (_, chave: string) => {
    const v = dados[chave];
    return v === null || v === undefined ? "" : String(v);
  });
  return pronto.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n").trim();
}

export function textoDoEvento(
  evento: EventoAviso,
  templates: Partial<Record<EventoAviso, string>> | null | undefined
): string {
  const salvo = templates?.[evento];
  return typeof salvo === "string" && salvo.trim() ? salvo : TEMPLATES_PADRAO[evento];
}

export function eventosAtivosPadrao(): Record<EventoAviso, boolean> {
  return {
    "tarefa.atribuida": true,
    "tarefa.prazo": true,
    "tarefa.atrasada": true,
    "tarefa.comentario": true
  };
}

export function ehEventoAviso(v: unknown): v is EventoAviso {
  return typeof v === "string" && EVENTOS.some((e) => e.id === v);
}
