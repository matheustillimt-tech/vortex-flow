import { randomInt } from "node:crypto";

// Sem caracteres que se confundem na leitura (0/O, 1/l/I).
const MAIUSCULAS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const MINUSCULAS = "abcdefghijkmnpqrstuvwxyz";
const DIGITOS = "23456789";
const TODOS = MAIUSCULAS + MINUSCULAS + DIGITOS;

const sorteia = (conjunto: string) => conjunto[randomInt(conjunto.length)]!;

/**
 * Senha temporária de convite/reset: aleatória, gerada na hora e mostrada uma
 * vez para quem convidou. A pessoa é obrigada a trocar no primeiro acesso.
 *
 * Sempre tem pelo menos uma maiúscula, uma minúscula e um número, para passar
 * mesmo se o Supabase estiver configurado para exigir isso.
 */
export function gerarSenhaTemporaria(tamanho = 12): string {
  const n = Math.max(tamanho, 8);
  const chars = [sorteia(MAIUSCULAS), sorteia(MINUSCULAS), sorteia(DIGITOS)];
  while (chars.length < n) chars.push(sorteia(TODOS));
  // Embaralha (Fisher–Yates) para as 3 garantidas não ficarem sempre no início.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}
