"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AtSign, FolderKanban, Hash, Search } from "lucide-react";
import { initials } from "@/lib/utils";
import type { Project, Task, UserProfile } from "@/lib/types";

interface Props {
  kind: "user" | "task" | null;
  users: UserProfile[];
  tasks: Task[];
  projects: Project[];
  onPick: (kind: "user" | "task", id: string, label: string) => void;
  onClose: () => void;
}

export function MentionPicker({
  kind,
  users,
  tasks,
  projects,
  onPick,
  onClose
}: Props) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (kind) {
      setQ("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [kind]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (kind) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kind, onClose]);

  const filteredUsers = useMemo(() => {
    if (kind !== "user") return [];
    const query = q.toLowerCase();
    return users.filter(
      (u) =>
        u.nome.toLowerCase().includes(query) ||
        u.email.toLowerCase().includes(query)
    );
  }, [kind, users, q]);

  // Agrupa tarefas por projeto
  const groupedTasks = useMemo(() => {
    if (kind !== "task") return [] as Array<{ project: Project | null; tasks: Task[] }>;
    const query = q.trim().toLowerCase();
    const filtered = tasks.filter((t) =>
      query ? t.titulo.toLowerCase().includes(query) : true
    );
    const byProject = new Map<string, Task[]>();
    for (const t of filtered) {
      const key = t.project_id ?? "_none";
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key)!.push(t);
    }
    const activeProjects = projects.filter((p) => p.status === "ativo");
    const groups: Array<{ project: Project | null; tasks: Task[] }> = [];
    for (const p of activeProjects) {
      const arr = byProject.get(p.id);
      if (arr && arr.length > 0) groups.push({ project: p, tasks: arr });
    }
    const orphan = byProject.get("_none");
    if (orphan && orphan.length > 0) groups.push({ project: null, tasks: orphan });
    return groups;
  }, [kind, tasks, projects, q]);

  if (!kind) return null;

  const totalTasks = groupedTasks.reduce((s, g) => s + g.tasks.length, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-xl bg-bg-subtle border border-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          {kind === "user" ? (
            <AtSign className="w-4 h-4 text-brand" />
          ) : (
            <Hash className="w-4 h-4 text-brand" />
          )}
          <Search className="w-3.5 h-3.5 text-fg-subtle" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={
              kind === "user" ? "Buscar pessoa..." : "Buscar tarefa..."
            }
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-fg-subtle"
          />
          {kind === "task" && (
            <span className="text-[10px] text-fg-subtle">{totalTasks} tarefa(s)</span>
          )}
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {kind === "user" ? (
            filteredUsers.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-fg-subtle">
                Ninguém encontrado.
              </p>
            ) : (
              <ul className="py-1">
                {filteredUsers.map((u) => (
                  <li key={u.id}>
                    <button
                      onClick={() => onPick("user", u.id, u.nome)}
                      className="w-full flex items-center gap-3 px-4 py-2 hover:bg-bg-muted text-left"
                    >
                      <div className="w-7 h-7 rounded-full bg-brand/20 text-brand flex items-center justify-center text-[10px] font-bold uppercase">
                        {initials(u.nome)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{u.nome}</p>
                        <p className="text-[10px] text-fg-subtle truncate">
                          {u.cargo || u.email}
                        </p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : groupedTasks.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-fg-subtle">
              Nenhuma tarefa encontrada.
            </p>
          ) : (
            <div className="py-1">
              {groupedTasks.map((g, idx) => (
                <div key={g.project?.id ?? `none-${idx}`}>
                  <div className="px-4 pt-3 pb-1 sticky top-0 bg-bg-subtle/95 backdrop-blur z-10 flex items-center gap-2 border-b border-border">
                    <FolderKanban
                      className="w-3.5 h-3.5"
                      style={{ color: g.project?.cor ?? "#94a3b8" }}
                    />
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                      {g.project?.nome ?? "Sem projeto"}
                    </p>
                    <span className="text-[10px] text-fg-subtle">
                      {g.tasks.length}
                    </span>
                  </div>
                  <ul>
                    {g.tasks.map((t) => (
                      <li key={t.id}>
                        <button
                          onClick={() => onPick("task", t.id, t.titulo)}
                          className="w-full flex items-center gap-3 px-4 py-2 hover:bg-bg-muted text-left"
                        >
                          <Hash className="w-3.5 h-3.5 text-fg-subtle" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {t.titulo}
                            </p>
                            <p className="text-[10px] text-fg-subtle truncate">
                              {t.status} · {t.prioridade}
                            </p>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-border text-[10px] text-fg-subtle">
          Esc para fechar
        </div>
      </div>
    </div>
  );
}
