// 奔跑羊赛跑 · 玩法定义（图5：双羊赛道竞速）。
// 观众扣 1 加入左边、扣 2 加入右边，点赞评论 666 增加推力，礼物加速冲线与连胜积分。
export const manifest = {
  id: "running-sheep",
  name: "奔跑羊赛跑",
  shortName: "奔跑羊",
  scene: "running-sheep",
  category: "双羊竞速对战",
  tagline: "扣1加入左边 扣2加入右边，666 增加推力，率先冲线获胜",
  description:
    "双羊赛道竞速：观众扣 1 / 扣 2 加入左右选手，点赞评论 666 增加推力，礼物加速冲刺并累积连胜积分，先跑完赛道的一方获胜。",
  accent: "#38bdf8",
  accent2: "#f43f5e",
  durationSec: 120,
  layout: "portrait",
  layoutKind: "race",
  features: ["双羊竞速", "扣1扣2加入", "推力加速", "连胜积分", "段位系统", "终点判定"],
  howTo: ["扣 1 加入左边，扣 2 加入右边", "点赞评论 666 增加推力", "送礼物加速冲刺冲线"],
  rules:
    "弹幕指令解析阵营归属；点赞 / 666 与礼物热度转化为推力；推力决定奔跑速度，先抵达终点的一方获胜并累积连胜与段位积分。所有推力和段位均为直播互动娱乐玩法，不涉及真实抽奖与货币兑换。",
  metricLabel: "推力",
  options: [
    { key: "roundSeconds", label: "单回合时长（秒）", type: "number", min: 60, max: 300, step: 10, default: 120 },
    { key: "trackMeters", label: "赛道长度（米）", type: "number", min: 500, max: 3000, step: 100, default: 1500 },
    { key: "baseSpeed", label: "基础速度", type: "number", min: 0.004, max: 0.03, step: 0.001, default: 0.012 },
    { key: "cheerBoost", label: "助威推力系数", type: "number", min: 0.5, max: 4, step: 0.1, default: 1.6 },
  ],
  defaults: { roundSeconds: 120, trackMeters: 1500, baseSpeed: 0.012, cheerBoost: 1.6 },
};

export default manifest;
