"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Plug,
  MessageSquare,
  Settings,
  User,
  Users,
  Wrench
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { warmCache } from "@/lib/cache";
import { cn, initials } from "@/lib/utils";
import { can, type PermissionSet } from "@/lib/permissions";
import { usePermissions } from "@/components/permissions/permissions-provider";
import { APP_NAME } from "@/lib/brand";

// Cada item aponta para um recurso do catálogo (lib/permissions.ts): o menu
// mostra só o que o perfil de quem está logado alcança.
const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, resource: "dashboard" },
  { href: "/projetos", label: "Projetos", icon: FolderKanban, resource: "projetos" },
  { href: "/minha-area", label: "Minhas Tarefas", icon: User, resource: "minhas-tarefas" },
  { href: "/tarefas", label: "Todas as tarefas", icon: ListChecks, resource: "tarefas" },
  { href: "/ferramentas", label: "Ferramentas", icon: Wrench, resource: "ferramentas" },
  { href: "/chat", label: "Chat", icon: MessageSquare, resource: "chat" },
  { href: "/colaboradores", label: "Colaboradores", icon: Users, resource: "colaboradores" }
];

/** Itens do menu que o perfil alcança, na ordem do menu. */
export function visibleNav(perms: PermissionSet | null) {
  return NAV.filter((item) => can(perms, item.resource));
}

const COLLAPSED_KEY = "vortex-sidebar-collapsed";

interface SidebarProps {
  userName: string;
  userEmail: string;
  avatarUrl: string | null;
  /** Nome do perfil de permissão, exibido no menu do usuário. */
  profileName: string | null;
}

export function Sidebar({ userName, userEmail, avatarUrl, profileName }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [profileOpen, setProfileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Carrega preferência do localStorage no mount + aquece cache
  useEffect(() => {
    if (typeof window === "undefined") return;
    setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
    // Pré-aquece users/projects/sectors em paralelo enquanto o usuário
    // ainda está olhando a primeira tela. Próximas trocas de aba ficam
    // instantâneas (cache em memória válido por 60s).
    warmCache();
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    setProfileOpen(false);
    if (typeof window !== "undefined") {
      if (next) localStorage.setItem(COLLAPSED_KEY, "1");
      else localStorage.removeItem(COLLAPSED_KEY);
    }
  }

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setProfileOpen(false);
    }
    if (profileOpen) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [profileOpen]);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const perms = usePermissions();
  const canSettings = can(perms, "configuracoes");

  return (
    <aside
      className={cn(
        // sticky + h-screen: o rodapé (perfil/config) fica SEMPRE visível,
        // mesmo em páginas altas que fazem o documento crescer.
        "shrink-0 border-r border-border bg-bg-subtle/50 flex flex-col relative transition-[width] duration-300 ease-in-out sticky top-0 h-screen",
        collapsed ? "w-[68px]" : "w-60"
      )}
    >
      {/* Botão flutuante de toggle */}
      <button
        onClick={toggleCollapsed}
        title={collapsed ? "Expandir menu" : "Recolher menu"}
        className="absolute -right-3 top-7 z-30 w-6 h-6 rounded-full bg-bg-subtle border border-border shadow-sm flex items-center justify-center hover:bg-bg-muted hover:border-border-strong transition"
      >
        {collapsed ? (
          <ChevronRight className="w-3.5 h-3.5 text-fg-muted" />
        ) : (
          <ChevronLeft className="w-3.5 h-3.5 text-fg-muted" />
        )}
      </button>

      <div
        className={cn(
          // Mesma altura do Topbar (--topbar-h) para que as duas bordas
          // inferiores formem uma linha contínua na largura da tela.
          "h-[var(--topbar-h)] shrink-0 flex items-center border-b border-border transition-all duration-300",
          collapsed ? "px-3 justify-center" : "px-4 gap-2.5"
        )}
      >
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand to-brand-hover flex items-center justify-center shadow-lg shadow-brand/40 shrink-0">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="w-[22px] h-[22px] text-white"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M12 2L3 7l9 5 9-5-9-5zm0 7L3 14l9 5 9-5-9-5zm0 7l-9-5v3l9 5 9-5v-3l-9 5z"
              fill="currentColor"
            />
          </svg>
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            {/* text-transparent + bg-clip-text: o degradê vira o preenchimento
                das letras. Usa os tokens de brand, então acompanha o tema. */}
            <p className="text-xl font-extrabold tracking-tight whitespace-nowrap bg-gradient-to-r from-brand to-brand-hover bg-clip-text text-transparent">
              {APP_NAME}
            </p>
          </div>
        )}
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto px-2 py-4 space-y-0.5">
        {visibleNav(perms).map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg text-sm transition-colors relative",
                collapsed ? "px-2.5 py-2 justify-center" : "px-3 py-2",
                active
                  ? "bg-brand-subtle text-brand font-medium"
                  : "text-fg-muted hover:bg-bg-muted hover:text-fg"
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {!collapsed && (
                <span className="overflow-hidden whitespace-nowrap">
                  {item.label}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div ref={wrapRef} className="border-t border-border p-2 space-y-0.5 relative">
        {profileOpen && !collapsed && (
          <div className="absolute bottom-full left-2 right-2 mb-2 bg-bg-subtle border border-border rounded-xl shadow-2xl overflow-hidden z-30 animate-fadeIn">
            <div className="px-3 py-2.5 border-b border-border">
              <p className="text-sm font-medium truncate">{userName}</p>
              <p className="text-xs text-fg-subtle truncate">{userEmail}</p>
              <p className="text-[10px] uppercase tracking-wider text-fg-subtle mt-1">
                {profileName ?? "Sem perfil"}
              </p>
            </div>
            <Link
              href="/conector"
              onClick={() => setProfileOpen(false)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-fg-muted hover:bg-bg-muted hover:text-fg transition"
            >
              <Plug className="w-3.5 h-3.5" /> Conector do Claude
            </Link>
            <button
              onClick={signOut}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-fg-muted hover:bg-bg-muted hover:text-fg transition border-t border-border"
            >
              <LogOut className="w-3.5 h-3.5" /> Sair
            </button>
          </div>
        )}

        {collapsed ? (
          <div className="flex flex-col items-center gap-1">
            <button
              onClick={() => signOut()}
              title={`Sair (${userName})`}
              className="relative group"
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={userName}
                  className="w-9 h-9 rounded-full object-cover border border-border"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-brand/20 text-brand flex items-center justify-center text-[11px] font-bold uppercase">
                  {initials(userName)}
                </div>
              )}
            </button>
            {canSettings && (
              <Link
                href="/configuracoes"
                title="Configurações"
                className={cn(
                  "p-2 rounded-lg transition",
                  pathname.startsWith("/configuracoes")
                    ? "bg-brand-subtle text-brand"
                    : "text-fg-muted hover:bg-bg-muted hover:text-fg"
                )}
              >
                <Settings className="w-4 h-4" />
              </Link>
            )}
          </div>
        ) : (
          <>
            <button
              onClick={() => setProfileOpen((v) => !v)}
              className={cn(
                "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition",
                profileOpen
                  ? "bg-bg-muted"
                  : "hover:bg-bg-muted text-fg-muted hover:text-fg"
              )}
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={userName}
                  className="w-7 h-7 rounded-full object-cover border border-border shrink-0"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-brand/20 text-brand flex items-center justify-center text-[10px] font-bold uppercase shrink-0">
                  {initials(userName)}
                </div>
              )}
              <div className="flex-1 text-left min-w-0">
                <p className="text-xs font-medium truncate text-fg">{userName}</p>
                <p className="text-[10px] text-fg-subtle truncate">{userEmail}</p>
              </div>
              <ChevronDown
                className={cn(
                  "w-3.5 h-3.5 text-fg-subtle transition",
                  profileOpen && "rotate-180"
                )}
              />
            </button>

            {canSettings && (
              <Link
                href="/configuracoes"
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                  pathname.startsWith("/configuracoes")
                    ? "bg-brand-subtle text-brand font-medium"
                    : "text-fg-muted hover:bg-bg-muted hover:text-fg"
                )}
              >
                <Settings className="w-4 h-4" />
                Configurações
              </Link>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
