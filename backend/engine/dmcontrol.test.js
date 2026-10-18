import assert from "node:assert/strict";
import test from "node:test";

import { canRollback, checkTimeBudget, classifyFailure, DEFAULT_DM_CONFIG, detectOffTopic } from "./dmcontrol.js";
import { EVENT_TYPES } from "./events.js";

const rounds = (...text) => text.map((item) => typeof item === "string" ? { text: item, isEffective: false } : item);
const timedState = (overrides = {}) => ({ currentAct: 1, actStartedAt: 0, createdAt: 0, ...overrides });

test("单条无关内容触发一级拉回，两条升级为二级", () => {
  assert.equal(detectOffTopic(rounds("今天天气怎样")).level, 1);
  assert.equal(detectOffTopic(rounds("聊聊明星", "我想玩游戏")).level, 2);
});

test("拉回后窗口内仍有两条无关内容升级为三级", () => {
  assert.equal(detectOffTopic(rounds("聊明星", "继续任务", "玩游戏"), { afterPullback: true }).level, 3);
  assert.equal(detectOffTopic(rounds("聊明星", "继续任务"), { afterPullback: true }).level, 1);
});

test("新约束、信息不足、纠错和证据请求均被豁免", () => {
  for (const text of ["我提出一个新约束", "当前信息不足", "纠错：这个数字不对", "请给出证据来源"]) {
    assert.deepEqual(detectOffTopic(rounds(text)), { level: 0, reason: "protected_signal", exempt: true });
  }
});

test("求解释和确认规则属于 help_requested，不计跑题", () => {
  for (const text of ["这是什么意思", "请解释一下", "我想确认规则"]) {
    assert.deepEqual(detectOffTopic(rounds("聊明星", text)), { level: 0, reason: "help_requested", exempt: true });
  }
});

test("一条有效行为立即清零", () => {
  const result = detectOffTopic(rounds("天气", "玩游戏", { text: "提交判断", isEffective: true }), { afterPullback: true });
  assert.deepEqual(result, { level: 0, reason: "effective_action_reset", exempt: false });
});

test("窗口外无关轮次不参与计数", () => {
  assert.equal(detectOffTopic(rounds("天气", "游戏", "任务判断", "执行动作"), { offTopicWindow: 2 }).level, 0);
});

test("同一主张无新信息重复时触发结构化决策提示", () => {
  const result = detectOffTopic(rounds("应该降价", "应该降价"));
  assert.equal(result.level, 2);
  assert.equal(result.reason, "repeated_claim_structure_prompt");
});

test("包含新证据的文本不按重复主张处理", () => {
  assert.equal(detectOffTopic(rounds("新证据显示成本上涨", "新证据显示成本上涨")).level, 0);
});

test("拒绝任务或索取答案触发转化式提示", () => {
  assert.equal(detectOffTopic(rounds("我拒绝执行这个任务")).reason, "conversion_prompt");
  assert.equal(detectOffTopic(rounds("直接告诉我答案")).reason, "conversion_prompt");
});

test("关键节点未完成及 DM 提示后连续两轮未响应可确定判定", () => {
  assert.equal(detectOffTopic(rounds("还没完成"), { keyNode: true, currentTaskComplete: false }).reason, "incomplete_task_at_key_node");
  assert.equal(detectOffTopic(rounds("继续", "继续"), { dmPrompted: true }).reason, "two_turns_without_response_to_dm");
});

test("软阈值提醒且不扣分，幕预算到点触发转幕事件", () => {
  const soft = checkTimeBudget(timedState(), { acts: [{}, {}, {}] }, 8 * 60_000);
  assert.equal(soft.actSoftWarn, true);
  assert.equal(soft.events[0].data.scoreImpact, "none");
  const timeout = checkTimeBudget(timedState(), { acts: [{}, {}, {}] }, 10 * 60_000);
  assert.equal(timeout.actTimeout, true);
  assert.equal(timeout.events.some((event) => event.type === EVENT_TYPES.ACT_ADVANCED), true);
});

test("38 分钟内容结算，45 分钟绝对结束", () => {
  const at38 = checkTimeBudget(timedState({ currentAct: 3, actStartedAt: 37 * 60_000 }), { acts: [{}, {}, {}] }, 38 * 60_000);
  assert.equal(at38.contentEnd, true);
  assert.equal(at38.absoluteEnd, false);
  const at45 = checkTimeBudget(timedState({ currentAct: 3, actStartedAt: 44 * 60_000 }), { acts: [{}, {}, {}] }, 45 * 60_000);
  assert.equal(at45.absoluteEnd, true);
  assert.equal(at45.events.some((event) => event.data.trigger === "absolute_end"), true);
});

test("时间阈值可覆盖默认配置且默认配置值固定", () => {
  assert.deepEqual(DEFAULT_DM_CONFIG.actBudgetsMin, [10, 18, 10]);
  const result = checkTimeBudget(timedState(), { acts: [{}, {}, {}] }, 60_000, { actSoftMin: [1, 1, 1], actBudgetsMin: [2, 2, 2], contentEndMin: 3, absoluteEndMin: 4 });
  assert.equal(result.actSoftWarn, true);
  assert.equal(result.actTimeout, false);
});

test("失败判定覆盖方案被否和超时无方案", () => {
  assert.deepEqual(classifyFailure({ planRejected: true }), { type: "plan_rejected", needsTeacherReview: false, defaultOutcome: "review_closed" });
  assert.equal(classifyFailure({ timeoutNoPlan: true }).type, "timeout_no_plan");
});

test("失败判定覆盖预算失控和合规失败", () => {
  assert.equal(classifyFailure({ budget: { used: 11, limit: 10 } }).type, "budget_overrun");
  assert.deepEqual(classifyFailure({ fabricatedInventory: true }), { type: "compliance", needsTeacherReview: true, defaultOutcome: "review_closed" });
});

test("回档四项准入条件全部满足才允许", () => {
  const base = { currentAct: 2, createdAt: 0, errorExecuted: false, complianceRedLine: false };
  assert.deepEqual(canRollback(base, 39 * 60_000), { allowed: true, reason: "eligible" });
  assert.equal(canRollback({ ...base, currentAct: 3 }, 1).allowed, false);
  assert.equal(canRollback(base, 41 * 60_000).allowed, false);
  assert.equal(canRollback({ ...base, errorExecuted: true }, 1).allowed, false);
  assert.equal(canRollback({ ...base, complianceRedLine: true }, 1).allowed, false);
});

test("回档只能使用一次且五分钟边界可用", () => {
  const base = { currentAct: 2, createdAt: 0 };
  assert.equal(canRollback(base, 40 * 60_000).allowed, true);
  assert.deepEqual(canRollback({ ...base, rollbackUsed: true }, 1), { allowed: false, reason: "rollback_already_used" });
});
