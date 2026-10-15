import assert from "node:assert/strict";
import test from "node:test";

import { evaluateSettlement } from "./director.js";
import { EVENT_TYPES } from "./events.js";
import { applyAction } from "./rules.js";
import { createInitialState } from "./state.js";

const NOW = Date.UTC(2026, 0, 1);

test("状态初始化正确", () => {
  const state = createInitialState("方案", { now: NOW, gameId: "game-1" });
  assert.equal(state.budget.limit, 120);
  assert.equal(state.budget.used, 0);
  assert.equal(state.schedule.limit, 30);
  assert.equal(state.rangeKm, 220);
  assert.equal(state.currentAct, 1);
  assert.deepEqual(state.unlockedInformation, ["投诉记录", "甲方通牒"]);
});

test("预热路线正确改变状态", () => {
  const state = createInitialState("测试", { now: NOW });
  applyAction(state, { type: "choose_preheat" }, { now: NOW });
  assert.equal(state.budget.used, 90);
  assert.equal(state.schedule.used, 20);
  assert.equal(state.rangeKm, 340);
  applyAction(state, { type: "choose_preheat" }, { now: NOW });
  assert.equal(state.budget.used, 90, "路线不可重复累计");
});

test("超预算触发财务警告", () => {
  const state = createInitialState("方案", { now: NOW });
  applyAction(state, { type: "choose_preheat" }, { now: NOW });
  const { events } = applyAction(state, { type: "choose_insulation" }, { now: NOW });
  assert.equal(state.budget.used, 135);
  assert.ok(events.some((event) => event.type === EVENT_TYPES.FINANCE_WARNING));
});

test("三幕按检查点推进", () => {
  const state = createInitialState("质检", { now: NOW });
  applyAction(state, { type: "clarify_problem" }, { now: NOW });
  applyAction(state, { type: "clarify_budget" }, { now: NOW });
  const first = applyAction(state, { type: "clarify_schedule" }, { now: NOW });
  assert.equal(state.currentAct, 2);
  assert.ok(first.events.some((event) => event.type === EVENT_TYPES.ACT_ADVANCED));
  applyAction(state, { type: "submit_plan" }, { now: NOW });
  assert.equal(state.currentAct, 3);
});

test("结算区分通关与不通关", () => {
  const passed = createInitialState("方案", { now: NOW });
  passed.budget.used = 120;
  passed.schedule.used = 30;
  passed.rangeKm = 300;
  assert.equal(evaluateSettlement(passed).passed, true);

  const failed = createInitialState("方案", { now: NOW });
  failed.rangeKm = 299;
  assert.equal(evaluateSettlement(failed).passed, false);
  assert.equal(evaluateSettlement(failed).canRestart, true);
});
