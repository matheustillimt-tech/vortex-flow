// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WebhooksTab } from "@/components/settings/webhooks-tab";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const config = {
  canal: "crm",
  ativo: true,
  url: null,
  token_final: null,
  crm_url: "https://p.supabase.co/functions/v1/mcp",
  crm_chave_final: "9x9x",
  zapi_instancia: null,
  zapi_token_final: null,
  zapi_client_token_final: null,
  zapi_base_url: null,
  templates: { "tarefa.prazo": "Bom dia {nome}, {tarefa} vence hoje" },
  eventos_ativos: {
    "tarefa.atribuida": true,
    "tarefa.prazo": true,
    "tarefa.atrasada": true,
    "tarefa.comentario": true
  },
  atualizado_em: null,
  atualizado_por_nome: null
};
const entregas = [
  { id: "e1", evento: "tarefa.prazo", status: "erro", tentativas: 3, http_status: 500, erro: "Falhou",
    criado_em: "2026-09-18T12:00:00Z", enviado_em: null, task_id: "t1", tarefa_titulo: "Criativos", responsavel_nome: "Ana" }
];

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url === "/api/admin/webhook" && !init?.method) return Response.json(config);
  if (url === "/api/admin/webhook" && init?.method === "PUT") return Response.json(config);
  if (url === "/api/admin/webhook/entregas") return Response.json({ entregas });
  if (url === "/api/admin/webhook/teste")
    return Response.json({ ok: true, http_status: 200, resposta: "ok", erro: null });
  return Response.json({ ok: true });
});

const corpoDoPut = () => {
  const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
  expect(put).toBeTruthy();
  return JSON.parse(put![1]!.body as string) as Record<string, unknown>;
};

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("mostra o canal salvo com a chave mascarada e o histórico com o tipo de aviso", async () => {
  render(<WebhooksTab />);
  expect(await screen.findByDisplayValue("https://p.supabase.co/functions/v1/mcp")).toBeTruthy();
  expect((screen.getByRole("radio", { name: /Vórtex CRM/ }) as HTMLInputElement).checked).toBe(true);
  expect(screen.getByText("••••9x9x")).toBeTruthy();
  const tabela = screen.getByRole("table");
  expect(within(tabela).getByText("Criativos")).toBeTruthy();
  expect(within(tabela).getByText("Prazo chegando")).toBeTruthy();
  expect(within(tabela).getByText("Falhou")).toBeTruthy();
});

it("trocar para Z-API mostra os campos da instância", async () => {
  render(<WebhooksTab />);
  await screen.findByDisplayValue("https://p.supabase.co/functions/v1/mcp");
  fireEvent.click(screen.getByRole("radio", { name: /Z-API/ }));
  expect(screen.getByLabelText("ID da instância")).toBeTruthy();
  expect(screen.getByLabelText("Token da instância")).toBeTruthy();
  expect(screen.getByText("Só preencha se você ligou o token de segurança da conta no Z-API")).toBeTruthy();
});

it("Salvar manda o canal e não manda a chave que não foi trocada", async () => {
  render(<WebhooksTab />);
  await screen.findByDisplayValue("https://p.supabase.co/functions/v1/mcp");
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() => {
    const body = corpoDoPut();
    expect(body).toMatchObject({ canal: "crm", ativo: true, crm_url: "https://p.supabase.co/functions/v1/mcp" });
    expect(body).not.toHaveProperty("crm_chave");
    expect(body).not.toHaveProperty("token");
  });
});

it("trocar a chave do CRM manda a chave nova", async () => {
  render(<WebhooksTab />);
  await screen.findByDisplayValue("https://p.supabase.co/functions/v1/mcp");
  fireEvent.click(screen.getByRole("button", { name: "Trocar chave" }));
  fireEvent.change(screen.getByLabelText("Chave do conector"), { target: { value: "nova-chave-123" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(corpoDoPut()).toMatchObject({ crm_chave: "nova-chave-123" }));
});

it("a prévia troca os campos pelos dados de exemplo", async () => {
  render(<WebhooksTab />);
  await screen.findByDisplayValue("https://p.supabase.co/functions/v1/mcp");
  expect(screen.getByText("Bom dia Ana, Criar os criativos da campanha vence hoje")).toBeTruthy();
});

it("desligar um aviso vai no Salvar", async () => {
  render(<WebhooksTab />);
  await screen.findByDisplayValue("https://p.supabase.co/functions/v1/mcp");
  fireEvent.click(screen.getByRole("checkbox", { name: /Tarefa atrasada/ }));
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() =>
    expect(corpoDoPut().eventos_ativos).toMatchObject({ "tarefa.atrasada": false, "tarefa.prazo": true })
  );
});

it("texto idêntico ao padrão é salvo vazio (segue o padrão)", async () => {
  render(<WebhooksTab />);
  await screen.findByDisplayValue("https://p.supabase.co/functions/v1/mcp");
  fireEvent.click(screen.getAllByRole("button", { name: "Voltar ao texto padrão" })[1]);
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(corpoDoPut().templates).toEqual({}));
});

it("Mandar teste mostra o resultado", async () => {
  render(<WebhooksTab />);
  await screen.findByDisplayValue("https://p.supabase.co/functions/v1/mcp");
  fireEvent.click(screen.getByRole("button", { name: "Mandar teste" }));
  expect(await screen.findByText(/Enviado \(HTTP 200\)/)).toBeTruthy();
});

it("Reenviar chama a rota da entrega", async () => {
  render(<WebhooksTab />);
  fireEvent.click(await screen.findByRole("button", { name: "Reenviar" }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/webhook/entregas/e1/reenviar", { method: "POST" })
  );
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
  expect(await screen.findByText("Não foi possível carregar os avisos.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
});

it("nenhum texto da tela usa travessão", async () => {
  const { container } = render(<WebhooksTab />);
  await screen.findByDisplayValue("https://p.supabase.co/functions/v1/mcp");
  expect(container.textContent).not.toMatch(/[—–]/);
});
