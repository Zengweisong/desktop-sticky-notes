import { getDatabase } from "./database";
import { DEFAULT_SETTINGS, type AppSettings } from "../types/settings";

export async function loadSettings(): Promise<AppSettings> {
  try {
    const db = await getDatabase();
    const rows = await db.select<Array<{ value: string }>>("SELECT value FROM settings WHERE key = 'app'");
    if (!rows.length) return structuredClone(DEFAULT_SETTINGS);
    const saved = JSON.parse(rows[0].value) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...saved, window: { ...DEFAULT_SETTINGS.window, ...saved.window } };
  } catch (error) { console.error("读取设置失败:", error); throw new Error("读取设置失败"); }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    const db = await getDatabase();
    await db.execute(
      `INSERT INTO settings (key, value, updated_at) VALUES ('app', $1, $2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [JSON.stringify(settings), new Date().toISOString()]
    );
  } catch (error) { console.error("保存设置失败:", error); throw new Error("保存设置失败"); }
}
