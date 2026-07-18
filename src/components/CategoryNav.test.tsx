// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Category } from "../types/category";
import type { NoteTimeFilter } from "../types/filter";
import { CategoryNav } from "./CategoryNav";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("CategoryNav", () => {
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    container?.remove();
    container = null;
  });

  it("moves today into the filter panel and removes status navigation", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    function Harness() {
      const [timeFilter, setTimeFilter] = useState<NoteTimeFilter>("all");
      const [categoryId, setCategoryId] = useState<number | null>(null);
      return <CategoryNav categories={categories} timeFilter={timeFilter} categoryId={categoryId}
        onTimeFilterChange={setTimeFilter} onCategoryChange={setCategoryId} onManage={vi.fn()} />;
    }

    await act(async () => root.render(<Harness />));
    expect(container.textContent).not.toContain("未完成");
    expect(container.querySelectorAll(".filter-tab")).toHaveLength(0);

    await act(async () => container!.querySelector<HTMLButtonElement>('[aria-label="筛选事项"]')!.click());
    expect(container.querySelector(".category-filter-popover")).not.toBeNull();
    await act(async () => button("今天")!.click());
    expect(button("今天")?.getAttribute("aria-checked")).toBe("true");
    await act(async () => button("工作")!.click());
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(container.querySelector(".active-filter-summary")?.textContent).toContain("今天 · 工作");

    await act(async () => container!.querySelector<HTMLButtonElement>('[aria-label="清除筛选"]')!.click());
    expect(container.querySelector(".active-filter-summary")).toBeNull();
    await act(async () => root.unmount());
  });

  it("closes the category popover with Escape or an outside pointer press", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<CategoryNav categories={categories} timeFilter="all" categoryId={null}
      onTimeFilterChange={vi.fn()} onCategoryChange={vi.fn()} onManage={vi.fn()} />));

    const trigger = () => container!.querySelector<HTMLButtonElement>('[aria-label="筛选事项"]')!;
    await act(async () => trigger().click());
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector(".category-filter-popover")).toBeNull();

    await act(async () => trigger().click());
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(container.querySelector(".category-filter-popover")).toBeNull();
    await act(async () => root.unmount());
  });

  function button(text: string) {
    return [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((item) => item.textContent?.trim().startsWith(text)) ?? null;
  }
});

const categories: Category[] = [
  { id: 1, name: "未分类", color: "#9aa6b2", icon: null, sortOrder: 10, createdAt: "2026-07-17", isSystem: true },
  { id: 2, name: "工作", color: "#5794d8", icon: null, sortOrder: 20, createdAt: "2026-07-17", isSystem: false }
];
