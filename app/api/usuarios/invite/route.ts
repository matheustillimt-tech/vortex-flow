import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteEmailHTML, sendEmail } from "@/lib/email";
import { APP_NAME } from "@/lib/brand";
import { gerarSenhaTemporaria } from "@/lib/senha-temporaria";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const auth = await requirePermission("configuracoes.time", "create");
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const nome = String(body.nome ?? "").trim();
    const cargo = body.cargo ? String(body.cargo).trim() : null;
    // Perfil de permissão escolhido no convite. Sem perfil, a pessoa entra em
    // "Sem permissões" — o banco atribui esse padrão (migration 043).
    const profileId =
      typeof body.permission_profile_id === "string" && body.permission_profile_id
        ? body.permission_profile_id
        : null;
    const setor_principal_id = body.setor_principal_id
      ? String(body.setor_principal_id)
      : null;

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
    }
    if (!nome) {
      return NextResponse.json({ error: "Nome obrigatório" }, { status: 400 });
    }

    const admin = createAdminClient();
    // Senha temporária aleatória, mostrada uma vez para quem convidou.
    // O usuário é obrigado a trocar no primeiro login.
    const password = gerarSenhaTemporaria();

    // Valida o perfil ANTES de criar a conta, para não deixar usuário órfão.
    if (profileId) {
      const { data: perfil } = await admin
        .from("permission_profiles")
        .select("id, full_access")
        .eq("id", profileId)
        .maybeSingle();
      if (!perfil) {
        return NextResponse.json(
          { error: "Perfil de permissão não encontrado" },
          { status: 400 }
        );
      }
      // Delegar convites não pode criar alguém com mais acesso que quem convida.
      if (perfil.full_access && !auth.perms.fullAccess) {
        return NextResponse.json(
          { error: "Só quem tem acesso total pode convidar alguém com acesso total." },
          { status: 403 }
        );
      }
    }

    // Cria o usuário em auth.users
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nome }
    });
    if (createErr || !created.user) {
      return NextResponse.json(
        { error: createErr?.message ?? "Falha ao criar usuário" },
        { status: 400 }
      );
    }

    const newUserId = created.user.id;

    // Atualiza perfil em public.users + marca senha como NÃO TROCADA
    // (no primeiro login será obrigado a trocar)
    await admin
      .from("users")
      .update({
        nome,
        cargo,
        // role não é gravado: o banco o deriva do perfil (migration 043).
        ...(profileId ? { permission_profile_id: profileId } : {}),
        setor_principal_id,
        ativo: true,
        password_changed: false
      })
      .eq("id", newUserId);

    // Envia e-mail com a senha (se RESEND_API_KEY estiver definido)
    const emailRes = await sendEmail({
      to: email,
      subject: `Seu acesso ao ${APP_NAME}`,
      html: inviteEmailHTML({ nome, email, password })
    });

    return NextResponse.json({
      ok: true,
      userId: newUserId,
      password,
      emailSent: emailRes.ok,
      emailSkipped: !!emailRes.skipped
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro inesperado" },
      { status: 500 }
    );
  }
}
