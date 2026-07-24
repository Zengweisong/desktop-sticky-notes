// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteInput } from "../types/note";
import { TaskScheduleFields } from "./TaskScheduleFields";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("TaskScheduleFields product rules", () => {
  let container: HTMLDivElement | null = null;

  afterEach(() => { container?.remove(); container = null; });

  it("does not enable reminders before an item time exists", async () => {
    const root = await render();
    const reminder = container!.querySelector<HTMLButtonElement>('[role="switch"]')!;
    await act(async () => reminder.click());
    expect(reminder.getAttribute("aria-checked")).toBe("false");
    expect(container!.textContent).toContain("请先设置事项时间");
    await act(async () => root.unmount());
  });

  it("enables a default ten-minute reminder independently from repeat", async () => {
    const root = await render({ scheduledAt: futurePlan() });
    const reminder = container!.querySelector<HTMLButtonElement>('[role="switch"]')!;
    await act(async () => reminder.click());
    expect(reminder.getAttribute("aria-checked")).toBe("true");
    expect(container!.querySelector<HTMLSelectElement>('select[aria-label="提醒方式"]')!.value).toBe("10");
    expect(container!.querySelector<HTMLSelectElement>('.schedule-control-row select')!.value).toBe("none");
    await act(async () => root.unmount());
  });

  it("enables repeat without an item date or time and defaults its own reminder", async () => {
    const root = await render();
    const repeat = container!.querySelector<HTMLSelectElement>('.schedule-control-row select')!;
    await act(async () => { repeat.value = "daily"; repeat.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(repeat.value).toBe("daily");
    expect(container!.querySelector<HTMLButtonElement>('[role="switch"]')!.getAttribute("aria-checked")).toBe("true");
    expect(container!.querySelector('[aria-labelledby="plan-time-label"]')).toBeNull();
    expect(container!.querySelector('.reminder-options')).toBeNull();
    expect(container!.querySelector<HTMLInputElement>('input[aria-label="重复提醒时间"]')!.value).toBe("09:00");
    await act(async () => root.unmount());
  });

  it("keeps repeat reminder time after its independent switch is turned off", async () => {
    const root = await render({ repeatEnabled: true, repeatReminderEnabled: true, repeatReminderTime: "08:30" }, true);
    expect(container!.querySelector('[aria-labelledby="plan-time-label"]')).toBeNull();
    expect(container!.querySelector<HTMLInputElement>('input[aria-label="重复提醒时间"]')!.value).toBe("08:30");
    const reminder = container!.querySelector<HTMLButtonElement>('[role="switch"]')!;
    await act(async () => reminder.click());
    expect(reminder.getAttribute("aria-checked")).toBe("false");
    expect(container!.querySelector('input[aria-label="重复提醒时间"]')).toBeNull();

    await act(async () => reminder.click());
    expect(container!.querySelector<HTMLInputElement>('input[aria-label="重复提醒时间"]')!.value).toBe("08:30");
    await act(async () => root.unmount());
  });

  it("does not overwrite the ordinary reminder when repeat is toggled on and off", async () => {
    const root = await render({ scheduledAt: futurePlan(), reminderEnabled: true, reminderOffsetMinutes: 10 }, true);
    const repeat = container!.querySelector<HTMLSelectElement>('.schedule-control-row select')!;
    await act(async () => { repeat.value = "daily"; repeat.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container!.querySelector<HTMLInputElement>('input[aria-label="重复提醒时间"]')!.value).toBe("09:00");

    await act(async () => { repeat.value = "none"; repeat.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container!.querySelector<HTMLButtonElement>('[role="switch"]')!.getAttribute("aria-checked")).toBe("true");
    expect(container!.querySelector<HTMLSelectElement>('select[aria-label="提醒方式"]')!.value).toBe("10");
    await act(async () => root.unmount());
  });

  it("renders exactly one editable date and time even when reminder is enabled", async () => {
    const root = await render({ scheduledAt: futurePlan(), reminderEnabled: true });
    expect(container!.querySelectorAll('input[type="date"]')).toHaveLength(1);
    expect(container!.querySelectorAll('input[type="time"]')).toHaveLength(1);
    expect(container!.querySelector('input[type="datetime-local"]')).toBeNull();
    expect(container!.querySelector('.reminder-block input[type="date"], .reminder-block input[type="time"]')).toBeNull();
    expect(container!.textContent).toContain("将在");
    await act(async () => root.unmount());
  });

  it("clears an ordinary item time without restoring midnight", async () => {
    const root = await render({ scheduledAt: futurePlan(), reminderEnabled: true }, true);
    const time = container!.querySelector<HTMLInputElement>('input[type="time"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(time, "");
      time.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(time.value).toBe("");
    expect(container!.querySelector<HTMLInputElement>('input[type="date"]')!.value).not.toBe("");
    expect(container!.querySelector<HTMLButtonElement>('[role="switch"]')!.getAttribute("aria-checked")).toBe("false");
    expect(container!.querySelector(".reminder-details-block")).toBeNull();
    await act(async () => root.unmount());
  });

  it("opens the native picker from the full custom date and time controls", async () => {
    const showPicker = vi.fn();
    const originalShowPicker = HTMLInputElement.prototype.showPicker;
    Object.defineProperty(HTMLInputElement.prototype, "showPicker", {
      configurable: true,
      value: showPicker
    });

    try {
      const root = await render();
      const date = container!.querySelector<HTMLInputElement>('input[type="date"]')!;
      const time = container!.querySelector<HTMLInputElement>('input[type="time"]')!;

      await act(async () => date.closest<HTMLLabelElement>(".picker-input")!.click());
      expect(showPicker).toHaveBeenCalledTimes(1);
      expect(showPicker.mock.instances[0]).toBe(date);

      await act(async () => time.closest<HTMLLabelElement>(".picker-input")!.click());
      expect(showPicker).toHaveBeenCalledTimes(2);
      expect(showPicker.mock.instances[1]).toBe(time);

      await act(async () => root.unmount());
    } finally {
      if (originalShowPicker) {
        Object.defineProperty(HTMLInputElement.prototype, "showPicker", {
          configurable: true,
          value: originalShowPicker
        });
      } else {
        delete (HTMLInputElement.prototype as Partial<HTMLInputElement>).showPicker;
      }
    }
  });

  it("keeps reminder details collapsed until the compact primary switch is enabled", async () => {
    const root = await render({ scheduledAt: futurePlan() }, true);
    expect(container!.querySelector(".schedule-primary-row")).not.toBeNull();
    expect(container!.querySelector(".reminder-details-block")).toBeNull();
    const reminder = container!.querySelector<HTMLButtonElement>('[role="switch"]')!;
    await act(async () => reminder.click());
    expect(container!.querySelector(".reminder-details-block")).not.toBeNull();
    await act(async () => root.unmount());
  });

  async function render(patch: Partial<NoteInput> = {}, withPriority = false) {
    container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    function Harness() {
      const [value, setValue] = useState<NoteInput>({
        title: "测试", reminderEnabled: false, reminderOffsetMinutes: 10, repeatEnabled: false, ...patch
      });
      return <TaskScheduleFields value={value} onChange={(next) => setValue((current) => ({ ...current, ...next }))}
        priority={withPriority ? "normal" : undefined} onPriorityChange={withPriority ? () => undefined : undefined} />;
    }
    await act(async () => root.render(<Harness />));
    return root;
  }
});

function futurePlan() {
  const date = new Date(Date.now() + 7 * 86_400_000);
  date.setHours(18, 0, 0, 0);
  return date.toISOString();
}
