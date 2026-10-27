import { ToolsView } from "@/components/tools/tools-view";
import { requirePageAccess } from "@/lib/permissions-server";

export default async function FerramentasPage() {
  await requirePageAccess("ferramentas");
  return <ToolsView />;
}
