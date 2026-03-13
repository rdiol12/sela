/**
 * modules/maplestory/frozen-caverns.js — Frozen Caverns dungeon zone.
 *
 * Ice-themed dungeon zone connected to El Nath. Three maps:
 *   211090000 — Frozen Caverns: Entrance Cave  (level 40, Cold Eye + Leatty)
 *   211090001 — Frozen Caverns: Frozen Halls   (level 45, Jr. Yeti + Hector)
 *   211090002 — Frozen Caverns: Ice Boss Chamber (level 50, Glacial Overlord boss)
 *
 * Entry: portal added to El Nath Town (211000000)
 * NPC: Frost Warden Kira (ID 9999020) placed at entrance (ms_4)
 *
 * Usage:
 *   import { deployFrozenCaverns, getFrozenCavernsStatus } from './frozen-caverns.js';
 *   const result = deployFrozenCaverns();
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createMap, addMobToMap, addNpcToMap, writeNpcScript, writeQuestScript } from './server-manager.js';
import { addPortalToMap } from './map-manager.js';
import log from '../../lib/logger.js';

const WZ_DIR = join(process.cwd(), 'workspace', 'Cosmic', 'wz');
const COSMIC_DIR = join(process.cwd(), 'workspace', 'Cosmic');

// ── Zone Config ───────────────────────────────────────────────────────────────

export const FROZEN_CAVERNS = {
  zone: 'Frozen Caverns',
  entryMap: 211000000,        // El Nath Town — where entry portal goes
  entryPortalPos: { x: -2200, y: 30 },  // position in El Nath for the cave entrance

  maps: {
    entrance: {
      id: '211090000',
      name: 'Frozen Caverns: Entrance Cave',
      streetName: 'Frozen Caverns',
      returnMap: 211000000,
      bgm: 'Bgm10/UnderworldMind',
      minLevel: 35,
      maxLevel: 45,
      // Multi-platform cave layout
      footholds: [
        // Ground floor
        { x1: -600, y1: 100, x2: 600,  y2: 100 },
        // Left alcove (lower)
        { x1: -580, y1: -80, x2: -300, y2: -80 },
        // Right platform
        { x1:  180, y1: -100, x2: 500, y2: -100 },
        // Upper left ledge
        { x1: -500, y1: -280, x2: -150, y2: -280 },
        // Upper right ledge
        { x1:  100, y1: -260, x2:  420, y2: -260 },
        // Ceiling left (decorative, mobs don't spawn here)
        { x1: -580, y1: -420, x2: -80,  y2: -420 },
        { x1:   80, y1: -400, x2:  580,  y2: -400 },
      ],
      portals: [
        // Spawn point
        { name: 'sp',        type: 0, x: -400, y:  80, targetMap: 999999999, targetPortal: '' },
        // Return to El Nath
        { name: 'out00',     type: 2, x: -560, y:  80, targetMap: 211000000, targetPortal: 'frozen00' },
        // Deeper into Frozen Halls
        { name: 'in00',      type: 2, x:  560, y:  80, targetMap: 211090001, targetPortal: 'back00' },
      ],
      // Mob spawns: Cold Eye (4230100, lvl 40) x5 + Leatty (5300000, lvl 32) x3
      mobs: [
        { id: '4230100', x: -350, y:  80, count: 3 },  // Cold Eye — lower floor
        { id: '4230100', x:  200, y:  80, count: 2 },  // Cold Eye — right side
        { id: '5300000', x: -380, y: -100, count: 2 }, // Leatty — left alcove
        { id: '5300000', x:  250, y: -120, count: 1 }, // Leatty — right platform
        { id: '4230100', x: -200, y: -300, count: 1 }, // Cold Eye — upper left
      ],
    },

    halls: {
      id: '211090001',
      name: 'Frozen Caverns: Frozen Halls',
      streetName: 'Frozen Caverns',
      returnMap: 211000000,
      bgm: 'Bgm10/UnderworldMind',
      minLevel: 42,
      maxLevel: 50,
      footholds: [
        { x1: -700, y1: 100,  x2: 700,  y2: 100  },
        { x1: -680, y1: -100, x2: -350, y2: -100 },
        { x1:  -50, y1: -120, x2:  300, y2: -120 },
        { x1:  350, y1: -80,  x2:  680, y2: -80  },
        { x1: -620, y1: -300, x2: -200, y2: -300 },
        { x1:  150, y1: -320, x2:  620, y2: -320 },
        { x1: -400, y1: -500, x2:  400, y2: -500 },
      ],
      portals: [
        { name: 'sp',     type: 0, x: -500, y:  80, targetMap: 999999999, targetPortal: '' },
        { name: 'back00', type: 2, x: -660, y:  80, targetMap: 211090000, targetPortal: 'in00' },
        { name: 'boss00', type: 2, x:  660, y:  80, targetMap: 211090002, targetPortal: 'back00' },
      ],
      mobs: [
        { id: '5300001', x: -400, y:  80, count: 3 }, // Dark Leatty — floor left
        { id: '5300001', x:  200, y:  80, count: 2 }, // Dark Leatty — floor right
        { id: '5100000', x: -450, y: -120, count: 2 }, // Jr. Yeti — left platform
        { id: '5100000', x:  100, y: -140, count: 2 }, // Jr. Yeti — mid platform
        { id: '5130104', x:  500, y: -100, count: 1 }, // Hector — right platform
        { id: '5100000', x: -300, y: -320, count: 2 }, // Jr. Yeti — upper left
        { id: '5130104', x:  300, y: -340, count: 1 }, // Hector — upper right
      ],
    },

    boss: {
      id: '211090002',
      name: 'Frozen Caverns: Ice Chamber',
      streetName: 'Frozen Caverns',
      returnMap: 211090000,
      bgm: 'Bgm09/TimeAttack',
      minLevel: 48,
      maxLevel: 60,
      footholds: [
        { x1: -500, y1: 100,  x2: 500,  y2: 100  },
        { x1: -480, y1: -200, x2: -150, y2: -200 },
        { x1:  150, y1: -200, x2:  480, y2: -200 },
        { x1: -300, y1: -400, x2:  300, y2: -400 },
      ],
      portals: [
        { name: 'sp',     type: 0, x:   0,  y:  80, targetMap: 999999999, targetPortal: '' },
        { name: 'back00', type: 2, x: -480, y:  80, targetMap: 211090001, targetPortal: 'boss00' },
      ],
      mobs: [
        { id: '5140000', x: -200, y:  80, count: 2 }, // White Fang
        { id: '5140000', x:  200, y:  80, count: 2 }, // White Fang
        { id: '5130104', x:    0, y:  80, count: 1 }, // Hector (boss stand-in until custom boss added)
      ],
    },
  },
};

// ── Deploy Status ─────────────────────────────────────────────────────────────

const STATUS_PATH = join(process.cwd(), 'data', 'state', 'frozen-caverns-status.json');

function loadStatus() {
  try {
    if (existsSync(STATUS_PATH)) return JSON.parse(readFileSync(STATUS_PATH, 'utf-8'));
  } catch { /* */ }
  return { deployed: false, maps: {}, npc: false, quest: false, elNathPortal: false };
}

function saveStatus(status) {
  status.updatedAt = new Date().toISOString();
  writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2));
}

export function getFrozenCavernsStatus() {
  return loadStatus();
}

// ── Map Deploy ────────────────────────────────────────────────────────────────

function deployMap(mapKey) {
  const cfg = FROZEN_CAVERNS.maps[mapKey];
  const status = loadStatus();

  if (status.maps[mapKey]) {
    return { skipped: true, mapId: cfg.id, reason: 'already deployed' };
  }

  // Create the map XML
  const result = createMap(cfg.id, {
    name: cfg.name,
    streetName: cfg.streetName,
    returnMap: cfg.returnMap,
    bgm: cfg.bgm,
    fieldLimit: 0,
    footholds: cfg.footholds,
    portals: cfg.portals,
  });

  if (!result.success) return { success: false, mapId: cfg.id, error: result.error };

  // Add mob spawns
  const mobResults = [];
  for (const spawn of cfg.mobs) {
    try {
      const mr = addMobToMap(cfg.id, spawn.id, spawn.x, spawn.y, spawn.count || 1);
      mobResults.push({ mobId: spawn.id, ok: mr.success });
    } catch (e) {
      mobResults.push({ mobId: spawn.id, error: e.message });
    }
  }

  // Update status
  status.maps[mapKey] = { deployedAt: new Date().toISOString(), mobResults };
  saveStatus(status);

  log.info({ mapKey, mapId: cfg.id, mobs: mobResults.length }, 'Frozen Caverns map deployed');
  return { success: true, mapId: cfg.id, mobResults };
}

// ── El Nath Entry Portal ──────────────────────────────────────────────────────

function deployElNathPortal() {
  const status = loadStatus();
  if (status.elNathPortal) return { skipped: true, reason: 'already deployed' };

  const result = addPortalToMap('211000000', {
    name: 'frozen00',
    type: 2,
    x: FROZEN_CAVERNS.entryPortalPos.x,
    y: FROZEN_CAVERNS.entryPortalPos.y,
    targetMap: 211090000,
    targetPortal: 'out00',
  });

  if (result.success) {
    status.elNathPortal = true;
    saveStatus(status);
  }

  return result;
}

// ── NPC Script (ms_4) ─────────────────────────────────────────────────────────

function deployFrostWardenNpc() {
  const status = loadStatus();
  if (status.npc) return { skipped: true, reason: 'already deployed' };

  const script = `/**
 * 9999020.js — Frost Warden Kira
 * Entrance NPC for Frozen Caverns dungeon (map 211090000).
 * Gives info about the dungeon and offers the entry quest.
 */
var status = -1;

function start() {
  status = -1;
  action(1, 0, 0);
}

function action(mode, type, selection) {
  if (mode === -1) {
    cm.dispose();
    return;
  }

  if (mode === 0 && type > 0) {
    cm.dispose();
    return;
  }

  status++;

  if (status === 0) {
    var lines = [
      "You have found the Frozen Caverns, traveler.",
      "These icy depths were sealed long ago after something ancient stirred within.",
      "I am Kira — sworn to guard this entrance and turn back the unprepared.",
      "\\nThe caverns are split into three zones:",
      "  #b[ Entrance Cave ]#k — Levels 35-45. Cold Eye and Leatty roam freely.",
      "  #b[ Frozen Halls ]#k — Levels 42-50. Jr. Yetis and Hectors lurk in the dark.",
      "  #b[ Ice Chamber ]#k  — Levels 48-60. The beast at the heart of the frost.",
      "\\nBring warm gear. The cold saps your strength. Are you ready to enter?"
    ];
    cm.sendNext(lines.join("\\n"));
  } else if (status === 1) {
    var menu = "#b#L0# Tell me about the Ice Chamber#l\\n#L1# What rewards await inside?#l\\n#L2# I need nothing. Farewell.#l";
    cm.sendSimple("What would you like to know?\n\n" + menu);
  } else if (status === 2) {
    if (selection === 0) {
      cm.sendNext(
        "The Ice Chamber is the deepest point of the Frozen Caverns.\\n\\n" +
        "A creature called the #bGlacial Overlord#k slumbers there. " +
        "No one who has faced it has returned to speak of it... yet.\\n\\n" +
        "Defeat it, and the caverns will be yours to claim."
      );
    } else if (selection === 1) {
      cm.sendNext(
        "The creatures inside carry rare icy essences and crafting materials.\\n\\n" +
        "#b[ Cold Eye ]#k — Drops Icy Orb, Frost Crystal, Cold Eye Lens\\n" +
        "#b[ Jr. Yeti ]#k — Drops Yeti Pelt, Frozen Shard\\n" +
        "#b[ Hector ]#k — Drops Hector's Fang, Glacial Core\\n" +
        "#b[ White Fang ]#k — Drops White Fur, Frostbite Essence\\n\\n" +
        "Collect #bFrost Crystals#k and bring them to me for a special reward."
      );
    } else {
      cm.sendOk("Stay warm out there, traveler. The frost shows no mercy.");
    }
    cm.dispose();
  } else {
    cm.dispose();
  }
}
`;

  try {
    writeNpcScript('9999020', script);

    // Place NPC in entrance map
    addNpcToMap('211090000', '9999020', -50, 80);

    status.npc = true;
    saveStatus(status);
    log.info({}, 'Frost Warden Kira NPC deployed to Frozen Caverns entrance');
    return { success: true, npcId: '9999020', mapId: '211090000' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Master Deploy ─────────────────────────────────────────────────────────────

/**
 * Deploy the full Frozen Caverns dungeon zone.
 * Creates all 3 maps, adds mobs, wires El Nath portal, places NPC.
 * Safe to call multiple times — skips already-deployed components.
 */
export function deployFrozenCaverns() {
  const results = {};

  // Deploy entrance map (ms_1)
  results.entrance = deployMap('entrance');

  // Deploy frozen halls (ms_2)
  results.halls = deployMap('halls');

  // Deploy boss room (ms_3)
  results.boss = deployMap('boss');

  // Wire El Nath portal
  results.elNathPortal = deployElNathPortal();

  // Deploy Frost Warden NPC (ms_4)
  results.npc = deployFrostWardenNpc();

  const status = loadStatus();
  const allMapsDeployed = Object.values(FROZEN_CAVERNS.maps).every(
    m => status.maps[Object.keys(FROZEN_CAVERNS.maps).find(k => FROZEN_CAVERNS.maps[k].id === m.id)]
  );

  if (allMapsDeployed) {
    status.deployed = true;
    saveStatus(status);
  }

  log.info({ results }, 'Frozen Caverns deploy complete');
  return {
    zone: 'Frozen Caverns',
    maps: Object.fromEntries(Object.keys(results).filter(k => k !== 'npc' && k !== 'elNathPortal').map(k => [k, results[k]])),
    elNathPortal: results.elNathPortal,
    npc: results.npc,
    note: 'Restart server to apply all changes',
    mapIds: {
      entrance: FROZEN_CAVERNS.maps.entrance.id,
      halls: FROZEN_CAVERNS.maps.halls.id,
      boss: FROZEN_CAVERNS.maps.boss.id,
    },
  };
}

/**
 * Get the status of each Frozen Caverns map in the WZ directory.
 */
export function getFrozenCavernsMapStatus() {
  const status = loadStatus();
  const maps = {};

  for (const [key, cfg] of Object.entries(FROZEN_CAVERNS.maps)) {
    const prefix = `Map${cfg.id.charAt(0)}`;
    const filePath = join(WZ_DIR, 'Map.wz', 'Map', prefix, `${cfg.id}.img.xml`);
    maps[key] = {
      id: cfg.id,
      name: cfg.name,
      exists: existsSync(filePath),
      deployed: !!status.maps[key],
    };
  }

  return {
    zone: FROZEN_CAVERNS.zone,
    deployed: status.deployed,
    elNathPortal: status.elNathPortal,
    npc: status.npc,
    maps,
    updatedAt: status.updatedAt,
  };
}
