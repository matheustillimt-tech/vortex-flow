/**
 * Helpers para registrar atividades de auditoria a partir das rotas /api.
 * Captura IP, user-agent, e tenta resolver geolocalização via ipapi.co.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export type ActivityAction =
  | "tools_page_open"
  | "tool_view_attempt"
  | "tool_view_success"
  | "tool_view_failed_totp"
  | "tool_created"
  | "tool_updated"
  | "tool_deleted"
  | "tool_users_changed"
  | "webhook_updated";

interface LogInput {
  user_id: string | null;
  user_nome?: string | null;
  user_email?: string | null;
  action: ActivityAction;
  tool_id?: string | null;
  tool_nome?: string | null;
  request: Request;
  /** Coordenadas vindas do browser (mais precisas que IP) */
  client_latitude?: number | null;
  client_longitude?: number | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Extrai o IP "real" do cliente das headers usuais
 * (x-forwarded-for, x-real-ip, cf-connecting-ip).
 */
export function getClientIp(req: Request): string | null {
  const h = req.headers;
  const xff = h.get("x-forwarded-for");
  if (xff) {
    // primeiro IP da lista
    return xff.split(",")[0].trim() || null;
  }
  return (
    h.get("x-real-ip") ||
    h.get("cf-connecting-ip") ||
    h.get("x-vercel-forwarded-for") ||
    null
  );
}

interface GeoResult {
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Resolve geolocalização aproximada a partir do IP via ipapi.co (free tier).
 * Retorna null em qualquer falha — log nunca deve falhar por causa disso.
 */
export async function geolocateIp(ip: string | null): Promise<GeoResult> {
  const empty: GeoResult = {
    country: null,
    region: null,
    city: null,
    latitude: null,
    longitude: null
  };
  if (!ip) return empty;
  // IPs locais não têm geo
  if (
    ip === "::1" ||
    ip === "127.0.0.1" ||
    ip.startsWith("192.168.") ||
    ip.startsWith("10.") ||
    ip.startsWith("172.")
  ) {
    return empty;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      headers: { "user-agent": "vortex-flow-audit/1.0" },
      signal: ctrl.signal,
      cache: "no-store"
    });
    clearTimeout(t);
    if (!res.ok) return empty;
    const j = (await res.json()) as {
      country_name?: string;
      region?: string;
      city?: string;
      latitude?: number;
      longitude?: number;
      error?: boolean;
    };
    if (j.error) return empty;
    return {
      country: j.country_name ?? null,
      region: j.region ?? null,
      city: j.city ?? null,
      latitude: typeof j.latitude === "number" ? j.latitude : null,
      longitude: typeof j.longitude === "number" ? j.longitude : null
    };
  } catch {
    return empty;
  }
}

/**
 * Registra uma atividade. Nunca lança — falha silenciosamente para
 * não bloquear o request principal.
 */
export async function logActivity(input: LogInput): Promise<void> {
  const ip = getClientIp(input.request);
  const ua = input.request.headers.get("user-agent");
  // Se vieram coords do navegador, prioriza; senão tenta IP.
  let lat = input.client_latitude ?? null;
  let lng = input.client_longitude ?? null;
  let geo: GeoResult = {
    country: null,
    region: null,
    city: null,
    latitude: null,
    longitude: null
  };
  if (lat == null || lng == null) {
    geo = await geolocateIp(ip);
    if (lat == null) lat = geo.latitude;
    if (lng == null) lng = geo.longitude;
  } else {
    // Mesmo com coords precisas do browser, tenta enriquecer city/country
    geo = await geolocateIp(ip);
  }
  try {
    const admin = createAdminClient();
    await admin.from("activity_logs").insert({
      user_id: input.user_id,
      user_nome: input.user_nome ?? null,
      user_email: input.user_email ?? null,
      action: input.action,
      tool_id: input.tool_id ?? null,
      tool_nome: input.tool_nome ?? null,
      ip_address: ip,
      user_agent: ua,
      country: geo.country,
      region: geo.region,
      city: geo.city,
      latitude: lat,
      longitude: lng,
      metadata: input.metadata ?? null
    });
  } catch {
    /* nunca propaga */
  }
}
