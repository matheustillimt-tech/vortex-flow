// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { ToolModal } from "@/components/tools/tool-modal";
import type { Tool } from "@/lib/types";

const ferramenta: Tool = {
  id: "t1",
  nome: "Banco",
  url: "https://banco.example",
  descricao: null,
  icon: null,
  cor: "#3b82f6",
  login: "financeiro",
  senha: null,
  tem_senha: true,
  created_by: null,
  created_at: "",
  updated_at: ""
};

const fetchMock = vi.fn(
  async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }))
);

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function abrir(props: { tool?: Tool; hidePassword?: boolean }) {
  render(
    <ToolModal
      open
      onClose={vi.fn()}
      tool={props.tool ?? ferramenta}
      users={[]}
      initialUserIds={[]}
      onSaved={vi.fn()}
      hidePassword={props.hidePassword}
    />
  );
}

async function salvarECapturarCorpo() {
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

it("sem ver a senha, salvar sem digitar não envia o campo — a senha salva fica intacta", async () => {
  abrir({ hidePassword: true });
  const corpo = await salvarECapturarCorpo();
  expect(corpo).not.toHaveProperty("senha");
  expect(corpo.nome).toBe("Banco");
});

it("sem ver a senha, avisa que existe uma salva sem revelá-la", () => {
  abrir({ hidePassword: true });
  const campo = screen.getByPlaceholderText("Senha salva — digite para substituir") as HTMLInputElement;
  expect(campo.value).toBe("");
  expect(screen.getByText("Por segurança, a senha salva não é exibida para o seu perfil.")).toBeTruthy();
});

it("sem ver a senha, digitar uma nova envia a nova", async () => {
  abrir({ hidePassword: true });
  fireEvent.change(screen.getByPlaceholderText("Senha salva — digite para substituir"), {
    target: { value: "nova-senha-123" }
  });
  const corpo = await salvarECapturarCorpo();
  expect(corpo.senha).toBe("nova-senha-123");
});

it("com acesso total, a senha atual aparece e esvaziar o campo pede a remoção", async () => {
  abrir({ tool: { ...ferramenta, senha: "segredo" } });
  const campo = screen.getByDisplayValue("segredo");
  fireEvent.change(campo, { target: { value: "" } });
  const corpo = await salvarECapturarCorpo();
  expect(corpo.senha).toBeNull();
});
