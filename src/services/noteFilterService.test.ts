import { describe, expect, it } from "vitest";
import type { Note } from "../types/note";
import { filterNotes } from "./noteFilterService";

describe("noteFilterService", () => {
  const today = new Date(2026, 6, 17, 12, 0);
  const todayAt = new Date(2026, 6, 17, 9, 0).toISOString();
  const tomorrowAt = new Date(2026, 6, 18, 9, 0).toISOString();
  const yesterdayAt = new Date(2026, 6, 16, 9, 0).toISOString();
  const notes = [
    makeNote(1, 1, false, { scheduledAt: todayAt }),
    makeNote(2, 1, false, { dueAt: todayAt }),
    makeNote(3, 1, false, { reminderAt: todayAt }),
    makeNote(4, 1, true, { scheduledAt: todayAt }),
    makeNote(5, 2, false, { scheduledAt: todayAt }),
    makeNote(6, 1, false, { scheduledAt: tomorrowAt }),
    makeNote(7, 1, false, { dueAt: yesterdayAt }),
    makeNote(8, 1, false, {})
  ];

  it("combines time and category filters without changing completion visibility", () => {
    expect(filterNotes(notes, "all", 1, today).map(({ id }) => id)).toEqual([1, 2, 3, 4, 6, 7, 8]);
    expect(filterNotes(notes, "today", 1, today).map(({ id }) => id)).toEqual([1, 2, 3, 4]);
    expect(filterNotes(notes, "today", null, today).map(({ id }) => id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("supports overdue, future, and undated ranges", () => {
    expect(filterNotes(notes, "overdue", 1, today).map(({ id }) => id)).toEqual([7]);
    expect(filterNotes(notes, "future", 1, today).map(({ id }) => id)).toEqual([6]);
    expect(filterNotes(notes, "undated", 1, today).map(({ id }) => id)).toEqual([2, 3, 7, 8]);
  });
});

function makeNote(
  id: number,
  categoryId: number,
  completed: boolean,
  times: Partial<Pick<Note, "scheduledAt" | "dueAt" | "reminderAt">>
): Note {
  return {
    id,
    title: `事项 ${id}`,
    details: null,
    categoryId,
    completed,
    pinned: false,
    priority: "normal",
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    completedAt: completed ? "2026-07-16T00:00:00.000Z" : null,
    dueAt: times.dueAt ?? null,
    sortOrder: id,
    scheduledAt: times.scheduledAt ?? null, scheduledDate: null, scheduledTime: null,
    repeatSeriesId: null,
    repeatOccurrenceAt: null,
    reminderEnabled: Boolean(times.reminderAt),
    reminderAt: times.reminderAt ?? null,
    reminderOffsetMinutes: 0,
    reminderTriggeredAt: null,
    boardColumnId: completed ? "completed" : "todo",
    boardOrder: id * 10,
    status: completed ? "completed" : "todo",
    previousBoardColumnId: null
  };
}
