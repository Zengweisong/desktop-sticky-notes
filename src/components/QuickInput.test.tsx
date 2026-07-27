// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Category } from "../types/category";
import { QuickInput } from "./QuickInput";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("QuickInput category menu", () => {
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    container?.remove();
    container = null;
  });

  it("raises the open menu above later content and selects another category", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onCategoryChange = vi.fn();

    await act(async () => root.render(<QuickInput categories={categories} categoryId={1}
      onCategoryChange={onCategoryChange} onAdd={vi.fn().mockResolvedValue(true)} />));

    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="选择所属类别"]')!;
    await act(async () => trigger.click());
    expect(container.querySelector(".quick-input-wrap")?.classList.contains("category-menu-open")).toBe(true);
    expect(container.querySelector(".quick-category-menu")).not.toBeNull();

    const work = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((button) => button.textContent?.includes("工作"));
    expect(work).toBeDefined();
    await act(async () => work!.click());

    expect(onCategoryChange).toHaveBeenCalledWith(2);
    expect(container.querySelector(".quick-category-menu")).toBeNull();
    expect(container.querySelector(".quick-input-wrap")?.classList.contains("category-menu-open")).toBe(false);
    await act(async () => root.unmount());
  });

  it("uses the top category only and groups priority with the reminder switch", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onAdd = vi.fn().mockResolvedValue(true);

    await act(async () => root.render(<QuickInput categories={categories} categoryId={2}
      onCategoryChange={vi.fn()} onAdd={onAdd} />));

    await act(async () => container!.querySelector<HTMLButtonElement>('[aria-label="时间与重复设置"]')!.click());
    const primaryRow = container.querySelector(".schedule-primary-row");
    expect(primaryRow?.querySelector('select[aria-label="优先级"]')).not.toBeNull();
    expect(primaryRow?.querySelector('[role="switch"][aria-label="提醒"]')).not.toBeNull();
    expect(container.querySelector('select[aria-label="所属分类"]')).toBeNull();
    expect(container.textContent).not.toContain("分类与优先级");

    const input = container.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "只使用顶部分类");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container!.querySelector<HTMLButtonElement>('[aria-label="添加事项"]')!.click());
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ title: "只使用顶部分类", categoryId: 2 }));
    await act(async () => root.unmount());
  });

  it("does not add an item while Enter is confirming IME input", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onAdd = vi.fn().mockResolvedValue(true);

    await act(async () => root.render(<QuickInput categories={categories} categoryId={1}
      onCategoryChange={vi.fn()} onAdd={onAdd} />));
    const input = container.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "中文输入");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const composingEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    Object.defineProperty(composingEvent, "isComposing", { value: true });
    await act(async () => { input.dispatchEvent(composingEvent); });

    const legacyEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    Object.defineProperty(legacyEvent, "keyCode", { value: 229 });
    await act(async () => { input.dispatchEvent(legacyEvent); });

    expect(onAdd).not.toHaveBeenCalled();
    expect(input.value).toBe("中文输入");
    await act(async () => root.unmount());
  });

  it("still adds an item with a normal Enter key", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onAdd = vi.fn().mockResolvedValue(true);

    await act(async () => root.render(<QuickInput categories={categories} categoryId={2}
      onCategoryChange={vi.fn()} onAdd={onAdd} />));
    const input = container.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "正常新增");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });

    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      title: "正常新增", categoryId: 2, scheduledDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      scheduledTime: null, scheduledAt: null
    }));
    await act(async () => root.unmount());
  });
});

const categories: Category[] = [
  { id: 1, name: "未分类", color: "#9aa6b2", icon: null, sortOrder: 10, createdAt: "2026-07-17", isSystem: true },
  { id: 2, name: "工作", color: "#5794d8", icon: null, sortOrder: 20, createdAt: "2026-07-17", isSystem: false }
];
