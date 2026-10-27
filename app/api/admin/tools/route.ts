import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activity-log";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { requirePermission } from "@/lib/permissions-server";
import { can } from "@/lib/permissions";

export const runtime = "nodejs";

/**
 * GET /api/admin/tools
 * Lista completa de ferramentas e de quem acessa cada uma, para quem as gere
 * (criar, editar ou excluir). As senhas só vêm decriptadas para quem tem
 * acesso total; quem gere sem ele recebe `senha: null` e `tem_senha`, e pode
 * apenas sobrescrevê-las.
 */
export async function GET() {
  const auth = await requirePermission("ferramentas", "view");
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const gere = (["create", "edit", "delete"] as const).some((acao) =>
    can(auth.perms, "ferramentas", acao)
  );
  if (!gere) {
    return NextResponse.json(
      { error: "Você não tem permissão para esta ação" },
      { status: 403 }
    );
  }

  const admin = createAdminClient();
  const [{ data: tools, error: tErr }, { data: access, error: aErr }] =
    await Promise.all([
      admin
        .from("tools")
        .select(
          "id, nome, url, descricao, icon, cor, login, senha, created_by, created_at, updated_at"
        )
        .order("nome"),
      admin.from("tool_user_access").select("tool_id, user_id")
    ]);
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 400 });
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 400 });

  const veSenha = auth.perms.fullAccess;
  const lista = (tools ?? []).map((t) => ({
    ...t,
    senha: veSenha && t.senha ? safeDecrypt(t.senha as string) : null,
    tem_senha: !!t.senha
  }));
  return NextResponse.json({ tools: lista, access: access ?? [] });
}

function safeDecrypt(blob: string): string | null {
  try {
    return decryptSecret(blob);
  } catch {
    return null;
  }
}

/**
 * POST /api/admin/tools
 * Body: {
 *   nome, url, descricao?, icon?, cor, login?, senha?,
 *   allowed_user_ids: string[]
 * }
 */
export async function POST(req: Request) {
  const auth = await requirePermission("ferramentas", "create");
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const body = (await req.json().catch(() => ({}))) as {
    nome?: string;
    url?: string;
    descricao?: string | null;
    icon?: string | null;
    cor?: string;
    login?: string | null;
    senha?: string | null;
    allowed_user_ids?: string[];
  };
  if (!body.nome?.trim()) {
    return NextResponse.json({ error: "Nome obrigatório" }, { status: 400 });
  }
  if (!body.url?.trim()) {
    return NextResponse.json({ error: "URL obrigatória" }, { status: 400 });
  }
  const admin = createAdminClient();
  const { data: created, error } = await admin
    .from("tools")
    .insert({
      nome: body.nome.trim(),
      url: body.url.trim(),
      descricao: body.descricao?.trim() || null,
      icon: body.icon?.trim() || null,
      cor: body.cor || "#3b82f6",
      login: body.login?.trim() || null,
      senha: encryptSecret(body.senha ?? null),
      created_by: auth.userId
    })
    .select()
    .single();
  if (error || !created) {
    return NextResponse.json(
      { error: error?.message ?? "Falha ao criar" },
      { status: 400 }
    );
  }

  if (body.allowed_user_ids && body.allowed_user_ids.length > 0) {
    const rows = body.allowed_user_ids.map((uid) => ({
      tool_id: created.id as string,
      user_id: uid,
      granted_by: auth.userId
    }));
    const { error: linkErr } = await admin.from("tool_user_access").insert(rows);
    if (linkErr) {
      return NextResponse.json({ error: linkErr.message }, { status: 400 });
    }
  }

  await logActivity({
    user_id: auth.userId,
    user_nome: auth.nome,
    user_email: auth.email,
    action: "tool_created",
    tool_id: created.id as string,
    tool_nome: created.nome as string,
    request: req,
    metadata: { allowed_user_count: body.allowed_user_ids?.length ?? 0 }
  });

  // A resposta não devolve a senha gravada.
  const { senha: _senha, ...semSenha } = created as Record<string, unknown>;
  return NextResponse.json({ ok: true, tool: semSenha });
}
