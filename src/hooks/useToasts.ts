import { useCallback, useEffect, useRef, useState } from "react";
import type { ToastItem } from "../components/Toast";

type UndoAction = { noteId: number; run: () => Promise<boolean> };

export function useToasts() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const pendingUndo = useRef<(UndoAction & { id: number }) | null>(null);

  const dismiss = useCallback((id: number) => {
    if (pendingUndo.current?.id === id) pendingUndo.current = null;
    setItems((items) => items.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback((message: string, type: ToastItem["type"] = "success", action?: UndoAction) => {
    const id = ++nextId.current;
    const replaced = action ? pendingUndo.current?.id : undefined;
    if (action) pendingUndo.current = { ...action, id };
    setItems((items) => [...items.filter((item) => item.id !== replaced), { id, message, type, canUndo: Boolean(action) }]);
    window.setTimeout(() => dismiss(id), action ? 5000 : 3200);
  }, [dismiss]);

  const undo = useCallback((id: number) => {
    const action = pendingUndo.current;
    if (!action || action.id !== id) return;
    dismiss(id);
    void action.run();
  }, [dismiss]);

  const dismissUndoForNote = (noteId: number) => {
    const action = pendingUndo.current;
    if (action?.noteId === noteId) dismiss(action.id);
  };

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const action = pendingUndo.current;
      if (!action || event.defaultPrevented || event.repeat || event.isComposing || event.shiftKey || event.altKey
        || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true']"))) return;
      event.preventDefault();
      undo(action.id);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [undo]);

  return { items, toast, dismiss, undo, dismissUndoForNote };
}
