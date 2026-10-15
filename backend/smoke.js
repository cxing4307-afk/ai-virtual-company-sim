import assert from "node:assert/strict";

import { createDialogRouter } from "./routes/dialog.js";
import gameRouter from "./routes/game.js";

async function post(router, path, body) {
  const layer = router.stack.find((item) => item.route?.path === path && item.route.methods.post);
  const response = { status: 200, body: undefined };
  const res = {
    status(code) { response.status = code; return this; },
    json(payload) { response.body = payload; return this; },
  };
  await layer.route.stack[0].handle({ body }, res);
  assert.ok(response.status >= 200 && response.status < 300, `${path} 返回 ${response.status}: ${JSON.stringify(response.body)}`);
  return response.body;
}

async function smoke(scriptId, worldInfoMessage, expectedWorldInfo) {
  const systems = [];
  const requestChatFn = async ({ system }) => {
    systems.push(system);
    return { status: 200, body: { choices: [{ message: { content: `模拟回复 ${systems.length}` } }] } };
  };
  const dialogRouter = createDialogRouter({ requestChatFn });
  const created = await post(gameRouter, "/new", { role: "方案", scriptId });
  const gameId = created.gameId;
  await post(dialogRouter, "/dialog", { gameId, npcId: created.script.npcs[0].id, message: worldInfoMessage });
  assert.match(systems.at(-1), expectedWorldInfo);

  for (const type of ["clarify_problem", "clarify_budget", "clarify_schedule"]) await post(gameRouter, "/action", { gameId, type });
  let result;
  for (const route of created.script.routes) result = await post(gameRouter, "/action", { gameId, type: route.action });
  const financeEvent = result.events.find((event) => event.type === "finance_warning");
  assert.ok(financeEvent, `${scriptId} 未产生财务事件`);
  const dm = await post(dialogRouter, "/dm", { gameId, trigger: "预算超过上限", event: financeEvent });
  assert.ok(dm.scheduledDialog?.directed, `${scriptId} 未产生导演调度插话`);

  await post(gameRouter, "/action", { gameId, type: "submit_plan", payload: { contentSummary: "组合路线，包含成本、工期与风险预案。" } });
  const settled = await post(gameRouter, "/action", { gameId, type: "settle" });
  assert.equal(settled.state.settled, true);
  return { scriptId, worldInfo: expectedWorldInfo.source, directedNpc: dm.scheduledDialog.name, passed: settled.state.result.passed };
}

const results = [];
results.push(await smoke("handong", "罚款是否还有商量空间？", /罚款是手段，不是目的/));
results.push(await smoke("gaowen", "能否安排夜间错峰配送？", /部分门店存在夜间收货窗口/));
console.log(JSON.stringify(results, null, 2));
