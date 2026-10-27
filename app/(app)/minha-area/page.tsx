import { Suspense } from "react";
import { MyAreaView } from "@/components/my-area/my-area-view";
import { requirePageAccess } from "@/lib/permissions-server";

export default async function MinhaAreaPage() {
  await requirePageAccess("minhas-tarefas");
  return (
    <Suspense fallback={null}>
      <MyAreaView />
    </Suspense>
  );
}
