import { giftIcon, uiIcon } from "../assets/icons.mjs";

export const $ = (selector, root = document) => root.querySelector(selector);

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = String(value);
    else if (key === "html") el.innerHTML = value;
    else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
    else if (key === "dataset" && typeof value === "object") Object.assign(el.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat(3)) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function setText(el, value) {
  if (!el) return;
  const text = String(value ?? "");
  if (el.textContent !== text) el.textContent = text;
}

export function setClass(el, name, on) {
  if (!el) return;
  el.classList.toggle(name, Boolean(on));
}

export function formatNum(value) {
  const number = Math.round(Number(value) || 0);
  return String(number).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatCompact(value) {
  const number = Math.round(Number(value) || 0);
  if (Math.abs(number) >= 100_000_000) return `${(number / 100_000_000).toFixed(1).replace(/\.0$/, "")}亿`;
  if (Math.abs(number) >= 10_000) return `${(number / 10_000).toFixed(1).replace(/\.0$/, "")}万`;
  return formatNum(number);
}

export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(Number(ms) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function initials(name) {
  const chars = Array.from(String(name || "?").trim());
  return (chars[0] || "?").toUpperCase();
}

export function hueFor(text) {
  let hash = 0;
  const source = String(text || "");
  for (let index = 0; index < source.length; index += 1) hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  return hash % 360;
}

export function avatarEl(user, className = "") {
  const name = String(user?.name || "神秘观众");
  const hue = hueFor(user?.id || name);
  const el = h("span", { class: `avatar ${className}`.trim(), title: name }, initials(name));
  el.style.background = `linear-gradient(135deg, hsl(${hue} 72% 48%), hsl(${(hue + 46) % 360} 68% 28%))`;
  return el;
}

const tweens = new WeakMap();

export function animateNumber(el, value, formatter = formatNum, duration = 520) {
  if (!el) return;
  const target = Number(value) || 0;
  const state = tweens.get(el);
  if (!state) {
    el.textContent = formatter(target);
    tweens.set(el, { value: target, raf: 0 });
    return;
  }
  if (state.value === target) {
    const text = formatter(target);
    if (el.textContent !== text) el.textContent = text;
    return;
  }
  const from = state.value;
  const startedAt = performance.now();
  state.value = target;
  cancelAnimationFrame(state.raf);
  const step = (now) => {
    const progress = Math.min(1, (now - startedAt) / Math.max(120, duration));
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(from + (target - from) * eased);
    el.textContent = formatter(current);
    if (progress < 1) state.raf = requestAnimationFrame(step);
  };
  state.raf = requestAnimationFrame(step);
}

export function fitNumber(el, text, base = 118, threshold = 5) {
  if (!el) return;
  const length = String(text).length;
  if (length <= threshold) {
    el.style.fontSize = "";
    return;
  }
  const shrink = Math.min(0.35, (length - threshold) * 0.08);
  el.style.fontSize = `${Math.round(base * (1 - shrink))}px`;
}

export function iconForGift(name, size = 26) {
  return giftIcon(name || "heart", size);
}

export function iconForUi(name, size = 24) {
  return uiIcon(name, size);
}

/* ── 音效：全部用 WebAudio 合成，不依赖音频文件 ─────────────── */

export function createAudio(isEnabled) {
  let ctx = null;
  let unlocked = false;

  function ensureContext() {
    if (!isEnabled()) return null;
    if (!ctx) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return null;
      try { ctx = new AudioCtor(); } catch { return null; }
    }
    return ctx;
  }

  function ensure() {
    const audio = ensureContext();
    // 覆盖层通常跑在直播伴侣/OBS 里，没有用户手势。suspended 时继续创建振荡器会让
    // Chrome 每帧打印 "AudioContext was not allowed to start"，所以先静默，等点击解锁。
    if (!audio || audio.state !== "running") return null;
    return audio;
  }

  function tone(freq, duration = 0.16, options = {}) {
    const audio = ensure();
    if (!audio) return;
    const { type = "sine", gain = 0.045, delay = 0, slideTo = 0 } = options;
    const start = audio.currentTime + delay;
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(40, freq), start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), start + duration);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + 0.015);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(amp).connect(audio.destination);
    osc.start(start);
    osc.stop(start + duration + 0.06);
  }

  return {
    unlock() {
      unlocked = true;
      const audio = ensureContext();
      if (audio?.state === "suspended") audio.resume().then(() => { unlocked = true; }).catch(() => undefined);
    },
    gift(amount = 1) {
      if (amount >= 1000) {
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, index) => tone(freq, 0.28, { type: "triangle", gain: 0.06, delay: index * 0.07 }));
      } else if (amount >= 100) {
        [659.25, 783.99, 1046.5].forEach((freq, index) => tone(freq, 0.2, { type: "triangle", gain: 0.05, delay: index * 0.06 }));
      } else if (amount >= 10) {
        tone(523.25, 0.13, { type: "sine", gain: 0.04 });
        tone(659.25, 0.15, { type: "sine", gain: 0.04, delay: 0.08 });
      } else {
        tone(880, 0.09, { type: "sine", gain: 0.025 });
      }
    },
    join() {
      tone(587.33, 0.1, { type: "triangle", gain: 0.035 });
      tone(880, 0.12, { type: "triangle", gain: 0.035, delay: 0.07 });
    },
    rocket() {
      tone(180, 0.9, { type: "sawtooth", gain: 0.03, slideTo: 1400 });
      tone(90, 1.1, { type: "sine", gain: 0.05 });
    },
    win() {
      [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((freq, index) => {
        tone(freq, 0.34, { type: "triangle", gain: 0.055, delay: index * 0.11 });
      });
    },
    levelup() {
      [392, 523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((freq, index) => {
        tone(freq, 0.24, { type: "sine", gain: 0.05, delay: index * 0.075 });
      });
    },
    spin(seconds = 5.2) {
      for (let index = 0; index < 14; index += 1) {
        const delay = (index / 14) * Math.max(1, seconds);
        tone(1200 - index * 45, 0.045, { type: "square", gain: 0.018, delay });
      }
    },
    round() {
      tone(440, 0.14, { type: "triangle", gain: 0.035 });
      tone(660, 0.16, { type: "triangle", gain: 0.035, delay: 0.1 });
    },
    pop() {
      tone(760, 0.08, { type: "sine", gain: 0.03 });
    },
  };
}

/* ── 舞台特效层 ─────────────────────────────────────────────── */

const PALETTE = ["#ff4d6d", "#22d3ee", "#facc15", "#a855f7", "#34d399", "#fb7185", "#f472b6", "#60a5fa"];

export function createFx({ layer, toasts, audio }) {
  const random = (min, max) => min + Math.random() * (max - min);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const timers = new Set();

  function later(fn, ms) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
    return timer;
  }

  function remember(el, ttl) {
    if (layer.childElementCount > 180 && layer.firstElementChild) layer.firstElementChild.remove();
    layer.appendChild(el);
    later(() => el.remove(), ttl);
    return el;
  }

  function hearts(count = 6, color = "#ff4d6d", origin = null) {
    for (let index = 0; index < count; index += 1) {
      const el = h("span", { class: "fx-heart" });
      el.style.left = origin ? `${origin.x + random(-90, 90)}px` : `${random(90, 990)}px`;
      el.style.bottom = origin ? `${origin.y + random(-40, 40)}px` : `${random(260, 640)}px`;
      el.style.setProperty("--dx", `${random(-90, 90)}px`);
      el.style.setProperty("--rot", `${random(-30, 30)}deg`);
      el.style.setProperty("--dur", `${random(2.2, 3.4)}s`);
      el.style.animationDelay = `${index * 55}ms`;
      if (color) el.style.color = color;
      el.innerHTML = giftIcon(index % 4 === 0 ? "rose" : "heart", Math.round(random(26, 46)));
      remember(el, 3800);
    }
  }

  function rocket() {
    const el = h("span", { class: "fx-rocket" });
    el.innerHTML = giftIcon("rocket", 120);
    remember(el, 2400);
  }

  function spotlight() {
    for (const left of [18, 50, 82]) {
      const el = h("span", { class: "fx-spotlight" });
      el.style.left = `${left}%`;
      el.style.animationDelay = `${random(0, 0.4)}s`;
      remember(el, 3000);
    }
  }

  function burst(x = 540, y = 760, color = "#facc15", count = 22) {
    for (let index = 0; index < count; index += 1) {
      const el = h("span", { class: "fx-burst" });
      const angle = (index / count) * Math.PI * 2 + random(-0.2, 0.2);
      const distance = random(90, 320);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.setProperty("--c", color);
      el.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
      el.style.setProperty("--dy", `${Math.sin(angle) * distance}px`);
      el.style.animationDelay = `${random(0, 0.08)}s`;
      remember(el, 1100);
    }
  }

  function confetti(count = 48) {
    for (let index = 0; index < count; index += 1) {
      const el = h("span", { class: "fx-confetti" });
      el.style.left = `${random(0, 1080)}px`;
      el.style.setProperty("--c", pick(PALETTE));
      el.style.setProperty("--dx", `${random(-140, 140)}px`);
      el.style.setProperty("--dur", `${random(2.2, 3.6)}s`);
      el.style.animationDelay = `${random(0, 0.7)}s`;
      el.style.transform = `scale(${random(0.6, 1.3)})`;
      remember(el, 4600);
    }
  }

  function firework(x = random(180, 900), y = random(240, 820), color = pick(PALETTE), count = 26) {
    for (let index = 0; index < count; index += 1) {
      const el = h("span", { class: "fx-firework" });
      const angle = (index / count) * Math.PI * 2;
      const distance = random(110, 260);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.setProperty("--c", color);
      el.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
      el.style.setProperty("--dy", `${Math.sin(angle) * distance}px`);
      el.style.animationDelay = `${random(0, 0.1)}s`;
      remember(el, 1400);
    }
  }

  function toast({ title, subtitle = "", icon = uiIcon("gift", 26), big = false, border = "" }) {
    while (toasts.childElementCount >= 4) toasts.firstElementChild?.remove();
    const row = h(
      "div",
      { class: `toast${big ? " toast-big" : ""}` },
      h("span", { class: "toast-icon", html: icon }),
      h("div", { class: "toast-text" }, h("b", { text: title }), subtitle ? h("span", { text: subtitle }) : null),
    );
    if (border) row.style.borderColor = border;
    toasts.appendChild(row);
    later(() => {
      row.classList.add("out");
      later(() => row.remove(), 340);
    }, 3000);
  }

  function banner(title, subtitle = "", ttl = 2800) {
    const existing = layer.querySelector(".banner");
    existing?.remove();
    const el = h(
      "div",
      { class: "banner" },
      h("strong", { text: title }),
      subtitle ? h("span", { text: subtitle }) : null,
    );
    remember(el, ttl + 2000);
    later(() => {
      el.classList.add("out");
      later(() => el.remove(), 380);
    }, ttl);
  }

  function playEffect(effect) {
    if (!effect || !effect.type) return;
    const amount = Number(effect.amount || effect.count || 0);
    switch (effect.type) {
      case "gift-burst":
        toast({ title: effect.gift?.name ? (effect.gift.name + " ×" + (effect.gift.count || 1)) : effect.text, subtitle: effect.user ? (effect.user + " · 舞台能量 +" + formatNum(amount)) : "能量核心响应", icon: giftIcon(effect.gift?.icon || "heart", 26), border: effect.gift?.color || "#00e5ff" });
        hearts(amount >= 500 ? 10 : amount >= 100 ? 7 : 4, effect.gift?.color || "#00e5ff");
        burst(540, 760, effect.gift?.color || "#00e5ff", amount >= 500 ? 30 : 16);
        audio.gift(amount);
        break;
      case "supernova":
        firework(540, 620, "#ff2d75", 54); firework(540, 620, "#00e5ff", 40); confetti(70); spotlight(); audio.win();
        banner(effect.text || "超新星爆发", "舞台能量达到高峰", 3200);
        break;
      case "ai-react":
        toast({ title: "AI 互动演示", subtitle: effect.text || "本地规则已响应弹幕", icon: uiIcon("bolt", 24), border: "#a855f7" });
        burst(540, 640, "#a855f7", 22); audio.join();
        break;
      case "ai-duel":
        toast({ title: "AI 双核对决演示", subtitle: "左核 " + Math.round(effect.left || 0) + " · 右核 " + Math.round(effect.right || 0), icon: uiIcon("bolt", 24), border: "#facc15" });
        burst(300, 760, "#00e5ff", 18); burst(780, 760, "#ff2d75", 18); firework(540, 620, "#facc15", 28); audio.round();
        break;
      case "like-wave": hearts(Math.min(24, 5 + Math.ceil(amount / 20)), "#ff5cae"); audio.gift(1); break;
      case "follow-spark": burst(540, 700, "#facc15", 14); audio.join(); break;
      case "enter-orbit": burst(540, 520, "#00e5ff", 10); audio.join(); break;
      case "round": toast({ title: effect.text || "NEON ARENA 已启动", subtitle: "实时视觉舞台已就绪", icon: uiIcon("bolt", 24) }); audio.round(); break;
      case "finale": firework(540, 600, "#ff2d75", 42); confetti(56); banner(effect.text || "舞台终场", "本地演示场次已结束", 3000); audio.win(); break;
      default: break;
    }
  }

  function pushAlert(alert) {
    if (!alert || !alert.text) return;
    if (alert.level === "warn" || alert.level === "error") {
      toast({ title: "连接提醒", subtitle: alert.text, icon: uiIcon("alert", 24), big: true });
    }
  }

  function dispose() {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    clear(layer);
    clear(toasts);
  }

  return { hearts, rocket, spotlight, burst, confetti, firework, toast, banner, playEffect, pushAlert, dispose };
}
