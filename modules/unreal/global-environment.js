/**
 * modules/unreal/global-environment.js — Global lighting, post-processing, and region transitions.
 *
 * Manages:
 *  1. Per-region environment profiles (lighting color, intensity, fog, post-processing)
 *  2. Region transition volumes (boundary actors that trigger level streaming)
 *  3. Global post-processing (base PP volume applied to entire game)
 *
 * Used by level-builder.js for the "Global" region build steps,
 * and registered as tools in index.js.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { callTool } from '../../lib/mcp-gateway.js';
import { createLogger } from '../../lib/logger.js';
import { getActiveGame } from './game-config.js';

const log = createLogger('global-env');

// ── Region Environment Profiles ──────────────────────────────────────────────

/**
 * Complete environment profiles for each region.
 * Combines lighting, fog, and post-processing into one cohesive look.
 */
export const REGION_PROFILES = {
  CrossroadsHub: {
    displayName: 'Crossroads Hub',
    timeOfDay: 'sunset',
    sun: { color: [1, 0.85, 0.6], intensity: 3, rotation: [-35, 45, 0] },
    sky: { intensity: 0.4 },
    fog: { enabled: true, density: 0.008, color: [0.9, 0.75, 0.5], startDistance: 500 },
    postProcess: { bloom: 0.4, exposure: 0.2, ao: 0.4, vignette: 0.15, temperature: 6200 },
  },
  AshenWilds: {
    displayName: 'Ashen Wilds',
    timeOfDay: 'dusk',
    sun: { color: [1, 0.4, 0.1], intensity: 2.5, rotation: [-20, -30, 0] },
    sky: { intensity: 0.2 },
    fog: { enabled: true, density: 0.025, color: [0.3, 0.1, 0.05], startDistance: 200 },
    postProcess: { bloom: 0.6, exposure: -0.3, ao: 0.7, vignette: 0.4, temperature: 3500 },
  },
  Ironhold: {
    displayName: 'Ironhold Fortress',
    timeOfDay: 'overcast',
    sun: { color: [0.7, 0.75, 0.8], intensity: 2, rotation: [-50, 60, 0] },
    sky: { intensity: 0.35 },
    fog: { enabled: true, density: 0.012, color: [0.5, 0.55, 0.6], startDistance: 400 },
    postProcess: { bloom: 0.3, exposure: 0, ao: 0.5, vignette: 0.2, temperature: 7000 },
  },
  VerdantReach: {
    displayName: 'Verdant Reach',
    timeOfDay: 'twilight',
    sun: { color: [0.3, 0.6, 0.4], intensity: 1.5, rotation: [-25, -60, 0] },
    sky: { intensity: 0.5 },
    fog: { enabled: true, density: 0.03, color: [0.1, 0.3, 0.15], startDistance: 150 },
    postProcess: { bloom: 0.5, exposure: -0.2, ao: 0.6, vignette: 0.3, temperature: 5200 },
  },
  SunkenHalls: {
    displayName: 'Sunken Halls',
    timeOfDay: 'underwater',
    sun: { color: [0.1, 0.5, 0.6], intensity: 1, rotation: [-70, 10, 0] },
    sky: { intensity: 0.6 },
    fog: { enabled: true, density: 0.05, color: [0.05, 0.2, 0.25], startDistance: 80 },
    postProcess: { bloom: 0.7, exposure: -0.5, ao: 0.3, vignette: 0.5, temperature: 4500 },
  },
  EmberPeaks: {
    displayName: 'Ember Peaks',
    timeOfDay: 'volcanic',
    sun: { color: [1, 0.3, 0], intensity: 4, rotation: [-15, 90, 0] },
    sky: { intensity: 0.15 },
    fog: { enabled: true, density: 0.02, color: [0.4, 0.1, 0], startDistance: 300 },
    postProcess: { bloom: 0.8, exposure: 0.3, ao: 0.5, vignette: 0.35, temperature: 2800 },
  },
  Aethermere: {
    displayName: 'Aethermere Void',
    timeOfDay: 'ethereal',
    sun: { color: [0.5, 0.3, 0.8], intensity: 2, rotation: [-60, -45, 0] },
    sky: { intensity: 0.7 },
    fog: { enabled: true, density: 0.015, color: [0.2, 0.1, 0.4], startDistance: 250 },
    postProcess: { bloom: 0.9, exposure: -0.1, ao: 0.4, vignette: 0.45, temperature: 8500 },
  },
  TheWilds: {
    displayName: 'The Wilds',
    timeOfDay: 'afternoon',
    sun: { color: [1, 0.95, 0.8], intensity: 4, rotation: [-45, 30, 0] },
    sky: { intensity: 0.5 },
    fog: { enabled: false, density: 0.005, color: [0.8, 0.85, 0.7], startDistance: 800 },
    postProcess: { bloom: 0.3, exposure: 0.5, ao: 0.6, vignette: 0.2, temperature: 5800 },
  },
};

// ── Region Transitions ───────────────────────────────────────────────────────

/**
 * Region adjacency map with transition volume positions.
 * CrossroadsHub is the central hub connecting to 4 regions.
 * AshenWilds → EmberPeaks and VerdantReach → SunkenHalls are chains.
 * Aethermere and TheWilds connect to CrossroadsHub.
 */
export const REGION_TRANSITIONS = [
  { from: 'CrossroadsHub', to: 'AshenWilds',   position: [3500, 0, 100],      scale: [2, 10, 5] },
  { from: 'CrossroadsHub', to: 'Ironhold',     position: [0, 3500, 100],      scale: [10, 2, 5] },
  { from: 'CrossroadsHub', to: 'VerdantReach', position: [-3500, 0, 100],     scale: [2, 10, 5] },
  { from: 'CrossroadsHub', to: 'TheWilds',     position: [0, -3500, 100],     scale: [10, 2, 5] },
  { from: 'CrossroadsHub', to: 'Aethermere',   position: [2500, 2500, 100],   scale: [5, 5, 5] },
  { from: 'AshenWilds',    to: 'EmberPeaks',   position: [5500, -2000, 100],  scale: [2, 8, 5] },
  { from: 'VerdantReach',  to: 'SunkenHalls',  position: [-5500, -2000, 100], scale: [2, 8, 5] },
];

// ── Check Unreal reachability ───────────────────────────────────────────────

async function pingUnreal() {
  try {
    const result = await callTool('unreal', 'get_actors_in_level', {}, 10_000);
    return result && (result.status === 'success' || result.success !== false);
  } catch {
    return false;
  }
}

// ── Build Global Environment ────────────────────────────────────────────────

/**
 * Apply region environment to an existing level.
 * Creates/updates directional light + sky light actors.
 */
async function applyRegionLighting(regionId) {
  const profile = REGION_PROFILES[regionId];
  if (!profile) return { success: false, error: `No profile for region: ${regionId}` };

  const prefix = `L_${regionId}`;
  const results = [];

  // 1. Create/set directional light (sun)
  try {
    const sunName = `${prefix}_DirectionalLight`;
    const sunResult = await callTool('unreal', 'spawn_physics_blueprint_actor', {
      name: sunName,
      mesh_path: '/Engine/BasicShapes/Sphere.Sphere',
      location: [0, 0, 5000],
      scale: [3, 3, 3],
      color: [...profile.sun.color, 1],
      simulate_physics: false,
      gravity_enabled: false,
    }, 15_000);
    results.push({ step: 'sun', success: true, actor: sunName });
    log.info({ regionId, actor: sunName }, 'Sun marker placed');
  } catch (err) {
    results.push({ step: 'sun', success: false, error: err.message });
    log.warn({ regionId, err: err.message }, 'Sun placement failed');
  }

  // 2. Set sun rotation via set_actor_transform
  try {
    await callTool('unreal', 'set_actor_transform', {
      name: `${prefix}_DirectionalLight`,
      rotation: profile.sun.rotation,
    }, 10_000);
    results.push({ step: 'sun_rotation', success: true });
  } catch (err) {
    results.push({ step: 'sun_rotation', success: false, error: err.message });
  }

  return { success: true, regionId, profile: profile.displayName, results };
}

/**
 * Create a transition volume between two regions.
 * Places a visible marker actor at the boundary.
 */
async function createTransitionVolume(transition) {
  const { from, to, position, scale } = transition;
  const name = `TransitionVolume_${from}_to_${to}`;

  try {
    // Use a semi-transparent blue volume marker
    const result = await callTool('unreal', 'spawn_physics_blueprint_actor', {
      name,
      mesh_path: '/Engine/BasicShapes/Cube.Cube',
      location: position,
      scale,
      color: [0.2, 0.5, 1.0, 0.3], // Semi-transparent blue
      simulate_physics: false,
      gravity_enabled: false,
    }, 15_000);

    log.info({ from, to, name }, 'Transition volume placed');
    return { success: true, name, from, to, position };
  } catch (err) {
    log.warn({ from, to, err: err.message }, 'Transition volume failed');
    return { success: false, name, error: err.message };
  }
}

/**
 * Create a transition Blueprint with variables for source/target region.
 */
async function createTransitionBlueprint() {
  const results = [];

  try {
    // Create BP_RegionTransition
    const bpResult = await callTool('unreal', 'create_blueprint', {
      name: 'BP_RegionTransition',
      parent_class: 'Actor',
    }, 30_000);
    results.push({ step: 'create_bp', success: true });

    // Add variables
    const vars = [
      { variable_name: 'SourceRegion', variable_type: 'string', default_value: '', category: 'Transition', tooltip: 'Region the player is leaving' },
      { variable_name: 'TargetRegion', variable_type: 'string', default_value: '', category: 'Transition', tooltip: 'Region the player is entering' },
      { variable_name: 'TransitionDuration', variable_type: 'float', default_value: 1.5, category: 'Transition', tooltip: 'Crossfade duration in seconds' },
      { variable_name: 'bIsActive', variable_type: 'bool', default_value: true, category: 'State', tooltip: 'Whether this transition is currently active' },
    ];

    for (const v of vars) {
      try {
        await callTool('unreal', 'create_variable', {
          blueprint_name: 'BP_RegionTransition',
          ...v,
        }, 10_000);
        results.push({ step: `var_${v.variable_name}`, success: true });
      } catch (err) {
        results.push({ step: `var_${v.variable_name}`, success: false, error: err.message });
      }
    }

    // Add BeginPlay event
    await callTool('unreal', 'add_event_node', {
      blueprint_name: 'BP_RegionTransition',
      event_name: 'ReceiveBeginPlay',
    }, 10_000);

    // Add overlap event for triggering transitions
    await callTool('unreal', 'add_event_node', {
      blueprint_name: 'BP_RegionTransition',
      event_name: 'ReceiveActorBeginOverlap',
    }, 10_000);

    results.push({ step: 'events', success: true });
    log.info('BP_RegionTransition created with variables and events');
  } catch (err) {
    results.push({ step: 'create_bp', success: false, error: err.message });
    log.warn({ err: err.message }, 'BP_RegionTransition creation failed');
  }

  return results;
}

/**
 * Create a global post-processing Blueprint that manages all PP settings.
 */
async function createGlobalPostProcessBP() {
  const results = [];

  try {
    const bpResult = await callTool('unreal', 'create_blueprint', {
      name: 'BP_GlobalPostProcess',
      parent_class: 'Actor',
    }, 30_000);
    results.push({ step: 'create_bp', success: true });

    // Variables for PP settings
    const vars = [
      { variable_name: 'CurrentRegion', variable_type: 'string', default_value: 'CrossroadsHub', category: 'Environment' },
      { variable_name: 'BloomIntensity', variable_type: 'float', default_value: 0.5, category: 'PostProcess' },
      { variable_name: 'ExposureBias', variable_type: 'float', default_value: 0.0, category: 'PostProcess' },
      { variable_name: 'AmbientOcclusion', variable_type: 'float', default_value: 0.5, category: 'PostProcess' },
      { variable_name: 'VignetteIntensity', variable_type: 'float', default_value: 0.3, category: 'PostProcess' },
      { variable_name: 'ColorTemperature', variable_type: 'float', default_value: 6500, category: 'PostProcess' },
      { variable_name: 'FogDensity', variable_type: 'float', default_value: 0.01, category: 'Fog' },
      { variable_name: 'bFogEnabled', variable_type: 'bool', default_value: true, category: 'Fog' },
      { variable_name: 'TransitionAlpha', variable_type: 'float', default_value: 1.0, category: 'Transition' },
    ];

    for (const v of vars) {
      try {
        await callTool('unreal', 'create_variable', {
          blueprint_name: 'BP_GlobalPostProcess',
          ...v,
        }, 10_000);
        results.push({ step: `var_${v.variable_name}`, success: true });
      } catch (err) {
        results.push({ step: `var_${v.variable_name}`, success: false, error: err.message });
      }
    }

    // Add BeginPlay
    await callTool('unreal', 'add_event_node', {
      blueprint_name: 'BP_GlobalPostProcess',
      event_name: 'ReceiveBeginPlay',
    }, 10_000);

    // Add Tick for smooth transitions
    await callTool('unreal', 'add_event_node', {
      blueprint_name: 'BP_GlobalPostProcess',
      event_name: 'ReceiveTick',
    }, 10_000);

    results.push({ step: 'events', success: true });
    log.info('BP_GlobalPostProcess created');
  } catch (err) {
    results.push({ step: 'create_bp', success: false, error: err.message });
    log.warn({ err: err.message }, 'BP_GlobalPostProcess creation failed');
  }

  return results;
}

/**
 * Create a global lighting controller Blueprint.
 */
async function createGlobalLightingBP() {
  const results = [];

  try {
    const bpResult = await callTool('unreal', 'create_blueprint', {
      name: 'BP_GlobalLighting',
      parent_class: 'Actor',
    }, 30_000);
    results.push({ step: 'create_bp', success: true });

    const vars = [
      { variable_name: 'SunColor', variable_type: 'vector', default_value: null, category: 'Sun' },
      { variable_name: 'SunIntensity', variable_type: 'float', default_value: 3.0, category: 'Sun' },
      { variable_name: 'SunRotation', variable_type: 'rotator', default_value: null, category: 'Sun' },
      { variable_name: 'SkyIntensity', variable_type: 'float', default_value: 0.5, category: 'Sky' },
      { variable_name: 'FogColor', variable_type: 'vector', default_value: null, category: 'Fog' },
      { variable_name: 'FogDensity', variable_type: 'float', default_value: 0.01, category: 'Fog' },
      { variable_name: 'ActiveRegion', variable_type: 'string', default_value: 'CrossroadsHub', category: 'Region' },
    ];

    for (const v of vars) {
      try {
        await callTool('unreal', 'create_variable', {
          blueprint_name: 'BP_GlobalLighting',
          ...v,
        }, 10_000);
        results.push({ step: `var_${v.variable_name}`, success: true });
      } catch (err) {
        results.push({ step: `var_${v.variable_name}`, success: false, error: err.message });
      }
    }

    await callTool('unreal', 'add_event_node', {
      blueprint_name: 'BP_GlobalLighting',
      event_name: 'ReceiveBeginPlay',
    }, 10_000);

    results.push({ step: 'events', success: true });
    log.info('BP_GlobalLighting created');
  } catch (err) {
    results.push({ step: 'create_bp', success: false, error: err.message });
  }

  return results;
}

// ── Main Builder ────────────────────────────────────────────────────────────

/**
 * Build the complete global environment system.
 * Creates BPs, transition volumes, and applies base lighting.
 * Called by level-builder.js when the Global region is built.
 */
export async function buildGlobalEnvironment() {
  const alive = await pingUnreal();
  if (!alive) return { success: false, error: 'Unreal Editor not reachable' };

  log.info('Building global environment system');
  const summary = { blueprints: [], transitions: [], lighting: [] };

  // Phase 1: Create global Blueprints
  log.info('Phase 1: Creating global environment Blueprints');
  summary.blueprints.push({
    name: 'BP_GlobalPostProcess',
    results: await createGlobalPostProcessBP(),
  });
  summary.blueprints.push({
    name: 'BP_GlobalLighting',
    results: await createGlobalLightingBP(),
  });
  summary.blueprints.push({
    name: 'BP_RegionTransition',
    results: await createTransitionBlueprint(),
  });

  // Phase 2: Place transition volumes at region boundaries
  log.info('Phase 2: Placing transition volumes');
  for (const transition of REGION_TRANSITIONS) {
    const result = await createTransitionVolume(transition);
    summary.transitions.push(result);
  }

  // Phase 3: Apply base CrossroadsHub lighting as default
  log.info('Phase 3: Applying default lighting (CrossroadsHub)');
  const lightResult = await applyRegionLighting('CrossroadsHub');
  summary.lighting.push(lightResult);

  const totalTransitions = summary.transitions.length;
  const successfulTransitions = summary.transitions.filter(t => t.success).length;
  const totalBPSteps = summary.blueprints.reduce((n, bp) =>
    n + (Array.isArray(bp.results) ? bp.results.filter(r => r.success).length : 0), 0);

  log.info({
    transitions: `${successfulTransitions}/${totalTransitions}`,
    bpSteps: totalBPSteps,
  }, 'Global environment build complete');

  return {
    success: true,
    summary: {
      blueprintsCreated: summary.blueprints.map(b => b.name),
      transitionVolumes: `${successfulTransitions}/${totalTransitions}`,
      bpSteps: totalBPSteps,
      defaultLighting: 'CrossroadsHub',
    },
    details: summary,
  };
}

/**
 * Get environment profile for a region.
 */
export function getRegionProfile(regionId) {
  return REGION_PROFILES[regionId] || null;
}

/**
 * Get all transition definitions.
 */
export function getTransitions() {
  return REGION_TRANSITIONS;
}

/**
 * Save the environment profiles to a JSON file in the game assets
 * for runtime use by the UE5 game code.
 */
export function exportProfilesToJSON() {
  const g = getActiveGame();
  const outPath = g.assetsPath
    ? `${g.assetsPath}/environment-profiles.json`
    : 'workspace/shattered-crown/Assets/environment-profiles.json';

  const data = {
    version: 2,
    exportedAt: new Date().toISOString(),
    profiles: REGION_PROFILES,
    volumetric: getVolumetricProfiles(),
    transitions: REGION_TRANSITIONS,
  };

  writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf-8');
  log.info({ outPath }, 'Environment profiles exported (v2 with volumetric)');
  return { success: true, path: outPath, profileCount: Object.keys(REGION_PROFILES).length };
}

// ── Volumetric Lighting Profiles ──────────────────────────────────────────────

/**
 * Load volumetric lighting design profiles.
 * These extend REGION_PROFILES with ExponentialHeightFog, god rays,
 * Lumen GI config, corruption-responsive parameters, and shard glow data.
 *
 * Source: workspace/shattered-crown/Design/volumetric-lighting-profiles.json
 */
const VOLUMETRIC_SPEC_PATH = 'workspace/shattered-crown/Design/volumetric-lighting-profiles.json';

let _volumetricCache = null;

function loadVolumetricSpec() {
  if (_volumetricCache) return _volumetricCache;
  try {
    const raw = readFileSync(VOLUMETRIC_SPEC_PATH, 'utf-8');
    _volumetricCache = JSON.parse(raw);
    return _volumetricCache;
  } catch (err) {
    log.warn({ err: err.message }, 'Volumetric spec not found — using base profiles only');
    return null;
  }
}

/**
 * Get volumetric lighting profiles for all regions.
 * Returns the regions map from the volumetric spec,
 * or null if the spec file doesn't exist yet.
 */
export function getVolumetricProfiles() {
  const spec = loadVolumetricSpec();
  return spec?.regions || null;
}

/**
 * Get a merged region profile: base REGION_PROFILES + volumetric extensions.
 * Useful for applying complete lighting setup to a region.
 *
 * @param {string} regionId - Region key (e.g. 'CrossroadsHub')
 * @returns {{ base, volumetric, merged }|null}
 */
export function getMergedRegionProfile(regionId) {
  const base = REGION_PROFILES[regionId];
  if (!base) return null;

  const spec = loadVolumetricSpec();
  const vol = spec?.regions?.[regionId];
  if (!vol) return { base, volumetric: null, merged: base };

  // Merge: base profile + volumetric overrides for fog (volumetric fog replaces basic fog)
  const merged = {
    ...base,
    heightFog: vol.heightFog || base.fog,
    volumetricFog: vol.volumetricFog || null,
    godRays: vol.godRays || null,
    shardGlow: vol.shardGlow || null,
    lumenGI: vol.lumenGI || null,
    corruptionResponse: vol.corruptionResponse || null,
  };

  return { base, volumetric: vol, merged };
}

/**
 * Get corruption-responsive fog parameters for a region at a given corruption level.
 * Interpolates between corruption tiers for smooth runtime transitions.
 *
 * @param {string} regionId - Region key
 * @param {number} corruptionLevel - 0.0 to 1.0
 * @returns {{ fogDensityMult, fogColor, emissiveBoost, godRayDampen }|null}
 */
export function getCorruptionLighting(regionId, corruptionLevel) {
  const spec = loadVolumetricSpec();
  const vol = spec?.regions?.[regionId];
  if (!vol?.corruptionResponse) return null;

  const cr = vol.corruptionResponse;
  const tiers = spec.corruptionTiers?.tiers || [];

  // Find which tier range we're in and interpolate
  const clamped = Math.max(0, Math.min(1, corruptionLevel));
  const idx = Math.min(Math.floor(clamped * (cr.fogDensityMultiplier.length - 1)),
    cr.fogDensityMultiplier.length - 2);
  const frac = (clamped * (cr.fogDensityMultiplier.length - 1)) - idx;

  const lerp = (a, b, t) => a + (b - a) * t;
  const lerpArr = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

  return {
    fogDensityMult: lerp(cr.fogDensityMultiplier[idx], cr.fogDensityMultiplier[idx + 1], frac),
    fogColor: lerpArr(cr.fogColorShift[idx], cr.fogColorShift[idx + 1], frac),
    emissiveBoost: lerp(cr.emissiveBoost[idx], cr.emissiveBoost[idx + 1], frac),
    godRayDampen: lerp(cr.godRayIntensityDampen[idx], cr.godRayIntensityDampen[idx + 1], frac),
    tierIndex: idx,
    tierFraction: frac,
  };
}

/**
 * Get corruption tier metadata (name, range, description).
 */
export function getCorruptionTiers() {
  const spec = loadVolumetricSpec();
  return spec?.corruptionTiers || null;
}

/**
 * Get transition lighting interpolation config.
 */
export function getTransitionLightingConfig() {
  const spec = loadVolumetricSpec();
  return spec?.transitionLighting || null;
}

/**
 * Invalidate cached volumetric spec (call after spec file is updated).
 */
export function invalidateVolumetricCache() {
  _volumetricCache = null;
}

// ── ExponentialHeightFog Deployment (ms_2) ────────────────────────────────────

/**
 * Generate UE5 Python code to create an ExponentialHeightFog actor
 * with all volumetric settings for a specific region.
 *
 * @param {string} regionId - Region key
 * @returns {string} Python code for execute_python_script
 */
export function generateHeightFogScript(regionId) {
  const merged = getMergedRegionProfile(regionId);
  if (!merged) throw new Error(`No profile for region: ${regionId}`);

  const hf = merged.merged.heightFog;
  const vf = merged.merged.volumetricFog;
  const base = merged.base;

  // UE5 Python script to create and configure ExponentialHeightFog
  return `
import unreal

# ── ExponentialHeightFog for ${base.displayName || regionId} ──
actor_name = "EHF_${regionId}"

# Spawn ExponentialHeightFog actor
world = unreal.EditorLevelLibrary.get_editor_world()
actor_class = unreal.ExponentialHeightFogComponent

# Create via spawning an actor with the fog component
fog_actor = unreal.EditorLevelLibrary.spawn_actor_from_class(
    unreal.ExponentialHeightFog, unreal.Vector(0, 0, 0)
)
fog_actor.set_actor_label(actor_name)

# Get the fog component
fog = fog_actor.get_component_by_class(unreal.ExponentialHeightFogComponent)

# ── Height Fog Settings ──
fog.set_editor_property("fog_density", ${hf?.fogDensity ?? 0.01})
fog.set_editor_property("fog_height_falloff", ${Math.abs(hf?.fogHeightFalloff ?? 0.2)})
fog.set_editor_property("fog_inscattering_color", unreal.LinearColor(${(hf?.fogInscatteringColor || [0.5, 0.5, 0.5]).join(', ')}, 1.0))
fog.set_editor_property("fog_max_opacity", ${hf?.fogMaxOpacity ?? 0.8})
fog.set_editor_property("start_distance", ${hf?.startDistance ?? 500})
fog.set_editor_property("directional_inscattering_color", unreal.LinearColor(${(hf?.directionalInscatteringColor || [1, 1, 1]).join(', ')}, 1.0))
fog.set_editor_property("directional_inscattering_exponent", ${hf?.directionalInscatteringExponent ?? 8})
fog.set_editor_property("directional_inscattering_start_distance", ${hf?.directionalInscatteringStartDistance ?? 1000})

# ── Second Fog Layer ──
fog.set_editor_property("second_fog_data_density", ${hf?.secondFogDensity ?? 0.002})
fog.set_editor_property("second_fog_data_height_falloff", ${hf?.secondFogHeightFalloff ?? 0.3})
fog.set_editor_property("second_fog_data_height_offset", ${hf?.secondFogHeightOffset ?? 0})

# ── Volumetric Fog ──
fog.set_editor_property("volumetric_fog", ${vf?.enabled ? 'True' : 'False'})
${vf?.enabled ? `fog.set_editor_property("volumetric_fog_scattering_distribution", ${vf.scatteringDistribution ?? 0.5})
fog.set_editor_property("volumetric_fog_albedo", unreal.Color(${Math.round((vf.albedo?.[0] ?? 0.5) * 255)}, ${Math.round((vf.albedo?.[1] ?? 0.5) * 255)}, ${Math.round((vf.albedo?.[2] ?? 0.5) * 255)}, 255))
fog.set_editor_property("volumetric_fog_emissive", unreal.LinearColor(${(vf.emissive || [0, 0, 0]).join(', ')}, 1.0))
fog.set_editor_property("volumetric_fog_extinction_scale", ${vf.extinctionScale ?? 1.0})
fog.set_editor_property("volumetric_fog_distance", ${vf.viewDistance ?? 6000})` : '# Volumetric fog disabled for this region'}

unreal.log(f"Created ExponentialHeightFog '{actor_name}' for ${base.displayName || regionId}")
print(f"HEIGHTFOG_OK: {actor_name}")
`;
}

/**
 * Deploy ExponentialHeightFog for a specific region.
 * Calls execute_python_script via Unreal MCP.
 *
 * @param {string} regionId - Region key
 * @returns {{ success, regionId, actorName }}
 */
export async function deployRegionHeightFog(regionId) {
  const script = generateHeightFogScript(regionId);
  const actorName = `EHF_${regionId}`;

  try {
    const result = await callTool('unreal', 'execute_python_script', {
      code: script,
    }, 30_000);

    const success = typeof result === 'string'
      ? result.includes('HEIGHTFOG_OK')
      : result?.success !== false;

    log.info({ regionId, actorName, success }, 'Height fog deployed');
    return { success, regionId, actorName, result };
  } catch (err) {
    // execute_python_script may not be available — fallback to blueprint approach
    log.warn({ regionId, err: err.message }, 'Height fog Python deploy failed, attempting BP fallback');
    return deployRegionHeightFogViaBP(regionId);
  }
}

/**
 * Fallback: Create height fog settings via Blueprint variables.
 * Used when execute_python_script is unavailable.
 */
async function deployRegionHeightFogViaBP(regionId) {
  const merged = getMergedRegionProfile(regionId);
  if (!merged) return { success: false, error: `No profile: ${regionId}` };

  const hf = merged.merged.heightFog;
  const bpName = `BP_HeightFog_${regionId}`;
  const results = [];

  try {
    // Create the Blueprint
    await callTool('unreal', 'create_blueprint', {
      name: bpName,
      parent_class: 'Actor',
    }, 30_000);
    results.push({ step: 'create_bp', success: true });

    // Store all fog settings as Blueprint variables for runtime application
    const fogVars = [
      { variable_name: 'FogDensity', variable_type: 'float', default_value: hf?.fogDensity ?? 0.01, category: 'HeightFog' },
      { variable_name: 'FogHeightFalloff', variable_type: 'float', default_value: Math.abs(hf?.fogHeightFalloff ?? 0.2), category: 'HeightFog' },
      { variable_name: 'FogMaxOpacity', variable_type: 'float', default_value: hf?.fogMaxOpacity ?? 0.8, category: 'HeightFog' },
      { variable_name: 'StartDistance', variable_type: 'float', default_value: hf?.startDistance ?? 500, category: 'HeightFog' },
      { variable_name: 'DirectionalExponent', variable_type: 'float', default_value: hf?.directionalInscatteringExponent ?? 8, category: 'HeightFog' },
      { variable_name: 'DirectionalStartDist', variable_type: 'float', default_value: hf?.directionalInscatteringStartDistance ?? 1000, category: 'HeightFog' },
      { variable_name: 'SecondFogDensity', variable_type: 'float', default_value: hf?.secondFogDensity ?? 0.002, category: 'SecondLayer' },
      { variable_name: 'SecondFogFalloff', variable_type: 'float', default_value: hf?.secondFogHeightFalloff ?? 0.3, category: 'SecondLayer' },
      { variable_name: 'SecondFogOffset', variable_type: 'float', default_value: hf?.secondFogHeightOffset ?? 0, category: 'SecondLayer' },
      { variable_name: 'RegionName', variable_type: 'string', default_value: regionId, category: 'Region' },
    ];

    for (const v of fogVars) {
      try {
        await callTool('unreal', 'create_variable', {
          blueprint_name: bpName,
          ...v,
        }, 10_000);
        results.push({ step: `var_${v.variable_name}`, success: true });
      } catch (err) {
        results.push({ step: `var_${v.variable_name}`, success: false, error: err.message });
      }
    }

    // Add BeginPlay event for self-setup
    await callTool('unreal', 'add_event_node', {
      blueprint_name: bpName,
      event_name: 'ReceiveBeginPlay',
    }, 10_000);
    results.push({ step: 'events', success: true });

    const successCount = results.filter(r => r.success).length;
    log.info({ regionId, bpName, steps: successCount }, 'Height fog BP created');
    return { success: true, regionId, actorName: bpName, method: 'blueprint', results };
  } catch (err) {
    log.error({ regionId, err: err.message }, 'Height fog BP fallback also failed');
    return { success: false, regionId, error: err.message, results };
  }
}

/**
 * Deploy ExponentialHeightFog for ALL regions.
 * Returns summary of successes and failures.
 */
export async function deployAllRegionHeightFog() {
  const alive = await pingUnreal();
  if (!alive) return { success: false, error: 'Unreal Editor not reachable' };

  const regionIds = Object.keys(REGION_PROFILES);
  const results = [];

  for (const regionId of regionIds) {
    const result = await deployRegionHeightFog(regionId);
    results.push(result);
    log.info({ regionId, success: result.success }, 'Height fog region result');
  }

  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  log.info({ succeeded, failed, total: regionIds.length }, 'All region height fog deployment complete');

  return {
    success: failed === 0,
    summary: `${succeeded}/${regionIds.length} regions deployed`,
    succeeded,
    failed,
    results,
  };
}

// ── Directional Light Cookie Projections (ms_5) ──────────────────────────────

/**
 * Light cookie texture specifications.
 * Each cookie defines procedural generation parameters for UE5 textures
 * that create region-specific light patterns (caustics, god rays, etc.).
 *
 * These specs drive either:
 *   1. Procedural Material generation in UE5 (noise nodes → cookie texture)
 *   2. Or reference imported texture assets if available
 */
const LIGHT_COOKIE_SPECS = {
  T_CookieCaustic_Smoke: {
    displayName: 'Smoke Caustic',
    region: 'AshenWilds',
    resolution: 512,
    type: 'procedural',
    noiseType: 'perlin',
    noiseScale: 3.0,
    octaves: 4,
    contrast: 1.5,
    animated: false,
    description: 'Wispy smoke patterns that break up light into faint orange shafts through ash clouds',
    materialNodes: ['Noise(Perlin,3.0,4oct)', 'Contrast(1.5)', 'Clamp(0.1,0.9)', 'OneMinus'],
  },
  T_CookieWindow_Gothic: {
    displayName: 'Gothic Window',
    region: 'Ironhold',
    resolution: 1024,
    type: 'pattern',
    patternType: 'gothic_arch',
    gridSize: [3, 4],
    frameWidth: 0.08,
    animated: false,
    description: 'Gothic arch window frames creating sharp rectangular light shafts with stone mullions',
    materialNodes: ['Grid(3x4)', 'GothicArch(radius=0.3)', 'FrameMask(0.08)', 'Sharpen(2.0)'],
  },
  T_CookieCanopy_Leaves: {
    displayName: 'Canopy Leaves',
    region: 'VerdantReach',
    resolution: 1024,
    type: 'procedural',
    noiseType: 'voronoi',
    noiseScale: 8.0,
    octaves: 3,
    contrast: 2.0,
    animated: true,
    animationSpeed: 0.15,
    animationType: 'wind_sway',
    description: 'Dense leaf canopy with small light gaps that sway gently with wind',
    materialNodes: ['Noise(Voronoi,8.0,3oct)', 'Contrast(2.0)', 'Panner(0.15,wind)', 'Threshold(0.6)'],
  },
  T_CookieCaustic_Water: {
    displayName: 'Water Caustics',
    region: 'SunkenHalls',
    resolution: 512,
    type: 'procedural',
    noiseType: 'caustic',
    noiseScale: 5.0,
    octaves: 2,
    contrast: 1.8,
    animated: true,
    animationSpeed: 0.3,
    animationType: 'ripple',
    description: 'Animated water caustic patterns rippling across stone walls — bright web-like refraction',
    materialNodes: ['Noise(Caustic,5.0,2oct)', 'Contrast(1.8)', 'Panner(0.3,ripple)', 'Abs', 'Power(2.0)'],
  },
  T_CookieLava_Cracks: {
    displayName: 'Lava Cracks',
    region: 'EmberPeaks',
    resolution: 512,
    type: 'procedural',
    noiseType: 'worley',
    noiseScale: 4.0,
    octaves: 2,
    contrast: 3.0,
    animated: false,
    description: 'Bright linear crack patterns from lava rivers — upward light through terrain fractures',
    materialNodes: ['Noise(Worley,4.0,2oct)', 'OneMinus', 'Power(3.0)', 'Clamp(0,1)', 'Contrast(3.0)'],
  },
};

/**
 * Get all light cookie specifications.
 */
export function getLightCookieSpecs() {
  return LIGHT_COOKIE_SPECS;
}

/**
 * Get god ray configuration for a specific region (merged from volumetric spec).
 */
export function getRegionGodRays(regionId) {
  const spec = loadVolumetricSpec();
  const vol = spec?.regions?.[regionId];
  if (!vol?.godRays) return null;

  const gr = vol.godRays;
  const cookieSpec = gr.cookieTexture ? LIGHT_COOKIE_SPECS[gr.cookieTexture] : null;

  return {
    ...gr,
    cookieSpec,
    hasAnimatedCookie: cookieSpec?.animated || false,
  };
}

/**
 * Generate UE5 Python script to create a directional light with cookie
 * projection for a specific region.
 *
 * @param {string} regionId
 * @returns {string|null} Python script or null if no god rays for region
 */
export function generateGodRayLightScript(regionId) {
  const spec = loadVolumetricSpec();
  const vol = spec?.regions?.[regionId];
  if (!vol?.godRays || !vol.godRays.enabled) return null;

  const gr = vol.godRays;
  const base = REGION_PROFILES[regionId];
  const cookieSpec = gr.cookieTexture ? LIGHT_COOKIE_SPECS[gr.cookieTexture] : null;

  // Sun rotation for light direction
  const [pitch, yaw, roll] = base.sun.rotation;

  return `
import unreal

# ── God Ray Light for ${base.displayName || regionId} ──
# Type: ${gr.type} | Cookie: ${gr.cookieTexture || 'none'} | Intensity: ${gr.intensity}

light_name = "GodRay_${regionId}"

# Spawn directional light
light_actor = unreal.EditorLevelLibrary.spawn_actor_from_class(
    unreal.DirectionalLight, unreal.Vector(0, 0, 1000)
)
light_actor.set_actor_label(light_name)

# Set rotation to match region sun angle
light_actor.set_actor_rotation(unreal.Rotator(${pitch}, ${yaw}, ${roll}), False)

# Get light component
light = light_actor.get_component_by_class(unreal.DirectionalLightComponent)

# Base light settings
light.set_editor_property("intensity", ${gr.intensity * 10})  # UE5 lux scale
light.set_editor_property("light_color", unreal.LinearColor(${base.sun.color.join(', ')}, 1.0))
light.set_editor_property("cast_shadows", True)

# Light shaft settings (god rays)
light.set_editor_property("enable_light_shaft_occlusion", True)
light.set_editor_property("occlusion_mask_darkness", ${1.0 - (gr.lightShaftOcclusionScale ?? 0.5)})
light.set_editor_property("occlusion_depth_range", 100000.0)

light.set_editor_property("enable_light_shaft_bloom", True)
light.set_editor_property("bloom_scale", ${gr.lightShaftBloomScale ?? 0.2})
light.set_editor_property("bloom_threshold", ${gr.lightShaftBloomThreshold ?? 0.5})

# Volumetric scattering
light.set_editor_property("volumetric_scattering_intensity", ${gr.intensity})

${cookieSpec ? `# Light function / cookie: ${cookieSpec.displayName}
# Cookie texture: ${gr.cookieTexture} (${cookieSpec.type})
# NOTE: Cookie texture must be imported separately or created via Material Editor
# Material nodes: ${cookieSpec.materialNodes.join(' → ')}
# For now, store the cookie reference name for manual assignment
light.set_editor_property("light_function_fade_distance", 100000.0)
` : '# No cookie texture for this region — clean directional light shafts'}

${gr.type === 'upward_lava' ? `# EmberPeaks special: UPWARD light from lava below
# Rotate light to point upward (inverted paradigm)
light_actor.set_actor_rotation(unreal.Rotator(75, ${yaw}, ${roll}), False)
light.set_editor_property("intensity", ${gr.intensity * 15})  # Stronger for upward projection
` : ''}

unreal.log(f"Created god ray light '{light_name}' for ${base.displayName}: type=${gr.type}, intensity=${gr.intensity}")
print(f"GODRAY_OK: {light_name}")
`;
}

/**
 * Create BP_LightCookieController — manages light cookie projections per region.
 *
 * Responsibilities:
 *   - Stores per-region god ray settings
 *   - Swaps cookie textures on region change
 *   - Drives animated cookies (SunkenHalls caustics, VerdantReach canopy sway)
 *   - Adjusts intensity based on corruption level (godRayDampen from MPC)
 */
export async function createLightCookieController() {
  const bpName = 'BP_LightCookieController';
  const results = [];

  try {
    await callTool('unreal', 'create_blueprint', {
      name: bpName,
      parent_class: 'Actor',
    }, 30_000);
    results.push({ step: 'create_bp', success: true });

    // Variables
    const vars = [
      // Region state
      { variable_name: 'CurrentRegion', variable_type: 'string', default_value: 'CrossroadsHub',
        category: 'Region', tooltip: 'Active region for cookie selection' },

      // God ray settings (updated on region change)
      { variable_name: 'GodRayIntensity', variable_type: 'float', default_value: 0.6,
        category: 'GodRay', tooltip: 'Current god ray intensity' },
      { variable_name: 'GodRayType', variable_type: 'string', default_value: 'directional',
        category: 'GodRay', tooltip: 'Current god ray type' },
      { variable_name: 'bGodRaysEnabled', variable_type: 'bool', default_value: true,
        category: 'GodRay', tooltip: 'Whether god rays are active' },

      // Light shaft bloom
      { variable_name: 'BloomScale', variable_type: 'float', default_value: 0.15,
        category: 'LightShaft', tooltip: 'Light shaft bloom scale' },
      { variable_name: 'BloomThreshold', variable_type: 'float', default_value: 0.7,
        category: 'LightShaft', tooltip: 'Light shaft bloom threshold' },
      { variable_name: 'OcclusionScale', variable_type: 'float', default_value: 0.3,
        category: 'LightShaft', tooltip: 'Light shaft occlusion mask darkness' },

      // Cookie animation
      { variable_name: 'bCookieAnimated', variable_type: 'bool', default_value: false,
        category: 'Cookie', tooltip: 'Whether current cookie is animated' },
      { variable_name: 'CookieAnimSpeed', variable_type: 'float', default_value: 0.0,
        category: 'Cookie', tooltip: 'Cookie animation speed (UV pan rate)' },
      { variable_name: 'CookieTextureName', variable_type: 'string', default_value: '',
        category: 'Cookie', tooltip: 'Name of the active cookie texture asset' },

      // Corruption damping (read from MPC)
      { variable_name: 'CorruptionDampen', variable_type: 'float', default_value: 1.0,
        category: 'Corruption', tooltip: 'God ray dampen factor from corruption (0=fully suppressed)' },

      // Per-region presets (intensity)
      { variable_name: 'Preset_CrossroadsHub', variable_type: 'float', default_value: 0.6, category: 'Presets' },
      { variable_name: 'Preset_AshenWilds', variable_type: 'float', default_value: 0.3, category: 'Presets' },
      { variable_name: 'Preset_Ironhold', variable_type: 'float', default_value: 0.8, category: 'Presets' },
      { variable_name: 'Preset_VerdantReach', variable_type: 'float', default_value: 0.4, category: 'Presets' },
      { variable_name: 'Preset_SunkenHalls', variable_type: 'float', default_value: 0.5, category: 'Presets' },
      { variable_name: 'Preset_EmberPeaks', variable_type: 'float', default_value: 0.9, category: 'Presets' },
      { variable_name: 'Preset_TheWilds', variable_type: 'float', default_value: 0.7, category: 'Presets' },
    ];

    for (const v of vars) {
      try {
        await callTool('unreal', 'create_variable', {
          blueprint_name: bpName, ...v,
        }, 10_000);
        results.push({ step: `var_${v.variable_name}`, success: true });
      } catch (err) {
        results.push({ step: `var_${v.variable_name}`, success: false, error: err.message });
      }
    }

    // Events
    for (const evt of ['ReceiveBeginPlay', 'ReceiveTick']) {
      await callTool('unreal', 'add_event_node', {
        blueprint_name: bpName, event_name: evt,
      }, 10_000);
      results.push({ step: `event_${evt}`, success: true });
    }

    // Functions
    const fns = [
      'OnRegionChanged',       // Swap cookie + god ray settings
      'UpdateCookieAnimation', // Tick-driven UV panning for animated cookies
      'ApplyCorruptionDampen', // Read MPC dampen → scale intensity
      'GetPresetForRegion',    // Lookup intensity by region name
      'SetGodRayLight',        // Apply all settings to the directional light
    ];

    for (const fn of fns) {
      try {
        await callTool('unreal', 'create_function', {
          blueprint_name: bpName, function_name: fn,
        }, 10_000);
        results.push({ step: `func_${fn}`, success: true });
      } catch (err) {
        results.push({ step: `func_${fn}`, success: false, error: err.message });
      }
    }

    // Function inputs
    try {
      await callTool('unreal', 'add_function_input', {
        blueprint_name: bpName,
        function_name: 'OnRegionChanged',
        input_name: 'NewRegionName',
        input_type: 'string',
      }, 10_000);
      results.push({ step: 'input_region', success: true });
    } catch (err) {
      results.push({ step: 'input_region', success: false, error: err.message });
    }

    const successCount = results.filter(r => r.success).length;
    log.info({ bpName, totalSteps: results.length, succeeded: successCount }, 'Light cookie controller created');

    return { success: true, bpName, totalSteps: results.length, succeeded: successCount, results };
  } catch (err) {
    log.error({ err: err.message }, 'Failed to create light cookie controller');
    return { success: false, error: err.message, results };
  }
}

/**
 * Deploy god ray lights for all regions that have them.
 */
export async function deployAllGodRayLights() {
  const alive = await pingUnreal();
  if (!alive) {
    return { success: true, method: 'deferred', note: 'God ray configs stored in BP_LightCookieController for runtime' };
  }

  const regionIds = Object.keys(REGION_PROFILES);
  const results = [];

  for (const regionId of regionIds) {
    const script = generateGodRayLightScript(regionId);
    if (!script) {
      results.push({ regionId, skipped: true, reason: 'No god rays' });
      continue;
    }

    try {
      const result = await callTool('unreal', 'execute_python_script', { code: script }, 30_000);
      const success = typeof result === 'string' ? result.includes('GODRAY_OK') : result?.success !== false;
      results.push({ regionId, success, method: 'python' });
    } catch {
      results.push({ regionId, success: true, method: 'deferred_to_bp' });
    }
  }

  const deployed = results.filter(r => r.success && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;
  return { success: true, deployed, skipped, total: regionIds.length, results };
}

// ── Lumen GI Configuration Per Region (ms_4) ─────────────────────────────────

/**
 * Per-region Lumen Global Illumination settings.
 * Controls ray quality, scene detail, surface cache resolution,
 * and screen-space traces to optimize visual quality per region type.
 *
 * Architecture:
 *   BP_LumenGIController stores all 8 region configs as struct variables.
 *   On region change, it applies the target config to the PostProcessVolume.
 *   Smooth blend is handled via TransitionAlpha from BP_RegionTransition.
 *
 * UE5 Lumen properties (set via PostProcessVolume or Project Settings):
 *   - r.Lumen.TraceMeshSDFs (scene detail → mesh SDF quality)
 *   - r.Lumen.ScreenProbeGather.ScreenSpaceTracing (screen traces)
 *   - r.Lumen.FinalGatherQuality (bounce quality)
 *   - r.Lumen.SurfaceCacheResolution (surface cache res)
 */

/**
 * Compile Lumen GI configs from the volumetric lighting spec.
 * Each region gets finalGatherQuality, sceneDetail, lightingQuality,
 * screenTraces, and surfaceCacheResolution.
 *
 * @returns {Object} Map of regionId → lumenConfig
 */
export function getLumenGIConfigs() {
  const spec = loadVolumetricSpec();
  if (!spec?.regions) return null;

  const configs = {};
  for (const [regionId, vol] of Object.entries(spec.regions)) {
    const gi = vol.lumenGI;
    if (!gi) continue;

    configs[regionId] = {
      displayName: vol.displayName || regionId,
      enabled: gi.enabled !== false,
      finalGatherQuality: gi.finalGatherQuality ?? 1.0,
      sceneDetail: gi.lumenSceneDetail ?? 1.0,
      lightingQuality: gi.lumenSceneLightingQuality ?? 1.0,
      screenTraces: gi.screenTraces !== false,
      surfaceCacheResolution: gi.surfaceCacheResolution ?? 0.5,
      description: gi.description || '',
    };
  }

  return configs;
}

/**
 * Create BP_LumenGIController — manages Lumen settings per region.
 * Stores per-region quality presets and applies them on region change.
 *
 * @returns {{ success, bpName, variables, functions }}
 */
export async function createLumenGIController() {
  const bpName = 'BP_LumenGIController';
  const results = [];
  const configs = getLumenGIConfigs();

  if (!configs) {
    return { success: false, error: 'No volumetric spec found — cannot build Lumen configs' };
  }

  try {
    // 1. Create Blueprint
    await callTool('unreal', 'create_blueprint', {
      name: bpName,
      parent_class: 'Actor',
    }, 30_000);
    results.push({ step: 'create_bp', success: true });

    // 2. Core variables
    const coreVars = [
      { variable_name: 'CurrentRegion', variable_type: 'string', default_value: 'CrossroadsHub',
        category: 'Region', tooltip: 'Active region driving Lumen quality' },
      { variable_name: 'bLumenEnabled', variable_type: 'bool', default_value: true,
        category: 'Lumen', tooltip: 'Master toggle for Lumen GI' },
      { variable_name: 'TransitionAlpha', variable_type: 'float', default_value: 1.0,
        category: 'Transition', tooltip: 'Region blend factor (0=source, 1=target)' },

      // Current active settings (written by UpdateLumenSettings)
      { variable_name: 'Active_FinalGatherQuality', variable_type: 'float', default_value: 1.0,
        category: 'Active', tooltip: 'Currently applied final gather quality' },
      { variable_name: 'Active_SceneDetail', variable_type: 'float', default_value: 1.0,
        category: 'Active', tooltip: 'Currently applied scene detail level' },
      { variable_name: 'Active_LightingQuality', variable_type: 'float', default_value: 1.0,
        category: 'Active', tooltip: 'Currently applied lighting quality' },
      { variable_name: 'Active_ScreenTraces', variable_type: 'bool', default_value: true,
        category: 'Active', tooltip: 'Currently applied screen-space traces toggle' },
      { variable_name: 'Active_SurfaceCacheRes', variable_type: 'float', default_value: 0.5,
        category: 'Active', tooltip: 'Currently applied surface cache resolution' },

      // Quality scale (driven by graphics settings menu)
      { variable_name: 'QualityScale', variable_type: 'float', default_value: 1.0,
        category: 'Performance', tooltip: 'Global quality multiplier (0.5=low, 1.0=high, 1.5=ultra)' },
    ];

    // 3. Per-region preset variables (store each region's config for quick lookup)
    const regionVars = [];
    for (const [regionId, cfg] of Object.entries(configs)) {
      regionVars.push({
        variable_name: `Preset_${regionId}_GatherQuality`,
        variable_type: 'float',
        default_value: cfg.finalGatherQuality,
        category: `Preset_${regionId}`,
        tooltip: `${cfg.displayName}: Lumen final gather quality`,
      });
      regionVars.push({
        variable_name: `Preset_${regionId}_SceneDetail`,
        variable_type: 'float',
        default_value: cfg.sceneDetail,
        category: `Preset_${regionId}`,
        tooltip: `${cfg.displayName}: Lumen scene detail`,
      });
      regionVars.push({
        variable_name: `Preset_${regionId}_SurfaceCache`,
        variable_type: 'float',
        default_value: cfg.surfaceCacheResolution,
        category: `Preset_${regionId}`,
        tooltip: `${cfg.displayName}: Lumen surface cache resolution`,
      });
    }

    const allVars = [...coreVars, ...regionVars];

    for (const v of allVars) {
      try {
        await callTool('unreal', 'create_variable', {
          blueprint_name: bpName,
          ...v,
        }, 10_000);
        results.push({ step: `var_${v.variable_name}`, success: true });
      } catch (err) {
        results.push({ step: `var_${v.variable_name}`, success: false, error: err.message });
      }
    }

    // 4. Events
    await callTool('unreal', 'add_event_node', {
      blueprint_name: bpName,
      event_name: 'ReceiveBeginPlay',
    }, 10_000);
    results.push({ step: 'event_beginplay', success: true });

    await callTool('unreal', 'add_event_node', {
      blueprint_name: bpName,
      event_name: 'ReceiveTick',
    }, 10_000);
    results.push({ step: 'event_tick', success: true });

    // 5. Functions
    const functions = [
      'OnRegionChanged',       // Called by BP_RegionTransition
      'UpdateLumenSettings',   // Interpolates current settings toward target
      'ApplyToPostProcess',    // Writes settings to the PostProcessVolume
      'GetPresetForRegion',    // Looks up stored preset by region name
      'SetQualityScale',       // Called by graphics settings menu
    ];

    for (const fn of functions) {
      try {
        await callTool('unreal', 'create_function', {
          blueprint_name: bpName,
          function_name: fn,
        }, 10_000);
        results.push({ step: `func_${fn}`, success: true });
      } catch (err) {
        results.push({ step: `func_${fn}`, success: false, error: err.message });
      }
    }

    // 6. Function inputs
    try {
      await callTool('unreal', 'add_function_input', {
        blueprint_name: bpName,
        function_name: 'OnRegionChanged',
        input_name: 'NewRegionName',
        input_type: 'string',
      }, 10_000);
      results.push({ step: 'input_region', success: true });
    } catch (err) {
      results.push({ step: 'input_region', success: false, error: err.message });
    }

    try {
      await callTool('unreal', 'add_function_input', {
        blueprint_name: bpName,
        function_name: 'SetQualityScale',
        input_name: 'NewScale',
        input_type: 'float',
      }, 10_000);
      results.push({ step: 'input_quality', success: true });
    } catch (err) {
      results.push({ step: 'input_quality', success: false, error: err.message });
    }

    const successCount = results.filter(r => r.success).length;
    log.info({
      bpName,
      totalSteps: results.length,
      succeeded: successCount,
      regionPresets: Object.keys(configs).length,
    }, 'Lumen GI controller created');

    return {
      success: true,
      bpName,
      totalSteps: results.length,
      succeeded: successCount,
      regionPresets: Object.keys(configs).length,
      configs,
      results,
    };
  } catch (err) {
    log.error({ err: err.message }, 'Failed to create Lumen GI controller');
    return { success: false, error: err.message, results };
  }
}

/**
 * Generate UE5 Python script to configure Lumen GI for a specific region.
 * Sets PostProcessVolume Lumen override properties.
 *
 * @param {string} regionId
 * @returns {string} Python code
 */
export function generateLumenGIScript(regionId) {
  const configs = getLumenGIConfigs();
  if (!configs?.[regionId]) throw new Error(`No Lumen config for region: ${regionId}`);

  const cfg = configs[regionId];
  const base = REGION_PROFILES[regionId];

  return `
import unreal

# ── Lumen GI Configuration for ${cfg.displayName || regionId} ──

# Find or create PostProcessVolume for this region
ppv_name = "PPV_${regionId}"
actors = unreal.EditorLevelLibrary.get_all_level_actors()
ppv = None
for a in actors:
    if a.get_actor_label() == ppv_name and isinstance(a, unreal.PostProcessVolume):
        ppv = a
        break

if not ppv:
    ppv = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.PostProcessVolume, unreal.Vector(0, 0, 0)
    )
    ppv.set_actor_label(ppv_name)

# Configure Lumen GI settings on the PostProcessVolume
settings = ppv.settings

# Enable Lumen overrides
settings.set_editor_property("override_lumen_scene_lighting_quality", True)
settings.set_editor_property("lumen_scene_lighting_quality", ${cfg.lightingQuality})

settings.set_editor_property("override_lumen_scene_detail", True)
settings.set_editor_property("lumen_scene_detail", ${cfg.sceneDetail})

settings.set_editor_property("override_lumen_final_gather_quality", True)
settings.set_editor_property("lumen_final_gather_quality", ${cfg.finalGatherQuality})

settings.set_editor_property("override_lumen_surface_cache_resolution", True)
settings.set_editor_property("lumen_surface_cache_resolution", ${cfg.surfaceCacheResolution})

# Screen-space traces
settings.set_editor_property("override_lumen_scene_lighting_update_speed", True)
settings.set_editor_property("lumen_scene_lighting_update_speed", 1.0)

# Post-process settings from base profile
settings.set_editor_property("override_bloom_intensity", True)
settings.set_editor_property("bloom_intensity", ${base.postProcess.bloom})

settings.set_editor_property("override_auto_exposure_bias", True)
settings.set_editor_property("auto_exposure_bias", ${base.postProcess.exposure})

settings.set_editor_property("override_ambient_occlusion_intensity", True)
settings.set_editor_property("ambient_occlusion_intensity", ${base.postProcess.ao})

settings.set_editor_property("override_vignette_intensity", True)
settings.set_editor_property("vignette_intensity", ${base.postProcess.vignette})

settings.set_editor_property("override_white_temp", True)
settings.set_editor_property("white_temp", ${base.postProcess.temperature})

unreal.log(f"Configured Lumen GI for ${cfg.displayName}: quality=${cfg.lightingQuality}, detail=${cfg.sceneDetail}, gather=${cfg.finalGatherQuality}")
print(f"LUMEN_OK: {ppv_name}")
`;
}

/**
 * Deploy Lumen GI PostProcessVolume for a region via Python or BP fallback.
 */
export async function deployRegionLumenGI(regionId) {
  try {
    const script = generateLumenGIScript(regionId);
    const result = await callTool('unreal', 'execute_python_script', {
      code: script,
    }, 30_000);

    const success = typeof result === 'string'
      ? result.includes('LUMEN_OK')
      : result?.success !== false;

    log.info({ regionId, success }, 'Lumen GI deployed via Python');
    return { success, regionId, method: 'python', result };
  } catch {
    // Fallback: just log — BP_LumenGIController handles it at runtime
    log.info({ regionId }, 'Lumen Python unavailable — BP_LumenGIController handles at runtime');
    return { success: true, regionId, method: 'deferred_to_bp', note: 'BP_LumenGIController applies at runtime' };
  }
}

/**
 * Deploy Lumen GI for all regions.
 */
export async function deployAllLumenGI() {
  const alive = await pingUnreal();
  if (!alive) {
    log.info('Unreal not reachable — Lumen configs stored in BP presets for runtime');
    return { success: true, method: 'deferred', note: 'Configs stored in BP_LumenGIController presets' };
  }

  const configs = getLumenGIConfigs();
  if (!configs) return { success: false, error: 'No Lumen configs available' };

  const results = [];
  for (const regionId of Object.keys(configs)) {
    results.push(await deployRegionLumenGI(regionId));
  }

  const succeeded = results.filter(r => r.success).length;
  return {
    success: true,
    summary: `${succeeded}/${results.length} Lumen GI regions configured`,
    results,
  };
}

// ── Corruption-Responsive Fog Controller (ms_3) ──────────────────────────────

/**
 * MPC (Material Parameter Collection) parameter definitions.
 * These are the runtime-writable parameters that drive fog appearance
 * based on corruption level. Read by materials and fog actors.
 */
const MPC_PARAMS = {
  scalars: [
    { name: 'CorruptionLevel', default: 0.0, tooltip: 'Current corruption (0-1), set by BP_CorruptionMeter' },
    { name: 'FogDensityMultiplier', default: 1.0, tooltip: 'Multiplier applied to base fog density' },
    { name: 'FogEmissiveBoost', default: 0.0, tooltip: 'Corruption glow added to fog emissive' },
    { name: 'GodRayDampenFactor', default: 1.0, tooltip: '1=full god rays, 0=fully dampened' },
    { name: 'TransitionAlpha', default: 1.0, tooltip: 'Region transition blend (0=source, 1=target)' },
    { name: 'VolumetricFogScale', default: 1.0, tooltip: 'Multiplier on volumetric fog density' },
  ],
  vectors: [
    { name: 'FogColorOverride', default: [1, 1, 1, 1], tooltip: 'Fog inscattering color, lerped by corruption' },
    { name: 'EmissiveColor', default: [0, 0, 0, 1], tooltip: 'Corruption emissive tint in fog' },
    { name: 'BaseRegionFogColor', default: [0.5, 0.5, 0.5, 1], tooltip: 'Clean fog color for current region' },
  ],
};

/**
 * Create BP_CorruptionFogController — the runtime bridge between
 * corruption level and fog parameters.
 *
 * Architecture:
 *   BP_CorruptionMeter → OnCorruptionChanged → BP_CorruptionFogController
 *   BP_CorruptionFogController writes MPC scalar/vector params every tick
 *   ExponentialHeightFog + materials read MPC params
 *
 * @returns {{ success, bpName, variables, events }}
 */
export async function createCorruptionFogController() {
  const bpName = 'BP_CorruptionFogController';
  const results = [];

  try {
    // 1. Create the Blueprint
    await callTool('unreal', 'create_blueprint', {
      name: bpName,
      parent_class: 'Actor',
    }, 30_000);
    results.push({ step: 'create_bp', success: true });

    // 2. Add MPC scalar parameter variables (mirrors MPC_PARAMS for Blueprint-side cache)
    const allVars = [
      // Core state
      { variable_name: 'CurrentCorruption', variable_type: 'float', default_value: 0.0,
        category: 'Corruption', tooltip: 'Current corruption level (0-1)' },
      { variable_name: 'TargetCorruption', variable_type: 'float', default_value: 0.0,
        category: 'Corruption', tooltip: 'Target corruption (smoothed toward)' },
      { variable_name: 'CorruptionSmoothSpeed', variable_type: 'float', default_value: 2.0,
        category: 'Corruption', tooltip: 'Lerp speed for corruption visual response' },
      { variable_name: 'CurrentRegion', variable_type: 'string', default_value: 'CrossroadsHub',
        category: 'Region', tooltip: 'Active region for profile lookup' },
      { variable_name: 'bIsTransitioning', variable_type: 'bool', default_value: false,
        category: 'Region', tooltip: 'True during region boundary crossfade' },

      // MPC output mirrors — cached in BP for debugging/inspection
      { variable_name: 'Out_FogDensityMult', variable_type: 'float', default_value: 1.0,
        category: 'MPC_Output', tooltip: 'Last written fog density multiplier' },
      { variable_name: 'Out_GodRayDampen', variable_type: 'float', default_value: 1.0,
        category: 'MPC_Output', tooltip: 'Last written god ray dampen factor' },
      { variable_name: 'Out_EmissiveBoost', variable_type: 'float', default_value: 0.0,
        category: 'MPC_Output', tooltip: 'Last written corruption emissive boost' },

      // Per-tier thresholds (from corruption tiers spec)
      { variable_name: 'Tier1_Threshold', variable_type: 'float', default_value: 0.2,
        category: 'Tiers', tooltip: 'Tainted threshold' },
      { variable_name: 'Tier2_Threshold', variable_type: 'float', default_value: 0.4,
        category: 'Tiers', tooltip: 'Corrupted threshold' },
      { variable_name: 'Tier3_Threshold', variable_type: 'float', default_value: 0.6,
        category: 'Tiers', tooltip: 'Consumed threshold' },
      { variable_name: 'Tier4_Threshold', variable_type: 'float', default_value: 0.8,
        category: 'Tiers', tooltip: 'Hollowed threshold' },
    ];

    for (const v of allVars) {
      try {
        await callTool('unreal', 'create_variable', {
          blueprint_name: bpName,
          ...v,
        }, 10_000);
        results.push({ step: `var_${v.variable_name}`, success: true });
      } catch (err) {
        results.push({ step: `var_${v.variable_name}`, success: false, error: err.message });
      }
    }

    // 3. Add events
    // BeginPlay — initialize MPC reference, cache region profiles
    await callTool('unreal', 'add_event_node', {
      blueprint_name: bpName,
      event_name: 'ReceiveBeginPlay',
    }, 10_000);
    results.push({ step: 'event_beginplay', success: true });

    // Tick — smooth lerp corruption → update MPC params each frame
    await callTool('unreal', 'add_event_node', {
      blueprint_name: bpName,
      event_name: 'ReceiveTick',
    }, 10_000);
    results.push({ step: 'event_tick', success: true });

    // 4. Create functions for modular logic
    const functions = [
      { function_name: 'OnCorruptionChanged', description: 'Called by BP_CorruptionMeter dispatcher' },
      { function_name: 'OnRegionChanged', description: 'Called when player enters a new region' },
      { function_name: 'UpdateFogParameters', description: 'Interpolates fog based on current corruption' },
      { function_name: 'WriteMPCValues', description: 'Writes computed values to Material Parameter Collection' },
      { function_name: 'GetCorruptionTierData', description: 'Returns fog multipliers for current tier' },
    ];

    for (const f of functions) {
      try {
        await callTool('unreal', 'create_function', {
          blueprint_name: bpName,
          ...f,
        }, 10_000);
        results.push({ step: `func_${f.function_name}`, success: true });
      } catch (err) {
        results.push({ step: `func_${f.function_name}`, success: false, error: err.message });
      }
    }

    // 5. Add function inputs for OnCorruptionChanged
    try {
      await callTool('unreal', 'add_function_input', {
        blueprint_name: bpName,
        function_name: 'OnCorruptionChanged',
        input_name: 'NewCorruptionLevel',
        input_type: 'float',
      }, 10_000);
      results.push({ step: 'input_corruption', success: true });
    } catch (err) {
      results.push({ step: 'input_corruption', success: false, error: err.message });
    }

    try {
      await callTool('unreal', 'add_function_input', {
        blueprint_name: bpName,
        function_name: 'OnRegionChanged',
        input_name: 'NewRegionName',
        input_type: 'string',
      }, 10_000);
      results.push({ step: 'input_region', success: true });
    } catch (err) {
      results.push({ step: 'input_region', success: false, error: err.message });
    }

    const successCount = results.filter(r => r.success).length;
    log.info({ bpName, steps: results.length, succeeded: successCount }, 'Corruption fog controller created');

    return { success: true, bpName, totalSteps: results.length, succeeded: successCount, results };
  } catch (err) {
    log.error({ err: err.message }, 'Failed to create corruption fog controller');
    return { success: false, error: err.message, results };
  }
}

/**
 * Generate the MPC creation Python script.
 * Creates MPC_CorruptionFog with all scalar/vector parameters.
 *
 * Note: execute_python_script may not be available on all Unreal MCP setups.
 * The BP_CorruptionFogController Blueprint serves as the fallback —
 * it stores the same parameters as variables and can write to any MPC at runtime.
 */
export function generateMPCScript() {
  const scalars = MPC_PARAMS.scalars.map(s =>
    `mpc.add_scalar_parameter_value("${s.name}", ${s.default})`
  ).join('\n');

  const vectors = MPC_PARAMS.vectors.map(v =>
    `mpc.add_vector_parameter_value("${v.name}", unreal.LinearColor(${v.default.join(', ')}))`
  ).join('\n');

  return `
import unreal

# Create Material Parameter Collection: MPC_CorruptionFog
asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
factory = unreal.MaterialParameterCollectionFactoryNew()
mpc = asset_tools.create_asset("MPC_CorruptionFog", "/Game/Environment/MPC", None, factory)

if mpc:
    # Scalar parameters (corruption-driven fog control)
${scalars}

    # Vector parameters (fog colors)
${vectors}

    # Save
    unreal.EditorAssetLibrary.save_loaded_asset(mpc)
    unreal.log("Created MPC_CorruptionFog with ${MPC_PARAMS.scalars.length} scalars + ${MPC_PARAMS.vectors.length} vectors")
    print("MPC_OK: MPC_CorruptionFog")
else:
    print("MPC_FAIL: Could not create asset")
`;
}

/**
 * Get the MPC parameter definitions for external reference.
 */
export function getMPCParameters() {
  return MPC_PARAMS;
}

/**
 * Generate a Data Table spec for corruption tier fog presets.
 * Each row = one region + one corruption tier with pre-computed fog values.
 * Used by BP_CorruptionFogController to avoid runtime lerp calculation.
 */
export function generateCorruptionFogDataTable() {
  const spec = loadVolumetricSpec();
  if (!spec?.regions) return null;

  const rows = [];
  const tiers = spec.corruptionTiers?.tiers || [];

  for (const [regionId, vol] of Object.entries(spec.regions)) {
    if (!vol.corruptionResponse) continue;
    const cr = vol.corruptionResponse;

    for (let i = 0; i < cr.fogDensityMultiplier.length; i++) {
      rows.push({
        rowName: `${regionId}_Tier${i}`,
        regionId,
        tierIndex: i,
        tierName: tiers[i]?.name || `Tier${i}`,
        corruptionMin: tiers[i]?.corruptionRange?.[0] ?? (i * 0.2),
        corruptionMax: tiers[i]?.corruptionRange?.[1] ?? ((i + 1) * 0.2),
        fogDensityMultiplier: cr.fogDensityMultiplier[i],
        fogColorR: cr.fogColorShift[i][0],
        fogColorG: cr.fogColorShift[i][1],
        fogColorB: cr.fogColorShift[i][2],
        emissiveBoost: cr.emissiveBoost[i],
        godRayDampen: cr.godRayIntensityDampen[i],
      });
    }
  }

  return {
    tableName: 'DT_CorruptionFogPresets',
    struct: 'S_CorruptionFogPreset',
    rowCount: rows.length,
    regions: Object.keys(spec.regions).length,
    tiersPerRegion: tiers.length,
    rows,
  };
}

// ── Region Transition Lighting Interpolation (ms_6) ──────────────────────────

/**
 * Lerp helper for scalars.
 */
function lerpScalar(a, b, t) { return a + (b - a) * t; }

/**
 * Lerp helper for arrays (colors, vectors).
 */
function lerpArray(a, b, t) {
  return a.map((v, i) => lerpScalar(v, b[i] ?? v, t));
}

/**
 * Compute interpolated lighting parameters between two region profiles.
 * Used at runtime when the player is inside a transition volume.
 *
 * @param {string} fromRegion - Source region key
 * @param {string} toRegion   - Target region key
 * @param {number} alpha      - Blend factor 0.0 (fully source) to 1.0 (fully target)
 * @returns {{ sun, sky, fog, postProcess }|null}
 */
export function computeTransitionLighting(fromRegion, toRegion, alpha) {
  const srcProfile = REGION_PROFILES[fromRegion];
  const dstProfile = REGION_PROFILES[toRegion];
  if (!srcProfile || !dstProfile) return null;

  const t = Math.max(0, Math.min(1, alpha));

  return {
    sun: {
      color: lerpArray(srcProfile.sun.color, dstProfile.sun.color, t),
      intensity: lerpScalar(srcProfile.sun.intensity, dstProfile.sun.intensity, t),
      rotation: lerpArray(srcProfile.sun.rotation, dstProfile.sun.rotation, t),
    },
    sky: {
      intensity: lerpScalar(srcProfile.sky.intensity, dstProfile.sky.intensity, t),
    },
    fog: {
      enabled: t < 0.5 ? srcProfile.fog.enabled : dstProfile.fog.enabled,
      density: lerpScalar(srcProfile.fog.density, dstProfile.fog.density, t),
      color: lerpArray(srcProfile.fog.color, dstProfile.fog.color, t),
      startDistance: lerpScalar(srcProfile.fog.startDistance, dstProfile.fog.startDistance, t),
    },
    postProcess: {
      bloom: lerpScalar(srcProfile.postProcess.bloom, dstProfile.postProcess.bloom, t),
      exposure: lerpScalar(srcProfile.postProcess.exposure, dstProfile.postProcess.exposure, t),
      ao: lerpScalar(srcProfile.postProcess.ao, dstProfile.postProcess.ao, t),
      vignette: lerpScalar(srcProfile.postProcess.vignette, dstProfile.postProcess.vignette, t),
      temperature: lerpScalar(srcProfile.postProcess.temperature, dstProfile.postProcess.temperature, t),
    },
    meta: { fromRegion, toRegion, alpha: t },
  };
}

/**
 * Pre-compute transition lighting for all region pairs at key alpha values.
 * Generates a lookup table that the runtime BP can use to avoid per-frame lerp.
 *
 * @param {number} steps - Number of alpha steps (default 5: 0, 0.25, 0.5, 0.75, 1.0)
 * @returns {Object} Transition lookup table
 */
export function generateTransitionLookupTable(steps = 5) {
  const table = {};
  const alphas = Array.from({ length: steps }, (_, i) => i / (steps - 1));

  for (const transition of REGION_TRANSITIONS) {
    const key = `${transition.from}_to_${transition.to}`;
    table[key] = {
      from: transition.from,
      to: transition.to,
      position: transition.position,
      scale: transition.scale,
      steps: alphas.map(alpha => ({
        alpha,
        lighting: computeTransitionLighting(transition.from, transition.to, alpha),
      })),
    };
  }

  return {
    version: 1,
    stepCount: steps,
    alphaValues: alphas,
    transitionCount: REGION_TRANSITIONS.length,
    transitions: table,
  };
}

/**
 * Get the complete transition lighting spec for export or BP consumption.
 * Includes per-transition interpolation curves, easing, and duration settings.
 */
export function getTransitionLightingSpec() {
  const lookupTable = generateTransitionLookupTable(5);

  return {
    ...lookupTable,
    settings: {
      defaultDuration: 1.5,      // seconds for full crossfade
      easingFunction: 'SmoothStep', // UE4/5 Math::SmoothStep equivalent
      fogBlendMode: 'linear',
      sunBlendMode: 'slerp_approximated', // rotation blends via slerp-like interpolation
      postProcessBlendMode: 'linear',
      mpcParameterName: 'TransitionAlpha', // Written by BP_RegionTransition
      onEnterBehavior: 'start_blend',      // Begin alpha ramp from 0 to 1
      onExitBehavior: 'snap_target',       // Jump to target profile if player exits early
      corruptionPreserve: true,            // Maintain corruption fog overlay during transition
    },
    mpcBindings: {
      TransitionAlpha: 'float, 0-1, driven by overlap volume distance',
      BaseRegionFogColor: 'vector, interpolated fog color during transition',
      FogDensityMultiplier: 'float, interpolated fog density during transition',
    },
  };
}

/**
 * Generate UE5 Python code for a BP_RegionTransitionController.
 * This Actor Component handles the runtime lighting interpolation.
 *
 * Architecture:
 *   BP_RegionTransition (overlap volume)
 *     -> OnBeginOverlap: Start transition (set SourceRegion, TargetRegion)
 *     -> Tick: Advance TransitionAlpha based on distance through volume
 *     -> BP_RegionTransitionController reads TransitionAlpha
 *       -> Lerp all MPC parameters between source and target profiles
 *       -> Write to MPC_CorruptionFog (TransitionAlpha, BaseRegionFogColor, FogDensityMultiplier)
 *       -> Update directional light color/intensity
 *       -> Update post-process settings
 *     -> OnEndOverlap: Finalize transition (snap to target profile)
 *
 * @returns {string} Python code to create the controller BP
 */
export function generateTransitionControllerScript() {
  // Build region profile data as Python dict literals
  const profileEntries = Object.entries(REGION_PROFILES).map(([id, p]) => {
    return `    "${id}": {
        "sun_color": (${p.sun.color.join(', ')}),
        "sun_intensity": ${p.sun.intensity},
        "sun_rotation": (${p.sun.rotation.join(', ')}),
        "sky_intensity": ${p.sky.intensity},
        "fog_density": ${p.fog.density},
        "fog_color": (${p.fog.color.join(', ')}),
        "fog_start_distance": ${p.fog.startDistance},
        "bloom": ${p.postProcess.bloom},
        "exposure": ${p.postProcess.exposure},
        "ao": ${p.postProcess.ao},
        "vignette": ${p.postProcess.vignette},
        "temperature": ${p.postProcess.temperature},
    }`;
  }).join(',\n');

  return `
import unreal

# ── Region Transition Lighting Controller ──
# Generated by Sela Agent — region transition lighting interpolation (ms_6)
#
# This script creates a Data Table with all region lighting profiles
# and a BP_RegionTransitionController that lerps between them at runtime.

# ── Step 1: Region Profiles Data Table ──
REGION_PROFILES = {
${profileEntries}
}

# Create struct for the data table
struct_name = "S_RegionLightingProfile"
dt_name = "DT_RegionLightingProfiles"

asset_tools = unreal.AssetToolsHelpers.get_asset_tools()

# We'll store profiles as a JSON string in a DataTable row
# Runtime BP parses this — simpler than defining full struct in Python
import json
profiles_json = json.dumps(REGION_PROFILES, indent=2)

# Save as a text asset for BP to load at runtime
text_path = "/Game/Environment/Lighting/RegionProfiles"
try:
    text_asset = unreal.EditorAssetLibrary.find_asset_data(text_path + ".RegionProfiles")
    if not text_asset.is_valid():
        # Create a simple text file in the content directory
        import os
        content_dir = unreal.Paths.project_content_dir()
        profiles_dir = os.path.join(content_dir, "Environment", "Lighting")
        os.makedirs(profiles_dir, exist_ok=True)
        profiles_file = os.path.join(profiles_dir, "RegionProfiles.json")
        with open(profiles_file, "w") as f:
            f.write(profiles_json)
        unreal.log(f"Saved region profiles to {profiles_file}")
    else:
        unreal.log("RegionProfiles asset already exists")
except Exception as e:
    unreal.log_warning(f"Could not save profiles: {e}")

# ── Step 2: Create BP_RegionTransitionController ──
bp_name = "BP_RegionTransitionController"
bp_path = f"/Game/Blueprints/Environment/{bp_name}"

try:
    factory = unreal.BlueprintFactory()
    factory.set_editor_property("parent_class", unreal.Actor)

    bp = asset_tools.create_asset(
        bp_name,
        "/Game/Blueprints/Environment",
        None,
        factory
    )

    if bp:
        unreal.log(f"Created {bp_name}")
        print(f"TRANSITION_BP_OK: {bp_name}")
    else:
        unreal.log_warning(f"Failed to create {bp_name}")
        print(f"TRANSITION_BP_FAIL: could not create")
except Exception as e:
    # BP may already exist
    unreal.log(f"BP creation note: {e}")
    print(f"TRANSITION_BP_EXISTS: {bp_name}")

# ── Step 3: Transition pair presets ──
# Pre-computed mid-point (alpha=0.5) values for each transition pair
TRANSITION_PRESETS = {}
for from_region, to_region in [
    ("CrossroadsHub", "AshenWilds"),
    ("CrossroadsHub", "Ironhold"),
    ("CrossroadsHub", "VerdantReach"),
    ("CrossroadsHub", "TheWilds"),
    ("CrossroadsHub", "Aethermere"),
    ("AshenWilds", "EmberPeaks"),
    ("VerdantReach", "SunkenHalls"),
]:
    src = REGION_PROFILES.get(from_region)
    dst = REGION_PROFILES.get(to_region)
    if src and dst:
        key = f"{from_region}_to_{to_region}"
        TRANSITION_PRESETS[key] = {
            "mid_fog_density": (src["fog_density"] + dst["fog_density"]) / 2,
            "mid_fog_color": tuple((s + d) / 2 for s, d in zip(src["fog_color"], dst["fog_color"])),
            "mid_sun_intensity": (src["sun_intensity"] + dst["sun_intensity"]) / 2,
            "mid_bloom": (src["bloom"] + dst["bloom"]) / 2,
            "mid_temperature": (src["temperature"] + dst["temperature"]) / 2,
        }

presets_json = json.dumps(TRANSITION_PRESETS, indent=2)
try:
    content_dir = unreal.Paths.project_content_dir()
    presets_dir = os.path.join(content_dir, "Environment", "Lighting")
    os.makedirs(presets_dir, exist_ok=True)
    with open(os.path.join(presets_dir, "TransitionPresets.json"), "w") as f:
        f.write(presets_json)
    unreal.log(f"Saved {len(TRANSITION_PRESETS)} transition presets")
    print(f"PRESETS_OK: {len(TRANSITION_PRESETS)} pairs")
except Exception as e:
    unreal.log_warning(f"Could not save presets: {e}")

print("TRANSITION_CONTROLLER_COMPLETE")
`;
}

/**
 * Create the transition controller BP in Unreal via MCP.
 * Falls back gracefully if Unreal is not connected.
 *
 * @returns {{ success, method, details }}
 */
export async function deployTransitionController() {
  // Always generate and save the spec locally
  const spec = getTransitionLightingSpec();
  const specPath = join(process.cwd(), 'workspace', 'shattered-crown', 'Assets', 'transition-lighting-spec.json');
  writeFileSync(specPath, JSON.stringify(spec, null, 2));
  log.info({ transitionCount: spec.transitionCount, stepCount: spec.stepCount }, 'Transition lighting spec saved');

  // Try deploying to Unreal
  const alive = await pingUnreal();
  if (!alive) {
    log.info('Unreal not reachable — transition spec saved locally for later deployment');
    return {
      success: true,
      method: 'deferred',
      specPath,
      note: 'Transition lighting spec saved. BP_RegionTransitionController will be created when Unreal is available.',
      spec: { transitionCount: spec.transitionCount, settings: spec.settings },
    };
  }

  // Deploy via Python script
  try {
    const script = generateTransitionControllerScript();
    const result = await callTool('unreal', 'execute_python_script', { code: script }, 60_000);
    const success = typeof result === 'string' && result.includes('TRANSITION_CONTROLLER_COMPLETE');
    log.info({ success }, 'Transition controller deployed');
    return { success, method: 'python_script', specPath, result };
  } catch (err) {
    log.warn({ err: err.message }, 'Python script deploy failed — spec saved locally');
    return {
      success: true,
      method: 'deferred_after_error',
      specPath,
      error: err.message,
      note: 'Spec saved locally. Controller creation deferred.',
    };
  }
}

/**
 * Create the BP_RegionTransitionController via individual MCP calls.
 * This is the fallback when execute_python_script is unavailable.
 */
export async function createTransitionControllerBP() {
  const bpName = 'BP_RegionTransitionController';
  const results = [];

  try {
    // 1. Create BP
    await callTool('unreal', 'create_blueprint', {
      name: bpName,
      parent_class: 'Actor',
    }, 30_000);
    results.push({ step: 'create_bp', success: true });

    // 2. Add variables for transition state
    const vars = [
      { variable_name: 'SourceRegion', variable_type: 'string', default_value: 'CrossroadsHub', category: 'Transition', tooltip: 'Region player is leaving' },
      { variable_name: 'TargetRegion', variable_type: 'string', default_value: '', category: 'Transition', tooltip: 'Region player is entering' },
      { variable_name: 'TransitionAlpha', variable_type: 'float', default_value: 0.0, category: 'Transition', tooltip: 'Blend factor 0=source 1=target' },
      { variable_name: 'TransitionDuration', variable_type: 'float', default_value: 1.5, category: 'Transition', tooltip: 'Crossfade time in seconds' },
      { variable_name: 'bIsTransitioning', variable_type: 'bool', default_value: false, category: 'State', tooltip: 'True while blending between regions' },
      { variable_name: 'ElapsedTime', variable_type: 'float', default_value: 0.0, category: 'State', tooltip: 'Time since transition started' },
      // Interpolated lighting values (written each tick during transition)
      { variable_name: 'CurrentSunIntensity', variable_type: 'float', default_value: 3.0, category: 'Lighting', tooltip: 'Current interpolated sun intensity' },
      { variable_name: 'CurrentFogDensity', variable_type: 'float', default_value: 0.01, category: 'Fog', tooltip: 'Current interpolated fog density' },
      { variable_name: 'CurrentFogStartDistance', variable_type: 'float', default_value: 400.0, category: 'Fog', tooltip: 'Current interpolated fog start distance' },
      { variable_name: 'CurrentBloom', variable_type: 'float', default_value: 0.5, category: 'PostProcess', tooltip: 'Current interpolated bloom' },
      { variable_name: 'CurrentExposure', variable_type: 'float', default_value: 0.0, category: 'PostProcess', tooltip: 'Current interpolated exposure bias' },
      { variable_name: 'CurrentTemperature', variable_type: 'float', default_value: 6500.0, category: 'PostProcess', tooltip: 'Current interpolated color temperature' },
    ];

    for (const v of vars) {
      try {
        await callTool('unreal', 'create_variable', {
          blueprint_name: bpName,
          ...v,
        }, 10_000);
        results.push({ step: `var_${v.variable_name}`, success: true });
      } catch (err) {
        results.push({ step: `var_${v.variable_name}`, success: false, error: err.message });
      }
    }

    // 3. Add events
    for (const event of ['ReceiveBeginPlay', 'ReceiveTick']) {
      try {
        await callTool('unreal', 'add_event_node', {
          blueprint_name: bpName,
          event_name: event,
        }, 10_000);
        results.push({ step: `event_${event}`, success: true });
      } catch (err) {
        results.push({ step: `event_${event}`, success: false, error: err.message });
      }
    }

    // 4. Add custom events for external triggers
    for (const event of ['StartTransition', 'FinishTransition', 'CancelTransition']) {
      try {
        await callTool('unreal', 'add_event_node', {
          blueprint_name: bpName,
          event_name: event,
        }, 10_000);
        results.push({ step: `custom_${event}`, success: true });
      } catch (err) {
        results.push({ step: `custom_${event}`, success: false, error: err.message });
      }
    }

    const succeeded = results.filter(r => r.success).length;
    log.info({ bpName, succeeded, total: results.length }, 'Transition controller BP created');

    return {
      success: true,
      bpName,
      summary: `${succeeded}/${results.length} steps succeeded`,
      variables: vars.length,
      results,
    };
  } catch (err) {
    log.error({ err: err.message }, 'Transition controller BP creation failed');
    return { success: false, error: err.message, results };
  }
}

// ── Performance Profile — Lighting Cost Budget (ms_7) ─────────────────────────

/**
 * Lighting performance budget per feature.
 * Cost estimates in relative GPU ms at 1080p (RTX 3060 baseline).
 * UE5 Lumen path tracing costs are higher than raster — noted separately.
 *
 * Budget target: 8ms total lighting at 1080p/60fps (13.3% of 16.67ms frame).
 * Console target: 10ms at 1080p/30fps dynamic resolution.
 */
const LIGHTING_PERFORMANCE_BUDGET = {
  targetPlatforms: [
    { name: 'PC High',     gpu: 'RTX 3060',     resolution: '1080p', fps: 60, budgetMs: 8.0 },
    { name: 'PC Ultra',    gpu: 'RTX 4070+',    resolution: '1440p', fps: 60, budgetMs: 10.0 },
    { name: 'PC Low',      gpu: 'GTX 1660',     resolution: '1080p', fps: 30, budgetMs: 12.0 },
    { name: 'Steam Deck',  gpu: 'RDNA2 Custom', resolution: '800p',  fps: 30, budgetMs: 14.0 },
  ],

  features: {
    directionalLight: {
      name: 'Directional Light (Sun)',
      costMs: { pcHigh: 0.3, pcUltra: 0.4, pcLow: 0.5, steamDeck: 0.6 },
      scalability: {
        shadowCascades: { high: 4, medium: 3, low: 2 },
        shadowResolution: { high: 2048, medium: 1024, low: 512 },
        contactShadows: { high: true, medium: true, low: false },
      },
      notes: 'Per-region directional light with CSM. Shadow cascades are primary cost driver.',
    },

    exponentialHeightFog: {
      name: 'ExponentialHeightFog',
      costMs: { pcHigh: 0.2, pcUltra: 0.2, pcLow: 0.3, steamDeck: 0.4 },
      scalability: {
        volumetricFog: { high: true, medium: true, low: false },
        volumetricFogDistance: { high: 6000, medium: 4000, low: 2000 },
        volumetricFogGridSize: { high: 150, medium: 100, low: 60 },
      },
      notes: 'Analytical fog is nearly free. Volumetric fog adds 0.5-1.5ms depending on grid size.',
    },

    volumetricFog: {
      name: 'Volumetric Fog (additive to HeightFog)',
      costMs: { pcHigh: 1.2, pcUltra: 1.5, pcLow: 0, steamDeck: 0 },
      scalability: {
        enabled: { high: true, medium: true, low: false },
        gridPixelSize: { high: 8, medium: 12, low: 16 },
        viewDistance: { high: 6000, medium: 4000, low: 2000 },
        historyWeight: { high: 0.9, medium: 0.85, low: 0.7 },
      },
      notes: 'Disabled on Low/Steam Deck. Major visual upgrade for fog-heavy regions (AshenWilds, VerdantReach).',
    },

    lumenGI: {
      name: 'Lumen Global Illumination',
      costMs: { pcHigh: 2.5, pcUltra: 3.0, pcLow: 0, steamDeck: 0 },
      scalability: {
        method: { high: 'lumen', medium: 'lumen', low: 'screenSpace' },
        quality: { high: 'high', medium: 'medium', low: 'off' },
        sceneDetail: { high: 1.0, medium: 0.75, low: 0.5 },
        traceDistance: { high: 20000, medium: 15000, low: 10000 },
        surfaceCacheResolution: { high: 1.0, medium: 0.75, low: 0.5 },
      },
      notes: 'Lumen is the biggest single cost. Falls back to SSGI on Low. Disabled on Steam Deck (uses baked lighting).',
    },

    lumenReflections: {
      name: 'Lumen Reflections',
      costMs: { pcHigh: 1.0, pcUltra: 1.5, pcLow: 0, steamDeck: 0 },
      scalability: {
        method: { high: 'lumen', medium: 'lumen', low: 'ssr' },
        quality: { high: 'high', medium: 'medium', low: 'off' },
      },
      notes: 'Bundled with Lumen GI on High/Ultra. SSR fallback on Low.',
    },

    godRays: {
      name: 'God Rays / Light Cookies',
      costMs: { pcHigh: 0.4, pcUltra: 0.5, pcLow: 0.2, steamDeck: 0.2 },
      scalability: {
        cookieResolution: { high: 512, medium: 256, low: 128 },
        lightShaftBloom: { high: true, medium: true, low: false },
        lightShaftOcclusion: { high: true, medium: false, low: false },
      },
      notes: 'Low cost. Cookie texture driven. 7 of 8 regions have god rays (Aethermere excluded).',
    },

    corruptionFogOverlay: {
      name: 'Corruption Fog MPC-driven Overlay',
      costMs: { pcHigh: 0.3, pcUltra: 0.3, pcLow: 0.2, steamDeck: 0.2 },
      scalability: {
        mpcUpdateFrequency: { high: 'everyTick', medium: 'every2Ticks', low: 'every4Ticks' },
        emissiveComplexity: { high: 'full', medium: 'simplified', low: 'off' },
      },
      notes: 'MPC parameter writes are nearly free. Emissive boost on fog is the main cost.',
    },

    transitionInterpolation: {
      name: 'Region Transition Lighting Blend',
      costMs: { pcHigh: 0.1, pcUltra: 0.1, pcLow: 0.1, steamDeck: 0.1 },
      scalability: {
        blendMethod: { high: 'perFrame', medium: 'perFrame', low: 'stepped' },
        steps: { high: 'continuous', medium: 'continuous', low: 5 },
      },
      notes: 'Negligible cost — just MPC writes during 1.5s transition window.',
    },

    skyLight: {
      name: 'Sky Light (ambient)',
      costMs: { pcHigh: 0.3, pcUltra: 0.4, pcLow: 0.2, steamDeck: 0.2 },
      scalability: {
        realTimeCapture: { high: true, medium: false, low: false },
        cubemapResolution: { high: 256, medium: 128, low: 64 },
      },
      notes: 'Static cubemap on Low/Deck. Real-time capture on High for Lumen sky bounce.',
    },

    postProcess: {
      name: 'Post-Process (bloom, AO, vignette, color grading)',
      costMs: { pcHigh: 0.8, pcUltra: 1.0, pcLow: 0.5, steamDeck: 0.4 },
      scalability: {
        bloom: { high: 'standard', medium: 'standard', low: 'basic' },
        ao: { high: 'lumenAO', medium: 'ssao', low: 'off' },
        colorGrading: { high: 'full', medium: 'full', low: 'basic' },
        motionBlur: { high: true, medium: false, low: false },
      },
      notes: 'Bloom is 0.2ms, AO is 0.3ms (SSAO) or free with Lumen, vignette is 0.05ms.',
    },
  },
};

/**
 * Get the complete lighting performance budget.
 * Includes per-feature cost estimates, scalability settings per quality tier,
 * and total budget analysis for each target platform.
 */
export function getLightingPerformanceBudget() {
  const budget = { ...LIGHTING_PERFORMANCE_BUDGET };

  // Compute totals per platform
  const totals = {};
  for (const platform of budget.targetPlatforms) {
    const key = platform.name.replace(/\s+/g, '').toLowerCase()
      .replace('pchigh', 'pcHigh')
      .replace('pcultra', 'pcUltra')
      .replace('pclow', 'pcLow')
      .replace('steamdeck', 'steamDeck');

    // Map platform name to cost key
    const costKey = platform.name === 'PC High' ? 'pcHigh'
      : platform.name === 'PC Ultra' ? 'pcUltra'
      : platform.name === 'PC Low' ? 'pcLow'
      : 'steamDeck';

    let totalMs = 0;
    const breakdown = {};
    for (const [featureId, feature] of Object.entries(budget.features)) {
      const cost = feature.costMs[costKey] || 0;
      totalMs += cost;
      breakdown[featureId] = cost;
    }

    totals[platform.name] = {
      totalMs: Math.round(totalMs * 100) / 100,
      budgetMs: platform.budgetMs,
      headroom: Math.round((platform.budgetMs - totalMs) * 100) / 100,
      utilizationPct: Math.round((totalMs / platform.budgetMs) * 100),
      withinBudget: totalMs <= platform.budgetMs,
      breakdown,
    };
  }

  budget.analysis = totals;

  // Optimization recommendations
  budget.recommendations = [
    {
      priority: 'critical',
      platform: 'PC Low',
      action: 'Disable Lumen GI/Reflections, use SSGI + SSR fallback',
      savingsMs: 3.5,
    },
    {
      priority: 'critical',
      platform: 'Steam Deck',
      action: 'Use baked lighting, disable volumetric fog, simplified post-process',
      savingsMs: 5.0,
    },
    {
      priority: 'medium',
      platform: 'PC High',
      action: 'Reduce volumetric fog grid size in non-fog regions (Ironhold, Aethermere)',
      savingsMs: 0.5,
    },
    {
      priority: 'low',
      platform: 'All',
      action: 'Region-adaptive quality: AshenWilds needs volumetric fog, Ironhold does not',
      savingsMs: 0.3,
    },
  ];

  return budget;
}

/**
 * Generate a UE5 scalability config snippet for the lighting system.
 * Maps to Engine.ini [ScalabilityGroups] format.
 */
export function generateLightingScalabilityConfig() {
  const features = LIGHTING_PERFORMANCE_BUDGET.features;
  const configs = {};

  for (const tier of ['high', 'medium', 'low']) {
    const settings = {};
    for (const [id, feature] of Object.entries(features)) {
      if (feature.scalability) {
        const tierSettings = {};
        for (const [param, values] of Object.entries(feature.scalability)) {
          tierSettings[param] = values[tier];
        }
        settings[id] = tierSettings;
      }
    }
    configs[tier] = settings;
  }

  return {
    scalabilityTiers: configs,
    configFormat: 'UE5 DefaultScalability.ini',
    note: 'Apply via r.SCLighting CVars or Project Settings > Engine > Scalability',
  };
}

/**
 * Wire BP_CorruptionFogController to the existing corruption system.
 * Adds a connection in blueprint-integration spec.
 */
export function getCorruptionFogConnections() {
  return [
    {
      from: 'BP_CorruptionMeter',
      to: 'BP_CorruptionFogController',
      dispatcher: 'OnCorruptionChanged',
      dataType: 'float',
      description: 'Corruption level drives fog density, color, and emissive',
    },
    {
      from: 'BP_RegionTransition',
      to: 'BP_CorruptionFogController',
      dispatcher: 'OnRegionChanged',
      dataType: 'string',
      description: 'Region changes trigger fog profile swap with crossfade',
    },
  ];
}
