import * as React from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  buildPermissionSet,
  can,
  firstAllowedHref,
  NO_ACCESS_HREF,
  type PermissionAction,
  type PermissionSet
} from "@/lib/permissions";

/**
 * Leitura de permissão no servidor.
 *
 * Toda rota e toda página protegida passa por aqui. O cliente esconde o que a
 * pessoa não pode ver; este módulo é o que de fato impede o acesso quando
 * alguém digita a URL ou chama a API na mão.
 */

export interface SessionPermissions {
  userId: string;
  nome: string;
  email: string;
  /** Nome do perfil atribuído, para exibição. */
  profileName: string | null;
  perms: PermissionSet;
}

export type SessionState =
  | { status: "anon" }
  | { status: "no-profile" }
  | { status: "ok"; session: SessionPermissions };

export type PermissionFailure = { error: string; status: 401 | 403 };

type ProfileEmbed = { full_access: boolean; nome: string };

// cache() só existe no runtime de Server Components do Next. Fora dele (nos
// testes, por exemplo) cai para a própria função, sem memoização.
const cache: <T>(fn: T) => T =
  (React as unknown as { cache?: <T>(fn: T) => T }).cache ?? ((fn) => fn);

/**
 * Estado de acesso de quem faz a requisição. Memoizado por requisição com
 * cache(): o layout e a página consultam, mas o banco é lido uma vez só.
 */
export const getSessionState = cache(async (): Promise<SessionState> => {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { status: "anon" };

  const { data: perfil } = await supabase
    .from("users")
    .select(
      "id, nome, email, ativo, permission_profile_id, permission_profiles(full_access, nome)"
    )
    .eq("id", user.id)
    .maybeSingle();

  // Inativo ou sem perfil atribuído: autenticado, mas sem nenhuma permissão.
  if (!perfil || perfil.ativo === false || !perfil.permission_profile_id) {
    return { status: "no-profile" };
  }

  // O embed vem como objeto ou array de um, dependendo de como o PostgREST
  // resolve a relação. Normaliza os dois casos.
  const bruto = perfil.permission_profiles as ProfileEmbed | ProfileEmbed[] | null;
  const embed = Array.isArray(bruto) ? (bruto[0] ?? null) : bruto;
  const fullAccess = embed?.full_access ?? false;

  // full_access dispensa carregar concessões — ele responde por tudo.
  const rows = fullAccess
    ? []
    : ((
        await supabase
          .from("permission_grants")
          .select("resource, action")
          .eq("profile_id", perfil.permission_profile_id)
      ).data ?? []);

  return {
    status: "ok",
    session: {
      userId: perfil.id as string,
      nome: perfil.nome as string,
      email: perfil.email as string,
      profileName: embed?.nome ?? null,
      perms: buildPermissionSet(fullAccess, rows)
    }
  };
});

/** Permissões de quem está logado, ou null se não houver sessão com perfil. */
export async function getSessionPermissions(): Promise<SessionPermissions | null> {
  const state = await getSessionState();
  return state.status === "ok" ? state.session : null;
}

/**
 * Porteiro para rotas de API. Uso:
 *   const auth = await requirePermission("configuracoes.permissoes", "edit");
 *   if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
 */
export async function requirePermission(
  resource: string,
  action: PermissionAction = "view"
): Promise<SessionPermissions | PermissionFailure> {
  const state = await getSessionState();
  if (state.status === "anon") return { error: "Não autenticado", status: 401 };
  if (state.status === "no-profile" || !can(state.session.perms, resource, action)) {
    return { error: "Você não tem permissão para esta ação", status: 403 };
  }
  return state.session;
}

/**
 * Porteiro das telas que não viram permissão configurável — só o perfil de
 * acesso total entra (ex.: Webhooks, que expõe o telefone de todos).
 */
export async function requireFullAccess(): Promise<SessionPermissions | PermissionFailure> {
  const state = await getSessionState();
  if (state.status === "anon") return { error: "Não autenticado", status: 401 };
  if (state.status === "no-profile" || !state.session.perms.fullAccess) {
    return { error: "Você não tem permissão para esta ação", status: 403 };
  }
  return state.session;
}

/**
 * Porteiro para páginas (server components). Sem sessão vai para o login; sem
 * permissão vai para a primeira tela que o perfil alcança, ou para /sem-acesso.
 */
export async function requirePageAccess(resource: string): Promise<SessionPermissions> {
  const state = await getSessionState();
  if (state.status === "anon") redirect("/login");
  if (state.status === "no-profile") redirect(NO_ACCESS_HREF);
  const { session } = state;
  if (!can(session.perms, resource, "view")) {
    redirect(firstAllowedHref(session.perms) ?? NO_ACCESS_HREF);
  }
  return session;
}

/** Conveniência: true/false, sem detalhe do motivo. */
export async function sessionCan(
  resource: string,
  action: PermissionAction = "view"
): Promise<boolean> {
  const session = await getSessionPermissions();
  return can(session?.perms, resource, action);
}
