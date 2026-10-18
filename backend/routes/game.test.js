import assert from "node:assert/strict";
import test from "node:test";

import gameRouter from "./game.js";

async function request(method, path, { body, query } = {}) {
  const layer = gameRouter.stack.find((item) => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `未找到 ${method.toUpperCase()} ${path}`);
  const response = { status: 200, body: undefined };
  const res = { status(code) { response.status = code; return this; }, json(payload) { response.body = payload; return this; } };
  await layer.route.stack[0].handle({ body, query, get: () => undefined }, res);
  return response;
}

test("POST /new 创建对局且 NPC 只暴露展示字段", async () => {
  const result = await request("post", "/new", { body: { role: "方案" } });
  assert.equal(result.status, 201);
  assert.ok(result.body.gameId);
  assert.deepEqual(Object.keys(result.body.script.npcs[0]).sort(), ["id", "identity", "name"]);
});

test("POST /new 对非法岗位返回 400", async () => {
  const result = await request("post", "/new", { body: { role: "坏岗位" } });
  assert.equal(result.status, 400);
});

test("GET /scripts 返回剧本列表", async () => {
  const result = await request("get", "/scripts");
  assert.equal(result.status, 200);
  assert.ok(result.body.scripts.some((script) => script.id === "handong"));
});

test("POST /action 对非法 action 返回 400", async () => {
  const game = await request("post", "/new", { body: { role: "方案" } });
  const result = await request("post", "/action", { body: { gameId: game.body.gameId } });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /action.type/);
});

test("POST /action 对未知 gameId 返回 404", async () => {
  const result = await request("post", "/action", { body: { gameId: "missing", type: "ask" } });
  assert.equal(result.status, 404);
});

test("GET /state 对未知 gameId 返回 404", async () => {
  const result = await request("get", "/state", { query: { gameId: "missing" } });
  assert.equal(result.status, 404);
});

test("POST /review 返回复盘基本结构", async () => {
  const game = await request("post", "/new", { body: { role: "方案" } });
  const result = await request("post", "/review", { body: { gameId: game.body.gameId, dimensions: [] } });
  assert.equal(result.status, 200);
  assert.ok("timeline" in result.body);
  assert.ok("curves" in result.body);
  assert.ok("dimensions" in result.body);
});
