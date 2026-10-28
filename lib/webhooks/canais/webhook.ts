import { enviarWebhook } from "@/lib/webhooks/send";
import { semSegredos, type FetchLike, type ResultadoEnvio } from "@/lib/webhooks/http";

/** Comportamento de sempre: o JSON inteiro (agora com `mensagem`) vai para a URL. */
export async function enviarPorWebhook(
  cfg: { url: string; token: string | null },
  payload: unknown,
  opts: { fetchImpl?: FetchLike; timeoutMs?: number } = {}
): Promise<ResultadoEnvio> {
  const r = await enviarWebhook({ url: cfg.url, token: cfg.token, payload, ...opts });
  return semSegredos(r, [cfg.token]);
}
