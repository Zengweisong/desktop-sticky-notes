import { isNoteRelevantOnLocalDate } from "./noteDateService";
import type { NoteTimeFilter } from "../types/filter";
import type { Note } from "../types/note";
import type { PriorityFilter } from "../types/settings";

export function collapseRepeatSeriesNotes(notes: Note[]) {
  const latestBySeries = new Map<number, Note>();
  for (const note of notes) {
    if (note.repeatSeriesId == null) continue;
    const current = latestBySeries.get(note.repeatSeriesId);
    if (!current || occurrenceTime(note) > occurrenceTime(current)
      || (occurrenceTime(note) === occurrenceTime(current) && note.id > current.id)) {
      latestBySeries.set(note.repeatSeriesId, note);
    }
  }
  return notes.filter((note) => note.repeatSeriesId == null || latestBySeries.get(note.repeatSeriesId)?.id === note.id);
}

export function filterNotes(
  notes: Note[],
  timeRange: NoteTimeFilter,
  categoryId: number | null,
  today = new Date(),
  search = "",
  priority: PriorityFilter = "all"
) {
  return notes.filter((note) => matchesNoteFilters(note, timeRange, categoryId, today, search, priority));
}

export function matchesNoteFilters(
  note: Pick<Note, "title" | "details" | "categoryId" | "priority" | "scheduledDate" | "scheduledAt" | "dueAt" | "reminderAt">,
  timeRange: NoteTimeFilter,
  categoryId: number | null,
  today = new Date(),
  search = "",
  priority: PriorityFilter = "all"
) {
  if (!matchesCategoryAndQuery(note, categoryId, search, priority)) return false;
  if (timeRange === "today") return isNoteRelevantOnLocalDate(note, today);
  if (timeRange === "undated") return !note.scheduledDate && !note.scheduledAt;
  const dates = noteDates(note);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (timeRange === "overdue") return dates.some((date) => date.getTime() < startOfToday);
  if (timeRange === "future") {
    const startOfTomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
    return dates.some((date) => date.getTime() >= startOfTomorrow);
  }
  return true;
}

function matchesCategoryAndQuery(
  note: Pick<Note, "title" | "details" | "categoryId" | "priority">,
  categoryId: number | null,
  search: string,
  priority: PriorityFilter
) {
  if (categoryId != null && note.categoryId !== categoryId) return false;
  if (priority !== "all" && note.priority !== priority) return false;
  const query = search.trim().toLocaleLowerCase();
  return !query || note.title.toLocaleLowerCase().includes(query)
    || (note.details || "").toLocaleLowerCase().includes(query);
}

function noteDates(note: Pick<Note, "scheduledDate" | "scheduledAt" | "dueAt" | "reminderAt">) {
  const scheduledDate = note.scheduledDate ? localDateFromKey(note.scheduledDate) : null;
  const otherDates = [note.dueAt, note.reminderAt]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));
  return scheduledDate ? [scheduledDate, ...otherDates] : note.scheduledAt
    ? [new Date(note.scheduledAt), ...otherDates].filter((date) => !Number.isNaN(date.getTime()))
    : otherDates;
}

function localDateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function occurrenceTime(note: Note) {
  const value = note.repeatOccurrenceAt || note.scheduledAt || note.createdAt;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}
