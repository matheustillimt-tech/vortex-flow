import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireFullAccess } from "@/lib/permissions-server";
import { appUrl } from "@/lib/webhooks/config";
import { lerConfigAvisos } from "@/lib/webhooks/config-db";
import { canalPronto, enviarPeloCanal, normalizarConfig } from "@/lib/webhooks/canais";
import { montarPayload } from "@/lib/webhooks/payload";
import { APP_NAME } from "@/lib/brand";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/admin/webhook/teste
 * Manda uma mensagem de teste, pelo canal salvo, para o WhatsApp de quem
 * clicou e devolve a resposta. Não despacha pendentes aqui: isso cabe à rota
 * de despacho, para não arriscar estourar o maxDuration desta rota.
 */
export async function POST(_req: Request) {
  const auth = await requireFullAccess();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  const [cfg, { data: dados }] = await Promise.all([
    lerConfigAvisos(admin),
    admin.from("colaborador_dados").select("whatsapp").eq("user_id", auth.userId).maybeSingle()
  ]);
  const canal = cfg ? normalizarConfig(cfg) : null;
  if (!canal || !canalPronto(canal)) {
    const msg =
      (canal?.canal ?? "webhook") === "webhook"
        ? "Salve a URL do webhook antes de testar."
        : "Salve os dados do canal antes de testar.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const whatsapp = (dados as { whatsapp: string | null } | null)?.whatsapp ?? null;
  if (!whatsapp) {
    return NextResponse.json({ error: "Cadastre seu WhatsApp para receber o teste." }, { status: 400 });
  }

  const agora = new Date();
  const payload = montarPayload(
    "teste",
    {
      responsavel: { id: auth.userId, nome: auth.nome, whatsapp },
      tarefa: {
        id: "00000000-0000-0000-0000-000000000000",
        titulo: `Tarefa de teste do ${APP_NAME}`,
        descricao: "Se esta mensagem chegou, os avisos estão funcionando.",
        prioridade: "media",
        prazo: new Date(agora.getTime() + 24 * 3600_000).toISOString(),
        prazoTemHora: false
      },
      projeto: { id: "00000000-0000-0000-0000-000000000000", nome: "Projeto de teste" },
      atribuidoPorNome: auth.nome
    },
    { agora, appUrl: appUrl() }
  );
  const r = await enviarPeloCanal(canal, { telefone: whatsapp }, payload.mensagem, payload);

  return NextResponse.json({ ok: r.ok, http_status: r.httpStatus, resposta: r.resposta, erro: r.erro });
}
