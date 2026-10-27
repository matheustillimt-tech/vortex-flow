"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Eye,
  Globe2,
  KeyRound,
  MapPin,
  RefreshCw,
  Search,
  ShieldX,
  Trash2,
  User,
  Webhook,
  Wrench
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/input";
import type { ActivityAction, ActivityLog } from "@/lib/types";

const ACTION_META: Record<
  ActivityAction,
  { label: string; color: string; icon: React.ComponentType<{ className?: string }> }
> = {
  tools_page_open: {
    label: "Abriu Ferramentas",
    color: "bg-status-progress/15 text-status-progress",
    icon: Eye
  },
  tool_view_attempt: {
    label: "Tentativa de acesso",
    color: "bg-priority-medium/15 text-priority-medium",
    icon: KeyRound
  },
  tool_view_success: {
    label: "Credenciais reveladas",
    color: "bg-status-done/15 text-status-done",
    icon: CheckCircle2
  },
  tool_view_failed_totp: {
    label: "Falha no 2FA",
    color: "bg-priority-urgent/15 text-priority-urgent",
    icon: ShieldX
  },
  tool_created: {
    label: "Ferramenta criada",
    color: "bg-brand-subtle text-brand",
    icon: Wrench
  },
  tool_updated: {
    label: "Ferramenta editada",
    color: "bg-brand-subtle text-brand",
    icon: Wrench
  },
  tool_deleted: {
    label: "Ferramenta excluída",
    color: "bg-priority-urgent/15 text-priority-urgent",
    icon: Trash2
  },
  tool_users_changed: {
    label: "Permissões alteradas",
    color: "bg-priority-medium/15 text-priority-medium",
    icon: User
  },
  webhook_updated: {
    label: "Webhook alterado",
    color: "bg-brand-subtle text-brand",
    icon: Webhook
  }
};

const ACTION_FILTERS: Array<{ value: ActivityAction | ""; label: string }> = [
  { value: "", label: "Todas as ações" },
  { value: "tools_page_open", label: "Abriu Ferramentas" },
  { value: "tool_view_attempt", label: "Tentativa de acesso" },
  { value: "tool_view_success", label: "Credenciais reveladas" },
  { value: "tool_view_failed_totp", label: "Falha no 2FA" },
  { value: "tool_created", label: "Ferramenta criada" },
  { value: "tool_updated", label: "Ferramenta editada" },
  { value: "tool_deleted", label: "Ferramenta excluída" },
  { value: "tool_users_changed", label: "Permissões alteradas" },
  { value: "webhook_updated", label: "Webhook alterado" }
];

export function ActivityLogsView({
  headerless = false
}: { headerless?: boolean } = {}) {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState<ActivityAction | "">("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter, from, to]);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "500" });
      if (actionFilter) params.set("action", actionFilter);
      if (from) params.set("from", new Date(from).toISOString());
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        params.set("to", end.toISOString());
      }
      const res = await fetch(`/api/admin/activity-logs?${params}`, {
        cache: "no-store"
      });
      const json = (await res.json()) as { logs?: ActivityLog[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Falha");
      setLogs(json.logs ?? []);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter((l) => {
      const hay = [
        l.user_nome,
        l.user_email,
        l.tool_nome,
        l.ip_address,
        l.city,
        l.country
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [logs, search]);

  return (
    <>
      {!headerless && (
        <PageHeader
          title="Registro de atividades"
          subtitle="Auditoria de tudo que acontece na área de Ferramentas — quem viu, quando, de onde."
          actions={
            <button
              onClick={() => void load()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-bg-subtle border border-border hover:border-border-strong text-fg-muted hover:text-fg transition"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Atualizar
            </button>
          }
        />
      )}
      {headerless && (
        <div className="px-6 pt-4 flex items-center justify-end">
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-bg-subtle border border-border hover:border-border-strong text-fg-muted hover:text-fg transition"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Atualizar
          </button>
        </div>
      )}

      <div className="px-6 pt-4 grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
        <div className="md:col-span-4">
          <label className="block text-[10px] uppercase tracking-wider text-fg-subtle mb-1">
            Buscar
          </label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nome, email, IP, cidade, ferramenta..."
              className="pl-8"
            />
          </div>
        </div>
        <div className="md:col-span-3">
          <label className="block text-[10px] uppercase tracking-wider text-fg-subtle mb-1">
            Ação
          </label>
          <Select
            value={actionFilter}
            onChange={(e) =>
              setActionFilter(e.target.value as ActivityAction | "")
            }
          >
            {ACTION_FILTERS.map((a) => (
              <option key={a.value || "all"} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="md:col-span-2">
          <label className="block text-[10px] uppercase tracking-wider text-fg-subtle mb-1">
            De
          </label>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-[10px] uppercase tracking-wider text-fg-subtle mb-1">
            Até
          </label>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className="md:col-span-1 text-right text-xs text-fg-subtle">
          {filteredLogs.length}
        </div>
      </div>

      <div className="p-6">
        {loading ? (
          <p className="text-sm text-fg-muted">Carregando logs...</p>
        ) : filteredLogs.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="Nada por aqui"
            description="Nenhum evento registrado para os filtros selecionados."
          />
        ) : (
          <div className="bg-bg-subtle border border-border rounded-2xl overflow-hidden">
            <ul className="divide-y divide-border">
              {filteredLogs.map((l) => (
                <LogRow key={l.id} log={l} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}

function LogRow({ log }: { log: ActivityLog }) {
  const meta = ACTION_META[log.action] ?? {
    label: log.action,
    color: "bg-bg-muted text-fg-muted",
    icon: Activity
  };
  const Icon = meta.icon;
  const isFail = log.action === "tool_view_failed_totp";
  return (
    <li
      className={`px-5 py-3 flex items-start gap-3 hover:bg-bg-muted/40 transition ${
        isFail ? "bg-priority-urgent/[0.04]" : ""
      }`}
    >
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${meta.color}`}
      >
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${meta.color}`}>
            {meta.label}
          </span>
          {log.tool_nome && (
            <span className="inline-flex items-center gap-1 text-xs text-fg">
              <Wrench className="w-3 h-3" />
              {log.tool_nome}
            </span>
          )}
          <span className="text-[10px] text-fg-subtle ml-auto">
            {formatDate(log.created_at)}
          </span>
        </div>
        <div className="mt-1.5 text-sm">
          <span className="font-medium">{log.user_nome ?? "?"}</span>
          {log.user_email && (
            <span className="text-fg-subtle"> · {log.user_email}</span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-fg-muted">
          {log.ip_address && (
            <span className="inline-flex items-center gap-1">
              <Globe2 className="w-3 h-3" />
              <span className="font-mono">{log.ip_address}</span>
            </span>
          )}
          {(log.city || log.region || log.country) && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {[log.city, log.region, log.country].filter(Boolean).join(", ")}
            </span>
          )}
          {log.latitude != null && log.longitude != null && (
            <a
              href={`https://www.google.com/maps?q=${log.latitude},${log.longitude}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-brand hover:underline"
            >
              <MapPin className="w-3 h-3" />
              {log.latitude.toFixed(4)}, {log.longitude.toFixed(4)} ↗
            </a>
          )}
          {log.metadata && Object.keys(log.metadata).length > 0 && (
            <details className="text-fg-subtle">
              <summary className="cursor-pointer hover:text-fg">detalhes</summary>
              <pre className="mt-1 text-[10px] bg-bg-muted/60 p-2 rounded max-w-md overflow-x-auto">
                {JSON.stringify(log.metadata, null, 2)}
              </pre>
            </details>
          )}
        </div>
        {log.user_agent && (
          <p className="mt-1 text-[10px] text-fg-subtle truncate" title={log.user_agent}>
            {log.user_agent}
          </p>
        )}
      </div>
    </li>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}
