/**
 * modules/unreal/index.js — Module manifest for UE5 level construction.
 *
 * Manages The Shattered Crown UE5 project via Unreal MCP:
 *  - Level building (castles, towns, structures)
 *  - Asset placement at keyLocations
 *  - Blueprint gameplay logic (interactables, hazards, NPCs, bosses)
 *  - Asset imports and compilation checks
 *  - Material and lighting setup
 */

import { detectUnrealSignals } from './signals.js';
import {
  buildLevelBuildBrief,
  buildAssetImportBrief,
  buildRegionStep,
  getRegionStatusReport,
  getRegionProgress,
  regionManifestExists,
  populateRegionAssets,
  populateAllRegions,
} from './level-builder.js';
import {
  buildBlueprintBrief,
  buildNextBlueprint,
  getBlueprintProgress,
} from './blueprint-builder.js';
import { buildPlayableGame } from './game-builder.js';
import { planRegion, planAllRegions, hasDetailedPlan } from './world-planner.js';
import { designGame } from './game-brain.js';
import { setActiveGame, listGames, getActiveGame } from './game-config.js';
import {
  buildGlobalEnvironment,
  getRegionProfile,
  getTransitions,
  exportProfilesToJSON,
  REGION_PROFILES,
  getVolumetricProfiles,
  getMergedRegionProfile,
  getCorruptionLighting,
  deployAllRegionHeightFog,
  deployRegionHeightFog,
  createCorruptionFogController,
  generateCorruptionFogDataTable,
  getMPCParameters,
  createLumenGIController,
  getLumenGIConfigs,
  deployAllLumenGI,
  createLightCookieController,
  getLightCookieSpecs,
  deployAllGodRayLights,
  computeTransitionLighting,
  getTransitionLightingSpec,
  deployTransitionController,
  createTransitionControllerBP,
  getLightingPerformanceBudget,
  generateLightingScalabilityConfig,
} from './global-environment.js';
import {
  getMFCorruptionBlendSpec,
  deployCorruptionMaterialFunction,
  getCorruptionTierParams,
  CORRUPTION_TIERS,
  getRVTCorruptionSpec,
  deployRVTCorruptionSystem,
  getRegionCorruptionConfig,
  getCorruptionMaterialInstances,
  deployCorruptionMaterialInstances,
  getNaniteDisplacementSpec,
  deployNaniteDisplacement,
  getWPOBreathingSpec,
  deployWPOBreathing,
  getCorruptionGameplaySpec,
  deployCorruptionGameplayEvents,
  getRVTPerformanceSpec,
  getOptimizedRegionSettings,
  deployRVTPerformanceOptimization,
} from './corruption-shader.js';
import {
  getDialogueTreeSpec,
  getDialogueTree,
  getNPCDialogueTrees,
  deployDialogueDataTables,
  getDialogueWiringSpec,
  wireDialogueToBlueprints,
  NPC_DIALOGUE_WIRING,
} from './npc-dialogue.js';
import {
  integrateAllBlueprints,
  getIntegrationStatus,
  exportIntegrationSpec,
  buildAllBlueprints,
  placeAllBlueprintActors,
  connectBlueprints,
} from './blueprint-integration.js';
import {
  generateImportScript,
  buildTestLevel,
  getImportReport,
  executeImportPipeline,
} from './ue5-import.js';
import {
  runBalanceValidation,
  createComboDataTable,
  exportBalanceReport,
} from './combo-balance.js';
import {
  createWhisperBlueprint,
  addMissingWhisperEntries,
  getWhisperStatus,
} from './whisper-audio.js';
import {
  createWillpowerBlueprint,
  createEndingSynthesisBlueprint,
  createEndingDataTables,
  exportWillpowerSpec,
  getWillpowerStatus,
  runPermutationTest,
} from './willpower-tracker.js';
import {
  addEndingVoiceEntries,
  getEndingVoiceStatus,
} from './ending-voice.js';
import {
  buildAllLipSync,
  buildAllLipSyncData,
  generateLineTiming,
} from './lip-sync.js';
import {
  RIVAL_PROFILE,
  RIVAL_COMBAT,
  MOTIVATION_ARC,
  RELATIONSHIP_STATES,
  ENCOUNTER_SCHEDULE,
  FINAL_OUTCOMES,
  RIVAL_AI_CONFIG,
  VEYRA_BLACKBOARD_KEYS,
  computeRivalCorruption,
  computeRivalShardSpec,
  exportRivalSpec,
  getRivalStateSummary,
  buildVeyraBehaviorTree,
  deployRivalAI,
  exportRivalAISpec,
  getRelationshipCombatStyle,
  getRelationshipFromScore,
  buildNpcBlackboardKeys,
  buildNpcBehaviorTree,
  // ms_3: Dynamic shard loadout
  SHARD_MATCHUP_MATRIX,
  createPlayerShardProfile,
  recordShardAction,
  analyzeBlindSpots,
  buildDynamicLoadout,
  exportRivalLoadout,
  getLoadoutSummary,
  // ms_4: Encounter scripting
  ENCOUNTER_SCRIPTS,
  ENCOUNTER_FLAGS,
  ENCOUNTER_PHASES,
  getAvailableEncounter,
  determineFinalOutcome,
  getEncounterTimeline,
  getAllEncounterSummaries,
  exportEncounterScripts,
  getEncounterProgress,
  // ms_5: 3-way boss fight
  COMBAT_FACTIONS,
  BOSS_FIGHT_ARCHETYPES,
  THREE_WAY_BOSS_FIGHTS,
  ALLEGIANCE_TRIGGERS,
  buildFactionMatrix,
  createThreatTable,
  buildThreeWayCombatSubtree,
  initBossFight,
  processAllegianceShift,
  getBossFightSummary,
  getAllBossFightSummaries,
  exportBossFightSpecs,
  // ms_6: Final act resolution paths
  RESOLUTION_PATH_TYPES,
  RESOLUTION_PATHS,
  OUTCOME_TO_PATH,
  getResolutionPath,
  buildResolutionSequence,
  getResolutionPathSummaries,
  exportResolutionPaths,
  // ms_7: Companion reactions to rival encounters
  COMPANION_REACTIONS,
  REACTION_TRIGGERS,
  getCompanionReactions,
  getCompanionAllReactions,
  getCompanionReactionSummary,
  exportCompanionReactions,
} from './rival-crown-seeker.js';
import {
  ECHO_DUNGEONS,
  SHARD_ECHOES,
  getDungeonSummaries,
  getDungeonLayout,
  getShardEchoes,
  canEnterDungeon,
  exportDungeonSpecs,
  // ms_2: Puzzle actor framework
  getPuzzleActorTypes,
  getPuzzleActorType,
  getPuzzleTemplates,
  getPuzzleTemplate,
  getActorStateMachine,
  getFlowNetworkInfo,
  validateFlowNetwork,
  exportPuzzleActorSpecs,
  // ms_3: Shard puzzle interactions
  getShardPuzzleAbilities,
  getShardPuzzleSummary,
  getActorInteractions,
  buildInteractionMatrix,
  exportShardPuzzleSpecs,
  // ms_4: Echo reward system
  createPlayerEchoState,
  awardDungeonCompletion,
  upgradeEcho,
  equipEcho,
  unequipEcho,
  getActiveSynergies,
  getEchoProgressionSummary,
  getEchoSynergies,
  getEchoRewardConfig,
  exportEchoRewardSpecs,
  // ms_6: Corruption interference for puzzle mechanics
  CORRUPTION_ACTOR_EFFECTS,
  DUNGEON_CORRUPTION_PROFILES,
  CORRUPTION_CLEANSE_METHODS,
  getCorruptionTier,
  getCorruptionEffect,
  getRoomCorruptionEffects,
  getDungeonCorruptionSummary,
  getAllCorruptionInterference,
  exportCorruptionInterferenceSpecs,
  // ms_7: World placement & discovery triggers
  DUNGEON_WORLD_PLACEMENTS,
  DUNGEON_DISCOVERY_TRIGGERS,
  DISCOVERY_STATES,
  DISCOVERY_TRIGGER_TYPES,
  createDiscoveryState,
  advanceDiscovery,
  getDungeonPlacement,
  getAllDungeonPlacements,
  exportWorldPlacementSpecs,
  // ms_5: Companion puzzle interactions (bond-gated)
  BOND_LEVELS,
  COMPANION_PUZZLE_PROFILES,
  DUAL_COMPANION_PUZZLES,
  COMPANION_SECRET_ROOMS,
  checkCompanionAbility,
  getAvailableCompanionAbilities,
  checkDualPuzzle,
  getAccessibleSecretRooms,
  getCompanionPuzzleSummary,
  buildCompanionInteractionMatrix,
  exportCompanionPuzzleSpecs,
} from './shard-echo-dungeons.js';
import {
  CHRONICLE_TEMPLATES,
  CHRONICLE_CHAPTERS,
  NARRATOR_CORRUPTION_TIERS,
  ENTRY_CATEGORIES,
  TEMPLATES_BY_CATEGORY,
  DISTORTION_OPS,
  getNarratorTier,
  buildChronicleEntry,
  getChronicleTemplateSpec,
  exportChronicleTemplateSpec,
  validateEntryData,
  getChronicleStatus,
  // ms_2: Chronicle Generation System
  loadChronicle,
  appendChronicleEntry,
  processQuestEvent,
  processCorruptionEvent,
  processBondEvent,
  processCombatEvent,
  processRivalEvent,
  processRegionEvent,
  processNPCEvent,
  processDungeonEvent,
  generateFromGameState,
  getChronicleEntries,
  getChronicleByChapter,
  getChronicleReliability,
  getNarratorMood,
  exportChronicleText,
  resetChronicle,
  getChronicleGeneratorStatus,
  // ms_2: Data source readers
  readCorruptionSource,
  readBondSource,
  readQuestSource,
  readDungeonSource,
  readRivalSource,
  readRegionSource,
  readNPCSource,
  scanAndGenerate,
  getGeneratorState,
  resetGeneratorState,
  // ms_3: Unreliable narrator text variants
  applyVocabularyShift,
  applyStructuralDistortion,
  applyNarratorVoice,
  buildEnhancedChronicleEntry,
  retroactivelyReviseEntries,
  generateTextVariants,
  handleTierTransition,
  getUnreliableNarratorStatus,
  generateContradiction,
  getInterjection,
  NARRATOR_VOCABULARY,
  NARRATOR_INTERJECTIONS,
  CONTRADICTION_PATTERNS,
  // ms_4: Chronicle UI
  getChronicleChapterList,
  navigateToChapter,
  getEntryDetail,
  searchChronicle,
  toggleBookmark,
  getBookmarkedEntries,
  setChronicleUIFilters,
  getChronicleUIState,
  deployChronicleUI,
  getChronicleUIStatus,
  // ms_5: Rival Counter-Chronicle
  buildCounterChronicleEntry,
  generateCounterEntries,
  getChronicleComparison,
  getCounterChronicleStatus,
  exportCounterChronicleSpec,
  // ms_7: NG+ Previous-Age Chapter Integration
  archiveCurrentAge,
  beginNewAge,
  getPreviousAgeEntries,
  getPreviousAgeSummary,
  crossAgeNarratorCallback,
  getCurrentAgeInfo,
} from './chronicle.js';
// ms_6: Chronicle Export System
import {
  exportEnhancedText,
  exportChronicleMarkdown,
  exportCounterChronicleText,
  exportDualChronicle,
  exportChapter,
  exportAll as exportAllChronicle,
  getExportStatus as getChronicleExportStatus,
} from './chronicle-export.js';
import {
  WAYSHRINE_CONCEPTS,
  WAYSHRINE_COMMON,
  WAYSHRINE_PLACEMENTS,
  getWayshrineConceptSummaries,
  getWayshrineConceptDetail,
  getAllWayshrinePositions,
  getWayshrineCommonSpec,
  exportWayshrineDesigns,
  getWayshrineDesignStatus,
  buildWayshrineBlueprint,
  buildAllWayshrineBlueprints,
  spawnWayshrineActor,
  spawnRegionWayshrines,
  spawnAllWayshrines,
  getWayshrineComponentSpec,
  getNiagaraSpec,
  getAllNiagaraSpecs,
  deployRegionNiagara,
  deployAllNiagara,
  exportNiagaraSpecs,
  getNiagaraDeploymentStatus,
  SUPPRESSION_PP_SPECS,
  generateSuppressionPPScript,
  deploySuppressionPP,
  deployAllSuppressionPP,
  getSuppressionPPSpec,
  getAllSuppressionPPSpecs,
  getSuppressionPPDeploymentStatus,
  exportSuppressionPPSpecs,
  // ms_5: Bloom Pulse & Cinematic Camera
  BLOOM_PULSE_SPECS,
  CINEMATIC_CAMERA_SPECS,
  generateBloomPulseScript,
  generateCinematicCameraScript,
  deployBloomPulse,
  deployAllBloomPulse,
  deployCinematicCamera,
  deployAllCinematicCameras,
  getBloomPulseSpec,
  getAllBloomPulseSpecs,
  getCinematicCameraSpec,
  getAllCinematicCameraSpecs,
  getRestFXDeploymentStatus,
  exportRestFXSpecs,
  // ms_6: Aethermere Reality Sphere
  AETHERMERE_REALITY_SPHERE,
  generateAethermereRealitySphereScript,
  buildAethermereRealitySphere,
  getAethermereRealitySphereSpec,
  getAethermereRealitySphereStatus,
  exportAethermereRealitySphereSpec,
  // ms_7: Full Deployment Orchestrator
  deployAllWayshrinesComplete,
  getFullDeploymentStatus,
  exportDeploymentManifest,
} from './wayshrine-design.js';
import {
  setupPoseSearchDatabase,
  setupMotionMatchingLocomotion,
  setupFootIK,
  setupCorruptionDistortion,
  setupFullMotionMatchingPipeline,
  setupBossMontages,
  getBossMontageData,
} from './motion-matching.js';
import {
  profileMotionMatching,
  deployScalabilityPreset,
  getScalabilityConfig,
  getPlatformBudgets,
} from './mm-performance.js';
import { registerTool } from '../../lib/tool-bridge.js';
import { callTool } from '../../lib/mcp-gateway.js';

// ── Register tools ───────────────────────────────────────────────────────────

// Core UE5 tools
registerTool({
  name: 'unreal_run_command',
  description: 'Execute a raw Unreal MCP command. Pass { tool: "tool_name", args: {...} }. Available tools: get_actors_in_level, find_actors_by_name, delete_actor, set_actor_transform, create_blueprint, add_component_to_blueprint, set_static_mesh_properties, set_physics_properties, compile_blueprint, create_pyramid, create_wall, create_tower, create_staircase, construct_house, construct_mansion, create_arch, create_maze, get_available_materials, apply_material_to_actor, apply_material_to_blueprint, get_actor_material_info, set_mesh_material_color, create_town, create_castle_fortress, create_suspension_bridge, create_aqueduct, add_node, connect_nodes, create_variable, set_blueprint_variable_properties, add_event_node, delete_node, set_node_property, create_function, add_function_input, add_function_output, delete_function, rename_function, read_blueprint_content, analyze_blueprint_graph, get_blueprint_variable_details, get_blueprint_function_details. AAA tools: create_behavior_tree, create_blackboard, create_ai_controller, add_navmesh_bounds_volume, build_navigation, create_data_table, add_data_table_row, read_data_table, create_enum, create_struct, create_input_action, create_input_mapping_context, add_key_mapping, create_widget_blueprint, create_hud_blueprint, create_post_process_volume, spawn_niagara_system, add_height_fog, add_sky_atmosphere, create_game_instance, create_player_state, create_game_state, set_project_game_mode, create_anim_blueprint, get_skeleton_list.',
  async execute(params) {
    const toolName = params.tool || params.command;
    const args = params.args || {};
    const timeout = params.timeout || 60_000;
    return callTool('unreal', toolName, args, timeout);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'unreal_get_scene',
  description: 'Get all actors in the current UE5 level. Returns list of actors with names, types, locations.',
  async execute() {
    return callTool('unreal', 'get_actors_in_level', {}, 15_000);
  },
}, { rateLimit: 5000 });

// Level building tools
registerTool({
  name: 'build_region',
  description: 'Build the next step of a UE5 region level. Steps: structures → assets → lighting → materials. The assets step uses world-plan.json (50-100 positions) if plan_world ran first, otherwise falls back to 6 keyLocations. Pass optional { regionId } to target a specific region, or omit to auto-pick. Returns progress info. Requires Unreal Editor to be open with the project.',
  async execute(params) {
    return buildRegionStep(params || {});
  },
}, { rateLimit: 120000 }); // 2 min — building structures takes time

registerTool({
  name: 'region_progress',
  description: 'Get detailed progress of UE5 level construction. Returns per-region status, completed steps, and Blueprint progress.',
  async execute() {
    return getRegionStatusReport();
  },
}, { rateLimit: 5000 });

// Blueprint building tools
registerTool({
  name: 'build_blueprint',
  description: 'Build the next pending gameplay Blueprint. Creates the class, adds components/variables, builds initial event graph, and compiles. Pass optional { regionId } to target a specific region. Types: interactable, hazard, ambient, npc, enemy, gameplay.',
  async execute(params) {
    return buildNextBlueprint(params || {});
  },
}, { rateLimit: 60000 }); // 1 min

// Build playable game (all phases)
registerTool({
  name: 'build_playable_game',
  description: 'Autonomously build everything needed for a playable Shattered Crown session: BP_Kael character, BP_SCGameMode, TestArena level (floor/walls/lighting), and all pending region Blueprints. Requires UE5 editor to be open with the ShatteredCrown project. Takes ~10-20 minutes. Reports progress step by step.',
  async execute(_params, onProgress) {
    const messages = [];
    const progress = (msg) => {
      messages.push(msg);
      onProgress?.(msg);
    };
    const result = await buildPlayableGame(progress);
    return { ...result, log: messages };
  },
}, { rateLimit: 300_000 }); // 5 min cooldown

// Asset population — import FBX files + place in levels
registerTool({
  name: 'populate_region',
  description: 'Import all generated FBX assets for a region into UE5 and place them at their keyLocations. Pass { regionId: "CrossroadsHub" }. Requires UE5 editor open.',
  async execute(params) {
    if (!params?.regionId) return { success: false, error: 'regionId required' };
    return populateRegionAssets(params.regionId);
  },
}, { rateLimit: 300_000 });

registerTool({
  name: 'populate_all_regions',
  description: 'Import and place all generated 3D assets across every region in The Shattered Crown UE5 project. Processes all 51 FBX files. Requires UE5 editor open.',
  async execute() {
    return populateAllRegions();
  },
}, { rateLimit: 600_000 }); // 10 min cooldown

// Spatial planning — generates dense placement maps before building
registerTool({
  name: 'plan_world',
  description: 'Generate spatial layout plans for all regions using AI reasoning. Plans hero placement (singular, prominent), prop clusters, environment scatter, foliage. Produces 50-100 actor positions per region saved to world-plan.json. Must run before populate_region. Pass { regionId } to plan a single region, or omit to plan all 5 regions.',
  async execute(params) {
    if (params?.regionId) return planRegion(params.regionId);
    return planAllRegions();
  },
}, { rateLimit: 600_000 });

// Game design & project management tools
registerTool({
  name: 'design_game',
  description: 'Design and initialize a completely new game from a natural language brief. Claude generates the Game Design Document (genre, regions, assets, blueprints, mechanics), creates the workspace, writes all manifests, and seeds the autonomous build queue. Example: { brief: "build me a top-down zombie shooter" } or { brief: "a puzzle game where you push blocks onto tiles" }. The agent will start building autonomously after this call.',
  async execute(params) {
    if (!params?.brief) return { success: false, error: 'brief required — describe your game concept' };
    return designGame(params.brief);
  },
}, { rateLimit: 120_000 }); // 2 min — involves a Claude call

registerTool({
  name: 'switch_game',
  description: 'Switch the active game project. All builders (region, blueprint, populate) will operate on the switched-to game. Pass { gameId: "my-game-id" }. Use list_games to see available projects.',
  async execute(params) {
    if (!params?.gameId) return { success: false, error: 'gameId required' };
    return setActiveGame(params.gameId);
  },
}, { rateLimit: 1000 });

registerTool({
  name: 'list_games',
  description: 'List all game projects in the workspace. Shows gameId, displayName, genre, and which is currently active.',
  async execute() {
    const games = listGames();
    const active = getActiveGame();
    return { activeGame: active.gameId, games };
  },
}, { rateLimit: 1000 });

// Construction shortcut tools (pass-through to Unreal MCP)
registerTool({
  name: 'build_castle',
  description: 'Build a castle fortress in UE5. Pass { location, size, style, name_prefix }. Size: small/medium/large/epic. Style: medieval/fantasy/gothic.',
  async execute(params) {
    return callTool('unreal', 'create_castle_fortress', {
      castle_size: params.size || 'large',
      location: params.location || [0, 0, 0],
      name_prefix: params.name_prefix || 'Castle',
      include_siege_weapons: params.siege_weapons !== false,
      include_village: params.village !== false,
      architectural_style: params.style || 'medieval',
    }, 300_000);
  },
}, { rateLimit: 120000 });

registerTool({
  name: 'build_town',
  description: 'Build a full town in UE5. Pass { location, size, density, style, name_prefix }. Size: small/medium/large/metropolis. Style: modern/cottage/mansion/mixed/downtown/futuristic.',
  async execute(params) {
    return callTool('unreal', 'create_town', {
      town_size: params.size || 'medium',
      building_density: params.density || 0.7,
      location: params.location || [0, 0, 0],
      name_prefix: params.name_prefix || 'Town',
      include_infrastructure: params.infrastructure !== false,
      architectural_style: params.style || 'mixed',
    }, 300_000);
  },
}, { rateLimit: 120000 });

// ── AAA: AI Tools ─────────────────────────────────────────────────────────────

registerTool({
  name: 'create_behavior_tree',
  description: 'Create a Behavior Tree + Blackboard asset pair for AI. Pass { name, blackboard_name, folder }. Default keys: TargetActor, TargetLocation, bCanAttack, PatrolIndex, AlertLevel. Requires UE5 editor.',
  async execute(params) {
    return callTool('unreal', 'create_behavior_tree', {
      name: params.name || 'BT_NewAI',
      blackboard_name: params.blackboard_name || `BB_${(params.name || 'NewAI').replace(/^BT_/, '')}`,
      folder: params.folder || '/Game/AI',
    }, 30_000);
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'create_blackboard',
  description: 'Create a Blackboard asset with custom keys. Pass { name, folder, keys: [{name, type}] }. Types: Object|Vector|Bool|Float|Int|Name.',
  async execute(params) {
    return callTool('unreal', 'create_blackboard', {
      name: params.name || 'BB_NewBlackboard',
      folder: params.folder || '/Game/AI',
      keys: params.keys || [],
    }, 30_000);
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'create_ai_controller',
  description: 'Create an AI Controller Blueprint in UE5. Pass { name, folder }.',
  async execute(params) {
    return callTool('unreal', 'create_ai_controller', {
      name: params.name || 'BP_AIController',
      folder: params.folder || '/Game/AI',
    }, 30_000);
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'setup_navmesh',
  description: 'Add a NavMeshBoundsVolume and rebuild navigation. Pass { location, scale }. Scale default [50,50,20] = 5000×5000×2000cm. Requires UE5 editor.',
  async execute(params) {
    await callTool('unreal', 'add_navmesh_bounds_volume', {
      location: params.location || [0, 0, 0],
      scale: params.scale || [50, 50, 20],
    }, 15_000);
    return callTool('unreal', 'build_navigation', {}, 60_000);
  },
}, { rateLimit: 30000 });

// ── AAA: Data Tools ───────────────────────────────────────────────────────────

registerTool({
  name: 'create_data_table',
  description: 'Create a DataTable asset in UE5. Pass { name, folder, rows: [{key, label, value, count, notes}] }.',
  async execute(params) {
    return callTool('unreal', 'create_data_table', {
      name: params.name || 'DT_NewTable',
      folder: params.folder || '/Game/Data',
      rows: params.rows || [],
    }, 30_000);
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'create_enum',
  description: 'Create a Blueprint Enum in UE5. Pass { name, folder, values: ["Value1","Value2"] }.',
  async execute(params) {
    return callTool('unreal', 'create_enum', {
      name: params.name || 'E_NewEnum',
      folder: params.folder || '/Game/Data',
      values: params.values || [],
    }, 30_000);
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'create_struct',
  description: 'Create a Blueprint Struct in UE5. Pass { name, folder, fields: [{name, type}] }. Types: int32|float|bool|FString|FName|FVector.',
  async execute(params) {
    return callTool('unreal', 'create_struct', {
      name: params.name || 'F_NewStruct',
      folder: params.folder || '/Game/Data',
      fields: params.fields || [],
    }, 30_000);
  },
}, { rateLimit: 10000 });

// ── AAA: Input Tools ──────────────────────────────────────────────────────────

registerTool({
  name: 'setup_enhanced_input',
  description: 'Create Enhanced Input system: InputMappingContext + InputActions for a game. Pass { context_name, folder, actions: [{name, value_type, keys}] }. value_type: Boolean|Axis1D|Axis2D. Example: actions=[{name:"IA_Move",value_type:"Axis2D",keys:["W","S","A","D"]}].',
  async execute(params) {
    const folder = params.folder || '/Game/Input';
    const contextName = params.context_name || 'IMC_Default';

    // Create the mapping context
    const ctxResult = await callTool('unreal', 'create_input_mapping_context', {
      name: contextName, folder,
    }, 15_000);

    const contextPath = `${folder}/${contextName}.${contextName}`;
    const created = [];
    const errors = [];

    for (const action of (params.actions || [])) {
      try {
        const iaResult = await callTool('unreal', 'create_input_action', {
          name: action.name,
          folder,
          value_type: action.value_type || 'Boolean',
        }, 15_000);
        created.push(action.name);

        // Map keys
        for (const key of (action.keys || [])) {
          await callTool('unreal', 'add_key_mapping', {
            context_path: contextPath,
            action_path: `${folder}/${action.name}.${action.name}`,
            key,
          }, 10_000);
        }
      } catch (err) {
        errors.push({ action: action.name, error: err.message });
      }
    }

    return { success: true, context: contextPath, created, errors };
  },
}, { rateLimit: 60000 });

// ── AAA: UI Tools ─────────────────────────────────────────────────────────────

registerTool({
  name: 'create_widget',
  description: 'Create a UMG Widget Blueprint in UE5 (for HUD, menus, inventory). Pass { name, folder }.',
  async execute(params) {
    return callTool('unreal', 'create_widget_blueprint', {
      name: params.name || 'WBP_NewWidget',
      folder: params.folder || '/Game/UI',
    }, 30_000);
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'create_hud',
  description: 'Create a HUD Blueprint in UE5. Pass { name, folder }.',
  async execute(params) {
    return callTool('unreal', 'create_hud_blueprint', {
      name: params.name || 'BP_HUD',
      folder: params.folder || '/Game/UI',
    }, 30_000);
  },
}, { rateLimit: 10000 });

// ── AAA: VFX / Visual Quality Tools ──────────────────────────────────────────

registerTool({
  name: 'setup_visual_quality',
  description: 'Add a global Post Process Volume + height fog + sky atmosphere for AAA visual quality. Pass { bloom_intensity, exposure_bias, ao_intensity, fog_density }.',
  async execute(params) {
    const results = [];

    // Post Process Volume (global)
    results.push(await callTool('unreal', 'create_post_process_volume', {
      unbound: true,
      bloom_intensity: params.bloom_intensity ?? 0.675,
      exposure_bias: params.exposure_bias ?? 0.0,
      ao_intensity: params.ao_intensity ?? 0.5,
      vignette_intensity: params.vignette_intensity ?? 0.4,
    }, 15_000));

    // Height fog
    results.push(await callTool('unreal', 'add_height_fog', {
      density: params.fog_density ?? 0.02,
      start_distance: params.fog_start ?? 100,
    }, 10_000));

    // Sky atmosphere
    results.push(await callTool('unreal', 'add_sky_atmosphere', {}, 10_000));

    return { success: true, steps: results };
  },
}, { rateLimit: 30000 });

registerTool({
  name: 'spawn_vfx',
  description: 'Spawn a Niagara particle system at a location. Pass { system_path, location }. system_path: content path to UNiagaraSystem asset.',
  async execute(params) {
    return callTool('unreal', 'spawn_niagara_system', {
      system_path: params.system_path || '',
      location: params.location || [0, 0, 0],
    }, 15_000);
  },
}, { rateLimit: 5000 });

// ── Global Environment Tools ──────────────────────────────────────────────────

registerTool({
  name: 'setup_global_environment',
  description: 'Build the complete global environment system: per-region lighting profiles, post-processing controller, fog settings, and 7 region transition volumes. Creates BP_GlobalPostProcess, BP_GlobalLighting, BP_RegionTransition. Requires UE5 editor open.',
  async execute() {
    return buildGlobalEnvironment();
  },
}, { rateLimit: 300_000 }); // 5 min — creates multiple BPs and actors

registerTool({
  name: 'export_environment_profiles',
  description: 'Export all 8 region environment profiles (lighting, fog, post-processing) to a JSON file in the game assets. Used by runtime code to apply per-region visuals.',
  async execute() {
    return exportProfilesToJSON();
  },
}, { rateLimit: 10_000 });

// ── Volumetric Height Fog Tools ────────────────────────────────────────────────

registerTool({
  name: 'deploy_region_heightfog',
  description: 'Deploy ExponentialHeightFog with volumetric settings for a specific region. Uses Python script or Blueprint fallback. Pass regionId (e.g. "EmberPeaks").',
  async execute({ regionId }) {
    if (!regionId) return { success: false, error: 'regionId required' };
    return deployRegionHeightFog(regionId);
  },
}, { rateLimit: 15_000 });

registerTool({
  name: 'deploy_all_heightfog',
  description: 'Deploy ExponentialHeightFog actors for ALL 8 regions with volumetric settings (fog density, height falloff, inscattering color, second fog layer, volumetric fog). Requires UE5 editor open.',
  async execute() {
    return deployAllRegionHeightFog();
  },
}, { rateLimit: 300_000 }); // 5 min — deploys 8 fog actors

// ── Corruption Fog Controller Tools (ms_3) ────────────────────────────────────

registerTool({
  name: 'create_corruption_fog_controller',
  description: 'Create BP_CorruptionFogController — bridges corruption level to fog parameters via MPC. Adds 12 variables, 5 functions, BeginPlay+Tick events. Wires to BP_CorruptionMeter and BP_RegionTransition dispatchers. Requires UE5 editor open.',
  async execute() {
    return createCorruptionFogController();
  },
}, { rateLimit: 300_000 }); // 5 min

registerTool({
  name: 'get_corruption_fog_data',
  description: 'Generate the corruption fog data table spec — pre-computed fog values for all regions × 5 corruption tiers (40 rows). Returns { tableName, struct, rows }.',
  async execute() {
    return generateCorruptionFogDataTable();
  },
}, { rateLimit: 10_000 });

// ── Lumen GI Tools (ms_4) ─────────────────────────────────────────────────────

registerTool({
  name: 'create_lumen_gi_controller',
  description: 'Create BP_LumenGIController — manages per-region Lumen GI quality. Stores 8 region presets (finalGatherQuality, sceneDetail, surfaceCacheRes) as variables. Includes OnRegionChanged, UpdateLumenSettings, ApplyToPostProcess, SetQualityScale functions. Requires UE5.',
  async execute() {
    return createLumenGIController();
  },
}, { rateLimit: 300_000 });

registerTool({
  name: 'deploy_all_lumen_gi',
  description: 'Deploy Lumen GI PostProcessVolumes for all 8 regions. Creates per-region PPVs with Lumen quality, scene detail, gather quality, surface cache, and post-process settings. Falls back to BP runtime if Unreal unavailable.',
  async execute() {
    return deployAllLumenGI();
  },
}, { rateLimit: 300_000 });

registerTool({
  name: 'get_lumen_gi_configs',
  description: 'Get all 8 region Lumen GI configurations (quality, detail, screen traces, surface cache). Read-only, returns config map.',
  async execute() {
    return getLumenGIConfigs();
  },
}, { rateLimit: 10_000 });

// ── Light Cookie / God Ray Tools (ms_5) ───────────────────────────────────────

registerTool({
  name: 'create_light_cookie_controller',
  description: 'Create BP_LightCookieController — manages per-region god ray lights with cookie textures. 18 vars (intensity presets, animation state, corruption dampen), 5 functions. Supports animated caustics (SunkenHalls) and wind-swaying canopy (VerdantReach).',
  async execute() {
    return createLightCookieController();
  },
}, { rateLimit: 300_000 });

registerTool({
  name: 'deploy_all_god_rays',
  description: 'Deploy directional lights with god ray settings for all regions. Creates GodRay_[Region] actors with light shaft bloom, occlusion, and cookie texture references. 7 of 8 regions get god rays (Aethermere has none).',
  async execute() {
    return deployAllGodRayLights();
  },
}, { rateLimit: 300_000 });

registerTool({
  name: 'get_light_cookie_specs',
  description: 'Get all 5 light cookie texture specifications — procedural generation parameters, material nodes, resolution, animation settings. Used by UE5 Material Editor to create cookie textures.',
  async execute() {
    return getLightCookieSpecs();
  },
}, { rateLimit: 10_000 });

// ── Region Transition Lighting Tools (ms_6) ──────────────────────────────────

registerTool({
  name: 'deploy_transition_lighting',
  description: 'Deploy the region transition lighting interpolation system. Creates BP_RegionTransitionController with per-tick lerp between region profiles, saves transition-lighting-spec.json with 7 transition pairs and pre-computed lookup tables. Also generates UE5 Python script if editor is available.',
  async execute() {
    // Save spec + try deploying controller BP
    const deployResult = await deployTransitionController();
    // Also try creating the BP via MCP calls as fallback
    if (deployResult.method === 'deferred' || deployResult.method === 'deferred_after_error') {
      try {
        const bpResult = await createTransitionControllerBP();
        return { ...deployResult, bpCreation: bpResult };
      } catch {
        return deployResult;
      }
    }
    return deployResult;
  },
}, { rateLimit: 300_000 });

registerTool({
  name: 'get_transition_lighting',
  description: 'Get interpolated lighting parameters for a region transition at a given alpha. Pass { from, to, alpha } where alpha is 0-1 blend factor. Returns sun, fog, post-process values. Useful for previewing or debugging transitions.',
  async execute(params) {
    const { from, to, alpha } = params || {};
    if (!from || !to) return { error: 'Provide from and to region names' };
    return computeTransitionLighting(from, to, alpha ?? 0.5);
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'get_transition_lighting_spec',
  description: 'Get the full transition lighting specification — all 7 region pairs with pre-computed lookup tables at 5 alpha steps, easing/blend settings, and MPC bindings. Used for BP configuration and debugging.',
  async execute() {
    return getTransitionLightingSpec();
  },
}, { rateLimit: 10_000 });

// ── Lighting Performance Tools (ms_7) ─────────────────────────────────────────

registerTool({
  name: 'lighting_performance_budget',
  description: 'Get the complete lighting performance budget for all target platforms (PC High/Ultra/Low, Steam Deck). Shows per-feature GPU cost in ms, scalability settings per quality tier, total budget analysis, headroom, and optimization recommendations.',
  async execute() {
    return getLightingPerformanceBudget();
  },
}, { rateLimit: 10_000 });

registerTool({
  name: 'lighting_scalability_config',
  description: 'Generate UE5 scalability configuration for the lighting system. Returns per-tier (high/medium/low) settings for shadow cascades, volumetric fog, Lumen quality, god rays, and post-process — ready for DefaultScalability.ini.',
  async execute() {
    return generateLightingScalabilityConfig();
  },
}, { rateLimit: 10_000 });

// ── Corruption Shader Tools ──────────────────────────────────────────────────

registerTool({
  name: 'deploy_corruption_shader',
  description: 'Deploy the corruption surface propagation shader system. Creates MF_CorruptionBlend material function and M_CorruptedSurface master material in UE5. Saves corruption-shader-spec.json with 5-tier visual progression, noise parameters, and blend logic. Falls back to local spec if UE5 unavailable.',
  async execute() {
    return deployCorruptionMaterialFunction();
  },
}, { rateLimit: 300_000 });

registerTool({
  name: 'get_corruption_shader_spec',
  description: 'Get the full MF_CorruptionBlend material function specification — inputs, outputs, noise nodes, tier definitions, and HLSL-like blend logic. Used for manual UE5 material editor implementation.',
  async execute() {
    return getMFCorruptionBlendSpec();
  },
}, { rateLimit: 10_000 });

registerTool({
  name: 'get_corruption_tier_visual',
  description: 'Get interpolated corruption visual parameters at a given level. Pass { level: 0.0-1.0 }. Returns baseColorTint, roughnessOffset, emissiveIntensity, normalStrength, displacementHeight for the given corruption amount.',
  async execute(params) {
    return getCorruptionTierParams(params?.level ?? 0.5);
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'deploy_rvt_corruption',
  description: 'Deploy the RVT corruption painting system. Creates RVT_CorruptionMask runtime virtual texture (8K, R8), BP_CorruptionPainter component, ECorruptionBrush enum, and per-region corruption configs. 4 brush types (circular, organic, directional, splatter) and 5 corruption source types.',
  async execute() {
    return deployRVTCorruptionSystem();
  },
}, { rateLimit: 300_000 });

registerTool({
  name: 'get_rvt_corruption_spec',
  description: 'Get the full RVT corruption painting specification — texture config, brush types, spread params, per-region settings, corruption sources, and BP_CorruptionPainter blueprint spec.',
  async execute() {
    return getRVTCorruptionSpec();
  },
}, { rateLimit: 10_000 });

registerTool({
  name: 'get_region_corruption_config',
  description: 'Get corruption painting config for a specific region. Pass { regionId }. Returns initial corruption, max corruption, spread multiplier, brush types.',
  async execute(params) {
    return getRegionCorruptionConfig(params?.regionId ?? 'CrossroadsHub');
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'deploy_corruption_materials',
  description: 'Deploy all 4 corruption material instances (T1 Veins, T2 Stain, T3 Mass, T4 Eruption). Each MI inherits from M_CorruptedSurface with tier-specific parameters for color, emissive, displacement, and animation.',
  async execute() {
    return deployCorruptionMaterialInstances();
  },
}, { rateLimit: 300_000 });

registerTool({
  name: 'get_corruption_materials',
  description: 'Get all corruption material instance definitions — 4 tiers with parameters, textures, and parent material reference.',
  async execute() {
    return getCorruptionMaterialInstances();
  },
}, { rateLimit: 10_000 });

registerTool({
  name: 'deploy_nanite_displacement',
  description: 'Deploy Nanite displacement for corruption T3 (5cm ridges) and T4 (15cm eruptions). Configures tessellation on M_CorruptedSurface, updates MI params for displacement scale/noise/cracks, creates MF_CorruptionPOM fallback for non-Nanite meshes. Includes LOD fade and scalability settings.',
  async execute() {
    return deployNaniteDisplacement();
  },
}, { rateLimit: 300_000 });

registerTool({
  name: 'get_nanite_displacement_spec',
  description: 'Get Nanite displacement specification — T3/T4 height configs, POM fallback steps, crack emissive params, LOD distances, performance budget, and scalability tiers.',
  async execute() {
    return getNaniteDisplacementSpec();
  },
}, { rateLimit: 10_000 });

registerTool({
  name: 'deploy_wpo_breathing',
  description: 'Deploy WPO breathing animation for corruption surfaces. Creates MF_CorruptionBreathing material function with 4 additive layers: primary breath (sine), heartbeat pulse, organic noise, and reaction burst. Updates T2-T4 material instances with per-tier WPO amplitude. Adds CorruptionPulse + BreathSpeedMultiplier to MPC.',
  async execute() {
    return deployWPOBreathing();
  },
}, { rateLimit: 300_000 });

registerTool({
  name: 'get_wpo_breathing_spec',
  description: 'Get WPO breathing animation specification — 4 animation layers with per-tier amplitudes, HLSL summary, MPC parameters, LOD fade, wind interaction, and performance scalability.',
  async execute() {
    return getWPOBreathingSpec();
  },
}, { rateLimit: 10_000 });

registerTool({
  name: 'deploy_corruption_gameplay',
  description: 'Deploy corruption gameplay event integration. Creates BP_CorruptionEventDispatcher (GameInstance Subsystem), ECorruptionEvent enum (10 events), and event config JSON. Events: boss_death, shard_pickup/equip/unequip, story corruption, whisper escalation, healer cleanse, willpower resist, region enter, corruption well proximity. Each event routes to MPC + RVT + Audio + VFX + Post-Process.',
  async execute() {
    return deployCorruptionGameplayEvents();
  },
}, { rateLimit: 300_000 });

registerTool({
  name: 'get_corruption_gameplay_spec',
  description: 'Get corruption gameplay event specification — 10 event definitions with MPC effects, RVT painting params, audio/VFX triggers, post-process settings, and BP_CorruptionEventDispatcher public functions and delegates.',
  async execute() {
    return getCorruptionGameplaySpec();
  },
}, { rateLimit: 10_000 });

// ── RVT Performance Optimization Tools ───────────────────────────────────────

registerTool({
  name: 'deploy_rvt_performance',
  description: 'Deploy RVT performance optimization system for corruption shaders across all 8 regions. Creates scalability tiers (Low/Med/High/Epic), per-region performance profiles with draw distance/noise/tile budgets, shader LOD with 4 distance bands, GPU auto-scaling config, tile streaming priorities, and 12 CVars. Saves corruption-rvt-performance.json + per-region settings.',
  async execute() {
    return deployRVTPerformanceOptimization();
  },
}, { rateLimit: 300_000 });

registerTool({
  name: 'get_rvt_performance_spec',
  description: 'Get the full RVT corruption performance specification — scalability tiers, per-region profiles, shader LOD distances, tile streaming priorities, GPU budget auto-scaling, and 12 CVars.',
  async execute() {
    return getRVTPerformanceSpec();
  },
}, { rateLimit: 10_000 });

registerTool({
  name: 'get_optimized_region_corruption',
  description: 'Get optimized corruption settings for a specific region at a given scalability level. Pass { regionId, scalabilityLevel }. Returns effective draw distance, noise octaves, tile updates, displacement/WPO/POM settings.',
  async execute(params) {
    return getOptimizedRegionSettings(params.regionId, params.scalabilityLevel || 'High');
  },
}, { rateLimit: 5_000 });

// ── NPC Dialogue Tools ──────────────────────────────────────────────────────

registerTool({
  name: 'deploy_dialogue_tables',
  description: 'Deploy NPC dialogue tree data tables. Creates 7 branching conversation trees (Elder, Blacksmith, Lira campfire, Innkeeper, Merchant, Healer, Bard) with conditions, actions, voice refs, and player choices. Saves JSON trees + UE5 enums (ESCSpeaker, ESCEmotion).',
  async execute() {
    return deployDialogueDataTables();
  },
}, { rateLimit: 300_000 });

registerTool({
  name: 'get_dialogue_spec',
  description: 'Get full dialogue tree specification — all NPC trees with node counts, branch points, conditions, actions, and the FSCDialogueNode struct definition for UE5.',
  async execute() {
    return getDialogueTreeSpec();
  },
}, { rateLimit: 10_000 });

registerTool({
  name: 'get_dialogue_tree',
  description: 'Get a specific dialogue tree by ID. Pass { treeId }. Available: elder_intro, blacksmith_first_visit, lira_campfire, innkeeper_chat, merchant_trade, healer_visit, bard_performance.',
  async execute(params) {
    return getDialogueTree(params?.treeId ?? 'elder_intro');
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'get_npc_dialogues',
  description: 'Get all dialogue trees for a specific NPC. Pass { npcId }. Returns all conversation contexts for that character.',
  async execute(params) {
    return getNPCDialogueTrees(params?.npcId ?? 'Elder');
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'wire_dialogue_blueprints',
  description: 'Wire dialogue DataTables to NPC blueprints (ms_6). Maps 8 NPC blueprints to their dialogue trees, voice profiles, portraits, and interaction settings. Creates wiring spec + lookup table. If UE5 editor is open, sets BP defaults directly.',
  async execute() {
    return wireDialogueToBlueprints();
  },
}, { rateLimit: 300_000 });

registerTool({
  name: 'get_dialogue_wiring',
  description: 'Get the NPC dialogue wiring specification — which NPC blueprints are mapped to which dialogue trees, voice profiles, portraits, and interaction radii.',
  async execute() {
    return getDialogueWiringSpec();
  },
}, { rateLimit: 10_000 });

// ── UE5 Asset Import Tools (ms_10) ────────────────────────────────────────────

registerTool({
  name: 'ue5_import_pipeline',
  description: 'Execute the full UE5 asset import pipeline: generate Python import scripts for all 339 FBX assets, build a test level with available MCP tools, and report import status. Generates importAllAssets.py runnable in UE5 Editor Python console. Returns { scriptPath, assetCount, testLevel, importReport }.',
  async execute() {
    return executeImportPipeline();
  },
}, { rateLimit: 300_000 }); // 5 min cooldown

registerTool({
  name: 'ue5_import_script',
  description: 'Generate a UE5 Python import script for FBX assets. Pass optional { regionId } to target one region, or omit for all regions. Script uses unreal.AssetImportTask for batch FBX import with proper settings (auto-collision, lightmap UVs, skeletal detection). Returns { scriptPath, assetCount }.',
  async execute(params) {
    return generateImportScript(params || {});
  },
}, { rateLimit: 30_000 });

registerTool({
  name: 'ue5_test_level',
  description: 'Build a test level in UE5 to validate asset import pipeline. Creates ground plane, landmark structures, places Blueprint actors from CrossroadsHub + AshenWilds, attempts FBX import via Python, and validates actor count. Requires UE5 editor open.',
  async execute() {
    return buildTestLevel();
  },
}, { rateLimit: 300_000 });

registerTool({
  name: 'ue5_import_report',
  description: 'Get comprehensive import status report: total assets, static vs skeletal meshes, per-region breakdown, import state, test level status.',
  async execute() {
    return getImportReport();
  },
}, { rateLimit: 5_000 });

// ── Combo Balance Tools (ms_7) ────────────────────────────────────────────────

registerTool({
  name: 'combo_balance_test',
  description: 'Run balance validation on all 30 shard combination damage multipliers. Returns pass/fail verdict, per-shard stats, domination warnings, burst simulation, and per-combo warnings. No UE5 editor required.',
  async execute() {
    return runBalanceValidation();
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'combo_balance_export',
  description: 'Export the full shard combo balance report as JSON to Assets/balance-report.json. Includes all 30 combo definitions with tuned damage multipliers, AoE, duration, corruption costs.',
  async execute() {
    return exportBalanceReport();
  },
}, { rateLimit: 10_000 });

registerTool({
  name: 'combo_data_table',
  description: 'Create a UE5 Data Table (DT_ComboBalance) with all 30 shard combo balance rows. Also creates E_ShardType enum and F_ComboBalanceRow struct. Requires UE5 editor open.',
  async execute() {
    return createComboDataTable();
  },
}, { rateLimit: 60_000 });

// ── Corruption Whisper Audio Tools (ms_3) ─────────────────────────────────────

registerTool({
  name: 'whisper_blueprint',
  description: 'Create BP_CorruptionWhisper audio component in UE5 with 18 variables (tier, cooldown, volume, pitch, fade) and 10 functions (event handling, audio selection, playback, cooldown). Requires UE5 editor open.',
  async execute() {
    return createWhisperBlueprint();
  },
}, { rateLimit: 60_000 });

registerTool({
  name: 'whisper_manifest_update',
  description: 'Add missing Tier 4 & 5 corruption whisper entries to audio-manifest.json. Tier 4: deceptive lies about game mechanics. Tier 5: controlling threats. Creates pending TTS generation tasks. No UE5 editor required.',
  async execute() {
    return addMissingWhisperEntries();
  },
}, { rateLimit: 10_000 });

registerTool({
  name: 'whisper_status',
  description: 'Get corruption whisper audio coverage report: files per tier, events covered, generation progress.',
  async execute() {
    return getWhisperStatus();
  },
}, { rateLimit: 5_000 });

// ── Willpower Tracking + Ending Synthesis Tools (ms_7) ───────────────────────

registerTool({
  name: 'willpower_blueprint',
  description: 'Create BP_WillpowerTracker in UE5 with 19 variables (resistance/compliance counts, weighted scores, pending outcome windows, corruption sampling, whisper stats) and 10 functions (RegisterResistance, RegisterCompliance, ReportOutcome, etc.). Requires UE5 editor open.',
  async execute() {
    return createWillpowerBlueprint();
  },
}, { rateLimit: 60_000 });

registerTool({
  name: 'ending_synthesis_blueprint',
  description: 'Create BP_EndingSynthesis in UE5 with 22 variables (willpower, corruption, boss resolutions, synthesis outputs) and 12 functions (SynthesizeEnding, DetermineFinalPath, AnalyzeTrajectory, AssembleComponents, PlayEndingCinematic, etc.). Requires UE5 editor open.',
  async execute() {
    return createEndingSynthesisBlueprint();
  },
}, { rateLimit: 60_000 });

registerTool({
  name: 'ending_data_tables',
  description: 'Create UE5 data tables for the ending system: E_FinalPath (5 paths), E_CorruptionTrajectory (6 types), E_FinalChoice (5 choices), F_EndingPathRow struct, DT_EndingPaths, DT_EndingComponents (22 narrative components). Requires UE5 editor open.',
  async execute() {
    return createEndingDataTables();
  },
}, { rateLimit: 60_000 });

registerTool({
  name: 'ending_permutation_test',
  description: 'Run permutation test across all possible ending combinations (willpower × corruption × choices). Validates all 5 paths are reachable, shows path distribution, and samples 25 ending variants. No UE5 editor required.',
  async execute() {
    return runPermutationTest();
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'willpower_spec_export',
  description: 'Export the full willpower + ending synthesis specification as JSON to Assets/willpower-ending-spec.json. Includes outcome contexts, ending paths, trajectories, components, and permutation test results.',
  async execute() {
    return exportWillpowerSpec();
  },
}, { rateLimit: 10_000 });

registerTool({
  name: 'willpower_status',
  description: 'Get willpower tracking and ending synthesis status: outcome contexts, compliance/resistance tags, ending paths, trajectories, permutation coverage.',
  async execute() {
    return getWillpowerStatus();
  },
}, { rateLimit: 5_000 });

// ── Ending Voice Lines Tools (DES ms_3) ──────────────────────────────────────

registerTool({
  name: 'ending_voice_manifest',
  description: 'Add all 30 ending voice line entries to audio-manifest.json as voice_ending category. Covers 5 opening montages, 4 crown judgments, 4 epilogues, 5 shard-bearer fates, 4 companion reactions, 5 realm outcomes, 3 post-credits hooks. 4 narrators with unique TTS settings. No UE5 editor required.',
  async execute() {
    return addEndingVoiceEntries();
  },
}, { rateLimit: 10_000 });

registerTool({
  name: 'ending_voice_status',
  description: 'Get ending voice line coverage: lines per category (opening/judgment/epilogue/bearer/companion/realm/hook), narrator counts, component-to-cue mappings, manifest generation progress.',
  async execute() {
    return getEndingVoiceStatus();
  },
}, { rateLimit: 5_000 });

// ── Lip-Sync Timing Tools (ms_8) ─────────────────────────────────────────────

registerTool({
  name: 'build_lip_sync',
  description: 'Generate lip-sync viseme timing data for all NPC voice lines. Creates per-NPC JSON files with ARKit 15-viseme keyframes, plus a UE5 Data Table CSV for import. Processes dialogue scripts, campfire conversations, and corruption whispers. No UE5 editor required.',
  async execute() {
    return buildAllLipSync();
  },
}, { rateLimit: 60_000 });

// ── Blueprint Integration Tools (ms_10) ──────────────────────────────────────

registerTool({
  name: 'integrate_blueprints',
  description: 'Execute the full Blueprint integration pipeline (ms_10): 1) Build all 60+ pending BPs, 2) Place BP actors in levels at designated positions, 3) Wire cross-system connections via event dispatchers, 4) Recompile. Requires UE5 editor open. Takes 15-30 minutes.',
  async execute() {
    return integrateAllBlueprints();
  },
}, { rateLimit: 600_000 }); // 10 min cooldown

registerTool({
  name: 'integration_status',
  description: 'Get detailed Blueprint integration status: per-region BP counts, connection graph progress, placement positions defined.',
  async execute() {
    return getIntegrationStatus();
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'export_integration_spec',
  description: 'Export the full Blueprint integration specification (placements + connection graph) as JSON for documentation or runtime use.',
  async execute() {
    return exportIntegrationSpec();
  },
}, { rateLimit: 10_000 });

// ── Chronicle Tools (Unwritten Chronicle) ─────────────────────────────────────

registerTool({
  name: 'chronicle_status',
  description: 'Get Unwritten Chronicle status: template count, categories, chapters, narrator tiers, distortion ops.',
  async execute() {
    return getChronicleStatus();
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'chronicle_build_entry',
  description: 'Build a chronicle entry from a template. Pass { templateId, eventData: {...}, corruptionLevel: 0-1, timestamp }. Returns narrator-voiced text with corruption distortion applied.',
  async execute(params) {
    if (!params?.templateId) return { success: false, error: 'templateId required' };
    if (!params?.eventData) return { success: false, error: 'eventData required' };
    const validation = validateEntryData(params.templateId, params.eventData);
    if (!validation.valid) return { success: false, ...validation };
    return buildChronicleEntry(params.templateId, params.eventData, params.corruptionLevel || 0, params.timestamp || 0);
  },
}, { rateLimit: 1_000 });

registerTool({
  name: 'chronicle_template_spec',
  description: 'Export the full chronicle template specification as JSON. Includes all templates, narrator tiers, chapters, and distortion operations. Writes to workspace/shattered-crown/Data/chronicle-templates.json.',
  async execute() {
    return exportChronicleTemplateSpec();
  },
}, { rateLimit: 10_000 });

// ── Chronicle Generation Tools (ms_2) ─────────────────────────────────────────

registerTool({
  name: 'chronicle_generate',
  description: 'Generate chronicle entries from a game state snapshot. Pass { corruptionLevel, gameTimestamp, pendingEvents: [{ type, data }], companionBonds }. Types: quest, corruption, bond, combat, rival, region, npc, dungeon.',
  async execute(params) {
    if (!params) return { success: false, error: 'gameState required' };
    return generateFromGameState(params);
  },
}, { rateLimit: 2_000 });

registerTool({
  name: 'chronicle_process_event',
  description: 'Process a single game event into a chronicle entry. Pass { type: "quest"|"corruption"|"bond"|"combat"|"rival"|"region"|"npc"|"dungeon", data: {...}, corruptionLevel, gameTimestamp }.',
  async execute(params) {
    if (!params?.type || !params?.data) return { success: false, error: 'type and data required' };
    const c = params.corruptionLevel || 0;
    const t = params.gameTimestamp || 0;
    switch (params.type) {
      case 'quest': return processQuestEvent(params.data, c, t) || { success: false, error: 'Failed to process quest event' };
      case 'corruption': return processCorruptionEvent(params.data, t) || { success: false, error: 'Failed to process corruption event' };
      case 'bond': return processBondEvent(params.data, c, t) || { success: false, error: 'Failed to process bond event' };
      case 'combat': return processCombatEvent(params.data, params.data.eventType || 'enemy_slain', c, t) || { success: false, error: 'Failed to process combat event' };
      case 'rival': return processRivalEvent(params.data, c, t) || { success: false, error: 'Failed to process rival event' };
      case 'region': return processRegionEvent(params.data, c, t) || { success: false, error: 'Failed to process region event' };
      case 'npc': return processNPCEvent(params.data, c, t) || { success: false, error: 'Failed to process NPC event' };
      case 'dungeon': return processDungeonEvent(params.data, c, t) || { success: false, error: 'Failed to process dungeon event' };
      default: return { success: false, error: `Unknown event type: ${params.type}` };
    }
  },
}, { rateLimit: 1_000 });

registerTool({
  name: 'chronicle_entries',
  description: 'Get chronicle entries with optional filtering. Pass { chapter, category, minImportance, narratorTier, limit }. Returns matching entries.',
  async execute(params) {
    return getChronicleEntries(params || {});
  },
}, { rateLimit: 3_000 });

registerTool({
  name: 'chronicle_by_chapter',
  description: 'Get the full chronicle organized by chapters, with entries sorted chronologically within each chapter.',
  async execute() {
    return getChronicleByChapter();
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'chronicle_export_text',
  description: 'Export the chronicle as a formatted in-world text document. Pass { minImportance: 1-5, includeMetadata: boolean }. Returns path to exported file.',
  async execute(params) {
    return exportChronicleText(params || {});
  },
}, { rateLimit: 10_000 });

registerTool({
  name: 'chronicle_narrator_mood',
  description: 'Get the narrator\'s current mood based on recent chronicle entries. Shows corruption influence, dominant voice, distortion rate.',
  async execute(params) {
    return getNarratorMood(params?.windowSize || 10);
  },
}, { rateLimit: 3_000 });

registerTool({
  name: 'chronicle_generator_status',
  description: 'Full status of the chronicle generation system: entry count, reliability, narrator mood, event processors, chapters used.',
  async execute() {
    return getChronicleGeneratorStatus();
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'chronicle_reset',
  description: 'Reset/clear the entire chronicle (for testing or new game start). WARNING: Deletes all entries.',
  async execute() {
    return resetChronicle();
  },
}, { rateLimit: 30_000 });

// ── ms_2: Chronicle Generation — Data Source Scanner Tools ────────────────────

registerTool({
  name: 'chronicle_scan',
  description: 'Full scan of all game data sources (corruption, bonds, quests, dungeons, rival, regions, NPCs). Detects changes from last scan and auto-generates chronicle entries. Pass a game state snapshot with: { corruptionLevel, corruptionHistory, companionBonds: { Lira, Theron }, completedQuests: [...], completedDungeons: [...], rivalScore, visitedRegions: [...], npcInteractions: [...], gameTimestamp }.',
  async execute(params) {
    return scanAndGenerate(params);
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'chronicle_read_corruption',
  description: 'Read corruption/willpower data and generate chronicle entries for changes. Pass { corruptionLevel, corruptionHistory, willpowerScore, gameTimestamp }.',
  async execute(params) {
    return { entries: readCorruptionSource(params), source: 'corruption' };
  },
}, { rateLimit: 3_000 });

registerTool({
  name: 'chronicle_read_bonds',
  description: 'Read companion bond data and generate entries for bond changes. Pass { companionBonds: { Lira: 0-5, Theron: 0-5 }, corruptionLevel, gameTimestamp }.',
  async execute(params) {
    return { entries: readBondSource(params), source: 'bonds' };
  },
}, { rateLimit: 3_000 });

registerTool({
  name: 'chronicle_read_quests',
  description: 'Read quest completion data and generate entries. Pass { completedQuests: [{ questId, questName, regionId, npcGiver, rewardType, rewardName, difficulty, corruptionCost }], corruptionLevel, gameTimestamp }.',
  async execute(params) {
    return { entries: readQuestSource(params), source: 'quests' };
  },
}, { rateLimit: 3_000 });

registerTool({
  name: 'chronicle_read_rival',
  description: 'Read rival (Veyra) encounter data. Detects relationship state changes. Pass { rivalScore, playerWillpower, corruptionLevel, gameTimestamp }.',
  async execute(params) {
    return { entries: readRivalSource(params), source: 'rival' };
  },
}, { rateLimit: 3_000 });

registerTool({
  name: 'chronicle_generator_state',
  description: 'Get the chronicle generator\'s internal state: last-known corruption, bonds, processed counts, scan history.',
  async execute() {
    return getGeneratorState();
  },
}, { rateLimit: 3_000 });

registerTool({
  name: 'chronicle_generator_reset',
  description: 'Reset the chronicle generator state (not the chronicle entries). Use when starting a new playthrough to re-process all events.',
  async execute() {
    return resetGeneratorState();
  },
}, { rateLimit: 30_000 });

// ── ms_3: Unreliable Narrator Tools ──────────────────────────────────────────

registerTool({
  name: 'chronicle_narrator_voice',
  description: 'Apply the full unreliable narrator voice pipeline to text. Pass { text, corruptionLevel: 0-1, includeInterjections: bool, includeContradictions: bool }. Returns corruption-mutated text with vocabulary shifts, structural distortion, interjections.',
  async execute(params) {
    return applyNarratorVoice(params.text || '', params.corruptionLevel || 0, {
      includeInterjections: params.includeInterjections ?? true,
      includeContradictions: params.includeContradictions ?? true,
      entry: params.entry || null,
    });
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'chronicle_enhanced_entry',
  description: 'Build an enhanced chronicle entry with full narrator voice processing. Pass { templateId, eventData: {...}, corruptionLevel: 0-1, timestamp }. Returns entry with vocabulary shifts, distortion, interjections, and contradictions applied.',
  async execute(params) {
    return buildEnhancedChronicleEntry(params.templateId, params.eventData || {}, params.corruptionLevel || 0, params.timestamp || 0);
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'chronicle_text_variants',
  description: 'Generate the same event at all 5 corruption tiers for comparison. Pass { templateId, eventData: {...}, timestamp }. Returns 5 text variants showing how corruption changes the narrative.',
  async execute(params) {
    return generateTextVariants(params.templateId, params.eventData || {}, params.timestamp || 0);
  },
}, { rateLimit: 10_000 });

registerTool({
  name: 'chronicle_retroactive_revision',
  description: 'Retroactively revise past chronicle entries based on a new corruption tier. Pass { tierKey: "T2"|"T3"|"T4", maxRevisions: number, dryRun: bool }. Higher corruption rewrites history.',
  async execute(params) {
    return retroactivelyReviseEntries(params.tierKey || 'T3', {
      maxRevisions: params.maxRevisions || 20,
      dryRun: params.dryRun || false,
    });
  },
}, { rateLimit: 30_000 });

registerTool({
  name: 'chronicle_tier_transition',
  description: 'Handle a corruption tier transition with retroactive revision. Pass { fromTier, toTier, corruptionLevel }. Rewrites past entries and generates transition announcement.',
  async execute(params) {
    return handleTierTransition(params.fromTier || 'T0', params.toTier || 'T1', params.corruptionLevel || 0);
  },
}, { rateLimit: 30_000 });

registerTool({
  name: 'chronicle_narrator_status',
  description: 'Get full status of the unreliable narrator system: vocabulary tiers, interjection pool, contradiction patterns, revision rules, mutation counts.',
  async execute() {
    return getUnreliableNarratorStatus();
  },
}, { rateLimit: 5_000 });

// ── Chronicle UI Tools (ms_4) ─────────────────────────────────────────────────

registerTool({
  name: 'chronicle_ui_chapters',
  description: 'Get the chronicle chapter list view — all chapters with entry counts, previews, reliability. The main menu of the chronicle UI.',
  async execute() {
    return getChronicleChapterList();
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'chronicle_ui_navigate',
  description: 'Navigate to a chronicle chapter. Pass { chapter: "journey"|"encounters"|"quests"|..., page: 0 }. Returns paginated entries with corruption theming.',
  async execute(params) {
    return navigateToChapter(params.chapter, params.page || 0);
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'chronicle_ui_entry',
  description: 'Get detailed view of a chronicle entry. Pass { entryId }. Returns full text, narrator analysis, corruption indicators, prev/next navigation.',
  async execute(params) {
    return getEntryDetail(params.entryId);
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'chronicle_ui_search',
  description: 'Search chronicle entries. Pass { query: "text", filters: { chapter, category, minImportance, narratorTier } }. Returns up to 30 matching entries.',
  async execute(params) {
    return searchChronicle(params.query, params.filters || {});
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'chronicle_ui_bookmark',
  description: 'Toggle bookmark on a chronicle entry. Pass { entryId }. Returns bookmark state.',
  async execute(params) {
    return toggleBookmark(params.entryId);
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'chronicle_ui_bookmarks',
  description: 'Get all bookmarked chronicle entries.',
  async execute() {
    return getBookmarkedEntries();
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'chronicle_ui_filters',
  description: 'Set chronicle UI sort/filter options. Pass { sortOrder: "chronological"|"reverse"|"importance", narratorFilterTier: "T0"-"T4"|null, showDistortedOnly: bool }.',
  async execute(params) {
    return setChronicleUIFilters(params);
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'chronicle_ui_deploy',
  description: 'Deploy chronicle UI to UE5 — creates 5 Widget Blueprints (WBP_ChronicleMain/Chapter/Entry/Search/Bookmarks) and 3 DataTables (Chapters/Themes/Glyphs). Exports UI spec JSON.',
  async execute() {
    return deployChronicleUI();
  },
}, { rateLimit: 60_000 });

registerTool({
  name: 'chronicle_ui_status',
  description: 'Get chronicle UI system status: features, corruption theme preview, widget list, state summary.',
  async execute() {
    return getChronicleUIStatus();
  },
}, { rateLimit: 5_000 });

// ── Rival Counter-Chronicle Tools (ms_5) ──────────────────────────────────────

registerTool({
  name: 'chronicle_counter_entry',
  description: 'Build a counter-chronicle entry from Veyra\'s perspective. Pass { templateId, eventData: {...}, relationshipScore: -100 to 100, veyraCorruption: 0-1, timestamp }. Templates: counter_combat_victory, counter_combat_defeat, counter_quest_completed, counter_shard_collected, counter_corruption_shift, counter_region_entered, counter_companion_bond, counter_npc_interaction, counter_death, counter_boss_victory, counter_dungeon_cleared, counter_ending_approached.',
  async execute(params) {
    return buildCounterChronicleEntry(params.templateId, params.eventData || {}, params.relationshipScore || 0, params.veyraCorruption || 0.5, params.timestamp || 0);
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'chronicle_counter_generate',
  description: 'Auto-generate Veyra counter-entries for all existing Kael chronicle entries that lack a counterpart. Pass { relationshipScore: -100 to 100, veyraCorruption: 0-1 }.',
  async execute(params) {
    return generateCounterEntries(params.relationshipScore || 0, params.veyraCorruption || 0.5);
  },
}, { rateLimit: 30_000 });

registerTool({
  name: 'chronicle_comparison',
  description: 'Side-by-side comparison of Kael\'s chronicle and Veyra\'s counter-chronicle. Pass { chapter, fromTimestamp, toTimestamp, limit }. Shows paired entries with contradiction detection.',
  async execute(params) {
    return getChronicleComparison(params || {});
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'chronicle_counter_status',
  description: 'Get rival counter-chronicle status: entry counts, voice distribution, template list, chapter info.',
  async execute() {
    return getCounterChronicleStatus();
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'chronicle_counter_export',
  description: 'Export counter-chronicle spec as JSON for UE5. Includes all templates, voice profiles, mirror mappings.',
  async execute() {
    return exportCounterChronicleSpec();
  },
}, { rateLimit: 30_000 });

// ── ms_6: Chronicle Text File Export Tools ──────────────────────────────────

registerTool({
  name: 'chronicle_export_enhanced',
  description: 'Export chronicle as enhanced text file with table of contents, word count, and narrator attribution. Pass { minImportance: 1-5, includeMetadata: bool, chapter: "chapterKey", outputPath: "custom/path.txt" }.',
  async execute(params) {
    return exportEnhancedText(params || {});
  },
}, { rateLimit: 10_000 });

registerTool({
  name: 'chronicle_export_markdown',
  description: 'Export chronicle as Markdown file with headers, blockquotes, tables. Pass { minImportance: 1-5, includeMetadata: bool, chapter: "chapterKey", outputPath: "custom/path.md" }.',
  async execute(params) {
    return exportChronicleMarkdown(params || {});
  },
}, { rateLimit: 10_000 });

registerTool({
  name: 'chronicle_export_counter_text',
  description: 'Export Veyra\'s counter-chronicle as formatted text — the rival\'s version of events. Pass { includeMetadata: bool, outputPath: "custom/path.txt" }.',
  async execute(params) {
    return exportCounterChronicleText(params || {});
  },
}, { rateLimit: 10_000 });

registerTool({
  name: 'chronicle_export_dual',
  description: 'Export both Kael and Veyra chronicles side-by-side with contradiction highlighting. Pass { includeMetadata: bool, outputPath: "custom/path.txt" }.',
  async execute(params) {
    return exportDualChronicle(params || {});
  },
}, { rateLimit: 10_000 });

registerTool({
  name: 'chronicle_export_chapter',
  description: 'Export a single chapter as standalone document. Pass { chapter: "journey"|"encounters"|..., format: "text"|"markdown", includeMetadata: bool }.',
  async execute(params) {
    if (!params?.chapter) return { error: 'chapter is required' };
    return exportChapter(params.chapter, params);
  },
}, { rateLimit: 10_000 });

registerTool({
  name: 'chronicle_export_all',
  description: 'Batch export: all formats at once (text, markdown, counter-chronicle, dual). Pass { minImportance: 1-5, includeMetadata: bool }.',
  async execute(params) {
    return exportAllChronicle(params || {});
  },
}, { rateLimit: 30_000 });

registerTool({
  name: 'chronicle_export_status',
  description: 'Get export system status: available formats, recent exports, manifest summary, available chapters.',
  async execute() {
    return getChronicleExportStatus();
  },
}, { rateLimit: 3_000 });

// ── ms_7: NG+ Previous-Age Chronicle Tools ──────────────────────────────────

registerTool({
  name: 'chronicle_archive_age',
  description: 'Archive the current chronicle as a previous age (for NG+). Snapshots all entries and metadata. Call before chronicle_begin_new_age.',
  async execute() {
    return archiveCurrentAge();
  },
}, { rateLimit: 30_000 });

registerTool({
  name: 'chronicle_begin_new_age',
  description: 'Begin a new chronicle age (NG+). Resets current chronicle and prepends previous-age summaries as prologue entries. Must archive first.',
  async execute() {
    return beginNewAge();
  },
}, { rateLimit: 30_000 });

registerTool({
  name: 'chronicle_previous_ages',
  description: 'Get condensed summary of all previous ages: names, entry counts, reliability, epilogues.',
  async execute() {
    return getPreviousAgeSummary();
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'chronicle_previous_age_entries',
  description: 'Read entries from a specific previous age. Pass { ageNumber: 0, chapter, category, minImportance, limit }.',
  async execute(params) {
    return getPreviousAgeEntries(params?.ageNumber ?? 0, params || {});
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'chronicle_cross_age_reference',
  description: 'Narrator comments on a previous-age event. Pass { ageNumber: 0, eventSummary: "...", corruptionLevel: 0-1 }. Returns corruption-influenced narrator callback.',
  async execute(params) {
    return crossAgeNarratorCallback(params?.ageNumber ?? 0, params?.eventSummary || '', params?.corruptionLevel ?? 0);
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'chronicle_age_info',
  description: 'Get current age info: age number, name, entry count, archived ages count, total archived entries.',
  async execute() {
    return getCurrentAgeInfo();
  },
}, { rateLimit: 3_000 });

// ── AAA: Game Framework Tools ─────────────────────────────────────────────────

registerTool({
  name: 'setup_game_framework',
  description: 'Create the complete game framework blueprints: GameInstance, PlayerState, GameState. Pass { folder, game_instance_name, player_state_name, game_state_name }. Essential for any AAA game.',
  async execute(params) {
    const folder = params.folder || '/Game/Core';
    const [gi, ps, gs] = await Promise.all([
      callTool('unreal', 'create_game_instance', { name: params.game_instance_name || 'BP_GameInstance', folder }, 30_000),
      callTool('unreal', 'create_player_state',  { name: params.player_state_name  || 'BP_PlayerState',  folder }, 30_000),
      callTool('unreal', 'create_game_state',    { name: params.game_state_name    || 'BP_GameState',    folder }, 30_000),
    ]);
    return { success: true, game_instance: gi, player_state: ps, game_state: gs };
  },
}, { rateLimit: 60000 });

// ── AAA: Animation Tools ──────────────────────────────────────────────────────

registerTool({
  name: 'create_anim_blueprint',
  description: 'Create an Animation Blueprint for a skeleton. Pass { name, folder, skeleton_path }. Use get_skeleton_list first to find skeleton paths.',
  async execute(params) {
    return callTool('unreal', 'create_anim_blueprint', {
      name: params.name || 'ABP_NewAnim',
      folder: params.folder || '/Game/Animations',
      skeleton_path: params.skeleton_path || '',
    }, 30_000);
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'get_skeleton_list',
  description: 'List all USkeleton assets in the UE5 project. Use path values as skeleton_path for create_anim_blueprint.',
  async execute() {
    return callTool('unreal', 'get_skeleton_list', {}, 15_000);
  },
}, { rateLimit: 5000 });

// ── Motion Matching & PoseSearch ──────────────────────────────────────────────

registerTool({
  name: 'setup_pose_search',
  description: 'Set up PoseSearchSchema + PoseSearchDatabase for a character\'s locomotion Motion Matching. Pass { characterId, skeletonPath?, animDir? }. Creates assets under /Game/Animation/MotionMatching/<characterId>/.',
  async execute(params) {
    return setupPoseSearchDatabase({
      characterId: params?.characterId || 'Kael',
      skeletonPath: params?.skeletonPath,
      animDir: params?.animDir,
    });
  },
}, { rateLimit: 60_000 });

registerTool({
  name: 'setup_mm_locomotion',
  description: 'Wire Motion Matching locomotion layer into a character AnimBP. Adds MotionMatching node, trajectory variables, layer blend weights. Requires PoseSearchDatabase (run setup_pose_search_db first). Pass { characterId, blendTime? }.',
  async execute(params) {
    return setupMotionMatchingLocomotion({
      characterId: params?.characterId,
      blendTime: params?.blendTime,
    });
  },
}, { rateLimit: 60_000 });

registerTool({
  name: 'setup_foot_ik',
  description: 'Add foot IK variables to a character AnimBP for terrain-adaptive foot placement. Pass { characterId, skeletonPath? }.',
  async execute(params) {
    return setupFootIK({
      characterId: params?.characterId || 'Kael',
      skeletonPath: params?.skeletonPath,
    });
  },
}, { rateLimit: 30_000 });

registerTool({
  name: 'setup_corruption_distortion',
  description: 'Create a Control Rig for corruption body distortion (tremor, gait shift). Pass { characterId, skeletonPath? }.',
  async execute(params) {
    return setupCorruptionDistortion({
      characterId: params?.characterId || 'Kael',
      skeletonPath: params?.skeletonPath,
    });
  },
}, { rateLimit: 60_000 });

registerTool({
  name: 'setup_motion_matching',
  description: 'Full Motion Matching pipeline: PoseSearch database + foot IK + corruption distortion. Pass { characterId, skeletonPath?, animDir?, includeFootIK?, includeCorruption? }.',
  async execute(params) {
    return setupFullMotionMatchingPipeline({
      characterId: params?.characterId || 'Kael',
      skeletonPath: params?.skeletonPath,
      animDir: params?.animDir,
      includeFootIK: params?.includeFootIK ?? true,
      includeCorruption: params?.includeCorruption ?? true,
    });
  },
}, { rateLimit: 120_000 });

registerTool({
  name: 'setup_boss_montages',
  description: 'Register curated boss attack montages with frame-precise telegraph/hitbox/recovery windows. NOT Motion Matched — stays as traditional montages. Pass { characterId?, bossId }. Bosses: GeneralVoss, WardenSyltha, ScholarDren, ForgeKeeperAshka, Mordaen, HollowKing.',
  async execute(params) {
    return setupBossMontages({
      characterId: params?.characterId || 'Kael',
      bossId: params?.bossId,
    });
  },
}, { rateLimit: 60_000 });

registerTool({
  name: 'get_boss_montage_data',
  description: 'Get boss attack montage timing data (telegraph, hitbox, recovery frames) for gameplay AI. Pure data — no UE5 call. Pass { bossId }.',
  execute(params) {
    return getBossMontageData({ bossId: params?.bossId });
  },
}, { rateLimit: 5_000 });

// ── Motion Matching Performance Testing ───────────────────────────────────────

registerTool({
  name: 'mm_performance_test',
  description: 'Profile Motion Matching performance: PoseDB memory, query cost, foot IK traces, Control Rig ticks, total anim budget. Tests against 5 platform budgets (PC High/Med/Low, Console Current/Last). Pass { characterId?, numCharacters?, profileFrames? }.',
  async execute(params) {
    return profileMotionMatching({
      characterId: params?.characterId || 'Kael',
      numCharacters: params?.numCharacters || 4,
      profileFrames: params?.profileFrames || 300,
    });
  },
}, { rateLimit: 30_000 });

registerTool({
  name: 'mm_deploy_scalability',
  description: 'Deploy a Motion Matching scalability preset to UE5 via console variables. Presets: Low (MM@15Hz, no foot IK, no CR), Medium (MM@30Hz, 2 traces, CR LOD1), High (MM@60Hz, 4 traces, full CR), Epic (MM@60Hz, 6 traces, full CR). Pass { preset }.',
  async execute(params) {
    return deployScalabilityPreset({ preset: params?.preset || 'High' });
  },
}, { rateLimit: 10_000 });

registerTool({
  name: 'mm_scalability_config',
  description: 'Get Motion Matching scalability config for a preset (or all presets). Pure data — no UE5 call. Pass { preset? } or omit for all presets + platform budgets.',
  execute(params) {
    return getScalabilityConfig({ preset: params?.preset });
  },
}, { rateLimit: 5_000 });

registerTool({
  name: 'mm_platform_budgets',
  description: 'Get animation performance budgets for target platforms. Shows per-frame time budgets for MM query, foot IK, Control Rig, max characters. Pass { platform? } or omit for all.',
  execute(params) {
    return getPlatformBudgets({ platform: params?.platform });
  },
}, { rateLimit: 5_000 });

// ── C++ generation ───────────────────────────────────────────────────────────

registerTool({
  name: 'generate_cpp',
  description: 'Generate a UE5 C++ class for The Shattered Crown via Claude, write it to ShatteredCrown/Source/ShatteredCrown/, then compile with UBT. systemType options: character | game_mode | player_controller | logic_interpreter | gameplay_ability. Pass { systemType, config: {} }. UBT compile takes up to 3 minutes.',
  async execute(params) {
    if (!params?.systemType) return { success: false, error: 'systemType required' };
    const { generateCppFile, compileProject } = await import('./cpp-generator.js');
    const r = await generateCppFile(params.systemType, params.config || {});
    if (!r.success) return r;
    if (r.skipped) return { success: true, skipped: true, filename: r.filename };
    return compileProject();
  },
}, { rateLimit: 300_000 }); // 5 min — UBT compile

registerTool({
  name: 'generate_ruleset',
  description: 'Generate a JSON gameplay ruleset for an entity in The Shattered Crown via Claude. Rulesets define behavior rules (trigger → conditions → actions) read at runtime by ULogicInterpreter. Pass { entityId: "entity_id", description: "what this entity does" }. Saves to Content/Data/Rulesets/{entityId}.json.',
  async execute(params) {
    if (!params?.entityId)     return { success: false, error: 'entityId required' };
    if (!params?.description)  return { success: false, error: 'description required' };
    const { generateRuleset } = await import('./ruleset-generator.js');
    return generateRuleset(params.entityId, params.description);
  },
}, { rateLimit: 60_000 });

registerTool({
  name: 'execute_python_script',
  description: 'Execute arbitrary Python in the UE5 Editor via IPythonScriptPlugin. Import the "unreal" module for full typed UE5 Python API access. Returns { success, output, error }. Example: { script: "import unreal; print(unreal.get_editor_subsystem(unreal.LevelEditorSubsystem))" }. Requires UE5 Editor open and Python plugin enabled.',
  async execute(params) {
    if (!params?.script) return { success: false, error: 'script required' };
    return callTool('unreal', 'execute_python_script', { script: params.script }, 30_000);
  },
}, { rateLimit: 5000 });

// ── Rival Crown-Seeker tools ─────────────────────────────────────────────────

registerTool({
  name: 'rival_spec_export',
  description: 'Export the rival character (Veyra Ashcroft) design spec to JSON. Creates Characters/rival-veyra-spec.json in the active game\'s Assets folder. Includes profile, motivation arc, relationship system, combat stats, encounter schedule, and final outcomes.',
  async execute() {
    return exportRivalSpec();
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'rival_state',
  description: 'Get the rival\'s current state summary given player stats. Pass { playerWillpower: 0.0-1.0, playerShardUsage: { Fire: 50, Shield: 10, ... } }. Returns corruption level, shard specialization, combat health, and current act.',
  async execute(params) {
    return getRivalStateSummary(params?.playerWillpower, params?.playerShardUsage);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'deploy_rival_ai',
  description: 'Deploy Veyra\'s complete AI system to UE5: Blackboard (BB_Veyra, 27 keys), Behavior Tree (BT_Veyra), AI Controller (BP_AIController_Veyra with 11 vars + 10 functions). Requires UE5 editor running. Idempotent.',
  async execute() {
    return deployRivalAI();
  },
}, { rateLimit: 60000 });

registerTool({
  name: 'rival_ai_spec',
  description: 'Export the rival AI controller spec to JSON. Includes full behavior tree structure, blackboard keys, perception config, combat styles by relationship, and encounter types. Saved to Assets/AI/rival-veyra-ai-spec.json.',
  async execute() {
    return exportRivalAISpec();
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'rival_behavior_tree',
  description: 'Get Veyra\'s complete behavior tree as JSON. Shows the full tree: dialogue > combat (5 relationship styles + Crown Resonance + Shard Counter) > idle (corruption meditation) > encounter branches (glimpse/coop/confrontation).',
  async execute() {
    return buildVeyraBehaviorTree();
  },
}, { rateLimit: 5000 });

// ms_3: Dynamic shard loadout tools

registerTool({
  name: 'rival_loadout',
  description: 'Build Veyra\'s dynamic shard loadout based on player blind spots. Pass { playerShardUsage: { Fire: 50, Shield: 10, ... }, corruptionTier: 3, region: "AshenWilds", relationshipState: "neutral" }. Returns full loadout with primary/secondary shards, combo preferences, ability weights, and blind spot analysis.',
  async execute(params) {
    const profile = createPlayerShardProfile();
    const usage = params?.playerShardUsage || {};
    for (const [shard, count] of Object.entries(usage)) {
      profile.shardUsage[shard] = count;
      profile.totalActions += count;
    }
    return buildDynamicLoadout(profile, {
      corruptionTier: params?.corruptionTier,
      region: params?.region,
      relationshipState: params?.relationshipState,
    });
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'rival_loadout_export',
  description: 'Export Veyra\'s dynamic shard loadout to JSON for UE5 Data Table import. Creates Assets/AI/rival-veyra-loadout.json. Pass { playerShardUsage: { Fire: 50, Shield: 10, ... }, corruptionTier: 3 }.',
  async execute(params) {
    const profile = createPlayerShardProfile();
    const usage = params?.playerShardUsage || {};
    for (const [shard, count] of Object.entries(usage)) {
      profile.shardUsage[shard] = count;
      profile.totalActions += count;
    }
    return exportRivalLoadout(profile, {
      corruptionTier: params?.corruptionTier,
      region: params?.region,
      relationshipState: params?.relationshipState,
    });
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'rival_blind_spots',
  description: 'Analyze player shard usage to find exploitable blind spots. Pass { playerShardUsage: { Fire: 50, Shield: 10, ... }, region: "AshenWilds" }. Returns blind spot scores, combo gaps, play style classification, and versatility score.',
  async execute(params) {
    const profile = createPlayerShardProfile();
    const usage = params?.playerShardUsage || {};
    for (const [shard, count] of Object.entries(usage)) {
      profile.shardUsage[shard] = count;
      profile.totalActions += count;
    }
    return analyzeBlindSpots(profile, params?.region);
  },
}, { rateLimit: 5000 });

// ms_4: Encounter scripting tools

registerTool({
  name: 'rival_encounter',
  description: 'Get the encounter script available for a given region. Pass { region: "AshenWilds", gameState: { playerLevel: 10, flags: ["veyra_first_glimpse_seen"], questProgress: ["reached_ashen_shard_chamber"] } }. Returns full encounter script with phases, dialogue, combat config, and choices.',
  async execute(params) {
    const flags = new Set(params?.gameState?.flags || []);
    const state = { ...params?.gameState, flags, questProgress: params?.gameState?.questProgress || [] };
    const enc = getAvailableEncounter(params?.region, state);
    if (!enc) return { available: false, region: params?.region, reason: 'No encounter available — prerequisites not met or already completed' };
    return { available: true, encounter: enc, timeline: getEncounterTimeline(enc.id) };
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'rival_encounter_timeline',
  description: 'Get the linearized timeline for a specific encounter. Pass { encounterId: "ashen_confrontation" }. Returns phase sequence with start times, durations, action counts.',
  async execute(params) {
    return getEncounterTimeline(params?.encounterId);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'rival_encounter_list',
  description: 'List all rival encounter scripts in chronological order. Returns summaries with region, act, type, choice count, and prerequisite flags.',
  async execute() {
    return getAllEncounterSummaries();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'rival_encounter_export',
  description: 'Export all encounter scripts to JSON for UE5 Level Sequence import. Creates individual encounter files + master index in Assets/Encounters/.',
  async execute() {
    return exportEncounterScripts();
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'rival_final_outcome',
  description: 'Determine the final confrontation outcome based on game state. Pass { relationshipScore: 50, veyraCorruption: 0.6, flags: ["caelen_discovered"] }. Returns the selected ending from the 6 possible outcomes.',
  async execute(params) {
    const flags = new Set(params?.flags || []);
    return determineFinalOutcome({ ...params, flags });
  },
}, { rateLimit: 5000 });

// ms_5: 3-way boss fight tools

registerTool({
  name: 'rival_boss_fight_init',
  description: 'Initialize a 3-way boss fight state. Pass { fightId: "ironhold_corruption_beast"|"ember_warden"|"wilds_crown_fight", gameState: { playerLevel: 25, willpower: 0.6, corruptionLevel: 0.4, relationshipScore: 50, flags: [...], playerShardUsage: {...} } }. Returns complete fight state with boss phases, Veyra config, threat table, and faction matrix.',
  async execute(params) {
    const state = { ...params?.gameState };
    if (state.flags) state.flags = new Set(state.flags);
    return initBossFight(params?.fightId, state);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'rival_allegiance_shift',
  description: 'Process an allegiance shift during a boss fight. Pass { fightState: <from init>, triggerId: "player_saves_veyra"|"corruption_overwhelm"|etc, fightTime: 45 }. Returns updated fight state with shift details.',
  async execute(params) {
    return processAllegianceShift(params?.fightState, params?.triggerId, params?.fightTime);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'rival_boss_fight_list',
  description: 'List all 3-way boss fight definitions. Returns summaries with boss name, phases, archetype, and arena hazard count.',
  async execute() {
    return getAllBossFightSummaries();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'rival_boss_fight_export',
  description: 'Export all 3-way boss fight specs to JSON for UE5 blueprint consumption. Creates Assets/Combat/three-way-boss-fights.json.',
  async execute() {
    return exportBossFightSpecs();
  },
}, { rateLimit: 10000 });

// ms_6: Resolution paths
registerTool({
  name: 'rival_resolution_build',
  description: 'Build the complete final act resolution sequence. Pass { relationshipScore: 60, veyraCorruption: 0.5, willpower: 0.7, flags: ["caelen_discovered"], playerShardUsage: {...} }. Returns outcome, path type (fight/absorb/merge), phases, cinematics, and choices.',
  async execute(params) {
    return buildResolutionSequence(params || {});
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'rival_resolution_paths',
  description: 'List all 3 resolution path summaries (fight, absorb, merge) with phases and mechanics.',
  async execute() {
    return getResolutionPathSummaries();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'rival_resolution_export',
  description: 'Export all 3 resolution path specs to JSON for UE5. Creates Assets/Narrative/resolution-paths.json.',
  async execute() {
    return exportResolutionPaths();
  },
}, { rateLimit: 10000 });

// ms_7: Companion reactions
registerTool({
  name: 'rival_companion_reactions',
  description: 'Get companion reactions for a rival encounter. Pass { encounterId: "ironhold_truce", trigger: "encounter_combat", conditions: { theronPresent: true } }. Returns matching Lira/Theron dialogue lines and effects.',
  async execute(params) {
    return getCompanionReactions(params?.encounterId, params?.trigger, params?.conditions || {});
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'rival_companion_summary',
  description: 'Get summary of all companion reactions across all rival encounters. Shows counts by companion and trigger type.',
  async execute() {
    return getCompanionReactionSummary();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'rival_companion_export',
  description: 'Export all companion rival-encounter reactions to JSON for UE5 dialogue system. Creates Assets/Dialogue/companion-rival-reactions.json.',
  async execute() {
    return exportCompanionReactions();
  },
}, { rateLimit: 10000 });

// ── Shard Echo Dungeons ──────────────────────────────────────────────────────

registerTool({
  name: 'echo_dungeon_list',
  description: 'List all 6 Shard Echo dungeon summaries — name, shard requirements, region, room count, difficulty, reward.',
  async execute() {
    return getDungeonSummaries();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'echo_dungeon_layout',
  description: 'Get full layout for a specific dungeon. Pass { dungeonId: "temporal_sanctum"|"abyssal_cistern"|"ember_forge"|"verdant_labyrinth"|"umbral_nexus"|"primal_crucible" }.',
  async execute(params) {
    return getDungeonLayout(params?.dungeonId);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'echo_dungeon_check',
  description: 'Check if player can enter a dungeon. Pass { dungeonId: "umbral_nexus", playerShards: ["Shadow", "Time"] }. Returns canEnter + missing shards.',
  async execute(params) {
    return canEnterDungeon(params?.dungeonId, params?.playerShards || []);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'echo_dungeon_export',
  description: 'Export all 6 dungeon specs to JSON for UE5 level design. Creates Assets/Dungeons/shard-echo-dungeons.json.',
  async execute() {
    return exportDungeonSpecs();
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'shard_echoes_list',
  description: 'List all 6 Shard Echo passive abilities — rewards from echo dungeons. Shows name, shard type, description, rarity.',
  async execute() {
    return getShardEchoes();
  },
}, { rateLimit: 5000 });

// ── ms_2: Puzzle Actor Framework tools ──────────────────────────────────────

registerTool({
  name: 'puzzle_actor_types',
  description: 'List all puzzle actor types — switches (lever, pressure plate, crystal, rune panel), platforms (moving, rotating, appearing, vine bridge), flow (pipe, valve, reservoir, brazier), gates (door, barrier), temporal (echo recorder). Shows interaction model, events, states.',
  async execute() {
    return getPuzzleActorTypes();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'puzzle_actor_detail',
  description: 'Get full details for a specific puzzle actor type. Pass { actorTypeId: "lever"|"pressure_plate"|"crystal_resonator"|"rune_panel"|"moving_platform"|"rotating_platform"|"appearing_platform"|"vine_bridge"|"pipe_segment"|"valve"|"reservoir"|"brazier"|"puzzle_door"|"shard_barrier"|"echo_recorder" }.',
  async execute(params) {
    return getPuzzleActorType(params?.actorTypeId);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'puzzle_templates',
  description: 'List pre-built puzzle assembly templates — dual_switch_door, pipe_routing, crystal_chain, brazier_chain, temporal_echo_puzzle, growth_bridge. Shows actor count, wire count, shard requirements, difficulty.',
  async execute() {
    return getPuzzleTemplates();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'puzzle_template_detail',
  description: 'Get full actor + wire layout for a puzzle template. Pass { templateId: "dual_switch_door"|"pipe_routing"|"crystal_chain"|"brazier_chain"|"temporal_echo_puzzle"|"growth_bridge" }.',
  async execute(params) {
    return getPuzzleTemplate(params?.templateId);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'puzzle_state_machine',
  description: 'Get the actor state machine — all states (idle, activated, held, locked, cooldown, broken, rewinding, frozen), transitions, wire types, logic gates.',
  async execute() {
    return getActorStateMachine();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'puzzle_flow_network',
  description: 'Get flow network system info — flow types (water, lava, energy, shadow, nature), pipe shapes, connector directions, flow-related actors.',
  async execute() {
    return getFlowNetworkInfo();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'puzzle_validate_flow',
  description: 'Validate a flow network. Pass { pipes: [{id, shape, rotation, position: {x,y}}], sourceId: "src", destId: "dst" }. Returns valid/invalid + path + disconnected pipes.',
  async execute(params) {
    return validateFlowNetwork(params?.pipes || [], params?.sourceId, params?.destId);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'puzzle_actor_export',
  description: 'Export puzzle actor framework to JSON for UE5 blueprint generation. Creates Assets/Dungeons/puzzle-actor-framework.json with all actor types, states, wires, templates.',
  async execute() {
    return exportPuzzleActorSpecs();
  },
}, { rateLimit: 10000 });

// ── ms_3: Shard Puzzle Interaction tools ────────────────────────────────────

registerTool({
  name: 'shard_puzzle_summary',
  description: 'Get overview of all shard puzzle abilities — 6 shards × 3 abilities each = 18 non-combat puzzle interactions. Shows energy costs, input types, affected actor counts.',
  async execute() {
    return getShardPuzzleSummary();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'shard_puzzle_abilities',
  description: 'Get full puzzle abilities for a shard type. Pass { shardType: "Time"|"Water"|"Fire"|"Nature"|"Shadow"|"Shield" }. Shows controls, energy, interactions with each actor type, VFX/SFX references.',
  async execute(params) {
    return getShardPuzzleAbilities(params?.shardType);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'puzzle_actor_interactions',
  description: 'Get all shard abilities that can affect a specific actor type. Pass { actorTypeId: "lever"|"reservoir"|"brazier"|etc }. Shows which shards interact and how.',
  async execute(params) {
    return getActorInteractions(params?.actorTypeId);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'puzzle_interaction_matrix',
  description: 'Get the full interaction matrix — for every actor type, all shard abilities that affect it. Cross-reference of actors × shards.',
  async execute() {
    return buildInteractionMatrix();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'shard_puzzle_export',
  description: 'Export shard puzzle interaction specs to JSON for UE5. Creates Assets/Dungeons/shard-puzzle-interactions.json with all abilities, controls, energy costs, and interaction matrix.',
  async execute() {
    return exportShardPuzzleSpecs();
  },
}, { rateLimit: 10000 });

// ── ms_4: Echo Reward System tools ──────────────────────────────────────────

registerTool({
  name: 'echo_reward_config',
  description: 'Get full echo reward system config — equip slots, ranks, fragment sources, rank enhancements, synergies, acquisition states.',
  async execute() {
    return getEchoRewardConfig();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'echo_synergies',
  description: 'List all echo synergies — hidden bonus effects from equipping specific echo combinations. 5 synergies total.',
  async execute() {
    return getEchoSynergies();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'echo_simulate_progression',
  description: 'Simulate a player echo progression scenario. Pass { completions: [{dungeonId, difficulty, hintsUsed, underParTime}], upgrades: [echoId], equip: [echoId] }. Returns final state with synergies.',
  async execute(params) {
    const state = createPlayerEchoState('simulation');
    const results = { completions: [], upgrades: [], equips: [], finalState: null };

    for (const c of (params?.completions || [])) {
      const r = awardDungeonCompletion(state, c.dungeonId, c);
      results.completions.push(r);
    }
    for (const echoId of (params?.upgrades || [])) {
      const r = upgradeEcho(state, echoId);
      results.upgrades.push(r);
    }
    for (const echoId of (params?.equip || [])) {
      const r = equipEcho(state, echoId);
      results.equips.push(r);
    }

    results.finalState = getEchoProgressionSummary(state);
    return results;
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'echo_reward_export',
  description: 'Export echo reward system to JSON for UE5. Creates Assets/Dungeons/echo-reward-system.json with slots, ranks, fragments, synergies.',
  async execute() {
    return exportEchoRewardSpecs();
  },
}, { rateLimit: 10000 });

// ── ms_5: Companion Puzzle Interaction tools ────────────────────────────────

registerTool({
  name: 'companion_puzzle_summary',
  description: 'Get full companion puzzle system overview — bond levels, companion abilities, dual puzzles, secret rooms. Shows all bond-gated puzzle interactions.',
  async execute() {
    return getCompanionPuzzleSummary();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'companion_puzzle_check',
  description: 'Check if a companion ability is available at a given bond level. Pass { companion: "Lira"|"Theron", ability: "ability_id", bond: 0-5 }.',
  async execute(params) {
    return checkCompanionAbility(params?.companion, params?.ability, params?.bond || 0);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'companion_puzzle_available',
  description: 'List all companion abilities and their unlock status for given bond levels. Pass { liraBond: 0-5, theronBond: 0-5 }.',
  async execute(params) {
    return getAvailableCompanionAbilities({ Lira: params?.liraBond || 0, Theron: params?.theronBond || 0 });
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'companion_dual_puzzle_check',
  description: 'Check if a dual-companion puzzle is accessible. Pass { puzzle: "puzzle_id", liraBond: 0-5, theronBond: 0-5 }.',
  async execute(params) {
    return checkDualPuzzle(params?.puzzle, { Lira: params?.liraBond || 0, Theron: params?.theronBond || 0 });
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'companion_secret_rooms',
  description: 'Get accessible secret rooms for a dungeon at given bond levels. Pass { dungeon: "dungeon_id", liraBond: 0-5, theronBond: 0-5 }.',
  async execute(params) {
    return getAccessibleSecretRooms(params?.dungeon, { Lira: params?.liraBond || 0, Theron: params?.theronBond || 0 });
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'companion_interaction_matrix',
  description: 'Get companion-actor interaction matrix — which companion abilities affect which puzzle actors, cross-referenced.',
  async execute() {
    return buildCompanionInteractionMatrix();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'companion_puzzle_export',
  description: 'Export companion puzzle system to JSON for UE5. Creates Assets/Dungeons/companion-puzzle-system.json with bond levels, abilities, dual puzzles, secret rooms.',
  async execute() {
    return exportCompanionPuzzleSpecs();
  },
}, { rateLimit: 10000 });

// ── ms_6: Corruption Interference tools ─────────────────────────────────────

registerTool({
  name: 'corruption_dungeon_summary',
  description: 'Get corruption interference summary for a dungeon. Shows per-room corruption tiers, active effects, and special mechanics. Pass { dungeonId: "temporal_sanctum"|"abyssal_cistern"|"ember_forge"|"verdant_labyrinth"|"umbral_nexus"|"primal_crucible" }.',
  async execute(params) {
    return getDungeonCorruptionSummary(params?.dungeonId);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'corruption_room_effects',
  description: 'Get all active corruption effects in a specific dungeon room. Shows per-actor interference, workarounds, special mechanics, and cleanse options. Pass { dungeonId: "temporal_sanctum", roomIndex: 2 }.',
  async execute(params) {
    return getRoomCorruptionEffects(params?.dungeonId, params?.roomIndex ?? 0);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'corruption_actor_effect',
  description: 'Get corruption effect on a specific actor type at a given level. Pass { actorTypeId: "lever", corruptionLevel: 0.5 }.',
  async execute(params) {
    return getCorruptionEffect(params?.actorTypeId, params?.corruptionLevel ?? 0);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'corruption_interference_all',
  description: 'Get full corruption interference overview for all 6 dungeons — actor effect types, special mechanics count, peak tiers.',
  async execute() {
    return getAllCorruptionInterference();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'corruption_interference_export',
  description: 'Export corruption interference specs to JSON for UE5. Creates Assets/Dungeons/corruption-interference.json with actor effects, dungeon profiles, cleanse methods.',
  async execute() {
    return exportCorruptionInterferenceSpecs();
  },
}, { rateLimit: 10000 });

// ── ms_7: World Placement & Discovery Triggers ──────────────────────────────

registerTool({
  name: 'dungeon_placement_list',
  description: 'List world placements for all 6 Shard Echo dungeons — coordinates, region, entrance type, discovery difficulty, required shards.',
  async execute() {
    return getAllDungeonPlacements();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'dungeon_placement_detail',
  description: 'Get full placement details for a specific dungeon — world position, entrance asset, visual cues, navigation hints, level streaming volume, discovery triggers. Pass { dungeonId: "temporal_sanctum"|"abyssal_cistern"|"ember_forge"|"verdant_labyrinth"|"umbral_nexus"|"primal_crucible" }.',
  async execute(params) {
    const placement = getDungeonPlacement(params?.dungeonId);
    const triggers = DUNGEON_DISCOVERY_TRIGGERS[params?.dungeonId];
    const worldPlacement = DUNGEON_WORLD_PLACEMENTS[params?.dungeonId];
    if (placement.error) return placement;
    return {
      ...placement,
      visualCueDetails: worldPlacement?.visualCues || [],
      discoveryTriggers: triggers?.triggers || [],
      firstDiscoveryReward: triggers?.firstDiscoveryReward,
      rediscoveryBehavior: triggers?.rediscoveryBehavior,
    };
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'dungeon_discovery_check',
  description: 'Simulate discovery progression for a dungeon. Pass { dungeonId, playerShards: ["Time"], currentStep: 0 }. Returns next trigger step details.',
  async execute(params) {
    const dungeonId = params?.dungeonId;
    const triggers = DUNGEON_DISCOVERY_TRIGGERS[dungeonId];
    if (!triggers) return { error: `Unknown dungeon: ${dungeonId}` };
    const playerShards = params?.playerShards || [];
    const currentStep = params?.currentStep || 0;
    const missingShards = triggers.requiredShards.filter(s => !playerShards.includes(s));
    if (missingShards.length > 0) {
      return { canProgress: false, missingShards, requiredShards: triggers.requiredShards };
    }
    const nextTrigger = triggers.triggers.find(t => t.step === currentStep + 1);
    if (!nextTrigger) return { canProgress: false, reason: 'All steps completed', state: 'revealed' };
    return {
      canProgress: true,
      nextStep: nextTrigger.step,
      totalSteps: triggers.triggers.length,
      triggerType: nextTrigger.type,
      triggerConfig: nextTrigger.config,
    };
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'dungeon_placement_export',
  description: 'Export all dungeon world placements and discovery triggers to JSON for UE5. Creates Assets/Dungeons/dungeon-world-placements.json.',
  async execute() {
    return exportWorldPlacementSpecs();
  },
}, { rateLimit: 10000 });

// ── Wayshrine Visual Design Tools ─────────────────────────────────────────────

registerTool({
  name: 'wayshrine_concepts',
  description: 'Get all 7 region-specific wayshrine concept summaries. Returns displayName, lore, concept description, accent color, mesh/material/particle/light counts for each region.',
  async execute() {
    return { concepts: getWayshrineConceptSummaries(), common: getWayshrineCommonSpec() };
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'wayshrine_detail',
  description: 'Get the full wayshrine concept for a specific region. Pass { regionId }. Available: CrossroadsHub, AshenWilds, Ironhold, VerdantReach, SunkenHalls, EmberPeaks, Aethermere, TheWilds. Returns mesh spec, materials, particles, lighting, placements, and common behavior.',
  async execute(params) {
    return getWayshrineConceptDetail(params?.regionId ?? 'CrossroadsHub');
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'wayshrine_placements',
  description: 'Get all 21 wayshrine placement positions across all 7 regions (3 per region). Returns position, rotation, region, and type for each wayshrine.',
  async execute() {
    return getAllWayshrinePositions();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'wayshrine_status',
  description: 'Get the current wayshrine design status — concepts designed, placements defined, per-region breakdown.',
  async execute() {
    return getWayshrineDesignStatus();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'wayshrine_export',
  description: 'Export all wayshrine designs (concepts, common behavior, placements) to JSON for UE5 consumption. Creates Assets/Wayshrines/wayshrine-designs.json.',
  async execute() {
    return exportWayshrineDesigns();
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'wayshrine_build_blueprint',
  description: 'Build a wayshrine blueprint for a specific region in UE5. Pass { regionId }. Creates BP_Wayshrine_<region> with emissive crystal variables, point light params, interaction/suppression config, and event graph. Available regions: CrossroadsHub, AshenWilds, Ironhold, VerdantReach, SunkenHalls, EmberPeaks, Aethermere, TheWilds.',
  async execute(params) {
    return buildWayshrineBlueprint(params?.regionId ?? 'CrossroadsHub');
  },
}, { rateLimit: 30000 });

registerTool({
  name: 'wayshrine_build_all',
  description: 'Build all 7 region wayshrine blueprints in UE5. Creates BP_Wayshrine_<region> for each region with emissive crystal mesh specs and point light configuration.',
  async execute() {
    return buildAllWayshrineBlueprints();
  },
}, { rateLimit: 60000 });

registerTool({
  name: 'wayshrine_spawn',
  description: 'Spawn a wayshrine actor at a placement position. Pass { regionId, placementIndex }. Builds blueprint if needed, then spawns at the predefined position. placementIndex: 0-2 (3 per region).',
  async execute(params) {
    return spawnWayshrineActor(params?.regionId ?? 'CrossroadsHub', params?.placementIndex ?? 0);
  },
}, { rateLimit: 30000 });

registerTool({
  name: 'wayshrine_spawn_region',
  description: 'Spawn all 3 wayshrines for a specific region. Pass { regionId }. Builds blueprint if needed, spawns at all 3 predefined placement positions.',
  async execute(params) {
    return spawnRegionWayshrines(params?.regionId ?? 'CrossroadsHub');
  },
}, { rateLimit: 60000 });

registerTool({
  name: 'wayshrine_spawn_all',
  description: 'Build all blueprints and spawn all 21 wayshrines across all 7 regions. Full deployment pipeline.',
  async execute() {
    return spawnAllWayshrines();
  },
}, { rateLimit: 120000 });

registerTool({
  name: 'wayshrine_component_spec',
  description: 'Get the detailed UE5 component specification for a wayshrine blueprint. Pass { regionId }. Returns crystal mesh spec, point light config, interaction sphere, suppression sphere, secondary lights, particles, and audio. Useful for manual BP setup.',
  async execute(params) {
    return getWayshrineComponentSpec(params?.regionId ?? 'CrossroadsHub');
  },
}, { rateLimit: 5000 });

// ── Wayshrine Niagara Particle Tools (ms_3) ──────────────────────────────────

registerTool({
  name: 'wayshrine_niagara_spec',
  description: 'Get the detailed Niagara particle system specs for a region wayshrine. Pass { regionId }. Returns emitter configs, spawn rates, color/size curves, velocity, rendering settings for ambient + rest-burst systems.',
  async execute(params) {
    return getNiagaraSpec(params?.regionId ?? 'CrossroadsHub');
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'wayshrine_niagara_all',
  description: 'Get summary of all per-region Niagara particle systems. Returns total systems, emitters, spawn rates across all 7 regions.',
  async execute() {
    return getAllNiagaraSpecs();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'wayshrine_niagara_deploy_region',
  description: 'Deploy ambient Niagara particles at all wayshrine placements for a specific region. Pass { regionId }. Spawns NS systems via UE5 MCP.',
  async execute(params) {
    return deployRegionNiagara(params?.regionId ?? 'CrossroadsHub');
  },
}, { rateLimit: 60000 });

registerTool({
  name: 'wayshrine_niagara_deploy_all',
  description: 'Deploy Niagara particle systems at all 21 wayshrine positions across all regions. Full VFX deployment pipeline.',
  async execute() {
    return deployAllNiagara();
  },
}, { rateLimit: 300000 });

registerTool({
  name: 'wayshrine_niagara_export',
  description: 'Export all Niagara particle system specifications to JSON for UE5. Creates Assets/Wayshrines/niagara-particle-specs.json with emitter configs, materials, and deployment data.',
  async execute() {
    return exportNiagaraSpecs();
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'wayshrine_niagara_status',
  description: 'Get the Niagara deployment status — how many particle systems are deployed vs target per region.',
  async execute() {
    return getNiagaraDeploymentStatus();
  },
}, { rateLimit: 5000 });

// ── ms_4: Corruption-Suppression Post-Process Sphere tools ──

registerTool({
  name: 'wayshrine_suppression_spec',
  description: 'Get the corruption-suppression post-process sphere spec for a region. Pass { regionId }. Returns color grading, bloom override, MPC params, transition curve.',
  async execute(params) {
    return getSuppressionPPSpec(params?.regionId ?? 'CrossroadsHub');
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'wayshrine_suppression_all',
  description: 'Get summary of all per-region corruption-suppression post-process sphere specs. Returns MPC config, transition curves, and per-region color grading highlights.',
  async execute() {
    return getAllSuppressionPPSpecs();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'wayshrine_suppression_script',
  description: 'Generate the UE5 Python script to create MPC_WayshrineSuppression and PP volume for a region. Pass { regionId }. Returns executable Python code.',
  async execute(params) {
    return generateSuppressionPPScript(params?.regionId ?? 'CrossroadsHub');
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'wayshrine_suppression_deploy_region',
  description: 'Deploy corruption-suppression post-process spheres at all wayshrine placements for a specific region. Pass { regionId }.',
  async execute(params) {
    return deploySuppressionPP(params?.regionId ?? 'CrossroadsHub');
  },
}, { rateLimit: 60000 });

registerTool({
  name: 'wayshrine_suppression_deploy_all',
  description: 'Deploy corruption-suppression PP spheres at all wayshrine positions across all regions.',
  async execute() {
    return deployAllSuppressionPP();
  },
}, { rateLimit: 300000 });

registerTool({
  name: 'wayshrine_suppression_export',
  description: 'Export all suppression PP specs to JSON for UE5 consumption. Creates Assets/Wayshrines/suppression-pp-specs.json.',
  async execute() {
    return exportSuppressionPPSpecs();
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'wayshrine_suppression_status',
  description: 'Get suppression PP deployment status — how many post-process spheres deployed vs target per region.',
  async execute() {
    return getSuppressionPPDeploymentStatus();
  },
}, { rateLimit: 5000 });

// ── ms_5: Rest Bloom Pulse & Cinematic Camera Blend tools ──

registerTool({
  name: 'wayshrine_bloom_spec',
  description: 'Get the bloom pulse spec for a region wayshrine. Pass { regionId }. Returns bloom color, peak intensity, timeline keyframes, MPC params, and secondary glow config.',
  async execute(params) {
    return getBloomPulseSpec(params?.regionId ?? 'CrossroadsHub');
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'wayshrine_bloom_all',
  description: 'Get summary of all per-region bloom pulse specs. Returns bloom colors, peak intensities, and timeline durations for all 7 regions.',
  async execute() {
    return getAllBloomPulseSpecs();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'wayshrine_bloom_script',
  description: 'Generate the UE5 Python script to create MPC_WayshrineBloom and PP_BloomPulse volume for a region. Pass { regionId }. Returns executable Python code.',
  async execute(params) {
    return generateBloomPulseScript(params?.regionId ?? 'CrossroadsHub');
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'wayshrine_bloom_deploy_region',
  description: 'Deploy bloom pulse post-process volumes at all wayshrine placements for a specific region. Pass { regionId }.',
  async execute(params) {
    return deployBloomPulse(params?.regionId ?? 'CrossroadsHub');
  },
}, { rateLimit: 60000 });

registerTool({
  name: 'wayshrine_bloom_deploy_all',
  description: 'Deploy bloom pulse PP volumes at all wayshrine positions across all regions. Full bloom FX deployment.',
  async execute() {
    return deployAllBloomPulse();
  },
}, { rateLimit: 300000 });

registerTool({
  name: 'wayshrine_camera_spec',
  description: 'Get the cinematic camera orbit spec for a region wayshrine. Pass { regionId }. Returns orbit radius/speed, pitch, focal offset, f-stop, blend times, and DOF settings.',
  async execute(params) {
    return getCinematicCameraSpec(params?.regionId ?? 'CrossroadsHub');
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'wayshrine_camera_all',
  description: 'Get summary of all per-region cinematic camera orbit specs. Returns orbit params and blend times for all 7 regions.',
  async execute() {
    return getAllCinematicCameraSpecs();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'wayshrine_camera_script',
  description: 'Generate the UE5 Python script to spawn a CineCameraActor for wayshrine rest cinematic. Pass { regionId, position }. Returns executable Python code with orbit and DOF config.',
  async execute(params) {
    return generateCinematicCameraScript(params?.regionId ?? 'CrossroadsHub', params?.position ?? [0, 0, 100]);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'wayshrine_camera_deploy_region',
  description: 'Deploy cinematic cameras at all wayshrine placements for a specific region. Pass { regionId }.',
  async execute(params) {
    return deployCinematicCamera(params?.regionId ?? 'CrossroadsHub');
  },
}, { rateLimit: 60000 });

registerTool({
  name: 'wayshrine_camera_deploy_all',
  description: 'Deploy cinematic cameras at all wayshrine positions across all regions. Full camera deployment.',
  async execute() {
    return deployAllCinematicCameras();
  },
}, { rateLimit: 300000 });

registerTool({
  name: 'wayshrine_restfx_status',
  description: 'Get rest FX deployment status — bloom pulse volumes and cinematic cameras deployed vs target per region.',
  async execute() {
    return getRestFXDeploymentStatus();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'wayshrine_restfx_export',
  description: 'Export all bloom pulse + cinematic camera specs to JSON for UE5. Creates Assets/Wayshrines/rest-fx-specs.json.',
  async execute() {
    return exportRestFXSpecs();
  },
}, { rateLimit: 10000 });

// ms_6: Aethermere Reality Sphere tools
registerTool({
  name: 'aethermere_reality_sphere_build',
  description: 'Build the Aethermere reality-sphere special case wayshrine. Creates BP with extra variables (sphere radius, void push, iridescence), deploys dual PP volumes (normalcy inside, void outside), interior lighting, and void push timeline.',
  async execute() {
    return buildAethermereRealitySphere();
  },
}, { rateLimit: 60000 });

registerTool({
  name: 'aethermere_reality_sphere_spec',
  description: 'Get the full Aethermere reality sphere specification — sphere shell, inner environment, void boundary FX, void push phases, dual PP, audio layers.',
  async execute() {
    return getAethermereRealitySphereSpec();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'aethermere_reality_sphere_status',
  description: 'Get Aethermere reality sphere build status — whether built, variable count, sphere/void-push radii, Niagara emitters.',
  async execute() {
    return getAethermereRealitySphereStatus();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'aethermere_reality_sphere_export',
  description: 'Export Aethermere reality sphere spec to JSON. Creates Assets/Wayshrines/Aethermere/reality-sphere-spec.json.',
  async execute() {
    return exportAethermereRealitySphereSpec();
  },
}, { rateLimit: 10000 });

// ── ms_7: Full Wayshrine Deployment Tools ─────────────────────────────────────

registerTool({
  name: 'wayshrine_deploy_all_complete',
  description: 'Full deployment of all 24 wayshrines (8 regions x 3) with every visual layer: blueprints, actors, Niagara particles, corruption-suppression PP, bloom pulse, cinematic cameras, and Aethermere reality sphere. Idempotent — skips already-deployed items. Exports deployment manifest on completion.',
  async execute() {
    return deployAllWayshrinesComplete();
  },
}, { rateLimit: 60000 });

registerTool({
  name: 'wayshrine_full_status',
  description: 'Get combined deployment status across all visual layers for all wayshrines. Shows per-region completion for: blueprints, actors, niagara, suppression, bloom, cameras. Overall completion percentage.',
  async execute() {
    return getFullDeploymentStatus();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'wayshrine_deployment_manifest',
  description: 'Export full deployment manifest with all wayshrine placements, regional visual variants (mesh, materials, lighting, particles), behavior config, and deployment status. Creates Assets/Wayshrines/deployment-manifest.json.',
  async execute() {
    return exportDeploymentManifest();
  },
}, { rateLimit: 10000 });

// ── Brief builders ───────────────────────────────────────────────────────────

function buildCompileCheckBrief(signal) {
  const d = signal.data;
  return {
    title: `UE5 Compilation Check — ${d.recentChanges} recent changes`,
    content: `${d.recentChanges} C++ source files were modified recently in the Shattered Crown UE5 project (${d.sourceFiles} total files).

Consider running a compilation check via unreal_run_command to ensure no build errors.
Check the build log for warnings about missing includes, undefined symbols, or deprecated APIs.`,
    reasoning: `Many source files changed recently — a compilation check ensures the project is still buildable.`,
  };
}

// ── Urgent work check ────────────────────────────────────────────────────────

function hasUrgentWork() {
  try {
    if (!regionManifestExists()) return false;
    const progress = getRegionProgress();
    // Urgent when most regions are done and just a few remain
    return progress.pending > 0 && progress.pending <= 2 && progress.completed >= 5;
  } catch { return false; }
}

// ── Module manifest ──────────────────────────────────────────────────────────

export default {
  name: 'unreal',
  signalPrefix: 'unreal_',
  messageCategory: 'shattered-crown',

  detectSignals: detectUnrealSignals,

  briefBuilders: {
    unreal_asset_import: buildAssetImportBrief,
    unreal_compile_check: buildCompileCheckBrief,
    unreal_level_build: buildLevelBuildBrief,
    unreal_blueprint_build: buildBlueprintBrief,
  },

  sonnetSignalTypes: [],

  stateKey: 'unreal-project',
  stateKeyMap: {
    unreal_asset_import: 'lastAssetImportAt',
    unreal_compile_check: 'lastCompileCheckAt',
    unreal_level_build: 'lastLevelBuildAt',
    unreal_blueprint_build: 'lastBlueprintBuildAt',
  },

  hasUrgentWork,
};
