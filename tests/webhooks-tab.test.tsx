// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WebhooksTab } from "@/components/settings/webhooks-tab";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const config = { url: "https://x/hook", token_final: "1a2b", ativo: true,
  atualizado_em: null, atualizado_por_nome: null };
const entregas = [
  { id: "e1", status: "erro", tentativas: 3, http_status: 500, erro: "Falhou", criado_em: "2026-09-18T12:00:00Z",
    enviado_em: null, task_id: "t1", tarefa_titulo: "Criativos", responsavel_nome: "Ana" }
];

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url === "/api/admin/webhook" && !init?.method) return Response.json(config);
  if (url === "/api/admin/webhook/entregas") return Response.json({ entregas });
  if (url === "/api/admin/webhook/teste")
    return Response.json({ ok: true, http_status: 200, resposta: "ok", erro: null });
  return Response.json({ ok: true });
});

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("mostra a configuração com o token mascarado e o histórico", async () => {
  render(<WebhooksTab />);
  expect(await screen.findByDisplayValue("https://x/hook")).toBeTruthy();
  expect(screen.getByText("••••1a2b")).toBeTruthy();
  expect(screen.getByText("Criativos")).toBeTruthy();
  expect(screen.getByText("Falhou")).toBeTruthy();
});

it("Enviar teste mostra o código HTTP da ferramenta", async () => {
  render(<WebhooksTab />);
  await screen.findByDisplayValue("https://x/hook");
  fireEvent.click(screen.getByRole("button", { name: "Enviar teste" }));
  expect(await screen.findByText(/HTTP 200/)).toBeTruthy();
});

it("Reenviar chama a rota da entrega", async () => {
  render(<WebhooksTab />);
  fireEvent.click(await screen.findByRole("button", { name: "Reenviar" }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/webhook/entregas/e1/reenviar", { method: "POST" })
  );
});

it("Salvar sem trocar o token não manda o campo token", async () => {
  render(<WebhooksTab />);
  await screen.findByDisplayValue("https://x/hook");
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() => {
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(put).toBeTruthy();
    expect(JSON.parse(put![1]!.body as string)).toEqual({ url: "https://x/hook", ativo: true });
  });
});

it("sem permissão para carregar, mostra a mensagem e permite tentar de novo, sem Salvar", async () => {
  fetchMock.mockImplementationOnce(async () =>
    Response.json({ error: "Você não tem permissão para esta ação" }, { status: 403 })
  );
  render(<WebhooksTab />);
  expect(await screen.findByText("Você não tem permissão para esta ação")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Salvar" })).toBeNull();
});

it("falha de rede ao carregar mostra o estado de erro", async () => {
  fetchMock.mockImplementationOnce(async () => {
    throw new Error("network fail");
  });
  render(<WebhooksTab />);
  expect(await screen.findByText("Não foi possível carregar o webhook.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
});
