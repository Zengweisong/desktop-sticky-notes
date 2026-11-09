import { CheckCircle2, CircleAlert, X } from "lucide-react";
export type ToastItem = { id: number; message: string; type: "success" | "error"; canUndo: boolean };
export function Toast({ items, onDismiss, onUndo }: {
  items: ToastItem[]; onDismiss: (id: number) => void; onUndo: (id: number) => void;
}) {
  return <div className="toast-region" aria-live="polite">{items.map((item) =>
    <div className={`toast ${item.type}`} key={item.id}>
      {item.type === "success" ? <CheckCircle2 size={17} /> : <CircleAlert size={17} />}
      <span>{item.message}</span>
      <div className="toast-actions">
        {item.canUndo && <button type="button" className="toast-undo" onClick={() => onUndo(item.id)}>撤销 <kbd>Ctrl+Z</kbd></button>}
        <button type="button" aria-label="关闭提示" onClick={() => onDismiss(item.id)}><X size={14} /></button>
      </div>
    </div>
  )}</div>;
}
