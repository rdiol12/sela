/**
 * modules/maplestory/signals.js — MapleStory Cosmic v83 signal detectors.
 *
 * Zero-cost detectors: read local files, check server status, count content.
 * Drives the agent to proactively manage and expand the MapleStory server.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createConnection } from 'net';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('maple-signals');

// Cooldowns are handled by the agent-loop's persistent signalCooldowns system.
// No local in-memory cooldown needed here — just emit signals when there's work.

// ── Paths ──────────────────────────────────────────────────────────────────────
const COSMIC_DIR   = join(process.cwd(), 'workspace', 'Cosmic');
const SCRIPTS_DIR  = join(COSMIC_DIR, 'scripts', 'npc');
const QUESTS_DIR   = join(COSMIC_DIR, 'scripts', 'quest');
const EVENTS_DIR   = join(COSMIC_DIR, 'scripts', 'event');
const WZ_DIR       = join(COSMIC_DIR, 'wz');
const PROGRESS_FILE = join(process.cwd(), 'data', 'state', 'maple-content-progress.json');

// ── Content Tracking ────────────────────────────────────────────────────────────

/**
 * Reads or initializes the content progress tracker.
 * Tracks what the agent has created vs what's planned.
 */
function loadProgress() {
  try {
    if (existsSync(PROGRESS_FILE)) {
      return JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }
  return {
    npcsCreated: [],
    weaponsCreated: [],
    itemsCreated: [],
    skillsModified: [],
    mobsModified: [],
    dropsConfigured: [],
    questsCreated: [],
    eventsCreated: [],
    lastUpdated: 0,
  };
}

/**
 * Count existing NPC scripts to gauge server content richness.
 */
function countScripts(dir) {
  try {
    if (!existsSync(dir)) return 0;
    return readdirSync(dir).filter(f => f.endsWith('.js')).length;
  } catch { return 0; }
}

/**
 * Check if Cosmic server directory exists (i.e., server is installed).
 */
function serverInstalled() {
  return existsSync(COSMIC_DIR) && existsSync(join(COSMIC_DIR, 'config.yaml'));
}

// ── Content Work Plan ──────────────────────────────────────────────────────────
//
// The agent works through these content areas in priority order:
// 1. Custom NPCs (shops, quest givers, trainers) — most impactful for gameplay
// 2. Custom weapons & equipment — makes combat rewarding
// 3. Drop table tuning — connects mobs to loot
// 4. Skill balancing — fine-tune job progression
// 5. Custom quests — storyline content
// 6. Custom events — time-limited fun content
//
// Each area has a target count. When below target, signal fires.

const CONTENT_TARGETS = {
  customNpcs:    10,  // custom NPC scripts (shops, trainers, guides)
  customWeapons:  8,  // custom weapon/equip entries
  customItems:    8,  // custom consumable/etc items
  dropsConfigured: 15, // mobs with custom drop tables
  skillsModified:  5,  // skills rebalanced
  customQuests:    5,  // custom quest scripts
  customEvents:    3,  // custom event scripts
};

// ── TCP port check (zero-cost, ~200ms timeout) ──────────────────────────────
function checkPort(port, timeout = 2000) {
  return new Promise(resolve => {
    const sock = createConnection({ port, host: '127.0.0.1' });
    sock.setTimeout(timeout);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
    sock.once('error',   () => { sock.destroy(); resolve(false); });
  });
}

const MYSQL_PORT  = 3306;
const COSMIC_PORT = 8484; // login server

// ── Signal Detectors ────────────────────────────────────────────────────────────

export async function detectMapleSignals(state) {
  const signals = [];
  if (!serverInstalled()) return signals;

  // ── Server status check (MySQL + Cosmic) ─────────────────────────────────
  try {
    const [mysqlUp, cosmicUp] = await Promise.all([
      checkPort(MYSQL_PORT),
      checkPort(COSMIC_PORT),
    ]);

    const down = [];
    if (!mysqlUp)  down.push('MySQL (port 3306)');
    if (!cosmicUp) down.push('Cosmic login server (port 8484)');

    if (down.length > 0) {
      signals.push({
        type: 'maple_server_down',
        urgency: 'high',
        summary: `MapleStory server DOWN: ${down.join(' & ')} not responding`,
        data: { mysqlUp, cosmicUp, down },
      });
    }
  } catch (err) {
    log.warn({ err: err.message }, 'detectMapleSignals: server status check failed');
  }

  // ── Content creation signal ────────────────────────────────────────────────
  try {
      const progress = loadProgress();
      const countOf = (v) => Array.isArray(v) ? v.length : (typeof v === 'number' ? v : 0);
      const npcCount = countOf(progress.npcsCreated);
      const weaponCount = countOf(progress.weaponsCreated);
      const itemCount = countOf(progress.itemsCreated);
      const dropCount = countOf(progress.dropsConfigured ?? progress.dropsCreated);
      const skillCount = countOf(progress.skillsModified ?? progress.skillsCreated);
      const questCount = countOf(progress.questsCreated);
      const eventCount = countOf(progress.eventsCreated);

      // Find the most impactful next task
      let nextTask = null;
      let nextArea = null;

      if (npcCount < CONTENT_TARGETS.customNpcs) {
        nextTask = `Create custom NPC #${npcCount + 1} (${CONTENT_TARGETS.customNpcs - npcCount} remaining)`;
        nextArea = 'npcs';
      } else if (weaponCount < CONTENT_TARGETS.customWeapons) {
        nextTask = `Create custom weapon/equip #${weaponCount + 1} (${CONTENT_TARGETS.customWeapons - weaponCount} remaining)`;
        nextArea = 'weapons';
      } else if (itemCount < CONTENT_TARGETS.customItems) {
        nextTask = `Create custom item #${itemCount + 1} (${CONTENT_TARGETS.customItems - itemCount} remaining)`;
        nextArea = 'items';
      } else if (dropCount < CONTENT_TARGETS.dropsConfigured) {
        nextTask = `Configure drop table #${dropCount + 1} (${CONTENT_TARGETS.dropsConfigured - dropCount} remaining)`;
        nextArea = 'drops';
      } else if (skillCount < CONTENT_TARGETS.skillsModified) {
        nextTask = `Rebalance skill #${skillCount + 1} (${CONTENT_TARGETS.skillsModified - skillCount} remaining)`;
        nextArea = 'skills';
      } else if (questCount < CONTENT_TARGETS.customQuests) {
        nextTask = `Create quest #${questCount + 1} (${CONTENT_TARGETS.customQuests - questCount} remaining)`;
        nextArea = 'quests';
      } else if (eventCount < CONTENT_TARGETS.customEvents) {
        nextTask = `Create event #${eventCount + 1} (${CONTENT_TARGETS.customEvents - eventCount} remaining)`;
        nextArea = 'events';
      }

      if (nextTask) {
        const totalDone = npcCount + weaponCount + itemCount + dropCount + skillCount + questCount + eventCount;
        const totalTarget = Object.values(CONTENT_TARGETS).reduce((a, b) => a + b, 0);
        const pct = Math.round((totalDone / totalTarget) * 100);

        signals.push({
          type: 'maple_content_work',
          urgency: 'medium',
          summary: `MapleStory content: ${totalDone}/${totalTarget} (${pct}%) — next: ${nextTask}`,
          data: {
            totalDone, totalTarget, pct,
            nextTask, nextArea,
            npcCount, weaponCount, itemCount, dropCount, skillCount, questCount, eventCount,
            targets: CONTENT_TARGETS,
            progress,
          },
        });
      }
    } catch (err) {
      log.warn({ err: err.message }, 'detectMapleSignals: content check failed');
    }

  // ── Creative autonomy signal — open-ended ideation & improvement ────────
  // Fires when the basic content plan is done, or periodically alongside it.
  // The agent reviews existing content, comes up with new ideas, fixes issues.
  try {
    const progress = loadProgress();
    const countOf = (v) => Array.isArray(v) ? v.length : (typeof v === 'number' ? v : 0);
    const totalDone = countOf(progress.npcsCreated) + countOf(progress.weaponsCreated) +
      countOf(progress.itemsCreated) + countOf(progress.dropsConfigured ?? progress.dropsCreated) +
      countOf(progress.skillsModified ?? progress.skillsCreated) + countOf(progress.questsCreated) +
      countOf(progress.eventsCreated);
    const totalTarget = Object.values(CONTENT_TARGETS).reduce((a, b) => a + b, 0);
    const planComplete = totalDone >= totalTarget;

    // Count existing custom content for context
    const npcScripts = countScripts(SCRIPTS_DIR);
    const questScripts = countScripts(QUESTS_DIR);
    const eventScripts = countScripts(EVENTS_DIR);

    // Always fire if plan is complete (no more content_work signals)
    // Also fire 30% of the time alongside content_work for variety
    const shouldFire = planComplete || Math.random() < 0.3;

    if (shouldFire) {
      signals.push({
        type: 'maple_creative',
        urgency: planComplete ? 'medium' : 'low',
        summary: planComplete
          ? `Content plan complete (${totalDone}/${totalTarget}). Time to review, improve, and create new content.`
          : `Creative cycle: review existing content, brainstorm improvements, fix issues.`,
        data: {
          planComplete,
          totalDone, totalTarget,
          npcScripts, questScripts, eventScripts,
          progress,
          recentCreations: [
            ...(Array.isArray(progress.npcsCreated) ? progress.npcsCreated.slice(-3) : []),
            ...(Array.isArray(progress.weaponsCreated) ? progress.weaponsCreated.slice(-3) : []),
            ...(Array.isArray(progress.questsCreated) ? progress.questsCreated.slice(-2) : []),
          ],
        },
      });
    }
  } catch (err) {
    log.warn({ err: err.message }, 'detectMapleSignals: creative check failed');
  }

  // ── Map visual quality check ────────────────────────────────────────────
  // Detects custom maps that are missing visual layers (back/tile/obj)
  try {
    const customMapRanges = [
      { dir: 'Map1', start: 101050000, end: 101050099, label: 'Sage Hall' },
      { dir: 'Map9', start: 990100000, end: 990100099, label: "Sage's Spire" },
    ];
    const brokenMaps = [];
    for (const range of customMapRanges) {
      const mapDir = join(WZ_DIR, 'Map.wz', 'Map', range.dir);
      if (!existsSync(mapDir)) continue;
      try {
        const files = readdirSync(mapDir).filter(f => f.endsWith('.img.xml'));
        for (const file of files) {
          const mapId = parseInt(file.replace('.img.xml', ''));
          if (mapId >= range.start && mapId <= range.end) {
            const xml = readFileSync(join(mapDir, file), 'utf-8');
            const hasBack = xml.includes('name="back"') && xml.includes('name="bS"');
            const hasTile = xml.includes('name="tS"') && xml.includes('name="tile"');
            if (!hasBack || !hasTile) {
              brokenMaps.push({ mapId: String(mapId), label: range.label, hasBack, hasTile });
            }
          }
        }
      } catch { /* skip */ }
    }
    if (brokenMaps.length > 0) {
      signals.push({
        type: 'maple_map_work',
        urgency: 'medium',
        summary: `${brokenMaps.length} custom map(s) missing visuals (no background/tiles): ${brokenMaps.map(m => m.mapId).join(', ')}`,
        data: { brokenMaps },
      });
    }
  } catch (err) {
    log.warn({ err: err.message }, 'detectMapleSignals: map quality check failed');
  }

  // ── Log error detection (scan main log for recent errors) ────────────────
  try {
    const mainLog = join(COSMIC_DIR, 'cosmic-log.log');
    if (existsSync(mainLog)) {
      const content = readFileSync(mainLog, 'utf-8');
      const lines = content.split('\n');
      // Check last 100 lines for errors
      const recent = lines.slice(-100);
      const errors = recent.filter(l => /\b(ERROR|SEVERE|Exception|OutOfMemory|crash)\b/i.test(l));
      if (errors.length >= 3) {
        signals.push({
          type: 'maple_log_errors',
          urgency: 'medium',
          summary: `MapleStory server has ${errors.length} recent errors in log`,
          data: { errorCount: errors.length, samples: errors.slice(-5) },
        });
      }
    }
  } catch (err) {
    log.warn({ err: err.message }, 'detectMapleSignals: log check failed');
  }

  // ── WZ compilation check — detect stale client WZ files ──────────────────
  try {
    const { isWzStale } = await import('./server-manager.js');
    const staleInfo = isWzStale();
    if (staleInfo.stale) {
      signals.push({
        type: 'maple_wz_stale',
        urgency: 'medium',
        summary: `Client WZ files are out of date: ${staleInfo.reason}. Compile and upload to keep Ron's client in sync.`,
        data: staleInfo,
      });
    }
  } catch (err) {
    log.warn({ err: err.message }, 'detectMapleSignals: WZ stale check failed');
  }

  return signals;
}
