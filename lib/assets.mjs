import fs from "node:fs";
import path from "node:path";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const MODEL_EXT = new Set([".glb", ".gltf"]);

async function listFiles(dir, root) {
  const rows = [];
  let entries = [];
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return rows; }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(dir, entry.name);
    const ext = path.extname(entry.name).toLowerCase();
    if (!IMAGE_EXT.has(ext) && !MODEL_EXT.has(ext)) continue;
    const stat = await fs.promises.stat(full).catch(() => null);
    if (!stat) continue;
    rows.push({
      name: entry.name,
      size: stat.size,
      url: `/assets/${path.relative(root, full).replace(/\\/g, "/")}`,
      kind: MODEL_EXT.has(ext) ? "model" : "image",
      updatedAt: stat.mtimeMs,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** 扫描生图号池落地素材与 meshy GLB 模型，供工作台和覆盖层共用。 */
export async function collectAssets(webRoot) {
  const root = path.resolve(webRoot);
  const mediaDir = path.join(root, "assets", "media");
  const modelDir = path.join(root, "assets", "models");
  let manifest = null;
  try {
    manifest = JSON.parse(await fs.promises.readFile(path.join(mediaDir, "manifest.json"), "utf8"));
  } catch { manifest = null; }
  const [backgrounds, units, ui, models] = await Promise.all([
    listFiles(path.join(mediaDir, "backgrounds"), root),
    listFiles(path.join(mediaDir, "units"), root),
    listFiles(path.join(mediaDir, "ui"), root),
    listFiles(modelDir, root),
  ]);
  return {
    manifest,
    backgrounds,
    units,
    ui,
    models: models.filter((item) => item.kind === "model"),
    generatedAt: manifest?.generatedAt || 0,
  };
}
