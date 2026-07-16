// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { NoteInput } from "../types/note";
import { TaskScheduleFields } from "./TaskScheduleFields";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("TaskScheduleFields independence", () => {
  let container: HTMLDivElement | null = null;

  afterEach(() => { container?.remove(); container = null; });

  it("enables reminders without enabling repeat", async () => {
    const root = await render();
    const toggles = container!.querySelectorAll<HTMLInputElement>('.inline-toggle input[type="checkbox"]');
    await act(async () => toggles[0].click());
    expect(toggles[0].checked).toBe(true);
    expect(toggles[1].checked).toBe(false);
    expect(container!.textContent).toContain("提前提醒时间");
    await act(async () => root.unmount());
  });

  it("enables repeat without enabling reminders", async () => {
    const root = await render();
    const toggles = container!.querySelectorAll<HTMLInputElement>('.inline-toggle input[type="checkbox"]');
    await act(async () => toggles[1].click());
    expect(toggles[0].checked).toBe(false);
    expect(toggles[1].checked).toBe(true);
    expect(container!.textContent).toContain("重复规则");
    await act(async () => root.unmount());
  });

  async function render() {
    container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    function Harness() {
      const [value, setValue] = useState<NoteInput>({ title: "测试", reminderEnabled: false, repeatEnabled: false });
      return <TaskScheduleFields value={value} onChange={(patch) => setValue((current) => ({ ...current, ...patch }))} />;
    }
    await act(async () => root.render(<Harness />));
    return root;
  }
});
