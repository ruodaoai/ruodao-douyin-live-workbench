import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LiveController } from "../lib/controller.mjs";
import {
  sanitizeBgm,
  sanitizeControl,
  sanitizeStage,
  matchControlRule,
  firstHitWord,
} from "../lib/live-control.mjs";

async function makeController() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-control-"));
  const controller = new LiveController({ dataDir: dir });
  await controller.init();
  controller.stopDemo();
  controller.relay.stop();
  return { controller, dir };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 25));

test("BGM 清洗：音量夹紧、路由回退、曲目字段收敛", () => {
  const bgm = sanitizeBgm({ volume: 3, route: "tv", track: { title: " 热血开场 ", hash: "abc", isTrial: 1 } });
  assert.equal(bgm.volume, 1);
  assert.equal(bgm.route, "workbench");
  assert.equal(bgm.track.title, "热血开场");
  assert.equal(bgm.track.isTrial, true);
  assert.equal(sanitizeBgm({ volume: -1 }).volume, 0);
  assert.equal(sanitizeBgm({ track: null }).track, null);
});

test("场控清洗：敏感词去重、字幕 tone 回退、冷却夹紧", () => {
  const control = sanitizeControl({
    bannedWords: [" 加微信 ", "私聊", "", 123, "加微信"],
    subtitle: { text: "  上屏测试  ", tone: "rainbow" },
    replyCooldownMs: 999999,
    scripts: [{ title: "开场", text: "欢迎", hotkey: "F1" }, { title: "空", text: "" }],
  });
  assert.deepEqual(control.bannedWords, ["加微信", "私聊", "123"]);
  assert.equal(control.subtitle.text, "上屏测试");
  assert.equal(control.subtitle.tone, "info");
  assert.equal(control.replyCooldownMs, 120000);
  assert.equal(control.scripts.length, 1);
});

test("舞台清洗：非法模式回退、非法模型键被丢弃", () => {
  const stage = sanitizeStage({ mode: "vr", quality: "ultra", models: { human: "/assets/models/a.glb", "bad key": "/assets/models/b.glb" } });
  assert.equal(stage.mode, "3d");
  assert.equal(stage.quality, "high");
  assert.deepEqual(stage.models, { human: "/assets/models/a.glb" });
});

test("关键词规则：包含、精确与停用", () => {
  const control = {
    rules: [
      { id: "a", keywords: ["求关注"], reply: "关注一下", enabled: true },
      { id: "b", keywords: ["666"], reply: "谢6", enabled: false },
      { id: "c", keywords: ["扣1"], reply: "加入人类", match: "exact" },
    ],
  };
  assert.equal(matchControlRule(control, "主播求关注")?.id, "a");
  assert.equal(matchControlRule(control, "666"), null);
  assert.equal(matchControlRule(control, "扣1")?.id, "c");
  assert.equal(matchControlRule(control, "我扣1了"), null);
  assert.equal(firstHitWord({ bannedWords: ["加微信"] }, "请加微信聊"), "加微信");
});

test("手动上屏与自动应答：字幕进入状态，敏感词被拦截", async () => {
  const { controller, dir } = await makeController();
  try {
    await controller.startSession();
    await controller.saveControl({
      autoReply: true,
      rules: [{ id: "r1", keywords: ["扣1"], reply: "欢迎{user}加入人类", enabled: true, cooldownMs: 0 }],
      bannedWords: ["加微信"],
    });

    controller.injectRaw({ id: "c1", type: "comment", user: { id: "u1", name: "小李" }, text: "扣1" });
    await tick();
    assert.equal(controller.state().control.subtitle.text, "欢迎小李加入人类");

    // 手动上屏优先：自动应答静默窗口内不抢屏。
    await controller.pushControl({ text: "手动场控测试", tone: "boost" });
    const state = controller.state();
    assert.equal(state.control.subtitle.text, "手动场控测试");
    assert.equal(state.control.subtitle.tone, "boost");
    assert.ok(state.audio, "状态里应带音频信息");
    controller.injectRaw({ id: "c2", type: "comment", user: { id: "u2", name: "小王" }, text: "扣1" });
    await tick();
    assert.equal(controller.state().control.subtitle.text, "手动场控测试");

    // 敏感词直接拦截，不触发自动应答。
    controller.injectRaw({ id: "c3", type: "comment", user: { id: "u3", name: "小张" }, text: "加微信" });
    await tick();
    assert.equal(controller.state().control.subtitle.text, "手动场控测试");
  } finally {
    await controller.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
