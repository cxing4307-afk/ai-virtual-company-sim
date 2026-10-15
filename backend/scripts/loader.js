import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const cardsDirectory = path.join(directory, "cards");
const cardStringFields = ["_comment", "id", "name", "身份", "目标", "性格", "语言风格", "开场白"];

const nonEmptyStrings = (value) => Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim());

export function validateCard(card, source = card?.id ?? "未知卡片") {
  for (const field of cardStringFields) {
    if (typeof card?.[field] !== "string" || !card[field].trim()) throw new Error(`角色卡 ${source} 的 ${field} 必须是非空字符串`);
  }
  if (!nonEmptyStrings(card.知识边界?.知道) || !nonEmptyStrings(card.知识边界?.不知道)) throw new Error(`角色卡 ${source} 的知识边界必须包含非空的知道/不知道列表`);
  if (!nonEmptyStrings(card.红线)) throw new Error(`角色卡 ${source} 的红线必须是非空字符串列表`);
  if (!Array.isArray(card.示例对话) || card.示例对话.length !== 2 || card.示例对话.some((turn) => typeof turn?.user !== "string" || !turn.user.trim() || typeof turn?.assistant !== "string" || !turn.assistant.trim())) {
    throw new Error(`角色卡 ${source} 必须包含两轮非空的示例对话`);
  }
  return card;
}

const cards = new Map(
  fs.readdirSync(cardsDirectory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const card = JSON.parse(fs.readFileSync(path.join(cardsDirectory, name), "utf8"));
      validateCard(card, name);
      return [card.id, Object.freeze(card)];
    }),
);

if (cards.size !== fs.readdirSync(cardsDirectory).filter((name) => name.endsWith(".json")).length) throw new Error("角色卡 id 不得重复");

export function getCard(cardId) {
  const card = cards.get(cardId);
  if (!card) throw new Error(`未知角色卡：${cardId}`);
  return card;
}

const scripts = new Map(
  fs.readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const raw = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
      const script = {
        ...raw,
        npcs: raw.npcs.map((npc) => {
          const card = getCard(npc.cardId);
          return { ...npc, name: card.name, identity: card.身份 };
        }),
        directorCard: getCard(raw.directorCardId),
      };
      validateScriptReferences(script);
      return [script.id, Object.freeze(script)];
    }),
);

export function validateScriptReferences(script) {
  const npcIds = script.npcs?.map((npc) => npc.id) ?? [];
  if (new Set(npcIds).size !== npcIds.length) throw new Error(`剧本 ${script.id} 的 NPC id 不得重复`);
  const known = new Set(npcIds);
  for (const item of script.director_dispatch ?? []) {
    if (!known.has(item.npcId)) throw new Error(`剧本 ${script.id} 的导演调度引用未知 NPC：${item.npcId}`);
  }
  for (const entry of script.world_info ?? []) {
    for (const npcId of entry.npcIds ?? []) if (!known.has(npcId)) throw new Error(`剧本 ${script.id} 的 World Info 引用未知 NPC：${npcId}`);
  }
  return script;
}

export const DEFAULT_SCRIPT_ID = "handong";

/** 返回启动时已载入的剧本；调用方无需了解文件路径。 */
export function getScript(scriptId = DEFAULT_SCRIPT_ID) {
  const script = scripts.get(scriptId);
  if (!script) throw new Error(`未知剧本：${scriptId}`);
  return script;
}

/** 首页只需要轻量元信息，避免把 NPC 提示词发送到浏览器。 */
export function listScripts() {
  return [...scripts.values()].sort((a, b) => (a.id === DEFAULT_SCRIPT_ID ? -1 : b.id === DEFAULT_SCRIPT_ID ? 1 : 0)).map(({ id, title, background, company, duration, roles }) => ({ id, title, background, company, duration, roles }));
}
