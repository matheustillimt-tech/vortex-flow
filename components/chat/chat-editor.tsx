"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from "react";

export interface ChatEditorHandle {
  /** Serializa o conteúdo no formato @[Nome](id) / #[Título](id) para envio */
  serialize: () => string;
  /** Esvazia o editor */
  clear: () => void;
  /** Foca o editor */
  focus: () => void;
  /** Insere uma mention no cursor; substitui um trigger ativo se houver */
  insertMention: (
    kind: "user" | "task",
    id: string,
    label: string
  ) => void;
  /** Retorna o trigger ativo (@ ou #) na posição atual do cursor */
  getActiveTrigger: () => { kind: "@" | "#"; query: string } | null;
}

interface Props {
  placeholder?: string;
  onChange?: (plain: string) => void;
  onActiveTrigger?: (
    trigger: { kind: "@" | "#"; query: string } | null
  ) => void;
  onEnter?: (e: React.KeyboardEvent) => void;
  className?: string;
}

/**
 * Editor inline com chips visuais para @menções e #tarefas.
 *
 * Comportamento:
 * - Texto normal é só texto.
 * - Quando o usuário digita "@" ou "#" e começa a palavra, o componente
 *   reporta o trigger via onActiveTrigger pra abrir picker externo.
 * - Ao chamar insertMention(), substitui o trigger no cursor por um <span>
 *   estilizado contendo só "@Nome" / "#Título" e atributos data-id/data-kind.
 * - serialize() percorre o DOM e devolve a string final no formato
 *   "@[Nome](id)" / "#[Título](id)" — compatível com lib/chat.ts.
 */
export const ChatEditor = forwardRef<ChatEditorHandle, Props>(function ChatEditor(
  { placeholder, onChange, onActiveTrigger, onEnter, className },
  ref
) {
  const divRef = useRef<HTMLDivElement>(null);
  /**
   * Última seleção válida DENTRO do editor. Salva continuamente enquanto
   * o usuário digita; usada quando o picker (modal) rouba o foco e depois
   * pedimos pra inserir um chip — sem isso, window.getSelection() já não
   * está mais no editor e o insertMention falha silenciosamente.
   */
  const savedRangeRef = useRef<Range | null>(null);
  const [empty, setEmpty] = useState(true);

  /** Salva o range atual se ele está dentro do editor. */
  function captureSelection() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !divRef.current) return;
    const r = sel.getRangeAt(0);
    if (divRef.current.contains(r.startContainer)) {
      savedRangeRef.current = r.cloneRange();
    }
  }

  function serializeNode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    if (el.tagName === "BR") return "\n";
    // Mention chip
    if (el.dataset.kind && el.dataset.id) {
      const k = el.dataset.kind;
      const id = el.dataset.id;
      const label = (el.textContent ?? "").replace(/^[@#]/, "");
      return `${k === "user" ? "@" : "#"}[${label}](${id})`;
    }
    let out = "";
    for (const c of Array.from(el.childNodes)) out += serializeNode(c);
    if (el.tagName === "DIV" || el.tagName === "P") out += "\n";
    return out;
  }

  function detectTrigger(): { kind: "@" | "#"; query: string } | null {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !divRef.current) return null;
    const range = sel.getRangeAt(0);
    if (!divRef.current.contains(range.startContainer)) return null;
    // Pega texto antes do cursor no nó atual
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return null;
    const text = node.textContent ?? "";
    const offset = range.startOffset;
    let i = offset - 1;
    while (i >= 0) {
      const c = text[i];
      if (c === " " || c === "\n" || c === "\t") return null;
      if (c === "@" || c === "#") {
        const before = i > 0 ? text[i - 1] : "";
        if (i === 0 || /\s/.test(before)) {
          return {
            kind: c as "@" | "#",
            query: text.slice(i + 1, offset)
          };
        }
        return null;
      }
      i--;
    }
    return null;
  }

  /** Constrói o span do chip (com estilo por kind). */
  function buildChip(
    kind: "user" | "task",
    id: string,
    label: string
  ): HTMLSpanElement {
    const chip = document.createElement("span");
    chip.contentEditable = "false";
    chip.dataset.kind = kind;
    chip.dataset.id = id;
    chip.className =
      kind === "user"
        ? "inline-flex items-center px-1.5 py-px rounded-md bg-brand-subtle text-brand text-sm font-medium align-baseline mx-0.5"
        : "inline-flex items-center px-1.5 py-px rounded-md bg-status-progress/15 text-status-progress text-sm font-medium align-baseline mx-0.5";
    chip.textContent = `${kind === "user" ? "@" : "#"}${label}`;
    return chip;
  }

  /** Insere chip no fim do editor (último child) + espaço. */
  function appendChipAtEnd(
    kind: "user" | "task",
    id: string,
    label: string
  ) {
    if (!divRef.current) return;
    const chip = buildChip(kind, id, label);
    const space = document.createTextNode(" ");
    divRef.current.appendChild(chip);
    divRef.current.appendChild(space);
    // Move cursor pra depois do espaço
    const sel = window.getSelection();
    if (sel) {
      const after = document.createRange();
      after.setStartAfter(space);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
    }
    divRef.current.focus();
    savedRangeRef.current = null;
    emitChange();
  }

  /**
   * Insere o chip no melhor lugar possível:
   *  1) Se há um range salvo dentro do editor com um trigger @ ou #
   *     imediatamente antes do cursor → substitui o trigger pelo chip.
   *  2) Se há um range salvo mas sem trigger → insere o chip nessa
   *     posição (caso típico: usuário clicou no botão "Mencionar tarefa"
   *     na barra de ações, sem ter digitado # antes).
   *  3) Sem nada salvo → append no fim do editor.
   */
  function replaceTriggerWithChip(
    kind: "user" | "task",
    id: string,
    label: string
  ) {
    if (!divRef.current) return;
    const saved = savedRangeRef.current;
    const sel = window.getSelection();

    // Sem seleção salva → append no final.
    if (!saved || !divRef.current.contains(saved.startContainer)) {
      appendChipAtEnd(kind, id, label);
      return;
    }

    // Restaura a seleção salva
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(saved);
    }
    divRef.current.focus();

    const node = saved.startContainer;
    const offset = saved.startOffset;

    // Tenta encontrar o trigger @ / # antes do cursor no nó atual
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      let i = offset - 1;
      while (i >= 0) {
        const c = text[i];
        if (c === " " || c === "\n" || c === "\t") break;
        if (c === "@" || c === "#") {
          const r = document.createRange();
          r.setStart(node, i);
          r.setEnd(node, offset);
          r.deleteContents();
          const chip = buildChip(kind, id, label);
          const space = document.createTextNode(" ");
          r.insertNode(space);
          r.insertNode(chip);
          const after = document.createRange();
          after.setStartAfter(space);
          after.collapse(true);
          sel?.removeAllRanges();
          sel?.addRange(after);
          savedRangeRef.current = after.cloneRange();
          emitChange();
          return;
        }
        i--;
      }
    }

    // Não tinha trigger ativo → insere no ponto do cursor salvo
    const r = saved.cloneRange();
    r.deleteContents();
    const chip = buildChip(kind, id, label);
    const space = document.createTextNode(" ");
    r.insertNode(space);
    r.insertNode(chip);
    const after = document.createRange();
    after.setStartAfter(space);
    after.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(after);
    savedRangeRef.current = after.cloneRange();
    emitChange();
  }

  function emitChange() {
    const html = divRef.current?.innerHTML ?? "";
    setEmpty(!divRef.current?.textContent?.trim());
    onChange?.(divRef.current?.textContent ?? "");
    // Reporta trigger ativo
    onActiveTrigger?.(detectTrigger());
    // Salva a posição corrente do cursor (pra restaurar quando o picker
    // roubar foco e depois pedir pra inserir um chip)
    captureSelection();
    void html;
  }

  useImperativeHandle(
    ref,
    () => ({
      serialize: () => {
        if (!divRef.current) return "";
        let out = "";
        for (const c of Array.from(divRef.current.childNodes))
          out += serializeNode(c);
        return out.replace(/\n+$/, "").trim();
      },
      clear: () => {
        if (divRef.current) divRef.current.innerHTML = "";
        setEmpty(true);
      },
      focus: () => divRef.current?.focus(),
      insertMention: (kind, id, label) =>
        replaceTriggerWithChip(kind, id, label),
      getActiveTrigger: detectTrigger
    }),
    []
  );

  const onInput = useCallback(() => emitChange(), []);
  const onKeyUp = useCallback(() => {
    onActiveTrigger?.(detectTrigger());
    captureSelection();
  }, [onActiveTrigger]);
  const onMouseUp = useCallback(() => captureSelection(), []);
  const onBlur = useCallback(() => captureSelection(), []);
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onEnter?.(e);
      }
    },
    [onEnter]
  );

  // Paste como texto puro (não importar HTML formatado)
  const onPaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  }, []);

  useEffect(() => {
    // observa cliques fora pra fechar pickers (delegado ao parent via onActiveTrigger)
  }, []);

  return (
    <div className="relative w-full">
      {empty && placeholder && (
        <span className="absolute left-3 top-2 pointer-events-none text-fg-subtle text-sm">
          {placeholder}
        </span>
      )}
      <div
        ref={divRef}
        contentEditable
        suppressContentEditableWarning
        onInput={onInput}
        onKeyUp={onKeyUp}
        onKeyDown={onKeyDown}
        onMouseUp={onMouseUp}
        onBlur={onBlur}
        onPaste={onPaste}
        className={
          className ??
          "w-full min-h-[40px] max-h-32 overflow-y-auto bg-bg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        }
      />
    </div>
  );
});
