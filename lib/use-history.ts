"use client";

import { useCallback, useRef, useState } from "react";

export interface HistoryAction {
  /** Refazer a ação (chamado em redo). */
  redo: () => void | Promise<void>;
  /** Desfazer a ação. */
  undo: () => void | Promise<void>;
  /** Rótulo opcional para debug/UI. */
  label?: string;
}

const MAX_HISTORY = 60;

/**
 * Hook simples de histórico de ações (undo/redo) para o mapa mental.
 *
 * O fluxo é:
 *   1. Aplique a mudança normalmente (no DB e no state).
 *   2. Chame `push({ redo, undo })` informando como repetir e como reverter.
 *   3. Botão/Atalho de undo chama `undo` e empurra a action para a redoStack.
 *   4. Botão/Atalho de redo chama `redo` e empurra de volta para undoStack.
 */
export function useHistory() {
  const undoStack = useRef<HistoryAction[]>([]);
  const redoStack = useRef<HistoryAction[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  function refreshFlags() {
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(redoStack.current.length > 0);
  }

  const push = useCallback((action: HistoryAction) => {
    undoStack.current.push(action);
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
    // Qualquer nova ação invalida o histórico de redo.
    redoStack.current = [];
    refreshFlags();
  }, []);

  const undo = useCallback(async () => {
    const a = undoStack.current.pop();
    if (!a) return;
    try {
      await a.undo();
    } catch (err) {
      console.error("[undo] erro:", err);
    }
    redoStack.current.push(a);
    refreshFlags();
  }, []);

  const redo = useCallback(async () => {
    const a = redoStack.current.pop();
    if (!a) return;
    try {
      await a.redo();
    } catch (err) {
      console.error("[redo] erro:", err);
    }
    undoStack.current.push(a);
    refreshFlags();
  }, []);

  const clear = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    refreshFlags();
  }, []);

  return { push, undo, redo, clear, canUndo, canRedo };
}
