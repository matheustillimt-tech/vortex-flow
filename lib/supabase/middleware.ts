import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cleanEnv } from "@/lib/env";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { temTotpVerificado } from "@/lib/mfa-admin";

// Cache local das flags em cookies httpOnly por 5 min. Elimina a query no
// banco a cada navegação — a verificação só roda depois de expirar (ou após
// trocar senha / ativar 2FA, que limpam o cookie no client).
const FLAGS_COOKIE = "vf-flags";
const FLAGS_TTL_SECONDS = 300; // 5 minutos

/**
 * Endpoints públicos da API: NÃO redirecionar pra /login (devolveriam um
 * 307 HTML, quebrando o fetch). Cada um faz sua própria validação por dentro.
 */
export function isPublicApiPath(pathname: string): boolean {
  return (
    pathname === "/api/usuarios/forgot-password" ||
    pathname === "/api/usuarios/reset-with-code" ||
    pathname === "/api/usuarios/me/password-changed" ||
    // Conector MCP: autentica pelo token pessoal na própria URL, não por
    // sessão de navegador. Um 307 aqui quebraria o handshake do Claude.
    pathname.startsWith("/api/mcp/") ||
    // Chamada do banco (pg_net), sem sessão: protegida por x-dispatch-secret.
    pathname === "/api/webhooks/despachar"
  );
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        }
      }
    }
  );

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthRoute =
    pathname === "/login" ||
    pathname === "/forgot-password" ||
    pathname.startsWith("/auth");
  const isChangePw = pathname === "/trocar-senha";
  const isTwoFactor = pathname.startsWith("/seguranca/2fa");
  // /auth/reset-password é especial: usuário CHEGA logado (via magic link)
  // e precisa trocar a senha antes de qualquer outro fluxo. NÃO redireciona
  // pra dashboard mesmo já estando autenticado.
  const isResetPassword = pathname.startsWith("/auth/reset-password");
  const isPublicApi = isPublicApiPath(pathname);

  if (!user && !isAuthRoute && !isPublicApi) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute && !isResetPassword) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Reset password: usuário acabou de chegar via magic link de recovery.
  // Deixa ele trocar a senha em paz, sem checar flags/redirect pra 2FA.
  if (isResetPassword) {
    return response;
  }

  if (user && !isAuthRoute) {
    // Tenta usar o cache de flags em cookie (rápido, sem hit no banco).
    const cached = request.cookies.get(FLAGS_COOKIE)?.value;
    let pwChanged: boolean | null = null;
    let mfaEnabled: boolean | null = null;
    if (cached) {
      // formato: "p1m1" / "p0m1" / "p1m0" etc
      pwChanged = cached.includes("p1");
      mfaEnabled = cached.includes("m1");
    }

    if (pwChanged === null || mfaEnabled === null) {
      const { data: profile } = await supabase
        .from("users")
        .select("password_changed, mfa_enabled")
        .eq("id", user.id)
        .maybeSingle();
      pwChanged = !!profile?.password_changed;
      mfaEnabled = !!profile?.mfa_enabled;
      // Set cookie só se ambas são true (caso negativo, queremos
      // re-verificar logo após a ação que muda a flag).
      if (pwChanged && mfaEnabled) {
        response.cookies.set(FLAGS_COOKIE, "p1m1", {
          httpOnly: false, // client pode limpar após trocar senha / ativar 2FA
          sameSite: "lax",
          path: "/",
          maxAge: FLAGS_TTL_SECONDS
        });
      }
    }

    // 1) Força troca de senha antes de qualquer outra coisa
    if (!pwChanged && !isChangePw) {
      const url = request.nextUrl.clone();
      url.pathname = "/trocar-senha";
      return NextResponse.redirect(url);
    }

    // 2) Após senha trocada, força enrollment de 2FA se ainda não tem.
    //    ANTES de redirecionar, fazemos uma checagem de realidade contra o
    //    Supabase Auth: se a pessoa JÁ tem um factor TOTP verificado lá
    //    (mas a flag na tabela ficou false por sync que falhou), liberamos
    //    a passagem e curamos a flag — caso contrário o usuário ficaria
    //    preso no loop.
    if (pwChanged && !mfaEnabled && !isTwoFactor && !isChangePw) {
      const healed = await healMfaIfFactorVerified(user.id, response);
      if (!healed) {
        const url = request.nextUrl.clone();
        url.pathname = "/seguranca/2fa";
        return NextResponse.redirect(url);
      }
      // healed=true → o usuário tinha factor verificado; permite passagem.
    }
  }

  return response;
}

/**
 * Se o usuário tiver um factor TOTP verificado no Supabase Auth, atualiza
 * public.users.mfa_enabled=true via service_role e atualiza o cookie de
 * cache. Retorna true se curou, false caso contrário.
 *
 * Falha silenciosamente em qualquer erro (não bloqueia o request).
 */
async function healMfaIfFactorVerified(
  userId: string,
  response: NextResponse
): Promise<boolean> {
  const url = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceKey = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceKey) return false;
  try {
    const admin = createAdminClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    if (!(await temTotpVerificado(admin, userId))) return false;

    // Cura a flag em public.users
    await admin.from("users").update({ mfa_enabled: true }).eq("id", userId);

    // Atualiza cookie pro middleware reconhecer no próximo hit
    response.cookies.set("vf-flags", "p1m1", {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAge: 300
    });
    return true;
  } catch {
    return false;
  }
}
