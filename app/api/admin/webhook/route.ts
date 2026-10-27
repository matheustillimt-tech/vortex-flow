import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireFullAccess } from "@/lib/permissions-server";
import { logActivity } from "@/lib/activity-log";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { mascararToken, validarUrlWebhook } from "@/lib/webhooks/config";

export const runtime = "nodejs";

type Linha = {
  url: string | null;
  token: string | null;
  ativo: boolean;
  atualizado_em: string | null;
  atualizado_por: string | null;
};

async function lerParaTela() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("webhook_config")
    .select("url, token, ativo, atualizado_em, atualizado_por")
    .eq("id", true)
    .maybeSingle();
  const c = data as Linha | null;
  let atualizadoPorNome: string | null = null;
  if (c?.atualizado_por) {
    const { data: u } = await admin.from("users").select("nome").eq("id", c.atualizado_por).maybeSingle();
    atualizadoPorNome = (u as { nome: string } | null)?.nome ?? null;
  }
  let token: string | null = null;
  try {
    token = decryptSecret(c?.token ?? null);
  } catch (err) {
    console.error("[webhook] não foi possível descriptografar o token:", err);
    token = null;
  }
  return {
    url: c?.url ?? null,
    token_final: mascararToken(token),
    ativo: c?.ativo ?? false,
    atualizado_em: c?.atualizado_em ?? null,
    atualizado_por_nome: atualizadoPorNome
  };
}

/** GET /api/admin/webhook — configuração, com o token mascarado. */
export async function GET() {
  const auth = await requireFullAccess();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json(await lerParaTela());
}

/**
 * PUT /api/admin/webhook
 * Body: { url, ativo, token? } — token ausente mantém; null apaga.
 */
export async function PUT(req: Request) {
  const auth = await requireFullAccess();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await req.json().catch(() => null)) as {
    url?: unknown;
    ativo?: unknown;
    token?: unknown;
  } | null;
  if (!body || typeof body.url !== "string" || typeof body.ativo !== "boolean") {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }
  const erroUrl = validarUrlWebhook(body.url);
  if (erroUrl) return NextResponse.json({ error: erroUrl }, { status: 400 });

  const linha: Record<string, unknown> = {
    id: true,
    url: body.url.trim(),
    ativo: body.ativo,
    atualizado_em: new Date().toISOString(),
    atualizado_por: auth.userId
  };
  if ("token" in body) {
    if (body.token !== null && typeof body.token !== "string") {
      return NextResponse.json({ error: "Token inválido" }, { status: 400 });
    }
    const tokenLimpo = body.token ? body.token.trim() : null;
    if (tokenLimpo && tokenLimpo.length < 8) {
      return NextResponse.json({ error: "O token precisa ter pelo menos 8 caracteres." }, { status: 400 });
    }
    try {
      linha.token = tokenLimpo ? encryptSecret(tokenLimpo) : null;
    } catch (err) {
      console.error("[webhook] não foi possível criptografar o token:", err);
      return NextResponse.json(
        { error: "Não foi possível guardar o token (chave de criptografia ausente)." },
        { status: 500 }
      );
    }
  }

  const { error } = await createAdminClient().from("webhook_config").upsert(linha);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await logActivity({
    user_id: auth.userId,
    user_nome: auth.nome,
    user_email: auth.email,
    action: "webhook_updated",
    request: req,
    metadata: { ativo: body.ativo, token_alterado: "token" in body }
  });
  return NextResponse.json(await lerParaTela());
}
