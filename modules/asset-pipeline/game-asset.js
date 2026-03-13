/**
 * modules/asset-pipeline/game-asset.js — Mesh generation for game characters.
 *
 * Called by unreal-autonomy.js for `generate_mesh` tasks.
 * Pipeline: Hunyuan3D (text→mesh) → UniRig (auto-rig) → import into UE5 via Python.
 *
 * Falls back to Hyper3D → Claude-sculpt if Hunyuan3D is unavailable.
 */

import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { callTool } from '../../lib/mcp-gateway.js';
import { createLogger } from '../../lib/logger.js';
import { isUniRigReady, rigAndImport } from './auto-rig.js';

const log = createLogger('game-asset');

const MESH_DIR = join(process.cwd(), 'workspace', 'shattered-crown', 'Assets', 'Meshes');
const POLL_INTERVAL = 10_000;
const MAX_POLL = 5 * 60_000;

try { mkdirSync(MESH_DIR, { recursive: true }); } catch {}

// ── Hunyuan3D via local API server (port 8081) ────────────────────────────────

async function isHunyuanReady() {
  try {
    const r = await callTool('blender-mcp', 'get_hunyuan3d_status', {}, 8_000);
    return r && !r.toLowerCase().includes('disabled') && !r.toLowerCase().includes('not enabled');
  } catch { return false; }
}

async function generateWithHunyuan(prompt, characterId) {
  log.info({ characterId, prompt: prompt.slice(0, 60) }, 'Hunyuan3D: submitting');

  const result = await callTool('blender-mcp', 'generate_hunyuan3d_model', {
    text_prompt: prompt,
  }, 30_000);

  // Returns { job_id: "job_xxx" }
  const parsed = typeof result === 'string' ? JSON.parse(result) : result;
  const jobId = parsed?.job_id;
  if (!jobId) throw new Error(`Hunyuan3D submit failed: ${JSON.stringify(parsed).slice(0, 200)}`);

  log.info({ characterId, jobId }, 'Hunyuan3D: polling');

  const start = Date.now();
  while (Date.now() - start < MAX_POLL) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));

    const status = await callTool('blender-mcp', 'poll_hunyuan_job_status', { job_id: jobId }, 15_000);
    const s = typeof status === 'string' ? JSON.parse(status) : status;

    log.debug({ characterId, jobId, status: s?.status }, 'Hunyuan3D: poll');

    if (s?.status === 'DONE') {
      const zipUrl = s?.ResultFile3Ds;
      if (!zipUrl) throw new Error('Hunyuan3D done but no ResultFile3Ds');

      // Import the generated asset into Blender
      await callTool('blender-mcp', 'import_generated_asset_hunyuan', {
        name: characterId,
        zip_file_url: zipUrl,
      }, 60_000);

      log.info({ characterId }, 'Hunyuan3D: imported into Blender');
      return { method: 'hunyuan3d', jobId, zipUrl };
    }

    if (s?.status && !['RUN', 'QUEUE', 'IN_QUEUE', 'PENDING'].includes(s.status)) {
      throw new Error(`Hunyuan3D failed: ${s.status}`);
    }
  }

  throw new Error('Hunyuan3D timed out (5min)');
}

// ── Hyper3D fallback ──────────────────────────────────────────────────────────

async function generateWithHyper3d(prompt, characterId) {
  log.info({ characterId }, 'Hyper3D: submitting');

  const genResult = await callTool('blender-mcp', 'generate_hyper3d_model_via_text', {
    text_prompt: prompt,
  }, 120_000);

  const parsed = typeof genResult === 'string' ? JSON.parse(genResult) : genResult;
  const jobId = parsed?.subscription_key || parsed?.request_id || parsed?.task_uuid;
  if (!jobId) throw new Error(`Hyper3D submit failed: ${JSON.stringify(parsed).slice(0, 200)}`);

  const start = Date.now();
  while (Date.now() - start < MAX_POLL) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));

    const pollArgs = parsed.subscription_key
      ? { subscription_key: parsed.subscription_key }
      : { request_id: parsed.request_id };

    const pollResult = await callTool('blender-mcp', 'poll_rodin_job_status', pollArgs, 30_000);
    const s = typeof pollResult === 'string' ? JSON.parse(pollResult) : pollResult;

    if (s?.status === 'COMPLETED' || (Array.isArray(s) && s.every(x => x === 'Done'))) {
      const importArgs = { name: characterId };
      if (parsed.task_uuid) importArgs.task_uuid = parsed.task_uuid;
      if (parsed.request_id) importArgs.request_id = parsed.request_id;

      await callTool('blender-mcp', 'import_generated_asset', importArgs, 60_000);
      log.info({ characterId }, 'Hyper3D: imported into Blender');
      return { method: 'hyper3d' };
    }

    if (s?.status === 'FAILED') throw new Error('Hyper3D generation failed');
  }

  throw new Error('Hyper3D timed out (5min)');
}

// ── Import GLB from Blender into UE5 via Python ───────────────────────────────

async function importMeshIntoUE5(characterId, blueprintName) {
  // Export from Blender as GLB, then import into UE5
  const glbPath = join(MESH_DIR, `${characterId}.glb`).replace(/\\/g, '/');

  // Step 1: Export from Blender
  await callTool('blender-mcp', 'execute_blender_code', {
    code: `
import bpy, os
obj = bpy.context.selected_objects[0] if bpy.context.selected_objects else bpy.data.objects.get("${characterId}")
if obj:
    bpy.ops.export_scene.gltf(
        filepath="${glbPath}",
        export_selected=True,
        export_format='GLB',
        export_animations=False
    )
    print(f"Exported to ${glbPath}")
else:
    print("ERROR: object not found")
`,
  }, 30_000);

  if (!existsSync(glbPath)) {
    log.warn({ characterId, glbPath }, 'GLB not found after export — skipping UE5 import');
    return { success: false, error: 'GLB export failed' };
  }

  // Step 2: Import GLB into UE5 via Python
  const ue5ImportPath = `/Game/Characters/${characterId}`;
  const script = `
import unreal, os

glb_path = r"${glbPath}"
dest_path = "${ue5ImportPath}"

task = unreal.AssetImportTask()
task.filename = glb_path
task.destination_path = dest_path
task.destination_name = "${characterId}_Mesh"
task.replace_existing = True
task.automated = True
task.save = True

options = unreal.FbxImportUI()
options.import_mesh = True
options.import_textures = True
options.import_materials = True
options.import_as_skeletal = True
options.skeletal_mesh_import_data.import_morph_targets = False
task.options = options

unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
print(f"Imported: {dest_path}/{characterId}_Mesh")
`;

  const r = await callTool('unreal', 'execute_python_script', { script }, 60_000);
  log.info({ characterId, success: r?.success }, 'UE5: mesh imported');
  return { success: r?.success !== false, output: r?.output };
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function generateOnDemandForGame(params) {
  const { prompt, characterId, blueprintName, animType, creatureArchetype } = params;

  if (!prompt || !characterId) {
    return { success: false, error: 'Missing prompt or characterId' };
  }

  log.info({ characterId, animType }, 'Starting game mesh generation');

  const errors = [];
  let method = null;

  // 1. Try Hunyuan3D (local, best quality, free)
  try {
    if (await isHunyuanReady()) {
      await generateWithHunyuan(prompt, characterId);
      method = 'hunyuan3d';
    }
  } catch (err) {
    errors.push(`Hunyuan3D: ${err.message}`);
    log.warn({ err: err.message }, 'Hunyuan3D failed, trying Hyper3D');
  }

  // 2. Fallback: Hyper3D
  if (!method) {
    try {
      await generateWithHyper3d(prompt, characterId);
      method = 'hyper3d';
    } catch (err) {
      errors.push(`Hyper3D: ${err.message}`);
      log.warn({ err: err.message }, 'Hyper3D failed, trying Claude-sculpt');
    }
  }

  // 3. Fallback: Claude-sculpt (Blender Python keyframes)
  if (!method) {
    try {
      const { generateViaClaudeSculpt } = await import('./claude-sculpt.js');
      const r = await generateViaClaudeSculpt(prompt, characterId, { model: 'sonnet', maxRetries: 1 });
      method = r.method;
    } catch (err) {
      errors.push(`Claude-sculpt: ${err.message}`);
      log.error({ err: err.message }, 'All mesh generators failed');
    }
  }

  if (!method) {
    return { success: false, error: errors.join('; ') };
  }

  // 4. Auto-rig with UniRig (humanoid characters only)
  if (animType === 'humanoid' && isUniRigReady()) {
    try {
      const glbIn = join(MESH_DIR, `${characterId}_raw.glb`);
      const fbxOut = join(MESH_DIR, `${characterId}_rigged.fbx`);

      // Export raw from Blender first
      await callTool('blender-mcp', 'execute_blender_code', {
        code: `
import bpy
bpy.ops.export_scene.gltf(
    filepath="${glbIn.replace(/\\/g, '/')}",
    export_selected=True,
    export_format='GLB',
    export_animations=False
)
print("Raw export done")
`,
      }, 30_000);

      if (existsSync(glbIn)) {
        await rigAndImport(glbIn, callTool);
        log.info({ characterId }, 'UniRig: auto-rigged');
        method = method + '+unirig';
      }
    } catch (err) {
      log.warn({ err: err.message }, 'UniRig failed — continuing with unrigged mesh');
    }
  }

  // 5. Import into UE5
  const importResult = await importMeshIntoUE5(characterId, blueprintName);

  return {
    success: true,
    method,
    characterId,
    animType,
    ue5Imported: importResult.success,
  };
}
