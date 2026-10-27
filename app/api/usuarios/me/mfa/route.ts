import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Marca/desmarca mfa_enabled do PRÓPRIO usuário autenticado.
 * Usa service_role internamente para evitar problemas de RLS após
 * verify do TOTP (a sessão pode ainda estar AAL1 quando rodamos o update
 * direto no client).
 *
 * Body: { enabled: boolean }
 */
export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const enabled = !!body.enabled;

    const admin = createAdminClient();
    const { error } = await admin
      .from("users")
      .update({ mfa_enabled: enabled })
      .eq("id", user.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, enabled });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro inesperado" },
      { status: 500 }
    );
  }
}
