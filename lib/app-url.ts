import { cleanEnv } from "@/lib/env";

/**
 * Endereço público do sistema, usado nos links dos e-mails e do webhook.
 *
 * Ordem: NEXT_PUBLIC_APP_URL → APP_URL → o domínio de produção que a Vercel
 * informa sozinha (VERCEL_PROJECT_PRODUCTION_URL / VERCEL_URL) → localhost.
 * Defina NEXT_PUBLIC_APP_URL quando usar um domínio próprio.
 */
export function appUrl(): string {
  const configurado =
    cleanEnv(process.env.NEXT_PUBLIC_APP_URL) ?? cleanEnv(process.env.APP_URL);
  if (configurado) return configurado.replace(/\/+$/, "");

  const vercel =
    cleanEnv(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    cleanEnv(process.env.VERCEL_URL);
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;

  return "http://localhost:3000";
}
