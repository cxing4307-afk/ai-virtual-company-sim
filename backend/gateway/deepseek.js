import { getRuntimeApiKey } from "../routes/config.js";

const DEFAULT_BASE_URL = "https://api.deepseek.com";

/**
 * 调用 DeepSeek 兼容的聊天补全接口。
 * 外部依赖通过参数注入，便于在测试中替换真实网络请求。
 */
export async function requestChat({
  messages,
  system,
  apiKey,
  baseURL = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30_000,
}) {
  const resolvedApiKey = getRuntimeApiKey() || apiKey || process.env.DEEPSEEK_API_KEY;
  if (!resolvedApiKey) {
    return {
      status: 400,
      body: { error: "服务端未配置 DeepSeek API 密钥" },
    };
  }

  const requestMessages = system
    ? [{ role: "system", content: system }, ...messages]
    : messages;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${baseURL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${resolvedApiKey}`,
      },
      body: JSON.stringify({ model: "deepseek-chat", messages: requestMessages }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { status: 502, body: { error: "模型服务调用失败，请稍后重试" } };
    }

    return { status: 200, body: await response.json() };
  } catch {
    return { status: 502, body: { error: "模型服务请求超时或失败，请稍后重试" } };
  } finally {
    clearTimeout(timeout);
  }
}
