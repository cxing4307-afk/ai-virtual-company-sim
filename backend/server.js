import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import { closeDatabase, initializeDatabase } from "./db.js";
import chatRouter from "./routes/chat.js";
import configRouter from "./routes/config.js";
import dialogRouter from "./routes/dialog.js";
import gameRouter from "./routes/game.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendDirectory = path.resolve(currentDirectory, "../frontend");
const port = Number(process.env.PORT ?? 3000);

initializeDatabase();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/chat", chatRouter);
app.use("/api/config", configRouter);
app.use("/api/game", gameRouter);
app.use("/api/game", dialogRouter);
app.use(express.static(frontendDirectory));

const server = app.listen(port, (error) => {
  if (error) {
    console.error(`服务启动失败：${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`服务已启动：http://localhost:${port}`);
});

// 收到终止信号时先停止接收请求，再关闭数据库连接。
function shutdown() {
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
