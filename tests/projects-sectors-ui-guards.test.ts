import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Trava estática das telas de Projetos e Setores. O banco (migration 045) é
 * quem impede a gravação; estas travas evitam oferecer o que ele recusaria.
 */

const ler = (caminho: string) =>
  readFileSync(fileURLToPath(new URL(`../${caminho}`, import.meta.url)), "utf8");

describe("Projetos", () => {
  const codigo = ler("components/projects/projects-view.tsx");

  it("usa as três ações do perfil", () => {
    for (const acao of ["create", "edit", "delete"]) {
      expect(codigo).toContain(`useCan("projetos", "${acao}")`);
    }
  });

  it("cada botão depende da sua ação", () => {
    expect(codigo).toMatch(/canCreate && \(\s*<Button[\s\S]*?Novo projeto/);
    expect(codigo).toMatch(/canEdit && \(\s*<button[\s\S]*?title="Editar"/);
    expect(codigo).toMatch(/canCreate && \(\s*<button[\s\S]*?title="Duplicar"/);
    expect(codigo).toMatch(/!canEdit \? null : p\.status === "arquivado"/);
    expect(codigo).toMatch(/canDelete && \(\s*<button[\s\S]*?title="Excluir"/);
  });
});

describe("estrutura do kanban", () => {
  const codigo = ler("components/projects/kanban-board.tsx");

  it("deixa de decidir pelo role legado", () => {
    expect(codigo).not.toContain("isAdmin");
    expect(codigo).not.toMatch(/role\s*===?\s*["']admin["']/);
  });

  it("criar, excluir, renomear, cor e ordenar seguem projetos:edit", () => {
    expect(codigo).toContain('useCan("projetos", "edit")');
    expect(codigo.match(/\{canEditStructure && \(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(codigo).toContain("useSortable({ id: columnId, disabled: !canEditStructure })");
    expect(codigo.match(/disabled=\{!canEditStructure\}/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

describe("Setores", () => {
  const codigo = ler("components/sectors/sectors-view.tsx");

  it("usa as ações da aba Setores", () => {
    for (const acao of ["create", "edit", "delete"]) {
      expect(codigo).toContain(`useCan("configuracoes.setores", "${acao}")`);
    }
  });

  it("nenhum 'Novo setor' aparece sem Criar", () => {
    // Conta só o conteúdo de botão (ícone + texto): o título do modal também diz
    // "Novo setor" e não é um ponto de entrada.
    const botoes =
      codigo.match(/<Plus className="w-4 h-4" \/> (?:Novo setor|Criar primeiro setor)/g) ?? [];
    const protegidos = codigo.match(/canCreate && \(\s*(?:<div[^>]*>\s*)?<Button onClick=\{openCreate\}>/g) ?? [];
    expect(botoes.length).toBe(3);
    expect(protegidos.length).toBe(3);
  });
});
