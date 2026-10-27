"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Lock, Plus, ShieldCheck, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  PERMISSION_ACTION_LABEL,
  PERMISSION_CATALOG,
  grantKey,
  type PermissionAction,
  type PermissionResource
} from "@/lib/permissions";
import type { PermissionProfileWithGrants } from "@/lib/types";

/** Estado editável de um perfil na tela. */
interface Rascunho {
  nome: string;
  descricao: string;
  grants: Set<string>;
}

function rascunhoDe(p: PermissionProfileWithGrants): Rascunho {
  return {
    nome: p.nome,
    descricao: p.descricao ?? "",
    grants: new Set(p.grants.map((g) => `${g.resource}:${g.action}`))
  };
}

export function PermissionProfilesTab() {
  const [profiles, setProfiles] = useState<PermissionProfileWithGrants[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  const selected = useMemo(
    () => profiles.find((p) => p.id === selectedId) ?? null,
    [profiles, selectedId]
  );

  useEffect(() => {
    void load();
  }, []);

  // Ao trocar de perfil, o rascunho recomeça do que está salvo.
  useEffect(() => {
    setRascunho(selected ? rascunhoDe(selected) : null);
  }, [selected]);

  async function load(manterId?: string) {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/permission-profiles");
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Falha ao carregar");
      const lista = data.profiles as PermissionProfileWithGrants[];
      setProfiles(lista);
      setSelectedId((atual) => manterId ?? atual ?? lista[0]?.id ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar perfis");
    } finally {
      setLoading(false);
    }
  }

  async function criar() {
    const nome = prompt("Nome do novo perfil (ex.: Suporte)")?.trim();
    if (!nome) return;
    setCreating(true);
    try {
      const r = await fetch("/api/admin/permission-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Falha ao criar");
      toast.success(`Perfil "${nome}" criado. Agora marque o que ele alcança.`);
      await load(data.profile.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao criar perfil");
    } finally {
      setCreating(false);
    }
  }

  async function salvar() {
    if (!selected || !rascunho) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/admin/permission-profiles/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: rascunho.nome,
          descricao: rascunho.descricao,
          grants: [...rascunho.grants]
        })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Falha ao salvar");
      toast.success("Perfil salvo");
      await load(selected.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function excluir(p: PermissionProfileWithGrants) {
    if (!confirm(`Excluir o perfil "${p.nome}"? Esta ação não pode ser desfeita.`)) return;
    try {
      const r = await fetch(`/api/admin/permission-profiles/${p.id}`, {
        method: "DELETE"
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Falha ao excluir");
      toast.success(`Perfil "${p.nome}" excluído`);
      setSelectedId(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao excluir");
    }
  }

  function toggle(resource: string, action: PermissionAction) {
    setRascunho((prev) => {
      if (!prev) return prev;
      const grants = new Set(prev.grants);
      const key = grantKey(resource, action);
      if (grants.has(key)) {
        grants.delete(key);
        // Sem "ver", as demais ações do recurso não têm como ser exercidas.
        if (action === "view") {
          for (const k of [...grants]) {
            if (k.startsWith(`${resource}:`)) grants.delete(k);
          }
        }
      } else {
        grants.add(key);
        // Marcar qualquer ação implica poder ver o recurso.
        grants.add(grantKey(resource, "view"));
      }
      return { ...prev, grants };
    });
  }

  const alterado =
    !!selected &&
    !!rascunho &&
    (rascunho.nome !== selected.nome ||
      rascunho.descricao !== (selected.descricao ?? "") ||
      rascunho.grants.size !== selected.grants.length ||
      selected.grants.some(
        (g) => !rascunho.grants.has(`${g.resource}:${g.action}`)
      ));

  if (loading) {
    return <p className="p-6 text-sm text-fg-muted">Carregando perfis...</p>;
  }

  return (
    <div className="px-6 py-4 grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 items-start">
      {/* Lista de perfis */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            Perfis
          </span>
          <Button size="sm" onClick={() => void criar()} disabled={creating}>
            {creating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            Novo
          </Button>
        </div>
        <ul>
          {profiles.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => setSelectedId(p.id)}
                className={`w-full text-left px-3 py-2.5 border-b border-border/60 transition ${
                  p.id === selectedId
                    ? "bg-brand-subtle text-brand"
                    : "hover:bg-bg-subtle text-fg"
                }`}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {p.full_access && <ShieldCheck className="w-3.5 h-3.5 shrink-0" />}
                  {p.is_system && !p.full_access && (
                    <Lock className="w-3 h-3 shrink-0 text-fg-subtle" />
                  )}
                  <span className="truncate">{p.nome}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-1 text-[11px] text-fg-subtle">
                  <Users className="w-3 h-3" />
                  {p.user_count} {p.user_count === 1 ? "pessoa" : "pessoas"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Editor */}
      {!selected || !rascunho ? (
        <p className="text-sm text-fg-muted">Selecione um perfil à esquerda.</p>
      ) : (
        <div className="border border-border rounded-xl">
          <div className="px-4 py-3 border-b border-border flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-[10px] uppercase tracking-wider text-fg-subtle mb-1">
                Nome
              </label>
              <input
                value={rascunho.nome}
                disabled={selected.is_system}
                onChange={(e) =>
                  setRascunho({ ...rascunho, nome: e.target.value })
                }
                className="w-full px-2 py-1.5 bg-bg-subtle border border-border rounded-md text-sm disabled:opacity-60"
              />
            </div>
            <div className="flex-[2] min-w-[220px]">
              <label className="block text-[10px] uppercase tracking-wider text-fg-subtle mb-1">
                Descrição
              </label>
              <input
                value={rascunho.descricao}
                onChange={(e) =>
                  setRascunho({ ...rascunho, descricao: e.target.value })
                }
                placeholder="Para que serve este perfil"
                className="w-full px-2 py-1.5 bg-bg-subtle border border-border rounded-md text-sm"
              />
            </div>
            {/* Qualquer perfil pode ser excluído, menos o de acesso total. */}
            {!selected.full_access && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void excluir(selected)}
                disabled={selected.user_count > 0}
                title={
                  selected.user_count > 0
                    ? `Mova ${selected.user_count === 1 ? "a pessoa" : `as ${selected.user_count} pessoas`} para outro perfil antes de excluir`
                    : undefined
                }
                className="text-priority-urgent"
              >
                <Trash2 className="w-3.5 h-3.5" /> Excluir
              </Button>
            )}
          </div>

          {selected.full_access ? (
            <div className="p-6 text-sm text-fg-muted flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-brand" />
              <span>
                Este perfil tem acesso irrestrito a todos os menus, abas e ações.
                Não há nada para marcar — e ele não pode ser excluído, para que a
                operação nunca fique sem ninguém administrando.
              </span>
            </div>
          ) : (
            <>
              <div className="divide-y divide-border">
                {PERMISSION_CATALOG.map((r) => (
                  <LinhaRecurso
                    key={r.key}
                    recurso={r}
                    grants={rascunho.grants}
                    onToggle={toggle}
                  />
                ))}
              </div>
            </>
          )}

          <div className="px-4 py-3 border-t border-border flex items-center justify-between gap-3">
            <span className="text-xs text-fg-subtle">
              {alterado ? "Alterações não salvas" : "Tudo salvo"}
            </span>
            <Button onClick={() => void salvar()} disabled={!alterado || saving}>
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Salvar perfil
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function LinhaRecurso({
  recurso,
  grants,
  onToggle,
  nivel = 0
}: {
  recurso: PermissionResource;
  grants: Set<string>;
  onToggle: (resource: string, action: PermissionAction) => void;
  nivel?: number;
}) {
  return (
    <>
      <div
        className="px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5"
        style={{ paddingLeft: 16 + nivel * 20 }}
      >
        <span className="flex-1 min-w-[160px] text-sm">{recurso.label}</span>
        <div className="flex items-center gap-3">
          {recurso.actions.map((a) => (
            <label
              key={a}
              className="flex items-center gap-1.5 text-xs text-fg-muted cursor-pointer"
            >
              <input
                type="checkbox"
                checked={grants.has(grantKey(recurso.key, a))}
                onChange={() => onToggle(recurso.key, a)}
              />
              {PERMISSION_ACTION_LABEL[a]}
            </label>
          ))}
        </div>
      </div>
      {recurso.children?.map((c) => (
        <LinhaRecurso
          key={c.key}
          recurso={c}
          grants={grants}
          onToggle={onToggle}
          nivel={nivel + 1}
        />
      ))}
    </>
  );
}
