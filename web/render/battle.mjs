// 人类 VS 丧尸 · 战场渲染（Canvas2D，1080×1920 竖屏）。
// 唯一权威状态来自 Node 快照，这里只做插值与视觉表现，不参与胜负判定。
// 采用原生 Canvas2D：零依赖、无需 unsafe-eval，完全兼容 script-src 'self' 的 CSP。

const W = 1080;
const H = 1920;
const FIELD_TOP = 250;
const FIELD_BOTTOM = 1560;

const TEAM = {
  human: { color: "#38bdf8", glow: "#7dd3fc", base: "#0ea5e9", dark: "#0b3a56" },
  zombie: { color: "#f43f5e", glow: "#fb7185", base: "#e11d48", dark: "#3f0a1a" },
};
const LANE_DEFS = [
  { l: 0.28, tint: "rgba(30,58,138,0.30)" },
  { l: 0.5, tint: "rgba(22,78,99,0.30)" },
  { l: 0.72, tint: "rgba(59,7,100,0.30)" },
];

function laneX(lane) {
  const l = Number.isFinite(lane) ? lane : 0.5;
  return 170 + l * 740;
}
function progressY(progress) {
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  return FIELD_BOTTOM - p * (FIELD_BOTTOM - FIELD_TOP);
}

export function createBattleScene() {
  const el = document.createElement("div");
  el.className = "battle-stage";
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  canvas.style.display = "block";
  el.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const bg = document.createElement("canvas");
  bg.width = W;
  bg.height = H;
  paintBackground(bg.getContext("2d"));

  const units = new Map(); // id -> { x,y,tx,ty,team,level,hp,r }
  const particles = [];
  let latest = null;
  let running = true;
  let pulse = 0;
  let lastTs = 0;

  function reconcile(state) {
    const seen = new Set();
    const list = Array.isArray(state.units) ? state.units : [];
    for (const u of list) {
      seen.add(u.id);
      let s = units.get(u.id);
      if (!s) {
        s = { x: laneX(u.y), y: progressY(u.x), tx: 0, ty: 0, team: u.team, level: u.level ?? 0, hp: 1, r: u.r || 10, born: performance.now() };
        units.set(u.id, s);
      }
      s.tx = laneX(u.y);
      s.ty = progressY(u.x);
      s.level = u.level ?? 0;
      s.hp = Math.max(0, Math.min(1, (u.hp || 0) / (u.maxHp || 1)));
    }
    for (const [id, s] of units) {
      if (!seen.has(id)) s.gone = true;
    }
  }

  function burst(x, y, color, count = 26, power = 1) {
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const sp = (2 + Math.random() * 5) * power;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1.2,
        life: 1,
        decay: 0.012 + Math.random() * 0.02,
        size: 2 + Math.random() * 4 * power,
        color,
      });
    }
  }

  function drawBase(t, team, teamMeta) {
    const top = team === "zombie";
    const cy = top ? FIELD_TOP - 70 : FIELD_BOTTOM + 70;
    ctx.save();
    ctx.globalAlpha = 0.2 + Math.sin(pulse * 3.4 + (top ? 1 : 2)) * 0.06;
    ctx.fillStyle = teamMeta.base;
    ctx.beginPath();
    ctx.ellipse(W / 2, cy, 460, 70, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = teamMeta.color;
    ctx.globalAlpha = 0.28;
    ctx.beginPath();
    ctx.ellipse(W / 2, cy, 300, 44, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const glow = 0.6 + Math.sin(pulse * 3.4) * 0.25;
    ctx.save();
    ctx.globalAlpha = glow;
    const grad = ctx.createRadialGradient(W / 2, cy, 10, W / 2, cy, 140);
    grad.addColorStop(0, teamMeta.glow);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(W / 2, cy, 140, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = teamMeta.base;
    ctx.strokeStyle = teamMeta.glow;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(W / 2, cy, 96, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(11,16,32,0.72)";
    ctx.beginPath();
    ctx.arc(W / 2, cy, 58, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawUnit(s) {
    const meta = TEAM[s.team];
    const k = Math.min(1, (performance.now() - s.born) / 220);
    const r = (10 + Math.min(7, s.level) * 3.4) * (0.6 + 0.4 * k);
    ctx.save();
    ctx.translate(s.x, s.y);
    if (s.gone) ctx.globalAlpha = Math.max(0, (s.x + 999) ? 1 : 0);
    // 阴影
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.beginPath();
    ctx.ellipse(0, r * 1.1, r * 1.3, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    const bob = Math.sin(pulse * 6 + (s.x + s.y) * 0.05) * 1.5;
    ctx.translate(0, bob);
    if (s.team === "zombie") ctx.scale(-1, 1);

    ctx.shadowColor = meta.glow;
    ctx.shadowBlur = 12;
    if (s.team === "human") {
      ctx.fillStyle = meta.color;
      roundRect(ctx, -r, -r * 1.25, r * 2, r * 2.1, r * 0.4);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = meta.glow;
      roundRect(ctx, -r * 0.55, -r * 1.75, r * 1.1, r * 0.95, r * 0.3);
      ctx.fill();
      ctx.strokeStyle = "rgba(224,242,254,0.7)";
      ctx.lineWidth = 2;
      roundRect(ctx, -r, -r * 1.25, r * 2, r * 2.1, r * 0.4);
      ctx.stroke();
    } else {
      ctx.fillStyle = meta.color;
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.4);
      ctx.lineTo(r, r * 0.6);
      ctx.lineTo(r * 0.55, r * 1.2);
      ctx.lineTo(-r * 0.55, r * 1.2);
      ctx.lineTo(-r, r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(26,11,22,0.85)";
      ctx.beginPath();
      ctx.arc(0, -r * 0.3, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fecaca";
      ctx.beginPath();
      ctx.arc(-r * 0.22, -r * 0.42, r * 0.13, 0, Math.PI * 2);
      ctx.arc(r * 0.22, -r * 0.42, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,228,230,0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.4);
      ctx.lineTo(r, r * 0.6);
      ctx.lineTo(r * 0.55, r * 1.2);
      ctx.lineTo(-r * 0.55, r * 1.2);
      ctx.lineTo(-r, r * 0.6);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();

    // 血条
    const bw = 44;
    const bx = s.x - bw / 2;
    const by = s.y - r - 18;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(bx, by, bw, 5);
    ctx.fillStyle = s.hp > 0.5 ? "#22c55e" : s.hp > 0.25 ? "#f59e0b" : "#ef4444";
    ctx.fillRect(bx, by, bw * s.hp, 5);
    ctx.restore();
  }

  function frame(ts) {
    if (!running) return;
    const dt = Math.min(64, lastTs ? ts - lastTs : 16);
    lastTs = ts;
    pulse += dt / 1000;
    const k = Math.min(1, dt / 90);

    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bg, 0, 0);

    // 中间防御塔（装饰）
    const midY = (FIELD_TOP + FIELD_BOTTOM) / 2;
    ctx.save();
    ctx.fillStyle = "rgba(31,41,55,0.55)";
    roundRect(ctx, W / 2 - 34, midY - 120, 68, 240, 12);
    ctx.fill();
    ctx.fillStyle = "rgba(51,65,85,0.7)";
    roundRect(ctx, W / 2 - 52, midY - 140, 104, 40, 10);
    ctx.fill();
    ctx.fillStyle = "rgba(250,204,21,0.5)";
    ctx.beginPath();
    ctx.arc(W / 2, midY, 16 + Math.sin(pulse * 4) * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawBase(1, "zombie", TEAM.zombie);
    drawBase(2, "human", TEAM.human);

    // 单位插值
    for (const [id, s] of units) {
      s.x += (s.tx - s.x) * k;
      s.y += (s.ty - s.y) * k;
      if (s.gone) {
        s.fade = (s.fade ?? 1) - dt / 320;
        if (s.fade <= 0) { units.delete(id); continue; }
        ctx.save();
        ctx.globalAlpha = Math.max(0, s.fade);
        drawUnit(s);
        ctx.restore();
      } else {
        drawUnit(s);
      }
    }

    // 粒子
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.x += p.vx * (dt / 16);
      p.y += p.vy * (dt / 16);
      p.vy += 0.14;
      p.vx *= 0.985;
      p.life -= p.decay * (dt / 16);
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.6, p.size * p.life), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    requestAnimationFrame(frame);
  }

  function update(state) {
    if (!state) return;
    latest = state;
    reconcile(state);
  }

  function effect() {}

  function destroy() {
    running = false;
    units.clear();
    particles.length = 0;
    el.replaceChildren();
  }

  requestAnimationFrame(frame);
  return { el, update, effect, destroy };
}

function paintBackground(g) {
  // 上下渐层
  const fieldGrad = g.createLinearGradient(0, FIELD_TOP, 0, FIELD_BOTTOM);
  fieldGrad.addColorStop(0, "#140a12");
  fieldGrad.addColorStop(0.5, "#0b1020");
  fieldGrad.addColorStop(1, "#081020");
  g.fillStyle = fieldGrad;
  g.fillRect(0, FIELD_TOP, W, FIELD_BOTTOM - FIELD_TOP);
  g.fillStyle = "#1a0b16";
  g.fillRect(0, 0, W, FIELD_TOP);
  g.fillStyle = "#081020";
  g.fillRect(0, FIELD_BOTTOM, W, H - FIELD_BOTTOM);

  // 三条兵线
  for (const lane of LANE_DEFS) {
    const x = laneX(lane.l);
    g.fillStyle = lane.tint;
    roundRect(g, x - 74, FIELD_TOP, 148, FIELD_BOTTOM - FIELD_TOP, 30);
    g.fill();
    g.strokeStyle = "rgba(45,212,191,0.16)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, FIELD_TOP);
    g.lineTo(x, FIELD_BOTTOM);
    g.stroke();
  }

  // 中线虚线
  const midY = (FIELD_TOP + FIELD_BOTTOM) / 2;
  g.strokeStyle = "rgba(100,116,139,0.28)";
  g.lineWidth = 3;
  for (let x = 40; x < W - 40; x += 46) {
    g.beginPath();
    g.moveTo(x, midY);
    g.lineTo(x + 26, midY);
    g.stroke();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export default createBattleScene;