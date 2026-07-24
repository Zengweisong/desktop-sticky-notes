import { describe, expect, it } from "vitest";
import { calculateNextOccurrence, fromSeriesRow, repeatReminderAt } from "./repeatTaskService";
import type { RepeatSeriesRow } from "../types/repeat";
import type { RepeatSeries } from "../types/repeat";

describe("repeat occurrence calculation", () => {
  it("generates daily and weekday occurrences", () => {
    const friday = local(2026, 7, 17, 8, 0);
    expectLocal(calculateNextOccurrence(series("daily", friday), friday), 2026, 7, 18, 8, 0);
    expectLocal(calculateNextOccurrence(series("weekdays", friday), friday), 2026, 7, 20, 8, 0);
  });

  it("supports selected weekdays and every two weeks", () => {
    const monday = local(2026, 7, 20, 18, 0);
    const weekly = series("weekly", monday, { repeatWeekdays: [1, 3, 5] });
    expectLocal(calculateNextOccurrence(weekly, monday), 2026, 7, 22, 18, 0);
    const fortnightly = series("weekly", monday, { repeatInterval: 2, repeatWeekdays: [1] });
    expectLocal(calculateNextOccurrence(fortnightly, monday), 2026, 8, 3, 18, 0);
  });

  it("clamps monthly day 31 to the last day of shorter months", () => {
    const january31 = local(2027, 1, 31, 9, 30);
    expectLocal(calculateNextOccurrence(series("monthly", january31, { repeatMonthDay: 31 }), january31), 2027, 2, 28, 9, 30);
    const leapJanuary31 = local(2028, 1, 31, 9, 30);
    expectLocal(calculateNextOccurrence(series("monthly", leapJanuary31, { repeatMonthDay: 31 }), leapJanuary31), 2028, 2, 29, 9, 30);
  });

  it("stops at occurrence count and end date", () => {
    const start = local(2026, 7, 20, 8, 0);
    expect(calculateNextOccurrence(series("daily", start, {
      endType: "count", maxOccurrences: 3, generatedOccurrences: 2
    }), start)).not.toBeNull();
    expect(calculateNextOccurrence(series("daily", start, {
      endType: "count", maxOccurrences: 3, generatedOccurrences: 3
    }), start)).toBeNull();
    expect(calculateNextOccurrence(series("daily", start, {
      endType: "date", endDate: "2026-07-20"
    }), start)).toBeNull();
  });

  it("uses a fixed local reminder time instead of an ordinary reminder offset", () => {
    const occurrence = local(2026, 7, 22, 0, 0);
    expectLocal(repeatReminderAt(occurrence.toISOString(), true, "09:00"), 2026, 7, 22, 9, 0);
    expect(repeatReminderAt(occurrence.toISOString(), false, "09:00")).toBeNull();
  });

  it("derives an independent reminder time for legacy repeat series", () => {
    const start = local(2026, 7, 22, 10, 0);
    const row: RepeatSeriesRow = {
      id: 1, title: "旧重复事项", details: null, category_id: 1, priority: "normal",
      repeat_type: "daily", repeat_interval: 1, repeat_weekdays: null, repeat_month_day: null,
      start_at: start.toISOString(), end_type: "never", end_date: null, max_occurrences: null,
      generated_occurrences: 1, default_reminder_enabled: 1, default_all_day_reminder_time: null,
      default_reminder_offset_minutes: 60, next_occurrence_at: null, active: 1,
      created_at: start.toISOString(), updated_at: start.toISOString()
    };
    expect(fromSeriesRow(row).defaultReminderTime).toBe("09:00");
  });
});

function series(type: RepeatSeries["repeatType"], start: Date, patch: Partial<RepeatSeries> = {}): RepeatSeries {
  return {
    id: 1, title: "测试事项", details: null, categoryId: null, priority: "normal",
    repeatType: type, repeatInterval: 1, repeatWeekdays: [], repeatMonthDay: null,
    startAt: start.toISOString(), endType: "never", endDate: null, maxOccurrences: null,
    generatedOccurrences: 1, defaultReminderEnabled: false, defaultReminderTime: null, defaultReminderOffsetMinutes: 0,
    nextOccurrenceAt: null, active: true, createdAt: start.toISOString(), updatedAt: start.toISOString(),
    ...patch
  };
}

function local(year: number, month: number, day: number, hour: number, minute: number) {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function expectLocal(value: string | null, year: number, month: number, day: number, hour: number, minute: number) {
  expect(value).not.toBeNull();
  const date = new Date(value!);
  expect([date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()])
    .toEqual([year, month, day, hour, minute]);
}
