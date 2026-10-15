import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

let database;

/**
 * 初始化 SQLite 连接与最小占位表。
 * 业务层以后只通过本模块访问数据，便于替换为 PostgreSQL。
 */
export function initializeDatabase(filename = process.env.DATABASE_PATH ?? "data/demo.db") {
  if (database) return database;

  // 文件型数据库启动前自动创建父目录，避免首次启动依赖手工准备目录。
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  }

  database = new Database(filename);
  database.pragma("journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  return database;
}

// 统一释放连接，供进程优雅退出。
export function closeDatabase() {
  if (!database) return;
  database.close();
  database = undefined;
}

/**
 * 游戏状态持久化预留接口。本步骤使用 routes/game.js 中的内存 Map，暂不落库。
 */
export function saveGameState(_gameId, _state) {
  // TODO: 后续迁移时在此实现 SQLite / PostgreSQL 持久化。
}

/** 游戏状态读取预留接口；持久化实现前统一返回空值。 */
export function loadGameState(_gameId) {
  // TODO: 后续迁移时在此读取已保存的对局状态。
  return undefined;
}
