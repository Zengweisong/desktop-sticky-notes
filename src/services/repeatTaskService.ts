import { getDatabase } from "./database";
import type { NoteInput, NotePriority } from "../types/note";
import type { RepeatEndType, RepeatSeries, RepeatSeriesRow, RepeatType } from "../types/repeat";

const SERIES_FIELDS = `id, title, details, category_id, priority, repeat_type, repeat_interval,
  repeat_weekdays, repeat_month_day, start_at, end_type, end_date, max_occurrences,
  generated_occurrences, default_reminder_enabled, default_all_day_reminder_time,
  default_reminder_offset_minutes,
  next_occurrence_at, active, created_at, updated_at`;
type DatabaseConnection = Awaited<ReturnType<typeof getDatabase>>;
let seriesMutationTail: Promise<void> = Promise.resolve();

export function withRepeatSeriesMutation<T>(action: () => Promise<T>): Promise<T> {
  const result = seriesMutationTail.then(action, action);
  seriesMutationTail = result.then(() => undefined, () => undefined);
  return result;
}

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
  try {
    let noteId: number;
    if (existingNoteId != null) {
      await db.execute(
        `UPDATE notes SET repeat_series_id = $1, repeat_occurrence_at = $2, scheduled_at = $2,
         reminder_enabled = $3, reminder_offset_minutes = $4, reminder_at = $5,
         reminder_triggered_at = NULL, updated_at = $6 WHERE id = $7`,
        [seriesId, provisional.startAt, provisional.defaultReminderEnabled ? 1 : 0,
          0, initialRepeatReminderAt(provisional.startAt, provisional.defaultReminderEnabled,
            provisional.defaultReminderTime, new Date(now)), now, existingNoteId]
      );
      noteId = existingNoteId;
    } else {
      noteId = await insertOccurrence(db, { ...provisional, id: seriesId }, provisional.startAt, now);
    }
    return { seriesId, noteId };
  } catch (error) {
    try { await db.execute("DELETE FROM repeat_series WHERE id = $1", [seriesId]); }
    catch (cleanupError) { console.error("清理未完成的重复系列失败:", cleanupError); }
    throw error;
  }
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
  const scheduleChanged = !sameRepeatSchedule(current, nextBase);
  if (scheduleChanged) {
    const anchor = current.nextOccurrenceAt
      ? new Date(new Date(current.nextOccurrenceAt).getTime() - 1)
      : new Date();
    nextBase.nextOccurrenceAt = calculateNextOccurrence(nextBase, anchor);
  } else {
    nextBase.nextOccurrenceAt = current.nextOccurrenceAt;
  }
  nextBase.active = nextBase.nextOccurrenceAt !== null;
  await writeRepeatSeries(nextBase, database || await getDatabase());
}

function sameRepeatSchedule(current: RepeatSeries, next: RepeatSeries) {
  return current.repeatType === next.repeatType &&
    current.repeatInterval === next.repeatInterval &&
    current.repeatMonthDay === next.repeatMonthDay &&
    current.startAt === next.startAt &&
    current.endType === next.endType &&
    current.endDate === next.endDate &&
    current.maxOccurrences === next.maxOccurrences &&
    current.repeatWeekdays.join(",") === next.repeatWeekdays.join(",");
}

export async function restoreRepeatSeries(
  series: RepeatSeries, database?: DatabaseConnection
): Promise<void> {
  await writeRepeatSeries(series, database || await getDatabase());
}

async function writeRepeatSeries(series: RepeatSeries, db: DatabaseConnection) {
  await db.execute(
    `UPDATE repeat_series SET title=$1, details=$2, category_id=$3, priority=$4, repeat_type=$5,
     repeat_interval=$6, repeat_weekdays=$7, repeat_month_day=$8, start_at=$9, end_type=$10,
     end_date=$11, max_occurrences=$12, default_reminder_enabled=$13,
     default_all_day_reminder_time=$14, default_reminder_offset_minutes=$15,
     next_occurrence_at=$16, active=$17, updated_at=$18 WHERE id=$19`,
    [series.title, series.details, series.categoryId, series.priority, series.repeatType,
      series.repeatInterval, serializeWeekdays(series.repeatWeekdays), series.repeatMonthDay,
      series.startAt, series.endType, series.endDate, series.maxOccurrences,
      series.defaultReminderEnabled ? 1 : 0, series.defaultReminderTime,
      series.defaultReminderOffsetMinutes, series.nextOccurrenceAt,
      series.active ? 1 : 0, series.updatedAt, series.id]
  );
}

export function stopRepeatSeries(
  seriesId: number, database?: DatabaseConnection
): Promise<void> {
  return withRepeatSeriesMutation(() => stopRepeatSeriesUnlocked(seriesId, database));
}

async function stopRepeatSeriesUnlocked(seriesId: number, database?: DatabaseConnection) {
  const db = database || await getDatabase();
  const noteIds = await listSeriesNoteIds(db, seriesId);
  // The foreign key detaches occurrences. Delete the series first so a later
  // cleanup failure can leave only harmless metadata, never a half-detached series.
  await db.execute("DELETE FROM repeat_series WHERE id = $1", [seriesId]);
  if (noteIds.length) {
    await db.execute(
      `UPDATE notes SET repeat_occurrence_at = NULL WHERE id IN (${sqlParameters(noteIds.length)})`, noteIds
    );
  }
}

export function deleteRepeatSeries(seriesId: number): Promise<void> {
  return withRepeatSeriesMutation(() => deleteRepeatSeriesUnlocked(seriesId));
}

async function deleteRepeatSeriesUnlocked(seriesId: number) {
  const db = await getDatabase();
  const noteIds = await listSeriesNoteIds(db, seriesId);
  // Deleting the parent first makes failure conservative: occurrences may remain
  // as ordinary notes, but user data is never deleted while a live series remains.
  await db.execute("DELETE FROM repeat_series WHERE id = $1", [seriesId]);
  if (noteIds.length) {
    await db.execute(`DELETE FROM notes WHERE id IN (${sqlParameters(noteIds.length)})`, noteIds);
  }
}

async function listSeriesNoteIds(db: DatabaseConnection, seriesId: number) {
  const rows = await db.select<Array<{ id: number }>>(
    "SELECT id FROM notes WHERE repeat_series_id = $1", [seriesId]
  );
  return rows.map(({ id }) => id);
}

function sqlParameters(count: number) {
  return Array.from({ length: count }, (_, index) => `$${index + 1}`).join(",");
}

export function setRepeatSeriesActive(seriesId: number, active: boolean): Promise<void> {
  return withRepeatSeriesMutation(() => setRepeatSeriesActiveUnlocked(seriesId, active));
}

async function setRepeatSeriesActiveUnlocked(seriesId: number, active: boolean): Promise<void> {
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

export function generateDueOccurrences(now = new Date()): Promise<number> {
  return withRepeatSeriesMutation(() => generateDueOccurrencesUnlocked(now));
}

async function generateDueOccurrencesUnlocked(now: Date): Promise<number> {
  const db = await getDatabase();
  const rows = await db.select<RepeatSeriesRow[]>(
    `SELECT ${SERIES_FIELDS} FROM repeat_series WHERE active = 1 AND next_occurrence_at IS NOT NULL`
  );
  let generated = 0;
  for (const row of rows) {
    const series = fromSeriesRow(row);
    if (!series.nextOccurrenceAt || generationTime(series.nextOccurrenceAt) > now) continue;

    // Catch-up policy: consume all missed cycles but materialize only the latest one.
    // This avoids flooding the list after the app has been closed for a long time.
    let latest = series.nextOccurrenceAt;
    let processed = series.generatedOccurrences + 1;
    let cursor = latest;
    for (let guard = 0; guard < 500; guard += 1) {
      const probe = { ...series, generatedOccurrences: processed };
      const next = calculateNextOccurrence(probe, new Date(cursor));
      if (!next || generationTime(next) > now) break;
      latest = next;
      cursor = next;
      processed += 1;
    }

    const state = { ...series, generatedOccurrences: processed };
    const next = calculateNextOccurrence(state, new Date(latest));
    const active = next !== null;
    const nowIso = now.toISOString();
    const reminderAt = repeatReminderAt(latest, series.defaultReminderEnabled, series.defaultReminderTime);
    const reused = await db.execute(
        `UPDATE notes SET content=$1, title=$1, details=$2, category_id=$3, priority=$4,
         scheduled_at=$5, scheduled_date=NULL, scheduled_time=NULL, repeat_occurrence_at=$5,
         reminder_enabled=$7, reminder_at=$8, reminder_offset_minutes=0, reminder_triggered_at=NULL,
         sort_order=CASE WHEN completed=1 THEN
           (SELECT COALESCE(MAX(sort_order),0)+10 FROM notes WHERE completed=0 AND pinned=0)
           ELSE sort_order END,
         board_order=CASE WHEN completed=1 THEN
           (SELECT COALESCE(MAX(board_order),0)+10 FROM notes WHERE board_column_id='todo')
           ELSE board_order END,
         pinned=CASE WHEN completed=1 THEN 0 ELSE pinned END,
         board_column_id=CASE WHEN completed=1 THEN 'todo' ELSE board_column_id END,
         status=CASE WHEN completed=1 THEN 'todo' ELSE status END,
         previous_board_column_id=CASE WHEN completed=1 THEN NULL ELSE previous_board_column_id END,
         completed=0, completed_at=NULL, updated_at=$9
         WHERE id=(SELECT id FROM notes WHERE repeat_series_id=$6
           ORDER BY repeat_occurrence_at DESC, id DESC LIMIT 1)`,
        [series.title, series.details, series.categoryId, series.priority, latest, series.id,
          series.defaultReminderEnabled ? 1 : 0, reminderAt, nowIso]
    );
    let changed = reused.rowsAffected;
    if (changed > 0) {
      await db.execute(
        `UPDATE notes SET reminder_enabled=0, reminder_at=NULL, reminder_triggered_at=NULL, updated_at=$2
         WHERE repeat_series_id=$1 AND completed=0 AND id<>(SELECT id FROM notes
           WHERE repeat_series_id=$1 ORDER BY repeat_occurrence_at DESC, id DESC LIMIT 1)`,
        [series.id, nowIso]
      );
    } else {
      const result = await db.execute(
        `INSERT OR IGNORE INTO notes (content, title, details, category_id, priority, scheduled_at,
         repeat_series_id, repeat_occurrence_at, reminder_enabled, reminder_at,
         reminder_offset_minutes, created_at, updated_at, sort_order)
         VALUES ($1,$1,$2,$3,$4,$5,$6,$5,$7,$8,$9,$10,$10,
           (SELECT COALESCE(MAX(sort_order),0)+10 FROM notes WHERE completed=0 AND pinned=0))`,
        [series.title, series.details, series.categoryId, series.priority, latest, series.id,
          series.defaultReminderEnabled ? 1 : 0,
          reminderAt, 0, nowIso]
      );
      changed = result.rowsAffected;
    }
    await db.execute(
        `UPDATE repeat_series SET generated_occurrences=$1, next_occurrence_at=$2,
         active=$3, updated_at=$4 WHERE id=$5`,
        [processed, next, active ? 1 : 0, nowIso, series.id]
    );
    if (changed > 0) generated += 1;
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

/** Calculates calendar-only occurrences without writing generated notes to SQLite. */
export function calculateOccurrencesInRange(series: RepeatSeries, rangeStart: Date, rangeEnd: Date): string[] {
  const first = new Date(series.startAt);
  if (Number.isNaN(first.getTime()) || rangeEnd <= rangeStart || first >= rangeEnd) return [];
  if (series.repeatType === "daily") return calculateDailyOccurrencesInRange(series, first, rangeStart, rangeEnd);
  const occurrences: string[] = [];
  let current = first;
  let occurrenceCount = 1;
  for (let guard = 0; guard < 50_000 && current < rangeEnd; guard += 1) {
    if (current >= rangeStart) occurrences.push(current.toISOString());
    if (series.endType === "count" && series.maxOccurrences != null && occurrenceCount >= series.maxOccurrences) break;
    const nextValue = calculateNextOccurrence({ ...series, generatedOccurrences: occurrenceCount }, current);
    if (!nextValue) break;
    const next = new Date(nextValue);
    if (Number.isNaN(next.getTime()) || next <= current) break;
    current = next;
    occurrenceCount += 1;
  }
  return occurrences;
}

function calculateDailyOccurrencesInRange(
  series: RepeatSeries,
  first: Date,
  rangeStart: Date,
  rangeEnd: Date
) {
  const interval = Math.max(1, series.repeatInterval);
  const firstDay = Date.UTC(first.getFullYear(), first.getMonth(), first.getDate());
  const rangeDay = Date.UTC(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
  let index = Math.max(0, Math.floor((rangeDay - firstDay) / 86_400_000 / interval));
  let current = new Date(first);
  current.setDate(current.getDate() + index * interval);
  if (current < rangeStart) {
    index += 1;
    current = new Date(first);
    current.setDate(current.getDate() + index * interval);
  }

  const occurrences: string[] = [];
  const end = series.endType === "date" && series.endDate
    ? new Date(`${series.endDate}T23:59:59.999`)
    : null;
  while (current < rangeEnd) {
    if (series.endType === "count" && series.maxOccurrences != null && index >= series.maxOccurrences) break;
    if (end && current > end) break;
    occurrences.push(current.toISOString());
    index += 1;
    current = new Date(first);
    current.setDate(current.getDate() + index * interval);
  }
  return occurrences;
}

function nextDaily(after: Date, start: Date, interval: number) {
  if (after < start) return new Date(start);
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const afterDay = Date.UTC(after.getFullYear(), after.getMonth(), after.getDate());
  const elapsedDays = Math.max(0, Math.floor((afterDay - startDay) / 86_400_000));
  const steps = Math.floor(elapsedDays / interval) + 1;
  const candidate = new Date(start);
  candidate.setDate(candidate.getDate() + steps * interval);
  // The calendar-day calculation above is DST-safe; this final guard covers an
  // `after` value later on the same occurrence day.
  if (candidate <= after) candidate.setDate(candidate.getDate() + interval);
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

function generationTime(occurrenceAt: string) {
  return new Date(occurrenceAt);
}

export function repeatReminderAt(occurrenceAt: string, enabled: boolean, time?: string | null) {
  if (!enabled) return null;
  const occurrence = new Date(occurrenceAt);
  if (Number.isNaN(occurrence.getTime())) return null;
  const [hour, minute] = normalizeReminderTime(time).split(":").map(Number);
  const date = new Date(occurrence.getFullYear(), occurrence.getMonth(), occurrence.getDate(), hour, minute, 0, 0);
  return date.toISOString();
}

function initialRepeatReminderAt(
  occurrenceAt: string, enabled: boolean, time: string | null, now: Date
) {
  const reminderAt = repeatReminderAt(occurrenceAt, enabled, time);
  return reminderAt && new Date(reminderAt) > now ? reminderAt : null;
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
      initialRepeatReminderAt(occurrenceAt, series.defaultReminderEnabled, series.defaultReminderTime, new Date(createdAt)),
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
