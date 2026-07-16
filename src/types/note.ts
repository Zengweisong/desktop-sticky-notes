export type NotePriority = "low" | "normal" | "high";

export interface Note {
  id: number;
  title: string;
  details: string | null;
  categoryId: number | null;
  completed: boolean;
  pinned: boolean;
  priority: NotePriority;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  dueAt: string | null;
  sortOrder: number;
}

export interface NoteRow {
  id: number;
  title: string | null;
  content: string;
  details: string | null;
  category_id: number | null;
  completed: number;
  pinned: number;
  priority: NotePriority;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  due_at: string | null;
  sort_order: number;
}

export interface NoteInput {
  title: string;
  details?: string | null;
  categoryId?: number | null;
  priority?: NotePriority;
  dueAt?: string | null;
}

export interface NoteUpdate extends NoteInput {}

export interface ExportNote extends Omit<Note, "id"> { id?: number }

export interface ExportPayloadV1 {
  version: 1;
  exportedAt: string;
  notes: Array<{
    id?: number; content: string; completed: boolean; pinned: boolean;
    createdAt: string; updatedAt: string; completedAt: string | null; sortOrder: number;
  }>;
}
