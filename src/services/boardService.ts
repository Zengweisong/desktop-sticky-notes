import { getDatabase } from "./database";
import {
  COMPLETED_COLUMN_ID,
  DOING_COLUMN_ID,
  TODO_COLUMN_ID,
  type BoardColumn,
  type BoardColumnRow
} from "../types/board";

const PROTECTED_COLUMNS = new Set([TODO_COLUMN_ID, COMPLETED_COLUMN_ID]);

function fromRow(row: BoardColumnRow): BoardColumn {
  return {
    id: row.id,
    name: row.name,
    order: row.sort_order,
    type: row.type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function ensureBoardPlacement(): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `UPDATE notes SET
       board_column_id = CASE WHEN completed = 1 THEN $1 ELSE $2 END,
       status = CASE WHEN completed = 1 THEN 'completed' ELSE 'todo' END,
       board_order = CASE WHEN board_order = 0 THEN sort_order ELSE board_order END
     WHERE board_column_id IS NULL
        OR board_column_id NOT IN (SELECT id FROM board_columns)`,
    [COMPLETED_COLUMN_ID, TODO_COLUMN_ID]
  );
}

export async function listBoardColumns(): Promise<BoardColumn[]> {
  try {
    const db = await getDatabase();
    const rows = await db.select<BoardColumnRow[]>(
      "SELECT id, name, sort_order, type, status, created_at, updated_at FROM board_columns ORDER BY sort_order, created_at"
    );
    return rows.map(fromRow);
  } catch (error) {
    console.error("读取看板栏目失败:", error);
    throw new Error("读取看板栏目失败");
  }
}

export async function createBoardColumn(name: string): Promise<void> {
  const value = columnName(name);
  const db = await getDatabase();
  const now = new Date().toISOString();
  const orders = await db.select<Array<{ next_order: number }>>(
    "SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_order FROM board_columns"
  );
  const id = `column-${crypto.randomUUID()}`;
  try {
    await db.execute(
      `INSERT INTO board_columns (id, name, sort_order, type, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'custom', 'doing', $4, $4)`,
      [id, value, orders[0]?.next_order ?? 10, now]
    );
  } catch (error) {
    console.error("新增看板栏目失败:", error);
    throw new Error("新增栏目失败，请检查名称是否重复");
  }
}

export async function renameBoardColumn(id: string, name: string): Promise<void> {
  const value = columnName(name);
  const db = await getDatabase();
  const rows = await db.select<Array<{ type: string }>>("SELECT type FROM board_columns WHERE id = $1", [id]);
  if (!rows.length) throw new Error("栏目不存在");
  if (rows[0].type === "system") throw new Error("系统栏目不能重命名");
  await db.execute("UPDATE board_columns SET name = $1, updated_at = $2 WHERE id = $3", [value, new Date().toISOString(), id]);
}

export async function reorderBoardColumn(id: string, targetId: string, position: "before" | "after"): Promise<void> {
  if (id === targetId) return;
  const db = await getDatabase();
  const rows = await db.select<Array<{ id: string }>>("SELECT id FROM board_columns ORDER BY sort_order, created_at");
  const ids = rows.map((row) => row.id).filter((columnId) => columnId !== id);
  const targetIndex = ids.indexOf(targetId);
  if (targetIndex < 0 || !rows.some((row) => row.id === id)) throw new Error("栏目不存在");
  ids.splice(targetIndex + (position === "after" ? 1 : 0), 0, id);
  await updateOrders("board_columns", "sort_order", ids);
}

export async function deleteBoardColumn(id: string, moveToId?: string): Promise<void> {
  if (PROTECTED_COLUMNS.has(id)) throw new Error("待处理和已完成为系统栏目，不能删除");
  const db = await getDatabase();
  const columns = await listBoardColumns();
  const source = columns.find((column) => column.id === id);
  if (!source) throw new Error("栏目不存在");
  const noteRows = await db.select<Array<{ id: number }>>(
    "SELECT id FROM notes WHERE board_column_id = $1 ORDER BY board_order, created_at", [id]
  );
  if (noteRows.length) {
    const target = columns.find((column) => column.id === moveToId && column.id !== id);
    if (!target) throw new Error("请选择事项要移动到的栏目");
    const destination = await db.select<Array<{ id: number }>>(
      "SELECT id FROM notes WHERE board_column_id = $1 ORDER BY board_order, created_at", [target.id]
    );
    const now = new Date().toISOString();
    await db.execute(
      `UPDATE notes SET board_column_id = $1, status = $2, completed = $3,
       completed_at = CASE WHEN $3 = 1 THEN COALESCE(completed_at, $4) ELSE NULL END,
       previous_board_column_id = CASE WHEN $3 = 1 THEN $5 ELSE previous_board_column_id END,
       updated_at = $4 WHERE board_column_id = $6`,
      [target.id, target.status, target.status === "completed" ? 1 : 0, now,
        target.status === "completed" ? TODO_COLUMN_ID : null, id]
    );
    await updateNoteOrders([...destination.map((note) => note.id), ...noteRows.map((note) => note.id)]);
  }
  await db.execute("DELETE FROM board_columns WHERE id = $1", [id]);
}

export async function moveBoardNote(
  noteId: number,
  columnId: string,
  targetId: number | null,
  position: "before" | "after" = "after"
): Promise<void> {
  const db = await getDatabase();
  const [columns, sourceRows] = await Promise.all([
    listBoardColumns(),
    db.select<Array<{ board_column_id: string; completed: number }>>(
      "SELECT board_column_id, completed FROM notes WHERE id = $1", [noteId]
    )
  ]);
  const column = columns.find((item) => item.id === columnId);
  const source = sourceRows[0];
  if (!column || !source) throw new Error("事项或栏目不存在");
  const ordered = await db.select<Array<{ id: number }>>(
    "SELECT id FROM notes WHERE board_column_id = $1 ORDER BY board_order, created_at", [columnId]
  );
  const ids = ordered.map((note) => note.id).filter((id) => id !== noteId);
  const targetIndex = targetId == null ? -1 : ids.indexOf(targetId);
  const insertIndex = targetIndex < 0 ? ids.length : targetIndex + (position === "after" ? 1 : 0);
  ids.splice(insertIndex, 0, noteId);
  const now = new Date().toISOString();
  const completed = column.status === "completed";
  const previous = completed && source.board_column_id !== COMPLETED_COLUMN_ID
    ? source.board_column_id
    : null;
  await db.execute(
    `UPDATE notes SET board_column_id = $1, status = $2, completed = $3,
     completed_at = CASE WHEN $3 = 1 THEN COALESCE(completed_at, $4) ELSE NULL END,
     previous_board_column_id = CASE WHEN $5 IS NOT NULL THEN $5 ELSE previous_board_column_id END,
     updated_at = $4 WHERE id = $6`,
    [column.id, column.status, completed ? 1 : 0, now, previous, noteId]
  );
  await updateNoteOrders(ids);
}

export async function setBoardNoteCompleted(id: number, completed: boolean): Promise<void> {
  const db = await getDatabase();
  const rows = await db.select<Array<{ board_column_id: string; previous_board_column_id: string | null }>>(
    "SELECT board_column_id, previous_board_column_id FROM notes WHERE id = $1", [id]
  );
  if (!rows.length) throw new Error("事项不存在");
  const columns = await listBoardColumns();
  const current = rows[0];
  const targetId = completed
    ? COMPLETED_COLUMN_ID
    : columns.some((column) => column.id === current.previous_board_column_id && column.status !== "completed")
      ? current.previous_board_column_id!
      : TODO_COLUMN_ID;
  await moveBoardNote(id, targetId, null, "after");
}

async function updateNoteOrders(ids: number[]) {
  await updateOrders("notes", "board_order", ids);
}

async function updateOrders(table: "notes" | "board_columns", field: "board_order" | "sort_order", ids: Array<number | string>) {
  if (!ids.length) return;
  const db = await getDatabase();
  const cases = ids.map((_, index) => `WHEN $${index * 2 + 1} THEN $${index * 2 + 2}`).join(" ");
  const placeholders = ids.map((_, index) => `$${ids.length * 2 + index + 1}`).join(", ");
  const values = ids.flatMap((id, index) => [id, (index + 1) * 10]);
  await db.execute(
    `UPDATE ${table} SET ${field} = CASE id ${cases} END WHERE id IN (${placeholders})`,
    [...values, ...ids]
  );
}

function columnName(name: string) {
  const value = name.trim();
  if (!value) throw new Error("栏目名称不能为空");
  if (value.length > 30) throw new Error("栏目名称不能超过 30 个字符");
  return value;
}
