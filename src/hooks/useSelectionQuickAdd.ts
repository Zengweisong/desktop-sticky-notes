import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { NoteInput } from "../types/note";
import { localDateKey } from "../services/noteDateService";

interface Options {
  disabled?: boolean;
  categoryId: number | null;
  boardColumnId: string;
  defaultToToday: boolean;
  onAdd: (input: NoteInput) => Promise<boolean>;
  onFocus: () => Promise<void>;
  onSuccess: (source: "selection" | "clipboard") => void;
  onError: (message: string) => void;
}

export function useSelectionQuickAdd(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const busy = useRef(false);

  // Keep the callback stable so changing a category or adding an item does not
  // unregister the global shortcut. Read the current defaults on each invocation.
  return useCallback(async () => {
    if (busy.current || latest.current.disabled) return;
    busy.current = true;
    try {
      let captured: { text: string; source: "selection" | "clipboard" } | null = null;
      try {
        captured = await invoke("capture_quick_add_text");
      } catch {
        await latest.current.onFocus();
        latest.current.onError("无法读取选区或剪贴板文字，请在输入框中手动添加");
        return;
      }
      const current = latest.current;
      if (current.disabled) return;
      const title = captured?.text.trim();
      if (title) {
        const added = await current.onAdd({
          title,
          categoryId: current.categoryId,
          boardColumnId: current.boardColumnId,
          scheduledDate: current.defaultToToday ? localDateKey(new Date()) : null,
          scheduledTime: null,
          reminderEnabled: false,
          repeatEnabled: false
        });
        await current.onFocus();
        if (added) current.onSuccess(captured!.source);
        else current.onError("快捷添加未成功，请重试");
      } else {
        await current.onFocus();
      }
    } finally {
      busy.current = false;
    }
  }, []);
}
