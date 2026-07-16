// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Note } from "../types/note";
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
      handles[0].dispatchEvent(pointerEvent("pointermove", 1));
      handles[0].dispatchEvent(pointerEvent("pointerup", 1));
    });

    expect(onMove).toHaveBeenCalledWith(1, 2, "after");
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

function makeNote(id: number, title: string): Note {
  return {
    id, title, details: null, categoryId: null, completed: false, pinned: false,
    priority: "normal", createdAt: `2026-07-15T00:00:0${id}.000Z`,
    updatedAt: `2026-07-15T00:00:0${id}.000Z`, completedAt: null, dueAt: null, sortOrder: 0,
    scheduledAt: null, repeatSeriesId: null, repeatOccurrenceAt: null,
    reminderEnabled: false, reminderAt: null, reminderOffsetMinutes: 0, reminderTriggeredAt: null
  };
}
