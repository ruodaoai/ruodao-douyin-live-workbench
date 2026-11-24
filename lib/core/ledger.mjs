// 贡献账本：账户、阵营归属、礼物热度、积分池 / 连胜池 / 破塔奖池与贡献榜。
// 这里只做“可审计的记账”，战场推进与胜负由玩法模拟负责。

export const DEFAULT_TIER_THRESHOLDS = [0, 60, 200, 600, 1500, 4000];

export class Ledger {
  constructor({ towerBonusPct = 30, tierThresholds = DEFAULT_TIER_THRESHOLDS } = {}) {
    this.users = new Map();
    this.towerBonusPct = Math.max(0, Math.min(100, Number(towerBonusPct) || 0));
    this.tierThresholds = Array.isArray(tierThresholds) ? tierThresholds : DEFAULT_TIER_THRESHOLDS;
    this.pools = { score: 0, streak: 0, tower: 5000 };
    this.lastTowerAt = 0;
    this.towerBreaks = 0;
  }

  user(id, name) {
    const key = String(id || "") || `guest_${String(name || "nobody")}`;
    let account = this.users.get(key);
    if (!account) {
      account = {
        id: key,
        name: String(name || "神秘观众").slice(0, 32),
        team: null,
        heat: 0,
        gifts: 0,
        cheers: 0,
        joins: 0,
        firstGiftAt: 0,
        joinedAt: 0,
        lastAt: 0,
      };
      this.users.set(key, account);
    } else if (name) {
      account.name = String(name).slice(0, 32);
    }
    account.lastAt = Date.now();
    return account;
  }

  join(account, team, now = Date.now()) {
    if (!account) return false;
    const changed = account.team !== team;
    account.team = team;
    account.joins += 1;
    if (!account.joinedAt) account.joinedAt = now;
    return changed;
  }

  tierOf(heat) {
    const value = Number(heat) || 0;
    let tier = 0;
    for (let index = 0; index < this.tierThresholds.length; index += 1) {
      if (value >= this.tierThresholds[index]) tier = index;
    }
    return tier;
  }

  /** 记一笔礼物，返回 { tier, tierUp, firstGift, heat } */
  gift(account, heat, count = 1, now = Date.now()) {
    const amount = Math.max(0, Number(heat) || 0);
    const tierBefore = this.tierOf(account.heat);
    const firstGift = account.gifts === 0;
    account.heat += amount;
    account.gifts += Math.max(1, Number(count) || 1);
    account.lastAt = now;
    if (!account.firstGiftAt) account.firstGiftAt = now;
    this.pools.score += amount;
    this.pools.streak += amount * 0.04;
    this.pools.tower += amount * 0.02;
    const tier = this.tierOf(account.heat);
    return { heat: amount, tier, tierUp: tier > tierBefore, firstGift };
  }

  cheer(account, amount = 1) {
    if (account) account.cheers += Math.max(0, Number(amount) || 0);
  }

  /** 破塔奖励：按奖池百分比追加，返回本次奖励数额 */
  towerBreak(now = Date.now()) {
    const bonus = Math.round(this.pools.tower * (this.towerBonusPct / 100));
    this.pools.tower += bonus;
    this.lastTowerAt = now;
    this.towerBreaks += 1;
    return bonus;
  }

  awardStreak(streak) {
    this.pools.streak += Math.max(0, Number(streak) || 0) * 300;
  }

  members(team) {
    const rows = [];
    for (const account of this.users.values()) if (account.team === team) rows.push(account);
    return rows;
  }

  memberCount(team) {
    return this.members(team).length;
  }

  contributors(limit = 10) {
    return [...this.users.values()]
      .filter((account) => account.heat > 0 || account.gifts > 0)
      .sort((a, b) => b.heat - a.heat || b.gifts - a.gifts)
      .slice(0, limit);
  }

  leaderboard(limit = 10) {
    return this.contributors(limit).map((account, index) => ({
      rank: index + 1,
      id: account.id,
      name: account.name,
      team: account.team,
      heat: Math.round(account.heat),
      gifts: account.gifts,
      tier: this.tierOf(account.heat),
    }));
  }

  teamHeat(team) {
    let total = 0;
    for (const account of this.users.values()) if (account.team === team) total += account.heat;
    return Math.round(total);
  }

  snapshot() {
    return {
      score: Math.round(this.pools.score),
      streak: Math.round(this.pools.streak),
      tower: Math.round(this.pools.tower),
      towerBonusPct: this.towerBonusPct,
      towerBreaks: this.towerBreaks,
    };
  }
}