import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  cancel, isPermissionGranted, onAction, removeActive, requestPermission, sendNotification
} from "@tauri-apps/plugin-notification";
import { getDatabase } from "./database";
import type { NoteInput } from "../types/note";

interface PendingReminderRow {
  id: number;
  title: string;
  details: string | null;
  category_name: string | null;
  scheduled_at: string | null;
  reminder_at: string;
}

class ReminderServiceImpl {
  private actionCleanup: (() => void) | null = null;
  private nativeActionCleanup: (() => void) | null = null;

  calculateReminderAt(scheduledAt: string | null | undefined, offsetMinutes = 0) {
    if (!scheduledAt) return null;
    const eventTime = new Date(scheduledAt);
    if (Number.isNaN(eventTime.getTime())) throw new Error("事项时间无效");
    return new Date(eventTime.getTime() - Math.max(0, offsetMinutes) * 60_000).toISOString();
  }

  async scheduleReminder(input: NoteInput) {
    if (!input.reminderEnabled) return null;
    const reminderAt = this.calculateReminderAt(input.scheduledAt, input.reminderOffsetMinutes || 0);
    if (!reminderAt || new Date(reminderAt).getTime() < Date.now()) throw new Error("提醒时间不能早于当前时间");
    if (isTauriRuntime()) {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
      if (!granted) throw new Error("未获得 Windows 通知权限");
    }
    return reminderAt;
  }

  async cancelReminder(noteId: number) {
    if (!isTauriRuntime()) return;
    try { await cancel([notificationId(noteId)]); } catch (error) { console.debug("取消待发通知失败:", error); }
    try { await removeActive([{ id: notificationId(noteId) }]); } catch (error) { console.debug("移除活动通知失败:", error); }
  }

  async updateReminder(noteId: number, input: NoteInput) {
    await this.cancelReminder(noteId);
    return this.scheduleReminder(input);
  }

  async restorePendingReminders() {
    await this.installNotificationActions();
    return this.checkMissedReminders();
  }

  async checkMissedReminders(now = new Date()) {
    const db = await getDatabase();
    const rows = await db.select<PendingReminderRow[]>(
      `SELECT n.id, n.title, n.details, c.name AS category_name, n.scheduled_at, n.reminder_at
       FROM notes n LEFT JOIN categories c ON c.id = n.category_id
       WHERE n.reminder_enabled = 1 AND n.completed = 0
         AND n.reminder_triggered_at IS NULL AND n.reminder_at IS NOT NULL AND n.reminder_at <= $1
       ORDER BY n.reminder_at ASC`, [now.toISOString()]
    );
    let triggered = 0;
    for (const row of rows) {
      const claim = await db.execute(
        `UPDATE notes SET reminder_triggered_at=$1, updated_at=$1
         WHERE id=$2 AND reminder_enabled=1 AND completed=0 AND reminder_triggered_at IS NULL`,
        [now.toISOString(), row.id]
      );
      if (claim.rowsAffected === 0) continue;
      try {
        await this.showSystemNotification(row);
        triggered += 1;
      } catch (error) {
        // Re-open transient failures, but do not retry every 20 seconds after a permanent denial.
        if (!(error instanceof Error) || !error.message.includes("通知权限")) {
          await db.execute("UPDATE notes SET reminder_triggered_at=NULL WHERE id=$1", [row.id]);
        }
        throw error;
      }
    }
    return triggered;
  }

  async showSystemNotification(reminder: PendingReminderRow) {
    if (!isTauriRuntime()) return;
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (!granted) throw new Error("未获得 Windows 通知权限");
    const itemTime = reminder.scheduled_at ? formatDateTime(reminder.scheduled_at) : "未设置";
    const parts = [
      reminder.details?.trim() || "无补充内容",
      `分类：${reminder.category_name || "未分类"}`,
      `事项时间：${itemTime}`
    ];
    const body = parts.join("\n");
    try {
      await invoke("show_reminder_notification", {
        noteId: reminder.id, title: reminder.title, details: parts[0], context: parts.slice(1).join(" · ")
      });
    } catch (error) {
      console.warn("原生可点击 Toast 发送失败，使用通知插件后备方案:", error);
      sendNotification({ id: notificationId(reminder.id), title: reminder.title, body });
    }
  }

  dispose() {
    this.actionCleanup?.();
    this.actionCleanup = null;
    this.nativeActionCleanup?.();
    this.nativeActionCleanup = null;
  }

  private async installNotificationActions() {
    if (!isTauriRuntime() || this.actionCleanup) return;
    this.nativeActionCleanup = await listen<number>("notification-activated", (event) => {
      void focusNote(event.payload);
    });
    const listener = await onAction((notification) => {
      const noteId = Number(notification.extra?.noteId);
      void focusNote(Number.isFinite(noteId) ? noteId : null);
    });
    this.actionCleanup = () => listener.unregister();
  }
}

async function focusNote(noteId: number | null) {
  try {
    const win = getCurrentWindow();
    await win.show(); await win.unminimize(); await win.setFocus();
    await invoke("set_background_visible", { visible: true });
    if (noteId != null) window.dispatchEvent(new CustomEvent("focus-note", { detail: noteId }));
  } catch (error) { console.error("从通知打开事项失败:", error); }
}

function notificationId(noteId: number) {
  return Math.max(1, Math.min(2_147_483_647, Math.trunc(noteId)));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(new Date(value));
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const ReminderService = new ReminderServiceImpl();
