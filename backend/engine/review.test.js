import assert from "node:assert/strict";
import test from "node:test";

import { buildReview } from "./review.js";
import { applyAction } from "./rules.js";
import { createInitialState } from "./state.js";

test("复盘按动作前后快照组装时间线、曲线和前六条关键对话", () => {
  const state = createInitialState("方案", { now: Date.UTC(2026, 0, 1), gameId: "review-1" });
  for (let index = 1; index <= 7; index += 1) {
    applyAction(state, { type: "dialog", payload: { targetNpc: "wang_manager", contentSummary: `关键对话 ${index}` } }, { now: Date.UTC(2026, 0, 1, 0, index) });
  }
  applyAction(state, { type: "choose_preheat", payload: { contentSummary: "采用预热" } }, { now: Date.UTC(2026, 0, 1, 0, 8) });

  const dimensions = [{ name: "问题定位", level: "待改进", text: "没有先定位主因。" }];
  const review = buildReview(state, dimensions);

  assert.equal(review.timeline.length, 8);
  assert.deepEqual(review.dialogs.map((record) => record.contentSummary), ["关键对话 1", "关键对话 2", "关键对话 3", "关键对话 4", "关键对话 5", "关键对话 6"]);
  assert.equal(review.curves.at(0).metric, 220);
  assert.equal(review.curves.at(-1).budgetUsed, 90);
  assert.equal(review.curves.at(-1).metric, 340);
  assert.match(review.directorComment, /问题定位维度待改进/);
  assert.deepEqual(review.dimensions, dimensions);
});
