"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  Music,
  Paperclip,
  Trash2,
  Upload,
  Video as VideoIcon
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  deleteTaskAttachment,
  formatFileSize,
  uploadTaskAttachment
} from "@/lib/task-attachments";
import {
  prepareTaskAttachment,
  TASK_ATTACHMENT_ACCEPT
} from "@/lib/task-attachment-files";
import { downloadFile } from "@/lib/attachment-preview";
import { AttachmentPreview } from "@/components/attachments/attachment-preview";
import { useCan } from "@/components/permissions/permissions-provider";
import type { TaskAttachment } from "@/lib/types";

interface Props {
  taskId: string;
  userId: string;
}

export function TaskAttachments({ taskId, userId }: Props) {
  const [items, setItems] = useState<TaskAttachment[]>([]);
  const [uploading, setUploading] = useState<number>(0);
  const [dragOver, setDragOver] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [compressing, setCompressing] = useState<{
    name: string;
    progress: number;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Ver e baixar valem para quem enxerga a tarefa; enviar e excluir são editar.
  const canEdit = useCan("tarefas", "edit");

  // Load
  useEffect(() => {
    const supabase = createClient();
    void (async () => {
      const { data } = await supabase
        .from("task_attachments")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at", { ascending: true });
      setItems((data as TaskAttachment[]) ?? []);
    })();
    // Realtime
    const ch = supabase
      .channel(`task-att:${taskId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "task_attachments",
          filter: `task_id=eq.${taskId}`
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as TaskAttachment;
            setItems((prev) =>
              prev.some((x) => x.id === row.id) ? prev : [...prev, row]
            );
          } else if (payload.eventType === "DELETE") {
            const oldRow = payload.old as { id: string };
            setItems((prev) => prev.filter((x) => x.id !== oldRow.id));
          }
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [taskId]);

  // Se o anexo aberto some (excluído aqui ou por outra pessoa), fecha a prévia.
  useEffect(() => {
    if (previewIndex !== null && !items[previewIndex]) setPreviewIndex(null);
  }, [items, previewIndex]);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (arr.length === 0) return;
      setUploading(arr.length);
      let done = 0;
      for (const f of arr) {
        try {
          const fileToUpload = await prepareTaskAttachment(f, (progress) =>
            setCompressing({ name: f.name, progress })
          );
          setCompressing(null);
          const att = await uploadTaskAttachment(fileToUpload, {
            taskId,
            userId
          });
          setItems((prev) =>
            prev.some((x) => x.id === att.id) ? prev : [...prev, att]
          );
        } catch (err: unknown) {
          toast.error(
            `Falha no upload de "${f.name}": ${
              err instanceof Error ? err.message : "erro"
            }`
          );
        }
        setCompressing(null);
        done++;
        setUploading(arr.length - done);
      }
      setUploading(0);
    },
    [taskId, userId]
  );

  function onDragOver(e: React.DragEvent) {
    if (canEdit && e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      setDragOver(true);
    }
  }
  function onDragLeave(e: React.DragEvent) {
    // Só desativa se sair do alvo principal
    if (e.currentTarget === e.target) setDragOver(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (!canEdit) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFiles(e.dataTransfer.files);
    }
  }

  async function remove(att: TaskAttachment) {
    if (!confirm(`Remover "${att.name}"?`)) return;
    try {
      await deleteTaskAttachment(att);
      setItems((prev) => prev.filter((x) => x.id !== att.id));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Falha ao remover");
    }
  }

  async function download(att: TaskAttachment) {
    try {
      await downloadFile(att.url, att.name);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Falha ao baixar");
    }
  }

  return (
    <>
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`relative rounded-xl border-2 border-dashed transition ${
          dragOver
            ? "border-brand bg-brand-subtle/20"
            : "border-border bg-bg-subtle/40"
        }`}
      >
        {/* Galeria */}
        {items.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-2">
            {items.map((a, i) => (
              <AttachmentCard
                key={a.id}
                att={a}
                canEdit={canEdit}
                onOpen={() => setPreviewIndex(i)}
                onDownload={() => void download(a)}
                onDelete={() => void remove(a)}
              />
            ))}
          </div>
        ) : (
          <div className="p-6 text-center text-xs text-fg-muted">
            <Paperclip className="w-5 h-5 mx-auto mb-2 opacity-50" />
            Sem anexos ainda.
          </div>
        )}

        {/* Barra de ação */}
        {canEdit && (
          <div className="px-3 py-2 border-t border-border flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline"
            >
              <Upload className="w-3.5 h-3.5" /> Selecionar arquivos
            </button>
            <span className="text-[10px] text-fg-subtle">
              Imagens / vídeos / áudios / docs · vídeos &gt; 100 MB serão
              comprimidos automaticamente
            </span>
          </div>
        )}

        {compressing && (
          <div className="absolute inset-0 bg-bg/90 backdrop-blur-sm flex items-center justify-center rounded-xl pointer-events-none p-4">
            <div className="w-full max-w-xs text-center">
              <p className="text-xs font-medium text-fg">
                Comprimindo vídeo grande...
              </p>
              <p className="text-[10px] text-fg-subtle mt-0.5 truncate">
                {compressing.name}
              </p>
              <div className="mt-2 h-1.5 rounded-full bg-bg-muted overflow-hidden">
                <div
                  className="h-full bg-brand transition-[width] duration-200"
                  style={{ width: `${Math.round(compressing.progress * 100)}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] text-fg-subtle">
                {Math.round(compressing.progress * 100)}% · a compressão roda
                em tempo real
              </p>
            </div>
          </div>
        )}
        {!compressing && uploading > 0 && (
          <div className="absolute inset-0 bg-bg/80 backdrop-blur-sm flex items-center justify-center rounded-xl pointer-events-none">
            <p className="text-xs text-fg-muted">
              Enviando {uploading} arquivo(s)...
            </p>
          </div>
        )}
        {dragOver && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl pointer-events-none bg-brand/10">
            <div className="bg-bg-subtle border border-brand rounded-2xl px-6 py-4 shadow-2xl">
              <Upload className="w-7 h-7 text-brand mx-auto mb-1.5" />
              <p className="text-sm font-medium text-brand">Solte para enviar</p>
            </div>
          </div>
        )}

        {canEdit && (
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={TASK_ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        )}
      </div>

      {previewIndex !== null && items[previewIndex] && (
        <AttachmentPreview
          items={items}
          index={previewIndex}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </>
  );
}

function AttachmentCard({
  att,
  canEdit,
  onOpen,
  onDownload,
  onDelete
}: {
  att: TaskAttachment;
  canEdit: boolean;
  onOpen: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const isImage = att.type === "image";
  const isVideo = att.type === "video";
  const isAudio = att.type === "audio";
  return (
    <div className="group relative bg-bg border border-border rounded-lg overflow-hidden hover:border-border-strong transition">
      {/* Miniatura: clicar abre a pré-visualização */}
      {isImage ? (
        <button
          type="button"
          onClick={onOpen}
          className="block w-full h-28 bg-bg-muted"
          title={`Pré-visualizar ${att.name}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={att.url}
            alt={att.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </button>
      ) : isVideo ? (
        <button
          type="button"
          onClick={onOpen}
          className="block w-full h-28 bg-bg-muted relative"
          title={`Pré-visualizar ${att.name}`}
        >
          <video
            src={att.url}
            className="w-full h-full object-cover"
            preload="metadata"
            muted
          />
          <div className="absolute inset-0 flex items-center justify-center bg-fg/30">
            <div className="w-9 h-9 rounded-full bg-white/90 flex items-center justify-center shadow">
              <VideoIcon className="w-4 h-4 text-fg" />
            </div>
          </div>
        </button>
      ) : isAudio ? (
        <div className="p-2.5 bg-bg-subtle/60">
          <div className="flex items-center gap-2 mb-1.5">
            <Music className="w-4 h-4 text-brand" />
            <span className="text-[11px] font-medium truncate">{att.name}</span>
          </div>
          <audio src={att.url} controls className="w-full h-8" />
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          className="w-full flex items-center gap-2.5 p-3 text-left"
          title={`Pré-visualizar ${att.name}`}
        >
          <div className="w-10 h-10 rounded-lg bg-bg-muted text-fg-muted flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{att.name}</p>
            <p className="text-[10px] text-fg-subtle">
              {formatFileSize(att.size)}
            </p>
          </div>
        </button>
      )}

      {/* Meta + ações */}
      <div className="px-2 py-1.5 text-[10px] text-fg-subtle flex items-center justify-between gap-1 border-t border-border">
        <span className="truncate" title={att.name}>
          {isImage ? <ImageIcon className="w-3 h-3 inline mr-1" /> : null}
          {isVideo ? <VideoIcon className="w-3 h-3 inline mr-1" /> : null}
          {att.name}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onOpen}
            className="p-1 rounded hover:bg-bg-muted text-fg-muted hover:text-fg transition"
            title="Pré-visualizar"
            aria-label={`Pré-visualizar ${att.name}`}
          >
            <Eye className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={onDownload}
            className="p-1 rounded hover:bg-bg-muted text-fg-muted hover:text-fg transition"
            title="Baixar"
            aria-label={`Baixar ${att.name}`}
          >
            <Download className="w-3 h-3" />
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={onDelete}
              className="p-1 rounded hover:bg-priority-urgent/15 text-fg-muted hover:text-priority-urgent transition"
              title="Excluir"
              aria-label={`Excluir ${att.name}`}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
