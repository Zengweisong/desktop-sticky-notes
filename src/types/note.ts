export type NotePriority = "low" | "normal" | "high";
import type { BoardStatus } from "./board";

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
  /** 唯一的事项时间。数据库字段为 scheduled_at。 */
  scheduledAt: string | null;
  repeatSeriesId: number | null;
  repeatOccurrenceAt: string | null;
  reminderEnabled: boolean;
  reminderAt: string | null;
  reminderOffsetMinutes: number;
  reminderTriggeredAt: string | null;
  boardColumnId: string;
  boardOrder: number;
  status: BoardStatus;
  previousBoardColumnId: string | null;
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
  scheduled_at: string | null;
  repeat_series_id: number | null;
  repeat_occurrence_at: string | null;
  reminder_enabled: number;
  reminder_at: string | null;
  reminder_offset_minutes: number;
  reminder_triggered_at: string | null;
  board_column_id?: string | null;
  board_order?: number | null;
  status?: BoardStatus | null;
  previous_board_column_id?: string | null;
}

export interface NoteInput {
  title: string;
  details?: string | null;
  categoryId?: number | null;
  priority?: NotePriority;
  scheduledAt?: string | null;
  /** 仅供编辑旧版无法换算为提前量的提醒，保存时保持其原始时间。 */
  legacyReminderAt?: string | null;
  /** 事项时间控件的临时草稿，不直接持久化。 */
  planDate?: string;
  planTime?: string;
  reminderEnabled?: boolean;
  reminderOffsetMinutes?: number;
  repeatEnabled?: boolean;
  repeatType?: import("./repeat").RepeatType;
  repeatInterval?: number;
  repeatWeekdays?: number[];
  repeatMonthDay?: number | null;
  repeatEndType?: import("./repeat").RepeatEndType;
  repeatEndDate?: string | null;
  repeatMaxOccurrences?: number | null;
  repeatEditScope?: "occurrence" | "series";
  boardColumnId?: string;
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
