import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDatabase } from "./database";
import { createRepeatSeries, deleteRepeatSeries, generateDueOccurrences, setRepeatSeriesActive, stopRepeatSeries, updateRepeatSeries } from "./repeatTaskService";
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
      expect(occurrenceInsert[1][7]).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("generates an occurrence at the start of its day even when its reminder is later", async () => {
    const occurrence = new Date(2026, 6, 16, 0, 0);
    const row = seriesRow(occurrence.toISOString());
    row.start_at = new Date(2026, 6, 13, 0, 0).toISOString();
    row.default_reminder_enabled = 1;
    row.default_all_day_reminder_time = "18:00";
    const inserted: string[] = [];
    const db = fakeDatabase(row, inserted);
    vi.mocked(getDatabase).mockResolvedValue(db as never);

    await expect(generateDueOccurrences(new Date(2026, 6, 16, 10, 0))).resolves.toBe(1);
    expect(inserted).toEqual([occurrence.toISOString()]);
  });

  it("stores no occurrence reminder when repeat reminders are disabled", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const db = {
      select: vi.fn(async () => []),
      execute: vi.fn(async (sql: string, values: unknown[] = []) => {
        calls.push([sql, values]);
        return { rowsAffected: 1, lastInsertId: sql.includes("INSERT INTO repeat_series") ? 21 : 22 };
      })
    };

    await createRepeatSeries({
      title: "不提醒", repeatEnabled: true, repeatType: "daily",
      repeatReminderEnabled: false, repeatStartDate: "2026-07-25"
    }, 1, undefined, db as never);

    const seriesInsert = calls.find(([sql]) => sql.includes("INSERT INTO repeat_series"))!;
    const occurrenceInsert = calls.find(([sql]) => sql.includes("INSERT INTO notes"))!;
    expect(seriesInsert[1][12]).toBe(0);
    expect(occurrenceInsert[1][6]).toBe(0);
    expect(occurrenceInsert[1][7]).toBeNull();
  });

  it("removes a newly inserted series when creating its first occurrence fails", async () => {
    const calls: string[] = [];
    const db = {
      select: vi.fn(async () => []),
      execute: vi.fn(async (sql: string) => {
        calls.push(sql);
        if (sql.includes("INSERT INTO notes")) throw new Error("note insert failed");
        return { rowsAffected: 1, lastInsertId: 31 };
      })
    };

    await expect(createRepeatSeries({
      title: "创建失败", repeatEnabled: true, repeatType: "daily", repeatStartDate: "2026-07-25"
    }, 1, undefined, db as never)).rejects.toThrow("note insert failed");
    expect(calls[calls.length - 1]).toBe("DELETE FROM repeat_series WHERE id = $1");
  });

  it("stops a series by deleting the parent before cleaning occurrence metadata", async () => {
    const db = {
      select: vi.fn(async () => [{ id: 4 }, { id: 5 }]),
      execute: vi.fn(async (_sql: string, _values: unknown[] = []) => ({ rowsAffected: 1, lastInsertId: 0 }))
    };

    await stopRepeatSeries(9, db as never);
    expect(db.execute.mock.calls[0]).toEqual(["DELETE FROM repeat_series WHERE id = $1", [9]]);
    expect(db.execute.mock.calls[1][0]).toContain("UPDATE notes SET repeat_occurrence_at = NULL");
    expect(db.execute.mock.calls[1][1]).toEqual([4, 5]);
  });

  it("deletes a series before its occurrences so a partial failure preserves user notes", async () => {
    const db = {
      select: vi.fn(async () => [{ id: 6 }, { id: 7 }]),
      execute: vi.fn(async (_sql: string, _values: unknown[] = []) => ({ rowsAffected: 1, lastInsertId: 0 }))
    };
    vi.mocked(getDatabase).mockResolvedValue(db as never);

    await deleteRepeatSeries(10);
    expect(db.execute.mock.calls[0]).toEqual(["DELETE FROM repeat_series WHERE id = $1", [10]]);
    expect(db.execute.mock.calls[1][0]).toBe("DELETE FROM notes WHERE id IN ($1,$2)");
    expect(db.execute.mock.calls[1][1]).toEqual([6, 7]);
  });

  it("keeps the third occurrence next after editing a series that already generated twice", async () => {
    const start = new Date(2026, 6, 20, 0, 0);
    const third = new Date(2026, 6, 22, 0, 0);
    const row = seriesRow(third.toISOString());
    row.start_at = start.toISOString();
    row.generated_occurrences = 2;
    row.end_type = "count";
    row.max_occurrences = 3;
    const inserted: string[] = [];
    const db = fakeDatabase(row, inserted);
    vi.mocked(getDatabase).mockResolvedValue(db as never);

    await updateRepeatSeries(1, {
      title: "每日事项", categoryId: 1, priority: "normal",
      repeatEnabled: true, repeatType: "daily", repeatStartDate: "2026-07-20",
      repeatEndType: "count", repeatMaxOccurrences: 3,
      repeatReminderEnabled: false
    }, 1, db as never);
    await generateDueOccurrences(new Date(2026, 6, 22, 12, 0));

    expect(inserted).toEqual([third.toISOString()]);
    expect(row.generated_occurrences).toBe(3);
    expect(row.next_occurrence_at).toBeNull();
  });

  it("does not let occurrence generation enter while a series deletion is in progress", async () => {
    let releaseSnapshot!: () => void;
    let snapshotReady!: () => void;
    const waitForRelease = new Promise<void>((resolve) => { releaseSnapshot = resolve; });
    const snapshotStarted = new Promise<void>((resolve) => { snapshotReady = resolve; });
    const events: string[] = [];
    let deleted = false;
    const row = seriesRow(new Date(2026, 6, 24, 0, 0).toISOString());
    row.start_at = new Date(2026, 6, 23, 0, 0).toISOString();
    const db = {
      select: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT id FROM notes")) {
          events.push("delete-snapshot");
          snapshotReady();
          await waitForRelease;
          return [{ id: 40 }];
        }
        events.push("generate-select");
        return deleted ? [] : [row];
      }),
      execute: vi.fn(async (sql: string) => {
        if (sql === "DELETE FROM repeat_series WHERE id = $1") {
          events.push("delete-series");
          deleted = true;
        } else if (sql.includes("INSERT OR IGNORE INTO notes")) {
          events.push("generate-insert");
        }
        return { rowsAffected: 1, lastInsertId: 0 };
      })
    };
    vi.mocked(getDatabase).mockResolvedValue(db as never);

    const deleting = deleteRepeatSeries(1);
    await snapshotStarted;
    const generating = generateDueOccurrences(new Date(2026, 6, 24, 12, 0));
    await Promise.resolve();
    releaseSnapshot();
    await Promise.all([deleting, generating]);

    expect(events).toEqual(["delete-snapshot", "delete-series", "generate-select"]);
  });

  it("applies a pause after an in-flight generation so generation cannot undo it", async () => {
    let releaseGeneration!: () => void;
    let generationReady!: () => void;
    const waitForRelease = new Promise<void>((resolve) => { releaseGeneration = resolve; });
    const generationStarted = new Promise<void>((resolve) => { generationReady = resolve; });
    const events: string[] = [];
    const row = seriesRow(new Date(2026, 6, 24, 0, 0).toISOString());
    row.start_at = new Date(2026, 6, 23, 0, 0).toISOString();
    let seriesReads = 0;
    const db = {
      select: vi.fn(async () => {
        seriesReads += 1;
        if (seriesReads === 1) {
          events.push("generate-select");
          generationReady();
          await waitForRelease;
        } else {
          events.push("pause-select");
        }
        return [row];
      }),
      execute: vi.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes("INSERT OR IGNORE INTO notes")) events.push("generate-insert");
        if (sql.includes("UPDATE repeat_series SET generated_occurrences")) {
          events.push("generate-update");
          row.generated_occurrences = Number(values[0]);
          row.next_occurrence_at = values[1] == null ? null : String(values[1]);
          row.active = Number(values[2]);
        }
        if (sql.startsWith("UPDATE repeat_series SET active=")) {
          events.push("pause-update");
          row.active = Number(values[0]);
        }
        return { rowsAffected: 1, lastInsertId: 0 };
      })
    };
    vi.mocked(getDatabase).mockResolvedValue(db as never);

    const generating = generateDueOccurrences(new Date(2026, 6, 24, 12, 0));
    await generationStarted;
    const pausing = setRepeatSeriesActive(1, false);
    await Promise.resolve();
    releaseGeneration();
    await Promise.all([generating, pausing]);

    expect(events).toEqual([
      "generate-select", "generate-insert", "generate-update", "pause-select", "pause-update"
    ]);
    expect(row.active).toBe(0);
  });
});

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
      if (sql.includes("UPDATE repeat_series SET title=")) {
        row.start_at = String(values[8]);
        row.end_type = values[9] as RepeatSeriesRow["end_type"];
        row.end_date = values[10] == null ? null : String(values[10]);
        row.max_occurrences = values[11] == null ? null : Number(values[11]);
        row.default_reminder_enabled = Number(values[12]);
        row.default_all_day_reminder_time = values[13] == null ? null : String(values[13]);
        row.next_occurrence_at = values[15] == null ? null : String(values[15]);
        row.active = Number(values[16]);
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
