import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions-server";
import { guardTargetUser } from "@/lib/user-management-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { limparFatoresMfa } from "@/lib/mfa-admin";
import { gerarSenhaTemporaria } from "@/lib/senha-temporaria";

export const runtime = "nodejs";

/**
 * Gera uma nova senha temporária para o usuário e marca
 * password_changed=false para forçar nova troca no próximo acesso.
 * A senha volta na resposta (uma vez só) para o admin repassar.
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
    // Quem não tem acesso total não mexe em quem tem.
    const recusa = await guardTargetUser(admin, auth, targetId);
    if (recusa) return recusa;

    const password = gerarSenhaTemporaria();
    const { error } = await admin.auth.admin.updateUserById(targetId, {
      password
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Remove TODOS os fatores de 2FA do usuário. Sem isso, ao logar com a
    // senha temporária o user cai em /trocar-senha antes de passar pelo TOTP
    // e o Supabase recusa atualizar a senha (erro AAL2). Forçamos uma
    // reconfiguração de 2FA do zero após a troca de senha.
    try {
      await limparFatoresMfa(admin, targetId);
    } catch (err) {
      console.warn("[reset-password] falha ao limpar MFA:", err);
    }

    await admin
      .from("users")
      .update({ password_changed: false, mfa_enabled: false })
      .eq("id", targetId);

    return NextResponse.json({ ok: true, password });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro inesperado" },
      { status: 500 }
    );
  }
}
