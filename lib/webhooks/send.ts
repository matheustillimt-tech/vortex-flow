import { postJson, type FetchLike, type ResultadoEnvio } from "@/lib/webhooks/http";

/** Canal webhook: um POST para a ferramenta de disparo. Nunca lança. */

export type { FetchLike, ResultadoEnvio };

export async function enviarWebhook({
  url,
  token,
  payload,
  fetchImpl,
  timeoutMs
}: {
  url: string;
  token: string | null;
  payload: unknown;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<ResultadoEnvio> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await postJson({ url, headers, body: payload, fetchImpl, timeoutMs });
  return { ok: r.ok, httpStatus: r.httpStatus, resposta: r.resposta, erro: r.erro };
}
