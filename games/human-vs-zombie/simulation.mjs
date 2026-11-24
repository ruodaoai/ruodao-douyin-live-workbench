// 人类 VS 丧尸 · 权威模拟（Node 端唯一真相）。
// 20Hz 固定步长的推进由 tick(dt) 完成；overlay 只做插值渲染，不参与胜负判定。
import { RoundCycle } from "../../lib/core/room.mjs";
import { Ledger } from "../../lib/core/ledger.mjs";
import { parseCommand } from "../../lib/core/commands.mjs";
import { clamp, safeText, uid, mulberry32, hashSeed } from "../../lib/util.mjs";
import { manifest } from "./manifest.mjs";

export const KIND_TREE = [
  { id: "scout", name: "冲锋兵", hp: 70, atk: 7, r: 6, color: "#7dd3fc" },
  { id: "special", name: "特种兵", hp: 130, atk: 13, r: 8, color: "#38bdf8" },
  { id: "cleaver", name: "菜刀屠夫", hp: 230, atk: 23, r: 10, color: "#22d3ee" },
  { id: "gunner", name: "机枪手", hp: 330, atk: 35, r: 11, color: "#a78bfa" },
  { id: "tank", name: "装甲车", hp: 540, atk: 50, r: 14, color: "#818cf8" },
  { id: "mech", name: "机甲战士", hp: 820, atk: 72, r: 16, color: "#f472b6" },
  { id: "titan", name: "泰坦", hp: 1250, atk: 105, r: 19, color: "#fb7185" },
  { id: "demon", name: "无敌邪神", hp: 2100, atk: 165, r: 24, color: "#ef4444" },
];

export const KIND_THRESHOLDS = [0, 300, 1200, 3500, 8000, 16000, 32000, 60000];

const TEAM_META = {
  human: { id: "human", name: "人类阵营", color: "#38bdf8", base: "#0ea5e9" },
  zombie: { id: "zombie", name: "丧尸阵营", color: "#f43f5e", base: "#e11d48" },
};

const BASE_MAX_HP = 1000;
const LANES = [0.28, 0.5, 0.72];
const ROUND_EFFECT_CAP = 48;

function kindIndexForHeat(heat) {
  let index = 0;
  for (let i = 0; i < KIND_THRESHOLDS.length; i += 1) if (heat >= KIND_THRESHOLDS[i]) index = i;
  return index;
}

export class HumanVsZombieSimulation {
  constructor({ gameId = manifest.id, options = {}, seed = "", now = Date.now() } = {}) {
    if (gameId !== manifest.id) throw new Error(`未知玩法：${gameId}`);
    this.gameId = manifest.id;
    this.game = manifest;
    this.options = { ...manifest.defaults };
    this.seedText = String(seed || "");
    this.random = mulberry32(hashSeed(this.seedText || Math.random().toString(36)));
    this.ledger = new Ledger({ towerBonusPct: manifest.defaults.towerBonusPct });
    this.isRunning = false;
    this.createdAt = now;
    this.lastTickAt = now;
    this.cycle = new RoundCycle({
      roundDurationMs: manifest.defaults.roundSeconds * 1000,
      prepareMs: 5000,
      settleMs: 7000,
    });
    this.teams = this._freshTeams();
    this.units = [];
    this.effects = [];
    this.effectCount = 0;
    this.combo = 0;
    this.beats = 0;
    this._beatAccum = 0;
    this._spawnAccum = { human: 0, zombie: 0 };
    this._cheerBoost = { human: 0, zombie: 0 };
    this._unitSeq = 0;
    this.round = this.cycle.info(now);
    this.setOptions(options);
  }

  get users() {
    return this.ledger.users;
  }

  _freshTeams() {
    const out = {};
    for (const id of ["human", "zombie"]) {
      const meta = TEAM_META[id];
      out[id] = {
        id,
        name: meta.name,
        color: meta.color,
        baseColor: meta.base,
        baseHp: BASE_MAX_HP,
        baseMaxHp: BASE_MAX_HP,
        members: 0,
        heat: 0,
        power: 0,
        kindIndex: 0,
        kindName: KIND_TREE[0].name,
      };
    }
    return out;
  }

  setOptions(options = {}) {
    this.options = { ...this.options, ...options };
    this.cycle.roundDurationMs = clamp(Number(this.options.roundSeconds) || 120, 30, 300) * 1000;
    this.maxUnitsPerSide = clamp(Number(this.options.maxUnitsPerSide) || 80, 20, 120);
    this.pushFactor = clamp(Number(this.options.pushFactor) || 1, 0.2, 3);
    this.ledger.towerBonusPct = clamp(Number(this.options.towerBonusPct) || 0, 0, 100);
  }

  start(now = Date.now()) {
    this.isRunning = true;
    this.cycle.start(now);
    this._resetField();
    this.round = this.cycle.info(now);
    this._push({ type: "phase", text: "第 1 回合开始 · 扣1人类 扣2丧尸", ts: now });
    return this.round;
  }

  stop(now = Date.now(), reason = "manual") {
    if (!this.isRunning) return;
    if (this.cycle.status !== "settled") {
      this._settle(now, this._leader(), reason, true);
    }
    this.isRunning = false;
  }

  _resetField() {
    this.units = [];
    this._spawnAccum = { human: 0, zombie: 0 };
    this._cheerBoost = { human: 0, zombie: 0 };
    for (const id of ["human", "zombie"]) {
      this.teams[id].baseHp = BASE_MAX_HP;
      this.teams[id].baseMaxHp = BASE_MAX_HP;
    }
  }

  startRound(now = Date.now()) {
    if (!this.isRunning) throw new Error("当前没有进行中的直播");
    this._resetField();
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

  _leader() {
    if (this.teams.human.baseHp === this.teams.zombie.baseHp) {
      return this.teams.human.power >= this.teams.zombie.power ? "human" : "zombie";
    }
    return this.teams.human.baseHp > this.teams.zombie.baseHp ? "human" : "zombie";
  }

  _settle(now, winner, reason, rewardTower) {
    const breakBase = Boolean(rewardTower) || reason === "base-destroyed";
    const reward = breakBase ? this.ledger.towerBreak(now) : Math.round(this.ledger.pools.tower * 0.2);
    const winnerName = this.teams[winner]?.name || "平局";
    this.cycle.settle(now, winner, reason, {
      reward,
      result: {
        humanBaseHp: Math.round(this.teams.human.baseHp),
        zombieBaseHp: Math.round(this.teams.zombie.baseHp),
        humanPower: Math.round(this.teams.human.power),
        zombiePower: Math.round(this.teams.zombie.power),
      },
    });
    this.round = this.cycle.info(now);
    this.ledger.awardStreak(1);
    this._push({
      type: "win",
      id: uid("fx"),
      ts: now,
      team: winner,
      text: `${winnerName} 摧毁对方基地 · 拿下第 ${this.cycle.index} 回合`,
      reward,
    });
  }

  tick(now = Date.now()) {
    const effectsBefore = this.effectCount;
    const dt = clamp((now - this.lastTickAt) / 1000, 0, 0.5);
    this.lastTickAt = now;
    if (!this.isRunning) return { changed: false, effects: [] };

    const { events } = this.cycle.tick(now);
    for (const event of events) {
      if (event.type === "phase" && event.phase === "battle") {
        this._push({ type: "phase", text: `第 ${event.index} 回合 · 对战开始`, ts: now });
      }
      if (event.type === "phase" && event.phase === "prepare") {
        this._resetField();
        this._push({ type: "phase", text: `第 ${event.index} 回合准备`, ts: now });
      }
      if (event.type === "battle-timeout") {
        if (this.cycle.status !== "settled") this._settle(now, this._leader(), "timeout", false);
      }
    }

    if (this.cycle.phase === "battle" && this.cycle.status === "running") {
      this._advance(now, dt);
      if (this.teams.zombie.baseHp <= 0) this._settle(now, "human", "base-destroyed", true);
      else if (this.teams.human.baseHp <= 0) this._settle(now, "zombie", "base-destroyed", true);
    }

    this.round = this.cycle.info(now);
    this._refreshTeams();
    const changed = this.effectCount !== effectsBefore || this.cycle.phase === "battle";
    return { changed, effects: this.effects.slice(-12) };
  }

  _advance(now, dt) {
    this._beatAccum += dt;
    while (this._beatAccum >= 1) { this._beatAccum -= 1; this.beats += 1; }

    // 助威推力随时间衰减
    this._cheerBoost.human = Math.max(0, this._cheerBoost.human - dt * 0.6);
    this._cheerBoost.zombie = Math.max(0, this._cheerBoost.zombie - dt * 0.6);
    if (this.combo > 0) this.combo = Math.max(0, this.combo - dt * 2);

    // 出兵
    for (const id of ["human", "zombie"]) {
      const interval = this._spawnInterval(id);
      this._spawnAccum[id] += dt * 1000;
      if (this._spawnAccum[id] >= interval) {
        this._spawnAccum[id] -= interval;
        const count = this.units.filter((u) => u.team === id).length;
        if (count < this.maxUnitsPerSide) this._spawnUnit(id, now);
      }
    }

    // 移动 + 交战
    const humans = this.units.filter((u) => u.team === "human");
    const zombies = this.units.filter((u) => u.team === "zombie");
    for (const unit of this.units) {
      const dir = unit.team === "human" ? 1 : -1;
      const boost = 1 + this._cheerBoost[unit.team] * this.pushFactor * 0.35;
      unit.x += dir * unit.speed * boost * dt;
    }
    this._resolveCombat(humans, zombies, dt);

    // 抵达基地造成伤害
    for (const unit of [...this.units]) {
      if (unit.team === "human" && unit.x >= 0.94) {
        this.teams.zombie.baseHp -= unit.atk * 2.4;
        this._removeUnit(unit.id);
        this._push({ type: "base-hit", id: uid("fx"), ts: now, team: "human", text: "人类突破丧尸基地" });
      } else if (unit.team === "zombie" && unit.x <= 0.06) {
        this.teams.human.baseHp -= unit.atk * 2.4;
        this._removeUnit(unit.id);
        this._push({ type: "base-hit", id: uid("fx"), ts: now, team: "zombie", text: "丧尸攻入人类基地" });
      }
    }
    this.teams.human.baseHp = Math.max(0, this.teams.human.baseHp);
    this.teams.zombie.baseHp = Math.max(0, this.teams.zombie.baseHp);
  }

  _spawnInterval(teamId) {
    const members = this.ledger.memberCount(teamId);
    const tier = this.teams[teamId].kindIndex;
    return Math.max(480, 1600 - Math.min(30, members) * 34 - tier * 130);
  }

  _spawnUnit(teamId, now, kindIndexOverride = null) {
    const kindIndex = kindIndexOverride ?? this.teams[teamId].kindIndex;
    const kind = KIND_TREE[clamp(kindIndex, 0, KIND_TREE.length - 1)];
    const lane = LANES[Math.floor(this.random() * LANES.length)];
    const laneIndex = LANES.indexOf(lane);
    const baseX = teamId === "human" ? 0.1 : 0.9;
    const jitter = (this.random() - 0.5) * 0.03;
    const unit = {
      id: `u${(this._unitSeq += 1)}`,
      team: teamId,
      kindIndex,
      kind: kind.id,
      lane: laneIndex,
      x: clamp(baseX + jitter, 0.03, 0.97),
      y: lane,
      hp: kind.hp,
      maxHp: kind.hp,
      atk: kind.atk,
      speed: 0.055 + this.random() * 0.02 + kindIndex * 0.004,
      r: kind.r,
      bornAt: now,
    };
    this.units.push(unit);
    return unit;
  }

  _removeUnit(id) {
    const index = this.units.findIndex((u) => u.id === id);
    if (index >= 0) this.units.splice(index, 1);
  }

  _resolveCombat(humans, zombies, dt) {
    // 每条兵线内按 x 排序，只和最近的敌方单位交战
    for (let lane = 0; lane < 3; lane += 1) {
      const laneHumans = humans.filter((u) => u.lane === lane);
      const laneZombies = zombies.filter((u) => u.lane === lane);
      if (laneHumans.length === 0 || laneZombies.length === 0) continue;
      for (const hunit of laneHumans) {
        let target = null;
        let best = Infinity;
        for (const zunit of laneZombies) {
          const dx = Math.abs(zunit.x - hunit.x);
          if (dx < best) { best = dx; target = zunit; }
        }
        if (target && best <= 0.045) {
          target.hp -= hunit.atk * dt * 1.2;
          hunit.hp -= target.atk * dt * 1.2;
        }
      }
      for (const unit of [...laneHumans, ...laneZombies]) {
        if (unit.hp <= 0) this._removeUnit(unit.id);
      }
    }
  }

  _refreshTeams() {
    for (const id of ["human", "zombie"]) {
      const team = this.teams[id];
      team.members = this.ledger.memberCount(id);
      team.heat = this.ledger.teamHeat(id);
      team.kindIndex = kindIndexForHeat(team.heat);
      team.kindName = KIND_TREE[team.kindIndex].name;
      const unitHp = this.units.reduce((sum, u) => (u.team === id ? sum + u.hp : sum), 0);
      team.power = Math.round(team.baseHp * 2 + unitHp * 0.6 + team.heat * 0.4 + team.members * 25);
    }
    const total = this.teams.human.power + this.teams.zombie.power || 1;
    this.teams.human.pct = Math.round((this.teams.human.power / total) * 100);
    this.teams.zombie.pct = 100 - this.teams.human.pct;
  }

  _assignTeam(account) {
    if (account.team) return account.team;
    const human = this.ledger.memberCount("human");
    const zombie = this.ledger.memberCount("zombie");
    const team = human <= zombie ? "human" : "zombie";
    this.ledger.join(account, team);
    return team;
  }

  apply(event, now = Date.now()) {
    const effects = [];
    if (!event || !event.type) return { effects };
    const account = this.ledger.user(event.user?.id || event.user?.name, event.user?.name);

    if (event.type === "gift") {
      const totalHeat = Math.max(0, Number(event.totalHeat) || Number(event.gift?.heat) * (Number(event.count) || 1));
      const team = this._assignTeam(account);
      const before = this.teams[team].kindIndex;
      const result = this.ledger.gift(account, totalHeat, Number(event.count) || 1, now);
      this._refreshTeams();
      const teamHit = this._cheerBoost[team];
      this._cheerBoost[team] = Math.min(6, teamHit + Math.min(3, totalHeat / 500));
      const kindAfter = this.teams[team].kindIndex;
      effects.push({
        type: "gift-burst",
        id: uid("fx"),
        ts: now,
        team,
        gift: event.gift,
        amount: totalHeat,
        text: `${account.name} 送出 ${event.gift?.name || "礼物"} ×${Number(event.count) || 1}，${this.teams[team].name} +${Math.round(totalHeat)} 战力`,
      });
      if (result.firstGift) effects.push({ type: "first-gift", id: uid("fx"), ts: now, team, text: "首送盲盒触发 · 空投精英单位" });
      if (result.firstGift) this._spawnUnit(team, now, Math.min(KIND_TREE.length - 1, this.teams[team].kindIndex + 1));
      if (kindAfter > before) effects.push({ type: "levelup", id: uid("fx"), ts: now, team, level: kindAfter, text: `${this.teams[team].name} 进化：${KIND_TREE[kindAfter].name}` });
      if (event.gift?.id === "rocket" || event.gift?.id === "carnival") effects.push({ type: "supernova", id: uid("fx"), ts: now, team, text: "超级火力支援" });
    } else if (event.type === "comment") {
      const cmd = parseCommand(event.text);
      const team = this._assignTeam(account);
      if (cmd?.kind === "join") {
        this.ledger.join(account, cmd.team, now);
        this._spawnUnit(cmd.team, now, 0);
        effects.push({ type: "join", id: uid("fx"), ts: now, team: cmd.team, text: `${account.name} 加入${this.teams[cmd.team].name}` });
      } else if (cmd?.kind === "cheer") {
        this.ledger.cheer(account, cmd.power);
        this.combo = Math.min(99, this.combo + Math.max(1, Math.round(cmd.power * 2)));
        this._cheerBoost[team] = Math.min(8, this._cheerBoost[team] + cmd.power * this.pushFactor);
        effects.push({ type: "cheer", id: uid("fx"), ts: now, team, power: cmd.power, text: `${this.teams[team].name} 获得助威推力` });
      } else if (cmd?.kind === "vote") {
        this.ledger.cheer(account, 1);
        this._cheerBoost[team] = Math.min(8, this._cheerBoost[team] + 0.6 * this.pushFactor);
        effects.push({ type: "cheer", id: uid("fx"), ts: now, team, text: `弹幕应援：${cmd.region}` });
      } else {
        effects.push({ type: "ai-react", id: uid("fx"), ts: now, text: `弹幕：${safeText(event.text, 40)}` });
      }
    } else if (event.type === "like") {
      const team = this._assignTeam(account);
      this.ledger.cheer(account, 1);
      this._cheerBoost[team] = Math.min(8, this._cheerBoost[team] + Math.min(1, (Number(event.count) || 1) / 50));
      effects.push({ type: "like-wave", id: uid("fx"), ts: now, team, count: Number(event.count) || 1, text: "点赞加速出兵" });
    } else if (event.type === "follow") {
      const team = this._assignTeam(account);
      this.ledger.join(account, team, now);
      this._spawnUnit(team, now, 0);
      effects.push({ type: "follow-spark", id: uid("fx"), ts: now, team, text: `${account.name} 关注成为冲锋兵` });
    } else if (event.type === "enter") {
      effects.push({ type: "enter-orbit", id: uid("fx"), ts: now, text: `${account.name} 进入直播间` });
    }

    for (const effect of effects) this._push(effect);
    this._refreshTeams();
    return { effects };
  }

  _push(effect) {
    this.effects.push(effect);
    this.effectCount += 1;
    if (this.effects.length > ROUND_EFFECT_CAP) this.effects.splice(0, this.effects.length - ROUND_EFFECT_CAP);
  }

  snapshot(now = Date.now()) {
    this._refreshTeams();
    const round = this.cycle.info(now);
    const countdownMs = this.cycle.phase === "battle" ? Math.max(0, this.cycle.battleEndsAt - now) : 0;
    const level = Math.max(this.teams.human.kindIndex, this.teams.zombie.kindIndex);
    const totalHeat = Math.round(this.ledger.pools.score);
    const leaderboard = this.ledger.leaderboard(10);
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
      teams: ["human", "zombie"].map((id) => {
        const team = this.teams[id];
        return {
          id,
          name: team.name,
          color: team.color,
          power: team.power,
          pct: team.pct,
          members: team.members,
          heat: team.heat,
          baseHp: Math.round(team.baseHp),
          baseMaxHp: team.baseMaxHp,
          kindIndex: team.kindIndex,
          kindName: team.kindName,
        };
      }),
      hud: {
        pools: this.ledger.snapshot(),
        countdownMs,
        phase: this.cycle.phase,
        tree: { human: this.teams.human.kindIndex, zombie: this.teams.zombie.kindIndex },
        combo: Math.round(this.combo),
        beats: this.beats,
      },
      leaderboard,
      topUsers: leaderboard,
      units: this.units.slice(0, 260).map((u) => ({
        id: u.id,
        team: u.team,
        kind: u.kind,
        x: Number(u.x.toFixed(4)),
        y: u.y,
        hp: Math.round(u.hp),
        maxHp: u.maxHp,
        level: u.kindIndex,
        r: u.r,
      })),
      totalHeat,
      energy: this.teams.human.pct,
      combo: Math.round(this.combo),
      beats: this.beats,
      level,
      levelName: KIND_TREE[level].name,
      ai: { score: 0, text: "" },
      duel: {},
      effects: this.effects.slice(-16),
      recentEffects: this.effects.slice(-16),
      effectCount: this.effectCount,
    };
  }
}

export function createSimulation(args) {
  return new HumanVsZombieSimulation(args);
}

export default createSimulation;