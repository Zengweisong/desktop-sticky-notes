import type { ExportNote } from "./note";

export interface Category {
  id: number;
  name: string;
  color: string;
  icon: string | null;
  sortOrder: number;
  createdAt: string;
  isSystem: boolean;
}

export interface CategoryRow {
  id: number;
  name: string;
  color: string;
  icon: string | null;
  sort_order: number;
  created_at: string;
  is_system: number;
}

export type CategoryDeleteStrategy =
  | { type: "move"; targetCategoryId: number }
  | { type: "uncategorized" }
  | { type: "delete-notes" };

export interface ExportPayloadV2 {
  version: 2;
  exportedAt: string;
  categories: Array<Omit<Category, "id"> & { id: number }>;
  notes: ExportNote[];
}
