"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { Loader2, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import {
  CAMPOS,
  EVENTOS,
  EXEMPLO_CAMPOS,
  TEMPLATES_PADRAO,
  eventosAtivosPadrao,
  renderTemplate,
  textoDoEvento,
  type EventoAviso
} from "@/lib/avisos/template";

type Canal = "crm" | "zapi" | "webhook";

interface Config {
  canal: Canal;
  ativo: boolean;
  url: string | null;
  token_final: string | null;
  crm_url: string | null;
  crm_chave_final: string | null;
  zapi_instancia: string | null;
  zapi_token_final: string | null;
  zapi_client_token_final: string | null;
  zapi_base_url: string | null;
  templates: Partial<Record<EventoAviso, string>>;
  eventos_ativos: Record<EventoAviso, boolean>;
  atualizado_em: string | null;
  atualizado_por_nome: string | null;
}

type Status = "pendente" | "processando" | "enviado" | "erro" | "sem_telefone" | "cancelado";

interface Entrega {
  id: string;
  evento: EventoAviso;
  status: Status;
  tentativas: number;
  http_status: number | null;
  erro: string | null;
  criado_em: string;
  enviado_em: string | null;
  task_id: string;
  tarefa_titulo: string | null;
  responsavel_nome: string | null;
}

const STATUS: Record<Status, { label: string; cls: string }> = {
  pendente: { label: "Na fila", cls: "bg-priority-medium/15 text-priority-medium" },
  processando: { label: "Enviando", cls: "bg-status-progress/15 text-status-progress" },
  enviado: { label: "Enviado", cls: "bg-status-done/15 text-status-done" },
  erro: { label: "Erro", cls: "bg-priority-urgent/15 text-priority-urgent" },
  sem_telefone: { label: "Sem WhatsApp", cls: "bg-bg-muted text-fg-muted" },
  cancelado: { label: "Cancelado", cls: "bg-bg-muted text-fg-muted" }
};

const CANAIS: { id: Canal; titulo: string; descricao: string }[] = [
  {
    id: "crm",
    titulo: "Vórtex CRM",
    descricao: "Manda pelo WhatsApp conectado no seu Vórtex CRM."
  },
  {
    id: "zapi",
    titulo: "Z-API",
    descricao: "Manda direto por uma instância da Z-API (ou do Zapbot)."
  },
  {
    id: "webhook",
    titulo: "Webhook",
    descricao: "Entrega os dados para outra ferramenta, que manda a mensagem."
  }
];

const TITULO_EVENTO = Object.fromEntries(EVENTOS.map((e) => [e.id, e.titulo])) as Record<
  EventoAviso,
  string
>;

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** Campo com rótulo ligado ao input (acessível). */
function Campo({
  label,
  dica,
  children
}: {
  label: string;
  dica?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-fg-muted mb-1.5 block">
        {label}
      </label>
      {children(id)}
      {dica && <p className="text-[11px] text-fg-subtle mt-1">{dica}</p>}
    </div>
  );
}

/** Segredo salvo aparece só com os 4 últimos caracteres; trocar abre o campo. */
function CampoSegredo({
  label,
  dica,
  final,
  valor,
  trocando,
  onTrocar,
  onChange,
  placeholder,
  textoTrocar
}: {
  label: string;
  dica?: string;
  final: string | null;
  valor: string;
  trocando: boolean;
  onTrocar: () => void;
  onChange: (v: string) => void;
  placeholder?: string;
  textoTrocar: string;
}) {
  return (
    <Campo label={label} dica={dica}>
      {(id) =>
        trocando || !final ? (
          <Input
            id={id}
            value={valor}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            type="password"
            autoComplete="off"
          />
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-fg font-mono">••••{final}</span>
            <Button variant="ghost" size="sm" onClick={onTrocar}>
              {textoTrocar}
            </Button>
          </div>
        )
      }
    </Campo>
  );
}

type Segredo = "token" | "crm_chave" | "zapi_token" | "zapi_client_token";

const SEGREDOS_VAZIOS: Record<Segredo, string> = {
  token: "",
  crm_chave: "",
  zapi_token: "",
  zapi_client_token: ""
};
const NADA_ABERTO: Record<Segredo, boolean> = {
  token: false,
  crm_chave: false,
  zapi_token: false,
  zapi_client_token: false
};

/**
 * Avisos no WhatsApp: canal de envio, quais avisos mandar, o texto de cada um
 * e o histórico dos últimos envios. Só o perfil de acesso total chega aqui.
 */
export function WebhooksTab() {
  const [loading, setLoading] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);

  const [canal, setCanal] = useState<Canal>("crm");
  const [ativo, setAtivo] = useState(false);
  const [url, setUrl] = useState("");
  const [crmUrl, setCrmUrl] = useState("");
  const [zapiInstancia, setZapiInstancia] = useState("");
  const [zapiBase, setZapiBase] = useState("");
  const [segredos, setSegredos] = useState<Record<Segredo, string>>(SEGREDOS_VAZIOS);
  const [trocando, setTrocando] = useState<Record<Segredo, boolean>>(NADA_ABERTO);
  const [eventos, setEventos] = useState<Record<EventoAviso, boolean>>(eventosAtivosPadrao());
  const [textos, setTextos] = useState<Record<EventoAviso, string>>({ ...TEMPLATES_PADRAO });

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
        setErroCarga(json.error ?? "Não foi possível carregar os avisos.");
        return;
      }
      aplicarConfig((await res.json()) as Config);
      setEntregas((await buscarEntregas()) ?? []);
    } catch {
      setErroCarga("Não foi possível carregar os avisos.");
    } finally {
      setLoading(false);
    }
  }

  function aplicarConfig(c: Config) {
    setConfig(c);
    setCanal(c.canal ?? "webhook");
    setAtivo(c.ativo ?? false);
    setUrl(c.url ?? "");
    setCrmUrl(c.crm_url ?? "");
    setZapiInstancia(c.zapi_instancia ?? "");
    setZapiBase(c.zapi_base_url ?? "");
    setSegredos(SEGREDOS_VAZIOS);
    setTrocando(NADA_ABERTO);
    setEventos({ ...eventosAtivosPadrao(), ...(c.eventos_ativos ?? {}) });
    const t = {} as Record<EventoAviso, string>;
    for (const e of EVENTOS) t[e.id] = textoDoEvento(e.id, c.templates);
    setTextos(t);
  }

  function finalDe(s: Segredo): string | null {
    if (!config) return null;
    const mapa: Record<Segredo, string | null> = {
      token: config.token_final,
      crm_chave: config.crm_chave_final,
      zapi_token: config.zapi_token_final,
      zapi_client_token: config.zapi_client_token_final
    };
    return mapa[s] ?? null;
  }

  async function salvar() {
    setSalvando(true);
    const templates: Partial<Record<EventoAviso, string>> = {};
    for (const e of EVENTOS) {
      const t = textos[e.id];
      if (t.trim() && t.trim() !== TEMPLATES_PADRAO[e.id].trim()) templates[e.id] = t;
    }
    const body: Record<string, unknown> = {
      canal,
      ativo,
      url,
      crm_url: crmUrl,
      zapi_instancia: zapiInstancia,
      zapi_base_url: zapiBase,
      templates,
      eventos_ativos: eventos
    };
    // Segredo só vai quando a pessoa abriu o campo para trocar, ou quando não
    // havia nenhum salvo e ela digitou algo.
    for (const s of Object.keys(segredos) as Segredo[]) {
      if (trocando[s]) body[s] = segredos[s].trim() || null;
      else if (!finalDe(s) && segredos[s].trim()) body[s] = segredos[s].trim();
    }
    try {
      const res = await fetch("/api/admin/webhook", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Não foi possível salvar.");
        return;
      }
      aplicarConfig(json as Config);
      toast.success("Avisos salvos.");
    } catch {
      toast.error("Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  async function testar() {
    setTestando(true);
    setResultadoTeste(null);
    try {
      const res = await fetch("/api/admin/webhook/teste", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Não foi possível testar.");
        return;
      }
      setResultadoTeste(
        json.ok
          ? `Enviado (HTTP ${json.http_status}). Confira o seu WhatsApp.`
          : `Não foi: ${json.http_status ? `HTTP ${json.http_status}, ` : ""}${json.erro ?? "sem resposta"}`
      );
      void recarregarEntregas();
    } catch {
      toast.error("Não foi possível testar.");
    } finally {
      setTestando(false);
    }
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

  const segredo = (
    s: Segredo,
    label: string,
    textoTrocar: string,
    extra: { dica?: string; placeholder?: string } = {}
  ) => (
    <CampoSegredo
      label={label}
      final={finalDe(s)}
      valor={segredos[s]}
      trocando={trocando[s]}
      onTrocar={() => setTrocando((t) => ({ ...t, [s]: true }))}
      onChange={(v) => setSegredos((x) => ({ ...x, [s]: v }))}
      textoTrocar={textoTrocar}
      {...extra}
    />
  );

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
      {/* Canal */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-fg">Avisos no WhatsApp</h2>
          <p className="text-xs text-fg-muted mt-1">
            O sistema avisa a equipe no WhatsApp quando chega tarefa nova, quando o prazo vence, quando
            atrasa e quando alguém comenta. Escolha por onde a mensagem sai.
          </p>
        </div>

        <div role="radiogroup" aria-label="Canal do WhatsApp" className="grid gap-2 sm:grid-cols-3">
          {CANAIS.map((c) => (
            <label
              key={c.id}
              className={`flex gap-2 rounded-lg border p-3 cursor-pointer transition ${
                canal === c.id ? "border-brand bg-brand-subtle" : "border-border hover:bg-bg-subtle"
              }`}
            >
              <input
                type="radio"
                name="canal-whatsapp"
                value={c.id}
                checked={canal === c.id}
                onChange={() => setCanal(c.id)}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm font-medium text-fg">{c.titulo}</span>
                <span className="block text-[11px] text-fg-muted mt-0.5">{c.descricao}</span>
              </span>
            </label>
          ))}
        </div>

        {canal === "crm" && (
          <div className="space-y-4">
            <Campo
              label="Endereço do conector do Vórtex CRM"
              dica="Fica no Vórtex CRM, na tela do conector. Termina em /functions/v1/mcp."
            >
              {(id) => (
                <Input
                  id={id}
                  value={crmUrl}
                  onChange={(e) => setCrmUrl(e.target.value)}
                  placeholder="https://seu-projeto.supabase.co/functions/v1/mcp"
                />
              )}
            </Campo>
            {segredo("crm_chave", "Chave do conector", "Trocar chave", {
              dica: "Gere a chave no Vórtex CRM com permissão de envio de mensagens.",
              placeholder: "Cole a chave aqui"
            })}
          </div>
        )}

        {canal === "zapi" && (
          <div className="space-y-4">
            <Campo label="ID da instância" dica="Está na página da instância, no painel da Z-API.">
              {(id) => (
                <Input id={id} value={zapiInstancia} onChange={(e) => setZapiInstancia(e.target.value)} />
              )}
            </Campo>
            {segredo("zapi_token", "Token da instância", "Trocar token")}
            {segredo("zapi_client_token", "Client-Token da conta (opcional)", "Trocar Client-Token", {
              dica: "Só preencha se você ligou o token de segurança da conta no Z-API"
            })}
            <Campo
              label="Endereço da API (opcional)"
              dica="Deixe em branco para usar https://api.z-api.io. Mude só se usa outro serviço com as mesmas rotas."
            >
              {(id) => (
                <Input
                  id={id}
                  value={zapiBase}
                  onChange={(e) => setZapiBase(e.target.value)}
                  placeholder="https://api.z-api.io"
                />
              )}
            </Campo>
          </div>
        )}

        {canal === "webhook" && (
          <div className="space-y-4">
            <Campo
              label="URL do webhook"
              dica="O sistema manda um POST com os dados do aviso e o texto pronto no campo mensagem."
            >
              {(id) => (
                <Input
                  id={id}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://sua-ferramenta.com/webhook"
                />
              )}
            </Campo>
            {segredo("token", "Token (opcional)", "Trocar token", {
              dica: "Vai no cabeçalho Authorization: Bearer seguido do token.",
              placeholder: "Deixe em branco para não usar token"
            })}
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-fg">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          Avisos ligados
        </label>

        <div className="flex items-center gap-2">
          <Button onClick={salvar} disabled={salvando}>
            {salvando && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
            Salvar
          </Button>
          <Button variant="outline" onClick={testar} disabled={testando}>
            {testando ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
            ) : (
              <Send className="w-3.5 h-3.5 mr-1.5" />
            )}
            Mandar teste
          </Button>
        </div>
        <p className="text-[11px] text-fg-subtle">
          O teste vai para o seu WhatsApp, com os dados que já estão salvos.
        </p>
        {resultadoTeste && <p className="text-xs text-fg-muted">{resultadoTeste}</p>}
        {config?.atualizado_em && (
          <p className="text-[11px] text-fg-subtle">
            Alterado em {dataHora(config.atualizado_em)}
            {config.atualizado_por_nome ? ` por ${config.atualizado_por_nome}` : ""}.
          </p>
        )}
      </section>

      {/* Quando avisar */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-fg">Quando avisar</h2>
        <div className="space-y-2">
          {EVENTOS.map((e) => (
            <label key={e.id} className="flex items-start gap-2 text-sm text-fg">
              <input
                type="checkbox"
                className="mt-1"
                checked={eventos[e.id]}
                onChange={(ev) => setEventos((x) => ({ ...x, [e.id]: ev.target.checked }))}
              />
              <span>
                <span className="font-medium">{e.titulo}</span>
                <span className="block text-[11px] text-fg-muted">{e.descricao}</span>
              </span>
            </label>
          ))}
        </div>
        {canal === "webhook" && (
          <p className="text-[11px] text-priority-medium">
            No canal Webhook, antes de ligar prazo, atraso e comentário, confira se a sua ferramenta usa
            o campo evento ou o texto pronto do campo mensagem. Se ela monta sempre a mensagem de nova
            tarefa, esses avisos vão sair com o texto errado.
          </p>
        )}
        <p className="text-[11px] text-fg-subtle">
          Quem não cadastrou o WhatsApp não recebe. O aviso aparece como Sem WhatsApp no histórico.
        </p>
      </section>

      {/* Mensagens */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-fg">Mensagens</h2>
          <p className="text-xs text-fg-muted mt-1">
            Escreva do seu jeito. Clique num campo para colocar no texto; ele é trocado pelo dado real
            na hora do envio. Lembre de clicar em Salvar.
          </p>
        </div>
        {EVENTOS.map((e) => (
          <div key={e.id} className="grid gap-3 md:grid-cols-2 border border-border rounded-lg p-3">
            <div className="space-y-2">
              <Campo label={e.titulo}>
                {(id) => (
                  <Textarea
                    id={id}
                    rows={7}
                    value={textos[e.id]}
                    onChange={(ev) => setTextos((x) => ({ ...x, [e.id]: ev.target.value }))}
                  />
                )}
              </Campo>
              <div className="flex flex-wrap gap-1">
                {CAMPOS.map((c) => (
                  <button
                    key={c.chave}
                    type="button"
                    title={c.descricao}
                    onClick={() => setTextos((x) => ({ ...x, [e.id]: `${x[e.id]}{${c.chave}}` }))}
                    className="text-[11px] px-1.5 py-0.5 rounded border border-border text-fg-muted hover:text-fg hover:bg-bg-muted font-mono"
                  >
                    {`{${c.chave}}`}
                  </button>
                ))}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTextos((x) => ({ ...x, [e.id]: TEMPLATES_PADRAO[e.id] }))}
              >
                Voltar ao texto padrão
              </Button>
            </div>
            <div>
              <p className="text-xs font-medium text-fg-muted mb-1.5">Prévia</p>
              <div className="whitespace-pre-wrap text-sm text-fg bg-bg-subtle border border-border rounded-lg p-3">
                {renderTemplate(textoDoEvento(e.id, { [e.id]: textos[e.id] }), EXEMPLO_CAMPOS)}
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Histórico */}
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
                  <th className="px-3 py-2 font-medium">Aviso</th>
                  <th className="px-3 py-2 font-medium">Para</th>
                  <th className="px-3 py-2 font-medium">Tarefa</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Detalhe</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {entregas.map((e) => {
                  const st = STATUS[e.status] ?? STATUS.pendente;
                  return (
                    <tr key={e.id} className="border-t border-border">
                      <td className="px-3 py-2 whitespace-nowrap">{dataHora(e.criado_em)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {TITULO_EVENTO[e.evento] ?? TITULO_EVENTO["tarefa.atribuida"]}
                      </td>
                      <td className="px-3 py-2">{e.responsavel_nome ?? ""}</td>
                      <td className="px-3 py-2">
                        <Link href={`/minha-area?task=${e.task_id}`} className="hover:underline">
                          {e.tarefa_titulo ?? "Abrir tarefa"}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
