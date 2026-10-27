// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  tabelas: {} as Record<string, unknown[]>
}));

// Cliente Supabase falso: cada consulta encadeável resolve com a tabela do teste.
vi.mock("@/lib/supabase/client", () => {
  const consulta = (tabela: string) => {
    const resultado = { data: db.tabelas[tabela] ?? [], error: null };
    const q: Record<string, unknown> = {};
    for (const metodo of ["select", "eq", "order"]) q[metodo] = () => q;
    q.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
      Promise.resolve(resultado).then(ok, falha);
    return q;
  };
  return {
    createClient: () => ({
      from: consulta,
      auth: { getUser: async () => ({ data: { user: { id: "u-eu" } } }) }
    })
  };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock("@/components/settings/invite-member-modal", () => ({ InviteMemberModal: () => null }));
vi.mock("@/components/settings/project-access-modal", () => ({ ProjectAccessModal: () => null }));

import { PermissionsProvider } from "@/components/permissions/permissions-provider";
import { TeamTab } from "@/components/settings/team-tab";

const SUPER = "p-super";
const SEM = "p-sem";
const pessoa = (id: string, nome: string, perfil: string) => ({
  id,
  nome,
  email: `${id}@empresa.com`,
  cargo: null,
  setor_principal_id: null,
  ativo: true,
  role: perfil === SUPER ? "admin" : "colaborador",
  permission_profile_id: perfil,
  password_changed: true
});

beforeEach(() => {
  db.tabelas = {
    users: [pessoa("u-eu", "Eu", SEM), pessoa("u-chefe", "Chefe", SUPER), pessoa("u-colab", "Colab", SEM)],
    sectors: [],
    permission_profiles: [
      { id: SUPER, nome: "Super Admin", full_access: true, can_manage: true, is_system: true },
      { id: SEM, nome: "Sem permissões", full_access: false, can_manage: false, is_system: true }
    ]
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ projects: [], project_ids_by_user: {} })))
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function abrir(grants: string[], fullAccess = false) {
  render(
    <PermissionsProvider value={{ fullAccess, grants }}>
      <TeamTab />
    </PermissionsProvider>
  );
  await screen.findByDisplayValue("Colab");
}

const linha = (nome: string) => screen.getByDisplayValue(nome).closest("tr") as HTMLElement;

function abrirMenu(nome: string) {
  fireEvent.click(within(linha(nome)).getByTitle("Ações"));
}

it("só ver: nada de convidar, editar, excluir ou menu de ações", async () => {
  await abrir(["configuracoes.time:view"]);
  expect(screen.queryByRole("button", { name: "Adicionar membro" })).toBeNull();
  expect(screen.queryAllByTitle("Ações")).toHaveLength(0);
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  expect((screen.getByDisplayValue("Colab") as HTMLInputElement).disabled).toBe(true);
});

it("criar mostra o botão de convite", async () => {
  await abrir(["configuracoes.time:view", "configuracoes.time:create"]);
  expect(screen.getByRole("button", { name: "Adicionar membro" })).toBeTruthy();
});

it("editar sem acesso total: gere colaboradores, mas não toca no Super Admin", async () => {
  await abrir(["configuracoes.time:view", "configuracoes.time:edit"]);

  expect((screen.getByDisplayValue("Colab") as HTMLInputElement).disabled).toBe(false);
  expect((screen.getByDisplayValue("Chefe") as HTMLInputElement).disabled).toBe(true);
  expect(within(linha("Chefe")).queryByTitle("Ações")).toBeNull();

  abrirMenu("Colab");
  expect(screen.getByText("Resetar senha")).toBeTruthy();
  expect(screen.getByText("Desativar usuário")).toBeTruthy();
  // Restrição de projetos ainda exige acesso total no banco; excluir exige a ação.
  expect(screen.queryByText("Acesso a projetos")).toBeNull();
  expect(screen.queryByText("Excluir usuário")).toBeNull();
});

it("quem não tem acesso total não oferece Super Admin como perfil", async () => {
  await abrir(["configuracoes.time:view", "configuracoes.time:edit"]);
  const seletorColab = within(linha("Colab")).getByDisplayValue("Sem permissões") as HTMLSelectElement;
  const opcoes = Array.from(seletorColab.options).map((o) => o.textContent);
  expect(opcoes).not.toContain("Super Admin");
  // No Super Admin o seletor fica travado.
  const seletorChefe = within(linha("Chefe")).getByDisplayValue("Super Admin") as HTMLSelectElement;
  expect(seletorChefe.disabled).toBe(true);
});

it("excluir sem editar: menu só com excluir, e Super Admin fora da seleção", async () => {
  await abrir(["configuracoes.time:view", "configuracoes.time:delete"]);
  abrirMenu("Colab");
  expect(screen.getByText("Excluir usuário")).toBeTruthy();
  expect(screen.queryByText("Resetar senha")).toBeNull();

  const caixaChefe = within(linha("Chefe")).getByRole("checkbox") as HTMLInputElement;
  const caixaColab = within(linha("Colab")).getByRole("checkbox") as HTMLInputElement;
  expect(caixaChefe.disabled).toBe(true);
  expect(caixaColab.disabled).toBe(false);
});

it("acesso total: tudo liberado, inclusive sobre o Super Admin", async () => {
  await abrir([], true);
  expect(screen.getByRole("button", { name: "Adicionar membro" })).toBeTruthy();
  expect((screen.getByDisplayValue("Chefe") as HTMLInputElement).disabled).toBe(false);

  abrirMenu("Chefe");
  for (const item of [
    "Reenviar e-mail de acesso",
    "Resetar senha",
    "Acesso a projetos",
    "Desativar usuário",
    "Excluir usuário"
  ]) {
    expect(screen.getByText(item), item).toBeTruthy();
  }
});
