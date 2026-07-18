import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../types/settings";
import { normalizeSettings } from "./settingsService";

describe("normalizeSettings", () => {
  it("uses safe defaults for missing or damaged configuration", () => {
    expect(normalizeSettings("not-an-object")).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ fontSize: "huge", window: { width: -1, height: Number.NaN } })).toEqual({
      ...DEFAULT_SETTINGS,
      window: { ...DEFAULT_SETTINGS.window, scaleFactor: null }
    });
  });

  it("keeps valid old settings and supplies newly introduced fields", () => {
    const settings = normalizeSettings({
      opacity: 64,
      theme: "dark",
      alwaysOnTop: false,
      window: { x: -1200, y: 80, width: 520, height: 700 }
    });

    expect(settings.opacity).toBe(64);
    expect(settings.theme).toBe("dark");
    expect(settings.alwaysOnTop).toBe(false);
    expect(settings.fontSize).toBe("medium");
    expect(settings.window).toEqual({
      x: -1200,
      y: 80,
      width: 520,
      height: 700,
      maximized: false,
      scaleFactor: null
    });
  });

  it("accepts the nested appearance and windowState compatibility shape", () => {
    const settings = normalizeSettings({
      appearance: { fontSize: "large" },
      windowState: { x: 10, y: 20, width: 410, height: 610, maximized: true, scaleFactor: 1.5 }
    });

    expect(settings.fontSize).toBe("large");
    expect(settings.window.maximized).toBe(true);
    expect(settings.window.scaleFactor).toBe(1.5);
  });

  it("keeps valid task filters and rejects stale filter values", () => {
    expect(normalizeSettings({ taskStatusFilter: "today", taskCategoryFilterId: 8 })).toMatchObject({
      taskStatusFilter: "today",
      taskCategoryFilterId: 8
    });
    expect(normalizeSettings({ taskStatusFilter: "all", taskCategoryFilterId: -1 })).toMatchObject({
      taskStatusFilter: "active",
      taskCategoryFilterId: null
    });
  });
});
