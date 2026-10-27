import { describe, expect, it } from "vitest";
import {
  fromWhatsappE164,
  maskTelefone,
  toWhatsappE164,
  validateWhatsapp
} from "@/lib/br-validations";
import { CELULAR, CELULAR_E164, CELULAR_MASCARA, celularComDdd } from "./fixtures/telefones";

describe("validateWhatsapp", () => {
  it.each([CELULAR_MASCARA, CELULAR, "(21) 3333-4444"])("aceita %s", (v) => {
    expect(validateWhatsapp(v)).toBeNull();
  });

  it("vazio pede o número", () => {
    expect(validateWhatsapp("")).toBe("Informe seu WhatsApp.");
  });

  it.each(["9999-8888", "(11) 9999", CELULAR + "7"])("tamanho errado: %s", (v) => {
    expect(validateWhatsapp(v)).toBe("WhatsApp inválido — use DDD + número.");
  });

  it.each([celularComDdd("01"), celularComDdd("10"), "(20) 3333-4444"])("DDD inválido: %s", (v) => {
    expect(validateWhatsapp(v)).toBe("DDD inválido.");
  });

  it("celular com 11 dígitos precisa começar com 9", () => {
    expect(validateWhatsapp("(11) 89999-8888")).toBe("Celular deve começar com 9 depois do DDD.");
  });
});

describe("formato gravado", () => {
  it("grava só dígitos com 55 na frente", () => {
    expect(toWhatsappE164(CELULAR_MASCARA)).toBe(CELULAR_E164);
  });

  it("volta para a máscara sem o 55", () => {
    expect(maskTelefone(fromWhatsappE164(CELULAR_E164))).toBe(CELULAR_MASCARA);
  });

  it("nulo vira string vazia", () => {
    expect(fromWhatsappE164(null)).toBe("");
  });
});
