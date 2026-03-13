/**
 * modules/unreal/game-builder.js — Autonomous playable game builder.
 *
 * Builds everything needed for a playable Shattered Crown session:
 *  1. BP_Kael   — Player character blueprint (ACharacter subclass)
 *  2. BP_SCGameMode — Game mode wiring BP_Kael as DefaultPawn
 *  3. TestArena level — Floor, lighting, PlayerStart placeholder
 *  4. Pending region Blueprints — From region-manifest.json
 *
 * Call buildPlayableGame() to run all phases sequentially.
 * Each phase reports progress via the onProgress callback.
 */

import { callTool } from '../../lib/mcp-gateway.js';
import { buildNextBlueprint, getBlueprintProgress } from './blueprint-builder.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('game-builder');

async function ue(tool, args = {}) {
  return callTool('unreal', tool, args, 60_000);
}

// ── Phase 1: BP_Kael character blueprint ────────────────────────────────────

async function buildKaelCharacter(onProgress) {
  onProgress('🗡️ Phase 1: Creating BP_Kael character blueprint...');

  // Create the blueprint
  let r = await ue('create_blueprint', {
    name: 'BP_Kael',
    parent_class: 'ACharacter',
    blueprint_path: '/Game/Blueprints/Characters',
  });
  if (r?.status === 'error') return { success: false, error: `create_blueprint: ${r.error}` };
  onProgress('  ✓ BP_Kael blueprint created');

  // Add spring arm + camera
  await ue('add_component_to_blueprint', { blueprint_name: 'BP_Kael', component_type: 'SpringArmComponent', component_name: 'CameraBoom' });
  await ue('add_component_to_blueprint', { blueprint_name: 'BP_Kael', component_type: 'CameraComponent', component_name: 'FollowCamera' });
  onProgress('  ✓ Camera components added');

  // Add stats variables
  const vars = [
    { name: 'MaxHealth', type: 'float', default_value: 100.0 },
    { name: 'CurrentHealth', type: 'float', default_value: 100.0 },
    { name: 'MaxStamina', type: 'float', default_value: 100.0 },
    { name: 'CurrentStamina', type: 'float', default_value: 100.0 },
    { name: 'MoveSpeed', type: 'float', default_value: 600.0 },
    { name: 'bIsSprinting', type: 'bool', default_value: false },
    { name: 'bIsDodging', type: 'bool', default_value: false },
  ];
  for (const v of vars) {
    await ue('create_variable', { blueprint_name: 'BP_Kael', ...v });
  }
  onProgress('  ✓ Stats variables added');

  // Build basic movement graph
  await ue('add_event_node', { blueprint_name: 'BP_Kael', event_type: 'BeginPlay', graph_name: 'EventGraph' });
  await ue('add_event_node', { blueprint_name: 'BP_Kael', event_type: 'Tick', graph_name: 'EventGraph' });
  onProgress('  ✓ Event graph scaffolded');

  // Compile
  r = await ue('compile_blueprint', { blueprint_name: 'BP_Kael' });
  const compiled = r?.status !== 'error';
  onProgress(compiled ? '  ✓ BP_Kael compiled successfully' : `  ⚠️ Compile warnings (continuing): ${r?.error}`);

  return { success: true };
}

// ── Phase 2: BP_SCGameMode wiring ───────────────────────────────────────────

async function buildGameMode(onProgress) {
  onProgress('⚙️ Phase 2: Creating BP_SCGameMode...');

  let r = await ue('create_blueprint', {
    name: 'BP_SCGameMode',
    parent_class: 'AGameModeBase',
    blueprint_path: '/Game/Blueprints/Framework',
  });
  if (r?.status === 'error') return { success: false, error: `create_blueprint: ${r.error}` };

  await ue('set_blueprint_variable_properties', {
    blueprint_name: 'BP_SCGameMode',
    variable_name: 'DefaultPawnClass',
    new_value: '/Game/Blueprints/Characters/BP_Kael.BP_Kael_C',
  });
  onProgress('  ✓ DefaultPawnClass set to BP_Kael');

  r = await ue('compile_blueprint', { blueprint_name: 'BP_SCGameMode' });
  onProgress(r?.status !== 'error' ? '  ✓ BP_SCGameMode compiled' : `  ⚠️ ${r?.error}`);

  return { success: true };
}

// ── Phase 3: TestArena level setup ──────────────────────────────────────────

async function buildTestArena(onProgress) {
  onProgress('🏟️ Phase 3: Building TestArena level...');

  // Large floor
  await ue('spawn_actor', {
    type: 'StaticMeshActor',
    name: 'Arena_Floor',
    location: { x: 0, y: 0, z: 0 },
    rotation: { pitch: 0, yaw: 0, roll: 0 },
    scale: { x: 100, y: 100, z: 1 },
    static_mesh: '/Engine/BasicShapes/Plane.Plane',
  });
  onProgress('  ✓ Floor spawned');

  // Fix scale explicitly
  await ue('set_actor_transform', {
    name: 'Arena_Floor',
    location: { x: 0, y: 0, z: 0 },
    rotation: { pitch: 0, yaw: 0, roll: 0 },
    scale: { x: 100, y: 100, z: 1 },
  });

  // Sun
  await ue('spawn_actor', {
    type: 'DirectionalLight',
    name: 'Arena_Sun',
    location: { x: 0, y: 0, z: 2000 },
    rotation: { pitch: -50, yaw: 45, roll: 0 },
  });
  onProgress('  ✓ Directional light spawned');

  // Some surrounding walls so the arena feels enclosed
  const walls = [
    { name: 'Wall_N', x: 0, y: 5000, z: 200, rx: 0, ry: 0 },
    { name: 'Wall_S', x: 0, y: -5000, z: 200, rx: 0, ry: 0 },
    { name: 'Wall_E', x: 5000, y: 0, z: 200, rx: 0, ry: 90 },
    { name: 'Wall_W', x: -5000, y: 0, z: 200, rx: 0, ry: 90 },
  ];
  for (const w of walls) {
    await ue('spawn_actor', {
      type: 'StaticMeshActor',
      name: w.name,
      location: { x: w.x, y: w.y, z: w.z },
      rotation: { pitch: 0, yaw: w.ry, roll: 0 },
      scale: { x: 100, y: 1, z: 10 },
      static_mesh: '/Engine/BasicShapes/Cube.Cube',
    });
  }
  onProgress('  ✓ Arena walls placed');

  onProgress('  ⚠️ NOTE: Add PlayerStart manually in UE5 → Place Actors → search "Player Start" → drag to center');
  onProgress('  ⚠️ NOTE: Set World Settings → GameMode Override → BP_SCGameMode');
  onProgress('  ⚠️ NOTE: Save level as Maps/TestMaps/TestArena then press Play');

  return { success: true };
}

// ── Phase 4: Build pending region Blueprints ─────────────────────────────────

async function buildAllBlueprints(onProgress) {
  const progress = getBlueprintProgress();
  onProgress(`🧩 Phase 4: Building ${progress.pending} pending Blueprints (${progress.completed}/${progress.total} done)...`);

  let built = 0, failed = 0;
  while (true) {
    const result = await buildNextBlueprint();
    if (!result.success && result.message === 'All Blueprints built') break;
    if (result.success) {
      built++;
      onProgress(`  ✓ Built ${result.regionId} blueprint`);
    } else {
      failed++;
      onProgress(`  ✗ Failed: ${result.error}`);
    }
    // Small delay between blueprints to not overwhelm UE5
    await new Promise(r => setTimeout(r, 2000));
  }

  return { success: true, built, failed };
}

// ── Main entry ───────────────────────────────────────────────────────────────

export async function buildPlayableGame(onProgress = log.info.bind(log)) {
  const results = [];
  const startMs = Date.now();

  try {
    // Phase 1: Kael character
    const kaelResult = await buildKaelCharacter(onProgress);
    results.push({ phase: 'BP_Kael', ...kaelResult });
    if (!kaelResult.success) {
      onProgress(`❌ BP_Kael failed: ${kaelResult.error} — continuing anyway`);
    }

    // Phase 2: Game mode
    const gmResult = await buildGameMode(onProgress);
    results.push({ phase: 'BP_SCGameMode', ...gmResult });

    // Phase 3: TestArena
    const arenaResult = await buildTestArena(onProgress);
    results.push({ phase: 'TestArena', ...arenaResult });

    // Phase 4: All pending Blueprints
    const bpResult = await buildAllBlueprints(onProgress);
    results.push({ phase: 'Blueprints', ...bpResult });

    const elapsedMin = ((Date.now() - startMs) / 60000).toFixed(1);
    const succeeded = results.filter(r => r.success).length;

    onProgress(`\n✅ Build complete in ${elapsedMin} min — ${succeeded}/${results.length} phases succeeded`);
    onProgress('📋 Final steps in UE5:');
    onProgress('  1. Add PlayerStart actor to TestArena level');
    onProgress('  2. World Settings → GameMode Override → BP_SCGameMode');
    onProgress('  3. File → Save Current Level As → Maps/TestMaps/TestArena');
    onProgress('  4. Press Alt+P to Play!');

    return { success: true, results, elapsedMin };
  } catch (err) {
    log.error({ err: err.message }, 'buildPlayableGame failed');
    onProgress(`❌ Fatal error: ${err.message}`);
    return { success: false, error: err.message, results };
  }
}
