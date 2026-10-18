import assert from "node:assert/strict";
import test from "node:test";

import { createInitialState, getOpeningData } from "./state.js";
import { getScript } from "../scripts/loader.js";

test("非法岗位会被拒绝", () => {
  assert.throws(() => createInitialState("不存在的岗位"), /岗位必须是/);
});

test("初始约束和信任度来自剧本规则", () => {
  const script = getScript("gaowen");
  const state = createInitialState("测试", { scriptId: script.id });
  assert.deepEqual({ budget: state.budget.limit, schedule: state.schedule.limit, trust: state.clientTrust }, {
    budget: script.rules.budgetLimit, schedule: script.rules.scheduleLimit, trust: script.rules.clientTrust,
  });
});

test("未指定 gameId 的新局各自唯一，所有旗标初始为 false", () => {
  const first = createInitialState("方案");
  const second = createInitialState("方案");
  assert.notEqual(first.gameId, second.gameId);
  assert.ok(Object.values(first.flags).every((value) => value === false || value === 0));
});

test("开场数据含岗位、已知信息和完整约束", () => {
  const state = createInitialState("测试", { scriptId: "gaowen" });
  const opening = getOpeningData(state);
  assert.deepEqual(opening.knownInformation, state.unlockedInformation);
  assert.deepEqual(opening.constraints, {
    budgetLimit: 120, scheduleLimit: 30,
    metric: { name: "货损率", unit: "%", target: 2, direction: "max" },
  });
  assert.equal(opening.role, "测试");
});
