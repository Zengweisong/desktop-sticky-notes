import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { register, unregister } from "./services/quickShortcutService";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { CategoryManager } from "./components/CategoryManager";
import { CategoryNav } from "./components/CategoryNav";
import { CustomTitleBar } from "./components/CustomTitleBar";
import { DailySummaryDialog } from "./components/DailySummaryDialog";
import { NoteList } from "./components/NoteList";
import { BoardView } from "./components/BoardView";
import { CalendarView } from "./components/CalendarView";
import { QuickInput } from "./components/QuickInput";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { Toast } from "./components/Toast";
import { WindowResizeHandles } from "./components/WindowResizeHandles";
import { WindowCloseDialog } from "./components/WindowCloseDialog";
import { useCategories } from "./hooks/useCategories";
import { useNotes } from "./hooks/useNotes";
import { useSettings } from "./hooks/useSettings";
import { useBoard } from "./hooks/useBoard";
import { useSelectionQuickAdd } from "./hooks/useSelectionQuickAdd";
import { useWindowClose } from "./hooks/useWindowClose";
import { useToasts } from "./hooks/useToasts";
import { initializeDatabase } from "./services/database";
import { saveSettings } from "./services/settingsService";
import {
  createWindowStateManager,
  restoreWindowState,
  type WindowStateManager
} from "./services/windowStateManager";
import { startBackgroundTaskService } from "./services/backgroundTaskService";
import { useSettingsStore } from "./stores/settingsStore";
import { useNoteStore } from "./stores/noteStore";
import type { NoteTimeFilter } from "./types/filter";
import { filterNotes } from "./services/noteFilterService";
import { localDateKey } from "./services/noteDateService";
import { TODO_COLUMN_ID } from "./types/board";
import type { Note } from "./types/note";
import type { AppSettings, ViewMode, WindowState } from "./types/settings";

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dailySummaryOpen, setDailySummaryOpen] = useState(false);
  const [shortcutRecording, setShortcutRecording] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [selectedBoardColumnId, setSelectedBoardColumnId] = useState<string | null>(null);
  const [calendarSelectedDate, setCalendarSelectedDate] = useState<string | null>(() => localDateKey(new Date()));
  const [ready, setReady] = useState(false);
  const activeShortcut = useRef<string | null>(null);
  const windowStateManager = useRef<WindowStateManager | null>(null);
  const calendarMoveVersion = useRef(0);
  const { items: toasts, toast, dismiss, undo, dismissUndoForNote } = useToasts();
  const errorToast = useCallback((message: string) => toast(message, "error"), [toast]);
  const notes = useNotes(errorToast);
  const board = useBoard(errorToast, notes.refresh);
  const categories = useCategories(errorToast, notes.refresh);
  const prefs = useSettings(errorToast);
  const quickCategoryId = prefs.settings.taskCategoryFilterId;
  const win = useMemo(() => getCurrentWindow(), []);
  const windowClose = useWindowClose({
    hideWindow: () => win.hide(),
    beforeClose: async () => { await windowStateManager.current?.flush(); },
    onError: errorToast
  });

  const focusQuickInput = useCallback(async () => {
    try {
      await win.show(); await win.unminimize(); await win.setFocus();
      await invoke("set_background_visible", { visible: true });
      window.dispatchEvent(new Event("focus-quick-input"));
    } catch (error) { console.error("显示快速添加窗口失败:", error); toast("无法显示便签窗口", "error"); }
  }, [toast, win]);

  const quickAddSelection = useSelectionQuickAdd({
    disabled: shortcutRecording,
    categoryId: quickCategoryId,
    boardColumnId: prefs.settings.viewMode === "board"
      ? board.columns.find((column) => column.id === selectedBoardColumnId && column.status !== "completed")?.id || TODO_COLUMN_ID
      : TODO_COLUMN_ID,
    defaultToToday: prefs.settings.quickAddDefaultsToToday,
    onAdd: notes.add,
    onFocus: focusQuickInput,
    onSuccess: (source) => toast(source === "clipboard" ? "已将剪贴板文字添加为事项" : "已将选中文字添加为事项"),
    onError: errorToast
  });

  const refreshAll = useCallback(async () => {
    await Promise.all([notes.refresh(), categories.refresh(), board.refresh()]);
  }, [notes.refresh, categories.refresh, board.refresh]);

  useEffect(() => {
    let cancelled = false;
    let showOnStartup = true;
    void (async () => {
      try {
        // Clear both the host window and WebView2 backing surface.
        await getCurrentWebviewWindow().setBackgroundColor([0, 0, 0, 0]);
        await initializeDatabase();
        await prefs.load();
        if (cancelled) return;
        const current = useSettingsStore.getState().settings;
        showOnStartup = current.showOnStartup;
        await invoke("set_background_appearance", {
          opacity: current.opacity,
          theme: current.theme,
          alwaysOnTop: current.alwaysOnTop
        });
        const savedForView = windowForView(current, current.viewMode);
        const restoredWindow = await restoreWindowState(win, savedForView);
        const viewPatch = windowPatchForView(current.viewMode, restoredWindow);
        const restoredSettings = { ...current, ...viewPatch, window: restoredWindow };
        useSettingsStore.getState().patchSettings({ ...viewPatch, window: restoredWindow });
        await saveSettings(restoredSettings);
        await Promise.all([categories.refresh(), notes.refresh()]);
      } catch (error) {
        console.error("应用初始化失败:", error);
        errorToast(error instanceof Error ? error.message : "应用初始化失败");
      } finally {
        if (!cancelled) {
          setReady(true);
          window.requestAnimationFrame(() => {
            if (!showOnStartup) return;
            void win.show()
              .then(() => invoke("set_background_visible", { visible: true }))
              .catch((error) => console.error("显示已恢复的窗口失败:", error));
          });
        }
      }
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
      void prefs.update({ taskTimeFilter: "all", taskCategoryFilterId: null, taskSearch: "", taskPriorityFilter: "all" });
      void notes.refresh().then(() => window.setTimeout(() => {
        const card = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
        card?.scrollIntoView({ behavior: "smooth", block: "center" });
        card?.classList.add("notification-focus");
        window.setTimeout(() => card?.classList.remove("notification-focus"), 2200);
      }, 60));
    };
    window.addEventListener("focus-note", focusNote);
    return () => window.removeEventListener("focus-note", focusNote);
  }, [notes.refresh, prefs.update]);

  useEffect(() => {
    const selectedId = prefs.settings.taskCategoryFilterId;
    if (prefs.loaded && !categories.loading && selectedId != null
      && !categories.categories.some((category) => category.id === selectedId)) {
      void prefs.update({ taskCategoryFilterId: null });
    }
  }, [categories.categories, categories.loading, prefs.loaded, prefs.settings.taskCategoryFilterId, prefs.update]);

  useEffect(() => {
    const visibleColumns = board.columns.filter((column) => prefs.settings.showCompleted || column.status !== "completed");
    if (!visibleColumns.length) return;
    if (!selectedBoardColumnId || !visibleColumns.some((column) => column.id === selectedBoardColumnId)) {
      setSelectedBoardColumnId(visibleColumns.find((column) => column.id === TODO_COLUMN_ID)?.id || visibleColumns[0].id);
    }
  }, [board.columns, selectedBoardColumnId, prefs.settings.showCompleted]);

  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    const shortcut = useSettingsStore.getState().settings.shortcut;
    void register(shortcut, (event) => { if (event.state === "Pressed") void quickAddSelection(); }).then(() => {
      if (disposed) void unregister(shortcut).catch((error) => console.error("注销全局快捷键失败:", error));
      else activeShortcut.current = shortcut;
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
  }, [ready, errorToast, quickAddSelection]);

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
    if (!ready) return;
    const manager = createWindowStateManager(
      win,
      useSettingsStore.getState().settings.window,
      async (windowState) => {
        const current = useSettingsStore.getState().settings;
        const viewPatch = windowPatchForView(current.viewMode, windowState);
        const next = { ...current, ...viewPatch, window: windowState };
        useSettingsStore.getState().patchSettings({ ...viewPatch, window: windowState });
        await saveSettings(next);
      }
    );
    windowStateManager.current = manager;
    void manager.start().catch((error) => console.error("监听窗口状态失败:", error));
    return () => {
      manager.dispose();
      if (windowStateManager.current === manager) windowStateManager.current = null;
    };
  }, [ready, win]);

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    let disposed = false;
    void listen<string>("tray-action", (event) => {
      if (event.payload === "show" || event.payload === "quick-add") void focusQuickInput();
      if (event.payload === "settings") { void focusQuickInput(); setCategoriesOpen(false); setSettingsOpen(true); }
      if (event.payload === "toggle-top") void toggleAlwaysOnTop();
      if (event.payload === "quit") {
        void (async () => {
          await windowStateManager.current?.flush();
          await invoke("quit_app");
        })().catch((error) => console.error("退出应用失败:", error));
      }
    }).then((fn) => { if (disposed) fn(); else cleanups.push(fn); });
    return () => { disposed = true; cleanups.forEach((fn) => fn()); };
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
      await register(shortcut, (event) => { if (event.state === "Pressed") void quickAddSelection(); });
      activeShortcut.current = shortcut;
      await prefs.update({ shortcut });
      toast(`呼出快捷键已改为 ${shortcut}`);
      return true;
    } catch (error) {
      console.error(`注册全局快捷键 ${shortcut} 失败:`, error);
      if (previous) {
        try {
          await register(previous, (event) => { if (event.state === "Pressed") void quickAddSelection(); });
          activeShortcut.current = previous;
        } catch (restoreError) { console.error("恢复原快捷键失败:", restoreError); activeShortcut.current = null; }
      }
      errorToast("快捷键无效或已被其他程序占用"); return false;
    }
  }, [errorToast, quickAddSelection, prefs.update, toast]);
  const changeTimeFilter = (next: NoteTimeFilter) => {
    void prefs.update({ taskTimeFilter: next });
  };
  const changeCategoryFilter = (categoryId: number | null) => {
    void prefs.update({ taskCategoryFilterId: categoryId });
  };
  const changeViewMode = useCallback(async (viewMode: ViewMode) => {
    const current = useSettingsStore.getState().settings;
    if (current.viewMode === viewMode) return;
    await windowStateManager.current?.flush();
    const latest = useSettingsStore.getState().settings;
    const target = windowForView(latest, viewMode);
    useSettingsStore.getState().patchSettings({ viewMode });
    try {
      const restored = await restoreWindowState(win, target);
      const viewPatch = windowPatchForView(viewMode, restored);
      const next = { ...useSettingsStore.getState().settings, ...viewPatch, viewMode, window: restored };
      useSettingsStore.getState().patchSettings({ ...viewPatch, viewMode, window: restored });
      await saveSettings(next);
    } catch (error) {
      errorToast(error instanceof Error ? error.message : "切换视图失败");
    }
  }, [errorToast, win]);
  const visibleNotes = filterNotes(
    notes.notes,
    prefs.settings.taskTimeFilter,
    prefs.settings.taskCategoryFilterId,
    new Date(),
    prefs.settings.taskSearch,
    prefs.settings.taskPriorityFilter
  );

  const boardPlacementUndo = (note: Note) => {
    const siblings = useNoteStore.getState().notes
      .filter((item) => item.boardColumnId === note.boardColumnId)
      .sort((left, right) => left.boardOrder - right.boardOrder);
    const index = siblings.findIndex((item) => item.id === note.id);
    const next = siblings[index + 1];
    const previous = siblings[index - 1];
    return {
      noteId: note.id,
      run: () => board.moveNote(note.id, note.boardColumnId, next?.id ?? previous?.id ?? null, next ? "before" : "after")
    };
  };

  const toggleCompleted = async (note: Note) => {
    const action = !note.completed ? boardPlacementUndo(note) : null;
    const ok = await notes.toggleCompleted(note.id, !note.completed);
    if (ok && action) toast("事项已完成", "success", action);
    if (ok && !action) dismissUndoForNote(note.id);
    return ok;
  };

  const moveBoardNote = async (id: number, columnId: string, targetId: number | null, position: "before" | "after") => {
    const note = useNoteStore.getState().notes.find((item) => item.id === id);
    const action = note && boardPlacementUndo(note);
    const completesNote = note && !note.completed && board.columns.some((column) => column.id === columnId && column.status === "completed");
    const ok = await board.moveNote(id, columnId, targetId, position);
    if (ok && action) toast(completesNote ? "事项已完成" : "事项已移动", "success", action);
    return ok;
  };

  const rescheduleCalendarNote = async (note: Note, scheduledDate: string | null) => {
    const previous = useNoteStore.getState().notes.find((item) => item.id === note.id) ?? note;
    const version = ++calendarMoveVersion.current;
    dismissUndoForNote(note.id);
    const ok = await notes.reschedule(previous, scheduledDate);
    if (ok && calendarMoveVersion.current === version) toast("已调整事项日期", "success", {
      noteId: note.id,
      run: () => notes.restoreSchedule(previous)
    });
    return ok;
  };

  return <main className={`app-shell theme-${prefs.settings.theme} font-size-${prefs.settings.fontSize} view-${prefs.settings.viewMode} ${prefs.settings.minimalMode ? "minimal-mode" : ""} ${(settingsOpen || categoriesOpen || dailySummaryOpen) ? "overlay-open" : ""}`}
    style={{ "--panel-opacity": String(prefs.settings.opacity / 100) } as React.CSSProperties}>
    <section className={`panel ${prefs.settings.viewMode === "board" ? "board-mode" : ""} ${prefs.settings.viewMode === "calendar" ? "calendar-mode" : ""}`}>
      <CustomTitleBar alwaysOnTop={prefs.settings.alwaysOnTop} onToggleTop={toggleAlwaysOnTop}
        onOpenDailySummary={() => setDailySummaryOpen(true)}
        onOpenSettings={() => { setCategoriesOpen(false); setSettingsOpen(true); }} onRequestClose={windowClose.requestClose} />
      <div className="quick-area"><QuickInput categoryId={quickCategoryId}
        defaultToToday={prefs.settings.quickAddDefaultsToToday}
        defaultDate={prefs.settings.viewMode === "calendar" ? calendarSelectedDate : undefined}
        minimal={prefs.settings.minimalMode}
        onAdd={(input) => notes.add({ ...input,
          boardColumnId: prefs.settings.viewMode === "board" ? selectedBoardColumnId || TODO_COLUMN_ID : input.boardColumnId
        })} /></div>
      <div className="list-area">
        <CategoryNav categories={categories.categories} timeFilter={prefs.settings.taskTimeFilter}
          categoryId={prefs.settings.taskCategoryFilterId} onTimeFilterChange={changeTimeFilter}
          onCategoryChange={changeCategoryFilter} search={prefs.settings.taskSearch}
          priority={prefs.settings.taskPriorityFilter} viewMode={prefs.settings.viewMode}
          onSearchChange={(taskSearch) => void prefs.update({ taskSearch })}
          onPriorityChange={(taskPriorityFilter) => void prefs.update({ taskPriorityFilter })}
          onViewModeChange={(mode) => void changeViewMode(mode)}
          onManage={() => { setSettingsOpen(false); setCategoriesOpen(true); }} />
        <div className="content-viewport">
          {!ready ? <div className="loading-state"><span /><span /><span /></div> :
          prefs.settings.viewMode === "list" ? <div className="filtered-list" key={`${prefs.settings.taskTimeFilter}:${prefs.settings.taskCategoryFilterId ?? "all"}`}>
            <NoteList notes={visibleNotes} categories={categories.categories} repeatSeries={notes.repeatSeries}
              loading={notes.loading || categories.loading}
              minimal={prefs.settings.minimalMode}
              showCompleted={prefs.settings.showCompleted} completedExpanded={prefs.settings.completedSectionExpanded}
              onCompletedExpandedChange={(completedSectionExpanded) => void prefs.update({ completedSectionExpanded })}
              onToggleCompleted={toggleCompleted}
              onTogglePinned={(note) => notes.togglePinned(note.id, !note.pinned)} onEdit={notes.edit}
              onToggleRepeatActive={(series) => notes.toggleRepeatActive(series.id, !series.active)}
              onMove={notes.move} onDelete={notes.remove} />
          </div> : prefs.settings.viewMode === "board" ? <BoardView columns={board.columns} notes={visibleNotes} categories={categories.categories}
            repeatSeries={notes.repeatSeries} loading={notes.loading || categories.loading || board.loading}
            minimal={prefs.settings.minimalMode}
            showCompleted={prefs.settings.showCompleted}
            selectedColumnId={selectedBoardColumnId} onSelectedColumnChange={setSelectedBoardColumnId}
            onAdd={(input) => notes.add({ ...input, categoryId: input.categoryId ?? quickCategoryId })} onEdit={notes.edit}
            onToggleCompleted={toggleCompleted}
            onTogglePinned={(note) => notes.togglePinned(note.id, !note.pinned)}
            onToggleRepeatActive={(series) => notes.toggleRepeatActive(series.id, !series.active)}
            onDelete={notes.remove} onMoveNote={moveBoardNote} onCreateColumn={board.create}
            onRenameColumn={board.rename} onDeleteColumn={board.remove} onMoveColumn={board.reorder} />
          : <CalendarView notes={notes.notes} categories={categories.categories} repeatSeries={notes.repeatSeries}
            onSelectedDateChange={setCalendarSelectedDate}
            loading={notes.loading || categories.loading} defaultCategoryId={quickCategoryId}
            minimal={prefs.settings.minimalMode}
            categoryId={prefs.settings.taskCategoryFilterId}
            search={prefs.settings.taskSearch} priority={prefs.settings.taskPriorityFilter}
            onAdd={notes.add} onEdit={notes.edit}
            onToggleCompleted={toggleCompleted}
            onTogglePinned={(note) => notes.togglePinned(note.id, !note.pinned)}
            onToggleRepeatActive={(series) => notes.toggleRepeatActive(series.id, !series.active)}
            onDelete={notes.remove} onReschedule={rescheduleCalendarNote} />}
        </div>
      </div>
    </section>
    <CategoryManager open={categoriesOpen} categories={categories.categories} onClose={() => setCategoriesOpen(false)}
      onCreate={categories.create} onUpdate={categories.update} onMove={categories.move} onDelete={categories.remove} countNotes={categories.countNotes} />
    <SettingsDrawer open={settingsOpen} settings={prefs.settings} completedCount={notes.notes.filter((note) => note.completed).length}
      onClose={() => setSettingsOpen(false)} onUpdate={updateSettings} onClearCompleted={notes.clearCompleted}
      onLaunchOnStartupChange={changeLaunchOnStartup} onShortcutChange={changeShortcut}
      onShortcutRecordingChange={setShortcutRecording}
      onImported={refreshAll} toast={toast} />
    <Toast items={toasts} onDismiss={dismiss} onUndo={undo} />
    <DailySummaryDialog open={dailySummaryOpen} notes={notes.notes} onClose={() => setDailySummaryOpen(false)} />
    <WindowCloseDialog open={windowClose.open} busy={windowClose.busy} onCancel={windowClose.cancel} onChoose={windowClose.choose} />
    <WindowResizeHandles />
  </main>;
}

function windowForView(settings: AppSettings, viewMode: ViewMode) {
  if (viewMode === "board") return settings.boardWindow;
  if (viewMode === "calendar") return settings.calendarWindow;
  return settings.listWindow;
}

function windowPatchForView(viewMode: ViewMode, windowState: WindowState): Partial<AppSettings> {
  if (viewMode === "board") return { boardWindow: windowState };
  if (viewMode === "calendar") return { calendarWindow: windowState };
  return { listWindow: windowState };
}
