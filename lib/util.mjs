export function nowMs() {
  return Date.now();
}

export function iso(ts) {
  return new Date(Number(ts) || Date.now()).toISOString();
}

export function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

export function safeText(value, max = 120) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function safeId(value, fallback = "") {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  return text.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 96) || fallback;
}

export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function hashSeed(input) {
  let hash = 2166136261;
  const text = String(input ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let state = Number(seed) >>> 0;
  return function random() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(list, random = Math.random) {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  return list[Math.floor(random() * list.length) % list.length];
}

export function weightedPick(items, weightOf, random = Math.random) {
  const rows = Array.isArray(items) ? items : [];
  let total = 0;
  for (const item of rows) total += Math.max(0, Number(weightOf(item)) || 0);
  if (total <= 0) return pick(rows, random);
  let cursor = random() * total;
  for (const item of rows) {
    cursor -= Math.max(0, Number(weightOf(item)) || 0);
    if (cursor <= 0) return item;
  }
  return rows[rows.length - 1];
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function readJsonBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error(`请求体超过 ${Math.round(limit / 1024)}KB 限制`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

export function bucketKey(ts) {
  return Math.floor(Number(ts) / 60000);
}
