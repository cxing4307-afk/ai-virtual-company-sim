import { getScript } from "../scripts/loader.js";

export function normalizeNpcId(npcId, scriptId) {
  const script = getScript(scriptId);
  return script.npcs.find((npc) => npc.id === npcId || npc.aliases?.includes(npcId))?.id ?? npcId;
}

function valuesFor(field, state) {
  if (field === "metric") return { name: state.metric.name, unit: state.metric.unit, value: state.metric.value, target: state.metric.target };
  if (field === "contract") return { scheduleLimit: state.schedule.limit };
  if (field === "workshopVisited") return state.flags.workshopVisited;
  if (field === "workshopInformation") return state.unlockedInformation.filter((item) => item === "土办法" || item === "开门频次记录");
  if (field === "unlockedInformationWithoutMetric") return state.unlockedInformation.filter((item) => !item.includes("衰减") && !item.includes("温度曲线"));
  if (field === "budget" || field === "schedule") return { ...state[field] };
  return state[field];
}

/** 可见字段白名单完全由当前剧本 NPC 配置给出。 */
export function filterStateFor(npcId, state) {
  const script = getScript(state?.scriptId);
  const npc = script.npcs.find((item) => item.id === normalizeNpcId(npcId, script.id));
  if (!npc) throw new Error("未知 NPC");
  return Object.fromEntries(npc.visibleFields.map((field) => [field, valuesFor(field, state)]));
}
