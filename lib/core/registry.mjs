// 玩法注册表：把 gameId 映射到具体玩法运行时。
// 新增玩法时只需在此登记 manifest 与 factory，controller 与 UI 不需要分支判断。
import { manifest as humanVsZombie } from "../../games/human-vs-zombie/manifest.mjs";
import { createSimulation as createHumanVsZombie } from "../../games/human-vs-zombie/simulation.mjs";
import { manifest as hometownVote } from "../../games/hometown-vote/manifest.mjs";
import { createSimulation as createHometownVote } from "../../games/hometown-vote/simulation.mjs";
import { manifest as threeKingdoms } from "../../games/three-kingdoms/manifest.mjs";
import { createSimulation as createThreeKingdoms } from "../../games/three-kingdoms/simulation.mjs";
import { manifest as runningSheep } from "../../games/running-sheep/manifest.mjs";
import { createSimulation as createRunningSheep } from "../../games/running-sheep/simulation.mjs";

const REGISTRY = new Map([
  [humanVsZombie.id, { manifest: humanVsZombie, create: createHumanVsZombie }],
  [hometownVote.id, { manifest: hometownVote, create: createHometownVote }],
  [threeKingdoms.id, { manifest: threeKingdoms, create: createThreeKingdoms }],
  [runningSheep.id, { manifest: runningSheep, create: createRunningSheep }],
]);

export function gameManifests() {
  return [...REGISTRY.values()].map((entry) => entry.manifest);
}

export function hasGame(gameId) {
  return REGISTRY.has(String(gameId));
}

export function createRuntime({ gameId, options = {}, seed = "", now = Date.now() } = {}) {
  const entry = REGISTRY.get(String(gameId));
  if (!entry) throw new Error(`未知玩法：${gameId}`);
  const resolvedGameId = gameId || entry.manifest.id;
  return entry.create({ gameId: resolvedGameId, options, seed, now });
}