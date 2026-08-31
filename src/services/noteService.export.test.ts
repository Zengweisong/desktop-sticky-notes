import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteRow } from "../types/note";

const db = {
  select: vi.fn(),
  execute: vi.fn()
};

vi.mock("./database", () => ({ getDatabase: vi.fn(async () => db) }));
vi.mock("./boardService", () => ({
  ensureBoardPlacement: vi.fn(async () => undefined),
  setBoardNoteCompleted: vi.fn(async () => undefined)
}));

import { exportNotes, importNotes, listNotes } from "./noteService";

describe("note export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.select.mockImplementation(async (sql: string) => sql.includes("FROM notes")
      ? [repeatOccurrence(1, "2026-08-25T00:00:00.000Z"), repeatOccurrence(2, "2026-08-26T00:00:00.000Z")]
      : []);
    db.execute.mockResolvedValue({ rowsAffected: 0, lastInsertId: 0 });
  });

  it("collapses repeat history in the UI but keeps every occurrence in backups", async () => {
    await expect(listNotes()).resolves.toHaveLength(1);

    const payload = await exportNotes();

    expect(payload.notes.map(({ id }) => id)).toEqual([1, 2]);
  });

  it("preserves legacy scheduledAt when a v3 backup predates split date fields", async () => {
    const scheduledAt = new Date(2026, 7, 20, 9, 30).toISOString();
    db.select.mockResolvedValue([{ id: 1 }]);

    await importNotes({
      version: 3,
      exportedAt: new Date().toISOString(),
      categories: [{
        id: 1, name: "未分类", color: "#64748b", icon: null,
        sortOrder: 0, createdAt: new Date().toISOString(), isSystem: true
      }],
      repeatSeries: [],
      notes: [{
        title: "旧备份事项", details: null, categoryId: 1,
        completed: false, pinned: false, priority: "normal",
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        completedAt: null, dueAt: null, sortOrder: 10, scheduledAt
      }]
    });

    const insert = db.execute.mock.calls.find(([sql]) => sql.includes("INSERT INTO notes"));
    expect(insert?.[1]?.slice(11, 14)).toEqual([scheduledAt, "2026-08-20", "09:30"]);
  });
});

function repeatOccurrence(id: number, occurredAt: string): NoteRow {
  return {
    id,
    title: "每日事项",
    content: "每日事项",
    details: null,
    category_id: null,
    completed: id === 1 ? 1 : 0,
    pinned: 0,
    priority: "normal",
    created_at: occurredAt,
    updated_at: occurredAt,
    completed_at: id === 1 ? occurredAt : null,
    due_at: null,
    sort_order: id * 10,
    scheduled_at: occurredAt,
    scheduled_date: occurredAt.slice(0, 10),
    scheduled_time: null,
    repeat_series_id: 7,
    repeat_occurrence_at: occurredAt,
    reminder_enabled: 0,
    reminder_at: null,
    reminder_offset_minutes: 0,
    reminder_triggered_at: null,
    board_column_id: id === 1 ? "completed" : "todo",
    board_order: id * 10,
    status: id === 1 ? "completed" : "todo",
    previous_board_column_id: null
  };
}
