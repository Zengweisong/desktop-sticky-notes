import { getDatabase } from "./database";
import type { Category, CategoryDeleteStrategy, CategoryRow } from "../types/category";

function fromRow(row: CategoryRow): Category {
  return { id: row.id, name: row.name, color: row.color, icon: row.icon, sortOrder: row.sort_order, createdAt: row.created_at, isSystem: Boolean(row.is_system) };
}

export async function listCategories(): Promise<Category[]> {
  try {
    const rows = await (await getDatabase()).select<CategoryRow[]>("SELECT * FROM categories ORDER BY is_system DESC, sort_order ASC, created_at ASC");
    return rows.map(fromRow);
  } catch (error) { console.error("读取类别失败:", error); throw new Error("读取类别失败"); }
}

export async function createCategory(name: string, color: string): Promise<void> {
  const clean = name.trim();
  if (!clean) throw new Error("类别名称不能为空");
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error("类别颜色格式不正确");
  try {
    const db = await getDatabase();
    const order = await db.select<Array<{ next_order: number }>>("SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_order FROM categories");
    await db.execute("INSERT INTO categories (name, color, sort_order, created_at) VALUES ($1, $2, $3, $4)", [clean, color, order[0].next_order, new Date().toISOString()]);
  } catch (error) {
    console.error("新增类别失败:", error);
    if (String(error).toLowerCase().includes("unique")) throw new Error("类别名称已存在");
    throw new Error("新增类别失败");
  }
}

export async function updateCategory(id: number, name: string, color: string): Promise<void> {
  const clean = name.trim();
  if (!clean) throw new Error("类别名称不能为空");
  try {
    const result = await (await getDatabase()).execute("UPDATE categories SET name = $1, color = $2 WHERE id = $3 AND is_system = 0", [clean, color, id]);
    if (!result.rowsAffected) throw new Error("系统类别不能修改");
  } catch (error) { console.error("修改类别失败:", error); throw error instanceof Error ? error : new Error("修改类别失败"); }
}

export async function moveCategory(id: number, direction: -1 | 1): Promise<void> {
  const db = await getDatabase();
  const categories = (await listCategories()).filter((category) => !category.isSystem);
  const index = categories.findIndex((category) => category.id === id);
  const target = categories[index + direction];
  if (index < 0 || !target) return;
  try {
    await db.execute(
      "UPDATE categories SET sort_order = CASE id WHEN $1 THEN $2 WHEN $3 THEN $4 END WHERE id IN ($1, $3)",
      [id, target.sortOrder, target.id, categories[index].sortOrder]
    );
  } catch (error) {
    console.error("调整类别顺序失败:", error); throw new Error("调整类别顺序失败");
  }
}

export async function countNotesInCategory(id: number): Promise<number> {
  const rows = await (await getDatabase()).select<Array<{ count: number }>>("SELECT COUNT(*) AS count FROM notes WHERE category_id = $1", [id]);
  return rows[0]?.count || 0;
}

export async function deleteCategory(id: number, strategy: CategoryDeleteStrategy): Promise<void> {
  const db = await getDatabase();
  const targetRows = await db.select<Array<{ is_system: number }>>("SELECT is_system FROM categories WHERE id = $1", [id]);
  if (!targetRows.length) return;
  if (targetRows[0].is_system) throw new Error("未分类是系统类别，不能删除");
  try {
    if (strategy.type === "delete-notes") {
      await db.execute("DELETE FROM notes WHERE category_id = $1", [id]);
    } else {
      const targetId = strategy.type === "move" ? strategy.targetCategoryId :
        (await db.select<Array<{ id: number }>>("SELECT id FROM categories WHERE is_system = 1 ORDER BY id LIMIT 1"))[0]?.id;
      if (targetId == null) throw new Error("找不到用于接收事项的类别");
      if (targetId === id) throw new Error("不能移动到正在删除的类别");
      const destination = await db.select<Array<{ id: number }>>("SELECT id FROM categories WHERE id = $1", [targetId]);
      if (!destination.length) throw new Error("目标类别不存在");
      await db.execute("UPDATE notes SET category_id = $1, updated_at = $2 WHERE category_id = $3", [targetId, new Date().toISOString(), id]);
    }
    const result = await db.execute("DELETE FROM categories WHERE id = $1 AND is_system = 0", [id]);
    if (!result.rowsAffected) throw new Error("类别不存在或不能删除");
  } catch (error) {
    console.error("删除类别失败:", error); throw error instanceof Error ? error : new Error("删除类别失败");
  }
}
