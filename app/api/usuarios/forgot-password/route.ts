import { NextResponse } from "next/server";
import { appUrl } from "@/lib/app-url";
import { APP_NAME } from "@/lib/brand";
import { randomInt } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { forgotPasswordEmailHTML, sendEmail } from "@/lib/email";

export const runtime = "nodejs";

/**
 * POST /api/usuarios/forgot-password
 * Body: { email }
 *
 * Gera um código OTP de 6 dígitos, persiste em password_resets e envia
 * por email. NÃO usa magic link do Supabase (independe de whitelist /
 * redirect URLs).
 *
 * Sempre devolve 200 — não revela se a conta existe (evita enumeração).
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return NextResponse.json({ ok: false, error: "E-mail inválido" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("users")
      .select("id, nome, email, ativo")
      .ilike("email", email)
      .maybeSingle();

    // Sempre responde sucesso (não revela existência).
    const okResponse = NextResponse.json({ ok: true });

    if (!profile || !profile.ativo) return okResponse;

    // Gera código de 6 dígitos (000000 - 999999)
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 60 min

    // NÃO invalidamos códigos antigos aqui — qualquer código não-usado e
    // não-expirado continua valendo. Isso evita confusão se o usuário
    // pedir 2 emails e tentar usar o do primeiro.
    // Cria novo código
    const { error: insErr } = await admin.from("password_resets").insert({
      user_id: profile.id,
      email: profile.email,
      code,
      expires_at: expiresAt,
      used: false
    });
    if (insErr) {
      console.error("[forgot-password] insert falhou:", insErr);
      return okResponse;
    }

    // URL pré-preenchida
    const appBase = appUrl();
    const resetUrl = `${appBase}/auth/reset-password?email=${encodeURIComponent(
      profile.email
    )}&code=${code}`;

    // Despacha o email
    const emailRes = await sendEmail({
      to: profile.email,
      subject: `Código para redefinir sua senha · ${APP_NAME}`,
      html: forgotPasswordEmailHTML({
        nome: profile.nome,
        code,
        resetUrl
      })
    });
    if (!emailRes.ok && !emailRes.skipped) {
      console.error("[forgot-password] sendEmail falhou:", emailRes.error);
    }
    return okResponse;
  } catch (err: unknown) {
    console.error("[forgot-password] erro:", err);
    return NextResponse.json({ ok: true });
  }
}
