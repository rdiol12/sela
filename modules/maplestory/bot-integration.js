/**
 * modules/maplestory/bot-integration.js — Bot + Custom Content Integration Analysis
 *
 * Research and planning module for "better bot integration".
 *
 * Performs a gap analysis between:
 *   - Deployed custom content (Sage class, Sage Hall maps, custom quests/NPCs)
 *   - Current bot capabilities in bot-brain.js / bot-manager.js
 *
 * Exports:
 *   getBotIntegrationReport()  — full gap analysis with improvement proposals
 *   getSageJobPath()           — Sage class JOB_ADVANCEMENT config to patch into bot-brain
 *   getSageTrainingSpots()     — Sage Hall training spot data for bot-brain TRAINING_SPOTS
 *   getSageQuestHandlers()     — Quest 99210/99211/99212 data for bot quest awareness
 *
 * Wired into index.js as: maple_bot_integration
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('maple:bot-integration');

const WZ_DIR  = process.env.COSMIC_WZ_DIR   || join(process.cwd(), 'workspace/Cosmic/wz');
const SCR_DIR = process.env.COSMIC_SCRIPTS_DIR || join(process.cwd(), 'workspace/Cosmic/scripts');
const STATE_FILE = join(process.cwd(), 'data/state/maple-bots.json');

// ── Sage Class Job Advancement Config ───────────────────────────────────────
// Proposed addition to bot-brain.js JOB_ADVANCEMENT dict.
// NPC: Sage Instructor Elara (9999030) in Sage Hall (101050000).

export const SAGE_JOB_PATH = {
  classType: 'sage',
  description: 'Custom Sage class — unique to this Cosmic server. Arcane magic, elemental mastery.',
  advancementNpcId: 9999030,       // Sage Instructor Elara
  advancementMapId: 101050000,     // Sage Hall
  firstJob:  { level: 10, npcId: 9999030, mapId: 101050000, jobId: 600, name: 'Sage' },
  secondJob: { level: 30, npcId: 9999030, mapId: 101050000, name: '2nd Job Sage' },
  secondJobChoices: [
    { jobId: 610, name: 'Elementalist' },
  ],
  thirdJob: { level: 70, npcId: 9999030, mapId: 101050000, name: '3rd Job Sage' },
  thirdJobChoices: [
    { fromJob: 610, jobId: 611, name: 'Arcanum' },
  ],
  fourthJob: { level: 120, npcId: 9999030, mapId: 101050000, name: '4th Job Sage' },
  fourthJobChoices: [
    { fromJob: 611, jobId: 612, name: 'Archsage' },
  ],
  jobIdChain: [0, 600, 610, 611, 612],
  weapons: ['staff', 'wand'],       // Sage uses Runic Orb / Arcane Scepter / Prism Staff
};

// ── Sage Hall Training Spots ─────────────────────────────────────────────────
// Proposed additions to bot-brain.js TRAINING_SPOTS array.

export const SAGE_TRAINING_SPOTS = [
  {
    minLv: 1, maxLv: 10,
    maps: [101050001],  // Sage Training Ground — Green Snails + Red Snails (for quest 99210)
    label: 'Sage Training Ground (early)',
    mobs: ['Green Snail', 'Red Snail'],
    notes: 'Quest 99210 item drops here (Green Snail Shell)',
  },
  {
    minLv: 8, maxLv: 15,
    maps: [101050001],  // Sage Training Ground — Shrooms (for quest 99211)
    label: 'Sage Training Ground (shrooms)',
    mobs: ['Shroom'],
    notes: 'Quest 99211 item drops here (Shroom Cap)',
  },
  {
    minLv: 15, maxLv: 30,
    maps: [101050002],  // Sage Inner Sanctum — Horny Mushrooms + Curse Eyes (for quest 99212)
    label: 'Sage Inner Sanctum',
    mobs: ['Horny Mushroom', 'Curse Eye', 'Jr Wraith', 'Zombie Mushroom'],
    notes: 'Quest 99212 items drop here (Horny Mushroom Spore + Curse Eye Tail)',
  },
];

// ── Sage Hall Quest Handlers ─────────────────────────────────────────────────
// Proposed additions to bot-brain.js quest awareness.

export const SAGE_QUESTS = [
  {
    questId: 99210,
    name: 'A New Beginning',
    minLevel: 1,
    npcId: 9999030,
    mapId: 101050000,
    requirements: [{ itemId: 4000000, count: 10, name: 'Green Snail Shell' }],
    trainMap: 101050001,
    rewards: { exp: 500, meso: 5000 },
  },
  {
    questId: 99211,
    name: 'The Shroom Menace',
    minLevel: 8,
    npcId: 9999030,
    mapId: 101050000,
    requirements: [{ itemId: 4000019, count: 15, name: 'Shroom Cap' }],
    trainMap: 101050001,
    rewards: { exp: 2000, meso: 15000 },
  },
  {
    questId: 99212,
    name: 'Awakening the Inner Sanctum',
    minLevel: 15,
    npcId: 9999030,
    mapId: 101050000,
    requirements: [
      { itemId: 4000024, count: 20, name: 'Horny Mushroom Spore' },
      { itemId: 4000005, count: 10, name: 'Curse Eye Tail' },
    ],
    trainMap: 101050002,
    rewards: { exp: 8000, meso: 40000, items: [{ itemId: 1372080, count: 1, name: 'Runic Orb' }] },
  },
];

// ── Gap Analysis ─────────────────────────────────────────────────────────────

function checkCustomContent() {
  const gaps = [];
  const present = [];

  // Check deployed maps
  const maps = ['101050000', '101050001', '101050002'];
  for (const mapId of maps) {
    const p = join(WZ_DIR, 'Map.wz', 'Map', 'Map1', `${mapId}.img.xml`);
    if (existsSync(p)) {
      present.push(`Map ${mapId} deployed`);
    } else {
      gaps.push({ severity: 'critical', area: 'maps', item: mapId, detail: `Map ${mapId}.img.xml missing from WZ` });
    }
  }

  // Check NPC script
  const npcPath = join(SCR_DIR, 'npc', '9999030.js');
  if (existsSync(npcPath)) {
    present.push('NPC 9999030 (Elara) script deployed');
  } else {
    gaps.push({ severity: 'critical', area: 'npc', item: '9999030', detail: 'Sage Instructor Elara NPC script missing' });
  }

  // Check quest scripts
  for (const q of [99210, 99211, 99212]) {
    const qPath = join(SCR_DIR, 'quest', `${q}.js`);
    if (existsSync(qPath)) {
      present.push(`Quest ${q} script deployed`);
    } else {
      gaps.push({ severity: 'high', area: 'quests', item: String(q), detail: `Quest ${q} script missing` });
    }
  }

  return { gaps, present };
}

function checkBotBrainGaps() {
  // We know bot-brain.js contents from static analysis; return known gaps
  const gaps = [];

  gaps.push({
    severity: 'high',
    area: 'bot-brain.js — JOB_ADVANCEMENT',
    item: 'sage',
    detail: 'JOB_ADVANCEMENT dict has warrior/mage/archer/thief/pirate but NO sage (600/610/611/612). Bots with classType=sage fail canAdvanceJob().',
    fix: 'Add SAGE_JOB_PATH from bot-integration.js to JOB_ADVANCEMENT.sage',
    effort: 'small — append 12 lines to bot-brain.js',
  });

  gaps.push({
    severity: 'medium',
    area: 'bot-brain.js — TRAINING_SPOTS',
    item: 'Sage Hall maps',
    detail: 'TRAINING_SPOTS array has no entries for 101050001 (Training Ground) or 101050002 (Inner Sanctum). Sage bots default to Henesys (100000000) regardless of class.',
    fix: 'Add SAGE_TRAINING_SPOTS entries to TRAINING_SPOTS in bot-brain.js',
    effort: 'small — 3 training spot objects',
  });

  gaps.push({
    severity: 'medium',
    area: 'bot-brain.js — getAvailableQuests()',
    item: 'Sage Hall quests',
    detail: 'getAvailableQuests() has no knowledge of quests 99210/99211/99212. Sage bots will never attempt the Sage Hall quest chain.',
    fix: 'Add SAGE_QUESTS to quest detection logic in getAvailableQuests()',
    effort: 'medium — needs custom item-count quest logic',
  });

  gaps.push({
    severity: 'low',
    area: 'bot-manager.js — PERSONALITIES',
    item: 'sage personality type',
    detail: 'PERSONALITIES list has warrior/mage/archer/thief types only. No sage-type bot personality exists for idle chat (arcane humor, spells, etc).',
    fix: 'Add 2-3 sage-type personalities to PERSONALITIES array in bot-manager.js',
    effort: 'trivial — copy pattern from existing personalities',
  });

  gaps.push({
    severity: 'low',
    area: 'bot-brain.js — getContextResponse()',
    item: 'sage job context',
    detail: 'getContextResponse() has class-specific dialog for warrior/archer/thief/mage but sage bots will return generic responses.',
    fix: 'Add sage case to classType switch in getContextResponse()',
    effort: 'trivial — 5-6 chat lines',
  });

  gaps.push({
    severity: 'low',
    area: 'health-check.js',
    item: 'bot state monitoring',
    detail: 'runHealthCheck() checks maps/NPCs/quests/WZ files but does NOT check bot state (STATE_FILE: data/state/maple-bots.json). Cannot detect if bots are disconnected or stuck.',
    fix: 'Add checkBotState() function to health-check.js',
    effort: 'small — read STATE_FILE + check lastSeen timestamps',
  });

  return gaps;
}

function checkBotState() {
  if (!existsSync(STATE_FILE)) {
    return { hasBots: false, botCount: 0, note: 'No bot state file (bots never spawned or state cleared)' };
  }
  try {
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    const bots = state.bots || [];
    const active = bots.filter(b => b.status === 'connected' || b.status === 'active');
    const sageBots = bots.filter(b => b.classType === 'sage' || (b.jobId >= 600 && b.jobId <= 612));
    return {
      hasBots: bots.length > 0,
      botCount: bots.length,
      activeBots: active.length,
      sageBots: sageBots.length,
      botNames: bots.slice(0, 5).map(b => b.name),
      stateFile: STATE_FILE,
    };
  } catch (e) {
    return { hasBots: false, error: e.message };
  }
}

// ── Main Report ──────────────────────────────────────────────────────────────

/**
 * Produce a full integration gap analysis and improvement proposal.
 * @returns {object} report with gaps, present content, proposals, effort estimates
 */
export function getBotIntegrationReport() {
  const customContent = checkCustomContent();
  const brainGaps = checkBotBrainGaps();
  const botState = checkBotState();

  const allGaps = [
    ...customContent.gaps,  // infrastructure gaps (missing files)
    ...brainGaps,            // logic gaps in bot-brain/manager
  ];

  const byPriority = {
    critical: allGaps.filter(g => g.severity === 'critical'),
    high:     allGaps.filter(g => g.severity === 'high'),
    medium:   allGaps.filter(g => g.severity === 'medium'),
    low:      allGaps.filter(g => g.severity === 'low'),
  };

  const proposals = [
    {
      id: 'prop_1',
      title: 'Add Sage class to bot-brain.js JOB_ADVANCEMENT',
      priority: 'high',
      effort: 'small (~30min)',
      impact: 'Bots can now advance through Sage → Elementalist → Arcanum → Archsage via Elara NPC',
      detail: 'Import SAGE_JOB_PATH from bot-integration.js, add as JOB_ADVANCEMENT.sage in bot-brain.js. Update getClassType() to include jobId range 600-612 → returns "sage".',
    },
    {
      id: 'prop_2',
      title: 'Add Sage Hall training spots to TRAINING_SPOTS',
      priority: 'medium',
      effort: 'small (~20min)',
      impact: 'Sage bots train in appropriate maps (Training Ground lv1-15, Inner Sanctum lv15-30) instead of defaulting to Henesys',
      detail: 'Import SAGE_TRAINING_SPOTS from bot-integration.js, concat into TRAINING_SPOTS array in bot-brain.js.',
    },
    {
      id: 'prop_3',
      title: 'Add Sage Hall quest chain to bot quest awareness',
      priority: 'medium',
      effort: 'medium (~1hr)',
      impact: 'Sage bots auto-attempt quests 99210→99211→99212, earning EXP/meso and the Runic Orb reward',
      detail: 'Import SAGE_QUESTS, add item-collection quest logic to getAvailableQuests() and quest turn-in handling in bot-manager.js questTick().',
    },
    {
      id: 'prop_4',
      title: 'Add sage personality types to PERSONALITIES',
      priority: 'low',
      effort: 'trivial (~15min)',
      impact: 'Sage bots have thematic chat (arcane spells, studying, reading tomes) fitting the class lore',
      detail: 'Add 3-4 sage-type personality entries to PERSONALITIES array in bot-manager.js with appropriate greetings/idle/responses.',
    },
    {
      id: 'prop_5',
      title: 'Add bot state monitoring to health-check.js',
      priority: 'low',
      effort: 'small (~30min)',
      impact: 'Health check can detect disconnected/stuck bots and report them in runHealthCheck() output',
      detail: 'Add checkBotState() to health-check.js that reads data/state/maple-bots.json and checks lastSeen timestamps for staleness.',
    },
  ];

  log.info({ gapCount: allGaps.length, proposalCount: proposals.length }, 'Bot integration report generated');

  return {
    timestamp: new Date().toISOString(),
    summary: {
      totalGaps: allGaps.length,
      criticalGaps: byPriority.critical.length,
      highGaps: byPriority.high.length,
      mediumGaps: byPriority.medium.length,
      lowGaps: byPriority.low.length,
      customContentHealthy: customContent.gaps.length === 0,
      deployedContent: customContent.present,
    },
    botState,
    gaps: byPriority,
    proposals,
    sageConfig: {
      jobPath: SAGE_JOB_PATH,
      trainingSpots: SAGE_TRAINING_SPOTS,
      quests: SAGE_QUESTS,
    },
    implementationOrder: proposals.map(p => `${p.id}: ${p.title} [${p.priority}/${p.effort}]`),
  };
}

/**
 * Return the Sage class job advancement config for patching into bot-brain.js.
 */
export function getSageJobPath() {
  return SAGE_JOB_PATH;
}

/**
 * Return training spot data for Sage Hall maps.
 */
export function getSageTrainingSpots() {
  return SAGE_TRAINING_SPOTS;
}

/**
 * Return Sage Hall quest data for bot quest awareness.
 */
export function getSageQuestHandlers() {
  return SAGE_QUESTS;
}
