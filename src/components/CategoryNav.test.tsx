// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Category } from "../types/category";
import type { NoteStatusFilter } from "../types/filter";
import { CategoryNav } from "./CategoryNav";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("CategoryNav", () => {
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    container?.remove();
    container = null;
  });

  it("keeps status and category as independent filters", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    function Harness() {
      const [status, setStatus] = useState<NoteStatusFilter>("active");
      const [categoryId, setCategoryId] = useState<number | null>(null);
      return <CategoryNav categories={categories} notes={[]} activeStatus={status} categoryId={categoryId}
        onStatusChange={setStatus} onCategoryChange={setCategoryId} onManage={vi.fn()} />;
    }

    await act(async () => root.render(<Harness />));
    expect(button("全部")).toBeNull();
    expect(container.querySelectorAll(".filter-tab")).toHaveLength(3);

    await act(async () => button("筛选")!.click());
    expect(container.querySelector(".category-filter-popover")).not.toBeNull();
    await act(async () => button("工作")!.click());
    expect(container.querySelector(".category-filter-popover")).toBeNull();
    expect(container.textContent).toContain("当前分类：工作");

    await act(async () => button("今日")!.click());
    expect(button("今日")?.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("当前分类：工作");

    await act(async () => container!.querySelector<HTMLButtonElement>('[aria-label="清除分类筛选"]')!.click());
    expect(container.textContent).not.toContain("当前分类：工作");
    await act(async () => root.unmount());
  });

  it("closes the category popover with Escape or an outside pointer press", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<CategoryNav categories={categories} notes={[]} activeStatus="active" categoryId={null}
      onStatusChange={vi.fn()} onCategoryChange={vi.fn()} onManage={vi.fn()} />));

    await act(async () => button("筛选")!.click());
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector(".category-filter-popover")).toBeNull();

    await act(async () => button("筛选")!.click());
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
