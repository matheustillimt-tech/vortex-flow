import { createMcpHandler } from "mcp-handler";
import { resolveToken } from "@/lib/mcp/auth";
import { buildTools } from "@/lib/mcp/tools";

/**
 * Conector MCP do sistema.
 *
 * URL por pessoa: https://<app>/api/mcp/<token-pessoal>
 * O token identifica quem está do outro lado; as ferramentas revalidam as
 * permissões dessa pessoa a cada chamada.
 *
 * `mcp-handler` não inspeciona o pathname, então o token pode viver no path.
 */

export const maxDuration = 60;

async function handle(
  req: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  const user = await resolveToken(token);

  if (!user) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message:
            "Token inválido ou revogado. Gere um novo em Configurações → Conector do Claude."
        },
        id: null
      }),
      { status: 401, headers: { "content-type": "application/json" } }
    );
  }

  const handler = createMcpHandler((server) => {
    for (const tool of buildTools(user)) {
      server.registerTool(
        tool.name,
        tool.config,
        tool.handler as Parameters<typeof server.registerTool>[2]
      );
    }
  });

  return handler(req);
}

export { handle as GET, handle as POST, handle as DELETE };
