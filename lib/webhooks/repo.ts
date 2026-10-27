import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto";
import type { TaskPriority } from "@/lib/types";
import type { EntregaReservada, WebhookRepo } from "@/lib/webhooks/dispatch";

/** Implementação real do WebhookRepo. Recebe o cliente service role. */
export function criarRepoSupabase(admin: SupabaseClient): WebhookRepo {
  return {
    async lerConfig() {
      const { data } = await admin
        .from("webhook_config")
        .select("url, token, ativo")
        .eq("id", true)
        .maybeSingle();
      if (!data) return null;
      let token: string | null = null;
      try {
        token = decryptSecret(data.token as string | null);
      } catch (err) {
        console.error("[webhook] não foi possível descriptografar o token:", err);
        token = null;
      }
      return { url: (data.url as string | null) ?? null, token, ativo: !!data.ativo };
    },

    async reservarPendentes(limite) {
      const { data, error } = await admin.rpc("webhook_reservar_pendentes", { limite });
      if (error) throw new Error(error.message);
      return (data ?? []) as EntregaReservada[];
    },

    async carregarDados(e) {
      const [tarefa, pessoa, dados, quem] = await Promise.all([
        admin
          .from("tasks")
          .select("id, titulo, descricao, prioridade, prazo, prazo_has_time, projects(id, nome)")
          .eq("id", e.task_id)
          .maybeSingle(),
        admin.from("users").select("id, nome").eq("id", e.user_id).maybeSingle(),
        admin.from("colaborador_dados").select("whatsapp").eq("user_id", e.user_id).maybeSingle(),
        e.atribuido_por
          ? admin.from("users").select("nome").eq("id", e.atribuido_por).maybeSingle()
          : Promise.resolve({ data: null, error: null })
      ]);

      if (tarefa.error) throw new Error(tarefa.error.message);
      if (pessoa.error) throw new Error(pessoa.error.message);
      if (dados.error) throw new Error(dados.error.message);
      if (quem.error) throw new Error(quem.error.message);

      const t = tarefa.data as {
        id: string;
        titulo: string;
        descricao: string | null;
        prioridade: TaskPriority;
        prazo: string | null;
        prazo_has_time: boolean | null;
        projects: { id: string; nome: string } | { id: string; nome: string }[] | null;
      } | null;
      const p = pessoa.data as { id: string; nome: string } | null;
      if (!t || !p) return null;

      const whatsapp = (dados.data as { whatsapp: string | null } | null)?.whatsapp ?? null;
      if (!whatsapp) return "sem_telefone";

      const projeto = Array.isArray(t.projects) ? (t.projects[0] ?? null) : t.projects;
      return {
        responsavel: { id: p.id, nome: p.nome, whatsapp },
        tarefa: {
          id: t.id,
          titulo: t.titulo,
          descricao: t.descricao,
          prioridade: t.prioridade,
          prazo: t.prazo,
          prazoTemHora: t.prazo_has_time === true
        },
        projeto,
        atribuidoPorNome: (quem.data as { nome: string } | null)?.nome ?? null
      };
    },

    async finalizar(id, f) {
      const { error } = await admin.from("webhook_entregas").update(f).eq("id", id);
      if (error) throw new Error(error.message);
    }
  };
}
