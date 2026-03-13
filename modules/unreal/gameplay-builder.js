/**
 * modules/unreal/gameplay-builder.js — Full gameplay loop builder.
 *
 * Builds Blueprints for every gameplay system:
 *   player_controller, game_mode, hud, combat, ability_system,
 *   progression, inventory, save_system, player_controller_apc
 *
 * Also builds the TestArena level (floor, walls, lighting, spawn point via GameMode).
 */

import { callTool } from '../../lib/mcp-gateway.js';
import { createLogger } from '../../lib/logger.js';
import { getCombatSystemVars, getCombatSystemFunctions } from './combo-balance.js';

const log = createLogger('gameplay-builder');

async function ue(tool, args = {}, timeout = 60_000) {
  try {
    return await callTool('unreal', tool, args, timeout);
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

// ── Blueprint type → build function ─────────────────────────────────────────

const BUILDERS = {
  player_controller: buildKael,
  game_mode:         buildGameMode,
  player_controller_apc: buildPlayerController,
  hud:               buildHUD,
  combat:            buildCombat,
  ability_system:    buildAbility,
  progression:       buildProgression,
  inventory:         buildInventory,
  save_system:       buildSaveSystem,
};

export async function buildGameplayBlueprint(bpType, name, path) {
  const builder = BUILDERS[bpType];
  if (!builder) return { success: false, error: `Unknown bpType: ${bpType}` };
  return builder(name, path);
}

// ── Shared helpers ───────────────────────────────────────────────────────────

async function createBP(name, parentClass, path) {
  const r = await ue('create_blueprint', { name, parent_class: parentClass, blueprint_path: path });
  return r?.status !== 'error';
}

async function addComp(bp, type, compName) {
  return ue('add_component_to_blueprint', { blueprint_name: bp, component_type: type, component_name: compName });
}

async function addVar(bp, name, type, defaultValue) {
  return ue('create_variable', { blueprint_name: bp, name, type, default_value: defaultValue });
}

async function addEvent(bp, eventType) {
  return ue('add_event_node', { blueprint_name: bp, event_type: eventType, graph_name: 'EventGraph' });
}

async function compile(bp) {
  const r = await ue('compile_blueprint', { blueprint_name: bp });
  return r?.status !== 'error';
}

// ── BP_Kael — Player character ───────────────────────────────────────────────

async function buildKael(name, path) {
  if (!await createBP(name, 'ACharacter', path)) return { success: false, error: 'create failed' };

  await addComp(name, 'SpringArmComponent', 'CameraBoom');
  await addComp(name, 'CameraComponent', 'FollowCamera');
  await addComp(name, 'SphereComponent', 'LockOnSensor');
  await addComp(name, 'AudioComponent', 'FootstepAudio');

  const vars = [
    ['MaxHealth', 'float', 100.0], ['CurrentHealth', 'float', 100.0],
    ['MaxStamina', 'float', 100.0], ['CurrentStamina', 'float', 100.0],
    ['MaxMana', 'float', 50.0], ['CurrentMana', 'float', 50.0],
    ['MoveSpeed', 'float', 600.0], ['SprintMultiplier', 'float', 1.5],
    ['bIsSprinting', 'bool', false], ['bIsDodging', 'bool', false],
    ['bIsBlocking', 'bool', false], ['bIsLockedOn', 'bool', false],
    ['PlayerLevel', 'int', 1], ['CurrentXP', 'int', 0],
    ['CorruptionLevel', 'float', 0.0], ['bIsCorrupted', 'bool', false],
  ];
  for (const [n, t, d] of vars) await addVar(name, n, t, d);

  await addEvent(name, 'BeginPlay');
  await addEvent(name, 'Tick');

  // Movement input function
  await ue('create_function', { blueprint_name: name, function_name: 'HandleMovementInput' });
  await ue('create_function', { blueprint_name: name, function_name: 'HandleCameraInput' });
  await ue('create_function', { blueprint_name: name, function_name: 'StartSprint' });
  await ue('create_function', { blueprint_name: name, function_name: 'StopSprint' });
  await ue('create_function', { blueprint_name: name, function_name: 'DodgeRoll' });
  await ue('create_function', { blueprint_name: name, function_name: 'TakeDamage_Kael' });
  await ue('create_function', { blueprint_name: name, function_name: 'Die' });

  const ok = await compile(name);
  return { success: ok };
}

// ── BP_SCGameMode — Game mode ────────────────────────────────────────────────

async function buildGameMode(name, path) {
  if (!await createBP(name, 'AGameModeBase', path)) return { success: false, error: 'create failed' };

  await ue('set_blueprint_variable_properties', {
    blueprint_name: name,
    variable_name: 'DefaultPawnClass',
    new_value: '/Game/Blueprints/Characters/BP_Kael.BP_Kael_C',
  });
  await ue('set_blueprint_variable_properties', {
    blueprint_name: name,
    variable_name: 'HUDClass',
    new_value: '/Game/Blueprints/UI/BP_SCHUD.BP_SCHUD_C',
  });
  await ue('set_blueprint_variable_properties', {
    blueprint_name: name,
    variable_name: 'PlayerControllerClass',
    new_value: '/Game/Blueprints/Framework/BP_SCPlayerController.BP_SCPlayerController_C',
  });

  const ok = await compile(name);
  return { success: ok };
}

// ── BP_SCPlayerController ────────────────────────────────────────────────────

async function buildPlayerController(name, path) {
  if (!await createBP(name, 'APlayerController', path)) return { success: false, error: 'create failed' };

  await addVar(name, 'bShowMouseCursor', 'bool', false);
  await addEvent(name, 'BeginPlay');
  await ue('create_function', { blueprint_name: name, function_name: 'SetupInputMappings' });
  await ue('create_function', { blueprint_name: name, function_name: 'OpenInventory' });
  await ue('create_function', { blueprint_name: name, function_name: 'TogglePause' });

  const ok = await compile(name);
  return { success: ok };
}

// ── BP_SCHUD — HUD ───────────────────────────────────────────────────────────

async function buildHUD(name, path) {
  if (!await createBP(name, 'AHUD', path)) return { success: false, error: 'create failed' };

  await addVar(name, 'HealthPercent', 'float', 1.0);
  await addVar(name, 'StaminaPercent', 'float', 1.0);
  await addVar(name, 'ManaPercent', 'float', 1.0);
  await addVar(name, 'CorruptionPercent', 'float', 0.0);
  await addVar(name, 'bShowInteractPrompt', 'bool', false);
  await addVar(name, 'InteractPromptText', 'string', '');
  await addVar(name, 'ActiveAbilitySlot', 'int', 0);

  await addEvent(name, 'BeginPlay');
  await ue('create_function', { blueprint_name: name, function_name: 'DrawHealthBar' });
  await ue('create_function', { blueprint_name: name, function_name: 'DrawStaminaBar' });
  await ue('create_function', { blueprint_name: name, function_name: 'DrawAbilitySlots' });
  await ue('create_function', { blueprint_name: name, function_name: 'ShowInteractPrompt' });
  await ue('create_function', { blueprint_name: name, function_name: 'HideInteractPrompt' });
  await ue('create_function', { blueprint_name: name, function_name: 'ShowDamageNumber' });

  const ok = await compile(name);
  return { success: ok };
}

// ── BP_CombatSystem ──────────────────────────────────────────────────────────

async function buildCombat(name, path) {
  if (!await createBP(name, 'AActor', path)) return { success: false, error: 'create failed' };

  await addComp(name, 'BoxComponent', 'WeaponHitbox');

  const vars = [
    ['BaseDamage', 'float', 25.0], ['ComboCount', 'int', 0],
    ['MaxCombo', 'int', 3], ['ComboWindowMs', 'float', 800.0],
    ['bIsAttacking', 'bool', false], ['bParryWindow', 'bool', false],
    ['ParryDurationMs', 'float', 200.0], ['DodgeIFramesMs', 'float', 300.0],
    ['StaminaCostLight', 'float', 15.0], ['StaminaCostHeavy', 'float', 30.0],
    ['StaminaCostDodge', 'float', 25.0], ['StaminaCostParry', 'float', 20.0],
  ];
  for (const [n, t, d] of vars) await addVar(name, n, t, d);

  // Shard Momentum & combo balance variables (from combo-balance.js)
  for (const [varName, varType, defaultVal] of getCombatSystemVars()) {
    await addVar(name, varName, varType, defaultVal);
  }

  await addEvent(name, 'BeginPlay');
  await ue('create_function', { blueprint_name: name, function_name: 'LightAttack' });
  await ue('create_function', { blueprint_name: name, function_name: 'HeavyAttack' });
  await ue('create_function', { blueprint_name: name, function_name: 'ComboExtend' });
  await ue('create_function', { blueprint_name: name, function_name: 'Parry' });
  await ue('create_function', { blueprint_name: name, function_name: 'CheckHit' });
  await ue('create_function', { blueprint_name: name, function_name: 'ApplyDamage_Combat' });
  await ue('create_function', { blueprint_name: name, function_name: 'ResetCombo' });

  // Combo balance functions (Shard Momentum, Crown Pulse, resonance)
  for (const fn of getCombatSystemFunctions()) {
    await ue('create_function', { blueprint_name: name, function_name: fn });
  }

  const ok = await compile(name);
  return { success: ok };
}

// ── BP_Ability_* — Shard abilities ──────────────────────────────────────────

async function buildAbility(name, path) {
  if (!await createBP(name, 'AActor', path)) return { success: false, error: 'create failed' };

  await addComp(name, 'SphereComponent', 'AbilityRadius');
  await addComp(name, 'AudioComponent', 'AbilitySound');

  await addVar(name, 'ManaCost', 'float', 20.0);
  await addVar(name, 'Cooldown', 'float', 5.0);
  await addVar(name, 'bIsOnCooldown', 'bool', false);
  await addVar(name, 'Damage', 'float', 40.0);
  await addVar(name, 'Range', 'float', 1000.0);
  await addVar(name, 'CorruptionCost', 'float', 5.0);

  await addEvent(name, 'BeginPlay');
  await ue('create_function', { blueprint_name: name, function_name: 'Activate' });
  await ue('create_function', { blueprint_name: name, function_name: 'ApplyEffect' });
  await ue('create_function', { blueprint_name: name, function_name: 'StartCooldown' });
  await ue('create_function', { blueprint_name: name, function_name: 'OnCooldownFinished' });

  const ok = await compile(name);
  return { success: ok };
}

// ── BP_Progression ───────────────────────────────────────────────────────────

async function buildProgression(name, path) {
  if (!await createBP(name, 'AActor', path)) return { success: false, error: 'create failed' };

  await addVar(name, 'Level', 'int', 1);
  await addVar(name, 'CurrentXP', 'int', 0);
  await addVar(name, 'XPToNextLevel', 'int', 100);
  await addVar(name, 'SkillPoints', 'int', 0);
  await addVar(name, 'HealthUpgrades', 'int', 0);
  await addVar(name, 'StaminaUpgrades', 'int', 0);

  await addEvent(name, 'BeginPlay');
  await ue('create_function', { blueprint_name: name, function_name: 'AddXP' });
  await ue('create_function', { blueprint_name: name, function_name: 'LevelUp' });
  await ue('create_function', { blueprint_name: name, function_name: 'SpendSkillPoint' });
  await ue('create_function', { blueprint_name: name, function_name: 'GetXPForLevel' });

  const ok = await compile(name);
  return { success: ok };
}

// ── BP_Inventory ─────────────────────────────────────────────────────────────

async function buildInventory(name, path) {
  if (!await createBP(name, 'AActor', path)) return { success: false, error: 'create failed' };

  await addVar(name, 'MaxSlots', 'int', 30);
  await addVar(name, 'UsedSlots', 'int', 0);
  await addVar(name, 'Gold', 'int', 0);
  await addVar(name, 'bIsOpen', 'bool', false);

  await addEvent(name, 'BeginPlay');
  await ue('create_function', { blueprint_name: name, function_name: 'AddItem' });
  await ue('create_function', { blueprint_name: name, function_name: 'RemoveItem' });
  await ue('create_function', { blueprint_name: name, function_name: 'UseItem' });
  await ue('create_function', { blueprint_name: name, function_name: 'EquipItem' });
  await ue('create_function', { blueprint_name: name, function_name: 'DropItem' });

  const ok = await compile(name);
  return { success: ok };
}

// ── BP_SaveSystem ─────────────────────────────────────────────────────────────

async function buildSaveSystem(name, path) {
  if (!await createBP(name, 'AActor', path)) return { success: false, error: 'create failed' };

  await addVar(name, 'SaveSlot', 'string', 'SaveSlot_0');
  await addVar(name, 'bAutoSave', 'bool', true);
  await addVar(name, 'AutoSaveIntervalSec', 'float', 300.0);

  await addEvent(name, 'BeginPlay');
  await ue('create_function', { blueprint_name: name, function_name: 'SaveGame' });
  await ue('create_function', { blueprint_name: name, function_name: 'LoadGame' });
  await ue('create_function', { blueprint_name: name, function_name: 'DeleteSave' });
  await ue('create_function', { blueprint_name: name, function_name: 'AutoSaveTick' });

  const ok = await compile(name);
  return { success: ok };
}

// ── TestArena level ──────────────────────────────────────────────────────────

export async function buildArenaLevel() {
  const actors = [
    { type: 'StaticMeshActor', name: 'Arena_Floor', location: { x: 0, y: 0, z: 0 }, scale: { x: 100, y: 100, z: 1 }, static_mesh: '/Engine/BasicShapes/Plane.Plane' },
    { type: 'DirectionalLight', name: 'Arena_Sun', location: { x: 0, y: 0, z: 2000 }, rotation: { pitch: -50, yaw: 45, roll: 0 } },
    { type: 'StaticMeshActor', name: 'Wall_N', location: { x: 0, y: 5000, z: 300 }, scale: { x: 100, y: 2, z: 6 }, static_mesh: '/Engine/BasicShapes/Cube.Cube' },
    { type: 'StaticMeshActor', name: 'Wall_S', location: { x: 0, y: -5000, z: 300 }, scale: { x: 100, y: 2, z: 6 }, static_mesh: '/Engine/BasicShapes/Cube.Cube' },
    { type: 'StaticMeshActor', name: 'Wall_E', location: { x: 5000, y: 0, z: 300 }, scale: { x: 2, y: 100, z: 6 }, static_mesh: '/Engine/BasicShapes/Cube.Cube' },
    { type: 'StaticMeshActor', name: 'Wall_W', location: { x: -5000, y: 0, z: 300 }, scale: { x: 2, y: 100, z: 6 }, static_mesh: '/Engine/BasicShapes/Cube.Cube' },
    // Scattered rocks for cover
    { type: 'StaticMeshActor', name: 'Rock_1', location: { x: 1500, y: 1000, z: 50 }, scale: { x: 3, y: 3, z: 3 }, static_mesh: '/Engine/BasicShapes/Sphere.Sphere' },
    { type: 'StaticMeshActor', name: 'Rock_2', location: { x: -2000, y: 1500, z: 50 }, scale: { x: 4, y: 2, z: 3 }, static_mesh: '/Engine/BasicShapes/Sphere.Sphere' },
    { type: 'StaticMeshActor', name: 'Rock_3', location: { x: 800, y: -1800, z: 50 }, scale: { x: 2, y: 3, z: 2 }, static_mesh: '/Engine/BasicShapes/Sphere.Sphere' },
  ];

  const results = [];
  for (const actor of actors) {
    const r = await ue('spawn_actor', actor);
    results.push({ name: actor.name, ok: r?.status !== 'error' });
  }

  return { success: true, results };
}
