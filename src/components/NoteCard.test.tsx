// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "../types/note";
import { NoteCard } from "./NoteCard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
Object.defineProperty(Range.prototype, "getBoundingClientRect", {
  configurable: true,
  value: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) })
});

describe("NoteCard editor keyboard behavior", () => {
  let container: HTMLDivElement | null = null;

  beforeEach(async () => {
    await import("./MarkdownEditor");
  });

  afterEach(() => {
    container?.remove();
    container = null;
  });

  it("inserts Enter inside live details without saving, closing, or bubbling", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onEdit = vi.fn().mockResolvedValue(true);
    const outerKeyDown = vi.fn();

    await act(async () => root.render(<div onKeyDown={outerKeyDown}>
      <NoteCard {...props(onEdit)} startEditing />
    </div>));

    const details = container.querySelector<HTMLElement>('.cm-content[aria-label="详细备注"]')!;
    details.focus();
    await act(async () => {
      details.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", code: "Enter", bubbles: true, cancelable: true
      }));
    });

    expect(onEdit).not.toHaveBeenCalled();
    expect(outerKeyDown).not.toHaveBeenCalled();
    expect(container.querySelector(".note-edit-form")).not.toBeNull();
    expect(document.activeElement).toBe(details);
    await act(async () => container!.querySelectorAll<HTMLButtonElement>(".note-edit-actions button")[1].click());
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ details: "\n原备注" }));
    await act(async () => root.unmount());
  });

  it("does not bubble or submit an IME confirmation Enter in live details", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onEdit = vi.fn().mockResolvedValue(true);
    const outerKeyDown = vi.fn();

    await act(async () => root.render(<div onKeyDown={outerKeyDown}>
      <NoteCard {...props(onEdit)} startEditing />
    </div>));
    const details = container.querySelector<HTMLElement>('.cm-content[aria-label="详细备注"]')!;
    const event = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true });
    Object.defineProperty(event, "keyCode", { value: 229 });
    await act(async () => { details.dispatchEvent(event); });

    expect(onEdit).not.toHaveBeenCalled();
    expect(outerKeyDown).not.toHaveBeenCalled();
    expect(container.querySelector(".note-edit-form")).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("does not save when Enter has the legacy IME key code", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onEdit = vi.fn().mockResolvedValue(true);

    await act(async () => root.render(<NoteCard {...props(onEdit)} startEditing />));
    const title = container.querySelector<HTMLTextAreaElement>("textarea")!;
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    Object.defineProperty(event, "keyCode", { value: 229 });
    await act(async () => { title.dispatchEvent(event); });

    expect(onEdit).not.toHaveBeenCalled();
    expect(container.querySelector(".note-edit-form")).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("passes consecutive details line breaks through when saving", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onEdit = vi.fn().mockResolvedValue(true);

    await act(async () => root.render(<NoteCard {...props(onEdit)} startEditing />));
    await act(async () => container!.querySelector<HTMLButtonElement>('button[aria-label="Markdown 源码"]')!.click());
    const details = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="详细备注源码"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(details, "第一行\n\n第二行");
      details.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container!.querySelectorAll<HTMLButtonElement>(".note-edit-actions button")[1].click());

    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ details: "第一行\n\n第二行" }));
    await act(async () => root.unmount());
  });

  it("keeps normal Enter-to-save behavior in the title field", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onEdit = vi.fn().mockResolvedValue(true);

    await act(async () => root.render(<NoteCard {...props(onEdit)} startEditing />));
    const title = container.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      title.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".note-edit-form")).toBeNull();
    await act(async () => root.unmount());
  });

  it("renders saved Markdown and does not execute raw HTML", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const markdownNote = { ...note,
      details: "# 入住清单\n\n**重点确认**\n\n- [x] 已联系\n- [ ] 待登记\n\n<script>alert('x')</script>" };

    await act(async () => root.render(<NoteCard {...props(vi.fn().mockResolvedValue(true))} note={markdownNote} />));

    expect(container.querySelector(".note-details h1")?.textContent).toBe("入住清单");
    expect(container.querySelector(".note-details strong")?.textContent).toBe("重点确认");
    expect(container.querySelector<HTMLInputElement>('.note-details input[type="checkbox"]')?.checked).toBe(true);
    expect(container.querySelector("script")).toBeNull();
    await act(async () => root.unmount());
  });

  it("switches between live, source, and reading modes", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const markdownNote = { ...note, details: "## 二级标题\n\n`房间号 302`" };

    await act(async () => root.render(<NoteCard {...props(vi.fn().mockResolvedValue(true))} note={markdownNote} startEditing />));
    expect(container.querySelector<HTMLElement>('.cm-content[aria-label="详细备注"]')).not.toBeNull();

    const source = container.querySelector<HTMLButtonElement>('button[aria-label="Markdown 源码"]')!;
    await act(async () => source.click());
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="详细备注源码"]')?.value).toBe(markdownNote.details);

    const preview = container.querySelector<HTMLButtonElement>('button[aria-label="阅读预览"]')!;
    await act(async () => preview.click());
    expect(container.querySelector('[aria-label="详细备注预览"] h2')?.textContent).toBe("二级标题");
    expect(container.querySelector('[aria-label="详细备注预览"] code')?.textContent).toBe("房间号 302");
    expect(container.querySelector<HTMLElement>('.cm-content[aria-label="详细备注"]')).toBeNull();
    await act(async () => container!.querySelector<HTMLButtonElement>('button[aria-label="实时预览"]')!.click());
    expect(container.querySelector<HTMLElement>('.cm-content[aria-label="详细备注"]')).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("renders inactive Markdown lines as live preview decorations", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const markdownNote = { ...note, details: "# 标题\n\n**重点**\n- [x] 已完成" };

    await act(async () => root.render(<NoteCard {...props(vi.fn().mockResolvedValue(true))} note={markdownNote} startEditing />));

    expect(container.querySelector(".cm-live-strong")?.textContent).toBe("重点");
    expect(container.querySelector<HTMLInputElement>('.cm-live-checkbox[type="checkbox"]')?.checked).toBe(true);
    await act(async () => root.unmount());
  });

  it("shows a date-only schedule without inventing a time", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const dateOnly = { ...note, scheduledDate: "2026-07-27", scheduledTime: null, scheduledAt: null };

    await act(async () => root.render(<NoteCard {...props(vi.fn().mockResolvedValue(true))} note={dateOnly} />));

    expect(container.querySelector(".due-badge")?.textContent).toBe("7月27日");
    expect(container.textContent).not.toContain("09:00");
    expect(container.textContent).not.toContain("00:00");
    await act(async () => root.unmount());
  });
});

function props(onEdit: ReturnType<typeof vi.fn>) {
  return {
    note,
    categories: [],
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onPointerCancel: vi.fn(),
    onToggleCompleted: vi.fn().mockResolvedValue(true),
    onTogglePinned: vi.fn().mockResolvedValue(true),
    onEdit,
    onRequestDelete: vi.fn()
  };
}

const note: Note = {
  id: 1, title: "四位同学提前入住", details: "原备注", categoryId: null,
  completed: false, pinned: false, priority: "normal",
  createdAt: "2026-07-27T00:00:00.000Z", updatedAt: "2026-07-27T00:00:00.000Z",
  completedAt: null, dueAt: null, sortOrder: 10, scheduledAt: null, scheduledDate: null, scheduledTime: null,
  repeatSeriesId: null, repeatOccurrenceAt: null, reminderEnabled: false,
  reminderAt: null, reminderOffsetMinutes: 10, reminderTriggeredAt: null,
  boardColumnId: "todo", boardOrder: 10, status: "todo", previousBoardColumnId: null
};
