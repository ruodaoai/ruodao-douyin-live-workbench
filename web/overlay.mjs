// 人类 VS 丧尸 · 覆盖层入口：SSE 接收 Node 权威快照，PixiJS 渲染战场，DOM 渲染 HUD。
import { $, h, setText, setClass, formatClock, formatNum, createFx, createAudio } from "./scenes/core.mjs";
import { giftIcon } from "./assets/icons.mjs";
import { createBattleScene } from "./render/battle.mjs";
import { createStage3D } from "./scenes/stage3d.mjs";
import { createHometownScene } from "./render/hometown.mjs";
import { createThreeKingdomsScene } from "./render/three-kingdoms.mjs";
import { createSheepScene } from "./render/sheep.mjs";
import { createHud } from "./hud.mjs";

const params = new URLSearchParams(location.search);
const token = params.get("token") || "";
const preview = params.get("preview") === "1";

const stage = $("#stage");
const sceneEl = $("#scene");
const hudEl = $("#hud");
const idle = $("#idle");
const titleEl = $("#ov-title");
const liveText = $("#live-text");
const connEl = $("#conn");
const idleName = $("#idle-name");
const idleTagline = $("#idle-tagline");
const idleHowto = $("#idle-howto");
const idleGifts = $("#idle-gifts");

if (preview) {
  stage.classList.add("preview");
  document.body.classList.add("preview");
}

let state = null;
let offset = 0;
let games = [];
let gifts = [];
const gameMap = new Map();
let currentScene = null;
let currentGameId = "";
let idleSignature = "";

const audio = createAudio(() => state?.settings?.sound !== false);
const fx = createFx({ layer: $("#fx"), toasts: $("#toasts"), audio });
const hud = createHud(hudEl);
const bgmEl = $("#bgm");
const subtitleEl = $("#subtitle");
const subtitleText = $("#subtitle-text");
let assets = {};
let lastTtsText = "";
let lastTtsAt = 0;
let bgmBlockedNotified = false;

function createGameScene(gameId) {
  const config = state?.settings?.stage || {};
  const asset = assets[gameId] || {};
  if (gameId === "human-vs-zombie" && config.mode !== "2d") {
    try {
      return createStage3D({
        quality: config.quality || "high",
        models: {
          human: config.models?.human || "",
          zombie: config.models?.zombie || "",
        },
        portraits: {
          human: asset.humanBoss || asset.human || "",
          zombie: asset.zombieBoss || asset.zombie || "",
        },
        background: config.background && config.background !== "auto" ? config.background : asset.background || "",
      });
    } catch (error) {
      console.warn("[overlay] 3D 舞台不可用，已回退 2D", error?.message || error);
    }
  }
  return null;
}

const SCENES = {
  "human-vs-zombie": () => createGameScene("human-vs-zombie") || createBattleScene(),
  "hometown-vote": () => createHometownScene({ assets: assets["hometown-vote"] || {} }),
  "three-kingdoms": () => createThreeKingdomsScene({ assets: assets["three-kingdoms"] || {} }),
  "running-sheep": () => createSheepScene({ assets: assets["running-sheep"] || {} }),
};

function fitStage() {
  const scale = Math.min(window.innerWidth / 1080, window.innerHeight / 1920);
  stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

function setConn(text, bad = false) {
  if (!connEl) return;
  setText(connEl, text);
  setClass(connEl, "hidden", !text);
  setClass(connEl, "bad", Boolean(text) && bad);
}

async function api(path) {
  const joiner = path.includes("?") ? "&" : "?";
  const response = await fetch(`/api/${path}${joiner}token=${encodeURIComponent(token)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function destroyScene() {
  if (!currentScene) return;
  try { currentScene.destroy?.(); } catch { /* 场景已卸载 */ }
  currentScene = null;
  currentGameId = "";
  sceneEl.replaceChildren();
}

function mountScene(gameId) {
  const factory = SCENES[gameId];
  if (!factory) return;
  destroyScene();
  currentGameId = gameId;
  currentScene = factory();
  sceneEl.replaceChildren(currentScene.el);
  try { currentScene.onMount?.(); } catch { /* 渲染初始化失败时降级为空战场 */ }
}

function renderIdle(activeState) {
  const game = gameMap.get(activeState?.settings?.lastGameId) ?? games[0];
  if (!game) return;
  const signature = `${game.id}:${gifts.length}`;
  if (signature === idleSignature) return;
  idleSignature = signature;
  setText(idleName, game.name);
  setText(idleTagline, game.tagline);
  idleHowto.replaceChildren(...(game.howTo || []).slice(0, 3).map((line) => h("li", { text: line })));
  idleGifts.replaceChildren(...gifts.slice(0, 6).map((gift) => {
    const icon = h("span", { class: "idle-gift-icon" });
    icon.innerHTML = giftIcon(gift.icon, 22);
    return h("span", { class: "idle-gift" }, icon, `${gift.name} ${gift.heat}`);
  }));
}

function syncBgm(settings, now) {
  const bgm = settings?.bgm || {};
  const track = bgm.track;
  const route = bgm.route || "overlay";
  const wanted = Boolean(bgm.enabled && bgm.playing && track?.url && route !== "workbench");
  if (!wanted) {
    if (!bgmEl.paused) bgmEl.pause();
    if (bgmEl.dataset.src) {
      bgmEl.removeAttribute("src");
      bgmEl.dataset.src = "";
      bgmEl.load();
    }
    return;
  }
  const source = "/api/bgm/stream?token=" + encodeURIComponent(token) + "&v=" + encodeURIComponent(bgm.updatedAt || 0);
  if (bgmEl.dataset.src !== source) {
    bgmEl.dataset.src = source;
    bgmEl.src = source;
    bgmEl.load();
  }
  const volume = Math.max(0, Math.min(1, Number(bgm.volume) || 0.35));
  bgmEl.volume = volume;
  if (bgmEl.paused) {
    bgmEl.play().then(() => { bgmBlockedNotified = false; }).catch(() => {
      if (!bgmBlockedNotified) {
        bgmBlockedNotified = true;
        console.warn("[overlay] 浏览器拦截了 BGM 自动播放，请在覆盖层点一下或从工作台播放");
      }
    });
  }
}

function syncSubtitle(control, now) {
  const subtitle = control?.subtitle || null;
  const active = Boolean(subtitle?.text) && now < Number(subtitle.until || 0);
  setClass(subtitleEl, "hidden", !active);
  if (!active) return;
  setText(subtitleText, subtitle.text);
  subtitleEl.dataset.tone = subtitle.tone || "info";
}

function speak(text, volume = 0.9) {
  if (!("speechSynthesis" in window) || !text) return;
  const now = Date.now();
  if (text === lastTtsText && now - lastTtsAt < 2500) return;
  lastTtsText = text;
  lastTtsAt = now;
  try {
    const utterance = new SpeechSynthesisUtterance(String(text).slice(0, 120));
    utterance.lang = "zh-CN";
    utterance.rate = 1.05;
    utterance.pitch = 1.02;
    utterance.volume = Math.max(0, Math.min(1, Number(volume) || 0.9));
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  } catch { /* 语音合成不可用时静默降级 */ }
}

function handleControl(payload) {
  if (!payload) return;
  if (payload.kind === "subtitle") {
    const now = Date.now() + offset;
    syncSubtitle({ subtitle: { text: payload.text, tone: payload.tone, until: payload.until } }, now);
    if (payload.tts) speak(payload.text, payload.volume);
  }
}

function render(next) {
  if (!next) return;
  state = next;
  offset = Number(next.serverTime) - Date.now();
  const settings = next.settings ?? {};

  const running = Boolean(next.session) && Boolean(next.engine);
  const activeGame = gameMap.get(next.engine?.gameId) || gameMap.get(settings.lastGameId);
  const displayName = next.engine?.gameName || activeGame?.name || settings.overlayTitle || "人类 VS 丧尸";
  setText(titleEl, displayName);
  document.title = running ? `${displayName} · 直播中` : `${displayName} · 待开播`;
  setClass(stage, "is-live", running);
  setText(liveText, running ? "直播中" : "待开播");
  setClass(idle, "hidden", running);
  setClass(sceneEl, "hidden", !running);
  setClass(hudEl, "hidden", !running);

  if (running) {
    const gameId = next.engine.gameId;
    if (gameId !== currentGameId) mountScene(gameId);
    try { currentScene?.update?.(next.engine); } catch { /* 单帧渲染失败不应中断直播 */ }
    try { hud.update(next.engine); } catch { /* HUD 单帧失败忽略 */ }
  } else {
    destroyScene();
    renderIdle(next);
  }

  const clockNow = Date.now() + offset;
  syncBgm(settings, clockNow);
  syncSubtitle(next.control || { subtitle: settings.control?.subtitle }, clockNow);
  stage.dataset.game = running ? next.engine.gameId : (settings.lastGameId || "");
  stage.dataset.status = running ? "live" : "idle";
  document.documentElement.dataset.overlayReady = "1";
  window.__RUODAO_OVERLAY_STATE__ = next;
  tickClock();
}

function tickClock() {
  if (!state) return;
  const now = Date.now() + offset;
  const engine = state.engine;
  const round = engine?.round;
  if (state.session && round) return;
  if (state.session?.startedAt) return;
  setText($("#live-text"), state.session ? "直播中" : "待开播");
}

function handleEffects(effects) {
  if (!Array.isArray(effects)) return;
  for (const effect of effects) {
    try { fx.playEffect(effect); } catch { /* 特效失败不影响主流程 */ }
    try { currentScene?.effect?.(effect); } catch { /* 场景动画失败忽略 */ }
    try { hud.effect?.(effect); } catch { /* HUD 特效失败忽略 */ }
  }
}

function connectStream() {
  if (!token) {
    setConn("缺少访问令牌，请从工作台复制完整覆盖层地址", true);
    return;
  }
  setConn("正在连接工作台…");
  const source = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);
  source.addEventListener("state", (event) => {
    try { render(JSON.parse(event.data)); } catch { /* 忽略坏帧 */ }
    setConn("");
  });
  source.addEventListener("effects", (event) => {
    try { handleEffects(JSON.parse(event.data)?.effects); } catch { /* 忽略坏帧 */ }
  });
  source.addEventListener("control", (event) => {
    try { handleControl(JSON.parse(event.data)); } catch { /* 忽略坏帧 */ }
  });
  source.addEventListener("alert", (event) => {
    try { fx.pushAlert(JSON.parse(event.data)); } catch { /* 忽略坏帧 */ }
  });
  source.addEventListener("session", () => {
    api("state").then(render).catch(() => undefined);
  });
  source.onopen = () => setConn("");
  source.onerror = () => setConn("连接中断，正在自动重连…", true);
}

async function bootstrap() {
  fitStage();
  window.addEventListener("resize", fitStage);
  window.addEventListener("pointerdown", () => audio.unlock(), { once: true });
  window.addEventListener("keydown", () => audio.unlock(), { once: true });

  const [stateResult, gameResult, assetResult] = await Promise.allSettled([api("state"), api("games"), api("assets")]);
  if (assetResult.status === "fulfilled") {
    assets = assetResult.value?.manifest?.items || {};
  }
  if (gameResult.status === "fulfilled") {
    games = Array.isArray(gameResult.value.games) ? gameResult.value.games : [];
    gifts = Array.isArray(gameResult.value.gifts) ? gameResult.value.gifts : [];
    gameMap.clear();
    for (const game of games) gameMap.set(game.id, game);
  }
  if (stateResult.status === "fulfilled") {
    render(stateResult.value);
    setConn("");
  } else {
    setConn("无法连接直播工作台，请从工作台复制完整覆盖层地址", true);
    renderIdle(null);
    document.documentElement.dataset.overlayReady = "1";
  }
  connectStream();
  setInterval(tickClock, 500);
}

bootstrap().catch(() => setConn("覆盖层初始化失败，请刷新页面", true));