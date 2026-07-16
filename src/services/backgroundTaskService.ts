import { generateDueOccurrences } from "./repeatTaskService";
import { ReminderService } from "./reminderService";

const CHECK_INTERVAL_MS = 20_000;

export function startBackgroundTaskService(
  onOccurrencesGenerated: () => void | Promise<void>,
  onError: (message: string) => void
) {
  let stopped = false;
  let running = false;
  const check = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const generated = await generateDueOccurrences();
      if (generated > 0) await onOccurrencesGenerated();
      await ReminderService.checkMissedReminders();
    } catch (error) {
      console.error("后台事项检查失败:", error);
      onError(error instanceof Error ? error.message : "后台事项检查失败");
    } finally { running = false; }
  };
  void ReminderService.restorePendingReminders().catch((error) =>
    onError(error instanceof Error ? error.message : "恢复提醒失败")
  );
  void check();
  const timer = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
  const resume = () => void check();
  window.addEventListener("focus", resume);
  document.addEventListener("visibilitychange", resume);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener("focus", resume);
    document.removeEventListener("visibilitychange", resume);
    ReminderService.dispose();
  };
}
