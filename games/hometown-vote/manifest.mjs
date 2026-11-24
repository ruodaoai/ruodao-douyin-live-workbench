// 最美家乡选拔赛 · 玩法定义（图2 / 图4 / 图6 类型的省份投票冲榜）。
// 观众发「加广东 / 加浙江」为家乡投票，点赞评论 666 加速，礼物成倍加票并提升家乡加成。
export const manifest = {
  id: "hometown-vote",
  name: "最美家乡选拔赛",
  shortName: "家乡投票",
  scene: "hometown-vote",
  category: "省份投票冲榜",
  tagline: "打出「加省份」为家乡投票，礼物加速冲榜，冲击全国积分池",
  description:
    "家乡投票玩法：观众评论「加广东」等为家乡投票，点赞 / 666 加速，礼物成倍加票并提升省份加成，实时更新省份排行榜与全国积分池，回合结束票数最高的省份夺冠。",
  accent: "#f59e0b",
  accent2: "#22d3ee",
  durationSec: 180,
  layout: "portrait",
  layoutKind: "vote",
  features: ["省份投票", "加省份加入", "全国积分池", "省份排行榜", "礼物加成", "召唤特效"],
  howTo: ["发「加广东」为家乡投票", "点赞 / 评论 666 加速冲榜", "送礼物成倍加票并提升加成"],
  rules:
    "评论指令解析省份归属并按票计入榜；礼物热度换算为票数与省份加成；回合结束票数最高省份夺冠。所有票数、加成与召唤特效均为直播互动娱乐玩法，不涉及真实抽奖与货币兑换。",
  metricLabel: "省份票数",
  options: [
    { key: "roundSeconds", label: "单回合时长（秒）", type: "number", min: 60, max: 600, step: 30, default: 180 },
    { key: "topCount", label: "榜单显示省份", type: "number", min: 3, max: 20, step: 1, default: 10 },
    { key: "votePerComment", label: "每次投票票数", type: "number", min: 1000, max: 1000000, step: 1000, default: 20000 },
    { key: "giftMultiplier", label: "礼物加票倍率", type: "number", min: 1, max: 200, step: 1, default: 20 },
  ],
  defaults: { roundSeconds: 180, topCount: 10, votePerComment: 20000, giftMultiplier: 20 },
};

export default manifest;
