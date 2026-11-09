// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localDateKey } from "../services/noteDateService";
import { useSelectionQuickAdd } from "./useSelectionQuickAdd";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("selection quick add", () => {
  let container: HTMLDivElement;
  let root: Root;
  let quickAdd!: () => Promise<void>;
  let options: Parameters<typeof useSelectionQuickAdd>[0];

  function Harness() {
    quickAdd = useSelectionQuickAdd(options);
    return null;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    container = document.createElement("div");
    root = createRoot(container);
    options = {
      categoryId: 3, boardColumnId: "doing", defaultToToday: true,
      onAdd: vi.fn(async () => true), onFocus: vi.fn(async () => {}),
      onSuccess: vi.fn(), onError: vi.fn()
    };
    native.invoke.mockResolvedValue(null);
    await act(async () => root.render(<Harness />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("captures before moving focus and adds the entire selection with quick-add defaults", async () => {
    const order: string[] = [];
    native.invoke.mockImplementation(async () => { order.push("capture"); return { text: "  第一行\n第二行😀  ", source: "selection" }; });
    options.onAdd = vi.fn(async () => { order.push("add"); return true; });
    options.onFocus = vi.fn(async () => { order.push("focus"); });
    await act(async () => quickAdd());

    expect(native.invoke).toHaveBeenCalledWith("capture_quick_add_text");
    expect(order).toEqual(["capture", "add", "focus"]);
    expect(options.onAdd).toHaveBeenCalledWith({
      title: "第一行\n第二行😀", categoryId: 3, boardColumnId: "doing",
      scheduledDate: localDateKey(new Date()), scheduledTime: null,
      reminderEnabled: false, repeatEnabled: false
    });
    expect(options.onSuccess).toHaveBeenCalledOnce();
  });

  it.each([null, "", " \r\n "])("only opens the input when the selected text is %j", async (text) => {
    native.invoke.mockResolvedValue(text === null ? null : { text, source: "selection" });
    await act(async () => quickAdd());

    expect(options.onFocus).toHaveBeenCalledOnce();
    expect(options.onAdd).not.toHaveBeenCalled();
    expect(options.onSuccess).not.toHaveBeenCalled();
    expect(options.onError).not.toHaveBeenCalled();
  });

  it("uses changed defaults without changing the registered callback", async () => {
    const registered = quickAdd;
    options = { ...options, categoryId: 8, boardColumnId: "todo", defaultToToday: false };
    await act(async () => root.render(<Harness />));
    expect(quickAdd).toBe(registered);
    native.invoke.mockResolvedValue({ text: "新的事项", source: "selection" });
    await act(async () => registered());

    expect(options.onAdd).toHaveBeenCalledWith(expect.objectContaining({
      title: "新的事项", categoryId: 8, boardColumnId: "todo", scheduledDate: null
    }));
  });

  it("ignores repeated shortcut presses until capture and saving finish", async () => {
    let finishCapture!: (value: { text: string; source: string }) => void;
    let finishSave!: (value: boolean) => void;
    native.invoke.mockReturnValue(new Promise<{ text: string; source: string }>((resolve) => { finishCapture = resolve; }));
    options.onAdd = vi.fn(() => new Promise<boolean>((resolve) => { finishSave = resolve; }));
    let pending!: Promise<void>;
    await act(async () => {
      pending = quickAdd();
      await quickAdd();
    });
    expect(native.invoke).toHaveBeenCalledOnce();
    expect(options.onFocus).not.toHaveBeenCalled();
    await act(async () => { finishCapture({ text: "只添加一次", source: "clipboard" }); await Promise.resolve(); });
    await act(async () => quickAdd());
    expect(options.onAdd).toHaveBeenCalledOnce();
    await act(async () => { finishSave(true); await pending; });
    expect(options.onSuccess).toHaveBeenCalledOnce();
  });

  it("opens manual input on a capture error and allows the next shortcut press", async () => {
    native.invoke.mockRejectedValueOnce(new Error("UI Automation unavailable"));
    await act(async () => quickAdd());
    expect(options.onAdd).not.toHaveBeenCalled();
    expect(options.onFocus).toHaveBeenCalledOnce();
    expect(options.onError).toHaveBeenCalledWith("无法读取选区或剪贴板文字，请在输入框中手动添加");

    native.invoke.mockResolvedValue({ text: "重试成功", source: "selection" });
    await act(async () => quickAdd());
    expect(options.onAdd).toHaveBeenCalledOnce();
    expect(options.onSuccess).toHaveBeenCalledOnce();
  });

  it("never reports success when saving fails", async () => {
    native.invoke.mockResolvedValue({ text: "尚未保存", source: "selection" });
    options.onAdd = vi.fn(async () => false);
    await act(async () => quickAdd());
    expect(options.onFocus).toHaveBeenCalledOnce();
    expect(options.onSuccess).not.toHaveBeenCalled();
    expect(options.onError).toHaveBeenCalledWith("快捷添加未成功，请重试");
  });

  it("adds recent clipboard text with the current defaults and identifies its source", async () => {
    native.invoke.mockResolvedValue({ text: "复制的任务😀", source: "clipboard" });
    await act(async () => quickAdd());
    expect(options.onAdd).toHaveBeenCalledWith(expect.objectContaining({ title: "复制的任务😀", categoryId: 3, boardColumnId: "doing" }));
    expect(options.onSuccess).toHaveBeenCalledWith("clipboard");
  });

  it("does not capture or add while shortcut settings are being edited", async () => {
    options = { ...options, disabled: true };
    await act(async () => root.render(<Harness />));
    await act(async () => quickAdd());
    expect(native.invoke).not.toHaveBeenCalled();
    expect(options.onAdd).not.toHaveBeenCalled();
    expect(options.onFocus).not.toHaveBeenCalled();
  });
});
