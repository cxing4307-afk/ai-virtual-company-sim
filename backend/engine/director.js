import { getScript } from "../scripts/loader.js";
import { createEvent, EVENT_TYPES } from "./events.js";

const metricPassed = (metric) => metric.direction === "max" ? metric.value <= metric.target : metric.value >= metric.target;

export function evaluateSettlement(state) {
  const currentMetric = state.metric.key === "rangeKm" && Number.isFinite(state.rangeKm) ? { ...state.metric, value: state.rangeKm } : state.metric;
  const metric = metricPassed(currentMetric);
  const passed = state.budget.used <= state.budget.limit && state.schedule.used <= state.schedule.limit && metric;
  return { passed, canRestart: !passed, checks: { budget: state.budget.used <= state.budget.limit, schedule: state.schedule.used <= state.schedule.limit, metric, ...(state.metric.key === "rangeKm" ? { range: metric } : {}) } };
}

export function advanceDirector(state, { now = Date.now(), action } = {}) {
  const script = getScript(state.scriptId); const events = []; const elapsed = now - state.actStartedAt;
  if (state.currentAct === 1) {
    const ready = state.flags.problemClarified && state.flags.budgetClarified && state.flags.scheduleClarified;
    if (ready || elapsed >= script.acts[0].durationMs) { state.currentAct = 2; state.actStartedAt = now; events.push(createEvent(EVENT_TYPES.ACT_ADVANCED, { fromAct: 1, toAct: 2, reason: ready ? "constraints_ready" : "timeout" })); }
  } else if (state.currentAct === 2) {
    const submitted = action?.type === "submit_plan" || action?.payload?.phrase === "交方案";
    if (submitted || elapsed >= script.acts[1].durationMs) { state.currentAct = 3; state.actStartedAt = now; events.push(createEvent(EVENT_TYPES.ACT_ADVANCED, { fromAct: 2, toAct: 3, reason: submitted ? "submitted" : "research_timeout" })); }
  } else if (state.currentAct === 3 && (action?.type === "settle" || action?.type === "submit_plan")) {
    state.result = evaluateSettlement(state); state.settled = true; events.push(createEvent(EVENT_TYPES.GAME_SETTLED, state.result));
  }
  return events;
}
