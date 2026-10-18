import assert from "node:assert/strict";
import test from "node:test";

import { createInitialState } from "../engine/state.js";
import { renderRolePrompt } from "./roles.js";
import { renderDmPrompt } from "./dm.js";
import { filterStateFor, normalizeNpcId } from "./permissions.js";

test("未知 NPC 不能渲染角色提示词", () => {
  assert.throws(() => renderRolePrompt("missing", {}), /未知 NPC/);
});

test("角色提示词替换状态与可见信息占位符", () => {
  const prompt = renderRolePrompt("wang_manager", { stateSummary: "状态甲", visibleInfo: "可见乙" });
  assert.match(prompt, /状态甲/);
  assert.match(prompt, /可见乙/);
  assert.doesNotMatch(prompt, /\{state_summary\}|\{visible_info\}/);
});

test("worldInfo 仅在有值时注入", () => {
  const withInfo = renderRolePrompt("wang_manager", { worldInfo: "仅本轮背景" });
  const withoutInfo = renderRolePrompt("wang_manager");
  assert.match(withInfo, /按需背景信息.*仅本轮背景/s);
  assert.doesNotMatch(withoutInfo, /按需背景信息/);
});

test("事件上下文附带导演调度说话指令", () => {
  const prompt = renderRolePrompt("wang_manager", { eventContext: "client_pressure" });
  assert.match(prompt, /导演调度事件：client_pressure/);
  assert.match(prompt, /直接说一句推动剧情的话/);
});

test("导演提示词替换三个动态占位符", () => {
  const prompt = renderDmPrompt({ stateSummary: "S", trigger: "T", decisionSummary: "D" });
  assert.match(prompt, /S/); assert.match(prompt, /T/); assert.match(prompt, /D/);
  assert.doesNotMatch(prompt, /\{state_summary\}|\{trigger\}|\{decision_summary\}/);
});

test("NPC 别名归一化，未知 id 原样保留", () => {
  assert.equal(normalizeNpcId("王经理"), "wang_manager");
  assert.equal(normalizeNpcId("not-known"), "not-known");
});

test("NPC 状态过滤严格返回其白名单字段", () => {
  const state = createInitialState("测试", { scriptId: "gaowen" });
  const visible = filterStateFor("finance", state);
  assert.deepEqual(Object.keys(visible), ["budget"]);
  assert.deepEqual(visible.budget, state.budget);
});
