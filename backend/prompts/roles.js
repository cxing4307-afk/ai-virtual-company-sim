import { getCard, getScript } from "../scripts/loader.js";

const commonBoundary = "你只影响怎么说，绝不决定发生什么；不直接给学生最优解；不知道的事情要明确说不知道，不能猜测或泄露不可见信息。";

function renderExamples(examples) {
  return examples.map((turn, index) => `示例 ${index + 1}\n学生：${turn.user}\n角色：${turn.assistant}`).join("\n");
}

function roleTemplate(card) {
  return [
    `你是${card.name}。`, `身份：${card.身份}`, `目标：${card.目标}`, `性格：${card.性格}`,
    `知道什么：${card.知识边界.知道.join("；")}`, `不知道什么（知识边界）：${card.知识边界.不知道.join("；")}`,
    `语言风格：${card.语言风格}`, `红线：${card.红线.join("；")}`, `共同红线：${commonBoundary}`,
    `开场白参考：${card.开场白}`, renderExamples(card.示例对话), "当前状态摘要：{state_summary}", "你可见的信息：{visible_info}",
  ].join("\n");
}

const defaultScript = getScript();
export const NPC_IDS = Object.freeze(defaultScript.npcs.map((npc) => npc.id));
export const ROLE_PROMPTS = Object.freeze(Object.fromEntries(defaultScript.npcs.map((npc) => [npc.id, roleTemplate(getCard(npc.cardId))])));

export function getNpcIds(scriptId) { return getScript(scriptId).npcs.map((npc) => npc.id); }

/** 角色卡只提供表达边界，状态仍必须经过权限过滤后才可注入。 */
export function renderRolePrompt(npcId, { stateSummary, visibleInfo, historySummary = "暂无历史对话。", worldInfo = "", eventContext = "", scriptId } = {}) {
  const npc = getScript(scriptId).npcs.find((item) => item.id === npcId);
  if (!npc) throw new Error("未知 NPC");
  return roleTemplate(getCard(npc.cardId))
    .replace("{state_summary}", stateSummary)
    .replace("{visible_info}", visibleInfo)
    .concat(`\n最近对话摘要：${historySummary}`)
    .concat(worldInfo ? `\n按需背景信息（只在本轮使用）：\n${worldInfo}` : "")
    .concat(eventContext ? `\n导演调度事件：${eventContext}\n请以角色身份直接说一句推动剧情的话，不要解释调度机制。` : "");
}
