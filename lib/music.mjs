import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CLI = path.resolve(here, "../../music-player/bin/music.mjs");

/**
 * 音乐插件桥接：所有请求交给 music-player 的 CLI，工作台自己不碰酷狗风控。
 * CLI 协议：stdout 单行 JSON，{state:"succeeded"|"failed"}。
 */
export class MusicBridge {
  constructor({ cliPath = process.env.RUODAO_MUSIC_CLI || DEFAULT_CLI, timeoutMs = 45_000 } = {}) {
    this.cliPath = cliPath;
    this.timeoutMs = timeoutMs;
    this.cache = new Map();
    this.lastError = "";
  }

  available() {
    try { return fs.statSync(this.cliPath).isFile(); } catch { return false; }
  }

  run(command, payload = {}, timeoutMs = this.timeoutMs) {
    if (!this.available()) {
      return Promise.reject(new Error("未安装音乐插件：plugins/music-player"));
    }
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [this.cliPath, command], {
        cwd: path.dirname(this.cliPath),
        windowsHide: true,
        env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill(); } catch { /* ignore */ }
        reject(new Error(`音乐服务响应超时（${Math.round(timeoutMs / 1000)} 秒）`));
      }, timeoutMs);
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("{"));
        const last = lines[lines.length - 1];
        if (!last) {
          this.lastError = stderr.trim() || `音乐插件退出码 ${code}`;
          reject(new Error(this.lastError));
          return;
        }
        try {
          const parsed = JSON.parse(last);
          if (parsed.state === "failed") {
            this.lastError = String(parsed.error || "音乐插件执行失败");
            reject(Object.assign(new Error(this.lastError), { payload: parsed }));
            return;
          }
          resolve(parsed);
        } catch (error) {
          reject(new Error(`音乐插件返回无法解析：${error.message}`));
        }
      });
      try {
        child.stdin.end(JSON.stringify(payload ?? {}));
      } catch { /* stdin 已关闭时忽略 */ }
    });
  }

  async doctor() {
    try {
      const result = await this.run("moekoe_status", {}, 20_000);
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: String(error.message || error) };
    }
  }

  normalizeSong(song) {
    if (!song || typeof song !== "object") return null;
    const duration = Number(song.durationSec || song.duration || song.timeLength || 0) || 0;
    return {
      hash: String(song.hash || song.id || ""),
      title: String(song.name || song.title || "").slice(0, 120),
      artist: String(song.singer || song.artist || "").slice(0, 120),
      album: String(song.album || "").slice(0, 80),
      duration,
      cover: String(song.cover || song.img || "").slice(0, 500),
      quality: String(song.quality || ""),
      isTrial: Boolean(song.isTrial),
    };
  }

  async search(keywords, limit = 12) {
    const query = String(keywords || "").trim();
    if (!query) throw new Error("请输入歌名、歌手或关键词");
    const cached = this.cache.get(query);
    if (cached && Date.now() - cached.at < 120_000) return cached.songs.slice(0, limit);
    const result = await this.run("search", { keywords: query, pagesize: Math.max(10, Math.min(30, limit)) });
    const songs = (Array.isArray(result.songs) ? result.songs : []).map((song) => this.normalizeSong(song)).filter(Boolean);
    this.cache.set(query, { at: Date.now(), songs });
    return songs.slice(0, limit);
  }

  async play(input = {}) {
    const payload = {};
    if (input.hash) payload.hash = String(input.hash);
    if (input.keywords || input.prompt) payload.keywords = String(input.keywords || input.prompt);
    if (input.index) payload.index = Math.max(1, Number(input.index) || 1);
    if (input.quality) payload.quality = String(input.quality);
    const result = await this.run("play", payload, 60_000);
    if (!result.url) throw new Error(String(result.error || "未取得播放地址（可能需要 VIP 或安全验证）"));
    const song = this.normalizeSong(result.song) || {};
    return {
      ...song,
      title: song.title || String(input.title || input.keywords || "直播间 BGM"),
      artist: song.artist || String(input.artist || ""),
      url: String(result.url),
      quality: String(result.quality || input.quality || "128"),
      isTrial: Boolean(result.isTrial),
      trialSec: Number(result.trialSec) || 0,
      source: "kugou",
      pickedAt: Date.now(),
    };
  }
}
