import { describe, expect, it } from "vitest";
import { isNoteRelevantOnLocalDate, isScheduledOnLocalDate } from "./noteDateService";

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
