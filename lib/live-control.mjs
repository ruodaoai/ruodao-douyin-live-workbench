/**
 * 场控与音频默认配置：纯数据 + 纯函数，便于单测。
 * 所有文案都是可直接上播的短句，主播可在家控台里改写。
 */

export const DEFAULT_BGM = {
  enabled: false,
  playing: false,
  volume: 0.35,
  fadeMs: 1200,
  duck: true,
  duckLevel: 0.22,
  route: "workbench", // workbench=主播本机（采集系统扬声器，自动播放最稳）| overlay=直播伴侣采集网页声音 | both
  track: null,
  playlist: [],
  updatedAt: 0,
};

export const DEFAULT_STAGE = {
  mode: "3d", // 3d | 2d | auto
  quality: "high", // high | balanced | low
  camera: "cinematic", // cinematic | fixed
  background: "auto",
  models: {}, // { human: "/assets/models/human.glb", zombie: "/assets/models/zombie.glb" }
  showHealth: true,
};

export const DEFAULT_CONTROL = {
  enabled: true,
  autoReply: true,
  tts: false,
  ttsVolume: 0.9,
  replyCooldownMs: 8000,
  scripts: [],
  rules: [],
  bannedWords: [],
  timeline: [],
  subtitle: { text: "", tone: "info", until: 0, at: 0 },
  updatedAt: 0,
};

export const DEFAULT_SCRIPTS = [
  { id: "open-1", group: "开场", title: "标准开场", hotkey: "F1", text: "欢迎来到直播间！今天这场我们玩点刺激的——扣 1 加入人类，扣 2 加入丧尸，你选哪边？" },
  { id: "open-2", group: "开场", title: "冲榜开场", hotkey: "", text: "新进来的家人们先别划走，右上角关注点一下，今天冲个在线新高，礼物直接改战场！" },
  { id: "hold-1", group: "留人", title: "三秒钩子", hotkey: "F2", text: "现在场上就差你这一票，扣个数字就能改写战局，进来就是自己人。" },
  { id: "hold-2", group: "留人", title: "倒计时留人", hotkey: "", text: "还有 30 秒结算，落后一方送一个小心心就能反打，别眨眼。" },
  { id: "play-1", group: "玩法", title: "规则速讲", hotkey: "F3", text: "规则很简单：扣 1 加人类，扣 2 加丧尸，礼物升兵种，先推掉对面基地的阵营赢。" },
  { id: "play-2", group: "玩法", title: "投票玩法", hotkey: "", text: "发送「加省份」给你的家乡投票，比如加广东、加四川，礼物可以给全省加票。" },
  { id: "gift-1", group: "礼物", title: "小额感谢", hotkey: "F4", text: "感谢家人的小心心，这一份心意已经变成战场上的兵力了！" },
  { id: "gift-2", group: "礼物", title: "大额感谢", hotkey: "", text: "感谢大哥的火箭！全体注意，火箭援军已经进场，直接推线！" },
  { id: "push-1", group: "冲榜", title: "最后冲刺", hotkey: "F5", text: "最后十秒！现在送礼物是双倍热度，想翻盘的家人抓紧这一波。" },
  { id: "end-1", group: "下播", title: "下播预告", hotkey: "F6", text: "今天先到这里，感谢每一位家人的陪伴，点个关注，明天同一时间继续开战。" },
];

export const DEFAULT_RULES = [
  { id: "rule-1", keywords: ["扣1", "扣 1", "1"], match: "exact", reply: "收到，{user} 加入人类阵营！", tone: "human", enabled: true },
  { id: "rule-2", keywords: ["扣2", "扣 2", "2"], match: "exact", reply: "收到，{user} 加入丧尸阵营！", tone: "zombie", enabled: true },
  { id: "rule-3", keywords: ["666", "冲冲冲", "加油"], match: "contains", reply: "全体加速！{user} 的助威已经变成推力。", tone: "boost", enabled: true },
  { id: "rule-4", keywords: ["来了", "大家好", "新人"], match: "contains", reply: "欢迎 {user} 进入直播间，扣个数字马上参战。", tone: "welcome", enabled: true },
  { id: "rule-5", keywords: ["关注"], match: "contains", reply: "感谢 {user} 的关注，已给你挂上回关提醒。", tone: "follow", enabled: true },
];

export const DEFAULT_TIMELINE = [
  { id: "tl-1", at: 0, action: "开场", scriptId: "open-1", bgm: "开场热血", enabled: true },
  { id: "tl-2", at: 180, action: "讲规则", scriptId: "play-1", bgm: "", enabled: true },
  { id: "tl-3", at: 600, action: "第一次冲榜", scriptId: "push-1", bgm: "冲刺鼓点", enabled: true },
  { id: "tl-4", at: 1500, action: "下播预告", scriptId: "end-1", bgm: "舒缓收尾", enabled: true },
];

const SCRIPT_GROUPS = ["开场", "留人", "玩法", "礼物", "冲榜", "下播", "自定义"];
const TONES = ["info", "human", "zombie", "boost", "welcome", "follow", "gift", "warning"];

const text = (value, max) => String(value ?? "").trim().slice(0, max);
const oneOf = (value, list, fallback) => (list.includes(value) ? value : fallback);
const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};

export function sanitizeBgm(value, fallback = DEFAULT_BGM) {
  const input = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_BGM;
  const track = input.track === null ? null : (input.track && typeof input.track === "object" ? {
    id: text(input.track.id || input.track.hash, 120),
    title: text(input.track.title || input.track.name, 80),
    artist: text(input.track.artist || input.track.singer, 80),
    url: text(input.track.url, 2000),
    hash: text(input.track.hash, 120),
    quality: text(input.track.quality, 12),
    isTrial: Boolean(input.track.isTrial),
    duration: Math.max(0, Number(input.track.duration) || 0),
    cover: text(input.track.cover, 2000),
    source: text(input.track.source || "kugou", 20),
    pickedAt: Number(input.track.pickedAt) || Date.now(),
  } : (base.track ?? null));
  const playlist = Array.isArray(input.playlist) ? input.playlist.slice(0, 40).map((item, index) => ({
    id: text(item?.id, 60) || `pl-${index + 1}`,
    title: text(item?.title || item?.name, 80),
    keywords: text(item?.keywords, 80),
    enabled: item?.enabled !== false,
  })).filter((item) => item.title || item.keywords) : (base.playlist ?? []);
  return {
    enabled: input.enabled === undefined ? Boolean(base.enabled) : Boolean(input.enabled),
    playing: input.playing === undefined ? Boolean(base.playing) : Boolean(input.playing),
    volume: clamp(input.volume ?? base.volume, 0, 1, 0.35),
    fadeMs: clamp(input.fadeMs ?? base.fadeMs, 0, 8000, 1200),
    duck: input.duck === undefined ? base.duck !== false : Boolean(input.duck),
    duckLevel: clamp(input.duckLevel ?? base.duckLevel, 0, 1, 0.22),
    route: oneOf(String(input.route ?? base.route), ["overlay", "workbench", "both"], "workbench"),
    track,
    playlist,
    updatedAt: Number(input.updatedAt) || 0,
  };
}

export function defaultControl() {
  return sanitizeControl({
    scripts: DEFAULT_SCRIPTS,
    rules: DEFAULT_RULES,
    timeline: DEFAULT_TIMELINE,
    bannedWords: ["加微信", "私聊", "刷单", "返利", "博彩", "贷款", "代充"],
  }, DEFAULT_CONTROL);
}

export function sanitizeControl(value, fallback = DEFAULT_CONTROL) {
  const input = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_CONTROL;
  const scripts = (Array.isArray(input.scripts) ? input.scripts : base.scripts || [])
    .slice(0, 80)
    .map((item, index) => ({
      id: text(item?.id, 60) || `script-${index + 1}`,
      group: oneOf(String(item?.group || "自定义"), SCRIPT_GROUPS, "自定义"),
      title: text(item?.title || "未命名话术", 40),
      hotkey: text(item?.hotkey, 12),
      text: text(item?.text, 300),
    }))
    .filter((item) => item.text);
  const rules = (Array.isArray(input.rules) ? input.rules : base.rules || [])
    .slice(0, 60)
    .map((item, index) => ({
      id: text(item?.id, 60) || `rule-${index + 1}`,
      keywords: (Array.isArray(item?.keywords) ? item.keywords : []).map((word) => text(word, 20)).filter(Boolean).slice(0, 10),
      match: oneOf(String(item?.match || "contains"), ["contains", "exact", "regex"], "contains"),
      reply: text(item?.reply, 160),
      tone: oneOf(String(item?.tone || "info"), TONES, "info"),
      enabled: item?.enabled !== false,
      cooldownMs: clamp(item?.cooldownMs, 0, 120000, 8000),
    }))
    .filter((item) => item.keywords.length && item.reply);
  const bannedWords = [...new Set((Array.isArray(input.bannedWords) ? input.bannedWords : base.bannedWords || [])
    .map((word) => text(word, 24)).filter(Boolean))].slice(0, 120);
  const timeline = (Array.isArray(input.timeline) ? input.timeline : base.timeline || [])
    .slice(0, 40)
    .map((item, index) => ({
      id: text(item?.id, 60) || `tl-${index + 1}`,
      at: clamp(item?.at, 0, 86400, 0),
      action: text(item?.action || "动作", 40),
      scriptId: text(item?.scriptId, 60),
      bgm: text(item?.bgm, 60),
      enabled: item?.enabled !== false,
    }));
  const subtitle = input.subtitle && typeof input.subtitle === "object" ? {
    text: text(input.subtitle.text, 120),
    tone: oneOf(String(input.subtitle.tone || "info"), TONES, "info"),
    until: Number(input.subtitle.until) || 0,
    at: Number(input.subtitle.at) || 0,
  } : (base.subtitle || { text: "", tone: "info", until: 0, at: 0 });
  return {
    enabled: input.enabled === undefined ? base.enabled !== false : Boolean(input.enabled),
    autoReply: input.autoReply === undefined ? base.autoReply !== false : Boolean(input.autoReply),
    tts: input.tts === undefined ? Boolean(base.tts) : Boolean(input.tts),
    ttsVolume: clamp(input.ttsVolume ?? base.ttsVolume, 0, 1, 0.9),
    replyCooldownMs: clamp(input.replyCooldownMs ?? base.replyCooldownMs, 0, 120000, 8000),
    scripts,
    rules,
    bannedWords,
    timeline,
    subtitle,
    updatedAt: Number(input.updatedAt) || 0,
  };
}

export function sanitizeStage(value, fallback = DEFAULT_STAGE) {
  const input = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_STAGE;
  const models = {};
  const rawModels = input.models && typeof input.models === "object" ? input.models : base.models || {};
  for (const [key, path] of Object.entries(rawModels)) {
    const clean = text(path, 300);
    if (clean && /^[a-zA-Z0-9_-]+$/.test(key)) models[key] = clean;
  }
  return {
    mode: oneOf(String(input.mode ?? base.mode), ["3d", "2d", "auto"], "3d"),
    quality: oneOf(String(input.quality ?? base.quality), ["high", "balanced", "low"], "high"),
    camera: oneOf(String(input.camera ?? base.camera), ["cinematic", "fixed"], "cinematic"),
    background: text(input.background ?? base.background, 120) || "auto",
    models,
    showHealth: input.showHealth === undefined ? base.showHealth !== false : Boolean(input.showHealth),
  };
}

export function matchControlRule(control, message) {
  const content = String(message ?? "").trim();
  if (!content) return null;
  const rules = Array.isArray(control?.rules) ? control.rules : [];
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    const keywords = Array.isArray(rule.keywords) ? rule.keywords : [];
    const hit = keywords.some((keyword) => {
      const word = String(keyword || "").trim();
      if (!word) return false;
      if (rule.match === "exact") return content === word;
      if (rule.match === "regex") {
        try { return new RegExp(word, "i").test(content); } catch { return false; }
      }
      return content.toLowerCase().includes(word.toLowerCase());
    });
    if (hit) return rule;
  }
  return null;
}

export function firstHitWord(control, message) {
  const content = String(message ?? "");
  const words = Array.isArray(control?.bannedWords) ? control.bannedWords : [];
  return words.find((word) => word && content.includes(word)) || "";
}
