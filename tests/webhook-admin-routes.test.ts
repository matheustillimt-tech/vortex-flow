import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    config: null as null | Record<string, unknown>,
    whatsapp: null as string | null,
    upserts: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[]
  };
  // Cliente admin mínimo: só as cadeias que as rotas usam.
  const admin = {
    from: vi.fn((tabela: string) => {
      if (tabela === "webhook_config") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.config }) }) }),
          upsert: vi.fn(async (row: Record<string, unknown>) => {
            state.upserts.push(row);
            state.config = { ...(state.config ?? {}), ...row };
            return { error: null };
          })
        };
      }
      if (tabela === "users") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { nome: "Admin" } }) }) }) };
      }
      if (tabela === "colaborador_dados") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { whatsapp: state.whatsapp } }) }) }) };
      }
      if (tabela === "webhook_entregas") {
        return {
          update: (row: Record<string, unknown>) => {
            state.updates.push(row);
            return { eq: () => ({ eq: () => ({ select: async () => ({ data: [{ id: "e1" }], error: null }) }) }) };
          }
        };
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    })
  };
  return { state, admin, requireFullAccess: vi.fn() };
});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.admin }));
vi.mock("@/lib/permissions-server", () => ({ requireFullAccess: mocks.requireFullAccess }));
vi.mock("@/lib/activity-log", () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock("@/lib/webhooks/dispatch", () => ({ despacharPendentes: vi.fn(async () => ({ processadas: 0 })) }));
vi.mock("@/lib/webhooks/repo", () => ({ criarRepoSupabase: () => ({}) }));
vi.mock("@/lib/crypto", () => ({
  encryptSecret: vi.fn((v: string | null) => (v ? `enc:${v}` : null)),
  decryptSecret: (v: string | null) => (v ? v.replace(/^enc:/, "") : null)
}));

import { encryptSecret } from "@/lib/crypto";
import { GET, PUT } from "@/app/api/admin/webhook/route";
import { POST as TESTE } from "@/app/api/admin/webhook/teste/route";
import { POST as REENVIAR } from "@/app/api/admin/webhook/entregas/[id]/reenviar/route";

const sessao = { userId: "u-admin", nome: "Admin", email: "a@x.com", profileName: "Super Admin",
  perms: { fullAccess: true, grants: new Set<string>() } };
const put = (body: unknown) =>
  PUT(new Request("http://localhost/api/admin/webhook", {
    method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" }
  }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.config = null;
  mocks.state.whatsapp = null;
  mocks.state.upserts = [];
  mocks.state.updates = [];
  mocks.requireFullAccess.mockResolvedValue(sessao);
});

describe("acesso", () => {
  it.each([
    [401, "Não autenticado"],
    [403, "Você não tem permissão para esta ação"]
  ])("sem acesso total responde %i e não toca no banco", async (status, error) => {
    mocks.requireFullAccess.mockResolvedValue({ status, error });
    expect((await GET()).status).toBe(status);
    expect((await put({ url: "https://x", ativo: true })).status).toBe(status);
    expect((await TESTE(new Request("http://localhost/", { method: "POST" }))).status).toBe(status);
    expect((await REENVIAR(new Request("http://localhost/", { method: "POST" }), { params: { id: "e1" } })).status).toBe(status);
    expect(mocks.admin.from).not.toHaveBeenCalled();
  });
});

describe("configuração", () => {
  it("GET nunca devolve o token inteiro", async () => {
    mocks.state.config = { url: "https://x/hook", token: "enc:segredo-1a2b", ativo: true,
      atualizado_em: null, atualizado_por: null };
    const body = await (await GET()).json();
    expect(body.token_final).toBe("1a2b");
    expect(JSON.stringify(body)).not.toContain("segredo");
  });

  it("PUT recusa URL sem https", async () => {
    const res = await put({ url: "http://x/hook", ativo: true });
    expect(res.status).toBe(400);
    expect(mocks.state.upserts).toEqual([]);
  });

  it("PUT criptografa o token novo", async () => {
    await put({ url: "https://x/hook", ativo: true, token: "novo-9z9z" });
    expect(mocks.state.upserts[0]).toMatchObject({ url: "https://x/hook", ativo: true, token: "enc:novo-9z9z" });
  });

  it("PUT sem o campo token mantém o atual", async () => {
    await put({ url: "https://x/hook", ativo: false });
    expect(mocks.state.upserts[0]).not.toHaveProperty("token");
  });

  it("PUT com token null apaga", async () => {
    await put({ url: "https://x/hook", ativo: true, token: null });
    expect(mocks.state.upserts[0]).toHaveProperty("token", null);
  });

  it("PUT recusa token com menos de 8 caracteres", async () => {
    const res = await put({ url: "https://x/hook", ativo: true, token: "curto12" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("O token precisa ter pelo menos 8 caracteres.");
    expect(mocks.state.upserts).toEqual([]);
  });

  it("PUT devolve 500 quando falha ao criptografar (chave ausente)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(encryptSecret).mockImplementationOnce(() => {
      throw new Error("TOOLS_ENC_KEY ausente");
    });
    const res = await put({ url: "https://x/hook", ativo: true, token: "novo-9z9z" });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe(
      "Não foi possível guardar o token (chave de criptografia ausente)."
    );
    expect(mocks.state.upserts).toEqual([]);
  });
});

describe("teste e reenvio", () => {
  it("teste sem WhatsApp de quem clicou: 400 com mensagem clara", async () => {
    mocks.state.config = { url: "https://x/hook", token: null, ativo: true };
    const res = await TESTE(new Request("http://localhost/", { method: "POST" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Cadastre seu WhatsApp para receber o teste.");
  });

  it("reenviar volta a entrega com erro para pendente e zera tentativas", async () => {
    const res = await REENVIAR(new Request("http://localhost/", { method: "POST" }), { params: { id: "e1" } });
    expect(res.status).toBe(200);
    expect(mocks.state.updates[0]).toEqual({ status: "pendente", tentativas: 0, erro: null, http_status: null });
  });
});

describe("canais", () => {
  it("PUT do Vórtex CRM guarda a chave criptografada", async () => {
    const res = await put({
      canal: "crm", ativo: true,
      crm_url: "https://p.supabase.co/functions/v1/mcp", crm_chave: "chave-crm-1234"
    });
    expect(res.status).toBe(200);
    expect(mocks.state.upserts[0]).toMatchObject({
      canal: "crm", crm_url: "https://p.supabase.co/functions/v1/mcp", crm_chave: "enc:chave-crm-1234", ativo: true
    });
  });

  it("GET mascara a chave do CRM e os tokens da Z-API", async () => {
    mocks.state.config = {
      canal: "crm", ativo: true, crm_url: "https://crm", crm_chave: "enc:segredo-crm-9x9x",
      zapi_token: "enc:tok-zapi-7a7a", zapi_client_token: "enc:cli-zapi-3b3b",
      templates: { "tarefa.prazo": "Oi {nome}" }, eventos_ativos: { "tarefa.prazo": false }
    };
    const body = await (await GET()).json();
    expect(body).toMatchObject({
      canal: "crm", crm_chave_final: "9x9x", zapi_token_final: "7a7a", zapi_client_token_final: "3b3b",
      templates: { "tarefa.prazo": "Oi {nome}" }
    });
    expect(body.eventos_ativos["tarefa.prazo"]).toBe(false);
    expect(body.eventos_ativos["tarefa.atribuida"]).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/segredo|tok-zapi|cli-zapi/);
  });

  it("ligar o CRM sem chave (nem salva) é recusado", async () => {
    const res = await put({ canal: "crm", ativo: true, crm_url: "https://p.supabase.co/functions/v1/mcp" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Informe a chave do Vórtex CRM.");
    expect(mocks.state.upserts).toEqual([]);
  });

  it("ligar o CRM com a chave já salva é aceito", async () => {
    mocks.state.config = { canal: "crm", crm_chave: "enc:chave-antiga-1" };
    const res = await put({ canal: "crm", ativo: true, crm_url: "https://p.supabase.co/functions/v1/mcp" });
    expect(res.status).toBe(200);
    expect(mocks.state.upserts[0]).not.toHaveProperty("crm_chave");
  });

  it("ligar a Z-API sem token é recusado", async () => {
    const res = await put({ canal: "zapi", ativo: true, zapi_instancia: "INST" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Informe o token da instância da Z-API.");
  });

  it("PUT sem canal mantém o canal salvo", async () => {
    mocks.state.config = { canal: "zapi", zapi_instancia: "I", zapi_token: "enc:tok-zapi-1" };
    await put({ ativo: true });
    expect(mocks.state.upserts[0]).toMatchObject({ canal: "zapi" });
  });

  it("canal desconhecido é recusado", async () => {
    expect((await put({ canal: "telegram", ativo: false })).status).toBe(400);
  });

  it("template de evento desconhecido ou grande demais é recusado", async () => {
    expect((await put({ url: "https://x/hook", ativo: false, templates: { outro: "x" } })).status).toBe(400);
    expect((await put({ url: "https://x/hook", ativo: false, templates: { "tarefa.prazo": "x".repeat(1001) } })).status).toBe(400);
  });

  it("eventos só aceitam ligado/desligado", async () => {
    expect((await put({ url: "https://x/hook", ativo: false, eventos_ativos: { "tarefa.prazo": "sim" } })).status).toBe(400);
    await put({ url: "https://x/hook", ativo: false, eventos_ativos: { "tarefa.prazo": false } });
    expect(mocks.state.upserts[0]).toMatchObject({ eventos_ativos: { "tarefa.prazo": false } });
  });

  it("teste pela Z-API manda a mensagem de teste para o WhatsApp de quem clicou", async () => {
    mocks.state.config = { canal: "zapi", ativo: true, zapi_instancia: "INST", zapi_token: "enc:tok-zapi-1", zapi_client_token: null };
    mocks.state.whatsapp = "5511900008888";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messageId: "m" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const res = await TESTE(new Request("http://localhost/", { method: "POST" }));
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, http_status: 200 });
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.z-api.io/instances/INST/token/tok-zapi-1/send-text");
      expect(JSON.parse(init.body as string)).toMatchObject({ phone: "5511900008888" });
      expect(JSON.parse(init.body as string).message).toContain("Teste do Vórtex Flow");
      expect(JSON.stringify(body)).not.toContain("tok-zapi-1");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("teste com canal incompleto pede para salvar os dados", async () => {
    mocks.state.config = { canal: "crm", ativo: true, crm_url: "https://crm" };
    mocks.state.whatsapp = "5511900008888";
    const res = await TESTE(new Request("http://localhost/", { method: "POST" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Salve os dados do canal antes de testar.");
  });
});
