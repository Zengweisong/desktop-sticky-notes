import { getDatabase } from "./database";
import type { NoteInput, NotePriority } from "../types/note";
import type { RepeatEndType, RepeatSeries, RepeatSeriesRow, RepeatType } from "../types/repeat";

const SERIES_FIELDS = `id, title, details, category_id, priority, repeat_type, repeat_interval,
  repeat_weekdays, repeat_month_day, start_at, end_type, end_date, max_occurrences,
  generated_occurrences, default_reminder_enabled, default_all_day_reminder_time,
  default_reminder_offset_minutes,
  next_occurrence_at, active, created_at, updated_at`;
type DatabaseConnection = Awaited<ReturnType<typeof getDatabase>>;

export function fromSeriesRow(row: RepeatSeriesRow): RepeatSeries {
  return {
    id: row.id, title: row.title, details: row.details, categoryId: row.category_id,
    priority: row.priority, repeatType: row.repeat_type, repeatInterval: row.repeat_interval,
    repeatWeekdays: parseWeekdays(row.repeat_weekdays), repeatMonthDay: row.repeat_month_day,
    startAt: row.start_at, endType: row.end_type, endDate: row.end_date,
    maxOccurrences: row.max_occurrences, generatedOccurrences: row.generated_occurrences,
    defaultReminderEnabled: Boolean(row.default_reminder_enabled),
    defaultReminderTime: row.default_all_day_reminder_time || legacyRepeatReminderTime(row),
    defaultReminderOffsetMinutes: row.default_reminder_offset_minutes,
    nextOccurrenceAt: row.next_occurrence_at, active: Boolean(row.active),
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

export async function getRepeatSeries(id: number, database?: DatabaseConnection): Promise<RepeatSeries | null> {
  const rows = await (database || await getDatabase()).select<RepeatSeriesRow[]>(
    `SELECT ${SERIES_FIELDS} FROM repeat_series WHERE id = $1`, [id]
  );
  return rows[0] ? fromSeriesRow(rows[0]) : null;
}

export async function listRepeatSeries(): Promise<RepeatSeries[]> {
  const rows = await (await getDatabase()).select<RepeatSeriesRow[]>(
    `SELECT ${SERIES_FIELDS} FROM repeat_series ORDER BY created_at DESC`
  );
  return rows.map(fromSeriesRow);
}

export async function createRepeatSeries(
  input: NoteInput, categoryId: number, existingNoteId?: number,
  database?: DatabaseConnection
): Promise<{ seriesId: number; noteId: number }> {
  const definition = normalizeRepeatInput(input);
  const db = database || await getDatabase();
  const now = new Date().toISOString();
  const provisional: RepeatSeries = {
      id: 0, title: input.title.trim(), details: input.details?.trim() || null, categoryId,
      priority: input.priority || "normal", ...definition, generatedOccurrences: 1,
      defaultReminderEnabled: input.repeatReminderEnabled !== false,
      defaultReminderTime: normalizeReminderTime(input.repeatReminderTime),
      defaultReminderOffsetMinutes: 0,
      nextOccurrenceAt: null, active: true, createdAt: now, updatedAt: now
  };
  provisional.nextOccurrenceAt = calculateNextOccurrence(provisional, new Date(provisional.startAt));
  provisional.active = provisional.nextOccurrenceAt !== null;
  const result = await db.execute(
      `INSERT INTO repeat_series (title, details, category_id, priority, repeat_type, repeat_interval,
       repeat_weekdays, repeat_month_day, start_at, end_type, end_date, max_occurrences,
       generated_occurrences, default_reminder_enabled, default_all_day_reminder_time,
       default_reminder_offset_minutes, next_occurrence_at, active, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13,$14,$15,$16,$17,$18,$18)`,
      [provisional.title, provisional.details, categoryId, provisional.priority, provisional.repeatType,
        provisional.repeatInterval, serializeWeekdays(provisional.repeatWeekdays), provisional.repeatMonthDay,
        provisional.startAt, provisional.endType, provisional.endDate, provisional.maxOccurrences,
        provisional.defaultReminderEnabled ? 1 : 0, provisional.defaultReminderTime,
        provisional.defaultReminderOffsetMinutes, provisional.nextOccurrenceAt,
        provisional.active ? 1 : 0, now]
  );
  const seriesId = Number(result.lastInsertId);
  let noteId: number;
  if (existingNoteId != null) {
    await db.execute(
        `UPDATE notes SET repeat_series_id = $1, repeat_occurrence_at = $2, scheduled_at = $2,
         reminder_enabled = $3, reminder_offset_minutes = $4, reminder_at = $5,
         reminder_triggered_at = NULL, updated_at = $6 WHERE id = $7`,
        [seriesId, provisional.startAt, provisional.defaultReminderEnabled ? 1 : 0,
          0, repeatReminderAt(provisional.startAt, provisional.defaultReminderEnabled,
            provisional.defaultReminderTime), now, existingNoteId]
    );
    noteId = existingNoteId;
  } else {
    noteId = await insertOccurrence(db, { ...provisional, id: seriesId }, provisional.startAt, now);
  }
  return { seriesId, noteId };
}

export async function updateRepeatSeries(
  seriesId: number, input: NoteInput, categoryId: number, database?: DatabaseConnection
): Promise<void> {
  const current = await getRepeatSeries(seriesId, database);
  if (!current) throw new Error("重复系列不存在");
  const definition = normalizeRepeatInput(input);
  const nextBase: RepeatSeries = {
    ...current, title: input.title.trim(), details: input.details?.trim() || null, categoryId,
    priority: input.priority || "normal", ...definition,
    defaultReminderEnabled: Boolean(input.repeatReminderEnabled),
    defaultReminderTime: normalizeReminderTime(input.repeatReminderTime || current.defaultReminderTime),
    defaultReminderOffsetMinutes: 0,
    // Editing re-anchors future generation while preserving the number of
    // occurrences already consumed by count-limited series.
    active: true,
    updatedAt: new Date().toISOString()
  };
  nextBase.nextOccurrenceAt = calculateNextOccurrence(nextBase, new Date(nextBase.startAt));
  nextBase.active = nextBase.nextOccurrenceAt !== null;
  await (database || await getDatabase()).execute(
    `UPDATE repeat_series SET title=$1, details=$2, category_id=$3, priority=$4, repeat_type=$5,
     repeat_interval=$6, repeat_weekdays=$7, repeat_month_day=$8, start_at=$9, end_type=$10,
     end_date=$11, max_occurrences=$12, default_reminder_enabled=$13,
     default_all_day_reminder_time=$14, default_reminder_offset_minutes=$15,
     next_occurrence_at=$16, active=$17, updated_at=$18 WHERE id=$19`,
    [nextBase.title, nextBase.details, categoryId, nextBase.priority, nextBase.repeatType,
      nextBase.repeatInterval, serializeWeekdays(nextBase.repeatWeekdays), nextBase.repeatMonthDay,
      nextBase.startAt, nextBase.endType, nextBase.endDate, nextBase.maxOccurrences,
      nextBase.defaultReminderEnabled ? 1 : 0, nextBase.defaultReminderTime,
      nextBase.defaultReminderOffsetMinutes, nextBase.nextOccurrenceAt,
      nextBase.active ? 1 : 0, nextBase.updatedAt, seriesId]
  );
}

export async function stopRepeatSeries(
  seriesId: number, database?: DatabaseConnection
): Promise<void> {
  const db = database || await getDatabase();
  // Existing occurrences remain ordinary independent notes, including their reminders.
  await db.execute("UPDATE notes SET repeat_series_id = NULL, repeat_occurrence_at = NULL WHERE repeat_series_id = $1", [seriesId]);
  await db.execute("DELETE FROM repeat_series WHERE id = $1", [seriesId]);
}

export async function deleteRepeatSeries(seriesId: number): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM notes WHERE repeat_series_id = $1", [seriesId]);
  await db.execute("DELETE FROM repeat_series WHERE id = $1", [seriesId]);
}

export async function setRepeatSeriesActive(seriesId: number, active: boolean): Promise<void> {
  const current = await getRepeatSeries(seriesId);
  if (!current) throw new Error("重复系列不存在");
  // Resuming starts from the current clock instead of treating cycles missed
  // while deliberately paused as application downtime that needs catch-up.
  const next = active ? calculateNextOccurrence(current, new Date()) : current.nextOccurrenceAt;
  const canActivate = active && next !== null;
  await (await getDatabase()).execute(
    "UPDATE repeat_series SET active=$1, next_occurrence_at=$2, updated_at=$3 WHERE id=$4",
    [canActivate ? 1 : 0, next, new Date().toISOString(), seriesId]
  );
  if (active && !canActivate) throw new Error("该重复系列已达到结束条件");
}

export async function generateDueOccurrences(now = new Date()): Promise<number> {
  const db = await getDatabase();
  const rows = await db.select<RepeatSeriesRow[]>(
    `SELECT ${SERIES_FIELDS} FROM repeat_series WHERE active = 1 AND next_occurrence_at IS NOT NULL`
  );
  let generated = 0;
  for (const row of rows) {
    const series = fromSeriesRow(row);
    if (!series.nextOccurrenceAt || generationTime(series, series.nextOccurrenceAt) > now) continue;

    // Catch-up policy: consume all missed cycles but materialize only the latest one.
    // This avoids flooding the list after the app has been closed for a long time.
    let latest = series.nextOccurrenceAt;
    let processed = series.generatedOccurrences + 1;
    let cursor = latest;
    for (let guard = 0; guard < 500; guard += 1) {
      const probe = { ...series, generatedOccurrences: processed };
      const next = calculateNextOccurrence(probe, new Date(cursor));
      if (!next || generationTime(series, next) > now) break;
      latest = next;
      cursor = next;
      processed += 1;
    }

    const state = { ...series, generatedOccurrences: processed };
    const next = calculateNextOccurrence(state, new Date(latest));
    const active = next !== null;
    const result = await db.execute(
        `INSERT OR IGNORE INTO notes (content, title, details, category_id, priority, scheduled_at,
         repeat_series_id, repeat_occurrence_at, reminder_enabled, reminder_at,
         reminder_offset_minutes, created_at, updated_at, sort_order)
         VALUES ($1,$1,$2,$3,$4,$5,$6,$5,$7,$8,$9,$10,$10,
           (SELECT COALESCE(MAX(sort_order),0)+10 FROM notes WHERE completed=0 AND pinned=0))`,
        [series.title, series.details, series.categoryId, series.priority, latest, series.id,
          series.defaultReminderEnabled ? 1 : 0,
          repeatReminderAt(latest, series.defaultReminderEnabled, series.defaultReminderTime),
          0, now.toISOString()]
    );
    await db.execute(
        `UPDATE repeat_series SET generated_occurrences=$1, next_occurrence_at=$2,
         active=$3, updated_at=$4 WHERE id=$5`,
        [processed, next, active ? 1 : 0, now.toISOString(), series.id]
    );
    if (result.rowsAffected > 0) generated += 1;
  }
  return generated;
}

export function calculateNextOccurrence(series: RepeatSeries, after: Date): string | null {
  if (series.endType === "count" && series.maxOccurrences != null && series.generatedOccurrences >= series.maxOccurrences) return null;
  const start = new Date(series.startAt);
  let candidate: Date;
  switch (series.repeatType) {
    case "weekdays": candidate = nextWeekday(after, start); break;
    case "weekly": candidate = nextWeekly(after, start, series.repeatInterval, series.repeatWeekdays); break;
    case "monthly": candidate = nextMonthly(after, start, series.repeatInterval, series.repeatMonthDay || start.getDate()); break;
    case "yearly": candidate = nextYearly(after, start, series.repeatInterval); break;
    default: candidate = nextDaily(after, start, series.repeatInterval); break;
  }
  if (series.endType === "date" && series.endDate) {
    const end = new Date(`${series.endDate}T23:59:59.999`);
    if (candidate > end) return null;
  }
  return candidate.toISOString();
}

function nextDaily(after: Date, start: Date, interval: number) {
  const candidate = new Date(start);
  while (candidate <= after) candidate.setDate(candidate.getDate() + interval);
  return candidate;
}

function nextWeekday(after: Date, start: Date) {
  const candidate = new Date(after < start ? start : after);
  if (candidate <= after) candidate.setDate(candidate.getDate() + 1);
  setTime(candidate, start);
  while (candidate.getDay() === 0 || candidate.getDay() === 6 || candidate < start) candidate.setDate(candidate.getDate() + 1);
  return candidate;
}

function nextWeekly(after: Date, start: Date, interval: number, weekdays: number[]) {
  const selected = weekdays.length ? weekdays : [start.getDay()];
  const candidate = new Date(after);
  candidate.setDate(candidate.getDate() + 1);
  setTime(candidate, start);
  const anchor = startOfWeek(start);
  for (let guard = 0; guard < 3660; guard += 1) {
    const weeks = Math.floor((startOfWeek(candidate).getTime() - anchor.getTime()) / 604_800_000);
    if (candidate >= start && weeks >= 0 && weeks % interval === 0 && selected.includes(candidate.getDay())) return candidate;
    candidate.setDate(candidate.getDate() + 1);
  }
  throw new Error("无法计算下一次每周事项");
}

function nextMonthly(after: Date, start: Date, interval: number, wantedDay: number) {
  const startIndex = start.getFullYear() * 12 + start.getMonth();
  const afterIndex = after.getFullYear() * 12 + after.getMonth();
  let step = Math.max(0, Math.floor((afterIndex - startIndex) / interval));
  for (let guard = 0; guard < 1200; guard += 1, step += 1) {
    const monthIndex = startIndex + step * interval;
    const year = Math.floor(monthIndex / 12);
    const month = monthIndex % 12;
    // Product rule: when the requested day (for example 31) does not exist,
    // use that month's last calendar day (28/29/30) instead of skipping it.
    const lastDay = new Date(year, month + 1, 0).getDate();
    const candidate = new Date(year, month, Math.min(wantedDay, lastDay), start.getHours(), start.getMinutes(), 0, 0);
    if (candidate >= start && candidate > after) return candidate;
  }
  throw new Error("无法计算下一次每月事项");
}

function nextYearly(after: Date, start: Date, interval: number) {
  let year = start.getFullYear();
  while (year <= after.getFullYear()) {
    const candidate = clampedDate(year, start.getMonth(), start.getDate(), start);
    if (candidate >= start && candidate > after) return candidate;
    year += interval;
  }
  return clampedDate(year, start.getMonth(), start.getDate(), start);
}

function clampedDate(year: number, month: number, day: number, time: Date) {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, last), time.getHours(), time.getMinutes(), 0, 0);
}

function startOfWeek(value: Date) {
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

function setTime(target: Date, source: Date) {
  target.setHours(source.getHours(), source.getMinutes(), 0, 0);
}

function normalizeRepeatInput(input: NoteInput): Pick<RepeatSeries,
  "repeatType" | "repeatInterval" | "repeatWeekdays" | "repeatMonthDay" | "startAt" |
  "endType" | "endDate" | "maxOccurrences"> {
  const startDate = normalizeStartDate(input.repeatStartDate, input.scheduledAt);
  const startAt = new Date(`${startDate}T00:00:00`);
  const repeatType = input.repeatType || "daily";
  const repeatInterval = Math.max(1, Math.floor(input.repeatInterval || 1));
  const repeatWeekdays = repeatType === "weekdays" ? [1, 2, 3, 4, 5]
    : [...new Set(input.repeatWeekdays?.filter((day) => day >= 0 && day <= 6) || [])];
  if (repeatType === "weekly" && !repeatWeekdays.length) repeatWeekdays.push(startAt.getDay());
  const endType = input.repeatEndType || "never";
  const maxOccurrences = endType === "count" ? Math.max(1, Math.floor(input.repeatMaxOccurrences || 1)) : null;
  if (endType === "date" && !input.repeatEndDate) throw new Error("请选择重复结束日期");
  if (endType === "date" && input.repeatEndDate && startDate > input.repeatEndDate) {
    throw new Error("重复结束日期不能早于开始日期");
  }
  return {
    repeatType, repeatInterval, repeatWeekdays,
    repeatMonthDay: repeatType === "monthly"
      ? Math.min(31, Math.max(1, input.repeatMonthDay || startAt.getDate())) : null,
    startAt: startAt.toISOString(), endType, endDate: endType === "date" ? input.repeatEndDate || null : null,
    maxOccurrences
  };
}

function generationTime(series: RepeatSeries, occurrenceAt: string) {
  if (!series.defaultReminderEnabled) return new Date(occurrenceAt);
  return new Date(repeatReminderAt(occurrenceAt, true, series.defaultReminderTime)!);
}

export function repeatReminderAt(occurrenceAt: string, enabled: boolean, time?: string | null) {
  if (!enabled) return null;
  const occurrence = new Date(occurrenceAt);
  if (Number.isNaN(occurrence.getTime())) return null;
  const [hour, minute] = normalizeReminderTime(time).split(":").map(Number);
  const date = new Date(occurrence.getFullYear(), occurrence.getMonth(), occurrence.getDate(), hour, minute, 0, 0);
  return date.toISOString();
}

async function insertOccurrence(
  db: Awaited<ReturnType<typeof getDatabase>>, series: RepeatSeries, occurrenceAt: string, createdAt: string
) {
  const result = await db.execute(
    `INSERT INTO notes (content, title, details, category_id, priority, scheduled_at,
     repeat_series_id, repeat_occurrence_at, reminder_enabled, reminder_at,
     reminder_offset_minutes, created_at, updated_at, sort_order)
     VALUES ($1,$1,$2,$3,$4,$5,$6,$5,$7,$8,$9,$10,$10,
       (SELECT COALESCE(MAX(sort_order),0)+10 FROM notes WHERE completed=0 AND pinned=0))`,
    [series.title, series.details, series.categoryId, series.priority, occurrenceAt, series.id,
      series.defaultReminderEnabled ? 1 : 0,
      repeatReminderAt(occurrenceAt, series.defaultReminderEnabled, series.defaultReminderTime),
      0, createdAt]
  );
  return Number(result.lastInsertId);
}

function parseWeekdays(value: string | null) {
  if (!value) return [];
  return value.split(",").map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
}
function serializeWeekdays(value: number[]) { return value.length ? value.join(",") : null; }

function normalizeStartDate(value?: string, fallback?: string | null) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime())) return value;
  if (fallback) {
    const date = new Date(fallback);
    if (!Number.isNaN(date.getTime())) return localDate(date);
  }
  return localDate(new Date());
}

function normalizeReminderTime(value?: string | null) {
  return value && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : "09:00";
}

function legacyRepeatReminderTime(row: RepeatSeriesRow) {
  if (!row.default_reminder_enabled) return null;
  const start = new Date(row.start_at);
  if (Number.isNaN(start.getTime())) return "09:00";
  const reminder = new Date(start.getTime() - Math.max(0, row.default_reminder_offset_minutes || 0) * 60_000);
  return `${String(reminder.getHours()).padStart(2, "0")}:${String(reminder.getMinutes()).padStart(2, "0")}`;
}

function localDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function describeRepeat(series: Pick<RepeatSeries, "repeatType" | "repeatInterval" | "repeatWeekdays" | "repeatMonthDay">) {
  const interval = series.repeatInterval;
  if (series.repeatType === "weekdays") return "每个工作日";
  if (series.repeatType === "weekly") {
    const names = ["日", "一", "二", "三", "四", "五", "六"];
    const days = series.repeatWeekdays.map((day) => `周${names[day]}`).join("、");
    return `${interval > 1 ? `每隔${interval}周` : "每周"}${days ? ` · ${days}` : ""}`;
  }
  if (series.repeatType === "monthly") return `${interval > 1 ? `每隔${interval}个月` : "每月"}${series.repeatMonthDay || ""}日`;
  if (series.repeatType === "yearly") return interval > 1 ? `每隔${interval}年` : "每年";
  return interval > 1 ? `每隔${interval}天` : "每天";
}

export type { NotePriority, RepeatEndType, RepeatType };
