/**
 * Data e hora ditas em português, sempre no horário de Brasília (UTC-3, sem
 * horário de verão desde 2019). Devolve ISO em UTC ou null se não entender.
 * Exige horário: "amanhã" sozinho não serve para um lembrete.
 */

const OFFSET_MS = 3 * 3600_000;

/** Ano, mês (1-12) e dia de "agora" em Brasília. */
function hojeBrasilia(agora: Date): { a: number; m: number; d: number } {
  const b = new Date(agora.getTime() - OFFSET_MS);
  return { a: b.getUTCFullYear(), m: b.getUTCMonth() + 1, d: b.getUTCDate() };
}

function montar(a: number, m: number, d: number, h: number, min: number): string | null {
  if (h > 23 || min > 59 || m < 1 || m > 12 || d < 1) return null;
  const utc = Date.UTC(a, m - 1, d, h, min) + OFFSET_MS;
  const conf = new Date(utc - OFFSET_MS);
  if (conf.getUTCDate() !== d || conf.getUTCMonth() !== m - 1) return null; // 31/02 etc.
  return new Date(utc).toISOString();
}

/** "14:00", "14h", "14h30", "às 9" → [h, min]. */
function lerHora(s: string): [number, number] | null {
  const m = s.trim().match(/^(?:(?:às|as|a)\s+)?(\d{1,2})(?:(?::|h)(\d{2})?)?\s*h?$/);
  if (!m) return null;
  if (!s.includes(":") && !s.includes("h") && !/^(às|as|a)\s/.test(s.trim())) return null;
  return [parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0];
}

export function parseDataHora(entrada: string | null | undefined, agora: Date = new Date()): string | null {
  if (!entrada) return null;
  const v = entrada.trim().toLowerCase().replace(/\s+/g, " ");
  if (!v) return null;

  const rel = v.match(/^(?:em|daqui a|daqui) (\d+) (minuto|minutos|hora|horas)$/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const ms = rel[2].startsWith("hora") ? n * 3600_000 : n * 60_000;
    return new Date(agora.getTime() + ms).toISOString();
  }

  const h = hojeBrasilia(agora);

  const dia = v.match(/^(hoje|amanhã|amanha|depois de amanhã|depois de amanha) (.+)$/);
  if (dia) {
    const hora = lerHora(dia[2]);
    if (!hora) return null;
    const soma = dia[1] === "hoje" ? 0 : dia[1].startsWith("depois") ? 2 : 1;
    const base = new Date(Date.UTC(h.a, h.m - 1, h.d + soma));
    return montar(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hora[0], hora[1]);
  }

  const br = v.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?,? (.+)$/);
  if (br) {
    const hora = lerHora(br[4]);
    if (!hora) return null;
    const ano = br[3] ? parseInt(br[3], 10) : h.a;
    return montar(ano, parseInt(br[2], 10), parseInt(br[1], 10), hora[0], hora[1]);
  }

  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})[t ](\d{1,2}):(\d{2})$/);
  if (iso) {
    return montar(+iso[1], +iso[2], +iso[3], +iso[4], +iso[5]);
  }
  return null;
}
