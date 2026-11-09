import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

interface Props {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onChoose: (action: "quit" | "minimize") => Promise<void>;
}

export function WindowCloseDialog({ open, busy, onCancel, onChoose }: Props) {
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const minimizeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    minimizeRef.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); onCancel();
      }
      if (event.key !== "Tab") return;
      const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
      if (!buttons?.length) { event.preventDefault(); return; }
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", keydown, true);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open, onCancel]);
  if (!open) return null;
  return <div className="dialog-backdrop window-close-backdrop" onMouseDown={onCancel}>
    <div ref={dialogRef} className="confirm-dialog window-close-dialog" role="dialog" aria-modal="true"
      aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={busy}
      onMouseDown={(event) => event.stopPropagation()}>
      <div className="window-close-heading"><h3 id={`${id}-title`}>关闭还是最小化？</h3>
        <button type="button" disabled={busy} onClick={onCancel} aria-label="取消关闭"><X size={16} /></button></div>
      <p id={`${id}-description`}>最小化到托盘后，提醒和快捷键仍可使用；关闭应用将退出程序。</p>
      <div className="dialog-actions">
        <button ref={minimizeRef} type="button" disabled={busy} onClick={() => void onChoose("minimize")}>最小化到托盘</button>
        <button type="button" className="danger" disabled={busy} onClick={() => void onChoose("quit")}>关闭应用</button>
      </div>
    </div>
  </div>;
}
