import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireFullAccess } from "@/lib/permissions-server";
import { despacharPendentes } from "@/lib/webhooks/dispatch";
import { criarRepoSupabase } from "@/lib/webhooks/repo";
import { appUrl } from "@/lib/webhooks/config";

export const runtime = "nodejs";
export const maxDuration = 60;

/** POST — volta uma entrega com erro para a fila e despacha na hora. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireFullAccess();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("webhook_entregas")
    .update({ status: "pendente", tentativas: 0, erro: null, http_status: null })
    .eq("id", params.id)
    .eq("status", "erro")
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Só entregas com erro podem ser reenviadas." }, { status: 409 });
  }

  try {
    await despacharPendentes(criarRepoSupabase(admin), { appUrl: appUrl() });
  } catch (err) {
    console.error("[webhook] despacho falhou:", err);
  }

  return NextResponse.json({ ok: true });
}
