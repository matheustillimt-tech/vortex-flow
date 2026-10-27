import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { cleanEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { despacharPendentes } from "@/lib/webhooks/dispatch";
import { criarRepoSupabase } from "@/lib/webhooks/repo";
import { appUrl } from "@/lib/webhooks/config";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/webhooks/despachar
 * Chamada pelo banco (pg_net) a cada entrega nova, e pelas rotas de admin
 * depois de um teste ou reenvio. Sem sessão: vale o segredo compartilhado.
 */
export async function POST(req: Request) {
  const esperado = cleanEnv(process.env.WEBHOOK_DISPATCH_SECRET);
  const recebido = req.headers.get("x-dispatch-secret") ?? "";
  if (!esperado || !mesmoSegredo(recebido, esperado)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const { processadas } = await despacharPendentes(
      criarRepoSupabase(createAdminClient()),
      { appUrl: appUrl() }
    );
    return NextResponse.json({ ok: true, processadas });
  } catch (err) {
    console.error("[webhook] despacho falhou:", err);
    return NextResponse.json({ error: "Falha ao despachar" }, { status: 500 });
  }
}

function mesmoSegredo(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
