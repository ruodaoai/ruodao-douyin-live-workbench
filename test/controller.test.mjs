import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LiveController } from "../lib/controller.mjs";
async function makeController() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-controller-")); const controller = new LiveController({ dataDir: dir }); await controller.init(); controller.stopDemo(); controller.relay.stop(); return { controller, dir }; }
test("默认会话固定为人类VS丧尸并支持弹幕互动", async () => {
  const { controller, dir } = await makeController();
  try {
    const report = await controller.startSession();
    assert.equal(report.gameId, "human-vs-zombie");
    assert.equal(controller.state().engine.gameId, "human-vs-zombie");
    await assert.rejects(() => controller.startSession({ gameId: "digital-human" }), /未知玩法/);
    const comment = controller.injectRaw({ id: "c1", type: "comment", user: { id: "u1", name: "观众" }, text: "扣1" });
    assert.equal(comment.ok, true);
    assert.ok(comment.effects.some((fx) => fx.type === "join" && fx.team === "human"));
  } finally { await controller.dispose(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test("设置持久化不会写入旧数字人和轮盘字段", async () => {
  const { controller, dir } = await makeController();
  try {
    const settings = await controller.saveSettings({ avatarModel: "bad", rewards: ["bad"], lastGameId: "digital-human" });
    assert.equal(settings.lastGameId, "human-vs-zombie");
    assert.equal(Object.hasOwn(settings, "avatarModel"), false);
    assert.equal(Object.hasOwn(settings, "rewards"), false);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8"));
    assert.equal(Object.hasOwn(raw, "avatarModel"), false);
    assert.equal(Object.hasOwn(raw, "rewards"), false);
  } finally { await controller.dispose(); fs.rmSync(dir, { recursive: true, force: true }); }
});
