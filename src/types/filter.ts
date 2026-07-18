export type NoteTimeFilter = "all" | "today" | "overdue" | "future" | "undated";

export function isNoteTimeFilter(value: unknown): value is NoteTimeFilter {
  return value === "all" || value === "today" || value === "overdue"
    || value === "future" || value === "undated";
}
