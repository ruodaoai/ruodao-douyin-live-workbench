import test from "node:test";
import assert from "node:assert/strict";
import { DemoSource, createGiftEvent, normalizeIncomingEvent } from "../lib/events.mjs";
import { DEFAULT_SETTINGS } from "../lib/catalog.mjs";
import { mulberry32 } from "../lib/util.mjs";

const T0 = 1_760_000_000_000;

test("归一化：工作台标准礼物事件", () => {
  const event = normalizeIncomingEvent({
    id: "e1",
    type: "gift",
    ts: T0,
    user: { id: "u1", name: "小鹿" },
    gift: { id: "rocket", name: "火箭" },
    count: 2,
  }, { settings: DEFAULT_SETTINGS, now: T0 });
  assert.equal(event.type, "gift");
  assert.equal(event.gift.id, "rocket");
  assert.equal(event.gift.heat, 1000);
  assert.equal(event.totalHeat, 2000);
  assert.equal(event.count, 2);
});

test("归一化：Webcast 风格消息与自定义礼物热度", () => {
  const settings = { ...DEFAULT_SETTINGS, giftHeat: { ...DEFAULT_SETTINGS.giftHeat, crown: 555 } };
  const event = normalizeIncomingEvent({
    method: "WebcastGiftMessage",
    msgId: "m1",
    createTime: T0,
    payload: {
      user: { id: "u2", nickname: "榜一大哥" },
      gift: { id: "crown", name: "皇冠", diamond_count: 888 },
      repeat_count: 3,
    },
  }, { settings, now: T0 });
  assert.equal(event.type, "gift");
  assert.equal(event.user.name, "榜一大哥");
  assert.equal(event.gift.name, "皇冠");
  assert.equal(event.gift.heat, 555);
  assert.equal(event.count, 3);
  assert.equal(event.totalHeat, 1665);
});

test("归一化：评论、房间统计与未知类型", () => {
  const comment = normalizeIncomingEvent({
    type: "WebcastChatMessage",
    payload: { user: { id: "u3", nickname: "阿泽" }, content: "让舞台亮起来" },
  }, { settings: DEFAULT_SETTINGS, now: T0 });
  assert.equal(comment.type, "comment");
  assert.equal(comment.text, "让舞台亮起来");
  const stats = normalizeIncomingEvent({
    type: "room_stats",
    payload: { viewerCount: 1234, likeCount: 5678 },
  }, { settings: DEFAULT_SETTINGS, now: T0 });
  assert.deepEqual(stats.room, { viewers: 1234, likes: 5678 });
  assert.equal(normalizeIncomingEvent({ type: "unknown" }, { settings: DEFAULT_SETTINGS, now: T0 }), null);
  assert.equal(normalizeIncomingEvent(null, { settings: DEFAULT_SETTINGS, now: T0 }), null);
});

test("手动测试礼物事件带上设置里的热度", () => {
  const settings = { ...DEFAULT_SETTINGS, giftHeat: { ...DEFAULT_SETTINGS.giftHeat, heart: 9 } };
  const event = createGiftEvent({ userName: "测试员", giftId: "heart", count: 3, settings, now: T0 });
  assert.equal(event.user.name, "测试员");
  assert.equal(event.gift.heat, 9);
  assert.equal(event.totalHeat, 27);
});

test("演示源能持续产出多种事件", () => {
  const source = new DemoSource({ onEvent: () => {}, settings: DEFAULT_SETTINGS, now: () => T0, random: mulberry32(42) });
  const types = new Set();
  for (let index = 0; index < 200; index += 1) {
    const event = source.nextEvent();
    assert.ok(event && event.type);
    types.add(event.type);
  }
  assert.ok(types.has("gift"));
  assert.ok(types.size >= 3);
});

test("演示源礼物热度跟随设置", () => {
  const settings = { ...DEFAULT_SETTINGS, giftHeat: { ...DEFAULT_SETTINGS.giftHeat, heart: 7 } };
  const gifts = [];
  const source = new DemoSource({
    onEvent: (event) => gifts.push(event),
    settings,
    now: () => T0,
    random: mulberry32(7),
  });
  for (let index = 0; index < 80; index += 1) gifts.push(source.nextGift(T0));
  const hearts = gifts.filter((event) => event.gift.id === "heart");
  assert.ok(hearts.length > 0);
  assert.ok(hearts.every((event) => event.gift.heat === 7));
});

