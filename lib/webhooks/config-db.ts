import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto";
import { eventosAtivosPadrao, ehEventoAviso, type EventoAviso } from "@/lib/avisos/template";
import type { CanalId } from "@/lib/webhooks/canais";
import type { WebhookConfigLida } from "@/lib/webhooks/dispatch";

/** Leitura da configuração de avisos, com os segredos já abertos. Só no servidor. */

export const COLUNAS_CONFIG =
  "url, token, ativo, canal, crm_url, crm_chave, zapi_instancia, zapi_token, zapi_client_token, zapi_base_url, templates, eventos_ativos, atualizado_em, atualizado_por";

export type ConfigAvisos = WebhookConfigLida & {
  canal: CanalId;
  templates: Partial<Record<EventoAviso, string>>;
  eventos_ativos: Record<EventoAviso, boolean>;
  atualizado_em: string | null;
  atualizado_por: string | null;
};

/** Descriptografa sem derrubar quem chamou; nunca loga o valor. */
export function abrirSegredo(campo: string, valor: string | null): string | null {
  try {
    return decryptSecret(valor);
  } catch (err) {
    console.error(`[avisos] não foi possível descriptografar ${campo}:`, err instanceof Error ? err.message : "erro");
    return null;
  }
}

export function lerEventos(v: unknown): Record<EventoAviso, boolean> {
  const out = eventosAtivosPadrao();
  if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (ehEventoAviso(k) && typeof val === "boolean") out[k] = val;
    }
  }
  return out;
}

export function lerTemplates(v: unknown): Partial<Record<EventoAviso, string>> {
  const out: Partial<Record<EventoAviso, string>> = {};
  if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (ehEventoAviso(k) && typeof val === "string") out[k] = val;
    }
  }
  return out;
}

/** Converte a linha crua do banco. Segredos continuam criptografados aqui. */
export function linhaCrua(data: Record<string, unknown> | null) {
  const c = data ?? {};
  const txt = (k: string) => (typeof c[k] === "string" ? (c[k] as string) : null);
  const canal = txt("canal");
  return {
    ativo: c.ativo === true,
    canal: (canal === "crm" || canal === "zapi" ? canal : "webhook") as CanalId,
    url: txt("url"),
    token: txt("token"),
    crm_url: txt("crm_url"),
    crm_chave: txt("crm_chave"),
    zapi_instancia: txt("zapi_instancia"),
    zapi_token: txt("zapi_token"),
    zapi_client_token: txt("zapi_client_token"),
    zapi_base_url: txt("zapi_base_url"),
    templates: lerTemplates(c.templates),
    eventos_ativos: lerEventos(c.eventos_ativos),
    atualizado_em: txt("atualizado_em"),
    atualizado_por: txt("atualizado_por")
  };
}

export async function lerConfigAvisos(admin: SupabaseClient): Promise<ConfigAvisos | null> {
  const { data } = await admin.from("webhook_config").select(COLUNAS_CONFIG).eq("id", true).maybeSingle();
  if (!data) return null;
  const c = linhaCrua(data as Record<string, unknown>);
  return {
    ...c,
    token: abrirSegredo("o token do webhook", c.token),
    crm_chave: abrirSegredo("a chave do CRM", c.crm_chave),
    zapi_token: abrirSegredo("o token da Z-API", c.zapi_token),
    zapi_client_token: abrirSegredo("o Client-Token da Z-API", c.zapi_client_token)
  };
}
