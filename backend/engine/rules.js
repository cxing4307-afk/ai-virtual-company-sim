import { getScript } from "../scripts/loader.js";
import { createEvent, EVENT_TYPES } from "./events.js";
import { advanceDirector } from "./director.js";

const BASE_EFFECTIVE_ACTIONS = new Set(["ask", "clarify_problem", "clarify_budget", "clarify_schedule", "visit_workshop", "submit_plan", "settle"]);
const addInformation = (state, information) => { if (information && !state.unlockedInformation.includes(information)) state.unlockedInformation.push(information); };
const setMetric = (state, value) => { state.metric.value = value; if (state.metric.key === "rangeKm") state.rangeKm = value; };

function record(state, action, now) {
  const payload = action.payload ?? {}; const time = new Date(now).toISOString();
  state.behaviorRecords.push({ time, type: action.type, targetNpc: payload.targetNpc ?? null, contentSummary: payload.contentSummary ?? payload.summary ?? null });
  state.decisionHistory.push({ time, act: state.currentAct, type: action.type, payload });
}

export function applyAction(state, action, { now = Date.now() } = {}) {
  if (!action?.type) throw new Error("action.type 不能为空");
  if (state.settled) throw new Error("本局已结算，请新开一局或重开");
  const script = getScript(state.scriptId); const events = []; const payload = action.payload ?? {};
  record(state, action, now);
  const route = script.routes.find((item) => item.action === action.type);
  const special = script.specialActions?.find((item) => item.action === action.type);
  state.ineffectiveTurns = BASE_EFFECTIVE_ACTIONS.has(action.type) || route || special ? 0 : state.ineffectiveTurns + 1;
  if (action.type === "clarify_problem" || (action.type === "ask" && payload.topic === "problem")) state.flags.problemClarified = true;
  if (action.type === "clarify_budget" || (action.type === "ask" && payload.topic === "budget")) state.flags.budgetClarified = true;
  if (action.type === "clarify_schedule" || (action.type === "ask" && payload.topic === "schedule")) state.flags.scheduleClarified = true;
  if (route && !state.flags[route.flag]) { state.flags[route.flag] = true; state.budget.used += route.budget; state.schedule.used += route.schedule; setMetric(state, state.metric.value + route.metricChange); }
  if (special && !state.flags[special.flag]) { state.flags[special.flag] = true; addInformation(state, special.information); setMetric(state, state.metric.value + special.metricChange); }
  if (state.budget.used > state.budget.limit && !state.flags.financeWarningTriggered) { state.flags.financeWarningTriggered = true; events.push(createEvent(EVENT_TYPES.FINANCE_WARNING, { budgetUsed: state.budget.used, budgetLimit: state.budget.limit, requiresApplication: true })); }
  if (state.schedule.used > state.schedule.limit && !state.flags.clientPressureTriggered) { state.flags.clientPressureTriggered = true; state.clientTrust = Math.max(0, state.clientTrust - script.rules.clientTrustPenalty); events.push(createEvent(EVENT_TYPES.CLIENT_PRESSURE, { scheduleUsed: state.schedule.used, scheduleLimit: state.schedule.limit, trustChange: -script.rules.clientTrustPenalty })); }
  if (state.ineffectiveTurns >= script.rules.ineffectiveTurnThreshold && state.flags.directorReminderTriggeredAt < state.ineffectiveTurns) { state.flags.directorReminderTriggeredAt = state.ineffectiveTurns; events.push(createEvent(EVENT_TYPES.DIRECTOR_REMINDER, { ineffectiveTurns: state.ineffectiveTurns })); }
  events.push(...advanceDirector(state, { now, action }));
  state.stateSnapshots.push({ time: new Date(now).toISOString(), act: state.currentAct, budgetUsed: state.budget.used, scheduleUsed: state.schedule.used, metric: state.metric.value });
  return { state, events };
}
