import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";

import express from "express";

import configRouter, { getRuntimeApiKey } from "./config.js";

const app = express();
app.use(express.json());
app.use(configRouter);

const server = http.createServer(app);
server.listen(0, "127.0.0.1");
await once(server, "listening");

const { port } = server.address();
const endpoint = `http://127.0.0.1:${port}/key`;

async function setKey(body) {
  return fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test.after(() => server.close());

test("运行时密钥初始为空，且仅保存在进程内", () => {
  assert.equal(getRuntimeApiKey(), "");
});

test("POST /key 设置合法密钥返回成功", async () => {
  const response = await setKey({ key: "valid-key" });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(getRuntimeApiKey(), "valid-key");
});

test("POST /key 会去除密钥首尾空格", async () => {
  const response = await setKey({ key: "  trimmed-key  " });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(getRuntimeApiKey(), "trimmed-key");
});

for (const [name, body] of [
  ["key 缺失", {}],
  ["空字符串", { key: "" }],
  ["纯空格", { key: "   " }],
  ["非字符串", { key: 123 }],
]) {
  test(`POST /key 在 ${name} 时拒绝请求并保留旧密钥`, async () => {
    const previousKey = getRuntimeApiKey();
    const response = await setKey(body);

    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, "string");
    assert.equal(getRuntimeApiKey(), previousKey);
  });
}

test("POST /key 重新设置会覆盖旧密钥", async () => {
  const response = await setKey({ key: "replacement-key" });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(getRuntimeApiKey(), "replacement-key");
});
