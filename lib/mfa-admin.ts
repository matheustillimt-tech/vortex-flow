import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Remove todos os fatores de 2FA de uma pessoa (precisa do cliente com a
 * service role). Usado ao resetar a senha: sem isso, quem entra com a senha
 * temporária cai na troca de senha antes do código do 2FA e o Supabase recusa
 * a troca (erro AAL2). No próximo acesso a pessoa configura o 2FA de novo.
 */
export async function limparFatoresMfa(
  admin: SupabaseClient,
  userId: string
): Promise<void> {
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
  if (error) throw error;
  for (const f of data?.factors ?? []) {
    const { error: erroRemover } = await admin.auth.admin.mfa.deleteFactor({
      id: f.id,
      userId
    });
    if (erroRemover) throw erroRemover;
  }
}

/** Verdadeiro se a pessoa já tem um fator TOTP verificado no Supabase Auth. */
export async function temTotpVerificado(
  admin: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
  if (error) return false;
  return (data?.factors ?? []).some(
    (f) => f.factor_type === "totp" && f.status === "verified"
  );
}
