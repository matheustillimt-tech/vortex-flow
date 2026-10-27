import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Trava estática das rotas de equipe e atividades: cada operação tem de passar
 * pelo perfil de permissão, e as sensíveis também pela regra de acesso total.
 */

const ler = (caminho: string) =>
  readFileSync(fileURLToPath(new URL(`../${caminho}`, import.meta.url)), "utf8");

const ROTAS: Array<[string, string[]]> = [
  ["app/api/usuarios/invite/route.ts", [
    'requirePermission("configuracoes.time", "create")',
    "auth.perms.fullAccess"
  ]],
  ["app/api/usuarios/[id]/route.ts", [
    'requirePermission("configuracoes.time", "edit")',
    'requirePermission("configuracoes.time", "delete")',
    "guardTargetUser("
  ]],
  ["app/api/usuarios/resend-invite/route.ts", [
    'requirePermission("configuracoes.time", "edit")',
    "guardTargetUser("
  ]],
  ["app/api/usuarios/reset-password/route.ts", [
    'requirePermission("configuracoes.time", "edit")',
    "guardTargetUser("
  ]],
  ["app/api/admin/usuarios/[id]/projects/route.ts", [
    'requirePermission("configuracoes.time", action)',
    'requireTeam("view")',
    'requireTeam("edit")'
  ]],
  ["app/api/admin/project-access/route.ts", [
    'requirePermission("configuracoes.time", "view")'
  ]],
  ["app/api/admin/activity-logs/route.ts", [
    'requirePermission("configuracoes.atividades", "view")'
  ]],
  ["app/api/admin/usuarios/[id]/permission-profile/route.ts", [
    'requirePermission("configuracoes.time", "edit")',
    "auth.perms.fullAccess"
  ]]
];

describe("rotas de equipe e atividades", () => {
  it.each(ROTAS)("%s passa pelo perfil", (arquivo, exigidos) => {
    const codigo = ler(arquivo);
    for (const trecho of exigidos) expect(codigo, trecho).toContain(trecho);
  });

  it.each(ROTAS.map(([arquivo]) => [arquivo]))("%s não decide mais pelo role legado", (arquivo) => {
    const codigo = ler(arquivo);
    expect(codigo).not.toMatch(/role\s*!==?\s*["']admin["']/);
    expect(codigo).not.toContain('.select("role")');
  });

  it("a exclusão confere se a pessoa sumiu, em vez de presumir sucesso", () => {
    const codigo = ler("app/api/usuarios/[id]/route.ts");
    // O bug antigo: `if (pubErr && !authErr)` deixava passar quando as duas falhavam.
    expect(codigo).not.toContain("pubErr && !authErr");
    expect(codigo).toContain("restante");
  });
});
