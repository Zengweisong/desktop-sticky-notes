import Database from "@tauri-apps/plugin-sql";

let databasePromise: Promise<Database> | null = null;

export function getDatabase(): Promise<Database> {
  if (!databasePromise) {
    databasePromise = Database.load("sqlite:desktop-notes.db").catch((error) => {
      databasePromise = null;
      console.error("SQLite 初始化失败:", error);
      throw new Error("无法打开本地数据库");
    });
  }
  return databasePromise;
}

export async function initializeDatabase(): Promise<void> {
  await getDatabase();
}
