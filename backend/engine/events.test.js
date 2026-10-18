import assert from "node:assert/strict";
import test from "node:test";

import { createEvent, EVENT_TYPES } from "./events.js";

test("事件类型包含且仅包含预期常量", () => {
  assert.deepEqual(EVENT_TYPES, {
    ACT_OPENING: "act_opening",
    ACT_ADVANCED: "act_advanced",
    FINANCE_WARNING: "finance_warning",
    CLIENT_PRESSURE: "client_pressure",
    DIRECTOR_REMINDER: "director_reminder",
    DM_INTERVENTION: "dm_intervention",
    GAME_SETTLED: "game_settled",
  });
});

test("事件类型被冻结", () => {
  assert.equal(Object.isFrozen(EVENT_TYPES), true);
  assert.throws(() => {
    EVENT_TYPES.ACT_OPENING = "changed";
  }, TypeError);
});

test("创建事件保留类型和数据", () => {
  const data = { act: 1 };
  assert.deepEqual(createEvent(EVENT_TYPES.ACT_OPENING, data), {
    type: EVENT_TYPES.ACT_OPENING,
    data,
  });
});

test("创建事件默认使用空数据对象", () => {
  assert.deepEqual(createEvent(EVENT_TYPES.GAME_SETTLED), {
    type: EVENT_TYPES.GAME_SETTLED,
    data: {},
  });
});

test("创建的事件只含 type 和 data", () => {
  const event = createEvent(EVENT_TYPES.CLIENT_PRESSURE, { level: 2 });
  assert.deepEqual(Object.keys(event), ["type", "data"]);
});
