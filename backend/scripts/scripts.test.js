import assert from "node:assert/strict";
import test from "node:test";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import gameRouter from "../routes/game.js";
import { getCard, getScript, getScriptDetail, listScripts, validateCard, validateScriptReferences } from "./loader.js";

const directory = path.dirname(fileURLToPath(import.meta.url));

async function postNew(body) {
  const layer = gameRouter.stack.find((item) => item.route?.path === "/new" && item.route.methods.post);
  const response = { status: 200, body: undefined };
  await layer.route.stack[0].handle({ body }, {
    status(code) { response.status = code; return this; },
    json(payload) { response.body = payload; return this; },
  });
  return response;
}

test("剧本加载接口提供可运行剧本及数据驱动的社区种子", () => {
  const scripts = listScripts();
  assert.deepEqual(scripts.map((script) => script.id), ["handong", "gaowen", "month-end-variance"]);
  assert.deepEqual(scripts.slice(0, 2).map((script) => script.title), ["寒冬订单", "高温订单"]);
  assert.deepEqual(listScripts()[0].tags, ["制造业", "冬季运营"]);
  assert.equal(listScripts()[0].difficulty, "入门");
  assert.equal(listScripts()[0].npcCount, getScript("handong").npcs.length);
  assert.equal(scripts.at(-1).draft, true);
  assert.match(scripts.at(-1).sourceNote, /社区种子草稿/);
});

test("剧本详情只投影剧本中心所需字段，不泄露角色卡或 World Info", () => {
  const detail = getScriptDetail("handong");
  assert.deepEqual(Object.keys(detail).sort(), ["background", "company", "difficulty", "duration", "npcs", "roles", "tagline", "tags", "title"]);
  assert.deepEqual(Object.keys(detail.roles[0]).sort(), ["id", "opening", "title"]);
  assert.deepEqual(Object.keys(detail.npcs[0]), ["name"]);
  const serialized = JSON.stringify(detail);
  for (const forbidden of ["identity", "知识边界", "红线", "示例对话", "目标", "world_info", "visibleFields", "cardId"]) assert.ok(!serialized.includes(forbidden), `详情不应包含 ${forbidden}`);
});

test("社区种子详情可查看但保持草稿状态", () => {
  const detail = getScriptDetail("month-end-variance");
  assert.equal(detail.draft, true);
  assert.equal(detail.npcs.length, 0);
  assert.match(detail.sourceNote, /月末差异/);
});

test("第二个剧本通过同一配置接口提供角色、NPC、路线和目标指标", () => {
  const script = getScript("gaowen");
  assert.equal(script.roles.length, 3);
  assert.equal(script.npcs.length, 4);
  assert.equal(script.routes.length, 2);
  assert.deepEqual(script.rules.metric, {
    key: "cargoLossRate",
    name: "货损率",
    unit: "%",
    initial: 6,
    target: 2,
    direction: "max",
    calibration: "待校准",
  });
});

test("未知剧本会被明确拒绝", () => {
  assert.throws(() => getScript("不存在"), /未知剧本/);
});

test("两个剧本通过 cardId 引用完整角色卡", () => {
  const required = ["name", "身份", "目标", "性格", "知识边界", "语言风格", "红线", "开场白", "示例对话"];
  for (const scriptId of ["handong", "gaowen"]) {
    const raw = JSON.parse(fs.readFileSync(path.join(directory, `${scriptId}.json`), "utf8"));
    assert.ok(raw.npcs.every((npc) => npc.cardId && !Object.hasOwn(npc, "prompt")));
    const script = getScript(scriptId);
    for (const npc of script.npcs) {
      const card = getCard(npc.cardId);
      for (const field of required) assert.ok(card[field], `${npc.cardId} 缺少 ${field}`);
      assert.equal(card.示例对话.length, 2);
      assert.ok(card.知识边界.知道.length > 0);
      assert.ok(card.知识边界.不知道.length > 0);
    }
    assert.ok(script.directorCard);
    assert.equal(getCard(raw.directorCardId).示例对话.length, 2);
  }
});

test("角色卡严格拒绝缺少中文说明、空知识边界和无效示例", () => {
  const valid = getCard("handong-wang-manager");
  assert.throws(() => validateCard({ ...valid, _comment: "" }, "坏卡片"), /_comment/);
  assert.throws(() => validateCard({ ...valid, 知识边界: { ...valid.知识边界, 知道: [] } }, "坏卡片"), /知识边界/);
  assert.throws(() => validateCard({ ...valid, 示例对话: [{ user: "", assistant: "回答" }, valid.示例对话[1]] }, "坏卡片"), /示例对话/);
});

test("剧本严格拒绝未知 NPC 的知识和导演调度引用", () => {
  const script = getScript("handong");
  assert.throws(() => validateScriptReferences({ ...script, director_dispatch: [{ eventType: "x", npcId: "ghost" }] }), /未知 NPC/);
  assert.throws(() => validateScriptReferences({ ...script, world_info: [{ id: "x", keywords: ["x"], npcIds: ["ghost"], content: "x" }] }), /未知 NPC/);
});

test("新建对局只向前端返回 NPC 展示字段", async () => {
  const response = await postNew({ role: "方案", scriptId: "handong" });
  assert.deepEqual(Object.keys(response.body.script.npcs[0]).sort(), ["id", "identity", "name"]);
});
