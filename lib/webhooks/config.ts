/** Base das URLs enviadas no webhook — mesma regra do e-mail (lib/app-url.ts). */
export { appUrl } from "@/lib/app-url";

/** Só os 4 últimos caracteres voltam para a tela. */
export function mascararToken(token: string | null): string | null {
  if (!token) return null;
  return token.slice(-4);
}

export function validarUrlWebhook(url: string): string | null {
  const v = (url ?? "").trim();
  if (!v) return "Informe a URL do webhook.";
  try {
    if (new URL(v).protocol === "https:") return null;
  } catch {
    // cai na mensagem abaixo
  }
  return "A URL precisa começar com https://.";
}
