// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const upsert = vi.fn(async () => ({ error: null }));
  return { upsert, client: { from: vi.fn(() => ({ upsert })) } };
});
vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { WhatsappBanner } from "@/components/colaboradores/whatsapp-banner";
import { CELULAR, CELULAR_E164 } from "./fixtures/telefones";

beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); });
afterEach(cleanup);

it("não aparece quando show é false", () => {
  render(<WhatsappBanner userId="u1" show={false} />);
  expect(screen.queryByText(/Cadastre seu WhatsApp/)).toBeNull();
});

it("salva o número com 55 e some", async () => {
  render(<WhatsappBanner userId="u1" show />);
  fireEvent.change(screen.getByPlaceholderText("(00) 00000-0000"), { target: { value: CELULAR } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() =>
    expect(mocks.upsert).toHaveBeenCalledWith(
      { user_id: "u1", whatsapp: CELULAR_E164 },
      { onConflict: "user_id" }
    )
  );
  await waitFor(() => expect(screen.queryByText(/Cadastre seu WhatsApp/)).toBeNull());
});

it("número inválido mostra o erro e não salva", async () => {
  render(<WhatsappBanner userId="u1" show />);
  fireEvent.change(screen.getByPlaceholderText("(00) 00000-0000"), { target: { value: "1199" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  expect(await screen.findByText("WhatsApp inválido: use DDD + número.")).toBeTruthy();
  expect(mocks.upsert).not.toHaveBeenCalled();
});

it("fechar esconde até a próxima sessão", () => {
  const { unmount } = render(<WhatsappBanner userId="u1" show />);
  fireEvent.click(screen.getByRole("button", { name: "Fechar aviso" }));
  expect(screen.queryByText(/Cadastre seu WhatsApp/)).toBeNull();
  unmount();
  render(<WhatsappBanner userId="u1" show />);
  expect(screen.queryByText(/Cadastre seu WhatsApp/)).toBeNull();
});
