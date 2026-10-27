// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const upsert = vi.fn(async (_row: Record<string, unknown>) => ({ error: null }));
  const dados = {
    user_id: "u1", cpf: "12345678909", data_nascimento: "1990-01-01", cep: "01001000",
    logradouro: "Praça da Sé", numero: "1", complemento: null, bairro: "Sé", cidade: "São Paulo",
    estado: "SP", chave_pix: "a@b.com", tipo_chave_pix: "email", whatsapp: null as string | null
  };
  const client = {
    from: vi.fn((tabela: string) =>
      tabela === "colaborador_dados"
        ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: dados }) }) }), upsert }
        : { update: () => ({ eq: async () => ({ error: null }) }) }
    ),
    storage: { from: vi.fn() }
  };
  return { upsert, dados, client, toastError: vi.fn() };
});
vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));
vi.mock("@/lib/cache", () => ({ invalidate: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: vi.fn() } }));

import { CadastroForm } from "@/components/colaboradores/cadastro-form";
import { CELULAR, CELULAR_E164, CELULAR_MASCARA } from "./fixtures/telefones";

const user = {
  id: "u1", nome: "Ana", email: "ana@x.com", cargo: "Designer", setor_principal_id: "s1", avatar_url: null
} as never;
const sectors = [{ id: "s1", nome: "Criação" }] as never;

beforeEach(() => { vi.clearAllMocks(); mocks.dados.whatsapp = null; });
afterEach(cleanup);

it("sem WhatsApp não salva e avisa", async () => {
  render(<CadastroForm user={user} sectors={sectors} onSaved={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Salvar cadastro" }));
  await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Informe seu WhatsApp."));
  expect(mocks.upsert).not.toHaveBeenCalled();
});

it("grava o WhatsApp com 55 e só dígitos", async () => {
  const onSaved = vi.fn();
  render(<CadastroForm user={user} sectors={sectors} onSaved={onSaved} />);
  fireEvent.change(await screen.findByPlaceholderText("(00) 00000-0000"), {
    target: { value: CELULAR }
  });
  fireEvent.click(screen.getByRole("button", { name: "Salvar cadastro" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(mocks.upsert.mock.calls[0][0]).toMatchObject({ whatsapp: CELULAR_E164 });
});

it("número já gravado aparece com máscara", async () => {
  mocks.dados.whatsapp = CELULAR_E164;
  render(<CadastroForm user={user} sectors={sectors} onSaved={vi.fn()} />);
  expect(await screen.findByDisplayValue(CELULAR_MASCARA)).toBeTruthy();
});
