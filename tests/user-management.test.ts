import { describe, expect, it } from "vitest";
import { canManageTarget, sanitizeUserPatch } from "@/lib/user-management";

describe("canManageTarget — delegar a equipe sem abrir escalada", () => {
  it.each([
    [true, true, true],
    [true, false, true],
    [false, false, true],
    [false, true, false]
  ])("quem tem acesso total=%s mexe em alvo com acesso total=%s → %s", (ator, alvo, esperado) => {
    expect(canManageTarget(ator, alvo)).toBe(esperado);
  });
});

describe("sanitizeUserPatch — o que a edição de equipe aceita gravar", () => {
  const setor = "123e4567-e89b-12d3-a456-426614174000";

  it("aceita os quatro campos editáveis", () => {
    expect(
      sanitizeUserPatch({ nome: "Ana", cargo: "Suporte", setor_principal_id: setor, ativo: false })
    ).toEqual({ patch: { nome: "Ana", cargo: "Suporte", setor_principal_id: setor, ativo: false } });
  });

  it("apara o nome e recusa nome vazio", () => {
    expect(sanitizeUserPatch({ nome: "  Ana  " })).toEqual({ patch: { nome: "Ana" } });
    expect(sanitizeUserPatch({ nome: "   " })).toEqual({ error: "O nome não pode ficar vazio" });
  });

  it("cargo vazio vira null", () => {
    expect(sanitizeUserPatch({ cargo: "  " })).toEqual({ patch: { cargo: null } });
    expect(sanitizeUserPatch({ cargo: null })).toEqual({ patch: { cargo: null } });
  });

  it("setor precisa ser uuid ou null", () => {
    expect(sanitizeUserPatch({ setor_principal_id: null })).toEqual({
      patch: { setor_principal_id: null }
    });
    expect(sanitizeUserPatch({ setor_principal_id: "nao-e-uuid" })).toEqual({
      error: "Setor inválido"
    });
  });

  it("status precisa ser booleano", () => {
    expect(sanitizeUserPatch({ ativo: "false" })).toEqual({ error: "Status inválido" });
  });

  it("ignora perfil, role e e-mail — eles têm rotas e guardas próprias", () => {
    expect(
      sanitizeUserPatch({
        nome: "Ana",
        role: "admin",
        permission_profile_id: setor,
        email: "outra@empresa.com"
      })
    ).toEqual({ patch: { nome: "Ana" } });
  });

  it("recusa quando só vieram campos de privilégio", () => {
    expect(sanitizeUserPatch({ role: "admin" })).toEqual({ error: "Nada para alterar" });
  });

  it("recusa corpo malformado sem derrubar a rota", () => {
    expect(sanitizeUserPatch(null)).toEqual({ error: "Corpo inválido" });
    expect(sanitizeUserPatch([])).toEqual({ error: "Corpo inválido" });
    expect(sanitizeUserPatch("nome=Ana")).toEqual({ error: "Corpo inválido" });
  });
});
