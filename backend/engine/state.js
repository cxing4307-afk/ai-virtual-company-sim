import { randomUUID } from "node:crypto";
import { DEFAULT_SCRIPT_ID, getScript } from "../scripts/loader.js";

export const ROLES = Object.freeze(getScript().roles.map((role) => role.id));

/** 创建一局的唯一事实源；金额单位万元、工期单位天。 */
export function createInitialState(role, { now = Date.now(), gameId = randomUUID(), scriptId = DEFAULT_SCRIPT_ID } = {}) {
  const script = getScript(scriptId);
  const roleConfig = script.roles.find((item) => item.id === role);
  if (!roleConfig) throw new Error(`岗位必须是：${script.roles.map((item) => item.id).join("、")}`);
  const metric = { ...script.rules.metric, value: script.rules.metric.initial };
  return {
    gameId, scriptId, scriptMeta: { id: script.id, title: script.title, company: script.company }, role,
    budget: { limit: script.rules.budgetLimit, used: 0 }, schedule: { limit: script.rules.scheduleLimit, used: 0 },
    clientTrust: script.rules.clientTrust, metric,
    ...(metric.key === "rangeKm" ? { rangeKm: metric.value } : {}),
    currentAct: 1, unlockedInformation: [...roleConfig.information],
    decisionHistory: [], behaviorRecords: [], stateSnapshots: [],
    flags: { problemClarified: false, budgetClarified: false, scheduleClarified: false, workshopVisited: false, financeWarningTriggered: false, clientPressureTriggered: false, directorReminderTriggeredAt: 0, ...Object.fromEntries(script.routes.map((route) => [route.flag, false])) },
    ineffectiveTurns: 0, directorDispatchCounts: {}, createdAt: now, actStartedAt: now, settled: false, result: null,
  };
}

export function getOpeningData(state) {
  return { act: 1, role: state.role, knownInformation: [...state.unlockedInformation], constraints: { budgetLimit: state.budget.limit, scheduleLimit: state.schedule.limit, metric: { name: state.metric.name, unit: state.metric.unit, target: state.metric.target, direction: state.metric.direction }, ...(state.metric.key === "rangeKm" ? { targetRangeKm: state.metric.target } : {}) } };
}
