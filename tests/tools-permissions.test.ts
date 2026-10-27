import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolvePasswordChange } from "@/lib/tool-password";

const ler = (caminho: string) =>
  readFileSync(fileURLToPath(new URL(`../${caminho}`, import.meta.url)), "utf8");

describe("resolvePasswordChange — editar ferramenta sem apagar a senha por acidente", () => {
  it("campo ausente mantém a senha", () => {
    expect(resolvePasswordChange(undefined, false)).toEqual({ kind: "keep" });
  });

  it("campo em branco mantém a senha — quem não a vê não pode apagá-la sem querer", () => {
    expect(resolvePasswordChange("", false)).toEqual({ kind: "keep" });
    expect(resolvePasswordChange("", true)).toEqual({ kind: "keep" });
  });

  it("texto grava a nova senha, preservando espaços", () => {
    expect(resolvePasswordChange("nova", false)).toEqual({ kind: "set", value: "nova" });
    expect(resolvePasswordChange(" com espaço ", false)).toEqual({
      kind: "set",
      value: " com espaço "
    });
  });

  it("remover exige pedido explícito e acesso total", () => {
    expect(resolvePasswordChange(null, true)).toEqual({ kind: "clear" });
    expect(resolvePasswordChange(null, false)).toMatchObject({ status: 403 });
  });

  it("tipo inválido é recusado", () => {
    expect(resolvePasswordChange(123, true)).toMatchObject({ status: 400 });
  });
});

describe("rotas de Ferramentas passam pelo perfil", () => {
  it("lista e criação", () => {
    const codigo = ler("app/api/admin/tools/route.ts");
    expect(codigo).toContain('requirePermission("ferramentas", "view")');
    expect(codigo).toContain('requirePermission("ferramentas", "create")');
    // Senha decriptada só para acesso total.
    expect(codigo).toContain("const veSenha = auth.perms.fullAccess");
    expect(codigo).not.toMatch(/role\s*!==?\s*["']admin["']/);
  });

  it("edição e exclusão", () => {
    const codigo = ler("app/api/admin/tools/[id]/route.ts");
    expect(codigo).toContain('requirePermission("ferramentas", "edit")');
    expect(codigo).toContain('requirePermission("ferramentas", "delete")');
    expect(codigo).toContain("resolvePasswordChange(");
    // O bug que apagava a senha: gravar sempre que o campo viesse no corpo.
    expect(codigo).not.toContain("body.senha ?? null");
    expect(codigo).not.toMatch(/role\s*!==?\s*["']admin["']/);
  });

  it("revelar credenciais exige Ferramentas e decide acesso total pelo perfil", () => {
    const codigo = ler("app/api/tools/access/route.ts");
    expect(codigo).toContain('requirePermission("ferramentas", "view")');
    expect(codigo).toContain("acesso.perms.fullAccess");
    expect(codigo).not.toContain('role === "admin"');
  });
});
