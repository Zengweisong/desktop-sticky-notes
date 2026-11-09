import { Pin, Settings, Sparkles, X } from "lucide-react";

interface Props {
  alwaysOnTop: boolean; onToggleTop: () => void; onOpenSettings: () => void; onOpenDailySummary: () => void; onRequestClose: () => void;
}
export function CustomTitleBar({ alwaysOnTop, onToggleTop, onOpenSettings, onOpenDailySummary, onRequestClose }: Props) {
  return <header className="titlebar" data-tauri-drag-region>
    <div className="window-actions">
      <button type="button" onClick={onOpenDailySummary} aria-label="AI 日报" title="AI 日报"><Sparkles size={16} /></button>
      <button type="button" className={alwaysOnTop ? "active" : ""} onClick={onToggleTop}
        aria-label={alwaysOnTop ? "取消始终置顶" : "始终置顶"} aria-pressed={alwaysOnTop}
        title={alwaysOnTop ? "取消始终置顶" : "始终置顶"}><Pin size={15} /></button>
      <button type="button" onClick={onOpenSettings} aria-label="打开设置" title="设置"><Settings size={16} /></button>
      <button type="button" onClick={onRequestClose} aria-label="关闭窗口" title="关闭"><X size={17} /></button>
    </div>
  </header>;
}
