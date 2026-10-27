/** Um POST para a ferramenta de disparo. Nunca lança: devolve o resultado. */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ResultadoEnvio {
  ok: boolean;
  httpStatus: number | null;
  resposta: string | null;
  erro: string | null;
}

const LIMITE_TEXTO = 500;

export async function enviarWebhook({
  url,
  token,
  payload,
  fetchImpl = fetch,
  timeoutMs = 10_000
}: {
  url: string;
  token: string | null;
  payload: unknown;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<ResultadoEnvio> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
      cache: "no-store",
      redirect: "manual"
    });
    const texto = (await res.text().catch(() => "")).slice(0, LIMITE_TEXTO) || null;
    return res.ok
      ? { ok: true, httpStatus: res.status, resposta: texto, erro: null }
      : { ok: false, httpStatus: res.status, resposta: texto, erro: texto ?? `HTTP ${res.status}` };
  } catch (err) {
    const abortou = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      httpStatus: null,
      resposta: null,
      erro: abortou
        ? `Sem resposta em ${timeoutMs / 1000}s`
        : err instanceof Error
          ? err.message
          : "Falha de rede"
    };
  } finally {
    clearTimeout(timer);
  }
}
