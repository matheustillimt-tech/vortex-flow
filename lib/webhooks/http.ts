/**
 * Um POST com JSON. Nunca lança: devolve o resultado. Regras que valem para
 * todo canal: timeout, sem seguir redirecionamento (3xx vira falha) e corpo
 * da resposta cortado em 500 caracteres.
 */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ResultadoEnvio {
  ok: boolean;
  httpStatus: number | null;
  resposta: string | null;
  erro: string | null;
}

export const LIMITE_TEXTO = 500;

export async function postJson({
  url,
  headers,
  body,
  fetchImpl = fetch,
  timeoutMs = 10_000
}: {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<ResultadoEnvio & { corpo: string | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: "no-store",
      redirect: "manual"
    });
    const corpo = (await res.text().catch(() => "")) || null;
    const texto = corpo ? corpo.slice(0, LIMITE_TEXTO) : null;
    return res.ok
      ? { ok: true, httpStatus: res.status, resposta: texto, erro: null, corpo }
      : { ok: false, httpStatus: res.status, resposta: texto, erro: texto ?? `HTTP ${res.status}`, corpo };
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
          : "Falha de rede",
      corpo: null
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Tira segredos de qualquer texto que vá para o banco ou para a tela. */
export function semSegredos<T extends ResultadoEnvio>(r: T, segredos: Array<string | null>): ResultadoEnvio {
  const limpar = (s: string | null) => {
    if (!s) return s;
    let out = s;
    for (const seg of segredos) if (seg && seg.length >= 4) out = out.split(seg).join("••••");
    return out;
  };
  return { ok: r.ok, httpStatus: r.httpStatus, resposta: limpar(r.resposta), erro: limpar(r.erro) };
}
