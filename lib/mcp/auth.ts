import { createHash, randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PermissionAction } from "@/lib/permissions";

/**
 * Autenticação do conector MCP.
 *
 * Cada pessoa gera um token pessoal no sistema e cola a URL do conector no
 * Claude. O token identifica quem está do outro lado — e a partir daí o
 * servidor aplica exatamente as mesmas permissões que a pessoa tem no app.
 *
 * Guardamos só o hash: o valor em claro aparece uma única vez, na criação.
 */

const PREFIX = "vfmcp_";

export function generateToken(): { token: string; hash: string; prefixo: string } {
  const raw = randomBytes(24).toString("base64url");
  const token = `${PREFIX}${raw}`;
  return {
    token,
    hash: hashToken(token),
    // o suficiente pra pessoa reconhecer o token na lista, sem revelá-lo
    prefixo: token.slice(0, PREFIX.length + 6)
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface McpUser {
  id: string;
  nome: string;
  email: string;
}

/**
 * Resolve o token para um usuário ativo. Retorna null se o token for
 * inválido, revogado, ou se a pessoa estiver desativada.
 */
export async function resolveToken(token: string): Promise<McpUser | null> {
  if (!token || !token.startsWith(PREFIX)) return null;
  const supabase = createAdminClient();

  const { data: row } = await supabase
    .from("mcp_tokens")
    .select("id, user_id, revoked_at")
    .eq("token_hash", hashToken(token))
    .is("revoked_at", null)
    .maybeSingle();
  if (!row) return null;

  const { data: user } = await supabase
    .from("users")
    .select("id, nome, email, ativo")
    .eq("id", (row as { user_id: string }).user_id)
    .maybeSingle();
  const u = user as
    | { id: string; nome: string; email: string; ativo: boolean }
    | null;
  if (!u || !u.ativo) return null;

  // Carimba o uso sem bloquear a resposta.
  void supabase
    .from("mcp_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", (row as { id: string }).id)
    .then(() => undefined);

  return { id: u.id, nome: u.nome, email: u.email };
}

/**
 * Checa uma permissão do catálogo (mesma função que a aplicação usa).
 * Falha fechado: qualquer erro nega o acesso.
 */
export async function can(
  userId: string,
  resource: string,
  action: PermissionAction
): Promise<boolean> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("has_permission", {
    uid: userId,
    p_resource: resource,
    p_action: action
  });
  if (error) return false;
  return data === true;
}

/** Projetos que a pessoa enxerga (respeita as regras de acesso do app). */
export async function visibleProjectIds(userId: string): Promise<string[]> {
  const supabase = createAdminClient();
  const { data } = await supabase.from("projects").select("id, status");
  const ids: string[] = [];
  for (const p of (data as Array<{ id: string }>) ?? []) {
    const { data: ok } = await supabase.rpc("user_can_see_project", {
      uid: userId,
      pid: p.id
    });
    if (ok === true) ids.push(p.id);
  }
  return ids;
}

/** Erro de permissão, formatado para o Claude explicar ao usuário. */
export class McpPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpPermissionError";
  }
}
