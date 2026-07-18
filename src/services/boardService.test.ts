import { beforeEach, describe, expect, it, vi } from "vitest";

const db = { select: vi.fn(), execute: vi.fn() };
vi.mock("./database", () => ({ getDatabase: vi.fn(async () => db) }));

import { moveBoardNote, setBoardNoteCompleted } from "./boardService";

const columns = [
  { id: "todo", name: "待处理", sort_order: 10, type: "system", status: "todo", created_at: "2026-07-18", updated_at: "2026-07-18" },
  { id: "doing", name: "进行中", sort_order: 20, type: "custom", status: "doing", created_at: "2026-07-18", updated_at: "2026-07-18" },
  { id: "completed", name: "已完成", sort_order: 30, type: "system", status: "completed", created_at: "2026-07-18", updated_at: "2026-07-18" }
];

describe("board note persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.execute.mockResolvedValue({ rowsAffected: 1 });
  });

  it("moving into completed updates column, status, completion and ordering together", async () => {
    db.select.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM board_columns")) return columns;
      if (sql.includes("SELECT board_column_id, completed")) return [{ board_column_id: "doing", completed: 0 }];
      if (sql.includes("SELECT id FROM notes WHERE board_column_id")) return [{ id: 11 }];
      return [];
    });

    await moveBoardNote(7, "completed", 11, "before");

    const placement = db.execute.mock.calls.find(([sql]) => sql.includes("UPDATE notes SET board_column_id"));
    expect(placement?.[1]).toEqual(["completed", "completed", 1, expect.any(String), "doing", 7]);
    const order = db.execute.mock.calls.find(([sql]) => sql.includes("SET board_order"));
    expect(order?.[1]).toEqual([7, 10, 11, 20, 7, 11]);
  });

  it("unchecking a completed note restores its previous column", async () => {
    db.select.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT board_column_id, previous_board_column_id")) {
        return [{ board_column_id: "completed", previous_board_column_id: "doing" }];
      }
      if (sql.includes("FROM board_columns")) return columns;
      if (sql.includes("SELECT board_column_id, completed")) return [{ board_column_id: "completed", completed: 1 }];
      if (sql.includes("SELECT id FROM notes WHERE board_column_id")) return [];
      return [];
    });

    await setBoardNoteCompleted(7, false);

    const placement = db.execute.mock.calls.find(([sql]) => sql.includes("UPDATE notes SET board_column_id"));
    expect(placement?.[1]).toEqual(["doing", "doing", 0, expect.any(String), null, 7]);
  });
});

