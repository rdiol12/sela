/**
 * modules/unreal/willpower-tracker.js — Willpower tracking + ending synthesis.
 *
 * Mirrors the C++ subsystems:
 *   - USCCorruptionWhisperSubsystem (willpower score, resistance/compliance)
 *   - USCEndingSynthesisSubsystem  (5 final paths, 6 trajectories, 25+ permutations)
 *
 * Provides:
 *   1. Willpower data model (outcome registration, context tags, pending windows)
 *   2. Ending synthesis (5 paths, 6 trajectories, ending component assembly)
 *   3. BP_WillpowerTracker + BP_EndingSynthesis blueprint creation via UE5 MCP
 *   4. Data tables for ending permutations
 *
 * ms_7: "Willpower tracking and ending integration" for Corruption Whispers goal.
 */

import { callTool } from '../../lib/mcp-gateway.js';
import { createLogger } from '../../lib/logger.js';
import { getActiveGame } from './game-config.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const log = createLogger('willpower-tracker');

// ── UE5 MCP helper ──────────────────────────────────────────────────────────

async function ue(tool, args = {}, timeout = 60_000) {
  try {
    return await callTool('unreal', tool, args, timeout);
  } catch (err) {
    log.warn(`UE5 call failed: ${tool} — ${err.message}`);
    return { status: 'error', error: err.message };
  }
}

// ── Constants matching C++ enums ─────────────────────────────────────────────

/** ESCFinalPath — 5 ending paths */
export const FINAL_PATHS = {
  REDEEMER:    'Redeemer',     // High willpower, low corruption → purification
  ARBITER:     'Arbiter',      // Balanced willpower → judgment/balance
  MARTYR:      'Martyr',       // Willpower >= 0.5, self-sacrifice
  VESSEL:      'Vessel',       // Low willpower, high corruption → crown's puppet
  HOLLOW_KING: 'HollowKing',  // Very low willpower, max corruption → reborn tyrant
};

/** ESCFinalChoice — player's final summit decision */
export const FINAL_CHOICES = {
  PURIFY:         'Purify',         // Destroy all shards
  MERGE:          'Merge',          // Merge shards into a balanced crown
  SHATTER:        'Shatter',        // Shatter crown, scatter shards
  CLAIM:          'Claim',          // Claim the crown's full power
  SELF_SACRIFICE: 'SelfSacrifice',  // Give life to seal corruption forever
};

/** ESCCorruptionTrajectory — how corruption changed over the playthrough */
export const TRAJECTORIES = {
  PURE_HEART:      'PureHeart',      // Stayed low throughout
  SLOW_DESCENT:    'SlowDescent',    // Gradual steady rise
  FALLEN_REDEEMED: 'FallenRedeemed', // Peaked then pulled back
  TORN_SOUL:       'TornSoul',       // Oscillated back and forth
  CONSUMED:        'Consumed',       // Rapid rise to max
  BORN_DARK:       'BornDark',       // High from the beginning
};

/** ESCWhisperTrigger — gameplay events that can produce willpower decisions */
export const WILLPOWER_EVENTS = [
  'idle', 'combat_start', 'enemy_kill', 'low_health', 'shard_pickup',
  'shard_use', 'corruption_threshold', 'npc_dialogue', 'boss_encounter',
  'death', 'respawn', 'area_enter', 'item_pickup', 'level_up',
  'whisper_heard', 'whisper_obeyed', 'whisper_resisted',
];

// ── Willpower outcome tracking ───────────────────────────────────────────────

/**
 * Context tags for willpower decisions — maps gameplay situations to
 * resistance/compliance semantics.
 *
 * Each tag defines:
 *   - label: human-readable description
 *   - weight: impact multiplier (1.0 = normal, 0.5 = minor, 2.0 = major)
 *   - windowSec: how long the outcome window stays open (player has this long to decide)
 */
export const OUTCOME_CONTEXTS = {
  whisper_obey:      { label: 'Obeyed a corruption whisper',       weight: 1.0, windowSec: 0   },
  whisper_resist:    { label: 'Resisted a corruption whisper',     weight: 1.0, windowSec: 0   },
  shard_overuse:     { label: 'Used shard ability despite warning',weight: 1.5, windowSec: 10  },
  shard_restrain:    { label: 'Chose not to use shard power',      weight: 1.5, windowSec: 10  },
  dialogue_corrupt:  { label: 'Chose corrupted dialogue option',   weight: 1.0, windowSec: 30  },
  dialogue_pure:     { label: 'Chose pure dialogue option',        weight: 1.0, windowSec: 30  },
  npc_harm:          { label: 'Harmed an innocent NPC',            weight: 2.0, windowSec: 0   },
  npc_spare:         { label: 'Spared a surrendering enemy',       weight: 1.5, windowSec: 15  },
  boss_mercy:        { label: 'Showed mercy to shard-bearer boss', weight: 2.0, windowSec: 30  },
  boss_consume:      { label: 'Consumed a shard-bearer\'s essence',weight: 2.0, windowSec: 30  },
  crown_fragment:    { label: 'Chose to absorb crown fragment',    weight: 2.5, windowSec: 60  },
  crown_destroy:     { label: 'Chose to destroy crown fragment',   weight: 2.5, windowSec: 60  },
  corruption_surge:  { label: 'Let corruption surge go unchecked', weight: 1.0, windowSec: 5   },
  corruption_purge:  { label: 'Purged corruption at a shrine',     weight: 1.0, windowSec: 0   },
  companion_betray:  { label: 'Betrayed companion trust',          weight: 2.0, windowSec: 0   },
  companion_loyal:   { label: 'Stayed loyal to companion',         weight: 1.5, windowSec: 0   },
  dark_path_enter:   { label: 'Entered a dark path willingly',     weight: 1.0, windowSec: 120 },
  dark_path_refuse:  { label: 'Refused to enter dark path',        weight: 1.0, windowSec: 120 },
};

/** Compliance contexts (willpower goes down when these fire) */
const COMPLIANCE_TAGS = new Set([
  'whisper_obey', 'shard_overuse', 'dialogue_corrupt', 'npc_harm',
  'boss_consume', 'crown_fragment', 'corruption_surge', 'companion_betray',
  'dark_path_enter',
]);

/** Resistance contexts (willpower goes up when these fire) */
const RESISTANCE_TAGS = new Set([
  'whisper_resist', 'shard_restrain', 'dialogue_pure', 'npc_spare',
  'boss_mercy', 'crown_destroy', 'corruption_purge', 'companion_loyal',
  'dark_path_refuse',
]);

// ── Ending path definitions ──────────────────────────────────────────────────

/**
 * Ending path requirements — matches DetermineFinalPath() in C++.
 * Each path has thresholds for willpower score and corruption.
 */
export const ENDING_PATH_RULES = [
  {
    path: FINAL_PATHS.REDEEMER,
    willpowerMin: 0.7,
    willpowerMax: 1.0,
    corruptionMax: 0.3,
    description: 'The hero who overcame the crown\'s corruption through sheer will. Kael purifies all shards and sacrifices the crown\'s power for the realm\'s safety.',
    availableChoices: ['Purify', 'SelfSacrifice'],
    toneKeywords: ['triumphant', 'bittersweet', 'hopeful'],
  },
  {
    path: FINAL_PATHS.ARBITER,
    willpowerMin: 0.4,
    willpowerMax: 0.7,
    corruptionMax: 0.6,
    description: 'Neither fully pure nor fully corrupted. Kael becomes the crown\'s judge, wielding its power with wisdom — a balanced but lonely ruler.',
    availableChoices: ['Merge', 'Shatter', 'Purify'],
    toneKeywords: ['contemplative', 'balanced', 'authoritative'],
  },
  {
    path: FINAL_PATHS.MARTYR,
    willpowerMin: 0.5,
    willpowerMax: 1.0,
    corruptionMax: 0.8,
    description: 'Despite the corruption, Kael\'s will endured. The ultimate sacrifice — giving life to seal the corruption forever. A hero\'s death.',
    availableChoices: ['SelfSacrifice', 'Purify'],
    toneKeywords: ['tragic', 'heroic', 'solemn'],
    requiresSelfSacrifice: true,
  },
  {
    path: FINAL_PATHS.VESSEL,
    willpowerMin: 0.15,
    willpowerMax: 0.4,
    corruptionMax: 1.0,
    description: 'The crown\'s influence consumed Kael\'s identity. A puppet king on a puppet throne — the Hollow Crown\'s will made flesh.',
    availableChoices: ['Claim', 'Merge'],
    toneKeywords: ['ominous', 'hollow', 'resigned'],
  },
  {
    path: FINAL_PATHS.HOLLOW_KING,
    willpowerMin: 0.0,
    willpowerMax: 0.15,
    corruptionMax: 1.0,
    description: 'Kael IS the crown now. Not a puppet — a reborn tyrant. The Hollow King rises again, and this time the realm may not survive.',
    availableChoices: ['Claim'],
    toneKeywords: ['terrifying', 'dark', 'absolute'],
  },
];

// ── Trajectory analysis ──────────────────────────────────────────────────────

/**
 * Analyze a corruption history array to determine the trajectory type.
 * Matches AnalyzeCorruptionTrajectory() in C++.
 *
 * @param {number[]} corruptionHistory - Array of corruption samples (0.0–1.0) over time.
 * @returns {{ trajectory: string, confidence: number, description: string }}
 */
export function analyzeTrajectory(corruptionHistory) {
  if (!corruptionHistory || corruptionHistory.length < 3) {
    return { trajectory: TRAJECTORIES.PURE_HEART, confidence: 0.5, description: 'Insufficient data' };
  }

  const first = corruptionHistory[0];
  const last = corruptionHistory[corruptionHistory.length - 1];
  const peak = Math.max(...corruptionHistory);
  const avg = corruptionHistory.reduce((s, v) => s + v, 0) / corruptionHistory.length;
  const mid = corruptionHistory[Math.floor(corruptionHistory.length / 2)];

  // Count direction changes (oscillation detection)
  let dirChanges = 0;
  for (let i = 2; i < corruptionHistory.length; i++) {
    const d1 = corruptionHistory[i - 1] - corruptionHistory[i - 2];
    const d2 = corruptionHistory[i] - corruptionHistory[i - 1];
    if ((d1 > 0.05 && d2 < -0.05) || (d1 < -0.05 && d2 > 0.05)) dirChanges++;
  }

  // BornDark: started high (>= 0.6) and stayed high
  if (first >= 0.6 && avg >= 0.5) {
    return { trajectory: TRAJECTORIES.BORN_DARK, confidence: 0.85, description: 'High corruption from the start — embraced darkness early' };
  }

  // PureHeart: stayed low throughout
  if (peak < 0.3 && avg < 0.2) {
    return { trajectory: TRAJECTORIES.PURE_HEART, confidence: 0.9, description: 'Minimal corruption throughout — a pure-hearted journey' };
  }

  // Consumed: rapid rise to high levels
  if (last >= 0.7 && (last - first) > 0.5 && dirChanges <= 2) {
    return { trajectory: TRAJECTORIES.CONSUMED, confidence: 0.85, description: 'Rapid corruption escalation — consumed by the crown\'s power' };
  }

  // TornSoul: lots of oscillation
  if (dirChanges >= 3) {
    return { trajectory: TRAJECTORIES.TORN_SOUL, confidence: 0.7 + dirChanges * 0.03, description: 'Corruption oscillated — a soul torn between light and dark' };
  }

  // FallenRedeemed: peaked then came back down
  if (peak >= 0.5 && last < peak - 0.2 && mid > first) {
    return { trajectory: TRAJECTORIES.FALLEN_REDEEMED, confidence: 0.8, description: 'Corruption peaked then receded — fell but found redemption' };
  }

  // SlowDescent: gradual steady rise
  if (last > first + 0.15 && dirChanges <= 2) {
    return { trajectory: TRAJECTORIES.SLOW_DESCENT, confidence: 0.75, description: 'Gradual corruption rise — a slow descent into darkness' };
  }

  // Default: closest match by corruption level
  return last > 0.5
    ? { trajectory: TRAJECTORIES.SLOW_DESCENT, confidence: 0.5, description: 'Moderate corruption growth' }
    : { trajectory: TRAJECTORIES.PURE_HEART, confidence: 0.5, description: 'Relatively pure journey' };
}

// ── Ending synthesis ─────────────────────────────────────────────────────────

/**
 * Ending components — narrative building blocks assembled based on
 * path + trajectory + choices + boss resolutions.
 * Matches FSCEndingComponent in C++.
 */
export const ENDING_COMPONENTS = {
  // Crown resolution
  crown_purified:     { id: 'crown_purified',     label: 'Crown purified and destroyed',        category: 'crown' },
  crown_merged:       { id: 'crown_merged',        label: 'Crown merged into balanced power',    category: 'crown' },
  crown_shattered:    { id: 'crown_shattered',     label: 'Crown shattered, shards scattered',   category: 'crown' },
  crown_claimed:      { id: 'crown_claimed',       label: 'Crown claimed, full power absorbed',  category: 'crown' },
  crown_sealed:       { id: 'crown_sealed',        label: 'Crown sealed with hero\'s life force',category: 'crown' },

  // Kael's fate
  kael_hero:          { id: 'kael_hero',           label: 'Kael remembered as hero of the realm', category: 'kael' },
  kael_ruler:         { id: 'kael_ruler',          label: 'Kael becomes balanced ruler',           category: 'kael' },
  kael_sacrifice:     { id: 'kael_sacrifice',      label: 'Kael sacrifices self, dies a hero',     category: 'kael' },
  kael_puppet:        { id: 'kael_puppet',         label: 'Kael becomes crown\'s puppet king',     category: 'kael' },
  kael_reborn_tyrant: { id: 'kael_reborn_tyrant',  label: 'Kael IS the Hollow King reborn',        category: 'kael' },

  // Companion outcomes
  lira_loyal:         { id: 'lira_loyal',          label: 'Lira stays loyal, joins Kael\'s cause',  category: 'companion' },
  lira_betrayed:      { id: 'lira_betrayed',       label: 'Lira betrayed, turns against Kael',      category: 'companion' },
  lira_mourns:        { id: 'lira_mourns',         label: 'Lira mourns Kael\'s sacrifice',           category: 'companion' },
  lira_serves:        { id: 'lira_serves',         label: 'Lira serves the new Hollow King',          category: 'companion' },

  // Realm outcomes
  realm_peace:        { id: 'realm_peace',         label: 'Realm enters an era of peace',             category: 'realm' },
  realm_balance:      { id: 'realm_balance',       label: 'Realm stabilized under new order',          category: 'realm' },
  realm_scattered:    { id: 'realm_scattered',      label: 'Realm fractured, new shard wars begin',    category: 'realm' },
  realm_enslaved:     { id: 'realm_enslaved',       label: 'Realm falls under tyrant\'s shadow',       category: 'realm' },
  realm_darkness:     { id: 'realm_darkness',       label: 'Eternal darkness covers the realm',         category: 'realm' },

  // Post-credits hooks
  hook_new_hero:      { id: 'hook_new_hero',       label: 'A new hero finds a scattered shard',        category: 'hook' },
  hook_kael_whisper:  { id: 'hook_kael_whisper',    label: 'Kael\'s whisper echoes in the void',        category: 'hook' },
  hook_crown_stirs:   { id: 'hook_crown_stirs',     label: 'The sealed crown stirs once more',          category: 'hook' },
};

/**
 * Synthesize the ending based on all player inputs.
 * Matches SynthesizeEnding() in C++.
 *
 * @param {Object} inputs
 * @param {number} inputs.willpowerScore    - 0.0 to 1.0
 * @param {number} inputs.finalCorruption   - 0.0 to 1.0
 * @param {number} inputs.peakCorruption    - highest corruption reached
 * @param {number[]} inputs.corruptionHistory - samples over time
 * @param {number} inputs.whispersHeard     - total whispers triggered
 * @param {number} inputs.whispersResisted  - whispers the player resisted
 * @param {number} inputs.totalDeaths       - player death count
 * @param {number} inputs.explorationPct    - 0.0 to 1.0 world explored
 * @param {number} inputs.secretsFound      - hidden areas/items discovered
 * @param {Object} inputs.bossResolutions   - { bossId: 'mercy'|'consume'|'spare' }
 * @param {string} inputs.finalChoice       - player's summit choice from FINAL_CHOICES
 * @returns {Object} FSCSynthesizedEnding equivalent
 */
export function synthesizeEnding(inputs) {
  const {
    willpowerScore = 0.5,
    finalCorruption = 0.0,
    peakCorruption = 0.0,
    corruptionHistory = [],
    whispersHeard = 0,
    whispersResisted = 0,
    totalDeaths = 0,
    explorationPct = 0.0,
    secretsFound = 0,
    bossResolutions = {},
    finalChoice = null,
  } = inputs;

  // 1. Determine trajectory
  const trajectoryResult = analyzeTrajectory(corruptionHistory);

  // 2. Determine final path
  const path = determineFinalPath(willpowerScore, finalCorruption);

  // 3. Get available choices for this path
  const pathRule = ENDING_PATH_RULES.find(r => r.path === path);
  const availableChoices = pathRule?.availableChoices || ['Merge'];

  // 4. Validate final choice — if player's choice isn't available, force the first valid one
  const resolvedChoice = (finalChoice && availableChoices.includes(finalChoice))
    ? finalChoice
    : availableChoices[0];

  // 5. Resolve shard-bearer fates from boss resolutions
  const shardBearerFates = resolveShardBearerFates(bossResolutions, willpowerScore);

  // 6. Assemble ending components
  const components = assembleComponents(path, resolvedChoice, trajectoryResult.trajectory, willpowerScore, shardBearerFates);

  // 7. Generate ending hash (unique permutation identifier)
  const hashInput = `${path}|${resolvedChoice}|${trajectoryResult.trajectory}|${willpowerScore.toFixed(2)}|${finalCorruption.toFixed(2)}|${Object.values(bossResolutions).sort().join(',')}`;
  const endingHash = simpleHash(hashInput);

  return {
    finalPath: path,
    trajectory: trajectoryResult.trajectory,
    trajectoryConfidence: trajectoryResult.confidence,
    trajectoryDescription: trajectoryResult.description,
    availableChoices,
    resolvedChoice,
    shardBearerFates,
    components,

    // Input summary
    willpowerScore,
    whispersHeard,
    whispersResisted,
    finalCorruption,
    peakCorruption,
    totalDeaths,
    explorationPct,
    secretsFound,
    endingHash,

    // Narrative metadata
    pathDescription: pathRule?.description || '',
    toneKeywords: pathRule?.toneKeywords || [],
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function determineFinalPath(willpowerScore, corruption) {
  // Walk rules in priority order — first match wins
  for (const rule of ENDING_PATH_RULES) {
    if (willpowerScore >= rule.willpowerMin &&
        willpowerScore <= rule.willpowerMax &&
        corruption <= rule.corruptionMax) {
      return rule.path;
    }
  }
  // Fallback: very corrupted + low willpower → Hollow King
  return willpowerScore < 0.2 ? FINAL_PATHS.HOLLOW_KING : FINAL_PATHS.VESSEL;
}

function resolveShardBearerFates(bossResolutions, willpowerScore) {
  const SHARD_BEARERS = [
    { id: 'gorrath',  name: 'Gorrath the Ashen',    shard: 'Fire' },
    { id: 'seravyn',  name: 'Seravyn of the Deep',  shard: 'Water' },
    { id: 'thaldris', name: 'Thaldris Ironbound',   shard: 'Shield' },
    { id: 'vyrel',    name: 'Vyrel the Verdant',     shard: 'Nature' },
    { id: 'nihara',   name: 'Nihara the Void',       shard: 'Shadow' },
  ];

  return SHARD_BEARERS.map(bearer => {
    const resolution = bossResolutions[bearer.id] || 'consume';
    let fate;
    if (resolution === 'mercy') {
      fate = willpowerScore >= 0.5 ? 'redeemed' : 'resentful';
    } else if (resolution === 'spare') {
      fate = 'exiled';
    } else {
      fate = 'consumed';
    }
    return { ...bearer, resolution, fate };
  });
}

function assembleComponents(path, choice, trajectory, willpower, bearerFates) {
  const components = [];
  const C = ENDING_COMPONENTS;

  // Crown resolution based on final choice
  const crownMap = {
    Purify: C.crown_purified, Merge: C.crown_merged, Shatter: C.crown_shattered,
    Claim: C.crown_claimed, SelfSacrifice: C.crown_sealed,
  };
  components.push(crownMap[choice] || C.crown_merged);

  // Kael's fate based on path
  const kaelMap = {
    [FINAL_PATHS.REDEEMER]: C.kael_hero,
    [FINAL_PATHS.ARBITER]: C.kael_ruler,
    [FINAL_PATHS.MARTYR]: C.kael_sacrifice,
    [FINAL_PATHS.VESSEL]: C.kael_puppet,
    [FINAL_PATHS.HOLLOW_KING]: C.kael_reborn_tyrant,
  };
  components.push(kaelMap[path] || C.kael_hero);

  // Companion fate based on willpower + path
  if (path === FINAL_PATHS.MARTYR) {
    components.push(C.lira_mourns);
  } else if (path === FINAL_PATHS.HOLLOW_KING) {
    components.push(C.lira_serves);
  } else if (willpower < 0.3) {
    components.push(C.lira_betrayed);
  } else {
    components.push(C.lira_loyal);
  }

  // Realm outcome based on path + trajectory
  const realmMap = {
    [FINAL_PATHS.REDEEMER]: C.realm_peace,
    [FINAL_PATHS.ARBITER]: C.realm_balance,
    [FINAL_PATHS.MARTYR]: C.realm_peace,
    [FINAL_PATHS.VESSEL]: C.realm_enslaved,
    [FINAL_PATHS.HOLLOW_KING]: C.realm_darkness,
  };
  if (choice === 'Shatter') {
    components.push(C.realm_scattered); // Override — shatter always scatters
  } else {
    components.push(realmMap[path] || C.realm_balance);
  }

  // Post-credits hook
  if (choice === 'Shatter') {
    components.push(C.hook_new_hero);
  } else if (path === FINAL_PATHS.MARTYR) {
    components.push(C.hook_kael_whisper);
  } else if (path === FINAL_PATHS.HOLLOW_KING || path === FINAL_PATHS.VESSEL) {
    components.push(C.hook_crown_stirs);
  }

  return components;
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// ── Permutation testing ──────────────────────────────────────────────────────

/**
 * Test all ending permutations — matches RunPermutationTest() in C++.
 * Returns coverage stats and any unreachable paths.
 */
export function runPermutationTest() {
  const willpowerSteps = [0.0, 0.1, 0.2, 0.3, 0.5, 0.7, 0.85, 1.0];
  const corruptionSteps = [0.0, 0.15, 0.3, 0.5, 0.7, 0.9, 1.0];
  const choices = Object.values(FINAL_CHOICES);

  const results = { total: 0, paths: {}, unreachable: [], samples: [] };
  for (const p of Object.values(FINAL_PATHS)) results.paths[p] = 0;

  for (const wp of willpowerSteps) {
    for (const corr of corruptionSteps) {
      for (const choice of choices) {
        const ending = synthesizeEnding({
          willpowerScore: wp,
          finalCorruption: corr,
          corruptionHistory: [0, corr * 0.3, corr * 0.6, corr],
          finalChoice: choice,
        });
        results.total++;
        results.paths[ending.finalPath]++;

        // Sample interesting ones
        if (results.samples.length < 25) {
          results.samples.push({
            willpower: wp, corruption: corr, choice,
            path: ending.finalPath, hash: ending.endingHash,
            components: ending.components.map(c => c.id),
          });
        }
      }
    }
  }

  // Check for unreachable paths
  for (const [path, count] of Object.entries(results.paths)) {
    if (count === 0) results.unreachable.push(path);
  }

  return {
    success: true,
    totalPermutations: results.total,
    pathDistribution: results.paths,
    unreachablePaths: results.unreachable,
    allPathsReachable: results.unreachable.length === 0,
    sampleEndings: results.samples,
  };
}

// ── Blueprint creation ───────────────────────────────────────────────────────

/**
 * Create BP_WillpowerTracker blueprint in UE5.
 * Tracks resistance/compliance counts, pending outcome windows, and willpower score.
 */
export async function createWillpowerBlueprint() {
  const name = 'BP_WillpowerTracker';
  log.info('Creating BP_WillpowerTracker...');

  const created = await ue('create_blueprint', {
    name,
    parent_class: 'AActor',
    blueprint_path: '/Game/Blueprints/Narrative',
  });
  if (created?.status === 'error') return { success: false, error: created.error };

  // ── Variables ──────────────────────────────────────────────
  const vars = [
    // Core willpower
    ['ResistanceCount',     'int',   0],
    ['ComplianceCount',     'int',   0],
    ['WillpowerScore',      'float', 0.5],
    ['TotalDecisions',      'int',   0],

    // Weighted willpower (accounts for decision gravity)
    ['WeightedResistance',  'float', 0.0],
    ['WeightedCompliance',  'float', 0.0],

    // Pending outcome windows
    ['bHasPendingOutcome',  'bool',  false],
    ['PendingContextTag',   'string', ''],
    ['PendingWindowEndTime','float', 0.0],
    ['PendingWeight',       'float', 1.0],

    // Corruption tracking (for trajectory analysis)
    ['CurrentCorruption',   'float', 0.0],
    ['PeakCorruption',      'float', 0.0],
    ['CorruptionSampleCount','int',  0],

    // Whisper interaction stats
    ['WhispersHeard',       'int',   0],
    ['WhispersResisted',    'int',   0],
    ['WhispersObeyed',      'int',   0],

    // State flags
    ['bIsTracking',         'bool',  true],
    ['SampleIntervalSec',   'float', 30.0],
    ['LastSampleTime',      'float', 0.0],
  ];

  for (const [n, t, d] of vars) {
    await ue('create_variable', { blueprint_name: name, name: n, type: t, default_value: d });
  }

  // ── Functions ─────────────────────────────────────────────
  const functions = [
    'RegisterResistance',    // +1 resistance, recalculate willpower
    'RegisterCompliance',    // +1 compliance, recalculate willpower
    'ReportOutcome',         // Context tag + bool (complied?), weighted update
    'OpenOutcomeWindow',     // Start a timed window for player decision
    'CloseOutcomeWindow',    // Close window (timeout = compliance by default)
    'RecalculateWillpower',  // willpower = weighted_resistance / (weighted_r + weighted_c)
    'SampleCorruption',      // Periodic corruption snapshot for trajectory
    'GetWillpowerScore',     // Return current 0.0-1.0 score
    'GetTrajectoryData',     // Return corruption history for ending synthesis
    'OnWhisperHeard',        // Increment whisper counters
  ];

  for (const fn of functions) {
    await ue('create_function', { blueprint_name: name, function_name: fn });
  }

  // ── Events ────────────────────────────────────────────────
  await ue('add_event_node', { blueprint_name: name, event_type: 'BeginPlay', graph_name: 'EventGraph' });
  await ue('add_event_node', { blueprint_name: name, event_type: 'Tick', graph_name: 'EventGraph' });

  // Compile
  const compiled = await ue('compile_blueprint', { blueprint_name: name });

  log.info(`BP_WillpowerTracker created: ${vars.length} vars, ${functions.length} functions`);
  return {
    success: compiled?.status !== 'error',
    blueprint: name,
    variables: vars.length,
    functions: functions.length,
  };
}

/**
 * Create BP_EndingSynthesis blueprint in UE5.
 * Assembles the final ending from all player inputs at the summit.
 */
export async function createEndingSynthesisBlueprint() {
  const name = 'BP_EndingSynthesis';
  log.info('Creating BP_EndingSynthesis...');

  const created = await ue('create_blueprint', {
    name,
    parent_class: 'AActor',
    blueprint_path: '/Game/Blueprints/Narrative',
  });
  if (created?.status === 'error') return { success: false, error: created.error };

  // ── Variables ──────────────────────────────────────────────
  const vars = [
    // Inputs (collected at summit)
    ['WillpowerScore',       'float',  0.5],
    ['FinalCorruption',      'float',  0.0],
    ['PeakCorruption',       'float',  0.0],
    ['WhispersHeard',        'int',    0],
    ['WhispersResisted',     'int',    0],
    ['TotalDeaths',          'int',    0],
    ['ExplorationPercent',   'float',  0.0],
    ['SecretsFound',         'int',    0],

    // Synthesis outputs
    ['FinalPathName',        'string', 'Arbiter'],
    ['TrajectoryName',       'string', 'PureHeart'],
    ['ResolvedChoice',       'string', 'Merge'],
    ['EndingHash',           'string', '00000000'],

    // Narrative state
    ['bSynthesisComplete',   'bool',   false],
    ['bCinematicPlaying',    'bool',   false],
    ['PathDescription',      'string', ''],
    ['TrajectoryDescription','string', ''],

    // Boss resolution inputs (5 shard-bearers)
    ['GorrathResolution',    'string', 'consume'],
    ['SeravynResolution',    'string', 'consume'],
    ['ThaldrisResolution',   'string', 'consume'],
    ['VyrelResolution',      'string', 'consume'],
    ['NiharaResolution',     'string', 'consume'],

    // Component count for cutscene sequencing
    ['ComponentCount',       'int',    0],
    ['CurrentComponentIdx',  'int',    0],
  ];

  for (const [n, t, d] of vars) {
    await ue('create_variable', { blueprint_name: name, name: n, type: t, default_value: d });
  }

  // ── Functions ─────────────────────────────────────────────
  const functions = [
    'CollectInputs',            // Gather all inputs from subsystems
    'SynthesizeEnding',         // Main synthesis — determines path + trajectory
    'DetermineFinalPath',       // Path selection from willpower + corruption
    'AnalyzeTrajectory',        // Corruption history → trajectory enum
    'ResolveShardBearerFates',  // Boss resolutions → bearer fates
    'AssembleComponents',       // Build component list for cutscene
    'GetAvailableChoices',      // Return valid choices for the determined path
    'PlayEndingCinematic',      // Trigger level sequence for the ending
    'AdvanceComponent',         // Step through ending components (cutscene beats)
    'GenerateEndingHash',       // Create unique permutation identifier
    'RunPermutationTest',       // Debug: test all possible endings
    'BuildCrownJudgment',       // Crown judgment component using willpower
  ];

  for (const fn of functions) {
    await ue('create_function', { blueprint_name: name, function_name: fn });
  }

  // ── Events ────────────────────────────────────────────────
  await ue('add_event_node', { blueprint_name: name, event_type: 'BeginPlay', graph_name: 'EventGraph' });

  // Compile
  const compiled = await ue('compile_blueprint', { blueprint_name: name });

  log.info(`BP_EndingSynthesis created: ${vars.length} vars, ${functions.length} functions`);
  return {
    success: compiled?.status !== 'error',
    blueprint: name,
    variables: vars.length,
    functions: functions.length,
  };
}

// ── Data table creation ──────────────────────────────────────────────────────

/**
 * Create UE5 data tables for endings: DT_EndingPaths, DT_EndingComponents, E_FinalPath.
 */
export async function createEndingDataTables() {
  log.info('Creating ending data tables...');
  const results = [];

  // 1. E_FinalPath enum
  results.push(await ue('create_enum', {
    name: 'E_FinalPath',
    folder: '/Game/Data/Narrative',
    values: Object.values(FINAL_PATHS),
  }));

  // 2. E_CorruptionTrajectory enum
  results.push(await ue('create_enum', {
    name: 'E_CorruptionTrajectory',
    folder: '/Game/Data/Narrative',
    values: Object.values(TRAJECTORIES),
  }));

  // 3. E_FinalChoice enum
  results.push(await ue('create_enum', {
    name: 'E_FinalChoice',
    folder: '/Game/Data/Narrative',
    values: Object.values(FINAL_CHOICES),
  }));

  // 4. F_EndingPathRow struct
  results.push(await ue('create_struct', {
    name: 'F_EndingPathRow',
    folder: '/Game/Data/Narrative',
    fields: [
      { name: 'PathName', type: 'FString' },
      { name: 'WillpowerMin', type: 'float' },
      { name: 'WillpowerMax', type: 'float' },
      { name: 'CorruptionMax', type: 'float' },
      { name: 'Description', type: 'FString' },
    ],
  }));

  // 5. DT_EndingPaths data table
  const pathRows = ENDING_PATH_RULES.map(rule => ({
    key: rule.path,
    label: rule.path,
    value: `wp:${rule.willpowerMin}-${rule.willpowerMax} corr:<${rule.corruptionMax}`,
    notes: rule.description,
  }));

  results.push(await ue('create_data_table', {
    name: 'DT_EndingPaths',
    folder: '/Game/Data/Narrative',
    rows: pathRows,
  }));

  // 6. DT_EndingComponents data table
  const compRows = Object.values(ENDING_COMPONENTS).map(comp => ({
    key: comp.id,
    label: comp.label,
    value: comp.category,
    notes: '',
  }));

  results.push(await ue('create_data_table', {
    name: 'DT_EndingComponents',
    folder: '/Game/Data/Narrative',
    rows: compRows,
  }));

  const errors = results.filter(r => r?.status === 'error');
  log.info(`Ending data tables created: ${results.length - errors.length}/${results.length} succeeded`);

  return {
    success: errors.length === 0,
    created: results.length - errors.length,
    total: results.length,
    errors: errors.map(e => e.error),
  };
}

// ── Export willpower/ending spec ──────────────────────────────────────────────

/**
 * Export the full willpower + ending specification as JSON for documentation.
 */
export function exportWillpowerSpec() {
  const game = getActiveGame();
  const specPath = join(process.cwd(), 'workspace', game.gameId, 'Assets', 'willpower-ending-spec.json');

  const spec = {
    generatedAt: new Date().toISOString(),
    gameId: game.gameId,

    willpower: {
      description: 'Willpower score = weighted resistance / (weighted resistance + weighted compliance). 0.0 = full compliance, 1.0 = full resistance.',
      outcomeContexts: OUTCOME_CONTEXTS,
      complianceTags: [...COMPLIANCE_TAGS],
      resistanceTags: [...RESISTANCE_TAGS],
      events: WILLPOWER_EVENTS,
    },

    endings: {
      paths: ENDING_PATH_RULES,
      trajectories: TRAJECTORIES,
      choices: FINAL_CHOICES,
      components: ENDING_COMPONENTS,
    },

    permutationTest: runPermutationTest(),
  };

  writeFileSync(specPath, JSON.stringify(spec, null, 2));
  log.info(`Willpower/ending spec exported: ${specPath}`);

  return {
    success: true,
    path: specPath,
    pathCount: ENDING_PATH_RULES.length,
    trajectoryCount: Object.keys(TRAJECTORIES).length,
    choiceCount: Object.keys(FINAL_CHOICES).length,
    componentCount: Object.keys(ENDING_COMPONENTS).length,
    contextCount: Object.keys(OUTCOME_CONTEXTS).length,
  };
}

// ── Status report ────────────────────────────────────────────────────────────

export function getWillpowerStatus() {
  const permTest = runPermutationTest();

  return {
    success: true,
    willpower: {
      outcomeContexts: Object.keys(OUTCOME_CONTEXTS).length,
      complianceTags: COMPLIANCE_TAGS.size,
      resistanceTags: RESISTANCE_TAGS.size,
      events: WILLPOWER_EVENTS.length,
    },
    endings: {
      paths: Object.keys(FINAL_PATHS).length,
      trajectories: Object.keys(TRAJECTORIES).length,
      choices: Object.keys(FINAL_CHOICES).length,
      components: Object.keys(ENDING_COMPONENTS).length,
    },
    permutationTest: {
      total: permTest.totalPermutations,
      allPathsReachable: permTest.allPathsReachable,
      pathDistribution: permTest.pathDistribution,
    },
  };
}

// ── Gameplay-builder integration ─────────────────────────────────────────────

/**
 * Returns [name, type, default] triples for BP_WillpowerTracker variables
 * that should be added to the combat/narrative system.
 */
export function getWillpowerVars() {
  return [
    ['WillpowerScore',    'float', 0.5],
    ['ResistanceCount',   'int',   0],
    ['ComplianceCount',   'int',   0],
    ['PeakCorruption',    'float', 0.0],
    ['CorruptionSamples', 'int',   0],
    ['WhispersResisted',  'int',   0],
    ['WhispersObeyed',    'int',   0],
  ];
}

/**
 * Returns function names for willpower/ending integration in gameplay BPs.
 */
export function getWillpowerFunctions() {
  return [
    'UpdateWillpower',
    'RegisterPlayerChoice',
    'SampleCorruptionLevel',
    'CheckEndingEligibility',
    'TriggerEndingSynthesis',
  ];
}
