import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/permissions-server";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ler exige ver a equipe; gravar exige editá-la. A RPC do banco ainda confere
 * acesso total para gravar restrições de projeto.
 */
async function requireTeam(action: "view" | "edit") {
  const auth = await requirePermission("configuracoes.time", action);
  if ("error" in auth) return auth;
  // Sessão de quem chama: a RPC valida e registra o autor real.
  return { ...auth, supabase: createClient() };
}

/**
 * GET /api/admin/usuarios/[id]/projects
 * Retorna { project_ids: string[] } — quais projetos esse usuário tem
 * acesso explícito. Lista vazia = sem restrição (vê tudo).
 */
export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const auth = await requireTeam("view");
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("project_members")
    .select("project_id")
    .eq("user_id", ctx.params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({
    project_ids: ((data as Array<{ project_id: string }>) ?? []).map(
      (r) => r.project_id
    )
  });
}

/**
 * PUT /api/admin/usuarios/[id]/projects
 * Body: { project_ids: string[] }
 *  - Lista vazia → libera tudo (apaga restrições).
 *  - Lista preenchida → restringe a esses projetos (sobrescreve).
 */
export async function PUT(req: Request, ctx: { params: { id: string } }) {
  const auth = await requireTeam("edit");
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const body: unknown = await req.json().catch(() => null);
  if (
    !UUID.test(ctx.params.id) ||
    !body || typeof body !== "object" ||
    !("project_ids" in body) ||
    !Array.isArray(body.project_ids) ||
    !body.project_ids.every((id: unknown) => typeof id === "string" && UUID.test(id))
  ) {
    return NextResponse.json(
      { error: "Informe o membro e uma lista válida de projetos. Para liberar tudo, envie uma lista vazia." },
      { status: 400 }
    );
  }

  const projectIds = [...new Set(body.project_ids.map((id: string) => id.toLowerCase()))];
  // Uma única transação: qualquer falha preserva as permissões anteriores.
  // Usa a sessão do admin para que o banco valide e registre o autor real.
  const { data, error } = await auth.supabase.rpc("set_user_project_access", {
    p_user_id: ctx.params.id,
    p_project_ids: projectIds
  });
  if (error) {
    const schemaUnavailable = ["PGRST202", "PGRST204", "42703", "42883"].includes(error.code);
    return NextResponse.json(
      { error: schemaUnavailable
        ? "Não foi possível salvar: a atualização de permissões do banco está pendente. As permissões anteriores foram mantidas."
        : error.message },
      { status: schemaUnavailable ? 503 : error.code === "42501" ? 403 : 400 }
    );
  }
  return NextResponse.json(data);
}
