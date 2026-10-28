import { describe, expect, it } from "vitest";
import {
  CAMPOS,
  EVENTOS,
  EXEMPLO_CAMPOS,
  TEMPLATES_PADRAO,
  eventosAtivosPadrao,
  renderTemplate,
  textoDoEvento
} from "@/lib/avisos/template";

describe("renderTemplate", () => {
  it("troca todos os campos conhecidos", () => {
    expect(
      renderTemplate("Oi {nome}, {tarefa} vence {prazo} ({prioridade}) em {projeto}: {link}", {
        nome: "Ana",
        tarefa: "Criativos",
        prazo: "25/09/2026",
        prioridade: "Alta",
        projeto: "Lançamento",
        link: "https://flow/x"
      })
    ).toBe("Oi Ana, Criativos vence 25/09/2026 (Alta) em Lançamento: https://flow/x");
  });

  it("campo nulo, ausente ou desconhecido vira texto vazio", () => {
    expect(renderTemplate("A{projeto}B{quem_criou}C{xyz}D", { projeto: null })).toBe("ABCD");
  });

  it("aceita espaços dentro da chave e números", () => {
    expect(renderTemplate("{ nome } atrasou {dias_atraso} dia(s)", { nome: "Bia", dias_atraso: 2 })).toBe(
      "Bia atrasou 2 dia(s)"
    );
  });

  it("não deixa linhas em branco sobrando quando um campo some", () => {
    expect(renderTemplate("Olá\n\n{comentario}\n\nFim", { comentario: "" })).toBe("Olá\n\nFim");
  });
});

describe("textos padrão", () => {
  it("existem para os 4 eventos, sem travessão e só com campos conhecidos", () => {
    const conhecidos = new Set<string>(CAMPOS.map((c) => c.chave));
    expect(EVENTOS.map((e) => e.id)).toEqual([
      "tarefa.atribuida",
      "tarefa.prazo",
      "tarefa.atrasada",
      "tarefa.comentario"
    ]);
    for (const e of EVENTOS) {
      const t = TEMPLATES_PADRAO[e.id];
      expect(t.length).toBeGreaterThan(10);
      expect(t).not.toMatch(/[—–]/);
      expect(e.titulo + e.descricao).not.toMatch(/[—–]/);
      for (const m of t.matchAll(/\{\s*([a-z_]+)\s*\}/g)) expect(conhecidos.has(m[1])).toBe(true);
    }
  });

  it("texto de prazo serve para lembrete de qualquer dia (não diz 'hoje')", () => {
    expect(TEMPLATES_PADRAO["tarefa.prazo"]).not.toMatch(/hoje/i);
  });

  it("texto de comentário diz quem comentou", () => {
    expect(TEMPLATES_PADRAO["tarefa.comentario"]).toContain("{quem_criou}");
  });

  it("textoDoEvento usa o salvo e cai no padrão quando está em branco", () => {
    expect(textoDoEvento("tarefa.prazo", { "tarefa.prazo": "Meu texto" })).toBe("Meu texto");
    expect(textoDoEvento("tarefa.prazo", { "tarefa.prazo": "   " })).toBe(TEMPLATES_PADRAO["tarefa.prazo"]);
    expect(textoDoEvento("tarefa.prazo", null)).toBe(TEMPLATES_PADRAO["tarefa.prazo"]);
  });

  it("exemplo da prévia preenche todos os campos", () => {
    for (const c of CAMPOS) expect(EXEMPLO_CAMPOS[c.chave as keyof typeof EXEMPLO_CAMPOS]).toBeTruthy();
  });

  it("todos os eventos nascem ligados", () => {
    expect(eventosAtivosPadrao()).toEqual({
      "tarefa.atribuida": true,
      "tarefa.prazo": true,
      "tarefa.atrasada": true,
      "tarefa.comentario": true
    });
  });
});
