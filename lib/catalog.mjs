/**
 * 礼物热度是互动计分权重，不是官方抖币价格。
 * 抖音礼物名称与价格会随平台调整，工作台只使用相对权重，并允许主播在设置里改写。
 */
import { gameManifests } from "./core/registry.mjs";
import { defaultControl, sanitizeBgm, sanitizeStage } from "./live-control.mjs";

export const GIFT_CATALOG = [
  { id: "heart", name: "小心心", icon: "heart", heat: 1, tier: "light", color: "#ff5c8a", weight: 34 },
  { id: "rose", name: "玫瑰", icon: "rose", heat: 2, tier: "light", color: "#ff4d6d", weight: 24 },
  { id: "candy", name: "棒棒糖", icon: "candy", heat: 5, tier: "light", color: "#ffb020", weight: 16 },
  { id: "beer", name: "干杯", icon: "beer", heat: 10, tier: "mid", color: "#f59e0b", weight: 10 },
  { id: "shades", name: "墨镜", icon: "shades", heat: 30, tier: "mid", color: "#a78bfa", weight: 7 },
  { id: "crown", name: "皇冠", icon: "crown", heat: 100, tier: "mid", color: "#facc15", weight: 4 },
  { id: "sportscar", name: "跑车", icon: "car", heat: 500, tier: "high", color: "#38bdf8", weight: 2.4 },
  { id: "rocket", name: "火箭", icon: "rocket", heat: 1000, tier: "high", color: "#fb7185", weight: 1.4 },
  { id: "carnival", name: "嘉年华", icon: "fireworks", heat: 3000, tier: "top", color: "#f472b6", weight: 0.5 },
];

export const GIFT_BY_ID = new Map(GIFT_CATALOG.map((gift) => [gift.id, gift]));
export const GIFT_BY_NAME = new Map(GIFT_CATALOG.map((gift) => [gift.name, gift]));

export const DEMO_USER_NAMES = [
  "晚风不打烊", "小鹿乱撞", "一颗栗子", "北岛不冷", "橙子汽水", "月亮邮差",
  "阿泽同学", "糖分超标", "海盐可可", "大橘为重", "云朵收藏家", "不吃香菜",
  "半糖去冰", "追光的人", "桃桃乌龙", "凌晨四点", "鲸落南星", "山野雾灯",
  "芝士年糕", "风吹麦浪", "把酒问青天", "满眼星河", "芋泥啵啵", "雾里看花",
  "猫在打盹", "夏日限定", "南风知我意", "路过的骑士", "小熊软糖", "落日飞车",
  "银河系漫游", "困困包", "一杯冰美式", "快乐星球", "柠檬不酸", "星光贩卖机",
  "想睡觉的猫", "蓝色大门", "晚安电台", "风吹过夏天",
];

export const GAMES = gameManifests();

export const GAME_BY_ID = new Map(GAMES.map((game) => [game.id, game]));

export const DEFAULT_SETTINGS = {
  theme: "neon",
  sound: true,
  showHints: true,
  lastGameId: GAMES[0]?.id ?? "human-vs-zombie",
  overlayTitle: "若道互动直播间",
  overlaySubtitle: "扣1人类 扣2丧尸 · 送礼物提升战力",
  source: {
    type: "demo",
    url: "",
    token: "",
    autoReconnect: true,
  },
  demo: {
    scenario: "normal",
    speed: 1,
  },
  giftHeat: Object.fromEntries(GIFT_CATALOG.map((gift) => [gift.id, gift.heat])),
  gameOptions: Object.fromEntries(GAMES.map((game) => [game.id, { ...game.defaults }])),
  ai: { provider: "", model: "", endpoint: "" },
  bgm: sanitizeBgm({}),
  control: defaultControl(),
  stage: sanitizeStage({}),
};

export function giftHeat(settings, giftId) {
  const custom = settings?.giftHeat?.[giftId];
  if (Number.isFinite(Number(custom)) && Number(custom) >= 0) return Number(custom);
  return GIFT_BY_ID.get(giftId)?.heat ?? 1;
}

export function gameOptions(settings, gameId) {
  const game = GAME_BY_ID.get(gameId);
  const merged = { ...(game?.defaults ?? {}), ...(settings?.gameOptions?.[gameId] ?? {}) };
  return merged;
}

export function publicGames(settings) {
  return GAMES.map((game) => ({
    ...game,
    defaults: gameOptions(settings, game.id),
    currentOptions: gameOptions(settings, game.id),
  }));
}

export function publicGifts(settings) {
  return GIFT_CATALOG.map((gift) => ({ ...gift, heat: giftHeat(settings, gift.id) }));
}

export function mergeSettings(base, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return base;
  const next = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value && typeof value === "object" && !Array.isArray(value) && base?.[key] && typeof base[key] === "object" && !Array.isArray(base[key])) {
      next[key] = mergeSettings(base[key], value);
    } else {
      next[key] = value;
    }
  }
  return next;
}