import type { Note } from "../types/note";

type ScheduleLike = Pick<Note, "scheduledAt"> & Partial<Pick<Note, "scheduledDate">>;

export function isScheduledOnLocalDate(note: ScheduleLike, localDate: Date) {
  return noteDateKey(note) === localDateKey(localDate);
}

/** “今天”筛选匹配计划、截止或提醒日期在当天的事项。 */
export function isNoteRelevantOnLocalDate(
  note: Pick<Note, "scheduledAt" | "dueAt" | "reminderAt"> & Partial<Pick<Note, "scheduledDate">>,
  localDate: Date
) {
  if (noteDateKey(note) === localDateKey(localDate)) return true;
  return [note.dueAt, note.reminderAt]
    .some((value) => isIsoValueOnLocalDate(value, localDate));
}

export function noteDateKey(note: ScheduleLike) {
  if (note.scheduledDate && isValidLocalDate(note.scheduledDate)) return note.scheduledDate;
  if (!note.scheduledAt) return null;
  const date = new Date(note.scheduledAt);
  return Number.isNaN(date.getTime()) ? null : localDateKey(date);
}

export function scheduledAtFromParts(dateKey?: string | null, time?: string | null) {
  if (!dateKey || !time || !isValidLocalDate(dateKey) || !isValidLocalTime(time)) return null;
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day
    || date.getHours() !== hour || date.getMinutes() !== minute) return null;
  return date.toISOString();
}

export function schedulePartsFromIso(value?: string | null) {
  if (!value) return { date: null, time: null };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: null, time: null };
  return {
    date: localDateKey(date),
    time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
  };
}

export function normalizedSchedule(input: {
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  scheduledAt?: string | null;
}) {
  const legacy = schedulePartsFromIso(input.scheduledAt);
  const date = input.scheduledDate === undefined ? legacy.date : normalizeDate(input.scheduledDate);
  const time = input.scheduledTime === undefined ? legacy.time : normalizeTime(input.scheduledTime);
  const scheduledAt = scheduledAtFromParts(date, date ? time : null);
  if (date && time && !scheduledAt) throw new Error("所选本地时间不存在，请选择其他时间");
  return {
    scheduledDate: date,
    scheduledTime: date ? time : null,
    scheduledAt
  };
}

export function isValidLocalDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function isValidLocalTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function normalizeDate(value?: string | null) {
  return value && isValidLocalDate(value) ? value : null;
}

function normalizeTime(value?: string | null) {
  return value && isValidLocalTime(value) ? value : null;
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
