"use client";

import { useMemo, useState } from "react";
import { ListTodo, Users } from "lucide-react";
import { PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { PrazoBadge } from "@/components/ui/prazo-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { initials } from "@/lib/utils";
import type {
  Project,
  Task,
  TaskPriority,
  TaskStatus,
  UserProfile
} from "@/lib/types";

interface Props {
  tasks: Task[];
  users: UserProfile[];
  assignees: Map<string, string[]>;
  projectById: Map<string, Project>;
  onOpenTask: (id: string) => void;
}

type SortKey =
  | "titulo"
  | "projeto"
  | "responsavel"
  | "prazo"
  | "prioridade"
  | "status";

const STATUS_ORDER: Record<TaskStatus, number> = {
  pendente: 0,
  em_andamento: 1,
  em_revisao: 2,
  travado: 3,
  concluido: 4
};
const PRIOR_ORDER: Record<TaskPriority, number> = {
  urgente: 0,
  alta: 1,
  media: 2,
  baixa: 3
};

export function AllTasksList({
  tasks,
  users,
  assignees,
  projectById,
  onOpenTask
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("prazo");
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  function userOf(id: string) {
    return users.find((u) => u.id === id);
  }
  function projName(t: Task) {
    return t.project_id ? projectById.get(t.project_id)?.nome ?? "" : "";
  }
  function firstRespName(t: Task) {
    const arr = assignees.get(t.id) ?? [];
    const id = arr[0] ?? t.responsavel_id ?? "";
    return userOf(id)?.nome ?? "";
  }

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(k);
      setSortDir(1);
    }
  }

  const sorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const dir = sortDir;
      switch (sortKey) {
        case "titulo":
          return a.titulo.localeCompare(b.titulo) * dir;
        case "projeto":
          return projName(a).localeCompare(projName(b)) * dir;
        case "responsavel":
          return firstRespName(a).localeCompare(firstRespName(b)) * dir;
        case "prazo": {
          const av = a.prazo ? new Date(a.prazo).getTime() : Infinity;
          const bv = b.prazo ? new Date(b.prazo).getTime() : Infinity;
          return (av - bv) * dir;
        }
        case "prioridade":
          return (PRIOR_ORDER[a.prioridade] - PRIOR_ORDER[b.prioridade]) * dir;
        case "status":
          return (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) * dir;
        default:
          return 0;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, sortKey, sortDir, assignees, projectById]);

  if (tasks.length === 0) {
    return (
      <div className="p-8">
        <EmptyState
          icon={ListTodo}
          title="Nenhuma tarefa"
          description="Nada corresponde aos filtros selecionados."
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-bg-subtle border-b border-border z-10">
          <tr className="text-left text-fg-muted">
            <Th
              label="Status"
              active={sortKey === "status"}
              dir={sortDir}
              onClick={() => toggleSort("status")}
              className="w-32"
            />
            <Th
              label="Tarefa"
              active={sortKey === "titulo"}
              dir={sortDir}
              onClick={() => toggleSort("titulo")}
            />
            <Th
              label="Projeto"
              active={sortKey === "projeto"}
              dir={sortDir}
              onClick={() => toggleSort("projeto")}
              className="w-40"
            />
            <Th
              label="Responsável"
              active={sortKey === "responsavel"}
              dir={sortDir}
              onClick={() => toggleSort("responsavel")}
              className="w-36"
            />
            <Th
              label="Prazo"
              active={sortKey === "prazo"}
              dir={sortDir}
              onClick={() => toggleSort("prazo")}
              className="w-32"
            />
            <Th
              label="Prioridade"
              active={sortKey === "prioridade"}
              dir={sortDir}
              onClick={() => toggleSort("prioridade")}
              className="w-28"
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => {
            const project = t.project_id ? projectById.get(t.project_id) : null;
            const aIds = assignees.get(t.id) ?? [];
            const respIds = aIds.length
              ? aIds
              : t.responsavel_id
                ? [t.responsavel_id]
                : [];
            return (
              <tr
                key={t.id}
                onClick={() => onOpenTask(t.id)}
                className="border-b border-border hover:bg-bg-subtle/60 cursor-pointer"
              >
                <td className="px-3 py-2">
                  <StatusBadge value={t.status} />
                </td>
                <td className="px-3 py-2 text-fg">
                  {t.titulo}
                </td>
                <td className="px-3 py-2 text-fg-muted">
                  {project ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: project.cor || "#64748b" }}
                      />
                      <span className="truncate">{project.nome}</span>
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2">
                  {respIds.length === 0 ? (
                    <span className="inline-flex items-center gap-1 text-fg-subtle">
                      <Users className="w-3 h-3" /> —
                    </span>
                  ) : (
                    <div className="flex items-center -space-x-1.5">
                      {respIds.slice(0, 3).map((id) => {
                        const u = userOf(id);
                        if (!u) return null;
                        return (
                          <span
                            key={id}
                            className="w-5 h-5 rounded-full border-2 border-bg bg-brand/20 text-brand text-[9px] font-semibold flex items-center justify-center uppercase"
                            title={u.nome}
                          >
                            {initials(u.nome)}
                          </span>
                        );
                      })}
                      {respIds.length > 3 && (
                        <span className="w-5 h-5 rounded-full border-2 border-bg bg-bg-muted text-fg-muted text-[9px] font-semibold flex items-center justify-center">
                          +{respIds.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <PrazoBadge
                    prazo={t.prazo}
                    prazo_has_time={t.prazo_has_time}
                    status={t.status}
                  />
                </td>
                <td className="px-3 py-2">
                  <PriorityBadge value={t.prioridade} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  label,
  active,
  dir,
  onClick,
  className
}: {
  label: string;
  active: boolean;
  dir: 1 | -1;
  onClick: () => void;
  className?: string;
}) {
  return (
    <th
      className={`px-3 py-2 cursor-pointer select-none hover:text-fg font-medium ${
        className ?? ""
      }`}
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && (
          <span className="text-fg-subtle">{dir === 1 ? "↑" : "↓"}</span>
        )}
      </span>
    </th>
  );
}
