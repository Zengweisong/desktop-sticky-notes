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

  const select = (label: string) => container!.querySelector<HTMLButtonElement>(`[role="combobox"][aria-label="${label}"]`)!;
  const choose = async (label: string, text: string) => {
    await act(async () => select(label).click());
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent === text)!;
    await act(async () => option.click());
  };

  it("does not enable reminders before an item time exists", async () => {
    const root = await render();
    const reminder = container!.querySelector<HTMLButtonElement>('[role="switch"]')!;
    await act(async () => reminder.click());
    expect(reminder.getAttribute("aria-checked")).toBe("false");
    expect(container!.textContent).toContain("请先设置具体时间");
    await act(async () => root.unmount());
  });

  it("enables a default ten-minute reminder independently from repeat", async () => {
    const root = await render({ scheduledAt: futurePlan() });
    const reminder = container!.querySelector<HTMLButtonElement>('[role="switch"]')!;
    await act(async () => reminder.click());
    expect(reminder.getAttribute("aria-checked")).toBe("true");
    expect(select("提醒方式").textContent).toBe("提前 10 分钟");
    expect(select("重复方式").textContent).toBe("不重复");
    await act(async () => root.unmount());
  });

  it("enables repeat without an item date or time and defaults its own reminder", async () => {
    const root = await render();
    await choose("重复方式", "每天");
    expect(select("重复方式").textContent).toBe("每天");
    expect(container!.querySelector<HTMLButtonElement>('[role="switch"]')!.getAttribute("aria-checked")).toBe("true");
    expect(container!.querySelector('[aria-labelledby="plan-time-label"]')).toBeNull();
    expect(container!.querySelector('.reminder-options')).toBeNull();
    expect(container!.querySelector('[aria-label="重复提醒时间"]')!.textContent).toBe("09:00");
    await act(async () => root.unmount());
  });

  it("previews keyboard choices and applies only a confirmed option", async () => {
    const root = await render();
    const repeat = select("重复方式");
    const press = async (key: string) => act(async () => {
      repeat.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
    repeat.focus();
    await press("ArrowDown");
    await press("ArrowDown");
    expect(document.getElementById(repeat.getAttribute("aria-activedescendant")!)?.textContent).toBe("每天");
    expect(repeat.textContent).toBe("不重复");
    await press("Escape");
    expect(repeat.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(repeat);
    await press("ArrowDown");
    await press("ArrowDown");
    await press("Enter");
    expect(repeat.textContent).toBe("每天");
    expect(select("结束条件").textContent).toBe("永不结束");
    await act(async () => root.unmount());
  });

  it("keeps repeat reminder time after its independent switch is turned off", async () => {
    const root = await render({ repeatEnabled: true, repeatReminderEnabled: true, repeatReminderTime: "08:30" }, true);
    expect(container!.querySelector('[aria-labelledby="plan-time-label"]')).toBeNull();
    expect(container!.querySelector('[aria-label="重复提醒时间"]')!.textContent).toBe("08:30");
    const reminder = container!.querySelector<HTMLButtonElement>('[role="switch"]')!;
    await act(async () => reminder.click());
    expect(reminder.getAttribute("aria-checked")).toBe("false");
    expect(container!.querySelector('[aria-label="重复提醒时间"]')).toBeNull();

    await act(async () => reminder.click());
    expect(container!.querySelector('[aria-label="重复提醒时间"]')!.textContent).toBe("08:30");
    await act(async () => root.unmount());
  });

  it("does not overwrite the ordinary reminder when repeat is toggled on and off", async () => {
    const root = await render({ scheduledAt: futurePlan(), reminderEnabled: true, reminderOffsetMinutes: 10 }, true);
    await choose("重复方式", "每天");
    expect(container!.querySelector('[aria-label="重复提醒时间"]')!.textContent).toBe("09:00");

    await choose("重复方式", "不重复");
    expect(container!.querySelector<HTMLButtonElement>('[role="switch"]')!.getAttribute("aria-checked")).toBe("true");
    expect(select("提醒方式").textContent).toBe("提前 10 分钟");
    await act(async () => root.unmount());
  });

  it("renders exactly one editable date and time even when reminder is enabled", async () => {
    const root = await render({ scheduledAt: futurePlan(), reminderEnabled: true });
    expect(container!.querySelectorAll('.calendar-date-field')).toHaveLength(1);
    expect(container!.querySelectorAll('.calendar-time-field')).toHaveLength(1);
    expect(container!.querySelector('input[type="datetime-local"]')).toBeNull();
    expect(container!.querySelector('.reminder-block input[type="date"], .reminder-block input[type="time"]')).toBeNull();
    expect(container!.textContent).toContain("将在");
    await act(async () => root.unmount());
  });

  it("clears an ordinary item time without restoring midnight", async () => {
    const root = await render({ scheduledAt: futurePlan(), reminderEnabled: true }, true);
    const time = container!.querySelector<HTMLButtonElement>('[aria-label="选择时间"]')!;
    await act(async () => time.click());
    await act(async () => document.querySelector<HTMLButtonElement>('.calendar-time-popover .calendar-picker-footer button')!.click());

    expect(time.textContent).toBe("添加时间");
    expect(container!.querySelector('[aria-label="选择日期"]')!.textContent).not.toBe("选择日期");
    expect(container!.querySelector<HTMLButtonElement>('[role="switch"]')!.getAttribute("aria-checked")).toBe("false");
    expect(container!.querySelector(".reminder-details-block")).toBeNull();
    await act(async () => root.unmount());
  });

  it("opens themed date and time popovers from the whole field", async () => {
    const root = await render();
    await act(async () => container!.querySelector<HTMLButtonElement>('[aria-label="选择日期"]')!.click());
    expect(document.querySelectorAll(".calendar-date-popover .date-popover-days button")).toHaveLength(42);
    await act(async () => document.querySelector<HTMLButtonElement>(".date-popover-today")!.click());
    await act(async () => container!.querySelector<HTMLButtonElement>('[aria-label="选择时间"]')!.click());
    expect(document.querySelectorAll(".time-popover-options button")).toHaveLength(84);
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="14 小时"]')!.click();
      document.querySelector<HTMLButtonElement>('[aria-label="35 分钟"]')!.click();
    });
    await act(async () => document.querySelector<HTMLButtonElement>(".time-popover-confirm")!.click());
    expect(container!.querySelector('[aria-label="选择时间"]')!.textContent).toBe("14:35");
    await act(async () => root.unmount());
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
