import { getDatabase } from "./database";
import type { ExportPayloadV2, ExportPayloadV3, Category, CategoryRow } from "../types/category";
import type { ExportPayloadV1, Note, NoteInput, NotePriority, NoteRow, NoteUpdate } from "../types/note";
import { listCategories } from "./categoryService";
import { ReminderService } from "./reminderService";
import { createRepeatSeries, deleteRepeatSeries, getRepeatSeries, listRepeatSeries, repeatReminderAt, restoreRepeatSeries, setRepeatSeriesActive, stopRepeatSeries, updateRepeatSeries, withRepeatSeriesMutation } from "./repeatTaskService";
import type { RepeatSeries } from "../types/repeat";
import { ensureBoardPlacement, setBoardNoteCompleted } from "./boardService";
import { COMPLETED_COLUMN_ID, TODO_COLUMN_ID } from "../types/board";
import { normalizedSchedule, schedulePartsFromIso, scheduledAtFromParts } from "./noteDateService";
import { collapseRepeatSeriesNotes } from "./noteFilterService";

const SELECT_FIELDS = `id, title, content, details, category_id, completed, pinned, priority,
  created_at, updated_at, completed_at, due_at, sort_order, scheduled_at, scheduled_date, scheduled_time,
  is_all_day, repeat_series_id,
  repeat_occurrence_at, reminder_enabled, reminder_at, reminder_offset_minutes, reminder_triggered_at,
  board_column_id, board_order, status, previous_board_column_id`;
const ORDER_BY = `ORDER BY CASE WHEN completed = 0 AND pinned = 1 THEN 0 WHEN completed = 0 THEN 1 ELSE 2 END,
  sort_order DESC, created_at DESC`;

function fromRow(row: NoteRow): Note {
  const legacySchedule = schedulePartsFromIso(row.scheduled_at);
  const scheduledDate = row.scheduled_date ?? legacySchedule.date;
  const scheduledTime = row.scheduled_time === undefined
    ? (row.repeat_series_id == null && !row.is_all_day ? legacySchedule.time : null)
    : row.scheduled_time;
  return {
    id: row.id,
    title: (row.title || row.content).trim(),
    details: row.details,
    categoryId: row.category_id,
    completed: Boolean(row.completed),
    pinned: Boolean(row.pinned),
    priority: row.priority || "normal",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    dueAt: row.due_at,
    sortOrder: row.sort_order,
    scheduledAt: row.scheduled_at ?? null,
    scheduledDate,
    scheduledTime,
    repeatSeriesId: row.repeat_series_id ?? null,
    repeatOccurrenceAt: row.repeat_occurrence_at ?? null,
    reminderEnabled: Boolean(row.reminder_enabled),
    reminderAt: row.reminder_at ?? null,
    reminderOffsetMinutes: row.reminder_offset_minutes ?? 0,
    reminderTriggeredAt: row.reminder_triggered_at ?? null,
    boardColumnId: row.board_column_id || (row.completed ? COMPLETED_COLUMN_ID : TODO_COLUMN_ID),
    boardOrder: row.board_order ?? row.sort_order,
    status: row.status || (row.completed ? "completed" : "todo"),
    previousBoardColumnId: row.previous_board_column_id ?? null
  };
}

async function resolveCategoryId(categoryId?: number | null): Promise<number> {
  const db = await getDatabase();
  if (categoryId != null) {
    const rows = await db.select<Array<{ id: number }>>("SELECT id FROM categories WHERE id = $1", [categoryId]);
    if (rows.length) return categoryId;
  }
  const fallback = await db.select<Array<{ id: number }>>("SELECT id FROM categories WHERE is_system = 1 ORDER BY id LIMIT 1");
  if (!fallback.length) throw new Error("未找到默认类别");
  return fallback[0].id;
}

export async function listNotes(): Promise<Note[]> {
  try {
    return collapseRepeatSeriesNotes(await listAllNotes());
  } catch (error) {
    console.error("读取事项失败:", error);
    throw new Error("读取事项失败");
  }
}

async function listAllNotes(): Promise<Note[]> {
  const db = await getDatabase();
  await ensureBoardPlacement();
  return (await db.select<NoteRow[]>(`SELECT ${SELECT_FIELDS} FROM notes ${ORDER_BY}`)).map(fromRow);
}

export async function createNote(input: NoteInput): Promise<Note> {
  const title = input.title.trim();
  if (!title) throw new Error("事项标题不能为空");
  try {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const categoryId = await resolveCategoryId(input.categoryId);
    const boardColumnId = input.boardColumnId || TODO_COLUMN_ID;
    const boardStatus = boardColumnId === COMPLETED_COLUMN_ID ? "completed" : boardColumnId === TODO_COLUMN_ID ? "todo" : "doing";
    if (input.repeatEnabled) {
      const created = await createRepeatSeries(input, categoryId);
      await db.execute(
        `UPDATE notes SET board_column_id=$1, status=$2, completed=$3,
         completed_at=CASE WHEN $3=1 THEN $4 ELSE NULL END WHERE id=$5`,
        [boardColumnId, boardStatus, boardStatus === "completed" ? 1 : 0, now, created.noteId]
      );
      const rows = await db.select<NoteRow[]>(`SELECT ${SELECT_FIELDS} FROM notes WHERE id = $1`, [created.noteId]);
      return fromRow(rows[0]);
    }
    const schedule = normalizedSchedule(input);
    const normalizedInput = { ...input, ...schedule };
    const reminderAt = await ReminderService.scheduleReminder(normalizedInput);
    const order = await db.select<Array<{ next_order: number }>>(
      "SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_order FROM notes WHERE completed = 0 AND pinned = 0"
    );
    const result = await db.execute(
      `INSERT INTO notes
        (content, title, details, category_id, priority, scheduled_at, scheduled_date, scheduled_time,
         reminder_enabled, reminder_at, reminder_offset_minutes, created_at, updated_at, sort_order,
         board_column_id, board_order, status, completed, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $13, $14, $13, $15, $16, $17)`,
      [title, title, input.details?.trim() || null, categoryId, input.priority || "normal",
        schedule.scheduledAt, schedule.scheduledDate, schedule.scheduledTime,
        input.reminderEnabled ? 1 : 0, reminderAt,
        input.reminderOffsetMinutes ?? 10, now, order[0].next_order, boardColumnId, boardStatus,
        boardStatus === "completed" ? 1 : 0, boardStatus === "completed" ? now : null]
    );
    const rows = await db.select<NoteRow[]>(`SELECT ${SELECT_FIELDS} FROM notes WHERE id = $1`, [result.lastInsertId]);
    return fromRow(rows[0]);
  } catch (error) {
    console.error("添加事项失败:", error);
    throw error instanceof Error ? error : new Error("添加事项失败");
  }
}

export function updateNote(id: number, input: NoteUpdate): Promise<void> {
  return input.repeatEnabled
    ? withRepeatSeriesMutation(() => updateNoteUnlocked(id, input))
    : updateNoteUnlocked(id, input);
}

async function updateNoteUnlocked(id: number, input: NoteUpdate): Promise<void> {
  const title = input.title.trim();
  if (!title) throw new Error("事项标题不能为空");
  try {
    const db = await getDatabase();
    const currentRows = await db.select<NoteRow[]>(`SELECT ${SELECT_FIELDS} FROM notes WHERE id = $1`, [id]);
    if (!currentRows.length) throw new Error("事项不存在");
    const current = fromRow(currentRows[0]);
    const categoryId = await resolveCategoryId(input.categoryId);
    const requestedSchedule = normalizedSchedule(input);
    let scheduledAt = requestedSchedule.scheduledAt;
    let scheduledDate = requestedSchedule.scheduledDate;
    let scheduledTime = requestedSchedule.scheduledTime;
    let reminderEnabled = Boolean(input.reminderEnabled);
    let reminderOffsetMinutes = input.reminderOffsetMinutes ?? 10;
    let computedReminderAt: string | null = null;
    let seriesBeforeEdit: RepeatSeries | null = null;
    if (input.repeatEnabled) {
      let seriesId = current.repeatSeriesId;
      if (current.repeatSeriesId != null) {
        seriesBeforeEdit = await getRepeatSeries(current.repeatSeriesId, db);
        if (!seriesBeforeEdit) throw new Error("重复系列不存在");
        if (input.repeatEditScope !== "occurrence") {
          await updateRepeatSeries(current.repeatSeriesId, input, categoryId, db);
        }
      } else {
        const created = await createRepeatSeries(input, categoryId, id, db);
        seriesId = created.seriesId;
      }
      const series = seriesBeforeEdit || (seriesId == null ? null : await getRepeatSeries(seriesId, db));
      scheduledAt = current.repeatSeriesId == null
        ? series?.startAt || scheduledAt
        : current.repeatOccurrenceAt || current.scheduledAt;
      scheduledDate = schedulePartsFromIso(scheduledAt).date;
      scheduledTime = null;
      reminderEnabled = input.repeatReminderEnabled ?? series?.defaultReminderEnabled ?? true;
      const repeatReminderTime = input.repeatReminderTime || series?.defaultReminderTime || "09:00";
      computedReminderAt = scheduledAt ? repeatReminderAt(scheduledAt, reminderEnabled, repeatReminderTime) : null;
      reminderOffsetMinutes = 0;
    } else if (current.repeatSeriesId != null) {
      if (input.repeatEditScope === "occurrence") {
        await db.execute(
          "UPDATE notes SET repeat_series_id=NULL, repeat_occurrence_at=NULL WHERE id=$1", [id]
        );
      } else await stopRepeatSeries(current.repeatSeriesId, db);
      computedReminderAt = reminderEnabled
        ? await ReminderService.updateReminder(id, { ...input, scheduledAt, scheduledDate, scheduledTime })
        : (await ReminderService.cancelReminder(id), null);
    } else {
      computedReminderAt = reminderEnabled
        ? await ReminderService.updateReminder(id, { ...input, scheduledAt, scheduledDate, scheduledTime })
        : (await ReminderService.cancelReminder(id), null);
    }
    try {
      await db.execute(
        `UPDATE notes SET content = $1, title = $1, details = $2, category_id = $3,
         priority = $4, scheduled_at = $5, scheduled_date = $6, scheduled_time = $7,
         reminder_triggered_at = CASE
           WHEN reminder_enabled != $8 OR reminder_at IS NOT $9 THEN NULL ELSE reminder_triggered_at END,
         reminder_enabled = $8, reminder_at = $9, reminder_offset_minutes = $10,
         repeat_occurrence_at = CASE
           WHEN repeat_series_id IS NULL THEN NULL
           WHEN $11 = 'occurrence' THEN repeat_occurrence_at ELSE $5 END,
         updated_at = $12 WHERE id = $13`,
        [title, input.details?.trim() || null, categoryId, input.priority || "normal",
          scheduledAt, scheduledDate, scheduledTime, reminderEnabled ? 1 : 0, computedReminderAt,
          reminderOffsetMinutes, input.repeatEditScope || "series", new Date().toISOString(), id]
      );
    } catch (error) {
      if (seriesBeforeEdit && input.repeatEditScope !== "occurrence") {
        try { await restoreRepeatSeries(seriesBeforeEdit, db); }
        catch (restoreError) { console.error("恢复重复系列失败:", restoreError); }
      }
      throw error;
    }
    if (input.repeatEnabled) await ReminderService.cancelReminder(id);
  } catch (error) {
    console.error("编辑事项失败:", error);
    throw error instanceof Error ? error : new Error("保存编辑失败");
  }
}

export async function setNoteCompleted(id: number, completed: boolean): Promise<void> {
  try {
    if (completed) await ReminderService.cancelReminder(id);
    await setBoardNoteCompleted(id, completed);
  } catch (error) { console.error("更新完成状态失败:", error); throw new Error("更新状态失败"); }
}

export async function setNotePinned(id: number, pinned: boolean): Promise<void> {
  try {
    await (await getDatabase()).execute("UPDATE notes SET pinned = $1, updated_at = $2 WHERE id = $3", [pinned ? 1 : 0, new Date().toISOString(), id]);
  } catch (error) { console.error("更新置顶状态失败:", error); throw new Error("更新置顶失败"); }
}

export async function rescheduleNote(id: number, scheduledDate: string | null): Promise<void> {
  const db = await getDatabase();
  const rows = await db.select<NoteRow[]>(`SELECT ${SELECT_FIELDS} FROM notes WHERE id = $1`, [id]);
  if (!rows.length) throw new Error("事项不存在");
  const current = fromRow(rows[0]);
  if (current.repeatSeriesId != null) throw new Error("重复事项需要在详情中选择修改范围");

  const schedule = normalizedSchedule({
    scheduledDate,
    scheduledTime: scheduledDate ? current.scheduledTime : null
  });
  if (scheduledDate !== null && schedule.scheduledDate === null) throw new Error("事项日期无效");
  const targetDate = schedule.scheduledDate;
  let reminderEnabled = current.reminderEnabled;
  let reminderAt: string | null = current.reminderAt;
  if (!targetDate) {
    reminderEnabled = false;
    reminderAt = null;
  } else if (current.reminderEnabled && schedule.scheduledAt) {
    reminderAt = ReminderService.calculateReminderAt(
      schedule.scheduledAt,
      current.reminderOffsetMinutes
    );
  } else if (current.reminderEnabled && current.reminderAt) {
    const reminderTime = schedulePartsFromIso(current.reminderAt).time;
    reminderAt = scheduledAtFromParts(targetDate, reminderTime);
  }

  await db.execute(
    `UPDATE notes SET scheduled_at=$1, scheduled_date=$2, scheduled_time=$3,
     reminder_enabled=$4, reminder_at=$5,
     reminder_triggered_at=CASE WHEN reminder_at IS NOT $5 THEN NULL ELSE reminder_triggered_at END,
     updated_at=$6 WHERE id=$7`,
    [schedule.scheduledAt, schedule.scheduledDate, schedule.scheduledTime,
      reminderEnabled ? 1 : 0, reminderAt, new Date().toISOString(), id]
  );
  await ReminderService.cancelReminder(id);
}

export async function setRepeatActive(seriesId: number, active: boolean): Promise<void> {
  try { await setRepeatSeriesActive(seriesId, active); }
  catch (error) {
    console.error("更新重复系列状态失败:", error);
    throw error instanceof Error ? error : new Error("更新重复系列状态失败");
  }
}

export async function moveNote(id: number, targetId: number, position: "before" | "after"): Promise<void> {
  if (id === targetId) return;
  const db = await getDatabase();
  try {
    const pair = await db.select<Array<{ id: number; completed: number; pinned: number }>>(
      "SELECT id, completed, pinned FROM notes WHERE id IN ($1, $2)", [id, targetId]
    );
    const source = pair.find((note) => note.id === id);
    const target = pair.find((note) => note.id === targetId);
    if (!source || !target || noteGroup(source) !== noteGroup(target)) {
      throw new Error("只能在同一事项分组内调整顺序");
    }

    const where = source.completed ? "completed = 1" : source.pinned ? "completed = 0 AND pinned = 1" : "completed = 0 AND pinned = 0";
    const ordered = await db.select<Array<{ id: number }>>(
      `SELECT id FROM notes WHERE ${where} ORDER BY sort_order DESC, created_at DESC`
    );
    const ids = ordered.map((note) => note.id).filter((noteId) => noteId !== id);
    const targetIndex = ids.indexOf(targetId);
    if (targetIndex < 0) return;
    ids.splice(targetIndex + (position === "after" ? 1 : 0), 0, id);

    const cases = ids.map((_, index) => `WHEN $${index * 2 + 1} THEN $${index * 2 + 2}`).join(" ");
    const idPlaceholders = ids.map((_, index) => `$${ids.length * 2 + index + 1}`).join(", ");
    const values = ids.flatMap((noteId, index) => [noteId, (ids.length - index) * 10]);
    await db.execute(
      `UPDATE notes SET sort_order = CASE id ${cases} END WHERE id IN (${idPlaceholders})`,
      [...values, ...ids]
    );
  } catch (error) {
    console.error("调整事项顺序失败:", error);
    throw error instanceof Error ? error : new Error("调整顺序失败");
  }
}

function noteGroup(note: { completed: number; pinned: number }) {
  return note.completed ? "completed" : note.pinned ? "pinned" : "active";
}

export async function deleteNote(id: number, scope: "occurrence" | "series" = "occurrence"): Promise<void> {
  try {
    const db = await getDatabase();
    const rows = await db.select<Array<{ repeat_series_id: number | null }>>("SELECT repeat_series_id FROM notes WHERE id=$1", [id]);
    await ReminderService.cancelReminder(id);
    if (scope === "series" && rows[0]?.repeat_series_id != null) await deleteRepeatSeries(rows[0].repeat_series_id);
    else await db.execute("DELETE FROM notes WHERE id = $1", [id]);
  }
  catch (error) { console.error("删除事项失败:", error); throw new Error("删除事项失败"); }
}

export async function clearCompletedNotes(): Promise<void> {
  try {
    const db = await getDatabase();
    const rows = await db.select<Array<{ id: number }>>("SELECT id FROM notes WHERE completed = 1");
    await Promise.all(rows.map((row) => ReminderService.cancelReminder(row.id)));
    await db.execute("DELETE FROM notes WHERE completed = 1");
  }
  catch (error) { console.error("清空已完成事项失败:", error); throw new Error("清空失败"); }
}

export async function exportNotes(): Promise<ExportPayloadV3> {
  const [notes, categories, repeatSeries] = await Promise.all([listAllNotes(), listCategories(), listRepeatSeries()]);
  return { version: 3, exportedAt: new Date().toISOString(), notes, categories, repeatSeries };
}

function isPriority(value: unknown): value is NotePriority { return value === "low" || value === "normal" || value === "high"; }

function isV1(value: unknown): value is ExportPayloadV1 {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<ExportPayloadV1>;
  return data.version === 1 && Array.isArray(data.notes) && data.notes.every((note) =>
    note && typeof note.content === "string" && Boolean(note.content.trim()) &&
    typeof note.completed === "boolean" && typeof note.pinned === "boolean" &&
    typeof note.createdAt === "string" && typeof note.updatedAt === "string" &&
    (note.completedAt === null || typeof note.completedAt === "string") && typeof note.sortOrder === "number"
  );
}

function isV2(value: unknown): value is ExportPayloadV2 {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<ExportPayloadV2>;
  return data.version === 2 && Array.isArray(data.categories) && Array.isArray(data.notes) &&
    data.categories.every((category) => category && Number.isInteger(category.id) && Boolean(category.name?.trim()) &&
      /^#[0-9a-f]{6}$/i.test(category.color) && (category.icon === null || typeof category.icon === "string") &&
      typeof category.sortOrder === "number" && typeof category.createdAt === "string" && typeof category.isSystem === "boolean") &&
    data.notes.every((note) => note && Boolean(note.title?.trim()) && typeof note.completed === "boolean" &&
      typeof note.pinned === "boolean" && isPriority(note.priority) && typeof note.createdAt === "string" &&
      typeof note.updatedAt === "string" && (note.details === null || typeof note.details === "string") &&
      (note.categoryId === null || typeof note.categoryId === "number") &&
      (note.completedAt === null || typeof note.completedAt === "string") &&
      (note.dueAt === null || typeof note.dueAt === "string") && typeof note.sortOrder === "number");
}

function isV3(value: unknown): value is ExportPayloadV3 {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<ExportPayloadV3>;
  const baseIsValid = isV2({ ...data, version: 2 });
  return data.version === 3 && baseIsValid && Array.isArray(data.repeatSeries) && data.repeatSeries.every((series) =>
    series && Number.isInteger(series.id) && Boolean(series.title?.trim()) &&
    ["daily", "weekdays", "weekly", "monthly", "yearly"].includes(series.repeatType) &&
    Number.isInteger(series.repeatInterval) && series.repeatInterval > 0 && Array.isArray(series.repeatWeekdays) &&
    ["never", "date", "count"].includes(series.endType) && typeof series.startAt === "string" &&
    typeof series.generatedOccurrences === "number" && typeof series.defaultReminderEnabled === "boolean" &&
    typeof series.defaultReminderOffsetMinutes === "number" &&
    (series.defaultReminderTime == null || /^([01]\d|2[0-3]):[0-5]\d$/.test(series.defaultReminderTime)) &&
    typeof series.active === "boolean");
}

export async function importNotes(value: unknown): Promise<void> {
  if (!isV1(value) && !isV2(value) && !isV3(value)) throw new Error("导入文件格式不正确");
  const db = await getDatabase();
  try {
    await db.execute("BEGIN IMMEDIATE");
    const fallbackId = await resolveCategoryId(null);
    const categoryMap = new Map<number, number>();
    const seriesMap = new Map<number, number>();

    await db.execute("DELETE FROM notes");
    await db.execute("DELETE FROM repeat_series");
    if (isV2(value) || isV3(value)) {
      await db.execute("DELETE FROM categories WHERE is_system = 0");
      for (const category of value.categories) {
        if (category.isSystem || category.name === "未分类") { categoryMap.set(category.id, fallbackId); continue; }
        const result = await db.execute(
          "INSERT INTO categories (name, color, icon, sort_order, created_at, is_system) VALUES ($1, $2, $3, $4, $5, 0)",
          [category.name.trim(), category.color, category.icon, category.sortOrder, category.createdAt]
        );
        categoryMap.set(category.id, Number(result.lastInsertId));
      }
      if (isV3(value)) {
        for (const series of value.repeatSeries) {
          const newId = await insertImportedSeries(db, series, categoryMap.get(series.categoryId || -1) || fallbackId);
          seriesMap.set(series.id, newId);
        }
      }
      for (const note of value.notes) {
        await insertImportedNote(db, note.title, note.details, categoryMap.get(note.categoryId || -1) || fallbackId,
          note.completed, note.pinned, note.priority, note.createdAt, note.updatedAt, note.completedAt, note.dueAt, note.sortOrder,
          note.scheduledAt ?? null, note.scheduledDate ?? null, note.scheduledTime ?? null,
          note.reminderEnabled ?? false, note.reminderAt ?? null,
          note.reminderOffsetMinutes ?? 0, note.reminderTriggeredAt ?? null,
          seriesMap.get(note.repeatSeriesId || -1) || null, note.repeatOccurrenceAt ?? null);
      }
    } else {
      for (const note of value.notes) {
        await insertImportedNote(db, note.content, null, fallbackId, note.completed, note.pinned, "normal",
          note.createdAt, note.updatedAt, note.completedAt, null, note.sortOrder, null, null, null,
          false, null, 0, null, null, null);
      }
    }
    await db.execute("COMMIT");
  } catch (error) {
    try { await db.execute("ROLLBACK"); } catch (rollbackError) { console.error("导入回滚失败:", rollbackError); }
    console.error("导入事项失败:", error);
    throw error instanceof Error ? error : new Error("导入失败");
  }
}

async function insertImportedNote(
  db: Awaited<ReturnType<typeof getDatabase>>, title: string, details: string | null, categoryId: number,
  completed: boolean, pinned: boolean, priority: NotePriority, createdAt: string, updatedAt: string,
  completedAt: string | null, dueAt: string | null, sortOrder: number,
  scheduledAt: string | null, scheduledDate: string | null, scheduledTime: string | null,
  reminderEnabled: boolean, reminderAt: string | null,
  reminderOffsetMinutes: number, reminderTriggeredAt: string | null,
  repeatSeriesId: number | null, repeatOccurrenceAt: string | null
) {
  const schedule = normalizedSchedule({ scheduledAt, scheduledDate, scheduledTime });
  await db.execute(
    `INSERT INTO notes (content, title, details, category_id, completed, pinned, priority,
      created_at, updated_at, completed_at, due_at, sort_order, scheduled_at, scheduled_date,
      scheduled_time, reminder_enabled,
      reminder_at, reminder_offset_minutes, reminder_triggered_at, repeat_series_id, repeat_occurrence_at)
     VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
    [title.trim(), details, categoryId, completed ? 1 : 0, pinned ? 1 : 0, priority,
      createdAt, updatedAt, completedAt, dueAt, sortOrder, schedule.scheduledAt,
      schedule.scheduledDate, schedule.scheduledTime, reminderEnabled ? 1 : 0,
      reminderAt, reminderOffsetMinutes, reminderTriggeredAt, repeatSeriesId, repeatOccurrenceAt]
  );
}

async function insertImportedSeries(
  db: Awaited<ReturnType<typeof getDatabase>>, series: RepeatSeries, categoryId: number
) {
  const result = await db.execute(
    `INSERT INTO repeat_series (title, details, category_id, priority, repeat_type, repeat_interval,
     repeat_weekdays, repeat_month_day, start_at, end_type, end_date, max_occurrences,
     generated_occurrences, default_reminder_enabled, default_all_day_reminder_time,
     default_reminder_offset_minutes, next_occurrence_at, active, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [series.title.trim(), series.details, categoryId, series.priority, series.repeatType,
      series.repeatInterval, series.repeatWeekdays.join(",") || null, series.repeatMonthDay,
      series.startAt, series.endType, series.endDate, series.maxOccurrences,
      series.generatedOccurrences, series.defaultReminderEnabled ? 1 : 0,
      series.defaultReminderTime || legacyImportedReminderTime(series),
      series.defaultReminderOffsetMinutes, series.nextOccurrenceAt, series.active ? 1 : 0,
      series.createdAt, series.updatedAt]
  );
  return Number(result.lastInsertId);
}

function legacyImportedReminderTime(series: RepeatSeries) {
  if (!series.defaultReminderEnabled) return null;
  const start = new Date(series.startAt);
  if (Number.isNaN(start.getTime())) return "09:00";
  const reminder = new Date(start.getTime() - Math.max(0, series.defaultReminderOffsetMinutes || 0) * 60_000);
  return `${String(reminder.getHours()).padStart(2, "0")}:${String(reminder.getMinutes()).padStart(2, "0")}`;
}

export type { Category, CategoryRow };
