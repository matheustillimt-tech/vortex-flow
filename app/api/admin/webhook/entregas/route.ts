import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireFullAccess } from "@/lib/permissions-server";

export const runtime = "nodejs";

/** GET /api/admin/webhook/entregas — as 50 entregas mais recentes. */
export async function GET() {
  const auth = await requireFullAccess();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { data, error } = await createAdminClient()
    .from("webhook_entregas")
    .select(
      "id, status, tentativas, http_status, erro, criado_em, enviado_em, task_id, tasks(titulo), users!webhook_entregas_user_id_fkey(nome)"
    )
    .order("criado_em", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  type Embed = { titulo?: string; nome?: string } | { titulo?: string; nome?: string }[] | null;
  const um = (e: Embed) => (Array.isArray(e) ? (e[0] ?? null) : e);
  const entregas = (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id,
      status: r.status,
      tentativas: r.tentativas,
      http_status: r.http_status,
      erro: r.erro,
      criado_em: r.criado_em,
      enviado_em: r.enviado_em,
      task_id: r.task_id,
      tarefa_titulo: um(r.tasks as Embed)?.titulo ?? null,
      responsavel_nome: um(r.users as Embed)?.nome ?? null
    };
  });
  return NextResponse.json({ entregas });
}
