import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { CadastroGate } from "@/components/colaboradores/cadastro-gate";
import { WhatsappBanner } from "@/components/colaboradores/whatsapp-banner";
import { PermissionsProvider } from "@/components/permissions/permissions-provider";
import { getSessionState } from "@/lib/permissions-server";
import { serializePermissions, type SerializedPermissions } from "@/lib/permissions";

const SEM_PERMISSOES: SerializedPermissions = { fullAccess: false, grants: [] };

export default async function AppLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [{ data: profile }, acesso, { data: dados }] = await Promise.all([
    supabase.from("users").select("*").eq("id", user.id).maybeSingle(),
    getSessionState(),
    supabase.from("colaborador_dados").select("whatsapp").eq("user_id", user.id).maybeSingle()
  ]);
  // Sem perfil ou inativo: menu vazio; cada página redireciona para /sem-acesso.
  const sessao = acesso.status === "ok" ? acesso.session : null;
  const semWhatsapp = profile?.cadastro_completo === true && !dados?.whatsapp;

  return (
    <PermissionsProvider
      value={sessao ? serializePermissions(sessao.perms) : SEM_PERMISSOES}
    >
      <div className="min-h-screen flex bg-bg">
        <Sidebar
          userName={profile?.nome ?? user.email ?? "Usuário"}
          userEmail={user.email ?? ""}
          avatarUrl={profile?.avatar_url ?? null}
          profileName={sessao?.profileName ?? null}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar />
          <WhatsappBanner userId={user.id} show={semWhatsapp} />
          <main className="flex-1 overflow-auto">{children}</main>
        </div>

        {/* Popup obrigatório de cadastro (financeiro) — só aparece pra quem
            ainda não preencheu. */}
        <CadastroGate pending={profile?.cadastro_completo === false} />
      </div>
    </PermissionsProvider>
  );
}
