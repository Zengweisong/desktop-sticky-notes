import { describe, expect, it } from "vitest";
import { calculateNextOccurrence } from "./repeatTaskService";
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
});

function series(type: RepeatSeries["repeatType"], start: Date, patch: Partial<RepeatSeries> = {}): RepeatSeries {
  return {
    id: 1, title: "测试事项", details: null, categoryId: null, priority: "normal",
    repeatType: type, repeatInterval: 1, repeatWeekdays: [], repeatMonthDay: null,
    startAt: start.toISOString(), endType: "never", endDate: null, maxOccurrences: null,
    generatedOccurrences: 1, defaultReminderEnabled: false, defaultReminderOffsetMinutes: 0,
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
