import assert from "node:assert/strict";
import test from "node:test";

import gameRouter, { getGameState } from "./game.js";

/** 不监听端口，直接执行 Express 路由处理器。 */
async function post(path, body) {
  const layer = gameRouter.stack.find((item) => item.route?.path === path && item.route.methods.post);
  assert.ok(layer, `未找到 POST ${path}`);
  const response = { status: 200, body: undefined };
  const res = { status(code) { response.status = code; return this; }, json(payload) { response.body = payload; return this; } };
  await layer.route.stack[0].handle({ body }, res);
  return response;
}

async function newGame() { return post("/new", { role: "测试" }); }

test("教师复核评分返回含复核标记的六维结构", async () => {
  const game = await newGame();
  const result = await post("/teacher-review-score", { gameId: game.body.gameId });
  assert.equal(result.status, 200);
  assert.equal(result.body.dimensions.length, 6);
  assert.ok(result.body.dimensions.every((item) => typeof item.needsTeacherReview === "boolean"));
  assert.deepEqual(result.body.teacherReviews, {});
});

test("确认建议分会写入教师复核记录", async () => {
  const game = await newGame();
  const score = (await post("/teacher-review-score", { gameId: game.body.gameId })).body.dimensions[0];
  const result = await post("/teacher-review-confirm", { gameId: game.body.gameId, dimensionKey: score.key, action: "confirm", note: "证据充分" });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.teacherReview.action, "confirm");
  assert.equal(result.body.teacherReview.originalScore, score.score);
  assert.equal(result.body.teacherReview.finalScore, score.score);
  assert.equal(getGameState(game.body.gameId).teacherReviews[score.key].length, 1);
});

test("改分保留原建议分且多次复核保留全部历史", async () => {
  const game = await newGame();
  const score = (await post("/teacher-review-score", { gameId: game.body.gameId })).body.dimensions[0];
  await post("/teacher-review-confirm", { gameId: game.body.gameId, dimensionKey: score.key, action: "adjust", score: 88, note: "教师调整" });
  await post("/teacher-review-confirm", { gameId: game.body.gameId, dimensionKey: score.key, action: "confirm" });
  const history = getGameState(game.body.gameId).teacherReviews[score.key];
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((item) => [item.originalScore, item.finalScore]), [[score.score, 88], [score.score, score.score]]);
  assert.equal((await post("/teacher-review-score", { gameId: game.body.gameId })).body.dimensions[0].score, score.score);
});

test("教师复核参数非法返回 400", async () => {
  const game = await newGame();
  const result = await post("/teacher-review-confirm", { gameId: game.body.gameId, dimensionKey: "problem_location", action: "adjust", score: 101 });
  assert.equal(result.status, 400);
});

test("不存在的 gameId 返回 404", async () => {
  const result = await post("/teacher-review-score", { gameId: "missing-game" });
  assert.equal(result.status, 404);
});
