import { describe, expect, it } from "vitest";
import {
  isNoteRelevantOnLocalDate,
  isScheduledOnLocalDate,
  normalizedSchedule,
  scheduledAtFromParts
} from "./noteDateService";

describe("today scheduling", () => {
  it("uses the local date of scheduledAt, never reminderAt or legacy dueAt", () => {
    const today = new Date(2026, 6, 17, 8, 0, 0, 0);
    expect(isScheduledOnLocalDate({ scheduledAt: new Date(2026, 6, 17, 23, 0).toISOString() }, today)).toBe(true);
    expect(isScheduledOnLocalDate({ scheduledAt: new Date(2026, 6, 16, 23, 0).toISOString() }, today)).toBe(false);
    expect(isScheduledOnLocalDate({ scheduledAt: null }, today)).toBe(false);
  });

  it("matches any supported date source for the today view", () => {
    const today = new Date(2026, 6, 17, 8, 0, 0, 0);
    const todayAtNine = new Date(2026, 6, 17, 9, 0).toISOString();
    const tomorrow = new Date(2026, 6, 18, 9, 0).toISOString();
    expect(isNoteRelevantOnLocalDate({ scheduledAt: todayAtNine, dueAt: null, reminderAt: null }, today)).toBe(true);
    expect(isNoteRelevantOnLocalDate({ scheduledAt: tomorrow, dueAt: todayAtNine, reminderAt: null }, today)).toBe(true);
    expect(isNoteRelevantOnLocalDate({ scheduledAt: tomorrow, dueAt: null, reminderAt: todayAtNine }, today)).toBe(true);
    expect(isNoteRelevantOnLocalDate({ scheduledAt: tomorrow, dueAt: null, reminderAt: null }, today)).toBe(false);
  });
});

describe("schedule normalization", () => {
  it("keeps a date-only schedule time-free", () => {
    expect(normalizedSchedule({ scheduledDate: "2026-07-27", scheduledTime: null })).toEqual({
      scheduledDate: "2026-07-27",
      scheduledTime: null,
      scheduledAt: null
    });
  });

  it("combines an explicit local time without UTC date parsing", () => {
    const result = normalizedSchedule({ scheduledDate: "2026-07-27", scheduledTime: "09:30" });
    expect(result.scheduledDate).toBe("2026-07-27");
    expect(result.scheduledTime).toBe("09:30");
    const local = new Date(result.scheduledAt as string);
    expect([local.getFullYear(), local.getMonth(), local.getDate(), local.getHours(), local.getMinutes()])
      .toEqual([2026, 6, 27, 9, 30]);
  });

  it("rejects invalid dates and times instead of normalizing them", () => {
    expect(normalizedSchedule({ scheduledDate: "2026-02-30", scheduledTime: "09:00" }))
      .toEqual({ scheduledDate: null, scheduledTime: null, scheduledAt: null });
    expect(scheduledAtFromParts("2026-07-27", "24:00")).toBeNull();
  });

  it("lets explicit nullable fields override legacy scheduledAt", () => {
    expect(normalizedSchedule({
      scheduledDate: "2026-07-28",
      scheduledTime: null,
      scheduledAt: new Date(2026, 6, 27, 9, 0).toISOString()
    })).toEqual({ scheduledDate: "2026-07-28", scheduledTime: null, scheduledAt: null });
  });
});
