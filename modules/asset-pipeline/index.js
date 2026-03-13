/**
 * modules/asset-pipeline/index.js — Module manifest for 3D asset generation.
 *
 * Generates 3D game assets for The Shattered Crown via Blender MCP.
 * Reads asset-manifest.json, generates procedural geometry, exports FBX.
 */

import { detectAssetSignals } from './signals.js';
import { buildAssetGenerationBrief, buildAssetRegenerationBrief, getProgress, manifestExists } from './pipeline.js';
import { getMaterialLibraryStatus, getMaterialsForRegion } from './region-materials.js';
import { registerTool } from '../../lib/tool-bridge.js';
import './on-demand.js';

// ── Register tools ───────────────────────────────────────────────────────────

registerTool({
  name: 'generate_asset',
  description: 'Generate a 3D asset via Blender MCP. Tries Hyper3D AI first, then Sketchfab, then procedural fallback. Optional param: assetId (string) to target a specific asset instead of picking the next pending one. Returns { success, assetId, outputPath, method }.',
  async execute(params) {
    const { generateOneAsset } = await import('./pipeline.js');
    return generateOneAsset(params?.assetId ? { assetId: params.assetId } : {});
  },
}, { rateLimit: 60000 }); // 1 min — production grind mode

registerTool({
  name: 'regenerate_asset',
  description: 'Regenerate one previously-completed procedural asset with AI generation (Hyper3D). Picks the oldest procedural asset from the queue. Returns { success, assetId, method }.',
  async execute() {
    const { regenerateOneAsset } = await import('./pipeline.js');
    return regenerateOneAsset();
  },
}, { rateLimit: 60000 }); // 1 min

registerTool({
  name: 'generate_asset_batch',
  description: 'Generate up to N pending 3D assets in one call. Processes sequentially — Hyper3D AI → Sketchfab → procedural for each. Params: count (number, default 3), region (string, optional — limit to specific region e.g. "Shared"). Returns { completed: [...ids], failed: [...], skipped }.',
  async execute(params) {
    const { generateBatchAssets, generateRegionBatch } = await import('./pipeline.js');
    if (params?.region) {
      return generateRegionBatch(params.region, params?.count || 6);
    }
    return generateBatchAssets(params?.count || 3);
  },
}, { rateLimit: 60000 }); // 1 min

registerTool({
  name: 'asset_progress',
  description: 'Get the current progress of the 3D asset generation pipeline. Returns { total, completed, pending, failed, percent, nextAsset }.',
  async execute() {
    const { getStatusReport } = await import('./pipeline.js');
    return getStatusReport();
  },
}, { rateLimit: 5000 });

// ── Auto-rigging (UniRig) ────────────────────────────────────────────────────

registerTool({
  name: 'rig_mesh',
  description: 'Auto-rig a 3D mesh using UniRig (skeleton + skinning weights). Input: GLB/FBX/OBJ path. Output: rigged FBX. Params: { input: string, output?: string, seed?: number }. Returns { success, output, fileSize, totalSeconds, timings }.',
  async execute(params) {
    const { rigMesh, isUniRigReady } = await import('./auto-rig.js');
    if (!isUniRigReady()) return { success: false, error: 'UniRig not installed. Run workspace/UniRig setup.' };
    if (!params?.input) return { success: false, error: 'Missing required param: input' };
    const output = params.output || params.input.replace(/\.[^.]+$/, '_rigged.fbx');
    return rigMesh(params.input, output, { seed: params.seed });
  },
}, { rateLimit: 60000 });

registerTool({
  name: 'rig_and_import',
  description: 'Auto-rig a mesh with UniRig and import the rigged result into the current Blender scene. Params: { input: string, seed?: number }. Returns { success, rigFile, bones, vertexGroups }.',
  async execute(params, { callTool }) {
    const { rigAndImport, isUniRigReady } = await import('./auto-rig.js');
    if (!isUniRigReady()) return { success: false, error: 'UniRig not installed.' };
    if (!params?.input) return { success: false, error: 'Missing required param: input' };
    return rigAndImport(params.input, callTool, { seed: params.seed });
  },
}, { rateLimit: 60000 });

// ── Animation (Claude-as-Animator) ───────────────────────────────────────────

registerTool({
  name: 'animate_rig',
  description: 'Animate a rigged armature in Blender using Claude-generated keyframe code. Params: { armature: string (Blender armature name), type: "idle"|"walk"|"attack"|"fly"|"custom", description?: string, frameCount?: number }. Returns { success, fcurves, keyframes, frameCount }.',
  async execute(params) {
    const { animateViaClaudeAnimator } = await import('./claude-animate.js');
    if (!params?.armature) return { success: false, error: 'Missing required param: armature' };
    const animType = params.type || 'idle';
    return animateViaClaudeAnimator(params.armature, animType, {
      description: params.description,
      frameCount: params.frameCount,
    });
  },
}, { rateLimit: 60000 });

// ── Material library query (exposed for briefs and status) ───────────────────

registerTool({
  name: 'material_library_status',
  description: 'Get master PBR material library status: universal materials, per-region kits, total count.',
  async execute(params) {
    const status = getMaterialLibraryStatus();
    if (params?.region) {
      const regionMats = getMaterialsForRegion(params.region);
      return { ...status, regionDetail: Object.keys(regionMats) };
    }
    return status;
  },
}, { rateLimit: 5000 });

// ── Urgent work check ────────────────────────────────────────────────────────

function hasUrgentWork() {
  try {
    if (!manifestExists()) return false;
    const progress = getProgress();
    return progress.pending > 0 && progress.pending <= 5 && progress.completed > 20;
  } catch { return false; }
}

// ── Module manifest ──────────────────────────────────────────────────────────

export default {
  name: 'asset-pipeline',
  signalPrefix: 'asset_',
  messageCategory: 'shattered-crown',

  detectSignals: detectAssetSignals,

  briefBuilders: {
    asset_generation: buildAssetGenerationBrief,
    asset_regeneration: buildAssetRegenerationBrief,
  },

  sonnetSignalTypes: ['asset_generation', 'asset_regeneration'],

  stateKey: 'asset-pipeline',
  stateKeyMap: {
    asset_generation: 'lastAssetGenerationAt',
    asset_regeneration: 'lastAssetRegenerationAt',
  },

  hasUrgentWork,
};
