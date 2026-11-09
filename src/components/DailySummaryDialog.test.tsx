// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Note } from "../types/note";
import { localDateKey } from "../services/noteDateService";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { DailySummaryDialog } from "./DailySummaryDialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
  configurable: true, value(this: HTMLDialogElement) { this.open = true; }
});
Object.defineProperty(HTMLDialogElement.prototype, "close", {
  configurable: true, value(this: HTMLDialogElement) { this.open = false; }
});

describe("DailySummaryDialog prompt", () => {
  let container: HTMLDivElement;
  let root: Root;
  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container?.remove();
    vi.clearAllMocks();
  });

  async function render(configured = true, completed = true) {
    invoke.mockImplementation(async (command: string) => {
      if (command === "get_daily_summary_config") return configured ? { endpoint: "https://example.com/v1", model: "test" } : null;
      if (command === "generate_daily_summary") return "今日完成了项目整理。";
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const notes = [{ title: "完成项目整理", completed, completedAt: new Date().toISOString() }] as Note[];
    await act(async () => root.render(<DailySummaryDialog open notes={notes} onClose={() => {}} />));
    return container.querySelector<HTMLTextAreaElement>(".summary-prompt textarea")!;
  }

  it("shows only send and configuration actions, and sends the prompt with today's completed titles", async () => {
    const input = await render();
    expect(input.value).toBe("帮我总结一下今日完成的代办事项");
    expect(document.activeElement).toBe(input);
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(container.querySelector(".summary-source")).toBeNull();
    expect([...container.querySelectorAll(".summary-actions button")].map((button) => button.textContent))
      .toEqual(["发送", "编辑 AI 配置"]);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "  按项目分类，突出完成成果  ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>(".summary-primary")!.click());
    expect(invoke).toHaveBeenCalledWith("generate_daily_summary", {
      date: localDateKey(new Date()), titles: ["完成项目整理"], prompt: "按项目分类，突出完成成果"
    });
    expect(container.querySelector(".summary-result")?.textContent).toContain("今日完成了项目整理。");

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "   ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector<HTMLButtonElement>(".summary-primary")!.disabled).toBe(true);
  });

  it("shows the prompt before API configuration has been saved", async () => {
    const input = await render(false);
    expect(input.value).toBe("帮我总结一下今日完成的代办事项");
    expect(container.querySelector(".summary-config")).not.toBeNull();
  });

  it("explains when no completed tasks are available instead of leaving send silently disabled", async () => {
    await render(true, false);
    await act(async () => container.querySelector<HTMLButtonElement>(".summary-primary")!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("今天还没有已完成的待办事项");
    expect(invoke).not.toHaveBeenCalledWith("generate_daily_summary", expect.anything());
  });
});
