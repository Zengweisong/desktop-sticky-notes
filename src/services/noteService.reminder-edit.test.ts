import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  select: vi.fn(),
  execute: vi.fn()
};

vi.mock("./database", () => ({ getDatabase: vi.fn(async () => db) }));
vi.mock("./reminderService", () => ({
  ReminderService: {
    updateReminder: vi.fn(async () => "2026-07-20T07:00:00.000Z"),
    cancelReminder: vi.fn(async () => undefined),
    scheduleReminder: vi.fn(async () => "2026-07-20T07:00:00.000Z")
  }
}));

import { createNote, updateNote } from "./noteService";
import { ReminderService } from "./reminderService";

describe("editing a reminder through the pooled Tauri database", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.select.mockReset();
    db.execute.mockReset();
    db.select
      .mockResolvedValueOnce([existingNoteRow()])
      .mockResolvedValueOnce([{ id: 1 }]);
    db.execute.mockImplementation(async (sql: string) => {
      if (sql === "COMMIT") throw "cannot commit - no transaction is active";
      return { rowsAffected: 1, lastInsertId: 0 };
    });
  });

  it("saves the reminder without cross-invocation transaction statements", async () => {
    await expect(updateNote(7, {
      title: "提交周报",
      details: "发送给团队",
      categoryId: 1,
      priority: "normal",
      scheduledAt: "2026-07-20T08:00:00.000Z",
      reminderEnabled: true,
      reminderOffsetMinutes: 60,
      repeatEnabled: false
    })).resolves.toBeUndefined();

    expect(db.execute.mock.calls.flat().join(" ")).not.toMatch(/BEGIN|COMMIT|ROLLBACK/);
    expect(ReminderService.updateReminder).toHaveBeenCalledWith(7, expect.objectContaining({
      reminderEnabled: true,
      reminderOffsetMinutes: 60
    }));
    const updateCall = db.execute.mock.calls.find(([sql]) => sql.includes("UPDATE notes SET content"));
    expect(updateCall?.[0]).not.toMatch(/due_at|is_all_day|all_day_reminder_time/);
    expect(updateCall?.[1]).toEqual([
      "提交周报", "发送给团队", 1, "normal", "2026-07-20T08:00:00.000Z",
      1, "2026-07-20T07:00:00.000Z", 60, "series", expect.any(String), 7
    ]);
  });

  it("cancels and clears a reminder when reminder is disabled", async () => {
    await expect(updateNote(7, {
      title: "提交周报",
      categoryId: 1,
      priority: "normal",
      scheduledAt: "2026-07-20T08:00:00.000Z",
      reminderEnabled: false,
      reminderOffsetMinutes: 60,
      repeatEnabled: false
    })).resolves.toBeUndefined();

    expect(ReminderService.cancelReminder).toHaveBeenCalledWith(7);
    expect(ReminderService.updateReminder).not.toHaveBeenCalled();
    const updateCall = db.execute.mock.calls.find(([sql]) => sql.includes("UPDATE notes SET content"));
    expect(updateCall?.[1]).toEqual([
      "提交周报", null, 1, "normal", "2026-07-20T08:00:00.000Z",
      0, null, 60, "series", expect.any(String), 7
    ]);
  });

  it("detaches one repeat occurrence after its item time is cleared", async () => {
    db.select.mockReset();
    db.select
      .mockResolvedValueOnce([{
        ...existingNoteRow(),
        scheduled_at: "2026-07-20T16:00:00.000Z",
        repeat_series_id: 3,
        repeat_occurrence_at: "2026-07-20T16:00:00.000Z",
        reminder_enabled: 1,
        reminder_at: "2026-07-21T01:00:00.000Z"
      }])
      .mockResolvedValueOnce([{ id: 1 }]);

    await expect(updateNote(7, {
      title: "提交周报",
      categoryId: 1,
      priority: "normal",
      scheduledAt: null,
      reminderEnabled: false,
      repeatEnabled: false,
      repeatEditScope: "occurrence"
    })).resolves.toBeUndefined();

    expect(db.execute).toHaveBeenCalledWith(
      "UPDATE notes SET repeat_series_id=NULL, repeat_occurrence_at=NULL WHERE id=$1", [7]
    );
    const updateCall = db.execute.mock.calls.find(([sql]) => sql.includes("UPDATE notes SET content"));
    expect(updateCall?.[1]).toEqual([
      "提交周报", null, 1, "normal", null, 0, null, 10, "occurrence", expect.any(String), 7
    ]);
    expect(db.execute.mock.calls.map(([sql]) => sql).join(" ")).not.toMatch(/BEGIN|COMMIT|ROLLBACK/);
  });
});

describe("creating with the unified item time", () => {
  it("writes scheduled_at but no legacy date or second reminder target", async () => {
    vi.clearAllMocks();
    db.select.mockReset();
    db.execute.mockReset();
    db.select
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([{ next_order: 10 }])
      .mockResolvedValueOnce([{ ...existingNoteRow(), scheduled_at: "2026-07-20T08:00:00.000Z" }]);
    db.execute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 8 });

    await createNote({
      title: "统一时间",
      categoryId: 1,
      scheduledAt: "2026-07-20T08:00:00.000Z",
      reminderEnabled: true,
      reminderOffsetMinutes: 60
    });

    const insertCall = db.execute.mock.calls.find(([sql]) => sql.includes("INSERT INTO notes"));
    expect(insertCall?.[0]).toContain("scheduled_at");
    expect(insertCall?.[0]).not.toMatch(/due_at|is_all_day|all_day_reminder_time|reminder_target|reminder_datetime/i);
  });
});

function existingNoteRow() {
  return {
    id: 7,
    title: "提交周报",
    content: "提交周报",
    details: null,
    category_id: 1,
    completed: 0,
    pinned: 0,
    priority: "normal",
    created_at: "2026-07-16T00:00:00.000Z",
    updated_at: "2026-07-16T00:00:00.000Z",
    completed_at: null,
    due_at: null,
    sort_order: 10,
    scheduled_at: null,
    repeat_series_id: null,
    repeat_occurrence_at: null,
    reminder_enabled: 0,
    reminder_at: null,
    reminder_offset_minutes: 0,
    reminder_triggered_at: null,
    is_all_day: 0,
    all_day_reminder_time: null
  };
}
