import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/cache", () => ({ warmCache: () => {} }));

import {
  buildPermissionSet,
  deserializePermissions,
  firstAllowedHref,
  NO_ACCESS_HREF,
  PERMISSION_CATALOG,
  serializePermissions
} from "@/lib/permissions";
import { visibleNav } from "@/components/layout/sidebar";

const set = (fullAccess: boolean, ...grants: string[]) =>
  buildPermissionSet(
    fullAccess,
    grants.map((g) => {
      const i = g.lastIndexOf(":");
      return { resource: g.slice(0, i), action: g.slice(i + 1) };
    })
  );

describe("firstAllowedHref — para onde vai quem é barrado", () => {
  it("acesso total começa pelo Dashboard", () => {
    expect(firstAllowedHref(set(true))).toBe("/dashboard");
  });

  it("sem nenhuma tela, não há destino", () => {
    expect(firstAllowedHref(set(false))).toBeNull();
    expect(firstAllowedHref(null)).toBeNull();
  });

  it("respeita a ordem do menu, não a ordem das concessões", () => {
    expect(firstAllowedHref(set(false, "chat:view", "projetos:view"))).toBe("/projetos");
  });

  it("uma aba de Configurações basta para cair em Configurações", () => {
    expect(firstAllowedHref(set(false, "configuracoes.setores:view"))).toBe("/configuracoes");
  });

  it("editar sem ver não abre caminho", () => {
    expect(firstAllowedHref(set(false, "tarefas:edit"))).toBeNull();
  });

  it("a página de sem-acesso não é uma tela do catálogo (nunca é bloqueada)", () => {
    expect(PERMISSION_CATALOG.map((r) => r.href)).not.toContain(NO_ACCESS_HREF);
  });
});

describe("serialização servidor → cliente", () => {
  it("ida e volta preserva o conjunto", () => {
    const original = set(false, "chat:view", "tarefas:edit", "tarefas:view");
    const volta = deserializePermissions(
      JSON.parse(JSON.stringify(serializePermissions(original)))
    );
    expect(volta.fullAccess).toBe(false);
    expect([...volta.grants].sort()).toEqual([...original.grants].sort());
  });
});

describe("menu lateral", () => {
  const hrefs = (perms: Parameters<typeof visibleNav>[0]) =>
    visibleNav(perms).map((i) => i.href);

  it("sem permissões, menu vazio", () => {
    expect(hrefs(set(false))).toEqual([]);
    expect(hrefs(null)).toEqual([]);
  });

  it("mostra só o que foi liberado", () => {
    expect(hrefs(set(false, "chat:view"))).toEqual(["/chat"]);
  });

  it("Colaboradores só aparece quando concedido", () => {
    expect(hrefs(set(false, "dashboard:view"))).not.toContain("/colaboradores");
    expect(hrefs(set(false, "colaboradores:view"))).toEqual(["/colaboradores"]);
  });

  it("acesso total mostra todo o menu, na ordem", () => {
    expect(hrefs(set(true))).toEqual([
      "/dashboard",
      "/projetos",
      "/minha-area",
      "/tarefas",
      "/ferramentas",
      "/chat",
      "/colaboradores"
    ]);
  });

  it("cada item do menu aponta para o recurso do catálogo com a mesma rota", () => {
    for (const item of visibleNav(set(true))) {
      const recurso = PERMISSION_CATALOG.find((r) => r.key === item.resource);
      expect(recurso, `recurso ${item.resource}`).toBeDefined();
      expect(recurso?.href).toBe(item.href);
    }
  });
});
