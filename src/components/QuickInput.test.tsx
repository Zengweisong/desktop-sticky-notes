// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickInput } from "./QuickInput";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("QuickInput", () => {
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    container?.remove();
    container = null;
  });

  it.each([false, true])("uses the selected category without a separate picker (minimal: %s)", async (minimal) => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onAdd = vi.fn().mockResolvedValue(true);

    await act(async () => root.render(<QuickInput categoryId={2} minimal={minimal} defaultToToday onAdd={onAdd} />));

    expect(container.querySelector('[aria-label="选择所属类别"]')).toBeNull();
    await act(async () => container!.querySelector<HTMLButtonElement>('[aria-label="时间与重复设置"]')!.click());
    const primaryRow = container.querySelector(".schedule-primary-row");
    expect(primaryRow?.querySelector('[role="combobox"][aria-label="优先级"]')).not.toBeNull();
    expect(primaryRow?.querySelector('[role="switch"][aria-label="提醒"]')).not.toBeNull();
    expect(container.querySelector('[role="combobox"][aria-label="所属分类"]')).toBeNull();
    expect(container.textContent).not.toContain("分类与优先级");

    const input = container.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "使用所选分类");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container!.querySelector<HTMLButtonElement>('[aria-label="添加事项"]')!.click());
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ title: "使用所选分类", categoryId: 2 }));
    await act(async () => root.unmount());
  });

  it("does not add an item while Enter is confirming IME input", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onAdd = vi.fn().mockResolvedValue(true);

    await act(async () => root.render(<QuickInput categoryId={1} defaultToToday onAdd={onAdd} />));
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

    await act(async () => root.render(<QuickInput categoryId={2} defaultToToday onAdd={onAdd} />));
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

  it("adds an undated item when the default-today setting is disabled", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onAdd = vi.fn().mockResolvedValue(true);

    await act(async () => root.render(<QuickInput categoryId={null} defaultToToday={false} onAdd={onAdd} />));
    const input = container.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "稍后整理");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });

    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      title: "稍后整理", categoryId: null, scheduledDate: null, scheduledTime: null, scheduledAt: null
    }));
    await act(async () => root.unmount());
  });

  it("uses the selected calendar date for consecutive additions even when default-today is off", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onAdd = vi.fn().mockResolvedValue(true);
    const render = (defaultDate: string | null) => act(async () => root.render(
      <QuickInput categoryId={2} defaultToToday={false} defaultDate={defaultDate} onAdd={onAdd} />
    ));
    const submit = async () => act(async () => {
      const input = container!.querySelector<HTMLTextAreaElement>("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "日历事项");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });

    await render("2026-12-23");
    await submit();
    await submit();
    expect(onAdd.mock.calls.slice(0, 2).map(([note]) => note.scheduledDate)).toEqual(["2026-12-23", "2026-12-23"]);
    await render("2027-01-04");
    await submit();
    expect(onAdd).toHaveBeenLastCalledWith(expect.objectContaining({ scheduledDate: "2027-01-04", scheduledTime: null }));
    await render(null);
    await submit();
    expect(onAdd).toHaveBeenLastCalledWith(expect.objectContaining({ scheduledDate: null }));
    await act(async () => root.unmount());
  });

  it("keeps an explicitly edited date when the selected calendar date changes", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onAdd = vi.fn().mockResolvedValue(true);
    const render = (defaultDate: string) => act(async () => root.render(
      <QuickInput categoryId={null} defaultToToday defaultDate={defaultDate} onAdd={onAdd} />
    ));
    await render("2026-12-23");
    await act(async () => container!.querySelector<HTMLButtonElement>('[aria-label="时间与重复设置"]')!.click());
    await act(async () => container!.querySelector<HTMLButtonElement>('[aria-label="选择日期"]')!.click());
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="2026年12月25日星期五"]')!.click());
    await render("2027-01-04");
    await act(async () => {
      const input = container!.querySelector<HTMLTextAreaElement>("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "手动安排");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ scheduledDate: "2026-12-25" }));
    await act(async () => root.unmount());
  });

  it("collapses on outside presses while retaining the draft and allowing portaled choices", async () => {
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<>
      <header>标题栏</header>
      <QuickInput categoryId={null} defaultToToday onAdd={vi.fn()} />
      <footer>内容区</footer>
    </>));
    const press = async (element: Element) => act(async () => {
      element.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    const open = async () => act(async () => container!.querySelector<HTMLButtonElement>('[aria-label="时间与重复设置"]')!.click());
    await open();
    await press(container.querySelector(".quick-advanced-panel")!);
    expect(container.querySelector(".quick-advanced-panel")).not.toBeNull();
    await act(async () => container!.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="优先级"]')!.click());
    const urgent = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent === "紧急")!;
    await press(urgent);
    await act(async () => urgent.click());
    expect(container.querySelector(".quick-advanced-panel")).not.toBeNull();
    await press(container.querySelector("header")!);
    expect(container.querySelector(".quick-advanced-panel")).toBeNull();
    await open();
    expect(container.querySelector('[role="combobox"][aria-label="优先级"]')?.textContent).toBe("紧急");
    await press(container.querySelector("footer")!);
    expect(container.querySelector(".quick-advanced-panel")).toBeNull();
    await act(async () => root.unmount());
  });
});
