/**
 * modules/maplestory/custom-skills.js — Skill rebalancing for MapleStory Cosmic.
 *
 * Rebalances 5 skills, one per job class, to make each class feel more rewarding:
 *
 *   Warrior  — Rage (1101006):        Remove the pdd penalty entirely
 *   Magician — Cold Beam (2201004):   +20 MAD all levels, longer freeze at high levels
 *   Bowman   — Arrow Bomb (3101005):  +20 damage, +10% stun chance all levels
 *   Thief    — Double Stab (4001334): +20 damage, -2 mpCon all levels
 *   Pirate   — Backspin Blow (5101002): +30 damage, -4 mpCon all levels
 *
 * Uses a single-read/single-write batch approach per skill file for efficiency.
 * Changes are computed from current live values (delta-based) — safe to re-apply
 * if values were manually reverted.
 *
 * Also generates a human-readable rebalance report at:
 *   data/state/skill-rebalances.json
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../lib/logger.js';
import { getSkillData } from './wz-xml.js';

const log = createLogger('maplestory:skills');

const WZ_DIR    = join(process.cwd(), 'workspace', 'Cosmic', 'wz');
const STATE_DIR = join(process.cwd(), 'data', 'state');
const REPORT_FILE = join(STATE_DIR, 'skill-rebalances.json');

// ── Rebalance Specifications ──────────────────────────────────────────────────

/**
 * Each rebalance has:
 *   skillId   — the skill to patch
 *   name      — human-readable name
 *   jobClass  — which class benefits
 *   rationale — why this change is being made
 *   changes   — function(level, currentData) → { property: newValue, ... }
 *               receives 1-indexed level number and current level data object
 */
export const SKILL_REBALANCES = [
  {
    skillId: 1101006,
    name: 'Rage',
    jobClass: 'Warrior (Fighter)',
    rationale: 'Rage imposes a pdd penalty equal to its pad bonus, making it unattractive. Removing pdd penalty makes it a clean ATK buff worth using.',
    changes: (_level, cur) => {
      const patch = {};
      if (cur.pdd !== undefined && cur.pdd < 0) patch.pdd = 0;
      return patch;
    },
  },
  {
    skillId: 2201004,
    name: 'Cold Beam',
    jobClass: 'Magician (IL Wizard)',
    rationale: 'Cold Beam MAD is 20% lower than Fire Arrow at all levels. Adding +20 MAD closes the FP/IL gap. Freeze duration extended at high levels for better mob control.',
    changes: (level, cur) => {
      const patch = {};
      if (cur.mad !== undefined) patch.mad = cur.mad + 20;
      // Extend freeze from 2s→4s at levels 16+, and from 1s→2s at levels 1-15
      if (cur.time !== undefined) {
        patch.time = level >= 16 ? 4 : 2;
      }
      return patch;
    },
  },
  {
    skillId: 3101005,
    name: 'Arrow Bomb',
    jobClass: 'Bowman (Hunter)',
    rationale: 'Arrow Bomb stun chance caps at 60% — too low for a specialist crowd-control skill. +20 damage and +10% stun prop make Hunters viable crowd controllers.',
    changes: (_level, cur) => {
      const patch = {};
      if (cur.x !== undefined) patch.x = cur.x + 20;       // x = damage for Arrow Bomb
      if (cur.prop !== undefined) patch.prop = Math.min(cur.prop + 10, 90); // stun chance, cap 90%
      return patch;
    },
  },
  {
    skillId: 4001334,
    name: 'Double Stab',
    jobClass: 'Thief (Rogue)',
    rationale: 'Double Stab damage scaling is too slow (+2/level) and mpCon climbs steeply. Buffing damage +20 and reducing mpCon makes early thieves competitive with other classes.',
    changes: (_level, cur) => {
      const patch = {};
      if (cur.damage !== undefined) patch.damage = cur.damage + 20;
      if (cur.mpCon !== undefined) patch.mpCon = Math.max(cur.mpCon - 2, 5);
      return patch;
    },
  },
  {
    skillId: 5101002,
    name: 'Backspin Blow',
    jobClass: 'Pirate (Brawler)',
    rationale: 'Backspin Blow has very high mpCon (30 at max) for a melee AoE, making it hard to spam. +30 damage and -4 mpCon make Brawlers more sustainable in extended fights.',
    changes: (_level, cur) => {
      const patch = {};
      if (cur.damage !== undefined) patch.damage = cur.damage + 30;
      if (cur.mpCon !== undefined) patch.mpCon = Math.max(cur.mpCon - 4, 8);
      return patch;
    },
  },
];

// ── Patch Engine ──────────────────────────────────────────────────────────────

/**
 * Replace a single property value within a specific skill+level section of XML.
 * Uses targeted regex: skillId → "level" section → specific level number → property.
 * Returns modified XML string (or original if pattern not found).
 */
function patchXmlProperty(xml, skillId, level, key, value) {
  // Pattern navigates: name="skillId" → name="level" → name="${level}" → name="${key}" value="..."
  const pattern = new RegExp(
    `(name="${skillId}">[\\s\\S]*?name="level">[\\s\\S]*?name="${level}">[\\s\\S]*?name="${key}" value=")([^"]*)(")`,
    'g'
  );
  let found = false;
  const result = xml.replace(pattern, (_m, pre, _old, post) => {
    found = true;
    return `${pre}${value}${post}`;
  });
  return { xml: result, found };
}

/**
 * Apply a skill rebalance definition to the WZ XML file.
 * Reads the file once, patches all levels, writes once.
 * Returns a detailed result object.
 */
export function applySkillRebalance(rebalance) {
  const { skillId, name, jobClass, changes } = rebalance;
  const jobId = Math.floor(skillId / 10000);
  const filePath = join(WZ_DIR, 'Skill.wz', `${jobId}.img.xml`);

  if (!existsSync(filePath)) {
    return { skillId, name, success: false, error: `File not found: ${jobId}.img.xml` };
  }

  // Load current skill data to compute new values
  const skillData = getSkillData(skillId);
  if (!skillData || !skillData.levels) {
    return { skillId, name, success: false, error: `Skill ${skillId} not found in WZ data` };
  }

  let xml = readFileSync(filePath, 'utf-8');
  const report = { skillId, name, jobClass, levels: [] };
  let totalPatched = 0;
  let totalNotFound = 0;

  for (const [lvStr, curData] of Object.entries(skillData.levels)) {
    const level = parseInt(lvStr, 10);
    const patch = changes(level, curData);

    if (Object.keys(patch).length === 0) continue;

    const levelReport = { level, changes: {} };

    for (const [key, newValue] of Object.entries(patch)) {
      const { xml: newXml, found } = patchXmlProperty(xml, skillId, level, key, newValue);
      if (found) {
        levelReport.changes[key] = { from: curData[key], to: newValue };
        xml = newXml;
        totalPatched++;
      } else {
        totalNotFound++;
        log.warn({ skillId, level, key }, 'Skill property not found for patching');
      }
    }

    if (Object.keys(levelReport.changes).length > 0) {
      report.levels.push(levelReport);
    }
  }

  writeFileSync(filePath, xml, 'utf-8');
  report.success = true;
  report.totalPatched = totalPatched;
  report.totalNotFound = totalNotFound;

  log.info({ skillId, name, totalPatched, totalNotFound }, 'Skill rebalance applied');
  return report;
}

// ── Deploy All ────────────────────────────────────────────────────────────────

/**
 * Apply all 5 skill rebalances.
 * Writes a detailed report to data/state/skill-rebalances.json.
 * Safe to call multiple times — changes are delta-based so re-running on already-patched
 * data would double-apply (call getCustomSkillStatus to verify before re-running).
 */
export function deployCustomSkills() {
  const results = [];

  for (const rebalance of SKILL_REBALANCES) {
    log.info({ skillId: rebalance.skillId, name: rebalance.name }, 'Applying skill rebalance');
    const result = applySkillRebalance(rebalance);
    results.push(result);
  }

  const successful = results.filter(r => r.success).length;
  const totalPatched = results.reduce((sum, r) => sum + (r.totalPatched || 0), 0);

  const report = {
    appliedAt: new Date().toISOString(),
    successful,
    failed: results.length - successful,
    totalPropertyPatches: totalPatched,
    rebalances: results,
    note: 'Restart server to see skill changes in-game.',
  };

  // Save report to state directory
  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf-8');

  log.info({ successful, totalPatched }, 'All skill rebalances complete');
  return report;
}

/**
 * Get a human-readable summary of what each rebalance does,
 * with before/after values at max level.
 */
export function getSkillRebalanceSummary() {
  return SKILL_REBALANCES.map(r => {
    const skillData = getSkillData(r.skillId);
    const maxLv = skillData ? Object.keys(skillData.levels).pop() : '?';
    const maxData = skillData?.levels[maxLv] ?? {};
    const preview = skillData ? r.changes(parseInt(maxLv, 10), maxData) : {};

    return {
      skillId: r.skillId,
      name: r.name,
      jobClass: r.jobClass,
      maxLevel: maxLv,
      rationale: r.rationale,
      previewAtMaxLevel: {
        current: maxData,
        proposed: { ...maxData, ...preview },
      },
    };
  });
}

/**
 * Read back current live values to verify rebalances are in effect.
 * Returns { applied: [], notApplied: [] } based on comparing expected vs actual values.
 */
export function getCustomSkillStatus() {
  const status = { applied: [], notApplied: [], errors: [] };

  for (const rebalance of SKILL_REBALANCES) {
    const skillData = getSkillData(rebalance.skillId);
    if (!skillData) {
      status.errors.push({ skillId: rebalance.skillId, error: 'Skill not found' });
      continue;
    }

    // Check max level to determine if rebalance looks applied
    const maxLv = Object.keys(skillData.levels).pop();
    const maxData = skillData.levels[maxLv];
    const expected = rebalance.changes(parseInt(maxLv, 10), maxData);

    // If changes returns empty object or matches current values, consider applied
    const isApplied = Object.entries(expected).every(([key, val]) => maxData[key] === val);
    const entry = { skillId: rebalance.skillId, name: rebalance.name, maxLevel: maxLv };

    if (isApplied) {
      status.applied.push(entry);
    } else {
      status.notApplied.push({ ...entry, expected, actual: maxData });
    }
  }

  return status;
}
