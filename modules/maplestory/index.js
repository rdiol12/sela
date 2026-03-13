/**
 * modules/maplestory/index.js — MapleStory Cosmic v83 server management module.
 *
 * Gives the agent tools to manage the MapleStory private server:
 * - Start/stop server and MySQL
 * - Create/edit NPC scripts, quest scripts, event scripts
 * - Add NPCs and mobs to maps
 * - Manage drop tables, config, and DB queries
 * - Read/edit WZ game data (mobs, skills, items, maps, equipment)
 * - Search game content by name
 */

import { registerTool } from '../../lib/tool-bridge.js';
import { callTool } from '../../lib/mcp-gateway.js';
import {
  generateSprite, generateSpriteSheet, generateMonster,
  generateNPC, generateItem, generateAnimation, generateAnimationSet,
  getStatus as comfyStatus,
} from './comfyui-sprites.js';
import {
  getServerStatus, startMysql, startServer, stopServer, stopMysql, restartServer,
  tailLog, listLogs, getOnlinePlayers, createMap, compileWz, uploadPatchedWz,
  listNpcScripts, readNpcScript, writeNpcScript,
  listQuestScripts, writeQuestScript,
  listEventScripts, writeEventScript,
  readWzFile, writeWzFile,
  addNpcToMap, addMobToMap,
  addDrop, getDrops,
  readConfig, updateConfig,
  mysqlQuery,
  importSprite,
  importMapAsset,
} from './server-manager.js';
import {
  lookupName, searchNames,
  getMobStats, setMobStats, searchMobs,
  getSkillData, setSkillLevelData, listJobSkills,
  getMapInfo, getMapLife, getMapPortals, searchMaps,
  getItemData, setItemData,
  getEquipData,
  searchNpcs, listNpcNames,
  setWzProperty, addWzProperty,
  getWzStats,
} from './wz-xml.js';
import { detectMapleSignals } from './signals.js';
import { buildMapleContentBrief, buildMapleServerDownBrief, buildMapleLogErrorsBrief, buildMapleCreativeBrief, buildMapleMapWorkBrief, buildMapleWzStaleBrief } from './brief-builders.js';
import { botManager } from './bot-manager.js';
import {
  CUSTOM_WEAPONS,
  deployCustomWeapons,
  getCustomWeaponStatus,
  isCustomWeapon,
} from './custom-weapons.js';
import {
  CUSTOM_ITEMS,
  deployCustomItems,
  getCustomItemStatus,
  isCustomItem,
} from './custom-items.js';
import {
  CUSTOM_DROPS,
  deployCustomDrops,
  getCustomDropStatus,
  getCustomDropSummary,
  writeCustomDropsSql,
} from './custom-drops.js';
import {
  SKILL_REBALANCES,
  deployCustomSkills,
  getSkillRebalanceSummary,
  getCustomSkillStatus,
} from './custom-skills.js';
import {
  CUSTOM_QUESTS,
  deployCustomQuests,
  getCustomQuestStatus,
  getCustomQuestSummary,
} from './custom-quests.js';
import {
  CUSTOM_EVENTS,
  deployCustomEvents,
  getCustomEventStatus,
  getCustomEventSummary,
} from './custom-events.js';
import {
  SAGE_CLASS,
  SAGE_WEAPONS,
  SAGE_SKILL_TREE,
  deploySkillWz,
  deploySkillStrings,
  deployAdvancementNpcs,
  deploySageWeapons,
  deploySageMaps,
  getSageMapsStatus,
  deployAll as deploySageClass,
  getSageDeployStatus,
  verifySageIntegration,
} from './custom-class.js';
import { runHealthCheck } from './health-check.js';
import { createLinkedMap, listCustomMaps, addPortalToMap, validateMapPortals, getMapRegistry } from './map-manager.js';
import { getBotIntegrationReport, getSageJobPath, getSageTrainingSpots, getSageQuestHandlers } from './bot-integration.js';
import { deployFrozenCaverns, getFrozenCavernsStatus, getFrozenCavernsMapStatus } from './frozen-caverns.js';
import { deployShadowCrypts, getShadowCryptsStatus, getShadowCryptsMapStatus, validateShadowCrypts } from './shadow-crypts.js';
import {
  NECROMANCER_CLASS,
  deploySkillWz as deployNecroSkillWz,
  deploySkillStrings as deployNecroSkillStrings,
  deployAdvancementNpcs as deployNecroNpcs,
  deployAll as deployNecromancer,
  getNecroDeployStatus,
  deployTrainingMap as deployNecroTraining,
  validateNecromancerClass,
} from './necromancer-class.js';
import {
  generateTierSprites,
  generateAllSprites,
  injectEffectXml,
  injectAllEffectXml,
  getSpriteStatus,
  packSpritesToClientWz,
} from './necromancer-sprites.js';
import {
  generateAllNpcSprites,
  packAllNpcSpritesToWz,
  getNpcSpriteStatus,
  NPC_VISUALS,
} from './custom-npc-sprites.js';
import {
  generateAllItemIcons,
  packAllItemIconsToWz,
  getItemIconStatus,
} from './custom-item-icons.js';
import {
  generateAllEquipmentSprites,
  equipmentSpriteStatus,
} from './custom-equipment-sprites.js';
import {
  generateAllSageSprites,
  getSagespriteStatus,
  packSageSpritesToClientWz,
  injectAllSageEffectXml,
} from './sage-sprites.js';
import {
  generateClassPortraits,
  packAllNpcSpritesToClientWz,
  getClassSpriteStatus,
} from './class-selection-sprites.js';
import {
  generateAllMobSprites,
  getMobSpriteStatus,
  packAllMobSpritesToWz,
} from './custom-mob-sprites.js';
import {
  generateSprite as loraGenerateSprite,
  writeWzXml as loraWriteWzXml,
  runLoraPipeline,
  importSpritesToWz,
} from './lora-sprite-gen.js';
import {
  validateAllWzAssets,
  getValidationSummary,
} from './wz-validator.js';
import {
  getBlueprintSystem,
  TIER_MATERIALS,
  generateBlacksmithNpcScript,
  deployAll as deployBlueprintSystem,
  getBlueprintStatus,
  deployBlueprintWeapons,
  deployBlueprintItems,
  deployBlueprintStrings,
  deployBlueprintEtcStrings,
  deployBlacksmithNpcStrings,
  deployBlacksmithNpcs,
  deployBlueprintDrops,
} from './blueprint-crafting.js';

// ── Server Management Tools ──────────────────────────────────────────────────

registerTool({
  name: 'maple_status',
  description: 'Get MapleStory Cosmic server status: MySQL running, game server running, account/character counts.',
  async execute() {
    return getServerStatus();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_start',
  description: 'Start the MapleStory server (starts MySQL first if needed, then Cosmic game server). Returns success status.',
  async execute() {
    return startServer();
  },
}, { rateLimit: 30000 });

registerTool({
  name: 'maple_restart',
  description: 'Restart the MapleStory Cosmic server. Kills the running Java process and starts a fresh instance. Use after WZ edits, config changes, NPC/mob placement, or skill edits. Takes ~20s.',
  async execute() {
    return restartServer();
  },
}, { rateLimit: 60000 });

registerTool({
  name: 'maple_stop',
  description: 'Stop the MapleStory Cosmic game server. Kills the Java process. Does NOT stop MySQL.',
  async execute() {
    return stopServer();
  },
}, { rateLimit: 30000 });

registerTool({
  name: 'maple_stop_mysql',
  description: 'Stop the MySQL server used by MapleStory. Stop the game server first!',
  async execute() {
    return stopMysql();
  },
}, { rateLimit: 30000 });

registerTool({
  name: 'maple_logs',
  description: 'Read recent server logs. Params: { log: "main"|"chat.log"|filename, lines: 50 }. Default: last 50 lines of main log. Use to diagnose crashes, errors, player activity.',
  async execute(params) {
    return tailLog(params?.log || 'main', params?.lines || 50);
  },
}, { rateLimit: 3000 });

registerTool({
  name: 'maple_log_list',
  description: 'List all available MapleStory server log files.',
  async execute() {
    return { logs: listLogs() };
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_players',
  description: 'Get currently online players. Returns name, level, job, and map for each connected player.',
  async execute() {
    return getOnlinePlayers();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_start_mysql',
  description: 'Start only MySQL (without starting the game server). Useful when you need DB access without the full server.',
  async execute() {
    return startMysql();
  },
}, { rateLimit: 30000 });

registerTool({
  name: 'maple_create_map',
  description: 'Create a new custom map. Params: { mapId: "990000100", name: "Training Grounds", streetName: "Custom Area", returnMap: 100000000, bgm: "Bgm00/GoPicnic", footholds: [{ x1: -500, y1: 0, x2: 500, y2: 0 }], portals: [{ name: "sp", type: 0, x: 0, y: 0, targetMap: 100000000, targetPortal: "sp" }] }. Use 99xxxxxxx range for custom map IDs. Requires server restart. After creating, add NPCs/mobs with maple_place_npc and maple_add_mob.',
  async execute(params) {
    if (!params?.mapId) throw new Error('Missing mapId');
    return createMap(params.mapId, params);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_import_sprite',
  description: 'Import a PNG sprite into WZ data for a mob, NPC, or item. Params: { type: "mob"|"npc"|"item", id: "0100100", pngPath: "/absolute/path/to/sprite.png", animState: "stand", frame: 0 }. Copies PNG to img-data directory and updates WZ XML. Requires server restart.',
  async execute(params) {
    if (!params?.type || !params?.id || !params?.pngPath) throw new Error('Missing type, id, or pngPath');
    return importSprite(params.type, params.id, params.pngPath, params.animState || 'stand', params.frame || 0);
  },
}, { rateLimit: 3000 });

registerTool({
  name: 'maple_import_map_asset',
  description: 'Import a PNG into Map WZ data as a background, tileset piece, or object sprite. Params: { assetType: "back"|"tile"|"obj", setName: "customForest", subPath: "0", pngPath: "/path/to/sky.png" }. For back: subPath is the image index ("0", "1"). For tile: subPath is "bsc/0", "edU/0", "enH0/0". For obj: subPath is "category/subcategory/variant/frame" (e.g. "tree/big/0/0"). After import, use bS/tS/oS=setName in map XML. Requires server restart.',
  async execute(params) {
    if (!params?.assetType || !params?.setName || !params?.subPath || !params?.pngPath) {
      throw new Error('Missing assetType, setName, subPath, or pngPath');
    }
    return importMapAsset(params.assetType, params.setName, params.subPath, params.pngPath);
  },
}, { rateLimit: 3000 });

registerTool({
  name: 'maple_query',
  description: 'Run a SQL query on the cosmic MySQL database. Params: { sql: "SELECT ..." }. Key tables: drop_data(id,dropperid,itemid,minimum_quantity,maximum_quantity,questid,chance), drop_data_global(id,itemid,minimum_quantity,maximum_quantity,questid,chance), characters, inventoryitems, shops, shopitems.',
  async execute(params) {
    const sql = params?.sql || params?.query || params?.SQL;
    if (!sql) throw new Error('Missing sql parameter — provide { sql: "SELECT ..." }');
    const result = mysqlQuery(sql);
    return { success: true, result };
  },
}, { rateLimit: 2000 });

// ── NPC Tools ────────────────────────────────────────────────────────────────

registerTool({
  name: 'maple_list_npcs',
  description: 'List all NPC script IDs in the server. Returns array of NPC IDs that have scripts.',
  async execute() {
    const npcs = listNpcScripts();
    return { count: npcs.length, npcs: npcs.slice(0, 50), note: npcs.length > 50 ? `${npcs.length - 50} more...` : undefined };
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_read_npc',
  description: 'Read an NPC script by ID. Params: { npcId: "1002000" }. Returns the JavaScript source code.',
  async execute(params) {
    if (!params?.npcId) throw new Error('Missing npcId parameter');
    const code = readNpcScript(params.npcId);
    if (!code) return { success: false, error: `NPC ${params.npcId} script not found` };
    return { success: true, npcId: params.npcId, code };
  },
}, { rateLimit: 2000 });

registerTool({
  name: 'maple_write_npc',
  description: 'Create or update an NPC script. Params: { npcId: "9999001", code: "var status = 0; ..." }. The script uses cm (NPCConversationManager) object with methods: cm.sendNext(), cm.sendSimple(), cm.sendYesNo(), cm.gainItem(id, qty), cm.gainExp(amount), cm.gainMeso(amount), cm.warp(mapId), cm.dispose(), cm.getJobId(), cm.getLevel(), cm.getMeso(), cm.haveItem(id).',
  async execute(params) {
    if (!params?.npcId || !params?.code) throw new Error('Missing npcId or code parameter');
    return writeNpcScript(params.npcId, params.code);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_place_npc',
  description: 'Place an NPC on a map by editing the map WZ XML. Params: { mapId: "100000000", npcId: "9999001", x: 500, y: 267 }. Common maps: 100000000=Henesys, 101000000=Ellinia, 102000000=Perion, 103000000=Kerning, 104000000=Lith Harbor. Requires server restart.',
  async execute(params) {
    if (!params?.mapId || !params?.npcId) throw new Error('Missing mapId or npcId parameter');
    return addNpcToMap(params.mapId, params.npcId, params.x || 0, params.y || 0);
  },
}, { rateLimit: 5000 });

// ── Quest Tools ──────────────────────────────────────────────────────────────

registerTool({
  name: 'maple_write_quest',
  description: 'Create or update a quest script. Params: { questId: "90000", code: "..." }. Uses qm (QuestManager) with: qm.sendNext(), qm.sendAcceptDecline(), qm.forceStartQuest(), qm.forceCompleteQuest(), qm.gainExp(), qm.gainItem(), qm.getQuestStatus(). Must define start() and end() functions.',
  async execute(params) {
    if (!params?.questId || !params?.code) throw new Error('Missing questId or code parameter');
    return writeQuestScript(params.questId, params.code);
  },
}, { rateLimit: 5000 });

// ── Event Tools ──────────────────────────────────────────────────────────────

registerTool({
  name: 'maple_write_event',
  description: 'Create or update an event script. Params: { name: "2xExpWeekend", code: "..." }. Must define init(), setup(), playerEntry(), monsterKilled(), allMonstersDead(), clearPQ(), timeOut() functions as needed.',
  async execute(params) {
    if (!params?.name || !params?.code) throw new Error('Missing name or code parameter');
    return writeEventScript(params.name, params.code);
  },
}, { rateLimit: 5000 });

// ── Map & Mob Tools ──────────────────────────────────────────────────────────

registerTool({
  name: 'maple_add_mob',
  description: 'Add mob spawns to a map. Params: { mapId: "100000000", mobId: "0100100", x: 500, y: 267, count: 5 }. Requires server restart.',
  async execute(params) {
    if (!params?.mapId || !params?.mobId) throw new Error('Missing mapId or mobId parameter');
    return addMobToMap(params.mapId, params.mobId, params.x || 0, params.y || 0, params.count || 1);
  },
}, { rateLimit: 5000 });

// ── Drop & Loot Tools ────────────────────────────────────────────────────────

registerTool({
  name: 'maple_add_drop',
  description: 'Add an item drop to a mob. Params: { mobId: 100100, itemId: 2000000, chance: 500000, minQty: 1, maxQty: 3 }. Chance is out of 1000000 (so 500000 = 50%). Takes effect immediately.',
  async execute(params) {
    if (!params?.mobId || !params?.itemId) throw new Error('Missing mobId or itemId parameter');
    return addDrop(params.mobId, params.itemId, params.chance || 100000, params.minQty || 1, params.maxQty || 1);
  },
}, { rateLimit: 2000 });

registerTool({
  name: 'maple_get_drops',
  description: 'Get all drops for a mob. Params: { mobId: 100100 }. Returns drop table.',
  async execute(params) {
    if (!params?.mobId) throw new Error('Missing mobId parameter');
    const result = getDrops(params.mobId);
    return { success: true, mobId: params.mobId, drops: result };
  },
}, { rateLimit: 2000 });

// ── Config Tool ──────────────────────────────────────────────────────────────

registerTool({
  name: 'maple_config',
  description: 'Read or update server config.yaml. Params: { action: "read" } to read entire config, or { action: "set", key: "exp_rate", value: "20" } to change a value. Requires server restart for changes.',
  async execute(params) {
    if (params?.action === 'set') {
      if (!params.key || params.value === undefined) throw new Error('Missing key or value');
      return updateConfig(params.key, params.value);
    }
    return { success: true, config: readConfig() };
  },
}, { rateLimit: 5000 });

// ── WZ Data Tool ─────────────────────────────────────────────────────────────

registerTool({
  name: 'maple_wz',
  description: 'Read or write WZ XML data files. Params: { action: "read", path: "Mob.wz/0100100.img.xml" } or { action: "write", path: "...", content: "..." }. Paths relative to wz/ directory. Use for editing mob stats, skill data, item properties, map data.',
  async execute(params) {
    if (params?.action === 'write') {
      if (!params.path || !params.content) throw new Error('Missing path or content');
      return writeWzFile(params.path, params.content);
    }
    if (!params?.path) throw new Error('Missing path parameter');
    const content = readWzFile(params.path);
    if (!content) return { success: false, error: `WZ file not found: ${params.path}` };
    return { success: true, path: params.path, content };
  },
}, { rateLimit: 2000 });

// ── WZ Data: Mob Tools ──────────────────────────────────────────────────────

registerTool({
  name: 'maple_mob_stats',
  description: 'Get mob stats by ID. Params: { mobId: 100100 }. Returns: name, level, maxHP, maxMP, PADamage, PDDamage, MADamage, MDDamage, acc, eva, exp, speed, etc.',
  async execute(params) {
    if (!params?.mobId) throw new Error('Missing mobId parameter');
    const stats = getMobStats(params.mobId);
    if (!stats) return { success: false, error: `Mob ${params.mobId} not found` };
    return { success: true, ...stats };
  },
}, { rateLimit: 2000 });

registerTool({
  name: 'maple_mob_edit',
  description: 'Edit mob stats. Params: { mobId: 100100, changes: { maxHP: "5000", PADamage: "100", exp: "200" } }. Can change any stat in the mob info section. Requires server restart.',
  async execute(params) {
    if (!params?.mobId || !params?.changes) throw new Error('Missing mobId or changes');
    return setMobStats(params.mobId, params.changes);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_search_mob',
  description: 'Search mobs by name. Params: { query: "mushroom", limit: 10 }. Returns mob IDs, names, level, HP, EXP, attack.',
  async execute(params) {
    if (!params?.query) throw new Error('Missing query parameter');
    return { success: true, results: searchMobs(params.query, params.limit || 20) };
  },
}, { rateLimit: 2000 });

// ── WZ Data: Skill Tools ────────────────────────────────────────────────────

registerTool({
  name: 'maple_skill_data',
  description: 'Get skill data by skill ID. Params: { skillId: 1001004 }. Returns skill name and per-level data (damage, MP cost, duration, etc.). Skill IDs: first digits = job ID (100=Warrior, 200=Magician, 300=Bowman, 400=Thief, 500=Pirate).',
  async execute(params) {
    if (!params?.skillId) throw new Error('Missing skillId parameter');
    const data = getSkillData(params.skillId);
    if (!data) return { success: false, error: `Skill ${params.skillId} not found` };
    return { success: true, ...data };
  },
}, { rateLimit: 2000 });

registerTool({
  name: 'maple_skill_edit',
  description: 'Edit a skill level\'s properties. Params: { skillId: 1001004, level: "10", changes: { damage: "200", mpCon: "15" } }. Requires server restart.',
  async execute(params) {
    if (!params?.skillId || !params?.level || !params?.changes) throw new Error('Missing skillId, level, or changes');
    return setSkillLevelData(params.skillId, params.level, params.changes);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_job_skills',
  description: 'List all skills for a job. Params: { jobId: 100 }. Job IDs: 0=Beginner, 100=Warrior(1st), 110=Fighter, 111=Crusader, 112=Hero, 120=Page, 200=Magician(1st), 210=F/P, 220=I/L, 230=Cleric, 300=Bowman(1st), 400=Thief(1st), 500=Pirate(1st).',
  async execute(params) {
    if (!params?.jobId && params?.jobId !== 0) throw new Error('Missing jobId parameter');
    const skills = listJobSkills(params.jobId);
    if (!skills) return { success: false, error: `Job ${params.jobId} skill file not found` };
    return { success: true, jobId: params.jobId, count: skills.length, skills };
  },
}, { rateLimit: 2000 });

// ── WZ Data: Map Tools ──────────────────────────────────────────────────────

registerTool({
  name: 'maple_map_info',
  description: 'Get detailed map info. Params: { mapId: 100000000 }. Returns: name, BGM, mob/NPC spawn counts, portal count, return map, and other map properties.',
  async execute(params) {
    if (!params?.mapId) throw new Error('Missing mapId parameter');
    const info = getMapInfo(params.mapId);
    if (!info) return { success: false, error: `Map ${params.mapId} not found` };
    return { success: true, ...info };
  },
}, { rateLimit: 2000 });

registerTool({
  name: 'maple_map_life',
  description: 'List all NPC and mob spawns on a map. Params: { mapId: 100000000 }. Returns array of { type, id, name, x, y } for each spawn.',
  async execute(params) {
    if (!params?.mapId) throw new Error('Missing mapId parameter');
    const life = getMapLife(params.mapId);
    if (!life) return { success: false, error: `Map ${params.mapId} not found` };
    return { success: true, mapId: params.mapId, count: life.length, life };
  },
}, { rateLimit: 2000 });

registerTool({
  name: 'maple_map_portals',
  description: 'Get all portals on a map. Params: { mapId: 100000000 }. Returns portal name, type, position, target map and portal.',
  async execute(params) {
    if (!params?.mapId) throw new Error('Missing mapId parameter');
    const portals = getMapPortals(params.mapId);
    if (!portals) return { success: false, error: `Map ${params.mapId} not found` };
    return { success: true, mapId: params.mapId, count: portals.length, portals };
  },
}, { rateLimit: 2000 });

registerTool({
  name: 'maple_search_map',
  description: 'Search maps by name. Params: { query: "henesys", limit: 10 }. Returns map IDs and names.',
  async execute(params) {
    if (!params?.query) throw new Error('Missing query parameter');
    return { success: true, results: searchMaps(params.query, params.limit || 20) };
  },
}, { rateLimit: 2000 });

// ── WZ Data: Item & Equipment Tools ─────────────────────────────────────────

registerTool({
  name: 'maple_item_data',
  description: 'Get item data by ID. Params: { itemId: 2000000 }. Returns item name, category, info (price, etc.), spec (hp/mp recovery, buffs). Works for consumables, etc items, cash items.',
  async execute(params) {
    if (!params?.itemId) throw new Error('Missing itemId parameter');
    const data = getItemData(params.itemId);
    if (!data) return { success: false, error: `Item ${params.itemId} not found` };
    return { success: true, ...data };
  },
}, { rateLimit: 2000 });

registerTool({
  name: 'maple_item_edit',
  description: 'Edit item properties. Params: { itemId: 2000000, section: "spec", changes: { hp: "500" } }. Section is "info" or "spec". Requires server restart.',
  async execute(params) {
    if (!params?.itemId || !params?.section || !params?.changes) throw new Error('Missing itemId, section, or changes');
    return setItemData(params.itemId, params.section, params.changes);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_equip_data',
  description: 'Get equipment stats by ID. Params: { equipId: 1302000 }. Returns: name, type (Weapon/Armor/etc), reqSTR, reqDEX, reqINT, reqLUK, reqLevel, incSTR, incPAD, incPDD, tuc (upgrade slots), etc.',
  async execute(params) {
    if (!params?.equipId) throw new Error('Missing equipId parameter');
    const data = getEquipData(params.equipId);
    if (!data) return { success: false, error: `Equipment ${params.equipId} not found` };
    return { success: true, ...data };
  },
}, { rateLimit: 2000 });

// ── WZ Data: Search & Lookup Tools ──────────────────────────────────────────

registerTool({
  name: 'maple_search_npc',
  description: 'Search NPCs by name. Params: { query: "grendel", limit: 10 }. Returns NPC IDs and names.',
  async execute(params) {
    if (!params?.query) throw new Error('Missing query parameter');
    return { success: true, results: searchNpcs(params.query, params.limit || 20) };
  },
}, { rateLimit: 2000 });

registerTool({
  name: 'maple_lookup',
  description: 'Look up a game entity name by ID. Params: { type: "mob", id: "100100" }. Types: mob, npc, map, skill, item, eqp. Returns the name string.',
  async execute(params) {
    if (!params?.type || !params?.id) throw new Error('Missing type or id');
    const name = lookupName(params.type, params.id);
    return { success: true, type: params.type, id: params.id, name: name || 'Unknown' };
  },
}, { rateLimit: 1000 });

registerTool({
  name: 'maple_search',
  description: 'Search any game entity by name. Params: { type: "mob", query: "dragon", limit: 10 }. Types: mob, npc, map, skill, item, eqp. Returns matching IDs and names.',
  async execute(params) {
    if (!params?.type || !params?.query) throw new Error('Missing type or query');
    return { success: true, results: searchNames(params.type, params.query, params.limit || 20) };
  },
}, { rateLimit: 2000 });

// ── WZ Data: Generic Property Edit ──────────────────────────────────────────

registerTool({
  name: 'maple_wz_set',
  description: 'Set any property in a WZ XML file. Params: { path: "Mob.wz/0100100.img.xml", prop: "info.maxHP", value: "9999" }. Universal editor for any game data. Requires server restart.',
  async execute(params) {
    if (!params?.path || !params?.prop || params?.value === undefined) throw new Error('Missing path, prop, or value');
    return setWzProperty(params.path, params.prop, params.value);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_wz_add',
  description: 'Add a new property to a WZ XML section. Params: { path: "Mob.wz/0100100.img.xml", section: "info", type: "int", name: "customProp", value: "100" }. Types: int, string, float, short. Requires server restart.',
  async execute(params) {
    if (!params?.path || !params?.section || !params?.type || !params?.name || params?.value === undefined) {
      throw new Error('Missing path, section, type, name, or value');
    }
    return addWzProperty(params.path, params.section, params.type, params.name, params.value);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_wz_stats',
  description: 'Get summary statistics about the WZ game data. Returns counts of mobs, NPCs, maps, skills, items, equipment, effects, and sounds.',
  async execute() {
    return { success: true, ...getWzStats() };
  },
}, { rateLimit: 10000 });

// ── Client-Side Binary Data (via harepacker-mcp) ─────────────────────────────

const MCP = 'harepacker-mcp';

registerTool({
  name: 'maple_sprite',
  description: 'Get a sprite/image from client data as base64 PNG. Params: { category: "Mob", image: "0100120.img", path: "move/0" }. Categories: Mob, Npc, Character, Map, UI, Effect, Item, Skill, Reactor.',
  async execute(params) {
    if (!params?.category || !params?.image || !params?.path) throw new Error('Missing category, image, or path');
    return JSON.parse(await callTool(MCP, 'get_canvas_bitmap', params));
  },
}, { rateLimit: 2000 });

registerTool({
  name: 'maple_sprite_info',
  description: 'Get sprite metadata (dimensions, origin, delay). Params: { category: "Mob", image: "0100120.img", path: "move/0" }.',
  async execute(params) {
    if (!params?.category || !params?.image || !params?.path) throw new Error('Missing category, image, or path');
    return JSON.parse(await callTool(MCP, 'get_canvas_info', params));
  },
}, { rateLimit: 1000 });

registerTool({
  name: 'maple_animation',
  description: 'Get animation frames for a mob/NPC/effect. Params: { category: "Mob", image: "0100120.img", path: "move", metadataOnly: true }. Returns frame list with width/height/delay/origin.',
  async execute(params) {
    if (!params?.category || !params?.image || !params?.path) throw new Error('Missing category, image, or path');
    return JSON.parse(await callTool(MCP, 'get_animation_frames', { ...params, metadataOnly: params.metadataOnly ?? true }));
  },
}, { rateLimit: 2000 });

registerTool({
  name: 'maple_sound',
  description: 'Get sound/BGM as base64 MP3. Params: { category: "Sound", image: "BgmGL.img", path: "Amoria" }.',
  async execute(params) {
    if (!params?.category || !params?.image || !params?.path) throw new Error('Missing category, image, or path');
    return JSON.parse(await callTool(MCP, 'get_sound_data', params));
  },
}, { rateLimit: 3000 });

registerTool({
  name: 'maple_sound_info',
  description: 'Get sound metadata (duration, format, frequency). Params: { category: "Sound", image: "BgmGL.img", path: "Amoria" }.',
  async execute(params) {
    if (!params?.category || !params?.image || !params?.path) throw new Error('Missing category, image, or path');
    return JSON.parse(await callTool(MCP, 'get_sound_info', params));
  },
}, { rateLimit: 1000 });

registerTool({
  name: 'maple_wz_tree',
  description: 'Browse binary WZ data tree. Params: { category: "Mob", image: "0100120.img", path: "", depth: 2 }. Returns hierarchical property tree with types and values.',
  async execute(params) {
    if (!params?.category || !params?.image) throw new Error('Missing category or image');
    return JSON.parse(await callTool(MCP, 'get_tree_structure', { path: '', depth: 2, ...params }));
  },
}, { rateLimit: 2000 });

registerTool({
  name: 'maple_wz_search',
  description: 'Search binary WZ data by property name pattern. Params: { pattern: "*maxHP*", category: "Mob", image: "0100120.img" }. Supports wildcards.',
  async execute(params) {
    if (!params?.pattern) throw new Error('Missing pattern');
    return JSON.parse(await callTool(MCP, 'search_by_name', { maxResults: 50, ...params }));
  },
}, { rateLimit: 3000 });

registerTool({
  name: 'maple_export_sprite',
  description: 'Export a sprite to PNG file. Params: { category: "Mob", image: "0100120.img", path: "stand/0", outputPath: "workspace/sprite.png" }.',
  async execute(params) {
    if (!params?.category || !params?.image || !params?.path || !params?.outputPath) {
      throw new Error('Missing category, image, path, or outputPath');
    }
    return JSON.parse(await callTool(MCP, 'export_png', params));
  },
}, { rateLimit: 3000 });

registerTool({
  name: 'maple_export_sound',
  description: 'Export a sound to MP3 file. Params: { category: "Sound", image: "BgmGL.img", path: "Amoria", outputPath: "workspace/bgm.mp3" }.',
  async execute(params) {
    if (!params?.category || !params?.image || !params?.path || !params?.outputPath) {
      throw new Error('Missing category, image, path, or outputPath');
    }
    return JSON.parse(await callTool(MCP, 'export_mp3', params));
  },
}, { rateLimit: 3000 });

registerTool({
  name: 'maple_wz_categories',
  description: 'List all available WZ data categories. Returns: effect, tamingmob, base, string, mob, quest, etc, item, sound, reactor, character, skill, morph, ui, npc, map.',
  async execute() {
    return JSON.parse(await callTool(MCP, 'list_categories', {}));
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'maple_wz_images',
  description: 'List .img files in a category. Params: { category: "Mob", subdirectory: "" }. Returns array of image names.',
  async execute(params) {
    if (!params?.category) throw new Error('Missing category');
    return JSON.parse(await callTool(MCP, 'list_images_in_category', params));
  },
}, { rateLimit: 3000 });

registerTool({
  name: 'maple_wz_property',
  description: 'Get a specific property value from binary WZ data. Params: { category: "Mob", image: "0100120.img", path: "info/maxHP" }. Returns type and value.',
  async execute(params) {
    if (!params?.category || !params?.image || !params?.path) throw new Error('Missing category, image, or path');
    return JSON.parse(await callTool(MCP, 'get_property', params));
  },
}, { rateLimit: 1000 });

// ── Pixel Art Generation (via PixelLab MCP) ──────────────────────────────────
//
// PixelLab MCP tool names: create_character, animate_character,
// create_topdown_tileset, create_sidescroller_tileset, create_isometric_tile,
// create_map_object. These are high-level wrappers over the PixelLab REST API.
// The callTool pass-through also works for any tool name the server exposes.

const PIXELLAB = 'pixellab';

registerTool({
  name: 'maple_create_character',
  description: 'Generate a pixel art character with multiple directional views. Params: { description: "blue slime monster", n_directions: 4 }. n_directions: 4 or 8 (directional sprite sheet). Returns character_id + base64 PNG images for each direction.',
  async execute(params) {
    if (!params?.description) throw new Error('Missing description');
    const args = { description: params.description };
    if (params.n_directions) args.n_directions = params.n_directions;
    return JSON.parse(await callTool(PIXELLAB, 'create_character', args, 60_000));
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_animate_character',
  description: 'Generate animation frames for an existing character. Params: { character_id: "abc123", animation: "walk" }. Animations: walk, run, idle, attack, etc. Returns animated sprite frames.',
  async execute(params) {
    if (!params?.character_id || !params?.animation) throw new Error('Missing character_id or animation');
    return JSON.parse(await callTool(PIXELLAB, 'animate_character', {
      character_id: params.character_id,
      animation: params.animation,
    }, 60_000));
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_create_tileset',
  description: 'Generate a top-down Wang tileset for seamless environments. Params: { lower: "ocean", upper: "sandy beach", lower_base_tile_id: "<optional prev id>" }. Returns tileset images with auto-transitions.',
  async execute(params) {
    if (!params?.lower || !params?.upper) throw new Error('Missing lower or upper');
    const args = { lower: params.lower, upper: params.upper };
    if (params.lower_base_tile_id) args.lower_base_tile_id = params.lower_base_tile_id;
    return JSON.parse(await callTool(PIXELLAB, 'create_topdown_tileset', args, 60_000));
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_create_sidescroll_tileset',
  description: 'Generate a side-scroller tileset. Params: { lower: "stone brick", transition: "moss", base_tile_id: "<optional prev id>" }. Returns tileset images.',
  async execute(params) {
    if (!params?.lower || !params?.transition) throw new Error('Missing lower or transition');
    const args = { lower: params.lower, transition: params.transition };
    if (params.base_tile_id) args.base_tile_id = params.base_tile_id;
    return JSON.parse(await callTool(PIXELLAB, 'create_sidescroller_tileset', args, 60_000));
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_create_iso_tile',
  description: 'Generate an isometric tile. Params: { description: "grass on top of dirt", size: 32 }. Size in pixels. Returns base64 PNG.',
  async execute(params) {
    if (!params?.description) throw new Error('Missing description');
    const args = { description: params.description };
    if (params.size) args.size = params.size;
    return JSON.parse(await callTool(PIXELLAB, 'create_isometric_tile', args, 30_000));
  },
}, { rateLimit: 3000 });

registerTool({
  name: 'maple_create_map_object',
  description: 'Generate a map object/prop. Params: { description: "treasure chest", background_image: "<optional base64>" }. Returns base64 PNG.',
  async execute(params) {
    if (!params?.description) throw new Error('Missing description');
    const args = { description: params.description };
    if (params.background_image) args.background_image = params.background_image;
    return JSON.parse(await callTool(PIXELLAB, 'create_map_object', args, 30_000));
  },
}, { rateLimit: 3000 });

registerTool({
  name: 'maple_pixellab_raw',
  description: 'Call any PixelLab MCP tool directly. Params: { tool: "create_character", args: { description: "wizard", n_directions: 8 } }. Use for tools not wrapped above. Pass-through to PixelLab MCP server.',
  async execute(params) {
    if (!params?.tool) throw new Error('Missing tool name');
    return JSON.parse(await callTool(PIXELLAB, params.tool, params.args || {}, 60_000));
  },
}, { rateLimit: 3000 });

// ── Ludo AI Sprite Generation (via Ludo MCP) ─────────────────────────────────
//
// Ludo AI generates high-quality pixel art sprites matching MapleStory art style.
// Uses generateWithStyle with original v83 sprites as style references.
// PREFERRED over PixelLab/ComfyUI/SVG for ALL sprite generation.
// Cost: 0.5 credits per image, 5 credits per animation. MCP at https://mcp.ludo.ai/mcp.

const LUDO = 'ludo';

// Pre-load MapleStory style reference sprites as base64 (extracted from v83 WZ data)
const STYLE_REFS_DIR = join(process.cwd(), 'workspace', 'maple-sprites', 'style-refs');
const STYLE_REFS = {};
for (const [key, file] of Object.entries({ npc: 'ref_npc.png', mob: 'ref_mob.png', boss: 'ref_boss.png' })) {
  try {
    STYLE_REFS[key] = 'data:image/png;base64,' + readFileSync(join(STYLE_REFS_DIR, file)).toString('base64');
  } catch { /* optional — falls back to createImage without style */ }
}

function pickStyleRef(category) {
  if (category === 'boss') return STYLE_REFS.boss;
  if (category === 'mob' || category === 'monster') return STYLE_REFS.mob;
  return STYLE_REFS.npc; // default for NPCs, items, weapons
}

registerTool({
  name: 'maple_ludo_sprite',
  description: 'Generate a MapleStory-style sprite via Ludo AI (PREFERRED tool for ALL sprites). Uses original v83 sprites as style reference for authentic MS look. Params: { prompt: "description", category: "npc"|"mob"|"boss"|"item"|"weapon"|"skill", type: "sprite"|"icon", n: 1 }. Returns image URL(s). 0.5 credits/image.',
  async execute(params) {
    if (!params?.prompt) throw new Error('Missing prompt');
    const category = params.category || 'npc';
    const imageType = params.type || 'sprite';
    const styleRef = pickStyleRef(category);

    if (styleRef) {
      const result = await callTool(LUDO, 'generateWithStyle', {
        requestBody: {
          style_image: styleRef,
          prompt: params.prompt,
          image_type: imageType,
          n: params.n || 1,
          augment_prompt: false,
        },
      }, 60_000);
      return JSON.parse(result);
    }

    const result = await callTool(LUDO, 'createImage', {
      requestBody: {
        image_type: imageType,
        prompt: params.prompt,
        art_style: 'Pixel Art (16-Bit)',
        perspective: 'Side-Scroll',
        aspect_ratio: 'ar_1_1',
        n: params.n || 1,
        augment_prompt: false,
      },
    }, 60_000);
    return JSON.parse(result);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_ludo_animate',
  description: 'Animate an existing sprite via Ludo AI. Params: { image_url: "https://...", animation_preset: "idle"|"walk"|"attack" }. 5 credits per animation. Returns spritesheet URL.',
  async execute(params) {
    if (!params?.image_url) throw new Error('Missing image_url');
    return JSON.parse(await callTool(LUDO, 'animateSprite', {
      requestBody: {
        image_url: params.image_url,
        animation_preset: params.animation_preset || 'idle',
      },
    }, 120_000));
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'maple_ludo_raw',
  description: 'Call any Ludo AI MCP tool directly. Params: { tool: "generateWithStyle", args: { requestBody: {...} } }. Tools: createImage, animateSprite, generateWithStyle, editImage, removeBackground, generatePose, createSoundEffect, create3DModel.',
  async execute(params) {
    if (!params?.tool) throw new Error('Missing tool name');
    return JSON.parse(await callTool(LUDO, params.tool, params.args || {}, 60_000));
  },
}, { rateLimit: 3000 });

// ── Local Pixel Art Generation (ComfyUI + Stable Diffusion) ──────────────────
//
// 100% free, runs on local GPU via ComfyUI + SD_PixelArt_SpriteSheet_Generator.
// ComfyUI must be running at http://127.0.0.1:8188 (start: python main.py --listen --port 8188)

registerTool({
  name: 'maple_comfy_status',
  description: 'Check ComfyUI local sprite generator status. Returns whether ComfyUI is running and available models.',
  async execute() {
    return comfyStatus();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_gen_sprite',
  description: 'Generate a pixel art sprite locally using ComfyUI (FREE, local GPU). Params: { description: "blue snail monster", direction: "front", useLora: false, width: 512, height: 512, seed: 12345, steps: 25, cfg: 7 }. Directions: front, right, back, left (using PixelartFSS/RSS/BSS/LSS triggers). Returns base64 PNG + saved file path.',
  async execute(params) {
    if (!params?.description) throw new Error('Missing description');
    return generateSprite(params.description, {
      direction: params.direction,
      useLora: params.useLora,
      width: params.width,
      height: params.height,
      seed: params.seed,
      steps: params.steps,
      cfg: params.cfg,
    });
  },
}, { rateLimit: 3000 });

registerTool({
  name: 'maple_gen_spritesheet',
  description: 'Generate a 4-direction pixel art sprite sheet locally (FREE). Params: { description: "warrior NPC with sword", seed: 12345 }. Generates front/right/back/left views using consistent seed. Returns array of 4 sprites with base64 PNGs.',
  async execute(params) {
    if (!params?.description) throw new Error('Missing description');
    return generateSpriteSheet(params.description, { seed: params.seed });
  },
}, { rateLimit: 3000 });

registerTool({
  name: 'maple_gen_monster',
  description: 'Generate a pixel art monster sprite locally (FREE). Params: { name: "Blue Snail", width: 512, height: 512 }. Optimized for MapleStory-style cute chibi monsters, side view.',
  async execute(params) {
    if (!params?.name) throw new Error('Missing name');
    return generateMonster(params.name, { width: params.width, height: params.height });
  },
}, { rateLimit: 3000 });

registerTool({
  name: 'maple_gen_npc',
  description: 'Generate a pixel art NPC sprite locally (FREE). Params: { name: "Village Elder", description: "old man with long white beard and staff" }. Optimized for MapleStory-style RPG NPCs, front view.',
  async execute(params) {
    if (!params?.name) throw new Error('Missing name');
    return generateNPC(params.name, params.description);
  },
}, { rateLimit: 3000 });

registerTool({
  name: 'maple_gen_item',
  description: 'Generate a pixel art item icon locally (FREE). Params: { name: "Mana Potion" }. 256x256 output optimized for RPG item/equipment icons.',
  async execute(params) {
    if (!params?.name) throw new Error('Missing name');
    return generateItem(params.name);
  },
}, { rateLimit: 3000 });

registerTool({
  name: 'maple_gen_animation',
  description: 'Generate animation frames locally using AnimateDiff (FREE). Params: { description: "warrior with sword", animation: "walk", frames: 8, seed: 42 }. Animations: walk, run, idle, attack, cast, jump, death, hit. Returns array of frame PNGs (base64). ~60s per animation.',
  async execute(params) {
    if (!params?.description) throw new Error('Missing description');
    return generateAnimation(params.description, params.animation || 'walk', {
      frames: params.frames,
      seed: params.seed,
      width: params.width,
      height: params.height,
    });
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_gen_animation_set',
  description: 'Generate a full animation set locally (FREE). Params: { description: "warrior with sword", animations: ["walk", "idle", "attack"] }. Generates multiple animation types for the same character. Returns all frame sets. ~60s per animation type.',
  async execute(params) {
    if (!params?.description) throw new Error('Missing description');
    return generateAnimationSet(params.description, params.animations, { seed: params.seed });
  },
}, { rateLimit: 5000 });

// ── Custom Weapons Tools ─────────────────────────────────────────────────────

registerTool({
  name: 'maple_deploy_weapons',
  description: [
    'Deploy all 8 custom weapons to the MapleStory Cosmic server.',
    'Creates WZ XML files in Character.wz/Weapon/ and registers names in String.wz/Eqp.img.xml.',
    'Safe to call multiple times — idempotent.',
    'Weapons: Crystal Fang (1H Sword/Warrior), Phoenix Staff (Staff/Magician),',
    'Wind Piercer (Bow/Bowman), Shadow Fang (Dagger/Thief),',
    'Thunder Barrel (Gun/Pirate), Earth Cleaver (Polearm/Warrior),',
    'Venom Claw (Claw/Thief), Iron Fist (Knuckle/Pirate).',
    'Server restart required for changes to take effect.',
  ].join(' '),
  async execute() {
    return deployCustomWeapons();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_weapon_status',
  description: [
    'Check status of all 8 custom weapons.',
    'Shows which WZ XML files exist and which names are registered in Eqp.img.xml.',
    'Also accepts an optional param { id } to check if a specific equip ID is a custom weapon.',
  ].join(' '),
  async execute(params) {
    if (params?.id !== undefined) {
      return { id: params.id, isCustomWeapon: isCustomWeapon(params.id) };
    }
    return { weapons: getCustomWeaponStatus(), total: CUSTOM_WEAPONS.length };
  },
}, { rateLimit: 2000 });

// ── Custom Items Tools ────────────────────────────────────────────────────────

registerTool({
  name: 'maple_deploy_items',
  description: [
    'Deploy all 8 custom consumable items to the MapleStory Cosmic server.',
    'Injects WZ XML blocks into Item.wz/Consume/0200.img.xml (buff potions) and 0203.img.xml (return scroll).',
    'Registers names in String.wz/Consume.img.xml.',
    'Items: Elixir of Rage (PAD+10/3min), Mana Crystal (MAD+10/3min),',
    'Iron Shield Scroll (PDD+15/5min), Swift Boots Potion (Speed+20/2min),',
    'Lucky Clover (ACC+EVA+15/5min), Giant\'s Meat (HP+800),',
    'Sage Tea (MP+600), Return Scroll (warp to Henesys).',
    'Safe to call multiple times — idempotent. Server restart required.',
  ].join(' '),
  async execute() {
    return deployCustomItems();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_item_status',
  description: [
    'Check deployment status of all 8 custom consumable items.',
    'Shows which items are injected in the WZ files and which names are registered.',
    'Accepts optional param { id } to check if a specific item ID is a custom item.',
  ].join(' '),
  async execute(params) {
    if (params?.id !== undefined) {
      return { id: params.id, isCustomItem: isCustomItem(params.id) };
    }
    return { items: getCustomItemStatus(), total: CUSTOM_ITEMS.length };
  },
}, { rateLimit: 2000 });

// ── Custom Drops Tools ────────────────────────────────────────────────────────

registerTool({
  name: 'maple_deploy_drops',
  description: [
    'Deploy custom drop tables for 15 mobs on the MapleStory Cosmic server.',
    'Always writes workspace/Cosmic/src/main/resources/db/data/153-custom-drops.sql',
    '(auto-loaded on fresh schema init).',
    'If MySQL is running, also executes each INSERT live (idempotent).',
    'Mobs covered: Snail, Blue Snail, Slime, Green Mushroom, Pig, Ribbon Pig,',
    'Orange Mushroom, Axe Stump, Jr. Necki, Horny Mushroom, Zombie Mushroom,',
    'Fire Boar, Curse Eye, Ligator, Stumpy.',
    'Custom items distributed: Elixir of Rage, Mana Crystal, Iron Shield Scroll,',
    'Swift Boots Potion, Lucky Clover, Giant\'s Meat, Sage Tea, Return Scroll.',
    'Rare weapon drops: Crystal Fang (Stumpy 1%), Wind Piercer (Curse Eye 0.5%),',
    'Shadow Fang (Ligator 0.5%).',
  ].join(' '),
  async execute() {
    return deployCustomDrops();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_drop_status',
  description: [
    'Check status of custom drop tables.',
    'With no params: returns a summary of all 15 mob drop tables and what items they drop.',
    'Requires MySQL to be running for live DB status.',
    'Params: { live: true } to check actual DB state vs just the definition summary.',
  ].join(' '),
  async execute(params) {
    if (params?.live) {
      return getCustomDropStatus();
    }
    return getCustomDropSummary();
  },
}, { rateLimit: 2000 });

// ── Custom Skills Tools ───────────────────────────────────────────────────────

registerTool({
  name: 'maple_rebalance_skills',
  description: [
    'Apply skill rebalances to 5 job classes on the MapleStory Cosmic server.',
    'Patches WZ XML Skill.wz files directly (single read/write per skill file).',
    'Changes: Rage (Warrior) — pdd penalty removed;',
    'Cold Beam (IL Magician) — +20 MAD all levels, longer freeze at lv16+;',
    'Arrow Bomb (Hunter) — +20 damage, +10% stun all levels;',
    'Double Stab (Thief) — +20 damage, -2 mpCon all levels;',
    'Backspin Blow (Pirate) — +30 damage, -4 mpCon all levels.',
    'Writes report to data/state/skill-rebalances.json.',
    'CAUTION: Delta-based — do not run twice without reverting first.',
    'Server restart required to see changes in-game.',
  ].join(' '),
  async execute() {
    return deployCustomSkills();
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'maple_skill_rebalance_status',
  description: [
    'Check status of skill rebalances.',
    'No params: returns a summary of all 5 planned rebalances with before/after preview at max level.',
    'Params: { verify: true } — reads live WZ data to check if changes are actually applied.',
  ].join(' '),
  async execute(params) {
    if (params?.verify) {
      return getCustomSkillStatus();
    }
    return { rebalances: getSkillRebalanceSummary(), total: SKILL_REBALANCES.length };
  },
}, { rateLimit: 3000 });

// ── Custom Quests Tools ───────────────────────────────────────────────────────

registerTool({
  name: 'maple_deploy_quests',
  description: [
    'Deploy all 5 custom quest scripts to the MapleStory Cosmic server.',
    'Writes JavaScript quest scripts to workspace/Cosmic/scripts/quest/ (IDs 99001-99005).',
    'Quests: Mushroom Menace (Scout Raven, Perion) — 30 Orange Mushroom Caps → 5000 EXP + 3x Iron Shield Scroll;',
    'Potion Ingredients (Alchemist Luna, Ellinia) — 20 Mushroom Spores + 10 Blue Snail Shells → 10x Elixir of Rage;',
    'Lost Treasure Map (Captain Flint, Lith Harbor) — 5 Jr. Necki Furs → 50000 meso + 3x Return Scroll;',
    'Arena Challenge (Arena Master Rex, Henesys) — 30 Pig Heads → 5x Lucky Clover + 3000 EXP;',
    "Blacksmith's Request (Blacksmith Taro, Henesys) — 30 Steel Ores → Crystal Fang + 5000 EXP.",
    'Idempotent — skips existing scripts. Server restart required.',
  ].join(' '),
  async execute() {
    return deployCustomQuests();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_quest_status',
  description: [
    'Check deployment status of all 5 custom quests.',
    'No params: shows which quest scripts exist on disk and quest metadata.',
    'Params: { summary: true } — returns human-readable summary of quest requirements and rewards.',
  ].join(' '),
  async execute(params) {
    if (params?.summary) {
      return { quests: getCustomQuestSummary(), total: CUSTOM_QUESTS.length };
    }
    return getCustomQuestStatus();
  },
}, { rateLimit: 2000 });

// ── Custom Events Tools ───────────────────────────────────────────────────────

registerTool({
  name: 'maple_deploy_events',
  description: [
    'Deploy all 3 custom server events to the MapleStory Cosmic server.',
    'Writes event scripts to workspace/Cosmic/scripts/event/.',
    'Events: CosmicExpWeekend (EXP 10x→20x when active);',
    'CosmicDropFest (Drop 5x→10x when active);',
    'CosmicGoldRush (Meso 5x→10x when active).',
    'Each event script has start() and stop() functions that broadcast world announcements.',
    'Activate in-game via GM commands or em.scheduleAtTimestamp().',
    'Idempotent — skips existing scripts. Server restart required.',
  ].join(' '),
  async execute() {
    return deployCustomEvents();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_event_status',
  description: [
    'Check deployment status of all 3 custom events.',
    'No params: shows which event scripts exist and their rate boost details.',
    'Params: { summary: true } — compact summary of all events.',
  ].join(' '),
  async execute(params) {
    if (params?.summary) {
      return { events: getCustomEventSummary(), total: CUSTOM_EVENTS.length };
    }
    return getCustomEventStatus();
  },
}, { rateLimit: 2000 });

// ── Bot Management Tools ─────────────────────────────────────────────────────

registerTool({
  name: 'maple_spawn_bots',
  description: [
    'Spawn AI-managed bot players on the MapleStory server.',
    'Bots connect as real clients, roam maps, chat, and respond to players.',
    'Params: { count: 3 } — number of bots to spawn (max 8). Default: 3.',
    'Each bot gets a unique personality (warrior, archer, mage, thief) with idle chat and greeting behavior.',
  ].join(' '),
  async execute(params) {
    const count = Math.min(params?.count ?? 3, 200);
    return botManager.spawnBots(count);
  },
}, { rateLimit: 30000 });

registerTool({
  name: 'maple_list_bots',
  description: 'List all active AI bots on the MapleStory server with their status, personality type, map, and nearby player count.',
  async execute() {
    return { bots: botManager.listBots() };
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_bot_chat',
  description: [
    'Make a specific bot send a chat message in-game.',
    'Params: { name: "StarBlade", message: "Hello everyone!" }',
  ].join(' '),
  async execute(params) {
    if (!params?.name || !params?.message) return { error: 'name and message required' };
    return botManager.botChat(params.name, params.message);
  },
}, { rateLimit: 2000 });

registerTool({
  name: 'maple_bot_broadcast',
  description: 'Make ALL online bots send the same chat message. Params: { message: "Server event starting!" }',
  async execute(params) {
    if (!params?.message) return { error: 'message required' };
    return botManager.broadcastChat(params.message);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_dismiss_bots',
  description: [
    'Dismiss (disconnect) bots from the server.',
    'Params: { name: "StarBlade" } — dismiss one bot by name.',
    'Params: { all: true } — dismiss all bots.',
  ].join(' '),
  async execute(params) {
    if (params?.all) return botManager.dismissAll();
    if (params?.name) return botManager.dismissBot(params.name);
    return { error: 'name or all:true required' };
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_configure_bot',
  description: [
    'Configure a bot\'s AI behavior.',
    'Params: { name: "StarBlade", combat: true, loot: true, autoPotion: true, emote: true }.',
    'Set combat=false to make bot passive. Set loot=false to stop auto-looting.',
  ].join(' '),
  async execute(params) {
    if (!params?.name) return { error: 'name required' };
    return botManager.configureBot(params.name, params);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_train_bot',
  description: 'Move a bot to its level-appropriate training map. Params: { name: "StarBlade" }.',
  async execute(params) {
    if (!params?.name) return { error: 'name required' };
    return botManager.trainBot(params.name);
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'maple_buff_bot',
  description: 'Make a bot cast its class buff skills. Params: { name: "StarBlade" }.',
  async execute(params) {
    if (!params?.name) return { error: 'name required' };
    return botManager.buffBot(params.name);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_create_guild',
  description: 'Make a bot create a guild. Params: { name: "StarBlade", guildName: "CosmicGuild" }. Requires 50K meso + party of 5.',
  async execute(params) {
    if (!params?.name || !params?.guildName) return { error: 'name and guildName required' };
    return botManager.createGuild(params.name, params.guildName);
  },
}, { rateLimit: 30000 });

registerTool({
  name: 'maple_buddy_all',
  description: 'Make all online bots add each other as buddies.',
  async execute() {
    return botManager.addAllBuddies();
  },
}, { rateLimit: 30000 });

registerTool({
  name: 'maple_trade_bots',
  description: 'Initiate a trade between two bots on the same map. Params: { from: "StarBlade", to: "MoonArrow" }.',
  async execute(params) {
    if (!params?.from || !params?.to) return { error: 'from and to required' };
    return botManager.tradeBots(params.from, params.to);
  },
}, { rateLimit: 30000 });

registerTool({
  name: 'maple_megaphone',
  description: 'Send a server-wide megaphone message from a bot (needs cash megaphone item). Params: { name: "StarBlade", message: "Hello server!" }.',
  async execute(params) {
    if (!params?.name || !params?.message) return { error: 'name and message required' };
    return botManager.megaphoneBot(params.name, params.message);
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'maple_whisper_bot',
  description: 'Send a private whisper message from a bot to a player. Params: { name: "StarBlade", target: "PlayerName", message: "Hey!" }.',
  async execute(params) {
    if (!params?.name || !params?.target || !params?.message) return { error: 'name, target, and message required' };
    return botManager.whisperBot(params.name, params.target, params.message);
  },
}, { rateLimit: 2000 });

registerTool({
  name: 'maple_fame_all',
  description: 'Make all online bots fame each other (+1 fame). Respects 24-hour cooldown per pair.',
  async execute() {
    return botManager.fameAll();
  },
}, { rateLimit: 60000 });

registerTool({
  name: 'maple_loot_filter',
  description: 'Set a bot\'s loot filter mode. Params: { name: "StarBlade", mode: "valuable" }. Modes: "all" (pick up everything), "valuable" (equips, scrolls, pots, meso only), "none" (pick up nothing).',
  async execute(params) {
    if (!params?.name || !params?.mode) return { error: 'name and mode required' };
    return botManager.setLootFilter(params.name, params.mode);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_restore_bots',
  description: 'Restore bots from saved state after a restart. Respawns bots with their previous config, stats, and progress.',
  async execute() {
    return botManager.restoreBots();
  },
}, { rateLimit: 30000 });

// ── Custom Class Tools ────────────────────────────────────────────────────────

registerTool({
  name: 'maple_deploy_sage_class',
  description: [
    'Deploy the complete custom Sage class to the MapleStory Cosmic server.',
    'Sage (600/610/611/612) is a 4-advancement elemental magic class with 32 skills and a',
    'full skill tree (SAGE_SKILL_TREE) with prerequisites across all job tiers.',
    'Generates and writes all missing pieces (idempotent):',
    '  SKILLS: wz/Skill.wz/600.img.xml, 610.img.xml, 611.img.xml, 612.img.xml (32 skills)',
    '  STRINGS: wz/String.wz/Skill.img.xml entries (skill names + descriptions)',
    '  NPCS: scripts/npc/9990001-9990004.js (4 job advancement NPCs)',
    '  WEAPONS: 3 Sage-exclusive weapons (reqJob=64): Runic Orb (lv20 wand, MAD55),',
    '           Arcane Scepter (lv35 wand, MAD78), Prism Staff (lv70 staff, MAD115)',
    'Skill tree has prerequisites, SP recommendations, and effect formulas.',
    'Server restart required after deployment.',
  ].join(' '),
  async execute() {
    return deploySageClass();
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'maple_sage_status',
  description: [
    'Check deployment status of the custom Sage class.',
    'Reports: Skill WZ files (4/4), String WZ entries, NPC advancement scripts (4/4),',
    'Sage-exclusive weapons (3/3), and skill tree node count.',
    'No params required.',
  ].join(' '),
  async execute() {
    return getSageDeployStatus();
  },
}, { rateLimit: 3000 });

registerTool({
  name: 'maple_verify_sage',
  description: 'Run comprehensive integration verification of the Sage class. Checks Java source, WZ files, NPC scripts, maps, quests, weapons, portal connectivity, and string registrations. Returns pass/fail report with detailed check results.',
  async execute() {
    return verifySageIntegration();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_create_linked_map',
  description: [
    'Create a new map WITH automatic bidirectional portal connection to a parent map.',
    'Params: mapId (string, 9-digit), name, streetName, returnMap (int), bgm (string),',
    'parentMapId (string), entryPortalName (default "in00"), exitPortalName,',
    'exitPortalPos {x,y}, entryPos {x,y}, footholds (array), portals (array), notes (string).',
    'Automatically adds return portal in new map and exit portal in parent map.',
    'Returns createResult + parentPortal link info. Example: mapId="101050003", parentMapId="101050000"',
  ].join(' '),
  async execute(params) {
    const { mapId, ...opts } = params;
    if (!mapId) return { success: false, error: 'mapId is required' };
    return createLinkedMap(mapId, opts);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_list_custom_maps',
  description: [
    'List all agent-created custom maps in known ID ranges (Sage Hall 101050xxx, Sage Spire 990100xxx, etc.).',
    'Returns map IDs, names, size, mob/NPC spawn counts, portal presence.',
    'No params required.',
  ].join(' '),
  async execute() {
    return listCustomMaps();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_add_portal',
  description: [
    'Add a portal to an existing map XML file.',
    'Params: mapId (string), portal { name, type (0=spawn/2=regular), x, y, targetMap, targetPortal }.',
    'Example: add exit portal in Ellinia (101000000) pointing to Sage Hall (101050000).',
    'Restart server to apply.',
  ].join(' '),
  async execute(params) {
    const { mapId, portal } = params;
    if (!mapId || !portal) return { success: false, error: 'mapId and portal are required' };
    return addPortalToMap(mapId, portal);
  },
}, { rateLimit: 3000 });

registerTool({
  name: 'maple_validate_map',
  description: [
    'Validate a map\'s portal setup: checks spawn points exist, target maps exist, portals are linked.',
    'Params: mapId (string). Returns { valid, issues, portals, hasSpawnPoint }.',
  ].join(' '),
  async execute(params) {
    if (!params.mapId) return { success: false, error: 'mapId is required' };
    return validateMapPortals(params.mapId);
  },
}, { rateLimit: 3000 });

// ── Frozen Caverns Dungeon Zone ───────────────────────────────────────────────

registerTool({
  name: 'maple_deploy_frozen_caverns',
  description: [
    'Deploy the Frozen Caverns ice dungeon zone to Cosmic server.',
    'Creates 3 maps (211090000 entrance, 211090001 frozen halls, 211090002 boss room),',
    'adds mobs (Cold Eye/Leatty for entrance, Jr. Yeti/Hector for halls, White Fang for boss),',
    'wires a portal from El Nath Town (211000000), and places the Frost Warden Kira NPC.',
    'Safe to call multiple times — skips already-deployed components.',
    'Requires server restart to apply. No params needed.',
  ].join(' '),
  async execute() {
    return deployFrozenCaverns();
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'maple_frozen_caverns_status',
  description: [
    'Get deployment status of the Frozen Caverns dungeon zone.',
    'Returns which maps exist in WZ, portal wired state, NPC placed, and deploy timestamps.',
    'No params needed.',
  ].join(' '),
  async execute() {
    return getFrozenCavernsMapStatus();
  },
}, { rateLimit: 3000 });

// ── Shadow Crypts Dungeon Tools ─────────────────────────────────────────────

registerTool({
  name: 'maple_deploy_shadow_crypts',
  description: [
    'Deploy the Shadow Crypts dark dungeon zone to Cosmic server.',
    'Creates 4 maps (261090000 entrance, 261090001 hall of whispers, 261090002 abyssal corridor, 261090003 boss room),',
    'adds mobs (Ghost Pirate/Lycanthrope, Dual Ghost Pirate/Death Teddy, Phantom Watch/Bain, Grim Phantom Watch boss),',
    'wires a portal from Magatia (261000000), and places the Crypt Warden Moros NPC.',
    'Level 80-100 dungeon zone. Safe to call multiple times — skips already-deployed components.',
    'Requires server restart to apply. No params needed.',
  ].join(' '),
  async execute() {
    return deployShadowCrypts();
  },
}, { rateLimit: 30000 });

registerTool({
  name: 'maple_shadow_crypts_status',
  description: [
    'Get deployment status of the Shadow Crypts dungeon zone.',
    'Returns which maps exist in WZ, portal wired state, NPC placed, and deploy timestamps.',
    'No params needed.',
  ].join(' '),
  async execute() {
    return getShadowCryptsMapStatus();
  },
}, { rateLimit: 3000 });

registerTool({
  name: 'maple_validate_shadow_crypts',
  description: [
    'Validate all Shadow Crypts portals, footholds, and connections.',
    'Checks: all 4 map XML files exist, spawn points present, portal bidirectionality',
    '(Magatia↔Entrance↔Hall↔Corridor↔Boss), mob positions on footholds, portal positions near footholds.',
    'Returns structured pass/fail result with issues and warnings. No params needed.',
  ].join(' '),
  async execute() {
    return validateShadowCrypts();
  },
}, { rateLimit: 5000 });

// ── Necromancer Class Tools ──────────────────────────────────────────────────

registerTool({
  name: 'maple_deploy_necromancer',
  description: [
    'Deploy the full Necromancer custom class to Cosmic server.',
    'Writes Skill WZ XML files (700/710/711/712.img.xml), inserts skill strings into',
    'Skill.img.xml, and writes 4 NPC advancement scripts (IDs 9990010–9990013) to scripts/npc/.',
    'Safe to call multiple times — skips already-deployed components.',
    'Job IDs: 700 (Necromancer) → 710 (Dark Acolyte) → 711 (Soul Reaper) → 712 (Lich King).',
    '22 skills across 4 tiers. INT/LUK-based dark magic + undead summoning.',
    'Requires server restart to apply. No params needed.',
  ].join(' '),
  async execute() {
    return deployNecromancer();
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'maple_necromancer_status',
  description: [
    'Get deployment status of the Necromancer class.',
    'Returns skill WZ presence, skill strings, NPC scripts, and overall readiness.',
    'Shows all 22 skill definitions and 4 job tier info.',
    'No params needed.',
  ].join(' '),
  async execute() {
    return getNecroDeployStatus();
  },
}, { rateLimit: 3000 });

registerTool({
  name: 'maple_deploy_necro_training',
  description: [
    'Deploy the Necromancer training area: places 5 advancement NPCs (9990010–9990014) on',
    'the Shadow Crypts hub map (990200000), adds NPC String.wz name entries, and verifies',
    'the Burial Vestibule training map (990200100) is connected with mobs and portals.',
    'Safe to call multiple times — skips already-placed NPCs.',
    'Maps: hub=990200000 (town, town=1), training=990200100 (Burial Vestibule, lv30-50).',
    'Requires server restart to apply. No params needed.',
  ].join(' '),
  async execute() {
    return deployNecroTraining();
  },
}, { rateLimit: 10000 });

// ── Necromancer Sprite Tools ────────────────────────────────────────────────

registerTool({
  name: 'maple_gen_necro_sprites',
  description: [
    'Generate skill effect sprites and icons for the Necromancer class.',
    'Params: { tier: 700 } for a single tier, or { tier: "all" } for all 4 tiers.',
    'Tiers: 700 (Necromancer), 710 (Dark Acolyte), 711 (Soul Reaper), 712 (Lich King).',
    'Generates programmatic dark-themed effect animations (4-8 frames per active skill)',
    'and 32x32 skill icons. Also injects effect/icon canvas XML into Skill WZ files.',
    'Output: workspace/maple-sprites/necromancer/<tier>/<skillId>/.',
  ].join(' '),
  async execute(params) {
    const tier = params?.tier;
    let spriteResult;
    if (tier === 'all' || !tier) {
      spriteResult = await generateAllSprites();
    } else {
      spriteResult = await generateTierSprites(Number(tier));
    }
    // Also inject WZ XML
    const xmlResult = tier === 'all' || !tier
      ? injectAllEffectXml()
      : [injectEffectXml(Number(tier))];
    return { success: true, sprites: spriteResult, wzXml: xmlResult };
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'maple_necro_sprite_status',
  description: 'Get status of Necromancer skill sprites: which icons/effects exist on disk, which WZ XMLs have effect entries. No params needed.',
  async execute() {
    return { success: true, ...getSpriteStatus() };
  },
}, { rateLimit: 3000 });

registerTool({
  name: 'maple_pack_necro_wz',
  description: [
    'Pack Necromancer skill icons (all 22 skills, jobs 700-712) into client WZ binary format',
    'using harepacker-mcp. Reads icons from workspace/maple-sprites/necromancer/icons_b64.json,',
    'injects icon/iconMouseOver/iconDisabled PNG canvases into v83-img-data Skill/*.img files,',
    'and saves each img. Run this after generating sprites with maple_gen_necro_sprites.',
    'No params required.',
  ].join(' '),
  async execute() {
    const { callTool } = await import('../tool-bridge.js').catch(() => ({}));
    if (!callTool) {
      return { success: false, error: 'tool-bridge not available — run manually via scripts/pack-necro-wz.cjs' };
    }
    return packSpritesToClientWz(callTool);
  },
}, { rateLimit: 60000 });

// ── Custom NPC Sprites ────────────────────────────────────────────────────────

registerTool({
  name: 'maple_gen_custom_npc_sprites',
  description: [
    'Generate pixel-art stand-animation sprites (2 frames, 80×100px) + portrait icons (32×32px)',
    'for all 11 custom NPCs: 9999001-9999010 and 9999030 (Blacksmith Taro, Alchemist Luna,',
    'Scout Raven, Chef Momo, Old Man Kazuki, Arena Master Rex, Gem Trader Safi, Captain Flint,',
    'Nurse Joy, Treasure Hunter Kai, Sage Instructor Elara). Saves PNGs to',
    'workspace/maple-sprites/custom-npcs/{npcId}/ and writes Npc.wz XML stubs to',
    'workspace/Cosmic/wz/Npc.wz/{npcId}.img.xml. Uses sharp for programmatic SVG→PNG rendering.',
    'No params required. Run maple_pack_custom_npc_wz afterwards to push to v83 client binary.',
  ].join(' '),
  async execute() {
    return generateAllNpcSprites();
  },
}, { rateLimit: 30000 });

registerTool({
  name: 'maple_custom_npc_sprite_status',
  description: [
    'Check generation status for all 11 custom NPC sprites.',
    'Returns per-NPC status: whether stand_0.png, stand_1.png, and Npc.wz XML exist.',
    'Also lists the NPC roster (IDs 9999001-9999010, 9999030) with names and roles.',
    'No params required.',
  ].join(' '),
  async execute() {
    const status = getNpcSpriteStatus();
    const done   = status.filter(s => s.hasFrames && s.hasXml).length;
    return { npcs: status, summary: `${done}/${status.length} NPCs have sprites + XML` };
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_pack_custom_npc_wz',
  description: [
    'Pack all 11 custom NPC stand-animation PNGs into the v83 client Npc.wz binary via harepacker-mcp.',
    'Injects stand/0/image and stand/1/image canvas entries for each NPC ID (9999001-9999010, 9999030).',
    'Requires: (1) sprites generated via maple_gen_custom_npc_sprites, (2) harepacker-mcp running,',
    '(3) v83 client at workspace/v83-client/83/Npc.wz. This step makes sprites visible in-game.',
    'No params required.',
  ].join(' '),
  async execute() {
    return packAllNpcSpritesToWz();
  },
}, { rateLimit: 60000 });

// ── LoRA Sprite Generator ─────────────────────────────────────────────────────

registerTool({
  name: 'maple_generate_sprite',
  description: [
    'Generate a MapleStory sprite using the trained LoRA model (AnythingV5 + MapleStory LoRA).',
    'Creates pixel-art sprites for NPCs, mobs, items, skills, or equipment.',
    'Params: type (npc|mob|item|skill|equipment), id (asset ID like 9999050),',
    'description (visual description e.g. "sheriff with star badge and cowboy hat"),',
    'poses (optional, comma-separated, default: stand_0,stand_1),',
    'width (optional, default: 80), height (optional, default: 100), seed (optional).',
    'Outputs PNGs to workspace/Cosmic/maple-sprites/custom-{type}s/{id}/.',
    'For NPCs, also generates Npc.wz XML stub automatically.',
  ].join(' '),
  params: {
    type:        { type: 'string', required: true,  description: 'Asset type: npc, mob, item, skill, equipment' },
    id:          { type: 'string', required: true,  description: 'Asset ID (e.g. 9999050, 2100100)' },
    description: { type: 'string', required: true,  description: 'Visual description of the sprite to generate' },
    poses:       { type: 'string', required: false, description: 'Comma-separated pose names (default: stand_0,stand_1)' },
    width:       { type: 'number', required: false, description: 'Sprite width in pixels (default: 80 for NPC, 36 for item)' },
    height:      { type: 'number', required: false, description: 'Sprite height in pixels (default: 100 for NPC, 36 for item)' },
    seed:        { type: 'number', required: false, description: 'Random seed for reproducibility' },
  },
  async execute(params) {
    const poses = params.poses ? params.poses.split(',').map(p => p.trim()) : undefined;
    const result = await loraGenerateSprite({
      type: params.type,
      id: params.id,
      description: params.description,
      poses,
      width: params.width,
      height: params.height,
      seed: params.seed,
    });

    // Auto-generate WZ XML for NPCs
    if (result.success && params.type === 'npc') {
      const xmlPath = loraWriteWzXml({
        type: params.type,
        id: params.id,
        poses: poses || ['stand_0', 'stand_1'],
        width: params.width || 80,
        height: params.height || 100,
      });
      result.wzXml = xmlPath;
    }

    return result;
  },
}, { rateLimit: 10000 });

// ── LoRA Full Pipeline (generate → crop → bg remove → ESRGAN → anim frames) ──

registerTool({
  name: 'maple_lora_pipeline',
  description: [
    'Full LoRA sprite pipeline for a single NPC: AnythingV5 + MapleStory LoRA (256x256)',
    '→ crop to character bounds → flood-fill bg removal (transparent)',
    '→ ESRGAN 4x upscale + LANCZOS downscale (quality enhance at same size)',
    '→ animation frames (stand_0-2 idle bob + move_0-3 walk lean).',
    'Output: maple-lora/game_assets/npcs/{npcId}_pipeline/ with 7+ PNGs.',
    'After generating, run maple_import_sprites_wz to push into Npc.wz binary.',
    'Requires: CUDA GPU, AnythingV5 model, MapleStory LoRA weights, Real-ESRGAN.',
  ].join(' '),
  params: {
    npcId:       { type: 'string', required: true,  description: 'NPC ID (e.g. 9999050)' },
    description: { type: 'string', required: true,  description: 'Visual description for LoRA prompt' },
    seed:        { type: 'number', required: false, description: 'Random seed' },
  },
  async execute(params) {
    return runLoraPipeline(params.npcId, params.description, params.seed);
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'maple_import_sprites_wz',
  description: [
    'Import pipeline-generated sprites into WZ binary, pack Npc.wz, and deploy to patcher.',
    'Full flow: read sprite PNGs → set_canvas_bitmap via WzImg-MCP (Format1/BGRA4444, isPreBB)',
    '→ save all .img files → pack to Npc.wz → copy to v83-client-patched/ → regen patcher manifest.',
    'Sprites mapped: stand_0-2 → stand/0-2, move_0-3 → move/0-3, fallback stand_0 for eye/say frames.',
    'Pass npcIds="*" to import ALL pipeline NPCs, or a specific ID like "9999050".',
    'Requires: WzImg-MCP server binary, npc-rebuild/ with .img files, pipeline sprites generated.',
  ].join(' '),
  params: {
    npcIds: { type: 'string', required: true, description: 'NPC ID(s) to import. Use "*" for all, or comma-separated IDs.' },
  },
  async execute(params) {
    const ids = params.npcIds === '*' || params.npcIds === 'all'
      ? '*'
      : params.npcIds.split(',').map(s => s.trim());
    return importSpritesToWz(ids);
  },
}, { rateLimit: 30000 });

// ── Custom Mob Sprites ────────────────────────────────────────────────────────

registerTool({
  name: 'maple_gen_mob_sprites',
  description: [
    'Generate pixel-art animation sprites for all custom dungeon mobs:',
    '9901001 (Crypt Shade, lv88) — wispy blue-grey ghost/wraith, 163×143px,',
    '  states: stand(2 frames), move(4), hit1(2), die1(3), attack1(3).',
    '9901002 (The Lich, lv105) — tall robed undead boss, 200×310px,',
    '  states: stand(3 frames), move(4), hit1(2), die1(4), attack1(3), attack2(4).',
    'Saves PNGs to workspace/maple-sprites/mobs/{mobId}/{state}_{frame}.png.',
    'Uses SVG→sharp programmatic rendering. No params required.',
    'Run maple_pack_mob_wz afterwards to push sprites to v83 client Mob.wz.',
  ].join(' '),
  async execute() {
    return generateAllMobSprites();
  },
}, { rateLimit: 30000 });

registerTool({
  name: 'maple_mob_sprite_status',
  description: [
    'Check generation status for all custom dungeon mob sprites.',
    'Returns per-mob status: which animation states/frames exist as PNGs.',
    'Mobs: 9901001 (Crypt Shade) and 9901002 (The Lich).',
    'No params required.',
  ].join(' '),
  async execute() {
    const status = getMobSpriteStatus();
    const allDone = status.filter(s => s.allDone).length;
    return {
      mobs: status,
      summary: `${allDone}/${status.length} mobs have all sprites generated`,
    };
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_pack_mob_wz',
  description: [
    'Pack all custom dungeon mob sprite PNGs into the v83 client Mob.wz binary via harepacker-mcp.',
    'Injects canvas bitmap entries for all animation frames of:',
    '  9901001 (Crypt Shade): stand/0-1, move/0-3, hit1/0-1, die1/0-2, attack1/0-2',
    '  9901002 (The Lich): stand/0-2, move/0-3, hit1/0-1, die1/0-3, attack1/0-2, attack2/0-3',
    'Requires: (1) sprites generated via maple_gen_mob_sprites, (2) harepacker-mcp running.',
    'No params required. Client restart required to see changes in-game.',
  ].join(' '),
  async execute() {
    return packAllMobSpritesToWz();
  },
}, { rateLimit: 60000 });

// ── WZ Asset Validator ────────────────────────────────────────────────────────

registerTool({
  name: 'maple_validate_wz',
  description: [
    'Validate ALL custom WZ client assets — checks that every custom NPC, mob, skill,',
    'and class portrait has the required sprites and WZ XML stubs.',
    'Checks: 22 custom NPCs (sprites + Npc.wz XML + String.wz name),',
    '  2 custom mobs (all animation frames + Mob.wz XML + String.wz name),',
    '  8 custom job Skill.wz XMLs (Sage 600-612, Necromancer 700-712),',
    '  2 class selection portrait sets (Sage + Necromancer portrait/badge PNGs),',
    '  skill effect sprite directories for both job lines.',
    'Returns: ok (bool), summary string, per-category pass/fail counts, failure list.',
    'No params required. Use this to verify the full asset pipeline before client testing.',
  ].join(' '),
  async execute() {
    return validateAllWzAssets();
  },
}, { rateLimit: 10000 });

// ── Custom Item Icons ─────────────────────────────────────────────────────────

registerTool({
  name: 'maple_gen_item_icons',
  description: [
    'Generate 32×32 pixel-art inventory icons for all 8 custom weapons and 8 custom items.',
    'Weapons: Crystal Fang (1302134), Phoenix Staff (1382081), Wind Piercer (1452086),',
    'Shadow Fang (1332100), Thunder Barrel (1492049), Earth Cleaver (1442104),',
    'Venom Claw (1472101), Iron Fist (1482047).',
    'Items: Elixir of Rage, Mana Crystal, Iron Shield Scroll, Swift Boots Potion,',
    'Lucky Clover, Giant\'s Meat, Sage Tea (2002031-2002037), Return Scroll (2030021).',
    'Saves icon.png + iconRaw.png to workspace/maple-sprites/item-icons/{id}/ and injects',
    'canvas nodes into wz/Character.wz/Weapon/*.img.xml and wz/Item.wz/Consume/*.img.xml.',
    'No params required. Run maple_pack_item_icons_wz afterwards to push to v83 client.',
  ].join(' '),
  async execute() {
    return generateAllItemIcons();
  },
}, { rateLimit: 30000 });

registerTool({
  name: 'maple_item_icon_status',
  description: [
    'Check generation status for all 16 custom item icons (8 weapons + 8 items).',
    'Returns per-item status: whether icon.png exists in workspace/maple-sprites/item-icons/.',
    'No params required.',
  ].join(' '),
  async execute() {
    return getItemIconStatus();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_pack_item_icons_wz',
  description: [
    'Pack all generated weapon and item icons into v83 client Character.wz + Item.wz via harepacker-mcp.',
    'Injects icon and iconRaw canvas entries for each item at:',
    '  Weapon/{fileId}.img/info/icon|iconRaw (weapons)',
    '  Consume/0{file}.img/{id}/info/icon|iconRaw (consumables)',
    'Requires: (1) icons generated via maple_gen_item_icons, (2) harepacker-mcp running,',
    '(3) v83 client at workspace/v83-client/83/. No params required.',
  ].join(' '),
  async execute() {
    return packAllItemIconsToWz();
  },
}, { rateLimit: 60000 });

registerTool({
  name: 'maple_gen_equip_sprites',
  description: [
    'Generate icon sprites for 4 custom equipment items: 2 caps (01003074 Arcane Sage Hat,',
    '01003075 Necromancer Cowl) and 2 medals (01142153 Adventurer Medal, 01142154 Conqueror Medal).',
    'Produces icon.png + iconRaw.png per item in workspace/maple-sprites/equipment/.',
    'No params required.',
  ].join(' '),
  async execute() {
    return generateAllEquipmentSprites();
  },
}, { rateLimit: 30000 });

registerTool({
  name: 'maple_equip_sprite_status',
  description: 'Check generation status for custom equipment sprites (caps + accessories/medals).',
  async execute() {
    return equipmentSpriteStatus();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_gen_sage_sprites',
  description: [
    'Generate skill effect sprites and 32x32 icons for all 32 Sage class skills (tiers 600/610/611/612).',
    'Produces icon.png + effect_N.png per skill using programmatic SVG→sharp generation.',
    'Saves icons_b64.json to workspace/maple-sprites/sage/ for WZ packing.',
    'Also injects effect/icon canvas entries into 600/610/611/612.img.xml WZ files.',
    'No params required. Run maple_pack_sage_wz afterwards to push icons to v83 client binary.',
  ].join(' '),
  async execute() {
    const genResult = await generateAllSageSprites();
    const xmlResults = injectAllSageEffectXml();
    return { ...genResult, xmlInjection: xmlResults };
  },
}, { rateLimit: 60000 });

registerTool({
  name: 'maple_sage_sprite_status',
  description: [
    'Check status of Sage class skill sprites: which icons exist on disk,',
    'which effect PNGs are generated, and which WZ XML files have icon/effect canvas entries.',
    'No params required.',
  ].join(' '),
  async execute() {
    return getSagespriteStatus();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_pack_sage_wz',
  description: [
    'Pack generated Sage skill icons into v83 client WZ binary format via harepacker-mcp.',
    'Injects icon/iconMouseOver/iconDisabled canvas nodes for all 32 skills into',
    '600.img, 610.img, 611.img, 612.img in workspace/v83-img-data/skill/.',
    'Requires: (1) maple_gen_sage_sprites run first, (2) harepacker-mcp running.',
    'No params required.',
  ].join(' '),
  async execute({ callTool }) {
    return packSageSpritesToClientWz(callTool);
  },
}, { rateLimit: 120000 });

registerTool({
  name: 'maple_gen_class_portraits',
  description: [
    'Generate class portrait sprites (80×140px) and badge icons (32×32px) for Sage and Necromancer job classes.',
    'Produces portrait.png (full character with class-themed gear, aura, weapon) and badge.png (class emblem icon)',
    'for each class. Saved to workspace/maple-sprites/class-selection/sage/ and /necromancer/.',
    'No params required. Used as class intro/selection visuals.',
  ].join(' '),
  async execute() {
    return generateClassPortraits();
  },
}, { rateLimit: 30000 });

registerTool({
  name: 'maple_pack_npc_wz',
  description: [
    'Pack all 22 custom NPC stand sprites (2 frames each) into v83 client Npc.wz binary format via WzImgMCP.exe.',
    'Creates {npcId}.img with stand/0 and stand/1 canvas nodes in workspace/v83-img-data/npc/.',
    'Covers all custom NPCs: Sage line (9999xxx), Necromancer line (9990xxx), dungeon wardens (9999020-021),',
    'and Sage Spire NPCs (9999032-035). Requires maple_gen_custom_npc_sprites run first.',
    'No params required. Run after generating sprites to push NPC visuals to the game client.',
  ].join(' '),
  async execute() {
    return packAllNpcSpritesToClientWz();
  },
}, { rateLimit: 300000 });

registerTool({
  name: 'maple_class_sprite_status',
  description: 'Check status of class portrait sprites and NPC sprite generation. No params required.',
  async execute() {
    return getClassSpriteStatus();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_validate_necromancer',
  description: [
    'Validate all Necromancer class components in-game readiness.',
    'Runs 13 checks: Skill WZ XML (700–712.img.xml), client WZ binary icon injection',
    '(v83-img-data file sizes), skill string entries in Skill.img.xml (all 22 skills),',
    'NPC scripts (9990010–9990014), NPC placement on hub map 990200000,',
    'NPC String.wz name/func entries, training map 990200100 mob spawns + portal back.',
    'Returns verdict: READY | PARTIAL | NOT_READY with per-check PASS/FAIL and next steps.',
    'No params required. Run after deploying to confirm everything is in-game ready.',
  ].join(' '),
  async execute() {
    return validateNecromancerClass();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_health_check',
  description: [
    'Run a comprehensive health check on all MapleStory Cosmic server content.',
    'Verifies: server processes (MySQL + game), custom NPC scripts (11 tracked),',
    'custom quest scripts (10 tracked), Sage Hall maps (101050000-101050002),',
    'Sage class WZ skill files (4/4), drop tables, and recent error logs.',
    'Returns a summary with issue list + detailed per-check results.',
    'No params required.',
  ].join(' '),
  async execute() {
    return runHealthCheck();
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'maple_bot_integration',
  description: [
    'Analyse gaps between deployed custom content (Sage class, Sage Hall maps, quests) and current bot capabilities.',
    'Returns a full integration report with: gap list by severity, improvement proposals with effort estimates,',
    'current bot state summary, and structured Sage class config (job path, training spots, quest handlers)',
    'ready to be patched into bot-brain.js. Use this to plan the next round of bot improvements.',
  ].join(' '),
  async execute() {
    return getBotIntegrationReport();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_bot_integration_sage_config',
  description: [
    'Return the Sage class configuration for bots: job advancement path (Sage→Elementalist→Arcanum→Archsage),',
    'training spot recommendations for Sage Hall maps, and quest chain data for quests 99210/99211/99212.',
    'Useful when patching bot-brain.js to support Sage bots.',
  ].join(' '),
  async execute() {
    return {
      jobPath: getSageJobPath(),
      trainingSpots: getSageTrainingSpots(),
      quests: getSageQuestHandlers(),
    };
  },
}, { rateLimit: 1000 });

// ── Blueprint Crafting System Tools ──────────────────────────────────────────

registerTool({
  name: 'maple_blueprint_status',
  description: [
    'Return the current deployment status of the Blueprint Weapon Crafting System.',
    'Shows per-job counts of weapons deployed, blueprint items deployed, and NPC scripts created.',
    '7 job tracks × 10 tiers = 70 weapons + 70 blueprints + 7 blacksmith NPCs.',
    'No params required.',
  ].join(' '),
  async execute() {
    return getBlueprintStatus();
  },
}, { rateLimit: 3000 });

registerTool({
  name: 'maple_deploy_blueprints',
  description: [
    'Deploy the full Blueprint Weapon Crafting System to the server.',
    'Writes 70 weapon WZ XML files, 70 blueprint Etc WZ XML files,',
    'String.wz entries for all weapons/blueprints/NPCs, 7 blacksmith NPC scripts,',
    'and (if deploy_drops=true) inserts 70 drop table entries via addDrop.',
    'Params: deploy_drops (boolean, default true), force_regen (boolean, default false).',
    'force_regen=true overwrites existing NPC scripts with the latest template (adds material requirements).',
    'Safe to re-run — skips already-present string entries.',
  ].join(' '),
  params: {
    deploy_drops: { type: 'boolean', description: 'Whether to insert drop table entries (default: true)' },
    force_regen:  { type: 'boolean', description: 'Overwrite existing NPC scripts with latest template (default: false)' },
  },
  async execute({ deploy_drops = true, force_regen = false } = {}) {
    const addDropFn = deploy_drops ? addDrop : null;
    return deployBlueprintSystem(addDropFn, { force_regen });
  },
}, { rateLimit: 10000 });

registerTool({
  name: 'maple_generate_blacksmith_script',
  description: [
    'Generate a Blacksmith NPC crafting script for a CUSTOM set of weapons (not one of the 7 built-in jobs).',
    'Uses the same reusable template as the standard blueprint system.',
    'Params: { npcId, npcName, npcDesc, label, weapons: [{ bpId, weaponId, name, tier, level, atk, meso, material: { itemId, name, qty } }] }.',
    'Returns { script, path } — writes the script to scripts/npc/<npcId>.js.',
    'Use maple_place_npc to place the NPC on a map after generation.',
  ].join(' '),
  async execute(params) {
    if (!params?.npcId || !params?.npcName || !params?.weapons) {
      throw new Error('Missing npcId, npcName, or weapons');
    }
    const script = generateBlacksmithNpcScript({
      npcId:   params.npcId,
      npcName: params.npcName,
      npcDesc: params.npcDesc || '',
      label:   params.label || 'Adventurer',
      weapons: params.weapons,
    });
    const result = writeNpcScript(params.npcId, script);
    return { success: true, npcId: params.npcId, scriptLength: script.length, writeResult: result };
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'maple_blueprint_system_info',
  description: [
    'Return the full design data for the Blueprint Weapon Crafting System:',
    'all 10 tier definitions (level, attack stats per job, meso costs)',
    'and all 7 job definitions (weapon IDs, blueprint IDs, NPC IDs, weapon names, drop mobs/rates).',
    'Useful for reviewing the system design or planning expansions.',
  ].join(' '),
  async execute() {
    return getBlueprintSystem();
  },
}, { rateLimit: 1000 });

// ── WZ Compilation & Upload ─────────────────────────────────────────────────

registerTool({
  name: 'maple_compile_wz',
  description: `Full WZ build pipeline via harepacker-mcp. Extracts vanilla .wz (v83-client-custom) → imports custom sprites (NPCs, mobs, items, skills, equipment, UI) → exports Cosmic XML for server → packs binary .wz for client → regenerates patcher manifest. Run after creating ANY new visual content (sprites, icons, effects). Takes 2-5 minutes.`,
  async execute() {
    return await compileWz();
  },
}, { rateLimit: 60000 });

registerTool({
  name: 'maple_upload_wz',
  description: 'Upload patched WZ files to Ron via Telegram. Files over 50MB show the local path instead. Run maple_compile_wz first.',
  async execute() {
    return await uploadPatchedWz();
  },
}, { rateLimit: 30000 });

// ── Module Manifest ──────────────────────────────────────────────────────────

import { join } from 'path';
import { readFileSync } from 'fs';

export default {
  name: 'maplestory',
  signalPrefix: 'maple_',
  messageCategory: 'maplestory',

  detectSignals: detectMapleSignals,

  sonnetSignalTypes: ['maple_content_work', 'maple_server_down', 'maple_log_errors', 'maple_creative', 'maple_map_work', 'maple_wz_stale'],

  briefBuilders: {
    maple_content_work: buildMapleContentBrief,
    maple_server_down: buildMapleServerDownBrief,
    maple_log_errors: buildMapleLogErrorsBrief,
    maple_creative: buildMapleCreativeBrief,
    maple_map_work: buildMapleMapWorkBrief,
    maple_wz_stale: buildMapleWzStaleBrief,
  },

  stateKey: 'maplestory',
  stateKeyMap: {
    maple_content_work: 'lastMapleContentWorkAt',
    maple_server_down: 'lastMapleServerDownAt',
    maple_log_errors: 'lastMapleLogErrorsAt',
    maple_creative: 'lastMapleCreativeAt',
    maple_map_work: 'lastMapleMapWorkAt',
    maple_wz_stale: 'lastMapleWzStaleAt',
  },

  hasUrgentWork: () => false,

  projectProcess: {
    project: 'maplestory',
    mcpConfig: join(process.cwd(), 'mcp-config-maple.json'),
    model: 'opus',
    cycleInterval: 30 * 60_000,  // 30min independent cycle (was 10min Sonnet — cost optimization Mar 8)
  },
};
