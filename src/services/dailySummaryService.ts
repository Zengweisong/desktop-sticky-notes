import { invoke } from "@tauri-apps/api/core";
import type { Note } from "../types/note";
import { schedulePartsFromIso } from "./noteDateService";

export interface DailySummaryConfig {
  endpoint: string;
  model: string;
}

export function completedTitlesForDate(
  notes: readonly Pick<Note, "completed" | "completedAt" | "title">[],
  date: string
): string[] {
  if (!date) return [];
  return notes
    .flatMap(({ completed, completedAt, title }) => {
      if (!completed || !completedAt || schedulePartsFromIso(completedAt).date !== date) return [];
      const trimmedTitle = title.trim();
      return trimmedTitle ? [{ title: trimmedTitle, completedAt: Date.parse(completedAt) }] : [];
    })
    .sort((left, right) => left.completedAt - right.completedAt)
    .map((note) => note.title);
}

export const loadDailySummaryConfig = () => invoke<DailySummaryConfig | null>("get_daily_summary_config");

export const saveDailySummaryConfig = (config: DailySummaryConfig, apiKey: string) =>
  invoke<DailySummaryConfig>("save_daily_summary_config", { ...config, apiKey });

export const clearDailySummaryConfig = () => invoke<void>("clear_daily_summary_config");

export const generateDailySummary = (date: string, titles: string[], prompt: string) =>
  invoke<string>("generate_daily_summary", { date, titles, prompt });
