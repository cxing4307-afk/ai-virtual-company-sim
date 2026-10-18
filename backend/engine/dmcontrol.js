import { createEvent, EVENT_TYPES } from "./events.js";

/** DM 只控制压力和流程边界；所有分钟配置在此集中管理。 */
export const DEFAULT_DM_CONFIG = Object.freeze({
  actBudgetsMin: Object.freeze([10, 18, 10]),
  actSoftMin: Object.freeze([8, 14, 8]),
  contentEndMin: 38,
  absoluteEndMin: 45,
  offTopicWindow: 3,
  rollbackMinRemainingMin: 5,
});

const HELP_RE = /解释|澄清|确认(?:一下)?规则|规则(?:是|为|怎么)|什么意思/;
const EXEMPT_RE = /新约束|新增约束|约束条件|信息不足|缺少信息|纠错|更正|不对|有误|证据|依据|来源|质疑/;
const OFF_TOPIC_RE = /闲聊|聊(?:点|个)?别的|游戏|天气|明星|八卦|娱乐|电影|电视剧|综艺/;
const NEW_INFORMATION_RE = /新(?:证据|约束|行动|信息)|补充|依据|因为|数据|调查|验证|改为|下一步|将会|计划/;
const REFUSAL_OR_ANSWER_RE = /拒绝(?:任务|执行)|不想做|不做了|直接(?:告诉|给)我答案|给我(?:标准)?答案|最优方案/;

const normalize = (text) => String(text ?? "").trim().replace(/\s+/g, " ");

/**
 * 用确定性信号判断最近窗口中的跑题程度。opts.afterPullback 表示此前已拉回过。
 * 最新一轮有效行为会立即清零；求助和保护性表达优先于跑题识别。
 */
export function detectOffTopic(rounds, opts = {}) {
  const windowSize = opts.offTopicWindow ?? opts.window ?? DEFAULT_DM_CONFIG.offTopicWindow;
  const recent = Array.isArray(rounds) ? rounds.slice(-windowSize) : [];
  const latest = recent.at(-1);
  const latestText = normalize(latest?.text);

  if (latest?.isEffective) return { level: 0, reason: "effective_action_reset", exempt: false };
  if (HELP_RE.test(latestText)) return { level: 0, reason: "help_requested", exempt: true };
  if (EXEMPT_RE.test(latestText)) return { level: 0, reason: "protected_signal", exempt: true };
  if (REFUSAL_OR_ANSWER_RE.test(latestText)) return { level: 2, reason: "conversion_prompt", exempt: false };
  if (opts.keyNode && opts.currentTaskComplete === false) return { level: 1, reason: "incomplete_task_at_key_node", exempt: false };
  if (opts.dmPrompted && recent.slice(-2).length === 2 && recent.slice(-2).every((round) => !round.isEffective)) {
    return { level: 2, reason: "two_turns_without_response_to_dm", exempt: false };
  }

  const texts = recent.map((round) => normalize(round.text)).filter(Boolean);
  const repeated = latestText && texts.filter((text) => text === latestText).length >= 2 && !NEW_INFORMATION_RE.test(latestText);
  if (repeated) return { level: 2, reason: "repeated_claim_structure_prompt", exempt: false };

  const unrelatedCount = recent.filter((round) => !round.isEffective && OFF_TOPIC_RE.test(normalize(round.text)) && !HELP_RE.test(normalize(round.text)) && !EXEMPT_RE.test(normalize(round.text))).length;
  if (unrelatedCount >= 2 && (opts.afterPullback || opts.pullbackIssued || opts.wasRedirected)) {
    return { level: 3, reason: "repeated_off_topic_after_pullback", exempt: false };
  }
  if (unrelatedCount >= 2) return { level: 2, reason: "explicit_off_topic", exempt: false };
  if (unrelatedCount === 1) return { level: 1, reason: "mild_off_topic", exempt: false };
  return { level: 0, reason: "on_task", exempt: false };
}

const intervention = (priority, trigger, action, stateChange) => createEvent(EVENT_TYPES.DM_INTERVENTION, {
  priority, trigger, action, stateChange, scoreImpact: "none",
});

/** 检查单幕和全局时间线，不修改 state。 */
export function checkTimeBudget(state, script, now, config = DEFAULT_DM_CONFIG) {
  const merged = { ...DEFAULT_DM_CONFIG, ...config };
  const actIndex = Math.max(0, Number(state.currentAct || 1) - 1);
  const actElapsed = Math.max(0, now - state.actStartedAt);
  const totalElapsed = Math.max(0, now - state.createdAt);
  const minute = 60_000;
  const actSoftWarn = actElapsed >= merged.actSoftMin[actIndex] * minute;
  const actTimeout = actElapsed >= merged.actBudgetsMin[actIndex] * minute;
  const contentEnd = totalElapsed >= merged.contentEndMin * minute;
  const absoluteEnd = totalElapsed >= merged.absoluteEndMin * minute;
  const events = [];

  if (actSoftWarn && !actTimeout) events.push(intervention("low", "act_soft_limit", "in_story_time_reminder", { currentAct: state.currentAct }));
  if (actTimeout) {
    const hasNextAct = state.currentAct < (script?.acts?.length ?? 3);
    if (hasNextAct) events.push(createEvent(EVENT_TYPES.ACT_ADVANCED, { fromAct: state.currentAct, toAct: state.currentAct + 1, reason: "timeout" }));
    else events.push(intervention("high", "act_timeout", "minimum_delivery_template", { currentAct: state.currentAct }));
  }
  if (contentEnd) events.push(intervention("high", "content_end", "structured_delivery_landing", { contentEnded: true }));
  if (absoluteEnd) events.push(intervention("critical", "absolute_end", "force_settlement", { settled: true }));
  return { actSoftWarn, actTimeout, contentEnd, absoluteEnd, events };
}

/** 四类失败按合规、无方案超时、预算、方案被否的确定顺序归类。 */
export function classifyFailure(state) {
  const compliance = state.complianceFailure || state.complianceRedLine || state.flags?.complianceFailure || state.flags?.complianceRedLine
    || state.adjustedWithoutEvidence || state.fabricatedInventory || state.unauthorizedCommitment;
  let type;
  if (compliance) type = "compliance";
  else if (state.timeoutNoPlan || state.flags?.timeoutNoPlan || ((state.timedOut || state.flags?.timedOut) && !state.plan && !state.planSubmitted)) type = "timeout_no_plan";
  else if (state.budgetOverrun || state.flags?.budgetOverrun || state.budget?.used > state.budget?.limit) type = "budget_overrun";
  else type = "plan_rejected";
  return { type, needsTeacherReview: type === "compliance", defaultOutcome: "review_closed" };
}

/** 回档只能用一次，且必须同时满足幕次、余时、未执行、未越合规红线。 */
export function canRollback(state, now) {
  if (state.rollbackUsed || state.flags?.rollbackUsed) return { allowed: false, reason: "rollback_already_used" };
  if (state.currentAct >= 3) return { allowed: false, reason: "third_act_started" };
  const remaining = DEFAULT_DM_CONFIG.absoluteEndMin * 60_000 - Math.max(0, now - state.createdAt);
  if (remaining < DEFAULT_DM_CONFIG.rollbackMinRemainingMin * 60_000) return { allowed: false, reason: "insufficient_time" };
  if (state.errorExecuted || state.flags?.errorExecuted) return { allowed: false, reason: "error_already_executed" };
  if (state.complianceRedLine || state.complianceFailure || state.flags?.complianceRedLine || state.flags?.complianceFailure) return { allowed: false, reason: "compliance_red_line" };
  return { allowed: true, reason: "eligible" };
}
