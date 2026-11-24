// 3D 直播舞台：1080×1920 竖屏，WebGL + InstancedMesh 低模角色。
// 权威状态仍来自 Node 快照，这里只做插值与视觉表现；WebGL 不可用时由 overlay 回退 2D。
import * as THREE from "../vendor/three/three.module.min.js";
import { GLTFLoader } from "../vendor/three/GLTFLoader.js";

const W = 1080;
const H = 1920;
const FIELD = 19;
const MAX_UNITS = 360;
const CROWD_PER_SIDE = 620;
const MAX_PARTICLES = 900;
const LANE_X = [-6.4, 0, 6.4];

const TEAM_META = {
  human: { color: 0x38bdf8, glow: 0x7dd3fc, base: 0x0ea5e9, hue: 0.55 },
  zombie: { color: 0xf43f5e, glow: 0xfb7185, base: 0xe11d48, hue: 0.97 },
};

function laneIndex(y) {
  const value = Number(y);
  if (!Number.isFinite(value)) return 1;
  if (value < 0.39) return 0;
  if (value < 0.61) return 1;
  return 2;
}

function unitZ(team, progress) {
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  return team === "human" ? FIELD - p * FIELD * 2 : -FIELD + p * FIELD * 2;
}

export function createStage3D({ quality = "high", models = {}, portraits = {}, background = "" } = {}) {
  const el = document.createElement("div");
  el.className = "stage3d";

  const bg = document.createElement("div");
  bg.className = "stage3d-bg";
  if (background) bg.style.backgroundImage = `url("${background}")`;
  el.appendChild(bg);

  const canvas = document.createElement("canvas");
  canvas.className = "stage3d-canvas";
  el.appendChild(canvas);

  const flash = document.createElement("div");
  flash.className = "stage3d-flash";
  el.appendChild(flash);

  const badge = document.createElement("div");
  badge.className = "stage3d-badge";
  badge.innerHTML = "<b>3D</b><span>LIVE STAGE</span>";
  el.appendChild(badge);
  const callouts = document.createElement("div");
  callouts.className = "stage3d-callouts";
  callouts.innerHTML = `
    <div class="callout left"><b>扣 1</b><span>加入人类</span></div>
    <div class="callout right"><b>扣 2</b><span>加入丧尸</span></div>
    <div class="callout center">关注 = 冲锋兵</div>`;
  el.appendChild(callouts);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: quality !== "low", powerPreference: "high-performance" });
  } catch (error) {
    throw new Error(`WebGL 初始化失败：${error.message}`);
  }
  const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1)) * (quality === "low" ? 0.62 : quality === "balanced" ? 0.82 : 1);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, W / H, 0.1, 260);
  const cameraBase = new THREE.Vector3(0, 31, 31);
  camera.position.copy(cameraBase);
  camera.lookAt(0, 0, -1);

  const hemi = new THREE.HemisphereLight(0xa8d4ff, 0x2a0714, 1.5);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 2.7);
  key.position.set(8, 22, 14);
  scene.add(key);
  const rimHuman = new THREE.PointLight(0x38bdf8, 38, 46, 2);
  rimHuman.position.set(-5.2, 4.2, 15);
  scene.add(rimHuman);
  const rimZombie = new THREE.PointLight(0xf43f5e, 38, 46, 2);
  rimZombie.position.set(5.2, 4.2, -15);
  scene.add(rimZombie);

  scene.fog = new THREE.FogExp2(0x061020, 0.0085);
  const world = new THREE.Group();
  scene.add(world);

  // 地面与三条发光跑道
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(72, 96),
    new THREE.MeshStandardMaterial({ color: 0x050810, metalness: 0.62, roughness: 0.42, transparent: true, opacity: 0.08 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  world.add(ground);

  const grid = new THREE.GridHelper(76, 38, 0x1b4b7a, 0x10233a);
  grid.position.y = 0.01;
  grid.material.transparent = true;
  grid.material.opacity = 0.16;
  world.add(grid);

  const laneMaterial = new THREE.MeshBasicMaterial({ color: 0x2f8fc4, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
  const edgeMaterial = new THREE.MeshBasicMaterial({ color: 0x8ee7ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const x of LANE_X) {
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(4.6, FIELD * 2 + 8), laneMaterial);
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(x, 0.02, 0);
    world.add(lane);
    for (const side of [-1, 1]) {
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.09, FIELD * 2 + 8), edgeMaterial);
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(x + side * 2.32, 0.03, 0);
      world.add(edge);
    }
  }

  // 双基地：平台 + 水晶 + 光环
  const bases = {};
  for (const [team, meta] of Object.entries(TEAM_META)) {
    const z = team === "human" ? FIELD + 3.2 : -FIELD - 3.2;
    const group = new THREE.Group();
    group.position.set(0, 0, z);
    world.add(group);

    const pad = new THREE.Mesh(
      new THREE.RingGeometry(0.95, 1.2, 48),
      new THREE.MeshBasicMaterial({ color: meta.glow, transparent: true, opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.06;
    group.add(pad);

    const crystal = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.46, 0),
      new THREE.MeshStandardMaterial({ color: meta.color, emissive: meta.glow, emissiveIntensity: 1.5, metalness: 0.4, roughness: 0.22 })
    );
    crystal.position.y = 0.62;
    group.add(crystal);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.5, 1.85, 48),
      new THREE.MeshBasicMaterial({ color: meta.glow, transparent: true, opacity: 0.42, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    group.add(ring);

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.38, 4.2, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: meta.glow, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    beam.position.y = 2.6;
    group.add(beam);

    bases[team] = { group, crystal, ring, beam, hp: 1 };
  }

  // 中线交火带：双方人海接触区的火光、焦痕与持续火花
  const frontGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(28, 3.6),
    new THREE.MeshBasicMaterial({ color: 0xffa63d, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  frontGlow.rotation.x = -Math.PI / 2;
  frontGlow.position.set(0, 0.07, 0);
  world.add(frontGlow);

  // 低模角色：身体/头/四肢分开实例化，5 个 draw call 撑起 300+ 单位
  const max = MAX_UNITS;
  const geoBody = new THREE.CapsuleGeometry(0.24, 0.52, 4, 8);
  const geoHead = new THREE.SphereGeometry(0.23, 10, 8);
  const geoArm = new THREE.BoxGeometry(0.13, 0.5, 0.13);
  const geoLeg = new THREE.BoxGeometry(0.16, 0.54, 0.16);
  const geoHp = new THREE.PlaneGeometry(1, 0.075);
  const geoGlow = new THREE.CircleGeometry(0.62, 16);

  const matBody = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.58, roughness: 0.3, emissive: 0x1b3350, emissiveIntensity: 0.7 });
  const matLimb = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.34, emissive: 0x14283f, emissiveIntensity: 0.6 });
  const matHp = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, depthWrite: false });
  const matGlow = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.62, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

  const bodyMesh = new THREE.InstancedMesh(geoBody, matBody, max);
  const headMesh = new THREE.InstancedMesh(geoHead, matBody, max);
  const armL = new THREE.InstancedMesh(geoArm, matLimb, max);
  const armR = new THREE.InstancedMesh(geoArm, matLimb, max);
  const legL = new THREE.InstancedMesh(geoLeg, matLimb, max);
  const legR = new THREE.InstancedMesh(geoLeg, matLimb, max);
  const hpMesh = new THREE.InstancedMesh(geoHp, matHp, max);
  const glowMesh = new THREE.InstancedMesh(geoGlow, matGlow, max);
  for (const mesh of [bodyMesh, headMesh, armL, armR, legL, legR, hpMesh, glowMesh]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    world.add(mesh);
  }
  const white = new THREE.Color(0xffffff);
  for (let i = 0; i < max; i += 1) {
    for (const mesh of [bodyMesh, headMesh, armL, armR, legL, legR, hpMesh, glowMesh]) mesh.setColorAt(i, white);
  }

  // 粒子
  const particlePositions = new Float32Array(MAX_PARTICLES * 3);
  const particleColors = new Float32Array(MAX_PARTICLES * 3);
  particlePositions.fill(9999);
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
  particleGeo.setAttribute("color", new THREE.BufferAttribute(particleColors, 3));
  const particles = new THREE.Points(
    particleGeo,
    new THREE.PointsMaterial({ size: 0.2, vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true })
  );
  particles.frustumCulled = false;
  world.add(particles);
  const particlePool = Array.from({ length: MAX_PARTICLES }, () => ({ x: 0, y: -9999, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, r: 1, g: 1, b: 1 }));
  let particleCursor = 0;

  // ── 人海层：每方 620 个低模小人，跟随真实阵线推进；真实单位再叠在上面 ──
  const CROWD_COLS = 20;
  const CROWD_ROWS = Math.ceil(CROWD_PER_SIDE / CROWD_COLS);
  const crowdGeo = new THREE.ConeGeometry(0.22, 0.6, 6);
  const crowdHeadGeo = new THREE.SphereGeometry(0.14, 7, 6);
  const crowdWeaponGeo = new THREE.BoxGeometry(0.05, 0.78, 0.05);
  const crowdMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3, roughness: 0.52, emissive: 0x0d1a2e, emissiveIntensity: 0.95 });
  const crowdMesh = new THREE.InstancedMesh(crowdGeo, crowdMat, CROWD_PER_SIDE * 2);
  const crowdHead = new THREE.InstancedMesh(crowdHeadGeo, crowdMat, CROWD_PER_SIDE * 2);
  const crowdWeapon = new THREE.InstancedMesh(crowdWeaponGeo, crowdMat, CROWD_PER_SIDE * 2);
  for (const mesh of [crowdMesh, crowdHead, crowdWeapon]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    world.add(mesh);
  }
  const crowd = [];
  for (let side = 0; side < 2; side += 1) {
    for (let index = 0; index < CROWD_PER_SIDE; index += 1) {
      crowd.push({
        side,
        col: index % CROWD_COLS,
        row: Math.floor(index / CROWD_COLS),
        jitter: (Math.random() - 0.5) * 1.35,
        depth: (Math.random() - 0.5) * 1.4,
        phase: Math.random() * Math.PI * 2,
        scale: 0.82 + Math.random() * 0.42,
        tint: Math.random(),
      });
    }
  }
  const crowdColor = new THREE.Color();

  function crowdFrontline() {
    let hSum = 0; let hCount = 0; let zSum = 0; let zCount = 0;
    for (const node of units.values()) {
      if (!node.team) continue;
      if (node.team === "human") { hSum += Math.max(0, Math.min(1, (FIELD - node.z) / (FIELD * 2))); hCount += 1; }
      else { zSum += Math.max(0, Math.min(1, (node.z + FIELD) / (FIELD * 2))); zCount += 1; }
    }
    const hp = hCount ? hSum / hCount : 0.22;
    const zp = zCount ? zSum / zCount : 0.22;
    return {
      human: FIELD - hp * FIELD * 1.7,
      zombie: -FIELD + zp * FIELD * 1.7,
    };
  }

  function writeCrowd(t) {
    const front = crowdFrontline();
    let index = 0;
    for (const person of crowd) {
      const human = person.side === 0;
      const frontZ = human ? front.human : front.zombie;
      const backZ = human ? FIELD + 3.2 : -FIELD - 3.2;
      const depthRatio = person.row / Math.max(1, CROWD_ROWS - 1);
      const scatter = 0.35 + depthRatio * 0.65;
      const z = backZ + (frontZ - backZ) * (0.5 + depthRatio * 0.5) + person.depth * scatter;
      const x = -12.2 + (person.col / (CROWD_COLS - 1)) * 24.4 + person.jitter * scatter;
      const bob = Math.sin(t * 5.2 + person.phase) * 0.055;
      const sway = Math.sin(t * 2.4 + person.phase) * 0.09;
      const sc = person.scale * 0.95;
      dummy.position.set(x + sway, 0.38 * sc + bob, z);
      dummy.rotation.set(0, human ? Math.PI : 0, 0);
      dummy.scale.setScalar(sc);
      dummy.updateMatrix();
      crowdMesh.setMatrixAt(index, dummy.matrix);
      dummy.position.y += 0.46 * sc;
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      crowdHead.setMatrixAt(index, dummy.matrix);
      dummy.position.set(x + sway + (human ? -0.22 : 0.22) * sc, 0.62 * sc + bob, z);
      dummy.rotation.set(0, 0, human ? -0.22 : 0.22);
      dummy.updateMatrix();
      crowdWeapon.setMatrixAt(index, dummy.matrix);

      if (human) {
        crowdColor.setHSL(0.552 + person.tint * 0.02, 0.9, 0.3 + person.tint * 0.16);
      } else {
        crowdColor.setHSL(person.tint < 0.16 ? 0.79 : 0.975, 0.88, 0.26 + person.tint * 0.16);
      }
      crowdMesh.setColorAt(index, crowdColor);
      crowdHead.setColorAt(index, crowdColor);
      crowdWeapon.setColorAt(index, crowdColor);
      index += 1;
    }
    for (const mesh of [crowdMesh, crowdHead, crowdWeapon]) {
      mesh.count = index;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  const units = new Map();
  const dummy = new THREE.Object3D();
  const baseMatrix = new THREE.Matrix4();
  const partMatrix = new THREE.Matrix4();
  let latest = null;
  let running = true;
  let destroyed = false;
  let lastTs = performance.now();
  let elapsed = 0;
  let shake = 0;
  let lastFlashAt = 0;
  let focus = 0;
  const mixers = [];
  const portraitSprites = [];

  // 阵营巨型 Boss：用低模几何体放大成 3D 主将，站在各自基地前，避免黑底立绘贴纸感
  const bosses = {};
  for (const team of ["human", "zombie"]) {
    const meta = TEAM_META[team];
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: meta.color, emissive: meta.glow, emissiveIntensity: 1.35, metalness: 0.55, roughness: 0.28 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.82, 1.5, 8, 14), mat);
    body.position.y = 2.35;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.52, 14, 10), mat);
    head.position.y = 3.7;
    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.4, 0.85), mat);
    shoulder.position.y = 3.02;
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.12, 0.1),
      new THREE.MeshBasicMaterial({ color: team === "human" ? 0xe0f7ff : 0xffd1d8 })
    );
    visor.position.set(0, 3.72, 0.48);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.36, 1.5, 0.36), mat);
    armL.position.set(-1.15, 2.45, 0);
    armL.rotation.z = 0.16;
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.36, 1.5, 0.36), mat);
    armR.position.set(1.15, 2.45, 0);
    armR.rotation.z = -0.16;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.25, 0.42), mat);
    legL.position.set(-0.42, 0.66, 0);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.25, 0.42), mat);
    legR.position.set(0.42, 0.66, 0);
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(1.5, 1.9, 40),
      new THREE.MeshBasicMaterial({ color: meta.glow, transparent: true, opacity: 0.5, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.05;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 1.15, 7.5, 18, 1, true),
      new THREE.MeshBasicMaterial({ color: meta.glow, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
    );
    beam.position.y = 3.4;
    group.add(body, head, shoulder, visor, armL, armR, legL, legR, halo, beam);
    group.position.set(team === "human" ? -4.2 : 4.2, 0, team === "human" ? 11.5 : -11.5);
    group.scale.setScalar(team === "human" ? 1.55 : 1.65);
    group.userData = { team, body, head, halo, beam, baseY: 0 };
    bosses[team] = group;
  }

  function spawnParticles(x, y, z, color, count = 26, power = 1) {
    const hsl = {};
    new THREE.Color(color).getHSL(hsl);
    for (let i = 0; i < count; i += 1) {
      const p = particlePool[particleCursor];
      particleCursor = (particleCursor + 1) % MAX_PARTICLES;
      const angle = Math.random() * Math.PI * 2;
      const speed = (1.6 + Math.random() * 5.5) * power;
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = Math.cos(angle) * speed;
      p.vz = Math.sin(angle) * speed;
      p.vy = 2 + Math.random() * 5 * power;
      p.max = 0.7 + Math.random() * 0.9;
      p.life = p.max;
      const hue = (hsl.h + (Math.random() - 0.5) * 0.12 + 1) % 1;
      const c = new THREE.Color().setHSL(hue, Math.min(1, hsl.s + 0.15), 0.62);
      p.r = c.r;
      p.g = c.g;
      p.b = c.b;
    }
  }

  function doFlash(color = "rgba(125,211,252,0.34)") {
    flash.style.background = color;
    flash.classList.remove("on");
    void flash.offsetWidth;
    flash.classList.add("on");
  }

  function reconcile(state) {
    latest = state || null;
    const list = Array.isArray(state?.units) ? state.units : [];
    const seen = new Set();
    for (const unit of list) {
      if (!unit?.id) continue;
      seen.add(unit.id);
      let node = units.get(unit.id);
      const lane = laneIndex(unit.y);
      const z = unitZ(unit.team, unit.x);
      if (!node) {
        node = {
          cx: LANE_X[lane],
          cz: z,
          x: LANE_X[lane],
          z,
          phase: Math.random() * Math.PI * 2,
          flash: 0,
          born: elapsed,
          dead: 0,
        };
        units.set(unit.id, node);
      }
      node.targetX = LANE_X[lane];
      node.targetZ = z;
      node.team = unit.team === "zombie" ? "zombie" : "human";
      node.level = Math.max(0, Number(unit.level) || 0);
      node.radius = Math.max(0.5, Math.min(1.5, (Number(unit.r) || 8) / 14));
      node.hp = Math.max(0, Math.min(1, (Number(unit.hp) || 0) / Math.max(1, Number(unit.maxHp) || 1)));
      if (node.prevHp !== undefined && node.hp < node.prevHp - 0.01) node.flash = 0.16;
      node.prevHp = node.hp;
    }
    for (const [id, node] of units) {
      if (!seen.has(id)) node.dead += 1;
    }
    for (const team of ["human", "zombie"]) {
      const row = (state?.teams || []).find((item) => item.id === team);
      if (row && bases[team]) bases[team].hp = Math.max(0, Math.min(1, Number(row.baseHp) / Math.max(1, Number(row.baseMaxHp) || 1)));
    }
  }

  function setPart(mesh, index, parent, px, py, pz, rx, ry, rz, sx = 1, sy = 1, sz = 1) {
    dummy.position.set(px, py, pz);
    dummy.rotation.set(rx, ry, rz);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    partMatrix.multiplyMatrices(parent, dummy.matrix);
    mesh.setMatrixAt(index, partMatrix);
  }

  function writeUnits() {
    let index = 0;
    const color = new THREE.Color();
    const hpColor = new THREE.Color();
    for (const [id, node] of units) {
      if (index >= max) break;
      if (!node.team) continue;
      node.x += (node.targetX - node.x) * 0.16;
      node.z += (node.targetZ - node.z) * 0.16;
      const speed = 2.6 + node.level * 0.28;
      node.phase += speed * 0.016;
      const swing = Math.sin(node.phase) * (node.team === "zombie" ? 0.34 : 0.62);
      const scale = (1.0 + node.level * 0.05) * (1 + node.radius * 0.08);
      const dying = node.dead > 0;
      const alphaScale = dying ? Math.max(0, 1 - node.dead * 0.16) : 1;
      if (dying && alphaScale <= 0.02) {
        units.delete(id);
        continue;
      }
      const bob = Math.sin(node.phase * 2) * 0.045;
      const facing = node.team === "human" ? Math.PI : 0;
      dummy.position.set(node.x, 0, node.z);
      dummy.rotation.set(0, facing, 0);
      dummy.scale.setScalar(scale * alphaScale);
      dummy.updateMatrix();
      baseMatrix.copy(dummy.matrix);

      const meta = TEAM_META[node.team];
      const hue = (meta.hue + node.level * 0.012) % 1;
      color.setHSL(hue, 0.9, 0.4 + Math.min(0.1, node.level * 0.01));
      if (node.flash > 0) color.lerp(new THREE.Color(0xffffff), Math.min(0.9, node.flash * 6));
      bodyMesh.setColorAt(index, color);
      headMesh.setColorAt(index, color);
      const limb = color.clone().multiplyScalar(0.78);
      armL.setColorAt(index, limb);
      armR.setColorAt(index, limb);
      legL.setColorAt(index, limb);
      legR.setColorAt(index, limb);

      const zombie = node.team === "zombie";
      const armBase = zombie ? -1.15 : 0;
      setPart(bodyMesh, index, baseMatrix, 0, 0.98 + bob, 0, 0, 0, 0);
      setPart(headMesh, index, baseMatrix, 0, 1.58 + bob, zombie ? 0.03 : 0, zombie ? -0.12 : 0, 0, 0);
      setPart(armL, index, baseMatrix, -0.33, 1.22 + bob, 0, armBase + (zombie ? 0 : swing), 0, 0);
      setPart(armR, index, baseMatrix, 0.33, 1.22 + bob, 0, armBase + (zombie ? 0 : -swing), 0, 0);
      setPart(legL, index, baseMatrix, -0.15, 0.45, 0, -swing * 0.9, 0, 0);
      setPart(legR, index, baseMatrix, 0.15, 0.45, 0, swing * 0.9, 0, 0);

      // 血条始终面向相机
      dummy.position.set(node.x, 2.08 * scale + 0.1, node.z);
      dummy.quaternion.copy(camera.quaternion);
      dummy.scale.set(Math.max(0.001, node.hp) * 1.05, 1, 1);
      dummy.updateMatrix();
      hpMesh.setMatrixAt(index, dummy.matrix);
      hpColor.setHex(node.hp > 0.6 ? 0x34d399 : node.hp > 0.3 ? 0xfbbf24 : 0xf43f5e);
      hpMesh.setColorAt(index, hpColor);

      dummy.position.set(node.x, 0.035, node.z);
      dummy.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
      dummy.scale.setScalar(1.0 + node.level * 0.06);
      dummy.updateMatrix();
      glowMesh.setMatrixAt(index, dummy.matrix);
      glowMesh.setColorAt(index, new THREE.Color(meta.glow));

      if (node.flash > 0) node.flash = Math.max(0, node.flash - 0.016);
      index += 1;
    }
    for (let i = index; i < max; i += 1) {
      dummy.position.set(0, -9999, 0);
      dummy.scale.setScalar(0.0001);
      dummy.updateMatrix();
      for (const mesh of [bodyMesh, headMesh, armL, armR, legL, legR, hpMesh, glowMesh]) mesh.setMatrixAt(i, dummy.matrix);
    }
    for (const mesh of [bodyMesh, headMesh, armL, armR, legL, legR, hpMesh, glowMesh]) {
      mesh.count = index;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  function updateParticles(dt) {
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      const p = particlePool[i];
      if (p.life <= 0) {
        particlePositions[i * 3 + 1] = -9999;
        continue;
      }
      p.life -= dt;
      p.vy -= 9 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.05) { p.y = 0.05; p.vy *= -0.36; p.vx *= 0.72; p.vz *= 0.72; }
      particlePositions[i * 3] = p.x;
      particlePositions[i * 3 + 1] = p.y;
      particlePositions[i * 3 + 2] = p.z;
      const fade = Math.max(0, p.life / p.max);
      particleColors[i * 3] = p.r * fade;
      particleColors[i * 3 + 1] = p.g * fade;
      particleColors[i * 3 + 2] = p.b * fade;
    }
    particleGeo.attributes.position.needsUpdate = true;
    particleGeo.attributes.color.needsUpdate = true;
  }

  function effect(effect) {
    if (!effect) return;
    const type = String(effect.type || "");
    const team = effect.team === "zombie" ? "zombie" : "human";
    const side = team === "human" ? 1 : -1;
    if (type === "gift-burst" || type === "supernova" || type === "first-gift") {
      const power = type === "supernova" ? 2.2 : 1.2;
      spawnParticles((Math.random() - 0.5) * 8, 1.2, side * (8 + Math.random() * 8), TEAM_META[team].glow, type === "supernova" ? 90 : 34, power);
      shake = Math.min(0.5, shake + (type === "supernova" ? 0.34 : 0.14));
      if (type === "supernova") doFlash(team === "human" ? "rgba(56,189,248,0.32)" : "rgba(244,63,94,0.32)");
    } else if (type === "levelup" || type === "crown") {
      spawnParticles(0, 1.5, side * (FIELD - 2), 0xfacc15, 60, 1.8);
      doFlash("rgba(250,204,21,0.22)");
    } else if (type === "join" || type === "cheer") {
      spawnParticles((Math.random() - 0.5) * 10, 0.7, side * (2 + Math.random() * 12), TEAM_META[team].glow, 14, 0.8);
    } else if (type === "win" || type === "finish" || type === "finale") {
      spawnParticles(0, 2, 0, 0xfacc15, 120, 2.2);
      doFlash("rgba(255,255,255,0.34)");
      shake = 0.5;
      focus = 1;
    }
  }

  function animate(ts) {
    if (!running || destroyed) return;
    const dt = Math.min(0.05, Math.max(0.001, (ts - lastTs) / 1000));
    lastTs = ts;
    elapsed += dt;

    writeUnits();
    writeCrowd(elapsed);
    frontGlow.material.opacity = 0.11 + Math.sin(elapsed * 3.1) * 0.05;
    if (Math.random() < 0.45) {
      spawnParticles((Math.random() - 0.5) * 20, 0.45, (Math.random() - 0.5) * 3, 0xffb347, 2, 0.7);
    }
    updateParticles(dt);

    for (const [team, node] of Object.entries(bases)) {
      const pulse = 0.9 + Math.sin(elapsed * 2.2 + (team === "human" ? 0 : Math.PI)) * 0.12;
      node.crystal.rotation.y += dt * 0.8;
      node.crystal.rotation.x = Math.sin(elapsed * 0.9) * 0.16;
      node.crystal.position.y = 0.62 + Math.sin(elapsed * 1.8 + (team === "human" ? 0 : 1)) * 0.05;
      node.ring.scale.setScalar(pulse);
      node.ring.material.opacity = 0.28 + Math.sin(elapsed * 2.2) * 0.12;
      node.beam.material.opacity = 0.1 + Math.sin(elapsed * 1.4) * 0.05;
      node.crystal.material.emissiveIntensity = 1.2 + Math.sin(elapsed * 3) * 0.35;
    }

    for (const group of Object.values(bosses)) {
      const phase = group.userData.team === "human" ? 0 : 1.6;
      group.position.y = Math.sin(elapsed * 1.3 + phase) * 0.12;
      group.userData.body.scale.setScalar(1 + Math.sin(elapsed * 2.2 + phase) * 0.02);
      group.userData.halo.rotation.z += dt * 0.5;
      group.userData.beam.material.opacity = 0.12 + Math.sin(elapsed * 1.7 + phase) * 0.05;
    }

    for (const group of portraitSprites) {
      const phase = group.userData.team === "human" ? 0 : 1.4;
      group.position.y = group.userData.baseY + Math.sin(elapsed * 1.1 + phase) * 0.22;
      group.userData.sprite.material.opacity = 0.9 + Math.sin(elapsed * 2.1 + phase) * 0.06;
      group.userData.ring.material.opacity = 0.4 + Math.sin(elapsed * 2.4 + phase) * 0.14;
    }
    focus = Math.max(0, focus - dt * 0.5);
    const cinematic = latest?.settings?.stage?.camera !== "fixed";
    const sway = cinematic ? Math.sin(elapsed * 0.32) * 1.5 : 0;
    const swayY = cinematic ? Math.sin(elapsed * 0.23) * 0.55 : 0;
    const push = 1 - focus * 0.14;
    camera.position.set(cameraBase.x + sway + (Math.random() - 0.5) * shake * 1.5, cameraBase.y + swayY + (Math.random() - 0.5) * shake, cameraBase.z * push + (Math.random() - 0.5) * shake * 1.5);
    camera.lookAt(0, (Math.random() - 0.5) * shake * 0.6, -1);
    shake = Math.max(0, shake - dt * 0.9);

    for (const mixer of mixers) mixer.update(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  async function loadHero(url, team) {
    if (!url) return;
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      // 先把模型缩放到统一高度，再把包围盒中心归零，最后放进 holder 定位；
      // 否则 meshy / Mixamo 模型自带的偏移会把主将甩到镜头外或放大到遮住整个舞台。
      const box = new THREE.Box3().setFromObject(root, true);
      const size = box.getSize(new THREE.Vector3());
      const height = Math.max(0.001, size.y);
      root.scale.setScalar(3.6 / height);
      root.updateMatrixWorld(true);
      const scaled = new THREE.Box3().setFromObject(root, true);
      const center = scaled.getCenter(new THREE.Vector3());
      root.position.set(-center.x, -scaled.min.y, -center.z);
      root.traverse((child) => {
        if (child.isMesh) {
          child.frustumCulled = false;
          child.material?.setValues?.({ metalness: 0.35, roughness: 0.5 });
        }
      });
      const holder = new THREE.Group();
      holder.position.set(team === "human" ? -5.6 : 5.6, 0, team === "human" ? FIELD + 1.2 : -FIELD - 1.2);
      holder.rotation.y = team === "human" ? Math.PI * 0.18 : -Math.PI * 0.18;
      holder.add(root);
      world.add(holder);
      if (gltf.animations?.length) {
        const mixer = new THREE.AnimationMixer(root);
        mixer.clipAction(gltf.animations[0]).play();
        mixers.push(mixer);
      }
    } catch (error) {
      console.warn("[stage3d] 模型加载失败", url, error?.message || error);
    }
  }

  function loadPortrait(url, team) {
    if (!url) return;
    new THREE.TextureLoader().load(url, (texture) => {
      if (destroyed) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace;
      // 生图立绘是黑底：按亮度重算 alpha 并提亮主体，避免黑框和“幽灵感”。
      let map = texture;
      try {
        const image = texture.image;
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = pixels.data;
        for (let i = 0; i < data.length; i += 4) {
          const lum = Math.max(data[i], data[i + 1], data[i + 2]);
          data[i + 3] = lum <= 16 ? 0 : lum >= 60 ? 255 : Math.round(((lum - 16) / 44) * 255);
          if (data[i + 3] > 0) {
            data[i] = Math.min(255, Math.round(data[i] * 1.55 + 10));
            data[i + 1] = Math.min(255, Math.round(data[i + 1] * 1.55 + 10));
            data[i + 2] = Math.min(255, Math.round(data[i + 2] * 1.55 + 10));
          }
        }
        ctx.putImageData(pixels, 0, 0);
        map = new THREE.CanvasTexture(canvas);
        map.colorSpace = THREE.SRGBColorSpace;
        texture.dispose();
      } catch (error) {
        console.warn("[stage3d] 立绘去底失败，使用原图", error?.message || error);
      }
      const material = new THREE.SpriteMaterial({
        map,
        transparent: true,
        depthWrite: false,
        opacity: 0.96,
      });
      const sprite = new THREE.Sprite(material);
      const ratio = map.image?.height && map.image?.width ? map.image.height / map.image.width : 1.5;
      sprite.scale.set(7.5 / Math.max(0.8, ratio), 7.5, 1);
      material.depthTest = false;
      material.depthWrite = false;
      sprite.renderOrder = 12;
      const group = new THREE.Group();
      group.position.set(team === "human" ? -6.2 : 6.2, 3.4, team === "human" ? 6.5 : -4.5);
      group.add(sprite);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.3, 1.7, 48),
        new THREE.MeshBasicMaterial({
          color: team === "human" ? 0x38bdf8 : 0xf43f5e,
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -3.3;
      group.add(ring);
      group.userData.team = team;
      group.userData.baseY = 3.4;
      group.userData.sprite = sprite;
      group.userData.ring = ring;
      world.add(group);
      portraitSprites.push(group);
    }, undefined, (error) => console.warn("[stage3d] 主将立绘加载失败", url, error?.message || error));
  }

  loadHero(models.human, "human");
  loadHero(models.zombie, "zombie");
  loadPortrait(portraits.human, "human");
  loadPortrait(portraits.zombie, "zombie");

  requestAnimationFrame(animate);

  return {
    el,
    update(state) { reconcile(state); },
    effect,
    setBackground(url) {
      bg.style.backgroundImage = url ? `url("${url}")` : "";
    },
    destroy() {
      destroyed = true;
      running = false;
      for (const mesh of [bodyMesh, headMesh, armL, armR, legL, legR, hpMesh, glowMesh, crowdMesh, crowdHead, crowdWeapon]) mesh.dispose();
      for (const geo of [geoBody, geoHead, geoArm, geoLeg, geoHp, geoGlow, particleGeo, crowdGeo, crowdHeadGeo, crowdWeaponGeo]) geo.dispose();
      for (const mat of [matBody, matLimb, matHp, matGlow, crowdMat]) mat.dispose();
      frontGlow.geometry.dispose();
      frontGlow.material.dispose();
      for (const group of portraitSprites) {
        const sprite = group.userData.sprite;
        const ring = group.userData.ring;
        sprite.material.map?.dispose();
        sprite.material.dispose();
        ring.geometry.dispose();
        ring.material.dispose();
      }
      renderer.dispose();
      el.remove();
    },
  };
}
