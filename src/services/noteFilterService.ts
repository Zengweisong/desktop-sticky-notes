import { isNoteRelevantOnLocalDate } from "./noteDateService";
import type { NoteTimeFilter } from "../types/filter";
import type { Note } from "../types/note";
import type { PriorityFilter } from "../types/settings";

export function filterNotes(
  notes: Note[],
  timeRange: NoteTimeFilter,
  categoryId: number | null,
  today = new Date(),
  search = "",
  priority: PriorityFilter = "all"
) {
  const categoryNotes = filterByQuery(filterByCategory(notes, categoryId), search, priority);
  if (timeRange === "today") return categoryNotes.filter((note) => isNoteRelevantOnLocalDate(note, today));
  const datedNotes = categoryNotes.map((note) => ({ note, dates: noteDates(note) }));
  if (timeRange === "undated") return datedNotes.filter(({ dates }) => !dates.length).map(({ note }) => note);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (timeRange === "overdue") {
    return datedNotes.filter(({ dates }) => dates.some((date) => date.getTime() < startOfToday)).map(({ note }) => note);
  }
  if (timeRange === "future") {
    const startOfTomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
    return datedNotes.filter(({ dates }) => dates.some((date) => date.getTime() >= startOfTomorrow)).map(({ note }) => note);
  }
  return categoryNotes;
}

function filterByCategory(notes: Note[], categoryId: number | null) {
  return categoryId == null ? notes : notes.filter((note) => note.categoryId === categoryId);
}

function filterByQuery(notes: Note[], search: string, priority: PriorityFilter) {
  const query = search.trim().toLocaleLowerCase();
  return notes.filter((note) => {
    if (priority !== "all" && note.priority !== priority) return false;
    if (!query) return true;
    return note.title.toLocaleLowerCase().includes(query)
      || (note.details || "").toLocaleLowerCase().includes(query);
  });
}

function noteDates(note: Pick<Note, "scheduledAt" | "dueAt" | "reminderAt">) {
  return [note.scheduledAt, note.dueAt, note.reminderAt]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));
}
