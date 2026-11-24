// 2D 舞台共用视觉层：主视觉背景、色彩分级、扫描线、尘埃、光效与立绘辅助。
// 所有绘制都用原生 Canvas2D，不引入新依赖，兼容 script-src 'self' 的 CSP。

export const W = 1080;
export const H = 1920;

export function clamp01(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

export function loadImage(url) {
  const image = new Image();
  image.decoding = "async";
  if (url) image.src = url;
  return image;
}

export function isReady(image) {
  return Boolean(image && image.complete && image.naturalWidth > 0);
}

export function drawCover(ctx, image, { width = W, height = H, zoom = 1, offsetX = 0, offsetY = 0 } = {}) {
  if (!isReady(image)) return false;
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight) * zoom;
  const drawW = image.naturalWidth * scale;
  const drawH = image.naturalHeight * scale;
  ctx.drawImage(image, (width - drawW) / 2 + offsetX, (height - drawH) / 2 + offsetY, drawW, drawH);
  return true;
}

function motes(count) {
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    rows.push({
      x: Math.random() * W,
      y: Math.random() * H,
      r: 0.8 + Math.random() * 2.6,
      speed: 6 + Math.random() * 26,
      sway: 8 + Math.random() * 26,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.16 + Math.random() * 0.45,
      hue: Math.random() < 0.5 ? "ice" : "warm",
    });
  }
  return rows;
}

/**
 * 主视觉背景 + 统一色彩分级。
 * 背景图未加载完成时用同色系渐变兜底，直播不会黑屏。
 */
export function createBackdrop({
  url = "",
  accent = "#38bdf8",
  accent2 = "#f43f5e",
  zoom = 1,
  topFade = 220,
  bottomFade = 260,
  particles = 58,
  dim = 0,
  base = "#05080f",
} = {}) {
  const image = loadImage(url);
  const dust = motes(particles);

  return {
    image,
    draw(ctx, time = 0) {
      const fallback = ctx.createLinearGradient(0, 0, 0, H);
      fallback.addColorStop(0, "#0a1020");
      fallback.addColorStop(0.52, "#070b16");
      fallback.addColorStop(1, "#03050a");
      ctx.fillStyle = fallback;
      ctx.fillRect(0, 0, W, H);

      const breathe = 1 + Math.sin(time * 0.06) * 0.008;
      drawCover(ctx, image, { zoom: zoom * breathe });
      if (dim > 0) {
        ctx.fillStyle = `rgba(3, 6, 13, ${dim})`;
        ctx.fillRect(0, 0, W, H);
      }

      // 环境色：让画面统一在阵营色里，而不是生图原色各说各话。
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const left = ctx.createRadialGradient(W * 0.18, H * 0.62, 30, W * 0.18, H * 0.62, 780);
      left.addColorStop(0, `${accent}2e`);
      left.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = left;
      ctx.fillRect(0, 0, W, H);
      const right = ctx.createRadialGradient(W * 0.82, H * 0.7, 30, W * 0.82, H * 0.7, 820);
      right.addColorStop(0, `${accent2}2a`);
      right.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = right;
      ctx.fillRect(0, 0, W, H);
      const topGlow = ctx.createRadialGradient(W * 0.5, H * 0.26, 20, W * 0.5, H * 0.26, 620);
      topGlow.addColorStop(0, "rgba(255,255,255,0.10)");
      topGlow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = topGlow;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();

      // 顶部 / 底部压暗，保证标题与 HUD 可读。
      const head = ctx.createLinearGradient(0, 0, 0, topFade);
      head.addColorStop(0, "rgba(2,5,12,0.92)");
      head.addColorStop(0.55, "rgba(2,5,12,0.42)");
      head.addColorStop(1, "rgba(2,5,12,0)");
      ctx.fillStyle = head;
      ctx.fillRect(0, 0, W, topFade);
      const foot = ctx.createLinearGradient(0, H - bottomFade, 0, H);
      foot.addColorStop(0, "rgba(2,5,12,0)");
      foot.addColorStop(0.6, "rgba(2,5,12,0.55)");
      foot.addColorStop(1, "rgba(2,5,12,0.94)");
      ctx.fillStyle = foot;
      ctx.fillRect(0, H - bottomFade, W, bottomFade);

      // 扫描线与暗角
      ctx.save();
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = "#9ad8ff";
      for (let y = 0; y < H; y += 5) ctx.fillRect(0, y, W, 1);
      ctx.restore();
      const vignette = ctx.createRadialGradient(W / 2, H * 0.48, H * 0.2, W / 2, H * 0.5, H * 0.72);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,0.62)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, W, H);

      // 缓慢上升的舞台尘埃
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const mote of dust) {
        const y = (mote.y - time * mote.speed) % H;
        const wrapped = y < 0 ? y + H : y;
        const x = mote.x + Math.sin(time * 0.7 + mote.phase) * mote.sway;
        const color = mote.hue === "ice" ? accent : accent2;
        ctx.globalAlpha = mote.alpha * (0.55 + Math.sin(time * 1.6 + mote.phase) * 0.45);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, wrapped, mote.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    },
  };
}

export function glowDot(ctx, x, y, radius, color, alpha = 1) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = alpha;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function hexagon(ctx, x, y, radius, rotation = 0) {
  ctx.beginPath();
  for (let index = 0; index < 6; index += 1) {
    const angle = rotation + (index / 6) * Math.PI * 2;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

const cutoutCache = new WeakMap();

/** 把纯黑底立绘处理成带 alpha 的透明画布，亮背景上也能清楚看到主将。 */
export function prepareCutout(image, { threshold = 9, range = 26, boost = 1.16 } = {}) {
  if (!image || !(image instanceof HTMLImageElement) || !isReady(image)) return null;
  const cached = cutoutCache.get(image);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  try {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = pixels.data;
    for (let index = 0; index < data.length; index += 4) {
      const lum = Math.max(data[index], data[index + 1], data[index + 2]);
      const alpha = lum <= threshold ? 0 : lum >= threshold + range ? 255 : Math.round(((lum - threshold) / range) * 255);
      data[index + 3] = alpha;
      if (alpha > 0) {
        data[index] = Math.min(255, Math.round(data[index] * boost + 8));
        data[index + 1] = Math.min(255, Math.round(data[index + 1] * boost + 8));
        data[index + 2] = Math.min(255, Math.round(data[index + 2] * boost + 8));
      }
    }
    context.putImageData(pixels, 0, 0);
    cutoutCache.set(image, canvas);
    return canvas;
  } catch {
    return image;
  }
}

/** 画一张黑底立绘，用 screen 混合自动隐去黑底，保持边缘发光。 */
export function drawSprite(ctx, image, { x, y, height, alpha = 1, flip = false, blend = "screen", rotation = 0 }) {
  if (!image || !height) return false;
  const sourceWidth = image.naturalWidth || image.width || 0;
  const sourceHeight = image.naturalHeight || image.height || 0;
  if (!sourceWidth || !sourceHeight) return false;
  if (image instanceof HTMLImageElement && !isReady(image)) return false;
  const width = height * (sourceWidth / sourceHeight);
  ctx.save();
  ctx.globalCompositeOperation = blend;
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  if (rotation) ctx.rotate(rotation);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  ctx.restore();
  return true;
}

/** 主将全息底座：椭圆光环 + 垂直光柱 + 切角边框。 */
export function holoBase(ctx, x, y, width, color, time = 0, alpha = 1) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = alpha;
  const pulse = 0.9 + Math.sin(time * 2.2) * 0.08;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(x, y, width * 0.52 * pulse, width * 0.13 * pulse, 0, 0, Math.PI * 2);
  ctx.stroke();
  const column = ctx.createLinearGradient(0, y - 260, 0, y);
  column.addColorStop(0, "rgba(0,0,0,0)");
  column.addColorStop(1, `${color}55`);
  ctx.fillStyle = column;
  ctx.fillRect(x - width * 0.5, y - 260, width, 260);
  ctx.restore();
  ctx.globalAlpha = 1;
}

export function cornerFrame(ctx, x, y, width, height, color, alpha = 0.55, length = 34) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  const corners = [
    [x, y, 1, 1], [x + width, y, -1, 1],
    [x, y + height, 1, -1], [x + width, y + height, -1, -1],
  ];
  for (const [cx, cy, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * length, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + sy * length);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}