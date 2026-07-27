import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  select: vi.fn(),
  execute: vi.fn()
};

vi.mock("./database", () => ({ getDatabase: vi.fn(async () => db) }));
vi.mock("./reminderService", () => ({
  ReminderService: {
    calculateReminderAt: vi.fn(() => "2026-07-28T00:30:00.000Z"),
    updateReminder: vi.fn(async () => "2026-07-20T07:00:00.000Z"),
    cancelReminder: vi.fn(async () => undefined),
    scheduleReminder: vi.fn(async () => "2026-07-20T07:00:00.000Z")
  }
}));

import { createNote, rescheduleNote, updateNote } from "./noteService";
import { ReminderService } from "./reminderService";
import { generateDueOccurrences } from "./repeatTaskService";

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
      "2026-07-20", "16:00", 1, "2026-07-20T07:00:00.000Z", 60, "series", expect.any(String), 7
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
      "2026-07-20", "16:00", 0, null, 60, "series", expect.any(String), 7
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
      "提交周报", null, 1, "normal", null, null, null, 0, null, 10, "occurrence", expect.any(String), 7
    ]);
    expect(db.execute.mock.calls.map(([sql]) => sql).join(" ")).not.toMatch(/BEGIN|COMMIT|ROLLBACK/);
  });

  it("keeps a later occurrence on its own date when editing the whole repeat series", async () => {
    const occurrenceAt = "2026-07-21T00:00:00.000Z";
    db.select.mockReset();
    db.select
      .mockResolvedValueOnce([{
        ...existingNoteRow(), scheduled_at: occurrenceAt,
        repeat_series_id: 3, repeat_occurrence_at: occurrenceAt
      }])
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([repeatSeriesRow()])
      .mockResolvedValueOnce([repeatSeriesRow()]);

    await updateNote(7, {
      title: "提交周报", categoryId: 1, priority: "normal",
      repeatEnabled: true, repeatType: "daily", repeatStartDate: "2026-07-20",
      repeatReminderEnabled: true, repeatReminderTime: "09:00", repeatEditScope: "series"
    });

    const updateCall = db.execute.mock.calls.find(([sql]) => sql.includes("UPDATE notes SET content"));
    expect(updateCall?.[1]?.[4]).toBe(occurrenceAt);
  });

  it("restores the series definition if saving the edited occurrence fails", async () => {
    const occurrenceAt = "2026-07-21T00:00:00.000Z";
    db.select.mockReset();
    db.select
      .mockResolvedValueOnce([{
        ...existingNoteRow(), scheduled_at: occurrenceAt,
        repeat_series_id: 3, repeat_occurrence_at: occurrenceAt
      }])
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([repeatSeriesRow()])
      .mockResolvedValueOnce([repeatSeriesRow()]);
    db.execute.mockImplementation(async (sql: string) => {
      if (sql.includes("UPDATE notes SET content")) throw new Error("unique occurrence");
      return { rowsAffected: 1, lastInsertId: 0 };
    });

    await expect(updateNote(7, {
      title: "修改后的周报", categoryId: 1, priority: "high",
      repeatEnabled: true, repeatType: "daily", repeatStartDate: "2026-07-22",
      repeatReminderEnabled: true, repeatReminderTime: "10:00", repeatEditScope: "series"
    })).rejects.toThrow("unique occurrence");

    const seriesUpdates = db.execute.mock.calls.filter(([sql]) => sql.includes("UPDATE repeat_series SET"));
    expect(seriesUpdates).toHaveLength(2);
    expect(seriesUpdates[1][1]?.[0]).toBe("提交周报");
    expect(seriesUpdates[1][1]?.[8]).toBe("2026-07-20T00:00:00.000Z");
  });

  it("waits for in-flight generation before editing the whole repeat series", async () => {
    let releaseGeneration!: () => void;
    let generationReady!: () => void;
    const waitForRelease = new Promise<void>((resolve) => { releaseGeneration = resolve; });
    const generationStarted = new Promise<void>((resolve) => { generationReady = resolve; });
    const events: string[] = [];
    const row = repeatSeriesRow();
    db.select.mockReset();
    db.execute.mockReset();
    db.select.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM repeat_series WHERE active")) {
        events.push("generate-select");
        generationReady();
        await waitForRelease;
        return [row];
      }
      if (sql.includes("FROM notes WHERE id")) {
        events.push("edit-note-select");
        return [{
          ...existingNoteRow(), scheduled_at: "2026-07-21T00:00:00.000Z",
          repeat_series_id: 3, repeat_occurrence_at: "2026-07-21T00:00:00.000Z"
        }];
      }
      if (sql.includes("FROM repeat_series WHERE id")) return [row];
      return [{ id: 1 }];
    });
    db.execute.mockImplementation(async (sql: string) => {
      if (sql.includes("UPDATE repeat_series SET generated_occurrences")) events.push("generate-update");
      if (sql.includes("UPDATE notes SET content")) events.push("edit-note-update");
      return { rowsAffected: 1, lastInsertId: 0 };
    });

    const generating = generateDueOccurrences(new Date("2026-07-22T12:00:00.000Z"));
    await generationStarted;
    const editing = updateNote(7, {
      title: "提交周报", categoryId: 1, priority: "normal",
      repeatEnabled: true, repeatType: "daily", repeatStartDate: "2026-07-20",
      repeatReminderEnabled: true, repeatReminderTime: "09:00", repeatEditScope: "series"
    });
    await Promise.resolve();
    expect(events).toEqual(["generate-select"]);
    releaseGeneration();
    await Promise.all([generating, editing]);

    expect(events.indexOf("generate-update")).toBeLessThan(events.indexOf("edit-note-select"));
    expect(events[events.length - 1]).toBe("edit-note-update");
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

  it("stores a date-only item without synthesizing scheduled_at or a time", async () => {
    vi.clearAllMocks();
    db.select.mockReset();
    db.execute.mockReset();
    db.select
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([{ next_order: 10 }])
      .mockResolvedValueOnce([{ ...existingNoteRow(), scheduled_date: "2026-07-20", scheduled_time: null }]);
    db.execute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 8 });

    await createNote({ title: "仅日期", categoryId: 1, scheduledDate: "2026-07-20", scheduledTime: null });

    const insertCall = db.execute.mock.calls.find(([sql]) => sql.includes("INSERT INTO notes"));
    expect(insertCall?.[1]?.slice(5, 8)).toEqual([null, "2026-07-20", null]);
  });
});

describe("rescheduling from the calendar", () => {
  it("changes only the date and preserves an explicit time", async () => {
    vi.clearAllMocks();
    db.select.mockResolvedValueOnce([{
      ...existingNoteRow(), scheduled_at: new Date(2026, 6, 27, 9, 30).toISOString(),
      scheduled_date: "2026-07-27", scheduled_time: "09:30"
    }]);
    db.execute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 });

    await rescheduleNote(7, "2026-07-28");

    const values = db.execute.mock.calls[0][1];
    expect(values?.slice(1, 3)).toEqual(["2026-07-28", "09:30"]);
    const scheduled = new Date(values?.[0] as string);
    expect([scheduled.getFullYear(), scheduled.getMonth(), scheduled.getDate(), scheduled.getHours(), scheduled.getMinutes()])
      .toEqual([2026, 6, 28, 9, 30]);
    expect(ReminderService.cancelReminder).toHaveBeenCalledWith(7);
  });

  it("does not cancel the existing reminder until the date update succeeds", async () => {
    vi.clearAllMocks();
    db.select.mockResolvedValueOnce([{
      ...existingNoteRow(), scheduled_at: new Date(2026, 6, 27, 9, 30).toISOString(),
      scheduled_date: "2026-07-27", scheduled_time: "09:30",
      reminder_enabled: 1, reminder_at: "2026-07-27T00:30:00.000Z",
      reminder_offset_minutes: 60
    }]);
    db.execute.mockRejectedValueOnce(new Error("save failed"));

    await expect(rescheduleNote(7, "2026-07-28")).rejects.toThrow("save failed");

    expect(ReminderService.calculateReminderAt).toHaveBeenCalled();
    expect(ReminderService.cancelReminder).not.toHaveBeenCalled();
  });

  it("rejects an invalid target before persistence or reminder side effects", async () => {
    vi.clearAllMocks();
    db.select.mockResolvedValueOnce([existingNoteRow()]);

    await expect(rescheduleNote(7, "2026-02-30")).rejects.toThrow("事项日期无效");

    expect(db.execute).not.toHaveBeenCalled();
    expect(ReminderService.calculateReminderAt).not.toHaveBeenCalled();
    expect(ReminderService.cancelReminder).not.toHaveBeenCalled();
  });

  it("keeps a date-only item time null and can move it back to unscheduled", async () => {
    vi.clearAllMocks();
    db.select
      .mockResolvedValueOnce([{ ...existingNoteRow(), scheduled_date: "2026-07-27", scheduled_time: null }])
      .mockResolvedValueOnce([{ ...existingNoteRow(), scheduled_date: "2026-07-28", scheduled_time: null }]);
    db.execute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 });

    await rescheduleNote(7, "2026-07-28");
    await rescheduleNote(7, null);

    expect(db.execute.mock.calls[0][1]?.slice(0, 3)).toEqual([null, "2026-07-28", null]);
    expect(db.execute.mock.calls[1][1]?.slice(0, 5)).toEqual([null, null, null, 0, null]);
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

function repeatSeriesRow() {
  return {
    id: 3,
    title: "提交周报",
    details: null,
    category_id: 1,
    priority: "normal",
    repeat_type: "daily",
    repeat_interval: 1,
    repeat_weekdays: null,
    repeat_month_day: null,
    start_at: "2026-07-20T00:00:00.000Z",
    end_type: "never",
    end_date: null,
    max_occurrences: null,
    generated_occurrences: 2,
    default_reminder_enabled: 1,
    default_all_day_reminder_time: "09:00",
    default_reminder_offset_minutes: 0,
    next_occurrence_at: "2026-07-22T00:00:00.000Z",
    active: 1,
    created_at: "2026-07-20T00:00:00.000Z",
    updated_at: "2026-07-20T00:00:00.000Z"
  };
}
