/**
 * modules/maplestory/custom-drops.js — Custom drop tables for MapleStory Cosmic.
 *
 * Adds our custom weapons and consumable items as drops on 15 existing mobs,
 * making them acquirable in-game without requiring a shop purchase.
 *
 * Drop chance is out of 1,000,000 (1% = 10000, 5% = 50000, 0.5% = 5000).
 * itemId = 0 means a meso drop; minQty/maxQty = meso amount range.
 *
 * Strategy:
 * - Beginner mobs (Snail/Slime): meso + rare return scrolls
 * - Easy mobs (Mushroom/Pig): buff potions at 5–8%
 * - Mid mobs (Jr. Necki/Horny/Zombie): Lucky Clover, Mana Crystal, shields
 * - Hard mobs (Fire Boar/Stumpy/Curse Eye/Ligator): rare custom weapons at 0.5–1%
 *
 * Deployment:
 * 1. Writes workspace/Cosmic/src/main/resources/db/data/153-custom-drops.sql
 *    (auto-applied on fresh server schema init)
 * 2. deployCustomDrops() also executes INSERTs live via MySQL CLI when running
 *    (idempotent — checks for existing (dropperid, itemid) before inserting)
 */

import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../lib/logger.js';
import { mysqlQuery, isMysqlRunning } from './server-manager.js';

const log = createLogger('maplestory:drops');

const COSMIC_DIR = join(process.cwd(), 'workspace', 'Cosmic');
const SQL_FILE = join(COSMIC_DIR, 'src', 'main', 'resources', 'db', 'data', '153-custom-drops.sql');

// ── Custom Drop Definitions ───────────────────────────────────────────────────

/**
 * Each entry: { mobId, itemId, minQty, maxQty, chance }
 * itemId 0 = meso drop; minQty/maxQty = meso amount.
 *
 * Custom item IDs used (from custom-items.js & custom-weapons.js):
 *   2002031  Elixir of Rage     PAD+10/3min
 *   2002032  Mana Crystal       MAD+10/3min
 *   2002033  Iron Shield Scroll DEF+15/5min
 *   2002034  Swift Boots Potion Speed+20/2min
 *   2002035  Lucky Clover       ACC+EVA+15/5min
 *   2002036  Giant's Meat       HP+800
 *   2002037  Sage Tea           MP+600
 *   2030021  Return Scroll      Warp to Henesys
 *   1302134  Crystal Fang       1H Sword (Warrior)
 *   1452086  Wind Piercer       Bow (Bowman)
 *   1332100  Shadow Fang        Dagger (Thief)
 */
export const CUSTOM_DROPS = [
  // ── Snail (100100) ─────────────────────────────────────────────────────────
  // Beginner mob: meso bonus + tiny chance of return scroll
  { mobId: 100100, itemId: 0,       minQty: 50,   maxQty: 100,  chance: 500000, note: 'Snail meso 50-100' },
  { mobId: 100100, itemId: 2030021, minQty: 1,    maxQty: 1,    chance: 5000,   note: 'Snail → Return Scroll 0.5%' },

  // ── Blue Snail (100101) ────────────────────────────────────────────────────
  // Beginner mob: meso bonus
  { mobId: 100101, itemId: 0,       minQty: 100,  maxQty: 200,  chance: 500000, note: 'Blue Snail meso 100-200' },
  { mobId: 100101, itemId: 2030021, minQty: 1,    maxQty: 1,    chance: 8000,   note: 'Blue Snail → Return Scroll 0.8%' },

  // ── Slime (210100) ─────────────────────────────────────────────────────────
  // Easy mob: meso + return scroll
  { mobId: 210100, itemId: 0,       minQty: 50,   maxQty: 150,  chance: 500000, note: 'Slime meso 50-150' },
  { mobId: 210100, itemId: 2030021, minQty: 1,    maxQty: 1,    chance: 10000,  note: 'Slime → Return Scroll 1%' },

  // ── Green Mushroom (1110100) ───────────────────────────────────────────────
  // Easy-mid mob: Elixir of Rage + meso
  { mobId: 1110100, itemId: 2002031, minQty: 1,   maxQty: 1,    chance: 50000,  note: 'Green Mushroom → Elixir of Rage 5%' },
  { mobId: 1110100, itemId: 0,       minQty: 400, maxQty: 600,  chance: 500000, note: 'Green Mushroom meso 400-600' },

  // ── Pig (1210100) ──────────────────────────────────────────────────────────
  // Easy mob: Swift Boots Potion (speed buff) + meso
  { mobId: 1210100, itemId: 2002034, minQty: 1,   maxQty: 1,    chance: 60000,  note: 'Pig → Swift Boots Potion 6%' },
  { mobId: 1210100, itemId: 0,       minQty: 400, maxQty: 600,  chance: 500000, note: 'Pig meso 400-600' },

  // ── Ribbon Pig (1210101) ───────────────────────────────────────────────────
  // Easy-mid mob: Iron Shield Scroll + meso
  { mobId: 1210101, itemId: 2002033, minQty: 1,   maxQty: 1,    chance: 50000,  note: 'Ribbon Pig → Iron Shield Scroll 5%' },
  { mobId: 1210101, itemId: 0,       minQty: 600, maxQty: 1000, chance: 500000, note: 'Ribbon Pig meso 600-1000' },

  // ── Orange Mushroom (1210102) ──────────────────────────────────────────────
  // Easy-mid mob: Elixir of Rage + meso
  { mobId: 1210102, itemId: 2002031, minQty: 1,   maxQty: 1,    chance: 80000,  note: 'Orange Mushroom → Elixir of Rage 8%' },
  { mobId: 1210102, itemId: 0,       minQty: 800, maxQty: 1200, chance: 500000, note: 'Orange Mushroom meso 800-1200' },

  // ── Axe Stump (1130100) ───────────────────────────────────────────────────
  // Easy-mid mob: Sage Tea (MP restore) + meso
  { mobId: 1130100, itemId: 2002037, minQty: 1,    maxQty: 1,   chance: 80000,  note: 'Axe Stump → Sage Tea 8%' },
  { mobId: 1130100, itemId: 0,       minQty: 1000, maxQty: 2000, chance: 500000, note: 'Axe Stump meso 1000-2000' },

  // ── Jr. Necki (2130103) ───────────────────────────────────────────────────
  // Mid mob: Lucky Clover + Return Scroll + meso
  { mobId: 2130103, itemId: 2002035, minQty: 1,    maxQty: 1,   chance: 30000,  note: 'Jr. Necki → Lucky Clover 3%' },
  { mobId: 2130103, itemId: 2030021, minQty: 1,    maxQty: 1,   chance: 50000,  note: 'Jr. Necki → Return Scroll 5%' },
  { mobId: 2130103, itemId: 0,       minQty: 2000, maxQty: 4000, chance: 500000, note: 'Jr. Necki meso 2000-4000' },

  // ── Horny Mushroom (2110200) ───────────────────────────────────────────────
  // Mid mob: Mana Crystal + Iron Shield Scroll + meso
  { mobId: 2110200, itemId: 2002032, minQty: 1,    maxQty: 1,   chance: 50000,  note: 'Horny Mushroom → Mana Crystal 5%' },
  { mobId: 2110200, itemId: 2002033, minQty: 1,    maxQty: 1,   chance: 40000,  note: 'Horny Mushroom → Iron Shield Scroll 4%' },
  { mobId: 2110200, itemId: 0,       minQty: 1500, maxQty: 2500, chance: 500000, note: 'Horny Mushroom meso 1500-2500' },

  // ── Zombie Mushroom (2230101) ──────────────────────────────────────────────
  // Mid mob: Mana Crystal + Sage Tea + meso
  { mobId: 2230101, itemId: 2002032, minQty: 1,    maxQty: 1,   chance: 60000,  note: 'Zombie Mushroom → Mana Crystal 6%' },
  { mobId: 2230101, itemId: 2002037, minQty: 1,    maxQty: 1,   chance: 70000,  note: 'Zombie Mushroom → Sage Tea 7%' },
  { mobId: 2230101, itemId: 0,       minQty: 2000, maxQty: 3500, chance: 500000, note: 'Zombie Mushroom meso 2000-3500' },

  // ── Fire Boar (3210100) ───────────────────────────────────────────────────
  // Mid-hard mob: Elixir of Rage + Giant's Meat + meso
  { mobId: 3210100, itemId: 2002031, minQty: 1,    maxQty: 1,   chance: 80000,  note: 'Fire Boar → Elixir of Rage 8%' },
  { mobId: 3210100, itemId: 2002036, minQty: 1,    maxQty: 1,   chance: 100000, note: 'Fire Boar → Giant\'s Meat 10%' },
  { mobId: 3210100, itemId: 0,       minQty: 3000, maxQty: 5000, chance: 500000, note: 'Fire Boar meso 3000-5000' },

  // ── Curse Eye (3230100) ───────────────────────────────────────────────────
  // Mid-hard mob: Lucky Clover + Sage Tea + Wind Piercer (rare bow for Bowmen)
  { mobId: 3230100, itemId: 2002035, minQty: 1,    maxQty: 1,   chance: 50000,  note: 'Curse Eye → Lucky Clover 5%' },
  { mobId: 3230100, itemId: 2002037, minQty: 1,    maxQty: 1,   chance: 70000,  note: 'Curse Eye → Sage Tea 7%' },
  { mobId: 3230100, itemId: 1452086, minQty: 1,    maxQty: 1,   chance: 5000,   note: 'Curse Eye → Wind Piercer 0.5%' },
  { mobId: 3230100, itemId: 0,       minQty: 3000, maxQty: 5000, chance: 500000, note: 'Curse Eye meso 3000-5000' },

  // ── Ligator (3110100) ─────────────────────────────────────────────────────
  // Mid-hard mob: Iron Shield + Elixir of Rage + Shadow Fang (rare dagger for Thieves)
  { mobId: 3110100, itemId: 2002033, minQty: 1,    maxQty: 1,   chance: 50000,  note: 'Ligator → Iron Shield Scroll 5%' },
  { mobId: 3110100, itemId: 2002031, minQty: 1,    maxQty: 1,   chance: 50000,  note: 'Ligator → Elixir of Rage 5%' },
  { mobId: 3110100, itemId: 1332100, minQty: 1,    maxQty: 1,   chance: 5000,   note: 'Ligator → Shadow Fang 0.5%' },
  { mobId: 3110100, itemId: 0,       minQty: 2500, maxQty: 4500, chance: 500000, note: 'Ligator meso 2500-4500' },

  // ── Stumpy (3220000) — hard mini-boss ─────────────────────────────────────
  // Hard mob: Giant's Meat + Lucky Clover + Crystal Fang (1% rare warrior weapon!)
  { mobId: 3220000, itemId: 2002036, minQty: 1,    maxQty: 2,    chance: 150000, note: 'Stumpy → Giant\'s Meat 15%' },
  { mobId: 3220000, itemId: 2002035, minQty: 1,    maxQty: 1,    chance: 80000,  note: 'Stumpy → Lucky Clover 8%' },
  { mobId: 3220000, itemId: 1302134, minQty: 1,    maxQty: 1,    chance: 10000,  note: 'Stumpy → Crystal Fang 1%' },
  { mobId: 3220000, itemId: 0,       minQty: 5000, maxQty: 10000, chance: 600000, note: 'Stumpy meso 5000-10000' },
];

// ── SQL Generation ────────────────────────────────────────────────────────────

/**
 * Generate the full SQL file content for custom drops.
 * Each INSERT is guarded with a NOT EXISTS check to be idempotent.
 */
function buildSqlContent() {
  const lines = [
    '-- 153-custom-drops.sql',
    '-- Custom drop entries for MapleStory Cosmic — 15 mobs.',
    '-- Generated by modules/maplestory/custom-drops.js',
    '-- Each INSERT is idempotent (NOT EXISTS guard).',
    '',
  ];

  // Group by mob for readability
  const byMob = {};
  for (const d of CUSTOM_DROPS) {
    if (!byMob[d.mobId]) byMob[d.mobId] = [];
    byMob[d.mobId].push(d);
  }

  for (const [mobId, drops] of Object.entries(byMob)) {
    lines.push(`-- Mob ${mobId}: ${drops[0].note.split('→')[0].trim()}`);
    for (const d of drops) {
      lines.push(
        `INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance)` +
        ` SELECT ${d.mobId}, ${d.itemId}, ${d.minQty}, ${d.maxQty}, 0, ${d.chance}` +
        ` WHERE NOT EXISTS (SELECT 1 FROM drop_data WHERE dropperid = ${d.mobId} AND itemid = ${d.itemId} AND chance = ${d.chance});`
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Write SQL File ────────────────────────────────────────────────────────────

/**
 * Write the 153-custom-drops.sql file for persistent schema-init deployment.
 * Returns { written: true, path } or { written: false } if file already current.
 */
export function writeCustomDropsSql() {
  const content = buildSqlContent();
  writeFileSync(SQL_FILE, content, 'utf-8');
  log.info({ path: SQL_FILE }, 'Wrote 153-custom-drops.sql');
  return { written: true, path: SQL_FILE };
}

// ── Live MySQL Deployment ─────────────────────────────────────────────────────

/**
 * Deploy a single drop entry via MySQL CLI.
 * Checks for duplicate (dropperid, itemid, chance) before inserting.
 * Returns 'inserted' | 'exists' | 'error'
 */
function deployDropEntry(d) {
  try {
    const checkSql = `SELECT COUNT(*) FROM drop_data WHERE dropperid = ${d.mobId} AND itemid = ${d.itemId} AND chance = ${d.chance}`;
    const result = mysqlQuery(checkSql);
    const count = parseInt(result.split('\n').pop().trim(), 10);
    if (count > 0) return 'exists';

    const insertSql = `INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance) VALUES (${d.mobId}, ${d.itemId}, ${d.minQty}, ${d.maxQty}, 0, ${d.chance})`;
    mysqlQuery(insertSql);
    return 'inserted';
  } catch (err) {
    log.error({ mobId: d.mobId, itemId: d.itemId, err: err.message }, 'Drop insert failed');
    return 'error';
  }
}

// ── Deploy All ────────────────────────────────────────────────────────────────

/**
 * Deploy all custom drops:
 * 1. Always writes the SQL file (153-custom-drops.sql) for persistent deployment
 * 2. If MySQL is running, also executes each INSERT live
 *
 * Returns a summary with counts of inserted/existing/error entries.
 */
export function deployCustomDrops() {
  // Always write the SQL file first
  writeCustomDropsSql();

  const summary = {
    sqlFileWritten: true,
    sqlFilePath: SQL_FILE,
    total: CUSTOM_DROPS.length,
    mysqlRunning: false,
    inserted: 0,
    alreadyExisted: 0,
    errors: 0,
    results: [],
  };

  if (!isMysqlRunning()) {
    summary.note = 'MySQL not running — SQL file written. Run maple_start then call maple_deploy_drops again to apply live.';
    log.info({ total: CUSTOM_DROPS.length }, 'MySQL offline — SQL file written for custom drops');
    return summary;
  }

  summary.mysqlRunning = true;
  for (const d of CUSTOM_DROPS) {
    const status = deployDropEntry(d);
    summary.results.push({ mobId: d.mobId, itemId: d.itemId, note: d.note, status });
    if (status === 'inserted') summary.inserted++;
    else if (status === 'exists') summary.alreadyExisted++;
    else summary.errors++;
  }

  log.info({ inserted: summary.inserted, existing: summary.alreadyExisted, errors: summary.errors },
    'Custom drops deployed live');
  summary.note = summary.inserted > 0
    ? `${summary.inserted} drops added. Restart server to see changes in-game.`
    : 'All drops already existed in DB.';
  return summary;
}

/**
 * Check status of custom drops (requires MySQL to be running).
 * Returns { mysqlRunning, drops: [{mobId, itemId, note, exists}] }
 */
export function getCustomDropStatus() {
  if (!isMysqlRunning()) {
    return { mysqlRunning: false, drops: [], note: 'MySQL not running — cannot check live status' };
  }

  const drops = CUSTOM_DROPS.map(d => {
    let exists = false;
    try {
      const result = mysqlQuery(
        `SELECT COUNT(*) FROM drop_data WHERE dropperid = ${d.mobId} AND itemid = ${d.itemId} AND chance = ${d.chance}`
      );
      exists = parseInt(result.split('\n').pop().trim(), 10) > 0;
    } catch {}
    return { mobId: d.mobId, itemId: d.itemId, note: d.note, exists };
  });

  const existCount = drops.filter(d => d.exists).length;
  return {
    mysqlRunning: true,
    total: CUSTOM_DROPS.length,
    deployed: existCount,
    pending: CUSTOM_DROPS.length - existCount,
    drops,
  };
}

/**
 * Get a summary of which mobs have custom drops and what they are.
 */
export function getCustomDropSummary() {
  const byMob = {};
  for (const d of CUSTOM_DROPS) {
    if (!byMob[d.mobId]) byMob[d.mobId] = { mobId: d.mobId, drops: [] };
    byMob[d.mobId].drops.push({
      itemId: d.itemId,
      minQty: d.minQty,
      maxQty: d.maxQty,
      chance: d.chance,
      chancePct: `${(d.chance / 10000).toFixed(2)}%`,
      note: d.note,
    });
  }
  return {
    mobs: Object.values(byMob),
    totalEntries: CUSTOM_DROPS.length,
    sqlFile: SQL_FILE,
  };
}
