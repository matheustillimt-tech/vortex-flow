import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateToken } from "@/lib/mcp/auth";

/**
 * Gera e lista tokens do conector MCP do usuário logado.
 * O token em claro só existe na resposta do POST — depois, só o hash.
 */

export async function GET() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("mcp_tokens")
    .select("id, prefixo, nome, last_used_at, created_at")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  return NextResponse.json({ tokens: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { nome?: string };
  const { token, hash, prefixo } = generateToken();

  const admin = createAdminClient();
  const { error } = await admin.from("mcp_tokens").insert({
    user_id: user.id,
    token_hash: hash,
    prefixo,
    nome: body.nome?.trim() || "Claude"
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Única vez que o token aparece em claro.
  return NextResponse.json({ token });
}

export async function DELETE(req: Request) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id ausente" }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin
    .from("mcp_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id); // ninguém revoga token de outro por aqui
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
