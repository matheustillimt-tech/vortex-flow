import { redirect } from "next/navigation";
import { ShieldOff } from "lucide-react";
import { getSessionState } from "@/lib/permissions-server";
import { firstAllowedHref } from "@/lib/permissions";

// Destino de quem não tem nenhuma tela liberada. Esta página NUNCA chama
// requirePageAccess — é o fim da linha dos redirecionamentos, e chamá-la
// aqui criaria um laço.
export default async function SemAcessoPage() {
  const state = await getSessionState();
  if (state.status === "anon") redirect("/login");
  // Quem ganhou acesso depois não precisa ficar preso aqui.
  if (state.status === "ok") {
    const destino = firstAllowedHref(state.session.perms);
    if (destino) redirect(destino);
  }

  return (
    <div className="min-h-[calc(100vh-var(--topbar-h))] flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-3">
        <div className="mx-auto w-12 h-12 rounded-xl bg-bg-muted flex items-center justify-center">
          <ShieldOff className="w-6 h-6 text-fg-muted" />
        </div>
        <h1 className="text-lg font-semibold text-fg">Seu perfil ainda não tem acesso</h1>
        <p className="text-sm text-fg-muted">
          Nenhuma tela foi liberada para o seu perfil de permissão. Fale com um
          administrador para receber o acesso de que você precisa.
        </p>
      </div>
    </div>
  );
}
