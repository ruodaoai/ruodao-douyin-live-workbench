// 多玩法 HUD（DOM 叠层，1080×1920）。按 state.hud.layout 切换：battle / vote / lanes / race。
// battle 布局（人类 VS 丧尸）保持原样；其余布局按各玩法截图还原关键信息区。
import { formatNum, formatClock } from "./scenes/core.mjs";

const KIND_NAMES = ["冲锋兵", "特种兵", "菜刀屠夫", "机枪手", "装甲车", "机甲战士", "泰坦", "无敌邪神"];
const CONTROLS = [
  { id: "rank", icon: "🏆", label: "排名" },
  { id: "top100", icon: "💯", label: "百强" },
  { id: "gift", icon: "🎁", label: "动感礼物" },
  { id: "reduce", icon: "🍚", label: "降米" },
  { id: "camera", icon: "🎥", label: "自动镜头" },
  { id: "particle", icon: "✨", label: "特效质点" },
  { id: "gun", icon: "🔫", label: "机枪" },
  { id: "temp", icon: "🌡️", label: "温度" },
];

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function buildTeam(side, name, color) {
  const wrap = el("div", `hud-team hud-team-${side}`);
  const head = el("div", "hud-team-head");
  const dot = el("i", "hud-team-dot");
  dot.style.background = color;
  const nm = el("b", "hud-team-name", name);
  const pct = el("span", "hud-team-pct", "50%");
  head.append(dot, nm, pct);
  const bar = el("div", "hud-team-bar");
  const fill = el("i", "hud-team-fill");
  fill.style.background = color;
  bar.appendChild(fill);
  const meta = el("div", "hud-team-meta");
  const power = el("span", "hud-power", "战力 0");
  const kind = el("span", "hud-kind", "冲锋兵");
  meta.append(power, kind);
  wrap.append(head, bar, meta);
  return { wrap, pct, fill, power, kind };
}

// ============ battle 布局（人类 VS 丧尸，原样保留） ============
function createBattleHud(root) {
  const top = el("div", "hud-top");
  const human = buildTeam("human", "人类阵营", "#38bdf8");
  const zombie = buildTeam("zombie", "丧尸阵营", "#f43f5e");
  const clock = el("div", "hud-clock");
  const phase = el("span", "hud-phase", "准备阶段");
  const time = el("strong", "hud-time", "02:00");
  clock.append(phase, time);
  top.append(human.wrap, clock, zombie.wrap);

  const pools = el("div", "hud-pools");
  const poolScore = poolChip("积分池", "0", "pool-score");
  const poolStreak = poolChip("连胜池", "0", "pool-streak");
  const poolTower = poolChip("破塔奖池", "0", "pool-tower");
  const poolBonus = el("span", "hud-pool-bonus", "+30%");
  poolTower.wrap.appendChild(poolBonus);
  pools.append(poolScore.wrap, poolStreak.wrap, poolTower.wrap);

  const tree = el("div", "hud-tree");
  tree.appendChild(el("div", "hud-tree-title", "兵种进化"));
  const treeNodes = KIND_NAMES.map((name, i) => {
    const node = el("div", "hud-tree-node");
    node.append(el("i", "hud-tree-dot"), el("span", "hud-tree-name", name));
    node.dataset.level = String(i);
    tree.appendChild(node);
    return node;
  });

  const controls = el("div", "hud-controls");
  for (const item of CONTROLS) {
    const btn = el("div", "hud-control", `${item.icon} ${item.label}`);
    btn.classList.add("on");
    controls.appendChild(btn);
  }

  const rank = el("div", "hud-rank");
  const rankTitle = el("div", "hud-rank-title", "贡献榜");
  const rankList = el("div", "hud-rank-list");
  rank.append(rankTitle, rankList);

  const bottom = el("div", "hud-bottom");
  const hBase = baseBar("人类基地", "#38bdf8");
  const zBase = baseBar("丧尸基地", "#f43f5e");
  bottom.append(hBase.wrap, zBase.wrap);

  const banner = el("div", "hud-banner hidden");
  root.append(top, pools, tree, controls, rank, bottom, banner);

  let lastSignature = "";

  function poolChip(label, value, cls) {
    const wrap = el("div", `hud-pool ${cls}`);
    wrap.append(el("span", "hud-pool-label", label), el("b", "hud-pool-value", value));
    return { wrap, value: wrap.querySelector(".hud-pool-value") };
  }
  function baseBar(label, color) {
    const wrap = el("div", "hud-base");
    const head = el("div", "hud-base-head");
    const fillWrap = el("div", "hud-base-bar");
    const fill = el("i", "hud-base-fill");
    fill.style.background = color;
    fillWrap.appendChild(fill);
    const val = el("b", "hud-base-value", "1000");
    head.append(el("span", "hud-base-name", label), val);
    wrap.append(head, fillWrap);
    return { wrap, fill, val };
  }
  function findTeam(teams, id) {
    return (teams || []).find((t) => t.id === id) || { pct: 50, power: 0, kindName: "冲锋兵", baseHp: 0, baseMaxHp: 1000 };
  }
  function update(state) {
    if (!state) return;
    const teams = state.teams || [];
    const hm = findTeam(teams, "human");
    const zm = findTeam(teams, "zombie");

    human.fill.style.width = `${hm.pct}%`;
    zombie.fill.style.width = `${zm.pct}%`;
    human.pct.textContent = `${hm.pct}%`;
    zombie.pct.textContent = `${zm.pct}%`;
    human.power.textContent = `战力 ${formatNum(hm.power)}`;
    zombie.power.textContent = `战力 ${formatNum(zm.power)}`;
    human.kind.textContent = hm.kindName || "冲锋兵";
    zombie.kind.textContent = zm.kindName || "冲锋兵";

    const round = state.round || {};
    const hud = state.hud || {};
    const countdown = Number(state.countdownMs || 0);
    if (round.phase === "battle") {
      phase.textContent = "对战中";
      time.textContent = formatClock(countdown);
    } else if (round.phase === "settle") {
      phase.textContent = "结算中";
      time.textContent = "结算";
    } else {
      phase.textContent = "准备阶段";
      time.textContent = Math.max(0, Math.ceil((Number(round.endsAt || 0) - (state.now || Date.now())) / 1000)) + "s";
      if (round.phase === "prepare" && countdown === 0) time.textContent = "准备";
    }

    const poolsData = hud.pools || {};
    poolScore.value.textContent = formatNum(poolsData.score || 0);
    poolStreak.value.textContent = formatNum(Math.round(poolsData.streak || 0));
    poolTower.value.textContent = formatNum(poolsData.tower || 0);
    poolBonus.textContent = `+${poolsData.towerBonusPct ?? 30}%`;

    const maxLevel = Math.max(hm.kindIndex || 0, zm.kindIndex || 0);
    treeNodes.forEach((node, i) => {
      node.classList.toggle("reached", i <= maxLevel);
      node.classList.toggle("current-h", (hm.kindIndex || 0) === i);
      node.classList.toggle("current-z", (zm.kindIndex || 0) === i);
    });

    hBase.fill.style.width = `${Math.max(0, Math.min(100, (hm.baseHp / (hm.baseMaxHp || 1000)) * 100))}%`;
    zBase.fill.style.width = `${Math.max(0, Math.min(100, (zm.baseHp / (zm.baseMaxHp || 1000)) * 100))}%`;
    hBase.val.textContent = String(Math.round(hm.baseHp || 0));
    zBase.val.textContent = String(Math.round(zm.baseHp || 0));

    const top = state.topUsers || [];
    const sig = top.slice(0, 5).map((u) => `${u.rank}:${u.name}:${u.heat}`).join("|");
    if (sig !== lastSignature) {
      lastSignature = sig;
      if (!top.length) {
        rankList.replaceChildren(el("div", "hud-rank-empty", "送出礼物即可上榜"));
      } else {
        rankList.replaceChildren(...top.slice(0, 5).map((u, i) => {
          const row = el("div", "hud-rank-row");
          row.append(
            el("span", `hud-rank-no no-${i + 1}`, String(u.rank || i + 1)),
            el("span", "hud-rank-name", u.name || "观众"),
            el("span", `hud-rank-team team-${u.team || "none"}`, u.team === "zombie" ? "尸" : u.team === "human" ? "人" : "—"),
            el("b", "hud-rank-heat", formatNum(u.heat || 0)),
          );
          return row;
        }));
      }
    }

    if (round.phase === "settle" && round.winner) {
      banner.classList.remove("hidden");
      const wname = round.winner === "zombie" ? "丧尸阵营" : "人类阵营";
      banner.className = `hud-banner show banner-${round.winner}`;
      banner.textContent = `${wname} 摧毁基地 · 拿下第 ${round.index || 1} 回合`;
    } else {
      banner.className = "hud-banner hidden";
    }
  }

  return { update, effect() {} };
}
// ============ vote 布局（最美家乡选拔赛） ============
function createVoteHud(root) {
  const wrap = el("div", "vote-layout");
  const top = el("div", "vote-top");
  const pool = el("div", "vote-pool");
  const poolVal = el("b", "vote-pool-value", "0");
  pool.append(el("span", "vote-pool-label", "全国积分池"), poolVal);
  const clock = el("div", "vote-clock");
  const clockPhase = el("span", "vote-clock-phase", "投票中");
  const clockTime = el("strong", "vote-clock-time", "00:00");
  clock.append(clockPhase, clockTime);
  top.append(pool, clock);

  const board = el("div", "vote-board");
  const list = el("div", "vote-board-list");
  board.append(el("div", "vote-board-title", "省份排行榜"), list);

  const foot = el("div", "vote-foot");
  foot.append(el("span", "vote-hint", "关注 +1万票 · 送出礼物加速冲榜"), el("span", "vote-boost", "礼物加成 200%"));

  const banner = el("div", "hud-banner hidden");
  wrap.append(top, board, foot, banner);
  root.append(wrap);

  let sig = "";
  function update(state) {
    const hud = state.hud || {};
    const round = state.round || {};
    poolVal.textContent = formatNum(hud.totalVotes || 0);
    const countdown = Number(state.countdownMs || 0);
    if (round.phase === "battle") { clockPhase.textContent = "投票中"; clockTime.textContent = formatClock(countdown); }
    else if (round.phase === "settle") { clockPhase.textContent = "结果公布"; clockTime.textContent = "结算"; }
    else { clockPhase.textContent = "准备中"; clockTime.textContent = "准备"; }

    const standings = hud.standings || [];
    const nextSig = standings.map((p) => `${p.rank}:${p.name}:${p.votes}`).join("|");
    if (nextSig !== sig) {
      sig = nextSig;
      if (!standings.length) {
        list.replaceChildren(el("div", "vote-empty", "发出「加省份」为家乡投票"));
      } else {
        list.replaceChildren(...standings.slice(0, 8).map((p) => {
          const row = el("div", "vote-row");
          const no = el("span", `vote-row-no rank-${Math.min(p.rank || 1, 4)}`, String(p.rank || ""));
          const body = el("div", "vote-row-body");
          const head = el("div", "vote-row-head");
          const nm = el("span", "vote-row-name", p.name || "");
          const votes = el("b", "vote-row-votes", formatNum(p.votes || 0));
          head.append(nm, votes);
          const bar = el("div", "vote-row-bar");
          const fill = el("i", "vote-row-fill");
          fill.style.background = p.color || "#f59e0b";
          fill.style.width = `${Math.max(6, Math.min(100, Number(p.pct) || 6))}%`;
          bar.appendChild(fill);
          body.append(head, bar);
          row.append(no, body);
          if (p.boost && p.boost > 1) row.append(el("span", "vote-row-boost", `x${p.boost}`));
          return row;
        }));
      }
    }

    if (round.phase === "settle" && round.winner) {
      banner.classList.remove("hidden");
      banner.className = "hud-banner show";
      banner.textContent = `「${round.winner}」夺得本回合冠军`;
    } else {
      banner.className = "hud-banner hidden";
    }
  }
  return { update, effect() {} };
}
// ============ lanes 布局（三国壮志三阵营） ============
const LANES_TEAMS = [
  { id: "shu", name: "蜀国", color: "#facc15" },
  { id: "wu", name: "吴国", color: "#38bdf8" },
  { id: "wei", name: "魏国", color: "#f43f5e" },
];

function createLanesHud(root) {
  const wrap = el("div", "lanes-layout");
  const top = el("div", "lanes-top");
  const cards = {};
  for (const meta of LANES_TEAMS) {
    const card = el("div", "lanes-card");
    const head = el("div", "lanes-card-head");
    const dot = el("i", "lanes-dot");
    dot.style.background = meta.color;
    head.append(dot, el("b", "lanes-name", meta.name));
    const troops = el("b", "lanes-troops", "0");
    const kind = el("span", "lanes-kind", "枪兵");
    const bar = el("div", "lanes-card-bar");
    const fill = el("i", "lanes-card-fill");
    fill.style.background = meta.color;
    bar.appendChild(fill);
    card.append(head, troops, kind, bar);
    top.appendChild(card);
    cards[meta.id] = { card, troops, kind, fill };
  }

  const chain = el("div", "lanes-chain");
  chain.append(el("div", "lanes-chain-title", "兵种克制链"));

  const mid = el("div", "lanes-mid");
  const score = el("div", "lanes-score", "0 : 0 : 0");
  const clock = el("div", "lanes-clock");
  const clockPhase = el("span", "lanes-clock-phase", "对战中");
  const clockTime = el("strong", "lanes-clock-time", "00:00");
  clock.append(clockPhase, clockTime);
  mid.append(score, clock);

  const banner = el("div", "hud-banner hidden");
  wrap.append(top, mid, chain, banner);
  root.append(wrap);

  let chainSig = "";
  function update(state) {
    const teams = state.teams || [];
    for (const meta of LANES_TEAMS) {
      const t = teams.find((x) => x.id === meta.id) || { troops: 0, kindName: "枪兵", pct: 0 };
      const c = cards[meta.id];
      c.troops.textContent = formatNum(Math.round(t.troops || 0));
      c.kind.textContent = t.kindName || "枪兵";
      c.fill.style.width = `${Math.max(4, Math.min(100, Number(t.pct) || 4))}%`;
    }
    const round = state.round || {};
    const hud = state.hud || {};
    const sc = hud.score || {};
    score.textContent = `${sc.shu || 0} : ${sc.wu || 0} : ${sc.wei || 0}`;
    const countdown = Number(state.countdownMs || 0);
    if (round.phase === "battle") { clockPhase.textContent = "对战中"; clockTime.textContent = formatClock(countdown); }
    else if (round.phase === "settle") { clockPhase.textContent = "结算"; clockTime.textContent = "结算"; }
    else { clockPhase.textContent = "集结"; clockTime.textContent = "准备"; }

    const chainNames = hud.counterChain || [];
    const nextSig = chainNames.join(">");
    if (nextSig !== chainSig) {
      chainSig = nextSig;
      const nodes = chainNames.map((name, i) => {
        const n = el("span", "lanes-chain-node", name);
        n.dataset.i = String(i);
        return n;
      });
      chain.replaceChildren(el("div", "lanes-chain-title", "兵种克制链"), ...nodes);
    }

    if (round.phase === "settle" && round.winner) {
      const w = LANES_TEAMS.find((t) => t.id === round.winner);
      banner.classList.remove("hidden");
      banner.className = "hud-banner show";
      banner.textContent = `${w?.name || round.winner} 拿下第 ${round.index || 1} 回合`;
    } else {
      banner.className = "hud-banner hidden";
    }
  }
  return { update, effect() {} };
}
// ============ race 布局（奔跑羊赛跑） ============
function createRaceHud(root) {
  const wrap = el("div", "race-layout");
  const top = el("div", "race-top");

  function side(id, label, color) {
    const box = el("div", `race-side race-${id}`);
    const head = el("div", "race-side-head");
    const dot = el("i", "race-dot");
    dot.style.background = color;
    head.append(dot, el("b", "race-side-name", label));
    const thrust = el("div", "race-thrust", "推力 0");
    const rank = el("span", "race-rank", "青铜");
    box.append(head, thrust, rank);
    return { box, thrust, rank };
  }
  const left = side("left", "左羊", "#38bdf8");
  const right = side("right", "右羊", "#f43f5e");

  const clock = el("div", "race-clock");
  const clockPhase = el("span", "race-clock-phase", "奔跑中");
  const clockTime = el("strong", "race-clock-time", "00:00");
  clock.append(clockPhase, clockTime);
  top.append(left.box, clock, right.box);

  const track = el("div", "race-track");
  function lane(id, color) {
    const row = el("div", "race-lane");
    const bar = el("div", "race-lane-bar");
    const fill = el("i", "race-lane-fill");
    fill.style.background = color;
    bar.appendChild(fill);
    const flag = el("span", "race-lane-flag", "🏁");
    const meta = el("span", "race-lane-meta", "0m");
    row.append(bar, flag, meta);
    track.appendChild(row);
    return { fill, meta };
  }
  const lanes = { left: lane("left", "#38bdf8"), right: lane("right", "#f43f5e") };

  const stats = el("div", "race-stats");
  const streakL = el("span", "race-stat chip-left", "总连胜 0");
  const streakR = el("span", "race-stat chip-right", "总连胜 0");
  const pool = el("span", "race-stat chip-pool", "积分池 0");
  stats.append(streakL, pool, streakR);

  const foot = el("div", "race-foot", "扣 1 左羊 · 扣 2 右羊 · 发 666 加推力");
  const banner = el("div", "hud-banner hidden");
  wrap.append(top, track, stats, foot, banner);
  root.append(wrap);

  function update(state) {
    const teams = state.teams || [];
    const l = teams.find((t) => t.id === "left") || { thrust: 0, meters: 0, pct: 0, streak: 0, rank: "青铜" };
    const r = teams.find((t) => t.id === "right") || { thrust: 0, meters: 0, pct: 0, streak: 0, rank: "青铜" };
    left.thrust.textContent = `推力 ${formatNum(Math.round(l.thrust || 0))}`;
    right.thrust.textContent = `推力 ${formatNum(Math.round(r.thrust || 0))}`;
    left.rank.textContent = l.rank || "青铜";
    right.rank.textContent = r.rank || "青铜";
    lanes.left.fill.style.width = `${Math.max(6, Math.min(100, Number(l.pct) || 6))}%`;
    lanes.right.fill.style.width = `${Math.max(6, Math.min(100, Number(r.pct) || 6))}%`;
    lanes.left.meta.textContent = `剩余 ${formatNum(Math.round(l.remaining || 0))}m`;
    lanes.right.meta.textContent = `剩余 ${formatNum(Math.round(r.remaining || 0))}m`;
    streakL.textContent = `总连胜 ${formatNum(l.streak || 0)}`;
    streakR.textContent = `总连胜 ${formatNum(r.streak || 0)}`;
    const pools = state.hud?.pools || {};
    pool.textContent = `积分池 ${formatNum(pools.score || 0)}`;

    const round = state.round || {};
    const countdown = Number(state.countdownMs || 0);
    if (round.phase === "battle") { clockPhase.textContent = "奔跑中"; clockTime.textContent = formatClock(countdown); }
    else if (round.phase === "settle") { clockPhase.textContent = "冲线"; clockTime.textContent = "结算"; }
    else { clockPhase.textContent = "就位"; clockTime.textContent = "准备"; }

    if (round.phase === "settle" && round.winner) {
      const w = round.winner === "right" ? "右羊" : "左羊";
      banner.classList.remove("hidden");
      banner.className = "hud-banner show";
      banner.textContent = `${w} 率先冲线 · 拿下第 ${round.index || 1} 回合`;
    } else {
      banner.className = "hud-banner hidden";
    }
  }
  return { update, effect() {} };
}

// ============ 调度器 ============
export function createHud(root) {
  let currentLayout = "";
  let impl = null;
  function ensure(layout) {
    if (layout === currentLayout && impl) return;
    currentLayout = layout;
    const wasHidden = root.classList.contains("hidden");
    root.replaceChildren();
    root.className = `hud hud-${layout}`;
    impl = layout === "vote" ? createVoteHud(root)
      : layout === "lanes" ? createLanesHud(root)
        : layout === "race" ? createRaceHud(root)
          : createBattleHud(root);
    if (wasHidden) root.classList.add("hidden");
  }
  function update(state) {
    if (!state) return;
    const layout = state?.hud?.layout || "battle";
    ensure(layout);
    impl.update(state);
  }
  function effect() { /* 特效由场景层与 toast 负责 */ }
  function reset() { root.classList.add("hidden"); }
  return { update, effect, reset };
}

export default createHud;