import { getDatabase } from "./database";
import type { ExportPayloadV2, ExportPayloadV3, Category, CategoryRow } from "../types/category";
import type { ExportPayloadV1, Note, NoteInput, NotePriority, NoteRow, NoteUpdate } from "../types/note";
import { listCategories } from "./categoryService";
import { ReminderService } from "./reminderService";
import { createRepeatSeries, deleteRepeatSeries, listRepeatSeries, setRepeatSeriesActive, stopRepeatSeries, updateRepeatSeries } from "./repeatTaskService";
import type { RepeatSeries } from "../types/repeat";

const SELECT_FIELDS = `id, title, content, details, category_id, completed, pinned, priority,
  created_at, updated_at, completed_at, due_at, sort_order, scheduled_at, repeat_series_id,
  repeat_occurrence_at, reminder_enabled, reminder_at, reminder_offset_minutes, reminder_triggered_at`;
const ORDER_BY = `ORDER BY CASE WHEN completed = 0 AND pinned = 1 THEN 0 WHEN completed = 0 THEN 1 ELSE 2 END,
  sort_order DESC, created_at DESC`;

function fromRow(row: NoteRow): Note {
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
    repeatSeriesId: row.repeat_series_id ?? null,
    repeatOccurrenceAt: row.repeat_occurrence_at ?? null,
    reminderEnabled: Boolean(row.reminder_enabled),
    reminderAt: row.reminder_at ?? null,
    reminderOffsetMinutes: row.reminder_offset_minutes ?? 0,
    reminderTriggeredAt: row.reminder_triggered_at ?? null
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
    const db = await getDatabase();
    return (await db.select<NoteRow[]>(`SELECT ${SELECT_FIELDS} FROM notes ${ORDER_BY}`)).map(fromRow);
  } catch (error) {
    console.error("读取事项失败:", error);
    throw new Error("读取事项失败");
  }
}

export async function createNote(input: NoteInput): Promise<Note> {
  const title = input.title.trim();
  if (!title) throw new Error("事项标题不能为空");
  try {
    const reminderAt = await ReminderService.scheduleReminder(input);
    const db = await getDatabase();
    const now = new Date().toISOString();
    const categoryId = await resolveCategoryId(input.categoryId);
    if (input.repeatEnabled) {
      const created = await createRepeatSeries(input, categoryId);
      const rows = await db.select<NoteRow[]>(`SELECT ${SELECT_FIELDS} FROM notes WHERE id = $1`, [created.noteId]);
      return fromRow(rows[0]);
    }
    const order = await db.select<Array<{ next_order: number }>>(
      "SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_order FROM notes WHERE completed = 0 AND pinned = 0"
    );
    const result = await db.execute(
      `INSERT INTO notes
        (content, title, details, category_id, priority, due_at, scheduled_at, reminder_enabled,
         reminder_at, reminder_offset_minutes, created_at, updated_at, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12)`,
      [title, title, input.details?.trim() || null, categoryId, input.priority || "normal", input.dueAt || null,
        input.scheduledAt || null, input.reminderEnabled ? 1 : 0, reminderAt,
        input.reminderOffsetMinutes || 0, now, order[0].next_order]
    );
    const rows = await db.select<NoteRow[]>(`SELECT ${SELECT_FIELDS} FROM notes WHERE id = $1`, [result.lastInsertId]);
    return fromRow(rows[0]);
  } catch (error) {
    console.error("添加事项失败:", error);
    throw error instanceof Error ? error : new Error("添加事项失败");
  }
}

export async function updateNote(id: number, input: NoteUpdate): Promise<void> {
  const title = input.title.trim();
  if (!title) throw new Error("事项标题不能为空");
  try {
    const db = await getDatabase();
    const currentRows = await db.select<NoteRow[]>(`SELECT ${SELECT_FIELDS} FROM notes WHERE id = $1`, [id]);
    if (!currentRows.length) throw new Error("事项不存在");
    const current = fromRow(currentRows[0]);
    const computedReminderAt = input.reminderEnabled
      ? await ReminderService.updateReminder(id, input)
      : (await ReminderService.cancelReminder(id), null);
    const categoryId = await resolveCategoryId(input.categoryId);
    if (input.repeatEnabled) {
      if (current.repeatSeriesId != null) {
        if (input.repeatEditScope !== "occurrence") {
          await updateRepeatSeries(current.repeatSeriesId, input, categoryId, db);
        }
      } else await createRepeatSeries(input, categoryId, id, db, false);
    } else if (current.repeatSeriesId != null) {
      if (input.repeatEditScope === "occurrence") {
        await db.execute(
          "UPDATE notes SET repeat_series_id=NULL, repeat_occurrence_at=NULL WHERE id=$1", [id]
        );
      } else await stopRepeatSeries(current.repeatSeriesId, db, false);
    }
    await db.execute(
      `UPDATE notes SET content = $1, title = $1, details = $2, category_id = $3,
       priority = $4, due_at = $5, scheduled_at = $6,
       reminder_triggered_at = CASE
         WHEN reminder_enabled != $7 OR reminder_at IS NOT $8 THEN NULL ELSE reminder_triggered_at END,
       reminder_enabled = $7, reminder_at = $8, reminder_offset_minutes = $9,
       repeat_occurrence_at = CASE
         WHEN repeat_series_id IS NULL THEN NULL
         WHEN $10 = 'occurrence' THEN repeat_occurrence_at ELSE $6 END,
       updated_at = $11 WHERE id = $12`,
      [title, input.details?.trim() || null, categoryId, input.priority || "normal", input.dueAt || null,
        input.scheduledAt || null, input.reminderEnabled ? 1 : 0, computedReminderAt,
        input.reminderOffsetMinutes || 0, input.repeatEditScope || "series", new Date().toISOString(), id]
    );
  } catch (error) {
    console.error("编辑事项失败:", error);
    throw error instanceof Error ? error : new Error("保存编辑失败");
  }
}

export async function setNoteCompleted(id: number, completed: boolean): Promise<void> {
  try {
    if (completed) await ReminderService.cancelReminder(id);
    const now = new Date().toISOString();
    await (await getDatabase()).execute(
      "UPDATE notes SET completed = $1, completed_at = $2, updated_at = $3 WHERE id = $4",
      [completed ? 1 : 0, completed ? now : null, now, id]
    );
  } catch (error) { console.error("更新完成状态失败:", error); throw new Error("更新状态失败"); }
}

export async function setNotePinned(id: number, pinned: boolean): Promise<void> {
  try {
    await (await getDatabase()).execute("UPDATE notes SET pinned = $1, updated_at = $2 WHERE id = $3", [pinned ? 1 : 0, new Date().toISOString(), id]);
  } catch (error) { console.error("更新置顶状态失败:", error); throw new Error("更新置顶失败"); }
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
  const [notes, categories, repeatSeries] = await Promise.all([listNotes(), listCategories(), listRepeatSeries()]);
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
    typeof series.defaultReminderOffsetMinutes === "number" && typeof series.active === "boolean");
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
          note.scheduledAt ?? null, note.reminderEnabled ?? false, note.reminderAt ?? null,
          note.reminderOffsetMinutes ?? 0, note.reminderTriggeredAt ?? null,
          seriesMap.get(note.repeatSeriesId || -1) || null, note.repeatOccurrenceAt ?? null);
      }
    } else {
      for (const note of value.notes) {
        await insertImportedNote(db, note.content, null, fallbackId, note.completed, note.pinned, "normal",
          note.createdAt, note.updatedAt, note.completedAt, null, note.sortOrder, null, false, null, 0, null, null, null);
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
  scheduledAt: string | null, reminderEnabled: boolean, reminderAt: string | null,
  reminderOffsetMinutes: number, reminderTriggeredAt: string | null,
  repeatSeriesId: number | null, repeatOccurrenceAt: string | null
) {
  await db.execute(
    `INSERT INTO notes (content, title, details, category_id, completed, pinned, priority,
      created_at, updated_at, completed_at, due_at, sort_order, scheduled_at, reminder_enabled,
      reminder_at, reminder_offset_minutes, reminder_triggered_at, repeat_series_id, repeat_occurrence_at)
     VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [title.trim(), details, categoryId, completed ? 1 : 0, pinned ? 1 : 0, priority,
      createdAt, updatedAt, completedAt, dueAt, sortOrder, scheduledAt, reminderEnabled ? 1 : 0,
      reminderAt, reminderOffsetMinutes, reminderTriggeredAt, repeatSeriesId, repeatOccurrenceAt]
  );
}

async function insertImportedSeries(
  db: Awaited<ReturnType<typeof getDatabase>>, series: RepeatSeries, categoryId: number
) {
  const result = await db.execute(
    `INSERT INTO repeat_series (title, details, category_id, priority, repeat_type, repeat_interval,
     repeat_weekdays, repeat_month_day, start_at, end_type, end_date, max_occurrences,
     generated_occurrences, default_reminder_enabled, default_reminder_offset_minutes,
     next_occurrence_at, active, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [series.title.trim(), series.details, categoryId, series.priority, series.repeatType,
      series.repeatInterval, series.repeatWeekdays.join(",") || null, series.repeatMonthDay,
      series.startAt, series.endType, series.endDate, series.maxOccurrences,
      series.generatedOccurrences, series.defaultReminderEnabled ? 1 : 0,
      series.defaultReminderOffsetMinutes, series.nextOccurrenceAt, series.active ? 1 : 0,
      series.createdAt, series.updatedAt]
  );
  return Number(result.lastInsertId);
}

export type { Category, CategoryRow };
