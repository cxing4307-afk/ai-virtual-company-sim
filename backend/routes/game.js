import { randomUUID } from "node:crypto";

import { Router } from "express";

import { EVENT_TYPES, createEvent } from "../engine/events.js";
import { applyAction } from "../engine/rules.js";
import { buildReview } from "../engine/review.js";
import { createInitialState, getOpeningData } from "../engine/state.js";
import { getScript, listScripts } from "../scripts/loader.js";

const router = Router();
const games = new Map();
let latestGameId;

/**
 * 供对话层读取当前对局的唯一事实源。对话层只能读取或记录行为，
 * 不能借此修改由引擎规则维护的业务状态。
 */
export function getGameState(gameId) {
  return games.get(gameId);
}

function getGameId(req) {
  return req.body?.gameId ?? req.query.gameId ?? req.get("x-game-id") ?? latestGameId;
}

function findGame(req, res) {
  const gameId = getGameId(req);
  const state = games.get(gameId);
  if (!state) {
    res.status(404).json({ error: "未找到对局，请传入 gameId 或先新开一局" });
    return null;
  }
  return state;
}

// 内存仓库：本步骤刻意不写库，后续可将 Map 替换为 db.js 的持久化接口。
router.post("/new", (req, res) => {
  try {
    const state = createInitialState(req.body?.role, { gameId: randomUUID(), scriptId: req.body?.scriptId });
    const script = getScript(state.scriptId);
    games.set(state.gameId, state);
    latestGameId = state.gameId;
    return res.status(201).json({
      gameId: state.gameId,
      state,
      opening: getOpeningData(state),
      script: { id: script.id, title: script.title, company: script.company, background: script.background, duration: script.duration, roles: script.roles, npcs: script.npcs.map(({ id, name, identity }) => ({ id, name, identity })), routes: script.routes, acts: script.acts },
      events: [createEvent(EVENT_TYPES.ACT_OPENING, { act: 1, role: state.role })],
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/scripts", (_req, res) => res.json({ scripts: listScripts() }));

router.post("/review", (req, res) => {
  const state = findGame(req, res);
  if (!state) return undefined;
  return res.json(buildReview(state, req.body?.dimensions ?? []));
});

router.post("/action", (req, res) => {
  const state = findGame(req, res);
  if (!state) return undefined;
  try {
    const result = applyAction(state, { type: req.body?.type, payload: req.body?.payload });
    return res.json({ gameId: state.gameId, ...result });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/state", (req, res) => {
  const state = findGame(req, res);
  if (!state) return undefined;
  return res.json({ gameId: state.gameId, state });
});

export default router;
