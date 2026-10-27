import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo"
    });
  } catch {
    return value;
  }
}

/**
 * Formata data + hora em horário de Brasília (America/Sao_Paulo).
 * Ex: 14/05/2026 às 18:30
 */
export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  try {
    const d = new Date(value);
    const date = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const time = d.toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit"
    });
    return `${date} ${time}`;
  } catch {
    return value;
  }
}

/**
 * Formata prazo respeitando o flag `prazo_has_time`. Se `hasTime` for
 * false, mostra apenas a data; caso contrário, data + hora.
 */
export function formatPrazo(
  prazo: string | null | undefined,
  hasTime: boolean | null | undefined
): string {
  if (!prazo) return "—";
  return hasTime === false ? formatDate(prazo) : formatDateTime(prazo);
}

/**
 * Converte ISO (UTC) para string aceita por <input type="date">
 * no fuso de Brasília (sem fuso, "YYYY-MM-DD").
 */
export function toBrasiliaDateInputValue(
  iso: string | null | undefined
): string {
  if (!iso) return "";
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Converte "YYYY-MM-DD" do <input type="date"> para ISO UTC, fixando
 * o horário em 23:59:59 de Brasília (fim do dia).
 */
export function fromBrasiliaDateInputValue(
  local: string | null | undefined
): string | null {
  if (!local) return null;
  return new Date(`${local}T23:59:59-03:00`).toISOString();
}

/**
 * Converte ISO (UTC) para string aceita por <input type="datetime-local">
 * no fuso de Brasília (sem fuso, "YYYY-MM-DDTHH:mm").
 */
export function toBrasiliaInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  // Pega componentes no fuso de Brasília
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/**
 * Converte o valor do <input type="datetime-local"> (Brasília) de volta para
 * ISO UTC para enviar ao banco.
 */
export function fromBrasiliaInputValue(local: string | null | undefined): string | null {
  if (!local) return null;
  // local: "YYYY-MM-DDTHH:mm" interpretado como horário de Brasília (-03:00).
  // Brasília está em UTC-3 sem horário de verão (desde 2019).
  // Construímos string com offset e Date faz a conversão para UTC.
  return new Date(`${local}:00-03:00`).toISOString();
}

export function isOverdue(prazo: string | null | undefined, status?: string) {
  if (!prazo) return false;
  if (status === "concluido") return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(prazo) < today;
}

/** Inteiros do "número de dias entre hoje e o prazo" (em horário de Brasília).
 *  Negativo = passado. 0 = hoje. 1 = amanhã. */
function daysUntilBrasilia(iso: string): number {
  const parts = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    })
      .formatToParts(d)
      .reduce<Record<string, string>>((acc, p) => {
        if (p.type !== "literal") acc[p.type] = p.value;
        return acc;
      }, {});
  const now = parts(new Date());
  const due = parts(new Date(iso));
  const a = Date.UTC(+now.year, +now.month - 1, +now.day);
  const b = Date.UTC(+due.year, +due.month - 1, +due.day);
  return Math.round((b - a) / 86_400_000);
}

export interface PrazoLabel {
  text: string;
  /** Cor lógica para colorir o badge. */
  tone: "danger" | "warn" | "info" | "muted" | "done";
}

/** Devolve um label humano + tom para o prazo de uma tarefa. */
export function relativePrazoLabel(
  prazo: string | null | undefined,
  status?: string
): PrazoLabel {
  if (status === "concluido") return { text: "Concluída", tone: "done" };
  if (!prazo) return { text: "Sem prazo", tone: "muted" };
  const d = daysUntilBrasilia(prazo);
  if (d < -1) return { text: `Atrasada há ${Math.abs(d)} dias`, tone: "danger" };
  if (d === -1) return { text: "Atrasada · ontem", tone: "danger" };
  if (d === 0) return { text: "Hoje", tone: "warn" };
  if (d === 1) return { text: "Amanhã", tone: "info" };
  if (d <= 7) return { text: `Em ${d} dias`, tone: "info" };
  if (d <= 14) return { text: `Em ${d} dias`, tone: "muted" };
  if (d <= 30) return { text: `Em ${Math.round(d / 7)} semanas`, tone: "muted" };
  return { text: `Em ${Math.round(d / 30)} meses`, tone: "muted" };
}

export function initials(name?: string | null) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}
