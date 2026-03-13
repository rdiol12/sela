/**
 * modules/unreal/blueprint-integration.js — Batch Blueprint construction & cross-system wiring.
 *
 * ms_10: Build all 60+ pending gameplay Blueprints across 9 regions,
 * place them in levels, and wire cross-system connections.
 *
 * Four phases:
 *  1. Build — create_blueprint → variables → event graph → compile (via blueprint-builder)
 *  2. Place — spawn Blueprint actors at 48 designated positions per region
 *  3. Connect — wire 30 event dispatchers between systems (combat↔player, inventory↔loot, etc.)
 *  4. Compile — recompile all modified BPs for consistency
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { callTool } from '../../lib/mcp-gateway.js';
import { createLogger } from '../../lib/logger.js';
import { getActiveGame } from './game-config.js';
import { buildNextBlueprint, getBlueprintProgress } from './blueprint-builder.js';

const log = createLogger('blueprint-integration');

// ── Pipeline state persistence — save/resume for long-running integration ────

const PIPELINE_STATE_FILE = join(process.cwd(), 'data', 'state', 'blueprint-pipeline-state.json');

function loadPipelineState() {
  if (!existsSync(PIPELINE_STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(PIPELINE_STATE_FILE, 'utf-8'));
  } catch { return null; }
}

function savePipelineState(state) {
  writeFileSync(PIPELINE_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function clearPipelineState() {
  if (existsSync(PIPELINE_STATE_FILE)) {
    const { unlinkSync } = require('fs');
    try { unlinkSync(PIPELINE_STATE_FILE); } catch { /* ignore */ }
  }
}

function loadManifest() {
  const p = getActiveGame().regionManifestPath;
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8'));
}

function saveManifest(manifest) {
  writeFileSync(getActiveGame().regionManifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

// ── Placement positions for Blueprint actors per region ───────────────────────
// Each entry maps BP name → world position [x, y, z] where the actor spawns.

const BLUEPRINT_PLACEMENTS = {
  CrossroadsHub: {
    BP_Wayshrine:              [0, 0, 50],
    BP_CampfireAmbient:        [-1000, 800, 0],
    BP_MarketNPC:              [1500, 200, 0],
    BP_BlacksmithNPC:          [2000, -500, 0],
    BP_ElderNPC:               [-500, -300, 0],
    BP_InnkeeperNPC:           [2500, -1500, 0],
    BP_EnemySpawner_Hollow:    [3500, 3500, 0],
  },
  AshenWilds: {
    BP_ShardAltar:             [3000, 2000, 50],
    BP_LavaPoolDamage:         [4000, 0, 0],
    BP_EmberParticles:         [0, 0, 200],
    BP_AshenwoodBossArena:     [-2000, -3000, 0],
    BP_EnemySpawner_Wolf:      [1500, -2000, 0],
    BP_EnemySpawner_Hollow:    [-3500, 1000, 0],
  },
  Ironhold: {
    BP_FortressGate:           [0, -4000, 0],
    BP_ForgeMinigame:          [1000, 500, 0],
    BP_GeneralVossBoss:        [0, 2000, 100],
    BP_TrainingDummy:          [-1500, -1000, 0],
    BP_EnemySpawner_Sentinel:  [3000, -3000, 0],
    BP_EnemySpawner_Archer:    [-3000, -3000, 200],
  },
  VerdantReach: {
    BP_RootShrine:             [-4000, 0, 0],
    BP_SporeDamage:            [2000, -2000, 0],
    BP_WardenSylthaBoss:       [0, 5000, 0],
    BP_EnemySpawner_Crawler:   [-2000, 3000, 0],
    BP_EnemySpawner_VineTrap:  [3000, -3000, 0],
    BP_PoisonFogZone:          [1000, 4000, 0],
  },
  SunkenHalls: {
    BP_SealedDoor:             [0, 4000, 0],
    BP_WaterRiseMechanic:      [0, 0, -100],
    BP_ScholarDrenBoss:        [-3000, 3000, 0],
    BP_UnderwaterSwimZone:     [1000, -1000, -200],
    BP_EnemySpawner_Wraith:    [2000, 2000, 0],
    BP_TreasurePuzzle:         [-3000, 2000, -50],
  },
  EmberPeaks: {
    BP_ForgeRuins:             [-3000, 2000, 0],
    BP_MagmaVentDamage:        [2000, -3000, 0],
    BP_ForgeKeeperAshkaBoss:   [0, 4000, 200],
    BP_EnemySpawner_Elemental: [-2000, -2000, 0],
    BP_EnemySpawner_Golem:     [4000, 2000, 0],
    BP_LavaPlatform:           [3000, 0, 100],
  },
  Aethermere: {
    BP_CosmicGateway:          [0, 6000, 0],
    BP_VoidDamage:             [2000, -1000, 300],
    BP_MordaenBoss:            [-3000, 4000, 500],
    BP_HollowKingBoss:         [0, 0, 800],
    BP_EnemySpawner_Revenant:  [4000, 2000, 300],
    BP_GravityPuzzle:          [3000, -2000, 0],
    BP_VoidTeleporter:         [-4000, -3000, 100],
  },
  TheWilds: {
    BP_StandingStone:      [4000, -3000, 0],     // Standing Stone landmark
    BP_WildlifeAmbient:    [0, 0, 100],           // Near Ancient Oak — ambient audio emitter
    BP_HunterRynn:         [-3000, 2000, 0],      // Hunter Camp — NPC
    BP_DruidessFayn:       [-2000, -1500, 0],     // Trail Marker area — NPC
  },
  // Global BPs don't have world placements — they're game-wide systems
  Global: {},
};

// ── Connection graph — which BPs wire to which via event dispatchers ──────────
// Each connection defines: source BP, target BP, dispatcher name, and data type.

const CONNECTION_GRAPH = [
  // Player ↔ Combat
  { from: 'BP_PlayerCharacter', to: 'BP_CombatSystem', dispatcher: 'OnAttackInput', dataType: 'AttackType' },
  { from: 'BP_CombatSystem', to: 'BP_PlayerCharacter', dispatcher: 'OnDamageTaken', dataType: 'float' },
  { from: 'BP_CombatSystem', to: 'BP_PlayerHUD', dispatcher: 'OnHealthChanged', dataType: 'float' },

  // Combat ↔ Shard powers
  { from: 'BP_ShardPowerSystem', to: 'BP_CombatSystem', dispatcher: 'OnShardAbilityUsed', dataType: 'ShardType' },
  { from: 'BP_CombatSystem', to: 'BP_ShardPowerSystem', dispatcher: 'OnEnemyKilled', dataType: 'int' },

  // Inventory ↔ Loot
  { from: 'BP_LootSystem', to: 'BP_InventorySystem', dispatcher: 'OnItemPickedUp', dataType: 'ItemStruct' },
  { from: 'BP_InventorySystem', to: 'BP_CraftingSystem', dispatcher: 'OnMaterialsChanged', dataType: 'int' },
  { from: 'BP_InventorySystem', to: 'BP_PlayerHUD', dispatcher: 'OnInventoryChanged', dataType: 'int' },

  // Quest ↔ Dialogue
  { from: 'BP_DialogueSystem', to: 'BP_QuestJournal', dispatcher: 'OnQuestAccepted', dataType: 'QuestID' },
  { from: 'BP_QuestJournal', to: 'BP_PlayerHUD', dispatcher: 'OnObjectiveUpdated', dataType: 'string' },
  { from: 'BP_QuestJournal', to: 'BP_LevelingSystem', dispatcher: 'OnQuestCompleted', dataType: 'int' },

  // Leveling ↔ Player
  { from: 'BP_LevelingSystem', to: 'BP_PlayerCharacter', dispatcher: 'OnLevelUp', dataType: 'int' },
  { from: 'BP_LevelingSystem', to: 'BP_PlayerHUD', dispatcher: 'OnXPGained', dataType: 'int' },
  { from: 'BP_LevelingSystem', to: 'BP_ShardPowerSystem', dispatcher: 'OnSkillPointGained', dataType: 'int' },

  // Save/Load ↔ everything
  { from: 'BP_SaveLoadSystem', to: 'BP_PlayerCharacter', dispatcher: 'OnGameLoaded', dataType: 'SaveData' },
  { from: 'BP_SaveLoadSystem', to: 'BP_InventorySystem', dispatcher: 'OnInventoryLoaded', dataType: 'SaveData' },
  { from: 'BP_SaveLoadSystem', to: 'BP_QuestJournal', dispatcher: 'OnQuestsLoaded', dataType: 'SaveData' },

  // Corruption ↔ systems
  { from: 'BP_CorruptionMeter', to: 'BP_AudioManager', dispatcher: 'OnCorruptionChanged', dataType: 'float' },
  { from: 'BP_CorruptionMeter', to: 'BP_PlayerHUD', dispatcher: 'OnCorruptionLevelChanged', dataType: 'float' },
  { from: 'BP_CorruptionMeter', to: 'BP_CorruptionFogController', dispatcher: 'OnCorruptionChanged', dataType: 'float' },
  { from: 'BP_RegionTransition', to: 'BP_CorruptionFogController', dispatcher: 'OnRegionChanged', dataType: 'string' },
  { from: 'BP_RegionTransition', to: 'BP_LightCookieController', dispatcher: 'OnRegionChanged', dataType: 'string' },
  { from: 'BP_CorruptionMeter', to: 'BP_LightCookieController', dispatcher: 'OnCorruptionChanged', dataType: 'float' },

  // Map ↔ Player
  { from: 'BP_MapSystem', to: 'BP_PlayerCharacter', dispatcher: 'OnFastTravel', dataType: 'vector' },

  // Audio ↔ Combat
  { from: 'BP_CombatSystem', to: 'BP_AudioManager', dispatcher: 'OnCombatStateChanged', dataType: 'bool' },

  // Tutorial triggers
  { from: 'BP_TutorialSystem', to: 'BP_PlayerHUD', dispatcher: 'OnTutorialPrompt', dataType: 'string' },

  // Pause
  { from: 'BP_PauseMenu', to: 'BP_SaveLoadSystem', dispatcher: 'OnSaveRequested', dataType: 'int' },
  { from: 'BP_PauseMenu', to: 'BP_AudioManager', dispatcher: 'OnVolumeChanged', dataType: 'float' },

  // TheWilds — region-specific BP connections to global systems
  { from: 'BP_StandingStone', to: 'BP_QuestJournal', dispatcher: 'OnShardDiscovered', dataType: 'ShardType' },
  { from: 'BP_StandingStone', to: 'BP_ShardPowerSystem', dispatcher: 'OnShardAttuned', dataType: 'ShardType' },
  { from: 'BP_HunterRynn', to: 'BP_DialogueSystem', dispatcher: 'OnDialogueStarted', dataType: 'string' },
  { from: 'BP_DruidessFayn', to: 'BP_DialogueSystem', dispatcher: 'OnDruidDialogueStarted', dataType: 'string' },
  { from: 'BP_WildlifeAmbient', to: 'BP_AudioManager', dispatcher: 'OnAmbientZoneEntered', dataType: 'string' },
  { from: 'BP_HunterRynn', to: 'BP_QuestJournal', dispatcher: 'OnHunterQuestOffered', dataType: 'QuestID' },
];

// ── Phase 1: Build all pending Blueprints ─────────────────────────────────────

/**
 * Build ALL pending Blueprints across all regions in sequence.
 * Uses existing buildNextBlueprint() from blueprint-builder.js.
 * Returns { success, built, failed, skipped, results[] }.
 */
export async function buildAllBlueprints() {
  const results = [];
  let built = 0, failed = 0, skipped = 0;
  const maxIterations = 80; // Safety cap

  log.info('Starting batch Blueprint construction');

  for (let i = 0; i < maxIterations; i++) {
    const progress = getBlueprintProgress();
    if (progress.pending === 0) {
      log.info({ built, failed, total: progress.total }, 'All Blueprints constructed');
      break;
    }

    try {
      const result = await buildNextBlueprint();

      if (result.message === 'All Blueprints built') {
        break;
      }

      if (result.success) {
        built++;
        log.info({ bp: result.blueprintName, region: result.regionId, steps: result.steps?.length },
          'Blueprint built successfully');
      } else {
        failed++;
        log.warn({ bp: result.blueprintName, error: result.error }, 'Blueprint build failed');
      }

      results.push(result);
    } catch (err) {
      failed++;
      log.error({ err: err.message, iteration: i }, 'Blueprint build error');
      results.push({ success: false, error: err.message });
    }
  }

  return { success: failed === 0, built, failed, skipped, results };
}

// ── Phase 2: Place Blueprint actors in levels ─────────────────────────────────

/**
 * Spawn Blueprint actors at their designated positions in each region.
 * Only spawns BPs that have status='completed' in the manifest.
 * Returns { success, placed, errors[] }.
 */
export async function placeAllBlueprintActors() {
  const manifest = loadManifest();
  if (!manifest) return { success: false, error: 'No manifest' };

  let placed = 0;
  const errors = [];

  for (const [regionId, positions] of Object.entries(BLUEPRINT_PLACEMENTS)) {
    if (regionId === 'Global') continue; // Global BPs have no world placement

    const region = manifest.regions[regionId];
    if (!region) continue;

    const completedBPs = (region.blueprints || [])
      .filter(bp => bp.status === 'completed')
      .map(bp => bp.name);

    for (const [bpName, pos] of Object.entries(positions)) {
      if (!completedBPs.includes(bpName)) {
        log.debug({ bp: bpName, region: regionId }, 'BP not yet completed — skipping placement');
        continue;
      }

      try {
        const actorName = `${regionId}_${bpName}`;
        const result = await callTool('unreal', 'spawn_physics_blueprint_actor', {
          blueprint_name: bpName,
          actor_name: actorName,
          location: { X: pos[0], Y: pos[1], Z: pos[2] },
          rotation: { Pitch: 0, Yaw: 0, Roll: 0 },
          simulate_physics: false,
        }, 30_000);

        if (result?.success !== false) {
          placed++;
          log.info({ bp: bpName, region: regionId, pos }, 'BP actor placed');
        } else {
          errors.push({ bp: bpName, region: regionId, error: result?.message || 'spawn failed' });
        }
      } catch (err) {
        errors.push({ bp: bpName, region: regionId, error: err.message });
        log.warn({ bp: bpName, region: regionId, err: err.message }, 'BP placement failed');
      }
    }
  }

  return { success: errors.length === 0, placed, errors };
}

// ── Phase 3: Wire cross-system connections ────────────────────────────────────

/**
 * Create event dispatcher variables on source BPs and reference variables on targets.
 * This establishes the communication channels between game systems.
 * Returns { success, connected, errors[] }.
 */
export async function connectBlueprints() {
  const manifest = loadManifest();
  if (!manifest) return { success: false, error: 'No manifest' };

  // Collect all completed BP names across all regions
  const completedBPs = new Set();
  for (const region of Object.values(manifest.regions || {})) {
    for (const bp of region.blueprints || []) {
      if (bp.status === 'completed') completedBPs.add(bp.name);
    }
  }

  let connected = 0;
  const errors = [];

  for (const conn of CONNECTION_GRAPH) {
    const { from, to, dispatcher, dataType } = conn;

    // Only wire connections where both BPs exist and are completed
    if (!completedBPs.has(from) || !completedBPs.has(to)) {
      log.debug({ from, to }, 'Skipping connection — one or both BPs not built');
      continue;
    }

    try {
      // 1. Add event dispatcher variable on source BP
      await callTool('unreal', 'create_variable', {
        blueprint_name: from,
        variable_name: dispatcher,
        variable_type: 'delegate',
        default_value: null,
        is_public: true,
        category: 'EventDispatchers',
      }, 15_000);

      // 2. Add reference variable on target BP pointing to source
      const refVarName = `${from.replace('BP_', '')}Ref`;
      await callTool('unreal', 'create_variable', {
        blueprint_name: to,
        variable_name: refVarName,
        variable_type: 'object',
        default_value: null,
        is_public: true,
        category: 'SystemReferences',
      }, 15_000);

      // 3. Add a call dispatcher node in source BP's graph
      try {
        await callTool('unreal', 'add_node', {
          blueprint_name: from,
          node_type: 'CallFunction',
          function_name: `Call_${dispatcher}`,
          pos_x: 600 + connected * 200,
          pos_y: 200,
        }, 15_000);
      } catch (_) {
        // Graph node addition is nice-to-have; variables are the critical part
      }

      connected++;
      log.info({ from, to, dispatcher }, 'Systems connected');
    } catch (err) {
      errors.push({ from, to, dispatcher, error: err.message });
      log.warn({ from, to, err: err.message }, 'Connection failed');
    }
  }

  return { success: errors.length < CONNECTION_GRAPH.length / 2, connected, errors };
}

// ── Phase 4: Compile all modified BPs ─────────────────────────────────────────

/**
 * Re-compile all Blueprints that were modified during connection phase.
 */
async function recompileModifiedBlueprints() {
  const manifest = loadManifest();
  if (!manifest) return { compiled: 0, errors: 0 };

  const bpsToCompile = new Set();
  for (const conn of CONNECTION_GRAPH) {
    bpsToCompile.add(conn.from);
    bpsToCompile.add(conn.to);
  }

  let compiled = 0, compileErrors = 0;

  for (const bpName of bpsToCompile) {
    try {
      await callTool('unreal', 'compile_blueprint', {
        blueprint_name: bpName,
      }, 30_000);
      compiled++;
    } catch (err) {
      compileErrors++;
      log.warn({ bp: bpName, err: err.message }, 'Recompile failed');
    }
  }

  return { compiled, errors: compileErrors };
}

// ── Master orchestrator ──────────────────────────────────────────────────────

/**
 * Execute the full Blueprint integration pipeline:
 *  Phase 1: Build all pending BPs
 *  Phase 2: Place BP actors in levels
 *  Phase 3: Wire cross-system connections
 *  Phase 4: Recompile modified BPs
 *
 * Updates region manifest on completion.
 */
export async function integrateAllBlueprints({ resume = true } = {}) {
  log.info('=== Blueprint Integration Pipeline — ms_10 ===');
  const startTime = Date.now();

  // Check for resumable state
  let state = resume ? loadPipelineState() : null;
  const startPhase = state?.completedPhase ? state.completedPhase + 1 : 1;
  if (state && startPhase > 1) {
    log.info({ resumeFromPhase: startPhase }, 'Resuming interrupted pipeline');
  }

  let buildResult = state?.buildResult || { built: 0, failed: 0 };
  let placeResult = state?.placeResult || { placed: 0, errors: [] };
  let connectResult = state?.connectResult || { connected: 0, errors: [] };
  let compileResult = state?.compileResult || { compiled: 0, errors: 0 };

  // Phase 1: Build
  if (startPhase <= 1) {
    log.info('Phase 1/4: Building all pending Blueprints...');
    buildResult = await buildAllBlueprints();
    log.info({ built: buildResult.built, failed: buildResult.failed }, 'Phase 1 complete');
    savePipelineState({ completedPhase: 1, buildResult, startTime: startTime });
  }

  // Phase 2: Place
  if (startPhase <= 2) {
    log.info('Phase 2/4: Placing Blueprint actors in levels...');
    placeResult = await placeAllBlueprintActors();
    log.info({ placed: placeResult.placed }, 'Phase 2 complete');
    savePipelineState({ completedPhase: 2, buildResult, placeResult, startTime: state?.startTime || startTime });
  }

  // Phase 3: Connect
  if (startPhase <= 3) {
    log.info('Phase 3/4: Wiring cross-system connections...');
    connectResult = await connectBlueprints();
    log.info({ connected: connectResult.connected }, 'Phase 3 complete');
    savePipelineState({ completedPhase: 3, buildResult, placeResult, connectResult, startTime: state?.startTime || startTime });
  }

  // Phase 4: Recompile
  if (startPhase <= 4) {
    log.info('Phase 4/4: Recompiling modified Blueprints...');
    compileResult = await recompileModifiedBlueprints();
    log.info({ compiled: compileResult.compiled }, 'Phase 4 complete');
  }

  // Clear pipeline state — all phases complete
  clearPipelineState();

  // Update manifest — mark Global region progress
  const manifest = loadManifest();
  if (manifest && manifest.regions.Global) {
    manifest.regions.Global.completedSteps = ['structures', 'assets', 'lighting', 'materials'];
    manifest.regions.Global.status = 'completed';
    manifest.regions.Global.buildNotes =
      `Blueprint integration completed ${new Date().toISOString()}. ` +
      `Built: ${buildResult.built}, Placed: ${placeResult.placed}, ` +
      `Connected: ${connectResult.connected}/${CONNECTION_GRAPH.length}, ` +
      `Compiled: ${compileResult.compiled}. Duration: ${Math.round((Date.now() - startTime) / 1000)}s.`;
    saveManifest(manifest);
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);

  const summary = {
    success: buildResult.built > 0 || placeResult.placed > 0,
    duration: `${elapsed}s`,
    phase1_build: { built: buildResult.built, failed: buildResult.failed },
    phase2_place: { placed: placeResult.placed, errors: placeResult.errors?.length || 0 },
    phase3_connect: { connected: connectResult.connected, total: CONNECTION_GRAPH.length },
    phase4_compile: { compiled: compileResult.compiled, errors: compileResult.errors },
    finalProgress: getBlueprintProgress(),
    totalPlacements: Object.values(BLUEPRINT_PLACEMENTS)
      .reduce((sum, region) => sum + Object.keys(region).length, 0),
    totalConnections: CONNECTION_GRAPH.length,
  };

  log.info(summary, 'Blueprint integration pipeline complete');
  return summary;
}

// ── Exports for tools and briefs ─────────────────────────────────────────────

/**
 * Get a detailed integration status report.
 */
export function getIntegrationStatus() {
  const progress = getBlueprintProgress();
  const manifest = loadManifest();

  const regionStatus = {};
  if (manifest) {
    for (const [id, region] of Object.entries(manifest.regions || {})) {
      const bps = region.blueprints || [];
      regionStatus[id] = {
        total: bps.length,
        completed: bps.filter(b => b.status === 'completed').length,
        pending: bps.filter(b => b.status === 'pending').length,
        failed: bps.filter(b => b.status === 'failed').length,
      };
    }
  }

  return {
    ...progress,
    connectionsDefined: CONNECTION_GRAPH.length,
    placementsDefined: Object.values(BLUEPRINT_PLACEMENTS)
      .reduce((sum, region) => sum + Object.keys(region).length, 0),
    regionStatus,
  };
}

/**
 * Export the full integration specification as JSON.
 */
export function exportIntegrationSpec() {
  const spec = {
    generatedAt: new Date().toISOString(),
    source: 'blueprint-integration.js',
    placements: BLUEPRINT_PLACEMENTS,
    connections: CONNECTION_GRAPH,
    totalPlacements: Object.values(BLUEPRINT_PLACEMENTS)
      .reduce((sum, region) => sum + Object.keys(region).length, 0),
    totalConnections: CONNECTION_GRAPH.length,
  };

  const outPath = join(
    getActiveGame().assetsRoot || 'workspace/shattered-crown/Assets',
    'blueprint-integration-spec.json',
  );

  writeFileSync(outPath, JSON.stringify(spec, null, 2), 'utf-8');
  log.info({ path: outPath }, 'Integration spec exported');
  return { success: true, path: outPath, ...spec };
}

export { CONNECTION_GRAPH, BLUEPRINT_PLACEMENTS };
