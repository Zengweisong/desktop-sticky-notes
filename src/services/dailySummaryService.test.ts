import { expect, it } from "vitest";
import { completedTitlesForDate } from "./dailySummaryService";

it("selects only completed titles within the requested local day, in completion order", () => {
  const completedNote = (title: string, completedAt: string | null) => ({ title, completedAt, completed: true });
  const midnight = new Date(2026, 10, 7);
  const first = midnight.toISOString();
  const last = new Date(2026, 10, 7, 23, 59, 59, 999).toISOString();
  expect(completedTitlesForDate([
    completedNote(" 晚间事项 ", last),
    completedNote("昨天完成", new Date(midnight.getTime() - 1).toISOString()),
    completedNote("次日完成", new Date(2026, 10, 8).toISOString()),
    completedNote("旧记录缺少完成时间", null),
    completedNote("无效完成时间", "invalid"),
    { title: "已重新打开", completed: false, completedAt: first },
    completedNote("凌晨事项", first)
  ], "2026-11-07")).toEqual(["凌晨事项", "晚间事项"]);
});
