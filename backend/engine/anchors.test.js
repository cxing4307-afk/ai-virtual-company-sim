import assert from "node:assert/strict";
import test from "node:test";

import { suggestScores } from "./rubric.js";
import { getAnchors } from "../scripts/loader.js";

const ARRAY_FIELDS = ["keyFacts", "constraints", "decisionPoints", "planElements", "invalidBehaviors"];
const DIMENSIONS = new Set(["problem_location", "solution_completeness", "information_priority", "constraint_awareness", "client_management", "iteration"]);

test("两份评价锚点表满足结构、唯一性和维度约束", () => {
  for (const scriptId of ["handong", "gaowen"]) {
    const anchors = getAnchors(scriptId);
    assert.equal(anchors.scriptId, scriptId);
    assert.ok(anchors.version);
    const ids = [];
    for (const field of ARRAY_FIELDS) {
      assert.ok(Array.isArray(anchors[field]), `${scriptId}.${field} 应为数组`);
      for (const item of anchors[field]) {
        assert.ok(item.id?.trim());
        assert.ok(item.描述?.trim());
        assert.ok([1, 2, 3].includes(item.层级));
        ids.push(item.id);
        if (field !== "invalidBehaviors") {
          assert.ok(Array.isArray(item.keywords) && item.keywords.length > 0);
          assert.ok(Array.isArray(item.dimensions) && item.dimensions.length > 0);
          assert.ok(item.dimensions.every((dimension) => DIMENSIONS.has(dimension)));
        }
      }
    }
    assert.equal(new Set(ids).size, ids.length, `${scriptId} 的锚点 id 应唯一`);
    assert.ok(anchors.keyFacts.length >= 6);
    assert.ok(anchors.constraints.length >= 2);
    assert.ok(anchors.decisionPoints.length >= 3);
    assert.ok(anchors.planElements.length >= 3);
    assert.ok(anchors.invalidBehaviors.length >= 3);
  }
});

test("getAnchors 返回两份非空锚点表，未知剧本返回空表", () => {
  assert.ok(getAnchors("handong").keyFacts.length > 0);
  assert.ok(getAnchors("gaowen").keyFacts.length > 0);
  assert.deepEqual(getAnchors("不存在的id"), {
    scriptId: "不存在的id",
    version: "",
    keyFacts: [],
    constraints: [],
    decisionPoints: [],
    planElements: [],
    invalidBehaviors: [],
  });
});

test("suggestScores 从已解锁信息和决策记录匹配锚点，并列出未覆盖关键项", () => {
  const dimensions = suggestScores({
    scriptId: "handong",
    unlockedInformation: ["实测续航从400km降到约220km"],
    decisionHistory: [{ type: "choose_preheat", payload: { contentSummary: "选择驻车预热，约90万、20天" } }],
    behaviorRecords: [],
    flags: {},
  });
  const problem = dimensions.find((item) => item.key === "problem_location");
  const solution = dimensions.find((item) => item.key === "solution_completeness");
  assert.ok(problem.anchorBasis.some((item) => item.startsWith("KF-01：")));
  assert.ok(solution.anchorBasis.some((item) => item.startsWith("DP-01：")));
  assert.ok(problem.uncoveredAnchors.some((item) => item.startsWith("KF-02：")));
});

test("新增锚点字段不改变建议分的既有字段契约", () => {
  const [dimension] = suggestScores({ scriptId: "gaowen", unlockedInformation: [], decisionHistory: [], behaviorRecords: [], flags: {} });
  assert.equal(typeof dimension.score, "number");
  assert.equal(typeof dimension.band, "string");
  assert.ok(Array.isArray(dimension.evidence));
  assert.equal(typeof dimension.needsTeacherReview, "boolean");
  assert.ok(Array.isArray(dimension.anchorBasis));
  assert.ok(Array.isArray(dimension.uncoveredAnchors));
});

test("未锁定唯一成因不因结论措辞被隐性扣分", () => {
  const sharedState = {
    scriptId: "handong",
    unlockedInformation: [
      "实测续航从400km降至220km，低温环境为-25℃",
      "驻车预热路线约90万、20天，可改善低温续航",
    ],
    flags: {
      problemClarified: true,
      budgetClarified: true,
      scheduleClarified: true,
      workshopVisited: true,
    },
    decisionHistory: [
      { type: "choose_preheat", payload: { contentSummary: "核对续航、氢耗、加氢与保温条件，并比较驻车预热的预算和工期" } },
      { type: "choose_preheat", payload: { contentSummary: "基于低温下续航和氢耗变化，评估驻车预热路线的90万、20天安排" } },
    ],
    behaviorRecords: [{ type: "communicate", targetNpc: "wang_manager", contentSummary: "向甲方同步低温续航与加氢保障的核查进度" }],
  };
  const pathA = suggestScores({
    ...sharedState,
    decisionHistory: [...sharedState.decisionHistory, { type: "choose_preheat", payload: { contentSummary: "已锁定唯一成因：低温导致氢耗上升，执行驻车预热路线" } }],
  });
  const pathB = suggestScores({
    ...sharedState,
    decisionHistory: [...sharedState.decisionHistory, { type: "choose_preheat", payload: { contentSummary: "证据不足以锁定唯一成因，暂缓调整、升级处置并保留未决项" } }],
  });

  assert.deepEqual(pathA.map((item) => item.score), pathB.map((item) => item.score), "两条路径的六维建议分应逐项相等");
  assert.deepEqual(
    pathA.map((item) => [...new Set(item.anchorBasis)].sort()),
    pathB.map((item) => [...new Set(item.anchorBasis)].sort()),
    "结论措辞不应改变各维度命中的锚点集合",
  );
  assert.deepEqual(
    pathA.map((item) => [...new Set(item.uncoveredAnchors)].sort()),
    pathB.map((item) => [...new Set(item.uncoveredAnchors)].sort()),
    "结论措辞不应改变各维度未覆盖锚点集合",
  );
  for (const path of [pathA, pathB]) {
    for (const key of ["problem_location", "information_priority"]) {
      const dimension = path.find((item) => item.key === key);
      assert.ok(dimension.anchorBasis.some((anchor) => anchor.startsWith("KF-01：")), `${key} 应命中 KF-01 层级1锚点`);
    }
  }
});
