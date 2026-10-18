import assert from "node:assert/strict";
import test from "node:test";

import { closeDatabase, initializeDatabase, loadGameState, saveGameState } from "./db.js";

test.afterEach(() => closeDatabase());

test("内存数据库初始化后含 schema_migrations 表", () => {
  const db = initializeDatabase(":memory:");
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get("schema_migrations").name, "schema_migrations");
});

test("数据库初始化在连接存活期间返回单例", () => {
  assert.strictEqual(initializeDatabase(":memory:"), initializeDatabase(":memory:"));
});

test("关闭数据库后可以重新初始化", () => {
  const first = initializeDatabase(":memory:");
  closeDatabase();
  const second = initializeDatabase(":memory:");
  assert.notStrictEqual(first, second);
  assert.equal(second.open, true);
});

test("游戏状态持久化接口目前是安全占位实现", () => {
  assert.equal(saveGameState("game", { any: "state" }), undefined);
  assert.equal(loadGameState("game"), undefined);
});
