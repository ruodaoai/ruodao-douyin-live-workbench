import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { Store } from "../lib/store.mjs";
async function tempDir() { return fs.promises.mkdtemp(path.join(os.tmpdir(), "live-store-")); }
test("设置持久化与旧字段清理", async () => {
  const dir = await tempDir();
  const store = await new Store(dir).init();
  await store.saveSettings({ overlayTitle: "测试直播间", avatarModel: "bad", rewards: ["bad"], lastGameId: "digital-human" });
  const reloaded = await new Store(dir).init();
  assert.equal(reloaded.settings.overlayTitle, "测试直播间");
  assert.equal(reloaded.settings.lastGameId, "human-vs-zombie");
  assert.equal(Object.hasOwn(reloaded.settings, "avatarModel"), false);
  assert.equal(Object.hasOwn(reloaded.settings, "rewards"), false);
  await fs.promises.rm(dir, { recursive: true, force: true });
});
test("会话事件追加、归档、列表、读取与删除", async () => {
  const dir = await tempDir();
  const store = await new Store(dir).init();
  const id = "arena_test_1";
  await store.appendEvent(id, { type: "gift", ts: 1 });
  await store.appendEvent(id, { type: "comment", ts: 2 });
  assert.equal((await store.readSessionEvents(id)).length, 2);
  await store.archiveSession({ id, gameId: "human-vs-zombie", gameName: "人类 VS 丧尸", status: "ended", startedAt: 1000, endedAt: 2000, durationMs: 1000, totals: { gifts: 2 }, topUsers: [{ name: "小鹿", heat: 100 }] });
  assert.equal((await store.listSessions())[0].topUser.name, "小鹿");
  assert.equal((await store.readSession(id)).gameId, "human-vs-zombie");
  await store.deleteSession(id);
  assert.equal((await store.readSession(id)), null);
  await fs.promises.rm(dir, { recursive: true, force: true });
});
