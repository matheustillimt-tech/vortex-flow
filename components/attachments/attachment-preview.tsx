"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  X
} from "lucide-react";
import { toast } from "sonner";
import {
  downloadFile,
  previewKind,
  TEXT_PREVIEW_MAX_BYTES,
  type PreviewKind
} from "@/lib/attachment-preview";
import { formatFileSize } from "@/lib/task-attachments";

export interface PreviewItem {
  id: string;
  name: string;
  /** URL pública do anexo, ou um endereço local (blob:) para arquivo ainda não enviado. */
  url: string;
  mime?: string | null;
  type?: string | null;
  size?: number | null;
}

interface Props {
  items: PreviewItem[];
  index: number;
  onClose: () => void;
  /** Com mais de um item, habilita ← → e os botões de navegação. */
  onIndexChange?: (index: number) => void;
  /** Baixar e abrir em nova aba valem para anexos enviados, não para o arquivo local. */
  allowDownload?: boolean;
}

/**
 * Pré-visualização de anexos em tela cheia: imagem, vídeo, áudio, PDF e texto.
 * Os demais tipos mostram um aviso com a opção de baixar.
 */
export function AttachmentPreview({
  items,
  index,
  onClose,
  onIndexChange,
  allowDownload = true
}: Props) {
  const item = items[index];
  const [baixando, setBaixando] = useState(false);
  const navegavel = items.length > 1 && !!onIndexChange;

  const irPara = useCallback(
    (delta: number) => {
      if (!navegavel || !onIndexChange) return;
      onIndexChange((index + delta + items.length) % items.length);
    },
    [navegavel, onIndexChange, index, items.length]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" && e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      // Em captura, antes de modais e painéis por baixo: o Esc fecha só a
      // pré-visualização, e não a tarefa que está sendo criada ou editada.
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") onClose();
      else irPara(e.key === "ArrowRight" ? 1 : -1);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, irPara]);

  if (!item) return null;
  const kind = previewKind(item);

  async function baixar() {
    setBaixando(true);
    try {
      await downloadFile(item.url, item.name);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao baixar");
    } finally {
      setBaixando(false);
    }
  }

  const detalhes = [
    formatFileSize(item.size),
    navegavel ? `${index + 1} de ${items.length}` : null
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Pré-visualização de ${item.name}`}
      className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-sm flex flex-col animate-fadeIn"
      onClick={onClose}
    >
      <header
        className="flex items-center gap-2 px-4 py-3 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate" title={item.name}>
            {item.name}
          </p>
          {detalhes && <p className="text-[11px] text-white/60">{detalhes}</p>}
        </div>
        {allowDownload && (
          <>
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-xs"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Abrir em nova aba
            </a>
            <button
              type="button"
              onClick={() => void baixar()}
              disabled={baixando}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/15 hover:bg-white/25 text-xs disabled:opacity-60"
            >
              {baixando ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              Baixar
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar pré-visualização"
          className="p-1.5 rounded-md hover:bg-white/15"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="relative flex-1 min-h-0 flex items-center justify-center gap-2 px-4 pb-4">
        {navegavel && (
          <button
            type="button"
            aria-label="Anexo anterior"
            onClick={(e) => {
              e.stopPropagation();
              irPara(-1);
            }}
            className="shrink-0 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        <div
          className="flex-1 min-w-0 max-w-5xl h-full flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          <Conteudo
            key={item.id}
            item={item}
            kind={kind}
            allowDownload={allowDownload}
            baixando={baixando}
            onDownload={() => void baixar()}
          />
        </div>
        {navegavel && (
          <button
            type="button"
            aria-label="Próximo anexo"
            onClick={(e) => {
              e.stopPropagation();
              irPara(1);
            }}
            className="shrink-0 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}

function Conteudo({
  item,
  kind,
  allowDownload,
  baixando,
  onDownload
}: {
  item: PreviewItem;
  kind: PreviewKind;
  allowDownload: boolean;
  baixando: boolean;
  onDownload: () => void;
}) {
  switch (kind) {
    case "image":
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.url}
          alt={item.name}
          className="max-w-full max-h-full object-contain rounded-lg"
        />
      );
    case "video":
      return <video src={item.url} controls className="max-w-full max-h-full rounded-lg" />;
    case "audio":
      return (
        <div className="w-full max-w-md rounded-xl bg-white/10 p-6">
          <audio src={item.url} controls className="w-full" />
        </div>
      );
    case "pdf":
      return (
        <iframe src={item.url} title={item.name} className="w-full h-full rounded-lg bg-white" />
      );
    case "text":
      return <TextoPreview url={item.url} />;
    default:
      return (
        <div className="text-center text-white/80 space-y-3">
          <FileText className="w-10 h-10 mx-auto opacity-60" />
          <p className="text-sm">Pré-visualização indisponível para este tipo de arquivo.</p>
          {allowDownload && (
            <button
              type="button"
              onClick={onDownload}
              disabled={baixando}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/15 hover:bg-white/25 text-xs text-white disabled:opacity-60"
            >
              <Download className="w-3.5 h-3.5" /> Baixar para abrir
            </button>
          )}
        </div>
      );
  }
}

function TextoPreview({ url }: { url: string }) {
  const [estado, setEstado] = useState<
    | { status: "carregando" }
    | { status: "ok"; texto: string; cortado: boolean }
    | { status: "erro" }
  >({ status: "carregando" });

  useEffect(() => {
    let ativo = true;
    setEstado({ status: "carregando" });
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.arrayBuffer();
      })
      .then((buffer) => {
        const cortado = buffer.byteLength > TEXT_PREVIEW_MAX_BYTES;
        const texto = new TextDecoder("utf-8").decode(buffer.slice(0, TEXT_PREVIEW_MAX_BYTES));
        if (ativo) setEstado({ status: "ok", texto, cortado });
      })
      .catch(() => {
        if (ativo) setEstado({ status: "erro" });
      });
    return () => {
      ativo = false;
    };
  }, [url]);

  if (estado.status === "carregando") {
    return <Loader2 className="w-6 h-6 text-white/70 animate-spin" />;
  }
  if (estado.status === "erro") {
    return <p className="text-sm text-white/80">Não foi possível carregar o conteúdo do arquivo.</p>;
  }
  return (
    <div className="w-full h-full flex flex-col rounded-lg bg-bg overflow-hidden">
      {estado.cortado && (
        <p className="px-4 py-2 text-[11px] text-fg-muted border-b border-border">
          Mostrando só o primeiro 1 MB. Baixe o arquivo para ver tudo.
        </p>
      )}
      <pre className="flex-1 overflow-auto p-4 text-xs text-fg whitespace-pre-wrap break-words">
        {estado.texto}
      </pre>
    </div>
  );
}
