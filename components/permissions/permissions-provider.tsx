"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  can,
  deserializePermissions,
  type PermissionAction,
  type PermissionSet,
  type SerializedPermissions
} from "@/lib/permissions";

/**
 * Permissões de quem está logado, disponíveis a qualquer componente cliente.
 *
 * O valor vem do servidor (app/(app)/layout.tsx). Serve para ESCONDER o que o
 * perfil não alcança — quem impede o acesso de fato são requirePageAccess() e
 * requirePermission() no servidor.
 */
const PermissionsContext = createContext<PermissionSet | null>(null);

export function PermissionsProvider({
  value,
  children
}: {
  value: SerializedPermissions;
  children: ReactNode;
}) {
  const perms = useMemo(() => deserializePermissions(value), [value]);
  return (
    <PermissionsContext.Provider value={perms}>{children}</PermissionsContext.Provider>
  );
}

/** Conjunto de permissões atual, ou null fora do provedor. */
export function usePermissions(): PermissionSet | null {
  return useContext(PermissionsContext);
}

/** `useCan("tarefas", "delete")` — para mostrar ou esconder um botão. */
export function useCan(resource: string, action: PermissionAction = "view"): boolean {
  return can(useContext(PermissionsContext), resource, action);
}
