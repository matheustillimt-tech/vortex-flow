"use client";

import { useEffect, useRef, useState } from "react";
import { Check, User as UserIcon } from "lucide-react";
import { initials } from "@/lib/utils";
import type { UserProfile } from "@/lib/types";

interface Props {
  users: UserProfile[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** Botão compacto (versão pra header). */
  compact?: boolean;
}

export function ResponsavelFilter({ users, value, onChange, compact }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const current = users.find((u) => u.id === value);
  const filtered = users.filter((u) =>
    u.nome.toLowerCase().includes(q.toLowerCase())
  );

  const btnClass = compact
    ? `inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-bg-subtle border border-border hover:border-border-strong rounded-md text-xs font-medium ${
        value ? "text-fg" : "text-fg-muted"
      }`
    : "inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-bg border border-border hover:border-border-strong rounded-md text-xs font-medium text-fg";

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={btnClass}
      >
        <UserIcon className="w-3.5 h-3.5 text-fg-muted" />
        {compact && value ? (
          <span className="text-fg">
            {current ? current.nome.split(" ")[0] : "—"}
          </span>
        ) : (
          <>
            <span className="text-fg-muted">Por responsável:</span>
            <span className="text-fg">
              {current ? current.nome.split(" ")[0] : "Todos"}
            </span>
          </>
        )}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 right-0 w-60 bg-bg border border-border rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-border">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar..."
              className="w-full px-2 py-1 bg-bg-subtle border border-border rounded-md text-xs"
            />
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            <li>
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-xs hover:bg-bg-subtle flex items-center justify-between ${
                  value === null ? "text-fg font-medium" : "text-fg-muted"
                }`}
              >
                Todos
                {value === null && <Check className="w-3.5 h-3.5 text-brand" />}
              </button>
            </li>
            {filtered.map((u) => {
              const active = value === u.id;
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(u.id);
                      setOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left text-xs hover:bg-bg-subtle flex items-center gap-2 ${
                      active ? "text-fg font-medium" : "text-fg"
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-brand/20 text-brand flex items-center justify-center text-[9px] font-bold uppercase">
                      {initials(u.nome)}
                    </span>
                    <span className="flex-1 truncate">{u.nome}</span>
                    {active && <Check className="w-3.5 h-3.5 text-brand" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
