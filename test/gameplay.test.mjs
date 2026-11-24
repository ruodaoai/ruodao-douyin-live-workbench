import assert from "node:assert/strict";
import test from "node:test";
import { createSimulation as createThreeKingdoms } from "../games/three-kingdoms/simulation.mjs";
import { createSimulation as createSheep } from "../games/running-sheep/simulation.mjs";
import { createSimulation as createHometown } from "../games/hometown-vote/simulation.mjs";

const T0 = 1_760_000_000_000;
let seq = 0;
function user(name) { seq += 1; return { id: `u${seq}`, name }; }
function comment(who, text) { return { type: "comment", user: who, text }; }
function gift(who, id, heat, name, count = 1) { return { type: "gift", user: who, gift: { id, heat, name }, count }; }

test("三国：扣1/扣2/扣3 归入蜀/吴/魏，礼物涨兵，火箭召白虎", () => {
  const sim = createThreeKingdoms({ seed: "3k", now: T0 });
  sim.start(T0);
  const shuUser = user("阿蜀");
  const e1 = sim.apply(comment(shuUser, "扣1"), T0 + 1000).effects;
  const e2 = sim.apply(comment(user("阿吴"), "扣2"), T0 + 1100).effects;
  const e3 = sim.apply(comment(user("阿魏"), "扣3"), T0 + 1200).effects;
  assert.ok(e1.some((f) => f.type === "join" && f.team === "shu"), "扣1 应加入蜀");
  assert.ok(e2.some((f) => f.type === "join" && f.team === "wu"), "扣2 应加入吴");
  assert.ok(e3.some((f) => f.type === "join" && f.team === "wei"), "扣3 应加入魏");

  const before = sim.snapshot(T0 + 1300).teams.find((t) => t.id === "shu").troops;
  const giftFx = sim.apply(gift(shuUser, "rocket", 1000, "火箭"), T0 + 1400).effects;
  assert.ok(giftFx.some((f) => f.type === "gift-burst"), "礼物应触发 gift-burst");
  assert.ok(giftFx.some((f) => f.type === "summon"), "火箭应召唤白虎");

  const snap = sim.snapshot(T0 + 1500);
  assert.equal(snap.hud.layout, "lanes");
  assert.equal(snap.hud.counterChain.length, 7, "克制链应有 7 个兵种");
  assert.ok(snap.teams.find((t) => t.id === "shu").troops > before, "蜀国兵力应增加");
  assert.ok(snap.units.some((u) => u.team === "shu" && u.kindIndex === 6), "应有顶级白虎单位");
});

test("羊：扣1/扣2 分左右，666 加推力，冲线结算且幂等", () => {
  const sim = createSheep({ seed: "sheep", now: T0, options: { baseSpeed: 0.03 } });
  sim.start(T0);
  const leftFan = user("左粉");
  const l = sim.apply(comment(leftFan, "扣1"), T0 + 1000).effects;
  const r = sim.apply(comment(user("右粉"), "扣2"), T0 + 1100).effects;
  assert.ok(l.some((f) => f.type === "join" && f.team === "left"), "扣1 应加入左羊");
  assert.ok(r.some((f) => f.type === "join" && f.team === "right"), "扣2 应加入右羊");

  const beforeThrust = sim.snapshot(T0 + 1200).teams.find((t) => t.id === "left").thrust;
  sim.apply(comment(leftFan, "666"), T0 + 1300);
  assert.ok(sim.snapshot(T0 + 1400).teams.find((t) => t.id === "left").thrust > beforeThrust, "666 应增加左羊推力");

  let now = T0 + 1400;
  for (let i = 0; i < 400 && sim.cycle.status !== "settled"; i += 1) { now += 500; sim.tick(now); }
  assert.equal(sim.cycle.status, "settled", "应冲线结算");
  assert.ok(["left", "right"].includes(sim.cycle.winner), "winner 应为左右之一");

  const snap = sim.snapshot(now);
  assert.equal(snap.hud.layout, "race");
  assert.ok(snap.hud.streak[sim.cycle.winner] >= 1, "胜方连胜应 +1");

  const winner = sim.cycle.winner;
  sim.tick(now + 500);
  assert.equal(sim.cycle.winner, winner, "重复 tick 不应改变胜者");
  assert.equal(sim.cycle.status, "settled", "重复 tick 保持已结算");
});

test("家乡：加省份投票增加，未知省份不报错", () => {
  const sim = createHometown({ seed: "hv", now: T0 });
  sim.start(T0);
  const beforeVotes = (sim.snapshot(T0 + 900).hud.standings.find((p) => p.name === "广东") || { votes: 0 }).votes;
  const fx = sim.apply(comment(user("广东佬"), "加广东"), T0 + 1000).effects;
  assert.ok(fx.some((f) => f.type === "vote" && f.province === "广东"), "加广东应产生投票效果");
  const snap = sim.snapshot(T0 + 1100);
  assert.equal(snap.hud.layout, "vote");
  const gd = snap.hud.standings.find((p) => p.name === "广东");
  assert.ok(gd && gd.votes > beforeVotes, "广东票数应增加");
  assert.doesNotThrow(() => sim.apply(comment(user("外星人"), "加火星"), T0 + 1200), "未知省份不应报错");
});