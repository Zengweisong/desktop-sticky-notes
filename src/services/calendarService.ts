import type { Note } from "../types/note";
import type { RepeatSeries } from "../types/repeat";
import { localDateKey, noteDateKey, scheduledAtFromParts } from "./noteDateService";
import { calculateOccurrencesInRange } from "./repeatTaskService";

export interface CalendarDay {
  date: Date;
  key: string;
  inMonth: boolean;
  isToday: boolean;
}

export interface CalendarEntry {
  id: string;
  dateKey: string;
  occurrenceAt: string | null;
  title: string;
  details: string | null;
  categoryId: number | null;
  priority: Note["priority"];
  completed: boolean;
  scheduledAt: string | null;
  scheduledDate: string | null;
  scheduledTime: string | null;
  sortOrder: number;
  dueAt: string | null;
  reminderAt: string | null;
  note: Note | null;
  sourceNote: Note | null;
  series: RepeatSeries | null;
  virtual: boolean;
}

export function monthStart(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

export function buildMonthGrid(month: Date, today = new Date()): CalendarDay[] {
  const first = monthStart(month);
  const mondayOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - mondayOffset);
  const todayKey = localDateKey(today);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
    const key = localDateKey(date);
    return { date, key, inMonth: date.getMonth() === first.getMonth(), isToday: key === todayKey };
  });
}

export function buildCalendarEntries(
  notes: Note[],
  repeatSeries: RepeatSeries[],
  rangeStart: Date,
  rangeEnd: Date
): CalendarEntry[] {
  const entries: CalendarEntry[] = [];
  const existingSeriesDates = new Set<string>();
  const sourceBySeries = new Map<number, Note>();

  const rangeStartKey = localDateKey(rangeStart);
  const rangeEndKey = localDateKey(rangeEnd);

  for (const note of notes) {
    if (note.repeatSeriesId != null && !sourceBySeries.has(note.repeatSeriesId)) {
      sourceBySeries.set(note.repeatSeriesId, note);
    }
    const dateKey = noteCalendarDateKey(note);
    if (!dateKey || dateKey < rangeStartKey || dateKey >= rangeEndKey) continue;
    if (note.repeatSeriesId != null) existingSeriesDates.add(`${note.repeatSeriesId}:${dateKey}`);
    entries.push({
      id: `note-${note.id}`,
      dateKey,
      occurrenceAt: note.scheduledAt,
      title: note.title,
      details: note.details,
      categoryId: note.categoryId,
      priority: note.priority,
      completed: note.completed,
      scheduledAt: note.scheduledAt,
      scheduledDate: dateKey,
      scheduledTime: note.scheduledTime,
      sortOrder: note.sortOrder,
      dueAt: note.dueAt,
      reminderAt: note.reminderAt,
      note,
      sourceNote: note,
      series: note.repeatSeriesId == null ? null : repeatSeries.find((item) => item.id === note.repeatSeriesId) || null,
      virtual: false
    });
  }

  for (const series of repeatSeries) {
    if (!series.active) continue;
    const sourceNote = sourceBySeries.get(series.id) || null;
    for (const occurrenceAt of calculateOccurrencesInRange(series, rangeStart, rangeEnd)) {
      const occurrence = new Date(occurrenceAt);
      const dateKey = Number.isNaN(occurrence.getTime()) ? null : localDateKey(occurrence);
      if (!dateKey || existingSeriesDates.has(`${series.id}:${dateKey}`)) continue;
      entries.push({
        id: `series-${series.id}-${dateKey}`,
        dateKey,
        occurrenceAt,
        title: series.title,
        details: series.details,
        categoryId: series.categoryId,
        priority: series.priority,
        completed: false,
        scheduledAt: occurrenceAt,
        scheduledDate: dateKey,
        scheduledTime: null,
        sortOrder: 0,
        dueAt: null,
        reminderAt: null,
        note: null,
        sourceNote,
        series,
        virtual: true
      });
    }
  }

  return entries.sort((left, right) => {
    if (left.dateKey !== right.dateKey) return left.dateKey.localeCompare(right.dateKey);
    if (Boolean(left.scheduledTime) !== Boolean(right.scheduledTime)) return left.scheduledTime ? 1 : -1;
    if (left.scheduledTime !== right.scheduledTime) return (left.scheduledTime || "").localeCompare(right.scheduledTime || "");
    if (left.completed !== right.completed) return left.completed ? 1 : -1;
    return right.sortOrder - left.sortOrder || left.title.localeCompare(right.title, "zh-CN");
  });
}

export function noteCalendarDateKey(note: Pick<Note, "scheduledAt"> & Partial<Pick<Note, "scheduledDate">>) {
  return noteDateKey(note);
}

export function unscheduledNotes(notes: Note[]) {
  return notes.filter((note) => noteCalendarDateKey(note) == null);
}

export function localScheduledAt(dateKey: string, time: string | null) {
  return scheduledAtFromParts(dateKey, time);
}

export function calendarRange(days: CalendarDay[]) {
  const start = days[0]?.date || new Date();
  const last = days[days.length - 1]?.date || start;
  return {
    start: new Date(start.getFullYear(), start.getMonth(), start.getDate()),
    end: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1)
  };
}
