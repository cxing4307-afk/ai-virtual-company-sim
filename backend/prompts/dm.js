import { getScript } from "../scripts/loader.js";

function directorTemplate(card) {
  return [
    `你是${card.name}。`, `身份：${card.身份}`, `目标：${card.目标}`, `性格：${card.性格}`,
    `知道什么：${card.知识边界.知道.join("；")}`, `不知道什么：${card.知识边界.不知道.join("；")}`,
    `语言风格：${card.语言风格}`, `红线：${card.红线.join("；")}`,
    "当前状态摘要：{state_summary}", "导演触发事件：{trigger}", "最近决策记录：{decision_summary}",
  ].join("\n");
}

export const DM_PROMPT = directorTemplate(getScript().directorCard);

export function renderDmPrompt({ stateSummary, trigger, decisionSummary, scriptId }) {
  return directorTemplate(getScript(scriptId).directorCard)
    .replace("{state_summary}", stateSummary)
    .replace("{trigger}", trigger)
    .replace("{decision_summary}", decisionSummary);
}
