import assert from "node:assert/strict";
import test from "node:test";

import { requestChat } from "../gateway/deepseek.js";
import { filterStateFor } from "../prompts/permissions.js";
import { ROLE_PROMPTS } from "../prompts/roles.js";
import { createInitialState } from "../engine/state.js";
import { createDialogRouter } from "./dialog.js";
import { getGameState } from "./game.js";
import gameRouter from "./game.js";

/** 不监听端口，直接执行 Express 路由处理器。 */
async function post(router, path, body) {
  const layer = router.stack.find((item) => item.route?.path === path && item.route.methods.post);
  assert.ok(layer, `未找到 POST ${path}`);
  const response = { status: 200, body: undefined };
  const res = {
    status(code) { response.status = code; return this; },
    json(payload) { response.body = payload; return this; },
  };
  await layer.route.stack[0].handle({ body }, res);
  return response;
}

test("张总权限过滤不包含电堆衰减数据", () => {
  const state = createInitialState("测试");
  const visible = filterStateFor("zhang_ceo", state);
  assert.doesNotMatch(JSON.stringify(visible), /衰减曲线|电堆/);
});

test("角色提示词包含红线文案和状态占位符", () => {
  assert.match(ROLE_PROMPTS.zhang_ceo, /红线/);
  assert.match(ROLE_PROMPTS.zhang_ceo, /不直接给学生最优解/);
  assert.match(ROLE_PROMPTS.zhang_ceo, /\{state_summary\}/);
  assert.match(ROLE_PROMPTS.zhang_ceo, /\{visible_info\}/);
});

test("对话会记录学生问了谁以及问题摘要", async () => {
  const gatewayFetchMock = async () => new Response(JSON.stringify({ choices: [{ message: { content: "请先确认约束。" } }] }), { status: 200 });
  const requestChatFn = (options) => requestChat({ ...options, apiKey: "测试密钥", fetchImpl: gatewayFetchMock });
  const dialogRouter = createDialogRouter({ requestChatFn });
  const game = await post(gameRouter, "/new", { role: "方案" });
  const dialog = await post(dialogRouter, "/dialog", { gameId: game.body.gameId, npcId: "wang_manager", message: "罚款条款具体是什么？" });

  assert.equal(dialog.status, 200);
  assert.equal(dialog.body.reply, "请先确认约束。");
  const record = getGameState(game.body.gameId).behaviorRecords.at(-1);
  assert.deepEqual({ type: record.type, targetNpc: record.targetNpc, contentSummary: record.contentSummary }, {
    type: "dialog", targetNpc: "wang_manager", contentSummary: "罚款条款具体是什么？",
  });
});

test("衰减原因提问映射为问题确认动作并返回最新状态与事件", async () => {
  const gatewayFetchMock = async () => new Response(JSON.stringify({ choices: [{ message: { content: "低温会让电堆输出功率衰减。" } }] }), { status: 200 });
  const requestChatFn = (options) => requestChat({ ...options, apiKey: "测试密钥", fetchImpl: gatewayFetchMock });
  const dialogRouter = createDialogRouter({ requestChatFn });
  const game = await post(gameRouter, "/new", { role: "测试" });

  const dialog = await post(dialogRouter, "/dialog", {
    gameId: game.body.gameId,
    npcId: "li_engineer",
    message: "衰减原因是什么？",
  });

  assert.equal(dialog.status, 200);
  assert.deepEqual(dialog.body.reply, "低温会让电堆输出功率衰减。");
  assert.equal(dialog.body.mapped, true);
  assert.equal(dialog.body.state.flags.problemClarified, true);
  assert.ok(Array.isArray(dialog.body.events));
  assert.equal(getGameState(game.body.gameId).behaviorRecords.at(-1).type, "ask");
});

test("未映射跑题对话返回状态、一级拉回事件与未映射标志", async () => {
  const gatewayFetchMock = async () => new Response(JSON.stringify({ choices: [{ message: { content: "我们先聚焦项目本身。" } }] }), { status: 200 });
  const requestChatFn = (options) => requestChat({ ...options, apiKey: "测试密钥", fetchImpl: gatewayFetchMock });
  const dialogRouter = createDialogRouter({ requestChatFn });
  const game = await post(gameRouter, "/new", { role: "方案" });

  const dialog = await post(dialogRouter, "/dialog", {
    gameId: game.body.gameId,
    npcId: "wang_manager",
    message: "你周末喜欢看什么电影？",
  });

  assert.equal(dialog.status, 200);
  assert.equal(dialog.body.mapped, false);
  assert.equal(dialog.body.state.gameId, game.body.gameId);
  assert.equal(dialog.body.offTopic.level, 1);
  assert.equal(dialog.body.events.at(-1).type, "dm_intervention");
});

test("跑题三级拉回由服务端判定，求助和新约束不触发", async () => {
  const requestChatFn = async () => ({ status: 200, body: { choices: [{ message: { content: "请继续。" } }] } });
  const dialogRouter = createDialogRouter({ requestChatFn });
  const game = await post(gameRouter, "/new", { role: "方案" });
  const request = (message) => post(dialogRouter, "/dialog", { gameId: game.body.gameId, npcId: "wang_manager", message });

  const first = await request("今天天气如何？");
  const second = await request("聊聊游戏吧");
  const third = await request("最近有什么电影？");
  assert.equal(first.body.offTopic.level, 1);
  assert.equal(second.body.offTopic.level, 2);
  assert.equal(third.body.offTopic.level, 3);
  assert.equal(third.body.events.at(-1).type, "dm_intervention");
  assert.equal((await request("规则是什么意思？")).body.offTopic.exempt, true);
  assert.equal((await request("刚发现一个新约束条件")).body.offTopic.exempt, true);
});

test("网关失败时对话接口返回 502 中文错误", async () => {
  const gatewayFetchMock = async () => { throw new Error("网络不可用"); };
  const requestChatFn = (options) => requestChat({ ...options, apiKey: "测试密钥", fetchImpl: gatewayFetchMock });
  const dialogRouter = createDialogRouter({ requestChatFn });
  const game = await post(gameRouter, "/new", { role: "方案" });
  const dialog = await post(dialogRouter, "/dialog", { gameId: game.body.gameId, npcId: "chen_accountant", message: "预算还能用多少？" });

  assert.equal(dialog.status, 502);
  assert.match(dialog.body.error, /模型服务.*失败/);
});

test("World Info 命中内容会注入对应 NPC 的 system prompt", async () => {
  let capturedSystem = "";
  const requestChatFn = async ({ system }) => {
    capturedSystem = system;
    return { status: 200, body: { choices: [{ message: { content: "罚款可以谈，但方案必须落地。" } }] } };
  };
  const dialogRouter = createDialogRouter({ requestChatFn });
  const game = await post(gameRouter, "/new", { role: "方案", scriptId: "handong" });

  await post(dialogRouter, "/dialog", { gameId: game.body.gameId, npcId: "wang_manager", message: "罚款能不能商量？" });

  assert.match(capturedSystem, /罚款是手段，不是目的/);
});

test("结构化导演事件会调度 NPC 插话并把事件历史带入下一次 prompt", async () => {
  const systems = [];
  const requestChatFn = async ({ system }) => {
    systems.push(system);
    return { status: 200, body: { choices: [{ message: { content: `调度插话${systems.length}` } }] } };
  };
  const dialogRouter = createDialogRouter({ requestChatFn });
  const game = await post(gameRouter, "/new", { role: "方案", scriptId: "handong" });
  const event = { type: "client_pressure", data: { scheduleUsed: 35, scheduleLimit: 30 } };

  const first = await post(dialogRouter, "/dm", { gameId: game.body.gameId, trigger: "甲方施压", event });
  const second = await post(dialogRouter, "/dm", { gameId: game.body.gameId, trigger: "甲方再次施压", event });

  assert.equal(first.status, 200);
  assert.deepEqual(first.body.scheduledDialog, { npcId: "wang_manager", name: "王经理", reply: "调度插话1", directed: true });
  assert.match(systems[0], /client_pressure/);
  assert.match(systems[1], /调度插话1/);
  assert.deepEqual(second.body.scheduledDialog, { npcId: "wang_manager", name: "王经理", reply: "调度插话2", directed: true });
});

test("导演调度每幕最多两次，失败不消耗次数", async () => {
  let calls = 0;
  const requestChatFn = async () => {
    calls += 1;
    if (calls === 1) return { status: 400, body: { error: "服务端未配置 DeepSeek API 密钥" } };
    return { status: 200, body: { choices: [{ message: { content: `有效插话${calls}` } }] } };
  };
  const dialogRouter = createDialogRouter({ requestChatFn });
  const game = await post(gameRouter, "/new", { role: "方案", scriptId: "handong" });
  const event = { type: "finance_warning", data: { budgetUsed: 130, budgetLimit: 120 } };

  const failed = await post(dialogRouter, "/dm", { gameId: game.body.gameId, trigger: "财务警告", event });
  const first = await post(dialogRouter, "/dm", { gameId: game.body.gameId, trigger: "财务警告", event });
  const second = await post(dialogRouter, "/dm", { gameId: game.body.gameId, trigger: "财务警告", event });
  const limited = await post(dialogRouter, "/dm", { gameId: game.body.gameId, trigger: "财务警告", event });

  assert.equal(failed.status, 400);
  assert.ok(first.body.scheduledDialog);
  assert.ok(second.body.scheduledDialog);
  assert.equal(limited.body.scheduledDialog, undefined);
  assert.match(limited.body.reply, /每幕调度次数已用完/);
  assert.equal(calls, 3);
});

test("并发导演事件仍严格限制每幕两次插话", async () => {
  let calls = 0;
  const requestChatFn = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { status: 200, body: { choices: [{ message: { content: `并发插话${calls}` } }] } };
  };
  const dialogRouter = createDialogRouter({ requestChatFn });
  const game = await post(gameRouter, "/new", { role: "方案", scriptId: "handong" });
  const event = { type: "finance_warning", data: { budgetUsed: 130, budgetLimit: 120 } };

  const results = await Promise.all(Array.from({ length: 3 }, () => post(dialogRouter, "/dm", { gameId: game.body.gameId, trigger: "并发财务警告", event })));

  assert.equal(calls, 2);
  assert.equal(results.filter((result) => result.body.scheduledDialog).length, 2);
  assert.equal(getGameState(game.body.gameId).directorDispatchCounts[1], 2);
});
