import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireFullAccess } from "@/lib/permissions-server";
import { decryptSecret } from "@/lib/crypto";
import { appUrl } from "@/lib/webhooks/config";
import { montarPayload } from "@/lib/webhooks/payload";
import { enviarWebhook } from "@/lib/webhooks/send";
import { APP_NAME } from "@/lib/brand";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/admin/webhook/teste
 * Envia um evento "teste" para o WhatsApp de quem clicou e devolve a
 * resposta da ferramenta. Não despacha pendentes aqui — isso cabe à rota
 * de despacho, para não arriscar estourar o maxDuration desta rota.
 */
export async function POST(_req: Request) {
  const auth = await requireFullAccess();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  const [{ data: cfg }, { data: dados }] = await Promise.all([
    admin.from("webhook_config").select("url, token").eq("id", true).maybeSingle(),
    admin.from("colaborador_dados").select("whatsapp").eq("user_id", auth.userId).maybeSingle()
  ]);
  const c = cfg as { url: string | null; token: string | null } | null;
  if (!c?.url) {
    return NextResponse.json({ error: "Salve a URL do webhook antes de testar." }, { status: 400 });
  }
  const whatsapp = (dados as { whatsapp: string | null } | null)?.whatsapp ?? null;
  if (!whatsapp) {
    return NextResponse.json({ error: "Cadastre seu WhatsApp para receber o teste." }, { status: 400 });
  }

  let token: string | null = null;
  try {
    token = decryptSecret(c.token);
  } catch (err) {
    console.error("[webhook] não foi possível descriptografar o token:", err);
    token = null;
  }

  const agora = new Date();
  const payload = montarPayload(
    "teste",
    {
      responsavel: { id: auth.userId, nome: auth.nome, whatsapp },
      tarefa: {
        id: "00000000-0000-0000-0000-000000000000",
        titulo: `Tarefa de teste do ${APP_NAME}`,
        descricao: "Se esta mensagem chegou, o webhook está funcionando.",
        prioridade: "media",
        prazo: new Date(agora.getTime() + 24 * 3600_000).toISOString(),
        prazoTemHora: false
      },
      projeto: { id: "00000000-0000-0000-0000-000000000000", nome: "Projeto de teste" },
      atribuidoPorNome: auth.nome
    },
    { agora, appUrl: appUrl() }
  );
  const r = await enviarWebhook({ url: c.url, token, payload });

  return NextResponse.json({ ok: r.ok, http_status: r.httpStatus, resposta: r.resposta, erro: r.erro });
}
