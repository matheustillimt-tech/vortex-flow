import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Trava estática do conector MCP: cada ferramenta que grava tem de revalidar a
 * permissão da pessoa antes de agir.
 */

const codigo = readFileSync(
  fileURLToPath(new URL("../lib/mcp/tools.ts", import.meta.url)),
  "utf8"
);

function trechoDa(ferramenta: string): string {
  const inicio = codigo.indexOf(`name: "${ferramenta}"`);
  expect(inicio, `ferramenta ${ferramenta} não encontrada`).toBeGreaterThan(-1);
  const proxima = codigo.indexOf('name: "', inicio + 1);
  return codigo.slice(inicio, proxima === -1 ? undefined : proxima);
}

describe("ferramentas do conector MCP", () => {
  it.each([
    ["criar_projeto", 'can(user.id, "projetos", "create")'],
    ["criar_tarefa", 'can(user.id, "tarefas", "create")'],
    ["atualizar_tarefa", 'can(user.id, "tarefas", "edit")'],
    ["excluir_tarefa", 'can(user.id, "tarefas", "delete")']
  ])("%s passa pelo perfil", (ferramenta, exigido) => {
    expect(trechoDa(ferramenta)).toContain(exigido);
  });

  it("atualizar_tarefa só move para projeto que a pessoa enxerga, sem levar o que é do antigo", () => {
    const trecho = trechoDa("atualizar_tarefa");
    expect(trecho).toContain("resolverProjeto(user.id, args.mover_para_projeto)");
    expect(trecho).toContain("patch.kanban_column_id");
    expect(trecho).toContain("patch.funnel_id = null");
    expect(trecho).toContain("patch.product_id = null");
  });

  it("excluir_tarefa só apaga com confirmação explícita", () => {
    const trecho = trechoDa("excluir_tarefa");
    const confirmacao = trecho.indexOf("args.confirmar !== true");
    const exclusao = trecho.indexOf('from("tasks")\n          .delete(');
    expect(confirmacao).toBeGreaterThan(-1);
    expect(exclusao).toBeGreaterThan(confirmacao);
  });

  it("criar_projeto cria o mapa padrão, como a tela de projetos", () => {
    expect(trechoDa("criar_projeto")).toContain('from("maps").insert');
  });
});
