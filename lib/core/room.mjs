// 回合节拍机：prepare（准备） -> battle（对战） -> settle（结算） -> 下一回合。
// 只负责时间轴与阶段切换，具体的战场推进、血量与胜负判定由玩法模拟实现。

export const ROUND_PHASES = ["prepare", "battle", "settle"];

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export class RoundCycle {
  constructor({ roundDurationMs = 120_000, prepareMs = 6_000, settleMs = 8_000 } = {}) {
    this.roundDurationMs = Math.max(10_000, num(roundDurationMs, 120_000));
    this.prepareMs = Math.max(0, num(prepareMs, 6_000));
    this.settleMs = Math.max(0, num(settleMs, 8_000));
    this.index = 0;
    this.phase = "idle";
    this.status = "idle";
    this.startedAt = 0;
    this.phaseStartedAt = 0;
    this.prepareEndsAt = 0;
    this.battleEndsAt = 0;
    this.settleEndsAt = 0;
    this.settledAt = 0;
    this.winner = null;
    this.reason = "";
    this.reward = null;
    this.result = null;
  }

  /** 开始新一场（第一回合） */
  start(now) {
    this.index = 1;
    this.status = "running";
    this.startedAt = now;
    this._enterPrepare(now);
    return this.info(now);
  }

  _enterPrepare(now) {
    this.phase = "prepare";
    this.phaseStartedAt = now;
    this.prepareEndsAt = now + this.prepareMs;
    this.battleEndsAt = this.prepareEndsAt + this.roundDurationMs;
    this.settleEndsAt = 0;
    this.settledAt = 0;
    this.winner = null;
    this.reason = "";
    this.reward = null;
    this.result = null;
  }

  _enterBattle(now) {
    this.phase = "battle";
    this.phaseStartedAt = now;
    this.battleEndsAt = now + this.roundDurationMs;
  }

  _enterSettle(now, winner, reason, extra = {}) {
    this.phase = "settle";
    this.status = "settled";
    this.phaseStartedAt = now;
    this.settledAt = now;
    this.settleEndsAt = now + this.settleMs;
    this.winner = winner ?? null;
    this.reason = String(reason || "");
    this.reward = extra.reward ?? null;
    this.result = extra.result ?? null;
  }

  /** 推进时间轴；返回本步发生的阶段事件 */
  tick(now) {
    const events = [];
    if (this.status !== "running" && this.phase !== "settle") return { events };
    if (this.phase === "prepare" && now >= this.prepareEndsAt) {
      this._enterBattle(now);
      events.push({ type: "phase", phase: "battle", index: this.index });
    }
    if (this.phase === "battle" && now >= this.battleEndsAt) {
      events.push({ type: "battle-timeout", index: this.index });
    }
    if (this.phase === "settle" && this.settleEndsAt > 0 && now >= this.settleEndsAt) {
      this.index += 1;
      this.status = "running";
      this._enterPrepare(now);
      events.push({ type: "phase", phase: "prepare", index: this.index });
    }
    return { events };
  }

  /** 主动结算当前回合 */
  settle(now, winner, reason, extra = {}) {
    if (this.status === "settled") return this.info(now);
    this._enterSettle(now, winner, reason, extra);
    return this.info(now);
  }

  info(now = 0) {
    return {
      index: this.index,
      phase: this.phase,
      status: this.status,
      startedAt: this.startedAt,
      endsAt: this.phase === "battle" ? this.battleEndsAt : this.phase === "prepare" ? this.prepareEndsAt : 0,
      battleEndsAt: this.battleEndsAt,
      settleEndsAt: this.settleEndsAt,
      nextStartAt: this.phase === "settle" ? this.settleEndsAt : 0,
      settledAt: this.settledAt,
      winner: this.winner,
      reason: this.reason,
      reward: this.reward,
      result: this.result,
      remainingMs: this.phase === "battle" ? Math.max(0, this.battleEndsAt - now) : 0,
    };
  }
}