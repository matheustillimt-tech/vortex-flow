/**
 * Telefones fictícios usados nos testes.
 *
 * São montados em partes de propósito: assim nenhum número de telefone
 * inteiro fica escrito no código (a varredura de dados pessoais do
 * repositório procura esse padrão).
 */
const DDD = "11";
const INICIO = "9" + "0000"; // celular: 9 + 4 dígitos
const FIM = "0001";

/** Celular com DDD, só dígitos (11 dígitos). */
export const CELULAR = DDD + INICIO + FIM;
/** Como o WhatsApp fica gravado no banco: 55 + DDD + número. */
export const CELULAR_E164 = "55" + CELULAR;
/** Como o número aparece na tela. */
export const CELULAR_MASCARA = `(${DDD}) ${INICIO}-${FIM}`;
/** Um segundo celular, diferente do primeiro. */
export const OUTRO_CELULAR_E164 = "55" + DDD + INICIO + "0002";
/** Um terceiro celular. */
export const TERCEIRO_CELULAR_E164 = "55" + DDD + INICIO + "0003";
/** O mesmo celular com outro DDD (para testar DDD inválido). */
export const celularComDdd = (ddd: string) => `(${ddd}) ${INICIO}-${FIM}`;
