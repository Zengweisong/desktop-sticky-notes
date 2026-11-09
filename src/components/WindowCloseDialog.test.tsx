// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomTitleBar } from "./CustomTitleBar";
import { WindowCloseDialog } from "./WindowCloseDialog";
import { useWindowClose } from "../hooks/useWindowClose";

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("window close choice", () => {
  let root: Root;
  let container: HTMLDivElement;
  let api: ReturnType<typeof useWindowClose>;
  let requestFromOs: () => void;
  let options: Parameters<typeof useWindowClose>[0];
  const stop = vi.fn();
  const onToggleTop = vi.fn();
  const onOpenSettings = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    native.invoke.mockResolvedValue(undefined);
    native.listen.mockImplementation(async (_event: string, callback: () => void) => {
      requestFromOs = callback;
      return stop;
    });
    options = { hideWindow: vi.fn(async () => {}), beforeClose: vi.fn(async () => {}), onError: vi.fn() };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    function Harness() {
      api = useWindowClose(options);
      return <><CustomTitleBar alwaysOnTop onToggleTop={onToggleTop} onOpenSettings={onOpenSettings}
        onOpenDailySummary={() => {}} onRequestClose={api.requestClose} />
        <WindowCloseDialog open={api.open} busy={api.busy} onCancel={api.cancel} onChoose={api.choose} /></>;
    }
    await act(async () => root.render(<Harness />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    expect(stop).toHaveBeenCalledOnce();
    container.remove();
  });

  const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((item) => item.textContent === label || item.getAttribute("aria-label") === label)!;
  const open = async () => act(async () => button("关闭窗口").click());

  it("keeps settings and pin controls and asks before hiding or quitting", async () => {
    expect(container.querySelector(".app-title")).toBeNull();
    expect(container.querySelector("header")?.textContent).not.toContain("桌面便签");
    expect(container.querySelector("header")?.hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(container.querySelectorAll(".window-actions button")).toHaveLength(4);
    expect(button("取消始终置顶").getAttribute("aria-pressed")).toBe("true");
    await act(async () => { button("取消始终置顶").click(); button("打开设置").click(); });
    expect(onToggleTop).toHaveBeenCalledOnce();
    expect(onOpenSettings).toHaveBeenCalledOnce();
    await open();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(button("最小化到托盘"));
    expect(options.hideWindow).not.toHaveBeenCalled();
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("uses the same dialog for an OS close request", async () => {
    expect(native.listen).toHaveBeenCalledWith("window-close-requested", expect.any(Function));
    await act(async () => requestFromOs());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(options.hideWindow).not.toHaveBeenCalled();
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("cancels with Escape and returns focus to the close button", async () => {
    button("关闭窗口").focus();
    await open();
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(button("关闭窗口"));
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("saves window state before minimizing and hides the native background without quitting", async () => {
    const order: string[] = [];
    options.beforeClose = vi.fn(async () => { order.push("save"); });
    options.hideWindow = vi.fn(async () => { order.push("hide"); });
    native.invoke.mockImplementation(async (command: string) => { order.push(command); });
    await open();
    await act(async () => button("最小化到托盘").click());
    expect(order).toEqual(["save", "hide", "set_background_visible"]);
    expect(native.invoke).toHaveBeenCalledWith("set_background_visible", { visible: false });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("saves window state and explicitly exits when the user chooses close", async () => {
    const order: string[] = [];
    options.beforeClose = vi.fn(async () => { order.push("save"); });
    native.invoke.mockImplementation(async (command: string) => { order.push(command); });
    await open();
    await act(async () => button("关闭应用").click());
    expect(order).toEqual(["save", "quit_app"]);
    expect(options.hideWindow).not.toHaveBeenCalled();
  });

  it("prevents a second action and cancellation while an operation is pending", async () => {
    let saved!: () => void;
    options.beforeClose = vi.fn(() => new Promise<void>((resolve) => { saved = resolve; }));
    await open();
    let pending!: Promise<void>;
    await act(async () => { pending = api.choose("minimize"); await api.choose("quit"); api.cancel(); });
    expect(button("关闭应用").disabled).toBe(true);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(options.beforeClose).toHaveBeenCalledOnce();
    await act(async () => { saved(); await pending; });
    expect(native.invoke).toHaveBeenCalledOnce();
    expect(native.invoke).toHaveBeenCalledWith("set_background_visible", { visible: false });
  });

  it("keeps the dialog open and allows retrying if saving fails", async () => {
    options.beforeClose = vi.fn().mockRejectedValueOnce(new Error("disk unavailable")).mockResolvedValue(undefined);
    await open();
    await act(async () => button("关闭应用").click());
    expect(options.onError).toHaveBeenCalledWith("关闭应用失败，请重试");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(native.invoke).not.toHaveBeenCalled();
    expect(button("关闭应用").disabled).toBe(false);
    await act(async () => button("关闭应用").click());
    expect(native.invoke).toHaveBeenCalledWith("quit_app");
  });
});
