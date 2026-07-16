import { useState } from "react";
import { Download, Keyboard, Moon, Sun, Trash2, Upload, X } from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { AppSettings, ThemeName } from "../types/settings";
import { exportNotes, importNotes } from "../services/noteService";
import { ConfirmDialog } from "./ConfirmDialog";
import { OpacitySlider } from "./OpacitySlider";

interface Props {
  open: boolean; settings: AppSettings; completedCount: number; onClose: () => void;
  onUpdate: (patch: Partial<AppSettings>) => Promise<void>; onClearCompleted: () => Promise<boolean>;
  onLaunchOnStartupChange: (enabled: boolean) => Promise<boolean>;
  onShortcutChange: (shortcut: string) => Promise<boolean>;
  onImported: () => Promise<void>; toast: (message: string, type?: "success" | "error") => void;
}
const themes: Array<{ value: ThemeName; label: string; icon: typeof Sun }> = [
  { value: "warm", label: "暖黄色便签", icon: Sun },
  { value: "light", label: "浅色玻璃", icon: Sun },
  { value: "dark", label: "深色玻璃", icon: Moon }
];

export function SettingsDrawer(props: Props) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [recordingShortcut, setRecordingShortcut] = useState(false);
  const [shortcutBusy, setShortcutBusy] = useState(false);

  const exportData = async () => {
    if (fileBusy) return; setFileBusy(true);
    try {
      const path = await save({ defaultPath: `桌面便签-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (path) { await writeTextFile(path, JSON.stringify(await exportNotes(), null, 2)); props.toast("数据已导出"); }
    } catch (error) { console.error("导出数据失败:", error); props.toast("导出数据失败", "error"); }
    finally { setFileBusy(false); }
  };
  const importData = async () => {
    if (fileBusy) return; setFileBusy(true);
    try {
      const path = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (typeof path === "string") {
        const raw = await readTextFile(path);
        let data: unknown;
        try { data = JSON.parse(raw); } catch { throw new Error("导入文件不是有效的 JSON"); }
        await importNotes(data); await props.onImported(); props.toast("数据已安全导入");
      }
    } catch (error) { console.error("导入数据失败:", error); props.toast(error instanceof Error ? error.message : "导入失败", "error"); }
    finally { setFileBusy(false); }
  };

  return <>
    <div className={`drawer-backdrop ${props.open ? "visible" : ""}`} onClick={props.onClose} />
    <aside className={`settings-drawer ${props.open ? "open" : ""}`} aria-hidden={!props.open}>
      <div className="drawer-header"><div><h2>设置</h2><p>让便签更适合你的桌面</p></div><button onClick={props.onClose}><X size={18} /></button></div>
      <div className="drawer-content">
        <OpacitySlider value={props.settings.opacity} onChange={(opacity) => void props.onUpdate({ opacity })} />
        <div className="setting-block"><div className="setting-heading"><span>主题</span></div>
          <div className="theme-options">{themes.map(({ value, label, icon: Icon }) => <button key={value}
            className={`theme-option theme-${value} ${props.settings.theme === value ? "selected" : ""}`}
            onClick={() => void props.onUpdate({ theme: value })}><Icon size={15} /><span>{label}</span></button>)}</div>
        </div>
        <div className="setting-list">
          <Toggle label="始终置顶" checked={props.settings.alwaysOnTop} onChange={(alwaysOnTop) => void props.onUpdate({ alwaysOnTop })} />
          <Toggle label="开机自动启动" checked={props.settings.launchOnStartup} onChange={(enabled) => void props.onLaunchOnStartupChange(enabled)} />
          <Toggle label="应用启动时显示窗口" checked={props.settings.showOnStartup} onChange={(showOnStartup) => void props.onUpdate({ showOnStartup })} />
          <Toggle label="显示已完成事项" checked={props.settings.showCompleted} onChange={(showCompleted) => void props.onUpdate({ showCompleted })} />
        </div>
        <button className={`shortcut-card ${recordingShortcut ? "recording" : ""}`} type="button"
          disabled={shortcutBusy} onClick={() => setRecordingShortcut(true)}
          onBlur={() => setRecordingShortcut(false)} onKeyDown={(event) => {
            if (!recordingShortcut) return;
            event.preventDefault(); event.stopPropagation();
            if (event.key === "Escape") { setRecordingShortcut(false); return; }
            const shortcut = shortcutFromKeyboardEvent(event);
            if (!shortcut) return;
            setShortcutBusy(true);
            void props.onShortcutChange(shortcut).then((ok) => { if (ok) setRecordingShortcut(false); }).finally(() => setShortcutBusy(false));
          }}>
          <Keyboard size={18} /><div><strong>快速呼出</strong><span>{recordingShortcut ? "请按新的组合键，Esc 取消" : "点击后录入自定义快捷键"}</span></div>
          <span className="shortcut-keys">{(recordingShortcut ? ["等待按键…"] : props.settings.shortcut.split("+")).map((key, index) =>
            <span className="shortcut-key-part" key={`${key}-${index}`}><kbd>{key}</kbd>{index < (recordingShortcut ? 0 : props.settings.shortcut.split("+").length - 1) && <b>+</b>}</span>)}</span>
        </button>
        <div className="data-actions">
          <button disabled={fileBusy} onClick={() => void exportData()}><Download size={16} />导出数据</button>
          <button disabled={fileBusy} onClick={() => void importData()}><Upload size={16} />导入数据</button>
          <button className="clear-button" disabled={!props.completedCount} onClick={() => setConfirmClear(true)}><Trash2 size={16} />清空已完成 <span>{props.completedCount || ""}</span></button>
        </div>
      </div>
    </aside>
    <ConfirmDialog open={confirmClear} title="清空已完成事项？" message={`将永久删除 ${props.completedCount} 条已完成事项。`} confirmText="清空"
      onCancel={() => setConfirmClear(false)} onConfirm={() => { void props.onClearCompleted(); setConfirmClear(false); }} />
  </>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="toggle-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><i /></label>;
}

export function shortcutFromKeyboardEvent(event: Pick<React.KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "code">): string | null {
  const modifiers = [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Super"].filter(Boolean) as string[];
  if (!event.ctrlKey && !event.altKey && !event.metaKey) return null;
  let key = "";
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
  else if (/^F(?:[1-9]|1[0-2])$/.test(event.code)) key = event.code;
  else if (event.code === "Space") key = "Space";
  if (!key) return null;
  return [...modifiers, key].join("+");
}
