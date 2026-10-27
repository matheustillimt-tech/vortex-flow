import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Trava estática da interface de tarefas. O banco (migration 044) é quem impede
 * a gravação; sem estas travas, a tela oferece ações que o banco ignora em
 * silêncio — o card "move" e volta sozinho, o círculo "conclui" e desfaz.
 */

const ler = (caminho: string) =>
  readFileSync(fileURLToPath(new URL(`../${caminho}`, import.meta.url)), "utf8");

describe("interface de tarefas obedece ao perfil", () => {
  it("painel: sem Editar vira leitura, sem Excluir some a lixeira, comentários seguem liberados", () => {
    const codigo = ler("components/side-panel/task-panel.tsx");
    expect(codigo).toContain('useCan("tarefas", "edit")');
    expect(codigo).toContain('useCan("tarefas", "delete")');
    expect(codigo).toContain("<fieldset disabled={!canEdit}");
    expect(codigo).toContain("{canDelete && (");

    // Comentários ficam FORA do bloco desabilitado.
    const fimDoBloco = codigo.indexOf("</fieldset>");
    const comentarios = codigo.indexOf('title="Comentários"');
    expect(fimDoBloco).toBeGreaterThan(-1);
    expect(comentarios).toBeGreaterThan(fimDoBloco);
  });

  it.each([
    "components/projects/kanban-board.tsx",
    "components/tasks/all-tasks-kanban.tsx"
  ])("%s só deixa arrastar quem pode editar", (arquivo) => {
    const codigo = ler(arquivo);
    expect(codigo).toContain('useCan("tarefas", "edit")');
    expect(codigo).toContain("draggable={canEdit}");
    // Nenhum card arrastável incondicional.
    expect(codigo).not.toMatch(/^\s*draggable\s*$/m);
  });

  it.each([
    "components/projects/kanban-board.tsx",
    "components/tasks/all-tasks-kanban.tsx"
  ])("%s tem lixeira no card, que tira o card do quadro", (arquivo) => {
    const codigo = ler(arquivo);
    expect(codigo).toMatch(/<TaskDeleteButton[^>]*onDeleted=/);
  });

  it("a lixeira do card obedece a Excluir e usa a mesma exclusão do painel", () => {
    expect(ler("components/tasks/task-delete-button.tsx")).toContain('useCan("tarefas", "delete")');
    expect(ler("components/tasks/task-delete-button.tsx")).toContain("deleteTaskById(");
    expect(ler("components/side-panel/task-panel.tsx")).toContain("deleteTaskById(");
  });

  it.each([
    "components/my-area/my-area-view.tsx",
    "components/projects/task-list-view.tsx"
  ])("%s trava o botão de concluir sem Editar", (arquivo) => {
    const codigo = ler(arquivo);
    expect(codigo).toContain('useCan("tarefas", "edit")');
    expect(codigo).toContain("disabled={!canEdit}");
  });

  it("criar tarefa só aparece para quem pode criar", () => {
    const tela = ler("components/projects/project-view.tsx");
    expect(tela).toContain('useCan("tarefas", "create")');
    expect(tela).toContain("{canCreate && (");
    expect(tela).toMatch(/onRequestCreate=\{\s*canCreate/);

    const kanban = ler("components/projects/kanban-board.tsx");
    expect(kanban).toContain("{onRequestCreate && (");
  });

  it("a tela de projeto declara o hook antes dos retornos antecipados", () => {
    const tela = ler("components/projects/project-view.tsx");
    const hook = tela.indexOf('useCan("tarefas", "create")');
    const primeiroRetorno = tela.indexOf("return null;");
    expect(hook).toBeGreaterThan(-1);
    expect(hook).toBeLessThan(primeiroRetorno);
  });
});
