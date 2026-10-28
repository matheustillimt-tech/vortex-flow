import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireFullAccess } from "@/lib/permissions-server";
import { logActivity } from "@/lib/activity-log";
import { encryptSecret } from "@/lib/crypto";
import { mascararToken, validarHttps } from "@/lib/webhooks/config";
import { abrirSegredo, COLUNAS_CONFIG, linhaCrua } from "@/lib/webhooks/config-db";
import { ehEventoAviso } from "@/lib/avisos/template";

export const runtime = "nodejs";

/** Tamanho máximo de cada texto de aviso. */
const LIMITE_TEMPLATE = 1000;

/** Segredos: na tela só aparecem os 4 últimos caracteres. */
const SEGREDOS = [
  { campo: "token", nome: "o token do webhook", curto: "O token precisa ter pelo menos 8 caracteres." },
  { campo: "crm_chave", nome: "a chave do CRM", curto: "A chave do Vórtex CRM precisa ter pelo menos 8 caracteres." },
  { campo: "zapi_token", nome: "o token da Z-API", curto: "O token da instância precisa ter pelo menos 8 caracteres." },
  {
    campo: "zapi_client_token",
    nome: "o Client-Token da Z-API",
    curto: "O Client-Token precisa ter pelo menos 8 caracteres."
  }
] as const;

async function lerLinha() {
  const admin = createAdminClient();
  const { data } = await admin.from("webhook_config").select(COLUNAS_CONFIG).eq("id", true).maybeSingle();
  return linhaCrua((data as Record<string, unknown> | null) ?? null);
}

async function lerParaTela() {
  const c = await lerLinha();
  let atualizadoPorNome: string | null = null;
  if (c.atualizado_por) {
    const { data: u } = await createAdminClient()
      .from("users")
      .select("nome")
      .eq("id", c.atualizado_por)
      .maybeSingle();
    atualizadoPorNome = (u as { nome: string } | null)?.nome ?? null;
  }
  const final = (campo: string, v: string | null) => mascararToken(abrirSegredo(campo, v));
  return {
    canal: c.canal,
    ativo: c.ativo,
    url: c.url,
    token_final: final("o token do webhook", c.token),
    crm_url: c.crm_url,
    crm_chave_final: final("a chave do CRM", c.crm_chave),
    zapi_instancia: c.zapi_instancia,
    zapi_token_final: final("o token da Z-API", c.zapi_token),
    zapi_client_token_final: final("o Client-Token da Z-API", c.zapi_client_token),
    zapi_base_url: c.zapi_base_url,
    templates: c.templates,
    eventos_ativos: c.eventos_ativos,
    atualizado_em: c.atualizado_em,
    atualizado_por_nome: atualizadoPorNome
  };
}

/** GET /api/admin/webhook — configuração dos avisos, com os segredos mascarados. */
export async function GET() {
  const auth = await requireFullAccess();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json(await lerParaTela());
}

const erro = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });

/**
 * PUT /api/admin/webhook
 * Body: { canal?, ativo, url?, token?, crm_url?, crm_chave?, zapi_instancia?,
 * zapi_token?, zapi_client_token?, zapi_base_url?, templates?, eventos_ativos? }.
 * Campo ausente mantém o que está salvo; segredo null apaga. Sem `canal`,
 * vale "webhook" (corpo antigo { url, ativo, token? }).
 */
export async function PUT(req: Request) {
  const auth = await requireFullAccess();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || typeof body.ativo !== "boolean") {
    return erro("Dados inválidos");
  }
  // Sem canal no corpo, mantém o salvo.
  const canal = body.canal ?? (await lerLinha()).canal;
  if (canal !== "webhook" && canal !== "crm" && canal !== "zapi") return erro("Canal inválido.");

  const linha: Record<string, unknown> = {
    id: true,
    canal,
    ativo: body.ativo,
    atualizado_em: new Date().toISOString(),
    atualizado_por: auth.userId
  };

  // Textos simples (endereços e instância): string vazia apaga.
  const textos: Array<[string, boolean, string]> = [
    ["url", true, "A URL precisa começar com https://."],
    ["crm_url", true, "O endereço do Vórtex CRM precisa começar com https://."],
    ["zapi_base_url", true, "O endereço da API precisa começar com https://."],
    ["zapi_instancia", false, ""]
  ];
  for (const [campo, ehUrl, msg] of textos) {
    if (!(campo in body)) continue;
    const v = body[campo];
    if (v !== null && typeof v !== "string") return erro("Dados inválidos");
    const limpo = typeof v === "string" ? v.trim() : "";
    if (limpo && ehUrl && validarHttps(limpo)) return erro(msg);
    linha[campo] = limpo || null;
  }

  for (const s of SEGREDOS) {
    if (!(s.campo in body)) continue;
    const v = body[s.campo];
    if (v !== null && typeof v !== "string") return erro("Dados inválidos");
    const limpo = typeof v === "string" ? v.trim() : "";
    if (limpo && limpo.length < 8) return erro(s.curto);
    try {
      linha[s.campo] = limpo ? encryptSecret(limpo) : null;
    } catch (err) {
      console.error(`[avisos] não foi possível criptografar ${s.nome}:`, err instanceof Error ? err.message : "erro");
      return erro(
        s.campo === "token"
          ? "Não foi possível guardar o token (chave de criptografia ausente)."
          : "Não foi possível guardar a chave (chave de criptografia ausente).",
        500
      );
    }
  }

  if ("templates" in body) {
    const t = body.templates;
    if (!t || typeof t !== "object" || Array.isArray(t)) return erro("Dados inválidos");
    const limpos: Record<string, string> = {};
    for (const [k, v] of Object.entries(t as Record<string, unknown>)) {
      if (!ehEventoAviso(k) || typeof v !== "string") return erro("Mensagem de aviso inválida.");
      if (v.length > LIMITE_TEMPLATE) return erro(`Cada mensagem pode ter até ${LIMITE_TEMPLATE} caracteres.`);
      if (v.trim()) limpos[k] = v;
    }
    linha.templates = limpos;
  }

  if ("eventos_ativos" in body) {
    const e = body.eventos_ativos;
    if (!e || typeof e !== "object" || Array.isArray(e)) return erro("Dados inválidos");
    const limpos: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(e as Record<string, unknown>)) {
      if (!ehEventoAviso(k) || typeof v !== "boolean") return erro("Escolha ligado ou desligado para cada aviso.");
      limpos[k] = v;
    }
    const atual = (await lerLinha()).eventos_ativos;
    linha.eventos_ativos = { ...atual, ...limpos };
  }

  // Ligado precisa do canal completo (contando o que já está salvo).
  if (body.ativo) {
    const atual = await lerLinha();
    const valor = (campo: keyof typeof atual) =>
      (campo in linha ? (linha[campo] as string | null) : (atual[campo] as string | null)) ?? null;
    if (canal === "webhook" && !valor("url")) return erro("Informe a URL do webhook.");
    if (canal === "crm") {
      if (!valor("crm_url")) return erro("Informe o endereço do Vórtex CRM.");
      if (!valor("crm_chave")) return erro("Informe a chave do Vórtex CRM.");
    }
    if (canal === "zapi") {
      if (!valor("zapi_instancia")) return erro("Informe o ID da instância da Z-API.");
      if (!valor("zapi_token")) return erro("Informe o token da instância da Z-API.");
    }
  }

  const { error } = await createAdminClient().from("webhook_config").upsert(linha);
  if (error) return erro(error.message);

  await logActivity({
    user_id: auth.userId,
    user_nome: auth.nome,
    user_email: auth.email,
    action: "webhook_updated",
    request: req,
    metadata: {
      canal,
      ativo: body.ativo,
      segredos_alterados: SEGREDOS.filter((s) => s.campo in body).map((s) => s.campo)
    }
  });
  return NextResponse.json(await lerParaTela());
}
