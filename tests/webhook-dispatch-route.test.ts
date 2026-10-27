import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  despachar: vi.fn(async () => ({ processadas: 2 })),
  admin: vi.fn(() => ({}))
}));
vi.mock("@/lib/webhooks/dispatch", () => ({ despacharPendentes: mocks.despachar }));
vi.mock("@/lib/webhooks/repo", () => ({ criarRepoSupabase: () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));

import { POST } from "@/app/api/webhooks/despachar/route";
import { isPublicApiPath } from "@/lib/supabase/middleware";

const chamar = (segredo?: string) =>
  POST(new Request("http://localhost/api/webhooks/despachar", {
    method: "POST",
    headers: segredo ? { "x-dispatch-secret": segredo } : {}
  }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WEBHOOK_DISPATCH_SECRET = "segredo-certo\n";
});

describe("POST /api/webhooks/despachar", () => {
  it("sem segredo: 401 e nada é despachado", async () => {
    expect((await chamar()).status).toBe(401);
    expect(mocks.despachar).not.toHaveBeenCalled();
  });

  it("segredo errado: 401", async () => {
    expect((await chamar("outro")).status).toBe(401);
    expect(mocks.despachar).not.toHaveBeenCalled();
  });

  it("sem a variável configurada no servidor: 401 mesmo com header", async () => {
    delete process.env.WEBHOOK_DISPATCH_SECRET;
    expect((await chamar("segredo-certo")).status).toBe(401);
  });

  it("segredo certo despacha e devolve quantas processou", async () => {
    const res = await chamar("segredo-certo");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, processadas: 2 });
  });

  it("quando o despacho falha, retorna 500", async () => {
    mocks.despachar.mockRejectedValueOnce(new Error("Erro na reserva"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await chamar("segredo-certo");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Falha ao despachar" });
  });
});

describe("middleware", () => {
  it("deixa a rota de despacho passar sem sessão", () => {
    expect(isPublicApiPath("/api/webhooks/despachar")).toBe(true);
  });
  it("continua liberando o conector MCP e barrando o resto", () => {
    expect(isPublicApiPath("/api/mcp/abc")).toBe(true);
    expect(isPublicApiPath("/api/admin/webhook")).toBe(false);
  });
});
