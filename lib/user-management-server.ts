import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionPermissions } from "@/lib/permissions-server";
import { canManageTarget, FULL_ACCESS_TARGET_ERROR } from "@/lib/user-management";

type Embed = { full_access: boolean } | { full_access: boolean }[] | null;

const fullAccessDe = (embed: Embed) =>
  Array.isArray(embed) ? (embed[0]?.full_access ?? false) : (embed?.full_access ?? false);

/** Se a pessoa tem acesso total, ou null quando ela não existe. */
export async function userHasFullAccess(
  admin: SupabaseClient,
  userId: string
): Promise<boolean | null> {
  const { data } = await admin
    .from("users")
    .select("id, permission_profiles(full_access)")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return null;
  return fullAccessDe(data.permission_profiles as Embed);
}

/**
 * Aplica a regra de gestão sobre um alvo antes de uma ação sensível.
 * Devolve a resposta de recusa pronta, ou null quando pode seguir.
 */
export async function guardTargetUser(
  admin: SupabaseClient,
  actor: SessionPermissions,
  targetId: string
): Promise<NextResponse | null> {
  const alvoTotal = await userHasFullAccess(admin, targetId);
  if (alvoTotal === null) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }
  if (!canManageTarget(actor.perms.fullAccess, alvoTotal)) {
    return NextResponse.json({ error: FULL_ACCESS_TARGET_ERROR }, { status: 403 });
  }
  return null;
}
