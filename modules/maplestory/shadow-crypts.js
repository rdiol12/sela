/**
 * modules/maplestory/shadow-crypts.js — Shadow Crypts dungeon zone.
 *
 * Dark underground dungeon connected to Magatia (261000000).
 * Level 80-100 zone with undead/shadow themed mobs, 4 maps + boss room.
 *
 * Map IDs: 261090000-261090004
 *   261090000 — Shadow Crypts: Forsaken Entrance   (level 78-85, Ghost Pirate + Lycanthrope)
 *   261090001 — Shadow Crypts: Hall of Whispers     (level 83-90, Dual Ghost Pirate + Death Teddy)
 *   261090002 — Shadow Crypts: Abyssal Corridor     (level 88-95, Phantom Watch + Bain)
 *   261090003 — Shadow Crypts: Throne of Shadows    (level 95-100, Grim Phantom Watch boss)
 *
 * Entry: portal added to Magatia town (261000000)
 * NPC: Crypt Warden Moros (ID 9999021) placed at entrance
 *
 * === RESEARCH (ms_1) ===
 *
 * Tileset selection:
 *   - darkCave.img.xml  — entrance + hall maps (dark stone cave tiles)
 *   - deepCave.img.xml  — abyssal corridor (deeper, more foreboding)
 *   - blackTile.img.xml — boss room (pitch black stone, ominous)
 *
 * Background / BGM:
 *   - Bgm00/Nightmare   — entrance + hall (eerie ambient)
 *   - Bgm09/TimeAttack  — boss room (intense, already proven in Frozen Caverns boss)
 *
 * Connection point: Magatia (261000000)
 *   - Alchemical desert town, fits the "secret underground crypt" lore
 *   - Level 80+ players naturally pass through Magatia
 *   - Portal position: near the center-right of town
 *   - Lore: alchemists discovered ancient crypt entrance during excavation
 *
 * Mob selection (all exist in v83 Mob.wz, dark/undead themed):
 *   Map 1 (Forsaken Entrance, lv 78-85):
 *     - Ghost Pirate     (7140000, lv 83) — spectral pirates, crypt guardians
 *     - Lycanthrope       (8140000, lv 80) — dark werewolf creatures
 *   Map 2 (Hall of Whispers, lv 83-90):
 *     - Dual Ghost Pirate (7160000, lv 87) — stronger ghost variant
 *     - Death Teddy        (7130010, lv 85) — death-themed mob
 *   Map 3 (Abyssal Corridor, lv 88-95):
 *     - Phantom Watch      (8142000, lv 95) — phantom sentinels
 *     - Bain               (8140500, lv 90) — dark warrior mob
 *   Map 4 (Throne of Shadows, boss, lv 95-100):
 *     - Grim Phantom Watch (8143000, lv 99) — boss stand-in (strongest phantom)
 *     - Phantom Watch      (8142000, lv 95) — boss room minions
 *
 * Custom map ID range: 261090000-261090099 (Magatia Dungeon Zone)
 *
 * Usage:
 *   import { deployShadowCrypts, getShadowCryptsStatus } from './shadow-crypts.js';
 *   const result = deployShadowCrypts();
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createMap, addMobToMap, addNpcToMap, writeNpcScript } from './server-manager.js';
import { addPortalToMap, validateMapPortals } from './map-manager.js';
import log from '../../lib/logger.js';

const WZ_DIR = join(process.cwd(), 'workspace', 'Cosmic', 'wz');
const COSMIC_DIR = join(process.cwd(), 'workspace', 'Cosmic');

// ── Zone Config ───────────────────────────────────────────────────────────────

export const SHADOW_CRYPTS = {
  zone: 'Shadow Crypts',
  entryMap: 261000000,        // Magatia town — where entry portal goes
  entryPortalPos: { x: 800, y: 30 },  // center-right of Magatia

  maps: {
    entrance: {
      id: '261090000',
      name: 'Shadow Crypts: Forsaken Entrance',
      streetName: 'Shadow Crypts',
      returnMap: 261000000,
      bgm: 'Bgm00/Nightmare',
      minLevel: 78,
      maxLevel: 85,
      // Multi-platform cave layout — dark, winding entrance
      footholds: [
        // Ground floor — wide main corridor
        { x1: -700, y1: 100, x2: 700,  y2: 100 },
        // Left alcove (lower platform)
        { x1: -680, y1: -60, x2: -350, y2: -60 },
        // Right raised platform
        { x1:  200, y1: -80, x2: 550,  y2: -80 },
        // Upper left ledge (crumbling)
        { x1: -550, y1: -240, x2: -180, y2: -240 },
        // Upper right ledge
        { x1:  120, y1: -260, x2:  480, y2: -260 },
        // High central platform
        { x1: -200, y1: -420, x2:  200, y2: -420 },
      ],
      portals: [
        // Spawn point
        { name: 'sp',        type: 0, x: -450, y:  80, targetMap: 999999999, targetPortal: '' },
        // Return to Magatia
        { name: 'out00',     type: 2, x: -660, y:  80, targetMap: 261000000, targetPortal: 'shadow00' },
        // Deeper into Hall of Whispers
        { name: 'in00',      type: 2, x:  660, y:  80, targetMap: 261090001, targetPortal: 'back00' },
      ],
      // Ghost Pirate (7140000, lv83) x6 + Lycanthrope (8140000, lv80) x4
      mobs: [
        { id: '7140000', x: -300, y:  80, count: 2 },  // Ghost Pirate — floor left
        { id: '7140000', x:  100, y:  80, count: 2 },  // Ghost Pirate — floor right
        { id: '8140000', x: -500, y: -80, count: 2 },  // Lycanthrope — left alcove
        { id: '8140000', x:  350, y: -100, count: 2 }, // Lycanthrope — right platform
        { id: '7140000', x: -350, y: -260, count: 1 }, // Ghost Pirate — upper left
        { id: '7140000', x:  300, y: -280, count: 1 }, // Ghost Pirate — upper right
      ],
    },

    halls: {
      id: '261090001',
      name: 'Shadow Crypts: Hall of Whispers',
      streetName: 'Shadow Crypts',
      returnMap: 261000000,
      bgm: 'Bgm00/Nightmare',
      minLevel: 83,
      maxLevel: 90,
      footholds: [
        // Wide main hall
        { x1: -800, y1: 100,  x2: 800,  y2: 100  },
        // Left burial alcove
        { x1: -780, y1: -80,  x2: -400, y2: -80  },
        // Center raised dais
        { x1: -150, y1: -120, x2:  150, y2: -120 },
        // Right burial alcove
        { x1:  400, y1: -80,  x2:  780, y2: -80  },
        // Upper left gallery
        { x1: -700, y1: -300, x2: -250, y2: -300 },
        // Upper right gallery
        { x1:  250, y1: -320, x2:  700, y2: -320 },
        // Central arch (high)
        { x1: -350, y1: -500, x2:  350, y2: -500 },
      ],
      portals: [
        { name: 'sp',     type: 0, x: -600, y:  80, targetMap: 999999999, targetPortal: '' },
        { name: 'back00', type: 2, x: -760, y:  80, targetMap: 261090000, targetPortal: 'in00' },
        { name: 'in00',   type: 2, x:  760, y:  80, targetMap: 261090002, targetPortal: 'back00' },
      ],
      // Dual Ghost Pirate (7160000, lv87) x5 + Death Teddy (7130010, lv85) x5
      mobs: [
        { id: '7160000', x: -500, y:  80, count: 2 },  // Dual Ghost Pirate — left floor
        { id: '7160000', x:  300, y:  80, count: 2 },  // Dual Ghost Pirate — right floor
        { id: '7130010', x: -600, y: -100, count: 2 }, // Death Teddy — left alcove
        { id: '7130010', x:  550, y: -100, count: 2 }, // Death Teddy — right alcove
        { id: '7160000', x:    0, y: -140, count: 1 }, // Dual Ghost Pirate — center dais
        { id: '7130010', x: -400, y: -320, count: 1 }, // Death Teddy — upper left
      ],
    },

    corridor: {
      id: '261090002',
      name: 'Shadow Crypts: Abyssal Corridor',
      streetName: 'Shadow Crypts',
      returnMap: 261000000,
      bgm: 'Bgm00/Nightmare',
      minLevel: 88,
      maxLevel: 95,
      footholds: [
        // Narrow winding corridor
        { x1: -600, y1: 100,  x2: 600,  y2: 100  },
        // Left shelf
        { x1: -580, y1: -100, x2: -250, y2: -100 },
        // Right shelf
        { x1:  250, y1: -120, x2:  580, y2: -120 },
        // Mid-left ledge
        { x1: -500, y1: -300, x2: -100, y2: -300 },
        // Mid-right ledge
        { x1:  100, y1: -280, x2:  500, y2: -280 },
        // High narrow bridge
        { x1: -250, y1: -460, x2:  250, y2: -460 },
      ],
      portals: [
        { name: 'sp',     type: 0, x: -400, y:  80, targetMap: 999999999, targetPortal: '' },
        { name: 'back00', type: 2, x: -560, y:  80, targetMap: 261090001, targetPortal: 'in00' },
        { name: 'boss00', type: 2, x:  560, y:  80, targetMap: 261090003, targetPortal: 'back00' },
      ],
      // Phantom Watch (8142000, lv95) x4 + Bain (8140500, lv90) x4
      mobs: [
        { id: '8140500', x: -350, y:  80, count: 2 },  // Bain — floor left
        { id: '8140500', x:  200, y:  80, count: 2 },  // Bain — floor right
        { id: '8142000', x: -400, y: -120, count: 2 }, // Phantom Watch — left shelf
        { id: '8142000', x:  400, y: -140, count: 2 }, // Phantom Watch — right shelf
      ],
    },

    boss: {
      id: '261090003',
      name: 'Shadow Crypts: Throne of Shadows',
      streetName: 'Shadow Crypts',
      returnMap: 261090000,
      bgm: 'Bgm09/TimeAttack',
      minLevel: 95,
      maxLevel: 105,
      footholds: [
        // Wide throne room
        { x1: -500, y1: 100,  x2: 500,  y2: 100  },
        // Left elevated platform
        { x1: -480, y1: -180, x2: -150, y2: -180 },
        // Right elevated platform
        { x1:  150, y1: -180, x2:  480, y2: -180 },
        // Central throne dais (high)
        { x1: -200, y1: -380, x2:  200, y2: -380 },
      ],
      portals: [
        { name: 'sp',     type: 0, x:   0,  y:  80, targetMap: 999999999, targetPortal: '' },
        { name: 'back00', type: 2, x: -480, y:  80, targetMap: 261090002, targetPortal: 'boss00' },
      ],
      // Grim Phantom Watch (8143000, lv99) x1 boss + Phantom Watch (8142000, lv95) x4 minions
      mobs: [
        { id: '8143000', x:    0, y: -400, count: 1 }, // Grim Phantom Watch — throne (BOSS)
        { id: '8142000', x: -300, y:  80, count: 2 },  // Phantom Watch — floor guards
        { id: '8142000', x:  300, y:  80, count: 2 },  // Phantom Watch — floor guards
      ],
    },
  },
};

// ── Deploy Status ─────────────────────────────────────────────────────────────

const STATUS_PATH = join(process.cwd(), 'data', 'state', 'shadow-crypts-status.json');

function loadStatus() {
  try {
    if (existsSync(STATUS_PATH)) return JSON.parse(readFileSync(STATUS_PATH, 'utf-8'));
  } catch { /* */ }
  return { deployed: false, maps: {}, npc: false, quest: false, magatiaPortal: false };
}

function saveStatus(st) {
  st.updatedAt = new Date().toISOString();
  writeFileSync(STATUS_PATH, JSON.stringify(st, null, 2));
}

export function getShadowCryptsStatus() {
  return loadStatus();
}

// ── Map Deploy ────────────────────────────────────────────────────────────────

function deployMap(mapKey) {
  const cfg = SHADOW_CRYPTS.maps[mapKey];
  const st = loadStatus();

  if (st.maps[mapKey]) {
    return { skipped: true, mapId: cfg.id, reason: 'already deployed' };
  }

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

  st.maps[mapKey] = { deployedAt: new Date().toISOString(), mobResults };
  saveStatus(st);

  log.info({ mapKey, mapId: cfg.id, mobs: mobResults.length }, 'Shadow Crypts map deployed');
  return { success: true, mapId: cfg.id, mobResults };
}

// ── Magatia Entry Portal ─────────────────────────────────────────────────────

function deployMagatiaPortal() {
  const st = loadStatus();
  if (st.magatiaPortal) return { skipped: true, reason: 'already deployed' };

  const result = addPortalToMap('261000000', {
    name: 'shadow00',
    type: 2,
    x: SHADOW_CRYPTS.entryPortalPos.x,
    y: SHADOW_CRYPTS.entryPortalPos.y,
    targetMap: 261090000,
    targetPortal: 'out00',
  });

  if (result.success) {
    st.magatiaPortal = true;
    saveStatus(st);
  }

  return result;
}

// ── NPC: Crypt Warden Moros ──────────────────────────────────────────────────

function deployCryptWardenNpc() {
  const st = loadStatus();
  if (st.npc) return { skipped: true, reason: 'already deployed' };

  const script = `/**
 * 9999021.js — Crypt Warden Moros
 * Entrance NPC for Shadow Crypts dungeon (map 261090000).
 * Dark, foreboding gatekeeper who warns players about the dungeon.
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
      "... You should not have come here, mortal.",
      "I am #bMoros#k, warden of the Shadow Crypts.",
      "Centuries ago, the alchemists of Magatia uncovered this crypt.",
      "What they found... consumed them.",
      "\\nThe crypts stretch deep beneath the desert sands:",
      "  #r[ Forsaken Entrance ]#k — Levels 78-85. Ghost Pirates and Lycanthropes patrol.",
      "  #r[ Hall of Whispers ]#k — Levels 83-90. Dual Ghost Pirates and Death Teddies.",
      "  #r[ Abyssal Corridor ]#k — Levels 88-95. Phantom Watches and Bain guard the path.",
      "  #r[ Throne of Shadows ]#k — Levels 95-100. The Grim Phantom Watch awaits.",
      "\\nOnly those above level 78 should dare enter. The shadows show no mercy."
    ];
    cm.sendNext(lines.join("\\n"));
  } else if (status === 1) {
    var menu = "#b#L0# Tell me about the Throne of Shadows#l\\n#L1# What treasures lie within?#l\\n#L2# I fear nothing. Farewell.#l";
    cm.sendSimple("What knowledge do you seek?\\n\\n" + menu);
  } else if (status === 2) {
    if (selection === 0) {
      cm.sendNext(
        "The Throne of Shadows is the heart of this cursed place.\\n\\n" +
        "A creature called the #rGrim Phantom Watch#k sits upon the throne of bones. " +
        "It was once a great alchemist, twisted by forbidden experiments.\\n\\n" +
        "Its gaze alone can freeze your soul. Bring your strongest allies."
      );
    } else if (selection === 1) {
      cm.sendNext(
        "The undead within hoard ancient relics and dark essences.\\n\\n" +
        "#b[ Ghost Pirate ]#k — Drops Shadow Essence, Pirate's Cursed Coin\\n" +
        "#b[ Lycanthrope ]#k — Drops Dark Pelt, Lycan Fang\\n" +
        "#b[ Death Teddy ]#k — Drops Cursed Stuffing, Shadow Thread\\n" +
        "#b[ Phantom Watch ]#k — Drops Phantom's Eye, Temporal Shard\\n" +
        "#b[ Grim Phantom Watch ]#k — Drops Grim Reaper's Pendant, Abyssal Core\\n\\n" +
        "Collect #rShadow Essences#k and bring them to me for a reward."
      );
    } else {
      cm.sendOk("Then go, fool. The shadows will claim you soon enough.");
    }
    cm.dispose();
  } else {
    cm.dispose();
  }
}
`;

  try {
    writeNpcScript('9999021', script);
    addNpcToMap('261090000', '9999021', -50, 80);

    st.npc = true;
    saveStatus(st);
    log.info({}, 'Crypt Warden Moros NPC deployed to Shadow Crypts entrance');
    return { success: true, npcId: '9999021', mapId: '261090000' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Master Deploy ─────────────────────────────────────────────────────────────

/**
 * Deploy the full Shadow Crypts dungeon zone.
 * Creates all 4 maps, adds mobs, wires Magatia portal, places NPC.
 * Safe to call multiple times — skips already-deployed components.
 */
export function deployShadowCrypts() {
  const results = {};

  // Deploy entrance (ms_2)
  results.entrance = deployMap('entrance');

  // Deploy Hall of Whispers (ms_2)
  results.halls = deployMap('halls');

  // Deploy Abyssal Corridor (ms_3)
  results.corridor = deployMap('corridor');

  // Deploy boss room (ms_3)
  results.boss = deployMap('boss');

  // Wire Magatia portal
  results.magatiaPortal = deployMagatiaPortal();

  // Deploy Crypt Warden NPC (ms_4)
  results.npc = deployCryptWardenNpc();

  const st = loadStatus();
  const allMapsDeployed = Object.keys(SHADOW_CRYPTS.maps).every(k => st.maps[k]);

  if (allMapsDeployed) {
    st.deployed = true;
    saveStatus(st);
  }

  log.info({ results }, 'Shadow Crypts deploy complete');
  return {
    zone: 'Shadow Crypts',
    maps: Object.fromEntries(
      Object.keys(results)
        .filter(k => k !== 'npc' && k !== 'magatiaPortal')
        .map(k => [k, results[k]])
    ),
    magatiaPortal: results.magatiaPortal,
    npc: results.npc,
    note: 'Restart server to apply all changes',
    mapIds: {
      entrance: SHADOW_CRYPTS.maps.entrance.id,
      halls:    SHADOW_CRYPTS.maps.halls.id,
      corridor: SHADOW_CRYPTS.maps.corridor.id,
      boss:     SHADOW_CRYPTS.maps.boss.id,
    },
  };
}

// ── Comprehensive Validation (ms_8) ──────────────────────────────────────────

/**
 * Extract portals from a map XML file.
 * Returns array of { name, type, x, y, targetMap, targetPortal }.
 *
 * Uses a robust approach: scans the portal section for all <imgdir name="N">
 * blocks and extracts pn/pt/x/y/tm/tn from the text between each imgdir open
 * and the next imgdir open (or section end). This handles imperfect nesting
 * from addPortalToMap() insertions into large vanilla map XMLs.
 */
function extractPortalsFromXml(mapId) {
  const prefix = `Map${mapId.toString().charAt(0)}`;
  const filePath = join(WZ_DIR, 'Map.wz', 'Map', prefix, `${mapId}.img.xml`);
  if (!existsSync(filePath)) return null;

  const xml = readFileSync(filePath, 'utf-8');
  const portals = [];

  const portalStart = xml.indexOf('<imgdir name="portal">');
  if (portalStart < 0) return portals;

  // Find the end of the portal section (top-level closing </imgdir> of the parent)
  // For large maps, we limit to a generous slice after portal start
  const portalSection = xml.slice(portalStart);

  // Find all imgdir entries with numeric names inside the portal section.
  // Each represents a portal entry. We collect the text from each opening tag
  // to the next opening tag (or end of section) and parse properties from it.
  const entryStarts = [];
  const entryOpenRe = /<imgdir name="(\d+)">/g;
  let m;
  while ((m = entryOpenRe.exec(portalSection)) !== null) {
    entryStarts.push({ idx: m.index, end: m.index + m[0].length });
  }

  for (let i = 0; i < entryStarts.length; i++) {
    const start = entryStarts[i].end;
    const end = i + 1 < entryStarts.length ? entryStarts[i + 1].idx : portalSection.length;
    const block = portalSection.slice(start, end);

    // Only process blocks that contain a portal name (pn) — skip non-portal imgdirs
    const pnMatch = block.match(/name="pn" value="([^"]*)"/);
    if (!pnMatch) continue;

    portals.push({
      name:         pnMatch[1],
      type:         parseInt((block.match(/name="pt" value="(\d+)"/) || [])[1] || '0'),
      x:            parseInt((block.match(/name="x" value="(-?\d+)"/) || [])[1] || '0'),
      y:            parseInt((block.match(/name="y" value="(-?\d+)"/) || [])[1] || '0'),
      targetMap:    parseInt((block.match(/name="tm" value="(-?\d+)"/) || [])[1] || '999999999'),
      targetPortal: (block.match(/name="tn" value="([^"]*)"/) || [])[1] || '',
    });
  }
  return portals;
}

/**
 * Extract footholds from a map XML file.
 * Returns array of { x1, y1, x2, y2 }.
 */
function extractFootholdsFromXml(mapId) {
  const prefix = `Map${mapId.toString().charAt(0)}`;
  const filePath = join(WZ_DIR, 'Map.wz', 'Map', prefix, `${mapId}.img.xml`);
  if (!existsSync(filePath)) return null;

  const xml = readFileSync(filePath, 'utf-8');
  const footholds = [];

  // Match foothold entries: look for x1/y1/x2/y2 groups
  const fhStart = xml.indexOf('<imgdir name="foothold">');
  if (fhStart < 0) return footholds;

  // Extract x1,y1,x2,y2 from nested imgdir entries
  const fhSection = xml.slice(fhStart);
  const entryRe = /<imgdir name="\d+">\s*<int name="x1" value="(-?\d+)"\/>\s*<int name="y1" value="(-?\d+)"\/>\s*<int name="x2" value="(-?\d+)"\/>\s*<int name="y2" value="(-?\d+)"\/>/g;
  let m;
  while ((m = entryRe.exec(fhSection)) !== null) {
    footholds.push({
      x1: parseInt(m[1]), y1: parseInt(m[2]),
      x2: parseInt(m[3]), y2: parseInt(m[4]),
    });
  }
  return footholds;
}

/**
 * Check if a position (x, y) is on or near a foothold.
 * Mobs snap to footholds, so y should be at or just above a foothold, and x within range.
 */
function isOnFoothold(x, y, footholds, toleranceX = 50, toleranceY = 40) {
  for (const fh of footholds) {
    const minX = Math.min(fh.x1, fh.x2) - toleranceX;
    const maxX = Math.max(fh.x1, fh.x2) + toleranceX;
    // For flat footholds, check y is at or slightly above foothold level
    const fhY = Math.min(fh.y1, fh.y2);
    if (x >= minX && x <= maxX && Math.abs(y - fhY) <= toleranceY) {
      return true;
    }
  }
  return false;
}

/**
 * Validate all portals, footholds, and connections for the Shadow Crypts zone.
 *
 * Checks:
 *  1. All 4 map XML files exist
 *  2. Each map has a spawn point (pt=0)
 *  3. Portal bidirectionality: A→B portal matches B→A portal by name
 *  4. Magatia ↔ Entrance connection: shadow00 ↔ out00
 *  5. Mob spawn positions are on or near valid footholds
 *  6. Foothold coverage: each map has sufficient footholds
 *  7. Portal positions are on or near footholds
 *
 * @returns {{ valid: boolean, maps: object, connections: object[], issues: string[], warnings: string[] }}
 */
export function validateShadowCrypts() {
  const issues = [];    // hard failures
  const warnings = [];  // non-blocking notes
  const mapResults = {};

  // ── 1. Check all map files exist ───────────────────────────────────────────
  for (const [key, cfg] of Object.entries(SHADOW_CRYPTS.maps)) {
    const prefix = `Map${cfg.id.charAt(0)}`;
    const filePath = join(WZ_DIR, 'Map.wz', 'Map', prefix, `${cfg.id}.img.xml`);
    const exists = existsSync(filePath);
    if (!exists) {
      issues.push(`Map ${key} (${cfg.id}) XML file missing at ${filePath}`);
    }
    mapResults[key] = { id: cfg.id, name: cfg.name, exists, portals: [], footholds: [], mobChecks: [] };
  }

  // ── 2. Extract portals & footholds from each map ──────────────────────────
  for (const [key, cfg] of Object.entries(SHADOW_CRYPTS.maps)) {
    if (!mapResults[key].exists) continue;

    const portals = extractPortalsFromXml(cfg.id);
    const footholds = extractFootholdsFromXml(cfg.id);

    mapResults[key].portals = portals || [];
    mapResults[key].footholds = footholds || [];
    mapResults[key].portalCount = (portals || []).length;
    mapResults[key].footholdCount = (footholds || []).length;

    // Check spawn point exists
    const hasSpawn = (portals || []).some(p => p.type === 0);
    mapResults[key].hasSpawnPoint = hasSpawn;
    if (!hasSpawn) {
      issues.push(`Map ${key} (${cfg.id}): missing spawn point (pt=0)`);
    }

    // Check foothold coverage
    if (!footholds || footholds.length === 0) {
      issues.push(`Map ${key} (${cfg.id}): no footholds found`);
    } else if (footholds.length < 3) {
      warnings.push(`Map ${key} (${cfg.id}): only ${footholds.length} footholds (low coverage)`);
    }
  }

  // ── 3. Validate portal bidirectionality ───────────────────────────────────
  const connections = [];
  const expectedLinks = [
    // Magatia → Entrance
    { fromMap: '261000000', fromPortal: 'shadow00', toMap: '261090000', toPortal: 'out00', label: 'Magatia → Entrance' },
    { fromMap: '261090000', fromPortal: 'out00',    toMap: '261000000', toPortal: 'shadow00', label: 'Entrance → Magatia' },
    // Entrance → Hall of Whispers
    { fromMap: '261090000', fromPortal: 'in00',     toMap: '261090001', toPortal: 'back00', label: 'Entrance → Hall' },
    { fromMap: '261090001', fromPortal: 'back00',   toMap: '261090000', toPortal: 'in00',   label: 'Hall → Entrance' },
    // Hall → Abyssal Corridor
    { fromMap: '261090001', fromPortal: 'in00',     toMap: '261090002', toPortal: 'back00', label: 'Hall → Corridor' },
    { fromMap: '261090002', fromPortal: 'back00',   toMap: '261090001', toPortal: 'in00',   label: 'Corridor → Hall' },
    // Corridor → Boss Room
    { fromMap: '261090002', fromPortal: 'boss00',   toMap: '261090003', toPortal: 'back00', label: 'Corridor → Boss' },
    { fromMap: '261090003', fromPortal: 'back00',   toMap: '261090002', toPortal: 'boss00', label: 'Boss → Corridor' },
  ];

  // Build portal lookup: mapId → { portalName → portal }
  const portalLookup = {};
  for (const [key, mr] of Object.entries(mapResults)) {
    portalLookup[mr.id] = {};
    for (const p of mr.portals) {
      portalLookup[mr.id][p.name] = p;
    }
  }
  // Also extract Magatia portals
  const magatiaPortals = extractPortalsFromXml('261000000');
  if (magatiaPortals) {
    portalLookup['261000000'] = {};
    for (const p of magatiaPortals) {
      portalLookup['261000000'][p.name] = p;
    }
  }

  for (const link of expectedLinks) {
    const srcPortals = portalLookup[link.fromMap];
    const conn = { ...link, valid: false };

    if (!srcPortals) {
      conn.error = `Source map ${link.fromMap} portals not loaded`;
      issues.push(`${link.label}: source map portals not found`);
    } else {
      const portal = srcPortals[link.fromPortal];
      if (!portal) {
        conn.error = `Portal '${link.fromPortal}' not found in map ${link.fromMap}`;
        issues.push(`${link.label}: portal '${link.fromPortal}' missing in map ${link.fromMap}`);
      } else if (portal.targetMap.toString() !== link.toMap) {
        conn.error = `Portal '${link.fromPortal}' targets map ${portal.targetMap}, expected ${link.toMap}`;
        issues.push(`${link.label}: portal targets wrong map (${portal.targetMap} vs expected ${link.toMap})`);
      } else if (portal.targetPortal !== link.toPortal) {
        conn.error = `Portal '${link.fromPortal}' targets portal '${portal.targetPortal}', expected '${link.toPortal}'`;
        issues.push(`${link.label}: portal targets wrong portal name ('${portal.targetPortal}' vs '${link.toPortal}')`);
      } else {
        conn.valid = true;
      }
    }
    connections.push(conn);
  }

  // ── 4. Validate mob positions on footholds ────────────────────────────────
  for (const [key, cfg] of Object.entries(SHADOW_CRYPTS.maps)) {
    if (!mapResults[key].exists) continue;
    const footholds = mapResults[key].footholds;
    if (!footholds || footholds.length === 0) continue;

    for (const mob of cfg.mobs) {
      const onFh = isOnFoothold(mob.x, mob.y, footholds);
      const check = { mobId: mob.id, x: mob.x, y: mob.y, onFoothold: onFh };
      mapResults[key].mobChecks.push(check);
      if (!onFh) {
        warnings.push(`Map ${key} (${cfg.id}): mob ${mob.id} at (${mob.x},${mob.y}) not on any foothold`);
      }
    }
  }

  // ── 5. Validate portal positions near footholds ───────────────────────────
  for (const [key, cfg] of Object.entries(SHADOW_CRYPTS.maps)) {
    if (!mapResults[key].exists) continue;
    const footholds = mapResults[key].footholds;
    if (!footholds || footholds.length === 0) continue;

    for (const portal of mapResults[key].portals) {
      if (portal.type === 0) continue; // spawn points don't need foothold check
      const nearFh = isOnFoothold(portal.x, portal.y, footholds, 80, 60);
      if (!nearFh) {
        warnings.push(`Map ${key} (${cfg.id}): portal '${portal.name}' at (${portal.x},${portal.y}) not near a foothold`);
      }
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const validConnections = connections.filter(c => c.valid).length;
  const totalConnections = connections.length;
  const allMapsExist = Object.values(mapResults).every(m => m.exists);
  const allSpawns = Object.values(mapResults).every(m => m.hasSpawnPoint);
  const valid = issues.length === 0;

  // Clean up large data for summary
  const summary = {};
  for (const [key, mr] of Object.entries(mapResults)) {
    summary[key] = {
      id: mr.id,
      name: mr.name,
      exists: mr.exists,
      hasSpawnPoint: mr.hasSpawnPoint,
      portalCount: mr.portalCount,
      footholdCount: mr.footholdCount,
      mobsOnFootholds: mr.mobChecks.filter(c => c.onFoothold).length + '/' + mr.mobChecks.length,
    };
  }

  const result = {
    zone: 'Shadow Crypts',
    valid,
    allMapsExist,
    allSpawnsPresent: allSpawns,
    connectionStatus: `${validConnections}/${totalConnections} valid`,
    connections: connections.map(c => ({ label: c.label, valid: c.valid, error: c.error })),
    maps: summary,
    issues,
    warnings,
    validatedAt: new Date().toISOString(),
  };

  // Persist validation result
  const st = loadStatus();
  st.validation = result;
  saveStatus(st);

  log.info({ valid, issues: issues.length, warnings: warnings.length, connections: validConnections + '/' + totalConnections },
    'Shadow Crypts validation complete');

  return result;
}

/**
 * Get the status of each Shadow Crypts map in the WZ directory.
 */
export function getShadowCryptsMapStatus() {
  const st = loadStatus();
  const maps = {};

  for (const [key, cfg] of Object.entries(SHADOW_CRYPTS.maps)) {
    const prefix = `Map${cfg.id.charAt(0)}`;
    const filePath = join(WZ_DIR, 'Map.wz', 'Map', prefix, `${cfg.id}.img.xml`);
    maps[key] = {
      id: cfg.id,
      name: cfg.name,
      exists: existsSync(filePath),
      deployed: !!st.maps[key],
    };
  }

  return {
    zone: SHADOW_CRYPTS.zone,
    deployed: st.deployed,
    magatiaPortal: st.magatiaPortal,
    npc: st.npc,
    maps,
    updatedAt: st.updatedAt,
  };
}
