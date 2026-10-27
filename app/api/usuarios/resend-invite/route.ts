import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions-server";
import { guardTargetUser } from "@/lib/user-management-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteEmailHTML, sendEmail } from "@/lib/email";
import { APP_NAME } from "@/lib/brand";
import { limparFatoresMfa } from "@/lib/mfa-admin";
import { gerarSenhaTemporaria } from "@/lib/senha-temporaria";

export const runtime = "nodejs";

/**
 * Reenvia o e-mail de acesso a um usuário.
 *
 * Body:
 *  - userId (obrigatório)
 *
 * A senha nunca fica guardada em texto: por isso o reenvio sempre gera uma
 * NOVA senha temporária (a anterior deixa de valer), limpa o 2FA e obriga a
 * troca no próximo acesso. A senha nova volta na resposta, para o admin
 * poder repassar se o e-mail não estiver configurado.
 */
export async function POST(req: Request) {
  try {
    const auth = await requirePermission("configuracoes.time", "edit");
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await req.json();
    const targetId = String(body.userId ?? "");
    if (!targetId) {
      return NextResponse.json({ error: "userId obrigatório" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Pega dados do usuário alvo
    const { data: target } = await admin
      .from("users")
      .select("nome, email")
      .eq("id", targetId)
      .maybeSingle();
    if (!target) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    // Quem não tem acesso total não mexe em quem tem.
    const recusa = await guardTargetUser(admin, auth, targetId);
    if (recusa) return recusa;

    const password = gerarSenhaTemporaria();
    const { error: pwErr } = await admin.auth.admin.updateUserById(targetId, {
      password
    });
    if (pwErr) {
      return NextResponse.json({ error: pwErr.message }, { status: 400 });
    }

    // Limpa fatores de 2FA (evita erro AAL2 quando o user for trocar a senha)
    try {
      await limparFatoresMfa(admin, targetId);
    } catch (err) {
      console.warn("[resend-invite] falha ao limpar MFA:", err);
    }

    await admin
      .from("users")
      .update({ password_changed: false, mfa_enabled: false })
      .eq("id", targetId);

    const emailRes = await sendEmail({
      to: target.email,
      subject: `Seu acesso ao ${APP_NAME}`,
      html: inviteEmailHTML({
        nome: target.nome,
        email: target.email,
        password
      })
    });

    return NextResponse.json({
      ok: true,
      password,
      emailSent: emailRes.ok,
      emailSkipped: !!emailRes.skipped,
      error: emailRes.error
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro inesperado" },
      { status: 500 }
    );
  }
}
