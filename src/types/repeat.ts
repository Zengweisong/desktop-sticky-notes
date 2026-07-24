export type RepeatType = "daily" | "weekdays" | "weekly" | "monthly" | "yearly";
export type RepeatEndType = "never" | "date" | "count";

export interface RepeatSeries {
  id: number;
  title: string;
  details: string | null;
  categoryId: number | null;
  priority: import("./note").NotePriority;
  repeatType: RepeatType;
  repeatInterval: number;
  repeatWeekdays: number[];
  repeatMonthDay: number | null;
  startAt: string;
  endType: RepeatEndType;
  endDate: string | null;
  maxOccurrences: number | null;
  generatedOccurrences: number;
  defaultReminderEnabled: boolean;
  /** 每次重复发生当天的本地提醒时间。旧数据会由偏移量换算。 */
  defaultReminderTime: string | null;
  defaultReminderOffsetMinutes: number;
  nextOccurrenceAt: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RepeatSeriesRow {
  id: number;
  title: string;
  details: string | null;
  category_id: number | null;
  priority: import("./note").NotePriority;
  repeat_type: RepeatType;
  repeat_interval: number;
  repeat_weekdays: string | null;
  repeat_month_day: number | null;
  start_at: string;
  end_type: RepeatEndType;
  end_date: string | null;
  max_occurrences: number | null;
  generated_occurrences: number;
  default_reminder_enabled: number;
  default_all_day_reminder_time: string | null;
  default_reminder_offset_minutes: number;
  next_occurrence_at: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}
