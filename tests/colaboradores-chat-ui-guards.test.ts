import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Trava estática de Colaboradores e Chat. O banco (migration 046) é quem impede;
 * estas travas mantêm a tela coerente com ele.
 */

const ler = (caminho: string) =>
  readFileSync(fileURLToPath(new URL(`../${caminho}`, import.meta.url)), "utf8");

describe("Colaboradores", () => {
  const codigo = ler("components/colaboradores/colaboradores-view.tsx");

  it("editar cadastro exige a ação e respeita a regra de acesso total", () => {
    expect(codigo).toContain('useCan("colaboradores", "edit")');
    expect(codigo).toMatch(
      /\{canEdit && \(actorFull \|\| u\.role !== "admin"\) && \(\s*<button\s+onClick=\{\(\) => setEditing\(u\)\}/
    );
  });

  it("não afirma mais que só administradores veem a tela", () => {
    expect(codigo).not.toContain("Visível apenas para administradores");
  });
});

describe("Chat", () => {
  const codigo = ler("components/chat/chat-view.tsx");

  it("canais de todos os setores seguem o acesso total do perfil, não o role legado", () => {
    expect(codigo).toContain("usePermissions()?.fullAccess");
    expect(codigo).not.toContain("isAdmin");
    expect(codigo).not.toMatch(/role\s*===?\s*["']admin["']/);
  });
});
