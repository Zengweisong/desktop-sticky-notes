// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "../types/note";
import { useNoteStore } from "../stores/noteStore";

const noteService = vi.hoisted(() => ({
  listNotes: vi.fn(),
  rescheduleNote: vi.fn()
}));

vi.mock("../services/noteService", () => ({
  ...noteService,
  createNote: vi.fn(), updateNote: vi.fn(), setNoteCompleted: vi.fn(), setNotePinned: vi.fn(),
  setRepeatActive: vi.fn(), moveNote: vi.fn(), deleteNote: vi.fn(), clearCompletedNotes: vi.fn()
}));
vi.mock("../services/repeatTaskService", () => ({ listRepeatSeries: vi.fn(async () => []) }));

import { useNotes } from "./useNotes";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useNotes calendar rescheduling", () => {
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    useNoteStore.setState({ notes: [note], repeatSeries: [], loading: false });
  });

  afterEach(() => { container?.remove(); container = null; });

  it("optimistically moves once, then rolls back exactly once when persistence fails", async () => {
    let rejectSave!: (error: Error) => void;
    noteService.rescheduleNote.mockReturnValueOnce(new Promise<void>((_, reject) => { rejectSave = reject; }));
    const onError = vi.fn();
    let api!: ReturnType<typeof useNotes>;
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    function Harness() { api = useNotes(onError); return null; }
    await act(async () => root.render(<Harness />));

    let saving!: Promise<boolean>;
    await act(async () => { saving = api.reschedule(note, "2026-07-28"); await Promise.resolve(); });
    expect(useNoteStore.getState().notes).toHaveLength(1);
    expect(useNoteStore.getState().notes[0]).toMatchObject({ scheduledDate: "2026-07-28", scheduledTime: null });

    await act(async () => { rejectSave(new Error("磁盘写入失败")); await saving; });
    expect(useNoteStore.getState().notes).toEqual([note]);
    expect(onError).toHaveBeenCalledWith("磁盘写入失败");
    await act(async () => root.unmount());
  });

  it("serializes rapid moves for one item and keeps the latest date", async () => {
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const first = new Promise<void>((resolve) => { resolveFirst = resolve; });
    const second = new Promise<void>((resolve) => { resolveSecond = resolve; });
    noteService.rescheduleNote
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    noteService.listNotes.mockResolvedValueOnce([{ ...note, scheduledDate: "2026-07-29" }]);
    const onError = vi.fn();
    let api!: ReturnType<typeof useNotes>;
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    function Harness() { api = useNotes(onError); return null; }
    await act(async () => root.render(<Harness />));

    let firstMove!: Promise<boolean>;
    let secondMove!: Promise<boolean>;
    await act(async () => {
      firstMove = api.reschedule(note, "2026-07-28");
      secondMove = api.reschedule(note, "2026-07-29");
      await Promise.resolve();
    });
    expect(noteService.rescheduleNote).toHaveBeenCalledTimes(1);
    expect(useNoteStore.getState().notes[0].scheduledDate).toBe("2026-07-29");

    await act(async () => { resolveFirst(); await firstMove; });
    expect(noteService.rescheduleNote).toHaveBeenNthCalledWith(2, 7, "2026-07-29");
    await act(async () => { resolveSecond(); await secondMove; });

    expect(useNoteStore.getState().notes[0].scheduledDate).toBe("2026-07-29");
    expect(onError).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("allows a newer queued move to succeed after an older save fails", async () => {
    let rejectFirst!: (error: Error) => void;
    let resolveSecond!: () => void;
    noteService.rescheduleNote
      .mockReturnValueOnce(new Promise<void>((_, reject) => { rejectFirst = reject; }))
      .mockReturnValueOnce(new Promise<void>((resolve) => { resolveSecond = resolve; }));
    noteService.listNotes.mockResolvedValueOnce([{ ...note, scheduledDate: "2026-07-29" }]);
    const onError = vi.fn();
    let api!: ReturnType<typeof useNotes>;
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    function Harness() { api = useNotes(onError); return null; }
    await act(async () => root.render(<Harness />));

    let firstMove!: Promise<boolean>;
    let secondMove!: Promise<boolean>;
    await act(async () => {
      firstMove = api.reschedule(note, "2026-07-28");
      secondMove = api.reschedule(note, "2026-07-29");
      await Promise.resolve();
    });
    await act(async () => { rejectFirst(new Error("first failed")); await firstMove; });
    await act(async () => { resolveSecond(); await secondMove; });

    expect(noteService.rescheduleNote.mock.calls).toEqual([
      [7, "2026-07-28"],
      [7, "2026-07-29"]
    ]);
    expect(useNoteStore.getState().notes[0].scheduledDate).toBe("2026-07-29");
    expect(onError).toHaveBeenCalledWith("first failed");
    await act(async () => root.unmount());
  });

  it("ignores a stale full refresh when different items finish out of order", async () => {
    const secondNote = { ...note, id: 8, title: "Second", scheduledDate: "2026-07-27" };
    useNoteStore.setState({ notes: [note, secondNote], repeatSeries: [], loading: false });
    noteService.rescheduleNote.mockResolvedValue(undefined);
    let resolveOlder!: (notes: Note[]) => void;
    let resolveNewer!: (notes: Note[]) => void;
    noteService.listNotes
      .mockReturnValueOnce(new Promise<Note[]>((resolve) => { resolveOlder = resolve; }))
      .mockReturnValueOnce(new Promise<Note[]>((resolve) => { resolveNewer = resolve; }));
    const onError = vi.fn();
    let api!: ReturnType<typeof useNotes>;
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    function Harness() { api = useNotes(onError); return null; }
    await act(async () => root.render(<Harness />));

    let olderMove!: Promise<boolean>;
    let newerMove!: Promise<boolean>;
    await act(async () => {
      olderMove = api.reschedule(note, "2026-07-28");
      newerMove = api.reschedule(secondNote, "2026-07-29");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(noteService.listNotes).toHaveBeenCalledTimes(2);

    const newestState = [
      { ...note, scheduledDate: "2026-07-28" },
      { ...secondNote, scheduledDate: "2026-07-29" }
    ];
    await act(async () => { resolveNewer(newestState); await newerMove; });
    await act(async () => {
      resolveOlder([{ ...note, scheduledDate: "2026-07-28" }, secondNote]);
      await olderMove;
    });

    expect(useNoteStore.getState().notes).toEqual(newestState);
    expect(onError).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});

const note: Note = {
  id: 7, title: "仅日期事项", details: null, categoryId: 1, completed: false, pinned: false,
  priority: "normal", createdAt: "2026-07-27T00:00:00.000Z", updatedAt: "2026-07-27T00:00:00.000Z",
  completedAt: null, dueAt: null, sortOrder: 10, scheduledAt: null,
  scheduledDate: "2026-07-27", scheduledTime: null, repeatSeriesId: null, repeatOccurrenceAt: null,
  reminderEnabled: false, reminderAt: null, reminderOffsetMinutes: 10, reminderTriggeredAt: null,
  boardColumnId: "todo", boardOrder: 10, status: "todo", previousBoardColumnId: null
};
