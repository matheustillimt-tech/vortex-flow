import { AllTasksView } from "@/components/tasks/all-tasks-view";
import { requirePageAccess } from "@/lib/permissions-server";

// A guarda confere se o perfil alcança Todas as tarefas. A RLS segue filtrando
// quais tarefas aparecem (usuários restritos só veem os projetos deles).
export default async function TarefasPage() {
  await requirePageAccess("tarefas");
  return <AllTasksView />;
}
