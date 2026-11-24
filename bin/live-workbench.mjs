#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LiveController } from "../lib/controller.mjs";
import { createLiveServer } from "../lib/server.mjs";
import { resolveDataDir } from "../lib/store.mjs";
import { GAMES } from "../lib/catalog.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..", "web");
const version = "1.3.0";

function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      rest.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return { command: rest[0] || "help", args: rest.slice(1), flags };
}

function dataDirOf(flags) {
  return resolveDataDir(flags["data-dir"] || flags.dataDir);
}

function readRuntime(dataDir) {
  const file = path.join(dataDir, "runtime.json");
  try {
    const runtime = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!runtime?.token || !runtime?.port) return null;
    return runtime;
  } catch {
    return null;
  }
}

function baseOf(runtime) {
  return `http://127.0.0.1:${runtime.port}`;
}

async function api(runtime, route, init = {}) {
  const url = `${baseOf(runtime)}${route}${route.includes("?") ? "&" : "?"}token=${encodeURIComponent(runtime.token)}`;
  const headers = { ...(init.headers || {}) };
  if (init.body && !headers["content-type"]) headers["content-type"] = "application/json";
  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function requireRuntime(flags) {
  const dataDir = dataDirOf(flags);
  const runtime = readRuntime(dataDir);
  if (!runtime) {
    throw new Error(`没有检测到运行中的直播服务（${dataDir}）。请先执行：node bin/live-workbench.mjs serve`);
  }
  return runtime;
}

function openUrl(url) {
  try {
    if (process.platform === "win32") {
      spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
    return true;
  } catch {
    return false;
  }
}

function duration(ms) {
  const total = Math.max(0, Math.round(Number(ms) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].filter((value, index) => index > 0 || value > 0).map((value) => String(value).padStart(2, "0")).join(":");
}

async function doctor(flags) {
  const dataDir = dataDirOf(flags);
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  const major = Number(process.versions.node.split(".")[0]);
  add("Node 运行时", major >= 20, `${process.version}${major >= 22 ? "" : "（WebSocket 中继建议 Node 22+）"}`);
  add("工作台页面", fs.existsSync(path.join(webRoot, "index.html")), path.join(webRoot, "index.html"));
  add("覆盖层页面", fs.existsSync(path.join(webRoot, "overlay.html")), path.join(webRoot, "overlay.html"));
  add("Three.js 运行时", fs.existsSync(path.join(webRoot, "vendor", "three.module.js")), "web/vendor/three.module.js");
  let writable = false;
  try {
    await fs.promises.mkdir(dataDir, { recursive: true });
    const probe = path.join(dataDir, `.doctor-${process.pid}.tmp`);
    await fs.promises.writeFile(probe, "ok");
    await fs.promises.rm(probe, { force: true });
    writable = true;
  } catch (error) {
    add("数据目录写入", false, String(error?.message ?? error));
  }
  if (writable) add("数据目录写入", true, dataDir);
  const runtime = readRuntime(dataDir);
  let serverOk = false;
  if (runtime) {
    try {
      const response = await fetch(`${baseOf(runtime)}/health`);
      const health = await response.json();
      serverOk = Boolean(health.ok);
      add("本地服务", serverOk, `${baseOf(runtime)} · v${health.version}`);
    } catch {
      add("本地服务", false, `runtime.json 存在，但 ${baseOf(runtime)} 无法访问`);
    }
  } else {
    add("本地服务", false, "未启动（node bin/live-workbench.mjs serve）");
  }
  const failed = checks.filter((check) => !check.ok && !/Node 运行时/.test(check.name));
  if (failed.length > 0) process.exitCode = 1;
  return checks;
}

async function serve(flags) {
  const dataDir = dataDirOf(flags);
  const controller = new LiveController({ dataDir, version });
  await controller.init();
  const server = await createLiveServer({
    controller,
    webRoot,
    dataDir: controller.store.dataDir,
    preferredPort: Number(flags.port) || 43119,
  });
  const info = server.info();
  console.log("抖音直播工作台已启动\n");
  console.log(`  工作台  ${info.workbenchUrl}`);
  console.log(`  覆盖层  ${info.overlayUrl}`);
  console.log(`  数据目录 ${info.dataDir}`);
  console.log("\n把覆盖层地址填进抖音直播伴侣的「浏览器源」，尺寸建议 1080×1920。按 Ctrl+C 停止。");
  if (flags.open) openUrl(info.workbenchUrl);
  const stop = async () => {
    console.log("\n正在停止直播工作台…");
    await server.stop();
    await controller.dispose();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  setInterval(() => undefined, 60_000).unref();
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (command === "help" || flags.help) {
    console.log(`抖音直播工作台

用法：
  node bin/live-workbench.mjs serve [--port 43119] [--data-dir 目录] [--open]
  node bin/live-workbench.mjs status
  node bin/live-workbench.mjs urls
  node bin/live-workbench.mjs start --game human-vs-zombie [--options '{"roundSeconds":120}']
  node bin/live-workbench.mjs stop
  node bin/live-workbench.mjs next
  node bin/live-workbench.mjs gift --user 测试观众 --gift crown --count 1
  node bin/live-workbench.mjs report
  node bin/live-workbench.mjs sessions
  node bin/live-workbench.mjs games
  node bin/live-workbench.mjs doctor

玩法：${GAMES.map((game) => `${game.id}(${game.name})`).join("、")}`);
    return;
  }
  if (command === "doctor") {
    await doctor(flags);
    return;
  }
  if (command === "games") {
    for (const game of GAMES) {
      console.log(`${game.id}\t${game.name}\t${game.category}\t${game.tagline}`);
    }
    return;
  }
  if (command === "serve") {
    await serve(flags);
    return;
  }
  const runtime = requireRuntime(flags);
  if (command === "urls") {
    console.log(`工作台  ${baseOf(runtime)}/workbench?token=${runtime.token}`);
    console.log(`覆盖层  ${baseOf(runtime)}/overlay?token=${runtime.token}`);
    return;
  }
  if (command === "status") {
    const state = await api(runtime, "/api/state");
    console.log(`服务：${baseOf(runtime)} · 数据目录 ${runtime.dataDir || dataDirOf(flags)}`);
    console.log(`健康：${state.metrics?.health?.label ?? "-"}`);
    if (state.session) {
      console.log(`直播：${state.session.gameName} · ${state.session.status} · 已播 ${duration(state.session.durationMs)}`);
      console.log(`互动：礼物 ${state.totals.gifts} · 热度 ${state.totals.heat} · 评论 ${state.totals.comments} · 在线 ${state.metrics.viewers}`);
    } else {
      console.log("直播：未开播");
    }
    return;
  }
  if (command === "start") {
    const gameId = String(flags.game || "human-vs-zombie");
    let options = {};
    if (typeof flags.options === "string") {
      try { options = JSON.parse(flags.options); } catch { throw new Error("--options 必须是合法 JSON"); }
    }
    const data = await api(runtime, "/api/session/start", { method: "POST", body: JSON.stringify({ gameId, options }) });
    console.log(`已开播：${data.report?.gameName ?? gameId}`);
    console.log(`覆盖层：${baseOf(runtime)}/overlay?token=${runtime.token}`);
    return;
  }
  if (command === "stop") {
    const data = await api(runtime, "/api/session/stop", { method: "POST", body: JSON.stringify({ reason: "cli" }) });
    if (!data.report) console.log("当前没有进行中的直播。");
    else console.log(`已结束：${data.report.gameName} · 礼物 ${data.report.totals.gifts} · 热度 ${data.report.totals.heat}`);
    return;
  }
  if (command === "next") {
    const data = await api(runtime, "/api/session/next", { method: "POST", body: "{}" });
    console.log(`已进入第 ${data.round} 回合。`);
    return;
  }
  if (command === "gift") {
    const data = await api(runtime, "/api/event/gift", {
      method: "POST",
      body: JSON.stringify({ userName: flags.user || "测试观众", giftId: flags.gift || "heart", count: Number(flags.count) || 1 }),
    });
    console.log(data.result?.ok ? "测试礼物已计入。" : `未计入：${data.result?.reason ?? "unknown"}`);
    return;
  }
  if (command === "report") {
    const data = await api(runtime, "/api/session/report");
    const report = data.report;
    if (!report) { console.log("暂无场次数据。"); return; }
    console.log(`${report.gameName} · ${report.status} · ${duration(report.durationMs)}`);
    console.log(`礼物 ${report.totals.gifts} 次 / 热度 ${report.totals.heat} / 评论 ${report.totals.comments} / 峰值在线 ${report.totals.peakViewers}`);
    for (const user of (report.topUsers || []).slice(0, 5)) console.log(`  #${user.rank} ${user.name} · 热度 ${user.heat}`);
    return;
  }
  if (command === "sessions") {
    const data = await api(runtime, "/api/sessions");
    for (const session of data.sessions) {
      console.log(`${new Date(session.startedAt).toLocaleString()} · ${session.gameName} · ${session.status} · 礼物 ${session.totals?.gifts ?? 0} · 热度 ${session.totals?.heat ?? 0}`);
    }
    if (data.sessions.length === 0) console.log("还没有历史场次。");
    return;
  }
  throw new Error(`未知命令：${command}（运行 help 查看用法）`);
}

main().catch((error) => {
  console.error(`错误：${error?.message ?? error}`);
  process.exit(1);
});
