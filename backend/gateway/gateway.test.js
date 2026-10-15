// 使用 Node.js 内置测试运行器验证模型网关的公开行为。
import assert from "node:assert/strict";
import test from "node:test";

import { requestChat } from "./deepseek.js";

test("模型成功响应时透传回复内容", async () => {
  const fetchMock = async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "这是模型回复" } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  const result = await requestChat({
    messages: [{ role: "user", content: "你好" }],
    system: "请简短回答",
    apiKey: "测试密钥",
    fetchImpl: fetchMock,
  });

  assert.deepEqual(result, {
    status: 200,
    body: {
      choices: [{ message: { role: "assistant", content: "这是模型回复" } }],
    },
  });
});

test("缺少 API key 时返回 400 和中文错误", async () => {
  const result = await requestChat({
    messages: [{ role: "user", content: "你好" }],
    system: "",
    apiKey: "",
    fetchImpl: async () => {
      throw new Error("缺少密钥时不应发起网络请求");
    },
  });

  assert.equal(result.status, 400);
  assert.match(result.body.error, /未配置.*密钥/);
});

test("上游模型返回 500 时转换为 502 和中文错误", async () => {
  const result = await requestChat({
    messages: [{ role: "user", content: "你好" }],
    system: "",
    apiKey: "测试密钥",
    fetchImpl: async () => new Response("上游内部错误", { status: 500 }),
  });

  assert.equal(result.status, 502);
  assert.match(result.body.error, /模型服务.*失败/);
});
