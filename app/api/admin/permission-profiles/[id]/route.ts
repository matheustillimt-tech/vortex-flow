import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/permissions-server";
import { sanitizeGrants } from "@/lib/permissions";

export const runtime = "nodejs";

const RECURSO = "configuracoes.permissoes";

/**
 * PATCH /api/admin/permission-profiles/[id]
 * Body: { nome?, descricao?, grants?: ["recurso:acao", ...] }
 *
 * `grants` é substituição completa: o que não vier na lista é revogado.
 */
export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const auth = await requirePermission(RECURSO, "edit");
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const admin = createAdminClient();
  const { data: atual } = await admin
    .from("permission_profiles")
    .select("id, nome, is_system, full_access")
    .eq("id", ctx.params.id)
    .maybeSingle();
  if (!atual) {
    return NextResponse.json({ error: "Perfil não encontrado" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const patch: Record<string, unknown> = {};

  if (typeof body?.nome === "string") {
    const nome = body.nome.trim();
    if (!nome) {
      return NextResponse.json({ error: "O nome não pode ficar vazio" }, { status: 400 });
    }
    if (atual.is_system && nome !== atual.nome) {
      return NextResponse.json(
        { error: "Perfis de sistema não podem ser renomeados" },
        { status: 400 }
      );
    }
    patch.nome = nome;
  }
  if (body?.descricao !== undefined) {
    patch.descricao =
      typeof body.descricao === "string" && body.descricao.trim()
        ? body.descricao.trim()
        : null;
  }

  if (Object.keys(patch).length) {
    const { error } = await admin
      .from("permission_profiles")
      .update(patch)
      .eq("id", atual.id);
    if (error) {
      const duplicado = error.code === "23505";
      return NextResponse.json(
        { error: duplicado ? "Já existe um perfil com esse nome" : error.message },
        { status: duplicado ? 409 : 400 }
      );
    }
  }

  // Concessões não se aplicam a quem já tem acesso irrestrito.
  if (body?.grants !== undefined && !atual.full_access) {
    const grants = sanitizeGrants(body.grants);
    const { error: delErr } = await admin
      .from("permission_grants")
      .delete()
      .eq("profile_id", atual.id);
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 400 });
    }
    if (grants.length) {
      const { error: insErr } = await admin
        .from("permission_grants")
        .insert(grants.map((g) => ({ profile_id: atual.id, ...g })));
      if (insErr) {
        return NextResponse.json({ error: insErr.message }, { status: 400 });
      }
    }
  }

  return NextResponse.json({ ok: true });
}

/** DELETE /api/admin/permission-profiles/[id] */
export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  const auth = await requirePermission(RECURSO, "delete");
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const admin = createAdminClient();
  const { data: perfil } = await admin
    .from("permission_profiles")
    .select("id, full_access")
    .eq("id", ctx.params.id)
    .maybeSingle();
  if (!perfil) {
    return NextResponse.json({ error: "Perfil não encontrado" }, { status: 404 });
  }
  // Qualquer perfil pode ser excluído, menos o de acesso total: sem ele, ninguém
  // administra o sistema. O banco aplica a mesma regra (migration 049).
  if (perfil.full_access) {
    return NextResponse.json(
      {
        error:
          "O perfil de acesso total não pode ser excluído: sem ele, ninguém administra o sistema."
      },
      { status: 400 }
    );
  }

  // Mensagem melhor que o erro cru de chave estrangeira.
  const { count } = await admin
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("permission_profile_id", perfil.id);
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error: `Este perfil está atribuído a ${count} pessoa(s). Mova-as para outro perfil antes de excluir.`
      },
      { status: 400 }
    );
  }

  const { error } = await admin
    .from("permission_profiles")
    .delete()
    .eq("id", perfil.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
