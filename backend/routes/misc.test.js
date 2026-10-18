import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import chatRouter from "./chat.js";

async function post(router, path, body) {
  const layer = router.stack.find((item) => item.route?.path === path && item.route.methods.post);
  assert.ok(layer, `未找到 POST ${path}`);
  const response = { status: 200, body: undefined };
  const res = { status(code) { response.status = code; return this; }, json(payload) { response.body = payload; return this; } };
  await layer.route.stack[0].handle({ body }, res);
  return response;
}

test("chat 路由拒绝非数组 messages，且不触发网关", async () => {
  const result = await post(chatRouter, "/", { messages: "不是数组" });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /messages 必须是数组/);
});

test("config 路由拒绝空 key", async () => {
  const run = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import router from './backend/routes/config.js';
    const handler = router.stack.find((item) => item.route?.path === '/key').route.stack[0].handle;
    const response = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ body: { key: '  ' } }, response);
    if (response.code !== 400) process.exit(1);
  `], { cwd: new URL("../..", import.meta.url), encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
});

test("config 路由保存合法 key 且进程结束后恢复为空", () => {
  const run = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import router, { getRuntimeApiKey } from './backend/routes/config.js';
    const handler = router.stack.find((item) => item.route?.path === '/key').route.stack[0].handle;
    const response = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ body: { key: '  test-key  ' } }, response);
    if (response.code !== 200 || getRuntimeApiKey() !== 'test-key') process.exit(1);
  `], { cwd: new URL("../..", import.meta.url), encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
});
