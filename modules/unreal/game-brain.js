/**
 * modules/unreal/game-brain.js — Game concept intake + design document generator.
 *
 * The missing layer between "user says build me a game" and "agent places meshes".
 *
 * Flow:
 *  1. User brief → Claude → Game Design Document (GDD) JSON
 *  2. GDD → region-manifest.json (regions with themes, lighting, blueprint slots)
 *  3. GDD → asset-manifest.json (asset classes per region)
 *  4. GDD → build-queue.json (plan_region + blueprint + structure + populate tasks)
 *  5. Sets the new game as active via game-config.js
 *
 * One Claude call handles the entire game design — genre, regions, assets, blueprints.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { createLogger } from '../../lib/logger.js';
import { chatOneShot } from '../../lib/claude.js';
import { createGame, getActiveGame } from './game-config.js';
import { getBlueprintsForGenre } from './genre-templates.js';

const log = createLogger('game-brain');

// ── Claude prompt ─────────────────────────────────────────────────────────────

function buildDesignPrompt(brief) {
  return `You are a senior game designer creating a Game Design Document for a UE5 game.

User's game concept: "${brief}"

Generate a complete GDD as a single JSON object. Return ONLY valid JSON — no explanation, no markdown, no comments.

{
  "gameId": "kebab-case-id-max-30-chars",
  "displayName": "Full Game Title",
  "genre": "rpg|shooter|platformer|puzzle|city-builder|rts|survival|horror|racing|sports",
  "subgenre": "more specific type (top-down, side-scroll, isometric, first-person, etc.)",
  "theme": "one-line atmospheric description",
  "artStyle": "visual style description (e.g. stylized dark fantasy, neon cyberpunk, cute cartoon)",
  "cameraType": "third-person|top-down|isometric|first-person|side-scroll",
  "inputScheme": "wasd-mouse-look|wasd-mouse-aim|wasd-click|arrow-keys|point-click",
  "coreLoop": "What the player does: verb → verb → verb",
  "playerStats": { "health": 100, "moveSpeed": 450, "add other relevant stats": 0 },
  "regions": [
    {
      "id": "snake_case_region_id",
      "displayName": "Region Display Name",
      "theme": "Detailed description of this area's look, mood, hazards",
      "terrain": "flat|hilly|indoor|vertical|maze|urban|forest|dungeon",
      "size": [8000, 8000],
      "difficulty": 1,
      "lightingPreset": "noon|afternoon|sunset|dusk|night|underground|overcast"
    }
  ],
  "assetClasses": [
    {
      "id": "snake_case_asset_id",
      "name": "Asset Display Name",
      "type": "hero|prop|environment|foliage",
      "description": "Detailed visual description for 3D model generation (mention materials, size, style)"
    }
  ],
  "blueprints": ["type_name_1", "type_name_2"],
  "winCondition": "How does the player win?",
  "lossCondition": "How does the player lose?"
}

CONSTRAINTS:
- gameId: lowercase, hyphens only, max 30 chars, make it unique (add number suffix)
- regions: 3-6 regions scaled to game complexity. First region = starting/tutorial area (difficulty 1)
- assetClasses: 10-20 total. Match the theme precisely. hero=1-3 (iconic landmark objects), prop=4-8 (interactive items), environment=4-8 (terrain features), foliage=2-4 (plants/debris)
- asset descriptions: detailed enough for 3D generation (e.g. "Rusted oil barrel with green liquid seeping from a crack. 1m tall, cylindrical, grunge texture")
- blueprints: 6-14 types. ONLY from this list:
  RPG: player_controller, combat, ability_system, npc, enemy, inventory, hud, quest_tracker, save_system, progression, loot, audio_system
  Shooter: player_controller_shooter, weapon_base, projectile, enemy_ai_shooter, wave_spawner, ammo_pickup, health_pack, hud_shooter, save_system
  Platformer: player_controller_platformer, moving_platform, hazard, checkpoint, collectible, enemy_patrol, hud_platformer, save_system
  Puzzle: player_controller_puzzle, pushable_block, pressure_plate, trigger_door, level_complete, hint_system, hud_puzzle
  City/RTS: building_base, resource_node, worker_unit, unit_base, fog_of_war, hud_city, hud_rts, save_system
  Universal: interactable, ambient, hazard, audio_system, save_system
- playerStats: realistic for genre. Shooter: health=100,moveSpeed=450. RPG: health=100,stamina=100,mana=50,moveSpeed=600. Platformer: health=3,moveSpeed=500,jumpForce=800
- region sizes: 6000-15000 UE5 units per side. Indoor/dungeon rooms: 3000-6000`;
}

// ── JSON extraction ───────────────────────────────────────────────────────────

function extractJson(text) {
  try { return JSON.parse(text.trim()); } catch { /* fall through */ }
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch { /* fall through */ }
  }
  return null;
}

// ── Lighting presets ─────────────────────────────────────────────────────────

const LIGHTING_PRESETS = {
  noon:        { timeOfDay: 'noon',       directionalColor: [1.0, 0.98, 0.95], intensity: 4.0, fog: false, ambientIntensity: 0.5 },
  afternoon:   { timeOfDay: 'afternoon',  directionalColor: [1.0, 0.92, 0.75], intensity: 3.5, fog: false, ambientIntensity: 0.4 },
  sunset:      { timeOfDay: 'sunset',     directionalColor: [1.0, 0.85, 0.6],  intensity: 3.0, fog: true,  fogColor: [0.9, 0.75, 0.5],  ambientIntensity: 0.4 },
  dusk:        { timeOfDay: 'dusk',       directionalColor: [1.0, 0.4, 0.1],   intensity: 2.5, fog: true,  fogColor: [0.3, 0.1, 0.05],  ambientIntensity: 0.2 },
  night:       { timeOfDay: 'night',      directionalColor: [0.4, 0.5, 0.8],   intensity: 1.0, fog: true,  fogColor: [0.05, 0.05, 0.1], ambientIntensity: 0.1 },
  underground: { timeOfDay: 'underground',directionalColor: [0.8, 0.6, 0.3],   intensity: 0.5, fog: false, ambientIntensity: 0.15 },
  overcast:    { timeOfDay: 'overcast',   directionalColor: [0.85, 0.88, 0.95],intensity: 2.0, fog: true,  fogColor: [0.7, 0.75, 0.8],  ambientIntensity: 0.45 },
};

function getLighting(preset) {
  return LIGHTING_PRESETS[preset] || LIGHTING_PRESETS.afternoon;
}

// ── GDD → region-manifest.json ────────────────────────────────────────────────

function buildRegionManifest(gdd) {
  const bpTypes = gdd.blueprints || getBlueprintsForGenre(gdd.genre);

  // Assign blueprints: region[0] gets all shared BPs; hazard/ambient/enemy per region
  const regionBpTypes = ['hazard', 'ambient', 'enemy', 'enemy_ai_shooter', 'enemy_patrol', 'enemy_ai_horror', 'wave_spawner'];

  const manifest = {
    version: 1,
    project: gdd.displayName,
    genre: gdd.genre,
    regions: {},
  };

  gdd.regions.forEach((r, idx) => {
    const bpsForRegion = [];

    if (idx === 0) {
      // First region: all non-region-specific BPs
      for (const t of bpTypes) {
        if (!regionBpTypes.includes(t)) {
          bpsForRegion.push({ name: `BP_${toPascalCase(t)}`, type: t, status: 'pending' });
        }
      }
    }

    // Every region gets its own hazard/ambient/enemy
    for (const t of bpTypes) {
      if (regionBpTypes.includes(t)) {
        bpsForRegion.push({
          name: `BP_${toPascalCase(r.id)}_${toPascalCase(t)}`,
          type: t,
          status: 'pending',
        });
      }
    }

    manifest.regions[r.id] = {
      levelName: `L_${toPascalCase(r.id)}`,
      displayName: r.displayName,
      status: 'pending',
      theme: r.theme,
      difficulty: r.difficulty || idx + 1,
      layout: {
        terrain: r.terrain || 'flat',
        size: r.size || [8000, 8000],
        keyLocations: [],
      },
      lighting: getLighting(r.lightingPreset || 'afternoon'),
      structures: [],
      blueprints: bpsForRegion,
      completedSteps: [],
      assetsReady: false,
    };
  });

  return manifest;
}

// ── GDD → asset-manifest.json ─────────────────────────────────────────────────

function buildAssetManifest(gdd) {
  const assets = gdd.assetClasses || [];
  const regions = gdd.regions || [];
  if (regions.length === 0) return null;

  // Distribute assets evenly across regions
  const perRegion = Math.ceil(assets.length / regions.length);
  const manifest = {
    version: 2,
    project: gdd.displayName,
    genre: gdd.genre,
    artDirection: {
      style: gdd.artStyle || 'stylized',
      polyBudget: {
        hero: '5000-15000 tris',
        prop: '500-3000 tris',
        environment: '1000-5000 tris',
        foliage: '200-800 tris',
      },
    },
    regions: {},
  };

  regions.forEach((r, rIdx) => {
    const regionAssets = assets.slice(rIdx * perRegion, (rIdx + 1) * perRegion);

    manifest.regions[r.id] = {
      theme: r.theme,
      assets: regionAssets.map(a => ({
        id: a.id,
        name: a.name,
        type: a.type,
        description: a.description,
        status: 'pending',
        fbx_path: null,
      })),
    };
  });

  return manifest;
}

// ── GDD → build task list ─────────────────────────────────────────────────────

function generateTasks(gdd) {
  const tasks = [];
  const regions = gdd.regions || [];
  const bpTypes = gdd.blueprints || getBlueprintsForGenre(gdd.genre);

  // Phase -1: AAA framework setup (UE5 required, highest priority after planning)
  // These run once for the entire game and set up core systems
  tasks.push({
    id: 'setup_game_framework',
    phase: 'framework',
    priority: 195,
    type: 'ue5_command',
    params: {
      commands: [
        { tool: 'create_game_instance', args: { name: `BP_${toPascalCase(gdd.gameId || 'game').replace(/-/g, '')}_GameInstance`, folder: '/Game/Core' } },
        { tool: 'create_player_state',  args: { name: `BP_${toPascalCase(gdd.gameId || 'game').replace(/-/g, '')}_PlayerState`,  folder: '/Game/Core' } },
        { tool: 'create_game_state',    args: { name: `BP_${toPascalCase(gdd.gameId || 'game').replace(/-/g, '')}_GameState`,    folder: '/Game/Core' } },
      ],
    },
  });

  tasks.push({
    id: 'setup_input_system',
    phase: 'framework',
    priority: 194,
    type: 'ue5_command',
    params: {
      commands: [
        { tool: 'create_input_mapping_context', args: { name: 'IMC_Default', folder: '/Game/Input' } },
        { tool: 'create_input_action', args: { name: 'IA_Move',   folder: '/Game/Input', value_type: 'Axis2D' } },
        { tool: 'create_input_action', args: { name: 'IA_Look',   folder: '/Game/Input', value_type: 'Axis2D' } },
        { tool: 'create_input_action', args: { name: 'IA_Jump',   folder: '/Game/Input', value_type: 'Boolean' } },
        { tool: 'create_input_action', args: { name: 'IA_Interact',folder: '/Game/Input', value_type: 'Boolean' } },
        { tool: 'create_input_action', args: { name: 'IA_Attack', folder: '/Game/Input', value_type: 'Boolean' } },
      ],
    },
  });

  tasks.push({
    id: 'setup_visual_quality',
    phase: 'framework',
    priority: 193,
    type: 'ue5_command',
    params: {
      commands: [
        { tool: 'create_post_process_volume', args: { unbound: true, bloom_intensity: 0.675, ao_intensity: 0.5, vignette_intensity: 0.4 } },
        { tool: 'add_height_fog',             args: { density: 0.02, start_distance: 100 } },
        { tool: 'add_sky_atmosphere',         args: {} },
      ],
    },
  });

  // Phase 0: Spatial planning (runs without UE5)
  regions.forEach((r, i) => {
    tasks.push({
      id: `plan_${r.id}`,
      phase: 'planning',
      priority: 200 - i,
      type: 'plan_region',
      params: { regionId: r.id },
    });
  });

  // Phase 1: Core blueprints (all non-region-specific)
  const regionBpTypes = ['hazard', 'ambient', 'enemy', 'enemy_ai_shooter', 'enemy_patrol', 'enemy_ai_horror', 'wave_spawner'];
  const coreBps = bpTypes.filter(t => !regionBpTypes.includes(t));

  coreBps.forEach((t, i) => {
    const name = `BP_${toPascalCase(t)}`;
    tasks.push({
      id: `bp_${t}`,
      phase: 'core',
      priority: 100 - i,
      type: 'blueprint',
      params: {
        bpType: t,
        name,
        path: `/Game/Blueprints/${blueprintCategory(t)}`,
      },
    });
  });

  // Phase 2: Region-specific blueprints
  let regionBpPriority = 70;
  regions.forEach(r => {
    for (const t of bpTypes) {
      if (regionBpTypes.includes(t)) {
        tasks.push({
          id: `bp_${r.id}_${t}`,
          phase: 'world',
          priority: regionBpPriority--,
          type: 'region_bp',
          params: {
            regionId: r.id,
            bpName: `BP_${toPascalCase(r.id)}_${toPascalCase(t)}`,
          },
        });
      }
    }
  });

  // Phase 3: Structures
  regions.forEach((r, i) => {
    tasks.push({
      id: `structure_${r.id}`,
      phase: 'content',
      priority: 40 - i,
      type: 'structure',
      params: { regionId: r.id },
    });
  });

  // Phase 4: Populate
  regions.forEach((r, i) => {
    tasks.push({
      id: `populate_${r.id}`,
      phase: 'content',
      priority: 30 - i,
      type: 'populate_region',
      params: { regionId: r.id },
    });
  });

  return tasks;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toPascalCase(str) {
  return str.replace(/(^|_|-)(\w)/g, (_, __, c) => c.toUpperCase());
}

function blueprintCategory(type) {
  if (['player_controller', 'player_controller_shooter', 'player_controller_platformer', 'player_controller_puzzle'].includes(type))
    return 'Characters';
  if (['combat', 'ability_system', 'progression', 'save_system', 'audio_system', 'inventory', 'loot', 'crafting'].includes(type))
    return 'Systems';
  if (['hud', 'hud_shooter', 'hud_platformer', 'hud_puzzle', 'hud_city', 'hud_rts', 'quest_tracker', 'dialogue_ui', 'map_ui', 'menu_ui'].includes(type))
    return 'UI';
  if (['weapon_base', 'projectile', 'ammo_pickup', 'health_pack'].includes(type))
    return 'Weapons';
  if (['building_base', 'resource_node', 'worker_unit', 'unit_base', 'fog_of_war'].includes(type))
    return 'Strategy';
  return 'Gameplay';
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Design a new game from a user brief.
 * Calls Claude, generates all manifests, seeds the build queue, sets active game.
 */
export async function designGame(brief) {
  log.info({ briefLen: brief.length }, 'Designing new game from brief');

  // 1. Call Claude
  const prompt = buildDesignPrompt(brief);
  let gdd;

  try {
    log.info('Calling Claude for game design');
    const response = await chatOneShot(prompt, null);
    gdd = extractJson(response);
    if (!gdd || !gdd.gameId) throw new Error('Claude returned invalid GDD');
    log.info({ gameId: gdd.gameId, genre: gdd.genre, regions: gdd.regions?.length }, 'GDD received from Claude');
  } catch (err) {
    log.warn({ err: err.message }, 'Claude GDD call failed — using minimal fallback');
    // Minimal fallback GDD
    const slug = brief.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 28);
    gdd = {
      gameId: `${slug}-001`,
      displayName: brief.slice(0, 40),
      genre: 'rpg',
      subgenre: 'action',
      theme: brief,
      artStyle: 'stylized fantasy',
      cameraType: 'third-person',
      inputScheme: 'wasd-mouse-look',
      coreLoop: 'explore → fight → survive',
      playerStats: { health: 100, moveSpeed: 500 },
      regions: [
        { id: 'region_one', displayName: 'Region One', theme: 'starting area', terrain: 'flat', size: [8000, 8000], difficulty: 1, lightingPreset: 'afternoon' },
        { id: 'region_two', displayName: 'Region Two', theme: 'middle area', terrain: 'varied', size: [10000, 10000], difficulty: 2, lightingPreset: 'sunset' },
      ],
      assetClasses: [
        { id: 'landmark_hero', name: 'Landmark', type: 'hero', description: 'Central landmark object for the starting area' },
        { id: 'basic_prop', name: 'Basic Prop', type: 'prop', description: 'Small decorative prop' },
        { id: 'rock_formation', name: 'Rock Formation', type: 'environment', description: 'Large rock cluster' },
        { id: 'small_bush', name: 'Bush', type: 'foliage', description: 'Low decorative bush' },
      ],
      blueprints: ['player_controller', 'enemy', 'hud', 'save_system'],
      winCondition: 'Complete all objectives',
      lossCondition: 'Health reaches zero',
    };
  }

  // 2. Create game workspace + set active
  const game = createGame(gdd);
  log.info({ gameId: gdd.gameId, basePath: game.basePath }, 'Game workspace created');

  // 3. Write GDD
  writeFileSync(game.gddPath, JSON.stringify(gdd, null, 2), 'utf-8');

  // 4. Write region-manifest.json
  const regionManifest = buildRegionManifest(gdd);
  writeFileSync(game.regionManifestPath, JSON.stringify(regionManifest, null, 2), 'utf-8');
  log.info({ regionCount: Object.keys(regionManifest.regions).length }, 'Region manifest written');

  // 5. Write asset-manifest.json
  const assetManifest = buildAssetManifest(gdd);
  if (assetManifest) {
    writeFileSync(game.assetManifestPath, JSON.stringify(assetManifest, null, 2), 'utf-8');
    log.info({ assetCount: gdd.assetClasses?.length }, 'Asset manifest written');
  }

  // 6. Seed build queue
  const rawTasks = generateTasks(gdd);
  const tasks = rawTasks.map(t => ({
    ...t,
    status: 'pending',
    attempts: 0,
    error: null,
    completedAt: null,
  }));

  const queue = { version: 1, createdAt: Date.now(), gameId: gdd.gameId, tasks };
  writeFileSync(game.buildQueuePath, JSON.stringify(queue, null, 2), 'utf-8');
  log.info({ taskCount: tasks.length }, 'Build queue seeded');

  return {
    success: true,
    gameId: gdd.gameId,
    displayName: gdd.displayName,
    genre: gdd.genre,
    regions: gdd.regions?.length || 0,
    assets: gdd.assetClasses?.length || 0,
    blueprints: gdd.blueprints?.length || 0,
    tasks: tasks.length,
    basePath: game.basePath,
    summary: `${gdd.displayName} (${gdd.genre}) — ${gdd.regions?.length} regions, ${gdd.assetClasses?.length} asset types, ${tasks.length} build tasks queued. Autonomous loop will start planning immediately.`,
  };
}
