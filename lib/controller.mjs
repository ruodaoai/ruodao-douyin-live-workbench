import { GAME_BY_ID, GAMES, gameOptions, publicGames, publicGifts } from "./catalog.mjs";
import { createRuntime } from "./core/registry.mjs";
import { DemoSource, RelaySource, createGiftEvent, normalizeIncomingEvent } from "./events.mjs";
import { Store } from "./store.mjs";
import { MusicBridge } from "./music.mjs";
import { firstHitWord, matchControlRule } from "./live-control.mjs";
import { clamp, safeText, uid } from "./util.mjs";

const TICK_MS = 50;
const STATE_LIVE_MS = 200;
const STATE_IDLE_MS = 2000;
const RATE_WINDOW_MS = 60_000;
const ACTIVE_WINDOW_MS = 5 * 60_000;
const MAX_RECENT_EVENTS = 30;
const MAX_SEEN = 6000;
const MAX_ROUNDS = 120;
const ACTIVE_WRITE_MS = 10_000;

function emptyTotals() {
  return {
    events: 0,
    gifts: 0,
    giftUnits: 0,
    heat: 0,
    comments: 0,
    likes: 0,
    follows: 0,
    enters: 0,
    effects: 0,
    rounds: 0,
    levels: 0,
    peakViewers: 0,
  };
}

function numberOption(option, raw) {
  let value = Number(raw);
  if (!Number.isFinite(value)) value = Number(option.min ?? 0);
  const step = Number(option.step) || 1;
  value = Math.round(value / step) * step;
  value = clamp(value, Number(option.min ?? -Infinity), Number(option.max ?? Infinity));
  return Number(value.toFixed(2));
}

export function sanitizeGameOptions(gameId, candidate) {
  const game = GAME_BY_ID.get(String(gameId));
  if (!game) return {};
  const source = candidate && typeof candidate === "object" ? candidate : {};
  const output = { ...game.defaults };
  for (const option of game.options) {
    const raw = source[option.key];
    if (option.type === "number") {
      output[option.key] = numberOption(option, raw === undefined ? game.defaults[option.key] : raw);
      continue;
    }
    if (option.type === "select") {
      const allowed = (option.options ?? []).map((item) => String(item.value));
      const value = String(raw ?? game.defaults[option.key] ?? "");
      output[option.key] = allowed.includes(value) ? value : String(game.defaults[option.key] ?? allowed[0] ?? "");
    }
  }
  return output;
}

export class LiveController {
  constructor({ dataDir, version = "1.3.0" } = {}) {
    this.version = version;
    this.store = new Store(dataDir);
    this.settings = { ...this.store.settings };
    this.bootAt = Date.now();
    this.engine = null;
    this.session = null;
    this.lastReport = null;
    this.demo = null;
    this.relay = null;
    this.subscribers = new Map();
    this.loopTimer = null;
    this.lastStateAt = 0;
    this.lastActiveWriteAt = 0;
    this.lastRelayState = "";
    this.lastAlertKey = "";
    this.lastAlertAt = 0;
    this.roundKeys = new Set();
    this.music = new MusicBridge();
    this.subtitle = { text: "", tone: "info", until: 0, at: 0 };
    this.controlCooldowns = new Map();
    this.lastAutoControlAt = 0;
    this.musicDoctorCache = { at: 0, value: null };
    this.resetSessionStats(Date.now());
  }

  async init() {
    await this.store.init();
    this.settings = this.store.settings;
    this.relay = new RelaySource({
      onEvent: (raw) => this.ingestRaw(raw, "relay"),
      onStatus: (status) => this.onRelayStatus(status),
    });
    await this.recoverInterrupted();
    this.loopTimer = setInterval(() => this.loop(), TICK_MS);
    this.loopTimer.unref?.();
    return this;
  }

  async recoverInterrupted() {
    const active = await this.store.readActive().catch(() => null);
    if (!active?.id) return;
    const now = Date.now();
    const summary = {
      ...active,
      status: "interrupted",
      endedAt: Number(active.updatedAt) || Number(active.endedAt) || now,
      durationMs: Math.max(0, (Number(active.updatedAt) || now) - Number(active.startedAt || now)),
      interrupted: true,
    };
    await this.store.archiveSession(summary).catch(() => undefined);
    await this.store.clearActive().catch(() => undefined);
    this.pushAlert("warn", "检测到上次直播没有正常结束，已归档为「中断」场次", "session.recovered");
  }

  resetSessionStats(now) {
    this.totals = emptyTotals();
    this.timeline = new Map();
    this.rounds = [];
    this.recentEvents = [];
    this.rateEvents = [];
    this.activeUsers = new Map();
    this.roundKeys = new Set();
    this.metrics = {
      viewers: 0,
      likes: 0,
      lastEventAt: 0,
      lastRawEventAt: 0,
      idleEvents: 0,
      parseErrors: 0,
    };
    this.alerts = this.alerts ?? [];
    this.sessionStartedAt = now;
  }

  /* ── 状态与指标 ─────────────────────────────────────────────── */

  publicSettings() {
    const { source, ...rest } = this.settings;
    return {
      ...rest,
      control: { ...(rest.control || {}), subtitle: this.subtitle },
      source: {
        type: source.type,
        url: source.url,
        hasToken: Boolean(source.token),
        autoReconnect: source.autoReconnect !== false,
      },
    };
  }

  sourceSnapshot() {
    return {
      type: this.settings.source.type,
      url: this.settings.source.url,
      hasToken: Boolean(this.settings.source.token),
      autoReconnect: this.settings.source.autoReconnect !== false,
      demo: this.demo
        ? {
            running: this.demo.running,
            scenario: this.demo.scenario,
            speed: this.demo.speed,
            emitted: this.demo.stats.emitted,
            startedAt: this.demo.stats.startedAt,
          }
        : null,
      relay: this.relay?.snapshot() ?? null,
      lastRawEventAt: this.metrics.lastRawEventAt,
      idleEvents: this.metrics.idleEvents,
    };
  }

  pruneMetrics(now) {
    const rateCutoff = now - 5 * 60_000;
    while (this.rateEvents.length > 0 && this.rateEvents[0].ts < rateCutoff) this.rateEvents.shift();
    const activeCutoff = now - ACTIVE_WINDOW_MS;
    for (const [id, ts] of this.activeUsers) {
      if (ts < activeCutoff) this.activeUsers.delete(id);
    }
  }

  metricsSnapshot(now = Date.now()) {
    this.pruneMetrics(now);
    const cutoff = now - RATE_WINDOW_MS;
    let events = 0;
    let gifts = 0;
    let comments = 0;
    let heat = 0;
    for (const row of this.rateEvents) {
      if (row.ts < cutoff) continue;
      events += 1;
      if (row.type === "gift") gifts += 1;
      if (row.type === "comment") comments += 1;
      heat += row.heat;
    }
    const sourceAgeMs = this.metrics.lastRawEventAt ? now - this.metrics.lastRawEventAt : -1;
    return {
      uptimeMs: now - this.bootAt,
      sessionMs: this.session ? now - this.session.startedAt : 0,
      viewers: this.metrics.viewers,
      likes: this.metrics.likes,
      lastEventAt: this.metrics.lastEventAt,
      lastRawEventAt: this.metrics.lastRawEventAt,
      sourceAgeMs,
      eventRate: events,
      giftRate: gifts,
      commentRate: comments,
      heatRate: heat,
      activeUsers: this.activeUsers.size,
      health: this.health(now),
    };
  }

  health(now = Date.now()) {
    if (!this.session) return { level: "idle", label: "未开播" };
    if (this.settings.source.type === "relay") {
      const relay = this.relay?.snapshot();
      if (relay?.state === "connected") {
        const age = this.metrics.lastRawEventAt ? now - this.metrics.lastRawEventAt : 0;
        if (age > 120_000) return { level: "warn", label: "中继在线，但 2 分钟没有互动" };
        return { level: "ok", label: "中继在线" };
      }
      if (relay?.state === "connecting") return { level: "warn", label: "中继重连中" };
      return { level: "error", label: "中继断开" };
    }
    return { level: "ok", label: "演示互动中" };
  }

  timelineSnapshot() {
    const rows = [...this.timeline.values()].sort((a, b) => a.minute - b.minute);
    return rows.slice(-30);
  }

  sessionSummary() {
    if (!this.session) return null;
    const now = Date.now();
    return {
      id: this.session.id,
      gameId: this.session.gameId,
      gameName: this.session.gameName,
      status: this.session.status,
      startedAt: this.session.startedAt,
      endedAt: this.session.endedAt,
      durationMs: Math.max(0, (this.session.endedAt || now) - this.session.startedAt),
      options: this.session.options,
    };
  }

  lastSessionSummary() {
    if (!this.lastReport) return null;
    const report = this.lastReport;
    return {
      id: report.id,
      gameId: report.gameId,
      gameName: report.gameName,
      status: report.status,
      startedAt: report.startedAt,
      endedAt: report.endedAt,
      durationMs: report.durationMs,
      totals: report.totals,
    };
  }

  state(now = Date.now()) {
    return {
      app: "ruodao-live-workbench",
      version: this.version,
      serverTime: now,
      bootAt: this.bootAt,
      session: this.sessionSummary(),
      lastSession: this.lastSessionSummary(),
      settings: this.publicSettings(),
      control: this.controlSnapshot(),
      audio: { bridge: this.music.available(), subtitle: this.subtitle },
      engine: this.engine ? this.engine.snapshot(now) : null,
      source: this.sourceSnapshot(),
      metrics: this.metricsSnapshot(now),
      totals: { ...this.totals },
      timeline: this.timelineSnapshot(),
      rounds: this.rounds.slice(-8),
      alerts: this.alerts.slice(0, 12),
      recentEvents: this.recentEvents.slice(-20),
    };
  }

  broadcastState(now = Date.now(), force = false) {
    if (this.subscribers.size === 0) {
      this.lastStateAt = now;
      return;
    }
    const interval = this.session ? STATE_LIVE_MS : STATE_IDLE_MS;
    if (!force && now - this.lastStateAt < interval) return;
    this.lastStateAt = now;
    const payload = this.state(now);
    for (const send of this.subscribers.values()) send(payload);
  }

  subscribe(send) {
    const id = uid("sub");
    this.subscribers.set(id, send);
    send(this.state());
    return () => this.subscribers.delete(id);
  }

  /* ── 场控：字幕、规则应答、话术与 AI 生成 ──────────────────── */

  controlSnapshot() {
    return { ...this.settings.control, subtitle: this.subtitle };
  }

  controlTone(value) {
    const tones = ["info", "human", "zombie", "boost", "welcome", "follow", "gift", "warning"];
    return tones.includes(String(value)) ? String(value) : "info";
  }

  async pushControl({ text, tone = "info", durationMs = 6000, tts, source: origin = "manual" } = {}) {
    const content = safeText(text, 120).trim();
    if (!content) throw new Error("话术内容为空");
    const now = Date.now();
    this.subtitle = {
      text: content,
      tone: this.controlTone(tone),
      until: now + clamp(Number(durationMs) || 6000, 1200, 30000),
      at: now,
    };
    this.lastAutoControlAt = now;
    this.broadcastState(now, true);
    this.emit("control", {
      kind: "subtitle",
      text: content,
      tone: this.subtitle.tone,
      until: this.subtitle.until,
      tts: tts === undefined ? Boolean(this.settings.control.tts) : Boolean(tts),
      volume: this.settings.control.ttsVolume,
      source: origin,
    });
    return this.subtitle;
  }

  applyControl(event, now) {
    const control = this.settings.control;
    if (!control?.enabled || !event) return;
    if (event.type === "comment") {
      const blocked = firstHitWord(control, event.text);
      if (blocked) {
        this.pushAlert("warn", "评论命中敏感词「" + blocked + "」，已跳过自动应答", "control.blocked");
        return;
      }
      if (!control.autoReply) return;
      // 手动上屏或上一条自动应答后 3.5 秒内不抢屏，场控优先。
      if (now - this.lastAutoControlAt < 3500) return;
      const rule = matchControlRule(control, event.text);
      if (!rule) return;
      const userKey = event.user?.id || event.user?.name || "guest";
      const key = rule.id + ":" + userKey;
      const last = this.controlCooldowns.get(key) || 0;
      const cooldown = Math.max(Number(rule.cooldownMs) || 0, 1500);
      if (now - last < cooldown) return;
      this.controlCooldowns.set(key, now);
      if (this.controlCooldowns.size > 800) {
        const cutoff = now - 10 * 60_000;
        for (const [id, ts] of this.controlCooldowns) if (ts < cutoff) this.controlCooldowns.delete(id);
      }
      const content = String(rule.reply || "").replace(/\{user\}/g, event.user?.name || "家人");
      this.pushControl({ text: content, tone: rule.tone, durationMs: 5400, source: "auto" }).catch(() => undefined);
      return;
    }
    if (!control.autoReply) return;
    if (now - this.lastAutoControlAt < 4500) return;
    if (event.type === "gift") {
      const gift = event.gift || {};
      const name = safeText(gift.name, 20) || "礼物";
      const count = Number(gift.count) || 1;
      const user = safeText(event.user?.name, 20) || "家人";
      const high = ["跑车", "火箭", "嘉年华"].includes(name) || Number(gift.heat) >= 500;
      const content = high
        ? "感谢 " + user + " 的" + name + "！全场注意，援军已进场，直接推线！"
        : "感谢 " + user + " 送出的 " + name + (count > 1 ? " ×" + count : "") + "，心意已经变成战场兵力！";
      this.pushControl({ text: content, tone: "gift", durationMs: 5600, source: "auto" }).catch(() => undefined);
    } else if (event.type === "follow") {
      const user = safeText(event.user?.name, 20) || "家人";
      this.pushControl({ text: "感谢 " + user + " 的关注，点个关注不迷路，下一场继续开战。", tone: "follow", durationMs: 5000, source: "auto" }).catch(() => undefined);
    } else if (event.type === "enter") {
      const user = safeText(event.user?.name, 20) || "家人";
      this.pushControl({ text: "欢迎 " + user + " 进入直播间，扣 1 或 2 马上参战。", tone: "welcome", durationMs: 4600, source: "auto" }).catch(() => undefined);
    }
  }

  async saveControl(patch = {}) {
    if (!patch || typeof patch !== "object") throw new Error("场控配置无效");
    const next = { ...this.settings.control, ...patch, updatedAt: Date.now() };
    delete next.subtitle;
    this.settings = await this.store.saveSettings({ control: next });
    this.broadcastState(Date.now(), true);
    return this.controlSnapshot();
  }

  async runControlScript(scriptId) {
    const script = (this.settings.control.scripts || []).find((item) => item.id === String(scriptId));
    if (!script) throw new Error("话术不存在");
    return this.pushControl({ text: script.text, tone: script.group === "礼物" ? "gift" : "info", durationMs: 7000, source: "script" });
  }

  async generateControlScripts({ scene = "开场", count = 5 } = {}) {
    const limit = clamp(Number(count) || 5, 3, 8);
    const ai = this.settings.ai || {};
    const templates = {
      开场: ["欢迎来到直播间，今天这场玩点刺激的。", "新进来的家人先别划走，右上角关注点一下。", "扣 1 加人类，扣 2 加丧尸，你选哪边？", "礼物直接改战场，先到先得。", "今天目标在线新高，帮我冲一波。"],
      留人: ["现在场上就差你这一票，扣个数字就能改写战局。", "还有 30 秒结算，落后一方一个小心心就能反打。", "别眨眼，下一秒可能就翻盘。", "刚进来的家人，先扣个 1 我带你玩。", "停留 3 分钟，整点抽一波礼物。"],
      礼物: ["感谢家人的小心心，已经变成战场兵力。", "感谢大哥的火箭，援军进场，直接推线。", "礼物不分大小，都是战局的一部分。", "这一波礼物直接把对面打退了。", "感谢榜一大哥，名字已经挂在贡献榜。"],
      下播: ["今天先到这里，感谢每一位家人的陪伴。", "点个关注，明天同一时间继续开战。", "最后 10 秒，把想看的玩法打在公屏。", "下播前再冲一波榜，感谢大家。", "晚安，明天见。"],
    };
    const fallback = (templates[scene] || templates["开场"]).slice(0, limit);
    if (!ai.endpoint) return { state: "succeeded", source: "template", scripts: fallback };
    try {
      const response = await fetch(String(ai.endpoint).replace(/\/+$/, "") + "/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", ...(ai.apiKey ? { authorization: "Bearer " + ai.apiKey } : {}) },
        body: JSON.stringify({
          model: ai.model || "gpt-4o-mini",
          temperature: 0.9,
          messages: [
            { role: "system", content: "你是抖音直播场控，只输出 JSON 数组，每项是一句 20-40 字的中文口播，不要解释。" },
            { role: "user", content: "场景：" + scene + "，玩法：" + (GAME_BY_ID.get(this.settings.lastGameId)?.name || "互动玩法") + "，生成 " + limit + " 句。" },
          ],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      const content = String(data?.choices?.[0]?.message?.content || "");
      const match = content.match(/\[[\s\S]*\]/);
      const list = match ? JSON.parse(match[0]) : [];
      const scripts = (Array.isArray(list) ? list : []).map((item) => safeText(typeof item === "string" ? item : item?.text, 80)).filter(Boolean).slice(0, limit);
      if (!scripts.length) throw new Error("AI 未返回可用话术");
      return { state: "succeeded", source: "ai", scripts };
    } catch (error) {
      return { state: "succeeded", source: "template", warning: String(error.message || error), scripts: fallback };
    }
  }

  /* ── BGM：音乐插件桥接与播放控制 ───────────────────────────── */

  async musicStatus({ refresh = false } = {}) {
    const now = Date.now();
    if (!refresh && this.musicDoctorCache.value && now - this.musicDoctorCache.at < 60_000) return this.musicDoctorCache.value;
    const value = await this.music.doctor();
    this.musicDoctorCache = { at: now, value };
    return value;
  }

  async searchMusic(keywords) {
    const songs = await this.music.search(keywords, 12);
    return { state: "succeeded", songs };
  }

  async setBgmTrack(input = {}) {
    const current = this.settings.bgm?.track;
    let track = null;
    if (input.url || input.title) {
      track = {
        id: safeText(input.id || input.hash, 120),
        title: safeText(input.title || input.name, 80),
        artist: safeText(input.artist || input.singer, 80),
        url: safeText(input.url, 2000),
        hash: safeText(input.hash, 120),
        quality: safeText(input.quality, 12),
        isTrial: Boolean(input.isTrial),
        duration: Number(input.duration) || 0,
        cover: safeText(input.cover, 2000),
        source: "kugou",
        pickedAt: Date.now(),
      };
    }
    if ((!track || !track.url) && (input.hash || input.keywords)) {
      track = await this.music.play({ hash: input.hash, keywords: input.keywords, title: input.title, artist: input.artist, quality: input.quality });
    }
    if (track && !track.url && current?.url) track = { ...current, ...track };
    if (!track?.url) throw new Error("没有取得可播放的音频地址");
    this.settings = await this.store.saveSettings({
      bgm: { ...this.settings.bgm, enabled: true, playing: true, track, updatedAt: Date.now() },
    });
    this.broadcastState(Date.now(), true);
    return this.settings.bgm;
  }

  async controlBgm({ action = "play", volume, route, duck, track } = {}) {
    const bgm = { ...this.settings.bgm };
    if (track !== undefined) bgm.track = track;
    if (volume !== undefined) bgm.volume = clamp(Number(volume) || 0, 0, 1);
    if (route) bgm.route = ["overlay", "workbench", "both"].includes(route) ? route : bgm.route;
    if (duck !== undefined) bgm.duck = Boolean(duck);
    if (action === "play") { bgm.enabled = true; bgm.playing = Boolean(bgm.track?.url); }
    else if (action === "pause") bgm.playing = false;
    else if (action === "stop") { bgm.playing = false; bgm.enabled = false; }
    else if (action === "toggle") { bgm.playing = !bgm.playing; bgm.enabled = bgm.playing; }
    bgm.updatedAt = Date.now();
    this.settings = await this.store.saveSettings({ bgm });
    this.broadcastState(Date.now(), true);
    return this.settings.bgm;
  }

  async saveStage(patch = {}) {
    if (!patch || typeof patch !== "object") throw new Error("舞台配置无效");
    this.settings = await this.store.saveSettings({ stage: { ...this.settings.stage, ...patch } });
    this.broadcastState(Date.now(), true);
    return this.settings.stage;
  }

  /* ── 设置与互动源 ───────────────────────────────────────────── */

  async saveSettings(patch) {
    let clean = patch && typeof patch === "object" ? { ...patch } : {};
    if (clean.source && typeof clean.source === "object" && clean.source.clearToken) {
      clean = { ...clean, source: { ...clean.source, token: "" } };
      delete clean.source.clearToken;
    }
    if (clean.gameOptions && typeof clean.gameOptions === "object") {
      const options = {};
      for (const [gameId, value] of Object.entries(clean.gameOptions)) {
        if (GAME_BY_ID.has(gameId)) options[gameId] = sanitizeGameOptions(gameId, value);
      }
      clean.gameOptions = options;
    }
    const beforeSource = JSON.stringify(this.settings.source);
    this.settings = await this.store.saveSettings(clean);
    if (this.engine) this.engine.setOptions(this.effectiveOptions(this.engine.gameId));
    this.demo?.updateSettings(this.settings);
    const sourceChanged = JSON.stringify(this.settings.source) !== beforeSource;
    if (sourceChanged && this.session) await this.applySource();
    this.broadcastState(Date.now(), true);
    return this.publicSettings();
  }

  effectiveOptions(gameId) {
    return {
      ...sanitizeGameOptions(gameId, gameOptions(this.settings, gameId)),
    };
  }

  async connectSource({ url, token, autoReconnect = true } = {}) {
    this.settings = await this.store.saveSettings({
      source: {
        type: "relay",
        url: String(url ?? this.settings.source.url ?? "").slice(0, 1000),
        token: token === undefined ? this.settings.source.token : String(token ?? "").slice(0, 1000),
        autoReconnect: autoReconnect !== false,
      },
    });
    if (this.session) await this.applySource();
    else await this.relay.connect(this.settings.source);
    this.broadcastState(Date.now(), true);
    return this.relay.snapshot();
  }

  async disconnectSource() {
    this.relay?.stop();
    this.settings = await this.store.saveSettings({ source: { type: "demo" } });
    if (this.session) this.startDemo();
    this.broadcastState(Date.now(), true);
    return this.sourceSnapshot();
  }

  async applySource() {
    if (!this.session) {
      this.stopSources();
      return;
    }
    if (this.settings.source.type === "relay" && this.settings.source.url) {
      this.stopDemo();
      await this.relay.connect(this.settings.source);
      return;
    }
    this.relay?.stop();
    this.startDemo();
  }

  startDemo() {
    this.stopDemo();
    this.demo = new DemoSource({
      onEvent: (event) => this.ingestRaw(event, "demo"),
      settings: this.settings,
    });
    this.demo.start();
  }

  stopDemo() {
    this.demo?.stop();
    this.demo = null;
  }

  stopSources() {
    this.stopDemo();
    this.relay?.stop();
  }

  onRelayStatus(status) {
    const state = String(status?.state || "");
    if (state === this.lastRelayState) return;
    const previous = this.lastRelayState;
    this.lastRelayState = state;
    if (state === "connected") {
      this.pushAlert("info", "互动中继已连接，开始接收直播间消息", "source.connected");
    } else if (state === "error") {
      this.pushAlert("warn", `互动中继异常：${safeText(status.lastError, 160) || "连接失败"}`, "source.error");
    } else if (state === "connecting" && previous === "connected") {
      this.pushAlert("warn", "互动中继断开，正在自动重连", "source.reconnecting");
    }
    this.broadcastState(Date.now(), true);
  }

  /* ── 事件处理 ───────────────────────────────────────────────── */

  remember(id) {
    if (!id) return true;
    if (this.seen?.has(id)) return false;
    if (!this.seen) this.seen = new Map();
    this.seen.set(id, Date.now());
    if (this.seen.size > MAX_SEEN) {
      const oldest = this.seen.keys().next().value;
      this.seen.delete(oldest);
    }
    return true;
  }

  ingestRaw(raw, source = "relay") {
    let event;
    try {
      event = normalizeIncomingEvent(raw, { settings: this.settings, now: Date.now(), source });
    } catch {
      this.metrics.parseErrors += 1;
      return { ok: false, reason: "parse-error" };
    }
    if (!event) return { ok: false, reason: "unrecognized" };
    this.metrics.lastRawEventAt = Date.now();
    if (!this.session) {
      this.metrics.idleEvents += 1;
      this.broadcastState(Date.now());
      return { ok: true, idle: true, event };
    }
    return this.ingestEvent(event);
  }

  ingestEvent(event) {
    if (!this.remember(event.id)) return { ok: false, reason: "duplicate" };
    const now = Date.now();
    this.totals.events += 1;
    this.metrics.lastEventAt = now;
    this.trackEvent(event, now);
    let effects = [];
    if (this.engine?.isRunning) {
      const result = this.engine.apply(event, now);
      effects = result.effects;
    }
    this.recentEvents.push(event);
    if (this.recentEvents.length > MAX_RECENT_EVENTS) this.recentEvents.splice(0, this.recentEvents.length - MAX_RECENT_EVENTS);
    if (effects.length > 0) this.recordEffects(effects, now);
    this.watchRound(now);
    this.applyControl(event, now);
    this.persistEvent(event, effects, now);
    this.broadcastState(now);
    if (effects.length > 0) this.emit("effects", { effects, ts: now });
    return { ok: true, event, effects };
  }

  trackEvent(event, now) {
    const minute = Math.floor(now / 60_000) * 60_000;
    let bucket = this.timeline.get(minute);
    if (!bucket) {
      bucket = { minute, gifts: 0, heat: 0, comments: 0, likes: 0, follows: 0, enters: 0, viewers: 0 };
      this.timeline.set(minute, bucket);
      if (this.timeline.size > 120) {
        const oldest = this.timeline.keys().next().value;
        this.timeline.delete(oldest);
      }
    }
    let heat = 0;
    if (event.type === "gift") {
      heat = Number(event.totalHeat) || 0;
      this.totals.gifts += 1;
      this.totals.giftUnits += Number(event.count) || 0;
      this.totals.heat += heat;
      bucket.gifts += 1;
      bucket.heat += heat;
    } else if (event.type === "comment") {
      this.totals.comments += 1;
      bucket.comments += 1;
    } else if (event.type === "like") {
      const count = Number(event.count) || 1;
      this.totals.likes += count;
      bucket.likes += count;
    } else if (event.type === "follow") {
      this.totals.follows += 1;
      bucket.follows += 1;
    } else if (event.type === "enter") {
      this.totals.enters += 1;
      bucket.enters += 1;
    } else if (event.type === "room_stats") {
      this.metrics.viewers = Number(event.room?.viewers) || 0;
      this.metrics.likes = Math.max(this.metrics.likes, Number(event.room?.likes) || 0);
      this.totals.peakViewers = Math.max(this.totals.peakViewers, this.metrics.viewers);
      bucket.viewers = Math.max(bucket.viewers, this.metrics.viewers);
    }
    this.rateEvents.push({ ts: now, type: event.type, heat });
    if (event.user?.id) this.activeUsers.set(event.user.id, now);
  }

  recordEffects(effects, now = Date.now()) {
    if (!Array.isArray(effects) || effects.length === 0) return;
    this.totals.effects += effects.length;
    for (const effect of effects) {
      if (!effect) continue;
      if (effect.type === "levelup") this.totals.levels = Math.max(this.totals.levels, Number(effect.level) + 1 || 0);
      if (effect.type === "win") {
        this.pushAlert("info", `回合结算 · ${safeText(effect.text, 80)}`, "round.win");
      } else if (effect.type === "finish") {
        this.pushAlert("info", `竞速结算 · ${safeText(effect.text, 80)}`, "round.finish");
      } else if (effect.type === "milestone") {
        this.pushAlert("info", safeText(effect.text, 100), "round.milestone");
      } else if (effect.type === "crown") {
        this.pushAlert("info", safeText(effect.text, 100), "round.crown");
      }
    }
  }

  watchRound(now = Date.now()) {
    const round = this.engine?.round;
    if (!round || round.status !== "settled" || !round.settledAt || !this.session) return;
    const key = `${this.session.id}:${round.index}:${round.settledAt}`;
    if (this.roundKeys.has(key)) return;
    this.roundKeys.add(key);
    this.rounds.push({
      index: round.index,
      winner: round.winner,
      reason: round.reason,
      reward: round.reward ?? null,
      startedAt: round.startedAt,
      endedAt: round.settledAt,
      result: round.result ?? null,
    });
    if (this.rounds.length > MAX_ROUNDS) this.rounds.splice(0, this.rounds.length - MAX_ROUNDS);
    this.totals.rounds = this.rounds.length;
    this.saveActive(true);
  }

  persistEvent(event, effects, now) {
    if (!this.session) return;
    const line = { ...event, sessionId: this.session.id, receivedAt: now };
    if (effects.length > 0) line.effects = effects;
    this.store.appendEvent(this.session.id, line).catch(() => this.alertOnce("record.failed", "warn", "互动记录写入失败，请检查数据目录权限"));
  }

  persistSystem(payload) {
    if (!this.session) return;
    this.store.appendEvent(this.session.id, { ...payload, sessionId: this.session.id }).catch(() => undefined);
  }

  /* ── 场次控制 ───────────────────────────────────────────────── */

  async startSession({ gameId, options } = {}) {
    const game = GAME_BY_ID.get(String(gameId ?? this.settings.lastGameId ?? "human-vs-zombie"));
    if (!game) throw new Error(`未知玩法：${gameId}`);
    if (this.session) await this.stopSession({ reason: "switch" });
    const merged = { ...sanitizeGameOptions(game.id, gameOptions(this.settings, game.id)), ...sanitizeGameOptions(game.id, options ?? {}) };
    const now = Date.now();
    this.settings = await this.store.saveSettings({
      lastGameId: game.id,
      gameOptions: { [game.id]: merged },
    });
    this.engine = createRuntime({ gameId: game.id, options: { ...merged }, seed: `${game.id}:${now}`, now });
    this.session = {
      id: uid("live"),
      gameId: game.id,
      gameName: game.name,
      status: "live",
      startedAt: now,
      endedAt: 0,
      options: merged,
    };
    this.resetSessionStats(now);
    this.engine.start(now);
    this.seen = new Map();
    this.saveActive(true);
    await this.applySource();
    this.pushAlert("info", `${game.name} 已开播 · 互动源：${this.settings.source.type === "relay" ? "中继" : "演示"}`, "session.started");
    this.emit("session", { action: "start", session: this.sessionSummary() });
    this.broadcastState(now, true);
    return this.report(now);
  }

  async stopSession({ reason = "manual" } = {}) {
    if (!this.session) return null;
    const now = Date.now();
    if (this.engine?.isRunning) this.engine.stop(now, reason);
    this.watchRound(now);
    this.stopSources();
    this.session.status = "ended";
    this.session.endedAt = now;
    const summary = this.buildReport(now, "ended", reason);
    this.session = null;
    this.lastReport = summary;
    await this.store.archiveSession(summary).catch(() => undefined);
    await this.store.clearActive().catch(() => undefined);
    this.engine = null;
    this.pushAlert("info", "本场直播已结束，数据报告已归档", "session.ended");
    this.emit("session", { action: "stop", session: summary });
    this.broadcastState(now, true);
    return summary;
  }

  async nextRound() {
    if (!this.engine?.isRunning) throw new Error("当前没有进行中的直播");
    const now = Date.now();
    let effects = [];
    if (this.engine.round?.phase === "battle") {
      effects = this.engine.endRound(now, "manual").effects;
    } else {
      this.engine.startRound(now);
      effects = [{ id: uid("fx"), type: "round", ts: now, text: `第 ${this.engine.round.index} 回合开始` }];
    }
    this.recordEffects(effects, now);
    this.emit("effects", { effects, ts: now });
    this.watchRound(now);
    this.persistSystem({ type: "system", ts: now, action: "next-round", effects });
    this.broadcastState(now, true);
    return { round: this.engine.round.index, effects };
  }

  injectGift({ userName, userId, giftId, count = 1 } = {}) {
    if (!this.session) throw new Error("请先开播，再发送测试礼物");
    const event = createGiftEvent({
      user: { id: userId, name: userName },
      userName,
      giftId: String(giftId || "heart"),
      count,
      settings: this.settings,
      now: Date.now(),
      source: "manual",
    });
    const result = this.ingestEvent(event);
    this.broadcastState(Date.now(), true);
    return result;
  }

  injectRaw(payload) {
    return this.ingestRaw(payload, "manual");
  }

  report(now = Date.now()) {
    if (!this.session && this.lastReport) return this.lastReport;
    return this.buildReport(now, this.session ? "live" : "ended", "snapshot");
  }

  buildReport(now, status, reason) {
    const snapshot = this.engine ? this.engine.snapshot(now) : null;
    const topUsers = snapshot?.topUsers ?? [];
    const totals = {
      ...this.totals,
      activeUsers: this.engine?.users?.size ?? 0,
      rounds: this.rounds.length,
    };
    const session = this.session;
    return {
      id: session?.id ?? this.lastReport?.id ?? uid("report"),
      gameId: session?.gameId ?? this.lastReport?.gameId ?? "",
      gameName: session?.gameName ?? this.lastReport?.gameName ?? "",
      status,
      reason,
      startedAt: session?.startedAt ?? now,
      endedAt: status === "ended" ? now : 0,
      durationMs: Math.max(0, now - (session?.startedAt ?? now)),
      options: session?.options ?? {},
      totals,
      peakViewers: this.totals.peakViewers,
      topUsers,
      rounds: this.rounds.slice(-MAX_ROUNDS),
      timeline: this.timelineSnapshot(),
      metrics: this.metricsSnapshot(now),
      alerts: this.alerts.filter((alert) => alert.ts >= (session?.startedAt ?? 0)).slice(0, 30),
      source: { type: this.settings.source.type, url: this.settings.source.url },
      generatedAt: now,
    };
  }

  saveActive(force = false) {
    if (!this.session) return;
    const now = Date.now();
    if (!force && now - this.lastActiveWriteAt < ACTIVE_WRITE_MS) return;
    this.lastActiveWriteAt = now;
    const snapshot = this.engine?.snapshot(now);
    const summary = {
      id: this.session.id,
      gameId: this.session.gameId,
      gameName: this.session.gameName,
      status: "live",
      startedAt: this.session.startedAt,
      endedAt: 0,
      durationMs: now - this.session.startedAt,
      options: this.session.options,
      totals: { ...this.totals, rounds: this.rounds.length, activeUsers: this.engine?.users?.size ?? 0 },
      topUsers: snapshot?.topUsers ?? [],
      timeline: this.timelineSnapshot(),
      rounds: this.rounds.slice(-MAX_ROUNDS),
      updatedAt: now,
    };
    this.store.writeActive(summary).catch(() => undefined);
  }

  async listSessions() {
    return this.store.listSessions();
  }

  async readSession(id) {
    return this.store.readSession(id);
  }

  async readSessionEvents(id, limit = 2000) {
    return this.store.readSessionEvents(id, limit);
  }

  async deleteSession(id) {
    if (this.session?.id === id) throw new Error("正在直播的场次不能删除，请先结束直播");
    return this.store.deleteSession(id);
  }

  games() {
    return publicGames(this.settings);
  }

  gifts() {
    return publicGifts(this.settings);
  }

  pushAlert(level, text, code = "") {
    const message = safeText(text, 200);
    if (!message) return null;
    const now = Date.now();
    const key = `${level}:${code}:${message}`;
    if (key === this.lastAlertKey && now - this.lastAlertAt < 8000) return null;
    this.lastAlertKey = key;
    this.lastAlertAt = now;
    const alert = { id: uid("alert"), ts: now, level, text: message, code };
    this.alerts.unshift(alert);
    if (this.alerts.length > 50) this.alerts.length = 50;
    this.emit("alert", alert);
    return alert;
  }

  alertOnce(code, level, text) {
    this.pushAlert(level, text, code);
  }

  loop(now = Date.now()) {
    if (this.engine?.isRunning) {
      const tick = this.engine.tick(now);
      if (tick.changed) {
        this.recordEffects(tick.effects, now);
        this.emit("effects", { effects: tick.effects, ts: now });
        this.persistSystem({ type: "system", ts: now, action: "tick", effects: tick.effects });
        this.watchRound(now);
      }
      this.saveActive();
    }
    this.broadcastState(now);
  }

  async dispose() {
    if (this.loopTimer) clearInterval(this.loopTimer);
    this.loopTimer = null;
    if (this.session) await this.stopSession({ reason: "service-stop" }).catch(() => undefined);
    this.stopSources();
    this.subscribers.clear();
  }

  on(name, handler) {
    this._emitter ??= new Map();
    if (!this._emitter.has(name)) this._emitter.set(name, new Set());
    this._emitter.get(name).add(handler);
    return () => this._emitter.get(name)?.delete(handler);
  }

  emit(name, payload) {
    const handlers = this._emitter?.get(name);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(payload);
      } catch {
        /* 订阅方异常不影响直播主流程 */
      }
    }
  }

  static gamesCatalog() {
    return GAMES;
  }
}
