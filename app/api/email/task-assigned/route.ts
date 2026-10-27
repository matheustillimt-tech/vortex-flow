import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail, taskAssignedEmailHTML } from "@/lib/email";

export const runtime = "nodejs";

/**
 * Envia e-mail ao responsável quando uma tarefa lhe é atribuída.
 * Esperado: { taskId: string }
 *
 * O acesso é restrito a usuários autenticados — o servidor faz a leitura
 * com a sessão atual (RLS aplicada) então não vaza dados.
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

    const body = await req.json();
    const taskId = String(body.taskId ?? "");
    if (!taskId) {
      return NextResponse.json({ error: "taskId obrigatório" }, { status: 400 });
    }
    // newAssigneeIds opcional — quando informado, envia só pra esses (caso de
    // múltiplos responsáveis recém adicionados). Sem ele, cai no modo legado:
    // tenta o responsavel_id principal.
    const newAssigneeIds: string[] = Array.isArray(body.newAssigneeIds)
      ? body.newAssigneeIds.filter((x: unknown) => typeof x === "string")
      : [];

    const { data: task } = await supabase
      .from("tasks")
      .select(
        "id, titulo, descricao, prioridade, prazo, project_id, responsavel_id, projects(nome)"
      )
      .eq("id", taskId)
      .maybeSingle();
    if (!task) {
      return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 });
    }
    const t = task as unknown as {
      id: string;
      titulo: string;
      descricao: string | null;
      prioridade: string;
      prazo: string | null;
      project_id: string | null;
      responsavel_id: string | null;
      projects: { nome: string } | null;
    };

    // Lista final de destinatários (exclui o próprio user que disparou)
    const targetIds = (
      newAssigneeIds.length > 0
        ? newAssigneeIds
        : t.responsavel_id
          ? [t.responsavel_id]
          : []
    ).filter((id) => id !== user.id);

    if (targetIds.length === 0) {
      return NextResponse.json({ ok: true, skipped: "ninguém para notificar" });
    }

    const { data: respUsers } = await supabase
      .from("users")
      .select("id, nome, email")
      .in("id", targetIds);

    const results: Array<{ to: string; ok: boolean; error?: string }> = [];
    for (const r of (respUsers as Array<{ nome: string; email: string }>) ?? []) {
      if (!r.email) continue;
      const emailRes = await sendEmail({
        to: r.email,
        subject: `Nova tarefa: ${t.titulo}`,
        html: taskAssignedEmailHTML({
          responsavelNome: r.nome,
          taskTitle: t.titulo,
          projectName: t.projects?.nome ?? null,
          priority: t.prioridade,
          prazo: t.prazo,
          descricao: t.descricao,
          projectId: t.project_id
        })
      });
      results.push({
        to: r.email,
        ok: !!emailRes.ok,
        error: emailRes.error ?? undefined
      });
    }

    return NextResponse.json({ ok: true, results });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro inesperado" },
      { status: 500 }
    );
  }
}
