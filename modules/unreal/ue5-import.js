/**
 * modules/unreal/ue5-import.js — UE5 Asset Import Orchestrator (ms_10).
 *
 * Bridges the gap between generated FBX assets on disk and UE5 Content Browser.
 * Since Unreal MCP has no native FBX import tool, this module:
 *
 *  1. Generates a UE5 Python import script (importAllAssets.py) that can be
 *     pasted into UE5 Editor's Python console or run via execute_python_script.
 *  2. Builds a test level using available MCP tools (construct_house,
 *     spawn_physics_blueprint_actor, set_actor_transform, etc.).
 *  3. Tracks import state so the pipeline knows what's been imported.
 *  4. Falls back gracefully — always leaves a runnable script even if
 *     execute_python_script MCP tool is unavailable.
 *
 * Asset flow:
 *   asset-manifest.json (339 FBX) → ue5-import.js → importAllAssets.py → UE5 Content
 *                                                  → test level (via MCP)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename, dirname } from 'path';
import { callTool } from '../../lib/mcp-gateway.js';
import { createLogger } from '../../lib/logger.js';
import { getActiveGame } from './game-config.js';
import { BLUEPRINT_PLACEMENTS } from './blueprint-integration.js';
import { getMaterialsForRegion } from '../asset-pipeline/region-materials.js';

const log = createLogger('ue5-import');

// ── State persistence ────────────────────────────────────────────────────────

const IMPORT_STATE_FILE = join(process.cwd(), 'data', 'state', 'ue5-import-state.json');

function loadImportState() {
  if (!existsSync(IMPORT_STATE_FILE)) return { imported: {}, scriptGenerated: false, testLevelBuilt: false };
  try {
    return JSON.parse(readFileSync(IMPORT_STATE_FILE, 'utf-8'));
  } catch { return { imported: {}, scriptGenerated: false, testLevelBuilt: false }; }
}

function saveImportState(state) {
  const dir = dirname(IMPORT_STATE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(IMPORT_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

// ── Asset manifest reader ────────────────────────────────────────────────────

function loadAssetManifest() {
  const { assetManifestPath } = getActiveGame();
  if (!existsSync(assetManifestPath)) return null;
  return JSON.parse(readFileSync(assetManifestPath, 'utf-8'));
}

/**
 * Collect all assets across all regions into a flat list.
 * Each entry: { id, name, region, fbxPath, type, status, method, faces }
 */
function collectAllAssets() {
  const manifest = loadAssetManifest();
  if (!manifest) return [];

  const game = getActiveGame();
  const assets = [];

  for (const [regionId, regionData] of Object.entries(manifest.regions || {})) {
    for (const asset of (regionData.assets || [])) {
      if (!asset.fbx_path && !asset.export_path) continue;
      const relPath = asset.fbx_path || asset.export_path;
      const absPath = join(game.assetsPath, relPath).replace(/\\/g, '/');

      assets.push({
        id: asset.id,
        name: asset.name || asset.id,
        region: regionId,
        fbxRelPath: relPath,
        fbxAbsPath: absPath,
        type: asset.type || 'prop',          // hero, prop, environment, foliage, character
        status: asset.status || 'pending',
        method: asset.method || 'unknown',
        faces: asset.faces || 0,
        isSkeletal: regionId === 'Characters' || regionId === 'Enemies' ||
                    (asset.type === 'character') || relPath.includes('_rigged'),
      });
    }
  }

  return assets;
}

// ── Python import script generator ───────────────────────────────────────────

/**
 * Generate a UE5 Python import script that bulk-imports all FBX assets.
 * Uses unreal.AssetToolsHelpers + FbxImportUI for proper import settings.
 * Outputs the script to workspace/{game}/Assets/Scripts/importAllAssets.py.
 *
 * @param {object} opts
 * @param {string} opts.regionId - Optional: only generate for one region
 * @returns {{ success, scriptPath, assetCount, regions }}
 */
export function generateImportScript(opts = {}) {
  const game = getActiveGame();
  const allAssets = collectAllAssets();
  const regionFilter = opts.regionId;

  const assets = regionFilter
    ? allAssets.filter(a => a.region === regionFilter)
    : allAssets;

  if (assets.length === 0) {
    return { success: false, error: 'No assets found in manifest' };
  }

  // Group by region for organized import
  const byRegion = {};
  for (const a of assets) {
    (byRegion[a.region] ||= []).push(a);
  }

  // Build the Python script
  const scriptLines = [
    '"""',
    'UE5 Asset Import Script — The Shattered Crown',
    `Generated: ${new Date().toISOString()}`,
    `Total assets: ${assets.length}`,
    `Regions: ${Object.keys(byRegion).join(', ')}`,
    '',
    'Run this in UE5 Editor: Edit → Execute Python Script, or paste into Output Log Python console.',
    '"""',
    '',
    'import unreal',
    'import os',
    '',
    '# ── Configuration ──',
    `ASSETS_ROOT = r"${game.assetsPath.replace(/\//g, '\\\\')}"`,
    'CONTENT_ROOT = "/Game/Assets"',
    '',
    '# ── Import helpers ──',
    '',
    'def get_import_task(source_path, dest_path, is_skeletal=False):',
    '    """Create an FBX import task with proper settings."""',
    '    task = unreal.AssetImportTask()',
    '    task.set_editor_property("automated", True)',
    '    task.set_editor_property("destination_path", dest_path)',
    '    task.set_editor_property("filename", source_path)',
    '    task.set_editor_property("replace_existing", True)',
    '    task.set_editor_property("save", True)',
    '',
    '    # FBX-specific options',
    '    fbx_options = unreal.FbxImportUI()',
    '    fbx_options.set_editor_property("import_mesh", True)',
    '    fbx_options.set_editor_property("import_textures", True)',
    '    fbx_options.set_editor_property("import_materials", True)',
    '    fbx_options.set_editor_property("import_as_skeletal", is_skeletal)',
    '',
    '    if not is_skeletal:',
    '        # Static mesh options',
    '        sm_opts = fbx_options.static_mesh_import_data',
    '        sm_opts.set_editor_property("combine_meshes", True)',
    '        sm_opts.set_editor_property("generate_lightmap_u_vs", True)',
    '        sm_opts.set_editor_property("auto_generate_collision", True)',
    '    else:',
    '        # Skeletal mesh options',
    '        sk_opts = fbx_options.skeletal_mesh_import_data',
    '        sk_opts.set_editor_property("import_morph_targets", True)',
    '',
    '    fbx_options.set_editor_property("automated_import_should_detect_type", False)',
    '    task.set_editor_property("options", fbx_options)',
    '',
    '    return task',
    '',
    '',
    'def import_batch(tasks):',
    '    """Execute a batch of import tasks."""',
    '    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()',
    '    asset_tools.import_asset_tasks(tasks)',
    '    return len(tasks)',
    '',
    '',
    '# ── Main import ──',
    '',
    'def main():',
    '    total = 0',
    '    succeeded = 0',
    '    failed = 0',
    '    errors = []',
    '',
    '    unreal.log("=== Shattered Crown Asset Import ===")' ,
    '',
  ];

  // Generate import calls per region
  for (const [regionId, regionAssets] of Object.entries(byRegion)) {
    scriptLines.push(`    # ── Region: ${regionId} (${regionAssets.length} assets) ──`);
    scriptLines.push(`    unreal.log("Importing ${regionId}: ${regionAssets.length} assets...")`);
    scriptLines.push('    tasks = []');
    scriptLines.push('');

    for (const asset of regionAssets) {
      const sourcePath = asset.fbxAbsPath.replace(/\//g, '\\\\');
      const destPath = `${'/Game/Assets/Meshes'}/${regionId}`;
      scriptLines.push(`    # ${asset.name} (${asset.type}, ${asset.faces} faces, ${asset.method})`);
      scriptLines.push(`    src = r"${sourcePath}"`);
      scriptLines.push(`    if os.path.exists(src):`);
      scriptLines.push(`        tasks.append(get_import_task(src, "${destPath}", is_skeletal=${asset.isSkeletal ? 'True' : 'False'}))`);
      scriptLines.push(`    else:`);
      scriptLines.push(`        unreal.log_warning("Missing: ${asset.id} at " + src)`);
      scriptLines.push(`        failed += 1`);
      scriptLines.push('');
    }

    scriptLines.push('    if tasks:');
    scriptLines.push('        try:');
    scriptLines.push('            count = import_batch(tasks)');
    scriptLines.push('            succeeded += count');
    scriptLines.push(`            unreal.log("  OK: ${regionId} — %d assets imported" % count)`);
    scriptLines.push('        except Exception as e:');
    scriptLines.push(`            unreal.log_error("  FAIL: ${regionId} — %s" % str(e))`);
    scriptLines.push(`            errors.append("${regionId}: " + str(e))`);
    scriptLines.push('    total += len(tasks) + failed');
    scriptLines.push('');
  }

  // Summary
  scriptLines.push('    unreal.log("=== Import Complete ===")',);
  scriptLines.push('    unreal.log("Total: %d | Succeeded: %d | Failed: %d" % (total, succeeded, failed))');
  scriptLines.push('    if errors:');
  scriptLines.push('        for e in errors:');
  scriptLines.push('            unreal.log_error("  " + e)');
  scriptLines.push('    return {"total": total, "succeeded": succeeded, "failed": failed, "errors": errors}');
  scriptLines.push('');
  scriptLines.push('');
  scriptLines.push('if __name__ == "__main__":');
  scriptLines.push('    main()');
  scriptLines.push('else:');
  scriptLines.push('    main()  # Also run when executed from Output Log');
  scriptLines.push('');

  // Write script
  const scriptsDir = join(game.assetsPath, 'Scripts');
  if (!existsSync(scriptsDir)) mkdirSync(scriptsDir, { recursive: true });

  const scriptPath = join(scriptsDir, regionFilter ? `import_${regionFilter}.py` : 'importAllAssets.py');
  writeFileSync(scriptPath, scriptLines.join('\n'), 'utf-8');

  // Update state
  const state = loadImportState();
  state.scriptGenerated = true;
  state.scriptPath = scriptPath;
  state.scriptGeneratedAt = new Date().toISOString();
  state.assetCount = assets.length;
  state.regions = Object.keys(byRegion);
  saveImportState(state);

  log.info({ scriptPath, assetCount: assets.length, regions: Object.keys(byRegion) },
    'UE5 import script generated');

  return {
    success: true,
    scriptPath,
    assetCount: assets.length,
    regions: Object.keys(byRegion),
    regionBreakdown: Object.fromEntries(
      Object.entries(byRegion).map(([k, v]) => [k, v.length]),
    ),
  };
}

// ── Test level builder ───────────────────────────────────────────────────────

/**
 * Build a test level in UE5 using available MCP tools.
 * Creates a showcase area with:
 *  1. Ground plane + bounding walls (via construct_house/pyramid)
 *  2. Blueprint actor placements from CrossroadsHub + AshenWilds
 *  3. Lighting setup
 *  4. Validation of actor count
 *
 * @returns {{ success, actorsPlaced, bpsPlaced, errors[] }}
 */
export async function buildTestLevel() {
  log.info('=== Building UE5 Test Level for Asset Validation ===');

  const errors = [];
  let actorsPlaced = 0;
  let bpsPlaced = 0;

  // Step 1: Check UE5 is reachable
  let alive = false;
  try {
    const result = await callTool('unreal', 'get_actors_in_level', {}, 10_000);
    alive = result && (result.status === 'success' || result.success !== false);
  } catch { /* not reachable */ }

  if (!alive) {
    log.warn('UE5 Editor not reachable — generating import script only');
    const scriptResult = generateImportScript();
    return {
      success: true,
      mode: 'script-only',
      message: 'UE5 Editor not reachable. Import script generated — run it in UE5 Python console.',
      scriptPath: scriptResult.scriptPath,
      assetCount: scriptResult.assetCount,
    };
  }

  // Step 2: Build ground/floor structure as test arena base
  try {
    log.info('Step 1/5: Building test arena ground...');
    const groundResult = await callTool('unreal', 'construct_house', {
      location: [0, 0, -100],
      name_prefix: 'TestLevel_Ground',
      style: 'cottage',
    }, 60_000);

    if (groundResult?.success !== false) {
      actorsPlaced += (groundResult?.actors_created || 1);
      log.info('Test arena ground built');
    }
  } catch (err) {
    errors.push({ step: 'ground', error: err.message });
    log.warn({ err: err.message }, 'Ground construction failed');
  }

  // Step 3: Build landmark structures (tower + arch for visual reference)
  try {
    log.info('Step 2/5: Building landmark structures...');
    const towerResult = await callTool('unreal', 'create_tower', {
      location: [5000, 0, 0],
      name_prefix: 'TestLevel_Tower',
    }, 60_000);
    if (towerResult?.success !== false) actorsPlaced++;

    const archResult = await callTool('unreal', 'create_arch', {
      location: [-5000, 0, 0],
      name_prefix: 'TestLevel_Arch',
    }, 60_000);
    if (archResult?.success !== false) actorsPlaced++;
  } catch (err) {
    errors.push({ step: 'landmarks', error: err.message });
    log.warn({ err: err.message }, 'Landmark construction failed');
  }

  // Step 4: Place Blueprint actors from first 2 regions (CrossroadsHub + AshenWilds)
  const testRegions = ['CrossroadsHub', 'AshenWilds'];

  for (const regionId of testRegions) {
    const placements = BLUEPRINT_PLACEMENTS[regionId];
    if (!placements) continue;

    log.info(`Step 3/5: Placing ${regionId} Blueprint actors...`);

    for (const [bpName, pos] of Object.entries(placements)) {
      try {
        const actorName = `TestLevel_${regionId}_${bpName}`;
        const result = await callTool('unreal', 'spawn_physics_blueprint_actor', {
          blueprint_name: bpName,
          actor_name: actorName,
          location: { X: pos[0], Y: pos[1], Z: pos[2] },
          rotation: { Pitch: 0, Yaw: 0, Roll: 0 },
          simulate_physics: false,
        }, 30_000);

        if (result?.success !== false) {
          bpsPlaced++;
          log.info({ bp: bpName, pos }, 'BP actor placed in test level');
        } else {
          errors.push({ step: 'bp_place', bp: bpName, error: result?.message || 'spawn failed' });
        }
      } catch (err) {
        errors.push({ step: 'bp_place', bp: bpName, error: err.message });
        log.warn({ bp: bpName, err: err.message }, 'BP placement failed in test level');
      }
    }
  }

  // Step 5: Try to execute the import script via Python (may fail — that's OK)
  let scriptImportAttempted = false;
  let scriptImportSuccess = false;
  try {
    log.info('Step 4/5: Attempting FBX import via UE5 Python...');
    const scriptResult = generateImportScript();

    // Try execute_python_script — known to be unreliable (memory note #21)
    try {
      const script = readFileSync(scriptResult.scriptPath, 'utf-8');
      const pyResult = await callTool('unreal', 'execute_python_script', { script }, 300_000);
      scriptImportAttempted = true;
      scriptImportSuccess = pyResult?.success !== false;
      if (scriptImportSuccess) {
        log.info('FBX import via Python succeeded!');
      }
    } catch (err) {
      scriptImportAttempted = true;
      log.info({ err: err.message },
        'execute_python_script unavailable (expected) — import script saved for manual execution');
    }
  } catch (err) {
    errors.push({ step: 'import_script', error: err.message });
  }

  // Step 6: Validate by counting actors
  let actorCount = 0;
  try {
    log.info('Step 5/5: Validating test level...');
    const sceneResult = await callTool('unreal', 'get_actors_in_level', {}, 15_000);
    if (Array.isArray(sceneResult?.actors)) {
      actorCount = sceneResult.actors.length;
    } else if (typeof sceneResult?.count === 'number') {
      actorCount = sceneResult.count;
    }
    log.info({ actorCount }, 'Test level validation complete');
  } catch (err) {
    errors.push({ step: 'validation', error: err.message });
  }

  // Update state
  const state = loadImportState();
  state.testLevelBuilt = true;
  state.testLevelBuiltAt = new Date().toISOString();
  state.testLevelActors = actorCount;
  state.testLevelBPs = bpsPlaced;
  state.scriptImportAttempted = scriptImportAttempted;
  state.scriptImportSuccess = scriptImportSuccess;
  saveImportState(state);

  const summary = {
    success: actorsPlaced > 0 || bpsPlaced > 0,
    actorsPlaced,
    bpsPlaced,
    totalActorsInLevel: actorCount,
    scriptImportAttempted,
    scriptImportSuccess,
    errors: errors.length > 0 ? errors : undefined,
    testRegions,
  };

  log.info(summary, 'Test level build complete');
  return summary;
}

// ── Import report ────────────────────────────────────────────────────────────

/**
 * Get a comprehensive import status report.
 * Shows all assets, their import state, and pipeline readiness.
 */
export function getImportReport() {
  const allAssets = collectAllAssets();
  const state = loadImportState();

  // Count by type and region
  const byRegion = {};
  const byType = {};
  const byMethod = {};
  let totalFaces = 0;
  let skeletal = 0;
  let staticMesh = 0;

  for (const a of allAssets) {
    (byRegion[a.region] ||= []).push(a.id);
    byType[a.type] = (byType[a.type] || 0) + 1;
    byMethod[a.method] = (byMethod[a.method] || 0) + 1;
    totalFaces += a.faces;
    if (a.isSkeletal) skeletal++;
    else staticMesh++;
  }

  return {
    totalAssets: allAssets.length,
    staticMeshes: staticMesh,
    skeletalMeshes: skeletal,
    totalFaces,
    regionBreakdown: Object.fromEntries(
      Object.entries(byRegion).map(([k, v]) => [k, v.length]),
    ),
    typeBreakdown: byType,
    methodBreakdown: byMethod,
    importState: {
      scriptGenerated: state.scriptGenerated,
      scriptPath: state.scriptPath,
      scriptGeneratedAt: state.scriptGeneratedAt,
      testLevelBuilt: state.testLevelBuilt,
      testLevelActors: state.testLevelActors,
      testLevelBPs: state.testLevelBPs,
    },
  };
}

// ── Improved placeAssets for level-builder ────────────────────────────────────

/**
 * Replacement for the broken placeAssets() in level-builder.js.
 * Instead of calling non-existent import_assets_batch + spawn_static_mesh,
 * this function:
 *  1. Generates the Python import script for the region
 *  2. Attempts import via execute_python_script (may fail)
 *  3. Creates blueprint wrappers for each asset (using available tools)
 *  4. Returns results with import script path for manual execution
 *
 * @param {string} regionId
 * @param {object} region - Region config from manifest
 * @param {object} assetLookup - assetId → fbx_path
 * @param {Array} placements - [{assetId, position, rotation, scale}]
 * @param {string} planSource - 'world-plan' or 'keyLocations'
 * @returns {{ placed, failed, planSource, importScript, results }}
 */
export async function importAndPlaceAssets(regionId, region, assetLookup, placements, planSource) {
  const results = [];
  let placed = 0;
  let failed = 0;

  // Step 1: Generate import script for this region
  const scriptResult = generateImportScript({ regionId });
  log.info({ regionId, scriptPath: scriptResult.scriptPath }, 'Import script generated for region');

  // Step 2: Attempt Python-based import (known to be unreliable)
  let pythonImportWorked = false;
  try {
    const scriptContent = readFileSync(scriptResult.scriptPath, 'utf-8');
    const pyResult = await callTool('unreal', 'execute_python_script',
      { script: scriptContent }, 300_000);
    pythonImportWorked = pyResult?.success !== false;
    if (pythonImportWorked) {
      log.info({ regionId }, 'Python FBX import succeeded');
    }
  } catch {
    log.info({ regionId }, 'Python import unavailable — script saved for manual use');
  }

  // Step 3: Place assets using available tools
  // If Python import worked, assets are in /Game/Assets/Meshes/{region}/
  // If not, we create placeholder Blueprint actors for spatial validation
  const actorCounts = {};

  for (const p of placements) {
    const assetId = p.assetId;
    const fbxRelPath = assetLookup[assetId];
    const assetName = fbxRelPath
      ? basename(fbxRelPath).replace(/\.fbx$/i, '')
      : assetId;

    actorCounts[assetId] = (actorCounts[assetId] || 0) + 1;
    const actorName = `${region.levelName}_${assetId}_${actorCounts[assetId]}`;
    const pos = p.position || [0, 0, 0];

    try {
      let spawnResult;

      if (pythonImportWorked) {
        // Assets are imported — try to set them as static mesh references
        const ue5AssetPath = `/Game/Assets/Meshes/${regionId}/${assetName}`;
        // Use spawn_physics_blueprint_actor as a placement mechanism
        spawnResult = await callTool('unreal', 'spawn_physics_blueprint_actor', {
          blueprint_name: 'StaticMeshActor',
          actor_name: actorName,
          location: { X: pos[0], Y: pos[1], Z: pos[2] },
          rotation: { Pitch: p.rotation?.[0] || 0, Yaw: p.rotation?.[1] || 0, Roll: p.rotation?.[2] || 0 },
          simulate_physics: false,
        }, 30_000);
      } else {
        // No import — create a simple pyramid as spatial placeholder
        spawnResult = await callTool('unreal', 'create_pyramid', {
          location: pos,
          name_prefix: actorName,
        }, 30_000);
      }

      if (spawnResult && !spawnResult?.error) {
        placed++;
        results.push({ assetId, actor: actorName, success: true });
        log.info({ actor: actorName }, 'Asset placed (or placeholder created)');
      } else {
        failed++;
        results.push({ assetId, success: false, error: spawnResult?.error || 'spawn failed' });
      }
    } catch (err) {
      failed++;
      results.push({ assetId, success: false, error: err.message });
      log.warn({ assetId, err: err.message }, 'Asset placement error');
    }
  }

  return {
    placed,
    failed,
    planSource,
    pythonImportWorked,
    importScript: scriptResult.scriptPath,
    results,
  };
}

// ── Full orchestrator ────────────────────────────────────────────────────────

/**
 * Execute the complete ms_10 UE5 import + test level pipeline:
 *  1. Generate import scripts for all regions
 *  2. Build test level
 *  3. Generate import report
 *
 * @returns {{ success, importReport, testLevel, scriptPath }}
 */
export async function executeImportPipeline() {
  log.info('=== UE5 Import Pipeline (ms_10) ===');
  const startTime = Date.now();

  // 1. Generate master import script
  const scriptResult = generateImportScript();
  log.info({ assetCount: scriptResult.assetCount }, 'Master import script generated');

  // 2. Build test level
  const testLevelResult = await buildTestLevel();
  log.info({ success: testLevelResult.success }, 'Test level build complete');

  // 3. Import report
  const report = getImportReport();

  const elapsed = Math.round((Date.now() - startTime) / 1000);

  return {
    success: scriptResult.success,
    duration: `${elapsed}s`,
    scriptPath: scriptResult.scriptPath,
    assetCount: scriptResult.assetCount,
    regions: scriptResult.regions,
    regionBreakdown: scriptResult.regionBreakdown,
    testLevel: testLevelResult,
    importReport: report,
  };
}

export { collectAllAssets, loadImportState, saveImportState };
