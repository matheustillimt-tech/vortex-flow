import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanEnv } from "@/lib/env";

describe("cleanEnv", () => {
  it.each([
    ["https://abc.supabase.co\n", "https://abc.supabase.co"],
    ["https://abc.supabase.co\\n", "https://abc.supabase.co"],
    ["  eyJhbGciOi.eyJyb2xlIjoi.assinatura \r\n", "eyJhbGciOi.eyJyb2xlIjoi.assinatura"],
    ["Vortex Flow <nao-responda@exemplo.com>\n", "Vortex Flow <nao-responda@exemplo.com>"],
    ["sem-sujeira", "sem-sujeira"]
  ])("%j → %j", (entrada, esperado) => {
    expect(cleanEnv(entrada)).toBe(esperado);
  });

  it("vazio ou ausente vira undefined, para o valor padrão entrar", () => {
    expect(cleanEnv(undefined)).toBeUndefined();
    expect(cleanEnv("")).toBeUndefined();
    expect(cleanEnv(" \n")).toBeUndefined();
    expect(cleanEnv("\\n")).toBeUndefined();
  });
});

/**
 * Trava: essas variáveis nunca são lidas cruas. Foi uma leitura crua da chave
 * do Supabase, com "\n" no fim, que derrubou o tempo real em produção.
 */
const PROTEGIDAS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "NEXT_PUBLIC_APP_URL",
  "APP_URL",
  "WEBHOOK_DISPATCH_SECRET"
];

function arquivosDeCodigo(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivosDeCodigo(caminho);
    return /\.(ts|tsx)$/.test(nome) ? [caminho] : [];
  });
}

describe("variáveis de ambiente sensíveis a quebra de linha", () => {
  it("são sempre lidas através de cleanEnv", () => {
    const raiz = process.cwd();
    const arquivos = ["app", "lib", "components"].flatMap((d) => arquivosDeCodigo(resolve(raiz, d)));
    const cruas: string[] = [];
    const leitura = new RegExp(`(cleanEnv\\()?process\\.env\\.(${PROTEGIDAS.join("|")})\\b`, "g");

    for (const arquivo of arquivos) {
      const codigo = readFileSync(arquivo, "utf8");
      for (const m of codigo.matchAll(leitura)) {
        if (!m[1]) cruas.push(`${arquivo.slice(raiz.length + 1)}: ${m[2]}`);
      }
    }

    expect(cruas).toEqual([]);
  });
});
