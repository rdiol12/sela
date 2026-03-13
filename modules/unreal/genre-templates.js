/**
 * modules/unreal/genre-templates.js — Genre-aware Blueprint template library.
 *
 * Provides two things:
 *  1. getBlueprintsForGenre(genre) — which BP types a game needs
 *  2. GENRE_TEMPLATES — Blueprint definitions for non-RPG genres
 *     (merged with BLUEPRINT_TEMPLATES in blueprint-builder.js)
 */

// ── Genre → required Blueprint types ─────────────────────────────────────────

const GENRE_BP_LISTS = {
  rpg: [
    'player_controller', 'combat', 'ability_system', 'npc', 'enemy',
    'inventory', 'hud', 'quest_tracker', 'save_system', 'progression',
    'loot', 'audio_system',
  ],
  shooter: [
    'player_controller_shooter', 'weapon_base', 'projectile',
    'enemy_ai_shooter', 'wave_spawner', 'ammo_pickup', 'health_pack',
    'hud_shooter', 'save_system', 'audio_system',
  ],
  platformer: [
    'player_controller_platformer', 'moving_platform', 'hazard',
    'checkpoint', 'collectible', 'enemy_patrol', 'hud_platformer',
    'save_system',
  ],
  puzzle: [
    'player_controller_puzzle', 'pushable_block', 'pressure_plate',
    'trigger_door', 'level_complete', 'hint_system', 'hud_puzzle',
  ],
  'city-builder': [
    'building_base', 'resource_node', 'worker_unit',
    'hud_city', 'save_system',
  ],
  rts: [
    'unit_base', 'building_base', 'resource_node',
    'fog_of_war', 'hud_rts', 'save_system',
  ],
  survival: [
    'player_controller', 'combat', 'inventory', 'crafting', 'enemy',
    'resource_node', 'hud', 'save_system', 'audio_system',
  ],
  horror: [
    'player_controller', 'enemy_ai_horror', 'hud_horror',
    'interactable', 'ambient', 'save_system', 'audio_system',
  ],
};

/**
 * Returns the list of Blueprint type names appropriate for a given genre.
 * Falls back to a minimal universal set if genre is unknown.
 */
export function getBlueprintsForGenre(genre) {
  const key = (genre || 'rpg').toLowerCase().replace(/[^a-z-]/g, '');
  return GENRE_BP_LISTS[key] || [
    'player_controller', 'enemy', 'hud', 'save_system',
  ];
}

// ── Blueprint templates for non-RPG genres ────────────────────────────────────

export const GENRE_TEMPLATES = {

  // ── Shooter ───────────────────────────────────────────────────────────────

  player_controller_shooter: {
    parentClass: 'ACharacter',
    components: [
      { type: 'SkeletalMeshComponent', name: 'Mesh', properties: {} },
      { type: 'SpringArmComponent', name: 'CameraBoom', properties: {} },
      { type: 'CameraComponent', name: 'FollowCamera', properties: {} },
      { type: 'SphereComponent', name: 'CollisionSphere', properties: {} },
    ],
    variables: [
      { name: 'MaxHealth', type: 'float', defaultValue: 100.0, isPublic: true },
      { name: 'CurrentHealth', type: 'float', defaultValue: 100.0, isPublic: false },
      { name: 'MoveSpeed', type: 'float', defaultValue: 450.0, isPublic: true },
      { name: 'SprintMultiplier', type: 'float', defaultValue: 1.6, isPublic: true },
      { name: 'AmmoCount', type: 'int', defaultValue: 30, isPublic: false },
      { name: 'MaxAmmo', type: 'int', defaultValue: 30, isPublic: true },
      { name: 'IsReloading', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'ReloadTimeSec', type: 'float', defaultValue: 1.5, isPublic: true },
      { name: 'bIsSprinting', type: 'bool', defaultValue: false, isPublic: false },
    ],
    graph: {
      description: 'WASD movement, mouse aim direction. LMB fire, R reload, Shift sprint. Health bar update. Death on health=0.',
    },
  },

  weapon_base: {
    parentClass: 'AActor',
    components: [
      { type: 'StaticMeshComponent', name: 'WeaponMesh', properties: {} },
      { type: 'AudioComponent', name: 'FireSound', properties: {} },
    ],
    variables: [
      { name: 'Damage', type: 'float', defaultValue: 25.0, isPublic: true },
      { name: 'FireRate', type: 'float', defaultValue: 0.1, isPublic: true },
      { name: 'MagazineSize', type: 'int', defaultValue: 30, isPublic: true },
      { name: 'ReloadTime', type: 'float', defaultValue: 1.5, isPublic: true },
      { name: 'BulletSpeed', type: 'float', defaultValue: 10000.0, isPublic: true },
      { name: 'IsAutomatic', type: 'bool', defaultValue: true, isPublic: true },
    ],
    graph: { description: 'Fire projectile on trigger, eject shell casing, play sound, decrement ammo.' },
  },

  projectile: {
    parentClass: 'AActor',
    components: [
      { type: 'SphereComponent', name: 'CollisionSphere', properties: {} },
      { type: 'StaticMeshComponent', name: 'Mesh', properties: {} },
      { type: 'ProjectileMovementComponent', name: 'ProjectileMovement', properties: {} },
    ],
    variables: [
      { name: 'Damage', type: 'float', defaultValue: 25.0, isPublic: true },
      { name: 'Speed', type: 'float', defaultValue: 10000.0, isPublic: true },
      { name: 'LifeSpan', type: 'float', defaultValue: 3.0, isPublic: true },
    ],
    graph: { description: 'Move forward at Speed. On hit actor: apply Damage, spawn impact VFX, destroy self.' },
  },

  enemy_ai_shooter: {
    parentClass: 'AActor',
    components: [
      { type: 'SkeletalMeshComponent', name: 'Mesh', properties: {} },
      { type: 'SphereComponent', name: 'AggroRadius', properties: {} },
      { type: 'SphereComponent', name: 'AttackRadius', properties: {} },
      { type: 'AudioComponent', name: 'SoundPlayer', properties: {} },
    ],
    variables: [
      { name: 'MaxHealth', type: 'float', defaultValue: 50.0, isPublic: true },
      { name: 'CurrentHealth', type: 'float', defaultValue: 50.0, isPublic: false },
      { name: 'AttackDamage', type: 'float', defaultValue: 10.0, isPublic: true },
      { name: 'MoveSpeed', type: 'float', defaultValue: 250.0, isPublic: true },
      { name: 'AggroRangeUnits', type: 'float', defaultValue: 2000.0, isPublic: true },
      { name: 'AttackRangeUnits', type: 'float', defaultValue: 800.0, isPublic: true },
      { name: 'bIsAlerted', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'XPReward', type: 'int', defaultValue: 10, isPublic: true },
    ],
    graph: { description: 'Patrol idle → player enters AggroRadius → chase player → enter AttackRadius → shoot projectile at player. Die at health=0, grant XP.' },
  },

  wave_spawner: {
    parentClass: 'AActor',
    components: [
      { type: 'BoxComponent', name: 'SpawnVolume', properties: {} },
    ],
    variables: [
      { name: 'CurrentWave', type: 'int', defaultValue: 0, isPublic: false },
      { name: 'EnemiesPerWave', type: 'int', defaultValue: 5, isPublic: true },
      { name: 'WaveScalingFactor', type: 'float', defaultValue: 1.3, isPublic: true },
      { name: 'TimeBetweenWavesSec', type: 'float', defaultValue: 10.0, isPublic: true },
      { name: 'bWaveActive', type: 'bool', defaultValue: false, isPublic: false },
    ],
    graph: { description: 'OnBeginPlay: start wave 1. Spawn N enemies in SpawnVolume. On all dead: wait TimeBetweenWaves, start next wave with +ScalingFactor enemies.' },
  },

  ammo_pickup: {
    parentClass: 'AActor',
    components: [
      { type: 'StaticMeshComponent', name: 'Mesh', properties: {} },
      { type: 'SphereComponent', name: 'PickupRadius', properties: {} },
    ],
    variables: [
      { name: 'AmmoAmount', type: 'int', defaultValue: 30, isPublic: true },
      { name: 'RespawnTimeSec', type: 'float', defaultValue: 30.0, isPublic: true },
    ],
    graph: { description: 'Player overlaps → add AmmoAmount to player ammo → hide mesh → start respawn timer → show mesh again.' },
  },

  health_pack: {
    parentClass: 'AActor',
    components: [
      { type: 'StaticMeshComponent', name: 'Mesh', properties: {} },
      { type: 'SphereComponent', name: 'PickupRadius', properties: {} },
    ],
    variables: [
      { name: 'HealAmount', type: 'float', defaultValue: 30.0, isPublic: true },
      { name: 'RespawnTimeSec', type: 'float', defaultValue: 45.0, isPublic: true },
    ],
    graph: { description: 'Player overlaps → restore HealAmount HP (clamped to MaxHealth) → hide mesh → respawn after RespawnTime.' },
  },

  hud_shooter: {
    parentClass: 'AActor',
    components: [{ type: 'WidgetComponent', name: 'HUDWidget', properties: {} }],
    variables: [
      { name: 'HealthPercent', type: 'float', defaultValue: 1.0, isPublic: false },
      { name: 'AmmoCount', type: 'int', defaultValue: 30, isPublic: false },
      { name: 'WaveNumber', type: 'int', defaultValue: 1, isPublic: false },
      { name: 'Score', type: 'int', defaultValue: 0, isPublic: false },
      { name: 'Crosshair', type: 'object', defaultValue: null, isPublic: false },
    ],
    graph: { description: 'Draw health bar, ammo counter, wave number, score. Show crosshair at screen center. Flash health bar red on low HP.' },
  },

  enemy_ai_horror: {
    parentClass: 'AActor',
    components: [
      { type: 'SkeletalMeshComponent', name: 'Mesh', properties: {} },
      { type: 'SphereComponent', name: 'HearingRadius', properties: {} },
      { type: 'SphereComponent', name: 'SightRadius', properties: {} },
      { type: 'AudioComponent', name: 'AmbientGrowl', properties: {} },
    ],
    variables: [
      { name: 'bPlayerSpotted', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'PatrolSpeed', type: 'float', defaultValue: 120.0, isPublic: true },
      { name: 'ChaseSpeed', type: 'float', defaultValue: 350.0, isPublic: true },
      { name: 'HearingRangeUnits', type: 'float', defaultValue: 1500.0, isPublic: true },
      { name: 'SightRangeUnits', type: 'float', defaultValue: 800.0, isPublic: true },
    ],
    graph: { description: 'Slow patrol, listening. Hears player noise → chase at ChaseSpeed. Spots player → trigger jumpscare, game over. Lose sight → return to patrol.' },
  },

  hud_horror: {
    parentClass: 'AActor',
    components: [{ type: 'WidgetComponent', name: 'HUDWidget', properties: {} }],
    variables: [
      { name: 'SanityLevel', type: 'float', defaultValue: 100.0, isPublic: false },
      { name: 'FlashlightBattery', type: 'float', defaultValue: 100.0, isPublic: false },
      { name: 'ObjectivesComplete', type: 'int', defaultValue: 0, isPublic: false },
    ],
    graph: { description: 'Minimal UI — sanity bar on edge, battery indicator, vignette distortion at low sanity. No crosshair.' },
  },

  // ── Platformer ────────────────────────────────────────────────────────────

  player_controller_platformer: {
    parentClass: 'ACharacter',
    components: [
      { type: 'SkeletalMeshComponent', name: 'Mesh', properties: {} },
      { type: 'SpringArmComponent', name: 'CameraBoom', properties: {} },
      { type: 'CameraComponent', name: 'SideCamera', properties: {} },
    ],
    variables: [
      { name: 'MaxHealth', type: 'int', defaultValue: 3, isPublic: true },
      { name: 'CurrentHealth', type: 'int', defaultValue: 3, isPublic: false },
      { name: 'MoveSpeed', type: 'float', defaultValue: 500.0, isPublic: true },
      { name: 'JumpForce', type: 'float', defaultValue: 800.0, isPublic: true },
      { name: 'bCanDoubleJump', type: 'bool', defaultValue: false, isPublic: true },
      { name: 'bDoubleJumpUsed', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'LivesRemaining', type: 'int', defaultValue: 3, isPublic: false },
    ],
    graph: { description: 'Arrow keys/WASD left-right, Space jump (double-jump if bCanDoubleJump). Fall damage on high velocity landing. Lose life on hazard hit.' },
  },

  moving_platform: {
    parentClass: 'AActor',
    components: [{ type: 'StaticMeshComponent', name: 'PlatformMesh', properties: {} }],
    variables: [
      { name: 'MoveDistance', type: 'float', defaultValue: 500.0, isPublic: true },
      { name: 'MoveSpeed', type: 'float', defaultValue: 200.0, isPublic: true },
      { name: 'MoveAxis', type: 'string', defaultValue: 'X', isPublic: true },
      { name: 'bStartsMoving', type: 'bool', defaultValue: true, isPublic: true },
    ],
    graph: { description: 'Lerp platform position back and forth along MoveAxis by MoveDistance at MoveSpeed. Player standing on it moves with it.' },
  },

  checkpoint: {
    parentClass: 'AActor',
    components: [
      { type: 'StaticMeshComponent', name: 'Mesh', properties: {} },
      { type: 'BoxComponent', name: 'TriggerBox', properties: {} },
      { type: 'PointLightComponent', name: 'CheckpointLight', properties: {} },
    ],
    variables: [
      { name: 'bActivated', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'RespawnLocation', type: 'object', defaultValue: null, isPublic: false },
    ],
    graph: { description: 'Player enters box → save respawn point → activate glow effect → mark bActivated so it doesn\'t re-trigger.' },
  },

  collectible: {
    parentClass: 'AActor',
    components: [
      { type: 'StaticMeshComponent', name: 'Mesh', properties: {} },
      { type: 'SphereComponent', name: 'CollectRadius', properties: {} },
      { type: 'RotatingMovementComponent', name: 'RotationAnim', properties: {} },
    ],
    variables: [
      { name: 'CollectibleType', type: 'string', defaultValue: 'coin', isPublic: true },
      { name: 'Value', type: 'int', defaultValue: 1, isPublic: true },
    ],
    graph: { description: 'Spin slowly. Player overlaps → add Value to player score → play collect sound → destroy self.' },
  },

  enemy_patrol: {
    parentClass: 'AActor',
    components: [
      { type: 'SkeletalMeshComponent', name: 'Mesh', properties: {} },
      { type: 'SphereComponent', name: 'HurtBox', properties: {} },
    ],
    variables: [
      { name: 'PatrolRange', type: 'float', defaultValue: 600.0, isPublic: true },
      { name: 'MoveSpeed', type: 'float', defaultValue: 150.0, isPublic: true },
      { name: 'DamageOnContact', type: 'int', defaultValue: 1, isPublic: true },
    ],
    graph: { description: 'Walk left-right within PatrolRange, flip sprite at edge. Player contact → deal DamageOnContact (knocks player back).' },
  },

  hud_platformer: {
    parentClass: 'AActor',
    components: [{ type: 'WidgetComponent', name: 'HUDWidget', properties: {} }],
    variables: [
      { name: 'Lives', type: 'int', defaultValue: 3, isPublic: false },
      { name: 'Score', type: 'int', defaultValue: 0, isPublic: false },
      { name: 'CollectiblesGathered', type: 'int', defaultValue: 0, isPublic: false },
    ],
    graph: { description: 'Show life hearts, score counter, collectible count. Update on player events.' },
  },

  // ── Puzzle ────────────────────────────────────────────────────────────────

  player_controller_puzzle: {
    parentClass: 'ACharacter',
    components: [
      { type: 'StaticMeshComponent', name: 'Mesh', properties: {} },
      { type: 'CameraComponent', name: 'IsometricCamera', properties: {} },
    ],
    variables: [
      { name: 'MoveSpeed', type: 'float', defaultValue: 300.0, isPublic: true },
      { name: 'bCanPush', type: 'bool', defaultValue: true, isPublic: true },
      { name: 'MovesUsed', type: 'int', defaultValue: 0, isPublic: false },
    ],
    graph: { description: 'Grid-based or free movement with WASD. On push: check if pushable block is ahead, move it if space is free. Increment MovesUsed.' },
  },

  pushable_block: {
    parentClass: 'AActor',
    components: [{ type: 'StaticMeshComponent', name: 'BlockMesh', properties: {} }],
    variables: [
      { name: 'bOnGoalTile', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'BlockColor', type: 'string', defaultValue: 'gray', isPublic: true },
    ],
    graph: { description: 'Can be pushed by player if space ahead is free. When placed on pressure_plate: bOnGoalTile=true, check win condition.' },
  },

  pressure_plate: {
    parentClass: 'AActor',
    components: [
      { type: 'StaticMeshComponent', name: 'PlateMesh', properties: {} },
      { type: 'BoxComponent', name: 'TriggerBox', properties: {} },
    ],
    variables: [
      { name: 'bActivated', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'LinkedDoorTag', type: 'string', defaultValue: '', isPublic: true },
    ],
    graph: { description: 'Block or player steps on → bActivated=true → find actor by LinkedDoorTag → trigger it to open. Deactivate when no weight.' },
  },

  trigger_door: {
    parentClass: 'AActor',
    components: [
      { type: 'StaticMeshComponent', name: 'DoorMesh', properties: {} },
      { type: 'BoxComponent', name: 'BlockingVolume', properties: {} },
    ],
    variables: [
      { name: 'bIsOpen', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'OpenOffsetZ', type: 'float', defaultValue: 300.0, isPublic: true },
    ],
    graph: { description: 'Default closed/blocking. When triggered (by pressure_plate or other): lerp Z position up by OpenOffsetZ to open.' },
  },

  level_complete: {
    parentClass: 'AActor',
    components: [
      { type: 'BoxComponent', name: 'GoalTrigger', properties: {} },
      { type: 'StaticMeshComponent', name: 'GoalMesh', properties: {} },
    ],
    variables: [
      { name: 'NextLevelName', type: 'string', defaultValue: '', isPublic: true },
      { name: 'RequiredActivations', type: 'int', defaultValue: 1, isPublic: true },
    ],
    graph: { description: 'Player enters when all pressure_plates active → show win screen → open next level after 2 seconds.' },
  },

  hint_system: {
    parentClass: 'AActor',
    components: [
      { type: 'BoxComponent', name: 'HintTrigger', properties: {} },
      { type: 'WidgetComponent', name: 'HintWidget', properties: {} },
    ],
    variables: [
      { name: 'HintText', type: 'string', defaultValue: 'Push blocks onto the marked tiles.', isPublic: true },
      { name: 'bShowOnce', type: 'bool', defaultValue: true, isPublic: true },
    ],
    graph: { description: 'Player enters trigger → show HintText widget → hide after 3 seconds (if bShowOnce: never show again).' },
  },

  hud_puzzle: {
    parentClass: 'AActor',
    components: [{ type: 'WidgetComponent', name: 'HUDWidget', properties: {} }],
    variables: [
      { name: 'MovesUsed', type: 'int', defaultValue: 0, isPublic: false },
      { name: 'GoalsRemaining', type: 'int', defaultValue: 0, isPublic: false },
      { name: 'TimeElapsedSec', type: 'float', defaultValue: 0, isPublic: false },
    ],
    graph: { description: 'Show move counter, remaining goals, elapsed time. Pulsing goal count when goals=0.' },
  },

  // ── City builder / RTS shared ─────────────────────────────────────────────

  building_base: {
    parentClass: 'AActor',
    components: [
      { type: 'StaticMeshComponent', name: 'BuildingMesh', properties: {} },
      { type: 'BoxComponent', name: 'Footprint', properties: {} },
    ],
    variables: [
      { name: 'BuildingType', type: 'string', defaultValue: 'house', isPublic: true },
      { name: 'MaxHealth', type: 'float', defaultValue: 500.0, isPublic: true },
      { name: 'CurrentHealth', type: 'float', defaultValue: 500.0, isPublic: false },
      { name: 'ProductionRate', type: 'float', defaultValue: 1.0, isPublic: true },
      { name: 'bIsConstructed', type: 'bool', defaultValue: false, isPublic: false },
    ],
    graph: { description: 'Placed on valid footprint → construction animation → mark bIsConstructed → begin producing resources at ProductionRate. Take damage, destroy at 0 HP.' },
  },

  resource_node: {
    parentClass: 'AActor',
    components: [
      { type: 'StaticMeshComponent', name: 'ResourceMesh', properties: {} },
      { type: 'SphereComponent', name: 'HarvestRadius', properties: {} },
    ],
    variables: [
      { name: 'ResourceType', type: 'string', defaultValue: 'wood', isPublic: true },
      { name: 'TotalAmount', type: 'int', defaultValue: 200, isPublic: true },
      { name: 'Remaining', type: 'int', defaultValue: 200, isPublic: false },
      { name: 'HarvestAmountPerTrip', type: 'int', defaultValue: 10, isPublic: true },
    ],
    graph: { description: 'Worker enters HarvestRadius → extract HarvestAmountPerTrip of ResourceType → deplete Remaining → hide when 0.' },
  },

  worker_unit: {
    parentClass: 'AActor',
    components: [
      { type: 'SkeletalMeshComponent', name: 'Mesh', properties: {} },
      { type: 'SphereComponent', name: 'SelectionCircle', properties: {} },
    ],
    variables: [
      { name: 'bSelected', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'MoveSpeed', type: 'float', defaultValue: 200.0, isPublic: true },
      { name: 'CarryingResourceType', type: 'string', defaultValue: '', isPublic: false },
      { name: 'CarryingAmount', type: 'int', defaultValue: 0, isPublic: false },
    ],
    graph: { description: 'Click to select → right-click target to move/harvest/build. Walk to resource, harvest, return to depot, deposit, repeat.' },
  },

  hud_city: {
    parentClass: 'AActor',
    components: [{ type: 'WidgetComponent', name: 'HUDWidget', properties: {} }],
    variables: [
      { name: 'WoodCount', type: 'int', defaultValue: 100, isPublic: false },
      { name: 'StoneCount', type: 'int', defaultValue: 50, isPublic: false },
      { name: 'FoodCount', type: 'int', defaultValue: 50, isPublic: false },
      { name: 'Population', type: 'int', defaultValue: 0, isPublic: false },
    ],
    graph: { description: 'Top bar: resource counts (wood/stone/food/gold icons + numbers). Bottom bar: building palette. Mini-map bottom right.' },
  },

  unit_base: {
    parentClass: 'AActor',
    components: [
      { type: 'SkeletalMeshComponent', name: 'Mesh', properties: {} },
      { type: 'SphereComponent', name: 'AttackRange', properties: {} },
    ],
    variables: [
      { name: 'MaxHealth', type: 'float', defaultValue: 100.0, isPublic: true },
      { name: 'CurrentHealth', type: 'float', defaultValue: 100.0, isPublic: false },
      { name: 'AttackDamage', type: 'float', defaultValue: 15.0, isPublic: true },
      { name: 'AttackCooldownSec', type: 'float', defaultValue: 1.0, isPublic: true },
      { name: 'MoveSpeed', type: 'float', defaultValue: 250.0, isPublic: true },
      { name: 'bSelected', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'UnitType', type: 'string', defaultValue: 'soldier', isPublic: true },
    ],
    graph: { description: 'Idle → receive move order → walk to target. Enemy enters AttackRange → attack on cooldown. Selected by player click/box-select.' },
  },

  fog_of_war: {
    parentClass: 'AActor',
    components: [{ type: 'StaticMeshComponent', name: 'FogMesh', properties: {} }],
    variables: [
      { name: 'FogOpacity', type: 'float', defaultValue: 0.85, isPublic: true },
      { name: 'RevealRadius', type: 'float', defaultValue: 1500.0, isPublic: true },
    ],
    graph: { description: 'Track player unit positions → carve fog holes at unit locations with RevealRadius. Explored areas show dim fog, unexplored are black.' },
  },

  hud_rts: {
    parentClass: 'AActor',
    components: [{ type: 'WidgetComponent', name: 'HUDWidget', properties: {} }],
    variables: [
      { name: 'SelectedUnitCount', type: 'int', defaultValue: 0, isPublic: false },
      { name: 'GoldCount', type: 'int', defaultValue: 200, isPublic: false },
      { name: 'PopulationCount', type: 'int', defaultValue: 0, isPublic: false },
      { name: 'MaxPopulation', type: 'int', defaultValue: 20, isPublic: false },
    ],
    graph: { description: 'Top: resource bar. Bottom: selection panel (unit portrait + actions). Mini-map bottom right with fog overlay.' },
  },
};
