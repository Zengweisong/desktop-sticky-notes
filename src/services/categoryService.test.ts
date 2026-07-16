import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  select: vi.fn(),
  execute: vi.fn()
};

vi.mock("./database", () => ({ getDatabase: vi.fn(async () => db) }));

import { deleteCategory, moveCategory } from "./categoryService";

describe("categoryService pooled database writes", () => {
  beforeEach(() => {
    db.select.mockReset();
    db.execute.mockReset();
    db.execute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 });
  });

  it("deletes a category without opening a cross-invocation transaction", async () => {
    db.select
      .mockResolvedValueOnce([{ is_system: 0 }])
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([{ id: 1 }]);

    await deleteCategory(9, { type: "uncategorized" });

    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(db.execute.mock.calls.map(([sql]) => sql)).toEqual([
      expect.stringContaining("UPDATE notes"),
      expect.stringContaining("DELETE FROM categories")
    ]);
    expect(db.execute.mock.calls.flat().join(" ")).not.toMatch(/BEGIN|COMMIT|ROLLBACK/);
  });

  it("swaps category order in one atomic update", async () => {
    db.select.mockResolvedValueOnce([
      { id: 1, name: "未分类", color: "#999999", icon: null, sort_order: 0, created_at: "", is_system: 1 },
      { id: 2, name: "工作", color: "#4488cc", icon: null, sort_order: 10, created_at: "", is_system: 0 },
      { id: 3, name: "学习", color: "#8855cc", icon: null, sort_order: 20, created_at: "", is_system: 0 }
    ]);

    await moveCategory(2, 1);

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.execute).toHaveBeenCalledWith(expect.stringContaining("CASE id"), [2, 20, 3, 10]);
  });
});
