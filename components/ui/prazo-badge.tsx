"use client";

import {
  AlertTriangle,
  Calendar,
  CalendarOff,
  CheckCircle2,
  Clock
} from "lucide-react";
import {
  formatPrazo,
  relativePrazoLabel,
  type PrazoLabel
} from "@/lib/utils";

interface Props {
  prazo: string | null | undefined;
  prazo_has_time?: boolean | null;
  status?: string;
  /** Versão compacta (inline numa linha). */
  size?: "sm" | "md";
}

const TONE_CLS: Record<PrazoLabel["tone"], string> = {
  danger:
    "bg-priority-urgent/15 text-priority-urgent border-priority-urgent/30",
  warn:
    "bg-priority-medium/15 text-priority-medium border-priority-medium/30",
  info: "bg-status-progress/15 text-status-progress border-status-progress/30",
  muted: "bg-bg-muted text-fg-muted border-border",
  done: "bg-status-done/15 text-status-done border-status-done/30"
};

function iconFor(tone: PrazoLabel["tone"], hasPrazo: boolean) {
  if (!hasPrazo) return CalendarOff;
  if (tone === "danger") return AlertTriangle;
  if (tone === "warn") return Clock;
  if (tone === "done") return CheckCircle2;
  return Calendar;
}

/**
 * Pill destacada com o prazo de uma tarefa. Mostra o label relativo
 * em destaque ("Atrasada há 3 dias", "Hoje", "Amanhã", "Em N dias")
 * e a data formatada logo abaixo.
 */
export function PrazoBadge({ prazo, prazo_has_time, status, size = "md" }: Props) {
  const label = relativePrazoLabel(prazo, status);
  const Icon = iconFor(label.tone, !!prazo);
  const isSm = size === "sm";
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-lg border ${
        TONE_CLS[label.tone]
      } ${isSm ? "px-2 py-1" : "px-2.5 py-1.5"} shrink-0`}
      title={prazo ? formatPrazo(prazo, prazo_has_time) : "Sem prazo definido"}
    >
      <Icon
        className={`${isSm ? "w-3 h-3" : "w-3.5 h-3.5"} shrink-0`}
        strokeWidth={2.25}
      />
      <div className="leading-tight">
        <p
          className={`${
            isSm ? "text-[10px]" : "text-[11px]"
          } font-semibold uppercase tracking-wider whitespace-nowrap`}
        >
          {label.text}
        </p>
        {prazo && (
          <p
            className={`${
              isSm ? "text-[9px]" : "text-[10px]"
            } opacity-75 whitespace-nowrap`}
          >
            {formatPrazo(prazo, prazo_has_time)}
          </p>
        )}
      </div>
    </div>
  );
}
