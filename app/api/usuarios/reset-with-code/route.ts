import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * POST /api/usuarios/reset-with-code
 * Body: { email, code, password }
 *
 * Valida o código gerado pelo /api/usuarios/forgot-password e atualiza a
 * senha do usuário via service_role. Não exige login prévio.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      email?: string;
      code?: string;
      password?: string;
    };
    const email = (body.email ?? "").trim().toLowerCase();
    const code = (body.code ?? "").trim();
    const password = body.password ?? "";

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
    }
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json(
        { error: "Código deve ter 6 dígitos" },
        { status: 400 }
      );
    }
    if (password.length < 6) {
      return NextResponse.json(
        { error: "A senha precisa ter ao menos 6 caracteres" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    // Busca o usuário (case-insensitive)
    const { data: profile } = await admin
      .from("users")
      .select("id, email, ativo")
      .ilike("email", email)
      .maybeSingle();
    if (!profile || !profile.ativo) {
      // Não revelamos se a conta existe
      return NextResponse.json(
        { error: "Código inválido ou expirado" },
        { status: 400 }
      );
    }

    // Aceita QUALQUER código não-usado e não-expirado desse usuário
    // (cobre o caso onde a pessoa pediu mais de um email e usa o de qq um).
    const nowIso = new Date().toISOString();
    const { data: resets } = await admin
      .from("password_resets")
      .select("id, code, expires_at")
      .eq("user_id", profile.id)
      .eq("used", false)
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false });
    if (!resets || resets.length === 0) {
      return NextResponse.json(
        { error: "Nenhum código válido. Peça um novo código." },
        { status: 400 }
      );
    }
    const reset = resets.find(
      (r) => (r.code as string).trim() === code.trim()
    );
    if (!reset) {
      return NextResponse.json(
        { error: "Código incorreto" },
        { status: 400 }
      );
    }

    // Atualiza senha via Supabase Auth Admin
    const { error: updErr } = await admin.auth.admin.updateUserById(
      profile.id,
      { password }
    );
    if (updErr) {
      console.error("[reset-with-code] updateUserById falhou:", updErr);
      return NextResponse.json(
        { error: "Falha ao atualizar senha. Tente de novo." },
        { status: 500 }
      );
    }

    // Marca código como usado
    await admin
      .from("password_resets")
      .update({ used: true })
      .eq("id", reset.id);

    // Marca password_changed=true pra não cair no fluxo de troca obrigatória
    await admin
      .from("users")
      .update({ password_changed: true })
      .eq("id", profile.id);

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("[reset-with-code] erro:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro inesperado" },
      { status: 500 }
    );
  }
}
