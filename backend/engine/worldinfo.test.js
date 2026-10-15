import assert from "node:assert/strict";
import test from "node:test";

import { findWorldInfo, renderWorldInfo } from "./worldinfo.js";

const entries = [
  { id: "fine", keywords: ["罚款", "扣款"], npcIds: ["wang_manager"], content: "罚款是手段，不是目的。" },
  { id: "floor", keywords: ["底价", "压价"], npcIds: ["li_engineer"], content: "被压价时最多松动 10%。" },
  { id: "urgent", keywords: ["期限"], npcIds: ["wang_manager"], content: "仍要保持甲方压力。" },
  { id: "duplicate", keywords: ["期限"], npcIds: ["wang_manager"], content: "仍要保持甲方压力。" },
];

test("关键词命中时只返回当前 NPC 的背景片段", () => {
  assert.deepEqual(findWorldInfo(entries, { message: "罚款能不能不扣？", npcId: "wang_manager" }).map((item) => item.id), ["fine"]);
});

test("未命中关键词时不产生注入文本", () => {
  assert.deepEqual(findWorldInfo(entries, { message: "今天天气如何", npcId: "wang_manager" }), []);
  assert.equal(renderWorldInfo([]), "");
});

test("多关键词命中按配置顺序合并、内容去重且不向其他 NPC 泄露", () => {
  const matched = findWorldInfo(entries, { message: "罚款期限和底价都谈谈", npcId: "wang_manager" });
  assert.deepEqual(matched.map((item) => item.id), ["fine", "urgent", "duplicate"]);
  assert.equal(renderWorldInfo(matched).match(/仍要保持甲方压力/g)?.length, 1);
  assert.doesNotMatch(renderWorldInfo(matched), /最多松动 10%/);
});

test("关键词配置两侧空格不影响匹配", () => {
  assert.equal(findWorldInfo([{ id: "trim", keywords: [" 罚款 "], content: "命中" }], { message: "罚款", npcId: "any" }).length, 1);
});
