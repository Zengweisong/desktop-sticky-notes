export type NoteFilter = "all" | "today" | "active" | "completed" | `category:${number}`;

export function categoryIdFromFilter(filter: NoteFilter): number | null {
  return filter.startsWith("category:") ? Number(filter.slice("category:".length)) : null;
}
