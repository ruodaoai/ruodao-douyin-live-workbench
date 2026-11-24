// 三国壮志 · 场景渲染（Canvas2D，1080×1920）。
// 生图号池主将 + 古战场主视觉 + 三阵营兵线，全部为纯视觉层，胜负仍由 Node 权威模拟决定。
import { W, H, clamp01, createBackdrop, glowDot, hexagon } from "./stage-kit.mjs";

const FT = 330;
const FB = 1580;
const TEAM = {
  shu: { color: "#facc15", glow: "rgba(250,204,21,0.55)", light: "#fde68a" },
  wu: { color: "#38bdf8", glow: "rgba(56,189,248,0.55)", light: "#7dd3fc" },
  wei: { color: "#f43f5e", glow: "rgba(244,63,94,0.55)", light: "#fb7185" },
};
const KIND_COLOR = ["#86efac", "#38bdf8", "#a78bfa", "#facc15", "#fb923c", "#2dd4bf", "#f8fafc"];
const BANNERS = [
  { x: 0.13, color: "#facc15", label: "\u8700", delay: 0, team: "shu" },
  { x: 0.5, color: "#38bdf8", label: "\u5434", delay: 1.4, team: "wu" },
  { x: 0.87, color: "#f43f5e", label: "\u9b4f", delay: 2.2, team: "wei" },
];

export function createThreeKingdomsScene({ assets = {} } = {}) {
  const el = document.createElement("div");
  el.className = "three-kingdoms-stage";
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  canvas.style.cssText = `width:${W}px;height:${H}px;display:block`;
  el.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const callouts = document.createElement("div");
  callouts.className = "stage-callouts lanes-callouts";
  callouts.innerHTML = `
    <div class="callout" style="--c:#facc15"><b>扣 1</b><span>蜀国</span></div>
    <div class="callout" style="--c:#38bdf8"><b>扣 2</b><span>吴国</span></div>
    <div class="callout" style="--c:#f43f5e"><b>扣 3</b><span>魏国</span></div>`;
  el.appendChild(callouts);


  const backdrop = createBackdrop({
    url: assets.background || assets.url || "",
    accent: "#f59e0b",
    accent2: "#38bdf8",
    topFade: 330,
    bottomFade: 330,
    particles: 46,
    zoom: 1.02,
    dim: 0.24,
  });

  let latest = null;
  let running = true;
  let rafId = 0;
  let time = 0;
  let lastTs = 0;
  const bursts = [];
  const positions = new Map();
  const motes = [];
  for (let index = 0; index < 64; index += 1) {
    const baseY = FT + Math.random() * (FB - FT);
    motes.push({
      baseY,
      x: Math.random() * W,
      y: baseY,
      r: 1 + Math.random() * 2.4,
      vy: -(6 + Math.random() * 22),
      sway: 6 + Math.random() * 18,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.1 + Math.random() * 0.32,
      warm: Math.random() < 0.55,
    });
  }

  function update(state) { if (state) latest = state; }

  function effect(event) {
    if (!event) return;
    if (!["gift-burst", "join", "summon", "cheer", "like-wave", "follow-spark", "levelup"].includes(event.type)) return;
    const team = TEAM[event.team] ? event.team : "wei";
    bursts.push({
      x: team === "shu" ? W * 0.14 : team === "wu" ? W * 0.86 : W * 0.5,
      y: FT + (FB - FT) * (0.25 + Math.random() * 0.5),
      life: 1,
      color: TEAM[team].color,
      power: 0.7 + Math.random() * 0.7,
    });
  }

  const px = (x) => 70 + clamp01(x) * (W - 140);
  const py = (y) => FT + clamp01(y) * (FB - FT);

  function drawBanners(t) {
    const TOP = 1180;
    const BASE = 1500;
    for (const banner of BANNERS) {
      const x = banner.x * W;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";

      const column = ctx.createLinearGradient(0, TOP, 0, BASE);
      column.addColorStop(0, "rgba(0,0,0,0)");
      column.addColorStop(0.28, `${banner.color}0c`);
      column.addColorStop(0.74, `${banner.color}1e`);
      column.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = column;
      ctx.beginPath();
      ctx.moveTo(x - 38, TOP);
      ctx.lineTo(x + 38, TOP);
      ctx.lineTo(x + 88, BASE);
      ctx.lineTo(x - 88, BASE);
      ctx.closePath();
      ctx.fill();

      for (let index = 0; index < 6; index += 1) {
        const phase = (t * 0.16 + index / 6 + banner.delay * 0.11) % 1;
        const py2 = BASE - phase * (BASE - TOP);
        const px2 = x + Math.sin(phase * 7 + banner.delay + index) * 54;
        glowDot(ctx, px2, py2, 20 + phase * 16, banner.color, (1 - phase) * 0.5);
      }

      const pulse = 0.9 + Math.sin(t * 1.6 + banner.delay) * 0.08;
      ctx.strokeStyle = banner.color;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(x, BASE, 132 * pulse, 32 * pulse, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = 2;
      ctx.setLineDash([16, 22]);
      ctx.lineDashOffset = -t * 26;
      ctx.beginPath();
      ctx.ellipse(x, BASE, 176 * pulse, 44 * pulse, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      const lift = Math.sin(t * 1.1 + banner.delay) * 8;
      ctx.globalAlpha = 0.12;
      ctx.font = '900 88px "Microsoft YaHei","Noto Sans SC",sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = banner.color;
      ctx.shadowColor = banner.color;
      ctx.shadowBlur = 46;
      ctx.fillText(banner.label, x, BASE - 74 + lift);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  function drawLanes(t) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const [team, x] of [["shu", 113], ["wu", 540], ["wei", 967]]) {
      const meta = TEAM[team];
      const gradient = ctx.createLinearGradient(0, FT, 0, FB);
      gradient.addColorStop(0, "rgba(0,0,0,0)");
      gradient.addColorStop(0.5, `${meta.color}14`);
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(x - 78, FT, 156, FB - FT);
      const dash = ctx.createLinearGradient(0, FT, 0, FB);
      dash.addColorStop(0, "rgba(0,0,0,0)");
      dash.addColorStop(0.5, `${meta.color}66`);
      dash.addColorStop(1, "rgba(0,0,0,0)");
      ctx.strokeStyle = dash;
      ctx.lineWidth = 2;
      ctx.setLineDash([26, 40]);
      ctx.lineDashOffset = -t * 26;
      ctx.beginPath();
      ctx.moveTo(x - 78, FT);
      ctx.lineTo(x - 78, FB);
      ctx.moveTo(x + 78, FT);
      ctx.lineTo(x + 78, FB);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  // 阵营人海：纯装饰层，制造抖音同类玩法的高密度战场观感
  const crowd = [];
  for (const team of ["shu", "wu", "wei"]) {
    for (let index = 0; index < 150; index += 1) {
      crowd.push({
        team,
        sx: Math.random(),
        sy: Math.random(),
        jitter: (Math.random() - 0.5) * 26,
        phase: Math.random() * Math.PI * 2,
        scale: 0.7 + Math.random() * 0.7,
      });
    }
  }
  const CROWD_X = { shu: 113, wu: 540, wei: 967 };

  function drawCrowd(t) {
    for (const person of crowd) {
      const meta = TEAM[person.team];
      const cx = CROWD_X[person.team] + (person.sx - 0.5) * 236 + person.jitter;
      const wave = Math.sin(t * 1.6 + person.phase) * 10;
      const cy = FT + 40 + person.sy * (FB - FT - 120) + wave;
      const size = 6.4 * person.scale;
      const bob = Math.sin(t * 4 + person.phase) * 2.2;
      ctx.save();
      ctx.globalAlpha = 0.34 + person.scale * 0.22;
      // 身体（梯形甲胄）
      ctx.fillStyle = meta.color;
      ctx.beginPath();
      ctx.moveTo(cx - size * 1.05, cy + size * 1.7 + bob);
      ctx.lineTo(cx - size * 0.62, cy - size * 0.15 + bob);
      ctx.lineTo(cx + size * 0.62, cy - size * 0.15 + bob);
      ctx.lineTo(cx + size * 1.05, cy + size * 1.7 + bob);
      ctx.closePath();
      ctx.fill();
      // 头
      ctx.fillStyle = meta.light;
      ctx.beginPath();
      ctx.arc(cx, cy - size * 0.85 + bob, size * 0.58, 0, Math.PI * 2);
      ctx.fill();
      // 长枪
      ctx.globalAlpha *= 0.75;
      ctx.strokeStyle = meta.light;
      ctx.lineWidth = Math.max(1, size * 0.14);
      ctx.beginPath();
      ctx.moveTo(cx + size * 0.9, cy - size * 2.3 + bob);
      ctx.lineTo(cx + size * 0.65, cy + size * 1.5 + bob);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawUnits(t) {
    const units = latest?.units || [];
    const seen = new Set();
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const unit of units) {
      if (!unit?.id) continue;
      seen.add(unit.id);
      const targetX = px(unit.x);
      const targetY = py(unit.y);
      let node = positions.get(unit.id);
      if (!node) {
        node = { x: targetX, y: targetY, tx: targetX, ty: targetY, born: t, team: unit.team };
        positions.set(unit.id, node);
      }
      node.tx = targetX;
      node.ty = targetY;
      node.team = unit.team;
      node.x += (targetX - node.x) * 0.24;
      node.y += (targetY - node.y) * 0.24;

      const meta = TEAM[unit.team] || TEAM.wei;
      const kindIndex = Math.max(0, Math.min(KIND_COLOR.length - 1, Number(unit.kindIndex) || 0));
      const color = KIND_COLOR[kindIndex];
      const radius = Math.max(10, Math.min(23, (Number(unit.r) || 10) * 1.0));
      const bob = Math.sin(t * 6 + node.x * 0.02) * 2;
      const x = node.x;
      const y = node.y + bob;

      // 拖尾：从上一帧方向拉出速度感
      const dx = node.tx - node.x;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.16;
      ctx.lineWidth = radius * 0.9;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x - dx * 5, y);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // 地面投影
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.beginPath();
      ctx.ellipse(x, y + radius * 0.9, radius * 0.9, radius * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "lighter";

      // 阵营光晕 + 兵种本体
      glowDot(ctx, x, y, radius * 3.2, meta.glow, 0.8);
      ctx.fillStyle = "rgba(2,6,14,0.88)";
      hexagon(ctx, x, y, radius + 4, Math.PI / 6 + t * 0.8);
      ctx.fill();
      ctx.fillStyle = color;
      hexagon(ctx, x, y, radius, Math.PI / 6 + t * 0.8);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.92)";
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.34, 0, Math.PI * 2);
      ctx.fill();

      if (kindIndex >= 4) {
        const ringPhase = t * 2.4 + node.x;
        ctx.strokeStyle = meta.light;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, radius + 7 + Math.sin(ringPhase) * 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (kindIndex >= 6) {
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 1.4;
        hexagon(ctx, x, y, radius + 13, -t * 1.2);
        ctx.stroke();
      }
    }
    ctx.restore();
    for (const id of positions.keys()) if (!seen.has(id)) positions.delete(id);
  }

  function drawMotes(t) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const mote of motes) {
      const span = FB - FT;
      const y = FT + ((((mote.baseY - FT + mote.vy * t) % span) + span) % span);
      const x = mote.x + Math.sin(t * 0.8 + mote.phase) * mote.sway;
      ctx.globalAlpha = mote.alpha * (0.55 + Math.sin(t * 1.6 + mote.phase) * 0.45);
      ctx.fillStyle = mote.warm ? "#fbbf24" : "#7dd3fc";
      ctx.beginPath();
      ctx.arc(x, y, mote.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBursts() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let index = bursts.length - 1; index >= 0; index -= 1) {
      const burst = bursts[index];
      burst.life -= 0.032;
      if (burst.life <= 0) { bursts.splice(index, 1); continue; }
      const radius = (1 - burst.life) * 130 * burst.power;
      ctx.globalAlpha = burst.life * 0.14;
      ctx.strokeStyle = burst.color;
      ctx.lineWidth = 3.5 * burst.life;
      ctx.beginPath();
      ctx.arc(burst.x, burst.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      glowDot(ctx, burst.x, burst.y, 86 * burst.life, burst.color, burst.life * 0.28);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function frame(timestamp) {
    if (!running) return;
    const dt = lastTs ? Math.min(0.06, (timestamp - lastTs) / 1000) : 0.016;
    lastTs = timestamp;
    time += dt;
    ctx.clearRect(0, 0, W, H);
    backdrop.draw(ctx, time);
    drawBanners(time);
    drawLanes(time);
    drawCrowd(time);
    drawUnits(time);
    drawMotes(time);
    drawBursts();
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

export default createThreeKingdomsScene;