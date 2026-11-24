#!/usr/bin/env node
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LiveController } from "../lib/controller.mjs";
import { createLiveServer } from "../lib/server.mjs";
import { collectAssets } from "../lib/assets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..", "web");
const version = "1.3.0";

let controller = null;
let server = null;
let shuttingDown = false;
let statePending = null;
let stateLastSentAt = 0;
let stateTimer = null;

function log(message) {
  try {
    process.stderr.write(`[douyin-live-workbench] ${String(message).replace(/\s+/g, " ").slice(0, 800)}\n`);
  } catch {
    /* stderr 已关闭 */
  }
}

function send(message) {
  try {
    if (!process.stdout.writable) return;
    process.stdout.write(`${JSON.stringify(message)}\n`);
  } catch {
    /* 宿主已断开 */
  }
}

function sendState(state) {
  statePending = state;
  flushState();
}

function flushState(force = false) {
  if (!statePending) return;
  const now = Date.now();
  if (!force && now - stateLastSentAt < 1000) return;
  stateLastSentAt = now;
  const payload = statePending;
  statePending = null;
  send({ type: "event", event: "live", payload: { topic: "state", state: payload } });
}



async function handle(method, params) {
  if (!controller) throw new Error("直播服务尚未初始化");
  const p = params && typeof params === "object" ? params : {};
  switch (method) {
    case "ping":
      return { ok: true, at: Date.now() };
    case "state":
      return controller.state();
    case "runtime":
      return server.info();
    case "games":
      return { games: controller.games(), gifts: controller.gifts() };
    case "settings.save":
      return controller.saveSettings(p.patch ?? p);
    case "source.connect":
      return controller.connectSource(p);
    case "source.disconnect":
      return controller.disconnectSource();
    case "session.start":
      return controller.startSession({ gameId: p.gameId, options: p.options });
    case "session.stop":
      return controller.stopSession({ reason: p.reason || "manual" });
    case "session.next":
      return controller.nextRound();
    case "session.report":
      return controller.report();
    case "event.gift":
      return controller.injectGift(p);
    case "event.raw":
      return controller.injectRaw(p.payload ?? p);
    case "sessions.list":
      return controller.listSessions();
    case "sessions.read":
      return controller.readSession(String(p.id || ""));
    case "sessions.events":
      return controller.readSessionEvents(String(p.id || ""), Number(p.limit) || 2000);
    case "sessions.delete":
      return controller.deleteSession(String(p.id || ""));
    case "assets":
      return collectAssets(webRoot);
    case "control.push":
      return controller.pushControl(p);
    case "control.script":
      return controller.runControlScript(String(p.scriptId || p.id || ""));
    case "control.save":
      return controller.saveControl(p.patch ?? p);
    case "control.generate":
      return controller.generateControlScripts(p);
    case "music.status":
      return controller.musicStatus(p);
    case "music.search":
      return controller.searchMusic(String(p.keywords || ""));
    case "music.play":
      return controller.setBgmTrack(p);
    case "bgm.control":
      return controller.controlBgm(p);
    case "stage.save":
      return controller.saveStage(p.patch ?? p);
    case "doctor":
      return {
        ok: true,
        version,
        dataDir: controller.store.dataDir,
        env: {
          dataDir: Boolean(process.env.RUODAO_PLUGIN_DATA_DIR),
          userData: Boolean(process.env.RUODAO_USER_DATA_DIR),
          pluginId: Boolean(process.env.RUODAO_PLUGIN_ID),
          pluginVersion: Boolean(process.env.RUODAO_PLUGIN_VERSION),
          probe: Boolean(process.env.RUODAO_PROBE),
        },
        cwd: process.cwd(),
        port: server?.port ?? 0,
        node: process.version,
      };
    default:
      throw new Error(`未知服务方法：${method}`);
  }
}

async function boot(payload) {
  const dataDir = String(payload?.dataDir || "").trim() || undefined;
  controller = new LiveController({ dataDir, version });
  await controller.init();
  server = await createLiveServer({
    controller,
    webRoot,
    dataDir: controller.store.dataDir,
    preferredPort: Number(payload?.preferredPort) || Number(process.env.RUODAO_LIVE_PORT) || 43119,
  });
  controller.on("effects", (payloadEvent) => {
    send({ type: "event", event: "live", payload: { topic: "effects", ...payloadEvent } });
  });
  controller.on("alert", (alert) => {
    send({ type: "event", event: "live", payload: { topic: "alert", alert } });
  });
  controller.on("session", (event) => {
    send({ type: "event", event: "live", payload: { topic: "session", ...event } });
  });
  send({
    type: "ready",
    payload: {
      ...server.info(),
      version,
      webRoot,
      dataDir: controller.store.dataDir,
    },
  });
  controller.subscribe(sendState);
  stateTimer = setInterval(() => flushState(), 1000);
  stateTimer.unref?.();
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("shutting down");
  if (stateTimer) clearInterval(stateTimer);
  try {
    await server?.stop();
  } catch (error) {
    log(`server stop failed: ${error?.message ?? error}`);
  }
  try {
    await controller?.dispose();
  } catch (error) {
    log(`controller dispose failed: ${error?.message ?? error}`);
  }
  setTimeout(() => process.exit(code), 30);
}

async function onMessage(message) {
  if (!message || typeof message !== "object") return;
  const type = String(message.type || "");
  if (type === "init") {
    try {
      await boot(message.payload || {});
    } catch (error) {
      log(`init failed: ${error?.stack ?? error}`);
      send({ type: "event", event: "live-error", payload: { message: String(error?.message ?? error) } });
      await shutdown(1);
    }
    return;
  }
  if (type === "request") {
    const id = String(message.id || "");
    const method = String(message.method || "");
    try {
      const result = await handle(method, message.params || {});
      send({ type: "response", id, ok: true, result });
    } catch (error) {
      send({ type: "response", id, ok: false, error: String(error?.message ?? error).slice(0, 2000) });
    }
    return;
  }
  if (type === "shutdown") {
    await shutdown(0);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  if (buffer.length > 16 * 1024 * 1024) {
    log("输入消息过大，已丢弃");
    buffer = "";
    return;
  }
  let index = buffer.indexOf("\n");
  while (index >= 0) {
    const line = buffer.slice(0, index).replace(/\r$/, "").trim();
    buffer = buffer.slice(index + 1);
    if (line) {
      try {
        void onMessage(JSON.parse(line));
      } catch (error) {
        log(`invalid message: ${error?.message ?? error}`);
      }
    }
    index = buffer.indexOf("\n");
  }
});
process.stdin.on("end", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.stdout.on("error", () => undefined);
process.on("uncaughtException", (error) => log(`uncaught: ${error?.stack ?? error}`));
process.on("unhandledRejection", (error) => log(`unhandled rejection: ${error?.stack ?? error}`));
