import { EyeOff, Minus, Pin, Settings } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";

interface Props { alwaysOnTop: boolean; onToggleTop: () => void; onOpenSettings: () => void; }
export function CustomTitleBar({ alwaysOnTop, onToggleTop, onOpenSettings }: Props) {
  const win = getCurrentWindow();
  const safely = (label: string, action: () => Promise<void>) => void action().catch((error) => console.error(`${label}失败:`, error));
  const hideToTray = async () => {
    await win.hide();
    await invoke("set_background_visible", { visible: false });
  };
  return <header className="titlebar" data-tauri-drag-region>
    <div className="app-title" data-tauri-drag-region><span className="brand-dot" />桌面便签</div>
    <div className="window-actions">
      <button type="button" className={alwaysOnTop ? "active" : ""} onClick={onToggleTop}
        aria-label={alwaysOnTop ? "取消始终置顶" : "始终置顶"} aria-pressed={alwaysOnTop}
        title={alwaysOnTop ? "取消始终置顶" : "始终置顶"}><Pin size={15} /></button>
      <button type="button" onClick={onOpenSettings} aria-label="打开设置" title="设置"><Settings size={16} /></button>
      <button type="button" onClick={() => safely("最小化窗口", () => win.minimize())} aria-label="最小化窗口" title="最小化"><Minus size={17} /></button>
      <button type="button" onClick={() => safely("隐藏窗口", hideToTray)} aria-label="隐藏到托盘" title="隐藏到托盘"><EyeOff size={16} /></button>
    </div>
  </header>;
}
