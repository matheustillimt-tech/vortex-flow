import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions-server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * GET /api/admin/activity-logs?limit=200&action=...&user_id=...&tool_id=...&from=ISO&to=ISO
 * Lista entradas do log para o admin.
 */
export async function GET(req: Request) {
  const auth = await requirePermission("configuracoes.atividades", "view");
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "200", 10), 1000);
  const action = url.searchParams.get("action");
  const userId = url.searchParams.get("user_id");
  const toolId = url.searchParams.get("tool_id");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const admin = createAdminClient();
  let q = admin
    .from("activity_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (action) q = q.eq("action", action);
  if (userId) q = q.eq("user_id", userId);
  if (toolId) q = q.eq("tool_id", toolId);
  if (from) q = q.gte("created_at", from);
  if (to) q = q.lte("created_at", to);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ logs: data ?? [] });
}
