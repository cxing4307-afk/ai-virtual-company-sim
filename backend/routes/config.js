import { Router } from "express";

let runtimeApiKey = "";

/** 仅存活在当前 Node 进程内；不写盘、不写库、不记录日志。 */
export function getRuntimeApiKey() {
  return runtimeApiKey;
}

const router = Router();

router.post("/key", (req, res) => {
  const { key } = req.body ?? {};
  if (typeof key !== "string" || !key.trim()) {
    return res.status(400).json({ error: "key 不能为空" });
  }
  runtimeApiKey = key.trim();
  return res.json({ ok: true });
});

export default router;
