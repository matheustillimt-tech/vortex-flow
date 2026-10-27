"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";

interface Config {
  url: string | null;
  token_final: string | null;
  ativo: boolean;
  atualizado_em: string | null;
  atualizado_por_nome: string | null;
}

interface Entrega {
  id: string;
  status: "pendente" | "processando" | "enviado" | "erro" | "sem_telefone";
  tentativas: number;
  http_status: number | null;
  erro: string | null;
  criado_em: string;
  enviado_em: string | null;
  task_id: string;
  tarefa_titulo: string | null;
  responsavel_nome: string | null;
}

const STATUS: Record<Entrega["status"], { label: string; cls: string }> = {
  pendente: { label: "Pendente", cls: "bg-priority-medium/15 text-priority-medium" },
  processando: { label: "Enviando", cls: "bg-status-progress/15 text-status-progress" },
  enviado: { label: "Enviado", cls: "bg-status-done/15 text-status-done" },
  erro: { label: "Erro", cls: "bg-priority-urgent/15 text-priority-urgent" },
  sem_telefone: { label: "Sem WhatsApp", cls: "bg-bg-muted text-fg-muted" }
};

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

/**
 * Configuração do webhook de WhatsApp (aviso de tarefa atribuída) e
 * histórico das últimas entregas. Só o perfil de acesso total chega aqui.
 */
export function WebhooksTab() {
  const [loading, setLoading] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [url, setUrl] = useState("");
  const [ativo, setAtivo] = useState(false);
  const [trocandoToken, setTrocandoToken] = useState(false);
  const [token, setToken] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [resultadoTeste, setResultadoTeste] = useState<string | null>(null);
  const [entregas, setEntregas] = useState<Entrega[]>([]);

  useEffect(() => {
    void carregar();
  }, []);

  /** Busca as entregas; `null` sinaliza falha (o chamador decide o que manter). */
  async function buscarEntregas(): Promise<Entrega[] | null> {
    try {
      const res = await fetch("/api/admin/webhook/entregas");
      if (!res.ok) return null;
      const json = (await res.json()) as { entregas: Entrega[] };
      return json.entregas ?? [];
    } catch {
      return null;
    }
  }

  async function carregar() {
    setLoading(true);
    setErroCarga(null);
    try {
      const res = await fetch("/api/admin/webhook");
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setErroCarga(json.error ?? "Não foi possível carregar o webhook.");
        return;
      }
      const c = (await res.json()) as Config;
      aplicarConfig(c);
      setEntregas((await buscarEntregas()) ?? []);
    } catch {
      setErroCarga("Não foi possível carregar o webhook.");
    } finally {
      setLoading(false);
    }
  }

  function aplicarConfig(c: Config) {
    setConfig(c);
    setUrl(c.url ?? "");
    setAtivo(c.ativo ?? false);
    setTrocandoToken(!c.token_final);
    setToken("");
  }

  async function salvar() {
    setSalvando(true);
    const body: { url: string; ativo: boolean; token?: string | null } = { url, ativo };
    if (trocandoToken) body.token = token.trim() || null;
    const res = await fetch("/api/admin/webhook", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const json = await res.json();
    setSalvando(false);
    if (!res.ok) {
      toast.error(json.error ?? "Não foi possível salvar.");
      return;
    }
    aplicarConfig(json as Config);
    toast.success("Webhook salvo.");
  }

  async function testar() {
    setTestando(true);
    setResultadoTeste(null);
    const res = await fetch("/api/admin/webhook/teste", { method: "POST" });
    const json = await res.json();
    setTestando(false);
    if (!res.ok) {
      toast.error(json.error ?? "Não foi possível testar.");
      return;
    }
    setResultadoTeste(
      json.ok
        ? `Enviado — HTTP ${json.http_status}${json.resposta ? `: ${json.resposta}` : ""}`
        : `Falhou — ${json.http_status ? `HTTP ${json.http_status}: ` : ""}${json.erro ?? "sem resposta"}`
    );
    void recarregarEntregas();
  }

  async function recarregarEntregas() {
    const novas = await buscarEntregas();
    if (novas) setEntregas(novas);
  }

  async function reenviar(id: string) {
    const res = await fetch(`/api/admin/webhook/entregas/${id}/reenviar`, { method: "POST" });
    if (!res.ok) {
      toast.error((await res.json()).error ?? "Não foi possível reenviar.");
      return;
    }
    toast.success("Reenviado.");
    void recarregarEntregas();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-fg-subtle" />
      </div>
    );
  }

  if (erroCarga) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-fg-muted">{erroCarga}</p>
        <Button variant="outline" onClick={() => void carregar()}>
          Tentar de novo
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8 max-w-4xl">
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-fg">Aviso de tarefa no WhatsApp</h2>
          <p className="text-xs text-fg-muted mt-1">
            Quando alguém vira responsável por uma tarefa, o Flow envia um POST com o WhatsApp da
            pessoa e os dados da tarefa para esta URL.
          </p>
        </div>

        <FormField label="URL do webhook">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://sua-ferramenta.com/webhook"
          />
        </FormField>

        <FormField
          label="Token (opcional)"
          hint="Enviado no header Authorization: Bearer <token>."
        >
          {trocandoToken ? (
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Deixe em branco para não usar token"
              type="password"
              autoComplete="off"
            />
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-fg font-mono">••••{config?.token_final}</span>
              <Button variant="ghost" size="sm" onClick={() => setTrocandoToken(true)}>
                Trocar token
              </Button>
            </div>
          )}
        </FormField>

        <label className="flex items-center gap-2 text-sm text-fg">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          Ativo
        </label>

        <div className="flex items-center gap-2">
          <Button onClick={salvar} disabled={salvando}>
            {salvando && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
            Salvar
          </Button>
          <Button variant="outline" onClick={testar} disabled={testando || !config?.url}>
            {testando ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
            ) : (
              <Send className="w-3.5 h-3.5 mr-1.5" />
            )}
            Enviar teste
          </Button>
        </div>
        {resultadoTeste && <p className="text-xs text-fg-muted">{resultadoTeste}</p>}
        {config?.atualizado_em && (
          <p className="text-[11px] text-fg-subtle">
            Alterado em {dataHora(config.atualizado_em)}
            {config.atualizado_por_nome ? ` por ${config.atualizado_por_nome}` : ""}.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-fg">Últimos envios</h2>
        {entregas.length === 0 ? (
          <p className="text-xs text-fg-muted">Nenhum envio ainda.</p>
        ) : (
          <div className="overflow-x-auto border border-border rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-bg-subtle text-fg-muted text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Quando</th>
                  <th className="px-3 py-2 font-medium">Responsável</th>
                  <th className="px-3 py-2 font-medium">Tarefa</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Detalhe</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {entregas.map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="px-3 py-2 whitespace-nowrap">{dataHora(e.criado_em)}</td>
                    <td className="px-3 py-2">{e.responsavel_nome ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Link href={`/minha-area?task=${e.task_id}`} className="hover:underline">
                        {e.tarefa_titulo ?? "—"}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full ${STATUS[e.status].cls}`}>
                        {STATUS[e.status].label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-fg-muted max-w-xs truncate" title={e.erro ?? ""}>
                      {e.erro ?? (e.http_status ? `HTTP ${e.http_status}` : "")}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {e.status === "erro" && (
                        <Button variant="ghost" size="sm" onClick={() => reenviar(e.id)}>
                          <RotateCcw className="w-3 h-3 mr-1" />
                          Reenviar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
