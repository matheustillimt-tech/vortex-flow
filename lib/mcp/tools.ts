import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { can, visibleProjectIds, type McpUser } from "@/lib/mcp/auth";
import { APP_NAME } from "@/lib/brand";

/**
 * Ferramentas do conector MCP do sistema (o nome vem de lib/brand.ts).
 *
 * Toda ferramenta recebe o usuário já resolvido pelo token e revalida a
 * permissão antes de agir — o conector nunca dá mais poder do que a pessoa
 * já tem na interface.
 */

type Texto = { content: Array<{ type: "text"; text: string }> };

function ok(text: string): Texto {
  return { content: [{ type: "text", text }] };
}
function negado(acao: string): Texto {
  return ok(
    `Sem permissão para ${acao}. Fale com um administrador do ${APP_NAME}.`
  );
}

/** Aceita "amanhã", "2026-09-20", "20/09/2026" e devolve ISO (ou null). */
export function parsePrazo(input?: string | null): string | null {
  if (!input) return null;
  const v = input.trim().toLowerCase();
  const hoje = new Date();
  hoje.setHours(12, 0, 0, 0);

  if (v === "hoje") return hoje.toISOString();
  if (v === "amanha" || v === "amanhã") {
    hoje.setDate(hoje.getDate() + 1);
    return hoje.toISOString();
  }
  const emDias = v.match(/^em (\d+) dias?$/);
  if (emDias) {
    hoje.setDate(hoje.getDate() + parseInt(emDias[1], 10));
    return hoje.toISOString();
  }
  // 20/09/2026 ou 20/09
  const br = v.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (br) {
    const ano = br[3] ? parseInt(br[3], 10) : hoje.getFullYear();
    const d = new Date(ano, parseInt(br[2], 10) - 1, parseInt(br[1], 10), 12);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  // ISO com ou sem hora
  const iso = new Date(v.length === 10 ? `${v}T12:00:00` : v);
  return isNaN(iso.getTime()) ? null : iso.toISOString();
}

/** Resolve nomes/emails informados pelo Claude para ids de usuários. */
async function resolverResponsaveis(
  nomes: string[]
): Promise<{ ids: string[]; naoEncontrados: string[] }> {
  if (nomes.length === 0) return { ids: [], naoEncontrados: [] };
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("users")
    .select("id, nome, email")
    .eq("ativo", true);
  const users = (data as Array<{ id: string; nome: string; email: string }>) ?? [];

  const ids: string[] = [];
  const naoEncontrados: string[] = [];
  for (const termo of nomes) {
    const t = termo.trim().toLowerCase();
    const achado =
      users.find((u) => u.email.toLowerCase() === t) ??
      users.find((u) => u.nome.toLowerCase() === t) ??
      users.find((u) => u.nome.toLowerCase().includes(t)) ??
      users.find((u) => u.id === termo);
    if (achado) {
      if (!ids.includes(achado.id)) ids.push(achado.id);
    } else {
      naoEncontrados.push(termo);
    }
  }
  return { ids, naoEncontrados };
}

/** Resolve nome de projeto para id, dentro do que a pessoa enxerga. */
async function resolverProjeto(
  userId: string,
  termo: string
): Promise<{ id: string; nome: string } | null> {
  const supabase = createAdminClient();
  const permitidos = await visibleProjectIds(userId);
  if (permitidos.length === 0) return null;
  const { data } = await supabase
    .from("projects")
    .select("id, nome")
    .in("id", permitidos);
  const projetos = (data as Array<{ id: string; nome: string }>) ?? [];
  const t = termo.trim().toLowerCase();
  return (
    projetos.find((p) => p.id === termo) ??
    projetos.find((p) => p.nome.toLowerCase() === t) ??
    projetos.find((p) => p.nome.toLowerCase().includes(t)) ??
    null
  );
}

const PRIORIDADES = ["baixa", "media", "alta", "urgente"] as const;
const TIPOS_PROJETO = ["infoproduto", "saas", "produto_fisico"] as const;

// ============================================================
// Definições das ferramentas
// ============================================================
export function buildTools(user: McpUser) {
  return [
    {
      name: "listar_projetos",
      config: {
        title: "Listar projetos",
        description:
          `Lista os projetos do ${APP_NAME} que este usuário pode acessar. Use antes de criar uma tarefa, para descobrir o nome exato do projeto.`,
        inputSchema: z.object({})
      },
      handler: async (): Promise<Texto> => {
        if (!(await can(user.id, "projetos", "view")))
          return negado("ver projetos");
        const supabase = createAdminClient();
        const ids = await visibleProjectIds(user.id);
        if (ids.length === 0) return ok("Nenhum projeto acessível.");
        const { data } = await supabase
          .from("projects")
          .select("id, nome, status")
          .in("id", ids)
          .eq("status", "ativo")
          .order("nome");
        const linhas = ((data as Array<{ nome: string }>) ?? []).map(
          (p) => `- ${p.nome}`
        );
        return ok(
          linhas.length
            ? `Projetos ativos (${linhas.length}):\n${linhas.join("\n")}`
            : "Nenhum projeto ativo."
        );
      }
    },

    {
      name: "criar_projeto",
      config: {
        title: "Criar projeto",
        description:
          `Cria um projeto novo no ${APP_NAME}, já com o quadro padrão (Demandas, Em andamento, Em revisão, Concluídas). Depois é só criar tarefas nele com criar_tarefa.`,
        inputSchema: z.object({
          nome: z.string().min(1).describe("Nome do projeto"),
          descricao: z.string().optional().describe("Sobre o que é o projeto"),
          tipo: z
            .enum(TIPOS_PROJETO)
            .optional()
            .describe(
              "infoproduto (com funis e tickets), saas ou produto_fisico. Padrão: infoproduto. Não pode ser alterado depois."
            ),
          prioridade: z.enum(PRIORIDADES).optional().describe("Padrão: media")
        })
      },
      handler: async (args: {
        nome: string;
        descricao?: string;
        tipo?: (typeof TIPOS_PROJETO)[number];
        prioridade?: (typeof PRIORIDADES)[number];
      }): Promise<Texto> => {
        if (!(await can(user.id, "projetos", "create")))
          return negado("criar projetos");

        const nome = args.nome.trim();
        const supabase = createAdminClient();

        // Evita duplicar um projeto que já existe (pedido repetido na conversa).
        const { data: mesmoNome } = await supabase
          .from("projects")
          .select("id, nome")
          .ilike("nome", nome.replace(/[%_\\]/g, "\\$&"))
          .limit(1)
          .maybeSingle();
        if (mesmoNome)
          return ok(
            `Já existe um projeto chamado "${(mesmoNome as { nome: string }).nome}". Nada foi criado.`
          );

        const { data: novo, error } = await supabase
          .from("projects")
          .insert({
            nome,
            descricao: args.descricao?.trim() || null,
            status: "ativo",
            prioridade: args.prioridade ?? "media",
            cor: "#3b82f6",
            tipo: args.tipo ?? "infoproduto"
          })
          .select("id, nome")
          .single();
        if (error) return ok(`Erro ao criar o projeto: ${error.message}`);
        const criado = novo as { id: string; nome: string };

        // Mesmo passo da tela de projetos; as colunas do quadro vêm do
        // gatilho trg_seed_kanban_on_insert.
        await supabase.from("maps").insert({
          nome: "Mapa do projeto",
          scope: "project",
          project_id: criado.id,
          is_default: true
        });

        // Quem tem acesso restrito a projetos não enxergaria o que acabou de
        // criar — e não conseguiria pôr tarefas nele.
        const { data: enxerga } = await supabase.rpc("user_can_see_project", {
          uid: user.id,
          pid: criado.id
        });
        if (enxerga !== true) {
          await supabase.from("project_members").insert({
            project_id: criado.id,
            user_id: user.id,
            granted_by: user.id
          });
        }

        return ok(
          `Projeto criado: "${criado.nome}" (${args.tipo ?? "infoproduto"}), com o quadro padrão. Já dá pra criar tarefas nele.`
        );
      }
    },

    {
      name: "listar_colaboradores",
      config: {
        title: "Listar colaboradores",
        description:
          "Lista os colaboradores ativos da empresa (nome e função). Use para descobrir a quem atribuir uma tarefa.",
        inputSchema: z.object({})
      },
      handler: async (): Promise<Texto> => {
        const supabase = createAdminClient();
        const { data } = await supabase
          .from("users")
          .select("nome, cargo")
          .eq("ativo", true)
          .order("nome");
        const linhas = (
          (data as Array<{ nome: string; cargo: string | null }>) ?? []
        ).map((u) => `- ${u.nome}${u.cargo ? ` (${u.cargo})` : ""}`);
        return ok(
          linhas.length
            ? `Colaboradores ativos (${linhas.length}):\n${linhas.join("\n")}`
            : "Nenhum colaborador ativo."
        );
      }
    },

    {
      name: "criar_tarefa",
      config: {
        title: "Criar tarefa",
        description:
          `Cria uma tarefa em um projeto do ${APP_NAME}, podendo já definir prazo, responsáveis e prioridade. A tarefa entra na primeira coluna do quadro do projeto.`,
        inputSchema: z.object({
          titulo: z.string().min(1).describe("Título da tarefa"),
          projeto: z
            .string()
            .describe("Nome do projeto (use listar_projetos para descobrir)"),
          descricao: z.string().optional().describe("Detalhes da tarefa"),
          responsaveis: z
            .array(z.string())
            .optional()
            .describe("Nomes ou e-mails dos responsáveis"),
          prazo: z
            .string()
            .optional()
            .describe(
              "Prazo: 'hoje', 'amanhã', 'em 3 dias', '20/09/2026' ou '2026-09-20'"
            ),
          prioridade: z.enum(PRIORIDADES).optional().describe("Padrão: media")
        })
      },
      handler: async (args: {
        titulo: string;
        projeto: string;
        descricao?: string;
        responsaveis?: string[];
        prazo?: string;
        prioridade?: (typeof PRIORIDADES)[number];
      }): Promise<Texto> => {
        if (!(await can(user.id, "tarefas", "create")))
          return negado("criar tarefas");

        const projeto = await resolverProjeto(user.id, args.projeto);
        if (!projeto)
          return ok(
            `Projeto "${args.projeto}" não encontrado entre os que você acessa. Use listar_projetos.`
          );

        const supabase = createAdminClient();
        const { data: col } = await supabase
          .from("kanban_columns")
          .select("id")
          .eq("project_id", projeto.id)
          .order("ordem")
          .limit(1)
          .maybeSingle();

        const prazoIso = parsePrazo(args.prazo);
        if (args.prazo && !prazoIso)
          return ok(
            `Não entendi o prazo "${args.prazo}". Use 'amanhã', 'em 3 dias' ou '20/09/2026'.`
          );

        const { ids: respIds, naoEncontrados } = await resolverResponsaveis(
          args.responsaveis ?? []
        );

        const { data: nova, error } = await supabase
          .from("tasks")
          .insert({
            titulo: args.titulo.trim(),
            descricao: args.descricao?.trim() || null,
            project_id: projeto.id,
            status: "pendente",
            prioridade: args.prioridade ?? "media",
            prazo: prazoIso,
            prazo_has_time: false,
            kanban_column_id: (col as { id: string } | null)?.id ?? null,
            responsavel_id: respIds[0] ?? null,
            created_by: user.id
          })
          .select("id, titulo")
          .single();
        if (error) return ok(`Erro ao criar a tarefa: ${error.message}`);

        const criada = nova as { id: string; titulo: string };
        if (respIds.length > 0) {
          await supabase.from("task_assignees").insert(
            respIds.map((uid, i) => ({
              task_id: criada.id,
              user_id: uid,
              primary_assignee: i === 0
            }))
          );
        }

        const partes = [`Tarefa criada: "${criada.titulo}" em ${projeto.nome}.`];
        if (prazoIso)
          partes.push(
            `Prazo: ${new Date(prazoIso).toLocaleDateString("pt-BR")}.`
          );
        if (respIds.length > 0)
          partes.push(`Responsáveis atribuídos: ${respIds.length}.`);
        if (naoEncontrados.length > 0)
          partes.push(
            `Não encontrei: ${naoEncontrados.join(", ")} — ninguém foi atribuído com esses nomes.`
          );
        return ok(partes.join(" "));
      }
    },

    {
      name: "listar_tarefas",
      config: {
        title: "Listar tarefas",
        description:
          `Lista tarefas do ${APP_NAME}, com filtros por projeto, responsável, status e atraso.`,
        inputSchema: z.object({
          projeto: z.string().optional().describe("Nome do projeto"),
          responsavel: z
            .string()
            .optional()
            .describe("Nome/e-mail do responsável. Use 'eu' para você mesmo."),
          status: z
            .enum(["pendente", "em_andamento", "em_revisao", "travado", "concluido"])
            .optional(),
          apenas_atrasadas: z.boolean().optional(),
          limite: z.number().int().min(1).max(100).optional()
        })
      },
      handler: async (args: {
        projeto?: string;
        responsavel?: string;
        status?: string;
        apenas_atrasadas?: boolean;
        limite?: number;
      }): Promise<Texto> => {
        if (!(await can(user.id, "tarefas", "view")))
          return negado("ver tarefas");

        const supabase = createAdminClient();
        const permitidos = await visibleProjectIds(user.id);
        if (permitidos.length === 0) return ok("Nenhum projeto acessível.");

        let alvoProjetos = permitidos;
        if (args.projeto) {
          const p = await resolverProjeto(user.id, args.projeto);
          if (!p) return ok(`Projeto "${args.projeto}" não encontrado.`);
          alvoProjetos = [p.id];
        }

        // O filtro de responsável precisa entrar ANTES do limite, senão
        // tarefas dessa pessoa com prazo mais distante somem do resultado.
        let idsDoResponsavel: string[] | null = null;
        if (args.responsavel) {
          const termo = args.responsavel.trim().toLowerCase();
          let alvoId: string | null = null;
          if (termo === "eu" || termo === "mim") alvoId = user.id;
          else {
            const { ids } = await resolverResponsaveis([args.responsavel]);
            alvoId = ids[0] ?? null;
          }
          if (!alvoId)
            return ok(`Não encontrei o colaborador "${args.responsavel}".`);

          const [{ data: asg }, { data: legado }] = await Promise.all([
            supabase.from("task_assignees").select("task_id").eq("user_id", alvoId),
            supabase
              .from("tasks")
              .select("id")
              .eq("responsavel_id", alvoId)
              .in("project_id", alvoProjetos)
          ]);
          const conjunto = new Set<string>([
            ...((asg as Array<{ task_id: string }>) ?? []).map((a) => a.task_id),
            ...((legado as Array<{ id: string }>) ?? []).map((t) => t.id)
          ]);
          idsDoResponsavel = Array.from(conjunto);
          if (idsDoResponsavel.length === 0)
            return ok("Nenhuma tarefa atribuída a essa pessoa.");
        }

        let query = supabase
          .from("tasks")
          .select("id, titulo, status, prioridade, prazo, project_id, responsavel_id")
          .in("project_id", alvoProjetos)
          .order("prazo", { ascending: true, nullsFirst: false })
          .limit(args.limite ?? 30);
        if (args.status) query = query.eq("status", args.status);
        if (idsDoResponsavel) query = query.in("id", idsDoResponsavel);
        if (args.apenas_atrasadas) {
          query = query
            .lt("prazo", new Date().toISOString())
            .neq("status", "concluido");
        }

        const { data, error } = await query;
        if (error) return ok(`Erro ao buscar tarefas: ${error.message}`);
        const tarefas =
          (data as Array<{
            id: string;
            titulo: string;
            status: string;
            prioridade: string;
            prazo: string | null;
            project_id: string;
            responsavel_id: string | null;
          }>) ?? [];

        if (tarefas.length === 0)
          return ok("Nenhuma tarefa encontrada com esses filtros.");

        const { data: projs } = await supabase
          .from("projects")
          .select("id, nome")
          .in("id", alvoProjetos);
        const nomeProjeto = new Map(
          ((projs as Array<{ id: string; nome: string }>) ?? []).map((p) => [
            p.id,
            p.nome
          ])
        );

        const linhas = tarefas.map((t) => {
          const prazo = t.prazo
            ? new Date(t.prazo).toLocaleDateString("pt-BR")
            : "sem prazo";
          return `- ${t.titulo} | ${nomeProjeto.get(t.project_id) ?? "?"} | ${t.status} | ${t.prioridade} | ${prazo}`;
        });
        return ok(`${tarefas.length} tarefa(s):\n${linhas.join("\n")}`);
      }
    },

    {
      name: "atualizar_tarefa",
      config: {
        title: "Atualizar tarefa",
        description:
          "Altera prazo, responsáveis, prioridade, status ou projeto de uma tarefa existente, localizada pelo título.",
        inputSchema: z.object({
          titulo: z
            .string()
            .describe("Título (ou parte dele) da tarefa a atualizar"),
          projeto: z
            .string()
            .optional()
            .describe("Projeto, para desambiguar títulos parecidos"),
          prazo: z.string().optional().describe("Novo prazo"),
          responsaveis: z
            .array(z.string())
            .optional()
            .describe("Substitui os responsáveis atuais"),
          prioridade: z.enum(PRIORIDADES).optional(),
          status: z
            .enum(["pendente", "em_andamento", "em_revisao", "travado", "concluido"])
            .optional(),
          mover_para_projeto: z
            .string()
            .optional()
            .describe(
              "Nome do projeto para onde a tarefa vai (troca de projeto). Não confundir com 'projeto', que só desambigua a busca."
            )
        })
      },
      handler: async (args: {
        titulo: string;
        projeto?: string;
        prazo?: string;
        responsaveis?: string[];
        prioridade?: (typeof PRIORIDADES)[number];
        status?: string;
        mover_para_projeto?: string;
      }): Promise<Texto> => {
        if (!(await can(user.id, "tarefas", "edit")))
          return negado("editar tarefas");

        const supabase = createAdminClient();
        let alvoProjetos = await visibleProjectIds(user.id);
        if (alvoProjetos.length === 0) return ok("Nenhum projeto acessível.");
        if (args.projeto) {
          const p = await resolverProjeto(user.id, args.projeto);
          if (!p) return ok(`Projeto "${args.projeto}" não encontrado.`);
          alvoProjetos = [p.id];
        }

        const { data } = await supabase
          .from("tasks")
          .select("id, titulo, status, project_id")
          .in("project_id", alvoProjetos)
          .ilike("titulo", `%${args.titulo.trim()}%`)
          .limit(5);
        const achadas =
          (data as Array<{
            id: string;
            titulo: string;
            status: string;
            project_id: string;
          }>) ?? [];
        if (achadas.length === 0)
          return ok(`Nenhuma tarefa encontrada com "${args.titulo}".`);
        if (achadas.length > 1)
          return ok(
            `Encontrei ${achadas.length} tarefas parecidas:\n${achadas
              .map((t) => `- ${t.titulo}`)
              .join("\n")}\nSeja mais específico (ou informe o projeto).`
          );

        const tarefa = achadas[0];
        const patch: Record<string, unknown> = {};

        if (args.prazo !== undefined) {
          const iso = parsePrazo(args.prazo);
          if (!iso) return ok(`Não entendi o prazo "${args.prazo}".`);
          patch.prazo = iso;
          patch.prazo_has_time = false;
        }
        if (args.prioridade) patch.prioridade = args.prioridade;
        if (args.status) {
          patch.status = args.status;
          patch.data_conclusao =
            args.status === "concluido" ? new Date().toISOString() : null;
        }

        let msgProjeto = "";
        if (args.mover_para_projeto) {
          const destino = await resolverProjeto(user.id, args.mover_para_projeto);
          if (!destino)
            return ok(
              `Projeto "${args.mover_para_projeto}" não encontrado entre os que você acessa. Nada foi alterado.`
            );
          if (destino.id !== tarefa.project_id) {
            // Coluna do destino com o mesmo status da tarefa; senão a 1ª.
            // Cair numa coluna com outro status_ao_mover faria o gatilho
            // trocar o status sozinho (ex.: "em andamento" voltar a "pendente").
            const statusFinal = args.status ?? tarefa.status;
            const { data: cols } = await supabase
              .from("kanban_columns")
              .select("id, status_ao_mover")
              .eq("project_id", destino.id)
              .order("ordem");
            const colunas =
              (cols as Array<{ id: string; status_ao_mover: string | null }>) ??
              [];
            const coluna =
              colunas.find((c) => c.status_ao_mover === statusFinal) ??
              colunas[0];

            patch.project_id = destino.id;
            patch.kanban_column_id = coluna?.id ?? null;
            // Funil e produto são do projeto antigo.
            patch.funnel_id = null;
            patch.product_id = null;
          }
          msgProjeto = ` Movida para ${destino.nome}.`;
        }

        if (Object.keys(patch).length > 0) {
          const { error } = await supabase
            .from("tasks")
            .update(patch)
            .eq("id", tarefa.id);
          if (error) return ok(`Erro ao atualizar: ${error.message}`);
        }

        let msgResp = "";
        if (args.responsaveis) {
          const { ids, naoEncontrados } = await resolverResponsaveis(
            args.responsaveis
          );
          await supabase.from("task_assignees").delete().eq("task_id", tarefa.id);
          if (ids.length > 0) {
            await supabase.from("task_assignees").insert(
              ids.map((uid, i) => ({
                task_id: tarefa.id,
                user_id: uid,
                primary_assignee: i === 0
              }))
            );
            await supabase
              .from("tasks")
              .update({ responsavel_id: ids[0] })
              .eq("id", tarefa.id);
          }
          msgResp = ` Responsáveis atualizados (${ids.length}).`;
          if (naoEncontrados.length > 0)
            msgResp += ` Não encontrei: ${naoEncontrados.join(", ")}.`;
        }

        return ok(`Tarefa "${tarefa.titulo}" atualizada.${msgProjeto}${msgResp}`);
      }
    },

    {
      name: "excluir_tarefa",
      config: {
        title: "Excluir tarefa",
        description:
          "Exclui uma tarefa, localizada pelo título. Não tem volta: chame primeiro sem 'confirmar' para ver qual tarefa seria apagada, mostre ao usuário e só chame de novo com confirmar=true depois que ele disser sim.",
        inputSchema: z.object({
          titulo: z
            .string()
            .describe("Título (ou parte dele) da tarefa a excluir"),
          projeto: z
            .string()
            .optional()
            .describe("Projeto, para desambiguar títulos parecidos"),
          confirmar: z
            .boolean()
            .optional()
            .describe(
              "true só depois que o usuário confirmar a exclusão. Sem isso, nada é apagado."
            )
        })
      },
      handler: async (args: {
        titulo: string;
        projeto?: string;
        confirmar?: boolean;
      }): Promise<Texto> => {
        // Mesma trava da RLS (migration 044), que a chave de admin não aplica.
        if (!(await can(user.id, "tarefas", "delete")))
          return negado("excluir tarefas");

        const supabase = createAdminClient();
        let alvoProjetos = await visibleProjectIds(user.id);
        if (alvoProjetos.length === 0) return ok("Nenhum projeto acessível.");
        if (args.projeto) {
          const p = await resolverProjeto(user.id, args.projeto);
          if (!p) return ok(`Projeto "${args.projeto}" não encontrado.`);
          alvoProjetos = [p.id];
        }

        const { data } = await supabase
          .from("tasks")
          .select("id, titulo, status, project_id")
          .in("project_id", alvoProjetos)
          .ilike("titulo", `%${args.titulo.trim()}%`)
          .limit(5);
        const achadas =
          (data as Array<{
            id: string;
            titulo: string;
            status: string;
            project_id: string;
          }>) ?? [];
        if (achadas.length === 0)
          return ok(`Nenhuma tarefa encontrada com "${args.titulo}".`);
        if (achadas.length > 1)
          return ok(
            `Encontrei ${achadas.length} tarefas parecidas:\n${achadas
              .map((t) => `- ${t.titulo}`)
              .join("\n")}\nSeja mais específico (ou informe o projeto). Nada foi apagado.`
          );

        const tarefa = achadas[0];
        const { data: proj } = await supabase
          .from("projects")
          .select("nome")
          .eq("id", tarefa.project_id)
          .maybeSingle();
        const nomeProjeto = (proj as { nome: string } | null)?.nome ?? "?";

        if (args.confirmar !== true)
          return ok(
            `Vou excluir a tarefa "${tarefa.titulo}" (${nomeProjeto}, ${tarefa.status}), junto com responsáveis, checklist e anexos dela. Não tem volta. Confirme com o usuário e chame de novo com confirmar=true.`
          );

        const { error, count } = await supabase
          .from("tasks")
          .delete({ count: "exact" })
          .eq("id", tarefa.id);
        if (error) return ok(`Erro ao excluir: ${error.message}`);
        if (count === 0)
          return ok(`A tarefa "${tarefa.titulo}" não foi encontrada para excluir.`);
        return ok(`Tarefa "${tarefa.titulo}" excluída de ${nomeProjeto}.`);
      }
    }
  ];
}
