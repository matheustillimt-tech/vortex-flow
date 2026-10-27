/**
 * Regras da pré-visualização de anexos: o que dá para mostrar no navegador e
 * como baixar mantendo o nome original.
 */

export type PreviewKind = "image" | "video" | "audio" | "pdf" | "text" | "none";

/** Texto maior que isso é mostrado só no começo, com aviso. */
export const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;

const TEXT_EXTENSIONS = new Set(["txt", "csv", "md", "json", "log"]);

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

/**
 * Decide como pré-visualizar. Word, Excel, PowerPoint, zip e rar ficam em
 * "none": o navegador não os abre sozinho, e visualizadores online exigiriam
 * enviar os arquivos da empresa a terceiros.
 */
export function previewKind(att: {
  name: string;
  mime?: string | null;
  type?: string | null;
}): PreviewKind {
  const mime = (att.mime ?? "").toLowerCase();
  const ext = extensionOf(att.name);

  if (att.type === "image" || mime.startsWith("image/")) return "image";
  if (att.type === "video" || mime.startsWith("video/")) return "video";
  if (att.type === "audio" || mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.startsWith("text/") || TEXT_EXTENSIONS.has(ext)) return "text";
  return "none";
}

/**
 * Baixa com o nome original.
 *
 * O atributo `download` de um link é ignorado para arquivos de outro domínio —
 * e os anexos ficam no storage do Supabase. Então o conteúdo é buscado e o
 * download sai de um endereço local, onde o nome é respeitado.
 */
export async function downloadFile(url: string, name: string): Promise<void> {
  const resposta = await fetch(url);
  if (!resposta.ok) throw new Error(`Não foi possível baixar "${name}" (${resposta.status})`);
  const blob = await resposta.blob();
  const local = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = local;
    link.download = name;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Dá tempo ao navegador de iniciar o download antes de liberar a memória.
    setTimeout(() => URL.revokeObjectURL(local), 1000);
  }
}
