"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, FolderKanban, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Project } from "@/lib/types";

interface Props {
  projects: Project[];
  currentId: string;
  /** se definido, sobrescreve o comportamento default de navegar */
  onSelect?: (project: Project) => void;
  size?: "sm" | "md";
}

export function ProjectSwitcher({ projects, currentId, onSelect, size = "md" }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const current = projects.find((p) => p.id === currentId);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtered = projects.filter((p) =>
    p.nome.toLowerCase().includes(q.toLowerCase())
  );

  function pick(p: Project) {
    setOpen(false);
    setQ("");
    if (onSelect) onSelect(p);
    else router.push(`/projetos/${p.id}`);
  }

  return (
    <div ref={wrapRef} className="relative min-w-0 max-w-full">
      <button
        onClick={() => setOpen((v) => !v)}
        title={current?.nome ?? "Selecionar projeto"}
        className={cn(
          "flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-border bg-bg hover:bg-bg-muted transition px-3",
          size === "sm" ? "h-8 text-xs" : "h-9 text-sm"
        )}
      >
        {current && (
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: current.cor }}
          />
        )}
        <span className="font-medium truncate max-w-[220px]">
          {current?.nome ?? "Selecionar projeto"}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-fg-subtle shrink-0" />
        <kbd className="ml-1 text-[10px] text-fg-subtle border border-border rounded px-1 py-px hidden sm:inline">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-80 max-w-[calc(100vw-5rem)] bg-bg-subtle border border-border rounded-xl shadow-2xl overflow-hidden animate-fadeIn">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Search className="w-3.5 h-3.5 text-fg-subtle" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar projeto..."
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-subtle"
            />
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-4 text-xs text-fg-subtle text-center">
                Nenhum projeto.
              </li>
            ) : (
              filtered.map((p) => {
                const active = p.id === currentId;
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => pick(p)}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-bg-muted transition",
                        active && "bg-brand-subtle/50"
                      )}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: p.cor }}
                      />
                      <FolderKanban className="w-3.5 h-3.5 text-fg-subtle shrink-0" />
                      <span className="flex-1 text-sm truncate">{p.nome}</span>
                      {active && <Check className="w-3.5 h-3.5 text-brand" />}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          <div className="px-3 py-1.5 border-t border-border text-[10px] text-fg-subtle">
            {projects.length} projeto(s) · Esc para fechar
          </div>
        </div>
      )}
    </div>
  );
}
