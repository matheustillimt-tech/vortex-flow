import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/permissions-server";

export const runtime = "nodejs";

/**
 * PATCH /api/admin/usuarios/[id]/permission-profile
 * Body: { profile_id }
 *
 * Atribui um perfil de permissão a alguém. O role legado é recalculado pelo
 * banco (migration 043), e o banco também recusa rebaixar o último Super Admin
 * — as checagens daqui existem para devolver mensagens claras.
 */
export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const auth = await requirePermission("configuracoes.time", "edit");
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const targetId = ctx.params.id;
  if (targetId === auth.userId) {
    return NextResponse.json(
      {
        error:
          "Você não pode alterar o próprio perfil de permissão. Peça a outro administrador."
      },
      { status: 400 }
    );
  }

  const body = (await req.json().catch(() => null)) as { profile_id?: unknown } | null;
  const profileId = typeof body?.profile_id === "string" ? body.profile_id : "";
  if (!profileId) {
    return NextResponse.json({ error: "Informe o perfil" }, { status: 400 });
  }

  const admin = createAdminClient();
  const [{ data: perfil }, { data: alvo }] = await Promise.all([
    admin
      .from("permission_profiles")
      .select("id, nome, full_access")
      .eq("id", profileId)
      .maybeSingle(),
    admin
      .from("users")
      .select("id, permission_profiles(full_access)")
      .eq("id", targetId)
      .maybeSingle()
  ]);
  if (!perfil) {
    return NextResponse.json({ error: "Perfil não encontrado" }, { status: 404 });
  }
  if (!alvo) {
    return NextResponse.json({ error: "Pessoa não encontrada" }, { status: 404 });
  }

  // Delegar a troca de perfil não pode abrir caminho para escalada.
  const embed = alvo.permission_profiles as
    | { full_access: boolean }
    | { full_access: boolean }[]
    | null;
  const alvoTotal = Array.isArray(embed)
    ? (embed[0]?.full_access ?? false)
    : (embed?.full_access ?? false);
  if (!auth.perms.fullAccess && (alvoTotal || perfil.full_access)) {
    return NextResponse.json(
      { error: "Só quem tem acesso total pode conceder ou retirar acesso total." },
      { status: 403 }
    );
  }

  const { data: atualizado, error } = await admin
    .from("users")
    .update({ permission_profile_id: perfil.id })
    .eq("id", targetId)
    .select("id, role, permission_profile_id")
    .maybeSingle();

  if (error) {
    // 42501 vem das guardas do banco (ex.: último Super Admin).
    return NextResponse.json(
      { error: error.message },
      { status: error.code === "42501" ? 400 : 500 }
    );
  }
  if (!atualizado) {
    return NextResponse.json({ error: "Nada foi alterado" }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    role: atualizado.role,
    permission_profile_id: atualizado.permission_profile_id
  });
}
