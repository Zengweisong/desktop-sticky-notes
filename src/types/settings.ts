import type { NoteTimeFilter } from "./filter";

export type ThemeName = "warm" | "light" | "dark";
export type FontSizePreference = "small" | "medium" | "large";
export type ViewMode = "list" | "board";
export type PriorityFilter = "all" | "low" | "normal" | "high";

export interface WindowState {
  x: number | null;
  y: number | null;
  width: number;
  height: number;
  maximized: boolean;
  /** Null identifies window sizes saved by versions that used physical pixels. */
  scaleFactor: number | null;
}

export interface AppSettings {
  opacity: number;
  theme: ThemeName;
  alwaysOnTop: boolean;
  launchOnStartup: boolean;
  showOnStartup: boolean;
  showCompleted: boolean;
  completedSectionExpanded: boolean;
  shortcut: string;
  fontSize: FontSizePreference;
  taskTimeFilter: NoteTimeFilter;
  taskCategoryFilterId: number | null;
  taskSearch: string;
  taskPriorityFilter: PriorityFilter;
  viewMode: ViewMode;
  window: WindowState;
  listWindow: WindowState;
  boardWindow: WindowState;
}

export const DEFAULT_SETTINGS: AppSettings = {
  opacity: 92,
  theme: "warm",
  alwaysOnTop: true,
  launchOnStartup: false,
  showOnStartup: true,
  showCompleted: false,
  completedSectionExpanded: false,
  shortcut: "Ctrl+Alt+Space",
  fontSize: "medium",
  taskTimeFilter: "all",
  taskCategoryFilterId: null,
  taskSearch: "",
  taskPriorityFilter: "all",
  viewMode: "list",
  window: {
    x: null,
    y: null,
    width: 400,
    height: 580,
    maximized: false,
    scaleFactor: 1
  },
  listWindow: {
    x: null, y: null, width: 400, height: 580, maximized: false, scaleFactor: 1
  },
  boardWindow: {
    x: null, y: null, width: 820, height: 620, maximized: false, scaleFactor: 1
  }
};
