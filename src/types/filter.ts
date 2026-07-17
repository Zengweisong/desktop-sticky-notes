export type NoteStatusFilter = "active" | "today" | "completed";

export function isNoteStatusFilter(value: unknown): value is NoteStatusFilter {
  return value === "active" || value === "today" || value === "completed";
}
