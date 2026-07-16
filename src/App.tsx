import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow, availableMonitors, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { CategoryManager } from "./components/CategoryManager";
import { CategoryNav } from "./components/CategoryNav";
import { CustomTitleBar } from "./components/CustomTitleBar";
import { NoteList } from "./components/NoteList";
import { QuickInput } from "./components/QuickInput";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { Toast, type ToastItem } from "./components/Toast";
import { useCategories } from "./hooks/useCategories";
import { useNotes } from "./hooks/useNotes";
import { useSettings } from "./hooks/useSettings";
import { initializeDatabase } from "./services/database";
import { saveSettings } from "./services/settingsService";
import { startBackgroundTaskService } from "./services/backgroundTaskService";
import { useSettingsStore } from "./stores/settingsStore";
import { categoryIdFromFilter, type NoteFilter } from "./types/filter";
import type { Note } from "./types/note";

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [filter, setFilter] = useState<NoteFilter>("all");
  const [quickCategoryId, setQuickCategoryId] = useState<number | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [ready, setReady] = useState(false);
  const toastId = useRef(0);
  const activeShortcut = useRef<string | null>(null);
  const toast = useCallback((message: string, type: "success" | "error" = "success") => {
    const id = ++toastId.current;
    setToasts((items) => [...items, { id, message, type }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 3200);
  }, []);
  const errorToast = useCallback((message: string) => toast(message, "error"), [toast]);
  const notes = useNotes(errorToast);
  const categories = useCategories(errorToast, notes.refresh);
  const prefs = useSettings(errorToast);
  const win = useMemo(() => getCurrentWindow(), []);

  const focusQuickInput = useCallback(async () => {
    try {
      await win.show(); await win.unminimize(); await win.setFocus();
      await invoke("set_background_visible", { visible: true });
      window.dispatchEvent(new Event("focus-quick-input"));
    } catch (error) { console.error("显示快速添加窗口失败:", error); toast("无法显示便签窗口", "error"); }
  }, [toast, win]);

  const refreshAll = useCallback(async () => {
    await Promise.all([notes.refresh(), categories.refresh()]);
  }, [notes.refresh, categories.refresh]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Clear both the host window and WebView2 backing surface.
        await getCurrentWebviewWindow().setBackgroundColor([0, 0, 0, 0]);
        await initializeDatabase();
        await prefs.load();
        if (cancelled) return;
        const current = useSettingsStore.getState().settings;
        await restoreWindow(win, current.window);
        await Promise.all([categories.refresh(), notes.refresh()]);
        if (!current.showOnStartup) {
          await win.hide();
          await invoke("set_background_visible", { visible: false });
        }
      } catch (error) {
        console.error("应用初始化失败:", error);
        errorToast(error instanceof Error ? error.message : "应用初始化失败");
      } finally { if (!cancelled) setReady(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    return startBackgroundTaskService(notes.refresh, errorToast);
  }, [ready, notes.refresh, errorToast]);

  useEffect(() => {
    const focusNote = (event: Event) => {
      const id = (event as CustomEvent<number>).detail;
      setFilter("all");
      void notes.refresh().then(() => window.setTimeout(() => {
        const card = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
        card?.scrollIntoView({ behavior: "smooth", block: "center" });
        card?.classList.add("notification-focus");
        window.setTimeout(() => card?.classList.remove("notification-focus"), 2200);
      }, 60));
    };
    window.addEventListener("focus-note", focusNote);
    return () => window.removeEventListener("focus-note", focusNote);
  }, [notes.refresh]);

  useEffect(() => {
    if (categories.categories.length && (quickCategoryId == null || !categories.categories.some((category) => category.id === quickCategoryId))) {
      setQuickCategoryId(categories.categories.find((category) => category.isSystem)?.id ?? categories.categories[0].id);
    }
    const selectedId = categoryIdFromFilter(filter);
    if (selectedId != null && !categories.categories.some((category) => category.id === selectedId)) setFilter("all");
  }, [categories.categories, filter, quickCategoryId]);

  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    const shortcut = useSettingsStore.getState().settings.shortcut;
    void register(shortcut, (event) => { if (event.state === "Pressed") void focusQuickInput(); }).then(() => {
      if (!disposed) activeShortcut.current = shortcut;
    }).catch((error) => {
      console.error(`全局快捷键 ${shortcut} 注册失败:`, error);
      if (!disposed) errorToast("快捷键被占用，可从托盘使用快速添加");
    });
    return () => {
      disposed = true;
      const current = activeShortcut.current;
      activeShortcut.current = null;
      if (current) void unregister(current).catch((error) => console.error("注销全局快捷键失败:", error));
    };
  }, [ready, errorToast, focusQuickInput]);

  useEffect(() => {
    if (!ready) return;
    void isAutostartEnabled().then((enabled) => {
      if (enabled !== useSettingsStore.getState().settings.launchOnStartup) void prefs.update({ launchOnStartup: enabled });
    }).catch((error) => console.error("读取开机启动状态失败:", error));
  }, [ready, prefs.update]);

  useEffect(() => {
    if (!ready) return;
    void invoke("set_background_appearance", {
      opacity: prefs.settings.opacity,
      theme: prefs.settings.theme,
      alwaysOnTop: prefs.settings.alwaysOnTop
    }).catch((error) => console.error("更新原生背景透明度失败:", error));
  }, [ready, prefs.settings.opacity, prefs.settings.theme, prefs.settings.alwaysOnTop]);

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    let timer: number | undefined;
    const persistBounds = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        try {
          const [position, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
          const current = useSettingsStore.getState().settings;
          const next = { ...current, window: { x: position.x, y: position.y, width: size.width, height: size.height } };
          useSettingsStore.getState().setSettings(next);
          await saveSettings(next);
        } catch (error) { console.error("保存窗口位置和尺寸失败:", error); }
      }, 350);
    };
    void win.onMoved(persistBounds).then((fn) => cleanups.push(fn));
    void win.onResized(persistBounds).then((fn) => cleanups.push(fn));
    void listen<string>("tray-action", (event) => {
      if (event.payload === "show" || event.payload === "quick-add") void focusQuickInput();
      if (event.payload === "settings") { void focusQuickInput(); setCategoriesOpen(false); setSettingsOpen(true); }
      if (event.payload === "toggle-top") void toggleAlwaysOnTop();
    }).then((fn) => cleanups.push(fn));
    return () => { window.clearTimeout(timer); cleanups.forEach((fn) => fn()); };
  }, [focusQuickInput, win]);

  const updateSettings = useCallback(async (patch: Parameters<typeof prefs.update>[0]) => {
    await prefs.update(patch);
  }, [prefs.update]);
  const toggleAlwaysOnTop = useCallback(() => {
    void updateSettings({ alwaysOnTop: !useSettingsStore.getState().settings.alwaysOnTop });
  }, [updateSettings]);
  const changeLaunchOnStartup = useCallback(async (enabled: boolean) => {
    try {
      if (enabled) await enableAutostart(); else await disableAutostart();
      await prefs.update({ launchOnStartup: enabled });
      toast(enabled ? "已设置开机自动启动" : "已关闭开机自动启动");
      return true;
    } catch (error) {
      console.error("更新开机启动状态失败:", error); errorToast("更新开机启动状态失败"); return false;
    }
  }, [errorToast, prefs.update, toast]);
  const changeShortcut = useCallback(async (shortcut: string) => {
    const previous = activeShortcut.current;
    if (shortcut === previous) return true;
    try {
      if (previous) await unregister(previous);
      await register(shortcut, (event) => { if (event.state === "Pressed") void focusQuickInput(); });
      activeShortcut.current = shortcut;
      await prefs.update({ shortcut });
      toast(`呼出快捷键已改为 ${shortcut}`);
      return true;
    } catch (error) {
      console.error(`注册全局快捷键 ${shortcut} 失败:`, error);
      if (previous) {
        try {
          await register(previous, (event) => { if (event.state === "Pressed") void focusQuickInput(); });
          activeShortcut.current = previous;
        } catch (restoreError) { console.error("恢复原快捷键失败:", restoreError); activeShortcut.current = null; }
      }
      errorToast("快捷键无效或已被其他程序占用"); return false;
    }
  }, [errorToast, focusQuickInput, prefs.update, toast]);
  const changeFilter = (next: NoteFilter) => {
    setFilter(next);
    const categoryId = categoryIdFromFilter(next);
    if (categoryId != null) setQuickCategoryId(categoryId);
  };
  const visibleNotes = filterNotes(notes.notes, filter, prefs.settings.showCompleted);

  return <main className={`app-shell theme-${prefs.settings.theme}`}
    style={{ "--panel-opacity": String(prefs.settings.opacity / 100) } as React.CSSProperties}>
    <section className="panel">
      <CustomTitleBar alwaysOnTop={prefs.settings.alwaysOnTop} onToggleTop={toggleAlwaysOnTop}
        onOpenSettings={() => { setCategoriesOpen(false); setSettingsOpen(true); }} />
      <div className="quick-area"><QuickInput categories={categories.categories} categoryId={quickCategoryId}
        onCategoryChange={setQuickCategoryId} onAdd={notes.add} /></div>
      <CategoryNav categories={categories.categories} notes={notes.notes} active={filter} onChange={changeFilter}
        onManage={() => { setSettingsOpen(false); setCategoriesOpen(true); }} />
      <div className="list-area">
        {!ready ? <div className="loading-state"><span /><span /><span /></div> :
          <NoteList notes={visibleNotes} categories={categories.categories} repeatSeries={notes.repeatSeries}
            loading={notes.loading || categories.loading}
            onToggleCompleted={(note) => notes.toggleCompleted(note.id, !note.completed)}
            onTogglePinned={(note) => notes.togglePinned(note.id, !note.pinned)} onEdit={notes.edit}
            onToggleRepeatActive={(series) => notes.toggleRepeatActive(series.id, !series.active)}
            onMove={notes.move} onDelete={notes.remove} />}
      </div>
      <footer><span>{visibleNotes.length} 项 · {notes.notes.filter((note) => !note.completed).length} 项待办</span>
        <button onClick={() => { setCategoriesOpen(false); setSettingsOpen(true); }}>个性化</button></footer>
    </section>
    <CategoryManager open={categoriesOpen} categories={categories.categories} onClose={() => setCategoriesOpen(false)}
      onCreate={categories.create} onUpdate={categories.update} onMove={categories.move} onDelete={categories.remove} countNotes={categories.countNotes} />
    <SettingsDrawer open={settingsOpen} settings={prefs.settings} completedCount={notes.notes.filter((note) => note.completed).length}
      onClose={() => setSettingsOpen(false)} onUpdate={updateSettings} onClearCompleted={notes.clearCompleted}
      onLaunchOnStartupChange={changeLaunchOnStartup} onShortcutChange={changeShortcut}
      onImported={refreshAll} toast={toast} />
    <Toast items={toasts} onDismiss={(id) => setToasts((items) => items.filter((item) => item.id !== id))} />
  </main>;
}

function filterNotes(notes: Note[], filter: NoteFilter, showCompleted: boolean) {
  if (filter === "completed") return notes.filter((note) => note.completed);
  if (filter === "active") return notes.filter((note) => !note.completed);
  const today = localDateKey(new Date());
  if (filter === "today") return notes.filter((note) =>
    (note.scheduledAt ? localDateKey(new Date(note.scheduledAt)) : note.dueAt?.slice(0, 10)) === today &&
    (showCompleted || !note.completed));
  const categoryId = categoryIdFromFilter(filter);
  if (categoryId != null) return notes.filter((note) => note.categoryId === categoryId && (showCompleted || !note.completed));
  return showCompleted ? notes : notes.filter((note) => !note.completed);
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function restoreWindow(win: ReturnType<typeof getCurrentWindow>, state: { x: number | null; y: number | null; width: number; height: number }) {
  try {
    const width = Math.max(300, state.width); const height = Math.max(320, state.height);
    await win.setSize(new PhysicalSize(width, height));
    const monitors = await availableMonitors();
    const valid = state.x !== null && state.y !== null && monitors.some((monitor) =>
      state.x! + 80 >= monitor.position.x && state.y! + 50 >= monitor.position.y &&
      state.x! < monitor.position.x + monitor.size.width && state.y! < monitor.position.y + monitor.size.height
    );
    if (valid) await win.setPosition(new PhysicalPosition(state.x!, state.y!)); else await win.center();
  } catch (error) {
    console.error("恢复窗口位置和尺寸失败，使用默认位置:", error);
    try { await win.center(); } catch { /* window may not be ready */ }
  }
}
