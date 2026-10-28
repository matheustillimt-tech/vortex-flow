"use client";

import { useState } from "react";
import {
  Layers,
  ScrollText,
  Settings as SettingsIcon,
  ShieldCheck,
  User,
  MessageCircle
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ProfileTab } from "@/components/settings/profile-tab";
import { TeamTab } from "@/components/settings/team-tab";
import { SectorsView } from "@/components/sectors/sectors-view";
import { ActivityLogsView } from "@/components/admin/activity-logs-view";
import { usePermissions } from "@/components/permissions/permissions-provider";
import { can } from "@/lib/permissions";
import { PermissionProfilesTab } from "@/components/settings/permission-profiles-tab";
import { WebhooksTab } from "@/components/settings/webhooks-tab";

type Tab = "perfil" | "setores" | "time" | "permissoes" | "atividades" | "webhooks";

const TABS: {
  id: Tab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Recurso do catálogo que libera a aba. */
  resource: string;
  /** Só para o perfil de acesso total — não vira permissão configurável. */
  fullAccessOnly?: boolean;
}[] = [
  { id: "perfil", label: "Perfil", icon: User, resource: "configuracoes.perfil" },
  { id: "setores", label: "Setores", icon: Layers, resource: "configuracoes.setores" },
  { id: "time", label: "Time & Permissões", icon: SettingsIcon, resource: "configuracoes.time" },
  {
    id: "permissoes",
    label: "Perfis de Permissão",
    icon: ShieldCheck,
    resource: "configuracoes.permissoes"
  },
  {
    id: "atividades",
    label: "Registro de atividades",
    icon: ScrollText,
    resource: "configuracoes.atividades"
  },
  {
    id: "webhooks",
    label: "Avisos no WhatsApp",
    icon: MessageCircle,
    resource: "configuracoes",
    fullAccessOnly: true
  }
];

export function SettingsView() {
  const perms = usePermissions();
  const tabs = TABS.filter((t) =>
    t.fullAccessOnly ? (perms?.fullAccess ?? false) : can(perms, t.resource)
  );
  const [escolhida, setTab] = useState<Tab | null>(null);
  // Aba ativa: a escolhida, se o perfil ainda a alcança; senão a primeira permitida.
  const tab = tabs.some((t) => t.id === escolhida) ? escolhida : (tabs[0]?.id ?? null);

  return (
    <>
      <PageHeader
        title="Configurações"
        subtitle="Perfil, setores, equipe, permissões e integrações."
      />

      <div className="px-6 pt-3 border-b border-border">
        <div className="flex gap-1 -mb-px">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition inline-flex items-center gap-2 ${
                  tab === t.id
                    ? "border-brand text-fg"
                    : "border-transparent text-fg-muted hover:text-fg"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="settings-tab-wrapper">
        {tabs.length === 0 && (
          <p className="p-6 text-sm text-fg-muted">
            Seu perfil não tem acesso a nenhuma aba de Configurações.
          </p>
        )}
        {tab === "perfil" && <ProfileTab />}
        {tab === "setores" && <SectorsView headerless />}
        {tab === "time" && <TeamTab />}
        {tab === "permissoes" && <PermissionProfilesTab />}
        {tab === "atividades" && <ActivityLogsView headerless />}
        {tab === "webhooks" && <WebhooksTab />}
      </div>
    </>
  );
}
