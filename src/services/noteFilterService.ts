import { isNoteRelevantOnLocalDate } from "./noteDateService";
import type { NoteStatusFilter } from "../types/filter";
import type { Note } from "../types/note";

export interface NoteFilterCounts {
  active: number;
  today: number;
  completed: number;
}

export function filterNotes(
  notes: Note[],
  status: NoteStatusFilter,
  categoryId: number | null,
  today = new Date()
) {
  const categoryNotes = filterByCategory(notes, categoryId);
  if (status === "completed") return categoryNotes.filter((note) => note.completed);
  if (status === "today") {
    return categoryNotes.filter((note) => !note.completed && isNoteRelevantOnLocalDate(note, today));
  }
  return categoryNotes.filter((note) => !note.completed);
}

export function countNotesByStatus(
  notes: Note[],
  categoryId: number | null,
  today = new Date()
): NoteFilterCounts {
  const categoryNotes = filterByCategory(notes, categoryId);
  return {
    active: categoryNotes.filter((note) => !note.completed).length,
    today: categoryNotes.filter((note) => !note.completed && isNoteRelevantOnLocalDate(note, today)).length,
    completed: categoryNotes.filter((note) => note.completed).length
  };
}

function filterByCategory(notes: Note[], categoryId: number | null) {
  return categoryId == null ? notes : notes.filter((note) => note.categoryId === categoryId);
}
