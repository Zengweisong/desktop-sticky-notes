import { describe, expect, it } from "vitest";
import { ReminderService } from "./reminderService";

describe("ReminderService", () => {
  it("calculates minute-precision offsets independently from repeat rules", () => {
    const event = new Date(2026, 6, 20, 15, 0, 0, 0);
    const reminder = new Date(ReminderService.calculateReminderAt(event.toISOString(), 30)!);
    expect([reminder.getHours(), reminder.getMinutes()]).toEqual([14, 30]);
  });

  it("returns no reminder when no item time exists", () => {
    expect(ReminderService.calculateReminderAt(null, 30)).toBeNull();
  });
});
