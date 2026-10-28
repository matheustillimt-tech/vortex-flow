import type { FetchLike, ResultadoEnvio } from "@/lib/webhooks/http";
import { enviarPorCrm } from "@/lib/webhooks/canais/crm";
import { enviarPorWebhook } from "@/lib/webhooks/canais/webhook";
import { enviarPorZapi } from "@/lib/webhooks/canais/zapi";

/** Um canal ativo por instalação. Segredos aqui já vêm descriptografados. */

export type CanalId = "webhook" | "crm" | "zapi";
export const CANAIS: CanalId[] = ["crm", "zapi", "webhook"];

export interface ConfigCanais {
  canal: CanalId;
  url: string | null;
  token: string | null;
  crm_url: string | null;
  crm_chave: string | null;
  zapi_instancia: string | null;
  zapi_token: string | null;
  zapi_client_token: string | null;
  zapi_base_url: string | null;
}

/** Completa os campos ausentes (configuração no formato de 051 = webhook). */
export function normalizarConfig(c: Partial<ConfigCanais>): ConfigCanais {
  return {
    canal: c.canal ?? "webhook",
    url: c.url ?? null,
    token: c.token ?? null,
    crm_url: c.crm_url ?? null,
    crm_chave: c.crm_chave ?? null,
    zapi_instancia: c.zapi_instancia ?? null,
    zapi_token: c.zapi_token ?? null,
    zapi_client_token: c.zapi_client_token ?? null,
    zapi_base_url: c.zapi_base_url ?? null
  };
}

const cheio = (v: string | null | undefined) => !!v && v.trim() !== "";

export function canalPronto(c: ConfigCanais): boolean {
  if (c.canal === "crm") return cheio(c.crm_url) && cheio(c.crm_chave);
  if (c.canal === "zapi") return cheio(c.zapi_instancia) && cheio(c.zapi_token);
  return cheio(c.url);
}

export async function enviarPeloCanal(
  c: ConfigCanais,
  destino: { telefone: string },
  texto: string,
  payload: unknown,
  opts: { fetchImpl?: FetchLike; timeoutMs?: number } = {}
): Promise<ResultadoEnvio> {
  if (!canalPronto(c)) {
    return { ok: false, httpStatus: null, resposta: null, erro: "Canal de WhatsApp não configurado." };
  }
  if (c.canal === "crm") {
    return enviarPorCrm({ url: c.crm_url!.trim(), chave: c.crm_chave!.trim() }, destino, texto, opts);
  }
  if (c.canal === "zapi") {
    return enviarPorZapi(
      {
        instancia: c.zapi_instancia!.trim(),
        token: c.zapi_token!.trim(),
        clientToken: c.zapi_client_token?.trim() || null,
        baseUrl: c.zapi_base_url
      },
      destino,
      texto,
      opts
    );
  }
  return enviarPorWebhook({ url: c.url!.trim(), token: c.token }, payload, opts);
}
