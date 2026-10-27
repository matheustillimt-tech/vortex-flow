/**
 * Regras de gestão de membros, compartilhadas entre as rotas e a tela de equipe.
 */

/** Recusa padrão quando alguém sem acesso total tenta mexer em quem tem. */
export const FULL_ACCESS_TARGET_ERROR =
  "Só quem tem acesso total pode alterar, resetar ou excluir alguém com acesso total.";

/**
 * Delegar a gestão da equipe não pode abrir caminho para escalada: quem não tem
 * acesso total poderia resetar a senha de um Super Admin e entrar como ele.
 */
export function canManageTarget(actorFullAccess: boolean, targetFullAccess: boolean): boolean {
  return actorFullAccess || !targetFullAccess;
}

export interface UserPatch {
  nome?: string;
  cargo?: string | null;
  setor_principal_id?: string | null;
  ativo?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Filtra o corpo de PATCH /api/usuarios/[id] para os campos que a gestão de equipe
 * pode alterar. Perfil, role e e-mail ficam de fora de propósito: têm rotas e
 * guardas próprias.
 */
export function sanitizeUserPatch(input: unknown): { patch: UserPatch } | { error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Corpo inválido" };
  }
  const body = input as Record<string, unknown>;
  const patch: UserPatch = {};

  if ("nome" in body) {
    if (typeof body.nome !== "string" || !body.nome.trim()) {
      return { error: "O nome não pode ficar vazio" };
    }
    patch.nome = body.nome.trim();
  }
  if ("cargo" in body) {
    if (body.cargo !== null && typeof body.cargo !== "string") {
      return { error: "Cargo inválido" };
    }
    patch.cargo = typeof body.cargo === "string" && body.cargo.trim() ? body.cargo.trim() : null;
  }
  if ("setor_principal_id" in body) {
    const setor = body.setor_principal_id;
    if (setor !== null && (typeof setor !== "string" || !UUID.test(setor))) {
      return { error: "Setor inválido" };
    }
    patch.setor_principal_id = setor as string | null;
  }
  if ("ativo" in body) {
    if (typeof body.ativo !== "boolean") return { error: "Status inválido" };
    patch.ativo = body.ativo;
  }

  if (!Object.keys(patch).length) return { error: "Nada para alterar" };
  return { patch };
}
