/**
 * modules/unreal/build-manifest.js — Master task queue for playable game.
 *
 * Tracks every task needed for a fully playable Shattered Crown session.
 * Persisted to disk. The autonomous loop pops the next pending task and executes it.
 *
 * Task shape: { id, type, phase, priority, status, params, attempts, error, completedAt }
 * Phases: core → gameplay → world → content
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getActiveGame } from './game-config.js';

function getManifestPath() {
  return getActiveGame().buildQueuePath;
}

// ── Initial task definitions ─────────────────────────────────────────────────

const INITIAL_TASKS = [
  // ── Phase -1: C++ foundation (runs before everything else) ─────────────────
  // Written to ShatteredCrown/Source/ + compiled via UBT. No UE5 editor needed.
  { id: 'cpp_character',   phase: 'foundation', priority: 310, type: 'generate_cpp', params: { systemType: 'character' } },
  { id: 'cpp_gamemode',    phase: 'foundation', priority: 309, type: 'generate_cpp', params: { systemType: 'game_mode' } },
  { id: 'cpp_playerctrl',  phase: 'foundation', priority: 308, type: 'generate_cpp', params: { systemType: 'player_controller' } },
  { id: 'cpp_interpreter', phase: 'foundation', priority: 307, type: 'generate_cpp', params: { systemType: 'logic_interpreter' } },

  // ── Phase 0: Planning (spatial AI pass — must run before populate) ─────────
  { id: 'plan_crossroads', phase: 'planning', priority: 200, type: 'plan_region', params: { regionId: 'CrossroadsHub' } },
  { id: 'plan_ashen',      phase: 'planning', priority: 199, type: 'plan_region', params: { regionId: 'AshenWilds' } },
  { id: 'plan_ironhold',   phase: 'planning', priority: 198, type: 'plan_region', params: { regionId: 'Ironhold' } },
  { id: 'plan_verdant',    phase: 'planning', priority: 197, type: 'plan_region', params: { regionId: 'VerdantReach' } },
  { id: 'plan_ember',      phase: 'planning', priority: 196, type: 'plan_region', params: { regionId: 'EmberPeaks' } },

  // ── Phase 1: Core (must be first — everything depends on these) ────────────
  { id: 'bp_kael',          phase: 'core',     priority: 100, type: 'blueprint', params: { bpType: 'player_controller', name: 'BP_Kael',       path: '/Game/Blueprints/Characters' } },
  { id: 'bp_gamemode',      phase: 'core',     priority: 99,  type: 'blueprint', params: { bpType: 'game_mode',         name: 'BP_SCGameMode', path: '/Game/Blueprints/Framework' } },
  { id: 'bp_playerctrl',   phase: 'core',     priority: 98,  type: 'blueprint', params: { bpType: 'player_controller_apc', name: 'BP_SCPlayerController', path: '/Game/Blueprints/Framework' } },
  { id: 'arena_level',     phase: 'core',     priority: 97,  type: 'level',     params: { name: 'TestArena' } },

  // ── Phase 2: Gameplay loop ─────────────────────────────────────────────────
  { id: 'bp_hud',          phase: 'gameplay', priority: 90,  type: 'blueprint', params: { bpType: 'hud',            name: 'BP_SCHUD',           path: '/Game/Blueprints/UI' } },
  { id: 'bp_combat',       phase: 'gameplay', priority: 89,  type: 'blueprint', params: { bpType: 'combat',         name: 'BP_CombatSystem',    path: '/Game/Blueprints/Combat' } },
  { id: 'bp_ability_ts',   phase: 'gameplay', priority: 88,  type: 'blueprint', params: { bpType: 'ability_system', name: 'BP_Ability_TimeSense',  path: '/Game/Blueprints/Abilities' } },
  { id: 'bp_ability_fire', phase: 'gameplay', priority: 87,  type: 'blueprint', params: { bpType: 'ability_system', name: 'BP_Ability_FireLance',  path: '/Game/Blueprints/Abilities' } },
  { id: 'bp_ability_vine', phase: 'gameplay', priority: 86,  type: 'blueprint', params: { bpType: 'ability_system', name: 'BP_Ability_VineGrab',   path: '/Game/Blueprints/Abilities' } },
  { id: 'bp_ability_water',phase: 'gameplay', priority: 85,  type: 'blueprint', params: { bpType: 'ability_system', name: 'BP_Ability_WaterJet',   path: '/Game/Blueprints/Abilities' } },
  { id: 'bp_ability_shield',phase:'gameplay', priority: 84,  type: 'blueprint', params: { bpType: 'ability_system', name: 'BP_Ability_ShieldWall', path: '/Game/Blueprints/Abilities' } },
  { id: 'bp_progression',  phase: 'gameplay', priority: 83,  type: 'blueprint', params: { bpType: 'progression',   name: 'BP_Progression',     path: '/Game/Blueprints/Systems' } },
  { id: 'bp_inventory',    phase: 'gameplay', priority: 82,  type: 'blueprint', params: { bpType: 'inventory',     name: 'BP_Inventory',       path: '/Game/Blueprints/Systems' } },
  { id: 'bp_save',         phase: 'gameplay', priority: 81,  type: 'blueprint', params: { bpType: 'save_system',   name: 'BP_SaveSystem',      path: '/Game/Blueprints/Systems' } },

  // ── Phase 3: World — CrossroadsHub BPs ────────────────────────────────────
  { id: 'bp_wayshrine',    phase: 'world',    priority: 70,  type: 'region_bp', params: { regionId: 'CrossroadsHub', bpName: 'BP_Wayshrine' } },
  { id: 'bp_campfire',     phase: 'world',    priority: 69,  type: 'region_bp', params: { regionId: 'CrossroadsHub', bpName: 'BP_CampfireAmbient' } },
  { id: 'bp_market_npc',  phase: 'world',    priority: 68,  type: 'region_bp', params: { regionId: 'CrossroadsHub', bpName: 'BP_MarketNPC' } },
  { id: 'bp_blacksmith',  phase: 'world',    priority: 67,  type: 'region_bp', params: { regionId: 'CrossroadsHub', bpName: 'BP_BlacksmithNPC' } },
  { id: 'bp_elder',       phase: 'world',    priority: 66,  type: 'region_bp', params: { regionId: 'CrossroadsHub', bpName: 'BP_ElderNPC' } },
  { id: 'bp_innkeeper',   phase: 'world',    priority: 65,  type: 'region_bp', params: { regionId: 'CrossroadsHub', bpName: 'BP_InnkeeperNPC' } },
  { id: 'bp_spawner',     phase: 'world',    priority: 64,  type: 'region_bp', params: { regionId: 'CrossroadsHub', bpName: 'BP_EnemySpawner_Hollow' } },

  // ── AshenWilds BPs ────────────────────────────────────────────────────────
  { id: 'bp_shard_altar',  phase: 'world',   priority: 60,  type: 'region_bp', params: { regionId: 'AshenWilds', bpName: 'BP_ShardAltar' } },
  { id: 'bp_ember_hazard', phase: 'world',   priority: 59,  type: 'region_bp', params: { regionId: 'AshenWilds', bpName: 'BP_EmberHazard' } },
  { id: 'bp_ember_glow',   phase: 'world',   priority: 58,  type: 'region_bp', params: { regionId: 'AshenWilds', bpName: 'BP_EmberGlowAmbient' } },
  { id: 'bp_ash_enemy',    phase: 'world',   priority: 57,  type: 'region_bp', params: { regionId: 'AshenWilds', bpName: 'BP_HollowSoldier' } },
  { id: 'bp_ash_boss',     phase: 'world',   priority: 56,  type: 'region_bp', params: { regionId: 'AshenWilds', bpName: 'BP_Boss_Voss' } },

  // ── Phase 3.5: Rulesets (before structures, no UE5 editor needed) ──────────
  // Claude generates JSON behavior rulesets read at runtime by ULogicInterpreter.
  { id: 'ruleset_combat',  phase: 'rulesets', priority: 50, type: 'generate_ruleset', params: { entityId: 'combat_base',  description: 'Base combat rules: attack, dodge, take damage, death' } },
  { id: 'ruleset_enemy',   phase: 'rulesets', priority: 49, type: 'generate_ruleset', params: { entityId: 'enemy_ash',    description: 'Ash Wilds enemy: patrol, aggro on sight, attack, flee at 20% hp' } },
  { id: 'ruleset_boss',    phase: 'rulesets', priority: 48, type: 'generate_ruleset', params: { entityId: 'boss_ash',     description: 'Ash boss: 3 phases, enrage at 50%, AoE at 25%' } },
  { id: 'ruleset_npc',     phase: 'rulesets', priority: 47, type: 'generate_ruleset', params: { entityId: 'npc_generic',  description: 'Friendly NPC: idle, greet player on approach, give quest, farewell' } },
  { id: 'ruleset_ability', phase: 'rulesets', priority: 46, type: 'generate_ruleset', params: { entityId: 'ability_base', description: 'Ability rules: cooldown, resource cost, cancel on stagger' } },

  // ── Phase 4: Content — structures & decoration ────────────────────────────
  { id: 'crossroads_hub',  phase: 'content',  priority: 40,  type: 'structure', params: { regionId: 'CrossroadsHub' } },
  { id: 'ashen_wilds',     phase: 'content',  priority: 39,  type: 'structure', params: { regionId: 'AshenWilds' } },
  { id: 'ironhold',        phase: 'content',  priority: 38,  type: 'structure', params: { regionId: 'Ironhold' } },
  { id: 'verdant_reach',   phase: 'content',  priority: 37,  type: 'structure', params: { regionId: 'VerdantReach' } },
  { id: 'ember_peaks',     phase: 'content',  priority: 36,  type: 'structure', params: { regionId: 'EmberPeaks' } },

  // ── Phase 5: Populate — import FBX assets + place in levels ───────────────
  { id: 'populate_crossroads', phase: 'content', priority: 30, type: 'populate_region', params: { regionId: 'CrossroadsHub' } },
  { id: 'populate_ashen',      phase: 'content', priority: 29, type: 'populate_region', params: { regionId: 'AshenWilds' } },
  { id: 'populate_ironhold',   phase: 'content', priority: 28, type: 'populate_region', params: { regionId: 'Ironhold' } },
  { id: 'populate_verdant',    phase: 'content', priority: 27, type: 'populate_region', params: { regionId: 'VerdantReach' } },
  { id: 'populate_ember',      phase: 'content', priority: 26, type: 'populate_region', params: { regionId: 'EmberPeaks' } },
];

// ── CRUD ─────────────────────────────────────────────────────────────────────

export function loadQueue() {
  const path = getManifestPath();
  if (!existsSync(path)) return initQueue();
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch { return initQueue(); }
}

function initQueue() {
  const q = {
    version: 1,
    createdAt: Date.now(),
    tasks: INITIAL_TASKS.map(t => ({
      ...t,
      status: 'pending',
      attempts: 0,
      error: null,
      completedAt: null,
    })),
  };
  saveQueue(q);
  return q;
}

export function saveQueue(q) {
  writeFileSync(getManifestPath(), JSON.stringify(q, null, 2), 'utf-8');
}

export function nextTask(q) {
  return q.tasks
    .filter(t => t.status === 'pending' || (t.status === 'failed' && t.attempts < 3))
    .sort((a, b) => b.priority - a.priority)[0] || null;
}

export function markDone(q, taskId) {
  const t = q.tasks.find(t => t.id === taskId);
  if (t) { t.status = 'completed'; t.completedAt = Date.now(); }
  saveQueue(q);
}

export function markFailed(q, taskId, error) {
  const t = q.tasks.find(t => t.id === taskId);
  if (t) { t.status = 'failed'; t.attempts = (t.attempts || 0) + 1; t.error = error; }
  saveQueue(q);
}

export function getProgress(q) {
  const total = q.tasks.length;
  const done  = q.tasks.filter(t => t.status === 'completed').length;
  const failed = q.tasks.filter(t => t.status === 'failed').length;
  const pending = total - done - failed;
  const pct = Math.round((done / total) * 100);
  return { total, done, failed, pending, pct };
}
