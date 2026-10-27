/**
 * Validações e máscaras de documentos brasileiros.
 * Usado no cadastro de colaboradores (CPF, CEP, telefone, WhatsApp).
 */

/** Remove tudo que não é dígito. */
export function onlyDigits(v: string): string {
  return (v ?? "").replace(/\D/g, "");
}

/** Formata como CPF: 000.000.000-00 (parcial enquanto digita). */
export function maskCPF(v: string): string {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Formata como CEP: 00000-000. */
export function maskCEP(v: string): string {
  const d = onlyDigits(v).slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

/** Formata telefone: (00) 00000-0000. */
export function maskTelefone(v: string): string {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10)
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/**
 * Valida CPF pelos dígitos verificadores.
 * Rejeita sequências repetidas (111.111.111-11) que passam no cálculo.
 */
export function isValidCPF(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const calcCheck = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) {
      sum += parseInt(cpf[i], 10) * (len + 1 - i);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return calcCheck(9) === parseInt(cpf[9], 10)
    && calcCheck(10) === parseInt(cpf[10], 10);
}

/** Valida e-mail de forma simples (suficiente pra chave PIX). */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((value ?? "").trim());
}

/**
 * Valida a chave PIX conforme o tipo escolhido.
 * Retorna null quando válida, ou a mensagem de erro.
 */
export function validateChavePix(
  tipo: string | null | undefined,
  chave: string
): string | null {
  const v = (chave ?? "").trim();
  if (!v) return "Informe a chave PIX.";
  switch (tipo) {
    case "cpf":
      return isValidCPF(v) ? null : "CPF da chave PIX é inválido.";
    case "email":
      return isValidEmail(v) ? null : "E-mail da chave PIX é inválido.";
    case "telefone":
      return onlyDigits(v).length >= 10
        ? null
        : "Telefone da chave PIX é inválido.";
    case "aleatoria":
      // Chave aleatória (EVP) é um UUID de 32 hex com hífens.
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
        ? null
        : "Chave aleatória deve ter o formato UUID.";
    default:
      return "Selecione o tipo da chave PIX.";
  }
}

/**
 * Valida o WhatsApp do colaborador (DDD + número, com ou sem máscara).
 * Retorna null quando válido, ou a mensagem de erro.
 */
export function validateWhatsapp(value: string): string | null {
  const d = onlyDigits(value);
  if (!d) return "Informe seu WhatsApp.";
  if (d.length !== 10 && d.length !== 11) return "WhatsApp inválido — use DDD + número.";
  // DDDs brasileiros vão de 11 a 99 e nunca terminam em 0.
  if (d[0] === "0" || d[1] === "0") return "DDD inválido.";
  if (d.length === 11 && d[2] !== "9") return "Celular deve começar com 9 depois do DDD.";
  return null;
}

/** Formato gravado no banco e enviado no webhook: só dígitos, com DDI 55. */
export function toWhatsappE164(value: string): string {
  return `55${onlyDigits(value)}`;
}

/** Inverso de toWhatsappE164: tira o 55 para aplicar a máscara na tela. */
export function fromWhatsappE164(value: string | null | undefined): string {
  if (!value) return "";
  return value.startsWith("55") && value.length >= 12 ? value.slice(2) : value;
}

/** Estados brasileiros pro select de endereço. */
export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
  "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
  "RS", "RO", "RR", "SC", "SP", "SE", "TO"
] as const;
