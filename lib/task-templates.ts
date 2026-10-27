import { createClient } from "@/lib/supabase/client";
import type { Task } from "@/lib/types";

/**
 * Clona uma task-template num projeto destino.
 * Copia: título, descrição, prioridade, prazo, prazo_has_time, checklist,
 * links e anexos. NÃO copia: assignees, dependências, comentários,
 * funnel_id, product_id, sector_id (são contextuais ao projeto original).
 *
 * Cria também um nó-órfão no mapa default do projeto destino, pra task
 * aparecer no mind map.
 *
 * Retorna o ID da nova task.
 */
export async function cloneTaskTemplate(
  templateTaskId: string,
  targetProjectId: string,
  opts?: { kanbanColumnId?: string | null }
): Promise<string> {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada");

  // 1) Lê a task-template + subtabelas
  const [t, cl, lk, at] = await Promise.all([
    supabase
      .from("tasks")
      .select(
        "titulo, descricao, prioridade, prazo, prazo_has_time"
      )
      .eq("id", templateTaskId)
      .maybeSingle(),
    supabase
      .from("task_checklist_items")
      .select("titulo, done, ordem")
      .eq("task_id", templateTaskId)
      .order("ordem"),
    supabase
      .from("task_links")
      .select("titulo, url")
      .eq("task_id", templateTaskId),
    supabase
      .from("task_attachments")
      .select("type, url, storage_path, name, size, mime, duration, width, height")
      .eq("task_id", templateTaskId)
  ]);

  if (t.error || !t.data) {
    throw new Error("Template não encontrada: " + (t.error?.message ?? ""));
  }
  const tpl = t.data as {
    titulo: string;
    descricao: string | null;
    prioridade: string;
    prazo: string | null;
    prazo_has_time: boolean;
  };

  // 2) Cria a nova task
  const { data: newTask, error: insErr } = await supabase
    .from("tasks")
    .insert({
      titulo: tpl.titulo,
      descricao: tpl.descricao,
      prioridade: tpl.prioridade,
      // Prazo "relativo" não faz sentido na clonagem — limpamos.
      // Mantemos prazo_has_time como preferência.
      prazo: null,
      prazo_has_time: tpl.prazo_has_time,
      status: "pendente",
      project_id: targetProjectId,
      created_by: user.id,
      kanban_column_id: opts?.kanbanColumnId ?? null,
      is_template: false
    })
    .select("id")
    .single();
  if (insErr || !newTask) {
    throw new Error("Erro ao clonar: " + (insErr?.message ?? ""));
  }
  const newTaskId = newTask.id as string;

  // 3) Copia checklist + links + anexos (em paralelo)
  // Cada operação retorna um PostgrestBuilder; envolvemos em Promise.resolve()
  // pra unificar tipo dentro do Promise.all.
  const ops: Promise<unknown>[] = [];
  if ((cl.data ?? []).length > 0) {
    ops.push(
      Promise.resolve(
        supabase.from("task_checklist_items").insert(
          (
            cl.data as Array<{
              titulo: string;
              done: boolean;
              ordem: number;
            }>
          ).map((c) => ({
            task_id: newTaskId,
            titulo: c.titulo,
            done: false,
            ordem: c.ordem
          }))
        )
      )
    );
  }
  if ((lk.data ?? []).length > 0) {
    ops.push(
      Promise.resolve(
        supabase.from("task_links").insert(
          (lk.data as Array<{ titulo: string | null; url: string }>).map(
            (l) => ({
              task_id: newTaskId,
              titulo: l.titulo,
              url: l.url
            })
          )
        )
      )
    );
  }
  if ((at.data ?? []).length > 0) {
    ops.push(
      Promise.resolve(
        supabase.from("task_attachments").insert(
          (
            at.data as Array<{
              type: string;
              url: string;
              storage_path: string | null;
              name: string;
              size: number | null;
              mime: string | null;
              duration: number | null;
              width: number | null;
              height: number | null;
            }>
          ).map((a) => ({
            task_id: newTaskId,
            type: a.type,
            url: a.url,
            storage_path: a.storage_path,
            name: a.name,
            size: a.size,
            mime: a.mime,
            duration: a.duration,
            width: a.width,
            height: a.height,
            uploaded_by: user.id
          }))
        )
      )
    );
  }

  // 4) Cria nó-órfão no mapa default do projeto destino
  const { data: m } = await supabase
    .from("maps")
    .select("id")
    .eq("project_id", targetProjectId)
    .eq("is_default", true)
    .maybeSingle();
  if (m?.id) {
    ops.push(
      Promise.resolve(
        supabase.from("nodes").insert({
          map_id: m.id,
          titulo: tpl.titulo,
          tipo: "tarefa",
          task_id: newTaskId,
          pos_x: 0,
          pos_y: 0
        })
      )
    );
  }

  await Promise.all(ops);
  return newTaskId;
}

/**
 * Lista todas as tasks marcadas como template (qualquer projeto).
 */
export async function listTaskTemplates() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, titulo, descricao, prioridade, project_id, projects(nome), created_at"
    )
    .eq("is_template", true)
    .order("titulo");
  if (error) throw error;
  // `projects(nome)` num inner join volta como objeto ou array vazio
  // dependendo do PostgREST. Normalizamos pra { nome } | null.
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    titulo: string;
    descricao: string | null;
    prioridade: Task["prioridade"];
    project_id: string | null;
    created_at: string;
    projects: { nome: string } | { nome: string }[] | null;
  }>;
  return rows.map((r) => ({
    ...r,
    projects: Array.isArray(r.projects)
      ? r.projects[0] ?? null
      : r.projects
  }));
}
