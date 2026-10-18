# HTTP API

服务默认监听 `http://localhost:3000`。所有写请求使用 JSON；服务端启用 `express.json({ limit: "1mb" })`。除非另行说明，响应均为 JSON。游戏接口按 `gameId` 查找对局；`/action`、`/review` 与 `/state` 也可从查询参数或 `x-game-id` 读取，最后才回退到本进程最近新建的一局。对局状态只保存在服务进程内。

## 健康检查

### `GET /api/health`

请求参数：无。

返回：`{ "ok": true }`。

```bash
curl http://localhost:3000/api/health
```

## 模型与运行时配置

### `POST /api/chat`

直接转发 DeepSeek 兼容的聊天补全请求。请求体：`messages`（必填，数组）、`system`（可选，字符串，默认空）。`messages` 不是数组时返回 `400` 与 `{ "error": "messages 必须是数组" }`；成功时原样返回模型 JSON，网关错误见下文。

```bash
curl -X POST http://localhost:3000/api/chat \
  -H 'content-type: application/json' \
  -d '{"system":"你是助手","messages":[{"role":"user","content":"你好"}]}'
```

示例成功返回（模型原始结构，字段由模型服务决定）：

```json
{"id":"…","choices":[{"message":{"role":"assistant","content":"你好"}}]}
```

### `POST /api/config/key`

将密钥仅写入当前 Node 进程内存。请求体：`key`（必填，非空字符串）；无效时返回 `400` 与 `{ "error": "key 不能为空" }`。成功返回 `{ "ok": true }`。

```bash
curl -X POST http://localhost:3000/api/config/key \
  -H 'content-type: application/json' \
  -d '{"key":"sk-…"}'
```

## 对局

### `GET /api/game/scripts`

请求参数：无。返回首页所需的轻量剧本列表，不包含角色卡提示词：`{ "scripts": [{ "id", "title", "background", "company", "duration", "roles" }] }`。

```bash
curl http://localhost:3000/api/game/scripts
```

### `POST /api/game/new`

新建一局。请求体：`role`（必填，所选剧本的岗位 ID）、`scriptId`（可选，默认 `handong`）。岗位或剧本无效时返回 `400` 与错误信息。

成功返回 `201`：`gameId`、完整 `state`、`opening`（`act`、`role`、`knownInformation`、`constraints`）、`script`（公开剧本信息、NPC 名称/身份、路线和幕信息）及开幕 `events`。

```bash
curl -X POST http://localhost:3000/api/game/new \
  -H 'content-type: application/json' \
  -d '{"scriptId":"handong","role":"方案"}'
```

### `POST /api/game/action`

执行确定性游戏动作。请求体：`gameId`（建议必填；亦可用查询参数、`x-game-id` 或最近一局）、`type`（必填）、`payload`（可选对象）。合法动作由剧本路线和引擎定义，例如 `clarify_problem`、`clarify_budget`、`clarify_schedule`、`visit_workshop`、`choose_preheat`、`choose_insulation`、`submit_plan`、`settle`；对话层也会记录 `ask` 与 `dialog`。缺局返回 `404`，动作无 `type`、已结算或其他规则错误返回 `400`。

成功返回 `{ "gameId", "state", "events" }`；`events` 是如 `act_advanced`、`finance_warning`、`game_settled` 的结构化事件数组。

```bash
curl -X POST http://localhost:3000/api/game/action \
  -H 'content-type: application/json' \
  -d '{"gameId":"<gameId>","type":"clarify_budget","payload":{}}'
```

### `GET /api/game/state`

请求参数：`gameId`（查询参数；也可由 `x-game-id` 或最近一局提供）。成功返回 `{ "gameId": "…", "state": { … } }`；找不到对局时返回 `404`。

```bash
curl 'http://localhost:3000/api/game/state?gameId=<gameId>'
```

### `POST /api/game/dialog`

向一个 NPC 对话并获取模型回复。请求体：`gameId`（必填）、`npcId`（必填，可使用剧本别名）、`message`（必填，非空字符串）。无对局返回 `404`；未知 NPC 或空消息返回 `400`。模型不可用时透传网关状态，模型成功却没有文本回复时返回 `502`。

成功返回 `{ "reply", "mapped", "state", "events" }`：`mapped` 表示本轮消息是否匹配剧本的 `dialogTopics` 并被记录为 `ask`；规则引擎会在返回的 `state`/`events` 中体现该记录所触发的确定性变化。

```bash
curl -X POST http://localhost:3000/api/game/dialog \
  -H 'content-type: application/json' \
  -d '{"gameId":"<gameId>","npcId":"wang_manager","message":"预算红线是多少？"}'
```

### `POST /api/game/dm`

请求导演播报，或在特定结构化事件中调度 NPC。请求体：`gameId`（必填）、`trigger`（必填，任意真值）、`event`（可选，含 `type` 与可选 `data`）。无对局返回 `404`，缺少 `trigger` 返回 `400`。每局每幕针对 `director_dispatch` 的调度最多两次；达到上限时直接返回固定播报。

普通成功返回 `{ "reply": "…" }`；命中剧本调度时返回 `{ "reply": "触发摘要", "scheduledDialog": { "npcId", "name", "reply", "directed": true } }`。

```bash
curl -X POST http://localhost:3000/api/game/dm \
  -H 'content-type: application/json' \
  -d '{"gameId":"<gameId>","trigger":"财务预警","event":{"type":"finance_warning","data":{}}}'
```

## 复盘与教师复核

### `POST /api/game/review`

请求体：`gameId`（建议必填；查找规则同 `/action`）、`dimensions`（可选数组，前端过程评价结果）。成功返回 `{ "script", "timeline", "curves", "dialogs", "dimensions", "directorComment", "result", "metric" }`，用于教师复盘页；找不到对局返回 `404`。

```bash
curl -X POST http://localhost:3000/api/game/review \
  -H 'content-type: application/json' \
  -d '{"gameId":"<gameId>","dimensions":[]}'
```

### `POST /api/game/teacher-review-score`

读取规则引擎的六维建议分与本局已有教师复核记录。请求体：`gameId`（必填、非空字符串）。缺失或空值返回 `400`；找不到对局返回 `404`。

成功返回 `{ "dimensions": [ { "key", "name", "weight", "score", "band", "evidence", "needsTeacherReview" } ], "teacherReviews": {} }`。

```bash
curl -X POST http://localhost:3000/api/game/teacher-review-score \
  -H 'content-type: application/json' \
  -d '{"gameId":"<gameId>"}'
```

### `POST /api/game/teacher-review-confirm`

确认或调整一项建议分，并把复核历史追加到当前局内存状态。请求体：`gameId`（必填）、`dimensionKey`（必填，来自上接口）、`action`（`confirm` 或 `adjust`）、`score`（仅 `adjust` 时必填，`0`–`100` 整数）、`note`（可选字符串）。无效字段返回 `400`，无对局返回 `404`。

成功返回 `{ "teacherReview": { "action", "originalScore", "finalScore", "note", "time" }, "teacherReviews": { … } }`。确认不会改写引擎建议分；调整仅追加教师记录。

```bash
curl -X POST http://localhost:3000/api/game/teacher-review-confirm \
  -H 'content-type: application/json' \
  -d '{"gameId":"<gameId>","dimensionKey":"constraint_awareness","action":"adjust","score":85,"note":"课堂观察补充"}'
```

## 网关错误约定

`/api/chat`、`/api/game/dialog` 与 `/api/game/dm` 共用 DeepSeek 网关：未找到运行时密钥、调用参数密钥或 `DEEPSEEK_API_KEY` 时返回 `400` 与 `{ "error": "服务端未配置 DeepSeek API 密钥" }`；上游非成功状态、超时或网络异常返回 `502` 与相应中文错误。`DEEPSEEK_BASE_URL` 可改变上游根地址，网关会追加 `/chat/completions`。
