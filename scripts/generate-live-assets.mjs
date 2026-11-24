/**
 * 用本地生图号池（image-pool 插件，127.0.0.1:8100）生成直播舞台素材。
 *
 *   node scripts/generate-live-assets.mjs            # 缺什么补什么
 *   node scripts/generate-live-assets.mjs --only human-vs-zombie
 *   node scripts/generate-live-assets.mjs --force    # 全部重生成
 *
 * 约定：背景 1024×1536 竖图，前端按 9:16 cover 裁剪；主将立绘黑底发光，便于叠加。
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..");
const mediaDir = path.join(pluginRoot, "web", "assets", "media");
const manifestFile = path.join(mediaDir, "manifest.json");
const poolCli = path.resolve(pluginRoot, "..", "image-pool", "bin", "image-pool.mjs");

// 覆盖层按游戏 id 读取素材，角色立绘要挂到对应玩法条目上。
const UNIT_TARGET = {
  "human-hero": ["human-vs-zombie", "human"],
  "zombie-hero": ["human-vs-zombie", "zombie"],
  "sheep-hero": ["running-sheep", "unit"],
  "three-kingdoms-shu": ["three-kingdoms", "shu"],
  "three-kingdoms-wu": ["three-kingdoms", "wu"],
  "three-kingdoms-wei": ["three-kingdoms", "wei"],
  "sheep-blue": ["running-sheep", "left"],
  "sheep-pink": ["running-sheep", "right"],
};

const ITEMS = [
  {
    key: "human-vs-zombie",
    kind: "background",
    file: "backgrounds/human-vs-zombie.png",
    prompt: "竖版 9:16 电影级赛博废土战场主视觉，超广角 35 度俯视，画面中央完全开阔、没有任何建筑、没有全息环、没有大型结构，只有三条纵向发光跑道从画面底部中央延伸到远方地平线，跑道边缘是青蓝色霓虹光带；左右两侧远处各有一座蓝青色与玫红色发光基地水晶与能量塔，地平线是低矮的赛博城市剪影，湿润黑色地面带镜面反射与霓虹倒影，薄雾、悬浮尘埃、火花粒子，蓝青与玫红对冲体积光，画面顶部 10% 与底部 16% 压暗，无人物、无文字、无水印，虚幻引擎 5 影视级渲染，高动态范围，极致细节，8K",
  },
  {
    key: "human-hero",
    kind: "unit",
    file: "units/human-hero.png",
    prompt: "竖屏 2:3 游戏角色立绘，未来蓝色装甲人类指挥官，全身正面站姿，外骨骼装甲带发光蓝色能量线条，手持电磁步枪，黑色纯背景，边缘蓝色轮廓光，电影级材质，硬表面细节，无文字，游戏主视觉，高对比度",
  },
  {
    key: "zombie-hero",
    kind: "unit",
    file: "units/zombie-hero.png",
    prompt: "竖屏 2:3 科幻游戏角色立绘，废土生化战士，全身正面站姿，深灰与暗红配色的重型战术装甲，胸口有红色能量核心，肩甲与护臂结构清晰，双手呈战斗准备姿态，黑色纯背景，边缘红色轮廓光，电影级材质，硬表面细节，干净整洁，无血迹，无伤口，无文字，游戏主视觉，高对比度",
  },
  {
    key: "three-kingdoms",
    kind: "background",
    file: "backgrounds/three-kingdoms.png",
    prompt: "竖版 9:16 史诗电影级游戏主视觉背景，中国古代三国夜战场，三条纵向军阵通道从画面底部延伸到远处燃烧的城门与烽火台，左侧蜀汉红金旗帜军阵，右侧曹魏蓝黑铁甲军阵，中间吴国青金战旗与火光，地面是泥土与破碎石板，浓烟、火星、箭雨剪影与月光体积光交织，远处城墙与巨型攻城器械，画面顶部 10% 和底部 18% 压暗留出 UI 空间，无人物、无文字、无水印，超广角 30 度俯视，电影级调色，红金与冷蓝强对比，虚幻引擎 5 影视级渲染，粒子与烟尘细节，8K",
  },
  {
    key: "three-kingdoms-shu",
    kind: "unit",
    file: "units/three-kingdoms-shu.png",
    prompt: "竖版 2:3 游戏角色立绘，三国蜀汉名将·武圣，赛博国风，全身正面站姿，身披红金重型战甲与绿色战袍，肩甲有龙纹浮雕，右手立青龙偃月刀，长须，威严，纯黑背景，边缘红金色轮廓光，金属与布料材质细节，电影级打光，无文字、无水印、无地面、无场景，游戏主视觉，超高细节，8K",
  },
  {
    key: "three-kingdoms-wu",
    kind: "unit",
    file: "units/three-kingdoms-wu.png",
    prompt: "竖版 2:3 游戏角色立绘，三国东吴儒将·火凤军师，赛博国风，全身正面站姿，橙金与青绿色轻型铠甲配长袍，手持燃烧着火焰流光的长弓，肩部有凤凰羽翼装饰，束发冠，从容自信，纯黑背景，边缘橙金与青色轮廓光，金属与丝绸材质细节，电影级打光，无文字、无水印、无地面、无场景，游戏主视觉，超高细节，8K",
  },
  {
    key: "three-kingdoms-wei",
    kind: "unit",
    file: "units/three-kingdoms-wei.png",
    prompt: "竖版 2:3 游戏角色立绘，三国曹魏枭雄·魏武帝，赛博国风，全身正面站姿，黑蓝重甲配玄色披风，甲片有冷蓝色发光纹路与兽面浮雕，右手按长剑，披风扬起，气场压迫，纯黑背景，边缘冰蓝色轮廓光，金属与皮革材质细节，电影级打光，无文字、无水印、无地面、无场景，游戏主视觉，超高细节，8K",
  },
  {
    key: "running-sheep",
    kind: "background",
    file: "backgrounds/running-sheep.png",
    prompt: "竖版 9:16 电影级赛博朋克竞速舞台背景，夜晚霓虹赛道从画面底部左右两侧向远处高处的巨型终点拱门延伸，赛道是深色金属与发光青色和玫红色能量边线，两侧是赛博羊村建筑、广告牌光幕与机械草坡，空中漂浮粒子与速度光线，远处终点门爆发金白色光芒，湿地面反射霓虹，画面顶部 10% 与底部 18% 压暗留出 UI 空间，中央赛道留空，无人物、无角色、无文字、无水印，超广角 25 度俯视，虚幻引擎 5 影视级渲染，高对比度，青蓝与品红对冲，极致细节，8K",
  },
  {
    key: "sheep-blue",
    kind: "unit",
    size: "1536x1024",
    file: "units/sheep-blue.png",
    prompt: "游戏角色立绘，一只赛博机械羊，全身侧面朝右奔跑姿态，白色蓬松羊毛与青蓝色发光机械外骨骼结合，头上戴着发光护目镜，四蹄带喷射推进器喷出青色光焰，身体有霓虹光条与金属关节，动感十足，纯黑背景，边缘青蓝色轮廓光，电影级材质细节，无文字、无水印、无地面、无场景，游戏主视觉，超高细节，8K",
  },
  {
    key: "sheep-pink",
    kind: "unit",
    size: "1536x1024",
    file: "units/sheep-pink.png",
    prompt: "游戏角色立绘，一只赛博机械羊，全身侧面朝右奔跑姿态，粉紫色蓬松羊毛与玫红色发光机械外骨骼结合，头部戴黑色发光护目镜，角是金属火焰造型，四蹄带喷射推进器喷出品红色光焰，尾部拖出速度光带，动感十足，纯黑背景，边缘玫红色轮廓光，电影级材质细节，无文字、无水印、无地面、无场景，游戏主视觉，超高细节，8K",
  },
  {
    key: "hometown-vote",
    kind: "background",
    file: "backgrounds/hometown-vote.png",
    prompt: "竖版 9:16 电影级直播舞台背景，深色未来科技大厅中央悬浮一座巨大的全息中国地图，地图由青蓝色发光网格与金色省份光点构成，省份之间以流光线条连接，地图下方环绕金色与青色的能量光环和上升粒子光柱，背景是层叠的暗色金属穹顶与扫描线，画面中央偏上留出地图展示空间，底部 20% 逐渐压暗留出榜单区域，无人物、无文字、无水印，超广角正视构图，虚幻引擎 5 影视级渲染，体积光，景深，冷蓝与鎏金对冲，高级质感，8K",
  },
];

function runPoolCli() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [poolCli, "agent-access"], { cwd: pluginRoot, windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(err.trim() || `agent-access 退出码 ${code}`));
      try { resolve(JSON.parse(out.trim().split(/\r?\n/).filter(Boolean).pop())); }
      catch { reject(new Error("无法解析 image-pool agent-access 输出")); }
    });
  });
}

async function generate({ baseUrl, apiKey, prompt, size = "1024x1536", retries = 3 }) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/images/generations`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: "gpt-image-2.6", prompt, size, n: 1 }),
        signal: AbortSignal.timeout(180_000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`HTTP ${response.status} ${JSON.stringify(data).slice(0, 220)}`);
      const item = data?.data?.[0];
      if (item?.b64_json) return Buffer.from(item.b64_json, "base64");
      if (item?.url) {
        const image = await fetch(item.url, { signal: AbortSignal.timeout(60_000) });
        if (!image.ok) throw new Error(`下载图片失败 HTTP ${image.status}`);
        return Buffer.from(await image.arrayBuffer());
      }
      throw new Error("接口没有返回 b64_json 或 url");
    } catch (error) {
      lastError = error;
      console.warn(`  ⚠️ 第 ${attempt}/${retries} 次失败：${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  throw lastError;
}

async function writeManifest(manifest) {
  // 旧清单可能缺少角色映射，按磁盘实际文件补登记。
  for (const item of ITEMS) {
    const full = path.join(mediaDir, item.file);
    if (!fs.existsSync(full)) continue;
    const url = "/assets/media/" + item.file.replace(/\\/g, "/");
    manifest.items[item.key] = { ...(manifest.items[item.key] || {}), kind: item.kind, url, file: item.file, prompt: item.prompt };
    if (item.kind === "background") manifest.items[item.key].background = url;
    if (item.kind === "unit") {
      const target = UNIT_TARGET[item.key];
      if (target) manifest.items[target[0]] = { ...(manifest.items[target[0]] || {}), [target[1]]: url };
    }
  }
  manifest.generatedAt = Date.now();
  await fs.promises.writeFile(manifestFile, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`✅ 素材清单写入 ${path.relative(pluginRoot, manifestFile)}`);
}

async function main() {
  const args = process.argv.slice(2);
  const onlyIndex = args.indexOf("--only");
  const only = onlyIndex >= 0 ? args[onlyIndex + 1] : "";
  const force = args.includes("--force");

  const access = await runPoolCli();
  if (!access?.apiKey) throw new Error("生图号池未就绪，请先在 image-pool 插件里启动服务");
  console.log(`✅ 生图号池 ${access.baseUrl} · 模型 ${access.models?.join("/")}`);

  await fs.promises.mkdir(path.join(mediaDir, "backgrounds"), { recursive: true });
  await fs.promises.mkdir(path.join(mediaDir, "units"), { recursive: true });
  await fs.promises.mkdir(path.join(mediaDir, "ui"), { recursive: true });

  let manifest = { generatedAt: 0, model: "gpt-image-2.6", items: {} };
  try { manifest = JSON.parse(await fs.promises.readFile(manifestFile, "utf8")); } catch { /* 首次生成 */ }
  manifest.items = manifest.items || {};

  const queue = ITEMS.filter((item) => (!only || item.key === only) && (force || !fs.existsSync(path.join(mediaDir, item.file))));
  if (!queue.length) {
    console.log("⏭️ 素材已齐全，无需生成");
    await writeManifest(manifest);
    return;
  }

  console.log(`🔄 待生成 ${queue.length} 张素材`);
  const groups = { background: [], unit: [], ui: [] };
  for (const item of queue) groups[item.kind]?.push(item);

  for (const [kind, items] of Object.entries(groups)) {
    for (let i = 0; i < items.length; i += 2) {
      const batch = items.slice(i, i + 2);
      await Promise.all(batch.map(async (item) => {
        const started = Date.now();
        process.stdout.write(`  · ${item.key} (${kind}) ... `);
        const buffer = await generate({ baseUrl: access.baseUrl, apiKey: access.apiKey, prompt: item.prompt, size: item.size || "1024x1536" });
        const target = path.join(mediaDir, item.file);
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await fs.promises.writeFile(target, buffer);
        const url = `/assets/media/${item.file.replace(/\\/g, "/")}`;
        manifest.items[item.key] = { ...(manifest.items[item.key] || {}), kind, url, file: item.file, prompt: item.prompt };
        if (kind === "background") manifest.items[item.key].background = url;
        if (kind === "unit") {
          const target = UNIT_TARGET[item.key];
          if (target) manifest.items[target[0]] = { ...(manifest.items[target[0]] || {}), [target[1]]: url };
        }
        console.log(`✅ ${Math.round((Date.now() - started) / 1000)}s ${(buffer.length / 1024).toFixed(0)}KB`);
      }));
    }
  }

  manifest.generatedAt = Date.now();
  await fs.promises.writeFile(manifestFile, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`✅ 素材清单写入 ${path.relative(pluginRoot, manifestFile)}`);
}

main().catch((error) => {
  console.error("❌ 素材生成失败：", error.message);
  process.exit(1);
});
