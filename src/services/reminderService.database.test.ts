import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDatabase } from "./database";
import { ReminderService } from "./reminderService";

vi.mock("./database", () => ({ getDatabase: vi.fn() }));

describe("ReminderService persistence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("atomically claims a due reminder so a second check cannot trigger it again", async () => {
    let claimed = false;
    const db = {
      select: vi.fn(async () => [{
        id: 7,
        title: "测试提醒",
        details: null,
        category_name: "工作",
        scheduled_at: "2026-07-16T10:00:00.000Z",
        reminder_at: "2026-07-16T09:50:00.000Z"
      }]),
      execute: vi.fn(async (sql: string) => {
        if (sql.includes("SET reminder_triggered_at=$1")) {
          if (claimed) return { rowsAffected: 0, lastInsertId: 0 };
          claimed = true;
          return { rowsAffected: 1, lastInsertId: 0 };
        }
        return { rowsAffected: 1, lastInsertId: 0 };
      })
    };
    vi.mocked(getDatabase).mockResolvedValue(db as never);

    const now = new Date("2026-07-16T10:00:00.000Z");
    await expect(ReminderService.checkMissedReminders(now)).resolves.toBe(1);
    await expect(ReminderService.checkMissedReminders(now)).resolves.toBe(0);
  });
});
