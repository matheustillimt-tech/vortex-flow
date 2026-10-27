import { cleanEnv } from "@/lib/env";

/**
 * Nome do sistema que aparece nas telas, nos e-mails e no app autenticador
 * (2FA). Para usar o nome da sua empresa, defina NEXT_PUBLIC_APP_NAME na
 * Vercel (e no .env.local) — não precisa mexer no código.
 *
 * A leitura é literal (process.env.NEXT_PUBLIC_APP_NAME) de propósito: só
 * assim o Next embute o valor no navegador.
 */
export const APP_NAME = cleanEnv(process.env.NEXT_PUBLIC_APP_NAME) ?? "Vórtex Flow";

/** Iniciais do nome (ex.: "Vórtex Flow" → "VF"), usadas no logo dos e-mails. */
export const APP_INITIALS =
  APP_NAME.split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("") || "VF";
