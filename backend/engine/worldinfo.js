/**
 * 按学生本轮原文和目标 NPC 检索剧本背景条目。
 * 这里只做确定性的字面匹配，不让模型决定看见哪些隐藏信息。
 */
export function findWorldInfo(entries = [], { message = "", npcId } = {}) {
  const normalized = String(message).toLocaleLowerCase("zh-CN");
  if (!normalized || !npcId) return [];
  return entries.filter((entry) => {
    const allowed = !entry.npcIds?.length || entry.npcIds.includes(npcId);
    const hit = entry.keywords?.some((keyword) => {
      const normalizedKeyword = String(keyword).trim().toLocaleLowerCase("zh-CN");
      return normalizedKeyword && normalized.includes(normalizedKeyword);
    });
    return allowed && hit;
  });
}

export function renderWorldInfo(entries = []) {
  return [...new Set(entries.map((entry) => entry.content).filter(Boolean))].map((content) => `- ${content}`).join("\n");
}
