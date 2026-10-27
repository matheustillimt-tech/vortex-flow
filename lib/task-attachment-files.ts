import { canCompressVideo, compressVideoForUpload } from "@/lib/video-compress";

export const TASK_ATTACHMENT_ACCEPT = "image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar";
export const MAX_TASK_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export function taskAttachmentValidationError(file: File): string | null {
  const media = /^(image|video|audio)\//.test(file.type);
  const document = /\.(pdf|docx?|xlsx?|pptx?|txt|csv|zip|rar)$/i.test(file.name);
  if (!media && !document) return `Formato de "${file.name}" não suportado. Selecione imagem, vídeo, áudio ou documento.`;
  if (file.size > MAX_TASK_ATTACHMENT_BYTES) {
    if (!file.type.startsWith("video/")) return `"${file.name}" excede 100 MB. Reduza o arquivo antes de enviar.`;
    if (!canCompressVideo()) return `"${file.name}" passa de 100 MB e seu navegador não suporta compressão. Comprima antes de enviar.`;
  }
  return null;
}

/** Mesmos limites e compressão no formulário de criação e no painel da tarefa. */
export async function prepareTaskAttachment(file: File, onProgress?: (progress: number) => void): Promise<File> {
  const error = taskAttachmentValidationError(file);
  if (error) throw new Error(error);
  if (file.size <= MAX_TASK_ATTACHMENT_BYTES) return file;
  onProgress?.(0);
  const result = await compressVideoForUpload(file, {
    targetBytes: 95 * 1024 * 1024,
    maxResolution: 720,
    onProgress
  });
  if (result.blob.size > MAX_TASK_ATTACHMENT_BYTES) {
    throw new Error(`"${file.name}" ainda excede 100 MB após a compressão. Tente um trecho menor.`);
  }
  return new File([result.blob], `${file.name.replace(/\.[^.]+$/, "")}-comprimido.${result.ext}`, { type: result.mime });
}
