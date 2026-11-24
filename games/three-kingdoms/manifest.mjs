// 三国壮志 · 玩法定义（图3：三阵营兵种克制战场）。
// 观众扣 1 加入蜀、扣 2 加入吴、扣 3 加入魏，礼物提升兵力与兵种，枪→骑→盾→弓→车→象→白虎构成克制链。
export const manifest = {
  id: "three-kingdoms",
  name: "三国壮志",
  shortName: "三国壮志",
  scene: "three-kingdoms",
  category: "三阵营兵种对战",
  tagline: "扣1蜀 扣2吴 扣3魏，礼物提升兵力，兵种克制决胜",
  description:
    "三阵营实时代战：观众扣 1 / 2 / 3 选择加入蜀、吴、魏，礼物提升阵营兵力并升级兵种，枪兵→骑兵→盾兵→弓兵→战车→象兵→白虎构成克制链，先击溃对方两路基地的一方拿下回合。",
  accent: "#22c55e",
  accent2: "#f59e0b",
  durationSec: 180,
  layout: "portrait",
  layoutKind: "lanes",
  features: ["三阵营对战", "扣1扣2扣3加入", "兵种克制链", "兵力对比", "回合比分", "贡献榜"],
  howTo: ["扣 1 蜀 / 扣 2 吴 / 扣 3 魏", "发 666 / 加油 为阵营助威", "送礼物提升兵力与兵种克制"],
  rules:
    "弹幕指令解析阵营归属；礼物热度转化为兵力与兵种等级；三阵营按克制链结算伤害，兵力最先清零的一方淘汰，回合末兵力最高阵营获胜。所有兵种与战力均为直播互动娱乐玩法，不涉及真实抽奖与货币兑换。",
  metricLabel: "兵力",
  options: [
    { key: "roundSeconds", label: "单回合时长（秒）", type: "number", min: 60, max: 300, step: 10, default: 180 },
    { key: "baseTroops", label: "初始兵力", type: "number", min: 10000, max: 60000, step: 1000, default: 32000 },
    { key: "giftTroops", label: "每点热度兵力", type: "number", min: 1, max: 60, step: 1, default: 12 },
    { key: "counterFactor", label: "克制倍率", type: "number", min: 1, max: 3, step: 0.1, default: 1.5 },
  ],
  defaults: { roundSeconds: 180, baseTroops: 32000, giftTroops: 12, counterFactor: 1.5 },
};

export default manifest;
