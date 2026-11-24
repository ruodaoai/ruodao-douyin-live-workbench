import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SETTINGS, GAME_BY_ID, GAMES, mergeSettings } from "./catalog.mjs";
import { sanitizeBgm, sanitizeControl, sanitizeStage } from "./live-control.mjs";
import { safeId } from "./util.mjs";

export function resolveDataDir(explicit) {
  const fromArg = String(explicit || "").trim();
  if (fromArg) return path.resolve(fromArg);
  const fromEnv = String(process.env.RUODAO_PLUGIN_DATA_DIR || "").trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(os.homedir(), ".ruodao", "douyin-live-workbench");
}

async function atomicWrite(filePath, text) {
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(temp, text, "utf8");
  try {
    await fs.promises.rename(temp, filePath);
  } catch {
    await fs.promises.rm(filePath, { force: true }).catch(() => undefined);
    await fs.promises.rename(temp, filePath);
  }
}

export class Store {
  constructor(dataDir) {
    this.dataDir = resolveDataDir(dataDir);
    this.settingsFile = path.join(this.dataDir, "settings.json");
    this.sessionsDir = path.join(this.dataDir, "sessions");
    this.indexFile = path.join(this.sessionsDir, "index.json");
    this.activeFile = path.join(this.sessionsDir, "active.json");
    this.settings = { ...DEFAULT_SETTINGS };
    this.appendQueues = new Map();
  }

  async init() {
    await fs.promises.mkdir(this.sessionsDir, { recursive: true });
    const raw = await fs.promises.readFile(this.settingsFile, "utf8").catch(() => "");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        this.settings = mergeSettings({ ...DEFAULT_SETTINGS }, parsed);
      } catch {
        this.settings = { ...DEFAULT_SETTINGS };
      }
    } else {
      await this.saveSettings({});
    }
    this.settings = this.sanitizeSettings(this.settings);
    return this;
  }

  sanitizeSettings(settings) {
    const next = { ...settings };
    const source = next.source && typeof next.source === "object" ? next.source : {};
    next.source = {
      type: ["demo", "relay"].includes(String(source.type)) ? String(source.type) : "demo",
      url: String(source.url || "").slice(0, 1000),
      token: String(source.token || "").slice(0, 1000),
      autoReconnect: source.autoReconnect !== false,
    };
    const demo = next.demo && typeof next.demo === "object" ? next.demo : {};
    next.demo = {
      scenario: ["normal", "burst", "quiet", "finale"].includes(String(demo.scenario)) ? String(demo.scenario) : "normal",
      speed: Math.min(6, Math.max(0.25, Number(demo.speed) || 1)),
    };
    next.theme = ["neon", "candy", "gold"].includes(String(next.theme)) ? String(next.theme) : "neon";
    next.sound = next.sound !== false;
    next.showHints = next.showHints !== false;
    next.lastGameId = GAME_BY_ID.has(String(next.lastGameId)) ? String(next.lastGameId) : (GAMES[0]?.id ?? "human-vs-zombie");
    delete next.avatarModel;
    delete next.rewards;
    next.overlayTitle = String(next.overlayTitle || "若道互动直播间").slice(0, 40);
    next.overlaySubtitle = String(next.overlaySubtitle || "送礼物参与互动").slice(0, 60);
        next.bgm = sanitizeBgm(next.bgm, DEFAULT_SETTINGS.bgm);
    next.control = sanitizeControl(next.control, DEFAULT_SETTINGS.control);
    next.stage = sanitizeStage(next.stage, DEFAULT_SETTINGS.stage);
    return next;
  }

  async saveSettings(patch) {
    const merged = mergeSettings(this.settings, patch || {});
    this.settings = this.sanitizeSettings(merged);
    await atomicWrite(this.settingsFile, JSON.stringify(this.settings, null, 2));
    return this.settings;
  }

  appendEvent(sessionId, event) {
    const id = safeId(sessionId, "");
    if (!id) return Promise.resolve();
    const file = path.join(this.sessionsDir, `${id}.ndjson`);
    const line = `${JSON.stringify(event)}\n`;
    const previous = this.appendQueues.get(id) ?? Promise.resolve();
    const next = previous.then(() => fs.promises.appendFile(file, line, "utf8")).catch(() => undefined);
    this.appendQueues.set(id, next);
    return next;
  }

  async archiveSession(summary) {
    const id = safeId(summary?.id, "");
    if (!id) throw new Error("会话 ID 无效");
    const file = path.join(this.sessionsDir, `${id}.json`);
    await atomicWrite(file, JSON.stringify(summary, null, 2));
    const index = await this.readIndex();
    const rows = index.filter((item) => item.id !== id);
    rows.unshift({
      id,
      gameId: summary.gameId,
      gameName: summary.gameName,
      status: summary.status,
      startedAt: summary.startedAt,
      endedAt: summary.endedAt,
      durationMs: summary.durationMs,
      totals: summary.totals,
      topUser: summary.topUsers?.[0] ?? null,
    });
    rows.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    await atomicWrite(this.indexFile, JSON.stringify(rows.slice(0, 300), null, 2));
    return summary;
  }

  async writeActive(summary) {
    await atomicWrite(this.activeFile, JSON.stringify({ ...summary, updatedAt: Date.now() }, null, 2));
  }

  async readActive() {
    const raw = await fs.promises.readFile(this.activeFile, "utf8").catch(() => "");
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async clearActive() {
    await fs.promises.rm(this.activeFile, { force: true }).catch(() => undefined);
  }

  async readIndex() {
    const raw = await fs.promises.readFile(this.indexFile, "utf8").catch(() => "");
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async listSessions() {
    const index = await this.readIndex();
    return index.slice(0, 100);
  }

  async readSession(id) {
    const safe = safeId(id, "");
    if (!safe) return null;
    const raw = await fs.promises.readFile(path.join(this.sessionsDir, `${safe}.json`), "utf8").catch(() => "");
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async readSessionEvents(id, limit = 2000) {
    const safe = safeId(id, "");
    if (!safe) return [];
    const pending = this.appendQueues.get(safe);
    if (pending) await pending.catch(() => undefined);
    const raw = await fs.promises.readFile(path.join(this.sessionsDir, `${safe}.ndjson`), "utf8").catch(() => "");
    if (!raw) return [];
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  }

  async deleteSession(id) {
    const safe = safeId(id, "");
    if (!safe) return false;
    const pending = this.appendQueues.get(safe);
    if (pending) await pending.catch(() => undefined);
    this.appendQueues.delete(safe);
    await fs.promises.rm(path.join(this.sessionsDir, `${safe}.json`), { force: true });
    await fs.promises.rm(path.join(this.sessionsDir, `${safe}.ndjson`), { force: true });
    const index = await this.readIndex();
    await atomicWrite(this.indexFile, JSON.stringify(index.filter((item) => item.id !== safe), null, 2));
    return true;
  }
}
