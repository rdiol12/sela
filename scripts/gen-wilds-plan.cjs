/**
 * Generate world-plan.json placements for TheWilds region.
 * Uses the deterministic fallback planner logic from world-planner.js.
 */
const fs = require('fs');
const path = require('path');

const ASSET_MANIFEST = path.join(__dirname, '..', 'workspace', 'shattered-crown', 'Assets', 'asset-manifest.json');
const REGION_MANIFEST = path.join(__dirname, '..', 'workspace', 'shattered-crown', 'Assets', 'region-manifest.json');
const WORLD_PLAN = path.join(__dirname, '..', 'workspace', 'shattered-crown', 'Assets', 'world-plan.json');

// Seeded LCG for deterministic scatter
function lcg(seed) {
  let s = seed | 0;
  return () => {
    s = Math.imul(1664525, s) + 1013904223 | 0;
    return (s >>> 0) / 0xFFFFFFFF;
  };
}

function scatter(center, radius, count, seed) {
  const rand = lcg(seed);
  const points = [];
  for (let i = 0; i < count; i++) {
    const angle = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * radius;
    const x = center[0] + Math.cos(angle) * r;
    const y = center[1] + Math.sin(angle) * r;
    const z = center[2] || 0;
    points.push([Math.round(x), Math.round(y), Math.round(z)]);
  }
  return points;
}

function cluster(center, radius, count, seed) {
  return scatter(center, radius * 0.33, count, seed);
}

function singular(center) {
  return [[center[0], center[1], center[2] || 0]];
}

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

// TheWilds-specific placement plan
// Natural forest with creature dens, camp sites, standing stones
const WILDS_PLAN = [
  // ── HERO assets — singular, at focal points ──
  { assetId: 'wild_oak_tree', pattern: 'singular', center: [0, 0, 0], radius: 0, count: 1, rotMin: 0, rotMax: 360, scaleMin: 1.1, scaleMax: 1.3 },
  { assetId: 'wild_standing_stone', pattern: 'singular', center: [4000, -3000, 0], radius: 0, count: 1, rotMin: 0, rotMax: 360, scaleMin: 1.0, scaleMax: 1.0 },
  { assetId: 'wild_stone_circle', pattern: 'singular', center: [4200, -2800, 0], radius: 0, count: 1, rotMin: 0, rotMax: 360, scaleMin: 1.0, scaleMax: 1.0 },

  // ── PROP assets — clusters near key locations ──
  { assetId: 'wild_hunter_camp', pattern: 'singular', center: [-3000, 2000, 0], radius: 0, count: 1, rotMin: 0, rotMax: 360, scaleMin: 1.0, scaleMax: 1.0 },
  { assetId: 'wild_campsite_log', pattern: 'cluster', center: [-2800, 2200, 0], radius: 400, count: 3, rotMin: 0, rotMax: 360, scaleMin: 0.9, scaleMax: 1.1 },
  { assetId: 'wild_deer_skull', pattern: 'cluster', center: [-2000, -1500, 0], radius: 600, count: 3, rotMin: 0, rotMax: 360, scaleMin: 0.85, scaleMax: 1.0 },
  { assetId: 'wild_bee_hive', pattern: 'cluster', center: [1000, -2000, 0], radius: 800, count: 2, rotMin: 0, rotMax: 360, scaleMin: 0.9, scaleMax: 1.1 },
  { assetId: 'wild_nest_ground', pattern: 'scatter', center: [2500, 2500, 0], radius: 1500, count: 4, rotMin: 0, rotMax: 360, scaleMin: 0.8, scaleMax: 1.0 },
  { assetId: 'wild_fishing_spot', pattern: 'singular', center: [3200, 1200, 0], radius: 0, count: 1, rotMin: 0, rotMax: 360, scaleMin: 1.0, scaleMax: 1.0 },
  { assetId: 'wild_ranger_cache', pattern: 'cluster', center: [-4000, -1000, 0], radius: 300, count: 2, rotMin: 0, rotMax: 360, scaleMin: 0.9, scaleMax: 1.1 },

  // ── ENVIRONMENT assets — scattered throughout ──
  { assetId: 'wild_stream_rocks', pattern: 'line', center: [3000, 1000, 0], radius: 2000, count: 5, rotMin: 0, rotMax: 360, scaleMin: 0.8, scaleMax: 1.2 },
  { assetId: 'wild_fallen_log', pattern: 'scatter', center: [1500, 3000, 0], radius: 2500, count: 4, rotMin: 0, rotMax: 360, scaleMin: 0.9, scaleMax: 1.15 },
  { assetId: 'wild_wooden_bridge', pattern: 'singular', center: [2500, 500, 0], radius: 0, count: 1, rotMin: -10, rotMax: 10, scaleMin: 1.0, scaleMax: 1.0 },
  { assetId: 'wild_fox_den', pattern: 'scatter', center: [-1500, 3500, 0], radius: 2000, count: 3, rotMin: 0, rotMax: 360, scaleMin: 0.9, scaleMax: 1.1 },
  { assetId: 'wild_mushroom_log', pattern: 'scatter', center: [-500, -3000, 0], radius: 2500, count: 5, rotMin: 0, rotMax: 360, scaleMin: 0.85, scaleMax: 1.2 },
  { assetId: 'wild_wolf_tracks', pattern: 'scatter', center: [500, -1000, 0], radius: 3500, count: 6, rotMin: 0, rotMax: 360, scaleMin: 0.9, scaleMax: 1.0 },
  { assetId: 'wild_rock_outcrop', pattern: 'scatter', center: [2000, -4000, 0], radius: 2000, count: 4, rotMin: 0, rotMax: 360, scaleMin: 0.8, scaleMax: 1.3 },
  { assetId: 'wild_antler_arch', pattern: 'singular', center: [-1000, 0, 0], radius: 0, count: 1, rotMin: -5, rotMax: 5, scaleMin: 1.0, scaleMax: 1.0 },
  { assetId: 'wild_waterfall_small', pattern: 'singular', center: [4500, 2000, 0], radius: 0, count: 1, rotMin: 0, rotMax: 360, scaleMin: 1.0, scaleMax: 1.1 },
  { assetId: 'wild_owl_tree', pattern: 'scatter', center: [-3500, -3000, 0], radius: 1500, count: 3, rotMin: 0, rotMax: 360, scaleMin: 0.9, scaleMax: 1.1 },

  // ── FOLIAGE — dense scatter for forest feel ──
  { assetId: 'wild_birch_tree', pattern: 'scatter', center: [0, 2000, 0], radius: 5500, count: 12, rotMin: 0, rotMax: 360, scaleMin: 0.8, scaleMax: 1.2 },
  { assetId: 'wild_pine_tree', pattern: 'scatter', center: [-2000, 0, 0], radius: 5500, count: 10, rotMin: 0, rotMax: 360, scaleMin: 0.85, scaleMax: 1.3 },
  { assetId: 'wild_maple_tree', pattern: 'scatter', center: [2000, -1000, 0], radius: 5000, count: 8, rotMin: 0, rotMax: 360, scaleMin: 0.8, scaleMax: 1.15 },
  { assetId: 'wild_berry_bush', pattern: 'scatter', center: [1000, 1000, 0], radius: 4000, count: 8, rotMin: 0, rotMax: 360, scaleMin: 0.85, scaleMax: 1.1 },
  { assetId: 'wild_herb_patch', pattern: 'scatter', center: [-1500, 1500, 0], radius: 3500, count: 6, rotMin: 0, rotMax: 360, scaleMin: 0.9, scaleMax: 1.1 },
];

// Expand groups into individual placements
function expandGroup(group, groupIndex) {
  const {
    assetId, pattern = 'scatter', center = [0, 0, 0],
    radius = 1000, count = 1,
    rotMin = 0, rotMax = 360,
    scaleMin = 0.9, scaleMax = 1.1,
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

function expandGroups(groups) {
  const placements = [];
  for (let i = 0; i < groups.length; i++) {
    placements.push(...expandGroup(groups[i], i));
  }
  return placements;
}

// ── Main ──
const placements = expandGroups(WILDS_PLAN);
console.log(`Generated ${placements.length} placements from ${WILDS_PLAN.length} groups`);

// Load or create world plan
let worldPlan = { version: 1, regions: {} };
if (fs.existsSync(WORLD_PLAN)) {
  worldPlan = JSON.parse(fs.readFileSync(WORLD_PLAN, 'utf-8'));
}

worldPlan.regions.TheWilds = {
  plannedAt: new Date().toISOString(),
  source: 'curated',
  groupCount: WILDS_PLAN.length,
  placementCount: placements.length,
  placements,
};

fs.writeFileSync(WORLD_PLAN, JSON.stringify(worldPlan, null, 2), 'utf-8');
console.log(`Saved to ${WORLD_PLAN}`);
console.log(`\nPlacement breakdown:`);

const byAsset = {};
for (const p of placements) {
  byAsset[p.assetId] = (byAsset[p.assetId] || 0) + 1;
}
for (const [id, count] of Object.entries(byAsset).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${id}: ${count}`);
}
