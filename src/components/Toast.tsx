import { CheckCircle2, CircleAlert, X } from "lucide-react";
export type ToastItem = { id: number; message: string; type: "success" | "error" };
export function Toast({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  return <div className="toast-region" aria-live="polite">{items.map((item) =>
    <div className={`toast ${item.type}`} key={item.id}>
      {item.type === "success" ? <CheckCircle2 size={17} /> : <CircleAlert size={17} />}
      <span>{item.message}</span><button onClick={() => onDismiss(item.id)}><X size={14} /></button>
    </div>
  )}</div>;
}
