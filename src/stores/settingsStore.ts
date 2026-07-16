import { create } from "zustand";
import { DEFAULT_SETTINGS, type AppSettings } from "../types/settings";

interface SettingsState { settings: AppSettings; loaded: boolean; setSettings: (settings: AppSettings) => void; patchSettings: (patch: Partial<AppSettings>) => void; }
export const useSettingsStore = create<SettingsState>((set) => ({
  settings: structuredClone(DEFAULT_SETTINGS), loaded: false,
  setSettings: (settings) => set({ settings, loaded: true }),
  patchSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } }))
}));
