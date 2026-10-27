import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A caixa "Pode gerir conteúdo de todos os projetos" (can_manage) foi removida:
 * depois da 045, projetos e setores seguem as ações do perfil, e a caixa não
 * fazia mais quase nada. Nem a tela nem a API voltam a aceitá-la.
 */

const ler = (caminho: string) =>
  readFileSync(fileURLToPath(new URL(`../${caminho}`, import.meta.url)), "utf8");

describe("can_manage fora do editor de perfis", () => {
  it("a tela não mostra nem envia a caixa", () => {
    const codigo = ler("components/settings/permission-profiles-tab.tsx");
    expect(codigo).not.toContain("Pode gerir conteúdo");
    expect(codigo).not.toContain("can_manage");
  });

  it.each([
    "app/api/admin/permission-profiles/route.ts",
    "app/api/admin/permission-profiles/[id]/route.ts"
  ])("%s não grava can_manage a partir do corpo", (arquivo) => {
    expect(ler(arquivo)).not.toContain("can_manage");
  });
});
