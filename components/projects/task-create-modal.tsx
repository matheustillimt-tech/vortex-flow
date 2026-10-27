"use client";

import { useEffect, useRef, useState } from "react";
import {
  Calendar,
  Check,
  Eye,
  ListChecks,
  Loader2,
  Plus,
  Paperclip,
  Upload,
  Trash2,
  Users,
  X
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { initials } from "@/lib/utils";
import { createTaskDraft, saveTaskDraft, type TaskCreationDraft } from "@/lib/task-creation";
import { discardPendingTaskAttachment, formatFileSize, uploadTaskAttachment } from "@/lib/task-attachments";
import { prepareTaskAttachment, TASK_ATTACHMENT_ACCEPT, taskAttachmentValidationError } from "@/lib/task-attachment-files";
import { AttachmentPreview } from "@/components/attachments/attachment-preview";

type PendingAttachment = {
  id: string;
  file: File;
  prepared?: File;
  attempted?: boolean;
  status: "pending" | "compressing" | "uploading" | "uploaded" | "error";
  progress?: number;
  error?: string;
};
function errorMessage(error: unknown): string {
  return error && typeof error === "object" && "message" in error ? String(error.message) : "Falha na operação. Tente novamente.";
}
import type {
  KanbanColumn,
  Sector,
  TaskPriority,
  TaskStatus,
  UserProfile
} from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  users: UserProfile[];
  sectors: Sector[];
  /** Pré-seleciona coluna de destino (ex: clicou no "+" de uma coluna). */
  defaultKanbanColumnId?: string;
  onCreated: () => void;
}

const PRIORIDADES: { value: TaskPriority; label: string; cor: string }[] = [
  { value: "baixa", label: "Baixa", cor: "#94a3b8" },
  { value: "media", label: "Média", cor: "#3b82f6" },
  { value: "alta", label: "Alta", cor: "#eab308" },
  { value: "urgente", label: "Urgente", cor: "#ef4444" }
];

const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "pendente", label: "Pendente" },
  { value: "em_andamento", label: "Em andamento" },
  { value: "em_revisao", label: "Em revisão" },
  { value: "travado", label: "Travado" },
  { value: "concluido", label: "Concluído" }
];

export function TaskCreateModal({
  open,
  onClose,
  projectId,
  users,
  sectors,
  defaultKanbanColumnId,
  onCreated
}: Props) {
  const supabase = createClient();
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [prioridade, setPrioridade] = useState<TaskPriority>("media");
  const [status, setStatus] = useState<TaskStatus>("pendente");
  const [responsaveis, setResponsaveis] = useState<Set<string>>(new Set());
  const [sectorId, setSectorId] = useState<string>("");
  const [columnId, setColumnId] = useState<string>("");
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [prazo, setPrazo] = useState<string>(""); // date input value
  const [prazoHora, setPrazoHora] = useState<string>(""); // hh:mm
  const [checklist, setChecklist] = useState<string[]>([]);
  const [newCheck, setNewCheck] = useState("");
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);
  const draftRef = useRef<TaskCreationDraft | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [taskCreated, setTaskCreated] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const attachmentRef = useRef<PendingAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activity, setActivity] = useState("");
  // Pré-visualização do arquivo ainda não enviado: lê o arquivo local por um
  // endereço blob:, liberado ao fechar ou trocar de arquivo.
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewItem = attachments.find((item) => item.id === previewId) ?? null;
  const previewFile = previewItem ? (previewItem.prepared ?? previewItem.file) : null;
  useEffect(() => {
    if (!previewFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(previewFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [previewFile]);

  function updateAttachments(items: PendingAttachment[]) {
    attachmentRef.current = items;
    setAttachments(items);
  }
  function updateAttachment(id: string, patch: Partial<PendingAttachment>) {
    updateAttachments(attachmentRef.current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }
  function selectFiles(files: FileList) {
    if (busyRef.current) return;
    const next = [...attachmentRef.current];
    for (const file of Array.from(files)) {
      const error = taskAttachmentValidationError(file);
      if (error) { toast.error(error); continue; }
      if (next.some((item) => item.file.name === file.name && item.file.size === file.size && item.file.type === file.type && item.file.lastModified === file.lastModified)) continue;
      next.push({ id: crypto.randomUUID(), file, status: "pending" });
    }
    updateAttachments(next);
  }
  async function discard(item: PendingAttachment) {
    const draft = draftRef.current;
    if (item.attempted && draft) {
      await discardPendingTaskAttachment(item.prepared ?? item.file, {
        taskId: draft.task.id, userId: draft.task.created_by, attachmentId: item.id
      });
    }
  }
  async function removeAttachment(item: PendingAttachment) {
    if (busyRef.current || item.status === "uploaded") return;
    busyRef.current = true;
    setSaving(true);
    try {
      await discard(item);
      updateAttachments(attachmentRef.current.filter((entry) => entry.id !== item.id));
    } catch (error) {
      setSaveError(`Não foi possível remover a seleção: ${errorMessage(error)}`);
    } finally { busyRef.current = false; setSaving(false); }
  }
  function requestClose() {
    if (busyRef.current) return;
    if (draftRef.current) { setConfirmLeave(true); return; }
    updateAttachments([]);
    onClose();
  }
  async function finishWithoutPending() {
    if (busyRef.current) return;
    busyRef.current = true;
    setSaving(true);
    try {
      for (const item of attachmentRef.current) {
        if (item.status !== "uploaded") await discard(item);
      }
      // Também atualiza o quadro quando a resposta da criação foi incerta.
      onCreated();
    } catch (error) {
      setSaveError(`Não foi possível limpar o envio pendente: ${errorMessage(error)}`);
    } finally { busyRef.current = false; setSaving(false); }
  }

  useEffect(() => {
    if (!open) return;
    setTitulo("");
    setDescricao("");
    setPrioridade("media");
    setStatus("pendente");
    setResponsaveis(new Set());
    setSectorId("");
    setPrazo("");
    setPrazoHora("");
    setChecklist([]);
    setNewCheck("");
    draftRef.current = null;
    setSubmitted(false);
    setTaskCreated(false);
    setSaveError("");
    setConfirmLeave(false);
    setActivity("");
    updateAttachments([]);
    void loadColumns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  useEffect(() => {
    if (!open || (!saving && !submitted && attachments.length === 0)) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [open, saving, submitted, attachments.length]);

  async function loadColumns() {
    const { data } = await supabase
      .from("kanban_columns")
      .select("*")
      .eq("project_id", projectId)
      .order("ordem");
    const list = (data as KanbanColumn[]) ?? [];
    setColumns(list);
    setColumnId(defaultKanbanColumnId ?? list[0]?.id ?? "");
  }

  function toggleResp(id: string) {
    setResponsaveis((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addCheck() {
    const v = newCheck.trim();
    if (!v) return;
    setChecklist((prev) => [...prev, v]);
    setNewCheck("");
  }

  function removeCheck(i: number) {
    setChecklist((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleCreate() {
    if (busyRef.current) return;
    const trimmed = titulo.trim();
    if (!trimmed) { toast.error("Dá um título pra tarefa."); return; }
    busyRef.current = true;
    setSaving(true);
    setSaveError("");
    setConfirmLeave(false);
    setActivity("Salvando tarefa...");
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error("Sessão expirada. Entre novamente antes de continuar.");
      if (draftRef.current && draftRef.current.task.created_by !== user.id) throw new Error("Continue com a mesma conta que iniciou esta tarefa.");
      if (!draftRef.current) {
        const prazoIso = prazo ? new Date(`${prazo}T${prazoHora || "12:00"}:00`).toISOString() : null;
        const respArr = Array.from(responsaveis);
        draftRef.current = createTaskDraft({
          project_id: projectId, titulo: trimmed, descricao: descricao.trim() || null,
          prioridade, status, sector_id: sectorId || null, kanban_column_id: columnId || null,
          prazo: prazoIso, prazo_has_time: !!(prazo && prazoHora),
          responsavel_id: respArr[0] ?? null, created_by: user.id
        }, respArr, checklist);
        setSubmitted(true);
      }
      const draft = draftRef.current;
      await saveTaskDraft(draft, () => setTaskCreated(true));
      const pending = attachmentRef.current.filter((item) => item.status !== "uploaded");
      for (let i = 0; i < pending.length; i++) {
        const item = pending[i];
        try {
          setActivity(`Enviando anexo ${i + 1} de ${pending.length}: ${item.file.name}`);
          updateAttachment(item.id, { status: "uploading", error: undefined });
          const prepared = item.prepared ?? await prepareTaskAttachment(item.file, (progress) => {
            updateAttachment(item.id, { status: "compressing", progress });
          });
          updateAttachment(item.id, { prepared, attempted: true, status: "uploading" });
          await uploadTaskAttachment(prepared, { taskId: draft.task.id, userId: user.id, attachmentId: item.id });
          updateAttachment(item.id, { status: "uploaded" });
        } catch (error) {
          updateAttachment(item.id, { status: "error", error: errorMessage(error) });
        }
      }
      if (attachmentRef.current.some((item) => item.status !== "uploaded")) {
        setSaveError("A tarefa foi criada, mas há anexos pendentes. Tente novamente para enviar só o que falta, sem criar outra tarefa.");
        return;
      }
      toast.success("Tarefa criada com sucesso.");
      onCreated();
    } catch (error) {
      setSaveError(`${draftRef.current?.taskSaved ? "A tarefa já foi criada, mas há dados pendentes." : "Não foi possível confirmar a criação."} ${errorMessage(error)} Tente novamente neste formulário para evitar duplicação.`);
    } finally {
      busyRef.current = false;
      setSaving(false);
      setActivity("");
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={requestClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-task-title"
        aria-busy={saving}
        className="bg-bg w-full max-w-2xl max-h-[92vh] rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="p-4 border-b border-border flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h2 id="new-task-title" className="text-sm font-semibold text-fg">{taskCreated ? "Concluir tarefa" : "Nova tarefa"}</h2>
            <p className="text-[11px] text-fg-muted mt-0.5">
              Preencha os detalhes — depois você pode editar tudo no painel
              lateral.
            </p>
          </div>
          <button
            onClick={requestClose}
            className="text-fg-subtle hover:text-fg p-1 rounded"
            aria-label="Fechar"
            disabled={saving}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="overflow-y-auto p-5 space-y-4">
          <fieldset disabled={saving || submitted} className="min-w-0 space-y-4">
          <div>
            <label className="block text-[11px] font-medium text-fg-muted mb-1">
              Título <span className="text-status-blocked">*</span>
            </label>
            <input
              autoFocus
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  void handleCreate();
                }
              }}
              placeholder="O que precisa ser feito?"
              className="w-full px-3 py-2 bg-bg-subtle border border-border rounded-lg text-sm font-medium"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-fg-muted mb-1">
              Descrição
            </label>
            <textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={3}
              placeholder="Contexto, critério de conclusão, links..."
              className="w-full px-3 py-2 bg-bg-subtle border border-border rounded-lg text-sm resize-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-fg-muted mb-1">
                Prioridade
              </label>
              <div className="flex gap-1">
                {PRIORIDADES.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPrioridade(p.value)}
                    className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium border transition ${
                      prioridade === p.value
                        ? "text-white border-transparent"
                        : "bg-bg-subtle border-border text-fg-muted hover:text-fg"
                    }`}
                    style={
                      prioridade === p.value
                        ? { backgroundColor: p.cor }
                        : undefined
                    }
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-fg-muted mb-1">
                Status inicial
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
                className="w-full px-2.5 py-2 bg-bg-subtle border border-border rounded-lg text-sm"
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-fg-muted mb-1">
                <Calendar className="w-3 h-3 inline mr-1" />
                Prazo
              </label>
              <div className="flex gap-1.5">
                <input
                  type="date"
                  value={prazo}
                  onChange={(e) => setPrazo(e.target.value)}
                  className="min-w-0 flex-1 px-2.5 py-2 bg-bg-subtle border border-border rounded-lg text-sm"
                />
                <input
                  type="time"
                  value={prazoHora}
                  onChange={(e) => setPrazoHora(e.target.value)}
                  disabled={!prazo}
                  placeholder="hh:mm"
                  className="w-24 px-2 py-2 bg-bg-subtle border border-border rounded-lg text-sm disabled:opacity-50"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-fg-muted mb-1">
                Coluna do Kanban
              </label>
              <select
                value={columnId}
                onChange={(e) => setColumnId(e.target.value)}
                className="w-full px-2.5 py-2 bg-bg-subtle border border-border rounded-lg text-sm"
              >
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-fg-muted mb-1.5">
              <Users className="w-3 h-3 inline mr-1" />
              Responsáveis ({responsaveis.size})
            </label>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-2 bg-bg-subtle border border-border rounded-lg">
              {users.length === 0 ? (
                <span className="text-xs text-fg-subtle">
                  Nenhum usuário ativo.
                </span>
              ) : (
                users.map((u) => {
                  const sel = responsaveis.has(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => toggleResp(u.id)}
                      className={`inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full text-[11px] font-medium border transition ${
                        sel
                          ? "bg-brand text-white border-brand"
                          : "bg-bg border-border text-fg-muted hover:text-fg hover:border-border-strong"
                      }`}
                    >
                      <span
                        className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold uppercase ${
                          sel ? "bg-white/20 text-white" : "bg-brand/20 text-brand"
                        }`}
                      >
                        {initials(u.nome)}
                      </span>
                      <span>{u.nome.split(" ")[0]}</span>
                      {sel && <Check className="w-3 h-3" />}
                    </button>
                  );
                })
              )}
            </div>
            {responsaveis.size > 0 && (
              <p className="text-[11px] text-fg-subtle mt-1">
                Primeiro selecionado vira o responsável principal.
              </p>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-medium text-fg-muted mb-1">
              Setor
            </label>
            <select
              value={sectorId}
              onChange={(e) => setSectorId(e.target.value)}
              className="w-full px-2.5 py-2 bg-bg-subtle border border-border rounded-lg text-sm"
            >
              <option value="">Nenhum</option>
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-fg-muted mb-1.5">
              <ListChecks className="w-3 h-3 inline mr-1" />
              Checklist ({checklist.length})
            </label>
            <div className="flex gap-1.5 mb-1.5">
              <input
                value={newCheck}
                onChange={(e) => setNewCheck(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCheck();
                  }
                }}
                placeholder="Adicionar item e Enter..."
                className="flex-1 px-3 py-1.5 bg-bg-subtle border border-border rounded-lg text-xs"
              />
              <button
                type="button"
                onClick={addCheck}
                disabled={!newCheck.trim()}
                className="px-2.5 py-1.5 bg-bg-subtle border border-border hover:border-border-strong disabled:opacity-50 rounded-lg text-xs"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            {checklist.length > 0 && (
              <ul className="space-y-1">
                {checklist.map((c, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 text-xs text-fg bg-bg-subtle border border-border rounded-md px-2.5 py-1.5"
                  >
                    <span className="text-fg-subtle">•</span>
                    <span className="flex-1 truncate">{c}</span>
                    <button
                      type="button"
                      onClick={() => removeCheck(i)}
                      className="text-fg-subtle hover:text-status-blocked"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          </fieldset>
          <section aria-label="Anexos" className="rounded-xl border border-dashed border-border bg-bg-subtle/40 p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-medium"><Paperclip className="w-3.5 h-3.5 inline mr-1" />Anexos ({attachments.length})</h3>
              <button type="button" disabled={saving} onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline disabled:opacity-50">
                <Upload className="w-3.5 h-3.5" /> Selecionar arquivos
              </button>
            </div>
            <p className="text-[11px] text-fg-muted">Imagens, vídeos, áudios e documentos · até 100 MB por arquivo. Vídeos maiores serão comprimidos antes do envio.</p>
            {!attachments.length && <p className="text-xs text-fg-subtle">Os arquivos serão enviados ao criar a tarefa.</p>}
            <input ref={fileInputRef} type="file" multiple accept={TASK_ATTACHMENT_ACCEPT} className="hidden" aria-label="Anexar arquivos" disabled={saving}
              onChange={(event) => { if (event.target.files) selectFiles(event.target.files); event.target.value = ""; }} />
            <ul className="space-y-2">
              {attachments.map((item) => (
                <li key={item.id} className="flex items-start gap-2 rounded-lg border border-border bg-bg px-3 py-2">
                  <Paperclip className="w-4 h-4 shrink-0 text-fg-subtle mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate" title={item.file.name}>{item.file.name}</p>
                    <p className="text-[11px] text-fg-muted">{formatFileSize(item.prepared?.size ?? item.file.size)} · {item.status === "uploaded" ? "Enviado" : item.status === "compressing" ? `Comprimindo ${Math.round((item.progress ?? 0) * 100)}%` : item.status === "uploading" ? "Enviando..." : item.status === "error" ? "Falha no envio" : "Aguardando criação"}</p>
                    {item.error && <p className="text-xs text-status-blocked mt-1 break-words">{item.error}</p>}
                  </div>
                  <button type="button" aria-label={`Pré-visualizar ${item.file.name}`} title="Pré-visualizar" onClick={() => setPreviewId(item.id)} className="p-1 text-fg-subtle hover:text-brand"><Eye className="w-3.5 h-3.5" /></button>
                  {item.status === "uploaded" ? <Check className="w-4 h-4 text-status-done shrink-0" /> : (
                    <button type="button" disabled={saving} aria-label={`Remover ${item.file.name}`} onClick={() => void removeAttachment(item)} className="p-1 text-fg-subtle hover:text-status-blocked disabled:opacity-50"><Trash2 className="w-3.5 h-3.5" /></button>
                  )}
                </li>
              ))}
            </ul>
            {activity && <p role="status" className="text-xs text-brand break-words">{activity}</p>}
          </section>
          {saveError && <p role="alert" className="text-xs text-status-blocked rounded-lg border border-status-blocked/30 p-3">{saveError}</p>}
          {confirmLeave && (
            <div role="alert" className="rounded-lg border border-border p-3 space-y-2 text-xs">
              <p>{taskCreated ? "A tarefa e os anexos enviados serão mantidos. Os arquivos e dados pendentes não serão enviados ao fechar." : "A criação foi iniciada, mas não foi confirmada. A tarefa pode já existir; confira o quadro antes de criar outra. Os arquivos pendentes não serão enviados."}</p>
              <div className="flex flex-wrap gap-3">
                <button type="button" disabled={saving} onClick={() => setConfirmLeave(false)} className="text-brand">Continuar aqui</button>
                <button type="button" disabled={saving} onClick={() => void finishWithoutPending()} className="text-fg-muted">Fechar sem enviar pendências</button>
              </div>
            </div>
          )}
        </div>

        {previewItem && previewFile && previewUrl && (
          <AttachmentPreview
            items={[{
              id: previewItem.id,
              name: previewItem.file.name,
              url: previewUrl,
              mime: previewFile.type,
              size: previewFile.size
            }]}
            index={0}
            onClose={() => setPreviewId(null)}
            allowDownload={false}
          />
        )}

        <footer className="p-3 border-t border-border flex gap-2 justify-end">
          <button
            onClick={requestClose}
            disabled={saving}
            className="px-3 py-2 text-sm text-fg-muted hover:text-fg disabled:opacity-50"
          >
            {submitted ? "Fechar" : "Cancelar"}
          </button>
          <button
            onClick={() => void handleCreate()}
            disabled={saving || !titulo.trim()}
            className="px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded-lg text-sm font-medium inline-flex items-center gap-1.5"
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            {saving ? "Salvando..." : submitted ? "Tentar novamente" : "Criar tarefa"}
          </button>
        </footer>
      </div>
    </div>
  );
}
