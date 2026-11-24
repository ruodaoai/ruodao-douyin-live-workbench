// 最美家乡选拔赛 · 场景渲染（Canvas2D，1080×1920）。
// 主视觉来自生图号池；本层只负责全息地图节点、票数光柱与投票氛围。
import { W, H, clamp01, createBackdrop, drawSprite, glowDot, cornerFrame, loadImage, prepareCutout } from "./stage-kit.mjs";

const NODES = [
  { x: 0.34, y: 0.245 },
  { x: 0.51, y: 0.205 },
  { x: 0.67, y: 0.260 },
  { x: 0.25, y: 0.345 },
  { x: 0.76, y: 0.355 },
  { x: 0.41, y: 0.368 },
  { x: 0.60, y: 0.394 },
];

const LINKS = [
  [0, 1], [1, 2], [0, 3], [2, 4], [3, 5], [5, 6], [6, 4],
  [1, 5], [1, 6], [0, 5], [2, 6],
];

export function createHometownScene({ assets = {} } = {}) {
  const el = document.createElement("div");
  el.className = "hometown-stage";
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  canvas.style.cssText = `width:${W}px;height:${H}px;display:block`;
  el.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const callout = document.createElement("div");
  callout.className = "vote-callout";
  callout.textContent = "打出你所在家乡 · 扣「加省份」";
  el.appendChild(callout);


  const backdrop = createBackdrop({
    url: assets.background || assets.url || "",
    accent: "#fbbf24",
    accent2: "#22d3ee",
    topFade: 300,
    bottomFade: 360,
    particles: 72,
  });

  const guardian = loadImage(assets.guardian || "");

  let latest = null;
  let running = true;
  let rafId = 0;
  let time = 0;
  let lastTs = 0;
  const bursts = [];
  const levels = new Map();

  const particles = [];
  for (let index = 0; index < 60; index += 1) {
    particles.push({
      x: Math.random() * W,
      y: H * 0.45 + Math.random() * H * 0.45,
      r: 1 + Math.random() * 2.4,
      speed: 0.4 + Math.random() * 1.6,
      drift: (Math.random() - 0.5) * 0.5,
      alpha: 0.2 + Math.random() * 0.55,
    });
  }

  function update(state) { if (state) latest = state; }

  function effect(event) {
    if (!event) return;
    if (["gift-burst", "vote", "cheer", "summon", "like-wave", "follow-spark"].includes(event.type)) {
      bursts.push({
        x: W / 2 + (Math.random() - 0.5) * 560,
        y: H * 0.52 + (Math.random() - 0.5) * 260,
        life: 1,
        color: event.color || "#fbbf24",
        power: 0.6 + Math.random() * 0.8,
      });
    }
  }

  function drawNetwork(t) {
    const standings = (latest?.hud?.standings || []).slice(0, NODES.length);
    if (!standings.length) return;
    const maxVotes = Math.max(1, ...standings.map((row) => Number(row.votes) || 0));
    const points = NODES.map((node) => ({ x: node.x * W, y: node.y * H }));

    // 节点间的数据流线
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const [from, to] of LINKS) {
      const a = points[from];
      const b = points[to];
      const gradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      gradient.addColorStop(0, "rgba(34,211,238,0.05)");
      gradient.addColorStop(0.5, "rgba(251,191,36,0.30)");
      gradient.addColorStop(1, "rgba(34,211,238,0.05)");
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([16, 22]);
      ctx.lineDashOffset = -t * 46;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    // 中央全息能量环
    const center = { x: W * 0.5, y: H * 0.30 };
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    glowDot(ctx, center.x, center.y, 300, "rgba(251,191,36,0.12)", 1);
    for (let ring = 0; ring < 3; ring += 1) {
      const radius = 120 + ring * 46;
      ctx.strokeStyle = ring === 0 ? "rgba(251,191,36,0.32)" : "rgba(34,211,238,0.16)";
      ctx.lineWidth = ring === 0 ? 3 : 1.6;
      ctx.setLineDash(ring === 1 ? [8, 18] : []);
      ctx.lineDashOffset = t * (ring === 1 ? 34 : -18);
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    standings.forEach((row, index) => {
      const point = points[index];
      if (!point) return;
      const ratio = clamp01((Number(row.votes) || 0) / maxVotes);
      const prev = levels.get(row.name) ?? 0;
      const level = prev + (ratio - prev) * 0.12;
      levels.set(row.name, level);
      const color = row.color || "#fbbf24";
      const first = index === 0;
      const pulse = 0.78 + Math.sin(t * 2.4 + index) * 0.22;

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      // 光柱：票数越高越高
      const beam = 50 + level * 250;
      const beamGradient = ctx.createLinearGradient(0, point.y - beam, 0, point.y);
      beamGradient.addColorStop(0, "rgba(0,0,0,0)");
      beamGradient.addColorStop(1, `${color}aa`);
      ctx.fillStyle = beamGradient;
      ctx.globalAlpha = 0.5 + level * 0.4;
      ctx.fillRect(point.x - (first ? 7 : 4), point.y - beam, first ? 14 : 8, beam);
      ctx.globalAlpha = 1;

      // 核心光点 + 外环
      glowDot(ctx, point.x, point.y, first ? 92 : 58, `${color}88`, 0.85);
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(point.x, point.y, first ? 8 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = first ? 3 : 2;
      ctx.globalAlpha = 0.4 + pulse * 0.4;
      ctx.beginPath();
      ctx.arc(point.x, point.y, (first ? 30 : 20) * (0.85 + pulse * 0.2), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();

      // 省份标签
      ctx.save();
      ctx.textAlign = "center";
      ctx.font = first ? "900 30px system-ui, 'Microsoft YaHei', sans-serif" : "700 23px system-ui, 'Microsoft YaHei', sans-serif";
      ctx.fillStyle = first ? "#ffe9a8" : "rgba(226,240,255,0.88)";
      ctx.shadowColor = color;
      ctx.shadowBlur = first ? 24 : 12;
      ctx.fillText(row.name || "", point.x, point.y + (first ? 52 : 42));
      ctx.shadowBlur = 0;
      ctx.font = "600 18px system-ui, 'Microsoft YaHei', sans-serif";
      ctx.fillStyle = first ? "rgba(251,191,36,0.95)" : "rgba(148,197,235,0.78)";
      ctx.fillText(formatVotes(row.votes), point.x, point.y + (first ? 82 : 70));
      ctx.restore();
    });
  }

  // 守护兽：金色火焰巨虎，浮在地图中央，作为地区守护神的视觉锚点
  function drawGuardian(t) {
    const cutout = prepareCutout(guardian);
    const sprite = cutout || guardian;
    if (!sprite || !(sprite.naturalWidth || sprite.width)) return;
    const breathe = 1 + Math.sin(t * 1.1) * 0.025;
    const hover = Math.sin(t * 0.8) * 10;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    glowDot(ctx, 540, 742 + hover, 330, "rgba(250,204,21,0.55)", 0.3);
    glowDot(ctx, 540, 742 + hover, 180, "rgba(253,230,138,0.75)", 0.28);
    ctx.restore();
    drawSprite(ctx, sprite, {
      x: 540,
      y: 742 + hover,
      height: 520 * breathe,
      alpha: 0.92,
      blend: cutout ? "source-over" : "screen",
    });
  }

  function drawParticles(t) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of particles) {
      p.y -= p.speed;
      p.x += Math.sin(t * 0.8 + p.y * 0.01) * 0.3 + p.drift * 0.1;
      if (p.y < H * 0.34) {
        p.y = H * 0.92;
        p.x = Math.random() * W;
      }
      ctx.globalAlpha = p.alpha * (0.6 + Math.sin(t * 2 + p.y * 0.02) * 0.4);
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBursts() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let index = bursts.length - 1; index >= 0; index -= 1) {
      const burst = bursts[index];
      burst.life -= 0.026;
      if (burst.life <= 0) { bursts.splice(index, 1); continue; }
      const radius = (1 - burst.life) * 260 * burst.power;
      ctx.globalAlpha = burst.life * 0.72;
      ctx.strokeStyle = burst.color;
      ctx.lineWidth = 7 * burst.life;
      ctx.beginPath();
      ctx.arc(burst.x, burst.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      glowDot(ctx, burst.x, burst.y, 90 * burst.life, burst.color, burst.life * 0.5);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // 底部留白处的 HUD 描边框，和背景图里的舞台结构呼应。
  function drawHudFrame() {
    cornerFrame(ctx, 54, 1392, W - 108, 386, "rgba(251,191,36,0.5)", 0.5, 42);
  }

  function formatVotes(value) {
    const number = Math.max(0, Math.round(Number(value) || 0));
    if (number >= 100000000) return `${(number / 100000000).toFixed(1)}亿票`;
    if (number >= 10000) return `${(number / 10000).toFixed(1)}万票`;
    return `${number}票`;
  }

  function frame(timestamp) {
    if (!running) return;
    const dt = lastTs ? Math.min(0.06, (timestamp - lastTs) / 1000) : 0.016;
    lastTs = timestamp;
    time += dt;
    ctx.clearRect(0, 0, W, H);
    backdrop.draw(ctx, time);
    drawNetwork(time);
    drawGuardian(time);
    drawParticles(time);
    drawBursts();
    drawHudFrame();
    rafId = requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function destroy() {
    running = false;
    cancelAnimationFrame(rafId);
    el.replaceChildren();
  }

  return { el, update, effect, destroy };
}

export default createHometownScene;