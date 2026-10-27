/**
 * Catálogo de permissões do sistema.
 *
 * Este arquivo é a fonte única de verdade sobre O QUE pode ser permissionado.
 * O banco guarda apenas as concessões (perfil × recurso × ação); os nomes e a
 * hierarquia vivem aqui, para que renomear um menu não exija migration.
 *
 * Duas camadas convivem, de propósito:
 *
 *  - `full_access` / `can_manage` no perfil são as capacidades herdadas que
 *    sustentam a RLS no banco (antes vinham do enum user_role). São grossas.
 *  - As concessões abaixo são finas e valem na aplicação: quais menus, abas e
 *    ações a pessoa alcança.
 */

export type PermissionAction = "view" | "create" | "edit" | "delete";

export const PERMISSION_ACTION_LABEL: Record<PermissionAction, string> = {
  view: "Ver",
  create: "Criar",
  edit: "Editar",
  delete: "Excluir"
};

export interface PermissionResource {
  /** Identificador gravado no banco. Nunca renomear sem migration de dados. */
  key: string;
  label: string;
  /** Rota que este recurso protege, quando é um item de menu ou uma página. */
  href?: string;
  /** Ações que fazem sentido para este recurso. `view` é sempre a primeira. */
  actions: PermissionAction[];
  /** Recursos aninhados (abas dentro de um menu). */
  children?: PermissionResource[];
}

/**
 * Ordem aqui é a ordem exibida na tela de perfis.
 * `key` espelha a navegação: "configuracoes.setores" é a aba Setores.
 */
export const PERMISSION_CATALOG: PermissionResource[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", actions: ["view"] },
  {
    key: "projetos",
    label: "Projetos",
    href: "/projetos",
    actions: ["view", "create", "edit", "delete"]
  },
  {
    key: "minhas-tarefas",
    label: "Minhas Tarefas",
    href: "/minha-area",
    actions: ["view"]
  },
  {
    key: "tarefas",
    label: "Todas as tarefas",
    href: "/tarefas",
    actions: ["view", "create", "edit", "delete"]
  },
  {
    key: "ferramentas",
    label: "Ferramentas",
    href: "/ferramentas",
    actions: ["view", "create", "edit", "delete"]
  },
  { key: "chat", label: "Chat", href: "/chat", actions: ["view"] },
  {
    key: "colaboradores",
    label: "Colaboradores",
    href: "/colaboradores",
    actions: ["view", "create", "edit", "delete"]
  },
  {
    key: "configuracoes",
    label: "Configurações",
    href: "/configuracoes",
    actions: ["view"],
    children: [
      { key: "configuracoes.perfil", label: "Perfil", actions: ["view", "edit"] },
      {
        key: "configuracoes.setores",
        label: "Setores",
        actions: ["view", "create", "edit", "delete"]
      },
      {
        key: "configuracoes.time",
        label: "Time & Permissões",
        actions: ["view", "create", "edit", "delete"]
      },
      {
        key: "configuracoes.permissoes",
        label: "Perfis de Permissão",
        actions: ["view", "create", "edit", "delete"]
      },
      {
        key: "configuracoes.atividades",
        label: "Registro de atividades",
        actions: ["view"]
      }
    ]
  }
];

/** Achata o catálogo (pais e filhos) numa lista única. */
export function flattenCatalog(
  nodes: PermissionResource[] = PERMISSION_CATALOG
): PermissionResource[] {
  return nodes.flatMap((n) => [n, ...flattenCatalog(n.children ?? [])]);
}

/** Todas as chaves válidas — usado para descartar concessões órfãs. */
export function allResourceKeys(): Set<string> {
  return new Set(flattenCatalog().map((r) => r.key));
}

export function findResource(key: string): PermissionResource | undefined {
  return flattenCatalog().find((r) => r.key === key);
}

/** "configuracoes.setores" → "configuracoes". Raiz devolve undefined. */
export function parentKey(key: string): string | undefined {
  const i = key.lastIndexOf(".");
  return i === -1 ? undefined : key.slice(0, i);
}

/** Uma concessão, no formato "recurso:ação". */
export type Grant = `${string}:${PermissionAction}`;

export function grantKey(resource: string, action: PermissionAction): Grant {
  return `${resource}:${action}`;
}

/**
 * O conjunto de permissões efetivas de alguém.
 * `fullAccess` curto-circuita tudo — é o Super Admin.
 */
export interface PermissionSet {
  fullAccess: boolean;
  grants: Set<string>;
}

export function can(
  perms: PermissionSet | null | undefined,
  resource: string,
  action: PermissionAction = "view"
): boolean {
  if (!perms) return false;
  if (perms.fullAccess) return true;
  if (perms.grants.has(grantKey(resource, action))) return true;
  // Ver um filho implica alcançar o pai: quem vê "configuracoes.setores"
  // precisa conseguir abrir "configuracoes" para chegar lá.
  if (action === "view") {
    return [...perms.grants].some(
      (g) => g.endsWith(":view") && parentKey(g.slice(0, -":view".length)) === resource
    );
  }
  return false;
}

/**
 * Sanea concessões vindas do cliente antes de gravar.
 *
 * Recebe strings "recurso:ação" e devolve só as que existem no catálogo, com
 * ação do vocabulário conhecido e sem duplicatas. Entrada malformada vira lista
 * vazia em vez de erro — isto é fronteira de confiança, não validação de forma.
 */
export function sanitizeGrants(
  input: unknown
): Array<{ resource: string; action: PermissionAction }> {
  if (!Array.isArray(input)) return [];
  const validos = allResourceKeys();
  const acoes = new Set<string>(Object.keys(PERMISSION_ACTION_LABEL));
  const vistos = new Set<string>();
  const saida: Array<{ resource: string; action: PermissionAction }> = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    const sep = item.lastIndexOf(":");
    if (sep === -1) continue;
    const resource = item.slice(0, sep);
    const action = item.slice(sep + 1);
    if (!validos.has(resource) || !acoes.has(action)) continue;
    if (vistos.has(item)) continue;
    vistos.add(item);
    saida.push({ resource, action: action as PermissionAction });
  }
  return saida;
}

/** Monta um PermissionSet a partir do que veio do banco. */
export function buildPermissionSet(
  fullAccess: boolean,
  rows: Array<{ resource: string; action: string }>
): PermissionSet {
  const valid = allResourceKeys();
  return {
    fullAccess,
    grants: new Set(
      rows
        .filter((r) => valid.has(r.resource))
        .map((r) => `${r.resource}:${r.action}`)
    )
  };
}

// ---------------------------------------------------------------- navegação

/** Para onde vai quem não tem nenhuma tela liberada. Nunca é bloqueada. */
export const NO_ACCESS_HREF = "/sem-acesso";

/** Primeira tela do menu, na ordem do catálogo, que o perfil alcança. */
export function firstAllowedHref(
  perms: PermissionSet | null | undefined
): string | null {
  for (const r of PERMISSION_CATALOG) {
    if (r.href && can(perms, r.key, "view")) return r.href;
  }
  return null;
}

/** Forma que atravessa do servidor para o cliente (Set não serializa). */
export interface SerializedPermissions {
  fullAccess: boolean;
  grants: string[];
}

export function serializePermissions(p: PermissionSet): SerializedPermissions {
  return { fullAccess: p.fullAccess, grants: [...p.grants].sort() };
}

export function deserializePermissions(s: SerializedPermissions): PermissionSet {
  return { fullAccess: s.fullAccess, grants: new Set(s.grants) };
}
