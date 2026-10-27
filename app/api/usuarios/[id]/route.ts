import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/permissions-server";
import { guardTargetUser } from "@/lib/user-management-server";
import { sanitizeUserPatch } from "@/lib/user-management";

export const runtime = "nodejs";

/**
 * PATCH /api/usuarios/[id]
 * Body: { nome?, cargo?, setor_principal_id?, ativo? }
 *
 * Edição feita pela tabela de equipe. Passa pelo servidor porque o banco só
 * aceita alterar a linha de outra pessoa vindo de quem tem acesso total — e a
 * permissão de editar a equipe pode ter sido delegada a um perfil comum.
 */
export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const auth = await requirePermission("configuracoes.time", "edit");
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const resultado = sanitizeUserPatch(await req.json().catch(() => null));
  if ("error" in resultado) {
    return NextResponse.json({ error: resultado.error }, { status: 400 });
  }
  const { patch } = resultado;

  const targetId = ctx.params.id;
  if (targetId === auth.userId && patch.ativo === false) {
    return NextResponse.json({ error: "Você não pode desativar a si mesmo." }, { status: 400 });
  }

  const admin = createAdminClient();
  const recusa = await guardTargetUser(admin, auth, targetId);
  if (recusa) return recusa;

  const { data, error } = await admin
    .from("users")
    .update(patch)
    .eq("id", targetId)
    .select("id")
    .maybeSingle();
  if (error) {
    // 42501 vem das guardas do banco (ex.: desativar o último Super Admin).
    return NextResponse.json(
      { error: error.message },
      { status: error.code === "42501" ? 400 : 500 }
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Nada foi alterado" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/usuarios/[id]
 * Exclui um usuário PERMANENTEMENTE: auth.users e public.users.
 *
 * Restrições:
 *  - configuracoes.time:delete;
 *  - ninguém exclui a si mesmo;
 *  - quem não tem acesso total não exclui quem tem;
 *  - o banco recusa excluir o último Super Admin ativo (migration 043).
 */
export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  try {
    const auth = await requirePermission("configuracoes.time", "delete");
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const targetId = ctx.params.id;
    if (!targetId) {
      return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
    }
    if (targetId === auth.userId) {
      return NextResponse.json(
        { error: "Você não pode excluir a si mesmo." },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const recusa = await guardTargetUser(admin, auth, targetId);
    if (recusa) return recusa;

    // Apaga primeiro do auth (corta o acesso na hora). A FK de public.users com
    // ON DELETE CASCADE leva o perfil junto; o delete explícito cobre perfis
    // sem vínculo com o auth.
    const { error: authErr } = await admin.auth.admin.deleteUser(targetId);
    const { error: pubErr } = await admin.from("users").delete().eq("id", targetId);

    // Confere o resultado em vez de presumir. Antes, quando as duas exclusões
    // falhavam, a rota respondia sucesso e a pessoa voltava ao recarregar.
    const { data: restante } = await admin
      .from("users")
      .select("id")
      .eq("id", targetId)
      .maybeSingle();
    if (restante) {
      console.error("[users/delete] exclusão não concluída", {
        auth: authErr?.message,
        perfil: pubErr?.message
      });
      const motivo = pubErr?.message ?? authErr?.message ?? "o banco manteve o registro";
      return NextResponse.json(
        { error: `Não foi possível excluir: ${motivo}` },
        { status: pubErr?.code === "42501" ? 400 : 500 }
      );
    }
    if (authErr) {
      console.warn("[users/delete] perfil removido, mas o auth respondeu:", authErr.message);
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro inesperado" },
      { status: 500 }
    );
  }
}
