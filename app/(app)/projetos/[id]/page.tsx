import { ProjectView } from "@/components/projects/project-view";
import { requirePageAccess } from "@/lib/permissions-server";

// A guarda confere se o perfil alcança Projetos (consulta memoizada com a do
// layout, sem custo extra). Qual projeto a pessoa vê continua sendo decidido
// pela RLS: sem acesso ao projeto, ProjectView mostra "Projeto não encontrado".
export default async function ProjectPage({ params }: { params: { id: string } }) {
  await requirePageAccess("projetos");
  return <ProjectView projectId={params.id} />;
}
