"use client";

import { useEffect, useRef, useState } from "react";
import {
  X,
  Trash2,
  Calendar,
  Crown,
  Search,
  User as UserIcon,
  UserPlus,
  Flag,
  Activity,
  Link as LinkIcon,
  CheckSquare,
  MessageSquare,
  Paperclip,
  Star,
  Plus,
  GitBranch,
  Package
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { deleteTaskById, taskDeleteConfirm } from "@/lib/task-delete";
import {
  cn,
  fromBrasiliaDateInputValue,
  fromBrasiliaInputValue,
  initials,
  toBrasiliaDateInputValue,
  toBrasiliaInputValue
} from "@/lib/utils";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  TIER_COLOR,
  TIER_LABEL,
  type ChecklistItem,
  type Funnel,
  type Product,
  type Project,
  type Sector,
  type Task,
  type TaskComment,
  type TaskDependency,
  type TaskLink,
  type TaskPriority,
  type TaskStatus,
  type UserProfile
} from "@/lib/types";
import { PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { TaskAttachments } from "@/components/side-panel/task-attachments";
import { useCan } from "@/components/permissions/permissions-provider";

interface Props {
  taskId: string | null;
  onClose: () => void;
  onUpdated?: () => void;
  /** Chamado com o id da task recém-excluída — pra remoção otimista na lista/board. */
  onDeleted?: (taskId: string) => void;
}

export function TaskPanel({ taskId, onClose, onUpdated, onDeleted }: Props) {
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [links, setLinks] = useState<TaskLink[]>([]);
  // Sem Editar, a tarefa abre só para leitura — o banco recusa a gravação de todo modo.
  const canEdit = useCan("tarefas", "edit");
  const canDelete = useCan("tarefas", "delete");
  const [newCheck, setNewCheck] = useState("");
  const [newComment, setNewComment] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [newLinkTitle, setNewLinkTitle] = useState("");
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [dependencies, setDependencies] = useState<TaskDependency[]>([]);
  const [depPickerOpen, setDepPickerOpen] = useState(false);
  const [depQuery, setDepQuery] = useState("");
  const [meUserId, setMeUserId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => {
      setMeUserId(data.user?.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (!taskId) {
      setTask(null);
      return;
    }
    void loadAll(taskId);
  }, [taskId]);

  async function loadAll(id: string) {
    setLoading(true);
    const supabase = createClient();
    const [tRes, uRes, pRes, sRes, cRes, coRes, lkRes, atRes, dpRes, asRes] = await Promise.all([
      supabase.from("tasks").select("*").eq("id", id).maybeSingle(),
      supabase.from("users").select("*").eq("ativo", true).order("nome"),
      supabase.from("projects").select("*").neq("status", "arquivado").order("nome"),
      supabase.from("sectors").select("*").eq("status", "ativo").order("nome"),
      supabase
        .from("task_checklist_items")
        .select("*")
        .eq("task_id", id)
        .order("ordem"),
      supabase
        .from("task_comments")
        .select("*")
        .eq("task_id", id)
        .order("created_at", { ascending: true }),
      supabase.from("task_links").select("*").eq("task_id", id).order("created_at"),
      supabase
        .from("tasks")
        .select("id, titulo, status, prioridade, project_id, responsavel_id, prazo")
        .neq("id", id)
        .limit(500),
      supabase.from("task_dependencies").select("*").eq("task_id", id),
      supabase
        .from("task_assignees")
        .select("user_id, primary_assignee")
        .eq("task_id", id)
    ]);

    const taskData = (tRes.data as Task) ?? null;
    // Anexa assignee_ids ao task, ordenando primary primeiro
    if (taskData) {
      const rows = (asRes.data as Array<{
        user_id: string;
        primary_assignee: boolean;
      }>) ?? [];
      taskData.assignee_ids = rows
        .sort((a, b) => Number(b.primary_assignee) - Number(a.primary_assignee))
        .map((r) => r.user_id);
      // Fallback: se nada na join table mas existe responsavel_id legado
      if (taskData.assignee_ids.length === 0 && taskData.responsavel_id) {
        taskData.assignee_ids = [taskData.responsavel_id];
      }
    }
    setTask(taskData);
    setUsers((uRes.data as UserProfile[]) ?? []);
    setProjects((pRes.data as Project[]) ?? []);
    setSectors((sRes.data as Sector[]) ?? []);
    setChecklist((cRes.data as ChecklistItem[]) ?? []);
    setComments((coRes.data as TaskComment[]) ?? []);
    setLinks((lkRes.data as TaskLink[]) ?? []);
    setAllTasks((atRes.data as Task[]) ?? []);
    setDependencies((dpRes.data as TaskDependency[]) ?? []);

    // Funis e produtos do projeto da tarefa
    if (taskData?.project_id) {
      const [fRes, prRes] = await Promise.all([
        supabase
          .from("funnels")
          .select("*")
          .eq("project_id", taskData.project_id)
          .order("ordem"),
        supabase
          .from("products")
          .select("*")
          .eq("project_id", taskData.project_id)
          .order("nome")
      ]);
      setFunnels((fRes.data as Funnel[]) ?? []);
      setProducts((prRes.data as Product[]) ?? []);
    } else {
      setFunnels([]);
      setProducts([]);
    }
    setLoading(false);
  }

  /**
   * Atualiza a lista de responsáveis da tarefa.
   * - primeira pessoa da lista vira `responsavel_id` (principal)
   * - lista vazia → responsavel_id null
   * - sincroniza task_assignees (deleta tudo da task + insere)
   */
  async function updateAssignees(nextIds: string[]) {
    if (!task) return;
    const supabase = createClient();
    // Dedup preservando ordem
    const ids = Array.from(new Set(nextIds));
    const primary = ids[0] ?? null;
    const previousPrimary = task.responsavel_id ?? null;

    // Optimistic UI
    setTask({ ...task, assignee_ids: ids, responsavel_id: primary });

    // Sincroniza task_assignees
    const { error: delErr } = await supabase
      .from("task_assignees")
      .delete()
      .eq("task_id", task.id);
    if (delErr) {
      toast.error("Erro ao atualizar: " + delErr.message);
      void loadAll(task.id);
      return;
    }
    if (ids.length > 0) {
      const {
        data: { user: me }
      } = await supabase.auth.getUser();
      const rows = ids.map((uid, i) => ({
        task_id: task.id,
        user_id: uid,
        primary_assignee: i === 0,
        assigned_by: me?.id ?? null
      }));
      const { error: insErr } = await supabase
        .from("task_assignees")
        .insert(rows);
      if (insErr) {
        toast.error("Erro ao atualizar: " + insErr.message);
        void loadAll(task.id);
        return;
      }
    }

    // Sincroniza responsavel_id (legado)
    const { error: tErr } = await supabase
      .from("tasks")
      .update({ responsavel_id: primary })
      .eq("id", task.id);
    if (tErr) {
      toast.error("Erro ao atualizar: " + tErr.message);
      void loadAll(task.id);
      return;
    }

    onUpdated?.();

    // Notifica por e-mail novos responsáveis (que ainda não eram)
    const previousIds = new Set(
      [previousPrimary, ...(task.assignee_ids ?? [])].filter(
        (x): x is string => !!x
      )
    );
    const newlyAdded = ids.filter((x) => !previousIds.has(x));
    if (newlyAdded.length > 0) {
      void fetch("/api/email/task-assigned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, newAssigneeIds: newlyAdded })
      });
    }
  }

  /** Update atômico de múltiplos campos. Usado pelo toggle de prazo
   *  (precisa atualizar `prazo` e `prazo_has_time` na mesma operação). */
  async function updateFields(patch: Partial<Task>) {
    if (!task) return;
    const supabase = createClient();
    setTask({ ...task, ...patch });
    const { error } = await supabase
      .from("tasks")
      .update(patch)
      .eq("id", task.id);
    if (error) {
      toast.error("Erro ao salvar: " + error.message);
      void loadAll(task.id);
    } else {
      onUpdated?.();
    }
  }

  async function updateField<K extends keyof Task>(field: K, value: Task[K]) {
    if (!task) return;
    const supabase = createClient();
    const prev = task[field];
    setTask({ ...task, [field]: value });
    const { error } = await supabase
      .from("tasks")
      .update({ [field]: value })
      .eq("id", task.id);
    if (error) {
      toast.error("Erro ao salvar: " + error.message);
      void loadAll(task.id);
    } else {
      onUpdated?.();
      // Notifica por e-mail quando o responsável é definido/trocado.
      if (
        field === "responsavel_id" &&
        value &&
        value !== prev
      ) {
        void fetch("/api/email/task-assigned", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId: task.id })
        }).catch(() => {});
      }
      // Celebra quando o status vira "concluido"
      if (
        field === "status" &&
        value === "concluido" &&
        prev !== "concluido"
      ) {
        const aside = document.querySelector(".animate-slideInRight");
        const { celebrate } = await import("@/lib/celebrate");
        celebrate(aside ?? null);
      }
    }
  }

  async function addChecklistItem() {
    if (!task || !newCheck.trim()) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("task_checklist_items")
      .insert({
        task_id: task.id,
        titulo: newCheck.trim(),
        ordem: checklist.length
      })
      .select()
      .single();
    if (!error && data) {
      setChecklist([...checklist, data as ChecklistItem]);
      setNewCheck("");
    } else if (error) {
      toast.error(error.message);
    }
  }

  async function toggleCheck(item: ChecklistItem) {
    const supabase = createClient();
    setChecklist((prev) =>
      prev.map((c) => (c.id === item.id ? { ...c, done: !c.done } : c))
    );
    await supabase
      .from("task_checklist_items")
      .update({ done: !item.done })
      .eq("id", item.id);
  }

  async function removeCheck(item: ChecklistItem) {
    const supabase = createClient();
    setChecklist((prev) => prev.filter((c) => c.id !== item.id));
    await supabase.from("task_checklist_items").delete().eq("id", item.id);
  }

  async function addComment() {
    if (!task || !newComment.trim()) return;
    const supabase = createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("task_comments")
      .insert({
        task_id: task.id,
        user_id: user?.id ?? null,
        conteudo: newComment.trim()
      })
      .select()
      .single();
    if (!error && data) {
      setComments([...comments, data as TaskComment]);
      setNewComment("");
    } else if (error) {
      toast.error(error.message);
    }
  }

  async function addLink() {
    if (!task || !newLinkUrl.trim()) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("task_links")
      .insert({
        task_id: task.id,
        url: newLinkUrl.trim(),
        titulo: newLinkTitle.trim() || null
      })
      .select()
      .single();
    if (!error && data) {
      setLinks([...links, data as TaskLink]);
      setNewLinkUrl("");
      setNewLinkTitle("");
    } else if (error) {
      toast.error(error.message);
    }
  }

  async function removeLink(id: string) {
    const supabase = createClient();
    setLinks((prev) => prev.filter((l) => l.id !== id));
    await supabase.from("task_links").delete().eq("id", id);
  }

  async function addDependency(otherTaskId: string) {
    if (!task) return;
    if (dependencies.some((d) => d.depends_on_task_id === otherTaskId)) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("task_dependencies")
      .insert({ task_id: task.id, depends_on_task_id: otherTaskId })
      .select()
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    setDependencies((prev) => [...prev, data as TaskDependency]);
    setDepPickerOpen(false);
    setDepQuery("");
    toast.success("Dependência adicionada");
  }

  async function removeDependency(depId: string) {
    const supabase = createClient();
    setDependencies((prev) => prev.filter((d) => d.id !== depId));
    await supabase.from("task_dependencies").delete().eq("id", depId);
  }

  async function deleteTask() {
    if (!task) return;
    if (!confirm(taskDeleteConfirm(task.titulo))) return;
    const resultado = await deleteTaskById(task.id);
    if (!resultado.ok) {
      toast.error(resultado.message);
      return;
    }
    toast.success("Tarefa excluída");
    onDeleted?.(task.id);
    onClose();
  }

  if (!taskId) return null;

  const userName = (uid: string | null | undefined) =>
    users.find((u) => u.id === uid)?.nome ?? "—";

  return (
    <aside className="fixed right-0 top-0 bottom-0 z-40 w-full max-w-md bg-bg-subtle border-l border-border flex flex-col animate-slideInRight shadow-2xl">
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <p className="text-xs text-fg-subtle uppercase tracking-wider">Tarefa</p>
          <div className="flex items-center gap-1">
            {canDelete && (
              <button
                onClick={deleteTask}
                className="p-1.5 rounded-lg hover:bg-priority-urgent/15 text-fg-muted hover:text-priority-urgent transition"
                title="Excluir"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-bg-muted text-fg-muted transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {loading || !task ? (
          <div className="flex-1 flex items-center justify-center text-fg-muted text-sm">
            Carregando...
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {!canEdit && (
              <p className="text-xs text-fg-muted bg-bg-muted/60 border border-border rounded-md px-3 py-2">
                Seu perfil permite ver esta tarefa, mas não alterá-la. Comentários seguem liberados.
              </p>
            )}
            {/* Sem Editar, tudo que altera a tarefa fica desabilitado de uma vez.
                Não usa display:contents: o espaçamento space-y-5 só vale para
                filhos diretos, então o fieldset leva o próprio espaçamento. */}
            <fieldset disabled={!canEdit} className="space-y-5 min-w-0 border-0 p-0 m-0">
            <input
              value={task.titulo}
              onChange={(e) => setTask({ ...task, titulo: e.target.value })}
              onBlur={() => updateField("titulo", task.titulo)}
              className="w-full text-lg font-semibold bg-transparent border-0 focus:outline-none focus:ring-0 px-0"
              placeholder="Título da tarefa"
            />

            <div className="flex flex-wrap items-center gap-2">
              <PriorityBadge value={task.prioridade} />
              <StatusBadge value={task.status} />
              <button
                type="button"
                onClick={() =>
                  void updateField("is_template", !task.is_template)
                }
                title={
                  task.is_template
                    ? "Esta tarefa aparece como template em outros projetos. Clique pra desmarcar."
                    : "Marcar como template — aparece no picker pra ser clonada em outros projetos."
                }
                className={cn(
                  "ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition",
                  task.is_template
                    ? "bg-priority-medium/15 border-priority-medium/40 text-priority-medium"
                    : "bg-bg border-border text-fg-muted hover:text-fg hover:border-border-strong"
                )}
              >
                <Star
                  className={cn(
                    "w-3 h-3",
                    task.is_template && "fill-priority-medium/40"
                  )}
                />
                {task.is_template ? "Template" : "Usar como template"}
              </button>
            </div>

            {/* Etiqueta de autoria: quem subiu a tarefa + quando */}
            <div className="inline-flex items-center gap-1.5 text-[11px] text-fg-muted bg-bg border border-border rounded-md px-2 py-1">
              <UserPlus className="w-3 h-3 text-fg-subtle shrink-0" />
              <span>
                Criada por{" "}
                <span className="font-medium text-fg">
                  {userName(task.created_by)}
                </span>
              </span>
              {task.created_at && (
                <span className="text-fg-subtle">
                  · {new Date(task.created_at).toLocaleDateString("pt-BR")}
                </span>
              )}
            </div>

            <textarea
              value={task.descricao ?? ""}
              onChange={(e) => setTask({ ...task, descricao: e.target.value })}
              onBlur={() => updateField("descricao", task.descricao)}
              placeholder="Adicione uma descrição..."
              className="w-full min-h-[80px] resize-y px-3 py-2 text-sm bg-bg border border-border rounded-lg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />

            <Field label="Responsáveis" icon={UserIcon}>
              <AssigneePicker
                users={users}
                selectedIds={task.assignee_ids ?? []}
                onChange={updateAssignees}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Status" icon={Activity}>
                <select
                  value={task.status}
                  onChange={(e) =>
                    updateField("status", e.target.value as TaskStatus)
                  }
                  className="w-full px-2.5 py-1.5 bg-bg border border-border rounded-md text-sm focus:border-brand focus:outline-none"
                >
                  {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Prioridade" icon={Flag}>
                <select
                  value={task.prioridade}
                  onChange={(e) =>
                    updateField("prioridade", e.target.value as TaskPriority)
                  }
                  className="w-full px-2.5 py-1.5 bg-bg border border-border rounded-md text-sm focus:border-brand focus:outline-none"
                >
                  {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="Prazo"
                icon={Calendar}
                headerRight={
                  <label
                    className="inline-flex items-center gap-1.5 text-[10px] text-fg-subtle cursor-pointer select-none"
                    title={
                      task.prazo_has_time
                        ? "Desmarque para gravar só a data"
                        : "Marque para incluir horário específico"
                    }
                  >
                    <span>com horário</span>
                    <span
                      className={cn(
                        "relative inline-block w-7 h-3.5 rounded-full transition-colors",
                        task.prazo_has_time
                          ? "bg-brand"
                          : "bg-bg-muted border border-border"
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-transform",
                          task.prazo_has_time
                            ? "translate-x-3.5"
                            : "translate-x-0.5"
                        )}
                      />
                    </span>
                    <input
                      type="checkbox"
                      checked={task.prazo_has_time}
                      onChange={(e) => {
                        const nextHasTime = e.target.checked;
                        if (!task.prazo) {
                          void updateField("prazo_has_time", nextHasTime);
                          return;
                        }
                        // Mantém a data, converte o componente de hora:
                        // - desligando: força 23:59:59 do mesmo dia (Brasília)
                        // - ligando:    mantém 23:59 ou seta hora padrão 09:00
                        const dateStr = toBrasiliaDateInputValue(task.prazo);
                        const newIso = nextHasTime
                          ? fromBrasiliaInputValue(`${dateStr}T09:00`)
                          : fromBrasiliaDateInputValue(dateStr);
                        void updateFields({
                          prazo: newIso,
                          prazo_has_time: nextHasTime
                        });
                      }}
                      className="sr-only"
                    />
                  </label>
                }
              >
                {task.prazo_has_time ? (
                  <input
                    type="datetime-local"
                    value={toBrasiliaInputValue(task.prazo)}
                    onChange={(e) =>
                      updateField(
                        "prazo",
                        fromBrasiliaInputValue(e.target.value)
                      )
                    }
                    className="w-full px-2.5 py-1.5 bg-bg border border-border rounded-md text-sm focus:border-brand focus:outline-none"
                  />
                ) : (
                  <input
                    type="date"
                    value={toBrasiliaDateInputValue(task.prazo)}
                    onChange={(e) =>
                      updateField(
                        "prazo",
                        fromBrasiliaDateInputValue(e.target.value)
                      )
                    }
                    className="w-full px-2.5 py-1.5 bg-bg border border-border rounded-md text-sm focus:border-brand focus:outline-none"
                  />
                )}
              </Field>

              <Field label="Projeto">
                <select
                  value={task.project_id ?? ""}
                  onChange={(e) =>
                    updateField("project_id", e.target.value || null)
                  }
                  className="w-full px-2.5 py-1.5 bg-bg border border-border rounded-md text-sm focus:border-brand focus:outline-none"
                >
                  <option value="">—</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Setor">
                <select
                  value={task.sector_id ?? ""}
                  onChange={(e) =>
                    updateField("sector_id", e.target.value || null)
                  }
                  className="w-full px-2.5 py-1.5 bg-bg border border-border rounded-md text-sm focus:border-brand focus:outline-none"
                >
                  <option value="">—</option>
                  {sectors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nome}
                    </option>
                  ))}
                </select>
              </Field>

              {(() => {
                const currentProject = projects.find(
                  (p) => p.id === task.project_id
                );
                if (currentProject && currentProject.tipo !== "infoproduto") {
                  return null;
                }
                return (
                  <>
                    <Field label="Funil" icon={GitBranch}>
                      <select
                        value={task.funnel_id ?? ""}
                        onChange={(e) => {
                          const newFunnelId = e.target.value || null;
                          const newFunnel = funnels.find(
                            (f) => f.id === newFunnelId
                          );
                          const currentProduct = products.find(
                            (p) => p.id === task.product_id
                          );
                          const productOk =
                            !currentProduct ||
                            !newFunnel?.tier ||
                            currentProduct.tier === newFunnel.tier;
                          if (!productOk) {
                            void updateField("product_id", null);
                          }
                          void updateField("funnel_id", newFunnelId);
                        }}
                        className="w-full px-2.5 py-1.5 bg-bg border border-border rounded-md text-sm focus:border-brand focus:outline-none"
                        disabled={!task.project_id}
                      >
                        <option value="">—</option>
                        {funnels.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.nome}
                            {f.tier ? ` (${TIER_LABEL[f.tier]})` : ""}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="Produto" icon={Package}>
                      {(() => {
                        const currentFunnel = funnels.find(
                          (f) => f.id === task.funnel_id
                        );
                        const tierFilter = currentFunnel?.tier;
                        const filtered = products.filter((p) => {
                          if (tierFilter && p.tier !== tierFilter) return false;
                          if (
                            task.funnel_id &&
                            p.funnel_id &&
                            p.funnel_id !== task.funnel_id
                          )
                            return false;
                          return true;
                        });
                        return (
                          <select
                            value={task.product_id ?? ""}
                            onChange={(e) =>
                              updateField(
                                "product_id",
                                e.target.value || null
                              )
                            }
                            className="w-full px-2.5 py-1.5 bg-bg border border-border rounded-md text-sm focus:border-brand focus:outline-none"
                            disabled={!task.project_id}
                          >
                            <option value="">—</option>
                            {filtered.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.nome} ({TIER_LABEL[p.tier]})
                              </option>
                            ))}
                          </select>
                        );
                      })()}
                    </Field>
                  </>
                );
              })()}
            </div>

            {/* Badges de funil/produto */}
            {(task.funnel_id || task.product_id) && (
              <div className="flex flex-wrap gap-1.5">
                {task.funnel_id &&
                  (() => {
                    const f = funnels.find((x) => x.id === task.funnel_id);
                    if (!f) return null;
                    return (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium"
                        style={{
                          backgroundColor: f.cor + "20",
                          color: f.cor
                        }}
                      >
                        <GitBranch className="w-2.5 h-2.5" />
                        {f.nome}
                      </span>
                    );
                  })()}
                {task.product_id &&
                  (() => {
                    const p = products.find((x) => x.id === task.product_id);
                    if (!p) return null;
                    return (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium"
                        style={{
                          backgroundColor: TIER_COLOR[p.tier] + "20",
                          color: TIER_COLOR[p.tier]
                        }}
                      >
                        <Package className="w-2.5 h-2.5" />
                        {p.nome}
                      </span>
                    );
                  })()}
              </div>
            )}

            </fieldset>

            {/* Anexos (imagens, vídeos, áudios, documentos) ficam FORA do bloco
                desabilitado: pré-visualizar e baixar valem para quem só lê a
                tarefa. Enviar e excluir obedecem ao perfil dentro do componente. */}
            <Section icon={Paperclip} title="Anexos">
              <TaskAttachments taskId={task.id} userId={meUserId ?? ""} />
            </Section>

            <fieldset disabled={!canEdit} className="space-y-5 min-w-0 border-0 p-0 m-0">

            {/* Checklist */}
            <Section icon={CheckSquare} title="Checklist">
              <div className="space-y-1.5">
                {checklist.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 group"
                  >
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() => toggleCheck(item)}
                      className="w-4 h-4 rounded border-border"
                    />
                    <span
                      className={cn(
                        "flex-1 text-sm",
                        item.done && "line-through text-fg-subtle"
                      )}
                    >
                      {item.titulo}
                    </span>
                    <button
                      onClick={() => removeCheck(item)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-fg-subtle hover:text-priority-urgent transition"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex gap-1.5 mt-2">
                  <input
                    value={newCheck}
                    onChange={(e) => setNewCheck(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addChecklistItem()}
                    placeholder="Novo item..."
                    className="flex-1 px-2.5 py-1.5 bg-bg border border-border rounded-md text-sm focus:border-brand focus:outline-none"
                  />
                  <button
                    onClick={addChecklistItem}
                    className="px-2.5 py-1.5 rounded-md bg-bg-muted hover:bg-border text-fg-muted hover:text-fg transition"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </Section>

            {/* Links */}
            <Section icon={LinkIcon} title="Links">
              <div className="space-y-1.5">
                {links.map((l) => (
                  <div
                    key={l.id}
                    className="flex items-center gap-2 group bg-bg rounded-md px-2.5 py-1.5 border border-border"
                  >
                    <LinkIcon className="w-3.5 h-3.5 text-fg-subtle shrink-0" />
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 text-sm text-brand hover:underline truncate"
                    >
                      {l.titulo || l.url}
                    </a>
                    <button
                      onClick={() => removeLink(l.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-fg-subtle hover:text-priority-urgent transition"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <div className="space-y-1.5 mt-2">
                  <input
                    value={newLinkTitle}
                    onChange={(e) => setNewLinkTitle(e.target.value)}
                    placeholder="Título (opcional)"
                    className="w-full px-2.5 py-1.5 bg-bg border border-border rounded-md text-sm focus:border-brand focus:outline-none"
                  />
                  <div className="flex gap-1.5">
                    <input
                      value={newLinkUrl}
                      onChange={(e) => setNewLinkUrl(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addLink()}
                      placeholder="https://..."
                      className="flex-1 px-2.5 py-1.5 bg-bg border border-border rounded-md text-sm focus:border-brand focus:outline-none"
                    />
                    <button
                      onClick={addLink}
                      className="px-2.5 py-1.5 rounded-md bg-bg-muted hover:bg-border text-fg-muted hover:text-fg transition"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </Section>

            {/* Dependências */}
            <Section icon={GitBranch} title="Depende de">
              {(() => {
                const depTasks = dependencies
                  .map((d) =>
                    allTasks.find((t) => t.id === d.depends_on_task_id)
                  )
                  .filter(Boolean) as Task[];
                const pendings = depTasks.filter((t) => t.status !== "concluido");
                const blocked = pendings.length > 0;
                return (
                  <div className="space-y-2">
                    {dependencies.length > 0 && (
                      <div
                        className={cn(
                          "rounded-lg border px-3 py-2 text-xs flex items-center gap-2",
                          blocked
                            ? "bg-priority-urgent/10 border-priority-urgent/30 text-priority-urgent"
                            : "bg-status-done/10 border-status-done/30 text-status-done"
                        )}
                      >
                        {blocked ? (
                          <>
                            <Activity className="w-3.5 h-3.5" />
                            Bloqueada: {pendings.length} dependência(s) pendente(s).
                          </>
                        ) : (
                          <>
                            <CheckSquare className="w-3.5 h-3.5" />
                            Liberada — todas as dependências foram concluídas.
                          </>
                        )}
                      </div>
                    )}

                    {depTasks.map((dep, idx) => {
                      const depRow = dependencies[idx];
                      const projName = projects.find(
                        (p) => p.id === dep.project_id
                      )?.nome;
                      return (
                        <div
                          key={dep.id}
                          className="bg-bg border border-border rounded-lg px-3 py-2 flex items-center gap-2 group"
                        >
                          <span
                            className={cn(
                              "w-2 h-2 rounded-full shrink-0",
                              dep.status === "concluido"
                                ? "bg-status-done"
                                : "bg-priority-high"
                            )}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {dep.titulo}
                            </p>
                            <p className="text-[10px] text-fg-subtle truncate">
                              {projName ?? "Sem projeto"} ·{" "}
                              {STATUS_LABEL[dep.status]}
                            </p>
                          </div>
                          <button
                            onClick={() => removeDependency(depRow.id)}
                            className="opacity-0 group-hover:opacity-100 p-1 text-fg-subtle hover:text-priority-urgent transition"
                            title="Remover dependência"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}

                    {!depPickerOpen ? (
                      <button
                        onClick={() => setDepPickerOpen(true)}
                        className="w-full text-xs font-medium text-fg-muted hover:text-fg flex items-center justify-center gap-1.5 py-2 rounded-md border border-dashed border-border hover:border-border-strong transition"
                      >
                        <Plus className="w-3.5 h-3.5" /> Adicionar dependência
                      </button>
                    ) : (
                      <div className="bg-bg border border-border rounded-lg p-2 space-y-1">
                        <div className="flex items-center gap-2 px-2 pt-1 pb-1.5 border-b border-border">
                          <GitBranch className="w-3 h-3 text-fg-subtle" />
                          <input
                            autoFocus
                            value={depQuery}
                            onChange={(e) => setDepQuery(e.target.value)}
                            placeholder="Buscar tarefa..."
                            className="flex-1 bg-transparent text-xs outline-none"
                          />
                          <button
                            onClick={() => {
                              setDepPickerOpen(false);
                              setDepQuery("");
                            }}
                            className="text-fg-subtle hover:text-fg"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                        <ul className="max-h-44 overflow-y-auto">
                          {allTasks
                            .filter(
                              (t) =>
                                !dependencies.some(
                                  (d) => d.depends_on_task_id === t.id
                                )
                            )
                            .filter((t) =>
                              depQuery.trim()
                                ? t.titulo
                                    .toLowerCase()
                                    .includes(depQuery.toLowerCase())
                                : true
                            )
                            .slice(0, 30)
                            .map((t) => {
                              const projName = projects.find(
                                (p) => p.id === t.project_id
                              )?.nome;
                              return (
                                <li key={t.id}>
                                  <button
                                    onClick={() => addDependency(t.id)}
                                    className="w-full text-left px-2 py-1.5 hover:bg-bg-muted rounded text-xs"
                                  >
                                    <p className="font-medium truncate">
                                      {t.titulo}
                                    </p>
                                    <p className="text-[10px] text-fg-subtle truncate">
                                      {projName ?? "Sem projeto"} ·{" "}
                                      {STATUS_LABEL[t.status]}
                                    </p>
                                  </button>
                                </li>
                              );
                            })}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })()}
            </Section>

            </fieldset>

            {/* Comentários — conversa, não edição: liberado a quem vê a tarefa. */}
            <Section icon={MessageSquare} title="Comentários">
              <div className="space-y-2">
                {comments.map((c) => (
                  <div
                    key={c.id}
                    className="bg-bg border border-border rounded-lg px-3 py-2"
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-medium">
                        {userName(c.user_id)}
                      </span>
                      <span className="text-[10px] text-fg-subtle">
                        {new Date(c.created_at).toLocaleString("pt-BR")}
                      </span>
                    </div>
                    <p className="text-sm text-fg-muted whitespace-pre-wrap">
                      {c.conteudo}
                    </p>
                  </div>
                ))}
                <div className="flex gap-1.5 mt-2">
                  <textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Adicionar comentário..."
                    rows={2}
                    className="flex-1 px-2.5 py-1.5 bg-bg border border-border rounded-md text-sm focus:border-brand focus:outline-none resize-y"
                  />
                  <button
                    onClick={addComment}
                    className="self-stretch px-3 rounded-md bg-brand hover:bg-brand-hover text-white text-sm font-medium transition"
                  >
                    Enviar
                  </button>
                </div>
              </div>
            </Section>

            <div className="pt-2 border-t border-border text-[11px] text-fg-subtle space-y-0.5">
              <p>
                Criado em{" "}
                {new Date(task.created_at).toLocaleString("pt-BR")} por{" "}
                {userName(task.created_by)}
              </p>
              {task.data_conclusao && (
                <p>
                  Concluído em{" "}
                  {new Date(task.data_conclusao).toLocaleString("pt-BR")}
                </p>
              )}
            </div>
          </div>
        )}
    </aside>
  );
}

function Field({
  label,
  icon: Icon,
  children,
  headerRight
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  headerRight?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-fg-muted uppercase tracking-wider mb-1">
        {Icon && <Icon className="w-3 h-3" />}
        {label}
        {headerRight && <span className="ml-auto normal-case">{headerRight}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * Multi-select de responsáveis. Mostra chips das pessoas selecionadas
 * (com avatar + nome, primeira marcada como "principal" com a coroa),
 * botão "+ adicionar" abre dropdown com busca e checkboxes. Clicar
 * num chip → coroa muda pra ele (vira principal). X no chip remove.
 */
function AssigneePicker({
  users,
  selectedIds,
  onChange
}: {
  users: UserProfile[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const selected = selectedIds
    .map((id) => users.find((u) => u.id === id))
    .filter((u): u is UserProfile => !!u);

  const filtered = users.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.nome.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.cargo ?? "").toLowerCase().includes(q)
    );
  });

  function toggle(uid: string) {
    if (selectedIds.includes(uid)) {
      onChange(selectedIds.filter((x) => x !== uid));
    } else {
      onChange([...selectedIds, uid]);
    }
  }

  function makePrimary(uid: string) {
    if (!selectedIds.includes(uid)) return;
    onChange([uid, ...selectedIds.filter((x) => x !== uid)]);
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex flex-wrap gap-1.5 items-center">
        {selected.length === 0 ? (
          <span className="text-xs text-fg-subtle italic">
            Ninguém atribuído
          </span>
        ) : (
          selected.map((u, i) => {
            const isPrimary = i === 0;
            return (
              <span
                key={u.id}
                className={cn(
                  "group inline-flex items-center gap-1.5 pl-1 pr-1 py-0.5 rounded-full text-xs border",
                  isPrimary
                    ? "bg-brand-subtle text-brand border-brand/30 font-semibold"
                    : "bg-bg-muted text-fg border-border"
                )}
                title={
                  isPrimary
                    ? "Responsável principal"
                    : "Clique na coroa para tornar principal"
                }
              >
                <span className="w-5 h-5 rounded-full bg-brand/20 text-brand flex items-center justify-center text-[9px] font-bold uppercase">
                  {initials(u.nome)}
                </span>
                <span className="truncate max-w-[100px]">{u.nome}</span>
                {isPrimary ? (
                  <Crown
                    className="w-3 h-3 text-priority-medium"
                    aria-label="Principal"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => makePrimary(u.id)}
                    className="opacity-50 hover:opacity-100 transition"
                    title="Tornar principal"
                  >
                    <Crown className="w-3 h-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => toggle(u.id)}
                  className="opacity-50 hover:opacity-100 hover:text-priority-urgent transition rounded-full"
                  title="Remover"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-dashed border-border hover:border-brand hover:text-brand text-fg-muted transition"
          title="Adicionar responsável"
        >
          <UserPlus className="w-3 h-3" /> Adicionar
        </button>
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-bg-subtle border border-border rounded-xl shadow-2xl overflow-hidden animate-fadeIn">
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar pessoa..."
                className="w-full pl-8 pr-2 py-1.5 bg-bg border border-border rounded-md text-xs focus:outline-none focus:border-brand"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="p-3 text-xs text-fg-muted text-center">
                Nenhuma pessoa encontrada.
              </p>
            ) : (
              filtered.map((u) => {
                const checked = selectedIds.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggle(u.id)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition",
                      checked
                        ? "bg-brand-subtle/40 text-fg"
                        : "hover:bg-bg-muted text-fg-muted"
                    )}
                  >
                    <span
                      className={cn(
                        "w-4 h-4 rounded border flex items-center justify-center shrink-0",
                        checked
                          ? "bg-brand border-brand text-white"
                          : "border-border"
                      )}
                    >
                      {checked && (
                        <svg
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className="w-3 h-3"
                        >
                          <path d="M16.7 5.3a1 1 0 010 1.4l-7 7a1 1 0 01-1.4 0l-3-3a1 1 0 011.4-1.4L9 11.6l6.3-6.3a1 1 0 011.4 0z" />
                        </svg>
                      )}
                    </span>
                    <span className="w-6 h-6 rounded-full bg-brand/20 text-brand flex items-center justify-center text-[9px] font-bold uppercase">
                      {initials(u.nome)}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="text-sm truncate block">{u.nome}</span>
                      <span className="text-[10px] text-fg-subtle truncate block">
                        {u.cargo || u.email}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-3.5 h-3.5 text-fg-muted" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}
