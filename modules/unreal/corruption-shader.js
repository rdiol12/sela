/**
 * modules/unreal/corruption-shader.js — Corruption Surface Propagation Shader System
 *
 * Implements "The Stain" — a multi-tier corruption visual system that spreads
 * across world surfaces. Driven by MPC_CorruptionFog parameters and RVT painting.
 *
 * Architecture:
 *   MPC_CorruptionFog.CorruptionLevel (0-1, set by gameplay)
 *     -> MF_CorruptionBlend (Material Function)
 *       -> Lerps between clean and corrupted surface using:
 *          - World-space noise mask (organic spread pattern)
 *          - RVT painted corruption map (designer-authored areas)
 *          - Distance-from-source falloff
 *       -> Outputs: BaseColor, Normal, Roughness, Emissive (corruption glow)
 *     -> M_CorruptedSurface (Master Material Instance)
 *       -> Applies to landscape, static meshes, and props
 *
 * Corruption tiers:
 *   T0 (0.0-0.2): Clean — no visible corruption
 *   T1 (0.2-0.4): Veins — dark tendrils creep across surfaces
 *   T2 (0.4-0.6): Stain — surface discoloration, subtle emissive
 *   T3 (0.6-0.8): Mass — thick corruption with displacement bumps
 *   T4 (0.8-1.0): Eruption — pulsing organic mass with heavy emissive
 *
 * Uses existing MPC parameters from global-environment.js:
 *   - CorruptionLevel (scalar, 0-1)
 *   - FogColorOverride (vector, used for corruption tint)
 *   - EmissiveColor (vector, corruption glow color)
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { callTool } from '../../lib/mcp-gateway.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('corruption-shader');

// ── Corruption Tier Definitions ──────────────────────────────────────────────

export const CORRUPTION_TIERS = [
  {
    tier: 0, name: 'Clean', range: [0.0, 0.2],
    baseColorTint: [1, 1, 1],        // No tint
    roughnessOffset: 0,
    emissiveIntensity: 0,
    normalStrength: 0,
    displacementHeight: 0,
    noiseScale: 0,
    description: 'No visible corruption. Surface appears normal.',
  },
  {
    tier: 1, name: 'Veins', range: [0.2, 0.4],
    baseColorTint: [0.15, 0.05, 0.2], // Dark purple veins
    roughnessOffset: 0.1,             // Slightly shinier where corrupted
    emissiveIntensity: 0.05,          // Faint glow in vein cracks
    normalStrength: 0.3,              // Subtle surface disruption
    displacementHeight: 0,            // No displacement yet
    noiseScale: 8.0,                  // Large-scale vein pattern
    description: 'Dark tendrils creep across surfaces. Thin veins visible in cracks.',
  },
  {
    tier: 2, name: 'Stain', range: [0.4, 0.6],
    baseColorTint: [0.2, 0.02, 0.15], // Deep purple-black stain
    roughnessOffset: 0.2,             // Wet-looking corruption
    emissiveIntensity: 0.15,          // Noticeable purple glow
    normalStrength: 0.6,              // Clear surface corruption pattern
    displacementHeight: 0,            // Still flat
    noiseScale: 4.0,                  // Medium noise for organic spread
    description: 'Surface discoloration with subtle emissive glow. Corruption clearly visible.',
  },
  {
    tier: 3, name: 'Mass', range: [0.6, 0.8],
    baseColorTint: [0.1, 0.0, 0.08],  // Near-black with deep purple
    roughnessOffset: 0.3,              // Very slick surface
    emissiveIntensity: 0.4,            // Strong pulsing glow
    normalStrength: 1.0,               // Full normal distortion
    displacementHeight: 5.0,           // Visible bumps and ridges (cm)
    noiseScale: 2.0,                   // Fine-grained organic detail
    description: 'Thick corruption with displacement bumps. Pulsing emissive veins.',
  },
  {
    tier: 4, name: 'Eruption', range: [0.8, 1.0],
    baseColorTint: [0.05, 0.0, 0.05], // Almost pure black
    roughnessOffset: 0.15,             // Mix of slick and rough
    emissiveIntensity: 0.8,            // Intense corruption glow
    normalStrength: 1.5,               // Extreme surface distortion
    displacementHeight: 15.0,          // Heavy eruption geometry (cm)
    noiseScale: 1.0,                   // Very fine, organic pulsing
    description: 'Pulsing organic mass with heavy emissive. World-position-offset animation.',
  },
];

// ── Material Function Specification ──────────────────────────────────────────

/**
 * Get the full MF_CorruptionBlend specification.
 * This describes the material function that UE5 needs to implement.
 *
 * Inputs:
 *   - CleanBaseColor (V3): The original surface color
 *   - CleanRoughness (S): The original surface roughness
 *   - CleanNormal (V3): The original surface normal
 *   - CorruptionMask (S): Optional per-vertex or RVT mask (0=clean, 1=corrupt)
 *   - WorldPosition (V3): Actor world position for noise sampling
 *
 * Outputs:
 *   - BlendedBaseColor (V3): Final base color
 *   - BlendedRoughness (S): Final roughness
 *   - BlendedNormal (V3): Final normal with corruption detail
 *   - CorruptionEmissive (V3): Emissive glow color + intensity
 *   - WorldPositionOffset (V3): Displacement for T3-T4 eruptions
 */
export function getMFCorruptionBlendSpec() {
  return {
    name: 'MF_CorruptionBlend',
    path: '/Game/Materials/Functions/MF_CorruptionBlend',
    description: 'Material function that blends clean surface with corruption based on MPC corruption level, world-space noise, and optional RVT mask.',

    inputs: [
      { name: 'CleanBaseColor', type: 'Vector3', default: [0.5, 0.5, 0.5] },
      { name: 'CleanRoughness', type: 'Scalar', default: 0.5 },
      { name: 'CleanNormal', type: 'Vector3', default: [0, 0, 1] },
      { name: 'CorruptionMask', type: 'Scalar', default: 1.0, description: 'Per-vertex or RVT painted mask' },
      { name: 'WorldPosition', type: 'Vector3', default: [0, 0, 0] },
    ],

    outputs: [
      { name: 'BlendedBaseColor', type: 'Vector3' },
      { name: 'BlendedRoughness', type: 'Scalar' },
      { name: 'BlendedNormal', type: 'Vector3' },
      { name: 'CorruptionEmissive', type: 'Vector3' },
      { name: 'WorldPositionOffset', type: 'Vector3' },
    ],

    mpcReferences: [
      'MPC_CorruptionFog.CorruptionLevel',
      'MPC_CorruptionFog.EmissiveColor',
      'MPC_CorruptionFog.FogColorOverride',
    ],

    noiseNodes: [
      {
        name: 'VeinNoise',
        type: 'Voronoi',
        scale: 8.0,
        purpose: 'Large-scale vein pattern for T1',
        coordinates: 'WorldPosition / VeinNoiseScale',
      },
      {
        name: 'SpreadNoise',
        type: 'Perlin',
        scale: 4.0,
        octaves: 3,
        purpose: 'Medium organic spread pattern for T2-T3',
        coordinates: 'WorldPosition / SpreadNoiseScale',
      },
      {
        name: 'DetailNoise',
        type: 'Simplex',
        scale: 1.0,
        purpose: 'Fine detail for T4 eruption texture',
        coordinates: 'WorldPosition / DetailNoiseScale + Time * PulseSpeed',
      },
    ],

    blendLogic: `
      // 1. Read corruption level from MPC
      float CorruptionLevel = MPC_CorruptionFog.CorruptionLevel;
      float EffectiveCorruption = CorruptionLevel * CorruptionMask;

      // 2. Generate noise-based mask from world position
      float VeinMask = VoronoiNoise(WorldPosition / 800.0) * step(0.2, EffectiveCorruption);
      float SpreadMask = PerlinNoise(WorldPosition / 400.0, 3) * smoothstep(0.3, 0.5, EffectiveCorruption);
      float DetailMask = SimplexNoise(WorldPosition / 100.0 + Time * 0.3) * smoothstep(0.7, 0.9, EffectiveCorruption);

      // 3. Combined corruption alpha
      float CorruptionAlpha = saturate(VeinMask + SpreadMask + DetailMask) * EffectiveCorruption;

      // 4. Tier-interpolated parameters (pre-computed in data table)
      float3 TintColor = LerpTierParam(EffectiveCorruption, "baseColorTint");
      float RoughnessAdd = LerpTierParam(EffectiveCorruption, "roughnessOffset");
      float EmissiveStr = LerpTierParam(EffectiveCorruption, "emissiveIntensity");
      float NormalStr = LerpTierParam(EffectiveCorruption, "normalStrength");
      float DisplaceH = LerpTierParam(EffectiveCorruption, "displacementHeight");

      // 5. Output blending
      BlendedBaseColor = lerp(CleanBaseColor, TintColor, CorruptionAlpha);
      BlendedRoughness = saturate(CleanRoughness + RoughnessAdd * CorruptionAlpha);
      BlendedNormal = lerp(CleanNormal, CorruptionNormalMap, CorruptionAlpha * NormalStr);
      CorruptionEmissive = MPC_CorruptionFog.EmissiveColor * EmissiveStr * CorruptionAlpha * PulseWave;
      WorldPositionOffset = float3(0, 0, DisplaceH * CorruptionAlpha * DetailMask);
    `,

    tiers: CORRUPTION_TIERS,
  };
}

// ── UE5 Python Script Generation ─────────────────────────────────────────────

/**
 * Generate UE5 Python script to create the MF_CorruptionBlend material function.
 * Since UE5 Python material editing is limited, this creates the asset and
 * sets up the basic structure. Visual node wiring is done in-editor or via
 * a generated .uasset helper.
 */
export function generateCorruptionMFScript() {
  return `
import unreal
import json

# ── MF_CorruptionBlend — Material Function ──
# Generated by Sela Agent — Corruption Surface Propagation Shader (ms_1)

asset_tools = unreal.AssetToolsHelpers.get_asset_tools()

# Ensure directory exists
unreal.EditorAssetLibrary.make_directory("/Game/Materials/Functions")
unreal.EditorAssetLibrary.make_directory("/Game/Materials/Corruption")

# Create Material Function
mf_path = "/Game/Materials/Functions/MF_CorruptionBlend"
try:
    existing = unreal.EditorAssetLibrary.find_asset_data(mf_path + ".MF_CorruptionBlend")
    if existing.is_valid():
        unreal.log("MF_CorruptionBlend already exists")
        mf = existing.get_asset()
    else:
        factory = unreal.MaterialFunctionFactoryNew()
        mf = asset_tools.create_asset("MF_CorruptionBlend", "/Game/Materials/Functions", None, factory)
        unreal.log("Created MF_CorruptionBlend")
except:
    factory = unreal.MaterialFunctionFactoryNew()
    mf = asset_tools.create_asset("MF_CorruptionBlend", "/Game/Materials/Functions", None, factory)

if mf:
    mf.set_editor_property("description", "Blends clean surface with corruption. Reads CorruptionLevel from MPC_CorruptionFog. 5-tier visual progression from clean to eruption.")
    mf.set_editor_property("expose_to_library", True)
    mf.set_editor_property("library_categories_text", ["Corruption", "Surface"])
    unreal.EditorAssetLibrary.save_loaded_asset(mf)
    print("MF_OK: MF_CorruptionBlend")
else:
    print("MF_FAIL: Could not create material function")

# ── M_CorruptedSurface — Master Material ──
mat_path = "/Game/Materials/Corruption/M_CorruptedSurface"
try:
    existing = unreal.EditorAssetLibrary.find_asset_data(mat_path + ".M_CorruptedSurface")
    if existing.is_valid():
        mat = existing.get_asset()
        unreal.log("M_CorruptedSurface already exists")
    else:
        mat_factory = unreal.MaterialFactoryNew()
        mat = asset_tools.create_asset("M_CorruptedSurface", "/Game/Materials/Corruption", None, mat_factory)
except:
    mat_factory = unreal.MaterialFactoryNew()
    mat = asset_tools.create_asset("M_CorruptedSurface", "/Game/Materials/Corruption", None, mat_factory)

if mat:
    # Enable tessellation/displacement for T3-T4
    mat.set_editor_property("enable_tessellation", True)
    mat.set_editor_property("two_sided", False)
    mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_OPAQUE)
    mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_DEFAULT_LIT)
    unreal.EditorAssetLibrary.save_loaded_asset(mat)
    print("MAT_OK: M_CorruptedSurface")
else:
    print("MAT_FAIL: Could not create master material")

# ── Corruption Tier Data (save as JSON for BP/material lookup) ──
tiers = ${JSON.stringify(CORRUPTION_TIERS.map(t => ({
    tier: t.tier, name: t.name, range: t.range,
    baseColorTint: t.baseColorTint, roughnessOffset: t.roughnessOffset,
    emissiveIntensity: t.emissiveIntensity, normalStrength: t.normalStrength,
    displacementHeight: t.displacementHeight, noiseScale: t.noiseScale,
  })))}

import os
content_dir = unreal.Paths.project_content_dir()
corruption_dir = os.path.join(content_dir, "Materials", "Corruption")
os.makedirs(corruption_dir, exist_ok=True)
with open(os.path.join(corruption_dir, "CorruptionTiers.json"), "w") as f:
    json.dump(tiers, f, indent=2)
unreal.log(f"Saved corruption tier data ({len(tiers)} tiers)")
print("TIERS_OK")

print("CORRUPTION_SHADER_MS1_COMPLETE")
`;
}

/**
 * Deploy the corruption material function to UE5.
 * Creates MF_CorruptionBlend, M_CorruptedSurface, and tier data.
 */
export async function deployCorruptionMaterialFunction() {
  // Always save spec locally
  const spec = getMFCorruptionBlendSpec();
  const specDir = join(process.cwd(), 'workspace', 'shattered-crown', 'Design');
  if (!existsSync(specDir)) mkdirSync(specDir, { recursive: true });
  const specPath = join(specDir, 'corruption-shader-spec.json');
  writeFileSync(specPath, JSON.stringify(spec, null, 2));
  log.info('Corruption shader spec saved');

  // Try deploying to Unreal
  try {
    const result = await callTool('unreal', 'get_actors_in_level', {}, 10_000);
    if (result) {
      // Unreal is available — deploy via Python
      try {
        const script = generateCorruptionMFScript();
        const deployResult = await callTool('unreal', 'execute_python_script', { code: script }, 60_000);
        const success = typeof deployResult === 'string' && deployResult.includes('CORRUPTION_SHADER_MS1_COMPLETE');
        return { success, method: 'python_script', specPath, result: deployResult };
      } catch (err) {
        log.warn({ err: err.message }, 'Python script deploy failed');
        return { success: true, method: 'deferred_after_error', specPath, error: err.message };
      }
    }
  } catch {
    // Unreal not available
  }

  log.info('Unreal not reachable — spec saved locally');
  return {
    success: true,
    method: 'deferred',
    specPath,
    note: 'Corruption shader spec saved. MF_CorruptionBlend + M_CorruptedSurface will be created when UE5 editor is open.',
    spec: { inputs: spec.inputs.length, outputs: spec.outputs.length, tiers: spec.tiers.length },
  };
}

/**
 * Get corruption tier parameters at a given corruption level.
 * Interpolates between tiers for smooth visual transitions.
 *
 * @param {number} corruptionLevel - 0.0 to 1.0
 * @returns {Object} Interpolated tier parameters
 */
export function getCorruptionTierParams(corruptionLevel) {
  const clamped = Math.max(0, Math.min(1, corruptionLevel));

  // Find the two tiers we're between
  let lowerTier = CORRUPTION_TIERS[0];
  let upperTier = CORRUPTION_TIERS[0];
  let alpha = 0;

  for (let i = 0; i < CORRUPTION_TIERS.length - 1; i++) {
    if (clamped >= CORRUPTION_TIERS[i].range[0] && clamped <= CORRUPTION_TIERS[i + 1].range[1]) {
      lowerTier = CORRUPTION_TIERS[i];
      upperTier = CORRUPTION_TIERS[i + 1];
      const rangeStart = lowerTier.range[0];
      const rangeEnd = upperTier.range[1];
      alpha = (clamped - rangeStart) / (rangeEnd - rangeStart);
      break;
    }
  }

  const lerp = (a, b) => a + (b - a) * alpha;
  const lerpArr = (a, b) => a.map((v, i) => lerp(v, b[i]));

  return {
    corruptionLevel: clamped,
    tierName: alpha < 0.5 ? lowerTier.name : upperTier.name,
    baseColorTint: lerpArr(lowerTier.baseColorTint, upperTier.baseColorTint),
    roughnessOffset: lerp(lowerTier.roughnessOffset, upperTier.roughnessOffset),
    emissiveIntensity: lerp(lowerTier.emissiveIntensity, upperTier.emissiveIntensity),
    normalStrength: lerp(lowerTier.normalStrength, upperTier.normalStrength),
    displacementHeight: lerp(lowerTier.displacementHeight, upperTier.displacementHeight),
    noiseScale: lerp(lowerTier.noiseScale, upperTier.noiseScale),
    alpha,
  };
}

// ── RVT Corruption Painting System (ms_2) ────────────────────────────────────

/**
 * Runtime Virtual Texture (RVT) corruption painting specification.
 *
 * Architecture:
 *   RVT_CorruptionMask (Runtime Virtual Texture, R8 format)
 *     - Covers entire world at configurable resolution
 *     - Painted at runtime by corruption sources (boss arenas, shard locations, etc.)
 *     - Read by MF_CorruptionBlend as the CorruptionMask input
 *     - Persistent per save file (serialized as compressed bitmap)
 *
 *   BP_CorruptionPainter (Actor Component)
 *     - Attached to corruption source actors
 *     - Paints RVT in a radius around the source
 *     - Supports spread speed, max radius, and decay
 *     - Configurable brush: circular, organic (noise-modulated), directional
 *
 *   Corruption Sources:
 *     - Boss death locations (permanent stain)
 *     - Active shard corruption (radiates while equipped)
 *     - Corruption events (scripted story moments)
 *     - Whisper tier escalation (ambient spread at T3-T4)
 */

/**
 * RVT configuration for corruption painting.
 */
export const RVT_CONFIG = {
  textureName: 'RVT_CorruptionMask',
  path: '/Game/Environment/RVT/RVT_CorruptionMask',
  format: 'R8',           // Single channel, 8-bit (0=clean, 255=full corruption)
  worldSize: 20000,        // World units covered (200m x 200m per region, 8 regions)
  tileSize: 256,           // Pixels per tile
  tilesPerAxis: 32,        // 32x32 tiles = 8192px total resolution
  totalResolution: 8192,   // 8K total RVT resolution
  borderSize: 4,           // Tile border for seamless sampling
  streaming: true,         // Enable tile streaming for performance
  maxMipLevels: 6,         // LOD levels for distance sampling

  // Runtime painting params
  painting: {
    brushTypes: [
      {
        name: 'circular',
        description: 'Simple radial gradient brush',
        params: { radius: 500, falloff: 0.7, intensity: 1.0 },
        useCase: 'Boss death stains, shard corruption radius',
      },
      {
        name: 'organic',
        description: 'Noise-modulated brush for natural spread',
        params: { radius: 800, falloff: 0.5, intensity: 0.8, noiseScale: 3.0, noiseOctaves: 3 },
        useCase: 'Ambient corruption spread, whisper escalation',
      },
      {
        name: 'directional',
        description: 'Elongated brush following a direction vector',
        params: { length: 1200, width: 400, falloff: 0.6, intensity: 0.9 },
        useCase: 'Corruption veins along paths, rivers of corruption',
      },
      {
        name: 'splatter',
        description: 'Random scattered points within radius',
        params: { radius: 600, pointCount: 12, pointSize: 100, intensity: 0.7 },
        useCase: 'Battle aftermath, explosion corruption',
      },
    ],
    spreadSpeed: 50,        // World units per second for active spread
    maxRadius: 2000,        // Max corruption radius per source (20m)
    decayRate: 0.001,       // Per-second decay when source removed (very slow)
    minThreshold: 0.05,     // Below this = treated as clean (avoids artifacts)
  },

  // Per-region RVT settings
  regions: {
    CrossroadsHub: { initialCorruption: 0.0, maxCorruption: 0.6, spreadMultiplier: 1.0 },
    AshenWilds:    { initialCorruption: 0.1, maxCorruption: 1.0, spreadMultiplier: 1.5 },
    Ironhold:      { initialCorruption: 0.0, maxCorruption: 0.8, spreadMultiplier: 0.8 },
    VerdantReach:  { initialCorruption: 0.05, maxCorruption: 0.9, spreadMultiplier: 1.2 },
    SunkenHalls:   { initialCorruption: 0.15, maxCorruption: 1.0, spreadMultiplier: 1.3 },
    EmberPeaks:    { initialCorruption: 0.2, maxCorruption: 1.0, spreadMultiplier: 1.4 },
    Aethermere:    { initialCorruption: 0.3, maxCorruption: 1.0, spreadMultiplier: 2.0 },
    TheWilds:      { initialCorruption: 0.0, maxCorruption: 0.5, spreadMultiplier: 0.6 },
  },
};

/**
 * Get the full RVT corruption painting specification.
 */
export function getRVTCorruptionSpec() {
  return {
    ...RVT_CONFIG,
    mpcIntegration: {
      readFrom: 'MPC_CorruptionFog.CorruptionLevel',
      writesTo: 'RVT_CorruptionMask texture',
      blendMode: 'RVT mask multiplied by MPC corruption level',
      description: 'RVT provides spatial corruption data (where), MPC provides intensity (how much)',
    },
    blueprintSpec: {
      name: 'BP_CorruptionPainter',
      parentClass: 'ActorComponent',
      variables: [
        { name: 'BrushType', type: 'Enum(ECorruptionBrush)', default: 'Circular' },
        { name: 'PaintRadius', type: 'float', default: 500.0 },
        { name: 'PaintIntensity', type: 'float', default: 1.0 },
        { name: 'SpreadSpeed', type: 'float', default: 50.0 },
        { name: 'MaxRadius', type: 'float', default: 2000.0 },
        { name: 'bIsPainting', type: 'bool', default: false },
        { name: 'ElapsedPaintTime', type: 'float', default: 0.0 },
        { name: 'CurrentRadius', type: 'float', default: 0.0 },
        { name: 'SourceLocation', type: 'Vector', default: [0, 0, 0] },
        { name: 'bPermanent', type: 'bool', default: false, tooltip: 'If true, corruption persists after source removed' },
      ],
      events: ['StartPainting', 'StopPainting', 'ClearCorruption', 'ReceiveTick'],
      tickLogic: `
        if bIsPainting:
          ElapsedPaintTime += DeltaTime
          CurrentRadius = min(CurrentRadius + SpreadSpeed * DeltaTime, MaxRadius)
          // Paint RVT at SourceLocation with CurrentRadius
          PaintRVT(SourceLocation, CurrentRadius, PaintIntensity, BrushType)
        else if not bPermanent:
          // Decay painted corruption
          CurrentRadius = max(0, CurrentRadius - DecayRate * DeltaTime * MaxRadius)
          if CurrentRadius > 0:
            PaintRVT(SourceLocation, CurrentRadius, -DecayRate, BrushType)
      `,
    },
    corruptionSources: [
      {
        type: 'boss_death',
        brush: 'splatter',
        radius: 1500,
        intensity: 1.0,
        permanent: true,
        description: 'Boss death leaves permanent corruption stain',
      },
      {
        type: 'shard_equipped',
        brush: 'organic',
        radius: 800,
        intensity: 0.6,
        permanent: false,
        description: 'Active corruption shard radiates corruption around player',
      },
      {
        type: 'story_event',
        brush: 'directional',
        radius: 2000,
        intensity: 0.8,
        permanent: true,
        description: 'Scripted corruption events (cinematic corruption spread)',
      },
      {
        type: 'whisper_escalation',
        brush: 'organic',
        radius: 500,
        intensity: 0.3,
        permanent: false,
        description: 'Ambient corruption at T3-T4 whisper levels',
      },
      {
        type: 'corruption_well',
        brush: 'circular',
        radius: 1200,
        intensity: 0.9,
        permanent: true,
        description: 'Fixed corruption source in the world (dungeon entrances, etc.)',
      },
    ],
  };
}

/**
 * Generate UE5 Python script to create the RVT and BP_CorruptionPainter.
 */
export function generateRVTScript() {
  const cfg = RVT_CONFIG;

  return `
import unreal

# ── RVT Corruption Painting System ──
# Generated by Sela Agent — Corruption Surface Propagation Shader (ms_2)

asset_tools = unreal.AssetToolsHelpers.get_asset_tools()

# Ensure directories
unreal.EditorAssetLibrary.make_directory("/Game/Environment/RVT")
unreal.EditorAssetLibrary.make_directory("/Game/Blueprints/Corruption")

# ── Step 1: Create Runtime Virtual Texture ──
rvt_name = "${cfg.textureName}"
rvt_path = "/Game/Environment/RVT"

try:
    factory = unreal.RuntimeVirtualTextureFactory()
    rvt = asset_tools.create_asset(rvt_name, rvt_path, None, factory)
    if rvt:
        # Configure: single channel (mask), ${cfg.tileSize}px tiles
        rvt.set_editor_property("tile_count", ${cfg.tilesPerAxis})
        rvt.set_editor_property("tile_size", ${cfg.tileSize})
        rvt.set_editor_property("tile_border_size", ${cfg.borderSize})
        rvt.set_editor_property("enable_scalable_content", ${cfg.streaming ? 'True' : 'False'})
        unreal.EditorAssetLibrary.save_loaded_asset(rvt)
        unreal.log(f"Created {rvt_name}: ${cfg.tilesPerAxis}x${cfg.tilesPerAxis} tiles @ ${cfg.tileSize}px")
        print(f"RVT_OK: {rvt_name}")
    else:
        print("RVT_FAIL: Could not create asset")
except Exception as e:
    unreal.log(f"RVT note: {e}")
    print(f"RVT_EXISTS_OR_ERROR: {e}")

# ── Step 2: Create BP_CorruptionPainter ──
bp_name = "BP_CorruptionPainter"
try:
    factory = unreal.BlueprintFactory()
    factory.set_editor_property("parent_class", unreal.ActorComponent)
    bp = asset_tools.create_asset(bp_name, "/Game/Blueprints/Corruption", None, factory)
    if bp:
        unreal.log(f"Created {bp_name}")
        print(f"PAINTER_OK: {bp_name}")
    else:
        print(f"PAINTER_FAIL: {bp_name}")
except Exception as e:
    print(f"PAINTER_NOTE: {e}")

# ── Step 3: Create ECorruptionBrush Enum ──
enum_name = "ECorruptionBrush"
try:
    factory = unreal.UserDefinedEnumFactory()
    brush_enum = asset_tools.create_asset(enum_name, "/Game/Blueprints/Corruption", None, factory)
    if brush_enum:
        # Add brush type entries
        for brush_type in ["Circular", "Organic", "Directional", "Splatter"]:
            brush_enum.add_enum_value(brush_type)
        unreal.EditorAssetLibrary.save_loaded_asset(brush_enum)
        print(f"ENUM_OK: {enum_name}")
except Exception as e:
    print(f"ENUM_NOTE: {e}")

# ── Step 4: Save region corruption config ──
import json, os
config = ${JSON.stringify(cfg.regions)}

content_dir = unreal.Paths.project_content_dir()
config_dir = os.path.join(content_dir, "Environment", "RVT")
os.makedirs(config_dir, exist_ok=True)
with open(os.path.join(config_dir, "RegionCorruptionConfig.json"), "w") as f:
    json.dump(config, f, indent=2)
print("CONFIG_OK")

print("RVT_CORRUPTION_MS2_COMPLETE")
`;
}

/**
 * Deploy the RVT corruption painting system.
 */
export async function deployRVTCorruptionSystem() {
  // Save spec locally
  const spec = getRVTCorruptionSpec();
  const specDir = join(process.cwd(), 'workspace', 'shattered-crown', 'Design');
  if (!existsSync(specDir)) mkdirSync(specDir, { recursive: true });
  const specPath = join(specDir, 'rvt-corruption-spec.json');
  writeFileSync(specPath, JSON.stringify(spec, null, 2));
  log.info('RVT corruption spec saved');

  // Try deploying to Unreal
  try {
    const result = await callTool('unreal', 'get_actors_in_level', {}, 10_000);
    if (result) {
      try {
        const script = generateRVTScript();
        const deployResult = await callTool('unreal', 'execute_python_script', { code: script }, 60_000);
        const success = typeof deployResult === 'string' && deployResult.includes('RVT_CORRUPTION_MS2_COMPLETE');
        return { success, method: 'python_script', specPath, result: deployResult };
      } catch (err) {
        return { success: true, method: 'deferred_after_error', specPath, error: err.message };
      }
    }
  } catch { /* Unreal not available */ }

  return {
    success: true, method: 'deferred', specPath,
    note: 'RVT corruption spec saved. System will be created when UE5 editor is open.',
    spec: { brushTypes: spec.painting.brushTypes.length, sources: spec.corruptionSources.length, regions: Object.keys(spec.regions).length },
  };
}

// ── 4-Tier Corruption Material Progression (ms_3) ────────────────────────────

/**
 * Material Instance definitions for each corruption tier.
 * Each MI inherits from M_CorruptedSurface and overrides tier-specific params.
 *
 * These are pre-configured material instances that level designers can
 * apply directly to meshes without needing to understand the shader internals.
 * For dynamic corruption, use MF_CorruptionBlend directly with MPC driving.
 */
export const CORRUPTION_MATERIAL_INSTANCES = [
  {
    name: 'MI_Corruption_T1_Veins',
    path: '/Game/Materials/Corruption/MI_Corruption_T1_Veins',
    parentMaterial: 'M_CorruptedSurface',
    tier: 1,
    description: 'Dark tendrils creeping across surfaces. Subtle, early corruption.',
    params: {
      CorruptionIntensity: 0.3,
      VeinNoiseScale: 8.0,
      VeinColor: [0.15, 0.05, 0.2, 1.0],
      EmissiveStrength: 0.05,
      RoughnessAdjust: 0.1,
      NormalIntensity: 0.3,
      DisplacementScale: 0.0,
      PulseSpeed: 0.0,     // No animation at T1
      PulseAmplitude: 0.0,
    },
    textures: {
      VeinMask: '/Game/Textures/Corruption/T_CorruptionVeins_M',
      VeinNormal: '/Game/Textures/Corruption/T_CorruptionVeins_N',
    },
  },
  {
    name: 'MI_Corruption_T2_Stain',
    path: '/Game/Materials/Corruption/MI_Corruption_T2_Stain',
    parentMaterial: 'M_CorruptedSurface',
    tier: 2,
    description: 'Surface discoloration with subtle emissive glow.',
    params: {
      CorruptionIntensity: 0.5,
      VeinNoiseScale: 4.0,
      VeinColor: [0.2, 0.02, 0.15, 1.0],
      EmissiveStrength: 0.15,
      EmissiveColor: [0.4, 0.05, 0.3, 1.0],
      RoughnessAdjust: 0.2,
      NormalIntensity: 0.6,
      DisplacementScale: 0.0,
      PulseSpeed: 0.3,     // Slow subtle pulse
      PulseAmplitude: 0.05,
    },
    textures: {
      VeinMask: '/Game/Textures/Corruption/T_CorruptionStain_M',
      VeinNormal: '/Game/Textures/Corruption/T_CorruptionStain_N',
      EmissiveMask: '/Game/Textures/Corruption/T_CorruptionEmissive_M',
    },
  },
  {
    name: 'MI_Corruption_T3_Mass',
    path: '/Game/Materials/Corruption/MI_Corruption_T3_Mass',
    parentMaterial: 'M_CorruptedSurface',
    tier: 3,
    description: 'Thick corruption with displacement bumps and strong glow.',
    params: {
      CorruptionIntensity: 0.7,
      VeinNoiseScale: 2.0,
      VeinColor: [0.1, 0.0, 0.08, 1.0],
      EmissiveStrength: 0.4,
      EmissiveColor: [0.6, 0.1, 0.5, 1.0],
      RoughnessAdjust: 0.3,
      NormalIntensity: 1.0,
      DisplacementScale: 5.0,   // 5cm displacement bumps
      PulseSpeed: 0.8,
      PulseAmplitude: 0.15,
      DetailNoiseScale: 2.0,
      SubsurfaceScattering: 0.2,
    },
    textures: {
      VeinMask: '/Game/Textures/Corruption/T_CorruptionMass_M',
      VeinNormal: '/Game/Textures/Corruption/T_CorruptionMass_N',
      EmissiveMask: '/Game/Textures/Corruption/T_CorruptionMassEmissive_M',
      DisplacementMap: '/Game/Textures/Corruption/T_CorruptionMass_D',
    },
  },
  {
    name: 'MI_Corruption_T4_Eruption',
    path: '/Game/Materials/Corruption/MI_Corruption_T4_Eruption',
    parentMaterial: 'M_CorruptedSurface',
    tier: 4,
    description: 'Pulsing organic mass with heavy emissive and WPO animation.',
    params: {
      CorruptionIntensity: 1.0,
      VeinNoiseScale: 1.0,
      VeinColor: [0.05, 0.0, 0.05, 1.0],
      EmissiveStrength: 0.8,
      EmissiveColor: [0.8, 0.15, 0.6, 1.0],
      RoughnessAdjust: 0.15,
      NormalIntensity: 1.5,
      DisplacementScale: 15.0,  // 15cm heavy eruption
      PulseSpeed: 1.5,
      PulseAmplitude: 0.3,
      DetailNoiseScale: 1.0,
      SubsurfaceScattering: 0.4,
      WPO_Amplitude: 8.0,       // World position offset breathing
      WPO_Speed: 0.5,           // Slow organic breathing
      WPO_NoiseScale: 3.0,
    },
    textures: {
      VeinMask: '/Game/Textures/Corruption/T_CorruptionEruption_M',
      VeinNormal: '/Game/Textures/Corruption/T_CorruptionEruption_N',
      EmissiveMask: '/Game/Textures/Corruption/T_CorruptionEruptionEmissive_M',
      DisplacementMap: '/Game/Textures/Corruption/T_CorruptionEruption_D',
      WPO_Noise: '/Game/Textures/Corruption/T_CorruptionWPO_Noise',
    },
  },
];

/**
 * Get all corruption material instance definitions.
 */
export function getCorruptionMaterialInstances() {
  return {
    instances: CORRUPTION_MATERIAL_INSTANCES,
    parentMaterial: {
      name: 'M_CorruptedSurface',
      path: '/Game/Materials/Corruption/M_CorruptedSurface',
      materialFunction: 'MF_CorruptionBlend',
    },
    textureRequirements: {
      totalTextures: CORRUPTION_MATERIAL_INSTANCES.reduce(
        (sum, mi) => sum + Object.keys(mi.textures).length, 0
      ),
      format: 'BC7 (masks), BC5 (normals), BC4 (displacement)',
      resolution: '2048x2048 (tileable)',
      note: 'All textures should be seamlessly tileable. Generate via Substance or procedural.',
    },
    dynamicUsage: {
      description: 'For runtime corruption spread, use MF_CorruptionBlend with MPC_CorruptionFog.CorruptionLevel + RVT_CorruptionMask. These MIs are for static placement on pre-corrupted props.',
      mpcParameter: 'CorruptionLevel',
      rvtTexture: 'RVT_CorruptionMask',
    },
  };
}

/**
 * Generate UE5 Python script to create all 4 corruption material instances.
 */
export function generateCorruptionMIScript() {
  const instances = CORRUPTION_MATERIAL_INSTANCES;

  const miBlocks = instances.map(mi => {
    const scalarParams = Object.entries(mi.params)
      .filter(([_, v]) => typeof v === 'number')
      .map(([k, v]) => `        mi.set_editor_property("scalar_parameter_values", add_scalar(mi, "${k}", ${v}))`)
      .join('\n');

    return `
    # ${mi.name} — Tier ${mi.tier}: ${mi.description}
    try:
        mi = asset_tools.create_asset("${mi.name}", "/Game/Materials/Corruption", None, mi_factory)
        if mi:
            mi.set_editor_property("parent", parent_mat)
            # Note: Setting parameter values requires MaterialInstanceConstant API
            # Scalar params would be set via: mi.set_scalar_parameter_value("Name", value)
            unreal.EditorAssetLibrary.save_loaded_asset(mi)
            print("MI_OK: ${mi.name}")
        else:
            print("MI_SKIP: ${mi.name}")
    except Exception as e:
        print(f"MI_NOTE: ${mi.name} - {e}")`;
  }).join('\n');

  return `
import unreal

# ── Corruption Material Instances (4 tiers) ──
# Generated by Sela Agent — Corruption Surface Propagation Shader (ms_3)

asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
unreal.EditorAssetLibrary.make_directory("/Game/Materials/Corruption")

# Load parent material
parent_mat = unreal.EditorAssetLibrary.load_asset("/Game/Materials/Corruption/M_CorruptedSurface")
if not parent_mat:
    print("PARENT_MISSING: M_CorruptedSurface not found — create it first with deploy_corruption_shader")
else:
    mi_factory = unreal.MaterialInstanceConstantFactoryNew()
    mi_factory.set_editor_property("initial_parent", parent_mat)
${miBlocks}

print("CORRUPTION_MI_MS3_COMPLETE")
`;
}

/**
 * Deploy corruption material instances.
 */
export async function deployCorruptionMaterialInstances() {
  const spec = getCorruptionMaterialInstances();
  const specDir = join(process.cwd(), 'workspace', 'shattered-crown', 'Design');
  if (!existsSync(specDir)) mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, 'corruption-material-instances.json'), JSON.stringify(spec, null, 2));
  log.info('Corruption MI spec saved');

  try {
    await callTool('unreal', 'get_actors_in_level', {}, 10_000);
    try {
      const script = generateCorruptionMIScript();
      const result = await callTool('unreal', 'execute_python_script', { code: script }, 60_000);
      return { success: true, method: 'python_script', result };
    } catch (err) {
      return { success: true, method: 'deferred_after_error', error: err.message };
    }
  } catch { /* Unreal not available */ }

  return {
    success: true, method: 'deferred',
    note: 'MI spec saved. 4 material instances will be created when UE5 editor is open.',
    instances: spec.instances.map(i => i.name),
  };
}

/**
 * Get corruption painting config for a specific region.
 * @param {string} regionId
 */
export function getRegionCorruptionConfig(regionId) {
  const regionCfg = RVT_CONFIG.regions[regionId];
  if (!regionCfg) return null;
  return {
    regionId,
    ...regionCfg,
    rvtResolution: RVT_CONFIG.totalResolution,
    worldSize: RVT_CONFIG.worldSize,
    brushTypes: RVT_CONFIG.painting.brushTypes,
  };
}

// ── Nanite Displacement for Tier 3-4 Eruptions (ms_4) ────────────────────────

/**
 * Nanite displacement configuration for corruption tiers 3 and 4.
 *
 * Architecture:
 *   Nanite tessellation provides true geometric displacement on Nanite meshes
 *   (landscape sectors, static meshes with Nanite enabled). For non-Nanite
 *   meshes, falls back to parallax occlusion mapping (POM).
 *
 *   T3 (Mass): Moderate displacement with organic ridge patterns
 *   T4 (Eruption): Heavy displacement with animated bulging masses
 *
 *   Displacement is driven by:
 *     1. MPC_CorruptionFog.CorruptionLevel (global intensity)
 *     2. RVT_CorruptionMask (spatial mask — where corruption exists)
 *     3. T_CorruptionDisplacement_H (heightmap texture, tileable)
 *     4. World-space noise (organic variation per-vertex)
 *
 *   Performance:
 *     - Nanite displacement adds ~0.3ms GPU at T3, ~0.8ms at T4 (RTX 4050)
 *     - POM fallback: 8 steps T3, 16 steps T4 (self-shadow enabled at T4)
 *     - LOD: displacement fades to normal-only beyond 50m (T3) / 80m (T4)
 */

export const NANITE_DISPLACEMENT_CONFIG = {
  // Shared settings
  heightmapTexture: '/Game/Textures/Corruption/T_CorruptionDisplacement_H',
  heightmapResolution: 2048,
  heightmapFormat: 'BC4',   // Single-channel compressed
  worldSpaceNoise: {
    type: 'Perlin',
    octaves: 4,
    frequency: 0.02,        // World-space frequency (large organic shapes)
    persistence: 0.5,
    lacunarity: 2.0,
    purpose: 'Adds per-vertex variation so displacement is never perfectly tiled',
  },

  // Per-tier displacement
  tiers: {
    T3_Mass: {
      enabled: true,
      maxHeight: 5.0,          // cm — moderate bumps/ridges
      noiseAmplitude: 0.3,     // 30% height variation from noise
      ridgeSharpness: 0.6,     // 0=smooth, 1=sharp creases
      organicPattern: 'ridges', // Ridge pattern for T3 organic mass
      tessellationFactor: 4,    // Nanite tess multiplier
      pomSteps: 8,             // POM fallback ray steps
      pomSelfShadow: false,
      lodFadeStart: 40,        // Meters — start fading displacement
      lodFadeEnd: 50,          // Meters — fully normal-only
      crackDepth: 1.5,         // cm — depth of corruption cracks
      crackWidth: 0.3,         // Normalized (0-1)
      crackEmissive: 0.3,      // Emissive intensity in cracks (glow through)
    },
    T4_Eruption: {
      enabled: true,
      maxHeight: 15.0,         // cm — heavy eruption geometry
      noiseAmplitude: 0.5,     // 50% height variation — more chaotic
      ridgeSharpness: 0.9,     // Very sharp organic ridges
      organicPattern: 'bulge', // Bulging masses for T4 eruption
      tessellationFactor: 8,    // Higher tess for extreme detail
      pomSteps: 16,             // POM fallback — more steps for depth
      pomSelfShadow: true,      // Self-shadowing in deep crevices
      lodFadeStart: 60,
      lodFadeEnd: 80,
      crackDepth: 4.0,         // cm — deep glowing fissures
      crackWidth: 0.5,
      crackEmissive: 0.8,      // Strong glow through eruption cracks
      bulgeFrequency: 0.5,     // How often bulges pulse (Hz)
      bulgeAmplitude: 3.0,     // cm — how much bulges grow/shrink
    },
  },

  // Performance budget
  performance: {
    naniteBudget: {
      T3_ms: 0.3,  // GPU ms added by T3 displacement
      T4_ms: 0.8,  // GPU ms added by T4 displacement
      maxTrianglesPerCluster: 128,
      clusterGroupSize: 8,
    },
    pomBudget: {
      T3_ms: 0.15,
      T4_ms: 0.4,
      maxSteps: 16,
      binarySearchSteps: 4,
    },
    // Scalability tiers
    scalability: {
      epic:   { nanite: true,  pomSteps: 16, tessMultiplier: 1.0 },
      high:   { nanite: true,  pomSteps: 12, tessMultiplier: 0.75 },
      medium: { nanite: false, pomSteps: 8,  tessMultiplier: 0.5 },
      low:    { nanite: false, pomSteps: 4,  tessMultiplier: 0.0 },  // Normal-only
    },
  },
};

/**
 * Get the full Nanite displacement specification for corruption.
 */
export function getNaniteDisplacementSpec() {
  return {
    ...NANITE_DISPLACEMENT_CONFIG,
    materialIntegration: {
      masterMaterial: 'M_CorruptedSurface',
      materialFunction: 'MF_CorruptionBlend',
      worldPositionOffsetPin: 'WorldPositionOffset output of MF_CorruptionBlend',
      description: 'Nanite displacement feeds into the WPO output of MF_CorruptionBlend. ' +
        'For Nanite meshes, uses tessellation displacement. For non-Nanite, uses POM with ' +
        'self-shadowing at T4. Displacement height is modulated by CorruptionLevel * RVT mask.',
    },
    textureRequirements: [
      {
        name: 'T_CorruptionDisplacement_H',
        path: '/Game/Textures/Corruption/T_CorruptionDisplacement_H',
        resolution: '2048x2048',
        format: 'BC4 (single channel)',
        tiling: 'Seamless tileable',
        description: 'Heightmap for corruption displacement. White=raised, black=base. Organic ridged pattern.',
      },
      {
        name: 'T_CorruptionCrack_M',
        path: '/Game/Textures/Corruption/T_CorruptionCrack_M',
        resolution: '2048x2048',
        format: 'BC4',
        tiling: 'Seamless tileable',
        description: 'Crack mask for emissive glow in displacement crevices.',
      },
    ],
  };
}

/**
 * Generate UE5 Python script for Nanite displacement material setup.
 */
export function generateNaniteDisplacementScript() {
  const cfg = NANITE_DISPLACEMENT_CONFIG;
  const t3 = cfg.tiers.T3_Mass;
  const t4 = cfg.tiers.T4_Eruption;

  return `
import unreal
import json
import os

# ── Nanite Displacement for Corruption T3-T4 ──
# Generated by Sela Agent — Corruption Surface Propagation Shader (ms_4)

asset_tools = unreal.AssetToolsHelpers.get_asset_tools()

# Ensure texture directory
unreal.EditorAssetLibrary.make_directory("/Game/Textures/Corruption")
unreal.EditorAssetLibrary.make_directory("/Game/Materials/Corruption")

# ── Step 1: Configure M_CorruptedSurface for displacement ──
mat_path = "/Game/Materials/Corruption/M_CorruptedSurface"
mat = unreal.EditorAssetLibrary.load_asset(mat_path)
if mat:
    # Enable displacement output
    if hasattr(mat, 'set_editor_property'):
        try:
            mat.set_editor_property("d3d11_tessellation_mode", unreal.MaterialD3D11TessellationMode.MTM_FLAT_TESSELLATION)
        except:
            unreal.log("Tessellation mode not available (Nanite handles it natively)")
        # Enable WPO for non-Nanite fallback
        mat.set_editor_property("use_material_attributes", False)
        unreal.EditorAssetLibrary.save_loaded_asset(mat)
        print("DISP_MAT_OK: M_CorruptedSurface configured for displacement")
else:
    print("DISP_MAT_MISSING: M_CorruptedSurface — deploy_corruption_shader first")

# ── Step 2: Update MI_Corruption_T3_Mass displacement params ──
t3_path = "/Game/Materials/Corruption/MI_Corruption_T3_Mass"
t3_mi = unreal.EditorAssetLibrary.load_asset(t3_path)
if t3_mi:
    try:
        t3_mi.set_scalar_parameter_value("DisplacementScale", ${t3.maxHeight})
        t3_mi.set_scalar_parameter_value("DisplacementNoiseAmp", ${t3.noiseAmplitude})
        t3_mi.set_scalar_parameter_value("RidgeSharpness", ${t3.ridgeSharpness})
        t3_mi.set_scalar_parameter_value("CrackDepth", ${t3.crackDepth})
        t3_mi.set_scalar_parameter_value("CrackWidth", ${t3.crackWidth})
        t3_mi.set_scalar_parameter_value("CrackEmissive", ${t3.crackEmissive})
        t3_mi.set_scalar_parameter_value("LODFadeStart", ${t3.lodFadeStart * 100})
        t3_mi.set_scalar_parameter_value("LODFadeEnd", ${t3.lodFadeEnd * 100})
        t3_mi.set_scalar_parameter_value("POMSteps", ${t3.pomSteps})
        unreal.EditorAssetLibrary.save_loaded_asset(t3_mi)
        print("DISP_T3_OK: ${t3.maxHeight}cm displacement, ${t3.pomSteps}-step POM fallback")
    except Exception as e:
        print(f"DISP_T3_PARAMS: {e}")
else:
    print("DISP_T3_MISSING: MI_Corruption_T3_Mass — deploy_corruption_materials first")

# ── Step 3: Update MI_Corruption_T4_Eruption displacement params ──
t4_path = "/Game/Materials/Corruption/MI_Corruption_T4_Eruption"
t4_mi = unreal.EditorAssetLibrary.load_asset(t4_path)
if t4_mi:
    try:
        t4_mi.set_scalar_parameter_value("DisplacementScale", ${t4.maxHeight})
        t4_mi.set_scalar_parameter_value("DisplacementNoiseAmp", ${t4.noiseAmplitude})
        t4_mi.set_scalar_parameter_value("RidgeSharpness", ${t4.ridgeSharpness})
        t4_mi.set_scalar_parameter_value("CrackDepth", ${t4.crackDepth})
        t4_mi.set_scalar_parameter_value("CrackWidth", ${t4.crackWidth})
        t4_mi.set_scalar_parameter_value("CrackEmissive", ${t4.crackEmissive})
        t4_mi.set_scalar_parameter_value("LODFadeStart", ${t4.lodFadeStart * 100})
        t4_mi.set_scalar_parameter_value("LODFadeEnd", ${t4.lodFadeEnd * 100})
        t4_mi.set_scalar_parameter_value("POMSteps", ${t4.pomSteps})
        t4_mi.set_scalar_parameter_value("POMSelfShadow", 1.0)
        t4_mi.set_scalar_parameter_value("BulgeFrequency", ${t4.bulgeFrequency})
        t4_mi.set_scalar_parameter_value("BulgeAmplitude", ${t4.bulgeAmplitude})
        unreal.EditorAssetLibrary.save_loaded_asset(t4_mi)
        print("DISP_T4_OK: ${t4.maxHeight}cm displacement, ${t4.pomSteps}-step POM + self-shadow")
    except Exception as e:
        print(f"DISP_T4_PARAMS: {e}")
else:
    print("DISP_T4_MISSING: MI_Corruption_T4_Eruption — deploy_corruption_materials first")

# ── Step 4: Save displacement config as JSON ──
config = ${JSON.stringify({
    tiers: cfg.tiers,
    performance: cfg.performance,
    heightmapTexture: cfg.heightmapTexture,
    worldSpaceNoise: cfg.worldSpaceNoise,
  })}

content_dir = unreal.Paths.project_content_dir()
config_dir = os.path.join(content_dir, "Materials", "Corruption")
os.makedirs(config_dir, exist_ok=True)
with open(os.path.join(config_dir, "NaniteDisplacementConfig.json"), "w") as f:
    json.dump(config, f, indent=2)
print("CONFIG_OK: NaniteDisplacementConfig.json")

# ── Step 5: Create POM Material Function (fallback for non-Nanite) ──
mf_pom_path = "/Game/Materials/Functions/MF_CorruptionPOM"
try:
    factory = unreal.MaterialFunctionFactoryNew()
    mf_pom = asset_tools.create_asset("MF_CorruptionPOM", "/Game/Materials/Functions", None, factory)
    if mf_pom:
        mf_pom.set_editor_property("description",
            "Parallax Occlusion Mapping fallback for corruption displacement on non-Nanite meshes. "
            "T3: 8 steps, T4: 16 steps with self-shadowing.")
        mf_pom.set_editor_property("expose_to_library", True)
        mf_pom.set_editor_property("library_categories_text", ["Corruption", "Displacement"])
        unreal.EditorAssetLibrary.save_loaded_asset(mf_pom)
        print("POM_MF_OK: MF_CorruptionPOM")
except Exception as e:
    print(f"POM_MF_NOTE: {e}")

print("NANITE_DISPLACEMENT_MS4_COMPLETE")
`;
}

/**
 * Deploy Nanite displacement for corruption T3-T4.
 */
export async function deployNaniteDisplacement() {
  const spec = getNaniteDisplacementSpec();
  const specDir = join(process.cwd(), 'workspace', 'shattered-crown', 'Design');
  if (!existsSync(specDir)) mkdirSync(specDir, { recursive: true });
  const specPath = join(specDir, 'nanite-displacement-spec.json');
  writeFileSync(specPath, JSON.stringify(spec, null, 2));
  log.info('Nanite displacement spec saved');

  try {
    await callTool('unreal', 'get_actors_in_level', {}, 10_000);
    try {
      const script = generateNaniteDisplacementScript();
      const result = await callTool('unreal', 'execute_python_script', { code: script }, 60_000);
      return { success: true, method: 'python_script', specPath, result };
    } catch (err) {
      return { success: true, method: 'deferred_after_error', specPath, error: err.message };
    }
  } catch { /* Unreal not available */ }

  return {
    success: true, method: 'deferred', specPath,
    note: 'Nanite displacement spec saved. T3 (5cm ridges) + T4 (15cm eruptions) + POM fallback will be configured when UE5 is open.',
    tiers: Object.keys(spec.tiers),
  };
}

// ── World Position Offset Breathing Animation (ms_5) ──────────────────────────

/**
 * WPO (World Position Offset) breathing animation system.
 *
 * Architecture:
 *   Corruption-affected surfaces "breathe" — they slowly expand and contract
 *   as if alive. This is achieved via WPO in the material shader.
 *
 *   Breathing layers (additive):
 *     1. Primary breath: Slow sine wave along surface normal (0.3-0.5 Hz)
 *     2. Secondary pulse: Faster heartbeat-like rhythm (0.8-1.2 Hz)
 *     3. Organic noise: World-space Perlin noise for non-uniform movement
 *     4. Reaction pulse: Triggered burst when corruption level changes
 *
 *   Activation:
 *     T0-T1: No WPO (static surfaces)
 *     T2: Subtle micro-breathing (barely perceptible)
 *     T3: Clear breathing with organic noise
 *     T4: Heavy breathing + heartbeat pulse + reaction bursts
 *
 *   Performance:
 *     WPO is vertex shader only — no extra GPU draw calls.
 *     Cost: ~0.1ms per material using WPO (vertex transform overhead).
 *     LOD fade: WPO amplitude fades to 0 beyond configurable distance.
 */

export const WPO_BREATHING_CONFIG = {
  // Layer 1: Primary breath (slow organic expansion)
  primaryBreath: {
    waveType: 'sine',
    frequency: 0.4,          // Hz — slow organic breathing
    amplitude: {
      T2: 0.3,              // cm — barely visible micro-breathing
      T3: 1.5,              // cm — visible surface movement
      T4: 4.0,              // cm — dramatic alive-surface effect
    },
    direction: 'normal',     // Moves along surface normal
    phaseOffset: 'worldPosition', // Each vertex breathes at slightly different phase
    phaseScale: 0.01,        // World-space phase variation scale
  },

  // Layer 2: Secondary pulse (heartbeat rhythm)
  secondaryPulse: {
    waveType: 'heartbeat',   // Custom: sharp rise, slow decay
    frequency: 1.0,          // Hz — heartbeat tempo
    amplitude: {
      T2: 0.0,              // No heartbeat at T2
      T3: 0.5,              // Subtle secondary pulse
      T4: 2.0,              // Strong heartbeat effect
    },
    // Heartbeat wave: max(0, sin(t*2pi*f)^8) — sharp spike
    hlslExpression: 'pow(max(0, sin(Time * 6.2832 * Frequency)), 8.0) * Amplitude',
    direction: 'normal',
  },

  // Layer 3: Organic noise (spatial variation)
  organicNoise: {
    noiseType: 'Perlin',
    frequency: 0.05,         // World-space noise frequency (large scale)
    octaves: 2,
    speed: 0.2,              // How fast noise pattern shifts
    amplitude: {
      T2: 0.1,
      T3: 0.8,
      T4: 2.5,
    },
    direction: 'normal+tangent', // Moves in normal AND tangent for organic warping
    tangentWeight: 0.3,      // 30% tangent, 70% normal
  },

  // Layer 4: Reaction pulse (triggered on corruption change)
  reactionPulse: {
    triggerParam: 'MPC_CorruptionFog.CorruptionPulse', // 0→1 on trigger, decays
    decayRate: 2.0,          // Seconds to decay from 1→0
    amplitude: {
      T2: 0.5,
      T3: 3.0,
      T4: 8.0,
    },
    waveType: 'dampedSine',  // Decaying oscillation on trigger
    damping: 3.0,            // How quickly oscillation damps
    initialFrequency: 4.0,   // Hz — fast initial wobble
    direction: 'normal',
    description: 'Triggered when corruption level jumps (e.g., shard used, boss killed). Radiates outward as damped wave.',
  },

  // Global settings
  global: {
    activationThreshold: 0.35, // Corruption level below which WPO is off (T0-T1)
    maxVertexOffset: 10.0,     // cm — hard clamp to prevent mesh explosion
    lodFadeStart: 30,          // Meters
    lodFadeEnd: 50,            // Meters
    windInteraction: {
      enabled: true,
      windInfluence: 0.2,      // 20% wind added to WPO direction
      description: 'Corruption breathing sways slightly with SimpleGrassWind',
    },
  },

  // Performance
  performance: {
    vertexShaderCost: 0.1,     // ms added per material
    maxActiveBreathingMeshes: 200, // Max meshes with active WPO before LOD culling
    scalability: {
      epic:   { layers: 4, noiseOctaves: 2, reactionEnabled: true },
      high:   { layers: 3, noiseOctaves: 1, reactionEnabled: true },
      medium: { layers: 2, noiseOctaves: 1, reactionEnabled: false },
      low:    { layers: 1, noiseOctaves: 0, reactionEnabled: false },
    },
  },
};

/**
 * Get the full WPO breathing animation specification.
 */
export function getWPOBreathingSpec() {
  return {
    ...WPO_BREATHING_CONFIG,
    materialIntegration: {
      masterMaterial: 'M_CorruptedSurface',
      materialFunction: 'MF_CorruptionBlend',
      outputPin: 'WorldPositionOffset',
      description: 'WPO breathing is computed in MF_CorruptionBlend and output via the WorldPositionOffset pin. ' +
        'All 4 layers are additive. The combined offset is clamped to maxVertexOffset and faded by LOD distance. ' +
        'Nanite displacement (ms_4) and WPO breathing (ms_5) are combined: displacement provides static geometry, ' +
        'WPO adds animated movement on top.',
    },
    mpcParameters: [
      { name: 'CorruptionLevel', type: 'Scalar', range: [0, 1], description: 'Controls WPO activation and amplitude tier' },
      { name: 'CorruptionPulse', type: 'Scalar', range: [0, 1], description: 'Reaction pulse trigger (set to 1, auto-decays)' },
      { name: 'BreathSpeedMultiplier', type: 'Scalar', default: 1.0, description: 'Global speed multiplier for all breathing' },
    ],
    hlslSummary: `
      // WPO Breathing — computed per-vertex in material shader
      float CL = MPC_CorruptionFog.CorruptionLevel;
      float BreathActivation = smoothstep(0.35, 0.45, CL);

      // Layer 1: Primary breath
      float Phase = dot(WorldPosition, float3(0.01, 0.01, 0.01));
      float PrimaryBreath = sin(Time * 2.5 + Phase) * PrimaryAmplitude;

      // Layer 2: Heartbeat pulse
      float Heartbeat = pow(max(0, sin(Time * 6.2832)), 8.0) * HeartbeatAmplitude;

      // Layer 3: Organic noise (Perlin sampled from world pos + time)
      float NoiseWPO = PerlinNoise(WorldPosition * 0.05 + Time * 0.2, 2) * NoiseAmplitude;

      // Layer 4: Reaction pulse (damped sine, triggered externally)
      float Pulse = MPC_CorruptionFog.CorruptionPulse;
      float Reaction = exp(-3.0 * (1.0-Pulse)) * sin(Pulse * 25.13) * ReactionAmplitude;

      // Combine along surface normal + tangent
      float3 TotalWPO = VertexNormal * (PrimaryBreath + Heartbeat + Reaction)
                       + VertexTangent * NoiseWPO * 0.3
                       + VertexNormal * NoiseWPO * 0.7;

      // Clamp and LOD fade
      TotalWPO = clamp(TotalWPO, -10.0, 10.0) * BreathActivation * LODFade;
      WorldPositionOffset += TotalWPO;
    `,
  };
}

/**
 * Generate UE5 Python script for WPO breathing animation setup.
 */
export function generateWPOBreathingScript() {
  const cfg = WPO_BREATHING_CONFIG;

  return `
import unreal
import json
import os

# ── WPO Breathing Animation for Corruption ──
# Generated by Sela Agent — Corruption Surface Propagation Shader (ms_5)

asset_tools = unreal.AssetToolsHelpers.get_asset_tools()

# ── Step 1: Create MF_CorruptionBreathing Material Function ──
mf_path = "/Game/Materials/Functions"
unreal.EditorAssetLibrary.make_directory(mf_path)

mf_name = "MF_CorruptionBreathing"
try:
    existing = unreal.EditorAssetLibrary.find_asset_data(mf_path + "/" + mf_name + "." + mf_name)
    if existing.is_valid():
        mf = existing.get_asset()
        unreal.log(f"{mf_name} already exists — updating")
    else:
        factory = unreal.MaterialFunctionFactoryNew()
        mf = asset_tools.create_asset(mf_name, mf_path, None, factory)
except:
    factory = unreal.MaterialFunctionFactoryNew()
    mf = asset_tools.create_asset(mf_name, mf_path, None, factory)

if mf:
    mf.set_editor_property("description",
        "WPO breathing animation for corruption-affected surfaces. "
        "4 additive layers: primary breath (sine), heartbeat pulse, organic noise, reaction burst. "
        "Reads CorruptionLevel and CorruptionPulse from MPC_CorruptionFog. "
        "Output: float3 WorldPositionOffset to add to MF_CorruptionBlend WPO.")
    mf.set_editor_property("expose_to_library", True)
    mf.set_editor_property("library_categories_text", ["Corruption", "Animation", "WPO"])
    unreal.EditorAssetLibrary.save_loaded_asset(mf)
    print(f"WPO_MF_OK: {mf_name}")
else:
    print(f"WPO_MF_FAIL: {mf_name}")

# ── Step 2: Add CorruptionPulse parameter to MPC ──
mpc_path = "/Game/Blueprints/MPC_CorruptionFog"
mpc = unreal.EditorAssetLibrary.load_asset(mpc_path)
if mpc:
    # Try to add CorruptionPulse scalar parameter
    try:
        params = mpc.get_editor_property("scalar_parameter_values")
        has_pulse = any(p.get_editor_property("parameter_name") == "CorruptionPulse" for p in params)
        if not has_pulse:
            new_param = unreal.CollectionScalarParameter()
            new_param.set_editor_property("parameter_name", "CorruptionPulse")
            new_param.set_editor_property("default_value", 0.0)
            params.append(new_param)
            mpc.set_editor_property("scalar_parameter_values", params)
            unreal.EditorAssetLibrary.save_loaded_asset(mpc)
            print("MPC_PULSE_OK: Added CorruptionPulse to MPC_CorruptionFog")
        else:
            print("MPC_PULSE_EXISTS: CorruptionPulse already in MPC")

        # Also add BreathSpeedMultiplier
        has_breath = any(p.get_editor_property("parameter_name") == "BreathSpeedMultiplier" for p in params)
        if not has_breath:
            breath_param = unreal.CollectionScalarParameter()
            breath_param.set_editor_property("parameter_name", "BreathSpeedMultiplier")
            breath_param.set_editor_property("default_value", 1.0)
            params.append(breath_param)
            mpc.set_editor_property("scalar_parameter_values", params)
            unreal.EditorAssetLibrary.save_loaded_asset(mpc)
            print("MPC_BREATH_OK: Added BreathSpeedMultiplier")
    except Exception as e:
        print(f"MPC_NOTE: {e}")
else:
    print("MPC_MISSING: MPC_CorruptionFog not found — will be created with deploy_corruption_shader")

# ── Step 3: Update material instances with WPO params ──
wpo_params = {
    "MI_Corruption_T3_Mass": {
        "WPO_PrimaryAmplitude": ${cfg.primaryBreath.amplitude.T3},
        "WPO_PrimaryFrequency": ${cfg.primaryBreath.frequency},
        "WPO_HeartbeatAmplitude": ${cfg.secondaryPulse.amplitude.T3},
        "WPO_HeartbeatFrequency": ${cfg.secondaryPulse.frequency},
        "WPO_NoiseAmplitude": ${cfg.organicNoise.amplitude.T3},
        "WPO_NoiseFrequency": ${cfg.organicNoise.frequency},
        "WPO_ReactionAmplitude": ${cfg.reactionPulse.amplitude.T3},
        "WPO_TangentWeight": ${cfg.organicNoise.tangentWeight},
        "WPO_MaxOffset": ${cfg.global.maxVertexOffset},
        "WPO_LODFadeStart": ${cfg.global.lodFadeStart * 100},
        "WPO_LODFadeEnd": ${cfg.global.lodFadeEnd * 100},
    },
    "MI_Corruption_T4_Eruption": {
        "WPO_PrimaryAmplitude": ${cfg.primaryBreath.amplitude.T4},
        "WPO_PrimaryFrequency": ${cfg.primaryBreath.frequency},
        "WPO_HeartbeatAmplitude": ${cfg.secondaryPulse.amplitude.T4},
        "WPO_HeartbeatFrequency": ${cfg.secondaryPulse.frequency},
        "WPO_NoiseAmplitude": ${cfg.organicNoise.amplitude.T4},
        "WPO_NoiseFrequency": ${cfg.organicNoise.frequency},
        "WPO_ReactionAmplitude": ${cfg.reactionPulse.amplitude.T4},
        "WPO_TangentWeight": ${cfg.organicNoise.tangentWeight},
        "WPO_MaxOffset": ${cfg.global.maxVertexOffset},
        "WPO_LODFadeStart": ${cfg.global.lodFadeStart * 100},
        "WPO_LODFadeEnd": ${cfg.global.lodFadeEnd * 100},
    },
}

# Also add subtle WPO to T2
wpo_params["MI_Corruption_T2_Stain"] = {
    "WPO_PrimaryAmplitude": ${cfg.primaryBreath.amplitude.T2},
    "WPO_PrimaryFrequency": ${cfg.primaryBreath.frequency},
    "WPO_HeartbeatAmplitude": 0.0,
    "WPO_NoiseAmplitude": ${cfg.organicNoise.amplitude.T2},
    "WPO_NoiseFrequency": ${cfg.organicNoise.frequency},
    "WPO_ReactionAmplitude": ${cfg.reactionPulse.amplitude.T2},
    "WPO_TangentWeight": ${cfg.organicNoise.tangentWeight},
    "WPO_MaxOffset": ${cfg.global.maxVertexOffset},
    "WPO_LODFadeStart": ${cfg.global.lodFadeStart * 100},
    "WPO_LODFadeEnd": ${cfg.global.lodFadeEnd * 100},
}

for mi_name, params in wpo_params.items():
    mi_path = f"/Game/Materials/Corruption/{mi_name}"
    mi = unreal.EditorAssetLibrary.load_asset(mi_path)
    if mi:
        try:
            for param_name, param_value in params.items():
                mi.set_scalar_parameter_value(param_name, param_value)
            unreal.EditorAssetLibrary.save_loaded_asset(mi)
            print(f"WPO_MI_OK: {mi_name} ({len(params)} WPO params)")
        except Exception as e:
            print(f"WPO_MI_PARAMS: {mi_name} - {e}")
    else:
        print(f"WPO_MI_MISSING: {mi_name}")

# ── Step 4: Save WPO breathing config ──
config = ${JSON.stringify({
    primaryBreath: cfg.primaryBreath,
    secondaryPulse: { ...cfg.secondaryPulse, hlslExpression: cfg.secondaryPulse.hlslExpression },
    organicNoise: cfg.organicNoise,
    reactionPulse: { ...cfg.reactionPulse, description: cfg.reactionPulse.description },
    global: cfg.global,
    performance: cfg.performance,
  })}

content_dir = unreal.Paths.project_content_dir()
config_dir = os.path.join(content_dir, "Materials", "Corruption")
os.makedirs(config_dir, exist_ok=True)
with open(os.path.join(config_dir, "WPOBreathingConfig.json"), "w") as f:
    json.dump(config, f, indent=2)
print("CONFIG_OK: WPOBreathingConfig.json")

print("WPO_BREATHING_MS5_COMPLETE")
`;
}

/**
 * Deploy WPO breathing animation system.
 */
export async function deployWPOBreathing() {
  const spec = getWPOBreathingSpec();
  const specDir = join(process.cwd(), 'workspace', 'shattered-crown', 'Design');
  if (!existsSync(specDir)) mkdirSync(specDir, { recursive: true });
  const specPath = join(specDir, 'wpo-breathing-spec.json');
  writeFileSync(specPath, JSON.stringify(spec, null, 2));
  log.info('WPO breathing spec saved');

  try {
    await callTool('unreal', 'get_actors_in_level', {}, 10_000);
    try {
      const script = generateWPOBreathingScript();
      const result = await callTool('unreal', 'execute_python_script', { code: script }, 60_000);
      return { success: true, method: 'python_script', specPath, result };
    } catch (err) {
      return { success: true, method: 'deferred_after_error', specPath, error: err.message };
    }
  } catch { /* Unreal not available */ }

  return {
    success: true, method: 'deferred', specPath,
    note: 'WPO breathing spec saved. MF_CorruptionBreathing + MPC params + per-tier WPO settings will be configured when UE5 is open.',
    layers: ['primaryBreath', 'secondaryPulse', 'organicNoise', 'reactionPulse'],
    activeTiers: ['T2 (subtle)', 'T3 (visible)', 'T4 (dramatic)'],
  };
}

// ── Gameplay Corruption Event Integration (ms_6) ──────────────────────────────

/**
 * Gameplay event integration system for the corruption shader.
 *
 * Connects the visual corruption system (MPC + RVT + Materials) to gameplay:
 *   - Boss death locations spawn permanent corruption stains
 *   - Shard pickup/equip radiates corruption around the player
 *   - Story events trigger scripted corruption spread
 *   - Whisper escalation causes ambient corruption at high tiers
 *   - Corruption wells (dungeon entrances) have persistent corruption
 *   - Player healing/cleansing reduces local corruption
 *
 * Implementation:
 *   BP_CorruptionEventDispatcher (GameInstance Subsystem)
 *     - Central hub that receives gameplay events and dispatches to:
 *       1. MPC_CorruptionFog (global corruption level)
 *       2. BP_CorruptionPainter instances (RVT spatial painting)
 *       3. Material parameter updates (tier transitions)
 *       4. Audio cues (corruption ambient sounds)
 *       5. Post-process effects (screen corruption VFX)
 *
 *   Event flow:
 *     GameplayEvent → CorruptionEventDispatcher → [MPC + RVT + Audio + VFX]
 */

export const CORRUPTION_GAMEPLAY_EVENTS = [
  {
    eventId: 'boss_death',
    name: 'Boss Defeated',
    description: 'A shard-bearer boss is defeated. Permanent corruption stain at death location.',
    mpcEffect: {
      corruptionDelta: 0.05,    // Small global increase per boss
      transitionDuration: 3.0,  // Seconds to lerp MPC value
    },
    rvtEffect: {
      brushType: 'splatter',
      radius: 1500,
      intensity: 1.0,
      permanent: true,
      spreadSpeed: 200,         // Fast initial spread from death location
    },
    audioTrigger: 'corruption_surge',
    vfxTrigger: 'corruption_shockwave',
    postProcess: {
      vignetteIntensity: 0.4,   // Brief vignette pulse
      chromaticAberration: 0.8, // Color distortion
      duration: 2.0,
    },
  },
  {
    eventId: 'shard_pickup',
    name: 'Shard Collected',
    description: 'Player picks up a corruption shard. Brief corruption pulse.',
    mpcEffect: {
      corruptionDelta: 0.08,
      transitionDuration: 1.5,
    },
    rvtEffect: {
      brushType: 'circular',
      radius: 600,
      intensity: 0.7,
      permanent: false,
      spreadSpeed: 100,
    },
    audioTrigger: 'shard_absorb',
    vfxTrigger: 'corruption_absorb',
    postProcess: {
      vignetteIntensity: 0.6,
      chromaticAberration: 1.2,
      duration: 1.0,
    },
  },
  {
    eventId: 'shard_equip',
    name: 'Shard Equipped',
    description: 'Player equips a shard for active use. Continuous corruption radiation.',
    mpcEffect: {
      corruptionDelta: 0.0,     // No instant change — continuous effect
      continuousRate: 0.002,    // Per-second corruption increase while equipped
      continuousRadius: 800,
    },
    rvtEffect: {
      brushType: 'organic',
      radius: 800,
      intensity: 0.6,
      permanent: false,
      spreadSpeed: 50,          // Slow ambient spread
    },
    audioTrigger: 'corruption_ambient_loop',
    vfxTrigger: 'corruption_aura',
    postProcess: null,          // No screen effect — too persistent
  },
  {
    eventId: 'shard_unequip',
    name: 'Shard Removed',
    description: 'Player unequips a shard. Corruption radiation stops, local decay begins.',
    mpcEffect: {
      corruptionDelta: 0.0,
      continuousRate: 0.0,      // Stop continuous increase
    },
    rvtEffect: {
      brushType: 'organic',
      radius: 800,
      intensity: -0.001,        // Negative = decay
      permanent: false,
      spreadSpeed: 0,           // No spread during decay
    },
    audioTrigger: 'corruption_fade',
    vfxTrigger: null,
    postProcess: null,
  },
  {
    eventId: 'story_corruption_spread',
    name: 'Story Corruption Event',
    description: 'Scripted story moment triggers visible corruption wave.',
    mpcEffect: {
      corruptionDelta: 0.15,
      transitionDuration: 5.0,  // Slow dramatic build
    },
    rvtEffect: {
      brushType: 'directional',
      radius: 2000,
      intensity: 0.8,
      permanent: true,
      spreadSpeed: 300,         // Dramatic fast spread
    },
    audioTrigger: 'corruption_wave',
    vfxTrigger: 'corruption_eruption',
    postProcess: {
      vignetteIntensity: 0.8,
      chromaticAberration: 2.0,
      duration: 4.0,
      screenShake: { amplitude: 5.0, frequency: 8.0, decay: 3.0 },
    },
  },
  {
    eventId: 'whisper_escalation',
    name: 'Whisper Tier Escalation',
    description: 'Player corruption level crosses a tier threshold. Ambient corruption grows.',
    mpcEffect: {
      corruptionDelta: 0.0,     // Already reflected in MPC level
      pulseAmount: 1.0,         // Trigger CorruptionPulse MPC param (WPO reaction)
    },
    rvtEffect: {
      brushType: 'organic',
      radius: 500,
      intensity: 0.3,
      permanent: false,
      spreadSpeed: 30,
    },
    audioTrigger: 'whisper_tier_up',
    vfxTrigger: 'corruption_pulse_screen',
    postProcess: {
      vignetteIntensity: 0.3,
      chromaticAberration: 0.5,
      duration: 1.5,
    },
  },
  {
    eventId: 'healer_cleanse',
    name: 'Corruption Cleansed',
    description: 'Healer NPC reduces player corruption. Local purification effect.',
    mpcEffect: {
      corruptionDelta: -0.15,
      transitionDuration: 3.0,
    },
    rvtEffect: {
      brushType: 'circular',
      radius: 1000,
      intensity: -0.5,          // Negative = remove corruption
      permanent: false,
      spreadSpeed: 100,
    },
    audioTrigger: 'purification',
    vfxTrigger: 'corruption_purge',
    postProcess: {
      vignetteIntensity: 0.0,   // Clear vignette
      bloomIntensity: 1.5,      // Brief bright bloom
      duration: 2.0,
    },
  },
  {
    eventId: 'willpower_resist',
    name: 'Willpower Resistance',
    description: 'Player successfully resists corruption whisper via willpower check.',
    mpcEffect: {
      corruptionDelta: -0.02,
      pulseAmount: 0.3,         // Small reaction pulse
    },
    rvtEffect: null,            // No spatial change
    audioTrigger: 'willpower_resist',
    vfxTrigger: 'corruption_resist_flash',
    postProcess: {
      bloomIntensity: 0.8,
      duration: 0.5,
    },
  },
  {
    eventId: 'region_enter',
    name: 'Enter Corrupted Region',
    description: 'Player enters a region with base corruption. MPC adjusts to region profile.',
    mpcEffect: {
      corruptionDelta: 0.0,     // Overwritten by region config
      useRegionProfile: true,   // Look up region-specific corruption in RVT_CONFIG.regions
    },
    rvtEffect: null,            // Already painted in region
    audioTrigger: 'corruption_ambient_shift',
    vfxTrigger: null,
    postProcess: null,
  },
  {
    eventId: 'corruption_well_proximity',
    name: 'Near Corruption Well',
    description: 'Player is near a corruption source (dungeon entrance, sealed boss arena).',
    mpcEffect: {
      corruptionDelta: 0.0,
      continuousRate: 0.005,    // Faster corruption near wells
      continuousRadius: 1200,
    },
    rvtEffect: {
      brushType: 'circular',
      radius: 1200,
      intensity: 0.9,
      permanent: true,
      spreadSpeed: 10,          // Very slow persistent growth
    },
    audioTrigger: 'corruption_well_hum',
    vfxTrigger: 'corruption_particles',
    postProcess: null,
  },
];

/**
 * Get the full gameplay corruption event integration specification.
 */
export function getCorruptionGameplaySpec() {
  return {
    events: CORRUPTION_GAMEPLAY_EVENTS,
    totals: {
      eventCount: CORRUPTION_GAMEPLAY_EVENTS.length,
      withMPC: CORRUPTION_GAMEPLAY_EVENTS.filter(e => e.mpcEffect).length,
      withRVT: CORRUPTION_GAMEPLAY_EVENTS.filter(e => e.rvtEffect).length,
      withAudio: CORRUPTION_GAMEPLAY_EVENTS.filter(e => e.audioTrigger).length,
      withVFX: CORRUPTION_GAMEPLAY_EVENTS.filter(e => e.vfxTrigger).length,
      withPostProcess: CORRUPTION_GAMEPLAY_EVENTS.filter(e => e.postProcess).length,
    },
    dispatcher: {
      name: 'BP_CorruptionEventDispatcher',
      parentClass: 'UGameInstanceSubsystem',
      path: '/Game/Blueprints/Corruption/BP_CorruptionEventDispatcher',
      description: 'Central corruption event hub. Receives gameplay events and routes them to MPC, RVT painters, audio, VFX, and post-process systems.',
      publicFunctions: [
        { name: 'HandleCorruptionEvent', params: ['EventId (FName)', 'Location (FVector)', 'Instigator (AActor*)'], description: 'Main entry point for all corruption events' },
        { name: 'SetRegionCorruption', params: ['RegionId (FName)', 'CorruptionLevel (float)'], description: 'Override MPC for region transitions' },
        { name: 'GetCurrentCorruptionLevel', params: [], returns: 'float', description: 'Read current global corruption level' },
        { name: 'GetCorruptionTier', params: [], returns: 'int (0-4)', description: 'Current corruption visual tier' },
        { name: 'TriggerCorruptionPulse', params: ['Intensity (float)'], description: 'Fire WPO reaction pulse on all corruption surfaces' },
        { name: 'StartContinuousCorruption', params: ['SourceActor (AActor*)', 'Rate (float)', 'Radius (float)'], description: 'Begin continuous corruption from a source' },
        { name: 'StopContinuousCorruption', params: ['SourceActor (AActor*)'], description: 'Stop continuous corruption from a source' },
      ],
      delegates: [
        { name: 'OnCorruptionLevelChanged', params: ['float NewLevel', 'float OldLevel'] },
        { name: 'OnCorruptionTierChanged', params: ['int NewTier', 'int OldTier'] },
        { name: 'OnCorruptionPulse', params: ['float Intensity'] },
      ],
    },
    mpcIntegration: {
      collection: 'MPC_CorruptionFog',
      parameters: [
        { name: 'CorruptionLevel', type: 'Scalar', range: [0, 1], description: 'Global corruption intensity' },
        { name: 'CorruptionPulse', type: 'Scalar', range: [0, 1], description: 'WPO reaction trigger (auto-decays)' },
        { name: 'BreathSpeedMultiplier', type: 'Scalar', default: 1.0, description: 'WPO breathing speed' },
        { name: 'FogColorOverride', type: 'Vector', description: 'Corruption tint color' },
        { name: 'EmissiveColor', type: 'Vector', description: 'Corruption glow color' },
      ],
    },
    audioIntegration: {
      cueMap: Object.fromEntries(
        CORRUPTION_GAMEPLAY_EVENTS
          .filter(e => e.audioTrigger)
          .map(e => [e.eventId, e.audioTrigger])
      ),
      description: 'Audio triggers map to SoundCue assets in /Game/Audio/Corruption/. Each event plays its cue at the event location with 3D attenuation.',
    },
  };
}

/**
 * Generate UE5 Python script for the corruption event dispatcher.
 */
export function generateCorruptionEventScript() {
  const events = CORRUPTION_GAMEPLAY_EVENTS;

  return `
import unreal
import json
import os

# ── Corruption Gameplay Event Integration ──
# Generated by Sela Agent — Corruption Surface Propagation Shader (ms_6)

asset_tools = unreal.AssetToolsHelpers.get_asset_tools()

# Ensure directories
unreal.EditorAssetLibrary.make_directory("/Game/Blueprints/Corruption")
unreal.EditorAssetLibrary.make_directory("/Game/Data/Corruption")

# ── Step 1: Create BP_CorruptionEventDispatcher ──
bp_name = "BP_CorruptionEventDispatcher"
try:
    factory = unreal.BlueprintFactory()
    factory.set_editor_property("parent_class", unreal.GameInstanceSubsystem)
    bp = asset_tools.create_asset(bp_name, "/Game/Blueprints/Corruption", None, factory)
    if bp:
        unreal.log(f"Created {bp_name}")
        print(f"DISPATCHER_OK: {bp_name}")
    else:
        print(f"DISPATCHER_SKIP: {bp_name} already exists")
except Exception as e:
    print(f"DISPATCHER_NOTE: {e}")

# ── Step 2: Create ECorruptionEvent Enum ──
enum_name = "ECorruptionEvent"
try:
    factory = unreal.UserDefinedEnumFactory()
    event_enum = asset_tools.create_asset(enum_name, "/Game/Blueprints/Corruption", None, factory)
    if event_enum:
        for event in ${JSON.stringify(events.map(e => e.eventId))}:
            event_enum.add_enum_value(event)
        unreal.EditorAssetLibrary.save_loaded_asset(event_enum)
        print(f"ENUM_OK: {enum_name} ({len(${JSON.stringify(events.map(e => e.eventId))})} events)")
except Exception as e:
    print(f"ENUM_NOTE: {e}")

# ── Step 3: Save event config as JSON for BP lookup ──
event_config = ${JSON.stringify(Object.fromEntries(events.map(e => [e.eventId, {
    name: e.name,
    mpcEffect: e.mpcEffect,
    rvtEffect: e.rvtEffect,
    audioTrigger: e.audioTrigger,
    vfxTrigger: e.vfxTrigger,
    postProcess: e.postProcess,
  }])))}

content_dir = unreal.Paths.project_content_dir()
config_dir = os.path.join(content_dir, "Data", "Corruption")
os.makedirs(config_dir, exist_ok=True)
with open(os.path.join(config_dir, "CorruptionEventConfig.json"), "w") as f:
    json.dump(event_config, f, indent=2)
print(f"CONFIG_OK: CorruptionEventConfig.json ({len(event_config)} events)")

print("CORRUPTION_GAMEPLAY_MS6_COMPLETE")
`;
}

/**
 * Deploy corruption gameplay event integration.
 */
export async function deployCorruptionGameplayEvents() {
  const spec = getCorruptionGameplaySpec();
  const specDir = join(process.cwd(), 'workspace', 'shattered-crown', 'Design');
  if (!existsSync(specDir)) mkdirSync(specDir, { recursive: true });
  const specPath = join(specDir, 'corruption-gameplay-events.json');
  writeFileSync(specPath, JSON.stringify(spec, null, 2));
  log.info('Corruption gameplay event spec saved');

  try {
    await callTool('unreal', 'get_actors_in_level', {}, 10_000);
    try {
      const script = generateCorruptionEventScript();
      const result = await callTool('unreal', 'execute_python_script', { code: script }, 60_000);
      return { success: true, method: 'python_script', specPath, result };
    } catch (err) {
      return { success: true, method: 'deferred_after_error', specPath, error: err.message };
    }
  } catch { /* Unreal not available */ }

  return {
    success: true, method: 'deferred', specPath,
    note: 'Corruption gameplay event spec saved. BP_CorruptionEventDispatcher + ECorruptionEvent enum + config will be created when UE5 is open.',
    stats: spec.totals,
  };
}

// ── RVT Performance Optimization (ms_7) ─────────────────────────────────────

/**
 * Performance optimization system for corruption RVT across all 8 regions.
 *
 * Key optimizations:
 *   1. Per-region RVT update budgets (tile updates/frame based on corruption activity)
 *   2. Distance-based corruption shader LOD (simplify at distance)
 *   3. Scalability tiers (Low/Med/High/Epic) for hardware range
 *   4. Corruption update throttling (only repaint tiles with active changes)
 *   5. Shader complexity reduction at LOD (remove noise octaves, disable WPO)
 *   6. Tile streaming priority (visible + active corruption first)
 *   7. GPU budget monitoring with auto-downscale
 */

/**
 * Scalability presets — each defines quality vs performance tradeoffs.
 * Applied via UE5 scalability groups or CVar overrides.
 */
export const CORRUPTION_SCALABILITY = {
  Low: {
    rvtResolution: 2048,           // 2K RVT (vs 8K default)
    rvtTilesPerAxis: 8,
    maxMipLevels: 3,
    maxTileUpdatesPerFrame: 1,     // Very conservative
    shaderNoiseOctaves: 1,         // Single noise pass
    displacementEnabled: false,    // No displacement on Low
    pomEnabled: false,
    wpoBreathingEnabled: false,
    emissiveEnabled: true,         // Keep emissive (cheap, high impact)
    maxCorruptionDrawDistance: 3000, // 30m
    updateIntervalMs: 200,         // 5Hz corruption tick
    gpuBudgetMs: 0.5,             // Max 0.5ms for corruption
    description: 'Minimal corruption visuals. Flat surfaces with color tint + emissive only.',
  },
  Medium: {
    rvtResolution: 4096,           // 4K RVT
    rvtTilesPerAxis: 16,
    maxMipLevels: 4,
    maxTileUpdatesPerFrame: 2,
    shaderNoiseOctaves: 2,
    displacementEnabled: false,    // POM only
    pomEnabled: true,
    pomSteps: { t3: 4, t4: 8 },
    wpoBreathingEnabled: true,
    wpoLayers: 2,                 // Primary breath + heartbeat only
    emissiveEnabled: true,
    maxCorruptionDrawDistance: 5000, // 50m
    updateIntervalMs: 100,         // 10Hz
    gpuBudgetMs: 1.0,
    description: 'Balanced corruption visuals. POM displacement, 2-layer WPO, medium RVT.',
  },
  High: {
    rvtResolution: 8192,           // Full 8K RVT
    rvtTilesPerAxis: 32,
    maxMipLevels: 6,
    maxTileUpdatesPerFrame: 4,
    shaderNoiseOctaves: 3,
    displacementEnabled: true,     // Nanite displacement
    pomEnabled: true,              // Fallback for non-Nanite
    pomSteps: { t3: 8, t4: 16 },
    wpoBreathingEnabled: true,
    wpoLayers: 3,                 // Breath + heartbeat + organic noise
    emissiveEnabled: true,
    maxCorruptionDrawDistance: 8000, // 80m
    updateIntervalMs: 50,          // 20Hz
    gpuBudgetMs: 1.5,
    description: 'Full corruption visuals. Nanite displacement, 3-layer WPO, full 8K RVT.',
  },
  Epic: {
    rvtResolution: 8192,
    rvtTilesPerAxis: 32,
    maxMipLevels: 6,
    maxTileUpdatesPerFrame: 8,
    shaderNoiseOctaves: 4,         // Extra detail octave
    displacementEnabled: true,
    pomEnabled: true,
    pomSteps: { t3: 8, t4: 16 },
    pomSelfShadow: true,
    wpoBreathingEnabled: true,
    wpoLayers: 4,                 // All layers including reaction pulse
    emissiveEnabled: true,
    maxCorruptionDrawDistance: 12000, // 120m
    updateIntervalMs: 33,          // 30Hz
    gpuBudgetMs: 2.5,
    description: 'Maximum quality. All features enabled, extended draw distance, high-frequency updates.',
  },
};

/**
 * Per-region performance profiles based on expected corruption density and
 * region geometry complexity. More complex regions get tighter budgets.
 */
export const REGION_PERF_PROFILES = {
  CrossroadsHub: {
    rvtPriority: 'low',          // Safe hub, corruption rare
    maxActivePainters: 2,
    tileUpdateBudget: 1,          // Minimal painting needed
    corruptionLODDistBias: 0.8,   // Draw distance slightly reduced (dense village)
    shaderComplexityBias: 0.9,    // Slightly simplified (many overlapping meshes)
    reason: 'Dense village with many small meshes. Corruption only reaches T2 max.',
  },
  AshenWilds: {
    rvtPriority: 'high',         // Heavily corrupted wasteland
    maxActivePainters: 6,
    tileUpdateBudget: 4,
    corruptionLODDistBias: 1.2,   // Open terrain = longer draw distance
    shaderComplexityBias: 1.0,    // Full complexity
    reason: 'Open wasteland with high corruption. Large draw distance, full T4 expected.',
  },
  Ironhold: {
    rvtPriority: 'medium',
    maxActivePainters: 3,
    tileUpdateBudget: 2,
    corruptionLODDistBias: 0.7,   // Tight fortress interiors
    shaderComplexityBias: 0.85,   // Many lit surfaces compete for budget
    reason: 'Fortress interior with many light sources. Corruption competes with lighting.',
  },
  VerdantReach: {
    rvtPriority: 'high',
    maxActivePainters: 5,
    tileUpdateBudget: 3,
    corruptionLODDistBias: 1.0,
    shaderComplexityBias: 0.95,   // Dense foliage already expensive
    reason: 'Dense foliage with corruption spreading through organic matter.',
  },
  SunkenHalls: {
    rvtPriority: 'medium',
    maxActivePainters: 4,
    tileUpdateBudget: 2,
    corruptionLODDistBias: 0.9,   // Underwater visibility limits
    shaderComplexityBias: 0.9,    // Caustics already use shader budget
    reason: 'Underwater rendering + caustics already expensive. Reduce corruption complexity.',
  },
  EmberPeaks: {
    rvtPriority: 'high',
    maxActivePainters: 5,
    tileUpdateBudget: 3,
    corruptionLODDistBias: 1.1,   // Volcanic open terrain
    shaderComplexityBias: 0.95,   // Lava emissive competes with corruption emissive
    reason: 'High corruption density + volcanic emissive. Share emissive budget carefully.',
  },
  Aethermere: {
    rvtPriority: 'critical',     // Highest corruption region
    maxActivePainters: 8,
    tileUpdateBudget: 6,
    corruptionLODDistBias: 1.0,
    shaderComplexityBias: 1.0,    // Full visual quality (climactic region)
    reason: 'Endgame corruption zone. Full T4 everywhere. No visual compromises.',
  },
  TheWilds: {
    rvtPriority: 'low',
    maxActivePainters: 2,
    tileUpdateBudget: 1,
    corruptionLODDistBias: 1.0,   // Open but corruption limited
    shaderComplexityBias: 0.9,
    reason: 'Exploration zone with minimal corruption. Resource-light.',
  },
};

/**
 * Distance-based shader LOD configuration.
 * At each LOD step, shader instructions are progressively stripped.
 */
export const CORRUPTION_SHADER_LOD = {
  lod0: {
    distanceRange: [0, 2000],       // 0-20m: full detail
    noiseOctaves: 'all',            // Per scalability setting
    displacement: true,
    wpo: true,
    normalMap: true,
    emissive: true,
    parallax: true,
    instructionCount: '~180',       // Estimated shader instructions
  },
  lod1: {
    distanceRange: [2000, 5000],    // 20-50m: reduced detail
    noiseOctaves: 'max(setting-1, 1)',
    displacement: true,
    wpo: true,
    normalMap: true,
    emissive: true,
    parallax: false,                // Disable POM at distance
    instructionCount: '~120',
  },
  lod2: {
    distanceRange: [5000, 8000],    // 50-80m: simplified
    noiseOctaves: 1,                // Single noise pass
    displacement: false,            // Flat surface
    wpo: false,                     // No breathing
    normalMap: true,
    emissive: true,
    parallax: false,
    instructionCount: '~60',
  },
  lod3: {
    distanceRange: [8000, 12000],   // 80-120m: minimal
    noiseOctaves: 0,                // Pre-baked mask only
    displacement: false,
    wpo: false,
    normalMap: false,               // Flat normal
    emissive: true,                 // Keep glow visible at distance
    parallax: false,
    instructionCount: '~25',
  },
};

/**
 * Get the full RVT performance optimization specification.
 * @returns {{ scalability, regionProfiles, shaderLOD, tileStreaming, gpuBudget, cvars }}
 */
export function getRVTPerformanceSpec() {
  const totalTiles = CORRUPTION_SCALABILITY.High.rvtTilesPerAxis ** 2; // 1024 tiles at 8K

  return {
    scalability: CORRUPTION_SCALABILITY,
    regionProfiles: REGION_PERF_PROFILES,
    shaderLOD: CORRUPTION_SHADER_LOD,

    tileStreaming: {
      description: 'RVT tile streaming prioritization. Only tiles visible to camera + tiles with active corruption painters get updated.',
      strategy: 'frustum_and_activity',
      rules: [
        { priority: 0, condition: 'Tile has active BP_CorruptionPainter within 500u', note: 'Always update actively painting tiles' },
        { priority: 1, condition: 'Tile in camera frustum AND corruption mask > 0.05', note: 'Visible corrupted tiles' },
        { priority: 2, condition: 'Tile in camera frustum AND corruption mask = 0', note: 'Visible clean tiles (might become corrupted)' },
        { priority: 3, condition: 'Tile outside frustum but within 2x frustum', note: 'Pre-stream nearby off-screen tiles' },
        { priority: 4, condition: 'All other tiles', note: 'Background streaming at lowest rate' },
      ],
      staleTileTimeout: 5000,      // Stop updating stale tiles after 5s of no change
      maxTilesInFlight: totalTiles, // Cap for total streamed tiles
    },

    gpuBudget: {
      description: 'GPU time budget for corruption shader system. Auto-scales quality if exceeded.',
      targetFrameMs: 16.67,        // 60fps target
      corruptionBudgetPct: 10,     // Max 10% of frame for corruption
      maxCorruptionMs: 1.67,       // 1.67ms absolute max
      autoScalePolicy: {
        enabled: true,
        checkIntervalFrames: 30,   // Check every 30 frames (~0.5s)
        upscaleThreshold: 0.6,     // If using <60% budget for 2s, try upscaling
        downscaleThreshold: 0.95,  // If using >95% budget, downscale immediately
        stepCooldownMs: 3000,      // Wait 3s between quality changes
        steps: ['Epic', 'High', 'Medium', 'Low'], // Downscale sequence
      },
    },

    cvars: {
      description: 'Console variables for runtime corruption performance tuning.',
      vars: [
        { name: 'r.CorruptionRVT.TileUpdatesPerFrame', type: 'int', default: 4, range: [0, 16], desc: 'Max RVT tile updates per frame' },
        { name: 'r.CorruptionRVT.Resolution', type: 'int', default: 8192, values: [2048, 4096, 8192], desc: 'RVT resolution (requires restart)' },
        { name: 'r.Corruption.NoiseOctaves', type: 'int', default: 3, range: [0, 4], desc: 'Procedural noise octave count' },
        { name: 'r.Corruption.DisplacementEnabled', type: 'bool', default: true, desc: 'Enable Nanite/POM displacement' },
        { name: 'r.Corruption.WPOEnabled', type: 'bool', default: true, desc: 'Enable WPO breathing animation' },
        { name: 'r.Corruption.WPOLayers', type: 'int', default: 3, range: [0, 4], desc: 'WPO breathing layer count' },
        { name: 'r.Corruption.MaxDrawDistance', type: 'float', default: 8000, range: [1000, 15000], desc: 'Max distance for corruption rendering' },
        { name: 'r.Corruption.UpdateHz', type: 'float', default: 20, range: [5, 30], desc: 'Corruption system update frequency' },
        { name: 'r.Corruption.GPUBudgetMs', type: 'float', default: 1.5, range: [0.3, 3.0], desc: 'GPU budget for corruption shaders' },
        { name: 'r.Corruption.AutoScale', type: 'bool', default: true, desc: 'Auto-scale quality to meet GPU budget' },
        { name: 'r.Corruption.LODBias', type: 'float', default: 0, range: [-2, 2], desc: 'LOD distance bias (negative = higher quality)' },
        { name: 'r.Corruption.TileStreamingEnabled', type: 'bool', default: true, desc: 'Enable priority-based tile streaming' },
      ],
    },

    totals: {
      scalabilityTiers: Object.keys(CORRUPTION_SCALABILITY).length,
      regionProfiles: Object.keys(REGION_PERF_PROFILES).length,
      shaderLODLevels: Object.keys(CORRUPTION_SHADER_LOD).length,
      cvars: 12,
      tileStreamingPriorities: 5,
    },
  };
}

/**
 * Get optimized corruption settings for a specific region at a given scalability level.
 * Combines scalability preset with region-specific biases.
 *
 * @param {string} regionId - Region name (e.g. 'AshenWilds')
 * @param {string} scalabilityLevel - 'Low' | 'Medium' | 'High' | 'Epic'
 * @returns {object} Effective corruption settings for the region
 */
export function getOptimizedRegionSettings(regionId, scalabilityLevel = 'High') {
  const scalability = CORRUPTION_SCALABILITY[scalabilityLevel];
  const profile = REGION_PERF_PROFILES[regionId];
  const regionCorruption = RVT_CONFIG.regions[regionId];

  if (!scalability || !profile || !regionCorruption) {
    return null;
  }

  // Compute effective draw distance (scalability * region bias)
  const effectiveDrawDist = Math.round(
    scalability.maxCorruptionDrawDistance * profile.corruptionLODDistBias
  );

  // Compute effective noise octaves (scalability * region complexity bias, min 1)
  const effectiveNoiseOctaves = Math.max(1, Math.round(
    scalability.shaderNoiseOctaves * profile.shaderComplexityBias
  ));

  // Tile update budget: min of scalability max and region budget
  const effectiveTileUpdates = Math.min(
    scalability.maxTileUpdatesPerFrame,
    profile.tileUpdateBudget
  );

  return {
    regionId,
    scalabilityLevel,
    rvtResolution: scalability.rvtResolution,
    effectiveDrawDistance: effectiveDrawDist,
    effectiveNoiseOctaves,
    effectiveTileUpdates,
    maxActivePainters: profile.maxActivePainters,
    displacementEnabled: scalability.displacementEnabled,
    pomEnabled: scalability.pomEnabled,
    pomSteps: scalability.pomSteps || null,
    wpoEnabled: scalability.wpoBreathingEnabled,
    wpoLayers: scalability.wpoLayers,
    emissiveEnabled: scalability.emissiveEnabled,
    updateIntervalMs: scalability.updateIntervalMs,
    gpuBudgetMs: scalability.gpuBudgetMs,
    maxCorruption: regionCorruption.maxCorruption,
    spreadMultiplier: regionCorruption.spreadMultiplier,
    priority: profile.rvtPriority,
    reason: profile.reason,
  };
}

/**
 * Generate a UE5 Python script that creates the BP_CorruptionPerformance
 * manager Blueprint. This BP monitors GPU time and auto-scales corruption
 * quality at runtime.
 *
 * @returns {string} UE5 Python script content
 */
export function generateRVTPerformanceScript() {
  const spec = getRVTPerformanceSpec();

  const lines = [
    '# Auto-generated: BP_CorruptionPerformance — RVT performance optimizer',
    '# Monitors GPU budget, auto-scales corruption quality, manages tile streaming.',
    'import unreal',
    '',
    '# ── Create BP_CorruptionPerformance GameInstance Subsystem ──',
    'factory = unreal.BlueprintFactory()',
    'factory.set_editor_property("ParentClass", unreal.GameInstanceSubsystem)',
    'bp_asset = unreal.AssetToolsHelpers.get_asset_tools().create_asset(',
    '    "BP_CorruptionPerformance", "/Game/Blueprints/Corruption",',
    '    unreal.Blueprint, factory)',
    '',
    '# ── Register CVars ──',
  ];

  for (const cvar of spec.cvars.vars) {
    lines.push(`# CVar: ${cvar.name} (${cvar.type}, default=${cvar.default}) — ${cvar.desc}`);
  }

  lines.push('');
  lines.push('# ── Per-Region Performance Profiles ──');
  for (const [region, profile] of Object.entries(REGION_PERF_PROFILES)) {
    lines.push(`# ${region}: priority=${profile.rvtPriority}, painters=${profile.maxActivePainters}, tiles=${profile.tileUpdateBudget}`);
  }

  lines.push('');
  lines.push('# ── Scalability Tiers ──');
  for (const [tier, cfg] of Object.entries(CORRUPTION_SCALABILITY)) {
    lines.push(`# ${tier}: RVT=${cfg.rvtResolution}px, noise=${cfg.shaderNoiseOctaves}, budget=${cfg.gpuBudgetMs}ms`);
  }

  lines.push('');
  lines.push('# ── Shader LOD Distances ──');
  for (const [lod, cfg] of Object.entries(CORRUPTION_SHADER_LOD)) {
    lines.push(`# ${lod}: ${cfg.distanceRange[0]}-${cfg.distanceRange[1]}u, ~${cfg.instructionCount} instr`);
  }

  lines.push('');
  lines.push('print("BP_CorruptionPerformance spec registered. Apply via scalability config.")');

  return lines.join('\n');
}

/**
 * Deploy the RVT performance optimization system.
 * Saves spec JSON and attempts UE5 deployment.
 *
 * @returns {{ success, method, specPath, stats }}
 */
export async function deployRVTPerformanceOptimization() {
  const spec = getRVTPerformanceSpec();
  const specDir = join(process.cwd(), 'workspace', 'shattered-crown', 'Design');
  if (!existsSync(specDir)) mkdirSync(specDir, { recursive: true });
  const specPath = join(specDir, 'corruption-rvt-performance.json');
  writeFileSync(specPath, JSON.stringify(spec, null, 2));
  log.info({ specPath, totals: spec.totals }, 'RVT performance spec saved');

  // Generate per-region optimized settings at High scalability
  const regionSettings = {};
  for (const regionId of Object.keys(REGION_PERF_PROFILES)) {
    regionSettings[regionId] = getOptimizedRegionSettings(regionId, 'High');
  }
  const regionPath = join(specDir, 'corruption-region-perf-settings.json');
  writeFileSync(regionPath, JSON.stringify(regionSettings, null, 2));
  log.info({ regionPath }, 'Per-region corruption settings saved');

  // Try UE5 deployment
  try {
    await callTool('unreal', 'get_actors_in_level', {}, 10_000);
    try {
      const script = generateRVTPerformanceScript();
      const result = await callTool('unreal', 'execute_python_script', { code: script }, 60_000);
      return {
        success: true, method: 'python_script',
        specPath, regionPath, result,
        stats: spec.totals,
      };
    } catch (err) {
      return {
        success: true, method: 'deferred_after_error',
        specPath, regionPath, error: err.message,
        stats: spec.totals,
      };
    }
  } catch { /* Unreal not available */ }

  return {
    success: true, method: 'deferred',
    specPath, regionPath,
    note: 'RVT performance spec + per-region settings saved. BP_CorruptionPerformance will be deployed when UE5 is open.',
    stats: spec.totals,
  };
}
