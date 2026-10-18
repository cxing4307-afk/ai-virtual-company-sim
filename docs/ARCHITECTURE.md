# 系统架构

本 Demo 把「发生什么」与「怎么说」分开：服务端确定性引擎维护可核查的游戏事实；DeepSeek 只生成 NPC/导演的语言；浏览器只负责展示和发起请求。Express 默认端口为 `3000`，并把 `frontend/` 作为静态站点提供。

## 四个组成部分

### 确定性规则引擎

`backend/engine/` 是对局事实的唯一裁决者。`state.js` 根据剧本建立初始状态；`rules.js` 的 `applyAction` 记录行为、应用路线与特殊动作的预算/工期/指标效果、产生预警并保存状态快照；`director.js` 推进三幕、结算预算/工期/指标三项硬约束；`events.js` 只产出不可变结构化事件。`review.js` 组织复盘数据，`rubric.js` 基于可追溯记录提出教师复核前的建议分，`worldinfo.js` 以确定性关键字匹配选择背景条目。

当前对局保存在 `routes/game.js` 的进程内 `Map` 中。SQLite 在启动时由 `db.js` 初始化为迁移占位表，游戏状态的读写接口仍是预留实现，尚未接入该 `Map`。

### DeepSeek 模型网关

`gateway/deepseek.js` 统一调用兼容聊天补全接口：组装 system message、使用 `deepseek-chat` 模型、30 秒超时、将上游失败统一为安全的 `502` 中文错误。密钥优先级为：运行时内存密钥、调用传入密钥、`DEEPSEEK_API_KEY` 环境变量；上游地址可由 `DEEPSEEK_BASE_URL` 覆盖。

### NPC / DM 提示词与权限

`prompts/roles.js` 从剧本角色卡生成 NPC system prompt，注入角色身份、目标、知识边界、红线、可见状态、最近对话和按需 World Info。角色共同红线明确要求「只影响怎么说，绝不决定发生什么」。`permissions.js` 按每个 NPC 的 `visibleFields` 白名单过滤状态；NPC 摘要只从该过滤结果生成。`prompts/dm.js` 则以导演卡、全局状态摘要、触发事件和决策摘要组装导演 prompt。

`routes/dialog.js` 保留每局、每个 NPC 最近十轮摘要，并将同一局/幕的导演调度串行化；剧本定义的事件可以调度 NPC，每幕最多两次。

### 纯前端

`frontend/index.html` 与 `app.js` 是无构建步骤的原生浏览器界面。它加载剧本、采集可选 API Key、创建对局、展示状态/对话/导演播报、发起确定性动作，并绘制过程评价和教师复盘。前端不包含模型密钥，也不计算服务端权威状态；模型不可用时仍保留结构化事件和规则操作。

## 一次完整对局的数据流

```text
浏览器 app.js
  → /api/game/new：game.js 创建 state，返回开幕 event
  → /api/game/action：game.js → rules.applyAction → director/events → state + events
  → /api/game/dialog：dialog.js 读取 state
       → permissions.filterStateFor + roles.renderRolePrompt + worldinfo
       → deepseek.requestChat → NPC 文本
       → rules.applyAction(ask/dialog) → state + events
  → 前端收到 events 后调用 /api/game/dm
       → 命中调度：权限过滤 → NPC prompt → 网关
       → 否则：dm.renderDmPrompt → 网关 → 导演文本
  → /api/game/review、/teacher-review-score：由已记录 state 生成复盘/建议分
```

一局从岗位选择开始：`/new` 建立初始状态和开幕事件；玩家通过按钮或对话推进。第一幕确认问题、预算、工期三项标记（或超时）进入第二幕，提交方案（或超时）进入第三幕，结算时由引擎核验三项硬约束。前端把结构化事件先显示为确定性播报，再尽力请求导演润色；没有密钥时，后一步失败不会抹去前一步的规则结果。

## 为什么 AI 只能「演」，不能改数

- 预算、工期、指标、信任度、幕次、结算结果只在服务端状态对象中维护；实际写入由 `rules.js` 的 `applyAction`、`director.js` 的 `advanceDirector/evaluateSettlement` 完成。
- 模型调用的返回值在 `dialog.js` 中只取 `choices[0].message.content` 作为 `reply`；没有任何代码把模型文本解析为动作、预算、工期或结算字段。
- NPC 只收到 `filterStateFor` 输出的可见字段，且角色 prompt 写明不能决定发生什么、不能泄露不可见信息。World Info 也先由 `worldinfo.js` 的字面关键词和 NPC 限制确定，再注入 prompt。
- 对话导致的规则记录由服务端将学生原话映射为 `ask` 或 `dialog` 后调用 `applyAction`；映射规则来自剧本 `dialogTopics`，不是模型决定。导演调度同样由结构化 `event.type` 对照剧本 `director_dispatch` 决定。
- 即使模型不可用，`/api/game/action` 与引擎仍能推进、预警、结算与复盘。因此模型输出不能绕过规则，也不能成为状态权威来源。
