import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activity-log";
import { encryptSecret } from "@/lib/crypto";
import { requirePermission } from "@/lib/permissions-server";
import { resolvePasswordChange } from "@/lib/tool-password";

export const runtime = "nodejs";

/**
 * PATCH /api/admin/tools/[id]
 * Atualiza campos da ferramenta + sincroniza allowed_user_ids (se enviado).
 *
 * Senha: em branco mantém a atual; texto grava a nova; null remove, e só para
 * quem tem acesso total. Ver lib/tool-password.ts.
 */
export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const auth = await requirePermission("ferramentas", "edit");
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const id = ctx.params.id;
  const body = (await req.json().catch(() => ({}))) as {
    nome?: string;
    url?: string;
    descricao?: string | null;
    icon?: string | null;
    cor?: string;
    login?: string | null;
    senha?: unknown;
    allowed_user_ids?: string[];
  };

  const senha = resolvePasswordChange(body.senha, auth.perms.fullAccess);
  if ("error" in senha) {
    return NextResponse.json({ error: senha.error }, { status: senha.status });
  }

  const admin = createAdminClient();

  // Monta payload apenas com campos presentes
  const patch: Record<string, unknown> = {};
  if (typeof body.nome === "string") patch.nome = body.nome.trim();
  if (typeof body.url === "string") patch.url = body.url.trim();
  if (body.descricao !== undefined) patch.descricao = body.descricao?.trim() || null;
  if (body.icon !== undefined) patch.icon = body.icon?.trim() || null;
  if (typeof body.cor === "string") patch.cor = body.cor;
  if (body.login !== undefined) patch.login = body.login?.trim() || null;
  // Criptografa antes de gravar.
  if (senha.kind === "set") patch.senha = encryptSecret(senha.value);
  if (senha.kind === "clear") patch.senha = null;

  if (Object.keys(patch).length > 0) {
    const { error } = await admin.from("tools").update(patch).eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  if (body.allowed_user_ids) {
    // Sincroniza: apaga existentes e re-insere
    await admin.from("tool_user_access").delete().eq("tool_id", id);
    if (body.allowed_user_ids.length > 0) {
      const rows = body.allowed_user_ids.map((uid) => ({
        tool_id: id,
        user_id: uid,
        granted_by: auth.userId
      }));
      const { error: linkErr } = await admin
        .from("tool_user_access")
        .insert(rows);
      if (linkErr) {
        return NextResponse.json({ error: linkErr.message }, { status: 400 });
      }
    }
  }

  // Busca ferramenta atualizada
  const { data: updated } = await admin
    .from("tools")
    .select("id, nome")
    .eq("id", id)
    .maybeSingle();

  await logActivity({
    user_id: auth.userId,
    user_nome: auth.nome,
    user_email: auth.email,
    action: body.allowed_user_ids ? "tool_users_changed" : "tool_updated",
    tool_id: id,
    tool_nome: (updated as { nome?: string } | null)?.nome ?? null,
    request: req,
    metadata: {
      fields_changed: Object.keys(patch),
      allowed_user_count: body.allowed_user_ids?.length
    }
  });

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/admin/tools/[id]
 */
export async function DELETE(req: Request, ctx: { params: { id: string } }) {
  const auth = await requirePermission("ferramentas", "delete");
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const id = ctx.params.id;
  const admin = createAdminClient();
  const { data: tool } = await admin
    .from("tools")
    .select("nome")
    .eq("id", id)
    .maybeSingle();
  const { error } = await admin.from("tools").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  await logActivity({
    user_id: auth.userId,
    user_nome: auth.nome,
    user_email: auth.email,
    action: "tool_deleted",
    tool_id: id,
    tool_nome: (tool as { nome?: string } | null)?.nome ?? null,
    request: req
  });
  return NextResponse.json({ ok: true });
}
