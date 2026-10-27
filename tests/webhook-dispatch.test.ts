import { describe, expect, it, vi } from "vitest";
import {
  despacharPendentes,
  type EntregaReservada,
  type Finalizacao,
  type WebhookRepo
} from "@/lib/webhooks/dispatch";
import type { DadosEntrega } from "@/lib/webhooks/payload";
import type { FetchLike } from "@/lib/webhooks/send";
import { CELULAR_E164, TERCEIRO_CELULAR_E164 } from "./fixtures/telefones";

const dados: DadosEntrega = {
  responsavel: { id: "u1", nome: "Ana", whatsapp: CELULAR_E164 },
  tarefa: { id: "t1", titulo: "Criativos", descricao: null, prioridade: "alta", prazo: null, prazoTemHora: false },
  projeto: null,
  atribuidoPorNome: null
};
const entrega = (tentativas = 1): EntregaReservada => ({
  id: "e1", task_id: "t1", user_id: "u1", atribuido_por: null, tentativas
});
const agora = () => new Date("2026-09-18T17:32:00Z");

function repo(over: Partial<WebhookRepo> = {}) {
  const finalizadas: Array<[string, Finalizacao]> = [];
  const r: WebhookRepo = {
    lerConfig: async () => ({ url: "https://x/hook", token: "tok", ativo: true }),
    reservarPendentes: vi.fn(async () => [entrega()]),
    carregarDados: async () => dados,
    finalizar: async (id, f) => { finalizadas.push([id, f]); },
    ...over
  };
  return { r, finalizadas };
}
const responde = (status: number) =>
  vi.fn<FetchLike>().mockResolvedValue(new Response("corpo", { status }));

describe("despacharPendentes", () => {
  it("2xx marca enviado com a hora do envio", async () => {
    const { r, finalizadas } = repo();
    const fetchImpl = responde(200);
    expect(await despacharPendentes(r, { appUrl: "https://flow", fetchImpl, agora })).toEqual({ processadas: 1 });
    expect(finalizadas).toEqual([
      ["e1", { status: "enviado", http_status: 200, erro: null, enviado_em: "2026-09-18T17:32:00.000Z" }]
    ]);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.evento).toBe("tarefa.atribuida");
    expect(body.responsavel.whatsapp).toBe(CELULAR_E164);
    expect(body.entrega_id).toBe("e1");
  });

  it("falha antes da 3ª tentativa volta para pendente", async () => {
    const { r, finalizadas } = repo({ reservarPendentes: async () => [entrega(2)] });
    await despacharPendentes(r, { appUrl: "https://flow", fetchImpl: responde(500), agora });
    expect(finalizadas[0][1]).toEqual({ status: "pendente", http_status: 500, erro: "corpo", enviado_em: null });
  });

  it("falha na 3ª tentativa vira erro", async () => {
    const { r, finalizadas } = repo({ reservarPendentes: async () => [entrega(3)] });
    await despacharPendentes(r, { appUrl: "https://flow", fetchImpl: responde(500), agora });
    expect(finalizadas[0][1].status).toBe("erro");
  });

  it("número apagado depois do registro vira sem_telefone, sem POST", async () => {
    const { r, finalizadas } = repo({ carregarDados: async () => "sem_telefone" });
    const fetchImpl = responde(200);
    await despacharPendentes(r, { appUrl: "https://flow", fetchImpl, agora });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(finalizadas[0][1].status).toBe("sem_telefone");
  });

  it("tarefa ou pessoa sumida vira erro, sem POST", async () => {
    const { r, finalizadas } = repo({ carregarDados: async () => null });
    const fetchImpl = responde(200);
    await despacharPendentes(r, { appUrl: "https://flow", fetchImpl, agora });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(finalizadas[0][1]).toEqual({
      status: "erro", http_status: null, erro: "Tarefa ou responsável não encontrado.", enviado_em: null
    });
  });

  it.each([
    ["desligado", { url: "https://x", token: null, ativo: false }],
    ["sem URL", { url: null, token: null, ativo: true }],
    ["sem configuração", null]
  ])("webhook %s não reserva nem envia", async (_nome, cfg) => {
    const { r } = repo({ lerConfig: async () => cfg });
    const fetchImpl = responde(200);
    expect(await despacharPendentes(r, { appUrl: "https://flow", fetchImpl, agora })).toEqual({ processadas: 0 });
    expect(r.reservarPendentes).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("carregarDados rejeita na 1ª tentativa volta para pendente", async () => {
    const { r, finalizadas } = repo({ 
      carregarDados: async () => { throw new Error("Erro na consulta"); }
    });
    const fetchImpl = responde(200);
    await despacharPendentes(r, { appUrl: "https://flow", fetchImpl, agora });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(finalizadas[0][1]).toEqual({
      status: "pendente", http_status: null, erro: "Erro na consulta", enviado_em: null
    });
  });

  it("carregarDados rejeita na 3ª tentativa vira erro", async () => {
    const { r, finalizadas } = repo({ 
      carregarDados: async () => { throw new Error("Erro fatal"); },
      reservarPendentes: async () => [entrega(3)]
    });
    const fetchImpl = responde(200);
    await despacharPendentes(r, { appUrl: "https://flow", fetchImpl, agora });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(finalizadas[0][1]).toEqual({
      status: "erro", http_status: null, erro: "Erro fatal", enviado_em: null
    });
  });

  it("POST ok mas finalizar(enviado) rejeita: não tenta marcar pendente/erro de novo", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const finalizar = vi.fn(async (_id: string, f: Finalizacao) => {
      if (f.status === "enviado") throw new Error("Falha ao gravar");
    });
    const { r } = repo({ finalizar });
    const fetchImpl = responde(200);
    await despacharPendentes(r, { appUrl: "https://flow", fetchImpl, agora });
    expect(finalizar).toHaveBeenCalledTimes(1);
    expect(finalizar).toHaveBeenCalledWith("e1", {
      status: "enviado", http_status: 200, erro: null, enviado_em: "2026-09-18T17:32:00.000Z"
    });
  });

  it("lote com duas entregas: primeira rejeita, segunda é enviada", async () => {
    const e1 = { id: "e1", task_id: "t1", user_id: "u1", atribuido_por: null, tentativas: 1 };
    const e2 = { id: "e2", task_id: "t2", user_id: "u2", atribuido_por: null, tentativas: 1 };
    let chamada = 0;
    const { r, finalizadas } = repo({
      reservarPendentes: async () => [e1, e2],
      carregarDados: async (e) => {
        chamada++;
        if (e.id === "e1") throw new Error("Falha na primeira");
        return { 
          responsavel: { id: "u2", nome: "Bob", whatsapp: TERCEIRO_CELULAR_E164 },
          tarefa: { id: "t2", titulo: "Task 2", descricao: null, prioridade: "media", prazo: null, prazoTemHora: false },
          projeto: null,
          atribuidoPorNome: null
        };
      }
    });
    const fetchImpl = responde(200);
    expect(await despacharPendentes(r, { appUrl: "https://flow", fetchImpl, agora })).toEqual({ processadas: 2 });
    expect(finalizadas.length).toBe(2);
    expect(finalizadas[0][1]).toEqual({
      status: "pendente", http_status: null, erro: "Falha na primeira", enviado_em: null
    });
    expect(finalizadas[1][1]).toEqual({
      status: "enviado", http_status: 200, erro: null, enviado_em: "2026-09-18T17:32:00.000Z"
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
