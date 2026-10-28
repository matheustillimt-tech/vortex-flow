import { describe, expect, it } from "vitest";
import { parseDataHora } from "@/lib/mcp/datas";

// 28/10/2026 22:30 em Brasília (já é 29/10 em UTC).
const agora = new Date("2026-10-29T01:30:00Z");

describe("parseDataHora (horário de Brasília)", () => {
  it.each([
    ["amanhã 14:00", "2026-10-29T17:00:00.000Z"],
    ["amanha às 14h", "2026-10-29T17:00:00.000Z"],
    ["hoje 23h30", "2026-10-29T02:30:00.000Z"],
    ["30/10 15:00", "2026-10-30T18:00:00.000Z"],
    ["30/10/2026 15h", "2026-10-30T18:00:00.000Z"],
    ["2026-10-30 15:00", "2026-10-30T18:00:00.000Z"],
    ["2026-10-30T09:05", "2026-10-30T12:05:00.000Z"],
    ["em 2 horas", "2026-10-29T03:30:00.000Z"],
    ["daqui a 30 minutos", "2026-10-29T02:00:00.000Z"]
  ])("%s → %s", (entrada, esperado) => {
    expect(parseDataHora(entrada, agora)).toBe(esperado);
  });

  it.each(["amanhã", "30/10", "qualquer coisa", "", "31/02 10:00", "hoje 25:00"])(
    "sem horário ou inválido (%s) devolve null",
    (entrada) => {
      expect(parseDataHora(entrada, agora)).toBeNull();
    }
  );
});
