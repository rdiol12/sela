/**
 * modules/unreal/world-planner.js — Spatial AI brain for Shattered Crown world building.
 *
 * Before any FBX assets are placed in UE5, this module calls Claude to reason about
 * the region's theme, assets, and space — then generates a rich placement map with
 * 50-100 individual actor positions per region.
 *
 * Flow:
 *  1. planRegion(regionId) → call Claude with region + asset data
 *  2. Claude returns JSON placement groups (pattern, center, radius, count, rot, scale)
 *  3. expandGroups() deterministically scatters groups → individual [x,y,z] placements
 *  4. Results saved to world-plan.json
 *  5. level-builder.js reads getPlacements() instead of keyLocations (6 → 50-100 actors)
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../lib/logger.js';
import { chatOneShot } from '../../lib/claude.js';
import { getActiveGame } from './game-config.js';

const log = createLogger('world-planner');

function getPaths() {
  const g = getActiveGame();
  return {
    worldPlanPath: g.worldPlanPath,
    assetManifestPath: g.assetManifestPath,
    regionManifestPath: g.regionManifestPath,
    displayName: g.displayName,
    genre: g.genre,
    artStyle: g.artStyle || 'stylized',
  };
}

// ── Seeded LCG for deterministic scatter ─────────────────────────────────────

function lcg(seed) {
  let s = seed | 0;
  return () => {
    s = Math.imul(1664525, s) + 1013904223 | 0;
    return (s >>> 0) / 0xFFFFFFFF;
  };
}

/**
 * Scatter `count` points around `center` within `radius`.
 * Uses seeded LCG so results are deterministic given same inputs.
 */
function scatter(center, radius, count, seed) {
  const rand = lcg(seed);
  const points = [];
  for (let i = 0; i < count; i++) {
    // Uniform disk sampling
    const angle = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * radius;
    const x = center[0] + Math.cos(angle) * r;
    const y = center[1] + Math.sin(angle) * r;
    const z = center[2] || 0;
    points.push([Math.round(x), Math.round(y), Math.round(z)]);
  }
  return points;
}

/**
 * Generate points in a line from center, spaced evenly.
 */
function line(center, radius, count, seed) {
  const rand = lcg(seed);
  const angle = rand() * Math.PI * 2;
  const points = [];
  const half = (count - 1) / 2;
  const spacing = count > 1 ? (radius * 2) / (count - 1) : 0;
  for (let i = 0; i < count; i++) {
    const dist = (i - half) * spacing;
    const x = center[0] + Math.cos(angle) * dist;
    const y = center[1] + Math.sin(angle) * dist;
    points.push([Math.round(x), Math.round(y), center[2] || 0]);
  }
  return points;
}

/**
 * Cluster: tight scatter with small radius (1/3 of given radius).
 */
function cluster(center, radius, count, seed) {
  return scatter(center, radius * 0.33, count, seed);
}

/**
 * Singular: just the center point.
 */
function singular(center) {
  return [[center[0], center[1], center[2] || 0]];
}

// ── Group expansion ───────────────────────────────────────────────────────────

/**
 * Expand a placement group into individual placement objects.
 * Each group: { assetId, pattern, center, radius, count, rotMin, rotMax, scaleMin, scaleMax }
 */
function expandGroup(group, groupIndex) {
  const {
    assetId,
    pattern = 'scatter',
    center = [0, 0, 0],
    radius = 1000,
    count = 1,
    rotMin = 0,
    rotMax = 360,
    scaleMin = 0.9,
    scaleMax = 1.1,
  } = group;

  const seed = (assetId.split('').reduce((a, c) => a + c.charCodeAt(0), 0) + groupIndex * 7919) | 0;
  const rand = lcg(seed + 1);

  let positions;
  switch (pattern) {
    case 'singular': positions = singular(center); break;
    case 'cluster':  positions = cluster(center, radius, count, seed); break;
    case 'line':     positions = line(center, radius, count, seed); break;
    case 'scatter':
    default:         positions = scatter(center, radius, count, seed); break;
  }

  return positions.map(pos => ({
    assetId,
    position: pos,
    rotation: [0, 0, Math.round(rotMin + rand() * (rotMax - rotMin))],
    scale: Math.round((scaleMin + rand() * (scaleMax - scaleMin)) * 100) / 100,
  }));
}

/**
 * Expand all groups for a region into a flat placements array.
 */
function expandGroups(groups) {
  const placements = [];
  for (let i = 0; i < groups.length; i++) {
    placements.push(...expandGroup(groups[i], i));
  }
  return placements;
}

// ── Fallback deterministic planner ───────────────────────────────────────────

const ASSET_TYPE_RULES = {
  hero:        { pattern: 'singular', count: 1,  radiusMin: 0,    radiusMax: 800  },
  prop:        { pattern: 'cluster',  count: 4,  radiusMin: 800,  radiusMax: 3000 },
  environment: { pattern: 'scatter',  count: 8,  radiusMin: 2000, radiusMax: 5000 },
  foliage:     { pattern: 'scatter',  count: 12, radiusMin: 500,  radiusMax: 5500 },
};

/**
 * Fallback: generate placement groups using only the asset type rules.
 * No LLM involved — purely deterministic from asset manifest data.
 */
function fallbackPlan(regionId, region, assets) {
  log.info({ regionId }, 'Using fallback deterministic planner');
  const halfW = (region.layout?.size?.[0] || 8000) / 2;
  const halfD = (region.layout?.size?.[1] || 8000) / 2;
  const maxRadius = Math.min(halfW, halfD) * 0.9;

  const rand = lcg(regionId.split('').reduce((a, c) => a + c.charCodeAt(0), 0));

  const groups = [];
  for (const asset of assets) {
    const rule = ASSET_TYPE_RULES[asset.type] || ASSET_TYPE_RULES.prop;
    const radiusMin = Math.min(rule.radiusMin, maxRadius * 0.4);
    const radiusMax = Math.min(rule.radiusMax, maxRadius);

    // Place center randomly within mid-range
    const angle = rand() * Math.PI * 2;
    const dist = radiusMin + rand() * (radiusMax - radiusMin) * 0.5;
    const cx = Math.round(Math.cos(angle) * dist);
    const cy = Math.round(Math.sin(angle) * dist);

    groups.push({
      assetId: asset.id,
      pattern: rule.pattern,
      center: [cx, cy, 0],
      radius: Math.round(radiusMin + rand() * (radiusMax - radiusMin) * 0.3),
      count: rule.count,
      rotMin: 0,
      rotMax: 360,
      scaleMin: 0.85,
      scaleMax: 1.15,
    });
  }
  return groups;
}

// ── Claude prompt builder ─────────────────────────────────────────────────────

function buildPrompt(regionId, region, assets) {
  const size = region.layout?.size || [8000, 8000];
  const halfW = size[0] / 2;
  const halfD = size[1] / 2;
  const theme = region.theme || 'game region';
  const terrain = region.layout?.terrain || 'varied terrain';
  const paths = getPaths();

  const assetLines = assets.map(a =>
    `- ${a.id} (${a.type}): ${a.description || a.name}`
  ).join('\n');

  return `You are a game world designer for "${paths.displayName}", a ${paths.genre} game (${paths.artStyle} art style).

Region: ${regionId}
Theme: ${theme}
Terrain: ${terrain}
Size: ${size[0]}×${size[1]} UE5 units (center = [0,0,0], bounds ±${halfW} ×±${halfD})

AVAILABLE ASSETS (${assets.length} total):
${assetLines}

PLACEMENT RULES:
- hero assets → pattern: "singular", count: 1, place at center area (radius 0-800), they are the focal point
- prop assets → pattern: "cluster", count: 3-6 instances, spread across mid-range (radius 800-3000)
- environment assets → pattern: "scatter", count: 5-12 instances, outer area (radius 2000-5000)
- foliage assets → pattern: "scatter", count: 8-20 instances, throughout region (radius 200-5500)

For each asset, generate ONE placement group. Total placements across all groups should be 50-100.
Consider the theme and terrain — cluster related props together, place hero assets prominently.
Vary rotation (rotMin/rotMax) and scale (scaleMin/scaleMax) for natural variety.

Return ONLY a valid JSON array — no explanation, no markdown, no comments:
[
  {
    "assetId": "string",
    "pattern": "singular|cluster|scatter|line",
    "center": [x, y, 0],
    "radius": number,
    "count": number,
    "rotMin": 0,
    "rotMax": 360,
    "scaleMin": 0.8,
    "scaleMax": 1.2
  }
]`;
}

// ── JSON extraction ───────────────────────────────────────────────────────────

function extractJson(text) {
  // Try direct parse first
  try { return JSON.parse(text.trim()); } catch { /* fall through */ }

  // Extract first JSON array
  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    try { return JSON.parse(match[0]); } catch { /* fall through */ }
  }

  return null;
}

// ── Load / save world plan ────────────────────────────────────────────────────

function loadWorldPlan() {
  const { worldPlanPath } = getPaths();
  if (!existsSync(worldPlanPath)) return { version: 1, regions: {} };
  try { return JSON.parse(readFileSync(worldPlanPath, 'utf-8')); }
  catch { return { version: 1, regions: {} }; }
}

function saveWorldPlan(plan) {
  writeFileSync(getPaths().worldPlanPath, JSON.stringify(plan, null, 2), 'utf-8');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns true if world-plan.json has valid placement data for this region.
 */
export function hasDetailedPlan(regionId) {
  const plan = loadWorldPlan();
  const r = plan.regions?.[regionId];
  return !!(r && Array.isArray(r.placements) && r.placements.length > 0);
}

/**
 * Returns the placements array for a region (or [] if no plan).
 */
export function getPlacements(regionId) {
  const plan = loadWorldPlan();
  return plan.regions?.[regionId]?.placements || [];
}

/**
 * Clears the cached plan for a region so it will be re-planned.
 */
export function resetRegionPlan(regionId) {
  const plan = loadWorldPlan();
  if (plan.regions?.[regionId]) {
    delete plan.regions[regionId];
    saveWorldPlan(plan);
    log.info({ regionId }, 'Region plan reset');
  }
  return { success: true, regionId };
}

/**
 * Plan a single region: call Claude, expand groups, save to world-plan.json.
 */
export async function planRegion(regionId) {
  // Load manifests
  const { assetManifestPath, regionManifestPath } = getPaths();
  const assetManifestRaw = existsSync(assetManifestPath)
    ? JSON.parse(readFileSync(assetManifestPath, 'utf-8'))
    : null;

  const regionManifestRaw = existsSync(regionManifestPath)
    ? JSON.parse(readFileSync(regionManifestPath, 'utf-8'))
    : null;

  const region = regionManifestRaw?.regions?.[regionId];
  if (!region) return { success: false, error: `Region not found: ${regionId}` };

  const regionAssets = (assetManifestRaw?.regions?.[regionId]?.assets || [])
    .filter(a => a.status === 'done' || a.fbx_path); // include any asset that has a path

  if (regionAssets.length === 0) {
    return { success: false, error: `No assets found for region: ${regionId}` };
  }

  log.info({ regionId, assetCount: regionAssets.length }, 'Planning region placement');

  const prompt = buildPrompt(regionId, region, regionAssets);

  let groups;
  let source = 'claude';

  try {
    log.info({ regionId }, 'Calling Claude for spatial planning');
    const response = await chatOneShot(prompt, null);
    const parsed = extractJson(response);

    if (parsed && Array.isArray(parsed) && parsed.length > 0) {
      groups = parsed;
      log.info({ regionId, groupCount: groups.length }, 'Claude returned placement groups');
    } else {
      log.warn({ regionId }, 'Claude response did not contain valid JSON, using fallback');
      groups = fallbackPlan(regionId, region, regionAssets);
      source = 'fallback';
    }
  } catch (err) {
    log.warn({ regionId, err: err.message }, 'Claude call failed, using fallback planner');
    groups = fallbackPlan(regionId, region, regionAssets);
    source = 'fallback';
  }

  // Expand groups → individual placements
  const placements = expandGroups(groups);

  // Save to world-plan.json
  const plan = loadWorldPlan();
  plan.regions[regionId] = {
    plannedAt: new Date().toISOString(),
    source,
    groupCount: groups.length,
    placementCount: placements.length,
    placements,
  };
  saveWorldPlan(plan);

  log.info({ regionId, placementCount: placements.length, source }, 'Region plan saved');
  return {
    success: true,
    regionId,
    source,
    groupCount: groups.length,
    placementCount: placements.length,
  };
}

/**
 * Plan all 5 regions in sequence.
 */
export async function planAllRegions() {
  const { regionManifestPath } = getPaths();
  const regionManifestRaw = existsSync(regionManifestPath)
    ? JSON.parse(readFileSync(regionManifestPath, 'utf-8'))
    : null;

  if (!regionManifestRaw) return { success: false, error: 'No region manifest found' };

  const regionIds = Object.keys(regionManifestRaw.regions || {});
  const results = [];

  for (const regionId of regionIds) {
    try {
      const result = await planRegion(regionId);
      results.push({ regionId, ...result });
      log.info({ regionId, placementCount: result.placementCount }, 'Region planned');
    } catch (err) {
      results.push({ regionId, success: false, error: err.message });
      log.warn({ regionId, err: err.message }, 'Region planning failed');
    }

    // Small delay between Claude calls to avoid rate limiting
    await new Promise(r => setTimeout(r, 2000));
  }

  const totalPlacements = results.reduce((n, r) => n + (r.placementCount || 0), 0);
  const succeeded = results.filter(r => r.success).length;

  return {
    success: true,
    regionsPlanned: succeeded,
    totalRegions: regionIds.length,
    totalPlacements,
    results,
  };
}
