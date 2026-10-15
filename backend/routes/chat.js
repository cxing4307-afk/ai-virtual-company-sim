import { Router } from "express";

import { requestChat } from "../gateway/deepseek.js";

const router = Router();

// 路由只负责 HTTP 输入输出，模型调用细节统一留在网关层。
router.post("/", async (req, res) => {
  const { messages, system = "" } = req.body ?? {};

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: "messages 必须是数组" });
  }

  const result = await requestChat({
    messages,
    system,
    baseURL: process.env.DEEPSEEK_BASE_URL,
  });

  return res.status(result.status).json(result.body);
});

export default router;
