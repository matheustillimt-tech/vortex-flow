/**
 * Lê uma variável de ambiente sem espaços nem quebras de linha nas pontas.
 *
 * Valores colados na Vercel chegaram com "\n" no fim. Nas chamadas HTTP isso
 * passa despercebido (o cabeçalho é aparado), mas a conexão em tempo real leva
 * a chave dentro do endereço — e o Supabase recusa com 401. Resultado: quadro,
 * chat e notificações deixam de atualizar sozinhos.
 *
 * Passe `process.env.NOME` literal (nunca `process.env[nome]`): o Next só
 * embute as variáveis NEXT_PUBLIC_ no navegador quando a leitura é literal.
 */
export function cleanEnv(valor: string | undefined): string | undefined {
  if (valor == null) return undefined;
  const limpo = valor.trim().replace(/(\\n)+$/, "").trim();
  return limpo === "" ? undefined : limpo;
}
