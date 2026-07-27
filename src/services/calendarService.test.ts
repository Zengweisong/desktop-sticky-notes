import { describe, expect, it } from "vitest";
import type { Note } from "../types/note";
import type { RepeatSeries } from "../types/repeat";
import {
  buildCalendarEntries,
  buildMonthGrid,
  calendarRange,
  localScheduledAt,
  noteCalendarDateKey,
  unscheduledNotes
} from "./calendarService";

describe("calendarService", () => {
  it("builds a Monday-first six-week grid with adjacent month dates", () => {
    const days = buildMonthGrid(new Date(2026, 6, 1), new Date(2026, 6, 15));
    expect(days).toHaveLength(42);
    expect(days[0].key).toBe("2026-06-29");
    expect(days[2]).toMatchObject({ key: "2026-07-01", inMonth: true });
    expect(days.find((day) => day.key === "2026-07-15")?.isToday).toBe(true);
    expect(days[41].key).toBe("2026-08-09");
  });

  it("uses scheduledAt in local time and treats missing dates as unscheduled", () => {
    const scheduledAt = new Date(2026, 6, 18, 23, 30).toISOString();
    const dated = makeNote(1, scheduledAt);
    const undated = makeNote(2, null, { dueAt: scheduledAt, reminderAt: scheduledAt });
    expect(noteCalendarDateKey(dated)).toBe("2026-07-18");
    expect(unscheduledNotes([dated, undated]).map((note) => note.id)).toEqual([2]);
    expect(new Date(localScheduledAt("2026-07-18", "09:30")!).getHours()).toBe(9);
  });

  it("projects repeat occurrences without duplicating materialized instances", () => {
    const days = buildMonthGrid(new Date(2026, 6, 1));
    const range = calendarRange(days);
    const start = new Date(2026, 6, 1, 0, 0).toISOString();
    const existing = makeNote(3, start, { repeatSeriesId: 7, repeatOccurrenceAt: start });
    const series = makeSeries(7, start);
    const entries = buildCalendarEntries([existing], [series], range.start, range.end)
      .filter((entry) => entry.dateKey.startsWith("2026-07"));

    expect(entries.filter((entry) => entry.dateKey === "2026-07-01")).toHaveLength(1);
    expect(entries.find((entry) => entry.dateKey === "2026-07-02")).toMatchObject({
      virtual: true,
      sourceNote: existing,
      series
    });
    expect(series.generatedOccurrences).toBe(1);
  });

  it("sorts date-only items before explicitly timed items", () => {
    const days = buildMonthGrid(new Date(2026, 6, 1));
    const range = calendarRange(days);
    const dateOnly = makeNote(1, null, { title: "仅日期", scheduledDate: "2026-07-18", scheduledTime: null });
    const morning = makeNote(2, new Date(2026, 6, 18, 8, 30).toISOString(), { title: "早会" });
    const evening = makeNote(3, new Date(2026, 6, 18, 18, 0).toISOString(), { title: "晚间复盘" });

    const entries = buildCalendarEntries([evening, dateOnly, morning], [], range.start, range.end)
      .filter((entry) => entry.dateKey === "2026-07-18");

    expect(entries.map((entry) => [entry.title, entry.scheduledTime])).toEqual([
      ["仅日期", null], ["早会", "08:30"], ["晚间复盘", "18:00"]
    ]);
  });
});

function makeNote(id: number, scheduledAt: string | null, patch: Partial<Note> = {}): Note {
  return {
    id, title: `事项 ${id}`, details: null, categoryId: 1, completed: false, pinned: false,
    priority: "normal", createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
    completedAt: null, dueAt: null, sortOrder: id, scheduledAt,
    scheduledDate: scheduledAt ? noteCalendarDateKey({ scheduledAt }) : null,
    scheduledTime: scheduledAt ? `${String(new Date(scheduledAt).getHours()).padStart(2, "0")}:${String(new Date(scheduledAt).getMinutes()).padStart(2, "0")}` : null,
    repeatSeriesId: null,
    repeatOccurrenceAt: null, reminderEnabled: false, reminderAt: null, reminderOffsetMinutes: 0,
    reminderTriggeredAt: null, boardColumnId: "todo", boardOrder: id * 10, status: "todo",
    previousBoardColumnId: null, ...patch
  };
}

function makeSeries(id: number, startAt: string): RepeatSeries {
  return {
    id, title: "每日站会", details: null, categoryId: 1, priority: "normal",
    repeatType: "daily", repeatInterval: 1, repeatWeekdays: [], repeatMonthDay: null,
    startAt, endType: "date", endDate: "2026-07-03", maxOccurrences: null,
    generatedOccurrences: 1, defaultReminderEnabled: false, defaultReminderTime: null,
    defaultReminderOffsetMinutes: 0, nextOccurrenceAt: null, active: true,
    createdAt: startAt, updatedAt: startAt
  };
}
