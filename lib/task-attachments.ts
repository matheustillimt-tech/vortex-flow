import { createClient } from "@/lib/supabase/client";
import type { TaskAttachment, TaskAttachmentType } from "@/lib/types";

const BUCKET = "task-media";

function detectType(file: File): TaskAttachmentType {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
}

async function readMediaDimensions(file: File): Promise<{
  width?: number;
  height?: number;
  duration?: number;
}> {
  return new Promise((resolve) => {
    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({});
      };
      img.src = url;
      return;
    }
    if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
      const url = URL.createObjectURL(file);
      const media = document.createElement(
        file.type.startsWith("video/") ? "video" : "audio"
      ) as HTMLVideoElement | HTMLAudioElement;
      media.preload = "metadata";
      media.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        const out: { width?: number; height?: number; duration?: number } = {
          duration: Math.round(media.duration || 0)
        };
        if (media instanceof HTMLVideoElement) {
          out.width = media.videoWidth;
          out.height = media.videoHeight;
        }
        resolve(out);
      };
      media.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({});
      };
      media.src = url;
      return;
    }
    resolve({});
  });
}

/**
 * Faz upload de um arquivo pra task e cria a linha em task_attachments.
 * Devolve o TaskAttachment criado.
 */
type UploadArgs = { taskId: string; userId: string; attachmentId?: string };

function attachmentStoragePath(file: File, taskId: string, attachmentId: string): string {
  const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  return `${taskId}/${attachmentId}.${ext}`;
}

export async function uploadTaskAttachment(file: File, args: UploadArgs): Promise<TaskAttachment> {
  const supabase = createClient();
  const attachmentId = args.attachmentId ?? crypto.randomUUID();
  const storagePath = attachmentStoragePath(file, args.taskId, attachmentId);
  const findExisting = () => supabase.from("task_attachments").select("*")
    .eq("id", attachmentId).eq("task_id", args.taskId).maybeSingle();

  // Uma tentativa anterior pode ter sido gravada mesmo se a resposta se perdeu.
  if (args.attachmentId) {
    const existing = await findExisting();
    if (existing.error) throw existing.error;
    if (existing.data) return existing.data as TaskAttachment;
  }

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
    contentType: file.type || undefined, upsert: false, cacheControl: "31536000"
  });
  // Caminho estável por seleção: conflito significa que o mesmo envio já chegou.
  const alreadyExists = upErr && (String(upErr.statusCode) === "409" ||
    (String(upErr.statusCode) === "400" && /(?:asset|resource) already exists/i.test(upErr.message)));
  if (upErr && !(args.attachmentId && alreadyExists)) throw upErr;

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  const dims = await readMediaDimensions(file);
  let insertError: unknown;
  try {
    const { data, error } = await supabase.from("task_attachments").insert({
      id: attachmentId, task_id: args.taskId, type: detectType(file),
      url: pub.publicUrl, storage_path: storagePath, name: file.name,
      size: file.size || null, mime: file.type || null,
      duration: dims.duration ?? null, width: dims.width ?? null, height: dims.height ?? null,
      uploaded_by: args.userId
    }).select().single();
    if (data && !error) return data as TaskAttachment;
    insertError = error ?? new Error("Falha ao gravar anexo");
  } catch (error) {
    insertError = error;
  }
  // Nunca remova o objeto de um INSERT confirmado após resposta incerta.
  const existing = await findExisting();
  if (existing.error) throw new Error("Não foi possível confirmar o anexo. Tente novamente para verificar o envio.");
  if (existing.data) return existing.data as TaskAttachment;
  const cleanup = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (cleanup.error) throw new Error("O anexo não foi associado e a limpeza falhou. Tente novamente antes de fechar.");
  throw insertError;
}

/** Limpa só objetos sem linha associada ao abandonar uma seleção após falha. */
export async function discardPendingTaskAttachment(file: File, args: UploadArgs & { attachmentId: string }): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.from("task_attachments").select("id")
    .eq("id", args.attachmentId).eq("task_id", args.taskId).maybeSingle();
  if (error) throw error;
  if (data) return; // Anexo confirmado pertence à tarefa e deve permanecer.
  const removed = await supabase.storage.from(BUCKET)
    .remove([attachmentStoragePath(file, args.taskId, args.attachmentId)]);
  if (removed.error) throw removed.error;
}

/**
 * Apaga o anexo: storage + linha do banco.
 */
export async function deleteTaskAttachment(att: TaskAttachment): Promise<void> {
  const supabase = createClient();
  if (att.storage_path) {
    await supabase.storage
      .from(BUCKET)
      .remove([att.storage_path])
      .catch(() => {
        /* não bloqueia */
      });
  }
  const { error } = await supabase
    .from("task_attachments")
    .delete()
    .eq("id", att.id);
  if (error) throw error;
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes < 1) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
