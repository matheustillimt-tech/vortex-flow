// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    lembretes: [{ id: "l1", horario: "2026-10-30T17:00:00.000Z" }] as Array<{ id: string; horario: string }>,
    inserts: [] as Record<string, unknown>[],
    deletes: [] as string[]
  };
  const client = {
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ order: async () => ({ data: state.lembretes, error: null }) }) }),
      insert: (row: Record<string, unknown>) => {
        state.inserts.push(row);
        return { select: () => ({ single: async () => ({ data: { id: "l2", horario: row.horario }, error: null }) }) };
      },
      delete: () => ({ eq: async (_c: string, id: string) => { state.deletes.push(id); return { error: null, count: 1 }; } })
    }))
  };
  return { state, client };
});
vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { TaskReminders } from "@/components/side-panel/task-reminders";

const base = {
  taskId: "t1", userId: "u1", temPrazo: true, lembretePadrao: true,
  podeEditarTarefa: true, podeAdicionar: true, onChangePadrao: vi.fn()
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.inserts = [];
  mocks.state.deletes = [];
});
afterEach(cleanup);

it("lista os horários extras no horário de Brasília", async () => {
  render(<TaskReminders {...base} />);
  expect(await screen.findByText("30/10/2026 às 14:00")).toBeTruthy();
});

it("adicionar grava o horário de Brasília em UTC e quem criou", async () => {
  render(<TaskReminders {...base} />);
  await screen.findByText("30/10/2026 às 14:00");
  fireEvent.change(screen.getByLabelText("Novo lembrete"), { target: { value: "2026-10-31T09:30" } });
  fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
  await waitFor(() =>
    expect(mocks.state.inserts[0]).toEqual({ task_id: "t1", horario: "2026-10-31T12:30:00.000Z", criado_por: "u1" })
  );
  expect(await screen.findByText("31/10/2026 às 09:30")).toBeTruthy();
});

it("remover apaga o lembrete", async () => {
  render(<TaskReminders {...base} />);
  fireEvent.click(await screen.findByRole("button", { name: "Remover lembrete de 30/10/2026 às 14:00" }));
  await waitFor(() => expect(mocks.state.deletes).toEqual(["l1"]));
});

it("a caixa das 08:00 chama onChangePadrao", async () => {
  render(<TaskReminders {...base} />);
  fireEvent.click(await screen.findByRole("checkbox", { name: /08:00 do dia do prazo/ }));
  expect(base.onChangePadrao).toHaveBeenCalledWith(false);
});

it("sem permissão fica só leitura", async () => {
  render(<TaskReminders {...base} podeEditarTarefa={false} podeAdicionar={false} />);
  await screen.findByText("30/10/2026 às 14:00");
  expect((screen.getByRole("checkbox", { name: /08:00 do dia do prazo/ }) as HTMLInputElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Adicionar" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Remover lembrete/ })).toBeNull();
});

it("sem prazo explica que o das 08:00 depende do prazo", async () => {
  render(<TaskReminders {...base} temPrazo={false} />);
  expect(await screen.findByText(/só vale quando a tarefa tem prazo/)).toBeTruthy();
});

it("horário no passado não é gravado", async () => {
  render(<TaskReminders {...base} />);
  await screen.findByText("30/10/2026 às 14:00");
  fireEvent.change(screen.getByLabelText("Novo lembrete"), { target: { value: "2020-01-01T09:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
  expect(await screen.findByText("Escolha um horário no futuro.")).toBeTruthy();
  expect(mocks.state.inserts).toEqual([]);
});
