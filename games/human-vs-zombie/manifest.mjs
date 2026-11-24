// 人类 vs 丧尸：抖音直播弹幕互动玩法定义。
// 观众用「扣1 / 发1」加入人类，「扣2 / 发2」加入丧尸；「666 / 加油」助威增加推力；
// 礼物提升阵营战力与兵种等级；关注默认成为「冲锋兵」。
export const manifest = {
  id: "human-vs-zombie",
  name: "人类 VS 丧尸",
  shortName: "人类VS丧尸",
  scene: "human-vs-zombie",
  category: "双阵营弹幕对战",
  tagline: "扣 1 加入人类，扣 2 加入丧尸，用礼物把己方推上无敌邪神",
  description:
    "双阵营实时对战玩法：观众扣 1 / 扣 2 选择加入人类或丧尸阵营，礼物提升阵营战力并逐级进化兵种，从特种兵一路打到无敌邪神；破塔触发奖池加成，实时结算连胜与贡献榜。",
  accent: "#38bdf8",
  accent2: "#f43f5e",
  durationSec: 120,
  layout: "portrait",
  features: ["双阵营对战", "扣1扣2加入", "兵种进化树", "积分池", "破塔奖池", "贡献榜"],
  howTo: ["扣 1 加入人类，扣 2 加入丧尸", "发 666 / 加油 为阵营助威推力", "送礼物提升战力，冲上无敌邪神"],
  rules:
    "弹幕指令解析阵营归属；礼物热度转化为阵营战力与兵种等级；单位沿三条兵线推进，先摧毁对方基地的一方获胜。礼盒与奖池为直播互动娱乐玩法，不涉及真实抽奖与货币兑换。",
  metricLabel: "阵营战力",
  options: [
    { key: "roundSeconds", label: "单回合时长（秒）", type: "number", min: 30, max: 300, step: 10, default: 120 },
    { key: "maxUnitsPerSide", label: "单方最大单位", type: "number", min: 20, max: 120, step: 10, default: 80 },
    { key: "pushFactor", label: "助威推力系数", type: "number", min: 0.2, max: 3, step: 0.1, default: 1 },
    { key: "towerBonusPct", label: "破塔奖池加成（%）", type: "number", min: 0, max: 100, step: 5, default: 30 },
    { key: "autoCamera", label: "自动镜头", type: "select", options: [{ value: "on", label: "开启" }, { value: "off", label: "关闭" }], default: "on" },
    { key: "rankPanel", label: "右侧榜单", type: "select", options: [{ value: "on", label: "显示" }, { value: "off", label: "隐藏" }], default: "on" },
  ],
  defaults: {
    roundSeconds: 120,
    maxUnitsPerSide: 80,
    pushFactor: 1,
    towerBonusPct: 30,
    autoCamera: "on",
    rankPanel: "on",
  },
};

export default manifest;