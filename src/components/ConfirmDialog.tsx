interface Props { open: boolean; title: string; message: string; confirmText?: string; onConfirm: () => void; onCancel: () => void; }
export function ConfirmDialog({ open, title, message, confirmText = "删除", onConfirm, onCancel }: Props) {
  if (!open) return null;
  return <div className="dialog-backdrop" onMouseDown={onCancel}>
    <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={(e) => e.stopPropagation()}>
      <h3 id="confirm-title">{title}</h3><p>{message}</p>
      <div className="dialog-actions"><button onClick={onCancel}>取消</button><button className="danger" onClick={onConfirm}>{confirmText}</button></div>
    </div>
  </div>;
}
