# SillyTavern 多 Agent 通讯机制：原创抄鉴笔记

> 调研日期：2026-10-15。目标是提炼可独立实现的产品/架构思想，**不复制、改写或移植** SillyTavern 的 AGPL-3.0 源码、函数实现、提示词或界面文案。
>
> 透明说明：任务最初给定的 `/tmp/SillyTavern` 全量检出因仓库体积和运行时限制中断；随后在 `/tmp/SillyTavern-study` 完成提交 `06bde939` 的稀疏只读检出，包含本文引用的角色卡、群聊、World Info、事件和扩展源码。本文结论均以这些本地一手源码逐项核对。

## 结论先行

SillyTavern 可借鉴的并不是“让多个模型自由讨论”，而是一套把多角色聊天拆为四个可替换环节的办法：**角色资料、发言调度、按需知识、生命周期观察点**。本 demo 已具备“确定性规则与生成式台词分离”的关键底座；最值得增加的是一个服务端的群聊编排器与结构化剧情知识检索层。不要把数值规则、幕次推进或评价裁量交回语言模型。

## 1. Character Card：角色资料的分层

### 字段及其职责

Character Card 的 V2 数据以 `data` 为主要容器。下表按本 demo 是否需要区分“模型上下文”与“管理元数据”归纳字段；不是要求照搬其 JSON 外形。

| 字段组 | 主要字段 | 作用 | 对本 demo 的含义 |
| --- | --- | --- | --- |
| 身份与设定 | `name`、`description`、`personality`、`scenario` | 名称、稳定事实、说话/决策倾向、当前情境共同构成角色语境。 | 将现有 NPC `name`、`identity`、目标、已知/未知、红线拆成可审查字段，而非只放在一段 `prompt` 中。 |
| 对话开场与示范 | `first_mes`、`alternate_greetings`、`mes_example` | 开局台词、候选开场、语气/格式示例。 | 用于每幕首次出现、NPC 再入场和导演播报的表达一致性；示例只管风格，不承载规则。 |
| 提示词位置 | `system_prompt`、`post_history_instructions`、`extensions.depth_prompt`（含文本、深度、角色） | 允许角色拥有主提示词覆写、历史之后的约束，以及固定在特定历史深度的提醒。 | 把“永远不可越过的知识边界”置于稳定系统约束；把“第二幕只谈调研”置于随幕次刷新的短约束，避免长期对话稀释。 |
| 群聊调度 | `extensions.talkativeness` | Natural 策略中未被点名时的主动发言概率。 | 可转为 `initiative`，但教学局宜由导演设上限，避免销售或技术角色挤占学生回合。 |
| 知识关联 | `character_book`、`extensions.world` | 卡片可携带条目集，也可关联外部世界书。 | NPC 可绑定私有知识包，例如“财务术语”“一线现场”；共享项目事实应另放剧本知识包。 |
| 创作者/检索元数据 | `creator`、`character_version`、`creator_notes`、`tags`、`extensions.fav` | 用于版本、归因、管理与检索，不应被误当成所有提示词内容。 | 为教学剧本记录编写人、来源、校准状态、适用幕次、学科标签。 |

源码定位：`public/scripts/char-data.js` / `v2CharData`、`v2CharDataExtensionInfos`（字段定义）；`public/scripts/group-chats.js` / `getGroupDepthPrompts`、`getGroupCharacterCardsLazy`（群聊读取角色字段）；`getFirstCharacterMessage`（开场候选与事件点）。

### 应保留的边界

角色卡的职责是限定“谁在说话、能知道什么、如何表达”；它不应成为事实状态的写入入口。SillyTavern 的群聊会共享聊天历史，但每次生成可以只使用当前发言人的卡，或将成员资料并入同一上下文。对教学模拟而言，前者更合适：NPC 应看到经过权限裁剪的游戏投影，而不是完整内部状态。

源码定位：`public/scripts/group-chats.js` / `group_generation_mode`、`getGroupCharacterCardsLazy`。后者明确将描述、性格、场景、示例拼为群组资料，适合一般角色扮演，却会扩大教学场景中的信息泄漏面。

## 2. 群聊：发言选择与 prompt 组装

### 一次群聊回合的抽象流程

1. 取本轮学生输入；若是自动续聊则取最后一条非系统消息作为激活文本。
2. 剔除静音成员，按策略形成候选发言队列；强制指定成员、重试、续写等特殊操作优先于普通策略。
3. 逐位设置当前角色并生成一条回复；所有成员共用聊天历史，但角色资料随当前发言者切换，或按可选模式合并。
4. 用“群聊批次开始—成员被选中—批次结束”事件暴露观察点。

源码定位：`public/scripts/group-chats.js` / `generateGroupWrapper`、`group_activation_strategy`、`group_generation_mode`、`getGroupCharacterCardsLazy`；其中 `generateGroupWrapper` 先选成员、后逐个调用统一生成入口，而不是把所有 NPC 的回复交给一次生成完成。`public/script.js` / `Generate` 的群聊分流与 prompt 准备路径说明：四种策略只决定“谁按什么顺序说”，并不是四套不同的 prompt 组装器；每一位入选者都会用当时的共享历史重新建一次上下文。

### 四种策略的行为与教学取舍

| 策略 | 上游行为的原创概括 | 课堂建议 |
| --- | --- | --- |
| Natural（自然） | 从激活文本中按词识别成员名字；未触发的成员再按各自健谈度随机入队。没有任何人入队时，从偏好发言的成员中兜底随机选一位；默认阻止上一位 NPC 连续自答，除非显式允许。 | 适合自由讨论/复盘，但应设每轮最多 1–2 位 NPC，并把随机性改为可复现的带种子决策，便于教学回放。 |
| List（列表） | 按群成员的配置顺序让所有未静音成员进入本轮队列，没有基于内容的额外筛选。 | 不适合普通学生输入：六名 NPC 都说会拖慢课堂。可用于固定的“圆桌总结”或结算前逐项陈述。 |
| Pooled（轮换池） | 回看自上次学生消息以来哪些成员已发言；优先从尚未发言的人中随机挑一位。若全部已经发言，则避开上一发言人（可行时）再随机。 | 最适合确保多方声音被听到；可按“本幕尚未发言的相关角色”建池，并把相关性、知识已解锁、时间预算作为过滤条件。 |
| Manual（手动） | 用户有输入时不会自动起草 NPC；没有学生新输入而触发生成时，才从未静音成员随机取一位。另有独立的强制发言入口可直接指定成员。 | 最适合主线教学：学生点名 NPC，或由确定性导演在事件后指定应回应的 NPC；“随机空回合”不宜照搬，改为导演队列。 |

源码定位：`public/scripts/group-chats.js` / `activateNaturalOrder`、`activateListOrder`、`activatePooledOrder`、`generateGroupWrapper`。尤其应注意：Natural 可能选出多名成员，List 也会形成全员队列；这解释了为何课堂产品必须另设发言上限。

### prompt 组装的可迁移原则

群聊的上下文至少由“共享消息历史 + 本次发言者的角色资料 + 本轮已检索剧情知识 + 经授权的状态投影”构成。建议将编排器输出的 `speakerId` 作为唯一事实，再调用现有 `renderRolePrompt`；不要让模型在台词中自行选择下一位讲话者。若需要所有 NPC 彼此知情，显式生成“公共摘要”，切勿把所有私有字段无差别拼接。

源码定位：`public/scripts/group-chats.js` / `getGroupCharacterCardsLazy`（可选的角色资料拼接）、`generateGroupWrapper`（逐成员调用）；本 demo 对应 `backend/prompts/roles.js` / `renderRolePrompt` 和 `backend/prompts/permissions.js` / `filterStateFor`。

## 3. World Info：按需知识而非全量塞入

### 数据模型

一份世界书是 `entries` 的集合；每个条目可理解为“何时把哪段可控知识放到哪一处”。核心字段是：

| 维度 | 字段 | 作用 |
| --- | --- | --- |
| 标识与内容 | `uid`、`comment`、`content` | 唯一标识、作者可读备注、实际注入的知识文本。 |
| 触发 | `key`、`keysecondary`、`selectiveLogic`、`constant`、`disable` | 主关键词、附加条件、附加条件的任一/全体/否定逻辑、恒定激活、开关。 |
| 排序与位置 | `order`、`position`、`depth`、`role`、`outletName` | 条目优先级、在角色卡前后/历史深度/锚点/专用出口的位置。 |
| 范围与稳定性 | `scanDepth`、`caseSensitive`、`matchWholeWords`、`sticky`、`cooldown`、`delay` | 搜索历史深度、匹配方式、持续/冷却/延迟效果。 |
| 冲突与选择 | `group`、`groupOverride`、`groupWeight`、`useGroupScoring`、`probability`、`useProbability` | 同组候选的取舍、权重和概率。 |
| 递归 | `excludeRecursion`、`preventRecursion`、`delayUntilRecursion` | 已激活内容是否再参与下一轮检索。 |

源码定位：`public/scripts/world-info.js` / `newWorldInfoEntryDefinition`、`newWorldInfoEntryTemplate`、`world_info_logic`、`world_info_position`；`public/scripts/char-data.js` / `v2DataWorldInfoEntry`、`v2DataWorldInfoEntryExtensionInfos`。

### 关键词触发与注入流程

1. 汇总全局、角色、聊天、Persona 四个来源的条目；按配置将全局与角色来源交错或置前，并保留聊天与 Persona 作用域。
2. 把近期聊天（受深度上限约束）放进扫描缓冲；如设置了可扫描的扩展提示词，也一并加入。条目可以永远激活，也可以按关键词先匹配主键，再判定副键逻辑。
3. 对候选实施角色筛选、冷却/延迟/粘滞、分组、概率与 token 预算。若启用递归，把成功条目的内容加入下一轮扫描；若设置最低激活数量，可逐步扩展历史搜索深度。
4. 按注入位置和 `order` 排序，把最终内容装配为卡片前后文本、历史深度消息、锚点文本或指定 outlet；随后与角色资料和聊天历史共同形成模型请求。每位群聊发言者都在自己的生成前重算这一步：默认扫描该发言者的角色字段；只有启用组卡合并模式时才扫描合并后的字段。

源码定位：`public/scripts/world-info.js` / `getSortedEntries`（来源汇总）、`WorldInfoBuffer`（扫描缓冲）、`checkWorldInfo`（筛选主循环）、`matchSecondaryKeys`（副键逻辑）、`getWorldInfoPrompt`（返回注入结果）、`world_info_position`（投放位置）；`public/script.js` / 生成前 World Info 准备路径，以及 `public/scripts/openai.js` / `prepareOpenAIMessages`（Chat Completion 将前后知识放入消息提示）共同完成实际注入。

### 对本 demo 的正确用法

将世界书思想改名为“剧情知识条目”：例如“甲方罚款条款”“供应商底价条件”“下车间后可得的一线证据”“第二幕交叉验证要求”。条目应含 `scope`（剧本/角色/公共）、`when`（幕次、事件、行动、关键词）、`audience`（学生、某 NPC、导演）、`priority`、`tokenBudget` 和 `factRef`。其中 `unlockedInformation`、预算、工期、指标只能来自规则引擎的结构化事实；检索层只选择解释材料，不能写状态。

这比把全部剧本背景塞进所有 NPC prompt 更省上下文，并能精确审计“某条消息为何看到了某事实”。

## 4. 扩展 hook：可观察、可干预，但要限权

上游可借鉴的关键观察点如下；本 demo 应自行定义同义事件，不能依赖上游实现或事件命名。

| 时点 | 上游定位 | 可迁移用途 | 本 demo 的限制 |
| --- | --- | --- | --- |
| 应用/扩展启动与设置 | `public/scripts/events.js` / `event_types`；`public/scripts/extensions.js` / `loadExtensionSettings`、`activateExtensions` | 装载剧本插件、初始化评价观察者。 | 插件只能注册，不能直接修改游戏状态。 |
| 生成前后与请求就绪 | `public/scripts/events.js` / `GENERATE_BEFORE_COMBINE_PROMPTS`、`GENERATE_AFTER_COMBINE_PROMPTS`、`CHAT_COMPLETION_PROMPT_READY`、`GENERATION_STARTED/ENDED` | 记录 prompt 组成、token 预算、模型耗时；在构建前添加经过审批的剧情知识。 | 日志需脱敏；禁止插件改写确定性事件结果。 |
| 群聊批次与成员 | `public/scripts/group-chats.js` / `generateGroupWrapper` 发出的 `GROUP_WRAPPER_STARTED`、`GROUP_MEMBER_DRAFTED`、`GROUP_WRAPPER_FINISHED` | 统计谁被选中、为何选中、发言是否公平；导演可在批次前排队。 | `speakerId` 应由服务端编排器最终裁决。 |
| 消息与渲染 | `public/scripts/events.js` / `MESSAGE_SENT`、`MESSAGE_RECEIVED`、`MESSAGE_UPDATED`、`CHARACTER_MESSAGE_RENDERED` | 保存可复盘的对话审计记录，驱动前端消息流。 | 将“台词生成成功”与“规则行动已生效”分成两类事件。 |
| 世界书加载/扫描 | `public/scripts/world-info.js` / `getSortedEntries`、`checkWorldInfo`；`public/scripts/events.js` / `WORLDINFO_ENTRIES_LOADED`、`WORLDINFO_SCAN_DONE` | 输出命中条目、预算耗用和命中原因，支持教师查看检索解释。 | 扩展可观察或建议候选，不可伪造解锁事实。 |
| 扩展清单与生命周期 | `public/scripts/extensions.js` / `getManifests`、`callExtensionHook`、`runGenerationInterceptors` | 通过 manifest 声明版本/依赖；使用 install、enable、disable、clean 等生命周期钩子。 | 生成拦截器有中止能力，教学系统只给可信的服务端模块，且必须设置超时和失败降级。 |

特别值得借鉴的是“世界书扫描循环向监听器传递结构化参数后再接回允许变更的字段”的模式：它使扩展可以参与策略而不必复制主流程。教学版应进一步收紧成命令式接口，例如 `recommendKnowledge()`、`recordObservation()`，而不是交给任意插件改整个上下文或状态。

源码定位：`public/scripts/world-info.js` / `checkWorldInfo` 在扫描循环后发出 `WORLDINFO_SCAN_DONE`；`public/scripts/extensions.js` / `runGenerationInterceptors`、`callExtensionHook`；`public/scripts/events.js` / `event_types`。

## 5. 对本 demo 的逐条映射建议

| 区域 | 当前基础 | 建议新增/调整 | 不应做的事 |
| --- | --- | --- | --- |
| `backend/prompts/` | `renderRolePrompt` 已按角色生成，`filterStateFor` 已限制可见状态，导演有独立 prompt。 | 新建原创的 `renderGroupTurnPrompt` 概念：接受 `speaker`、共享摘要、角色可见状态、已命中知识、当幕短约束；将现有长 prompt 切为角色资料与可变注入两层。 | 不把完整 `state` 或其他 NPC 私有资料拼给所有发言者；不让 prompt 决定数值。 |
| `backend/scripts/` | 两个 JSON 剧本已保存角色、路线、幕次、NPC prompt 与可见字段。 | 增加 `lore`/`knowledgeEntries`（原创 schema）：`id`、`content`、`scope`、`when`、`audience`、`priority`、`budget`、`factRef`；把校准标记和来源也结构化。 | 不在 JSON 里存可执行代码或未审校的“模型自行判断”规则。 |
| `backend/engine/` | `applyAction` 是状态唯一写入口；`advanceDirector` 推进幕次；`events.js` 有结构化领域事件。 | 新建服务端 `turnScheduler`：先按 Manual/Pooled 的教学化规则产生 `speakerId`，再生成；新建只读 `knowledgeResolver`，返回命中条目和理由；为 `speaker_selected`、`knowledge_resolved`、`reply_generated` 添加独立事件。 | 不把调度/检索写进 `applyAction`，更不能让 LLM 回写 `budget`、`schedule`、`metric`、`currentAct`。 |
| `backend/routes/` | `/api/game/action` 处理确定性行动；`/api/game/dialog` 当前是一问一答并在后端记录历史。 | 增设明确的群聊回合端点或把 `/dialog` 演化为返回 `messages[]`、`selectionReason`、`knowledgeTrace`；每个生成前先由引擎冻结状态快照。 | 不依赖客户端声明“下一位是谁”或“知识已解锁”；不要让 `/api/chat` 成为绕过权限/规则的后门。 |
| `frontend/` | 当前按 NPC 单独对话，已有导演消息区、事件文本和状态栏。 | 增加统一时间线，展示说话者、学生点名、导演指定、候选队列；教师/调试模式显示“本轮使用了哪些知识”，学生默认不显示内部提示词和隐藏事实。 | 不把完整提示词、NPC 私密知识或内部规则事件直接发到浏览器。 |

### 本次“我们抄什么”的实际落点

这里的“抄”只指吸收思想后独立实现，不指复制上游代码。

1. 抄“角色资料结构化、渲染时组 prompt”的分层：`backend/scripts/cards/*.json` 保存原创中文角色卡；`backend/scripts/handong.json` 与 `gaowen.json` 只引用 `cardId`；`backend/scripts/loader.js` 校验并解析引用；`backend/prompts/roles.js` 和 `dm.js` 自行渲染。
2. 抄“知识按需扫描、命中后注入”的流程：两个剧本各自保存 `world_info`；`backend/engine/worldinfo.js` 做确定性关键词和受众过滤；`backend/routes/dialog.js` 只把当前 NPC 命中的片段附加到本轮 system prompt。
3. 抄“发言者由编排层指定、每位角色单独生成”的原则：剧本 `director_dispatch` 把结构化事件映射到 NPC；`backend/routes/dialog.js` 用该 NPC 的卡片、权限状态和事件上下文单独调模型，并在每幕成功两次后停止。
4. 抄“消息生命周期可观察”的界面结果：`frontend/app.js` 把导演调度返回的台词作为目标 NPC 气泡写入对应会话，并显示“（导演调度）”；模型或 key 失败时，原确定性导演事件文本仍保留。
5. 不抄随机群聊和全角色卡合并：Natural/List/Pooled 只作为未来可选策略记录；当前教学主线采用 Manual 风格的学生点名与确定性事件指定，继续由 `backend/engine/rules.js` 独占数值状态变更。

### 建议的服务端回合边界

```text
学生输入/确定性事件
  → 规则引擎冻结 state snapshot
  → 调度器选 speaker（可解释、可复现）
  → 知识解析器按 scope 与权限取条目
  → prompt 渲染器构造该 speaker 的请求
  → 模型仅生成台词
  → 审计事件 + 前端消息流
  → 若识别到教学行动，再调用 applyAction
```

其中最后一步仍应由现有 `backend/engine/rules.js` / `applyAction` 决定状态变更；模型回复和关键词识别最多生成“待验证行动建议”。这保留了现有“AI 只演、引擎只算”的设计优势。

## 版权与复用边界

1. 上游 SillyTavern 使用 AGPL-3.0；本笔记只记录可独立重做的抽象、行为观察和文件/符号定位，不含其函数体、算法源码、原注释、UI 文案、角色卡文本或逐句改写。
2. 本 demo 后续应以自己的数据模型、函数命名、控制流、测试和界面重新实现；即使功能相似，也不应从上游复制粘贴代码。
3. 若未来实际引入、修改或分发上游 AGPL 代码，而不是仅借鉴思想，应另行进行许可证与发布义务审查；本文件不构成法律意见。
4. 上游定位用于研究可追溯性，不等于授权复制；本次已用 `/tmp/SillyTavern-study` 的提交 `06bde939` 稀疏工作树复核本文涉及的源码文件。
