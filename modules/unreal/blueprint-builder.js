/**
 * modules/unreal/blueprint-builder.js — Creates gameplay Blueprints via Unreal MCP.
 *
 * Creates Blueprint classes with event graphs for:
 *  - Interactable objects (wayshrines, doors, forges)
 *  - Hazard volumes (lava, spore, void damage)
 *  - Ambient effects (campfire, particles, wildlife)
 *  - NPC behaviors with dialogue and voice lines
 *  - Boss encounter frameworks with phase AI
 *  - Player controller (movement, combat, camera)
 *  - Game systems (inventory, quests, save/load, crafting, HUD)
 *  - Audio management (region music, combat triggers, voice playback)
 *
 * Each Blueprint goes through: create → add components → add variables → build graph → compile.
 * 20 template types covering all gameplay systems.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { callTool } from '../../lib/mcp-gateway.js';
import { createLogger } from '../../lib/logger.js';
import { getActiveGame } from './game-config.js';
import { GENRE_TEMPLATES } from './genre-templates.js';

const log = createLogger('blueprint-builder');

function getRegionManifestPath() {
  return getActiveGame().regionManifestPath;
}

// ── Blueprint templates by type ─────────────────────────────────────────────

/**
 * Templates define what components, variables, and graph nodes each Blueprint type needs.
 * The agent uses these as starting points and can customize further.
 */
const BLUEPRINT_TEMPLATES = {
  // ── World object types ──────────────────────────────────────────────────

  interactable: {
    parentClass: 'AActor',
    components: [
      { type: 'StaticMeshComponent', name: 'Mesh', properties: {} },
      { type: 'SphereComponent', name: 'InteractTrigger', properties: {} },
    ],
    variables: [
      { name: 'bIsActivated', type: 'bool', defaultValue: false, isPublic: true },
      { name: 'InteractPromptText', type: 'string', defaultValue: 'Press E to interact', isPublic: true },
    ],
    graph: {
      description: 'On overlap → show prompt. On interact → toggle activated state, play effect.',
    },
  },

  hazard: {
    parentClass: 'AActor',
    components: [
      { type: 'BoxComponent', name: 'DamageVolume', properties: {} },
    ],
    variables: [
      { name: 'DamagePerSecond', type: 'float', defaultValue: 10.0, isPublic: true },
      { name: 'bIsActive', type: 'bool', defaultValue: true, isPublic: true },
    ],
    graph: {
      description: 'On overlap begin → start damage timer. On overlap end → stop damage. Tick applies DPS.',
    },
  },

  ambient: {
    parentClass: 'AActor',
    components: [
      { type: 'AudioComponent', name: 'AmbientSound', properties: {} },
      { type: 'PointLightComponent', name: 'AmbientLight', properties: {} },
    ],
    variables: [
      { name: 'LightIntensity', type: 'float', defaultValue: 5000.0, isPublic: true },
      { name: 'LightColor', type: 'vector', defaultValue: null, isPublic: true },
    ],
    graph: {
      description: 'BeginPlay → start ambient sound, set light properties. Optional flicker on Tick.',
    },
  },

  gameplay: {
    parentClass: 'AActor',
    components: [
      { type: 'BoxComponent', name: 'GameplayVolume', properties: {} },
    ],
    variables: [
      { name: 'bMinigameActive', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'Score', type: 'int', defaultValue: 0, isPublic: false },
    ],
    graph: {
      description: 'Enter volume → start minigame. Track score/progress. On complete → reward.',
    },
  },

  // ── NPC with dialogue and voice ─────────────────────────────────────────

  npc: {
    parentClass: 'AActor',
    components: [
      { type: 'SkeletalMeshComponent', name: 'CharacterMesh', properties: {} },
      { type: 'SphereComponent', name: 'InteractRadius', properties: {} },
      { type: 'AudioComponent', name: 'VoicePlayer', properties: {} },
      { type: 'WidgetComponent', name: 'DialogueWidget', properties: {} },
    ],
    variables: [
      { name: 'NPCName', type: 'string', defaultValue: 'NPC', isPublic: true },
      { name: 'NPCTitle', type: 'string', defaultValue: '', isPublic: true },
      { name: 'DialogueIndex', type: 'int', defaultValue: 0, isPublic: false },
      { name: 'bCanInteract', type: 'bool', defaultValue: true, isPublic: true },
      { name: 'bIsTalking', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'VoicePitch', type: 'float', defaultValue: 1.0, isPublic: true },
      { name: 'DialogueDataTable', type: 'object', defaultValue: null, isPublic: true },
      { name: 'PortraitTexture', type: 'object', defaultValue: null, isPublic: true },
    ],
    graph: {
      description: 'On overlap → show interact prompt. On interact → open dialogue widget, play voice SoundWave, show portrait. Advance dialogue on input. Branch choices update quest state. On dialogue end → close widget, resume idle animation.',
    },
  },

  // ── Enemy types ─────────────────────────────────────────────────────────

  enemy: {
    parentClass: 'AActor',
    components: [
      { type: 'SkeletalMeshComponent', name: 'EnemyMesh', properties: {} },
      { type: 'SphereComponent', name: 'AggroRadius', properties: {} },
      { type: 'SphereComponent', name: 'AttackRadius', properties: {} },
      { type: 'AudioComponent', name: 'CombatAudio', properties: {} },
    ],
    variables: [
      { name: 'MaxHealth', type: 'float', defaultValue: 100.0, isPublic: true },
      { name: 'CurrentHealth', type: 'float', defaultValue: 100.0, isPublic: false },
      { name: 'AttackDamage', type: 'float', defaultValue: 15.0, isPublic: true },
      { name: 'AttackCooldown', type: 'float', defaultValue: 2.0, isPublic: true },
      { name: 'MoveSpeed', type: 'float', defaultValue: 300.0, isPublic: true },
      { name: 'bIsAggro', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'bIsDead', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'LootTableId', type: 'string', defaultValue: 'common', isPublic: true },
      { name: 'XPReward', type: 'int', defaultValue: 50, isPublic: true },
      { name: 'BossPhase', type: 'int', defaultValue: 1, isPublic: false },
      { name: 'bIsEnraged', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'bIsBoss', type: 'bool', defaultValue: false, isPublic: true },
    ],
    graph: {
      description: 'Player enters aggro → face player, start patrol-to-chase. In range → attack with cooldown. Track health → phase transitions at 66%/33%. Enrage below 25%. On death → play dissolve VFX, spawn loot bag, grant XP. Boss variant: multi-phase with unique mechanics per phase.',
    },
  },

  // ── Player controller ───────────────────────────────────────────────────

  player_controller: {
    parentClass: 'ACharacter',
    components: [
      { type: 'SkeletalMeshComponent', name: 'PlayerMesh', properties: {} },
      { type: 'SpringArmComponent', name: 'CameraBoom', properties: {} },
      { type: 'CameraComponent', name: 'FollowCamera', properties: {} },
      { type: 'SphereComponent', name: 'LockOnSensor', properties: {} },
      { type: 'AudioComponent', name: 'FootstepAudio', properties: {} },
    ],
    variables: [
      { name: 'MaxHealth', type: 'float', defaultValue: 100.0, isPublic: true },
      { name: 'CurrentHealth', type: 'float', defaultValue: 100.0, isPublic: false },
      { name: 'MaxStamina', type: 'float', defaultValue: 100.0, isPublic: true },
      { name: 'CurrentStamina', type: 'float', defaultValue: 100.0, isPublic: false },
      { name: 'MaxMana', type: 'float', defaultValue: 50.0, isPublic: true },
      { name: 'CurrentMana', type: 'float', defaultValue: 50.0, isPublic: false },
      { name: 'MoveSpeed', type: 'float', defaultValue: 600.0, isPublic: true },
      { name: 'SprintMultiplier', type: 'float', defaultValue: 1.5, isPublic: true },
      { name: 'bIsSprinting', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'bIsDodging', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'bIsBlocking', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'bIsLockedOn', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'LockedTarget', type: 'object', defaultValue: null, isPublic: false },
      { name: 'PlayerLevel', type: 'int', defaultValue: 1, isPublic: false },
      { name: 'CurrentXP', type: 'int', defaultValue: 0, isPublic: false },
    ],
    graph: {
      description: 'Enhanced Input: WASD movement, mouse camera. Shift=sprint (drains stamina). Space=dodge roll with i-frames. LMB=light attack, RMB=heavy attack/block. Q=lock-on toggle. Tab=inventory. F=interact. 1-5=shard abilities. Stamina regenerates when not sprinting/attacking.',
    },
  },

  // ── Combat system ───────────────────────────────────────────────────────

  combat: {
    parentClass: 'AActor',
    components: [
      { type: 'BoxComponent', name: 'WeaponHitbox', properties: {} },
    ],
    variables: [
      { name: 'BaseDamage', type: 'float', defaultValue: 10.0, isPublic: true },
      { name: 'ComboCount', type: 'int', defaultValue: 0, isPublic: false },
      { name: 'MaxCombo', type: 'int', defaultValue: 3, isPublic: true },
      { name: 'ComboWindowMs', type: 'float', defaultValue: 800.0, isPublic: true },
      { name: 'bIsAttacking', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'bParryWindow', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'ParryDurationMs', type: 'float', defaultValue: 200.0, isPublic: true },
      { name: 'DodgeIFramesMs', type: 'float', defaultValue: 300.0, isPublic: true },
      { name: 'StaminaCostLight', type: 'float', defaultValue: 15.0, isPublic: true },
      { name: 'StaminaCostHeavy', type: 'float', defaultValue: 30.0, isPublic: true },
      { name: 'StaminaCostDodge', type: 'float', defaultValue: 25.0, isPublic: true },
    ],
    graph: {
      description: 'LMB → light attack chain (3-hit combo, each must connect within window). RMB hold → block (reduces damage), RMB tap during enemy swing → parry (stagger enemy). Dodge → i-frames. Hit detection via weapon hitbox overlap. Apply damage with type/element. Play hit reaction montage on target.',
    },
  },

  // ── Shard ability system ────────────────────────────────────────────────

  ability_system: {
    parentClass: 'AActor',
    components: [],
    variables: [
      { name: 'ActiveShardSlots', type: 'int', defaultValue: 2, isPublic: true },
      { name: 'ShardFireLevel', type: 'int', defaultValue: 0, isPublic: false },
      { name: 'ShardIceLevel', type: 'int', defaultValue: 0, isPublic: false },
      { name: 'ShardVoidLevel', type: 'int', defaultValue: 0, isPublic: false },
      { name: 'ShardNatureLevel', type: 'int', defaultValue: 0, isPublic: false },
      { name: 'ShardLightningLevel', type: 'int', defaultValue: 0, isPublic: false },
      { name: 'AbilityCooldowns', type: 'object', defaultValue: null, isPublic: false },
      { name: 'ManaCostMultiplier', type: 'float', defaultValue: 1.0, isPublic: true },
    ],
    graph: {
      description: 'Hotkey 1-5 → activate shard ability. Each shard type: Fire (AoE damage), Ice (slow/freeze), Void (teleport/pull), Nature (heal/root), Lightning (chain/stun). Level 1=basic, 2=enhanced, 3=ultimate. Costs mana, has cooldown. VFX triggered on cast.',
    },
  },

  // ── Inventory system ────────────────────────────────────────────────────

  inventory: {
    parentClass: 'AActor',
    components: [
      { type: 'WidgetComponent', name: 'InventoryWidget', properties: {} },
    ],
    variables: [
      { name: 'MaxSlots', type: 'int', defaultValue: 30, isPublic: true },
      { name: 'EquippedWeapon', type: 'object', defaultValue: null, isPublic: false },
      { name: 'EquippedArmor', type: 'object', defaultValue: null, isPublic: false },
      { name: 'EquippedAccessory1', type: 'object', defaultValue: null, isPublic: false },
      { name: 'EquippedAccessory2', type: 'object', defaultValue: null, isPublic: false },
      { name: 'EquippedAccessory3', type: 'object', defaultValue: null, isPublic: false },
      { name: 'Gold', type: 'int', defaultValue: 0, isPublic: false },
      { name: 'bIsOpen', type: 'bool', defaultValue: false, isPublic: false },
    ],
    graph: {
      description: 'Tab → toggle inventory UI. Grid display of items with icons/counts. Click item → context menu (use, equip, drop, inspect). Drag-drop between slots. Equipment slots: weapon, armor, 3 accessories. Show stat comparison on hover. Gold display. Weight/capacity bar.',
    },
  },

  // ── Dialogue UI system ──────────────────────────────────────────────────

  dialogue_ui: {
    parentClass: 'AActor',
    components: [
      { type: 'WidgetComponent', name: 'DialogueBoxWidget', properties: {} },
      { type: 'AudioComponent', name: 'VoiceLinePlayer', properties: {} },
    ],
    variables: [
      { name: 'bDialogueActive', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'CurrentSpeaker', type: 'string', defaultValue: '', isPublic: false },
      { name: 'CurrentLine', type: 'string', defaultValue: '', isPublic: false },
      { name: 'TypewriterSpeed', type: 'float', defaultValue: 0.03, isPublic: true },
      { name: 'bTypewriterDone', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'Choices', type: 'object', defaultValue: null, isPublic: false },
      { name: 'VoiceVolume', type: 'float', defaultValue: 1.0, isPublic: true },
      { name: 'bAutoAdvance', type: 'bool', defaultValue: false, isPublic: true },
    ],
    graph: {
      description: 'Open → show dialogue box with speaker portrait + name. Typewriter text effect. Play voice line SoundWave (TTS-generated WAV). Space/click → skip typewriter or advance. Branch choices shown as buttons → selection updates quest flags. Close → resume gameplay input. Supports shop/quest integration.',
    },
  },

  // ── Quest journal ───────────────────────────────────────────────────────

  quest_tracker: {
    parentClass: 'AActor',
    components: [
      { type: 'WidgetComponent', name: 'QuestWidget', properties: {} },
    ],
    variables: [
      { name: 'ActiveQuests', type: 'object', defaultValue: null, isPublic: false },
      { name: 'CompletedQuests', type: 'object', defaultValue: null, isPublic: false },
      { name: 'FailedQuests', type: 'object', defaultValue: null, isPublic: false },
      { name: 'TrackedQuestId', type: 'string', defaultValue: '', isPublic: false },
      { name: 'bJournalOpen', type: 'bool', defaultValue: false, isPublic: false },
    ],
    graph: {
      description: 'J key → toggle quest journal. Tabs: active, completed, failed. Each quest: title, description, objectives with checkboxes. Track button pins quest to HUD compass. Objective markers rendered in world. Quest accept/complete events trigger from dialogue or world events.',
    },
  },

  // ── Save/Load system ────────────────────────────────────────────────────

  save_system: {
    parentClass: 'AActor',
    components: [],
    variables: [
      { name: 'CurrentSlot', type: 'int', defaultValue: 0, isPublic: false },
      { name: 'MaxSlots', type: 'int', defaultValue: 3, isPublic: true },
      { name: 'bAutoSaveEnabled', type: 'bool', defaultValue: true, isPublic: true },
      { name: 'AutoSaveIntervalSec', type: 'float', defaultValue: 300.0, isPublic: true },
      { name: 'LastSaveTimestamp', type: 'string', defaultValue: '', isPublic: false },
    ],
    graph: {
      description: 'Save at bonfires/wayshrines → serialize player state (health, inventory, equipment, position, level, XP) + world state (quest progress, NPC states, opened chests, killed bosses) + corruption meter. Auto-save on zone transition. 3 manual slots + 1 auto slot. Load → deserialize and reconstruct world.',
    },
  },

  // ── Player HUD ──────────────────────────────────────────────────────────

  hud: {
    parentClass: 'AActor',
    components: [
      { type: 'WidgetComponent', name: 'HUDWidget', properties: {} },
    ],
    variables: [
      { name: 'bShowMinimap', type: 'bool', defaultValue: true, isPublic: true },
      { name: 'bShowDamageNumbers', type: 'bool', defaultValue: true, isPublic: true },
      { name: 'bBossBarVisible', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'BossName', type: 'string', defaultValue: '', isPublic: false },
      { name: 'BossHealthPercent', type: 'float', defaultValue: 1.0, isPublic: false },
      { name: 'CompassHeading', type: 'float', defaultValue: 0.0, isPublic: false },
    ],
    graph: {
      description: 'Always visible: health bar (red), stamina bar (green), mana bar (blue) — top-left. Shard ability icons with cooldown sweep — bottom. Minimap with North indicator — top-right. Interaction prompt "Press F" — center-bottom. Boss HP bar — top-center when in boss fight. Floating damage numbers. Status effect icons. Quest objective compass.',
    },
  },

  // ── Crafting system ─────────────────────────────────────────────────────

  crafting: {
    parentClass: 'AActor',
    components: [
      { type: 'WidgetComponent', name: 'CraftingWidget', properties: {} },
    ],
    variables: [
      { name: 'bCraftingOpen', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'CraftingType', type: 'string', defaultValue: 'forge', isPublic: true },
      { name: 'DiscoveredRecipes', type: 'object', defaultValue: null, isPublic: false },
    ],
    graph: {
      description: 'Interact with forge/alchemy table → open crafting UI. Left panel: recipe list (filter by type). Right panel: required materials with owned count. Craft button → consume materials, play animation, produce item. Weapon/armor upgrade paths: +1 to +5 with increasing material costs. Discovery: find recipe scrolls in world.',
    },
  },

  // ── Loot system ─────────────────────────────────────────────────────────

  loot: {
    parentClass: 'AActor',
    components: [
      { type: 'SphereComponent', name: 'PickupRadius', properties: {} },
      { type: 'StaticMeshComponent', name: 'LootBagMesh', properties: {} },
    ],
    variables: [
      { name: 'LootTableId', type: 'string', defaultValue: 'common', isPublic: true },
      { name: 'RarityTier', type: 'int', defaultValue: 0, isPublic: true },
      { name: 'AutoPickupRadius', type: 'float', defaultValue: 200.0, isPublic: true },
      { name: 'DespawnTimeSec', type: 'float', defaultValue: 120.0, isPublic: true },
    ],
    graph: {
      description: 'Enemy death → roll loot table by tier (common 60%, uncommon 25%, rare 10%, legendary 5%). Spawn loot bag with glow color by rarity. Player enters radius → auto-pickup gold/consumables. Manual pickup for equipment. Show item popup. Despawn after timer.',
    },
  },

  // ── World map ───────────────────────────────────────────────────────────

  map_ui: {
    parentClass: 'AActor',
    components: [
      { type: 'WidgetComponent', name: 'MapWidget', properties: {} },
    ],
    variables: [
      { name: 'bMapOpen', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'FogOfWarMask', type: 'object', defaultValue: null, isPublic: false },
      { name: 'DiscoveredWayshrines', type: 'object', defaultValue: null, isPublic: false },
      { name: 'bFastTravelEnabled', type: 'bool', defaultValue: true, isPublic: true },
    ],
    graph: {
      description: 'M key → toggle world map overlay. Parchment-style map with fog of war (reveal by exploring). Region icons with completion percentage. Discovered wayshrines as fast-travel points — click to teleport. Player position marker with direction. Quest objective markers. Zoom in/out.',
    },
  },

  // ── Leveling / progression ──────────────────────────────────────────────

  progression: {
    parentClass: 'AActor',
    components: [],
    variables: [
      { name: 'PlayerLevel', type: 'int', defaultValue: 1, isPublic: false },
      { name: 'CurrentXP', type: 'int', defaultValue: 0, isPublic: false },
      { name: 'XPToNextLevel', type: 'int', defaultValue: 100, isPublic: false },
      { name: 'StatPointsAvailable', type: 'int', defaultValue: 0, isPublic: false },
      { name: 'Vitality', type: 'int', defaultValue: 10, isPublic: false },
      { name: 'Strength', type: 'int', defaultValue: 10, isPublic: false },
      { name: 'Agility', type: 'int', defaultValue: 10, isPublic: false },
      { name: 'Arcana', type: 'int', defaultValue: 10, isPublic: false },
    ],
    graph: {
      description: 'Gain XP from kills (scaled by enemy level) and quest completion. Level up → play VFX + sound, grant 3 stat points. Stat allocation at bonfires: Vitality (+HP), Strength (+damage), Agility (+stamina, dodge speed), Arcana (+mana, shard power). XP curve: 100 * level^1.5.',
    },
  },

  // ── Tutorial system ─────────────────────────────────────────────────────

  tutorial: {
    parentClass: 'AActor',
    components: [
      { type: 'WidgetComponent', name: 'TutorialWidget', properties: {} },
    ],
    variables: [
      { name: 'ShownTutorials', type: 'object', defaultValue: null, isPublic: false },
      { name: 'bTutorialsEnabled', type: 'bool', defaultValue: true, isPublic: true },
    ],
    graph: {
      description: 'First-time triggers: movement (WASD), combat (first enemy), dodge (first boss), interact (first NPC), shard use (first shard pickup), inventory (first item). Semi-transparent overlay with button prompts. Dismissable. Saved to prevent re-showing.',
    },
  },

  // ── Pause menu ──────────────────────────────────────────────────────────

  menu_ui: {
    parentClass: 'AActor',
    components: [
      { type: 'WidgetComponent', name: 'PauseWidget', properties: {} },
    ],
    variables: [
      { name: 'bIsPaused', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'MasterVolume', type: 'float', defaultValue: 1.0, isPublic: true },
      { name: 'MusicVolume', type: 'float', defaultValue: 0.8, isPublic: true },
      { name: 'VoiceVolume', type: 'float', defaultValue: 1.0, isPublic: true },
      { name: 'SFXVolume', type: 'float', defaultValue: 1.0, isPublic: true },
    ],
    graph: {
      description: 'Escape → pause game, show overlay. Buttons: Resume, Settings (audio sliders, video quality, controls rebind), Save, Load, Quit to Menu, Quit to Desktop. Settings persist to ini file.',
    },
  },

  // ── Audio manager ───────────────────────────────────────────────────────

  audio_system: {
    parentClass: 'AActor',
    components: [
      { type: 'AudioComponent', name: 'MusicPlayer', properties: {} },
      { type: 'AudioComponent', name: 'AmbientPlayer', properties: {} },
      { type: 'AudioComponent', name: 'VoicePlayer', properties: {} },
    ],
    variables: [
      { name: 'CurrentRegionId', type: 'string', defaultValue: '', isPublic: false },
      { name: 'bInCombat', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'bInBossFight', type: 'bool', defaultValue: false, isPublic: false },
      { name: 'MusicFadeDuration', type: 'float', defaultValue: 2.0, isPublic: true },
      { name: 'VoiceLineQueue', type: 'object', defaultValue: null, isPublic: false },
      { name: 'AmbientLayerCount', type: 'int', defaultValue: 3, isPublic: true },
    ],
    graph: {
      description: 'Region enter → crossfade to region music track. Enemy aggro → transition to combat music. Boss arena → boss-specific theme. Combat end → fade back to ambient. Voice lines queued and played one at a time with priority. Ambient layers: base loop + wind/water + wildlife. Volume ducking during dialogue.',
    },
  },
};

// ── Build one Blueprint ─────────────────────────────────────────────────────

// Merged template lookup: built-in RPG templates + genre-specific templates
const ALL_TEMPLATES = { ...BLUEPRINT_TEMPLATES, ...GENRE_TEMPLATES };

/**
 * Build a single Blueprint class from a template.
 * Returns { success, blueprintName, steps }.
 */
async function buildOneBlueprint(bpDef, regionId) {
  const { name, type } = bpDef;
  const template = ALL_TEMPLATES[type];
  if (!template) {
    return { success: false, error: `Unknown Blueprint type: ${type}` };
  }

  const steps = [];

  try {
    // 1. Create the Blueprint
    log.info({ name, type, regionId }, 'Creating Blueprint');
    const createResult = await callTool('unreal', 'create_blueprint', {
      name,
      parent_class: template.parentClass,
    }, 30_000);

    if (createResult?.success === false) {
      return { success: false, error: `Failed to create Blueprint: ${createResult.message}` };
    }
    steps.push('created');

    // 2. Add components
    for (const comp of template.components) {
      try {
        await callTool('unreal', 'add_component_to_blueprint', {
          blueprint_name: name,
          component_type: comp.type,
          component_name: comp.name,
          component_properties: comp.properties,
        }, 15_000);
        steps.push(`component:${comp.name}`);
      } catch (err) {
        log.warn({ bp: name, comp: comp.name, err: err.message }, 'Component add failed');
      }
    }

    // 3. Create variables
    for (const v of template.variables) {
      try {
        await callTool('unreal', 'create_variable', {
          blueprint_name: name,
          variable_name: v.name,
          variable_type: v.type,
          default_value: v.defaultValue,
          is_public: v.isPublic,
          category: 'Gameplay',
        }, 15_000);
        steps.push(`variable:${v.name}`);
      } catch (err) {
        log.warn({ bp: name, var: v.name, err: err.message }, 'Variable create failed');
      }
    }

    // 4. Add a BeginPlay event node (foundation for all logic)
    try {
      const beginPlayResult = await callTool('unreal', 'add_node', {
        blueprint_name: name,
        node_type: 'Event',
        event_type: 'BeginPlay',
        pos_x: 0,
        pos_y: 0,
      }, 15_000);

      if (beginPlayResult?.node_id) {
        // Add a Print node connected to BeginPlay for verification
        const printResult = await callTool('unreal', 'add_node', {
          blueprint_name: name,
          node_type: 'Print',
          message: `${name} initialized`,
          pos_x: 300,
          pos_y: 0,
        }, 15_000);

        if (printResult?.node_id) {
          await callTool('unreal', 'connect_nodes', {
            blueprint_name: name,
            source_node_id: beginPlayResult.node_id,
            source_pin_name: 'Then',
            target_node_id: printResult.node_id,
            target_pin_name: 'Execute',
          }, 15_000);
          steps.push('graph:BeginPlay→Print');
        }
      }
    } catch (err) {
      log.warn({ bp: name, err: err.message }, 'Event graph setup failed');
    }

    // 5. Compile
    try {
      const compileResult = await callTool('unreal', 'compile_blueprint', {
        blueprint_name: name,
      }, 30_000);
      steps.push(compileResult?.success !== false ? 'compiled' : 'compile_failed');
    } catch (err) {
      steps.push('compile_error');
      log.warn({ bp: name, err: err.message }, 'Compile failed');
    }

    return { success: true, blueprintName: name, type, steps };
  } catch (err) {
    return { success: false, error: err.message, blueprintName: name, steps };
  }
}

// ── Build Blueprints for a region ───────────────────────────────────────────

/**
 * Build the next pending Blueprint in any region.
 * Returns { success, regionId, blueprintName, type, steps }.
 */
export async function buildNextBlueprint(opts = {}) {
  const manifestPath = getRegionManifestPath();
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  if (!manifest) return { success: false, error: 'No region manifest' };

  // Find next pending Blueprint
  let targetRegionId, targetBp;

  if (opts.regionId) {
    const region = manifest.regions[opts.regionId];
    if (region) {
      targetBp = (region.blueprints || []).find(bp => bp.status === 'pending');
      if (targetBp) targetRegionId = opts.regionId;
    }
  }

  if (!targetBp) {
    for (const [id, region] of Object.entries(manifest.regions)) {
      const pending = (region.blueprints || []).find(bp => bp.status === 'pending');
      if (pending) {
        targetRegionId = id;
        targetBp = pending;
        break;
      }
    }
  }

  if (!targetBp) {
    return { success: true, message: 'All Blueprints built' };
  }

  // Build it
  const result = await buildOneBlueprint(targetBp, targetRegionId);

  // Update manifest
  if (result.success) {
    targetBp.status = 'completed';
  } else {
    targetBp.status = 'failed';
    targetBp.error = result.error;
  }

  writeFileSync(getRegionManifestPath(), JSON.stringify(manifest, null, 2), 'utf-8');

  return {
    ...result,
    regionId: targetRegionId,
  };
}

// ── Progress ────────────────────────────────────────────────────────────────

export function getBlueprintProgress() {
  const p = getRegionManifestPath();
  if (!existsSync(p)) return { total: 0, completed: 0, pending: 0 };

  const manifest = JSON.parse(readFileSync(p, 'utf-8'));
  let total = 0, completed = 0, pending = 0, failed = 0;

  for (const region of Object.values(manifest.regions || {})) {
    for (const bp of region.blueprints || []) {
      total++;
      if (bp.status === 'completed') completed++;
      else if (bp.status === 'failed') failed++;
      else pending++;
    }
  }

  return { total, completed, pending, failed };
}

/**
 * Brief builder for Blueprint construction signal.
 */
export function buildBlueprintBrief(signal) {
  const d = signal.data;
  return {
    title: `UE5 Blueprint Construction — ${d.pending} Blueprints pending`,
    content: `${getActiveGame().displayName} needs ${d.pending} gameplay Blueprints built via Unreal MCP:
- ${d.completed}/${d.total} Blueprints complete
- World types: interactable, hazard, ambient, gameplay
- Character types: npc (with dialogue/voice), enemy (with boss phases)
- Player types: player_controller, combat, ability_system, progression
- UI types: inventory, dialogue_ui, quest_tracker, hud, map_ui, menu_ui, tutorial
- System types: save_system, crafting, loot, audio_system

Use \`build_blueprint\` to build the next pending Blueprint. Each Blueprint is created with:
1. Base class and components (mesh, trigger, audio, etc.)
2. Variables (health, damage, state flags)
3. Event graph nodes (BeginPlay, overlap, interact)
4. Compiled and validated

Available Blueprint graph tools:
- \`add_node\` — 23 node types (Branch, Event, Variable, CallFunction, SpawnActor, Timeline, etc.)
- \`connect_nodes\` — Wire execution/data pins between nodes
- \`create_variable\` — Add Blueprint variables
- \`create_function\` / \`add_function_input\` / \`add_function_output\` — Custom functions
- \`compile_blueprint\` — Validate and compile

For more complex logic, chain multiple calls to build the full event graph.`,
    reasoning: `Gameplay Blueprints define how game objects behave — interaction, damage, effects, boss AI. Build them to bring levels to life.`,
  };
}
