"use client";

import { useEffect, useMemo } from "react";
import { initials } from "@/lib/utils";
import type { UserProfile } from "@/lib/types";

interface Props {
  users: UserProfile[];
  query: string;
  index: number;
  onChangeIndex: (i: number) => void;
  onSelect: (user: UserProfile) => void;
}

export function InlineMentionsDropdown({
  users,
  query,
  index,
  onChangeIndex,
  onSelect
}: Props) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users.slice(0, 8);
    return users
      .filter(
        (u) =>
          u.nome.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [users, query]);

  useEffect(() => {
    if (index >= filtered.length) onChangeIndex(Math.max(0, filtered.length - 1));
  }, [filtered.length, index, onChangeIndex]);

  if (filtered.length === 0) {
    return (
      <div className="absolute bottom-full left-12 right-12 mb-2 bg-bg-subtle border border-border rounded-xl shadow-2xl py-1.5 px-3 text-xs text-fg-subtle">
        Ninguém encontrado.
      </div>
    );
  }

  return (
    <div className="absolute bottom-full left-12 mb-2 w-72 bg-bg-subtle border border-border rounded-xl shadow-2xl overflow-hidden animate-fadeIn">
      <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-fg-subtle border-b border-border">
        Mencionar pessoa
      </p>
      <ul>
        {filtered.map((u, i) => (
          <li key={u.id}>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(u);
              }}
              onMouseEnter={() => onChangeIndex(i)}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left ${
                i === index ? "bg-bg-muted" : "hover:bg-bg-muted/60"
              }`}
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
      <p className="px-3 py-1.5 text-[10px] text-fg-subtle border-t border-border">
        ↑↓ navegar · Enter escolher · Esc fechar
      </p>
    </div>
  );
}
