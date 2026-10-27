import { describe, expect, it, vi } from "vitest";
import { enviarWebhook, type FetchLike } from "@/lib/webhooks/send";

const payload = { evento: "teste" };

describe("enviarWebhook", () => {
  it("POST JSON com Bearer quando há token", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(new Response("ok", { status: 200 }));
    const r = await enviarWebhook({ url: "https://x/hook", token: "abc", payload, fetchImpl });
    expect(r).toEqual({ ok: true, httpStatus: 200, resposta: "ok", erro: null });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://x/hook");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer abc" });
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  it("sem token não manda Authorization", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(new Response(null, { status: 204 }));
    await enviarWebhook({ url: "https://x/hook", token: null, payload, fetchImpl });
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json" });
  });

  it("não segue redirecionamentos (3xx vira falha, não sucesso silencioso)", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(new Response(null, { status: 200 }));
    await enviarWebhook({ url: "https://x/hook", token: null, payload, fetchImpl });
    expect(fetchImpl.mock.calls[0][1].redirect).toBe("manual");
  });

  it("resposta não 2xx vira erro com o corpo (até 500 caracteres)", async () => {
    const corpo = "x".repeat(800);
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(new Response(corpo, { status: 500 }));
    const r = await enviarWebhook({ url: "https://x/hook", token: null, payload, fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(500);
    expect(r.erro).toHaveLength(500);
  });

  it("erro de rede vira erro sem status", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockRejectedValue(new Error("ECONNREFUSED"));
    const r = await enviarWebhook({ url: "https://x/hook", token: null, payload, fetchImpl });
    expect(r).toEqual({ ok: false, httpStatus: null, resposta: null, erro: "ECONNREFUSED" });
  });

  it("para de esperar depois do timeout", async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_, reject) =>
        init.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
        )
      );
    const r = await enviarWebhook({ url: "https://x/hook", token: null, payload, fetchImpl, timeoutMs: 20 });
    expect(r).toEqual({ ok: false, httpStatus: null, resposta: null, erro: "Sem resposta em 0.02s" });
  });
});
