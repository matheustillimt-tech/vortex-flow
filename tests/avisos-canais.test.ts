import { describe, expect, it, vi } from "vitest";
import { canalPronto, enviarPeloCanal, type ConfigCanais } from "@/lib/webhooks/canais";
import type { FetchLike } from "@/lib/webhooks/send";

const base: ConfigCanais = {
  canal: "webhook",
  url: null,
  token: null,
  crm_url: null,
  crm_chave: null,
  zapi_instancia: null,
  zapi_token: null,
  zapi_client_token: null,
  zapi_base_url: null
};
const destino = { telefone: "5511900008888" };
const payload = { evento: "tarefa.atribuida", mensagem: "Oi" };
const responde = (corpo: string, status = 200, headers: Record<string, string> = {}) =>
  vi.fn<FetchLike>().mockResolvedValue(new Response(corpo, { status, headers }));

describe("canalPronto", () => {
  it.each([
    [{ canal: "webhook", url: "https://x" }, true],
    [{ canal: "webhook" }, false],
    [{ canal: "crm", crm_url: "https://crm/mcp", crm_chave: "chave-123" }, true],
    [{ canal: "crm", crm_url: "https://crm/mcp" }, false],
    [{ canal: "zapi", zapi_instancia: "I", zapi_token: "T" }, true],
    [{ canal: "zapi", zapi_instancia: "I" }, false]
  ] as const)("%o → %s", (over, esperado) => {
    expect(canalPronto({ ...base, ...over } as ConfigCanais)).toBe(esperado);
  });
});

describe("canal webhook", () => {
  it("manda o payload inteiro (com a mensagem) e o Bearer", async () => {
    const fetchImpl = responde("ok");
    const r = await enviarPeloCanal({ ...base, url: "https://x/hook", token: "tok-1234" }, destino, "Oi", payload, { fetchImpl });
    expect(r.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://x/hook");
    expect(JSON.parse(init.body as string)).toEqual(payload);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1234");
    expect(init.redirect).toBe("manual");
  });
});

describe("canal Vórtex CRM", () => {
  const crm = { ...base, canal: "crm" as const, crm_url: "https://p.supabase.co/functions/v1/mcp", crm_chave: "chave-secreta" };

  it("chama enviar_mensagem por JSON-RPC com telefone e texto", async () => {
    const fetchImpl = responde(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "{}" }] } }));
    const r = await enviarPeloCanal(crm, destino, "Olá Ana", payload, { fetchImpl });
    expect(r.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://p.supabase.co/functions/v1/mcp");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer chave-secreta",
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json"
    });
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "enviar_mensagem", arguments: { telefone: "5511900008888", texto: "Olá Ana" } }
    });
    expect(body.id).toBeDefined();
  });

  it("result.isError é falha, com o texto devolvido pelo CRM", async () => {
    const fetchImpl = responde(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "Sem conexão ativa." }], isError: true } })
    );
    const r = await enviarPeloCanal(crm, destino, "Oi", payload, { fetchImpl });
    expect(r).toMatchObject({ ok: false, httpStatus: 200, erro: "Sem conexão ativa." });
  });

  it("erro JSON-RPC é falha", async () => {
    const fetchImpl = responde(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Ferramenta desconhecida" } }));
    const r = await enviarPeloCanal(crm, destino, "Oi", payload, { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("Ferramenta desconhecida");
  });

  it("lê resposta em text/event-stream", async () => {
    const sse = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [], isError: false } })}\n\n`;
    const fetchImpl = responde(sse, 200, { "content-type": "text/event-stream" });
    expect((await enviarPeloCanal(crm, destino, "Oi", payload, { fetchImpl })).ok).toBe(true);
  });

  it("resposta que não é JSON-RPC é falha", async () => {
    const fetchImpl = responde("<html>oi</html>");
    expect((await enviarPeloCanal(crm, destino, "Oi", payload, { fetchImpl })).ok).toBe(false);
  });

  it("HTTP 401 é falha com o status, sem expor a chave", async () => {
    const fetchImpl = responde(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Chave inválida" } }), 401);
    const r = await enviarPeloCanal(crm, destino, "Oi", payload, { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(401);
    expect(JSON.stringify(r)).not.toContain("chave-secreta");
  });
});

describe("canal Z-API", () => {
  const zapi = { ...base, canal: "zapi" as const, zapi_instancia: "INST1", zapi_token: "TOK1", zapi_client_token: "CLI1" };

  it("POST em send-text com Client-Token e corpo { phone, message }", async () => {
    const fetchImpl = responde(JSON.stringify({ zaapId: "z", messageId: "m", id: "m" }));
    const r = await enviarPeloCanal(zapi, { telefone: "+55 (11) 90000-8888" }, "Oi", payload, { fetchImpl });
    expect(r.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.z-api.io/instances/INST1/token/TOK1/send-text");
    expect(init.headers).toMatchObject({ "Client-Token": "CLI1", "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ phone: "5511900008888", message: "Oi" });
    expect(init.redirect).toBe("manual");
  });

  it("base configurável (sem barra no fim) e sem Client-Token quando vazio", async () => {
    const fetchImpl = responde("{}");
    await enviarPeloCanal(
      { ...zapi, zapi_client_token: null, zapi_base_url: "https://api.zapbot.com.br/" },
      destino,
      "Oi",
      payload,
      { fetchImpl }
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.zapbot.com.br/instances/INST1/token/TOK1/send-text");
    expect(init.headers).not.toHaveProperty("Client-Token");
  });

  it("telefone sem 55 ganha o 55", async () => {
    const fetchImpl = responde("{}");
    await enviarPeloCanal(zapi, { telefone: "11900008888" }, "Oi", payload, { fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string).phone).toBe("5511900008888");
  });

  it("2xx com { error } é falha", async () => {
    const fetchImpl = responde(JSON.stringify({ error: "Instance not found" }));
    const r = await enviarPeloCanal(zapi, destino, "Oi", payload, { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("Instance not found");
  });

  it.each([
    [200, JSON.stringify({ error: "your client-token is not configured" })],
    [400, JSON.stringify({ error: "null", message: "client-token not allowed" })]
  ])("Z-API pedindo Client-Token (HTTP %i) vira mensagem clara", async (status, corpo) => {
    const fetchImpl = responde(corpo, status);
    const r = await enviarPeloCanal({ ...zapi, zapi_client_token: null }, destino, "Oi", payload, { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.erro).toBe(
      "A Z-API pediu o Client-Token. Preencha o Client-Token da conta (fica em Segurança, no painel da Z-API) e salve de novo."
    );
  });

  it("erro de rede não expõe o token da URL", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockRejectedValue(new Error("fetch failed"));
    const r = await enviarPeloCanal(zapi, destino, "Oi", payload, { fetchImpl });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("TOK1");
  });
});

it("canal não configurado devolve falha sem chamar a rede", async () => {
  const fetchImpl = responde("ok");
  const r = await enviarPeloCanal({ ...base, canal: "crm" }, destino, "Oi", payload, { fetchImpl });
  expect(r.ok).toBe(false);
  expect(fetchImpl).not.toHaveBeenCalled();
});
