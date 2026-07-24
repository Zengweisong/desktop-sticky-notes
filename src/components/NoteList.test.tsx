// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Note } from "../types/note";
import type { RepeatSeries } from "../types/repeat";
import { NoteList } from "./NoteList";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const notes: Note[] = [
  makeNote(1, "第一项"),
  makeNote(2, "第二项")
];

describe("NoteList drag sorting", () => {
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    container?.remove();
    container = null;
  });

  it("moves an item with pointer events without relying on an HTML drop event", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onMove = vi.fn().mockResolvedValue(true);

    await act(async () => {
      root.render(<NoteList notes={notes} categories={[]} loading={false}
        onToggleCompleted={vi.fn()} onTogglePinned={vi.fn()} onEdit={vi.fn()}
        onMove={onMove} onDelete={vi.fn()} />);
    });

    const handles = container.querySelectorAll<HTMLButtonElement>(".drag-handle");
    const cards = container.querySelectorAll<HTMLElement>(".note-card");
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => cards[1] });
    Object.defineProperties(handles[0], {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: () => true },
      releasePointerCapture: { configurable: true, value: vi.fn() }
    });

    await act(async () => {
      handles[0].dispatchEvent(pointerEvent("pointerdown", 0));
      handles[0].dispatchEvent(pointerEvent("pointermove", 20));
      handles[0].dispatchEvent(pointerEvent("pointerup", 20));
    });

    expect(onMove).toHaveBeenCalledWith(1, 2, "after");
    await act(async () => root.unmount());
  });

  it("does not start sorting for small pointer jitter", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onMove = vi.fn().mockResolvedValue(true);

    await act(async () => {
      root.render(<NoteList notes={notes} categories={[]} loading={false}
        onToggleCompleted={vi.fn()} onTogglePinned={vi.fn()} onEdit={vi.fn()}
        onMove={onMove} onDelete={vi.fn()} />);
    });

    const handle = container.querySelector<HTMLButtonElement>(".drag-handle")!;
    Object.defineProperties(handle, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: () => true },
      releasePointerCapture: { configurable: true, value: vi.fn() }
    });

    await act(async () => {
      handle.dispatchEvent(pointerEvent("pointerdown", 20));
      handle.dispatchEvent(pointerEvent("pointermove", 25));
      handle.dispatchEvent(pointerEvent("pointerup", 25));
    });

    expect(onMove).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("hides an expired reminder without leaving a details row behind", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const expired = {
      ...makeNote(3, "已过提醒事项"),
      scheduledAt: "2026-07-17T12:10:00.000Z",
      reminderEnabled: true,
      reminderAt: "2026-07-17T11:50:00.000Z"
    };

    await act(async () => {
      root.render(<NoteList notes={[expired]} categories={[]} loading={false}
        onToggleCompleted={vi.fn()} onTogglePinned={vi.fn()} onEdit={vi.fn()}
        onMove={vi.fn()} onDelete={vi.fn()} />);
    });

    expect(container.querySelector(".reminder-badge")).toBeNull();
    expect(container.querySelector(".expand-button")).toBeNull();
    await act(async () => root.unmount());
    vi.useRealTimers();
  });

  it("automatically removes a reminder when its time passes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const upcoming = {
      ...makeNote(4, "即将提醒事项"),
      scheduledAt: "2026-07-17T12:10:00.000Z",
      reminderEnabled: true,
      reminderAt: "2026-07-17T12:01:00.000Z"
    };

    await act(async () => {
      root.render(<NoteList notes={[upcoming]} categories={[]} loading={false}
        onToggleCompleted={vi.fn()} onTogglePinned={vi.fn()} onEdit={vi.fn()}
        onMove={vi.fn()} onDelete={vi.fn()} />);
    });
    expect(container.querySelector(".reminder-badge")).not.toBeNull();
    await act(async () => {
      container!.querySelector<HTMLButtonElement>(".expand-button")!.click();
    });
    expect(container.querySelector(".note-schedule-details")).not.toBeNull();

    await act(async () => { vi.advanceTimersByTime(60_100); });

    expect(container.querySelector(".reminder-badge")).toBeNull();
    expect(container.querySelector(".expand-button")).toBeNull();
    await act(async () => root.unmount());
    vi.useRealTimers();
  });

  it("does not present a repeat occurrence date as an item time", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const repeated = {
      ...makeNote(5, "每日更新信息"),
      scheduledAt: "2026-07-23T00:00:00.000Z",
      repeatSeriesId: 4,
      repeatOccurrenceAt: "2026-07-23T00:00:00.000Z"
    };

    await act(async () => {
      root.render(<NoteList notes={[repeated]} categories={[]} repeatSeries={[makeSeries(4)]} loading={false}
        onToggleCompleted={vi.fn()} onTogglePinned={vi.fn()} onEdit={vi.fn()}
        onMove={vi.fn()} onDelete={vi.fn()} />);
    });

    expect(container.querySelector(".due-badge")).toBeNull();
    await act(async () => container!.querySelector<HTMLButtonElement>(".expand-button")!.click());
    expect(container.querySelector(".note-schedule-details")?.textContent).toContain("事项时间未设置");
    await act(async () => root.unmount());
  });

  it("keeps completed items hidden until the persisted section is enabled and expanded", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const completed = makeNote(9, "已经完成", true);
    const onExpandedChange = vi.fn();
    const onToggleCompleted = vi.fn().mockResolvedValue(true);
    const common = {
      notes: [makeNote(8, "仍需处理"), completed], categories: [], loading: false,
      onToggleCompleted, onTogglePinned: vi.fn(), onEdit: vi.fn(), onMove: vi.fn(), onDelete: vi.fn()
    };

    await act(async () => root.render(<NoteList {...common} />));
    expect(container.textContent).toContain("仍需处理");
    expect(container.textContent).not.toContain("已经完成");
    expect(container.querySelector(".completed-section")).toBeNull();

    await act(async () => root.render(<NoteList {...common} showCompleted completedExpanded={false}
      onCompletedExpandedChange={onExpandedChange} />));
    expect(container.querySelector(".completed-section-trigger")?.textContent).toContain("已完成 1");
    expect(container.textContent).not.toContain("已经完成");
    await act(async () => container!.querySelector<HTMLButtonElement>(".completed-section-trigger")!.click());
    expect(onExpandedChange).toHaveBeenCalledWith(true);

    await act(async () => root.render(<NoteList {...common} showCompleted completedExpanded
      onCompletedExpandedChange={onExpandedChange} />));
    expect(container.textContent).toContain("已经完成");
    const completedCard = container.querySelector<HTMLElement>('[data-note-id="9"]')!;
    await act(async () => completedCard.querySelector<HTMLButtonElement>(".check-button")!.click());
    expect(onToggleCompleted).toHaveBeenCalledWith(completed);
    await act(async () => root.unmount());
  });

  it("does not render a completed section when no completed items exist", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<NoteList notes={[makeNote(10, "待办")]} categories={[]} loading={false}
      showCompleted completedExpanded onCompletedExpandedChange={vi.fn()}
      onToggleCompleted={vi.fn()} onTogglePinned={vi.fn()} onEdit={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} />));
    expect(container.querySelector(".completed-section")).toBeNull();
    await act(async () => root.unmount());
  });
});

function pointerEvent(type: string, clientY: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: 10 },
    clientY: { value: clientY },
    pointerId: { value: 1 }
  });
  return event;
}

function makeNote(id: number, title: string, completed = false): Note {
  return {
    id, title, details: null, categoryId: null, completed, pinned: false,
    priority: "normal", createdAt: `2026-07-15T00:00:${String(id).padStart(2, "0")}.000Z`,
    updatedAt: `2026-07-15T00:00:${String(id).padStart(2, "0")}.000Z`, completedAt: completed ? "2026-07-16T00:00:00.000Z" : null, dueAt: null, sortOrder: 0,
    scheduledAt: null, repeatSeriesId: null, repeatOccurrenceAt: null,
    reminderEnabled: false, reminderAt: null, reminderOffsetMinutes: 0, reminderTriggeredAt: null,
    boardColumnId: completed ? "completed" : "todo", boardOrder: id * 10,
    status: completed ? "completed" : "todo", previousBoardColumnId: null
  };
}

function makeSeries(id: number): RepeatSeries {
  return {
    id, title: "每日更新信息", details: null, categoryId: null, priority: "normal",
    repeatType: "daily", repeatInterval: 1, repeatWeekdays: [], repeatMonthDay: null,
    startAt: "2026-07-23T00:00:00.000Z", endType: "never", endDate: null,
    maxOccurrences: null, generatedOccurrences: 1, defaultReminderEnabled: false,
    defaultReminderTime: null, defaultReminderOffsetMinutes: 0, nextOccurrenceAt: null,
    active: true, createdAt: "2026-07-23T00:00:00.000Z", updatedAt: "2026-07-23T00:00:00.000Z"
  };
}
