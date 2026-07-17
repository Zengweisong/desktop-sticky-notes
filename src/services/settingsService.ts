import { getDatabase } from "./database";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type FontSizePreference,
  type ThemeName
} from "../types/settings";
import { isNoteStatusFilter } from "../types/filter";

const THEMES = new Set<ThemeName>(["warm", "light", "dark"]);
const FONT_SIZES = new Set<FontSizePreference>(["small", "medium", "large"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function coordinate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 10_000_000
    ? Math.round(value)
    : null;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function categoryFilterId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Merges old or partially damaged settings with safe defaults. This is deliberately
 * kept independent from SQLite so it can also validate in-memory updates.
 */
export function normalizeSettings(value: unknown): AppSettings {
  const saved = isRecord(value) ? value : {};
  const hasSavedWindow = isRecord(saved.window) || isRecord(saved.windowState);
  const savedWindow = isRecord(saved.window)
    ? saved.window
    : isRecord(saved.windowState)
      ? saved.windowState
      : {};
  const savedAppearance = isRecord(saved.appearance) ? saved.appearance : {};
  const opacity = finiteNumber(saved.opacity, DEFAULT_SETTINGS.opacity);
  const width = finiteNumber(savedWindow.width, DEFAULT_SETTINGS.window.width);
  const height = finiteNumber(savedWindow.height, DEFAULT_SETTINGS.window.height);
  const scaleFactor = savedWindow.scaleFactor === null
    ? null
    : typeof savedWindow.scaleFactor === "number"
      && Number.isFinite(savedWindow.scaleFactor)
      && savedWindow.scaleFactor >= 0.5
      && savedWindow.scaleFactor <= 8
      ? savedWindow.scaleFactor
      : savedWindow.scaleFactor === undefined
        ? hasSavedWindow ? null : DEFAULT_SETTINGS.window.scaleFactor
        : DEFAULT_SETTINGS.window.scaleFactor;
  const theme = THEMES.has(saved.theme as ThemeName)
    ? saved.theme as ThemeName
    : DEFAULT_SETTINGS.theme;
  const fontSizeCandidate = saved.fontSize ?? savedAppearance.fontSize;
  const fontSize = FONT_SIZES.has(fontSizeCandidate as FontSizePreference)
    ? fontSizeCandidate as FontSizePreference
    : DEFAULT_SETTINGS.fontSize;

  return {
    opacity: Math.round(Math.min(100, Math.max(0, opacity))),
    theme,
    alwaysOnTop: booleanValue(saved.alwaysOnTop, DEFAULT_SETTINGS.alwaysOnTop),
    launchOnStartup: booleanValue(saved.launchOnStartup, DEFAULT_SETTINGS.launchOnStartup),
    showOnStartup: booleanValue(saved.showOnStartup, DEFAULT_SETTINGS.showOnStartup),
    showCompleted: booleanValue(saved.showCompleted, DEFAULT_SETTINGS.showCompleted),
    shortcut: typeof saved.shortcut === "string" && saved.shortcut.trim().length > 0 && saved.shortcut.length <= 80
      ? saved.shortcut
      : DEFAULT_SETTINGS.shortcut,
    fontSize,
    taskStatusFilter: isNoteStatusFilter(saved.taskStatusFilter)
      ? saved.taskStatusFilter
      : DEFAULT_SETTINGS.taskStatusFilter,
    taskCategoryFilterId: categoryFilterId(saved.taskCategoryFilterId),
    window: {
      x: coordinate(savedWindow.x),
      y: coordinate(savedWindow.y),
      width: width > 0 && width <= 100_000 ? Math.round(width) : DEFAULT_SETTINGS.window.width,
      height: height > 0 && height <= 100_000 ? Math.round(height) : DEFAULT_SETTINGS.window.height,
      maximized: booleanValue(savedWindow.maximized, DEFAULT_SETTINGS.window.maximized),
      scaleFactor
    }
  };
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const db = await getDatabase();
    const rows = await db.select<Array<{ value: string }>>("SELECT value FROM settings WHERE key = 'app'");
    if (!rows.length) return structuredClone(DEFAULT_SETTINGS);
    return normalizeSettings(JSON.parse(rows[0].value));
  } catch (error) {
    console.error("读取设置失败，已恢复默认设置:", error);
    return structuredClone(DEFAULT_SETTINGS);
  }
}

let saveQueue: Promise<void> = Promise.resolve();

async function persistSettings(settings: AppSettings): Promise<void> {
  try {
    const db = await getDatabase();
    await db.execute(
      `INSERT INTO settings (key, value, updated_at) VALUES ('app', $1, $2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [JSON.stringify(settings), new Date().toISOString()]
    );
  } catch (error) { console.error("保存设置失败:", error); throw new Error("保存设置失败"); }
}

export function saveSettings(settings: AppSettings): Promise<void> {
  const snapshot = normalizeSettings(structuredClone(settings));
  const operation = saveQueue.catch(() => undefined).then(() => persistSettings(snapshot));
  saveQueue = operation;
  return operation;
}
