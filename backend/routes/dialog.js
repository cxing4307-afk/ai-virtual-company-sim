import { Router } from "express";

import { applyAction } from "../engine/rules.js";
import { detectOffTopic } from "../engine/dmcontrol.js";
import { createEvent, EVENT_TYPES } from "../engine/events.js";
import { findWorldInfo, renderWorldInfo } from "../engine/worldinfo.js";
import { requestChat } from "../gateway/deepseek.js";
import { renderDmPrompt } from "../prompts/dm.js";
import { filterStateFor, normalizeNpcId } from "../prompts/permissions.js";
import { getNpcIds, renderRolePrompt } from "../prompts/roles.js";
import { getScript } from "../scripts/loader.js";
import { getGameState } from "./game.js";

const MAX_HISTORY_TURNS = 10;
const MAX_SUMMARY_LENGTH = 80;

function actionForDialog(message, npcId, scriptId) {
  const topic = getScript(scriptId).dialogTopics.find((candidate) => new RegExp(candidate.pattern).test(message))?.topic;
  return topic
    ? { type: "ask", payload: { topic, targetNpc: npcId, contentSummary: summarize(message) } }
    : { type: "dialog", payload: { targetNpc: npcId, contentSummary: summarize(message) } };
}

function summarize(text) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > MAX_SUMMARY_LENGTH ? `${normalized.slice(0, MAX_SUMMARY_LENGTH)}…` : normalized;
}

function dmStateSummary(state) {
  return `第 ${state.currentAct} 幕；预算 ${state.budget.used}/${state.budget.limit} 万元；工期 ${state.schedule.used}/${state.schedule.limit} 天；当前${state.metric.name} ${state.metric.value}${state.metric.unit}；甲方信任 ${state.clientTrust}。`;
}

/** NPC 的摘要严格从权限过滤结果生成，避免全局摘要绕过权限表。 */
function visibleStateSummary(visibleState) {
  return `仅限以下可见状态：${JSON.stringify(visibleState)}`;
}

function historySummary(history) {
  if (!history?.length) return "暂无历史对话。";
  return history.map((turn) => `学生：${turn.message}；NPC：${turn.reply}`).join("\n");
}

function decisionSummary(state) {
  const records = state.behaviorRecords.slice(-10);
  if (!records.length) return "暂无决策记录。";
  return records.map((record) => `${record.type}${record.targetNpc ? `(${record.targetNpc})` : ""}：${record.contentSummary ?? "无摘要"}`).join("；");
}

function extractReply(body) {
  const reply = body?.choices?.[0]?.message?.content;
  return typeof reply === "string" && reply.trim() ? reply.trim() : null;
}

function validateGame(gameId, res) {
  const state = getGameState(gameId);
  if (!state) {
    res.status(404).json({ error: "未找到对局，请传入有效 gameId" });
    return null;
  }
  return state;
}

function offTopicIntervention(result) {
  if (!result.level) return null;
  const actions = { 1: "gentle_redirect", 2: "structured_redirect", 3: "firm_redirect" };
  return createEvent(EVENT_TYPES.DM_INTERVENTION, {
    priority: result.level === 3 ? "high" : "low",
    trigger: `off_topic_level_${result.level}`,
    action: actions[result.level],
    stateChange: { offTopicLevel: result.level, reason: result.reason },
    scoreImpact: "none",
  });
}

/**
 * 以工厂形式导出，便于测试替换网关；生产环境使用默认网关。
 * 历史只保存在进程内，按每局、每个 NPC 最多十轮截断。
 */
export function createDialogRouter({ requestChatFn = requestChat } = {}) {
  const router = Router();
  const histories = new Map();
  const dispatchLocks = new Map();

  async function withDispatchLock(key, task) {
    const previous = dispatchLocks.get(key) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const queued = previous.then(() => gate);
    dispatchLocks.set(key, queued);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (dispatchLocks.get(key) === queued) dispatchLocks.delete(key);
    }
  }

  function getHistory(gameId, npcId) {
    const key = `${gameId}:${npcId}`;
    if (!histories.has(key)) histories.set(key, []);
    return histories.get(key);
  }

  router.post("/dialog", async (req, res) => {
    const { gameId, npcId: rawNpcId, message } = req.body ?? {};
    const state = validateGame(gameId, res);
    if (!state) return undefined;
    const npcId = normalizeNpcId(rawNpcId, state.scriptId);
    if (!getNpcIds(state.scriptId).includes(npcId)) return res.status(400).json({ error: "npcId 不合法" });
    if (typeof message !== "string" || !message.trim()) return res.status(400).json({ error: "message 不能为空" });

    const visibleState = filterStateFor(npcId, state);
    const history = getHistory(gameId, npcId);
    const worldInfo = renderWorldInfo(findWorldInfo(getScript(state.scriptId).world_info, { message, npcId }));
    const system = renderRolePrompt(npcId, {
      stateSummary: visibleStateSummary(visibleState),
      visibleInfo: JSON.stringify(visibleState),
      historySummary: historySummary(history),
      worldInfo,
      scriptId: state.scriptId,
    });
    const result = await requestChatFn({
      messages: [{ role: "user", content: message.trim() }],
      system,
      baseURL: process.env.DEEPSEEK_BASE_URL,
    });

    if (result.status !== 200) return res.status(result.status).json(result.body);
    const reply = extractReply(result.body);
    if (!reply) return res.status(502).json({ error: "模型服务返回格式异常，请稍后重试" });

    history.push({ message: summarize(message), reply: summarize(reply) });
    if (history.length > MAX_HISTORY_TURNS) history.splice(0, history.length - MAX_HISTORY_TURNS);
    const action = actionForDialog(message, npcId, state.scriptId);
    const actionResult = applyAction(state, action);
    const dialogRounds = state.behaviorRecords
      .filter((record) => record.type === "ask" || record.type === "dialog")
      .map((record) => ({ text: record.contentSummary, isEffective: record.type === "ask" }));
    const offTopic = detectOffTopic(dialogRounds, { afterPullback: state.flags.offTopicPullbackIssued });
    if (offTopic.level >= 2) state.flags.offTopicPullbackIssued = true;
    const intervention = offTopicIntervention(offTopic);
    return res.json({ reply, mapped: action.type === "ask", offTopic, ...actionResult, events: intervention ? [...actionResult.events, intervention] : actionResult.events });
  });

  router.post("/dm", async (req, res) => {
    const { gameId, trigger, event } = req.body ?? {};
    const state = validateGame(gameId, res);
    if (!state) return undefined;
    if (!trigger) return res.status(400).json({ error: "trigger 不能为空" });

    const triggerSummary = summarize(typeof trigger === "string" ? trigger : JSON.stringify(trigger));
    const script = getScript(state.scriptId);
    const dispatch = event?.type ? script.director_dispatch?.find((item) => item.eventType === event.type) : null;
    if (dispatch) {
      const lockKey = `${gameId}:${state.currentAct}`;
      return withDispatchLock(lockKey, async () => {
        const used = state.directorDispatchCounts?.[state.currentAct] ?? 0;
        if (used >= 2) return res.json({ reply: "每幕调度次数已用完，保留结构化事件播报。" });
        const npc = script.npcs.find((item) => item.id === dispatch.npcId);
        const visibleState = filterStateFor(npc.id, state);
        const history = getHistory(gameId, npc.id);
        const eventContext = JSON.stringify({ type: event.type, data: event.data ?? {} });
        const system = renderRolePrompt(npc.id, {
          stateSummary: visibleStateSummary(visibleState),
          visibleInfo: JSON.stringify(visibleState),
          historySummary: historySummary(history),
          eventContext,
          scriptId: state.scriptId,
        });
        const result = await requestChatFn({
          messages: [{ role: "user", content: `导演要求你回应当前事件：${triggerSummary}` }],
          system,
          baseURL: process.env.DEEPSEEK_BASE_URL,
        });
        if (result.status !== 200) return res.status(result.status).json(result.body);
        const reply = extractReply(result.body);
        if (!reply) return res.status(502).json({ error: "模型服务返回格式异常，请稍后重试" });
        history.push({ message: `[导演事件] ${triggerSummary}`, reply: summarize(reply) });
        if (history.length > MAX_HISTORY_TURNS) history.splice(0, history.length - MAX_HISTORY_TURNS);
        state.directorDispatchCounts[state.currentAct] = used + 1;
        return res.json({ reply: triggerSummary, scheduledDialog: { npcId: npc.id, name: npc.name, reply, directed: true } });
      });
    }

    const system = renderDmPrompt({
      stateSummary: dmStateSummary(state),
      trigger: triggerSummary,
      decisionSummary: decisionSummary(state),
      scriptId: state.scriptId,
    });
    const result = await requestChatFn({
      messages: [{ role: "user", content: `请播报本次导演事件：${triggerSummary}` }],
      system,
      baseURL: process.env.DEEPSEEK_BASE_URL,
    });

    if (result.status !== 200) return res.status(result.status).json(result.body);
    const reply = extractReply(result.body);
    if (!reply) return res.status(502).json({ error: "模型服务返回格式异常，请稍后重试" });
    return res.json({ reply });
  });

  return router;
}

export default createDialogRouter();
