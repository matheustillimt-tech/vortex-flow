import { createClient } from "@supabase/supabase-js";
import { cleanEnv } from "@/lib/env";

/**
 * Cliente Supabase usando service_role.
 * Usar APENAS em rotas /api/* (server side).
 */
export function createAdminClient() {
  const url = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY ausente — defina nas variáveis de ambiente."
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
