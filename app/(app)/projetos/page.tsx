import { ProjectsView } from "@/components/projects/projects-view";
import { requirePageAccess } from "@/lib/permissions-server";

export default async function ProjetosPage() {
  await requirePageAccess("projetos");
  return <ProjectsView />;
}
