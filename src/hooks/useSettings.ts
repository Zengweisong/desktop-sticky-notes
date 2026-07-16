import { useCallback } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { loadSettings, saveSettings } from "../services/settingsService";
import type { AppSettings } from "../types/settings";

export function useSettings(onError: (message: string) => void) {
  const { settings, loaded, setSettings, patchSettings } = useSettingsStore();
  const load = useCallback(async () => {
    try { setSettings(await loadSettings()); }
    catch (error) { onError(error instanceof Error ? error.message : "读取设置失败"); setSettings(settings); }
  }, [onError, setSettings]);
  const update = useCallback(async (patch: Partial<AppSettings>) => {
    const next = { ...useSettingsStore.getState().settings, ...patch };
    patchSettings(patch);
    try { await saveSettings(next); }
    catch (error) { onError(error instanceof Error ? error.message : "保存设置失败"); }
  }, [onError, patchSettings]);
  return { settings, loaded, load, update };
}
