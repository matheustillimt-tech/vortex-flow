import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Qualquer perfil de permissão pode ser excluído, menos o de acesso total.
 * Rota, tela e banco (migration 049) aplicam a mesma regra.
 */

const ler = (caminho: string) =>
  readFileSync(fileURLToPath(new URL(`../${caminho}`, import.meta.url)), "utf8");

describe("exclusão de perfis de permissão", () => {
  it("a rota barra só o perfil de acesso total, não mais os de sistema", () => {
    const codigo = ler("app/api/admin/permission-profiles/[id]/route.ts");
    const excluir = codigo.slice(codigo.indexOf("export async function DELETE"));
    expect(excluir).toContain("if (perfil.full_access)");
    expect(excluir).not.toContain("is_system");
    // Perfil em uso continua bloqueado, com mensagem clara.
    expect(excluir).toContain("Mova-as para outro perfil antes de excluir");
  });

  it("a tela oferece Excluir para todo perfil sem acesso total, travado quando em uso", () => {
    const codigo = ler("components/settings/permission-profiles-tab.tsx");
    expect(codigo).toContain("{!selected.full_access && (");
    expect(codigo).toContain("disabled={selected.user_count > 0}");
    expect(codigo).not.toContain("{!selected.is_system && (");
  });

  it("o convite tem opção explícita de 'sem perfil'", () => {
    const codigo = ler("components/settings/invite-member-modal.tsx");
    expect(codigo).toContain('<option value="">Sem perfil (sem acesso até atribuir)</option>');
  });
});
