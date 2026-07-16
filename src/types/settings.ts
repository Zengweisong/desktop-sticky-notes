export type ThemeName = "warm" | "light" | "dark";

export interface WindowState {
  x: number | null;
  y: number | null;
  width: number;
  height: number;
}

export interface AppSettings {
  opacity: number;
  theme: ThemeName;
  alwaysOnTop: boolean;
  launchOnStartup: boolean;
  showOnStartup: boolean;
  showCompleted: boolean;
  shortcut: string;
  window: WindowState;
}

export const DEFAULT_SETTINGS: AppSettings = {
  opacity: 0,
  theme: "warm",
  alwaysOnTop: true,
  launchOnStartup: false,
  showOnStartup: true,
  showCompleted: true,
  shortcut: "Ctrl+Alt+Space",
  window: { x: null, y: null, width: 360, height: 520 }
};
