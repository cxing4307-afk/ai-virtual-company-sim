/**
 * 引擎事件类型。事件只描述发生了什么及其结构化数据，任何面向玩家的文案
 * 均由后续导演层根据事件生成，不能由规则层生成。
 */
export const EVENT_TYPES = Object.freeze({
  ACT_OPENING: "act_opening",
  ACT_ADVANCED: "act_advanced",
  FINANCE_WARNING: "finance_warning",
  CLIENT_PRESSURE: "client_pressure",
  DIRECTOR_REMINDER: "director_reminder",
  GAME_SETTLED: "game_settled",
});

/** 创建不可变的结构化事件。 */
export function createEvent(type, data = {}) {
  return { type, data };
}
