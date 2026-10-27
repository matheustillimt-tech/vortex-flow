// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserProfile } from "@/lib/types";

const mocks = vi.hoisted(() => ({ order: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  from: () => ({ select: () => ({ order: mocks.order }) })
}) }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
import { ProjectAccessModal } from "@/components/settings/project-access-modal";

const a = { id: "user-a", nome: "Pessoa A", role: "colaborador" } as UserProfile;
const b = { id: "user-b", nome: "Pessoa B", role: "colaborador" } as UserProfile;
const projects = [
  { id: "p1", nome: "Projeto A", status: "ativo" },
  { id: "p2", nome: "Projeto B", status: "arquivado" }
];
const fetchMock = vi.fn();
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const saveButton = () => screen.getByRole("button", { name: "Salvar permissões" }) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  mocks.order.mockResolvedValue({ data: projects, error: null });
  fetchMock.mockResolvedValue(response({ project_ids: ["p1"] }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("bloqueia salvar após erro ao carregar permissões", async () => {
  fetchMock.mockResolvedValue(response({ error: "Falha ao carregar" }, 500));
  render(<ProjectAccessModal open user={a} onClose={vi.fn()} />);
  await screen.findByRole("alert");
  expect(saveButton().disabled).toBe(true);
  fireEvent.click(saveButton());
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("bloqueia salvar após erro da consulta de projetos", async () => {
  mocks.order.mockResolvedValue({ data: null, error: { message: "read failed" } });
  render(<ProjectAccessModal open user={a} onClose={vi.fn()} />);
  await screen.findByRole("alert");
  expect(saveButton().disabled).toBe(true);
});

it("não usa resposta atrasada do membro anterior", async () => {
  let resolveA!: (value: Response) => void;
  fetchMock.mockImplementation((url: string) => url.includes(a.id)
    ? new Promise<Response>((resolve) => { resolveA = resolve; })
    : Promise.resolve(response({ project_ids: ["p2"] })));
  const view = render(<ProjectAccessModal open user={a} onClose={vi.fn()} />);
  view.rerender(<ProjectAccessModal open user={b} onClose={vi.fn()} />);
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  resolveA(response({ project_ids: ["p1"] }));
  await waitFor(() => expect(screen.getByRole("button", { name: /Projeto B/ }).getAttribute("aria-pressed")).toBe("true"));
  expect(screen.getByRole("button", { name: /Projeto A/ }).getAttribute("aria-pressed")).toBe("false");
});

it("preserva seleção e modal abertos quando a API rejeita o salvamento", async () => {
  const onClose = vi.fn();
  fetchMock.mockResolvedValueOnce(response({ project_ids: ["p2"] }))
    .mockResolvedValueOnce(response({ error: "Atualização do banco pendente" }, 503));
  render(<ProjectAccessModal open user={a} onClose={onClose} />);
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  expect(screen.getByRole("button", { name: /Projeto B \(arquivado\)/ }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(saveButton());
  await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Atualização do banco pendente"));
  expect(onClose).not.toHaveBeenCalled();
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ project_ids: ["p2"] });
  expect(screen.getByRole("button", { name: /Projeto B/ }).getAttribute("aria-pressed")).toBe("true");
});

it("salva a seleção e fecha somente depois de sucesso confirmado", async () => {
  const onClose = vi.fn();
  fetchMock.mockResolvedValueOnce(response({ project_ids: ["p1"] }))
    .mockResolvedValueOnce(response({ ok: true, restricted: true, count: 2 }));
  render(<ProjectAccessModal open user={a} onClose={onClose} />);
  await waitFor(() => expect(saveButton().disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: /Projeto B/ }));
  fireEvent.click(saveButton());
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ project_ids: ["p1", "p2"] });
});
