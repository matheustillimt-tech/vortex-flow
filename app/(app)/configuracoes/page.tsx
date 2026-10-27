import { SettingsView } from "@/components/settings/settings-view";
import { requirePageAccess } from "@/lib/permissions-server";

// Libera a página para quem alcança pelo menos uma aba de Configurações; cada
// aba é filtrada pelo perfil dentro do SettingsView.
export default async function ConfiguracoesPage() {
  await requirePageAccess("configuracoes");
  return <SettingsView />;
}
