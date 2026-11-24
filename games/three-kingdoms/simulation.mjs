// 三国壮志 · 权威模拟（Node 端唯一真相）。
// 三阵营（蜀/吴/魏）扣1/2/3 加入，礼物提升兵力与兵种，克制链结算伤害，兵力最高者赢得回合。
import { SimBase } from "../../lib/core/sim-base.mjs";
import { parseCommand, normalizeText } from "../../lib/core/commands.mjs";
import { clamp, safeText, uid, mulberry32 } from "../../lib/util.mjs";
import { manifest } from "./manifest.mjs";

// 兵种克制链：前者克制后者（环形）。
export const TROOP_TREE = [
  { id: "spear", name: "枪兵", atk: 9, r: 7, color: "#22c55e" },
  { id: "rider", name: "骑兵", atk: 13, r: 9, color: "#38bdf8" },
  { id: "shield", name: "盾兵", atk: 8, r: 9, color: "#a78bfa" },
  { id: "archer", name: "弓兵", atk: 15, r: 7, color: "#facc15" },
  { id: "chariot", name: "战车", atk: 22, r: 12, color: "#f97316" },
  { id: "elephant", name: "象兵", atk: 30, r: 14, color: "#14b8a6" },
  { id: "tiger", name: "白虎", atk: 46, r: 17, color: "#e2e8f0" },
];
const TROOP_THRESHOLDS = [0, 800, 2600, 6500, 14000, 28000, 52000];

const TEAM_META = {
  shu: { id: "shu", name: "蜀国", color: "#22c55e", light: "#86efac" },
  wu: { id: "wu", name: "吴国", color: "#f59e0b", light: "#fcd34d" },
  wei: { id: "wei", name: "魏国", color: "#3b82f6", light: "#93c5fd" },
};
const TEAM_IDS = ["shu", "wu", "wei"];

function kindIndexForHeat(heat) {
  let index = 0;
  for (let i = 0; i < TROOP_THRESHOLDS.length; i += 1) if (heat >= TROOP_THRESHOLDS[i]) index = i;
  return index;
}

function parseFaction(rawText) {
  const text = normalizeText(rawText);
  if (!text) return "";
  if (text.includes("蜀") || text.includes("shu")) return "shu";
  if (text.includes("吴") || text.includes("wu")) return "wu";
  if (text.includes("魏") || text.includes("wei")) return "wei";
  const m = text.match(/^(扣|发|打|加入|搬)?([123])$/);
  if (m) return m[2] === "1" ? "shu" : m[2] === "2" ? "wu" : "wei";
  return "";
}

export class ThreeKingdomsSimulation extends SimBase {
  constructor(args = {}) {
    super({ manifest, prepareMs: 5000, settleMs: 7000, ...args });
    if (this.gameId !== manifest.id) throw new Error(`未知玩法：${this.gameId}`);
    this.teams = this._freshTeams();
    this.units = [];
    this._unitSeq = 0;
    this._spawnAccum = { shu: 0, wu: 0, wei: 0 };
    this.wins = { shu: 0, wu: 0, wei: 0 };
    this._rand = mulberry32(0x3a1);
  }

  _freshTeams() {
    const out = {};
    for (const id of TEAM_IDS) {
      out[id] = {
        id, name: TEAM_META[id].name, color: TEAM_META[id].color, light: TEAM_META[id].light,
        members: 0, heat: 0, troops: 0, baseTroops: 0, power: 0, pct: 0, kindIndex: 0, kindName: TROOP_TREE[0].name,
      };
    }
    return out;
  }

  _applyOptions() { this._roundTroopsTarget = null; }

  _resetField() {
    const base = clamp(Number(this.options.baseTroops) || 32000, 5000, 80000);
    for (const id of TEAM_IDS) {
      this.teams[id].baseTroops = base;
      this.teams[id].troops = base + this.teams[id].heat * (Number(this.options.giftTroops) || 12);
    }
    this.units = [];
    this._spawnAccum = { shu: 0, wu: 0, wei: 0 };
    this._refreshTeams();
  }

  _nameOf(id) { return TEAM_META[id]?.name || ""; }
  _leaderName() { return this._nameOf(this._leader()); }

  _leader() {
    let best = TEAM_IDS[0];
    for (const id of TEAM_IDS) if (this.teams[id].troops > this.teams[best].troops) best = id;
    return best;
  }

  _settle(now, winner, reason, rewardTower) {
    if (this.cycle.status !== "settled" && winner && this.wins[winner] != null) this.wins[winner] += 1;
    super._settle(now, winner, reason, rewardTower);
  }

  _settleResult() {
    return {
      troops: Object.fromEntries(TEAM_IDS.map((id) => [id, Math.round(this.teams[id].troops)])),
      score: { ...this.wins },
    };
  }

  _spawnInterval(id) {
    const members = this.teams[id].members;
    const tier = this.teams[id].kindIndex;
    return Math.max(520, 1700 - Math.min(30, members) * 30 - tier * 120);
  }

  _spawnUnit(id, now) {
    const team = this.teams[id];
    const kindIndex = team.kindIndex;
    const kind = TROOP_TREE[clamp(kindIndex, 0, TROOP_TREE.length - 1)];
    const y = 0.28 + this._rand() * 0.44;
    const side = id === "shu" ? 0.06 : id === "wu" ? 0.94 : 0.5;
    const unit = {
      id: `t${(this._unitSeq += 1)}`, team: id, kindIndex, kind: kind.id, x: side, y,
      hp: 60 + kindIndex * 30, maxHp: 60 + kindIndex * 30, atk: kind.atk, r: kind.r,
      dir: side < 0.5 ? 1 : -1, bornAt: now,
    };
    this.units.push(unit);
    return unit;
  }

  _refreshTeams() {
    let total = 0;
    for (const id of TEAM_IDS) {
      const t = this.teams[id];
      t.members = this.ledger.memberCount(id);
      t.heat = this.ledger.teamHeat(id);
      t.kindIndex = kindIndexForHeat(t.heat);
      t.kindName = TROOP_TREE[t.kindIndex].name;
      t.troops = Math.max(0, t.troops);
      t.power = Math.round(t.troops);
      total += t.troops;
    }
    for (const id of TEAM_IDS) {
      const t = this.teams[id];
      t.pct = total > 0 ? Math.round((t.troops / total) * 100) : Math.round(100 / TEAM_IDS.length);
    }
  }

  _advance(now, dt) {
    for (const id of TEAM_IDS) {
      if (this.teams[id].troops <= 0) continue;
      const interval = this._spawnInterval(id);
      this._spawnAccum[id] += dt * 1000;
      if (this._spawnAccum[id] >= interval) {
        this._spawnAccum[id] -= interval;
        const count = this.units.filter((u) => u.team === id).length;
        if (count < 90) this._spawnUnit(id, now);
      }
    }
    for (const unit of this.units) {
      unit.x += unit.dir * 0.05 * dt;
      if (unit.x < 0.04) unit.x = 0.04;
      if (unit.x > 0.96) unit.x = 0.96;
    }
    const counterFactor = Number(this.options.counterFactor) || 1.5;
    for (const unit of [...this.units]) {
      const reached = unit.team === "wei" ? Math.abs(unit.x - 0.5) <= 0.06 : (unit.team === "shu" ? unit.x >= 0.46 : unit.x <= 0.54);
      if (!reached) continue;
      const targets = TEAM_IDS.filter((id) => id !== unit.team && this.teams[id].troops > 0);
      if (targets.length === 0) continue;
      targets.sort((a, b) => this.teams[b].troops - this.teams[a].troops);
      const target = this.teams[targets[0]];
      const attacker = this.teams[unit.team];
      const counters = (attacker.kindIndex + 1) % TROOP_TREE.length === target.kindIndex;
      const dmg = unit.atk * (counters ? counterFactor : 1) * 8;
      target.troops = Math.max(0, target.troops - dmg);
      unit.hp -= 20;
      if (unit.hp <= 0) this.units.splice(this.units.indexOf(unit), 1);
    }
    this._refreshTeams();
    const alive = TEAM_IDS.filter((id) => this.teams[id].troops > 0);
    if (alive.length === 1) return { winner: alive[0], reason: "conquest" };
    return null;
  }

  _onEvent(event, account, now) {
    const effects = [];
    const type = event.type;
    if (type === "gift") {
      const totalHeat = Math.max(0, Number(event.totalHeat) || Number(event.gift?.heat) * (Number(event.count) || 1));
      const team = this._assignTeam(account);
      const before = this.teams[team].kindIndex;
      const result = this.ledger.gift(account, totalHeat, Number(event.count) || 1, now);
      const giftTroops = Number(this.options.giftTroops) || 12;
      this.teams[team].troops += totalHeat * giftTroops * 3;
      this._refreshTeams();
      const after = this.teams[team].kindIndex;
      effects.push({ type: "gift-burst", id: uid("fx"), ts: now, team, gift: event.gift, amount: totalHeat, text: `${account.name} 送出 ${event.gift?.name || "礼物"} ×${Number(event.count) || 1}，${this.teams[team].name} +${Math.round(totalHeat * giftTroops * 3)} 兵力` });
      if (result.firstGift) effects.push({ type: "first-gift", id: uid("fx"), ts: now, team, text: "首送盲盒触发 · 空投精锐" });
      if (after > before) effects.push({ type: "levelup", id: uid("fx"), ts: now, team, level: after, text: `${this.teams[team].name} 进化：${TROOP_TREE[after].name}` });
      if (event.gift?.id === "rocket" || event.gift?.id === "carnival") {
        this._summonTiger(team, now);
        effects.push({ type: "summon", id: uid("fx"), ts: now, team, text: `${this.teams[team].name} 召唤白虎 · 全军突击` });
      }
    } else if (type === "comment") {
      const cmd = parseCommand(event.text);
      if (cmd?.kind === "cheer") {
        const team = this._assignTeam(account);
        this.ledger.cheer(account, cmd.power);
        this.combo = Math.min(99, this.combo + Math.max(1, Math.round(cmd.power * 2)));
        this._refreshTeams();
        effects.push({ type: "cheer", id: uid("fx"), ts: now, team, text: `${this.teams[team].name} 获得助威 · 士气大振` });
      } else {
        const faction = parseFaction(event.text);
        if (faction) {
          this.ledger.join(account, faction, now);
          this._refreshTeams();
          this._spawnUnit(faction, now);
          effects.push({ type: "join", id: uid("fx"), ts: now, team: faction, text: `${account.name} 加入${this.teams[faction].name}` });
        }
      }
    } else if (type === "like") {
      const team = this._assignTeam(account);
      const count = Number(event.count) || 1;
      this.teams[team].troops += count * 60;
      this.beats += count;
      this._refreshTeams();
      effects.push({ type: "like-wave", id: uid("fx"), ts: now, team, count, text: `${this.teams[team].name} 点赞增援` });
    } else if (type === "follow") {
      const team = this._assignTeam(account);
      this.ledger.join(account, team, now);
      this.teams[team].troops += 1000;
      this._refreshTeams();
      this._spawnUnit(team, now);
      effects.push({ type: "follow-spark", id: uid("fx"), ts: now, team, text: `${account.name} 关注 · 为${this.teams[team].name} +1000 兵力` });
    } else if (type === "enter") {
      effects.push({ type: "enter-orbit", id: uid("fx"), ts: now, text: `${account.name} 进入直播间` });
    }
    return effects;
  }

  _summonTiger(team, now) {
    const tiger = TROOP_TREE[TROOP_TREE.length - 1];
    const side = team === "shu" ? 0.06 : team === "wu" ? 0.94 : 0.5;
    this.units.push({
      id: `t${(this._unitSeq += 1)}`, team, kindIndex: TROOP_TREE.length - 1, kind: tiger.id,
      x: side, y: 0.5, hp: 320, maxHp: 320, atk: tiger.atk, r: tiger.r,
      dir: side < 0.5 ? 1 : -1, bornAt: now,
    });
  }
  _assignTeam(account) {
    if (account.team && TEAM_META[account.team]) return account.team;
    const counts = TEAM_IDS.map((id) => [id, this.ledger.memberCount(id)]);
    counts.sort((a, b) => a[1] - b[1]);
    const team = counts[0][0];
    this.ledger.join(account, team);
    return team;
  }

  _snapshotExtra(now = Date.now()) {
    const teams = TEAM_IDS.map((id) => {
      const t = this.teams[id];
      return {
        id, name: t.name, color: t.color, light: t.light, members: t.members, heat: t.heat,
        troops: Math.round(t.troops), power: t.power, pct: t.pct, kindIndex: t.kindIndex, kindName: t.kindName,
      };
    });
    const units = this.units.slice(0, 200).map((u) => ({
      id: u.id, team: u.team, kind: u.kind, kindIndex: u.kindIndex,
      x: Math.round(u.x * 1000) / 1000, y: Math.round(u.y * 1000) / 1000,
      hp: Math.round(u.hp), maxHp: u.maxHp, r: u.r, dir: u.dir,
    }));
    const countdownMs = this.cycle.phase === "battle" ? Math.max(0, this.cycle.battleEndsAt - now) : 0;
    return {
      teams,
      units,
      hud: {
        layout: "lanes",
        pools: this.ledger.snapshot(),
        countdownMs,
        phase: this.cycle.phase,
        leader: this._leader(),
        counterChain: TROOP_TREE.map((t) => t.name),
        score: { ...this.wins },
      },
      top: { score: { ...this.wins }, teams },
    };
  }
}

export function createSimulation(args = {}) {
  return new ThreeKingdomsSimulation(args);
}

export default createSimulation;