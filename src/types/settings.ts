import type { NoteStatusFilter } from "./filter";

export type ThemeName = "warm" | "light" | "dark";
export type FontSizePreference = "small" | "medium" | "large";

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
  shortcut: string;
  fontSize: FontSizePreference;
  taskStatusFilter: NoteStatusFilter;
  taskCategoryFilterId: number | null;
  window: WindowState;
}

export const DEFAULT_SETTINGS: AppSettings = {
  opacity: 92,
  theme: "warm",
  alwaysOnTop: true,
  launchOnStartup: false,
  showOnStartup: true,
  showCompleted: true,
  shortcut: "Ctrl+Alt+Space",
  fontSize: "medium",
  taskStatusFilter: "active",
  taskCategoryFilterId: null,
  window: {
    x: null,
    y: null,
    width: 400,
    height: 580,
    maximized: false,
    scaleFactor: 1
  }
};
