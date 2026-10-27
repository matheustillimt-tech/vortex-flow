"use client";

import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Hash
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Task } from "@/lib/types";
import { isOverdue } from "@/lib/utils";

interface Props {
  tasks: Task[];
}

/**
 * Card de "Saúde da empresa" no topo do dashboard.
 * Mostra: total / concluídas / pendentes no prazo / atrasadas
 * + medidor 0-100 com pesos: +1.5 concluída, +0.6 no prazo, -1.5 atrasada.
 */
export function HealthCard({ tasks }: Props) {
  const { total, done, onTrack, overdue, score, label, color } = useMemo(() => {
    const totalAll = tasks.length;
    const concluidas = tasks.filter((t) => t.status === "concluido").length;
    const atrasadas = tasks.filter((t) => isOverdue(t.prazo, t.status)).length;
    const noPrazo = tasks.filter(
      (t) => t.status !== "concluido" && !isOverdue(t.prazo, t.status)
    ).length;

    const wDone = 1.5;
    const wTrack = 0.6;
    const wOver = -1.5;
    let s = 100;
    if (totalAll > 0) {
      const score =
        concluidas * wDone + noPrazo * wTrack + atrasadas * wOver;
      const max = totalAll * wDone;
      const min = totalAll * wOver;
      const norm = (score - min) / (max - min);
      s = Math.round(Math.max(0, Math.min(1, norm)) * 100);
    }

    let lbl: string;
    let clr: string;
    if (s >= 85) {
      lbl = "Excelente";
      clr = "#10b981";
    } else if (s >= 65) {
      lbl = "Saudável";
      clr = "#34d399";
    } else if (s >= 45) {
      lbl = "Atenção";
      clr = "#eab308";
    } else if (s >= 25) {
      lbl = "Alerta";
      clr = "#f97316";
    } else {
      lbl = "Crítico";
      clr = "#ef4444";
    }

    return {
      total: totalAll,
      done: concluidas,
      onTrack: noPrazo,
      overdue: atrasadas,
      score: s,
      label: lbl,
      color: clr
    };
  }, [tasks]);

  return (
    <div className="bg-bg-subtle border border-border rounded-2xl overflow-hidden">
      <header className="px-5 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-fg-muted" />
          <h2 className="font-medium text-sm">Saúde da empresa</h2>
        </div>
        <span className="text-[10px] text-fg-subtle uppercase tracking-wider">
          Resumo operacional
        </span>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px]">
        {/* Métricas */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border">
          <Metric
            icon={Hash}
            label="Total"
            value={total}
            color="text-fg-muted"
            bg="bg-bg-subtle"
          />
          <Metric
            icon={CheckCircle2}
            label="Concluídas"
            value={done}
            color="text-status-done"
            bg="bg-bg-subtle"
          />
          <Metric
            icon={Clock}
            label="No prazo"
            value={onTrack}
            color="text-status-progress"
            bg="bg-bg-subtle"
          />
          <Metric
            icon={AlertTriangle}
            label="Atrasadas"
            value={overdue}
            color="text-priority-urgent"
            bg="bg-bg-subtle"
          />
        </div>

        {/* Medidor */}
        <div className="bg-bg-subtle border-l border-border px-5 py-4 flex items-center gap-4">
          <Gauge value={score} color={color} />
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-fg-subtle">
              Índice de saúde
            </p>
            <p
              className="text-2xl font-bold tabular-nums"
              style={{ color }}
            >
              {score}
              <span className="text-sm text-fg-subtle font-normal">/100</span>
            </p>
            <p
              className="text-xs font-semibold"
              style={{ color }}
            >
              {label}
            </p>
          </div>
        </div>
      </div>

      {total > 0 && (
        <div className="px-5 py-2 border-t border-border bg-bg-subtle/40">
          <BarStack done={done} onTrack={onTrack} overdue={overdue} total={total} />
        </div>
      )}
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  color,
  bg
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: string;
  bg: string;
}) {
  return (
    <div className={cn("px-5 py-4 flex items-center gap-3", bg)}>
      <div className={cn("w-10 h-10 rounded-xl bg-bg flex items-center justify-center", color)}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-xs text-fg-muted">{label}</p>
        <p className={cn("text-xl font-semibold tabular-nums", color)}>{value}</p>
      </div>
    </div>
  );
}

function Gauge({ value, color }: { value: number; color: string }) {
  const size = 80;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const dash = (circ * value) / 100;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgb(var(--border))"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ - dash}`}
          style={{ transition: "stroke-dasharray 600ms ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-lg font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function BarStack({
  done,
  onTrack,
  overdue,
  total
}: {
  done: number;
  onTrack: number;
  overdue: number;
  total: number;
}) {
  const pct = (n: number) => (n / total) * 100;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-bg-muted rounded-full overflow-hidden flex">
        <div
          className="h-full"
          style={{ width: `${pct(done)}%`, backgroundColor: "#10b981" }}
          title={`${done} concluídas`}
        />
        <div
          className="h-full"
          style={{ width: `${pct(onTrack)}%`, backgroundColor: "#3b82f6" }}
          title={`${onTrack} no prazo`}
        />
        <div
          className="h-full"
          style={{ width: `${pct(overdue)}%`, backgroundColor: "#ef4444" }}
          title={`${overdue} atrasadas`}
        />
      </div>
      <div className="flex items-center gap-3 text-[10px] text-fg-subtle shrink-0">
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-status-done" /> {pct(done).toFixed(0)}%
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-status-progress" /> {pct(onTrack).toFixed(0)}%
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-priority-urgent" /> {pct(overdue).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}
