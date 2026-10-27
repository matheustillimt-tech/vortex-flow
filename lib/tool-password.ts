/**
 * O que uma edição de ferramenta faz com a senha salva.
 *
 * Quem gere ferramentas sem acesso total não vê a senha atual, então o campo
 * chega vazio no formulário. Por isso, em branco significa "não alterar": sem
 * essa regra, editar só o nome apagaria a senha. Remover a senha exige pedir
 * isso explicitamente (null) e ter acesso total.
 */
export type PasswordChange =
  | { kind: "keep" }
  | { kind: "set"; value: string }
  | { kind: "clear" };

export function resolvePasswordChange(
  input: unknown,
  actorFullAccess: boolean
): PasswordChange | { error: string; status: 400 | 403 } {
  if (input === undefined || input === "") return { kind: "keep" };
  if (input === null) {
    return actorFullAccess
      ? { kind: "clear" }
      : {
          error: "Só quem tem acesso total pode remover a senha de uma ferramenta.",
          status: 403
        };
  }
  if (typeof input !== "string") return { error: "Senha inválida", status: 400 };
  // Não apara: espaços podem fazer parte da senha.
  return { kind: "set", value: input };
}
