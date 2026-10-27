import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logActivity, type ActivityAction } from "@/lib/activity-log";

export const runtime = "nodejs";

/**
 * POST /api/tools/log
 * Registra uma ação do usuário relacionada à área de Ferramentas.
 *
 * Body: {
 *   action: 'tools_page_open' | 'tool_view_attempt' | 'tool_view_failed_totp',
 *   tool_id?: string,
 *   latitude?: number,  // coords precisas do navegador (opcional)
 *   longitude?: number,
 *   metadata?: object
 * }
 */
const ALLOWED: ActivityAction[] = [
  "tools_page_open",
  "tool_view_attempt",
  "tool_view_failed_totp"
];

export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      action?: ActivityAction;
      tool_id?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      metadata?: Record<string, unknown> | null;
    };
    const action = body.action;
    if (!action || !ALLOWED.includes(action)) {
      return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
    }

    // Carrega nome/email + (opcional) nome da ferramenta
    const { data: profile } = await supabase
      .from("users")
      .select("nome, email")
      .eq("id", user.id)
      .maybeSingle();
    let tool_nome: string | null = null;
    if (body.tool_id) {
      const { data: t } = await supabase
        .from("tools")
        .select("nome")
        .eq("id", body.tool_id)
        .maybeSingle();
      tool_nome = (t as { nome?: string } | null)?.nome ?? null;
    }

    await logActivity({
      user_id: user.id,
      user_nome: profile?.nome ?? null,
      user_email: profile?.email ?? user.email ?? null,
      action,
      tool_id: body.tool_id ?? null,
      tool_nome,
      request: req,
      client_latitude: body.latitude ?? null,
      client_longitude: body.longitude ?? null,
      metadata: body.metadata ?? null
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro inesperado" },
      { status: 500 }
    );
  }
}
