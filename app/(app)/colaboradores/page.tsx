import { ColaboradoresView } from "@/components/colaboradores/colaboradores-view";
import { requirePageAccess } from "@/lib/permissions-server";

// Dados sensíveis (CPF, PIX, endereço). A RLS de colaborador_dados protege no
// banco; esta guarda impede abrir a tela sem o perfil liberar.
export default async function ColaboradoresPage() {
  await requirePageAccess("colaboradores");
  return <ColaboradoresView />;
}
