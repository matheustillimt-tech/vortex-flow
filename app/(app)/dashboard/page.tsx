import { DashboardView } from "@/components/dashboard/dashboard-view";
import { requirePageAccess } from "@/lib/permissions-server";

export default async function DashboardPage() {
  await requirePageAccess("dashboard");
  return <DashboardView />;
}
