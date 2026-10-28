import { postJson, semSegredos, type FetchLike, type ResultadoEnvio } from "@/lib/webhooks/http";

/** Canal Z-API (e serviços com as mesmas rotas, como o Zapbot). */

export const ZAPI_BASE_PADRAO = "https://api.z-api.io";

export const PEDIU_CLIENT_TOKEN =
  "A Z-API pediu o Client-Token. Preencha o Client-Token da conta (fica em Segurança, no painel da Z-API) e salve de novo.";

/** Só dígitos, sempre com 55 na frente. */
export function telefoneZapi(telefone: string): string {
  const d = telefone.replace(/\D/g, "");
  return d.startsWith("55") && d.length >= 12 ? d : `55${d}`;
}

export async function enviarPorZapi(
  cfg: { instancia: string; token: string; clientToken: string | null; baseUrl: string | null },
  destino: { telefone: string },
  texto: string,
  opts: { fetchImpl?: FetchLike; timeoutMs?: number } = {}
): Promise<ResultadoEnvio> {
  const base = (cfg.baseUrl?.trim() || ZAPI_BASE_PADRAO).replace(/\/+$/, "");
  const url = `${base}/instances/${encodeURIComponent(cfg.instancia)}/token/${encodeURIComponent(cfg.token)}/send-text`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.clientToken) headers["Client-Token"] = cfg.clientToken;

  const r = await postJson({
    url,
    headers,
    body: { phone: telefoneZapi(destino.telefone), message: texto },
    ...opts
  });

  let final: ResultadoEnvio = { ok: r.ok, httpStatus: r.httpStatus, resposta: r.resposta, erro: r.erro };
  if (r.ok && r.corpo) {
    try {
      const j = JSON.parse(r.corpo) as { error?: unknown; message?: unknown };
      if (j && typeof j === "object" && j.error) {
        final = {
          ok: false,
          httpStatus: r.httpStatus,
          resposta: r.resposta,
          erro: [j.error, j.message].filter((x) => typeof x === "string").join(": ") || "A Z-API recusou o envio."
        };
      }
    } catch {
      // corpo que não é JSON com 2xx: aceita como enviado
    }
  }
  if (!final.ok && /client[-_ ]?token/i.test(`${final.erro ?? ""} ${final.resposta ?? ""}`)) {
    final = { ...final, erro: PEDIU_CLIENT_TOKEN };
  }
  return semSegredos(final, [cfg.token, cfg.clientToken, cfg.instancia]);
}
