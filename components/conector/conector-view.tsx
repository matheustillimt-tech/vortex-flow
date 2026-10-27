"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Loader2,
  Plug,
  Plus,
  Trash2
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";
import { APP_NAME } from "@/lib/brand";

interface TokenRow {
  id: string;
  prefixo: string;
  nome: string;
  last_used_at: string | null;
  created_at: string;
}

export function ConectorView() {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [gerando, setGerando] = useState(false);
  /** Token em claro — existe só nesta sessão de tela, nunca volta do servidor. */
  const [novoToken, setNovoToken] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const baseUrl =
    typeof window !== "undefined" ? window.location.origin : "";
  const urlConector = novoToken ? `${baseUrl}/api/mcp/${novoToken}` : "";

  useEffect(() => {
    void carregar();
  }, []);

  async function carregar() {
    setLoading(true);
    try {
      const res = await fetch("/api/mcp-tokens");
      const json = (await res.json()) as { tokens?: TokenRow[] };
      setTokens(json.tokens ?? []);
    } catch {
      toast.error("Não foi possível carregar seus tokens.");
    }
    setLoading(false);
  }

  async function gerar() {
    setGerando(true);
    try {
      const res = await fetch("/api/mcp-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: "Claude" })
      });
      const json = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !json.token) {
        toast.error(json.error ?? "Falha ao gerar o token.");
      } else {
        setNovoToken(json.token);
        void carregar();
      }
    } catch {
      toast.error("Falha ao gerar o token.");
    }
    setGerando(false);
  }

  async function revogar(id: string) {
    if (!confirm("Revogar este acesso? O Claude perde a conexão na hora."))
      return;
    const res = await fetch(`/api/mcp-tokens?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Acesso revogado.");
      void carregar();
    } else {
      toast.error("Não foi possível revogar.");
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(urlConector);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
      toast.success("URL copiada.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  return (
    <>
      <PageHeader
        title="Conector do Claude"
        subtitle={`Crie e acompanhe tarefas do ${APP_NAME} conversando com o Claude — no navegador ou no celular.`}
      />

      <div className="p-6 max-w-3xl space-y-5">
        {/* Token recém-criado */}
        {novoToken && (
          <div className="border border-brand/40 bg-brand/5 rounded-xl p-4">
            <div className="flex items-start gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-priority-medium shrink-0 mt-0.5" />
              <p className="text-xs text-fg">
                Copie a URL agora — <strong>ela não será mostrada de novo</strong>.
                Se perder, é só gerar outra.
              </p>
            </div>
            <div className="flex gap-2">
              <input
                readOnly
                value={urlConector}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 px-3 py-2 bg-bg border border-border rounded-lg text-xs font-mono"
              />
              <button
                onClick={copiar}
                className="px-3 py-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-xs font-medium inline-flex items-center gap-1.5 shrink-0"
              >
                {copiado ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copiado ? "Copiado" : "Copiar"}
              </button>
            </div>
          </div>
        )}

        {/* Como conectar */}
        <section className="bg-bg-subtle border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold text-fg mb-2 flex items-center gap-2">
            <Plug className="w-4 h-4 text-fg-muted" />
            Como conectar
          </h2>
          <ol className="text-xs text-fg-muted space-y-1.5 list-decimal pl-4">
            <li>Gere sua URL no botão abaixo e copie.</li>
            <li>
              No Claude, abra <strong>Configurações → Conectores</strong> e
              clique em <strong>Adicionar conector personalizado</strong>.
            </li>
            <li>
              Dê o nome <strong>{APP_NAME}</strong>, cole a URL e confirme.
            </li>
            <li>
              Pronto: peça coisas como{" "}
              <em>
                &quot;cria uma tarefa no projeto X para a Ana, prazo sexta&quot;
              </em>
              .
            </li>
          </ol>
          <p className="text-[11px] text-fg-subtle mt-3 leading-snug">
            A URL é pessoal e funciona como uma senha: o Claude age{" "}
            <strong>como você</strong>, respeitando exatamente os projetos e as
            permissões que você já tem. Não compartilhe com ninguém — se cada
            pessoa gerar a sua, fica claro quem criou o quê.
          </p>
        </section>

        {/* Lista de acessos */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-fg">Seus acessos</h2>
            <button
              onClick={() => void gerar()}
              disabled={gerando}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded-lg text-xs font-medium"
            >
              {gerando ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              Gerar URL do conector
            </button>
          </div>

          {loading ? (
            <p className="text-xs text-fg-muted">Carregando...</p>
          ) : tokens.length === 0 ? (
            <p className="text-xs text-fg-subtle bg-bg-subtle border border-border rounded-lg p-3">
              Nenhum acesso ainda. Gere o primeiro no botão acima.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {tokens.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-3 bg-bg-subtle border border-border rounded-lg px-3 py-2"
                >
                  <code className="text-xs font-mono text-fg-muted">
                    {t.prefixo}…
                  </code>
                  <span className="text-[11px] text-fg-subtle flex-1">
                    {t.last_used_at
                      ? `usado em ${new Date(t.last_used_at).toLocaleDateString("pt-BR")}`
                      : "nunca usado"}
                    {" · "}
                    criado em{" "}
                    {new Date(t.created_at).toLocaleDateString("pt-BR")}
                  </span>
                  <button
                    onClick={() => void revogar(t.id)}
                    className="text-fg-subtle hover:text-priority-urgent p-1"
                    title="Revogar acesso"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* O que dá pra pedir */}
        <section className="bg-bg-subtle border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold text-fg mb-2">
            O que dá pra pedir
          </h2>
          <ul className="text-xs text-fg-muted space-y-1">
            <li>• &quot;Quais projetos eu tenho no {APP_NAME}?&quot;</li>
            <li>
              • &quot;Cria a tarefa &apos;Gravar aula 3&apos; no projeto
              Tecnologia, urgente, prazo amanhã, responsável Ana&quot;
            </li>
            <li>• &quot;Me mostra minhas tarefas atrasadas&quot;</li>
            <li>• &quot;Muda o prazo da tarefa X para sexta&quot;</li>
            <li>• &quot;Marca a tarefa Y como concluída&quot;</li>
          </ul>
        </section>
      </div>
    </>
  );
}
