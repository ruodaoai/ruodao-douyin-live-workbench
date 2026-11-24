// 通用玩法模拟基座：统一生命周期（prepare→battle→settle）、权威 tick、指令/礼物接入与快照契约。
// 各玩法继承本类，只实现 _resetField / _advance / _leader / _onEvent / _snapshotExtra。
import { RoundCycle } from "./room.mjs";
import { Ledger } from "./ledger.mjs";
import { clamp, uid, mulberry32, hashSeed } from "../util.mjs";

export class SimBase {
  constructor({ gameId, manifest, options = {}, seed = "", now = Date.now(), roundDurationMs, prepareMs = 5000, settleMs = 6000, maxEffects = 48 } = {}) {
    this.gameId = gameId || manifest.id;
    this.game = manifest;
    this.options = { ...manifest.defaults };
    this.random = mulberry32(hashSeed(String(seed || "")));
    this.ledger = new Ledger({ towerBonusPct: manifest.defaults?.towerBonusPct ?? 30 });
    this.isRunning = false;
    this.createdAt = now;
    this.lastTickAt = now;
    this.effects = [];
    this.effectCount = 0;
    this.combo = 0;
    this.beats = 0;
    this.cycle = new RoundCycle({
      roundDurationMs: roundDurationMs ?? (Number(manifest.defaults?.roundSeconds) || 90) * 1000,
      prepareMs,
      settleMs,
    });
    this.round = this.cycle.info(now);
    this.setOptions(options);
  }

  get users() {
    return this.ledger.users;
  }

  setOptions(options = {}) {
    if (options && typeof options === "object") this.options = { ...this.options, ...options };
    const rs = Number(this.options.roundSeconds);
    if (Number.isFinite(rs) && rs > 0) this.cycle.roundDurationMs = rs * 1000;
    this._applyOptions?.();
  }

  start(now = Date.now()) {
    this.isRunning = true;
    this.cycle.start(now);
    this._resetField?.();
    this.round = this.cycle.info(now);
    this._push({ type: "phase", text: `第 1 回合开始`, ts: now });
    return this.round;
  }

  stop(now = Date.now(), reason = "manual") {
    if (!this.isRunning) return { round: this.round };
    if (this.cycle.status !== "settled") this._settle(now, this._leader(), reason, true);
    this.isRunning = false;
    return { round: this.round };
  }

  startRound(now = Date.now()) {
    if (!this.isRunning) throw new Error("当前没有进行中的直播");
    this._resetField?.();
    this.cycle.index += 1;
    this.cycle.status = "running";
    this.cycle.phase = "battle";
    this.cycle.phaseStartedAt = now;
    this.cycle.battleEndsAt = now + this.cycle.roundDurationMs;
    this.cycle.settledAt = 0;
    this.cycle.settleEndsAt = 0;
    this.cycle.winner = null;
    this.cycle.reason = "";
    this.round = this.cycle.info(now);
    this._push({ type: "phase", text: `第 ${this.cycle.index} 回合开始`, ts: now });
    return { effects: this.effects.slice(-4) };
  }

  endRound(now = Date.now(), reason = "manual") {
    const before = this.effectCount;
    if (this.cycle.status !== "settled") this._settle(now, this._leader(), reason, false);
    return { effects: this.effects.slice(-8), delta: this.effectCount - before };
  }

  _settle(now, winner, reason, rewardTower) {
    const reward = rewardTower ? this.ledger.towerBreak(now) : Math.round(this.ledger.pools.tower * 0.15);
    const winnerName = this._nameOf?.(winner) || this._leaderName?.() || "冠军";
    this.cycle.settle(now, winner, reason, { reward, result: this._settleResult?.() ?? {} });
    this.round = this.cycle.info(now);
    this.ledger.awardStreak(1);
    this._push({ type: "win", id: uid("fx"), ts: now, winner, text: `${winnerName} 拿下第 ${this.cycle.index} 回合`, reward });
  }

  tick(now = Date.now()) {
    const before = this.effectCount;
    const dt = clamp((now - this.lastTickAt) / 1000, 0, 0.5);
    this.lastTickAt = now;
    if (!this.isRunning) return { changed: false, effects: [] };

    const { events } = this.cycle.tick(now);
    for (const event of events) {
      if (event.type === "phase" && event.phase === "battle") this._push({ type: "phase", text: `第 ${event.index} 回合 · 对战开始`, ts: now });
      if (event.type === "phase" && event.phase === "prepare") { this._resetField?.(); this._push({ type: "phase", text: `第 ${event.index} 回合准备`, ts: now }); }
      if (event.type === "battle-timeout" && this.cycle.status !== "settled") this._settle(now, this._leader(), "timeout", false);
    }

    if (this.cycle.phase === "battle" && this.cycle.status === "running") {
      const finished = this._advance(now, dt);
      if (finished) this._settle(now, finished.winner, finished.reason || "finish", true);
    }

    this.round = this.cycle.info(now);
    const changed = this.effectCount !== before || this.cycle.phase === "battle";
    return { changed, effects: this.effects.slice(-12) };
  }

  apply(event, now = Date.now()) {
    if (!event || !event.type) return { effects: [] };
    const account = this.ledger.user(event.user?.id || event.user?.name, event.user?.name);
    const effects = this._onEvent(event, account, now) || [];
    for (const effect of effects) this._push(effect);
    return { effects };
  }

  _push(effect) {
    this.effects.push(effect);
    this.effectCount += 1;
    if (this.effects.length > 64) this.effects.splice(0, this.effects.length - 64);
  }

  snapshot(now = Date.now()) {
    const round = this.cycle.info(now);
    const countdownMs = this.cycle.phase === "battle" ? Math.max(0, this.cycle.battleEndsAt - now) : 0;
    const leaderboard = this.ledger.leaderboard(10);
    const extra = this._snapshotExtra(now) || {};
    return {
      gameId: this.gameId,
      gameName: this.game.name,
      scene: this.game.scene,
      accent: this.game.accent,
      accent2: this.game.accent2,
      status: this.isRunning ? "running" : "ended",
      startedAt: this.cycle.startedAt,
      now,
      phase: this.cycle.phase,
      countdownMs,
      round: { ...round, endsAt: this.cycle.phase === "battle" ? this.cycle.battleEndsAt : 0 },
      teams: extra.teams || [],
      hud: extra.hud || {},
      units: extra.units || [],
      leaderboard,
      topUsers: leaderboard,
      totalHeat: Math.round(this.ledger.pools.score),
      combo: Math.round(this.combo),
      beats: this.beats,
      level: extra.level || 0,
      levelName: extra.levelName || "",
      ...(extra.top || {}),
    };
  }
}

export default SimBase;
