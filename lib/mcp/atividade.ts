import { createAdminClient } from "@/lib/supabase/admin";
import type { McpUser } from "@/lib/mcp/auth";

/**
 * Registra no Registro de atividades o que a pessoa fez pelo conector do
 * Claude, em nome dela. Nunca lança: o registro não pode impedir a ação.
 */
export async function registrarAtividadeClaude(
  user: McpUser,
  ferramenta: string,
  resumo: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    await createAdminClient()
      .from("activity_logs")
      .insert({
        user_id: user.id,
        user_nome: user.nome,
        user_email: user.email,
        action: "claude_conector",
        tool_nome: `Pelo Claude: ${resumo}`.slice(0, 200),
        metadata: { ferramenta, ...metadata }
      });
  } catch {
    /* nunca propaga */
  }
}
