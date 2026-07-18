export type BoardStatus = "todo" | "doing" | "completed";

export interface BoardColumn {
  id: string;
  name: string;
  order: number;
  type: "system" | "custom";
  status: BoardStatus;
  createdAt: string;
  updatedAt: string;
}

export interface BoardColumnRow {
  id: string;
  name: string;
  sort_order: number;
  type: "system" | "custom";
  status: BoardStatus;
  created_at: string;
  updated_at: string;
}

export const TODO_COLUMN_ID = "todo";
export const DOING_COLUMN_ID = "doing";
export const COMPLETED_COLUMN_ID = "completed";

