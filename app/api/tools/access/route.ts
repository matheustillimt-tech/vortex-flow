import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activity-log";
import { decryptSecret } from "@/lib/crypto";
import { requirePermission } from "@/lib/permissions-server";

export const runtime = "nodejs";

/**
 * POST /api/tools/access
 * Revela URL/login/senha de uma ferramenta APÓS o cliente ter validado um
 * código TOTP do Google Authenticator (a sessão precisa estar em AAL2).
 *
 * O cliente DEVE chamar antes:
 *   supabase.auth.mfa.challenge({ factorId })
 *   supabase.auth.mfa.verify({ factorId, challengeId, code })
 *
 * Body: { tool_id: string, latitude?: number, longitude?: number }
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

    // Revelar credenciais exige alcançar Ferramentas no perfil.
    const acesso = await requirePermission("ferramentas", "view");
    if ("error" in acesso) {
      return NextResponse.json({ error: acesso.error }, { status: acesso.status });
    }

    const body = (await req.json().catch(() => ({}))) as {
      tool_id?: string;
      latitude?: number | null;
      longitude?: number | null;
    };
    if (!body.tool_id) {
      return NextResponse.json({ error: "tool_id obrigatório" }, { status: 400 });
    }

    // Checa AAL: usuário precisa ter acabado de validar o TOTP.
    const { data: aalData } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalData?.currentLevel !== "aal2") {
      // log do attempt sem credenciais
      const { data: profile } = await supabase
        .from("users")
        .select("nome, email")
        .eq("id", user.id)
        .maybeSingle();
      await logActivity({
        user_id: user.id,
        user_nome: profile?.nome ?? null,
        user_email: profile?.email ?? user.email ?? null,
        action: "tool_view_failed_totp",
        tool_id: body.tool_id,
        request: req,
        client_latitude: body.latitude ?? null,
        client_longitude: body.longitude ?? null,
        metadata: { reason: "aal_not_2", currentLevel: aalData?.currentLevel }
      });
      return NextResponse.json(
        { error: "Verificação de 2 fatores necessária." },
        { status: 403 }
      );
    }

    // Verifica permissão (admin ou tool_user_access)
    const admin = createAdminClient();
    const [{ data: profile }, { data: tool }, { data: access }] = await Promise.all([
      supabase
        .from("users")
        .select("id, nome, email")
        .eq("id", user.id)
        .maybeSingle(),
      admin
        .from("tools")
        .select("id, nome, url, login, senha")
        .eq("id", body.tool_id)
        .maybeSingle(),
      admin
        .from("tool_user_access")
        .select("user_id")
        .eq("tool_id", body.tool_id)
        .eq("user_id", user.id)
        .maybeSingle()
    ]);

    if (!tool) {
      return NextResponse.json({ error: "Ferramenta não encontrada" }, { status: 404 });
    }
    // Acesso total dispensa a liberação por ferramenta; os demais precisam dela.
    const isAdmin = acesso.perms.fullAccess;
    if (!isAdmin && !access) {
      await logActivity({
        user_id: user.id,
        user_nome: profile?.nome ?? null,
        user_email: profile?.email ?? user.email ?? null,
        action: "tool_view_failed_totp",
        tool_id: tool.id as string,
        tool_nome: tool.nome as string,
        request: req,
        client_latitude: body.latitude ?? null,
        client_longitude: body.longitude ?? null,
        metadata: { reason: "no_access" }
      });
      return NextResponse.json(
        { error: "Sem permissão para acessar esta ferramenta." },
        { status: 403 }
      );
    }

    // Loga sucesso (sem incluir senha no metadata, claro)
    await logActivity({
      user_id: user.id,
      user_nome: profile?.nome ?? null,
      user_email: profile?.email ?? user.email ?? null,
      action: "tool_view_success",
      tool_id: tool.id as string,
      tool_nome: tool.nome as string,
      request: req,
      client_latitude: body.latitude ?? null,
      client_longitude: body.longitude ?? null
    });

    // Decripta a senha (criptografada em repouso com AES-256-GCM)
    let plainSenha: string | null = null;
    try {
      plainSenha = decryptSecret(tool.senha as string | null);
    } catch (e: unknown) {
      // Falha de decryption (chave errada/dado corrompido) → não vaza nada.
      await logActivity({
        user_id: user.id,
        user_nome: profile?.nome ?? null,
        user_email: profile?.email ?? user.email ?? null,
        action: "tool_view_failed_totp",
        tool_id: tool.id as string,
        tool_nome: tool.nome as string,
        request: req,
        metadata: {
          reason: "decrypt_failed",
          error: e instanceof Error ? e.message : String(e)
        }
      });
      return NextResponse.json(
        { error: "Falha ao decriptar credencial. Avise um administrador." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      tool: {
        id: tool.id,
        nome: tool.nome,
        url: tool.url,
        login: tool.login,
        senha: plainSenha
      }
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro inesperado" },
      { status: 500 }
    );
  }
}
