import assert from "node:assert/strict";
import test from "node:test";

import { RUBRIC, suggestScores } from "./rubric.js";
import { createInitialState } from "./state.js";

test("量规权重合计为 100，档位覆盖 0—100", () => {
  assert.equal(RUBRIC.dimensions.reduce((total, item) => total + item.weight, 0), 100);
  assert.deepEqual(RUBRIC.bands.map(({ min, max }) => [min, max]), [[85, 100], [70, 84], [50, 69], [0, 49]]);
});

test("量规示例不包含锂电池专用表述", () => {
  const examples = RUBRIC.dimensions.flatMap((item) => item.bands.map((band) => band.observableExample)).join(" ");
  assert.doesNotMatch(examples, /内阻|有效容量/);
});

test("建议评分返回合法档位和可追溯证据", () => {
  const state = createInitialState("方案");
  state.flags.problemClarified = true;
  state.flags.budgetClarified = true;
  state.flags.scheduleClarified = true;
  state.flags.workshopVisited = true;
  state.unlockedInformation.push("冬季续航里程、氢耗、加氢能力和保温条件");
  state.behaviorRecords.push({ type: "ask", targetNpc: "wang_manager", contentSummary: "确认甲方冬季续航目标和加氢安排" });
  state.decisionHistory.push(
    { type: "visit_workshop", payload: { contentSummary: "核实保温和加热条件" } },
    { type: "choose_preheat", payload: { contentSummary: "按续航、氢耗和加氢事实选择预热" } },
    { type: "submit_plan", payload: { contentSummary: "甲方确认续航目标；方案含保温、预算、工期、监测和风险预案" } },
  );
  const scores = suggestScores(state);
  assert.equal(scores.length, 6);
  for (const score of scores) {
    assert.match(score.band, /^[ABCD]$/);
    assert.ok(score.score >= 0 && score.score <= 100);
    assert.ok(score.evidence.length > 0);
  }
});
