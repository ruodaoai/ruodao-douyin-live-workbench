// 最美家乡选拔赛 · 权威模拟（Node 端唯一真相）。
// 评论「加省份」投票、点赞/666 加速、礼物成倍加票；省份票数实时排行，回合末最高票夺冠。
import { SimBase } from "../../lib/core/sim-base.mjs";
import { parseCommand } from "../../lib/core/commands.mjs";
import { uid, clamp, safeText, mulberry32 } from "../../lib/util.mjs";
import { manifest } from "./manifest.mjs";

const PROVINCES = [
  "广东", "浙江", "江苏", "云南", "上海", "青海", "重庆", "贵州", "河南", "天津",
  "福建", "四川", "黑龙江", "湖北", "北京", "河北", "江西", "山东", "海南", "安徽",
  "湖南", "甘肃", "山西", "陕西", "辽宁", "吉林", "广西", "新疆", "内蒙古", "宁夏",
  "西藏", "香港", "澳门", "台湾",
];
const ALIAS = {
  内蒙: "内蒙古", 黑: "黑龙江", 桂: "广西", 琼: "海南", 黔: "贵州", 滇: "云南",
  豫: "河南", 鄂: "湖北", 湘: "湖南", 赣: "江西", 皖: "安徽", 闽: "福建",
  粤: "广东", 苏: "江苏", 浙: "浙江", 川: "四川", 蜀: "四川", 渝: "重庆",
  沪: "上海", 京: "北京", 津: "天津", 冀: "河北", 晋: "山西", 陕: "陕西",
  甘: "甘肃", 宁: "宁夏", 新: "新疆", 藏: "西藏", 辽: "辽宁", 吉: "吉林",
};

function normProvince(raw) {
  let text = safeText(raw, 12).replace(/省|市|自治区|特别行政区/g, "").trim();
  if (!text) return "";
  if (PROVINCES.includes(text)) return text;
  if (ALIAS[text]) return ALIAS[text];
  for (const name of PROVINCES) if (text.includes(name)) return name;
  for (const [k, v] of Object.entries(ALIAS)) if (text.includes(k)) return v;
  return "";
}

export class HometownVoteSimulation extends SimBase {
  constructor(args = {}) {
    super({ manifest, prepareMs: 4000, settleMs: 7000, ...args });
    if (this.gameId !== manifest.id) throw new Error(`未知玩法：${this.gameId}`);
    this.provinces = new Map();
    this._userProvince = new Map();
    this._seedBoard();
  }

  _map() {
    return PROVINCES.map((name) => {
      let p = this.provinces.get(name);
      if (!p) { p = { name, votes: 0, boost: 1, supporters: new Set() }; this.provinces.set(name, p); }
      return p;
    });
  }

  _seedBoard() {
    const rand = mulberry32(20261110);
    const top = 968_000_000;
    let factor = 1;
    for (const name of PROVINCES) {
      factor *= 0.82 + rand() * 0.05;
      this.provinces.set(name, { name, votes: Math.round(top * factor), boost: 1, supporters: new Set() });
    }
  }

  _resetField() {
    // 回合切换时只重置加成，不清空累计票数（票数跨回合累积）
    for (const p of this._map()) p.boost = 1;
  }

  _applyOptions() { /* 参数在事件处理时读取 */ }

  _leader() {
    const list = this._sorted();
    return list[0]?.name || "";
  }

  _nameOf(id) { return id; }
  _leaderName() { return this._leader(); }

  _sorted() {
    return [...this.provinces.values()].sort((a, b) => b.votes - a.votes);
  }

  _addVotes(province, amount, account) {
    if (!province) return 0;
    const p = this.provinces.get(province);
    if (!p) return 0;
    const gain = Math.max(0, Math.round(amount));
    p.votes += gain;
    if (account) p.supporters.add(account.id);
    return gain;
  }

  _onEvent(event, account, now) {
    const effects = [];
    const type = event.type;
    if (type === "gift") {
      const totalHeat = Math.max(0, Number(event.totalHeat) || Number(event.gift?.heat) * (Number(event.count) || 1));
      const province = this._userProvince.get(account.id) || this._leader() || "广东";
      const mult = Number(this.options.giftMultiplier) || 20;
      const before = this.provinces.get(province)?.votes || 0;
      const gain = this._addVotes(province, totalHeat * mult * 1000, account);
      const p = this.provinces.get(province);
      if (p) p.boost = Math.min(30, p.boost + Math.min(6, totalHeat / 400));
      const result = this.ledger.gift(account, totalHeat, Number(event.count) || 1, now);
      effects.push({
        type: "gift-burst", id: uid("fx"), ts: now, province, color: this._provinceColor(province),
        text: `${account.name} 送出 ${event.gift?.name || "礼物"} ×${Number(event.count) || 1}，${province} +${(gain / 10000).toFixed(0)}万票`,
      });
      if (result.firstGift) effects.push({ type: "first-gift", id: uid("fx"), ts: now, province, text: "首送盲盒触发 · 空投加速" });
      if (event.gift?.id === "rocket" || event.gift?.id === "carnival") effects.push({ type: "summon", id: uid("fx"), ts: now, province, text: `${province} 召唤 ${event.gift?.id === "carnival" ? "哪吒" : "闪电"}` });
    } else if (type === "comment") {
      const cmd = parseCommand(event.text);
      if (cmd?.kind === "vote") {
        const province = normProvince(cmd.region);
        if (province) {
          this._userProvince.set(account.id, province);
          this.ledger.join(account, province, now);
          const gain = this._addVotes(province, Number(this.options.votePerComment) || 20000, account);
          effects.push({ type: "vote", id: uid("fx"), ts: now, province, color: this._provinceColor(province), text: `${account.name} 为「${province}」投票 +${(gain / 10000).toFixed(0)}万票` });
        }
      } else if (cmd?.kind === "cheer") {
        const province = this._userProvince.get(account.id) || this._leader();
        const p = this.provinces.get(province);
        if (p) p.boost = Math.min(30, p.boost + cmd.power * 0.5);
        this.ledger.cheer(account, cmd.power);
        this.combo = Math.min(99, this.combo + Math.max(1, Math.round(cmd.power * 2)));
        effects.push({ type: "cheer", id: uid("fx"), ts: now, province, text: `${province} 获得加速 · 助力冲榜` });
      }
    } else if (type === "like") {
      const province = this._userProvince.get(account.id) || this._leader();
      const p = this.provinces.get(province);
      if (p) p.boost = Math.min(30, p.boost + 0.2 * (Number(event.count) || 1));
      this.beats += Number(event.count) || 1;
      effects.push({ type: "like-pop", id: uid("fx"), ts: now, province, count: Number(event.count) || 1, text: "点赞加速冲榜" });
    } else if (type === "follow") {
      const province = this._userProvince.get(account.id) || this._leader();
      this._addVotes(province, 1_000_000, account);
      effects.push({ type: "follow-spark", id: uid("fx"), ts: now, province, text: `${account.name} 关注 · 为${province} +100万票` });
    } else if (type === "enter") {
      effects.push({ type: "enter-orbit", id: uid("fx"), ts: now, text: `${account.name} 进入直播间` });
    }
    return effects;
  }

  _advance(now, dt) {
    const list = this._map();
    for (const p of list) {
      if (p.boost > 1) { p.votes += p.boost * 4000 * dt; p.boost = Math.max(1, p.boost - dt * 0.6); }
    }
    // 到达回合时间不是这里判定，交由 cycle timeout 结算；返回 null 表示继续
    return null;
  }

  _settleResult() {
    const top = this._sorted().slice(0, 5).map((p) => ({ name: p.name, votes: Math.round(p.votes) }));
    return { standings: top };
  }

  _provinceColor(name) {
    const colors = ["#f59e0b", "#22d3ee", "#f43f5e", "#a78bfa", "#34d399", "#60a5fa", "#fb7185", "#facc15"];
    let h = 0;
    for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return colors[h % colors.length];
  }

  _snapshotExtra() {
    const sorted = this._sorted();
    const topN = clamp(Number(this.options.topCount) || 10, 3, 20);
    const standings = sorted.slice(0, topN).map((p, i) => ({
      rank: i + 1, name: p.name, votes: Math.round(p.votes),
      boost: Math.round(p.boost * 10) / 10, supporters: p.supporters.size,
      color: this._provinceColor(p.name),
      pct: Math.round((p.votes / (sorted[0]?.votes || 1)) * 1000) / 10,
    }));
    const totalVotes = sorted.reduce((s, p) => s + p.votes, 0);
    return {
      teams: [],
      units: [],
      hud: {
        layout: "vote",
        pools: this.ledger.snapshot(),
        standings,
        maxVotes: Math.round(sorted[0]?.votes || 0),
        totalVotes: Math.round(totalVotes),
        topProvince: sorted[0]?.name || "",
        countdownMs: this.cycle.phase === "battle" ? Math.max(0, this.cycle.battleEndsAt - Date.now()) : 0,
        phase: this.cycle.phase,
      },
      top: {
        provinces: standings,
        totalVotes: Math.round(totalVotes),
      },
    };
  }
}

export function createSimulation(args) {
  return new HometownVoteSimulation(args);
}

export default createSimulation;
