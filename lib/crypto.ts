/**
 * Criptografia AES-256-GCM para segredos guardados em repouso
 * (senhas de ferramentas, chaves de API, etc.).
 *
 * - Chave: 32 bytes (256 bits) em base64 lido de TOOLS_ENC_KEY.
 * - IV (nonce): 12 bytes aleatórios por mensagem.
 * - Auth tag: 16 bytes verificados na decryption (detecta corrupção/tamper).
 * - Formato armazenado: "v1:<iv_b64>:<tag_b64>:<ct_b64>"
 *
 * IMPORTANTE: este módulo só roda no server-side (rotas /api). Nunca importar
 * de componentes "use client".
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const KEY_LEN = 32;
const PREFIX = "v1";

let cachedKey: Buffer | null = null;
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.TOOLS_ENC_KEY;
  if (!raw) {
    throw new Error(
      "TOOLS_ENC_KEY ausente — configure nas variáveis de ambiente (32 bytes em base64)."
    );
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== KEY_LEN) {
    throw new Error(
      `TOOLS_ENC_KEY com tamanho inválido (${buf.length}B) — precisa de 32 bytes em base64.`
    );
  }
  cachedKey = buf;
  return buf;
}

/**
 * Criptografa uma string. Retorna `null` se o input for null/undefined/""
 * (mantém semântica de "sem senha").
 */
export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain == null || plain === "") return null;
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString(
    "base64"
  )}`;
}

/**
 * Decripta um blob criptografado. Retorna null se input for null/vazio.
 * Aceita também strings legadas em texto puro (sem o prefixo "v1:") —
 * útil durante a janela de migração; após o seed script todas as senhas
 * deverão estar no formato novo.
 */
export function decryptSecret(blob: string | null | undefined): string | null {
  if (blob == null || blob === "") return null;
  if (!blob.startsWith(`${PREFIX}:`)) {
    // legado / texto puro — retorna como veio
    return blob;
  }
  const parts = blob.split(":");
  if (parts.length !== 4) {
    throw new Error("Formato inválido de senha criptografada");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const key = getKey();
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

/** True quando o blob já está no formato criptografado v1. */
export function isEncrypted(blob: string | null | undefined): boolean {
  return !!blob && blob.startsWith(`${PREFIX}:`);
}
