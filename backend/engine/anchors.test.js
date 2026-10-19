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
