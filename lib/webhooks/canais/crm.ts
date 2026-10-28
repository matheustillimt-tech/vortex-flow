import { postJson, semSegredos, LIMITE_TEXTO, type FetchLike, type ResultadoEnvio } from "@/lib/webhooks/http";

/**
 * Canal Vórtex CRM: chama a ferramenta `enviar_mensagem` do servidor MCP do
 * CRM (JSON-RPC 2.0, `tools/call`). Resposta com `result.isError` é falha.
 */

type Rpc = {
  jsonrpc?: string;
  result?: { isError?: boolean; content?: Array<{ type?: string; text?: string }> };
  error?: { code?: number; message?: string };
};

/** Aceita JSON puro ou text/event-stream (pega o último `data:` com JSON-RPC). */
function lerRpc(corpo: string | null): Rpc | null {
  if (!corpo) return null;
  const tentar = (s: string): Rpc | null => {
    try {
      const v = JSON.parse(s) as unknown;
      const um = Array.isArray(v) ? v[0] : v;
      return um && typeof um === "object" && ("result" in um || "error" in um) ? (um as Rpc) : null;
    } catch {
      return null;
    }
  };
  const direto = tentar(corpo.trim());
  if (direto) return direto;
  const linhas = corpo
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim());
  for (let i = linhas.length - 1; i >= 0; i--) {
    const r = tentar(linhas[i]);
    if (r) return r;
  }
  return null;
}

function textoDo(rpc: Rpc): string | null {
  const t = (rpc.result?.content ?? [])
    .map((c) => (typeof c.text === "string" ? c.text : ""))
    .filter(Boolean)
    .join(" ");
  return t ? t.slice(0, LIMITE_TEXTO) : null;
}

export async function enviarPorCrm(
  cfg: { url: string; chave: string },
  destino: { telefone: string },
  texto: string,
  opts: { fetchImpl?: FetchLike; timeoutMs?: number } = {}
): Promise<ResultadoEnvio> {
  const r = await postJson({
    url: cfg.url,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${cfg.chave}`
    },
    body: {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name: "enviar_mensagem", arguments: { telefone: destino.telefone, texto } }
    },
    ...opts
  });

  const rpc = lerRpc(r.corpo);
  let final: ResultadoEnvio;
  if (!r.ok) {
    const msg = rpc?.error?.message ?? r.erro;
    final = { ok: false, httpStatus: r.httpStatus, resposta: r.resposta, erro: msg };
  } else if (!rpc) {
    final = { ok: false, httpStatus: r.httpStatus, resposta: r.resposta, erro: "Resposta inesperada do Vórtex CRM." };
  } else if (rpc.error) {
    final = { ok: false, httpStatus: r.httpStatus, resposta: r.resposta, erro: rpc.error.message ?? "Erro no Vórtex CRM." };
  } else if (rpc.result?.isError) {
    final = { ok: false, httpStatus: r.httpStatus, resposta: r.resposta, erro: textoDo(rpc) ?? "O Vórtex CRM recusou o envio." };
  } else {
    final = { ok: true, httpStatus: r.httpStatus, resposta: textoDo(rpc) ?? r.resposta, erro: null };
  }
  return semSegredos(final, [cfg.chave]);
}
