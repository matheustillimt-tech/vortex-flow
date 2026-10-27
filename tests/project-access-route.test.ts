import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const rpc = vi.fn();
  const getUser = vi.fn();
  // Linha do usuário logado, com o perfil embutido (lida por getSessionState).
  const maybeSingle = vi.fn();
  // Concessões do perfil, quando ele não tem acesso total.
  const grants = vi.fn();
  const client = {
    auth: { getUser },
    rpc,
    from: vi.fn((tabela: string) =>
      tabela === "permission_grants"
        ? { select: () => ({ eq: grants }) }
        : { select: () => ({ eq: () => ({ maybeSingle }) }) }
    )
  };
  return { rpc, getUser, maybeSingle, grants, client, adminClient: vi.fn() };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: () => mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.adminClient }));
import { PUT } from "@/app/api/admin/usuarios/[id]/projects/route";

const user = "00000000-0000-0000-0000-000000000001";
const project = "aaaaaaaa-0000-0000-0000-000000000001";
const context = { params: { id: user } };
function request(body: unknown) {
  return new Request("http://localhost/api/admin/usuarios/test/projects", {
    method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" }
  });
}

const perfil = (fullAccess: boolean) => ({
  data: {
    id: user,
    nome: "Pessoa",
    email: "pessoa@empresa.com",
    ativo: true,
    permission_profile_id: "perfil-1",
    permission_profiles: { full_access: fullAccess, nome: fullAccess ? "Super Admin" : "Suporte" }
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: user } } });
  mocks.maybeSingle.mockResolvedValue(perfil(true));
  mocks.grants.mockResolvedValue({ data: [] });
  mocks.rpc.mockResolvedValue({ data: { ok: true, count: 1, restricted: true }, error: null });
});

describe("API de acesso a projetos", () => {
  it.each([null, {}, { project_ids: null }, { project_ids: "all" }, { project_ids: [123] }, { project_ids: ["invalid"] }])(
    "rejeita payload inválido sem liberar tudo: %j", async (body) => {
      expect((await PUT(request(body), context)).status).toBe(400);
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.adminClient).not.toHaveBeenCalled();
    }
  );

  it("JSON quebrado também não apaga permissões", async () => {
    expect((await PUT(new Request("http://localhost/", { method: "PUT", body: "{" }), context)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("usa uma só chamada transacional autenticada e normaliza duplicados", async () => {
    const response = await PUT(request({ project_ids: [project, project.toUpperCase()] }), context);
    expect(await response.json()).toEqual({ ok: true, count: 1, restricted: true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("set_user_project_access", {
      p_user_id: user, p_project_ids: [project]
    });
    expect(mocks.adminClient).not.toHaveBeenCalled();
  });

  it("aceita liberação somente com lista vazia explícita", async () => {
    await PUT(request({ project_ids: [] }), context);
    expect(mocks.rpc).toHaveBeenCalledWith("set_user_project_access", { p_user_id: user, p_project_ids: [] });
  });

  it.each(["PGRST202", "PGRST204", "42703"])("schema pendente (%s) falha sem fallback destrutivo", async (code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "schema unavailable" } });
    const response = await PUT(request({ project_ids: [project] }), context);
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("permissões anteriores foram mantidas");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.adminClient).not.toHaveBeenCalled();
  });

  it("perfil sem nenhuma permissão é barrado antes da RPC", async () => {
    mocks.maybeSingle.mockResolvedValue(perfil(false));
    mocks.grants.mockResolvedValue({ data: [] });
    expect((await PUT(request({ project_ids: [] }), context)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("só VER a equipe não basta para gravar", async () => {
    mocks.maybeSingle.mockResolvedValue(perfil(false));
    mocks.grants.mockResolvedValue({ data: [{ resource: "configuracoes.time", action: "view" }] });
    expect((await PUT(request({ project_ids: [] }), context)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("editar a equipe chega à RPC — que segue conferindo acesso total no banco", async () => {
    mocks.maybeSingle.mockResolvedValue(perfil(false));
    mocks.grants.mockResolvedValue({
      data: [
        { resource: "configuracoes.time", action: "view" },
        { resource: "configuracoes.time", action: "edit" }
      ]
    });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Apenas administradores" } });
    const response = await PUT(request({ project_ids: [] }), context);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(403);
  });

  it("usuário inativo ou sem perfil é barrado", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { ...perfil(true).data, ativo: false } });
    expect((await PUT(request({ project_ids: [] }), context)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejeita sessão ausente", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await PUT(request({ project_ids: [] }), context)).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
