// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  podeExcluir: true,
  resposta: { error: null as null | { message: string }, count: 1 as number | null },
  chamadas: [] as unknown[][]
}));

vi.mock("@/components/permissions/permissions-provider", () => ({
  useCan: () => estado.podeExcluir
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (tabela: string) => ({
      delete: (opcoes: unknown) => ({
        eq: async (coluna: string, valor: string) => {
          estado.chamadas.push([tabela, opcoes, coluna, valor]);
          return estado.resposta;
        }
      })
    })
  })
}));

import { toast } from "sonner";
import { TaskDeleteButton } from "@/components/tasks/task-delete-button";

function renderCard(onDeleted = vi.fn(), onOpen = vi.fn()) {
  render(
    <div onClick={onOpen}>
      <TaskDeleteButton taskId="t-1" titulo="FEATURE - Criar o Gera HeadLine" onDeleted={onDeleted} />
    </div>
  );
  return { onDeleted, onOpen, lixeira: () => screen.queryByRole("button", { name: /Excluir tarefa/ }) };
}

describe("lixeira no card da tarefa", () => {
  beforeEach(() => {
    estado.podeExcluir = true;
    estado.resposta = { error: null, count: 1 };
    estado.chamadas = [];
    vi.stubGlobal("confirm", vi.fn(() => true));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("não aparece para perfil sem Excluir", () => {
    estado.podeExcluir = false;
    const { lixeira } = renderCard();
    expect(lixeira()).toBeNull();
  });

  it("exclui pelo id, tira o card do quadro e não abre a tarefa", async () => {
    const { onDeleted, onOpen, lixeira } = renderCard();
    fireEvent.click(lixeira()!);

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("t-1"));
    expect(estado.chamadas).toEqual([["tasks", { count: "exact" }, "id", "t-1"]]);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('"FEATURE - Criar o Gera HeadLine"'));
    expect(onOpen).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Tarefa excluída");
  });

  it("cancelar a confirmação não exclui nada", () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const { onDeleted, onOpen, lixeira } = renderCard();
    fireEvent.click(lixeira()!);
    expect(estado.chamadas).toHaveLength(0);
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("banco recusa em silêncio (RLS): avisa e o card continua", async () => {
    estado.resposta = { error: null, count: 0 };
    const { onDeleted, lixeira } = renderCard();
    fireEvent.click(lixeira()!);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Sem permissão para excluir essa tarefa.")
    );
    expect(onDeleted).not.toHaveBeenCalled();
    expect((lixeira() as HTMLButtonElement).disabled).toBe(false);
  });

  it("erro do banco aparece para quem clicou", async () => {
    estado.resposta = { error: { message: "falha de rede" }, count: null };
    const { onDeleted, lixeira } = renderCard();
    fireEvent.click(lixeira()!);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("falha de rede"));
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
