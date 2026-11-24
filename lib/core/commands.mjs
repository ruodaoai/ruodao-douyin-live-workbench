// 弹幕指令解析：只做纯文本归一化，不依赖具体玩法实现。
// 玩法通过传入的 teams 决定可用阵营；其它识别结果统一作为结构化指令返回。

const DIGIT_MAP = { "０": "0", "１": "1", "２": "2", "３": "3", "４": "4", "５": "5", "６": "6", "７": "7", "８": "8", "９": "9" };

export function normalizeText(raw) {
  return String(raw ?? "")
    .replace(/[０-９]/g, (ch) => DIGIT_MAP[ch] || ch)
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

const CHEER_RE = /(666|6{3,}|加油|冲冲冲|冲鸭|冲|顶起|点赞|赞|牛逼|牛啊|上上上)/;
const JOIN_NUM_RE = /^(扣|发|打|搬|加入)?([12])$/;
const HUMAN_WORDS = ["人类", "人族", "人方", "蓝方", "左边", "左方", "human", "蓝队"];
const ZOMBIE_WORDS = ["丧尸", "僵尸", "尸", "红方", "右边", "右方", "zombie", "红队"];

/**
 * @param {string} rawText 弹幕原文
 * @returns {{kind:string, team?:string, region?:string, power?:number, raw:string}|null}
 */
export function parseCommand(rawText) {
  const text = normalizeText(rawText);
  if (!text) return null;

  // 1) 助威类优先（避免 "666" 被当成数字加入规则误判）
  if (CHEER_RE.test(text)) {
    const power = text.includes("666") || /6{3,}/.test(text) ? 1 : 0.5;
    return { kind: "cheer", power, raw: String(rawText ?? "") };
  }

  // 2) 数字加入（扣1/发1/1 等）
  const num = text.match(JOIN_NUM_RE);
  if (num) return { kind: "join", team: num[2] === "1" ? "human" : "zombie", raw: String(rawText ?? "") };

  // 3) 语义加入
  if (HUMAN_WORDS.some((word) => text.includes(word))) return { kind: "join", team: "human", raw: String(rawText ?? "") };
  if (ZOMBIE_WORDS.some((word) => text.includes(word))) return { kind: "join", team: "zombie", raw: String(rawText ?? "") };

  // 4) 地区投票（加广东 / 投浙江 / 广东）
  const vote = text.match(/^(加|投|支持|加入|选)([\u4e00-\u9fa5]{2,8})$/);
  if (vote) return { kind: "vote", region: vote[2], raw: String(rawText ?? "") };

  return null;
}

export function describeCommand(cmd) {
  if (!cmd) return "";
  if (cmd.kind === "join") return cmd.team === "human" ? "加入人类阵营" : "加入丧尸阵营";
  if (cmd.kind === "cheer") return "为阵营助威";
  if (cmd.kind === "vote") return `为「${cmd.region}」投票`;
  return "";
}