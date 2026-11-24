import {
  h,
  clear,
  setText,
  formatNum,
  formatCompact,
  formatClock,
} from "../scenes/core.mjs";
import { giftIcon, uiIcon } from "./icons.mjs";

const params = new URLSearchParams(location.search);
const host = window.ruodao && window.ruodao.service ? window.ruodao : null;
const isHttp = location.protocol === "http:" || location.protocol === "https:";

const DEMO_USERS = [
  "晚风不打烊", "小鹿乱撞", "一颗栗子", "北岛不冷", "橙子汽水", "月亮邮差", "阿泽同学", "糖分超标",
  "海盐可可", "大橘为重", "云朵收藏家", "不吃香菜", "半糖去冰", "追光的人", "桃桃乌龙", "凌晨四点",
  "鲸落南星", "山野雾灯", "芝士年糕", "风吹麦浪", "满眼星河", "芋泥啵啵", "猫在打盹", "夏日限定",
  "南风知我意", "小熊软糖", "落日飞车", "一杯冰美式", "快乐星球", "柠檬不酸", "晚安电台", "风吹过夏天",
];
const GIFT_DEFAULT_HEAT = { heart: 1, rose: 2, candy: 5, beer: 10, shades: 30, crown: 100, sportscar: 500, rocket: 1000, carnival: 3000 };
const SCENARIO_LABELS = { normal: "常态互动", burst: "礼物爆发", finale: "终场冲榜", quiet: "安静陪伴" };
const EVENT_LABELS = { gift: "礼物", comment: "评论", like: "点赞", follow: "关注", enter: "进场", room_stats: "在线" };
const REASON_LABELS = { target: "目标达成", timeout: "时间到", manual: "手动结算", finish: "冲线", switch: "切换玩法", "service-stop": "服务停止" };
const RELAY_LABELS = { connected: "已连接", connecting: "连接中", disconnected: "未连接", error: "连接失败" };
const TAB_HINTS = {
  console: "选择玩法 · 检查互动源 · 一键开播",
  data: "礼物热度 · 玩法实时数据 · 贡献榜",
  monitor: "互动源 · 健康告警 · 实时事件",
  review: "本场复盘 · 历史场次",
  control: "字幕上屏 · 话术库 · 自动应答 · 背景音乐",
  settings: "直播间 · 中继 · 演示 · 礼物视觉权重",
};

const dm = {};
const el = (id) => (dm[id] ||= document.getElementById(id));

let runtime = null;
let state = null;
let previousState = null;
let games = [];
let gifts = [];
const gameMap = new Map();
const giftMap = new Map();
let selectedGameId = "";
let selectedGiftId = "heart";
let activeTab = "console";
let clockOffset = 0;
let lastStateAt = 0;
let optionsGameId = "";
let optionsTimer = 0;
let optionsResetTimer = 0;
let chartSig = "";
let giftSig = "";
let streamSig = "";
let sessionsLoaded = false;
let sessionsLoading = false;
let lastReport = null;
let themeChoice = "neon";
let booting = false;

const now = () => Date.now() + clockOffset;
const errText = (error) => String(error?.message ?? error ?? "未知错误");
const pad2 = (value) => String(value).padStart(2, "0");

function fmtTime(ts) {
  if (!ts) return "—";
  const date = new Date(ts);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function fmtDateTime(ts) {
  if (!ts) return "—";
  const date = new Date(ts);
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function fmtAgo(ts) {
  if (!ts) return "暂无";
  const seconds = Math.max(0, Math.round((now() - ts) / 1000));
  if (seconds < 5) return "刚刚";
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  return `${Math.floor(seconds / 3600)} 小时前`;
}

function fmtBytes(bytes) {
  const size = Number(bytes) || 0;
  if (size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function hashId(text) {
  let hash = 0;
  for (const char of String(text)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return `sim_${hash.toString(36)}`;
}

function randomDemoUser() {
  const name = DEMO_USERS[Math.floor(Math.random() * DEMO_USERS.length)];
  return Math.random() < 0.4 ? `${name}·${Math.floor(Math.random() * 90) + 10}` : name;
}

/* ── 传输层：浏览器直连 / 桌面端常驻服务 ─────────────────────── */

async function httpJson(path, init = {}) {
  const headers = { "x-live-token": runtime.token, ...(init.headers || {}) };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${runtime.base}${path}`, {
    cache: "no-store",
    method: init.method || "GET",
    body: init.body,
    headers,
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `请求失败（HTTP ${response.status}）`);
  return data;
}

async function apiHttp(method, payload = {}) {
  switch (method) {
    case "state": return httpJson("/api/state");
    case "games": return httpJson("/api/games");
    case "settings.save": return httpJson("/api/settings", { method: "POST", body: JSON.stringify({ patch: payload }) });
    case "session.start": return httpJson("/api/session/start", { method: "POST", body: JSON.stringify(payload) });
    case "session.stop": return httpJson("/api/session/stop", { method: "POST", body: JSON.stringify(payload) });
    case "session.next": return httpJson("/api/session/next", { method: "POST", body: "{}" });
    case "session.report": return httpJson("/api/session/report");
    case "event.gift": return httpJson("/api/event/gift", { method: "POST", body: JSON.stringify(payload) });
    case "event.raw": return httpJson("/api/event/raw", { method: "POST", body: JSON.stringify({ payload }) });
    case "source.connect": return httpJson("/api/source/connect", { method: "POST", body: JSON.stringify(payload) });
    case "source.disconnect": return httpJson("/api/source/disconnect", { method: "POST", body: "{}" });
    case "sessions.list": return httpJson("/api/sessions");
    case "sessions.read": return httpJson(`/api/sessions/${encodeURIComponent(payload.id)}`);
    case "sessions.delete": return httpJson(`/api/sessions/${encodeURIComponent(payload.id)}`, { method: "DELETE" });
    case "assets": return httpJson("/api/assets");
    case "control.push": return httpJson("/api/control/push", { method: "POST", body: JSON.stringify(payload) });
    case "control.script": return httpJson("/api/control/script", { method: "POST", body: JSON.stringify(payload) });
    case "control.save": return httpJson("/api/control/save", { method: "POST", body: JSON.stringify(payload) });
    case "control.generate": return httpJson("/api/control/generate", { method: "POST", body: JSON.stringify(payload) });
    case "music.status": return httpJson("/api/music/status");
    case "music.search": return httpJson("/api/music/search", { method: "POST", body: JSON.stringify(payload) });
    case "music.play": return httpJson("/api/music/play", { method: "POST", body: JSON.stringify(payload) });
    case "bgm.control": return httpJson("/api/bgm/control", { method: "POST", body: JSON.stringify(payload) });
    case "stage.save": return httpJson("/api/stage", { method: "POST", body: JSON.stringify(payload) });
    case "models.delete": return httpJson("/api/models/delete", { method: "POST", body: JSON.stringify(payload) });
    default: throw new Error(`未知接口：${method}`);
  }
}

function request(method, payload = {}, options = {}) {
  if (runtime.mode === "host") {
    if (!host) return Promise.reject(new Error("桌面端服务桥不可用"));
    return host.service.call("main", method, payload, options.timeoutMs);
  }
  return apiHttp(method, payload);
}

async function fetchState() {
  const result = await request("state");
  const next = result?.state ?? result;
  if (!next || !next.app) throw new Error("互动服务返回异常");
  return next;
}

async function fetchGames() {
  const result = await request("games");
  return {
    games: Array.isArray(result?.games) ? result.games : [],
    gifts: Array.isArray(result?.gifts) ? result.gifts : [],
  };
}

async function saveSettings(patch) {
  const result = await request("settings.save", patch);
  return result?.settings ?? result;
}

async function resolveRuntime() {
  if (isHttp) {
    const token = params.get("token") || "";
    if (!token) throw new Error("缺少访问令牌，请从插件入口或 serve 命令打印的完整地址打开");
    const response = await fetch(`/api/runtime?token=${encodeURIComponent(token)}`, { cache: "no-store" });
    const info = await response.json().catch(() => null);
    if (!response.ok || !info?.port) throw new Error("互动服务没有返回运行时信息");
    return {
      mode: "http",
      base: location.origin,
      token,
      port: Number(info.port) || location.port,
      overlayUrl: info.overlayUrl,
      dataDir: info.dataDir,
      version: info.version,
    };
  }
  if (!host) throw new Error("请通过若道桌面端的插件入口打开直播工作台");
  await host.ready;
  await host.service.start("main", { payload: {}, readyTimeoutMs: 30000 });
  const info = await host.service.call("main", "runtime");
  if (!info?.port) throw new Error("直播互动服务没有返回端口");
  return {
    mode: "host",
    base: info.baseUrl,
    token: info.token,
    port: Number(info.port),
    overlayUrl: info.overlayUrl,
    dataDir: info.dataDir,
    version: info.version,
  };
}

/* ── 基础 UI 组件 ─────────────────────────────────────────────── */

function toast(message, tone = "") {
  const text = String(message ?? "").trim();
  if (!text) return;
  const box = el("toasts");
  while (box.childElementCount >= 4) box.firstElementChild?.remove();
  const node = h("div", { class: `toast-item ${tone}`.trim(), text });
  box.appendChild(node);
  setTimeout(() => {
    node.classList.add("out");
    setTimeout(() => node.remove(), 260);
  }, 3200);
}

let modalResolve = null;

function confirmAction(title, text, confirmLabel = "确认") {
  setText(el("modal-title"), title);
  setText(el("modal-text"), text);
  setText(el("modal-confirm"), confirmLabel);
  el("modal-cancel").hidden = false;
  el("modal").hidden = false;
  el("modal-confirm").focus();
  return new Promise((resolve) => {
    modalResolve = resolve;
  });
}

function closeModal(result) {
  if (el("modal").hidden) return;
  el("modal").hidden = true;
  const resolve = modalResolve;
  modalResolve = null;
  resolve?.(result);
}

function showCopyFallback(text) {
  setText(el("modal-title"), "请手动复制");
  setText(el("modal-text"), text);
  setText(el("modal-confirm"), "知道了");
  el("modal-cancel").hidden = true;
  el("modal").hidden = false;
  modalResolve = null;
}

async function copyText(text, label = "已复制") {
  const value = String(text ?? "");
  if (!value) return;
  try {
    if (host?.clipboard) await host.clipboard.writeText(value);
    else await navigator.clipboard.writeText(value);
    toast(label, "ok");
    return;
  } catch {
    /* 沙箱里 Clipboard API 可能被拒绝，退回 execCommand */
  }
  try {
    const area = h("textarea", { style: { position: "fixed", left: "-9999px", top: "0" } });
    area.value = value;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    if (ok) {
      toast(label, "ok");
      return;
    }
  } catch {
    /* 最后交给手动复制弹窗 */
  }
  showCopyFallback(value);
}

function openUrl(url) {
  if (!url) return;
  if (host?.openExternal) {
    host.openExternal(url).catch(() => toast("打开浏览器失败，请手动复制地址", "err"));
    return;
  }
  const opened = window.open(url, "_blank", "noopener");
  if (!opened) toast("浏览器拦截了新窗口，请允许弹窗或手动复制地址", "err");
}

function setPill(node, tone, text) {
  if (!node) return;
  node.classList.remove("ok", "warn", "bad", "live", "neutral");
  if (tone) node.classList.add(tone);
  const label = node.querySelector("span");
  if (label) setText(label, text);
  else setText(node, text);
}

function setTagTone(node, tone) {
  if (!node) return;
  node.classList.remove("good", "warn", "bad", "live");
  if (tone) node.classList.add(tone);
}

function busy(button, on, text) {
  if (!button) return;
  if (on) {
    if (!button.dataset.idleHtml) button.dataset.idleHtml = button.innerHTML;
    button.disabled = true;
    button.textContent = text || "处理中…";
    return;
  }
  button.disabled = false;
  if (button.dataset.idleHtml) {
    button.innerHTML = button.dataset.idleHtml;
    delete button.dataset.idleHtml;
  }
}

function statCard(label, value, hint, tone = "") {
  return h("div", { class: `stat ${tone}`.trim() },
    h("span", { text: label }),
    h("b", { text: value }),
    hint ? h("em", { text: hint }) : null);
}

function miniStat(label, value, tone = "") {
  return h("div", { class: "mini-stat" },
    h("span", { text: label }),
    h("b", { class: tone, text: value }));
}

function tableEmpty(text) {
  return h("div", { class: "table-empty", text });
}

/* ── 状态接收 ─────────────────────────────────────────────────── */

function applyState(next) {
  if (!next || typeof next !== "object" || !next.app) return;
  previousState = state;
  state = next;
  lastStateAt = Date.now();
  clockOffset = Number(next.serverTime || Date.now()) - Date.now();
  if (!selectedGameId) selectedGameId = next.settings?.lastGameId || games[0]?.id || "human-vs-zombie";
  syncGiftHeat();
  renderAll();
  detectTransitions(previousState, next);
  updateDocumentTitle();
}

function detectTransitions(prev, next) {
  if (!prev) return;
  if (!prev.session && next.session) {
    toast(`已开播：${next.session.gameName}`, "ok");
    giftFeedback("直播已开始，可以发送测试礼物", "ok");
  }
  if (prev.session && !next.session) {
    toast("本场直播已结束，数据已归档到复盘", "ok");
    sessionsLoaded = false;
    lastReport = null;
    loadLastReport();
    if (activeTab === "review") {
      loadSessions(true);
      renderReview();
    }
  }
}

function updateDocumentTitle() {
  if (state?.session) document.title = `直播中 · ${state.session.gameName} · 抖音直播工作台`;
  else document.title = "抖音直播工作台";
}

function syncGiftHeat() {
  const custom = state?.settings?.giftHeat || {};
  for (const gift of gifts) {
    const heat = Number(custom[gift.id]);
    gift.heat = Number.isFinite(heat) && heat >= 0 ? heat : GIFT_DEFAULTS[gift.id] ?? gift.heat;
  }
}

/* ── 场控台 ───────────────────────────────────────────────────── */

const CONTROL_TONE_LABELS = {
  info: "常规", human: "人类", zombie: "丧尸", gift: "礼物", boost: "冲榜", welcome: "欢迎", follow: "关注", warning: "警示",
};

let localBgm = null;
let localBgmUrl = "";
let bgmResultsCache = [];

function controlData() {
  return state?.control || state?.settings?.control || {};
}

function bgmData() {
  return state?.settings?.bgm || {};
}

function renderControl() {
  const control = controlData();
  const bgm = bgmData();
  const live = Boolean(state?.session);
  const box = el("control-live");
  if (box) {
    clear(box);
    box.append(
      h("div", { class: "control-live-item" }, h("span", { text: "直播状态" }), h("b", { text: live ? "直播中" : "待开播", class: live ? "good" : "" })),
      h("div", { class: "control-live-item" }, h("span", { text: "自动应答" }), h("b", { text: control.autoReply ? "开启" : "关闭" })),
      h("div", { class: "control-live-item" }, h("span", { text: "语音播报" }), h("b", { text: control.tts ? "开启" : "关闭" })),
      h("div", { class: "control-live-item" }, h("span", { text: "背景音乐" }), h("b", { text: bgm.playing ? (bgm.track?.title || "播放中") : "停止" })),
      h("div", { class: "control-live-item" }, h("span", { text: "上屏字幕" }), h("b", { text: control.subtitle?.text || "无" })),
    );
  }
  const subtitleTag = el("control-subtitle-tag");
  if (subtitleTag) {
    setText(subtitleTag, control.subtitle?.text ? "已上屏" : "待上屏");
    setTagTone(subtitleTag, control.subtitle?.text ? "good" : "");
  }
  if (el("control-auto") && document.activeElement !== el("control-auto")) el("control-auto").checked = control.autoReply !== false;
  if (el("control-tts-global") && document.activeElement !== el("control-tts-global")) el("control-tts-global").checked = Boolean(control.tts);
  if (el("control-banned") && document.activeElement !== el("control-banned")) el("control-banned").value = (control.bannedWords || []).join("，");
  renderScriptGroups(control);
  renderRules(control);
  renderTimeline(control);
  renderBgm();
  renderStage();
}

function renderScriptGroups(control) {
  const box = el("script-groups");
  if (!box) return;
  const scripts = Array.isArray(control.scripts) ? control.scripts : [];
  const groups = new Map();
  for (const script of scripts) {
    const group = script.group || "自定义";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(script);
  }
  if (!scripts.length) {
    box.replaceChildren(tableEmpty("还没有话术，点右上角「AI 生成 5 条」"));
    return;
  }
  const nodes = [];
  for (const [group, rows] of groups) {
    const section = h("div", { class: "script-group" });
    section.append(h("div", { class: "script-group-head" }, h("b", { text: group }), h("span", { text: rows.length + " 条" })));
    const grid = h("div", { class: "script-grid" });
    for (const script of rows) {
      const button = h("button", { type: "button", class: "script-chip" },
        h("span", { class: "script-title" }, script.hotkey ? h("kbd", { text: script.hotkey }) : null, script.title || "未命名"),
        h("span", { class: "script-text", text: script.text }),
      );
      button.addEventListener("click", () => runScript(script.id));
      grid.append(button);
    }
    section.append(grid);
    nodes.push(section);
  }
  box.replaceChildren(...nodes);
}

function renderRules(control) {
  const box = el("rule-list");
  if (!box) return;
  const rules = Array.isArray(control.rules) ? control.rules : [];
  setText(el("rule-tag"), rules.filter((rule) => rule.enabled !== false).length + " 条");
  if (!rules.length) {
    box.replaceChildren(tableEmpty("还没有自动应答规则"));
    return;
  }
  const rows = rules.map((rule) => {
    const row = h("div", { class: "rule-row" + (rule.enabled === false ? " is-off" : "") },
      h("div", { class: "rule-keys" }, ...(rule.keywords || []).slice(0, 4).map((word) => h("span", { class: "rule-key", text: word }))),
      h("div", { class: "rule-reply", text: rule.reply }),
      h("button", { type: "button", class: "btn ghost small", text: rule.enabled === false ? "启用" : "停用" }),
    );
    row.querySelector("button").addEventListener("click", () => toggleRule(rule.id));
    return row;
  });
  box.replaceChildren(...rows);
}

function renderTimeline(control) {
  const box = el("timeline-list");
  if (!box) return;
  const timeline = Array.isArray(control.timeline) ? control.timeline : [];
  if (!timeline.length) {
    box.replaceChildren(tableEmpty("还没有场控时间轴"));
    return;
  }
  const startedAt = Number(state?.session?.startedAt) || 0;
  const minute = startedAt ? Math.floor((Date.now() + clockOffset - startedAt) / 60000) : 0;
  const rows = timeline.slice().sort((a, b) => a.at - b.at).map((item) => {
    const atMinute = Math.round((Number(item.at) || 0) / 60);
    const due = startedAt && minute >= atMinute;
    const row = h("div", { class: "timeline-row" + (due ? " is-due" : "") },
      h("div", { class: "timeline-time" }, h("b", { text: "第 " + atMinute + " 分钟" }), h("span", { text: due ? "已到点" : "待触发" })),
      h("div", { class: "timeline-action" }, h("b", { text: item.action || "动作" }), h("span", { text: item.bgm || "" })),
      h("button", { type: "button", class: "btn ghost small", text: "执行" }),
    );
    row.querySelector("button").addEventListener("click", () => runTimeline(item));
    return row;
  });
  box.replaceChildren(...rows);
}

function renderBgm() {
  const bgm = bgmData();
  const track = bgm.track || null;
  const now = el("bgm-now");
  if (now) {
    now.replaceChildren(...(track ? [
      h("div", { class: "bgm-cover", text: (track.title || "BGM").slice(0, 1) }),
      h("div", { class: "bgm-meta" }, h("b", { text: track.title || "未命名曲目" }), h("span", { text: [track.artist, track.isTrial ? "试听" : track.quality ? track.quality + "k" : ""].filter(Boolean).join(" · ") || "本地音乐插件" })),
    ] : [h("div", { class: "bgm-meta" }, h("b", { text: "还没有选择背景音乐" }), h("span", { text: "搜索歌名或歌手，点结果即可播放" }))]));
  }
  setText(el("bgm-status"), track ? "当前：" + (track.title || "未命名") + (track.artist ? " · " + track.artist : "") : "未选择曲目");
  const tag = el("bgm-tag");
  if (tag) {
    setText(tag, bgm.playing ? "播放中" : "停止");
    setTagTone(tag, bgm.playing ? "good" : "");
  }
  if (el("bgm-route") && document.activeElement !== el("bgm-route")) el("bgm-route").value = bgm.route || "workbench";
  if (el("bgm-volume") && document.activeElement !== el("bgm-volume")) el("bgm-volume").value = Math.round((Number(bgm.volume) || 0.35) * 100);
  setText(el("bgm-volume-label"), Math.round((Number(bgm.volume) || 0.35) * 100) + "%");
}

function syncLocalBgm() {
  const bgm = bgmData();
  const route = bgm.route || "overlay";
  const wanted = Boolean(bgm.enabled && bgm.playing && bgm.track?.url && route !== "overlay");
  if (!localBgm) {
    localBgm = new Audio();
    localBgm.preload = "auto";
  }
  if (!wanted) {
    if (!localBgm.paused) localBgm.pause();
    return;
  }
  const url = runtime.base + "/api/bgm/stream?token=" + encodeURIComponent(runtime.token) + "&v=" + encodeURIComponent(bgm.updatedAt || 0);
  if (url !== localBgmUrl) {
    localBgmUrl = url;
    localBgm.src = url;
    localBgm.load();
  }
  localBgm.volume = Math.max(0, Math.min(1, Number(bgm.volume) || 0.35));
  if (localBgm.paused) localBgm.play().catch(() => undefined);
}

async function pushControlText() {
  const text = el("control-text").value.trim();
  if (!text) {
    toast("先输入要上屏的内容", "err");
    return;
  }
  const button = el("control-push");
  busy(button, true, "上屏中…");
  try {
    await request("control.push", { text, tone: el("control-tone").value, durationMs: 7000, tts: el("control-tts-once").checked });
    el("control-text").value = "";
    toast("已上屏，覆盖层同步显示", "ok");
  } catch (error) {
    toast("上屏失败：" + errText(error), "err");
  } finally {
    busy(button, false);
  }
}

async function runScript(scriptId) {
  try {
    await request("control.script", { scriptId });
    toast("话术已上屏", "ok");
  } catch (error) {
    toast("执行失败：" + errText(error), "err");
  }
}

async function runTimeline(item) {
  try {
    if (item.scriptId) await request("control.script", { scriptId: item.scriptId });
    else await request("control.push", { text: item.action || "场控提醒", tone: "info", durationMs: 6000 });
    toast("已执行：" + (item.action || "场控动作"), "ok");
  } catch (error) {
    toast("执行失败：" + errText(error), "err");
  }
}

async function toggleRule(ruleId) {
  const control = controlData();
  const rules = (control.rules || []).map((rule) => rule.id === ruleId ? { ...rule, enabled: rule.enabled === false } : rule);
  try {
    await request("control.save", { patch: { rules } });
    toast("自动应答规则已更新", "ok");
  } catch (error) {
    toast("更新失败：" + errText(error), "err");
  }
}

async function saveControlSettings() {
  const button = el("control-save");
  busy(button, true, "保存中…");
  try {
    await request("control.save", {
      patch: {
        autoReply: el("control-auto").checked,
        tts: el("control-tts-global").checked,
        bannedWords: el("control-banned").value.split(/[，,\s]+/).map((word) => word.trim()).filter(Boolean).slice(0, 120),
      },
    });
    toast("场控设置已保存", "ok");
  } catch (error) {
    toast("保存失败：" + errText(error), "err");
  } finally {
    busy(button, false);
  }
}

async function generateControlScripts() {
  const button = el("control-ai");
  busy(button, true, "生成中…");
  try {
    const result = await request("control.generate", { scene: "开场", count: 5 });
    const lines = Array.isArray(result?.scripts) ? result.scripts : [];
    if (!lines.length) throw new Error("没有生成可用话术");
    const control = controlData();
    const scripts = [...(control.scripts || [])];
    const stamp = Date.now();
    lines.forEach((text, index) => {
      scripts.push({ id: "ai-" + stamp + "-" + (index + 1), group: "自定义", title: "AI 开场 " + (index + 1), hotkey: "", text: String(text).slice(0, 300) });
    });
    await request("control.save", { patch: { scripts } });
    toast(result?.warning ? "已用本地模板生成（" + result.warning + "）" : "AI 话术已加入话术库", "ok");
  } catch (error) {
    toast("生成失败：" + errText(error), "err");
  } finally {
    busy(button, false);
  }
}

async function searchBgm() {
  const keywords = el("bgm-query").value.trim();
  if (!keywords) {
    toast("请输入歌名或歌手", "err");
    return;
  }
  const button = el("bgm-search");
  busy(button, true, "搜索中…");
  try {
    const result = await request("music.search", { keywords });
    bgmResultsCache = Array.isArray(result?.songs) ? result.songs : [];
    renderBgmResults(bgmResultsCache);
    if (!bgmResultsCache.length) toast("没有搜到歌曲，换个关键词试试", "err");
  } catch (error) {
    toast("搜索失败：" + errText(error), "err");
  } finally {
    busy(button, false);
  }
}

function renderBgmResults(songs) {
  const box = el("bgm-results");
  if (!box) return;
  if (!songs.length) {
    box.replaceChildren(tableEmpty("没有搜索结果"));
    return;
  }
  box.replaceChildren(...songs.map((song) => {
    const row = h("div", { class: "bgm-item" },
      h("div", { class: "bgm-item-main" }, h("b", { text: song.title || "未命名" }), h("span", { text: song.artist || "未知歌手" })),
      h("span", { class: "tag", text: song.isTrial ? "试听" : song.quality ? song.quality + "k" : "播放" }),
    );
    row.addEventListener("click", () => playBgmSong(song));
    return row;
  }));
}

async function playBgmSong(song) {
  try {
    await request("music.play", { hash: song.hash, title: song.title, artist: song.artist });
    toast("正在播放：" + (song.title || "BGM"), "ok");
  } catch (error) {
    toast("播放失败：" + errText(error), "err");
  }
}

async function toggleBgm() {
  try {
    await request("bgm.control", { action: "toggle" });
  } catch (error) {
    toast("操作失败：" + errText(error), "err");
  }
}

async function changeBgmVolume(value) {
  const volume = Math.max(0, Math.min(1, Number(value) / 100));
  setText(el("bgm-volume-label"), Math.round(volume * 100) + "%");
  try {
    await request("bgm.control", { volume });
  } catch (error) {
    toast("音量保存失败：" + errText(error), "err");
  }
}

async function changeBgmRoute(route) {
  try {
    await request("bgm.control", { route });
    toast(route === "overlay" ? "BGM 从覆盖层播放（直播伴侣采集网页声音）" : route === "workbench" ? "BGM 从本机播放（直播伴侣采集系统声音）" : "BGM 同时从两边播放，注意回声", "ok");
  } catch (error) {
    toast("切换失败：" + errText(error), "err");
  }
}

function handleControlHotkey(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
  const scripts = controlData().scripts || [];
  const script = scripts.find((item) => item.hotkey && item.hotkey.toUpperCase() === String(event.key).toUpperCase());
  if (!script) return;
  event.preventDefault();
  runScript(script.id);
}

let stageAssets = null;

function stageData() {
  return state?.settings?.stage || {};
}

async function loadStageAssets(force = false) {
  if (stageAssets && !force) return stageAssets;
  try {
    stageAssets = await request("assets");
  } catch {
    stageAssets = { models: [], backgrounds: [] };
  }
  return stageAssets;
}

function fillStageBackgrounds() {
  const select = el("stage-background");
  if (!select) return;
  const current = stageData().background || "auto";
  const backgrounds = Array.isArray(stageAssets?.backgrounds) ? stageAssets.backgrounds : [];
  const options = [h("option", { value: "auto", text: "自动匹配玩法" })];
  for (const item of backgrounds) options.push(h("option", { value: item.url, text: item.name }));
  if (current !== "auto" && current && !backgrounds.some((item) => item.url === current)) {
    options.push(h("option", { value: current, text: "当前自定义背景" }));
  }
  select.replaceChildren(...options);
  select.value = current;
}

function renderStage() {
  const cfg = stageData();
  if (el("stage-mode") && document.activeElement !== el("stage-mode")) el("stage-mode").value = cfg.mode || "3d";
  if (el("stage-quality") && document.activeElement !== el("stage-quality")) el("stage-quality").value = cfg.quality || "high";
  if (el("stage-camera") && document.activeElement !== el("stage-camera")) el("stage-camera").value = cfg.camera || "cinematic";
  const tag = el("stage-tag");
  if (tag) {
    setText(tag, cfg.mode === "2d" ? "2D" : cfg.mode === "auto" ? "自动" : "3D");
    setTagTone(tag, cfg.mode === "2d" ? "warn" : "good");
  }
  const box = el("stage-models");
  if (!box) return;
  if (!stageAssets) {
    box.replaceChildren(h("div", { class: "stage-empty", text: "正在读取本机模型…" }));
    loadStageAssets().then(() => renderStage()).catch(() => undefined);
    return;
  }
  fillStageBackgrounds();
  const models = Array.isArray(stageAssets.models) ? stageAssets.models : [];
  const assigned = cfg.models || {};
  const roleRow = (role, label) => {
    const url = assigned[role] || "";
    const row = h("div", { class: "stage-role" + (url ? " is-set" : "") },
      h("span", { class: "stage-role-label", text: label }),
      h("b", { text: url ? url.split("/").pop() : "使用内置低模" }),
      url ? (() => {
        const button = h("button", { type: "button", class: "btn ghost small", text: "清除" });
        button.addEventListener("click", () => assignStageModel(role, ""));
        return button;
      })() : null,
    );
    return row;
  };
  const rows = [
    roleRow("human", "人类主将"),
    roleRow("zombie", "丧尸主将"),
  ];
  if (!models.length) {
    rows.push(h("div", { class: "stage-empty", text: "还没有 GLB 模型。去 meshy.cn 下载后点「导入 GLB」。" }));
  } else {
    const list = h("div", { class: "stage-model-list" });
    for (const model of models) {
      const name = model.name;
      const row = h("div", { class: "stage-model" },
        h("div", { class: "stage-model-meta" }, h("b", { text: name }), h("span", { text: (model.size / 1024 / 1024).toFixed(1) + " MB" })),
        (() => {
          const human = h("button", { type: "button", class: "btn ghost small", text: "给人类" });
          human.addEventListener("click", () => assignStageModel("human", model.url));
          return human;
        })(),
        (() => {
          const zombie = h("button", { type: "button", class: "btn ghost small", text: "给丧尸" });
          zombie.addEventListener("click", () => assignStageModel("zombie", model.url));
          return zombie;
        })(),
        (() => {
          const remove = h("button", { type: "button", class: "btn ghost small danger-text", text: "删除" });
          remove.addEventListener("click", () => deleteStageModel(model));
          return remove;
        })(),
      );
      list.append(row);
    }
    rows.push(list);
  }
  box.replaceChildren(...rows);
}

async function assignStageModel(role, url) {
  const models = { ...(stageData().models || {}) };
  if (url) models[role] = url;
  else delete models[role];
  try {
    await request("stage.save", { models });
    toast(url ? "已指派主将模型，重新打开覆盖层生效" : "已恢复内置低模", "ok");
    refreshPreview();
  } catch (error) {
    toast("指派失败：" + errText(error), "err");
  }
}

async function importStageModel(file) {
  const input = el("stage-import");
  const label = input?.closest("label");
  busy(label, true, "上传中…");
  try {
    const response = await fetch(runtime.base + "/api/models/import?token=" + encodeURIComponent(runtime.token), {
      method: "POST",
      headers: { "x-file-name": encodeURIComponent(file.name), "content-type": "application/octet-stream" },
      body: file,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.ok === false) throw new Error(data?.error || "HTTP " + response.status);
    stageAssets = null;
    toast("模型已导入：" + (data?.model?.name || file.name), "ok");
    await loadStageAssets(true);
    renderStage();
  } catch (error) {
    toast("导入失败：" + errText(error), "err");
  } finally {
    busy(label, false);
  }
}

async function deleteStageModel(model) {
  try {
    const response = await fetch(runtime.base + "/api/models/delete?token=" + encodeURIComponent(runtime.token), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: model.name }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.ok === false) throw new Error(data?.error || "HTTP " + response.status);
    const models = { ...(stageData().models || {}) };
    for (const [role, url] of Object.entries(models)) if (url === model.url) delete models[role];
    if (Object.keys(models).length !== Object.keys(stageData().models || {}).length) await request("stage.save", { models });
    stageAssets = null;
    await loadStageAssets(true);
    toast("模型已删除", "ok");
    renderStage();
  } catch (error) {
    toast("删除失败：" + errText(error), "err");
  }
}

async function saveStageSettings() {
  const button = el("stage-save");
  busy(button, true, "保存中…");
  try {
    await request("stage.save", {
      mode: el("stage-mode").value,
      quality: el("stage-quality").value,
      camera: el("stage-camera").value,
      background: el("stage-background").value || "auto",
    });
    toast("舞台设置已保存，重新打开覆盖层生效", "ok");
    refreshPreview();
  } catch (error) {
    toast("保存失败：" + errText(error), "err");
  } finally {
    busy(button, false);
  }
}

function refreshPreview() {
  setPreviewSource(true);
}

function bindControlEvents() {
  el("control-push")?.addEventListener("click", pushControlText);
  el("stage-save")?.addEventListener("click", saveStageSettings);
  el("stage-import")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) importStageModel(file);
    event.target.value = "";
  });
  el("control-save")?.addEventListener("click", saveControlSettings);
  el("control-ai")?.addEventListener("click", generateControlScripts);
  el("bgm-search")?.addEventListener("click", searchBgm);
  el("bgm-toggle")?.addEventListener("click", toggleBgm);
  el("bgm-volume")?.addEventListener("input", (event) => changeBgmVolume(event.target.value));
  el("bgm-route")?.addEventListener("change", (event) => changeBgmRoute(event.target.value));
  el("bgm-query")?.addEventListener("keydown", (event) => { if (event.key === "Enter") searchBgm(); });
  el("control-text")?.addEventListener("keydown", (event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) pushControlText(); });
  document.addEventListener("keydown", handleControlHotkey);
}

/* ── 渲染总入口 ───────────────────────────────────────────────── */

function renderAll() {
  if (!state) return;
  renderHeader();
  renderGames();
  renderOptions();
  renderChecklist();
  renderGiftGrid();
  renderGiftMeta();
  renderSide();
  if (activeTab === "data") {
    renderDataKpis();
    renderChart();
    renderEngine();
    renderTopUsers();
    renderRounds();
  } else if (activeTab === "monitor") {
    renderMonitorKpis();
    renderSourceDetail();
    renderAlerts();
    renderEventStream();
  } else if (activeTab === "review") {
    renderReview();
  } else if (activeTab === "control") {
    renderControl();
  } else if (activeTab === "settings") {
    hydrateSettings();
  }
  syncLocalBgm();
}

/* ── 顶栏 ─────────────────────────────────────────────────────── */

function renderHeader() {
  const live = Boolean(state.session);
  setText(el("version-label"), `v${state.version || runtime?.version || "1.0.0"}`);
  setText(el("mode-label"), runtime?.mode === "host"
    ? `桌面端常驻服务 · 端口 ${runtime.port}`
    : `浏览器本地服务 · ${runtime?.port || location.port}`);

  const health = state.metrics?.health || { level: "idle", label: "未开播" };
  const healthTone = health.level === "ok" ? "ok" : health.level === "warn" ? "warn" : health.level === "error" ? "bad" : "neutral";
  setPill(el("health-pill"), healthTone, health.label || (live ? "直播中" : "未开播"));

  el("start-top").hidden = live;
  el("stop-top").hidden = !live;
  setText(el("launch-btn"), live ? "重新开播" : "一键开播");
  const nextRoundButton = el("next-round-btn");
  if (nextRoundButton) nextRoundButton.disabled = !live;
  el("end-btn").disabled = !live;
  el("gift-send").disabled = !live;

  if (!live) {
    setText(el("tab-hint"), TAB_HINTS[activeTab]);
  } else {
    const round = state.engine?.round;
    setText(el("tab-hint"), `${state.session.gameName}${round?.index ? ` · 第 ${round.index} 回合` : ""} · ${health.label || "直播中"}`);
  }
  tickClock();
}

function tickClock() {
  const node = el("clock-pill");
  if (!node) return;
  const session = state?.session;
  if (session?.startedAt) {
    node.title = "直播时长";
    setText(node, formatClock(now() - session.startedAt));
    return;
  }
  node.title = "当前时间";
  const date = new Date();
  setText(node, `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`);
}

/* ── 玩法选择 ─────────────────────────────────────────────────── */

function gameIcon() { return uiIcon("spark", 21); }

let gamesSignature = "";
let coverItems = null;
let coverPromise = null;

function loadCoverItems() {
  if (!coverPromise) {
    coverPromise = request("assets").then((result) => result?.manifest?.items || {}).catch(() => ({}));
  }
  return coverPromise;
}

function applyCover(card, gameId) {
  loadCoverItems().then((items) => {
    if (coverItems === null) coverItems = items;
    const asset = items?.[gameId];
    const cover = asset?.background || asset?.url || "";
    if (cover && card.isConnected) card.style.setProperty("--cover", `url("${cover}")`);
  }).catch(() => undefined);
}

function renderGames() {
  if (games.length === 0) return;
  const liveGameId = state?.engine?.gameId || "";
  const signature = `${games.map((game) => game.id).join("|")}#${selectedGameId}#${liveGameId}`;
  if (signature === gamesSignature) return;
  gamesSignature = signature;
  const grid = el("game-grid");
  clear(grid);
  for (const game of games) {
    const selected = game.id === selectedGameId;
    const isLive = game.id === liveGameId;
    const card = h("button", { type: "button", class: `game-card${selected ? " selected" : ""}`, title: game.description || game.tagline },
      h("div", { class: "game-head" },
        h("span", { class: "game-icon", html: gameIcon() }),
        h("div", { class: "game-title" },
          h("b", { text: game.name }),
          h("span", { text: `${game.category} · ${game.layout === "landscape" ? "横版场景" : "竖版场景"}` })),
        h("span", { class: "game-check", html: uiIcon("check", 12) })),
      h("p", { class: "game-tagline", text: game.tagline }),
      h("div", { class: "game-features" }, (game.features || []).slice(0, 4).map((feature) => h("span", { text: feature }))),
      h("div", { class: "game-foot" },
        h("span", { text: isLive ? "正在直播" : game.durationSec ? `时长 ${formatClock(game.durationSec * 1000)}` : "畅玩不下播" }),
        h("b", { text: `${(game.options || []).length} 项设置` })));
    card.style.setProperty("--a", game.accent || "#fe2c55");
    card.style.setProperty("--b", game.accent2 || "#22d3ee");
    applyCover(card, game.id);
    card.addEventListener("click", () => selectGame(game.id));
    grid.appendChild(card);
  }
  setText(el("games-tag"), `${games.length} 套玩法`);
}

function selectGame(gameId) {
  if (selectedGameId === gameId) return;
  selectedGameId = gameId;
  optionsGameId = "";
  gamesSignature = "";
  renderGames();
  renderOptions();
  renderChecklist();
  saveSettings({ lastGameId: gameId }).catch(() => undefined);
}

function currentOptions(gameId) {
  const game = gameMap.get(gameId);
  return { ...(game?.defaults || {}), ...(state?.settings?.gameOptions?.[gameId] || {}) };
}

/* ── 玩法参数 ─────────────────────────────────────────────────── */

function renderOptions() {
  const game = gameMap.get(selectedGameId);
  if (!game) return;
  const grid = el("options-grid");
  const values = currentOptions(game.id);
  setText(el("options-desc"), `调整「${game.name}」参数，改动自动保存${state?.session ? "，直播中大部分参数会立即生效" : ""}`);
  if (optionsGameId !== game.id) {
    optionsGameId = game.id;
    clear(grid);
    for (const option of game.options || []) {
      let control;
      if (option.type === "select") {
        control = h("select", { "data-option": option.key },
          (option.options || []).map((item) => h("option", { value: item.value, selected: values[option.key] === item.value }, item.label)));
        control.addEventListener("change", () => queueOptionsSave());
      } else {
        control = h("div", { class: "suffix" },
          h("input", {
            type: "number",
            "data-option": option.key,
            min: option.min,
            max: option.max,
            step: option.step || 1,
            value: values[option.key],
          }),
          option.suffix ? h("em", { text: option.suffix }) : null);
        control.querySelector("input").addEventListener("change", () => {
          const input = control.querySelector("input");
          let value = Number(input.value);
          if (!Number.isFinite(value)) value = Number(option.min) || 0;
          const step = Number(option.step) || 1;
          value = Math.round(value / step) * step;
          value = Math.min(Number(option.max ?? Infinity), Math.max(Number(option.min ?? 0), value));
          input.value = String(value);
          queueOptionsSave();
        });
      }
      grid.appendChild(h("label", { class: "field" }, h("span", { text: option.label }), control));
    }
  } else {
    for (const control of grid.querySelectorAll("[data-option]")) {
      const key = control.getAttribute("data-option");
      if (key === null || values[key] === undefined) continue;
      if (document.activeElement === control) continue;
      if (String(control.value) !== String(values[key])) control.value = String(values[key]);
    }
  }
}

function collectOptionValues(gameId = selectedGameId) {
  const game = gameMap.get(gameId);
  if (!game) return {};
  const grid = el("options-grid");
  const values = {};
  for (const control of grid.querySelectorAll("[data-option]")) {
    const key = control.getAttribute("data-option");
    const option = (game.options || []).find((item) => item.key === key);
    if (!option) continue;
    values[key] = option.type === "number" ? Number(control.value) : String(control.value);
  }
  return values;
}

function queueOptionsSave() {
  const gameId = selectedGameId;
  const values = collectOptionValues(gameId);
  clearTimeout(optionsTimer);
  optionsTimer = setTimeout(async () => {
    try {
      await saveSettings({ gameOptions: { [gameId]: values } });
      const desc = el("options-desc");
      setText(desc, "参数已保存 · 改动会立即生效");
      clearTimeout(optionsResetTimer);
      optionsResetTimer = setTimeout(() => {
        const game = gameMap.get(selectedGameId);
        if (game) setText(desc, `调整「${game.name}」参数，改动自动保存`);
      }, 1600);
    } catch (error) {
      toast(`参数保存失败：${errText(error)}`, "err");
    }
  }, 320);
}

async function resetOptions() {
  const game = gameMap.get(selectedGameId);
  if (!game) return;
  try {
    await saveSettings({ gameOptions: { [game.id]: { ...game.defaults } } });
    optionsGameId = "";
    renderOptions();
    toast("已恢复该玩法的默认参数", "ok");
  } catch (error) {
    toast(`恢复失败：${errText(error)}`, "err");
  }
}

/* ── 开播检查 ─────────────────────────────────────────────────── */

function checkRow(level, title, detail, stateText) {
  const icon = level === "ok" ? uiIcon("check", 14) : level === "warn" ? uiIcon("bolt", 14) : uiIcon("alert", 14);
  return h("div", { class: `check-row ${level}` },
    h("span", { class: "check-icon", html: icon }),
    h("div", { class: "check-text" }, h("b", { text: title }), h("span", { text: detail })),
    h("span", { class: "check-state", text: stateText }));
}

function sourceState() {
  const source = state?.source || {};
  if (source.type === "relay") {
    const relay = source.relay || {};
    const label = RELAY_LABELS[relay.state] || "未连接";
    const level = relay.state === "connected" ? "ok" : relay.state === "error" ? "bad" : "warn";
    return {
      type: "relay",
      tag: "中继",
      label,
      level,
      detail: source.url || "未填写中继地址",
      error: relay.lastError || "",
      messages: Number(relay.messages) || 0,
      attempts: Number(relay.attempts) || 0,
    };
  }
  const demo = source.demo;
  return {
    type: "demo",
    tag: "演示",
    label: demo?.running ? "运行中" : "待命",
    level: "ok",
    detail: demo ? `${SCENARIO_LABELS[demo.scenario] || demo.scenario} · ${demo.speed}x · 已生成 ${formatNum(demo.emitted)} 条` : "开播后自动生成礼物与评论",
    error: "",
    messages: 0,
    attempts: 0,
  };
}

function renderChecklist() {
  const game = gameMap.get(selectedGameId);
  const live = Boolean(state.session);
  const source = sourceState();
  const rows = [];

  rows.push(checkRow("ok", "本地互动服务",
    runtime?.mode === "host" ? `桌面端常驻进程 · 端口 ${runtime?.port ?? "—"}` : `浏览器直连 127.0.0.1:${runtime?.port ?? "—"}`,
    "已连接"));

  rows.push(checkRow("ok", "当前玩法",
    live ? `正在直播：${state.engine?.gameName || state.session.gameName}` : game ? `${game.name} · ${game.tagline}` : "尚未选择",
    live ? "直播中" : "已选择"));

  const sourceLevel = source.type === "relay" ? source.level : "ok";
  const sourceDetail = source.type === "relay"
    ? `${source.detail}${source.error ? ` · ${source.error}` : ""}`
    : live ? "演示互动会自动生成礼物、评论与进场" : "开播后自动启动演示互动";
  rows.push(checkRow(sourceLevel, "互动源", sourceDetail, source.label));

  rows.push(checkRow("ok", "覆盖层地址", "1080 × 1920 透明背景，已在右侧预览", "已生成"));

  rows.push(checkRow("warn", "抖音直播伴侣", "工作台不操作官方开播按钮，请在直播伴侣里点「开始直播」", "需手动"));

  clear(el("checklist"));
  el("checklist").append(...rows);

  const tag = el("launch-tag");
  setTagTone(tag, live ? "live" : "good");
  setText(tag, live ? "直播中" : "就绪");
}

/* ── 礼物模拟器 ───────────────────────────────────────────────── */

function renderGiftGrid() {
  if (gifts.length === 0) return;
  const signature = gifts.map((gift) => `${gift.id}:${gift.heat}`).join("|");
  if (signature === giftSig) {
    updateGiftActive();
    return;
  }
  giftSig = signature;
  if (!giftMap.has(selectedGiftId)) selectedGiftId = gifts[0].id;
  const grid = el("gift-grid");
  clear(grid);
  for (const gift of gifts) {
    const chip = h("button", { type: "button", class: `gift-chip${gift.id === selectedGiftId ? " active" : ""}`, "data-gift": gift.id },
      h("span", { class: "gi", html: giftIcon(gift.icon || "heart", 24) }),
      h("b", { text: gift.name }),
      h("em", { text: `+${formatNum(gift.heat)}` }));
    chip.addEventListener("click", () => {
      selectedGiftId = gift.id;
      updateGiftActive();
      renderGiftMeta();
    });
    grid.appendChild(chip);
  }
  renderGiftMeta();
}

function updateGiftActive() {
  for (const chip of el("gift-grid").querySelectorAll("[data-gift]")) {
    chip.classList.toggle("active", chip.dataset.gift === selectedGiftId);
  }
}

function renderGiftMeta() {
  const gift = giftMap.get(selectedGiftId);
  const count = Math.max(1, Math.min(999, Math.round(Number(el("gift-count").value) || 1)));
  if (gift) setText(el("gift-heat-preview"), `热度 +${formatNum(gift.heat * count)}`);
}

function giftFeedback(text, tone = "") {
  const node = el("gift-feedback");
  node.className = `gift-feedback ${tone}`.trim();
  setText(node, text);
}

async function sendGift() {
  if (!state?.session) {
    giftFeedback("请先点「一键开播」，再发送测试礼物", "err");
    return;
  }
  const gift = giftMap.get(selectedGiftId);
  if (!gift) return;
  const userInput = el("gift-user");
  const userName = (userInput.value || "").trim() || randomDemoUser();
  const count = Math.max(1, Math.min(999, Math.round(Number(el("gift-count").value) || 1)));
  const button = el("gift-send");
  busy(button, true, "发送中…");
  try {
    const result = await request("event.gift", { userName, userId: hashId(userName), giftId: gift.id, count });
    const event = result?.event ?? result?.result?.event ?? null;
    giftFeedback(`已计入：${userName} 送出 ${gift.name} ×${count} · 热度 +${formatNum(event?.totalHeat ?? gift.heat * count)}`, "ok");
    if (!userInput.value.trim()) userInput.value = userName;
  } catch (error) {
    giftFeedback(`发送失败：${errText(error)}`, "err");
  } finally {
    busy(button, false);
  }
}


/* ── 预览与侧栏 ───────────────────────────────────────────────── */

let previewBound = false;

function setPreviewSource(force = false) {
  if (!runtime?.overlayUrl) return;
  const frame = el("overlay-preview");
  const url = `${runtime.overlayUrl}${runtime.overlayUrl.includes("?") ? "&" : "?"}preview=1${force ? `&_t=${Date.now()}` : ""}`;
  if (!force && frame.dataset.src === url) return;
  frame.dataset.src = url;
  if (!previewBound) {
    previewBound = true;
    frame.addEventListener("load", () => el("preview-empty")?.classList.add("hidden"));
  }
  el("preview-empty")?.classList.remove("hidden");
  setText(el("preview-empty"), force ? "正在刷新预览…" : "正在连接互动服务");
  frame.src = url;
  setTimeout(() => {
    if (frame.dataset.src === url) el("preview-empty")?.classList.add("hidden");
  }, 2200);
}

function renderSide() {
  const metrics = state.metrics || {};
  const totals = state.totals || {};
  const live = Boolean(state.session);
  const kpis = el("side-kpis");
  clear(kpis);
  kpis.append(
    miniStat("在线观众", formatCompact(metrics.viewers || 0)),
    miniStat("礼物热度", formatCompact(totals.heat || 0), "accent"),
    miniStat("参与观众", formatCompact(metrics.activeUsers || 0), "cyan"),
    miniStat("本场时长", formatClock(live ? state.session.durationMs : 0)),
  );

  if (live) {
    const round = state.engine?.round;
    setText(el("side-session-label"), `${state.session.gameName}${round?.index ? ` · 第 ${round.index} 回合` : ""} · 直播中`);
  } else if (state.lastSession) {
    setText(el("side-session-label"), `上场：${state.lastSession.gameName} · ${formatClock(state.lastSession.durationMs || 0)}`);
  } else {
    setText(el("side-session-label"), "待开播");
  }

  const source = sourceState();
  setText(el("side-source-label"), `${source.tag} · ${source.label}`);
  setTagTone(el("side-source-tag"), source.level === "ok" ? "" : source.level === "warn" ? "warn" : "bad");
  setText(el("side-source-tag"), source.type === "relay" ? "真实弹幕" : "演示互动");

  const quick = el("side-source");
  clear(quick);
  quick.append(
    sourceLine("当前模式", source.type === "relay" ? "真实弹幕中继" : "演示互动源"),
    sourceLine("最近互动", fmtAgo(state.source?.lastRawEventAt)),
    sourceLine("接收消息", source.type === "relay" ? `${formatNum(source.messages)} 条` : `${formatNum(state.source?.demo?.emitted || 0)} 条`),
  );
  const switchButton = h("button", { type: "button", class: "btn ghost small", text: "前往互动源设置" });
  switchButton.addEventListener("click", () => switchTab("settings", true));
  quick.appendChild(switchButton);
}

function sourceLine(label, value) {
  return h("div", { class: "source-line" }, h("span", { text: label }), h("b", { text: value }));
}

/* ── 数据页 ───────────────────────────────────────────────────── */

function renderDataKpis() {
  const totals = state.totals || {};
  const metrics = state.metrics || {};
  const box = el("data-kpis");
  clear(box);
  box.append(
    statCard("礼物热度", formatCompact(totals.heat || 0), `${formatCompact(metrics.heatRate || 0)} / 分钟`, "gold"),
    statCard("礼物件数", formatCompact(totals.gifts || 0), `共 ${formatNum(totals.giftUnits || 0)} 个礼物`),
    statCard("互动事件", formatCompact(totals.events || 0), `${formatCompact(metrics.eventRate || 0)} / 分钟`),
    statCard("评论", formatCompact(totals.comments || 0), `近 1 分钟 ${formatCompact(metrics.commentRate || 0)} 条`, "cyan"),
    statCard("新增关注", formatCompact(totals.follows || 0), `进场 ${formatCompact(totals.enters || 0)} 人`, "green"),
    statCard("峰值在线", formatCompact(totals.peakViewers || 0), `当前 ${formatCompact(metrics.viewers || 0)} 人`),
  );
}

function renderChart() {
  const buckets = Array.isArray(state.timeline) ? state.timeline : [];
  setText(el("chart-total"), `${formatNum(state.totals?.heat || 0)} 热度`);
  setText(el("chart-caption"), buckets.length ? `${buckets.length} 分钟 · 礼物热度按分钟汇总` : "按分钟统计本场礼物热度");
  const signature = buckets.map((bucket) => `${bucket.minute}:${bucket.heat}`).join("|");
  if (signature === chartSig) return;
  chartSig = signature;
  const box = el("heat-chart");
  if (buckets.length === 0) {
    box.innerHTML = "";
    box.appendChild(h("div", { class: "chart-empty", text: "本场还没有互动数据，开播后送出一份测试礼物" }));
    return;
  }
  const width = Math.max(340, box.clientWidth || 640);
  const height = 238;
  const padL = 42;
  const padR = 16;
  const padT = 16;
  const padB = 26;
  const max = Math.max(1, ...buckets.map((bucket) => Number(bucket.heat) || 0));
  const stepX = buckets.length > 1 ? (width - padL - padR) / (buckets.length - 1) : 0;
  const pointX = (index) => padL + index * stepX;
  const pointY = (value) => padT + (1 - value / max) * (height - padT - padB);
  const points = buckets.map((bucket, index) => `${pointX(index).toFixed(1)},${pointY(Number(bucket.heat) || 0).toFixed(1)}`);
  const linePath = `M${points.join(" L")}`;
  const areaPath = `${linePath} L${pointX(buckets.length - 1).toFixed(1)},${height - padB} L${padL},${height - padB} Z`;
  const grid = [0, 0.5, 1].map((ratio) => {
    const y = padT + ratio * (height - padT - padB);
    const label = formatCompact(Math.round(max * (1 - ratio)));
    return `<line class="chart-grid-line" x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}"></line>`
      + `<text class="chart-label" x="${padL - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${label}</text>`;
  }).join("");
  const labelIndexes = buckets.length <= 3 ? buckets.map((_, index) => index) : [0, Math.floor((buckets.length - 1) / 2), buckets.length - 1];
  const xLabels = labelIndexes.map((index) => {
    const date = new Date(buckets[index].minute);
    return `<text class="chart-label" x="${pointX(index).toFixed(1)}" y="${height - 6}" text-anchor="${index === 0 ? "start" : index === buckets.length - 1 ? "end" : "middle"}">${pad2(date.getHours())}:${pad2(date.getMinutes())}</text>`;
  }).join("");
  const last = buckets[buckets.length - 1];
  const lastX = pointX(buckets.length - 1).toFixed(1);
  const lastY = pointY(Number(last.heat) || 0).toFixed(1);
  box.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="礼物热度趋势">`
    + `<defs><linearGradient id="heatGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ff4d6d" stop-opacity="0.4"></stop><stop offset="100%" stop-color="#ff4d6d" stop-opacity="0.02"></stop></linearGradient></defs>`
    + grid
    + `<path class="chart-area" d="${areaPath}"></path>`
    + `<path class="chart-line" d="${linePath}"></path>`
    + `<circle class="chart-dot" cx="${lastX}" cy="${lastY}" r="4"></circle>`
    + xLabels
    + `</svg>`;
}

function roundStateText(round) {
  if (!round) return "待开始";
  if (round.status === "running") {
    return round.endsAt > 0 ? `倒计时 ${formatClock(round.endsAt - now())}` : "进行中";
  }
  if (round.status === "settled") {
    return round.nextStartAt > now() ? `下一回合 ${formatClock(round.nextStartAt - now())}` : "已结算";
  }
  return "待开始";
}

function snapshotProgressRow(label, value, pct, tone = "") {
  return h("div", { class: "snapshot-row" },
    h("span", { text: label }),
    h("div", { class: `snapshot-bar ${tone || ""}`.trim() }, h("i", { style: { width: `${Math.max(0, Math.min(100, pct))}%` } })),
    h("b", { text: value }));
}

function snapshotChips(items) {
  return h("div", { class: "snapshot-chips" },
    items.map((item) => h("span", {}, item.label ? `${item.label} ` : "", h("b", { text: item.value }))));
}

function renderEngine() {
  const engine = state.engine;
  const box = el("engine-snapshot");
  clear(box);
  if (!engine) {
    box.appendChild(h("div", { class: "snapshot-empty", text: "尚未开播，开始直播后显示双阵营实时战力" }));
    setText(el("engine-caption"), "尚未开播");
    return;
  }
  const teams = Array.isArray(engine.teams) ? engine.teams : [];
  const human = teams.find((team) => team.id === "human") || {};
  const zombie = teams.find((team) => team.id === "zombie") || {};
  const pools = engine.hud?.pools || {};
  setText(el("engine-caption"), `${engine.gameName || "人类 VS 丧尸"} · 第 ${engine.round?.index || 1} 回合 · ${roundStateText(engine.round)}`);
  box.append(
    snapshotProgressRow("人类战力", `${formatNum(Math.round(human.power || 0))} · ${human.kindName || "冲锋兵"}`, Number(human.pct || 0), "blue"),
    snapshotProgressRow("丧尸战力", `${formatNum(Math.round(zombie.power || 0))} · ${zombie.kindName || "冲锋兵"}`, Number(zombie.pct || 0), ""),
    snapshotChips([
      { label: "积分池", value: formatNum(Math.round(pools.score || 0)) },
      { label: "连胜池", value: formatNum(Math.round(pools.streak || 0)) },
      { label: "破塔奖池", value: `${formatNum(Math.round(pools.tower || 0))}${pools.towerBonusPct ? ` (+${pools.towerBonusPct}%)` : ""}` },
      { label: "破塔", value: `${formatNum(pools.towerBreaks || 0)} 次` },
      { label: "基地", value: `人 ${formatNum(human.baseHp || 0)} / 尸 ${formatNum(zombie.baseHp || 0)}` },
    ])
  );
  const effectList = Array.isArray(engine.effects) ? engine.effects : [];
  if (effectList.length) {
    box.appendChild(h("div", { class: "snapshot-empty", text: `最近事件：${effectList.at(-1)?.text || "阵营推进"}` }));
  }
}

const AVATAR_GRADIENTS = [
  "linear-gradient(140deg,#ff4d6d,#7c3aed)",
  "linear-gradient(140deg,#f59e0b,#ef4444)",
  "linear-gradient(140deg,#22d3ee,#3b82f6)",
  "linear-gradient(140deg,#34d399,#0ea5e9)",
  "linear-gradient(140deg,#a78bfa,#ec4899)",
  "linear-gradient(140deg,#facc15,#f97316)",
];

function avatarEl(user) {
  const name = String(user?.name || "观众").trim();
  const initial = [...name][0] || "观";
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  const node = h("span", { class: "avatar", text: initial });
  node.style.background = AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
  return node;
}

function renderTopUsers() {
  const users = state.engine?.topUsers || [];
  setText(el("top-users-tag"), `${users.length} 人上榜`);
  const table = el("top-users");
  clear(table);
  if (users.length === 0) {
    table.appendChild(tableEmpty("还没有贡献数据，送出礼物后会实时上榜"));
    return;
  }
  table.appendChild(h("div", { class: "trow user-row head" },
    h("span", { text: "#" }), h("span", { text: "" }), h("span", { text: "观众" }),
    h("span", { class: "user-heat", text: "热度" }), h("span", { class: "user-gifts", text: "礼物" })));
  users.slice(0, 10).forEach((user) => {
    table.appendChild(h("div", { class: "trow user-row" },
      h("span", { class: "rank-badge", text: String(user.rank) }),
      avatarEl(user),
      h("div", { class: "user-name" },
        h("span", { text: user.name }),
      ),
      h("span", { class: "user-heat", text: formatNum(user.heat) }),
      h("span", { class: "user-gifts", text: `${formatNum(user.gifts)} 件` })) );
  });
}

function roundChips(round) {
  const parts = [];
  
  if (round.reason) parts.push({ label: "原因", value: REASON_LABELS[round.reason] || round.reason });
  if (round.reward) parts.push({ label: "奖励", value: round.reward });
  const result = round.result || {};
  if (result.mvp?.name) parts.push({ label: "MVP", value: result.mvp.name });
  if (result.winner?.name) parts.push({ label: "幸运观众", value: result.winner.name });
  if (Array.isArray(result.podium) && result.podium.length) {
    parts.push({ label: "前三", value: result.podium.map((item) => item?.name || item).slice(0, 3).join(" / ") });
  }
  return parts;
}

function renderRounds() {
  const rounds = Array.isArray(state.rounds) ? state.rounds : [];
  const box = el("round-list");
  clear(box);
  if (rounds.length === 0) {
    box.appendChild(tableEmpty("本场还没有回合结算记录"));
    return;
  }
  for (const round of [...rounds].reverse()) {
    const chips = roundChips(round);
    box.appendChild(h("div", { class: "round-item" },
      h("div", { class: "round-top" },
        h("b", { text: `第 ${round.index} 回合` }),
        h("span", { text: `${fmtTime(round.startedAt)} - ${fmtTime(round.endedAt)}` })),
      chips.length ? h("div", { class: "round-meta" }, chips.map((chip) => h("span", {}, `${chip.label} `, h("b", { text: chip.value })))) : null));
  }
}

/* ── 监控页 ───────────────────────────────────────────────────── */

function renderMonitorKpis() {
  const metrics = state.metrics || {};
  const live = Boolean(state.session);
  const box = el("monitor-kpis");
  clear(box);
  box.append(
    statCard("事件速率", `${formatCompact(metrics.eventRate || 0)}`, "每分钟", "gold"),
    statCard("礼物速率", `${formatCompact(metrics.giftRate || 0)}`, "每分钟"),
    statCard("热度速率", `${formatCompact(metrics.heatRate || 0)}`, "每分钟"),
    statCard("活跃观众", formatCompact(metrics.activeUsers || 0), "5 分钟窗口", "cyan"),
    statCard("最近事件", metrics.lastRawEventAt ? fmtAgo(metrics.lastRawEventAt) : "暂无", "互动源", "green"),
    statCard("本场时长", formatClock(live ? state.session.durationMs : 0), live ? "直播中" : "未开播"),
  );
}

let detailSig = "";

function renderSourceDetail() {
  const source = sourceState();
  const raw = state.source || {};
  const relay = raw.relay || {};
  const signature = JSON.stringify([source, Math.floor((raw.lastRawEventAt || 0) / 10000), relay.messages, relay.lastError, state.session?.id]);
  if (signature === detailSig) return;
  detailSig = signature;
  setText(el("source-mode-tag"), source.type === "relay" ? "中继" : "演示");
  setTagTone(el("source-mode-tag"), source.type === "relay" ? (source.level === "ok" ? "good" : source.level === "warn" ? "warn" : "bad") : "");
  const box = el("source-detail");
  clear(box);
  const status = h("div", { class: "source-status" },
    miniStat("模式", source.type === "relay" ? "真实弹幕" : "演示互动", "cyan"),
    miniStat("状态", source.label, source.level === "ok" ? "green" : source.level === "warn" ? "" : "red"));
  const rows = [
    ["中继地址", raw.url || "未配置"],
    ["访问令牌", raw.hasToken ? "已保存（不回显）" : "未设置"],
    ["自动重连", raw.autoReconnect === false ? "关闭" : "开启"],
    ["最近原始事件", raw.lastRawEventAt ? `${fmtAgo(raw.lastRawEventAt)} · ${fmtTime(raw.lastRawEventAt)}` : "暂无"],
    ["直播前空闲事件", `${formatNum(raw.idleEvents || 0)} 条`],
  ];
  if (source.type === "relay") {
    rows.push(["累计消息", `${formatNum(relay.messages || 0)} 条 · 重连 ${formatNum(relay.reconnects || 0)} 次`]);
    if (relay.lastError) rows.push(["最近错误", relay.lastError]);
  }
  const list = h("div", { class: "source-form" }, status);
  for (const [label, value] of rows) list.appendChild(sourceLine(label, value));
  const actions = h("div", { class: "form-actions" });
  if (source.type === "relay") {
    const reconnect = h("button", { type: "button", class: "btn secondary", text: "重新连接" });
    reconnect.addEventListener("click", async () => {
      busy(reconnect, true, "连接中…");
      try {
        await request("source.connect", { url: raw.url, autoReconnect: raw.autoReconnect !== false });
        toast("已重新发起中继连接", "ok");
      } catch (error) {
        toast(`连接失败：${errText(error)}`, "err");
      } finally {
        busy(reconnect, false);
      }
    });
    const demo = h("button", { type: "button", class: "btn ghost", text: "切回演示源" });
    demo.addEventListener("click", switchToDemo);
    actions.append(reconnect, demo);
  } else {
    const settingsButton = h("button", { type: "button", class: "btn secondary", text: "配置真实弹幕" });
    settingsButton.addEventListener("click", () => switchTab("settings", true));
    actions.appendChild(settingsButton);
  }
  list.appendChild(actions);
  box.appendChild(list);
}

function renderAlerts() {
  const alerts = Array.isArray(state.alerts) ? state.alerts : [];
  const box = el("alert-list");
  clear(box);
  if (alerts.length === 0) {
    box.appendChild(tableEmpty("暂无告警，连接与记录都正常"));
    return;
  }
  const levelLabel = { info: "提示", warn: "提醒", error: "错误" };
  for (const alert of alerts.slice(0, 12)) {
    box.appendChild(h("div", { class: `alert-row ${alert.level || "info"}` },
      h("i"),
      h("div", { class: "alert-body" },
        h("b", { text: levelLabel[alert.level] || "提示" }),
        h("span", { text: alert.text })),
      h("span", { class: "alert-time", text: fmtTime(alert.ts) })));
  }
}

function eventDetail(event) {
  if (!event) return "—";
  if (event.type === "gift") return `${event.gift?.name || "礼物"}${event.count > 1 ? ` ×${event.count}` : ""}`;
  if (event.type === "comment") return event.text || "";
  if (event.type === "like") return `点赞 ×${event.count || 1}`;
  if (event.type === "room_stats") return `在线 ${formatNum(event.room?.viewers || 0)}`;
  return event.text || "进入直播间";
}

function renderEventStream() {
  const events = Array.isArray(state.recentEvents) ? [...state.recentEvents].reverse() : [];
  const signature = events.map((event) => event.id || `${event.ts}:${event.type}`).join("|");
  if (signature === streamSig) return;
  streamSig = signature;
  const table = el("event-stream");
  clear(table);
  if (events.length === 0) {
    table.appendChild(tableEmpty("开播后，最近 20 条互动事件会实时出现在这里"));
    return;
  }
  table.appendChild(h("div", { class: "trow head" },
    h("span", { text: "时间" }), h("span", { text: "类型" }), h("span", { text: "观众" }),
    h("span", { text: "内容" }), h("span", { class: "event-heat", text: "热度" })));
  for (const event of events.slice(0, 20)) {
    table.appendChild(h("div", { class: "trow" },
      h("span", { class: "event-time", text: fmtTime(event.ts) }),
      h("span", { class: `event-type ${event.type}`, text: EVENT_LABELS[event.type] || event.type }),
      h("span", { class: "event-user", text: event.user?.name || "神秘观众" }),
      h("span", { class: "event-detail", text: eventDetail(event) }),
      h("span", { class: "event-heat", text: event.type === "gift" ? `+${formatNum(event.totalHeat || 0)}` : "—" })));
  }
}

/* ── 复盘页 ───────────────────────────────────────────────────── */

function buildLiveReport() {
  if (!state.session) return null;
  const engine = state.engine || {};
  return {
    id: state.session.id,
    gameId: engine.gameId || state.session.gameId,
    gameName: engine.gameName || state.session.gameName,
    status: "live",
    startedAt: state.session.startedAt,
    endedAt: 0,
    durationMs: now() - state.session.startedAt,
    options: state.session.options || {},
    totals: { ...state.totals, activeUsers: engine.topUsers?.length || 0 },

    topUsers: engine.topUsers || [],
    rounds: state.rounds || [],
    timeline: state.timeline || [],
    metrics: state.metrics,
    source: { type: state.source?.type || "demo", url: state.source?.url || "" },
    generatedAt: now(),
  };
}

function currentReport() {
  if (state?.session) return buildLiveReport();
  if (lastReport) return lastReport;
  if (state?.lastSession) {
    return {
      ...state.lastSession,
      topUsers: [],

      rounds: [],
      timeline: state.timeline || [],
      metrics: state.metrics,
      source: { type: state.source?.type || "demo", url: state.source?.url || "" },
    };
  }
  return null;
}

async function loadLastReport() {
  if (state?.session) return;
  try {
    const report = result?.report ?? result ?? null;
    const empty = report
      && !state?.lastSession
      && Number(report.durationMs || 0) === 0
      && !Number(report.totals?.events)
      && !Number(report.totals?.gifts)
      && !(report.rounds || []).length;
    lastReport = empty ? null : report;
    if (activeTab === "review") renderReview();
  } catch {
    /* 还没有历史场次时忽略 */
  }
}

let reportSig = "";

function renderReview() {
  const report = currentReport();
  const caption = el("review-caption");
  const card = el("report-card");
  if (!report) {
    setText(caption, "尚未开播");
    clear(card);
    card.appendChild(h("div", { class: "report-empty", text: "开播并送出第一份礼物后，这里会生成本场复盘" }));
    reportSig = "";
    return;
  }
  const live = Boolean(state.session);
  setText(caption, `${report.gameName || "直播"} · ${live ? "直播中" : "已结束"} · ${formatClock(report.durationMs || 0)}`);
  const signature = JSON.stringify({
    live,
    id: report.id,
    duration: Math.round((report.durationMs || 0) / 5000),
    totals: report.totals,
    top: (report.topUsers || []).slice(0, 5).map((user) => `${user.id}:${user.heat}`),
    rounds: (report.rounds || []).length,

  });
  if (signature === reportSig) return;
  reportSig = signature;
  clear(card);
  const gameIconHtml = gameIcon(report.gameId);
  card.append(
    h("div", { class: "report-top" },
      h("span", { class: "avatar", html: gameIconHtml }),
      h("div", {},
        h("b", { text: `${report.gameName || "直播互动"}${live ? " · 直播中" : ""}` }),
        h("span", { text: `${fmtDateTime(report.startedAt)} 开始 · 时长 ${formatClock(report.durationMs || 0)} · ${report.source?.type === "relay" ? "真实弹幕" : "演示互动"}` }))),
    h("div", { class: "report-totals" },
      reportTotal("礼物热度", formatCompact(report.totals?.heat || 0)),
      reportTotal("礼物件数", formatCompact(report.totals?.gifts || 0)),
      reportTotal("互动事件", formatCompact(report.totals?.events || 0)),
      reportTotal("评论", formatCompact(report.totals?.comments || 0)),
      reportTotal("点赞", formatCompact(report.totals?.likes || 0)),
      reportTotal("新增关注", formatCompact(report.totals?.follows || 0)),
      reportTotal("回合结算", formatCompact(report.totals?.rounds ?? (report.rounds || []).length)),
      reportTotal("峰值在线", formatCompact(report.peakViewers || report.totals?.peakViewers || 0))),
  );
  const top = (report.topUsers || []).slice(0, 5);
  const topBox = h("div", { class: "report-sub" }, h("h4", { text: "贡献榜前五" }));
  if (top.length === 0) {
    topBox.appendChild(h("div", { class: "report-empty", text: live ? "还没有礼物贡献" : "该场次没有留下贡献数据" }));
  } else {
    const table = h("div", { class: "table" });
    for (const user of top) {
      table.appendChild(h("div", { class: "trow user-row" },
        h("span", { class: "rank-badge", text: String(user.rank) }),
        avatarEl(user),
        h("div", { class: "user-name", text: user.name }),
        h("span", { class: "user-heat", text: formatNum(user.heat) }),
        h("span", { class: "user-gifts", text: `${formatNum(user.gifts || 0)} 件` })));
    }
    topBox.appendChild(table);
  }

  const roundCount = (report.rounds || []).length;
  const chips = [
    { label: "总热度", value: formatNum(report.totals?.heat || 0) },
    { label: "回合", value: `${roundCount} 次` },
    { label: "效果", value: `${formatNum(report.totals?.effects || 0)} 次` },
    { label: "等级演出", value: `${formatNum(report.totals?.levels || 0)} 次` },
  ];
  topBox.appendChild(h("div", { class: "snapshot-chips", style: { marginTop: "10px" } },
    chips.map((chip) => h("span", {}, `${chip.label} `, h("b", { text: chip.value })))));
  card.appendChild(topBox);
}

function reportTotal(label, value) {
  return h("div", { class: "report-total" }, h("span", { text: label }), h("b", { text: value }));
}

function reportSummaryText(report) {
  if (!report) return "";
  const totals = report.totals || {};
  const top = (report.topUsers || []).slice(0, 5);
  const lines = [
    `若道直播复盘 · ${report.gameName || "直播互动"}`,
    `时间：${fmtDateTime(report.startedAt)} · 时长 ${formatClock(report.durationMs || 0)}`,
    `礼物热度：${formatNum(totals.heat || 0)} · 礼物 ${formatNum(totals.gifts || 0)} 件 · 互动 ${formatNum(totals.events || 0)} 次`,
    `评论 ${formatNum(totals.comments || 0)} · 点赞 ${formatNum(totals.likes || 0)} · 关注 ${formatNum(totals.follows || 0)} · 峰值在线 ${formatNum(totals.peakViewers || report.peakViewers || 0)}`,
  ];
  if (top.length) {
    lines.push("贡献榜：" + top.map((user) => `${user.rank}. ${user.name} ${formatNum(user.heat)}`).join(" / "));
  }

  return lines.join("\n");
}

function exportReport() {
  const report = currentReport();
  if (!report) {
    toast("还没有可导出的复盘数据", "err");
    return;
  }
  const json = JSON.stringify(report, null, 2);
  if (runtime.mode === "host") {
    copyText(json, "桌面端已把复盘 JSON 复制到剪贴板");
    return;
  }
  try {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = h("a", { href: url, download: `live-report-${report.gameId || "session"}-${new Date(report.startedAt || Date.now()).toISOString().slice(0, 10)}.json` });
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast("复盘 JSON 已导出", "ok");
  } catch (error) {
    toast(`导出失败：${errText(error)}`, "err");
  }
}

async function loadSessions(force = false) {
  if (sessionsLoading) return;
  if (sessionsLoaded && !force) return;
  sessionsLoading = true;
  setText(el("sessions-refresh"), "加载中…");
  try {
    const result = await request("sessions.list");
    const rows = Array.isArray(result) ? result : result?.sessions || [];
    renderSessionList(rows);
    sessionsLoaded = true;
  } catch (error) {
    toast(`历史场次加载失败：${errText(error)}`, "err");
  } finally {
    sessionsLoading = false;
    setText(el("sessions-refresh"), "刷新");
  }
}

function renderSessionList(rows) {
  const box = el("session-list");
  clear(box);
  if (rows.length === 0) {
    box.appendChild(tableEmpty("还没有归档场次，结束一场直播后会自动保存在这里"));
    return;
  }
  for (const row of rows) {
    const button = h("button", { type: "button", class: "session-row", "data-session": row.id },
      h("span", { class: "session-icon", html: uiIcon("clock", 15) }),
      h("div", { class: "session-body" },
        h("b", { text: `${row.gameName || row.gameId || "直播"} · ${row.status === "interrupted" ? "中断" : "已结束"}` }),
        h("span", { text: `${fmtDateTime(row.startedAt)} · 时长 ${formatClock(row.durationMs || 0)}` })),
      h("div", { class: "session-numbers" },
        h("b", { text: `+${formatCompact(row.totals?.heat || 0)}` }),
        h("span", { text: `热度 · ${formatCompact(row.totals?.gifts || 0)} 礼物` })));
    button.addEventListener("click", () => loadSessionDetail(row.id, button));
    box.appendChild(button);
  }
}

async function loadSessionDetail(id, button) {
  for (const row of el("session-list").querySelectorAll(".session-row")) row.classList.toggle("active", row === button);
  const box = el("session-detail");
  box.hidden = false;
  clear(box);
  box.appendChild(h("div", { class: "report-empty", text: "正在读取场次…" }));
  try {
    const result = await request("sessions.read", { id });
    const session = result?.session ?? result;
    if (!session) throw new Error("场次不存在");
    renderSessionDetail(session);
  } catch (error) {
    clear(box);
    box.appendChild(h("div", { class: "report-empty", text: `读取失败：${errText(error)}` }));
  }
}

function renderSessionDetail(session) {
  const box = el("session-detail");
  clear(box);
  const totals = session.totals || {};
  const rows = [
    ["玩法", session.gameName || session.gameId || "—"],
    ["状态", session.status === "interrupted" ? "中断" : "已结束"],
    ["开始时间", fmtDateTime(session.startedAt)],
    ["直播时长", formatClock(session.durationMs || 0)],
    ["互动源", session.source?.type === "relay" ? "真实弹幕" : "演示互动"],
    ["礼物热度", formatNum(totals.heat || 0)],
    ["礼物件数", formatNum(totals.gifts || 0)],
    ["互动事件", formatNum(totals.events || 0)],
    ["评论 / 点赞", `${formatNum(totals.comments || 0)} / ${formatNum(totals.likes || 0)}`],
    ["峰值在线", formatNum(totals.peakViewers || session.peakViewers || 0)],
    ["回合结算", formatNum(totals.rounds ?? (session.rounds || []).length)],
  ];
  if (session.topUsers?.[0]) rows.push(["榜一", `${session.topUsers[0].name} · ${formatNum(session.topUsers[0].heat)}`]);
  box.appendChild(h("h4", { text: `${session.gameName || "直播场次"} · 详细数据` }));
  for (const [label, value] of rows) {
    box.appendChild(h("div", { class: "kv" }, h("span", { text: label }), h("b", { text: value })));
  }
  const actions = h("div", { class: "detail-actions" });
  const copyButton = h("button", { type: "button", class: "btn ghost small", text: "复制复盘" });
  copyButton.addEventListener("click", () => copyText(reportSummaryText(session), "场次复盘已复制"));
  const deleteButton = h("button", { type: "button", class: "btn danger ghost small", text: "删除场次" });
  deleteButton.addEventListener("click", async () => {
    const ok = await confirmAction("删除历史场次", `确定删除「${session.gameName || "直播场次"} · ${fmtDateTime(session.startedAt)}」吗？互动记录会一起删除，且不可恢复。`, "删除");
    if (!ok) return;
    try {
      await request("sessions.delete", { id: session.id });
      toast("场次已删除", "ok");
      box.hidden = true;
      clear(box);
      loadSessions(true);
    } catch (error) {
      toast(`删除失败：${errText(error)}`, "err");
    }
  });
  actions.append(copyButton, deleteButton);
  box.appendChild(actions);
}

/* ── 设置页 ───────────────────────────────────────────────────── */

function hydrateSettings(force = false) {
  const settings = state?.settings;
  if (!settings) return;
  const fields = [
    [el("set-title"), settings.overlayTitle || ""],
    [el("set-subtitle"), settings.overlaySubtitle || ""],
    [el("set-relay-url"), settings.source?.url || ""],
  ];
  for (const [input, value] of fields) {
    if (!force && document.activeElement === input) continue;
    if (input.value !== value) input.value = value;
  }
  el("set-sound").checked = settings.sound !== false;
  el("set-hints").checked = settings.showHints !== false;
  el("set-relay-auto").checked = settings.source?.autoReconnect !== false;
  el("set-relay-token").placeholder = settings.source?.hasToken ? "已保存令牌，留空表示不修改" : "没有保存令牌，可留空";
  if (!el("set-relay-token").value) el("set-relay-token").value = "";

  if (force || !el("set-demo-scenario").matches(":focus")) {
    el("set-demo-scenario").value = settings.demo?.scenario || "normal";
    el("set-demo-speed").value = String(settings.demo?.speed ?? 1);
  }
  if (!settings.demo?.speed && el("set-demo-speed").value !== "1") el("set-demo-speed").value = "1";

  themeChoice = settings.theme || themeChoice || "neon";
  for (const swatch of el("set-theme").querySelectorAll("[data-theme]")) {
    swatch.classList.toggle("active", swatch.dataset.theme === themeChoice);
  }

  const relayTag = el("relay-state-tag");
  const source = sourceState();
  setText(relayTag, settings.source?.type === "relay" ? `中继 · ${source.label}` : "演示源");
  setTagTone(relayTag, settings.source?.type === "relay" ? (source.level === "ok" ? "good" : source.level === "warn" ? "warn" : "bad") : "");

  const demoTag = el("demo-state-tag");
  const demo = state.source?.demo;
  setText(demoTag, demo?.running ? `运行中 · ${SCENARIO_LABELS[demo.scenario] || demo.scenario}` : "未运行");
  setTagTone(demoTag, demo?.running ? "good" : "");

  buildHeatGrid();
  for (const input of el("heat-grid").querySelectorAll("[data-gift]")) {
    if (!force && document.activeElement === input) continue;
    const value = settings.giftHeat?.[input.dataset.gift];
    if (value === undefined) continue;
    if (String(input.value) !== String(value)) input.value = String(value);
  }

  renderRuntimeInfo();
}

function buildHeatGrid() {
  const signature = gifts.map((gift) => gift.id).join("|");
  if (signature === el("heat-grid").dataset.signature) return;
  el("heat-grid").dataset.signature = signature;
  const grid = el("heat-grid");
  clear(grid);
  for (const gift of gifts) {
    grid.appendChild(h("label", { class: "heat-field" },
      h("span", { class: "gi", html: giftIcon(gift.icon || "heart", 18) }),
      h("span", { text: gift.name }),
      h("input", { type: "number", min: "0", max: "100000", step: "1", "data-gift": gift.id, value: String(gift.heat) })));
  }
}

function renderRuntimeInfo() {
  if (el("runtime-info").dataset.ready === "1") return;
  el("runtime-info").dataset.ready = "1";
  const box = el("runtime-info");
  clear(box);
  const token = runtime?.token || "";
  const rows = [
    ["运行模式", runtime?.mode === "host" ? "桌面端插件常驻服务" : "浏览器直连本地服务"],
    ["版本", state?.version || runtime?.version || "1.0.0"],
    ["服务端口", String(runtime?.port ?? "—")],
    ["服务地址", runtime?.base || "—"],
    ["覆盖层地址", runtime?.overlayUrl || "—"],
    ["数据目录", runtime?.dataDir || "—"],
    ["访问令牌", token ? `${token.slice(0, 6)}…${token.slice(-4)}` : "—"],
  ];
  for (const [label, value] of rows) {
    box.appendChild(h("div", { class: "info-row" }, h("span", { text: label }), h("b", { text: value, title: value })));
  }
}

async function saveRoomInfo() {
  const button = el("set-info-save");
  busy(button, true, "保存中…");
  try {
    await saveSettings({
      overlayTitle: el("set-title").value.trim() || "若道互动直播间",
      overlaySubtitle: el("set-subtitle").value.trim(),
      theme: themeChoice,
      sound: el("set-sound").checked,
      showHints: el("set-hints").checked,
    });
    toast("直播间信息已保存，覆盖层会立即同步", "ok");
  } catch (error) {
    toast(`保存失败：${errText(error)}`, "err");
  } finally {
    busy(button, false);
  }
}

async function chooseTheme(theme) {
  if (!theme) return;
  themeChoice = theme;
  for (const swatch of el("set-theme").querySelectorAll("[data-theme]")) {
    swatch.classList.toggle("active", swatch.dataset.theme === theme);
  }
  try {
    await saveSettings({ theme });
    toast("覆盖层主题已切换", "ok");
  } catch (error) {
    toast(`主题保存失败：${errText(error)}`, "err");
  }
}

async function saveRelay() {
  const url = el("set-relay-url").value.trim();
  if (!/^(wss?|https?):\/\//i.test(url)) {
    toast("中继地址需要以 ws://、wss://、http:// 或 https:// 开头", "err");
    return;
  }
  const token = el("set-relay-token").value.trim();
  const button = el("relay-save");
  busy(button, true, "保存中…");
  try {
    await request("source.connect", {
      url,
      token: token || undefined,
      autoReconnect: el("set-relay-auto").checked,
    });
    el("set-relay-token").value = "";
    toast("中继配置已保存，正在连接", "ok");
  } catch (error) {
    toast(`中继连接失败：${errText(error)}`, "err");
  } finally {
    busy(button, false);
  }
}

async function switchToDemo() {
  try {
    await request("source.disconnect");
    toast("已切回演示互动源", "ok");
  } catch (error) {
    toast(`切换失败：${errText(error)}`, "err");
  }
}

async function clearRelayToken() {
  const ok = await confirmAction("清除中继令牌", "确定删除本机保存的中继访问令牌吗？下次连接需要重新填写。", "清除");
  if (!ok) return;
  try {
    await saveSettings({ source: { clearToken: true } });
    el("set-relay-token").value = "";
    toast("中继令牌已清除", "ok");
  } catch (error) {
    toast(`清除失败：${errText(error)}`, "err");
  }
}

async function saveDemoSettings() {
  const button = el("demo-save");
  busy(button, true, "保存中…");
  try {
    await saveSettings({
      demo: {
        scenario: el("set-demo-scenario").value,
        speed: Number(el("set-demo-speed").value) || 1,
      },
    });
    toast("演示设置已保存，直播中会立即生效", "ok");
  } catch (error) {
    toast(`保存失败：${errText(error)}`, "err");
  } finally {
    busy(button, false);
  }
}

async function saveGiftHeat() {
  const heat = {};
  for (const input of el("heat-grid").querySelectorAll("[data-gift]")) {
    let value = Math.round(Number(input.value));
    if (!Number.isFinite(value) || value < 0) value = 0;
    value = Math.min(100000, value);
    input.value = String(value);
    heat[input.dataset.gift] = value;
  }
  try {
    await saveSettings({ giftHeat: heat });
    toast("礼物热度权重已保存", "ok");
  } catch (error) {
    toast(`保存失败：${errText(error)}`, "err");
  }
}

async function resetGiftHeat() {
  try {
    await saveSettings({ giftHeat: { ...GIFT_DEFAULT_HEAT } });
    toast("已恢复默认礼物热度", "ok");
  } catch (error) {
    toast(`恢复失败：${errText(error)}`, "err");
  }
}



/* ── 直播控制 ─────────────────────────────────────────────────── */

async function startLive() {
  const game = gameMap.get(selectedGameId);
  if (!game) {
    toast("请先选择一套互动玩法", "err");
    return;
  }
  if (state?.session) {
    const ok = await confirmAction("重新开播", `当前正在直播「${state.session.gameName}」。重新开播会结束并归档本场，再用「${game.name}」开始新一场。`, "重新开播");
    if (!ok) return;
  }
  clearTimeout(optionsTimer);
  const options = collectOptionValues(game.id);
  const button = el("launch-btn");
  busy(button, true, "正在启动互动服务…");
  try {
    const result = await request("session.start", { gameId: game.id, options });
    const report = result?.report ?? result;
    toast(`已开播：${game.name} · 覆盖层已就绪`, "ok");
    giftFeedback("直播已开始：先送礼彩排，或在直播伴侣添加覆盖层地址", "ok");
    if (report?.id) lastReport = null;
    applyState(await fetchState());
    refreshPreviewScene();
  } catch (error) {
    toast(`开播失败：${errText(error)}`, "err");
  } finally {
    busy(button, false);
    el("launch-btn").textContent = state?.session ? "重新开播" : "一键开播";
  }
}

function refreshPreviewScene() {
  // 覆盖层靠 SSE 自己切场景；这里只确保预览 iframe 已经加载过
  setPreviewSource(false);
}

async function stopLive() {
  if (!state?.session) return;
  const ok = await confirmAction("结束直播", `确定结束「${state.session.gameName}」吗？本场数据会自动归档到复盘，覆盖层回到待开播状态。`, "结束直播");
  if (!ok) return;
  const button = el("end-btn");
  busy(button, true, "正在结束…");
  try {
    const result = await request("session.stop", { reason: "manual" });
    const report = result?.report ?? result;
    if (report?.id) lastReport = report;
    sessionsLoaded = false;
    toast("本场已结束，复盘已归档", "ok");
    applyState(await fetchState());
    if (activeTab === "review") {
      renderReview();
      loadSessions(true);
    }
  } catch (error) {
    toast(`结束失败：${errText(error)}`, "err");
  } finally {
    busy(button, false);
    button.disabled = true;
  }
}

async function nextRound() {
  if (!state?.session) return;
  const button = el("next-round-btn");
  busy(button, true, "结算中…");
  try {
    const result = await request("session.next");
    const round = Number(result?.round) || 0;
    toast(round ? `已进入第 ${round} 回合` : "回合已结算", "ok");
  } catch (error) {
    toast(`操作失败：${errText(error)}`, "err");
  } finally {
    busy(button, false);
  }
}

/* ── 覆盖层地址动作 ───────────────────────────────────────────── */

function overlayAddress() {
  return runtime?.overlayUrl || "";
}

function copyOverlay() {
  const url = overlayAddress();
  if (!url) {
    toast("互动服务还没准备好", "err");
    return;
  }
  copyText(url, "覆盖层地址已复制，可粘贴到直播伴侣");
}

function openOverlay() {
  const url = overlayAddress();
  if (!url) {
    toast("互动服务还没准备好", "err");
    return;
  }
  openUrl(url);
}

/* ── 标签页 ───────────────────────────────────────────────────── */

function switchTab(name, focus = false) {
  if (!TAB_HINTS[name]) return;
  activeTab = name;
  const app = el("app");
  app.dataset.tab = name;
  for (const button of document.querySelectorAll(".tab")) {
    button.classList.toggle("active", button.dataset.tab === name);
  }
  for (const pane of document.querySelectorAll(".pane")) {
    const isActive = pane.dataset.pane === name;
    pane.hidden = !isActive;
    pane.classList.toggle("active", isActive);
  }
  setText(el("tab-hint"), TAB_HINTS[name]);
  if (name === "data") chartSig = "";
  if (name === "monitor") detailSig = "";
  if (name === "review") {
    renderReview();
    loadSessions();
    if (!state?.session && !lastReport) loadLastReport();
  }
  if (name === "settings") hydrateSettings(true);
  if (name === "control") renderControl();
  renderAll();
  if (focus) {
    const main = document.querySelector(".main");
    main?.scrollIntoView({ block: "start" });
  }
}

/* ── 启动 ─────────────────────────────────────────────────────── */

function fillStaticIcons() {
  el("brand-icon").innerHTML = uiIcon("spark", 22);
  el("boot-icon").innerHTML = uiIcon("spark", 32);
  for (const button of document.querySelectorAll(".tab")) {
    const icon = button.dataset.icon;
    if (icon) button.insertAdjacentHTML("afterbegin", uiIcon(icon, 15));
  }
}

function bindEvents() {
  for (const button of document.querySelectorAll(".tab")) {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  }
  el("copy-overlay-top").addEventListener("click", copyOverlay);
  el("open-overlay-top").addEventListener("click", openOverlay);
  el("start-top").addEventListener("click", startLive);
  el("stop-top").addEventListener("click", stopLive);
  el("copy-overlay-side").addEventListener("click", copyOverlay);
  el("open-overlay-side").addEventListener("click", openOverlay);
  el("preview-refresh").addEventListener("click", () => setPreviewSource(true));
  el("launch-btn").addEventListener("click", startLive);
  el("hero-start")?.addEventListener("click", startLive);
  el("next-round-btn")?.addEventListener("click", nextRound);
  el("end-btn").addEventListener("click", stopLive);
  el("options-reset").addEventListener("click", resetOptions);
  el("gift-send").addEventListener("click", sendGift);
  el("gift-random").addEventListener("click", () => {
    el("gift-user").value = randomDemoUser();
    toast("已随机填入一位观众", "ok");
  });
  el("gift-count").addEventListener("input", renderGiftMeta);
  el("report-copy").addEventListener("click", () => {
    const report = currentReport();
    if (!report) {
      toast("还没有可复制的复盘", "err");
      return;
    }
    copyText(reportSummaryText(report), "复盘摘要已复制");
  });
  el("report-export").addEventListener("click", exportReport);
  el("sessions-refresh").addEventListener("click", () => loadSessions(true));
  el("set-info-save").addEventListener("click", saveRoomInfo);
  for (const swatch of el("set-theme").querySelectorAll("[data-theme]")) {
    swatch.addEventListener("click", () => chooseTheme(swatch.dataset.theme));
  }
  el("relay-save").addEventListener("click", saveRelay);
  el("relay-demo").addEventListener("click", switchToDemo);
  el("relay-clear-token").addEventListener("click", clearRelayToken);
  el("demo-save").addEventListener("click", saveDemoSettings);
  el("heat-save").addEventListener("click", saveGiftHeat);
  el("heat-reset").addEventListener("click", resetGiftHeat);
  el("modal-cancel").addEventListener("click", () => closeModal(false));
  el("modal-confirm").addEventListener("click", () => {
    if (modalResolve) closeModal(true);
    else closeModal(false);
    el("modal-cancel").hidden = false;
  });
  el("modal").addEventListener("click", (event) => {
    if (event.target === el("modal")) closeModal(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal(false);
  });
  el("boot-screen").addEventListener("click", () => {
    if (el("app").dataset.boot === "error") location.reload();
  });
  bindControlEvents();
}



function setBoot(text, isError = false) {
  setText(el("boot-text"), text);
  el("app").dataset.boot = isError ? "error" : "loading";
}

function hideBoot() {
  el("app").dataset.boot = "ready";
  const screen = el("boot-screen");
  screen.classList.add("out");
  setTimeout(() => {
    screen.hidden = true;
  }, 360);
}

async function connectStream() {
  if (runtime.mode === "host") {
    setPill(el("conn-pill"), "ok", "服务已连接");
    host.on("service", (data) => {
      if (!data || data.type !== "plugin-service" || data.serviceId !== "main") return;
      if (data.event === "live-error") {
        toast(data.payload?.message || "互动服务异常", "err");
        return;
      }
      if (data.event !== "live") return;
      const payload = data.payload || {};
      if (payload.topic === "state" && payload.state) applyState(payload.state);
      else if (payload.topic === "effects") handleEffects(payload.effects);
      else if (payload.topic === "alert") toast(payload.alert?.text, payload.alert?.level === "error" ? "err" : "");
    });
  } else {
    setPill(el("conn-pill"), "warn", "连接中");
    const source = new EventSource(`${runtime.base}/api/stream?token=${encodeURIComponent(runtime.token)}`);
    source.addEventListener("state", (event) => {
      try {
        applyState(JSON.parse(event.data));
        setPill(el("conn-pill"), "ok", "服务已连接");
      } catch {
        /* 忽略坏帧 */
      }
    });
    source.addEventListener("effects", (event) => {
      try {
        handleEffects(JSON.parse(event.data)?.effects);
      } catch {
        /* 忽略坏帧 */
      }
    });
    source.addEventListener("alert", (event) => {
      try {
        const alert = JSON.parse(event.data);
        if (alert?.text) toast(alert.text, alert.level === "error" ? "err" : "");
      } catch {
        /* 忽略坏帧 */
      }
    });
    source.onopen = () => setPill(el("conn-pill"), "ok", "服务已连接");
    source.onerror = () => setPill(el("conn-pill"), "warn", "连接中断，自动重连中");
  }
  setInterval(watchdog, 4000);
}

let watching = false;

async function watchdog() {
  if (watching) return;
  if (Date.now() - lastStateAt < 6000) return;
  watching = true;
  try {
    applyState(await fetchState());
    setPill(el("conn-pill"), "ok", "服务已连接");
  } catch {
    setPill(el("conn-pill"), "bad", "服务离线");
  } finally {
    watching = false;
  }
}

function handleEffects(effects) {
  if (!Array.isArray(effects)) return;
  for (const effect of effects) {
    if (!effect) continue;
    if (effect.type === "win" || effect.type === "finish") toast(effect.text || "回合结算", "ok");
    else if (effect.type === "milestone" || effect.type === "crown" || effect.type === "levelup") toast(effect.text || "全场播报");
  }
}

async function boot() {
  if (booting) return;
  booting = true;
  setBoot("正在连接本地互动服务…");
  try {
    fillStaticIcons();
    runtime = await resolveRuntime();
    setBoot("正在读取玩法与直播数据…");
    const [gameResult, stateResult] = await Promise.all([fetchGames(), request("state").then((result) => result?.state ?? result)]);
    games = gameResult.games;
    gifts = gameResult.gifts;
    gameMap.clear();
    giftMap.clear();
    for (const game of games) gameMap.set(game.id, game);
    for (const gift of gifts) giftMap.set(gift.id, gift);
    if (!giftMap.has(selectedGiftId)) selectedGiftId = gifts[0]?.id || "heart";
    if (!stateResult?.app) throw new Error("互动服务没有返回有效状态");
    state = stateResult;
    lastStateAt = Date.now();
    clockOffset = Number(state.serverTime || Date.now()) - Date.now();
    selectedGameId = state.settings?.lastGameId || games[0]?.id || "human-vs-zombie";
    syncGiftHeat();
    setPreviewSource(false);
    bindEvents();
    switchTab("console");
    renderAll();
    updateDocumentTitle();
    await connectStream();
    hideBoot();
    if (!state.session) loadLastReport();
    setInterval(tickClock, 250);
    if (activeTab === "data") chartSig = "";
  } catch (error) {
    setBoot(`无法唤醒直播工作台：${errText(error)}。请确认插件已安装并启用，点击这里重试。`, true);
    booting = false;
    return;
  }
  booting = false;
}

boot();


