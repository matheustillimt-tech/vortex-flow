import { describe, expect, it } from "vitest";
import { montarPayload, type DadosEntrega } from "@/lib/webhooks/payload";
import { mascararToken, validarUrlWebhook } from "@/lib/webhooks/config";
import { CELULAR_E164 } from "./fixtures/telefones";

const base: DadosEntrega = {
  responsavel: { id: "u1", nome: "Ana Souza", whatsapp: CELULAR_E164 },
  tarefa: {
    id: "t1",
    titulo: "Criar criativos",
    descricao: "Três peças para o feed",
    prioridade: "alta",
    // 25/09/2026 18:00 em São Paulo
    prazo: "2026-09-25T21:00:00+00:00",
    prazoTemHora: true
  },
  projeto: { id: "p1", nome: "Lançamento Setembro" },
  atribuidoPorNome: "Bruno Costa"
};
const opts = { agora: new Date("2026-09-18T17:32:00Z"), appUrl: "https://flow.exemplo.com/", entregaId: "e1" };

describe("montarPayload", () => {
  it("monta o JSON completo", () => {
    expect(montarPayload("tarefa.atribuida", base, opts)).toEqual({
      evento: "tarefa.atribuida",
      entrega_id: "e1",
      enviado_em: "2026-09-18T14:32:00-03:00",
      responsavel: { id: "u1", nome: "Ana Souza", whatsapp: CELULAR_E164 },
      tarefa: {
        id: "t1",
        titulo: "Criar criativos",
        descricao: "Três peças para o feed",
        prioridade: "alta",
        prioridade_label: "Alta",
        prazo: "2026-09-25",
        prazo_formatado: "25/09/2026 às 18:00",
        link: "https://flow.exemplo.com/minha-area?task=t1",
        link_projeto: "https://flow.exemplo.com/projetos/p1"
      },
      projeto: { id: "p1", nome: "Lançamento Setembro" },
      atribuido_por: { nome: "Bruno Costa" }
    });
  });

  it("prazo sem hora mostra só a data, no dia de São Paulo", () => {
    const p = montarPayload("tarefa.atribuida", {
      ...base,
      tarefa: { ...base.tarefa, prazo: "2026-09-26T02:59:59+00:00", prazoTemHora: false }
    }, opts);
    expect(p.tarefa.prazo).toBe("2026-09-25");
    expect(p.tarefa.prazo_formatado).toBe("25/09/2026");
  });

  it("campos ausentes vão como null", () => {
    const p = montarPayload("tarefa.atribuida", {
      ...base,
      tarefa: { ...base.tarefa, descricao: "   ", prazo: null },
      projeto: null,
      atribuidoPorNome: null
    }, opts);
    expect(p.tarefa.descricao).toBeNull();
    expect(p.tarefa.prazo).toBeNull();
    expect(p.tarefa.prazo_formatado).toBeNull();
    expect(p.tarefa.link_projeto).toBeNull();
    expect(p.projeto).toBeNull();
    expect(p.atribuido_por).toBeNull();
  });

  it("média ganha acento no rótulo", () => {
    const p = montarPayload("teste", { ...base, tarefa: { ...base.tarefa, prioridade: "media" } }, opts);
    expect(p.evento).toBe("teste");
    expect(p.tarefa.prioridade_label).toBe("Média");
  });

  it("entrega_id vai null quando não informado (ex.: evento de teste)", () => {
    const p = montarPayload("teste", base, { agora: opts.agora, appUrl: opts.appUrl });
    expect(p.entrega_id).toBeNull();
  });
});

describe("config", () => {
  it("mascara o token mostrando só o final", () => {
    expect(mascararToken("segredo-1a2b")).toBe("1a2b");
    expect(mascararToken(null)).toBeNull();
    expect(mascararToken("abc")).toBe("abc");
  });

  it.each([
    ["https://disparo.exemplo.com/hook", null],
    ["", "Informe a URL do webhook."],
    ["http://disparo.exemplo.com", "A URL precisa começar com https://."],
    ["não é url", "A URL precisa começar com https://."]
  ])("valida %j", (url, erro) => {
    expect(validarUrlWebhook(url)).toBe(erro);
  });
});
