import { DEMO_USER_NAMES, GIFT_BY_ID, GIFT_BY_NAME, GIFT_CATALOG, giftHeat } from "./catalog.mjs";
import { clamp, mulberry32, pick, safeId, safeText, uid, weightedPick } from "./util.mjs";

const TYPE_ALIASES = new Map([
  ["gift", "gift"],
  ["webcastgiftmessage", "gift"],
  ["giftmessage", "gift"],
  ["comment", "comment"],
  ["chat", "comment"],
  ["webcastchatmessage", "comment"],
  ["like", "like"],
  ["webcastlikemessage", "like"],
  ["follow", "follow"],
  ["social", "follow"],
  ["webcastsocialmessage", "follow"],
  ["enter", "enter"],
  ["member", "enter"],
  ["webcastmembermessage", "enter"],
  ["room_stats", "room_stats"],
  ["roomstats", "room_stats"],
  ["webcastroomuserseqmessage", "room_stats"],
  ["viewer", "room_stats"],
]);

function rawType(raw) {
  const method = String(raw?.method ?? raw?.methodName ?? "").trim().toLowerCase();
  if (method) return TYPE_ALIASES.get(method) ?? "";
  const type = String(raw?.type ?? raw?.event ?? raw?.eventType ?? raw?.kind ?? "").trim().toLowerCase();
  return TYPE_ALIASES.get(type) ?? "";
}

function rawUser(raw) {
  const source = raw?.user ?? raw?.fromUser ?? raw?.sender ?? raw?.member ?? raw?.author ?? {};
  const id = safeId(source.id ?? source.userId ?? source.sec_uid ?? source.secUid ?? source.uid ?? raw?.userId, "");
  const name = safeText(
    source.nickname ?? source.name ?? source.displayName ?? source.userName ?? raw?.nickname ?? raw?.userName,
    32,
  );
  const avatar = safeText(source.avatar ?? source.avatarUrl ?? source.avatar_url ?? source.avatarThumb?.url_list?.[0], 500);
  return {
    id: id || `guest_${safeId(name || "nobody", "nobody")}`,
    name: name || "神秘观众",
    avatar,
  };
}

function rawGift(raw, settings) {
  const gift = raw?.gift ?? raw?.giftInfo ?? {};
  const name = safeText(gift.name ?? gift.giftName ?? raw?.giftName ?? raw?.gift_name, 24);
  const id = safeId(gift.id ?? gift.giftId ?? raw?.giftId ?? raw?.gift_id, "");
  const catalog = GIFT_BY_ID.get(id) ?? GIFT_BY_NAME.get(name);
  const resolvedId = catalog?.id ?? id ?? (name ? `custom_${safeId(name, "gift")}` : "heart");
  const resolvedName = catalog?.name ?? name ?? "礼物";
  const count = clamp(
    Math.round(Number(raw?.count ?? raw?.repeatCount ?? raw?.repeat_count ?? raw?.comboCount ?? raw?.combo_count ?? gift.count) || 1),
    1,
    999,
  );
  const declaredHeat = Number(raw?.heat ?? raw?.value ?? gift.diamond_count ?? gift.diamondCount ?? gift.heat);
  const heat = catalog ? giftHeat(settings, catalog.id) : Number.isFinite(declaredHeat) && declaredHeat > 0 ? clamp(declaredHeat, 0.01, 100000) : 1;
  return {
    id: resolvedId,
    name: resolvedName,
    icon: catalog?.icon ?? "heart",
    color: catalog?.color ?? "#ff5c8a",
    tier: catalog?.tier ?? "light",
    heat,
    count,
    rawHeat: Number.isFinite(declaredHeat) ? declaredHeat : undefined,
  };
}

export function normalizeIncomingEvent(raw, { settings, now = Date.now(), source = "relay" } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const type = rawType(raw);
  if (!type) return null;
  const payload = raw?.payload && typeof raw.payload === "object" ? raw.payload : raw;
  const user = rawUser(payload);
  const ts = clamp(Number(raw.ts ?? raw.timestamp ?? raw.createTime ?? raw.create_time ?? now) || now, now - 10 * 60_000, now + 60_000);
  const id = safeId(raw.id ?? raw.msgId ?? raw.eventId ?? raw.event_id, "") || uid(`evt_${type}`);

  if (type === "room_stats") {
    const viewers = clamp(
      Number(payload.viewers ?? payload.viewerCount ?? payload.onlineCount ?? payload.roomViewers ?? payload.room_viewers ?? payload.total) || 0,
      0,
      10_000_000,
    );
    const likes = clamp(Number(payload.likes ?? payload.likeCount ?? payload.like_count ?? payload.totalLike) || 0, 0, 1_000_000_000);
    return {
      id,
      type,
      ts,
      source,
      user,
      room: { viewers: Math.round(viewers), likes: Math.round(likes) },
    };
  }

  if (type === "gift") {
    const gift = rawGift(payload, settings);
    return {
      id,
      type,
      ts,
      source,
      user,
      gift: {
        id: gift.id,
        name: gift.name,
        icon: gift.icon,
        color: gift.color,
        tier: gift.tier,
        heat: gift.heat,
      },
      count: gift.count,
      totalHeat: Math.round(gift.heat * gift.count),
      combo: clamp(Number(raw.combo ?? raw.comboCount ?? 0) || 0, 0, 9999),
      text: `${user.name} 送出 ${gift.name} ×${gift.count}`,
    };
  }

  if (type === "comment") {
    const text = safeText(payload.text ?? payload.content ?? payload.comment ?? payload.message, 120);
    if (!text) return null;
    return { id, type, ts, source, user, text };
  }

  if (type === "like") {
    return {
      id,
      type,
      ts,
      source,
      user,
      count: clamp(Math.round(Number(payload.count ?? payload.likeCount ?? 1) || 1), 1, 9999),
    };
  }

  return { id, type, ts, source, user, text: safeText(payload.text, 80) };
}

export function createGiftEvent({ user, userName, giftId, count = 1, settings, now = Date.now(), source = "manual" }) {
  const gift = GIFT_BY_ID.get(giftId) ?? GIFT_CATALOG[0];
  const name = safeText(user?.name ?? userName, 32) || "测试观众";
  const id = safeId(user?.id, "") || `manual_${safeId(name, "guest")}`;
  const finalCount = clamp(Math.round(Number(count) || 1), 1, 999);
  const heat = giftHeat(settings, gift.id);
  return {
    id: uid("evt_gift"),
    type: "gift",
    ts: now,
    source,
    user: { id, name, avatar: "" },
    gift: {
      id: gift.id,
      name: gift.name,
      icon: gift.icon,
      color: gift.color,
      tier: gift.tier,
      heat,
    },
    count: finalCount,
    totalHeat: Math.round(heat * finalCount),
    combo: 0,
    text: `${name} 送出 ${gift.name} ×${finalCount}`,
  };
}

export class DemoSource {
  constructor({ onEvent, settings, now = Date.now, random }) {
    this.onEvent = onEvent;
    this.settings = settings;
    this.now = now;
    this.random = random ?? mulberry32(0x5eed);
    this.timer = null;
    this.running = false;
    this.scenario = settings?.demo?.scenario ?? "normal";
    this.speed = clamp(Number(settings?.demo?.speed) || 1, 0.25, 6);
    this.users = new Map();
    this.giftBurst = 0;
    this.viewers = 860 + Math.floor(this.random() * 900);
    this.likes = 1200 + Math.floor(this.random() * 3000);
    this.tickCount = 0;
    this.stats = { emitted: 0, startedAt: 0 };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.stats.startedAt = this.now();
    this.schedule(600);
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  updateSettings(settings) {
    this.settings = settings;
    this.scenario = settings?.demo?.scenario ?? this.scenario;
    this.speed = clamp(Number(settings?.demo?.speed) || 1, 0.25, 6);
  }

  schedule(delay) {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), Math.max(120, delay / this.speed));
  }

  tick() {
    if (!this.running) return;
    const event = this.nextEvent();
    if (event) {
      this.onEvent(event);
      this.stats.emitted += 1;
    }
    const base = this.scenario === "burst" ? 360 : this.scenario === "finale" ? 420 : this.scenario === "quiet" ? 3600 : 1700;
    const jitter = this.scenario === "quiet" ? 2200 : 900;
    this.schedule(base + this.random() * jitter);
  }

  nextEvent() {
    const now = this.now();
    const scenario = this.scenario;
    this.tickCount += 1;
    this.viewers = clamp(this.viewers + Math.round((this.random() - 0.42) * 26), 80, 20000);
    if (this.tickCount % 10 === 0) {
      return { id: uid("demo_room"), type: "room_stats", ts: now, source: "demo", room: { viewers: this.viewers, likes: this.likes } };
    }
    const roll = this.random();
    const giftChance = scenario === "burst" ? 0.78 : scenario === "finale" ? 0.84 : scenario === "quiet" ? 0.2 : 0.5;
    if (roll < giftChance) return this.nextGift(now);
    if (roll < giftChance + 0.2) return this.nextComment(now);
    if (roll < giftChance + 0.36) {
      this.likes += 1 + Math.floor(this.random() * 12);
      return { id: uid("demo_like"), type: "like", ts: now, source: "demo", user: this.nextUser(), count: 1 + Math.floor(this.random() * 10) };
    }
    if (roll < giftChance + 0.43) return { id: uid("demo_follow"), type: "follow", ts: now, source: "demo", user: this.nextUser() };
    return { id: uid("demo_enter"), type: "enter", ts: now, source: "demo", user: this.nextUser() };
  }

  nextGift(now) {
    const scenario = this.scenario;
    const user = this.nextUser(true);
    const weights = GIFT_CATALOG.map((gift) => {
      let weight = gift.weight;
      if (scenario === "burst" && gift.tier === "light") weight *= 1.6;
      if (scenario === "finale" && (gift.tier === "high" || gift.tier === "top")) weight *= 6;
      if (scenario === "quiet") weight *= gift.tier === "light" ? 2 : 0.3;
      return weight;
    });
    const gift = weightedPick(GIFT_CATALOG, (item) => weights[GIFT_CATALOG.indexOf(item)], this.random);
    let count = 1;
    if (gift.tier === "light" && this.random() < 0.38) count = [3, 5, 10, 20][Math.floor(this.random() * 4)];
    if (gift.tier === "mid" && this.random() < 0.16) count = [2, 3, 5][Math.floor(this.random() * 3)];
    const heat = giftHeat(this.settings, gift.id);
    return {
      id: uid("demo_gift"),
      type: "gift",
      ts: now,
      source: "demo",
      user,
      gift: { id: gift.id, name: gift.name, icon: gift.icon, color: gift.color, tier: gift.tier, heat },
      count,
      totalHeat: heat * count,
      combo: 0,
      text: `${user.name} 送出 ${gift.name} ×${count}`,
    };
  }

  nextComment(now) {
    const user = this.nextUser();
    const options = [
      "让舞台亮起来", "开启能量核心", "AI 对决开始", "点赞波纹",
      "关注了", "再来一次超新星", "666", "这舞台太炸了", "准备送礼",
    ];
    return { id: uid("demo_comment"), type: "comment", ts: now, source: "demo", user, text: pick(options, this.random) };
  }

  nextUser(preferSpender = false) {
    if (preferSpender && this.users.size > 0 && this.random() < 0.34) {
      const spenders = [...this.users.values()].sort((a, b) => b.gifts - a.gifts).slice(0, 8);
      if (spenders.length > 0) return pick(spenders, this.random);
    }
    const existing = [...this.users.values()];
    if (existing.length > 0 && this.random() < 0.58) return pick(existing, this.random);
    const name = pick(DEMO_USER_NAMES, this.random);
    const user = { id: `demo_${safeId(name, "user")}_${Math.floor(this.random() * 1000)}`, name, avatar: "" };
    user.gifts = 0;
    this.users.set(user.id, user);
    return user;
  }
}

export class RelaySource {
  constructor({ onEvent, onStatus, now = Date.now }) {
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.now = now;
    this.ws = null;
    this.abort = null;
    this.timer = null;
    this.heartbeat = null;
    this.generation = 0;
    this.attempts = 0;
    this.lastMessageAt = 0;
    this.status = { state: "disconnected", url: "", lastError: "", attempts: 0, lastMessageAt: 0, reconnects: 0, messages: 0 };
  }

  snapshot() {
    return { ...this.status, lastMessageAt: this.lastMessageAt };
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch, attempts: this.attempts, lastMessageAt: this.lastMessageAt };
    this.onStatus?.(this.snapshot());
  }

  stop() {
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    try { this.ws?.close(); } catch { /* 已关闭 */ }
    this.ws = null;
    try { this.abort?.abort(); } catch { /* 已结束 */ }
    this.abort = null;
    this.setStatus({ state: "disconnected", lastError: "" });
  }

  async connect({ url, token, autoReconnect = true } = {}) {
    this.stop();
    const target = String(url || "").trim();
    if (!/^(wss?|https?):\/\//i.test(target)) {
      this.setStatus({ state: "error", url: target, lastError: "互动源地址必须是 ws://、wss://、http:// 或 https://" });
      return this.snapshot();
    }
    let finalUrl = target;
    if (token && !/[?&]token=/.test(finalUrl)) {
      finalUrl += `${finalUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
    }
    this.autoReconnect = autoReconnect !== false;
    this.attempts = 0;
    this.url = finalUrl;
    this.setStatus({ state: "connecting", url: target, lastError: "" });
    if (/^wss?:/i.test(finalUrl)) this.connectWs(finalUrl);
    else this.connectHttp(finalUrl);
    return this.snapshot();
  }

  connectWs(url) {
    if (typeof WebSocket !== "function") {
      this.setStatus({ state: "error", lastError: "当前 Node 不支持 WebSocket，请升级到 Node 22+" });
      return;
    }
    const generation = ++this.generation;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (error) {
      this.setStatus({ state: "error", lastError: `连接失败：${String(error?.message ?? error)}` });
      this.scheduleReconnect(generation);
      return;
    }
    this.ws = ws;
    ws.addEventListener("open", () => {
      if (generation !== this.generation) return;
      this.attempts = 0;
      this.lastMessageAt = this.now();
      this.setStatus({ state: "connected", lastError: "" });
      this.heartbeat = setInterval(() => {
        if (generation !== this.generation) return;
        if (this.now() - this.lastMessageAt > 55_000) {
          this.setStatus({ state: "error", lastError: "55 秒没有收到互动消息，正在重连" });
          try { ws.close(); } catch { /* 已关闭 */ }
        }
      }, 15_000);
    });
    ws.addEventListener("message", (event) => {
      if (generation !== this.generation) return;
      this.lastMessageAt = this.now();
      this.status.messages += 1;
      const text = typeof event.data === "string" ? event.data : "";
      if (!text) return;
      this.emitPayload(text);
    });
    ws.addEventListener("error", () => {
      if (generation !== this.generation) return;
      this.setStatus({ state: "error", lastError: "互动源连接异常" });
    });
    ws.addEventListener("close", (event) => {
      if (generation !== this.generation) return;
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      this.setStatus({ state: "disconnected", lastError: event?.reason ? String(event.reason).slice(0, 200) : "" });
      this.scheduleReconnect(generation);
    });
  }

  async connectHttp(url) {
    const generation = ++this.generation;
    const controller = new AbortController();
    this.abort = controller;
    try {
      const response = await fetch(url, {
        headers: { accept: "text/event-stream, application/x-ndjson, application/json" },
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.attempts = 0;
      this.lastMessageAt = this.now();
      this.setStatus({ state: "connected", lastError: "" });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.body) throw new Error("互动源没有返回可读取的数据流");
      if (/application\/json/i.test(contentType) && !/ndjson/i.test(contentType)) {
        const payload = await response.json();
        this.emitObject(payload);
        this.setStatus({ state: "disconnected", lastError: "" });
        this.scheduleReconnect(generation);
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (generation !== this.generation) break;
        buffer += decoder.decode(value, { stream: true });
        let index = buffer.indexOf("\n");
        while (index >= 0) {
          const line = buffer.slice(0, index).replace(/\r$/, "");
          buffer = buffer.slice(index + 1);
          if (line.trim()) {
            this.lastMessageAt = this.now();
            this.status.messages += 1;
            if (/^(data|event):/i.test(line)) {
              if (line.startsWith("data:")) this.emitPayload(line.slice(5).trim());
            } else {
              this.emitPayload(line.trim());
            }
          }
          index = buffer.indexOf("\n");
        }
      }
      this.setStatus({ state: "disconnected", lastError: "" });
      this.scheduleReconnect(generation);
    } catch (error) {
      if (generation !== this.generation) return;
      if (error?.name === "AbortError") return;
      this.setStatus({ state: "error", lastError: `互动源连接失败：${String(error?.message ?? error).slice(0, 200)}` });
      this.scheduleReconnect(generation);
    }
  }

  emitPayload(text) {
    try {
      const payload = JSON.parse(text);
      this.emitObject(payload);
    } catch {
      this.status.parseErrors = (this.status.parseErrors || 0) + 1;
      if (this.status.parseErrors % 5 === 1) console.warn(`[live] 互动源返回了非 JSON 消息（累计 ${this.status.parseErrors} 条）`);
    }
  }

  emitObject(payload) {
    if (!payload) return;
    if (Array.isArray(payload)) {
      payload.forEach((item) => this.onEvent(item));
      return;
    }
    if (Array.isArray(payload.events)) {
      payload.events.forEach((item) => this.onEvent(item));
      return;
    }
    this.onEvent(payload);
  }

  scheduleReconnect(generation) {
    if (generation !== this.generation || !this.autoReconnect) return;
    this.attempts += 1;
    const delay = Math.min(15_000, 800 * Math.pow(1.7, Math.min(this.attempts, 8)));
    this.setStatus({ state: "connecting", lastError: `将在 ${(delay / 1000).toFixed(1)} 秒后重连` });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (generation !== this.generation) return;
      this.status.reconnects = (this.status.reconnects || 0) + 1;
      if (/^https?:/i.test(this.url)) this.connectHttp(this.url);
      else this.connectWs(this.url);
    }, delay);
  }
}
