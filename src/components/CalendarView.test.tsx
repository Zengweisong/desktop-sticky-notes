// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Category } from "../types/category";
import type { Note, NoteInput } from "../types/note";
import { CalendarView } from "./CalendarView";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("CalendarView", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  it("renders a full month, exposes unscheduled tasks, and reuses the existing detail card", async () => {
    ({ container, root } = await renderCalendar());

    expect(container.textContent).toContain("2026年7月");
    expect(container.querySelectorAll(".calendar-day")).toHaveLength(42);
    expect(container.querySelector(".unscheduled-trigger")?.textContent).toContain("未安排1");

    const task = [...container.querySelectorAll<HTMLButtonElement>(".calendar-task")]
      .find((button) => button.textContent?.includes("提交周报"));
    await act(async () => task?.click());
    expect(container.querySelector(".board-detail-dialog")?.textContent).toContain("提交周报");
  });

  it("navigates months and creates a dated task without creating an empty record", async () => {
    const onAdd = vi.fn(async (_input: NoteInput) => true);
    ({ container, root } = await renderCalendar(onAdd));

    const nextMonth = container.querySelector<HTMLButtonElement>('[aria-label="下一个月"]')!;
    await act(async () => nextMonth.click());
    expect(container.textContent).toContain("2026年8月");
    await act(async () => container!.querySelector<HTMLButtonElement>(".calendar-today")!.click());
    expect(container.textContent).toContain("2026年7月");

    const day = container.querySelector<HTMLElement>('[data-date="2026-07-20"]')!;
    await act(async () => day.click());
    expect(onAdd).not.toHaveBeenCalled();

    const title = container.querySelector<HTMLInputElement>('[aria-label="新事项标题"]')!;
    await act(async () => setInputValue(title, "预约体检"));
    const form = container.querySelector<HTMLFormElement>(".calendar-quick-add")!;
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const input = onAdd.mock.calls[0][0];
    expect(input).toMatchObject({ title: "预约体检", categoryId: 1 });
    expect(input).toMatchObject({ scheduledDate: "2026-07-20", scheduledTime: null });
    expect(input.scheduledAt).toBeUndefined();
  });

  it("moves to a reminder task month when the existing focus event is dispatched", async () => {
    ({ container, root } = await renderCalendar());
    await act(async () => window.dispatchEvent(new CustomEvent("focus-note", { detail: 3 })));
    expect(container.textContent).toContain("2026年8月");
    expect(container.querySelector('[data-date="2026-08-05"]')?.classList.contains("selected")).toBe(true);
  });

  it("drags a timed task to an adjacent-month cell without also opening details", async () => {
    const onReschedule = vi.fn(async () => true);
    ({ container, root } = await renderCalendar(undefined, onReschedule));
    const task = [...container.querySelectorAll<HTMLButtonElement>(".calendar-task")]
      .find((button) => button.textContent?.includes("提交周报"))!;
    const target = container.querySelector<HTMLElement>('[data-date="2026-08-01"]')!;
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => target });
    Object.defineProperties(task, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: () => true },
      releasePointerCapture: { configurable: true, value: vi.fn() }
    });

    await act(async () => {
      task.dispatchEvent(pointerEvent("pointerdown", 10, 10));
      task.dispatchEvent(pointerEvent("pointermove", 30, 30));
      task.dispatchEvent(pointerEvent("pointerup", 30, 30));
      task.click();
    });

    expect(onReschedule).toHaveBeenCalledWith(expect.objectContaining({ id: 1, scheduledTime: "10:00" }), "2026-08-01");
    expect(container.querySelector(".board-detail-dialog")).toBeNull();
    expect(container.textContent).toContain("2026年8月");
  });

  it("keeps a normal click when pointer movement stays below the drag threshold", async () => {
    const onReschedule = vi.fn(async () => true);
    ({ container, root } = await renderCalendar(undefined, onReschedule));
    const task = [...container.querySelectorAll<HTMLButtonElement>(".calendar-task")]
      .find((button) => button.textContent?.includes("提交周报"))!;
    Object.defineProperties(task, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: () => true },
      releasePointerCapture: { configurable: true, value: vi.fn() }
    });
    await act(async () => {
      task.dispatchEvent(pointerEvent("pointerdown", 10, 10));
      task.dispatchEvent(pointerEvent("pointermove", 14, 14));
      task.dispatchEvent(pointerEvent("pointerup", 14, 14));
      task.click();
    });
    expect(onReschedule).not.toHaveBeenCalled();
    expect(container.querySelector(".board-detail-dialog")?.textContent).toContain("提交周报");
  });
  it("moves an unscheduled item onto a date without inventing a time", async () => {
    const onReschedule = vi.fn(async () => true);
    ({ container, root } = await renderCalendar(undefined, onReschedule));
    await act(async () => container!.querySelector<HTMLButtonElement>(".unscheduled-trigger")!.click());
    const task = container.querySelector<HTMLButtonElement>('.agenda-task[data-note-id="2"]')!;
    const target = container.querySelector<HTMLElement>('[data-date="2026-07-20"]')!;
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => target });
    installPointerCapture(task);

    await act(async () => {
      task.dispatchEvent(pointerEvent("pointerdown", 10, 10));
      task.dispatchEvent(pointerEvent("pointermove", 30, 30));
      task.dispatchEvent(pointerEvent("pointerup", 30, 30));
    });

    expect(onReschedule).toHaveBeenCalledWith(expect.objectContaining({ id: 2, scheduledTime: null }), "2026-07-20");
  });

  it("moves a dated item to the unscheduled area and clears its date", async () => {
    const onReschedule = vi.fn(async () => true);
    ({ container, root } = await renderCalendar(undefined, onReschedule));
    const task = container.querySelector<HTMLButtonElement>('.calendar-task[data-note-id="1"]')!;
    const target = container.querySelector<HTMLElement>(".unscheduled-trigger")!;
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => target });
    installPointerCapture(task);

    await act(async () => {
      task.dispatchEvent(pointerEvent("pointerdown", 10, 10));
      task.dispatchEvent(pointerEvent("pointermove", 30, 30));
      task.dispatchEvent(pointerEvent("pointerup", 30, 30));
    });

    expect(onReschedule).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), null);
  });

  it("does not persist a drop onto the original date", async () => {
    const onReschedule = vi.fn(async () => true);
    ({ container, root } = await renderCalendar(undefined, onReschedule));
    const task = container.querySelector<HTMLButtonElement>('.calendar-task[data-note-id="1"]')!;
    const target = container.querySelector<HTMLElement>('[data-date="2026-07-18"]')!;
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => target });
    installPointerCapture(task);

    await act(async () => {
      task.dispatchEvent(pointerEvent("pointerdown", 10, 10));
      task.dispatchEvent(pointerEvent("pointermove", 30, 30));
      task.dispatchEvent(pointerEvent("pointerup", 30, 30));
    });

    expect(onReschedule).not.toHaveBeenCalled();
  });

  it("cancels an active pointer drag without changing the date", async () => {
    const onReschedule = vi.fn(async () => true);
    ({ container, root } = await renderCalendar(undefined, onReschedule));
    const task = container.querySelector<HTMLButtonElement>('.calendar-task[data-note-id="1"]')!;
    const target = container.querySelector<HTMLElement>('[data-date="2026-07-20"]')!;
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => target });
    installPointerCapture(task);

    await act(async () => {
      task.dispatchEvent(pointerEvent("pointerdown", 10, 10));
      task.dispatchEvent(pointerEvent("pointermove", 30, 30));
      task.dispatchEvent(pointerEvent("pointercancel", 30, 30));
      task.dispatchEvent(pointerEvent("pointerup", 30, 30));
    });

    expect(onReschedule).not.toHaveBeenCalled();
    expect(container.querySelector(".calendar-drag-preview")).toBeNull();
  });
});

async function renderCalendar(
  onAdd = vi.fn(async (_input: NoteInput) => true),
  onReschedule = vi.fn(async () => true)
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<CalendarView notes={notes} categories={categories} repeatSeries={[]}
    loading={false} defaultCategoryId={1} timeFilter="all" categoryId={null} search="" priority="all"
    onAdd={onAdd} onEdit={async () => true} onToggleCompleted={async () => true}
    onTogglePinned={async () => true} onToggleRepeatActive={async () => true} onDelete={async () => true}
    onReschedule={onReschedule}
    today={new Date(2026, 6, 15, 12)} />));
  return { container, root };
}

function pointerEvent(type: string, clientX: number, clientY: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: 0 }, clientX: { value: clientX }, clientY: { value: clientY }, pointerId: { value: 1 }
  });
  return event;
}

function installPointerCapture(target: HTMLButtonElement) {
  Object.defineProperties(target, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: () => true },
    releasePointerCapture: { configurable: true, value: vi.fn() }
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const categories: Category[] = [
  { id: 1, name: "工作", color: "#6096d8", icon: null, sortOrder: 10, createdAt: "2026-07-01", isSystem: false }
];

const notes: Note[] = [
  makeNote(1, "提交周报", new Date(2026, 6, 18, 10).toISOString()),
  makeNote(2, "整理收件箱", null),
  makeNote(3, "八月提醒", new Date(2026, 7, 5, 9).toISOString())
];

function makeNote(id: number, title: string, scheduledAt: string | null): Note {
  const scheduled = scheduledAt ? new Date(scheduledAt) : null;
  return {
    id, title, details: null, categoryId: 1, completed: false, pinned: false, priority: "normal",
    createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
    completedAt: null, dueAt: null, sortOrder: id * 10, scheduledAt,
    scheduledDate: scheduled ? `${scheduled.getFullYear()}-${String(scheduled.getMonth() + 1).padStart(2, "0")}-${String(scheduled.getDate()).padStart(2, "0")}` : null,
    scheduledTime: scheduled ? `${String(scheduled.getHours()).padStart(2, "0")}:${String(scheduled.getMinutes()).padStart(2, "0")}` : null,
    repeatSeriesId: null,
    repeatOccurrenceAt: null, reminderEnabled: false, reminderAt: null, reminderOffsetMinutes: 0,
    reminderTriggeredAt: null, boardColumnId: "todo", boardOrder: id * 10, status: "todo",
    previousBoardColumnId: null
  };
}
