import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDatabase } from "./database";
import { createRepeatSeries, generateDueOccurrences, setRepeatSeriesActive } from "./repeatTaskService";
import type { RepeatSeriesRow } from "../types/repeat";

vi.mock("./database", () => ({ getDatabase: vi.fn() }));

describe("repeat occurrence persistence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("catches up only the latest missed occurrence and advances the series once", async () => {
    const row = seriesRow("2026-07-14T00:00:00.000Z");
    const inserted: string[] = [];
    const db = fakeDatabase(row, inserted);
    vi.mocked(getDatabase).mockResolvedValue(db as never);

    await expect(generateDueOccurrences(new Date("2026-07-16T12:00:00.000Z"))).resolves.toBe(1);
    expect(db.execute.mock.calls.map(([sql]) => sql).join(" ")).not.toMatch(/BEGIN|COMMIT|ROLLBACK/);
    expect(inserted).toEqual(["2026-07-16T00:00:00.000Z"]);
    expect(row.generated_occurrences).toBe(4);
    expect(row.next_occurrence_at).toBe("2026-07-17T00:00:00.000Z");

    await expect(generateDueOccurrences(new Date("2026-07-16T12:00:00.000Z"))).resolves.toBe(0);
    expect(inserted).toHaveLength(1);
  });

  it("recalculates the next occurrence from the resume time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:00:00.000Z"));
    const row = seriesRow("2026-07-14T00:00:00.000Z");
    const updates: unknown[][] = [];
    const db = {
      select: vi.fn(async () => [row]),
      execute: vi.fn(async (_sql: string, values: unknown[] = []) => {
        updates.push(values);
        return { rowsAffected: 1, lastInsertId: 0 };
      })
    };
    vi.mocked(getDatabase).mockResolvedValue(db as never);

    try {
      await setRepeatSeriesActive(1, true);
      expect(updates[0][1]).toBe("2026-07-17T00:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates a repeat series without an ordinary item date or time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 22, 15, 30));
    const calls: Array<[string, unknown[]]> = [];
    const db = {
      select: vi.fn(async () => []),
      execute: vi.fn(async (sql: string, values: unknown[] = []) => {
        if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) throw "pooled database transaction boundary";
        calls.push([sql, values]);
        return { rowsAffected: 1, lastInsertId: sql.includes("INSERT INTO repeat_series") ? 12 : 13 };
      })
    };

    try {
      await expect(createRepeatSeries({
        title: "每天站立", repeatEnabled: true, repeatType: "daily",
        repeatReminderEnabled: true, repeatReminderTime: "09:00"
      }, 1, undefined, db as never)).resolves.toEqual({ seriesId: 12, noteId: 13 });
      const seriesInsert = calls.find(([sql]) => sql.includes("INSERT INTO repeat_series"))!;
      const start = new Date(String(seriesInsert[1][8]));
      expect([start.getFullYear(), start.getMonth() + 1, start.getDate()]).toEqual([2026, 7, 22]);
      expect(seriesInsert[1][12]).toBe(1);
      expect(seriesInsert[1][13]).toBe("09:00");
      expect(seriesInsert[1][14]).toBe(0);
      const occurrenceInsert = calls.find(([sql]) => sql.includes("INSERT INTO notes"))!;
      expectLocalTime(String(occurrenceInsert[1][7]), 9, 0);
    } finally {
      vi.useRealTimers();
    }
  });
});

function expectLocalTime(value: string, hour: number, minute: number) {
  const date = new Date(value);
  expect([date.getHours(), date.getMinutes()]).toEqual([hour, minute]);
}

function fakeDatabase(row: RepeatSeriesRow, inserted: string[]) {
  return {
    select: vi.fn(async () => [row]),
    execute: vi.fn(async (sql: string, values: unknown[] = []) => {
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) throw "pooled database transaction boundary";
      if (sql.includes("INSERT OR IGNORE INTO notes")) {
        inserted.push(String(values[4]));
        return { rowsAffected: 1, lastInsertId: 1 };
      }
      if (sql.includes("UPDATE repeat_series SET generated_occurrences")) {
        row.generated_occurrences = Number(values[0]);
        row.next_occurrence_at = values[1] == null ? null : String(values[1]);
        row.active = Number(values[2]);
      }
      return { rowsAffected: 1, lastInsertId: 0 };
    })
  };
}

function seriesRow(nextOccurrenceAt: string): RepeatSeriesRow {
  return {
    id: 1,
    title: "每日事项",
    details: null,
    category_id: 1,
    priority: "normal",
    repeat_type: "daily",
    repeat_interval: 1,
    repeat_weekdays: null,
    repeat_month_day: null,
    start_at: "2026-07-13T00:00:00.000Z",
    end_type: "never",
    end_date: null,
    max_occurrences: null,
    generated_occurrences: 1,
    default_reminder_enabled: 0,
    default_all_day_reminder_time: null,
    default_reminder_offset_minutes: 0,
    next_occurrence_at: nextOccurrenceAt,
    active: 1,
    created_at: "2026-07-13T00:00:00.000Z",
    updated_at: "2026-07-13T00:00:00.000Z"
  };
}
