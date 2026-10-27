import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions-server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Lista os projetos e as liberações explícitas para a tela de equipe. */
export async function GET() {
  const auth = await requirePermission("configuracoes.time", "view");
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createAdminClient();
  const [{ data: projects, error: projectsError }, { data: members, error: membersError }] = await Promise.all([
    admin.from("projects").select("*").order("nome"),
    admin.from("project_members").select("user_id, project_id")
  ]);
  if (projectsError || membersError) {
    return NextResponse.json({ error: projectsError?.message ?? membersError?.message }, { status: 400 });
  }
  const project_ids_by_user: Record<string, string[]> = {};
  for (const row of members ?? []) {
    (project_ids_by_user[row.user_id] ??= []).push(row.project_id);
  }
  return NextResponse.json({ projects: projects ?? [], project_ids_by_user });
}
