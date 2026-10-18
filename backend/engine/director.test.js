import assert from "node:assert/strict";
import test from "node:test";

import { advanceDirector, evaluateSettlement } from "./director.js";
import { createInitialState } from "./state.js";
import { getScript } from "../scripts/loader.js";

function settledState(scriptId = "handong") {
  const state = createInitialState("方案", { scriptId, now: 1 });
  state.metric.value = state.metric.target;
  if (state.metric.key === "rangeKm") state.rangeKm = state.metric.target;
  return state;
}

test("结算在预算超限时不通过", () => {
  const state = settledState();
  state.budget.used = state.budget.limit + 1;
  assert.deepEqual(evaluateSettlement(state).checks, { budget: false, schedule: true, metric: true, range: true });
  assert.equal(evaluateSettlement(state).passed, false);
});

test("结算在工期超限时不通过", () => {
  const state = settledState();
  state.schedule.used = state.schedule.limit + 1;
  assert.equal(evaluateSettlement(state).checks.schedule, false);
  assert.equal(evaluateSettlement(state).passed, false);
});

test("结算在指标未达时不通过", () => {
  const state = settledState();
  state.rangeKm = state.metric.target - 1;
  assert.equal(evaluateSettlement(state).checks.metric, false);
  assert.equal(evaluateSettlement(state).passed, false);
});

test("预算、工期、指标全部满足才能通过", () => {
  const result = evaluateSettlement(settledState());
  assert.equal(result.passed, true);
  assert.equal(result.canRestart, false);
});

test("direction=max 时值不高于目标才通过", () => {
  const state = settledState("gaowen");
  state.metric.value = state.metric.target;
  assert.equal(evaluateSettlement(state).passed, true);
  state.metric.value += 0.1;
  assert.equal(evaluateSettlement(state).checks.metric, false);
});

test("rangeKm 指标优先使用 rangeKm 字段", () => {
  const state = settledState();
  state.metric.value = 0;
  state.rangeKm = state.metric.target;
  assert.equal(evaluateSettlement(state).passed, true);
});

test("第一幕三旗标齐全时进入第二幕", () => {
  const state = settledState();
  state.flags.problemClarified = state.flags.budgetClarified = state.flags.scheduleClarified = true;
  const events = advanceDirector(state, { now: 10 });
  assert.equal(state.currentAct, 2);
  assert.deepEqual(events[0].data, { fromAct: 1, toAct: 2, reason: "constraints_ready" });
});

test("第一幕超时时进入第二幕", () => {
  const state = settledState();
  const events = advanceDirector(state, { now: getScript().acts[0].durationMs + 1 });
  assert.equal(state.currentAct, 2);
  assert.equal(events[0].data.reason, "timeout");
  assert.equal(events[1].type, "dm_intervention");
  assert.equal(events[1].data.scoreImpact, "none");
});

test("第二幕交方案时进入第三幕", () => {
  const state = settledState(); state.currentAct = 2; state.actStartedAt = 1;
  const events = advanceDirector(state, { now: 2, action: { payload: { phrase: "交方案" } } });
  assert.equal(state.currentAct, 3);
  assert.equal(events[0].data.reason, "submitted");
});

test("第二幕超时时进入第三幕", () => {
  const state = settledState(); state.currentAct = 2; state.actStartedAt = 1;
  const events = advanceDirector(state, { now: getScript().acts[1].durationMs + 2 });
  assert.equal(state.currentAct, 3);
  assert.equal(events[0].data.reason, "research_timeout");
  assert.equal(events[1].type, "dm_intervention");
});

test("第三幕 settle 动作触发结算", () => {
  const state = settledState(); state.currentAct = 3;
  const events = advanceDirector(state, { action: { type: "settle" } });
  assert.equal(state.settled, true);
  assert.equal(events[0].type, "game_settled");
});

test("条件不满足时不转幕也不产生事件", () => {
  const state = settledState();
  assert.deepEqual(advanceDirector(state, { now: 2, action: { type: "ask" } }), []);
  assert.equal(state.currentAct, 1);
});
