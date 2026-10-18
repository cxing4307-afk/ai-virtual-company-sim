# 部署指南

## 环境要求

- Node.js 18 或更高版本（现有运行说明的要求）。
- npm，以及可编译/安装 `better-sqlite3` 的运行环境；依赖由 `npm install` 安装。
- 可选的 DeepSeek API Key。没有可用密钥时，页面和确定性规则操作仍可使用，但 NPC 对话和模型导演播报不可用。

项目的启动脚本为 `npm start`，实际执行 `node backend/server.js`；测试脚本为 `npm test`。

## 环境变量

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `PORT` | HTTP 监听端口 | `3000` |
| `DEEPSEEK_API_KEY` | 服务端模型密钥；运行时网页提交的内存密钥优先于它 | 无 |
| `DEEPSEEK_BASE_URL` | DeepSeek 兼容 API 根地址 | `https://api.deepseek.com` |
| `DATABASE_PATH` | SQLite 数据库路径 | `data/demo.db`（相对启动工作目录） |

## 启动步骤

```bash
cd ~/workspace/projects/ai-edu-simulation/demo
npm install
export DEEPSEEK_API_KEY='你的密钥'  # 可选；也可在首页临时填写
npm start
```

然后访问 `http://localhost:3000`。服务会初始化 SQLite，并把 `frontend/` 作为静态站点提供。用 `GET /api/health` 可做存活检查。

## 密钥与浏览器边界

不要把 API Key 写进前端代码、静态 HTML、提交到仓库或暴露给浏览器脚本。首页填写的 key 通过 `POST /api/config/key` 发送到服务端后，只存于 Node 当前进程的内存：不写文件、数据库或日志，重启即失效。生产部署优先通过受限的服务进程环境变量注入 `DEEPSEEK_API_KEY`，并限制环境变量、日志和运维平台的访问权限。

目前后端没有认证、限流或多租户隔离；若公开部署，应在反向代理或应用层补充访问控制、TLS、请求大小/频率限制及审计策略。不要将通用 `/api/chat` 无保护地暴露到公网，以免被当作模型代理滥用。

## SQLite 与备份

`db.js` 默认创建 `data/demo.db`，可用 `DATABASE_PATH` 改到持久化卷的绝对路径。数据库启用 WAL 模式，因此备份时应使用 SQLite 的一致性备份方式，或在停止服务后同时保留主数据库及其 WAL 相关文件；请先在演练环境验证恢复流程。

重要限制：目前游戏对局保存在 `routes/game.js` 的内存 `Map`，不会写入 SQLite。重启进程会丢失进行中的对局、行为记录和教师复核记录；现有 SQLite 只有 `schema_migrations` 占位表。数据库备份不能替代对局持久化方案。

## 迁移 PostgreSQL 的预留点

业务层的数据库入口集中在 `backend/db.js`：`initializeDatabase`、`closeDatabase`、`saveGameState` 与 `loadGameState`。后两者当前是 TODO，而 `game.js` 仍直接操作内存 Map。迁移应先在 `db.js` 实现连接、迁移和状态序列化，再把 `game.js` 的创建、读取与更新改为调用该封装；同时为并发更新和教师复核历史设计事务/锁。完成前不要宣称对局已持久化。

## 端口与反向代理

应用通过 `PORT` 监听本机端口；生产环境通常让 Node 仅绑定在内部网络，由 Nginx、Caddy 或云负载均衡器终止 TLS 并反向代理到该端口。代理应保留 JSON 请求体、合理设置上游超时（模型网关自身默认 30 秒），并配置 `/api/health` 健康检查。若将应用置于子路径，当前前端使用以 `/api/` 开头的绝对 API 路径，部署前需要确认代理能把该路径正确转发；代码未提供可配置的前缀，其他改造需求待确认。
