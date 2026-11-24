// 奔跑羊赛跑 · 权威模拟（Node 端唯一真相）。
// 扣1加入左羊、扣2加入右羊，666/点赞增加推力，礼物加速冲线并累积连胜与段位。
import { SimBase } from "../../lib/core/sim-base.mjs";
import { parseCommand } from "../../lib/core/commands.mjs";
import { clamp, safeText, uid, mulberry32 } from "../../lib/util.mjs";
import { manifest } from "./manifest.mjs";

const TEAM_META = {
  left: { id: "left", name: "左羊", color: "#38bdf8", light: "#93c5fd" },
  right: { id: "right", name: "右羊", color: "#f43f5e", light: "#fda4af" },
};
const TEAM_IDS = ["left", "right"];
const RANKS = [
  { name: "青铜", min: 0 },
  { name: "白银", min: 1000 },
  { name: "精英", min: 3000 },
  { name: "宗师", min: 8000 },
  { name: "君主", min: 20000 },
  { name: "至尊1", min: 40000 },
];

function rankOf(score) {
  let name = RANKS[0].name;
  for (const r of RANKS) if (score >= r.min) name = r.name;
  return name;
}

export class RunningSheepSimulation extends SimBase {
  constructor(args = {}) {
    super({ manifest, prepareMs: 4000, settleMs: 6000, ...args });
    if (this.gameId !== manifest.id) throw new Error(`未知玩法：${this.gameId}`);
    this.progress = { left: 0, right: 0 };
    this.thrust = { left: 0, right: 0 };
    this.streak = { left: 0, right: 0 };
    this.rankScore = { left: 0, right: 0 };
    this._rand = mulberry32(0x5ee9);
  }

  _applyOptions() { /* 读取在事件与推进时进行 */ }

  _resetField() {
    this.progress = { left: 0, right: 0 };
    this.thrust = { left: 0, right: 0 };
  }

  _nameOf(id) { return TEAM_META[id]?.name || ""; }
  _leaderName() { return this._nameOf(this._leader()); }
  _leader() {
    return this.progress.right > this.progress.left ? "right" : "left";
  }

  _settle(now, winner, reason, rewardTower) {
    if (this.cycle.status !== "settled" && winner && this.streak[winner] != null) {
      this.streak[winner] += 1;
      this.rankScore[winner] += 500;
    }
    super._settle(now, winner, reason, rewardTower);
  }

  _settleResult() {
    return { progress: { ...this.progress }, streak: { ...this.streak } };
  }

  _advance(now, dt) {
    const baseSpeed = clamp(Number(this.options.baseSpeed) || 0.012, 0.004, 0.03);
    const cheerK = (Number(this.options.cheerBoost) || 1.6) * 0.0009;
    for (const id of TEAM_IDS) {
      const speed = baseSpeed + this.thrust[id] * cheerK;
      this.progress[id] = Math.min(1, this.progress[id] + speed * dt);
      this.thrust[id] = Math.max(0, this.thrust[id] - dt * 16);
    }
    const done = TEAM_IDS.filter((id) => this.progress[id] >= 1);
    if (done.length) {
      done.sort((a, b) => this.progress[b] - this.progress[a]);
      return { winner: done[0], reason: "finish" };
    }
    return null;
  }
  _assignTeam(account) {
    if (account.team && TEAM_META[account.team]) return account.team;
    const left = this.ledger.memberCount("left");
    const right = this.ledger.memberCount("right");
    const team = left <= right ? "left" : "right";
    this.ledger.join(account, team);
    return team;
  }

  _onEvent(event, account, now) {
    const effects = [];
    const type = event.type;
    const cheerBoost = Number(this.options.cheerBoost) || 1.6;
    if (type === "gift") {
      const totalHeat = Math.max(0, Number(event.totalHeat) || Number(event.gift?.heat) * (Number(event.count) || 1));
      const team = this._assignTeam(account);
      this.ledger.gift(account, totalHeat, Number(event.count) || 1, now);
      this.thrust[team] = Math.min(400, this.thrust[team] + totalHeat * 0.06);
      this.rankScore[team] += totalHeat * 0.2;
      effects.push({ type: "gift-burst", id: uid("fx"), ts: now, team, gift: event.gift, text: `${account.name} 送出 ${event.gift?.name || "礼物"} ×${Number(event.count) || 1}，${this.teams2name(team)} 推力暴涨` });
      if (event.gift?.id === "rocket" || event.gift?.id === "carnival") {
        this.progress[team] = Math.min(0.99, this.progress[team] + 0.08);
        effects.push({ type: "summon", id: uid("fx"), ts: now, team, text: `${this.teams2name(team)} 火箭冲刺 · 直逼终点` });
      }
    } else if (type === "comment") {
      const cmd = parseCommand(event.text);
      if (cmd?.kind === "cheer") {
        const team = this._assignTeam(account);
        this.ledger.cheer(account, cmd.power);
        this.combo = Math.min(99, this.combo + Math.max(1, Math.round(cmd.power * 2)));
        this.thrust[team] = Math.min(400, this.thrust[team] + cmd.power * cheerBoost * 12);
        effects.push({ type: "cheer", id: uid("fx"), ts: now, team, text: `${this.teams2name(team)} 666 加速推力` });
      } else if (cmd?.kind === "join") {
        const team = cmd.team === "zombie" ? "right" : "left";
        this.ledger.join(account, team, now);
        this.thrust[team] = Math.min(400, this.thrust[team] + 8);
        effects.push({ type: "join", id: uid("fx"), ts: now, team, text: `${account.name} 加入${this.teams2name(team)}` });
      }
    } else if (type === "like") {
      const team = this._assignTeam(account);
      const count = Number(event.count) || 1;
      this.beats += count;
      this.thrust[team] = Math.min(400, this.thrust[team] + count * 0.35);
      effects.push({ type: "like-wave", id: uid("fx"), ts: now, team, count, text: `${this.teams2name(team)} 点赞加推力` });
    } else if (type === "follow") {
      const team = this._assignTeam(account);
      this.ledger.join(account, team, now);
      this.thrust[team] = Math.min(400, this.thrust[team] + 20);
      this.progress[team] = Math.min(0.98, this.progress[team] + 0.012);
      effects.push({ type: "follow-spark", id: uid("fx"), ts: now, team, text: `${account.name} 关注 · 助推${this.teams2name(team)}` });
    } else if (type === "enter") {
      effects.push({ type: "enter-orbit", id: uid("fx"), ts: now, text: `${account.name} 进入直播间` });
    }
    return effects;
  }

  teams2name(id) { return TEAM_META[id]?.name || id; }

  _snapshotExtra(now = Date.now()) {
    const trackMeters = clamp(Number(this.options.trackMeters) || 1500, 500, 3000);
    const teams = TEAM_IDS.map((id) => {
      const p = this.progress[id];
      const meters = Math.round(p * trackMeters);
      return {
        id, name: TEAM_META[id].name, color: TEAM_META[id].color, light: TEAM_META[id].light,
        members: this.ledger.memberCount(id), heat: this.ledger.teamHeat(id),
        thrust: Math.round(this.thrust[id]), progress: Math.round(p * 1000) / 1000,
        meters, remaining: Math.max(0, trackMeters - meters),
        streak: this.streak[id], rankScore: this.rankScore[id], rank: rankOf(this.rankScore[id]),
        pct: Math.round(p * 100),
      };
    });
    const countdownMs = this.cycle.phase === "battle" ? Math.max(0, this.cycle.battleEndsAt - now) : 0;
    return {
      teams,
      units: [],
      hud: {
        layout: "race",
        pools: this.ledger.snapshot(),
        countdownMs,
        phase: this.cycle.phase,
        trackMeters,
        thrust: { left: Math.round(this.thrust.left), right: Math.round(this.thrust.right) },
        streak: { ...this.streak },
        rank: { left: rankOf(this.rankScore.left), right: rankOf(this.rankScore.right) },
        score: { ...this.streak },
      },
      top: { score: { ...this.streak } },
    };
  }
}

export function createSimulation(args = {}) {
  return new RunningSheepSimulation(args);
}

export default createSimulation;