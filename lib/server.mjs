import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { readJsonBody } from "./util.mjs";
import { collectAssets } from "./assets.mjs";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const PAGE_CSP_BASE = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob: data:",
  "connect-src 'self' blob: http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
];
// 桌面宿主的插件 iframe 是 sandbox（无 allow-same-origin）→ 祖先源不透明，
// frame-ancestors 的任何 URL 源都匹配不上，只能给工作台内的预览响应整条省略。
// 普通覆盖层仍带白名单，防止被任意网页套框；预览地址还要求 token + preview=1。
const PAGE_CSP = [...PAGE_CSP_BASE, "frame-ancestors * http: https: file: ruodao-plugin:"].join("; ");
const PAGE_CSP_PREVIEW = PAGE_CSP_BASE.join("; ");

const JSON_LIMIT = 1024 * 1024;

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, x-live-token, x-file-name, authorization, range",
    "access-control-expose-headers": "content-length, content-range",
    "access-control-allow-private-network": "true",
    "access-control-max-age": "600",
  };
}

function writeJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    ...corsHeaders(),
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function writeHtml(res, status, html, extra = {}) {
  res.writeHead(status, {
    ...corsHeaders(),
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": PAGE_CSP,
    ...extra,
  });
  res.end(html);
}

function errorPage(message) {
  const text = String(message || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>抖音直播工作台</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d17;color:#e8eaf6;font:15px/1.7 "Microsoft YaHei",system-ui,sans-serif}
.card{max-width:560px;padding:32px 36px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:linear-gradient(160deg,#161a2e,#0d1020);box-shadow:0 24px 60px rgba(0,0,0,.45)}
h1{font-size:18px;margin:0 0 10px;color:#ff4d6d}p{margin:0;color:#a9b0c8}code{color:#7dd3fc;background:rgba(125,211,252,.1);padding:2px 6px;border-radius:6px}</style>
<div class="card"><h1>无法打开直播工作台</h1><p>${text}</p></div></html>`;
}

function safeCompare(candidate, token) {
  const left = Buffer.from(String(candidate || ""));
  const right = Buffer.from(String(token || ""));
  if (left.length !== right.length || left.length === 0) return false;
  try {
    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function authCandidate(req, url) {
  const header = String(req.headers["x-live-token"] || "");
  if (header) return header;
  const bearer = String(req.headers.authorization || "");
  if (/^Bearer\s+/i.test(bearer)) return bearer.replace(/^Bearer\s+/i, "").trim();
  return url.searchParams.get("token") || "";
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(server.address());
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

export async function loadRuntime(dataDir) {
  const file = path.join(dataDir, "runtime.json");
  let runtime = {};
  try {
    runtime = JSON.parse(await fs.promises.readFile(file, "utf8"));
  } catch {
    runtime = {};
  }
  const envToken = String(process.env.RUODAO_LIVE_TOKEN || "").trim();
  let token = envToken || String(runtime.token || "");
  if (!/^[a-zA-Z0-9_-]{24,128}$/.test(token)) token = crypto.randomBytes(24).toString("hex");
  const port = Math.max(0, Math.min(65535, Number(process.env.RUODAO_LIVE_PORT || runtime.port) || 0));
  const next = { token, port, updatedAt: Date.now() };
  await fs.promises.mkdir(dataDir, { recursive: true });
  await fs.promises.writeFile(file, JSON.stringify(next, null, 2), "utf8");
  return { ...next, file };
}

export class LiveServer {
  constructor({ controller, webRoot, host = "127.0.0.1", preferredPort = 43119, dataDir }) {
    this.controller = controller;
    this.webRoot = path.resolve(webRoot);
    this.host = host;
    this.preferredPort = preferredPort;
    this.dataDir = dataDir ?? controller.store.dataDir;
    this.server = null;
    this.port = 0;
    this.token = "";
    this.runtimeFile = "";
    this.sseClients = new Set();
    this.heartbeat = null;
    this.unsubscribers = [];
    this.startedAt = 0;
  }

  async start() {
    if (this.server) return this.info();
    const runtime = await loadRuntime(this.dataDir);
    this.token = runtime.token;
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((error) => {
        if (res.headersSent) {
          try { res.end(); } catch { /* 已断开 */ }
          return;
        }
        writeJson(res, Number(error?.status) || 500, { ok: false, error: String(error?.message ?? error) });
      });
    });
    const desired = runtime.port || this.preferredPort;
    let address;
    try {
      address = await listen(this.server, this.host, desired);
    } catch (error) {
      if (error?.code !== "EADDRINUSE") throw error;
      address = await listen(this.server, this.host, 0);
    }
    this.port = address.port;
    this.startedAt = Date.now();
    await fs.promises.writeFile(runtime.file, JSON.stringify({ token: this.token, port: this.port, updatedAt: Date.now() }, null, 2), "utf8");
    this.unsubscribers.push(this.controller.subscribe((state) => this.broadcast("state", state)));
    this.unsubscribers.push(this.controller.on("effects", (payload) => this.broadcast("effects", payload)));
    this.unsubscribers.push(this.controller.on("alert", (payload) => this.broadcast("alert", payload)));
    this.unsubscribers.push(this.controller.on("session", (payload) => this.broadcast("session", payload)));
    this.heartbeat = setInterval(() => {
      for (const client of this.sseClients) {
        try { client.write(": ping\n\n"); } catch { /* 客户端已断开 */ }
      }
    }, 15_000);
    this.heartbeat.unref?.();
    return this.info();
  }

  info() {
    const base = `http://127.0.0.1:${this.port}`;
    return {
      port: this.port,
      host: this.host,
      token: this.token,
      baseUrl: base,
      overlayUrl: `${base}/overlay?token=${encodeURIComponent(this.token)}`,
      workbenchUrl: `${base}/workbench?token=${encodeURIComponent(this.token)}`,
      startedAt: this.startedAt,
      version: this.controller.version,
      dataDir: this.dataDir,
    };
  }

  authorized(req, url) {
    return safeCompare(authCandidate(req, url), this.token);
  }

  broadcast(event, payload) {
    if (this.sseClients.size === 0) return;
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(frame);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  async handle(req, res) {
    const url = new URL(req.url || "/", `http://127.0.0.1:${this.port || 80}`);
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    if (url.pathname === "/health") {
      writeJson(res, 200, {
        ok: true,
        app: "ruodao-live-workbench",
        version: this.controller.version,
        uptimeMs: Date.now() - this.startedAt,
        live: Boolean(this.controller.session),
      });
      return;
    }

    if (url.pathname.startsWith("/assets/")) {
      await this.serveAsset(req, res, url.pathname.slice("/assets/".length));
      return;
    }

    if (url.pathname === "/overlay" || url.pathname === "/overlay/") {
      if (!this.authorized(req, url)) {
        writeHtml(res, 403, errorPage("覆盖层地址缺少访问令牌。请在直播工作台的「开播检查」里复制完整覆盖层地址。"));
        return;
      }
      await this.servePage(res, "overlay.html", { preview: url.searchParams.get("preview") === "1" });
      return;
    }

    // 工作台页面放在 /assets/ 下，页面里的相对路径在浏览器与插件宿主两种环境
    // 都能解析到同一份文件；/workbench 只做带令牌跳转。
    if (url.pathname === "/workbench" || url.pathname === "/workbench/") {
      if (!this.authorized(req, url)) {
        writeHtml(res, 403, errorPage("工作台地址缺少访问令牌。请使用桌面端插件入口，或通过命令行 <code>serve</code> 打印的完整地址打开。"));
        return;
      }
      res.writeHead(302, { ...corsHeaders(), location: `/assets/index.html?token=${encodeURIComponent(this.token)}` });
      res.end();
      return;
    }

    if (url.pathname === "/") {
      res.writeHead(302, { ...corsHeaders(), location: this.authorized(req, url) ? `/assets/index.html?token=${encodeURIComponent(this.token)}` : "/overlay" });
      res.end();
      return;
    }

    if (!url.pathname.startsWith("/api/")) {
      writeJson(res, 404, { ok: false, error: "Not Found" });
      return;
    }
    if (!this.authorized(req, url)) {
      writeJson(res, 401, { ok: false, error: "访问令牌无效" });
      return;
    }

    await this.handleApi(req, res, url);
  }

  async servePage(res, name, { preview = false } = {}) {
    const file = path.join(this.webRoot, name);
    try {
      const html = await fs.promises.readFile(file);
      res.writeHead(200, {
        ...corsHeaders(),
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": preview ? PAGE_CSP_PREVIEW : PAGE_CSP,
      });
      res.end(html);
    } catch {
      writeHtml(res, 404, errorPage(`缺少页面资源：${name}`));
    }
  }

  async serveAsset(req, res, relativePath) {
    const clean = decodeURIComponent(String(relativePath || "")).replace(/\\/g, "/");
    if (!clean || clean.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith("."))) {
      writeJson(res, 400, { ok: false, error: "资源路径无效" });
      return;
    }
    const root = path.resolve(this.webRoot) + path.sep;
    // /assets/ 同时承载工作台页面（web/xxx）与插件素材（web/assets/xxx），两处都要能取到。
    let file = null;
    let stat = null;
    for (const candidate of [path.resolve(this.webRoot, clean), path.resolve(this.webRoot, "assets", clean)]) {
      if (!candidate.startsWith(root)) continue;
      const info = await fs.promises.stat(candidate).catch(() => null);
      if (info?.isFile()) { file = candidate; stat = info; break; }
    }
    if (!file) {
      writeJson(res, 404, { ok: false, error: "资源不存在" });
      return;
    }
    try {
      const etag = `W/"${stat.size}-${Math.round(stat.mtimeMs)}"`;
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304, { ...corsHeaders(), etag });
        res.end();
        return;
      }
      const ext = path.extname(file).toLowerCase();
      const contentType = MIME[ext] || "application/octet-stream";
      res.writeHead(200, {
        ...corsHeaders(),
        etag,
        "content-type": contentType,
        "content-length": stat.size,
        "cache-control": ext === ".html" ? "no-store" : "public, max-age=60",
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "cross-origin",
      });
      fs.createReadStream(file).pipe(res);
    } catch {
      writeJson(res, 404, { ok: false, error: "资源不存在" });
    }
  }

  async handleApi(req, res, url) {
    const method = req.method || "GET";
    const route = url.pathname;

    if (method === "GET" && route === "/api/state") {
      writeJson(res, 200, this.controller.state());
      return;
    }

    if (method === "GET" && route === "/api/stream") {
      res.writeHead(200, {
        ...corsHeaders(),
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      res.write(`retry: 2000\n\n`);
      this.sseClients.add(res);
      const state = this.controller.state();
      res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
      req.on("close", () => this.sseClients.delete(res));
      return;
    }

    if (method === "GET" && route === "/api/games") {
      writeJson(res, 200, { ok: true, games: this.controller.games(), gifts: this.controller.gifts() });
      return;
    }

    if (method === "GET" && route === "/api/runtime") {
      const info = this.info();
      writeJson(res, 200, {
        ok: true,
        port: info.port,
        baseUrl: info.baseUrl,
        overlayUrl: info.overlayUrl,
        workbenchUrl: info.workbenchUrl,
        version: info.version,
        dataDir: info.dataDir,
      });
      return;
    }

    if (route === "/api/session/start" && method === "POST") {
      const body = await readJsonBody(req, JSON_LIMIT);
      const report = await this.controller.startSession({ gameId: body.gameId, options: body.options });
      writeJson(res, 200, { ok: true, report, state: this.controller.state() });
      return;
    }

    if (route === "/api/session/stop" && method === "POST") {
      const body = await readJsonBody(req, JSON_LIMIT).catch(() => ({}));
      const report = await this.controller.stopSession({ reason: body.reason || "manual" });
      writeJson(res, 200, { ok: true, report });
      return;
    }

    if (route === "/api/session/next" && method === "POST") {
      const result = await this.controller.nextRound();
      writeJson(res, 200, { ok: true, ...result });
      return;
    }

    if (route === "/api/session/report" && method === "GET") {
      writeJson(res, 200, { ok: true, report: this.controller.report() });
      return;
    }

    if (route === "/api/event/gift" && method === "POST") {
      const body = await readJsonBody(req, JSON_LIMIT);
      const result = this.controller.injectGift(body);
      writeJson(res, 200, { ok: true, result });
      return;
    }

    if (route === "/api/event/raw" && method === "POST") {
      const body = await readJsonBody(req, JSON_LIMIT);
      const result = this.controller.injectRaw(body.payload ?? body);
      writeJson(res, 200, { ok: true, result });
      return;
    }

    if (route === "/api/settings" && method === "POST") {
      const body = await readJsonBody(req, JSON_LIMIT);
      const settings = await this.controller.saveSettings(body.patch ?? body);
      writeJson(res, 200, { ok: true, settings });
      return;
    }

    if (method === "GET" && route === "/api/assets") {
      const assets = await collectAssets(this.webRoot);
      writeJson(res, 200, { ok: true, ...assets });
      return;
    }

    if (method === "GET" && route === "/api/music/status") {
      const status = await this.controller.musicStatus({ refresh: url.searchParams.get("refresh") === "1" });
      writeJson(res, 200, { ok: true, status, bridge: this.controller.music.available() });
      return;
    }

    if (route === "/api/music/search" && method === "POST") {
      const body = await readJsonBody(req, JSON_LIMIT);
      const result = await this.controller.searchMusic(body.keywords || body.q || "");
      writeJson(res, 200, { ok: true, ...result });
      return;
    }

    if (route === "/api/music/play" && method === "POST") {
      const body = await readJsonBody(req, JSON_LIMIT);
      const bgm = await this.controller.setBgmTrack(body);
      writeJson(res, 200, { ok: true, bgm });
      return;
    }

    if (route === "/api/bgm/control" && method === "POST") {
      const body = await readJsonBody(req, JSON_LIMIT);
      const bgm = await this.controller.controlBgm(body);
      writeJson(res, 200, { ok: true, bgm });
      return;
    }

    if (route === "/api/bgm/stream" && method === "GET") {
      await this.proxyAudio(req, res);
      return;
    }

    if (route === "/api/control/push" && method === "POST") {
      const body = await readJsonBody(req, JSON_LIMIT);
      const subtitle = await this.controller.pushControl(body);
      writeJson(res, 200, { ok: true, subtitle });
      return;
    }

    if (route === "/api/control/script" && method === "POST") {
      const body = await readJsonBody(req, JSON_LIMIT);
      const subtitle = await this.controller.runControlScript(body.scriptId || body.id);
      writeJson(res, 200, { ok: true, subtitle });
      return;
    }

    if (route === "/api/control/save" && method === "POST") {
      const body = await readJsonBody(req, JSON_LIMIT);
      const control = await this.controller.saveControl(body.patch ?? body);
      writeJson(res, 200, { ok: true, control });
      return;
    }

    if (route === "/api/control/generate" && method === "POST") {
      const body = await readJsonBody(req, JSON_LIMIT);
      const result = await this.controller.generateControlScripts(body);
      writeJson(res, 200, { ok: true, ...result });
      return;
    }

    if (route === "/api/stage" && method === "POST") {
      const body = await readJsonBody(req, JSON_LIMIT);
      const stage = await this.controller.saveStage(body.patch ?? body);
      writeJson(res, 200, { ok: true, stage });
      return;
    }

    if (route === "/api/models/import" && method === "POST") {
      const model = await this.importModel(req);
      writeJson(res, 200, { ok: true, model });
      return;
    }

    if (route === "/api/models/delete" && method === "POST") {
      const body = await readJsonBody(req, JSON_LIMIT);
      const removed = await this.deleteModel(body.name);
      writeJson(res, 200, { ok: true, removed });
      return;
    }

    if (route === "/api/source/connect" && method === "POST") {
      const body = await readJsonBody(req, JSON_LIMIT);
      const source = await this.controller.connectSource(body);
      writeJson(res, 200, { ok: true, source });
      return;
    }

    if (route === "/api/source/disconnect" && method === "POST") {
      const source = await this.controller.disconnectSource();
      writeJson(res, 200, { ok: true, source });
      return;
    }

    if (route === "/api/sessions" && method === "GET") {
      writeJson(res, 200, { ok: true, sessions: await this.controller.listSessions() });
      return;
    }

    const sessionMatch = route.match(/^\/api\/sessions\/([A-Za-z0-9._:-]{1,96})(\/events)?$/);
    if (sessionMatch) {
      const id = sessionMatch[1];
      const events = Boolean(sessionMatch[2]);
      if (method === "GET" && events) {
        const limit = Math.max(1, Math.min(5000, Number(url.searchParams.get("limit")) || 2000));
        writeJson(res, 200, { ok: true, events: await this.controller.readSessionEvents(id, limit) });
        return;
      }
      if (method === "GET") {
        const session = await this.controller.readSession(id);
        if (!session) {
          writeJson(res, 404, { ok: false, error: "场次不存在" });
          return;
        }
        writeJson(res, 200, { ok: true, session });
        return;
      }
      if (method === "DELETE") {
        await this.controller.deleteSession(id);
        writeJson(res, 200, { ok: true });
        return;
      }
    }

    writeJson(res, 404, { ok: false, error: `未知接口：${method} ${route}` });
  }

  async proxyAudio(req, res) {
    const track = this.controller.settings.bgm?.track;
    if (!track?.url) {
      writeJson(res, 404, { ok: false, error: "当前没有 BGM 曲目" });
      return;
    }
    const headers = {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
      referer: "https://www.kugou.com/",
    };
    if (req.headers.range) headers.range = String(req.headers.range);
    let upstream;
    try {
      upstream = await fetch(track.url, { headers, redirect: "follow", signal: AbortSignal.timeout(25_000) });
    } catch (error) {
      writeJson(res, 502, { ok: false, error: "音频源不可达：" + String(error.message || error) });
      return;
    }
    if (!upstream.ok && upstream.status !== 206) {
      writeJson(res, 502, { ok: false, error: "音频源返回 HTTP " + upstream.status });
      return;
    }
    const out = { ...corsHeaders(), "cache-control": "no-store", "accept-ranges": "bytes", "cross-origin-resource-policy": "cross-origin" };
    for (const key of ["content-type", "content-length", "content-range", "etag", "last-modified"]) {
      const value = upstream.headers.get(key);
      if (value) out[key] = value;
    }
    if (!out["content-type"]) out["content-type"] = "audio/mpeg";
    res.writeHead(upstream.status === 206 ? 206 : 200, out);
    if (!upstream.body) { res.end(); return; }
    const stream = Readable.fromWeb(upstream.body);
    stream.on("error", () => { try { res.destroy(); } catch { /* 已断开 */ } });
    req.on("close", () => { try { stream.destroy(); } catch { /* 已断开 */ } });
    stream.pipe(res);
  }

  async importModel(req) {
    let rawName = String(req.headers["x-file-name"] || "model.glb");
    try { rawName = decodeURIComponent(rawName); } catch { /* 保留原值 */ }
    const ext = path.extname(rawName).toLowerCase();
    if (![".glb", ".gltf"].includes(ext)) throw new Error("只支持 .glb / .gltf 模型");
    const base = path.basename(rawName, ext).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60) || "model";
    const dir = path.join(this.webRoot, "assets", "models");
    await fs.promises.mkdir(dir, { recursive: true });
    let file = path.join(dir, base + ext);
    let index = 2;
    while (fs.existsSync(file)) file = path.join(dir, base + "-" + index++ + ext);
    const limit = 80 * 1024 * 1024;
    let size = 0;
    const handle = await fs.promises.open(file, "w");
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) throw new Error("模型超过 80MB 限制");
        await handle.write(chunk);
      }
    } catch (error) {
      await handle.close().catch(() => undefined);
      await fs.promises.rm(file, { force: true }).catch(() => undefined);
      throw error;
    }
    await handle.close();
    const name = path.basename(file);
    return { name, url: "/assets/models/" + encodeURIComponent(name), size, ext };
  }

  async deleteModel(name) {
    const clean = path.basename(String(name || ""));
    if (!/^[A-Za-z0-9._-]+\.(glb|gltf)$/i.test(clean)) throw new Error("模型文件名无效");
    const file = path.join(this.webRoot, "assets", "models", clean);
    await fs.promises.rm(file, { force: true });
    return clean;
  }

  async stop() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const off of this.unsubscribers) {
      try { off(); } catch { /* 已注销 */ }
    }
    this.unsubscribers = [];
    for (const client of this.sseClients) {
      try { client.end(); } catch { /* 已断开 */ }
    }
    this.sseClients.clear();
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

export async function createLiveServer(options) {
  const server = new LiveServer(options);
  await server.start();
  return server;
}
