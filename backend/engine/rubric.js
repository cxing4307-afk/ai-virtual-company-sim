/** 《寒冬订单》过程性评价量规；分数为教师复核前的规则建议。 */
export const RUBRIC = {
  version: "2026-10-16",
  bands: [
    { level: "A", min: 85, max: 100 },
    { level: "B", min: 70, max: 84 },
    { level: "C", min: 50, max: 69 },
    { level: "D", min: 0, max: 49 },
  ],
  dimensions: [
    dimension("problem_location", "问题定位", 20,
      [["核心问题及机制", 45], ["症状、原因与约束区分", 25], ["证据支撑", 20], ["决策前完成定位", 10]],
      ["能说明低温下氢燃料电池公交续航下降与氢耗、保温和加热策略的关系，并在选路线前锁定问题。", "用续航里程和加氢频次区分现象与可能原因，已核对预算、工期约束。", "只确认续航不足，尚未把氢耗或冬季保温条件连成机制。", "未围绕寒冬续航、氢耗或加氢条件定位问题。"]),
    dimension("solution_completeness", "方案完整度", 20,
      [["技术措施组合", 35], ["成本、工期与风险预案", 30], ["指标与验收", 20], ["实施责任与顺序", 15]],
      ["方案组合保温、预热或加热策略，写明续航目标、氢耗监测、加氢保障、成本工期和风险预案。", "提出了可执行的保温或加热措施，并覆盖多数成本、工期和验收项。", "只有单一措施，例如加保温，未说明加氢保障或验收办法。", "未形成针对氢燃料电池公交冬季续航的可执行方案。"]),
    dimension("information_priority", "信息优先级", 15,
      [["先取关键事实", 40], ["交叉验证", 30], ["信息用于决策", 30]],
      ["先核实续航里程、氢耗、加氢能力和低温保温条件，再用这些事实选择加热策略。", "优先获取了续航或氢耗等关键事实，并用于比较路线。", "获取的信息与冬季续航决策关联不够清楚。", "没有优先核实续航、氢耗、加氢或保温条件。"]),
    dimension("constraint_awareness", "约束意识", 15,
      [["预算红线", 35], ["工期红线", 35], ["安全、运维与供氢约束", 30]],
      ["在预算和工期内安排保温、加热与加氢保障，同时说明冬季运维风险。", "已把预算、工期和至少一项加氢或运维约束纳入选择。", "只关注预算或工期之一，未说明加氢、保温施工或运维限制。", "选措施时未核对预算、工期或供氢条件。"]),
    dimension("client_management", "甲方管理", 15,
      [["澄清业务目标", 35], ["沟通预期与取舍", 35], ["阶段反馈与承诺", 30]],
      ["与甲方确认冬季续航目标、加氢安排和可接受工期，并说明保温与加热策略的取舍。", "已沟通续航目标或加氢安排，并反馈方案进度。", "有一次沟通，但没有确认续航目标、工期或服务影响。", "未主动管理甲方对冬季续航和加氢服务的预期。"]),
    dimension("iteration", "尝试与迭代", 15,
      [["有效假设验证", 40], ["基于证据调整", 35], ["迭代收敛", 25]],
      ["用 2—4 次有效迭代比较保温、预热和加热策略，并根据续航、氢耗或加氢事实收敛方案。", "进行了至少两次有依据的调整，能说明对续航或氢耗的影响。", "只有一次验证，或多次动作未体现依据和调整。", "没有围绕冬季续航、氢耗、加氢或保温开展有效迭代。"]),
  ],
};

function dimension(key, name, weight, subItems, examples) {
  return {
    key, name, weight,
    subItems: subItems.map(([name, points]) => ({ name, points })),
    bands: RUBRIC_BANDS_WITH_EXAMPLES(examples),
    evidenceRules: {
      principle: "关键事实必须先在已解锁信息或有效现场动作中获得，且在方案或后续决策中使用；不按提问数量计分。",
      minimum: "至少一条可追溯的动作、行为标记或决策摘要证据。",
    },
  };
}

function RUBRIC_BANDS_WITH_EXAMPLES(examples) {
  return [
    { level: "A", min: 85, max: 100, observableExample: examples[0] },
    { level: "B", min: 70, max: 84, observableExample: examples[1] },
    { level: "C", min: 50, max: 69, observableExample: examples[2] },
    { level: "D", min: 0, max: 49, observableExample: examples[3] },
  ];
}

const FACTS = [
  ["续航", /续航|里程|range/i], ["氢耗", /氢耗|耗氢|氢气/i], ["加氢", /加氢|加注|供氢/i],
  ["保温", /保温|预热|加热|热管理/i], ["预算", /预算|成本|费用/i], ["工期", /工期|天数|进度/i],
];
const ROUTE_ACTION = /^(choose_|select_|route_)/;
const textOf = (item) => [item?.contentSummary, item?.summary, item?.payload?.contentSummary, item?.payload?.summary, item?.payload?.routes?.join(" "), item?.payload?.note].filter(Boolean).join(" ");
const hasType = (all, type) => all.some((item) => item?.type === type);
const contains = (text, label) => FACTS.find(([name]) => name === label)?.[1].test(text) ?? false;
const bandFor = (score) => RUBRIC.bands.find((band) => score >= band.min && score <= band.max).level;
const clamp = (score) => Math.max(0, Math.min(100, Math.round(score)));

/** 根据可追溯过程记录提出建议分；不替代教师对证据质量的判断。 */
export function suggestScores(state) {
  const records = state?.behaviorRecords ?? [];
  const decisions = state?.decisionHistory ?? [];
  const all = [...records, ...decisions];
  const flags = state?.flags ?? {};
  const decisionText = decisions.map(textOf).join(" ");
  const obtainedText = [...(state?.unlockedInformation ?? []), flags.workshopVisited ? "现场走访" : ""].join(" ");
  const usedFacts = FACTS.filter(([name]) => contains(obtainedText, name) && contains(decisionText, name)).map(([name]) => name);
  const factEvidence = usedFacts.map((name) => `已获得并在决策中使用“${name}”关键事实`);
  const workshopVisited = Boolean(flags.workshopVisited) || hasType(all, "visit_workshop");
  const routes = decisions.filter((item) => ROUTE_ACTION.test(item.type));
  const effectiveIterations = Math.min(4, new Set([...routes.map((item) => item.type), ...decisions.filter((item) => ["visit_workshop", "submit_plan"].includes(item.type)).map((item) => item.type)]).size);
  const hasPlan = hasType(all, "submit_plan");
  const planBeforeRoute = !hasPlan || routes.length === 0 || decisions.findIndex((item) => item.type === "clarify_problem" || item?.payload?.topic === "problem") < decisions.findIndex((item) => ROUTE_ACTION.test(item.type));
  const contactedClient = records.some((record) => record.targetNpc === "wang_manager" || record.targetNpc === "zhang_ceo") || decisions.some((item) => /甲方|客户|续航目标|服务/.test(textOf(item)));
  const scores = {
    problem_location: (flags.problemClarified ? 35 : 0) + (usedFacts.filter((name) => ["续航", "氢耗", "保温"].includes(name)).length * 15) + ((flags.budgetClarified && flags.scheduleClarified) ? 15 : 0) + (planBeforeRoute && flags.problemClarified ? 10 : 0),
    solution_completeness: (hasPlan ? 20 : 0) + (usedFacts.filter((name) => ["保温", "加氢", "续航"].includes(name)).length * 15) + ((flags.budgetClarified && flags.scheduleClarified) ? 25 : 0) + (/风险|验收|监测|责任|步骤/.test(decisionText) ? 15 : 0),
    information_priority: (workshopVisited ? 25 : 0) + (usedFacts.length * 20) + (records.some((record) => record.targetNpc) ? 15 : 0),
    constraint_awareness: (flags.budgetClarified ? 35 : 0) + (flags.scheduleClarified ? 35 : 0) + (usedFacts.some((name) => name === "加氢" || name === "保温") ? 30 : 0),
    client_management: (contactedClient ? 35 : 0) + (/(甲方|客户).{0,20}(续航|工期|加氢)|(?:续航|工期|加氢).{0,20}(甲方|客户)/.test(decisionText) ? 35 : 0) + (hasPlan && contactedClient ? 30 : 0),
    iteration: (effectiveIterations >= 2 ? 40 : effectiveIterations * 20) + (usedFacts.length >= 2 ? 35 : usedFacts.length * 15) + (effectiveIterations >= 2 && hasPlan ? 25 : 0),
  };
  return RUBRIC.dimensions.map((item) => {
    const score = clamp(scores[item.key]);
    const evidence = [...factEvidence];
    if (flags.problemClarified) evidence.push("已完成问题确认标记");
    if (flags.budgetClarified) evidence.push("已完成预算红线确认标记");
    if (flags.scheduleClarified) evidence.push("已完成工期红线确认标记");
    if (workshopVisited) evidence.push("已记录现场走访动作");
    if (hasPlan) evidence.push("已提交方案决策");
    if (item.key === "iteration") evidence.push(`有效迭代计 ${effectiveIterations} 次（2—4 次为最佳区间，超过 4 次不加分）`);
    if (!evidence.length) evidence.push("尚无可追溯过程证据");
    const insufficient = ({
      problem_location: !flags.problemClarified || usedFacts.length === 0,
      solution_completeness: !hasPlan,
      information_priority: usedFacts.length === 0,
      constraint_awareness: !flags.budgetClarified || !flags.scheduleClarified,
      client_management: !contactedClient,
      iteration: effectiveIterations < 2 || usedFacts.length === 0,
    })[item.key];
    return { key: item.key, name: item.name, weight: item.weight, score, band: bandFor(score), evidence, needsTeacherReview: insufficient || (score >= 68 && score <= 72) || (score >= 83 && score <= 87) };
  });
}
