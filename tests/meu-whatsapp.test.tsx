// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = { whatsapp: "5511900008888" as string | null, upserts: [] as unknown[] };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { whatsapp: state.whatsapp } }) }) }),
      upsert: vi.fn(async (...args: unknown[]) => {
        state.upserts.push(args);
        return { error: null };
      })
    }))
  };
  return { state, client };
});
vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { MeuWhatsapp } from "@/components/colaboradores/meu-whatsapp";

beforeEach(() => {
  mocks.state.upserts = [];
  mocks.state.whatsapp = "5511900008888";
});
afterEach(cleanup);

it("mostra o número salvo e grava o novo só com dígitos e 55", async () => {
  render(<MeuWhatsapp />);
  const campo = (await screen.findByDisplayValue("(11) 90000-8888")) as HTMLInputElement;
  fireEvent.change(campo, { target: { value: "21900007777" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar WhatsApp" }));
  await waitFor(() =>
    expect(mocks.state.upserts[0]).toEqual([{ user_id: "u1", whatsapp: "5521900007777" }, { onConflict: "user_id" }])
  );
});

it("número inválido não salva", async () => {
  mocks.state.whatsapp = null;
  render(<MeuWhatsapp />);
  const campo = await screen.findByLabelText("Seu WhatsApp");
  fireEvent.change(campo, { target: { value: "1199" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar WhatsApp" }));
  expect(await screen.findByText(/WhatsApp inválido/)).toBeTruthy();
  expect(mocks.state.upserts).toEqual([]);
});
