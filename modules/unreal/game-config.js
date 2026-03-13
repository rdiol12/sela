/**
 * modules/unreal/game-config.js — Active game state manager.
 *
 * Replaces every hardcoded 'workspace/shattered-crown/' path across all builders.
 * Each game lives in workspace/{gameId}/ with isolated manifests, assets, and queues.
 *
 * Fallback: if no active game is set, uses 'shattered-crown' for backward compatibility.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

export const WORKSPACE = join(process.cwd(), 'workspace');
const ACTIVE_PATH = join(WORKSPACE, 'active-game.json');

// ── Path builder ──────────────────────────────────────────────────────────────

function buildPaths(cfg) {
  const base = join(WORKSPACE, cfg.gameId);
  const assets = join(base, 'Assets');
  return {
    ...cfg,
    basePath: base,
    assetsPath: assets,
    meshesPath: join(assets, 'Meshes'),
    audioPath: join(assets, 'Audio'),
    regionManifestPath: join(assets, 'region-manifest.json'),
    assetManifestPath: join(assets, 'asset-manifest.json'),
    worldPlanPath: join(assets, 'world-plan.json'),
    buildQueuePath: join(assets, 'build-queue.json'),
    gddPath: join(assets, 'game-design.json'),
    configPath: join(assets, 'game-config.json'),
  };
}

const FALLBACK = buildPaths({
  gameId: 'shattered-crown',
  displayName: 'The Shattered Crown',
  genre: 'rpg',
  subgenre: 'action-rpg',
  theme: 'dark fantasy',
  artStyle: 'stylized dark fantasy',
  cameraType: 'third-person',
  inputScheme: 'wasd-mouse-look',
  coreLoop: 'explore → fight → loot',
});

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get the currently active game config with all resolved paths.
 * Falls back to shattered-crown if no game is set.
 */
export function getActiveGame() {
  if (!existsSync(ACTIVE_PATH)) return FALLBACK;
  try {
    const cfg = JSON.parse(readFileSync(ACTIVE_PATH, 'utf-8'));
    return buildPaths(cfg);
  } catch {
    return FALLBACK;
  }
}

/**
 * Switch the active game by gameId. The game must already exist in workspace/.
 */
export function setActiveGame(gameId) {
  const cfgPath = join(WORKSPACE, gameId, 'Assets', 'game-config.json');
  if (!existsSync(cfgPath)) return { success: false, error: `Game not found: ${gameId}` };
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    writeFileSync(ACTIVE_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
    return { success: true, gameId, displayName: cfg.displayName };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Create a new game workspace, write game-config.json, and set it as active.
 * Returns the full paths object.
 */
export function createGame(cfg) {
  const game = buildPaths(cfg);
  mkdirSync(game.meshesPath, { recursive: true });
  mkdirSync(game.audioPath, { recursive: true });
  writeFileSync(game.configPath, JSON.stringify(cfg, null, 2), 'utf-8');
  writeFileSync(ACTIVE_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
  return game;
}

/**
 * List all games in the workspace directory.
 */
export function listGames() {
  if (!existsSync(WORKSPACE)) return [];
  try {
    return readdirSync(WORKSPACE, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => {
        const cfgPath = join(WORKSPACE, e.name, 'Assets', 'game-config.json');
        if (!existsSync(cfgPath)) return null;
        try {
          const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
          const active = getActiveGame();
          return {
            gameId: e.name,
            displayName: cfg.displayName,
            genre: cfg.genre,
            isActive: active.gameId === e.name,
          };
        } catch { return null; }
      })
      .filter(Boolean);
  } catch { return []; }
}
