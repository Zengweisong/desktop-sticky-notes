import { isNoteRelevantOnLocalDate } from "./noteDateService";
import type { NoteStatusFilter } from "../types/filter";
import type { Note } from "../types/note";
import type { PriorityFilter } from "../types/settings";

export interface NoteFilterCounts {
  active: number;
  today: number;
  completed: number;
}

export function filterNotes(
  notes: Note[],
  status: NoteStatusFilter,
  categoryId: number | null,
  today = new Date(),
  search = "",
  priority: PriorityFilter = "all"
) {
  const categoryNotes = filterByQuery(filterByCategory(notes, categoryId), search, priority);
  if (status === "completed") return categoryNotes.filter((note) => note.completed);
  if (status === "today") {
    return categoryNotes.filter((note) => !note.completed && isNoteRelevantOnLocalDate(note, today));
  }
  return categoryNotes.filter((note) => !note.completed);
}

export function countNotesByStatus(
  notes: Note[],
  categoryId: number | null,
  today = new Date(),
  search = "",
  priority: PriorityFilter = "all"
): NoteFilterCounts {
  const categoryNotes = filterByQuery(filterByCategory(notes, categoryId), search, priority);
  return {
    active: categoryNotes.filter((note) => !note.completed).length,
    today: categoryNotes.filter((note) => !note.completed && isNoteRelevantOnLocalDate(note, today)).length,
    completed: categoryNotes.filter((note) => note.completed).length
  };
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
