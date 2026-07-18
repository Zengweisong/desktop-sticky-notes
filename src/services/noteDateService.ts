import type { Note } from "../types/note";

export function isScheduledOnLocalDate(note: Pick<Note, "scheduledAt">, localDate: Date) {
  return isIsoValueOnLocalDate(note.scheduledAt, localDate);
}

/** “今日”视图包含计划、截止或提醒日期在当天的未完成事项。 */
export function isNoteRelevantOnLocalDate(
  note: Pick<Note, "scheduledAt" | "dueAt" | "reminderAt">,
  localDate: Date
) {
  return [note.scheduledAt, note.dueAt, note.reminderAt]
    .some((value) => isIsoValueOnLocalDate(value, localDate));
}

function isIsoValueOnLocalDate(value: string | null, localDate: Date) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return localDateKey(date) === localDateKey(localDate);
}

export function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
