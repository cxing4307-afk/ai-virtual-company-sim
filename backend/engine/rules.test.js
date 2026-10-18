import assert from "node:assert/strict";
import test from "node:test";

import { EVENT_TYPES } from "./events.js";
import { applyAction } from "./rules.js";
import { createInitialState } from "./state.js";
import { getScript } from "../scripts/loader.js";

const NOW = Date.UTC(2026, 0, 1);
const SCRIPT_ID = "handong";

function createState() {
  return createInitialState("方案", { now: NOW, scriptId: SCRIPT_ID });
}

test("空 action 或缺少 type 会被拒绝", () => {
  const state = createState();
  assert.throws(() => applyAction(state), /action.type 不能为空/);
  assert.throws(() => applyAction(state, {}), /action.type 不能为空/);
});

test("已结算的对局不能继续行动", () => {
  const state = createState();
  state.settled = true;

  assert.throws(() => applyAction(state, { type: "ask" }), /本局已结算/);
});

test("ask 可分别澄清问题、预算和工期", () => {
  for (const [topic, flag] of [["problem", "problemClarified"], ["budget", "budgetClarified"], ["schedule", "scheduleClarified"]]) {
    const state = createState();
    applyAction(state, { type: "ask", payload: { topic } }, { now: NOW });
    assert.equal(state.flags[flag], true, `topic=${topic} 应设置 ${flag}`);
  }
});

test("未知行动累计无效回合，并在同一阈值只提醒一次", () => {
  const state = createState();
  const threshold = getScript(SCRIPT_ID).rules.ineffectiveTurnThreshold;

  for (let turn = 1; turn < threshold; turn += 1) {
    const { events } = applyAction(state, { type: `unknown_${turn}` }, { now: NOW });
    assert.equal(events.some((event) => event.type === EVENT_TYPES.DIRECTOR_REMINDER), false);
  }
  const { events } = applyAction(state, { type: `unknown_${threshold}` }, { now: NOW });
  assert.equal(state.ineffectiveTurns, threshold);
  assert.equal(events.filter((event) => event.type === EVENT_TYPES.DIRECTOR_REMINDER).length, 1);
  assert.equal(state.flags.directorReminderTriggeredAt, threshold);

  const alreadyReminded = createState();
  alreadyReminded.ineffectiveTurns = threshold - 1;
  alreadyReminded.flags.directorReminderTriggeredAt = threshold;
  const repeated = applyAction(alreadyReminded, { type: "unknown_repeat" }, { now: NOW });
  assert.equal(repeated.events.some((event) => event.type === EVENT_TYPES.DIRECTOR_REMINDER), false);
});

test("有效行动会清零无效回合计数", () => {
  const state = createState();
  state.ineffectiveTurns = 2;

  applyAction(state, { type: "clarify_problem" }, { now: NOW });
  assert.equal(state.ineffectiveTurns, 0);
});

test("特殊行动解锁信息，重复执行不重复累计", () => {
  const state = createState();
  const special = getScript(SCRIPT_ID).specialActions[0];
  const before = { budget: state.budget.used, schedule: state.schedule.used };

  applyAction(state, { type: special.action }, { now: NOW });
  assert.equal(state.flags[special.flag], true);
  assert.ok(state.unlockedInformation.includes(special.information));
  assert.equal(state.budget.used, before.budget);
  assert.equal(state.schedule.used, before.schedule);

  applyAction(state, { type: special.action }, { now: NOW });
  assert.equal(state.unlockedInformation.filter((item) => item === special.information).length, 1);
  assert.equal(state.budget.used, before.budget);
  assert.equal(state.schedule.used, before.schedule);
});

test("超工期只触发一次客户施压", () => {
  const state = createState();
  const route = getScript(SCRIPT_ID).routes[0];
  state.schedule.used = state.schedule.limit;

  const first = applyAction(state, { type: route.action }, { now: NOW });
  assert.equal(first.events.filter((event) => event.type === EVENT_TYPES.CLIENT_PRESSURE).length, 1);
  assert.equal(state.flags.clientPressureTriggered, true);

  const second = applyAction(state, { type: "clarify_problem" }, { now: NOW });
  assert.equal(second.events.some((event) => event.type === EVENT_TYPES.CLIENT_PRESSURE), false);
});

test("财务警告只触发一次", () => {
  const state = createState();
  state.budget.used = state.budget.limit + 1;

  const first = applyAction(state, { type: "clarify_problem" }, { now: NOW });
  assert.equal(first.events.filter((event) => event.type === EVENT_TYPES.FINANCE_WARNING).length, 1);
  assert.equal(state.flags.financeWarningTriggered, true);

  const second = applyAction(state, { type: "clarify_budget" }, { now: NOW });
  assert.equal(second.events.some((event) => event.type === EVENT_TYPES.FINANCE_WARNING), false);
});

test("每次行动都会追加包含时间、幕数和资源数值的快照", () => {
  const state = createState();
  const later = NOW + 1_000;

  applyAction(state, { type: "clarify_problem" }, { now: later });
  assert.equal(state.stateSnapshots.length, 1);
  assert.deepEqual(state.stateSnapshots[0], {
    time: new Date(later).toISOString(), act: 1, budgetUsed: 0, scheduleUsed: 0, metric: state.metric.value,
  });
});

test("每次行动都会记录决策和行为", () => {
  const state = createState();
  const action = { type: "ask", payload: { topic: "problem", targetNpc: "wang", contentSummary: "确认故障" } };

  applyAction(state, action, { now: NOW });
  assert.equal(state.decisionHistory.length, 1);
  assert.deepEqual(state.decisionHistory[0], { time: new Date(NOW).toISOString(), act: 1, type: "ask", payload: action.payload });
  assert.equal(state.behaviorRecords.length, 1);
  assert.deepEqual(state.behaviorRecords[0], { time: new Date(NOW).toISOString(), type: "ask", targetNpc: "wang", contentSummary: "确认故障" });
});
