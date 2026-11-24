// 奔跑羊赛跑 · 场景渲染（Canvas2D，1080×1920）。
// 生图号池的赛博赛道做主视觉，两只机械羊沿透视赛道向终点冲刺。
import { W, H, clamp01, createBackdrop, drawSprite, glowDot, loadImage, prepareCutout } from "./stage-kit.mjs";

const LANES = [
  {
    id: "left",
    label: "左道",
    color: "#38bdf8",
    glow: "rgba(56,189,248,0.55)",
    sprite: "left",
    p0: { x: 304, y: 1216 },
    p1: { x: 306, y: 940 },
    p2: { x: 414, y: 596 },
  },
  {
    id: "right",
    label: "右道",
    color: "#f43f5e",
    glow: "rgba(244,63,94,0.55)",
    sprite: "right",
    p0: { x: 818, y: 1266 },
    p1: { x: 826, y: 986 },
    p2: { x: 700, y: 650 },
  },
];

function pointAt(lane, progress) {
  const p = clamp01(progress);
  const inv = 1 - p;
  const x = inv * inv * lane.p0.x + 2 * inv * p * lane.p1.x + p * p * lane.p2.x;
  const y = inv * inv * lane.p0.y + 2 * inv * p * lane.p1.y + p * p * lane.p2.y;
  return { x, y, scale: 1.0 - p * 0.3 };
}

export function createSheepScene({ assets = {} } = {}) {
  const el = document.createElement("div");
  el.className = "sheep-stage";
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  canvas.style.cssText = `width:${W}px;height:${H}px;display:block`;
  el.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const callouts = document.createElement("div");
  callouts.className = "stage-callouts race-callouts";
  callouts.innerHTML = `
    <div class="callout" style="--c:#38bdf8"><b>扣 1</b><span>左羊</span></div>
    <div class="callout" style="--c:#f43f5e"><b>扣 2</b><span>右羊</span></div>`;
  el.appendChild(callouts);


  const backdrop = createBackdrop({
    url: assets.background || assets.url || "",
    accent: "#38bdf8",
    accent2: "#f43f5e",
    topFade: 300,
    bottomFade: 340,
    particles: 54,
    zoom: 1.03,
  });

  const mainSheep = loadImage(assets.sheep || assets.left || assets.unit || "");
  const sprites = {
    left: mainSheep,
    right: mainSheep,
  };
  const flockSprite = loadImage(assets.sheep || assets.left || assets.unit || "");

  let latest = null;
  let running = true;
  let rafId = 0;
  let time = 0;
  let lastTs = 0;
  const pos = { left: 0, right: 0 };
  const speed = { left: 0, right: 0 };
  const lastPos = { left: 0, right: 0 };
  const dust = [];
  const bursts = [];
  const streaks = [];
  for (let index = 0; index < 44; index += 1) {
    streaks.push({
      x: Math.random() * W,
      y: 500 + Math.random() * 1100,
      len: 40 + Math.random() * 140,
      speed: 180 + Math.random() * 420,
      alpha: 0.06 + Math.random() * 0.16,
    });
  }

  function update(state) { if (state) latest = state; }

  function effect(event) {
    if (!event) return;
    if (!["gift-burst", "cheer", "like-wave", "follow-spark", "summon", "vote"].includes(event.type)) return;
    const id = event.team === "right" ? "right" : "left";
    const lane = LANES.find((row) => row.id === id);
    const point = pointAt(lane, pos[id]);
    for (let index = 0; index < 14; index += 1) {
      dust.push({
        x: point.x + (Math.random() - 0.5) * 120,
        y: point.y + 60 + Math.random() * 40,
        vx: -40 - Math.random() * 140,
        vy: 30 + Math.random() * 120,
        life: 1,
        size: 3 + Math.random() * 9,
        color: lane.color,
      });
    }
    bursts.push({ x: point.x, y: point.y, life: 1, color: lane.color });
  }

  function drawTrack(t) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const lane of LANES) {
      // 沿贝塞尔曲线铺一条半透明能量跑道
      ctx.strokeStyle = lane.color;
      ctx.globalAlpha = 0.10;
      ctx.lineWidth = 210;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(lane.p0.x, lane.p0.y);
      ctx.quadraticCurveTo(lane.p1.x, lane.p1.y, lane.p2.x, lane.p2.y);
      ctx.stroke();

      ctx.globalAlpha = 0.34;
      ctx.lineWidth = 3;
      ctx.setLineDash([30, 46]);
      ctx.lineDashOffset = -t * 120;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        const offset = 108;
        ctx.moveTo(lane.p0.x + side * offset, lane.p0.y);
        ctx.quadraticCurveTo(lane.p1.x + side * offset, lane.p1.y, lane.p2.x + side * offset * 0.6, lane.p2.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawFinishGate(t) {
    const gateX = W / 2;
    const gateY = 520;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    glowDot(ctx, gateX, gateY, 340, "rgba(251,191,36,0.18)", 0.7 + Math.sin(t * 2) * 0.1);
    for (let index = 0; index < 3; index += 1) {
      const radius = 210 + index * 54;
      ctx.strokeStyle = index % 2 ? "rgba(56,189,248,0.24)" : "rgba(251,191,36,0.32)";
      ctx.lineWidth = index === 0 ? 3 : 1.5;
      ctx.setLineDash(index === 0 ? [] : [12, 26]);
      ctx.lineDashOffset = t * (index % 2 ? 40 : -22);
      ctx.beginPath();
      ctx.arc(gateX, gateY, radius, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const beam = ctx.createLinearGradient(0, gateY - 40, 0, gateY + 330);
    beam.addColorStop(0, "rgba(251,191,36,0.28)");
    beam.addColorStop(1, "rgba(251,191,36,0)");
    ctx.fillStyle = beam;
    ctx.fillRect(gateX - 170, gateY - 40, 340, 370);
    ctx.restore();
  }

  function drawStreaks(t) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const streak of streaks) {
      streak.y -= streak.speed * 0.016;
      if (streak.y < 460) { streak.y = 1650; streak.x = Math.random() * W; }
      const gradient = ctx.createLinearGradient(0, streak.y, 0, streak.y + streak.len);
      gradient.addColorStop(0, `rgba(180,230,255,${streak.alpha})`);
      gradient.addColorStop(1, "rgba(180,230,255,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(streak.x, streak.y, 2, streak.len);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // 羊群：每队 26 只小羊跟随主羊推进，制造抖音同类的“羊海”观感
  const flock = [];
  for (const lane of LANES) {
    for (let index = 0; index < 26; index += 1) {
      flock.push({
        lane: lane.id,
        back: index * 0.0042 + Math.random() * 0.002,
        side: (Math.random() - 0.5) * 2,
        bob: Math.random() * Math.PI * 2,
        scale: 0.72 + Math.random() * 0.5,
        plate: Math.random() < 0.72,
      });
    }
  }

  function drawFlock(t) {
    const cutout = prepareCutout(flockSprite);
    const sprite = cutout || flockSprite;
    if (!sprite || !(sprite.naturalWidth || sprite.width)) return;
    for (const sheep of flock) {
      const lane = LANES.find((row) => row.id === sheep.lane);
      if (!lane) continue;
      const point = pointAt(lane, Math.max(0.002, pos[lane.id] - sheep.back * 0.55));
      const height = 104 * point.scale * sheep.scale;
      const sway = Math.sin(t * 7 + sheep.bob) * 4;
      const x = point.x + sheep.side * 168 * point.scale + sway;
      const y = point.y + 52 + Math.sin(t * 3.4 + sheep.bob) * 5;
      drawSprite(ctx, sprite, {
        x,
        y,
        height,
        alpha: 0.92,
        rotation: sheep.side * 0.06,
        blend: cutout ? "source-over" : "screen",
      });
      if (sheep.plate) {
        ctx.save();
        ctx.globalAlpha = 0.92;
        ctx.beginPath();
        ctx.arc(x, y - height * 0.92, 12 * point.scale, 0, Math.PI * 2);
        ctx.fillStyle = lane.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(255,255,255,.85)";
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawSheep(lane, t) {
    const point = pointAt(lane, pos[lane.id]);
    const height = 258 * point.scale;
    const image = sprites[lane.id];
    const cutout = prepareCutout(image);
    const sprite = cutout || image;
    const blend = cutout ? "source-over" : "screen";
    const lean = (pointAt(lane, Math.min(1, pos[lane.id] + 0.01)).x - point.x) * 0.02;
    const vibration = Math.sin(t * 26 + (lane.id === "left" ? 0 : 2)) * 2.4;

    // 残影
    for (let index = 3; index >= 1; index -= 1) {
      const ghost = pointAt(lane, Math.max(0, pos[lane.id] - index * 0.018));
      drawSprite(ctx, sprite, {
        x: ghost.x,
        y: ghost.y + index * 14,
        height: height * (1 - index * 0.02),
        alpha: 0.042 * (4 - index),
        rotation: lean,
        blend,
      });
    }

    // 推进器光焰
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const flare = clamp01(speed[lane.id] * 1.8);
    glowDot(ctx, point.x - 40 * point.scale, point.y + 130 * point.scale, 90 * point.scale * (0.5 + flare), lane.glow, 0.5 + flare * 0.4);
    ctx.restore();

    drawSprite(ctx, sprite, {
      x: point.x + vibration,
      y: point.y,
      height,
      alpha: 1,
      rotation: lean,
      blend,
    });

    // 跑动尘土
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let index = 0; index < 3; index += 1) {
      const px = point.x + 40 * point.scale + (Math.random() - 0.5) * 70;
      const py = point.y + 150 * point.scale + (Math.random() - 0.5) * 26;
      glowDot(ctx, px, py, 12 + Math.random() * 18, lane.glow, 0.12 + Math.random() * 0.16);
    }
    ctx.restore();
  }

  function drawDust() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let index = dust.length - 1; index >= 0; index -= 1) {
      const particle = dust[index];
      particle.life -= 0.028;
      if (particle.life <= 0) { dust.splice(index, 1); continue; }
      particle.x += particle.vx * 0.016;
      particle.y += particle.vy * 0.016;
      particle.vy += 2.2;
      ctx.globalAlpha = particle.life * 0.7;
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size * particle.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawBursts() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let index = bursts.length - 1; index >= 0; index -= 1) {
      const burst = bursts[index];
      burst.life -= 0.04;
      if (burst.life <= 0) { bursts.splice(index, 1); continue; }
      const radius = (1 - burst.life) * 180;
      ctx.globalAlpha = burst.life * 0.55;
      ctx.strokeStyle = burst.color;
      ctx.lineWidth = 5 * burst.life;
      ctx.beginPath();
      ctx.arc(burst.x, burst.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function frame(timestamp) {
    if (!running) return;
    const dt = lastTs ? Math.min(0.06, (timestamp - lastTs) / 1000) : 0.016;
    lastTs = timestamp;
    time += dt;
    const teams = latest?.teams || [];
    for (const lane of LANES) {
      const team = teams.find((row) => row.id === lane.id);
      const target = clamp01(team?.progress);
      const before = pos[lane.id];
      pos[lane.id] += (target - pos[lane.id]) * 0.12;
      const instant = Math.abs(pos[lane.id] - before) / Math.max(dt, 0.001);
      speed[lane.id] = speed[lane.id] * 0.86 + instant * 0.14;
      lastPos[lane.id] = pos[lane.id];
    }
    ctx.clearRect(0, 0, W, H);
    backdrop.draw(ctx, time);
    drawTrack(time);
    drawStreaks(time);
    drawFinishGate(time);
    drawFlock(time);
    for (const lane of LANES) drawSheep(lane, time);
    drawDust();
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

export default createSheepScene;