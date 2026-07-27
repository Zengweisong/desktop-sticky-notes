// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardColumn } from "../types/board";
import type { Note } from "../types/note";
import { BoardView } from "./BoardView";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("BoardView column menus", () => {
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    container?.remove();
    container = null;
  });

  it("only renders a menu trigger when the column has available actions", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(<BoardView columns={columns} notes={[]} categories={[]} repeatSeries={[]}
      loading={false} selectedColumnId={null} onSelectedColumnChange={vi.fn()} onAdd={async () => true}
      onEdit={async () => true} onToggleCompleted={async () => true} onTogglePinned={async () => true}
      onToggleRepeatActive={async () => true} onDelete={async () => true} onMoveNote={async () => true}
      onCreateColumn={async () => true} onRenameColumn={async () => true} onDeleteColumn={async () => true}
      onMoveColumn={async () => true} />));

    expect(container.querySelector('[aria-label="待处理 更多操作"]')).toBeNull();
    expect(container.querySelector('[aria-label="已完成 更多操作"]')).toBeNull();

    const customMenuTrigger = container.querySelector<HTMLButtonElement>('[aria-label="进行中 更多操作"]');
    expect(customMenuTrigger).not.toBeNull();
    await act(async () => customMenuTrigger!.click());
    expect(container.querySelector(".column-menu")?.textContent).toContain("重命名");
    expect(container.querySelector(".column-menu")?.textContent).toContain("删除栏目");

    await act(async () => root.unmount());
  });

  it("does not show a repeat occurrence date as an item time", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(<BoardView columns={columns} notes={[repeatNote]} categories={[]} repeatSeries={[]}
      loading={false} selectedColumnId={null} onSelectedColumnChange={vi.fn()} onAdd={async () => true}
      onEdit={async () => true} onToggleCompleted={async () => true} onTogglePinned={async () => true}
      onToggleRepeatActive={async () => true} onDelete={async () => true} onMoveNote={async () => true}
      onCreateColumn={async () => true} onRenameColumn={async () => true} onDeleteColumn={async () => true}
      onMoveColumn={async () => true} />));

    expect(container.querySelector('[title="事项时间"]')).toBeNull();
    await act(async () => root.unmount());
  });
});

const columns: BoardColumn[] = [
  { id: "todo", name: "待处理", order: 10, type: "system", status: "todo", createdAt: "2026-07-18", updatedAt: "2026-07-18" },
  { id: "doing", name: "进行中", order: 20, type: "custom", status: "doing", createdAt: "2026-07-18", updatedAt: "2026-07-18" },
  { id: "completed", name: "已完成", order: 30, type: "system", status: "completed", createdAt: "2026-07-18", updatedAt: "2026-07-18" }
];

const repeatNote: Note = {
  id: 1, title: "每日更新信息", details: null, categoryId: null, completed: false, pinned: false,
  priority: "normal", createdAt: "2026-07-23T00:00:00.000Z", updatedAt: "2026-07-23T00:00:00.000Z",
  completedAt: null, dueAt: null, sortOrder: 10, scheduledAt: "2026-07-23T00:00:00.000Z",
  scheduledDate: "2026-07-23", scheduledTime: null,
  repeatSeriesId: 4, repeatOccurrenceAt: "2026-07-23T00:00:00.000Z", reminderEnabled: false,
  reminderAt: null, reminderOffsetMinutes: 0, reminderTriggeredAt: null, boardColumnId: "todo",
  boardOrder: 10, status: "todo", previousBoardColumnId: null
};
