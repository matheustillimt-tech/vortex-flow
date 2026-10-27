import { describe, expect, it } from "vitest";
import {
  allResourceKeys,
  buildPermissionSet,
  can,
  findResource,
  flattenCatalog,
  parentKey,
  PERMISSION_CATALOG,
  sanitizeGrants
} from "@/lib/permissions";

const set = (fullAccess: boolean, ...grants: string[]) =>
  buildPermissionSet(
    fullAccess,
    grants.map((g) => {
      const i = g.lastIndexOf(":");
      return { resource: g.slice(0, i), action: g.slice(i + 1) };
    })
  );

describe("catálogo", () => {
  it("não tem chaves duplicadas", () => {
    const keys = flattenCatalog().map((r) => r.key);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it("toda ação começa por 'view' — não faz sentido editar o que não se vê", () => {
    for (const r of flattenCatalog()) {
      expect(r.actions[0], `recurso ${r.key}`).toBe("view");
    }
  });

  it("toda chave filha é prefixada pela chave do pai", () => {
    for (const pai of PERMISSION_CATALOG) {
      for (const filho of pai.children ?? []) {
        expect(parentKey(filho.key)).toBe(pai.key);
      }
    }
  });

  it("localiza recursos aninhados", () => {
    expect(findResource("configuracoes.setores")?.label).toBe("Setores");
    expect(findResource("nao-existe")).toBeUndefined();
  });
});

describe("can()", () => {
  it("full_access responde por tudo, inclusive recurso desconhecido", () => {
    const p = set(true);
    expect(can(p, "configuracoes.time", "delete")).toBe(true);
    expect(can(p, "qualquer-coisa", "edit")).toBe(true);
  });

  it("sem permissões, nada passa", () => {
    expect(can(set(false), "dashboard", "view")).toBe(false);
  });

  it("null e undefined não passam", () => {
    expect(can(null, "dashboard")).toBe(false);
    expect(can(undefined, "dashboard")).toBe(false);
  });

  it("concede apenas o recurso e a ação exatos", () => {
    const p = set(false, "chat:view");
    expect(can(p, "chat", "view")).toBe(true);
    expect(can(p, "chat", "edit")).toBe(false);
    expect(can(p, "tarefas", "view")).toBe(false);
  });

  it("ver um filho implica alcançar o pai", () => {
    // Quem só pode ver Setores precisa conseguir abrir Configurações.
    const p = set(false, "configuracoes.setores:view");
    expect(can(p, "configuracoes", "view")).toBe(true);
  });

  it("mas essa implicação não vaza para outras ações do pai", () => {
    const p = set(false, "configuracoes.setores:view");
    expect(can(p, "configuracoes", "edit")).toBe(false);
  });

  it("e não vaza para outros filhos do mesmo pai", () => {
    const p = set(false, "configuracoes.setores:view");
    expect(can(p, "configuracoes.time", "view")).toBe(false);
  });

  it("editar um filho não basta para alcançar o pai", () => {
    // Sem "view" no filho, não há caminho até ele.
    const p = set(false, "configuracoes.setores:edit");
    expect(can(p, "configuracoes", "view")).toBe(false);
  });
});

describe("buildPermissionSet", () => {
  it("descarta concessões a recursos fora do catálogo", () => {
    const p = buildPermissionSet(false, [
      { resource: "chat", action: "view" },
      { resource: "recurso-que-saiu-do-sistema", action: "view" }
    ]);
    expect(p.grants.has("chat:view")).toBe(true);
    expect(p.grants.size).toBe(1);
  });
});

describe("sanitizeGrants — o que a API aceita gravar", () => {
  it("aceita pares válidos", () => {
    expect(sanitizeGrants(["chat:view", "tarefas:delete"])).toEqual([
      { resource: "chat", action: "view" },
      { resource: "tarefas", action: "delete" }
    ]);
  });

  it("recusa recurso fora do catálogo", () => {
    expect(sanitizeGrants(["banco-de-dados:delete"])).toEqual([]);
  });

  it("recusa ação inventada", () => {
    expect(sanitizeGrants(["chat:apagar-tudo"])).toEqual([]);
  });

  it("recusa entrada malformada sem derrubar a rota", () => {
    expect(sanitizeGrants(["semdoispontos", 42, null, {}, "chat:"])).toEqual([]);
    expect(sanitizeGrants("não é lista")).toEqual([]);
    expect(sanitizeGrants(undefined)).toEqual([]);
  });

  it("remove duplicatas", () => {
    expect(sanitizeGrants(["chat:view", "chat:view"])).toEqual([
      { resource: "chat", action: "view" }
    ]);
  });

  it("preserva a chave com ponto do recurso aninhado", () => {
    expect(sanitizeGrants(["configuracoes.setores:edit"])).toEqual([
      { resource: "configuracoes.setores", action: "edit" }
    ]);
  });

  it("aceita todo par que o catálogo declara", () => {
    const todos = flattenCatalog().flatMap((r) =>
      r.actions.map((a) => `${r.key}:${a}`)
    );
    expect(sanitizeGrants(todos)).toHaveLength(todos.length);
    expect(allResourceKeys().size).toBe(flattenCatalog().length);
  });
});
