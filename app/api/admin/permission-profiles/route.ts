import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/permissions-server";
import { sanitizeGrants } from "@/lib/permissions";

export const runtime = "nodejs";

const RECURSO = "configuracoes.permissoes";

/**
 * GET /api/admin/permission-profiles
 * Perfis + concessões + quantas pessoas usam cada um.
 */
export async function GET() {
  const auth = await requirePermission(RECURSO, "view");
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const admin = createAdminClient();
  const [perfis, grants, usuarios] = await Promise.all([
    admin.from("permission_profiles").select("*").order("full_access", { ascending: false }).order("nome"),
    admin.from("permission_grants").select("profile_id, resource, action"),
    admin.from("users").select("permission_profile_id").not("permission_profile_id", "is", null)
  ]);

  const erro = perfis.error ?? grants.error ?? usuarios.error;
  if (erro) return NextResponse.json({ error: erro.message }, { status: 400 });

  const porPerfil = new Map<string, Array<{ resource: string; action: string }>>();
  for (const g of grants.data ?? []) {
    const arr = porPerfil.get(g.profile_id) ?? [];
    arr.push({ resource: g.resource, action: g.action });
    porPerfil.set(g.profile_id, arr);
  }
  const contagem = new Map<string, number>();
  for (const u of usuarios.data ?? []) {
    const id = u.permission_profile_id as string;
    contagem.set(id, (contagem.get(id) ?? 0) + 1);
  }

  return NextResponse.json({
    profiles: (perfis.data ?? []).map((p) => ({
      ...p,
      grants: porPerfil.get(p.id) ?? [],
      user_count: contagem.get(p.id) ?? 0
    }))
  });
}

/**
 * POST /api/admin/permission-profiles
 * Body: { nome, descricao?, grants?: ["recurso:acao", ...] }
 */
export async function POST(req: Request) {
  const auth = await requirePermission(RECURSO, "create");
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const nome = typeof body?.nome === "string" ? body.nome.trim() : "";
  if (!nome) {
    return NextResponse.json({ error: "Informe o nome do perfil" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: perfil, error } = await admin
    .from("permission_profiles")
    .insert({
      nome,
      descricao:
        typeof body?.descricao === "string" && body.descricao.trim()
          ? body.descricao.trim()
          : null,
      // full_access só existe no Super Admin, que já nasce com a migration.
      full_access: false,
      is_system: false
    })
    .select("*")
    .single();

  if (error) {
    const duplicado = error.code === "23505";
    return NextResponse.json(
      { error: duplicado ? "Já existe um perfil com esse nome" : error.message },
      { status: duplicado ? 409 : 400 }
    );
  }

  const grants = sanitizeGrants(body?.grants);
  if (grants.length) {
    const { error: gErr } = await admin
      .from("permission_grants")
      .insert(grants.map((g) => ({ profile_id: perfil.id, ...g })));
    if (gErr) return NextResponse.json({ error: gErr.message }, { status: 400 });
  }

  return NextResponse.json({ profile: { ...perfil, grants, user_count: 0 } });
}
