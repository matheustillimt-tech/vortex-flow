// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// Cada aba vira um marcador: aqui só interessa QUAIS aparecem, não o conteúdo.
vi.mock("@/components/settings/profile-tab", () => ({ ProfileTab: () => "conteudo-perfil" }));
vi.mock("@/components/settings/team-tab", () => ({ TeamTab: () => "conteudo-time" }));
vi.mock("@/components/sectors/sectors-view", () => ({ SectorsView: () => "conteudo-setores" }));
vi.mock("@/components/admin/activity-logs-view", () => ({
  ActivityLogsView: () => "conteudo-atividades"
}));
vi.mock("@/components/settings/permission-profiles-tab", () => ({
  PermissionProfilesTab: () => "conteudo-permissoes"
}));
vi.mock("@/components/settings/webhooks-tab", () => ({ WebhooksTab: () => "conteudo-webhooks" }));

import { PermissionsProvider } from "@/components/permissions/permissions-provider";
import { SettingsView } from "@/components/settings/settings-view";

afterEach(cleanup);

const abrir = (grants: string[], fullAccess = false) =>
  render(
    <PermissionsProvider value={{ fullAccess, grants }}>
      <SettingsView />
    </PermissionsProvider>
  );

const aba = (nome: string) => screen.queryByRole("button", { name: nome });

it("acesso total vê as seis abas e abre em Perfil", () => {
  abrir([], true);
  for (const nome of [
    "Perfil",
    "Setores",
    "Time & Permissões",
    "Perfis de Permissão",
    "Registro de atividades",
    "Avisos no WhatsApp"
  ]) {
    expect(aba(nome), nome).not.toBeNull();
  }
  expect(screen.getByText("conteudo-perfil")).toBeTruthy();
});

it("Webhooks é só do acesso total, mesmo com todas as concessões de Configurações", () => {
  abrir([
    "configuracoes:view",
    "configuracoes.perfil:view",
    "configuracoes.setores:view",
    "configuracoes.time:view",
    "configuracoes.permissoes:view",
    "configuracoes.atividades:view"
  ]);
  expect(aba("Registro de atividades")).not.toBeNull();
  expect(aba("Avisos no WhatsApp")).toBeNull();
});

it("perfil com só Setores vê só Setores, e ela já abre selecionada", () => {
  abrir(["configuracoes.setores:view"]);
  expect(aba("Setores")).not.toBeNull();
  expect(aba("Perfil")).toBeNull();
  expect(aba("Time & Permissões")).toBeNull();
  expect(aba("Perfis de Permissão")).toBeNull();
  expect(aba("Registro de atividades")).toBeNull();
  expect(screen.getByText("conteudo-setores")).toBeTruthy();
  expect(screen.queryByText("conteudo-perfil")).toBeNull();
});

it("um Suporte sem Time & Permissões não enxerga a gestão de equipe", () => {
  abrir(["configuracoes.perfil:view", "configuracoes.perfil:edit"]);
  expect(aba("Perfil")).not.toBeNull();
  expect(aba("Time & Permissões")).toBeNull();
  expect(screen.queryByText("conteudo-time")).toBeNull();
});

it("troca de aba entre as permitidas", () => {
  abrir(["configuracoes.setores:view", "configuracoes.atividades:view"]);
  expect(screen.getByText("conteudo-setores")).toBeTruthy();
  fireEvent.click(aba("Registro de atividades")!);
  expect(screen.getByText("conteudo-atividades")).toBeTruthy();
  expect(screen.queryByText("conteudo-setores")).toBeNull();
});

it("sem nenhuma aba, avisa em vez de mostrar tela vazia", () => {
  abrir(["configuracoes:view"]);
  expect(
    screen.getByText("Seu perfil não tem acesso a nenhuma aba de Configurações.")
  ).toBeTruthy();
});
