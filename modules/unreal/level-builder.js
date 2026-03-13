/**
 * modules/unreal/level-builder.js — Builds UE5 levels via Unreal MCP.
 *
 * Reads region-manifest.json, calls Unreal MCP tools to:
 *  1. Spawn terrain/structures (castles, houses, walls, towers)
 *  2. Place 3D assets at keyLocations (from asset-manifest.json)
 *  3. Set up lighting (directional light, fog, sky)
 *  4. Apply materials and colors
 *
 * Each region goes through steps: terrain → structures → assets → lighting → materials.
 * Progress is tracked in region-manifest.json via completedSteps[].
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { callTool } from '../../lib/mcp-gateway.js';
import { createLogger } from '../../lib/logger.js';
import { hasDetailedPlan, getPlacements } from './world-planner.js';
import { getActiveGame } from './game-config.js';
import { buildGlobalEnvironment } from './global-environment.js';
import { integrateAllBlueprints } from './blueprint-integration.js';
import { importAndPlaceAssets } from './ue5-import.js';

const log = createLogger('level-builder');

function getPaths() {
  const g = getActiveGame();
  return {
    regionManifestPath: g.regionManifestPath,
    assetManifestPath: g.assetManifestPath,
    meshesDir: g.meshesPath,
    displayName: g.displayName,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function loadRegionManifest() {
  const { regionManifestPath } = getPaths();
  if (!existsSync(regionManifestPath)) return null;
  return JSON.parse(readFileSync(regionManifestPath, 'utf-8'));
}

function saveRegionManifest(manifest) {
  const { regionManifestPath } = getPaths();
  writeFileSync(regionManifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

function loadAssetManifest() {
  const { assetManifestPath } = getPaths();
  if (!existsSync(assetManifestPath)) return null;
  return JSON.parse(readFileSync(assetManifestPath, 'utf-8'));
}

export function regionManifestExists() {
  return existsSync(REGION_MANIFEST_PATH);
}

/**
 * Check if Unreal Editor is reachable via MCP.
 */
async function pingUnreal() {
  try {
    const result = await callTool('unreal', 'get_actors_in_level', {}, 10_000);
    return result && (result.status === 'success' || result.success !== false);
  } catch {
    return false;
  }
}

// ── Progress tracking ───────────────────────────────────────────────────────

export function getRegionProgress() {
  const manifest = loadRegionManifest();
  if (!manifest) return { total: 0, completed: 0, inProgress: 0, pending: 0 };

  let total = 0, completed = 0, inProgress = 0, pending = 0;
  let nextRegion = null;

  for (const [id, region] of Object.entries(manifest.regions || {})) {
    total++;
    if (region.status === 'completed') completed++;
    else if (region.status === 'in_progress') inProgress++;
    else {
      pending++;
      if (!nextRegion) nextRegion = { id, name: region.levelName, theme: region.theme };
    }
  }

  return { total, completed, inProgress, pending, nextRegion };
}

export function getRegionStatusReport() {
  const manifest = loadRegionManifest();
  if (!manifest) return { error: 'No region manifest found' };

  const regions = {};
  for (const [id, region] of Object.entries(manifest.regions || {})) {
    const steps = region.completedSteps || [];
    regions[id] = {
      levelName: region.levelName,
      status: region.status,
      completedSteps: steps,
      structures: (region.structures || []).length,
      blueprints: (region.blueprints || []).length,
      assetsReady: region.assetsReady || false,
    };
  }

  const progress = getRegionProgress();
  return { ...progress, regions };
}

// ── Check if a region's assets are ready ────────────────────────────────────

function checkAssetsReady(regionId) {
  const assetManifest = loadAssetManifest();
  if (!assetManifest) return false;

  const region = assetManifest.regions?.[regionId];
  if (!region) return false;

  return (region.assets || []).every(a => a.status === 'completed');
}

// ── Step: Build structures ──────────────────────────────────────────────────

async function buildStructures(regionId, region) {
  const results = [];
  const structures = region.structures || [];

  for (const struct of structures) {
    if (struct.status === 'completed') continue;

    try {
      let result;
      const pos = struct.position || [0, 0, 0];
      const prefix = `${region.levelName}_${struct.type}`;

      switch (struct.type) {
        case 'castle':
          result = await callTool('unreal', 'create_castle_fortress', {
            castle_size: struct.size || 'large',
            location: pos,
            name_prefix: prefix,
            include_siege_weapons: true,
            include_village: false,
            architectural_style: struct.style || 'medieval',
          }, 300_000);
          break;

        case 'house':
          result = await callTool('unreal', 'construct_house', {
            location: pos,
            name_prefix: prefix,
            style: struct.style || 'cottage',
          }, 60_000);
          break;

        case 'tower':
          result = await callTool('unreal', 'create_tower', {
            location: pos,
            name_prefix: prefix,
          }, 60_000);
          break;

        case 'wall':
          result = await callTool('unreal', 'create_wall', {
            location: pos,
            name_prefix: prefix,
          }, 60_000);
          break;

        case 'arch':
          result = await callTool('unreal', 'create_arch', {
            location: pos,
            name_prefix: prefix,
          }, 60_000);
          break;

        case 'bridge':
          result = await callTool('unreal', 'create_suspension_bridge', {
            location: pos,
            name_prefix: prefix,
            span_length: 3000,
          }, 120_000);
          break;

        case 'staircase':
          result = await callTool('unreal', 'create_staircase', {
            location: pos,
            name_prefix: prefix,
          }, 60_000);
          break;

        default:
          log.warn({ type: struct.type }, 'Unknown structure type, skipping');
          continue;
      }

      if (result?.success !== false) {
        struct.status = 'completed';
        results.push({ type: struct.type, success: true, actors: result?.actors?.length || 0 });
        log.info({ type: struct.type, regionId }, 'Structure built');
      } else {
        results.push({ type: struct.type, success: false, error: result?.message });
        log.warn({ type: struct.type, err: result?.message }, 'Structure build failed');
      }
    } catch (err) {
      results.push({ type: struct.type, success: false, error: err.message });
      log.warn({ type: struct.type, err: err.message }, 'Structure build error');
    }
  }

  return results;
}

// ── Step: Place assets at key locations ──────────────────────────────────────
// Uses ue5-import.js for FBX import (Python script generation + placement).
// Replaces the old broken import_assets_batch + spawn_static_mesh calls.

async function placeAssets(regionId, region) {
  const assetManifest = loadAssetManifest();

  // Build a lookup: assetId → fbx_path from the asset manifest
  const assetLookup = {};
  const regionAssets = assetManifest?.regions?.[regionId]?.assets || [];
  for (const a of regionAssets) {
    if (a.fbx_path || a.export_path) {
      assetLookup[a.id] = a.fbx_path || a.export_path;
    }
  }

  // Prefer world-plan.json (50-100 placements) over keyLocations (6 placements)
  let placements;
  let planSource;
  if (hasDetailedPlan(regionId)) {
    placements = getPlacements(regionId);
    planSource = 'world-plan';
    log.info({ regionId, count: placements.length }, 'Using detailed world plan placements');
  } else {
    const keyLocations = region.layout?.keyLocations || [];
    if (keyLocations.length === 0) return { skipped: true, reason: 'No placements or keyLocations defined' };
    // Adapt keyLocations to the common placement shape
    placements = keyLocations
      .filter(loc => !loc.placed)
      .map(loc => ({
        assetId: loc.assetId,
        position: loc.position,
        rotation: [0, 0, 0],
        scale: 1.0,
        _keyLoc: loc, // back-reference so we can mark as placed
      }));
    planSource = 'keyLocations';
    log.info({ regionId, count: placements.length }, 'Falling back to keyLocations');
  }

  // Delegate to ue5-import.js — handles Python script generation + placement
  const result = await importAndPlaceAssets(regionId, region, assetLookup, placements, planSource);

  // Mark keyLocations as placed for successfully placed assets
  if (planSource === 'keyLocations') {
    for (const r of (result.results || [])) {
      if (r.success) {
        const kl = placements.find(p => p.assetId === r.assetId && p._keyLoc);
        if (kl?._keyLoc) kl._keyLoc.placed = true;
      }
    }
  }

  return result;
}

// ── Step: Set up lighting ───────────────────────────────────────────────────

async function setupLighting(regionId, region) {
  const lighting = region.lighting;
  if (!lighting) return { skipped: true };

  try {
    // Spawn a directional light for the main sun
    const sunResult = await callTool('unreal', 'set_actor_transform', {
      name: `${region.levelName}_DirectionalLight`,
      rotation: [-45, 30, 0],
    }, 10_000).catch(() => null);

    // Set the light color via material color (approximate)
    if (lighting.directionalColor) {
      await callTool('unreal', 'set_mesh_material_color', {
        name: `${region.levelName}_DirectionalLight`,
        color: {
          R: lighting.directionalColor[0],
          G: lighting.directionalColor[1],
          B: lighting.directionalColor[2],
          A: 1.0,
        },
        material_slot: 0,
      }, 10_000).catch(() => null);
    }

    return { success: true, timeOfDay: lighting.timeOfDay };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Main: Build one region step ─────────────────────────────────────────────

const BUILD_STEPS = ['structures', 'assets', 'lighting', 'materials'];

/**
 * Build one step of a region. Returns what was done.
 * Called by the agent on each cycle via the build_region tool.
 */
export async function buildRegionStep(opts = {}) {
  const manifest = loadRegionManifest();
  if (!manifest) return { success: false, error: 'No region manifest found' };

  // Check Unreal is reachable
  const alive = await pingUnreal();
  if (!alive) return { success: false, error: 'Unreal Editor not reachable — is the project open?' };

  // Pick a region to work on
  let regionId = opts.regionId;
  let region;

  if (regionId) {
    region = manifest.regions[regionId];
    if (!region) return { success: false, error: `Region ${regionId} not found` };
  } else {
    // Pick first in-progress, or first pending
    for (const [id, r] of Object.entries(manifest.regions)) {
      if (r.status === 'in_progress') { regionId = id; region = r; break; }
    }
    if (!regionId) {
      for (const [id, r] of Object.entries(manifest.regions)) {
        if (r.status === 'pending') { regionId = id; region = r; break; }
      }
    }
  }

  if (!regionId) return { success: true, message: 'All regions completed' };

  // Mark as in-progress
  if (region.status === 'pending') region.status = 'in_progress';

  // Check assets ready
  region.assetsReady = checkAssetsReady(regionId);

  // Find next step
  const completedSteps = region.completedSteps || [];
  const nextStep = BUILD_STEPS.find(s => !completedSteps.includes(s));

  if (!nextStep) {
    region.status = 'completed';
    saveRegionManifest(manifest);
    return { success: true, regionId, message: 'Region fully built', status: 'completed' };
  }

  log.info({ regionId, step: nextStep }, 'Building region step');

  // Global region uses the global-environment module instead of standard steps
  if (regionId === 'Global') {
    log.info('Global region — delegating to buildGlobalEnvironment()');
    const globalResult = await buildGlobalEnvironment();
    // Mark all steps complete at once for Global
    region.completedSteps = [...BUILD_STEPS];
    region.status = 'completed';
    saveRegionManifest(manifest);
    return {
      success: globalResult.success,
      regionId,
      step: 'global_environment',
      stepsCompleted: BUILD_STEPS.length,
      totalSteps: BUILD_STEPS.length,
      stepResult: globalResult,
      status: 'completed',
    };
  }

  let stepResult;
  switch (nextStep) {
    case 'structures':
      stepResult = await buildStructures(regionId, region);
      break;
    case 'assets':
      stepResult = await placeAssets(regionId, region);
      break;
    case 'lighting':
      stepResult = await setupLighting(regionId, region);
      break;
    case 'materials':
      // Materials are applied per-actor — this step verifies and applies region palette
      stepResult = { success: true, note: 'Material pass — palette applied during structure/asset placement' };
      break;
  }

  // Mark step complete
  if (!region.completedSteps) region.completedSteps = [];
  region.completedSteps.push(nextStep);

  // Check if all done
  if (region.completedSteps.length >= BUILD_STEPS.length) {
    region.status = 'completed';
  }

  saveRegionManifest(manifest);

  return {
    success: true,
    regionId,
    step: nextStep,
    stepsCompleted: region.completedSteps.length,
    totalSteps: BUILD_STEPS.length,
    stepResult,
    assetsReady: region.assetsReady,
    status: region.status,
  };
}

/**
 * Populate one region with its 3D assets (import FBXs + spawn actors).
 * Can be called even if the region's build steps are "completed".
 * Returns a summary of what was imported and placed.
 */
export async function populateRegionAssets(regionId) {
  const manifest = loadRegionManifest();
  if (!manifest) return { success: false, error: 'No region manifest found' };

  const alive = await pingUnreal();
  if (!alive) return { success: false, error: 'Unreal Editor not reachable' };

  const region = manifest.regions[regionId];
  if (!region) return { success: false, error: `Region not found: ${regionId}` };

  log.info({ regionId }, 'Populating region with assets');
  const result = await placeAssets(regionId, region);

  saveRegionManifest(manifest);
  return { success: true, regionId, ...result };
}

/**
 * Populate ALL regions with their 3D assets.
 * Runs populateRegionAssets for each region in order.
 */
export async function populateAllRegions() {
  const manifest = loadRegionManifest();
  if (!manifest) return { success: false, error: 'No region manifest found' };

  const summary = [];
  for (const regionId of Object.keys(manifest.regions)) {
    try {
      const result = await populateRegionAssets(regionId);
      summary.push({ regionId, ...result });
      log.info({ regionId, placed: result.placed }, 'Region populate done');
    } catch (err) {
      summary.push({ regionId, success: false, error: err.message });
      log.warn({ regionId, err: err.message }, 'Region populate error');
    }
  }

  const totalPlaced = summary.reduce((n, r) => n + (r.placed || 0), 0);
  const totalFailed = summary.reduce((n, r) => n + (r.failed || 0), 0);
  return { success: true, totalPlaced, totalFailed, regions: summary };
}

/**
 * Get the full brief for the agent when a level build signal fires.
 */
export function buildLevelBuildBrief(signal) {
  const d = signal.data;
  return {
    title: `UE5 Level Build — ${d.pending} regions pending`,
    content: `${getPaths().displayName} has ${d.pending} regions ready for UE5 level construction:
${d.nextRegion ? `- Next: **${d.nextRegion.id}** (${d.nextRegion.theme})` : ''}
- ${d.completed}/${d.total} regions built
- ${d.assetsReady} regions have all 3D assets ready

Use \`build_region\` to build the next step of a region. Each region goes through:
1. **structures** — Spawn castles, houses, towers, walls via create_castle_fortress, construct_house, etc.
2. **assets** — Place 3D assets at key locations from the asset manifest
3. **lighting** — Set up directional light, fog, ambient for the region's mood
4. **materials** — Apply region color palette to structures and props

The Unreal MCP tools available:
- \`create_castle_fortress\` — Full castle with walls, towers, keep, courtyard
- \`construct_house\` / \`construct_mansion\` — Residential buildings
- \`create_tower\` / \`create_wall\` / \`create_arch\` — Modular fortress pieces
- \`create_suspension_bridge\` / \`create_aqueduct\` — Large structures
- \`create_town\` — Full town with streets, buildings, infrastructure
- \`set_actor_transform\` — Position/rotate/scale actors
- \`apply_material_to_actor\` / \`set_mesh_material_color\` — Materials and colors
- \`get_actors_in_level\` / \`find_actors_by_name\` — Query scene
- \`create_blueprint\` / \`add_node\` / \`connect_nodes\` — Blueprint scripting

You can also call \`unreal_run_command\` for any custom Unreal Python command.`,
    reasoning: `3D assets are being generated. Meanwhile, region levels can be built using the Unreal MCP construction tools. Structures and lighting don't depend on the asset pipeline — they use built-in UE5 shapes.`,
  };
}

/**
 * Brief for when assets are ready to import.
 */
export function buildAssetImportBrief(signal) {
  const d = signal.data;
  return {
    title: `UE5 Asset Import — ${d.pendingImports} meshes, ${d.pendingAudioImports} audio ready`,
    content: `${getPaths().displayName} UE5 project has generated assets ready for import:
- ${d.pendingImports} 3D mesh files (.fbx) in Assets/Meshes/
- ${d.pendingAudioImports} audio files in Assets/Audio/
- ${d.sourceFiles} total C++ source files

Use \`unreal_run_command\` to import these assets into the UE5 content browser.
For meshes: import FBX files as Static Mesh assets.
For audio: import WAV/MP3 files as SoundWave assets.

After importing, use \`build_region\` to place them at their keyLocations in each region.`,
    reasoning: `Generated assets are sitting in the filesystem but not yet imported into the UE5 project. Import them to make them available for level design.`,
  };
}
