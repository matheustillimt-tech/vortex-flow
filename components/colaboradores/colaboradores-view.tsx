"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Search,
  Users
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { ensureSectors, ensureUsers } from "@/lib/cache";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { CadastroForm } from "@/components/colaboradores/cadastro-form";
import { maskCEP, maskCPF } from "@/lib/br-validations";
import { initials } from "@/lib/utils";
import {
  TIPO_PIX_LABEL,
  type ColaboradorDados,
  type Sector,
  type UserProfile
} from "@/lib/types";
import { useCan, usePermissions } from "@/components/permissions/permissions-provider";

type Filtro = "todos" | "completos" | "pendentes";

export function ColaboradoresView() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [dados, setDados] = useState<Map<string, ColaboradorDados>>(new Map());
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<UserProfile | null>(null);
  // Mesma regra da migration 046: editar exige a ação, e quem não tem acesso
  // total não mexe no cadastro de quem tem. O role é derivado do perfil (043),
  // então role === "admin" equivale a acesso total.
  const canEdit = useCan("colaboradores", "edit");
  const actorFull = usePermissions()?.fullAccess ?? false;

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    const supabase = createClient();
    const [uList, sList, dRes] = await Promise.all([
      ensureUsers(true),
      ensureSectors(),
      supabase.from("colaborador_dados").select("*")
    ]);
    setUsers(uList);
    setSectors(sList);
    const m = new Map<string, ColaboradorDados>();
    for (const d of (dRes.data as ColaboradorDados[]) ?? []) {
      m.set(d.user_id, d);
    }
    setDados(m);
    setLoading(false);
  }

  function sectorName(id: string | null) {
    if (!id) return "—";
    return sectors.find((s) => s.id === id)?.nome ?? "—";
  }

  function enderecoOf(d?: ColaboradorDados) {
    if (!d?.logradouro) return "—";
    const parts = [
      `${d.logradouro}, ${d.numero ?? "s/n"}`,
      d.complemento,
      d.bairro,
      d.cidade && d.estado ? `${d.cidade}/${d.estado}` : d.cidade,
      d.cep ? maskCEP(d.cep) : null
    ].filter(Boolean);
    return parts.join(" · ");
  }

  function toggleReveal(id: string) {
    setRevealed((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copiado.`);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return users
      .filter((u) => {
        const d = dados.get(u.id);
        const completo = !!u.cadastro_completo;
        if (filtro === "completos" && !completo) return false;
        if (filtro === "pendentes" && completo) return false;
        if (!ql) return true;
        return (
          u.nome?.toLowerCase().includes(ql) ||
          u.email?.toLowerCase().includes(ql) ||
          u.cargo?.toLowerCase().includes(ql) ||
          (d?.cpf ?? "").includes(ql.replace(/\D/g, ""))
        );
      })
      .sort((a, b) => {
        // Pendentes primeiro (é o que o financeiro precisa cobrar)
        const ca = a.cadastro_completo ? 1 : 0;
        const cb = b.cadastro_completo ? 1 : 0;
        if (ca !== cb) return ca - cb;
        return (a.nome ?? "").localeCompare(b.nome ?? "");
      });
  }, [users, dados, q, filtro]);

  const pendentes = users.filter((u) => !u.cadastro_completo).length;

  function exportCSV() {
    const header = [
      "Nome",
      "E-mail",
      "CPF",
      "Data de nascimento",
      "Função",
      "Setor",
      "CEP",
      "Endereço",
      "Número",
      "Complemento",
      "Bairro",
      "Cidade",
      "Estado",
      "Tipo chave PIX",
      "Chave PIX",
      "Cadastro completo"
    ];
    const rows = filtered.map((u) => {
      const d = dados.get(u.id);
      return [
        u.nome ?? "",
        u.email ?? "",
        d?.cpf ? maskCPF(d.cpf) : "",
        d?.data_nascimento
          ? new Date(d.data_nascimento + "T12:00:00").toLocaleDateString("pt-BR")
          : "",
        u.cargo ?? "",
        sectorName(u.setor_principal_id),
        d?.cep ? maskCEP(d.cep) : "",
        d?.logradouro ?? "",
        d?.numero ?? "",
        d?.complemento ?? "",
        d?.bairro ?? "",
        d?.cidade ?? "",
        d?.estado ?? "",
        d?.tipo_chave_pix ? TIPO_PIX_LABEL[d.tipo_chave_pix] : "",
        d?.chave_pix ?? "",
        u.cadastro_completo ? "Sim" : "Não"
      ];
    });
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((r) => r.map(esc).join(";")).join("\r\n");
    // BOM pro Excel abrir acentos corretamente
    const blob = new Blob(["﻿" + csv], {
      type: "text/csv;charset=utf-8;"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `colaboradores-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${rows.length} colaborador(es) exportado(s).`);
  }

  return (
    <>
      <PageHeader
        title="Colaboradores"
        subtitle="Dados cadastrais completos para o financeiro. Visível conforme o perfil de permissão."
        actions={
          <button
            onClick={exportCSV}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded-lg text-sm font-medium"
          >
            <Download className="w-4 h-4" />
            Exportar CSV
          </button>
        }
      />

      <div className="px-6 pt-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nome, e-mail, função ou CPF..."
            className="w-full pl-8 pr-3 py-1.5 bg-bg-subtle border border-border rounded-md text-xs"
          />
        </div>
        {(["todos", "pendentes", "completos"] as Filtro[]).map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition ${
              filtro === f
                ? "bg-brand text-white border-brand"
                : "bg-bg-subtle border-border text-fg-muted hover:text-fg"
            }`}
          >
            {f === "todos"
              ? "Todos"
              : f === "pendentes"
                ? `Pendentes${pendentes > 0 ? ` (${pendentes})` : ""}`
                : "Completos"}
          </button>
        ))}
        <span className="ml-auto text-xs text-fg-subtle">
          {filtered.length} de {users.length}
        </span>
      </div>

      <div className="p-6">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-fg-muted">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Nenhum colaborador"
            description="Nada corresponde aos filtros selecionados."
          />
        ) : (
          <div className="space-y-2.5">
            {filtered.map((u) => {
              const d = dados.get(u.id);
              const completo = !!u.cadastro_completo;
              const isRevealed = revealed.has(u.id);
              return (
                <div
                  key={u.id}
                  className={`bg-bg-subtle border rounded-xl overflow-hidden ${
                    completo ? "border-border" : "border-priority-medium/50"
                  }`}
                >
                  <div className="p-4 flex items-start gap-3">
                    {u.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={u.avatar_url}
                        alt={u.nome}
                        className="w-11 h-11 rounded-full object-cover border border-border shrink-0"
                      />
                    ) : (
                      <div className="w-11 h-11 rounded-full bg-brand/15 text-brand flex items-center justify-center text-xs font-bold uppercase shrink-0">
                        {initials(u.nome ?? u.email)}
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-fg truncate">
                          {u.nome}
                        </p>
                        {completo ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-status-done bg-status-done/10 border border-status-done/30 rounded-full px-1.5 py-0.5">
                            <CheckCircle2 className="w-2.5 h-2.5" /> Completo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-priority-medium bg-priority-medium/10 border border-priority-medium/30 rounded-full px-1.5 py-0.5">
                            <AlertCircle className="w-2.5 h-2.5" /> Pendente
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-fg-muted truncate">
                        {u.email}
                      </p>
                      <p className="text-[11px] text-fg-subtle mt-0.5">
                        {u.cargo || "Sem função"} ·{" "}
                        {sectorName(u.setor_principal_id)}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {d && (
                        <button
                          onClick={() => toggleReveal(u.id)}
                          className="p-1.5 rounded-md text-fg-muted hover:text-fg hover:bg-bg-muted"
                          title={
                            isRevealed
                              ? "Ocultar dados sensíveis"
                              : "Mostrar dados sensíveis"
                          }
                        >
                          {isRevealed ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      )}
                      {canEdit && (actorFull || u.role !== "admin") && (
                        <button
                          onClick={() => setEditing(u)}
                          className="p-1.5 rounded-md text-fg-muted hover:text-fg hover:bg-bg-muted"
                          title="Editar cadastro"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {isRevealed && d && (
                    <div className="px-4 pb-4 pt-1 border-t border-border bg-bg/40">
                      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs mt-3">
                        <Row
                          label="CPF"
                          value={d.cpf ? maskCPF(d.cpf) : "—"}
                          onCopy={
                            d.cpf ? () => copy(maskCPF(d.cpf!), "CPF") : undefined
                          }
                        />
                        <Row
                          label="Nascimento"
                          value={
                            d.data_nascimento
                              ? new Date(
                                  d.data_nascimento + "T12:00:00"
                                ).toLocaleDateString("pt-BR")
                              : "—"
                          }
                        />
                        <Row
                          label={`Chave PIX${
                            d.tipo_chave_pix
                              ? ` (${TIPO_PIX_LABEL[d.tipo_chave_pix]})`
                              : ""
                          }`}
                          value={d.chave_pix ?? "—"}
                          onCopy={
                            d.chave_pix
                              ? () => copy(d.chave_pix!, "Chave PIX")
                              : undefined
                          }
                          highlight
                        />
                        <Row label="Endereço" value={enderecoOf(d)} />
                      </dl>
                    </div>
                  )}

                  {!d && completo && (
                    <div className="px-4 pb-3 text-[11px] text-fg-subtle">
                      Sem dados complementares registrados.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de edição (quem tem "Editar colaboradores" corrige o cadastro de outra pessoa) */}
      {editing && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
          onClick={() => setEditing(null)}
        >
          <div
            className="bg-bg w-full max-w-2xl my-8 rounded-2xl border border-border shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="p-4 border-b border-border">
              <h2 className="text-sm font-semibold text-fg">
                Editar cadastro — {editing.nome}
              </h2>
            </header>
            <div className="p-5">
              <CadastroForm
                user={editing}
                sectors={sectors.filter((s) => s.status === "ativo")}
                onCancel={() => setEditing(null)}
                onSaved={() => {
                  setEditing(null);
                  void load();
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Row({
  label,
  value,
  onCopy,
  highlight
}: {
  label: string;
  value: string;
  onCopy?: () => void;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <dt className="text-fg-subtle shrink-0 min-w-[92px]">{label}</dt>
      <dd
        className={`flex-1 min-w-0 break-words ${
          highlight ? "font-medium text-fg" : "text-fg-muted"
        }`}
      >
        {value}
      </dd>
      {onCopy && value !== "—" && (
        <button
          onClick={onCopy}
          className="text-fg-subtle hover:text-fg shrink-0"
          title="Copiar"
        >
          <Copy className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
