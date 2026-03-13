/**
 * modules/unreal/rival-crown-seeker.js — Rival Crown-Seeker NPC System.
 *
 * Designs and manages "Veyra Ashcroft" — a persistent NPC antagonist on the same
 * quest as the player (Kael), making different choices. She appears at key moments:
 * reaching shard-bearers first, competing for resources, offering uneasy alliances.
 *
 * Core mechanics:
 *  - Corruption level mirrors INVERSE of player (high player willpower = high Veyra corruption)
 *  - Specializes in player's LEAST-used shard powers (adaptive counter-build)
 *  - 5 relationship states: Hostile → Wary → Neutral → Reluctant Ally → Rival Respect
 *  - Appears in all 8 regions with region-specific encounter scripts
 *  - Final confrontation adapts based on accumulated choices
 *
 * Integration points:
 *  - willpower-tracker.js: reads player willpower to compute inverse corruption
 *  - combo-balance.js: references SHARD_TYPES for power specialization
 *  - npc-dialogue.js: SPEAKERS enum extended with Veyra entry
 *  - corruption-shader.js: CORRUPTION_TIERS for visual corruption staging
 *  - game-config.js: paths for data export
 *
 * ms_1: Design rival character (appearance, personality, motivation arc)
 * Goal: Rival Crown-Seeker — Persistent NPC antagonist (02222134)
 */

import { createLogger } from '../../lib/logger.js';
import { getActiveGame } from './game-config.js';
import { SHARD_TYPES } from './combo-balance.js';
import { FINAL_PATHS } from './willpower-tracker.js';
import { callTool } from '../../lib/mcp-gateway.js';
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';

const log = createLogger('rival-crown-seeker');

// ── Character Profile ────────────────────────────────────────────────────────

export const RIVAL_PROFILE = {
  id: 'veyra_ashcroft',
  displayName: 'Veyra Ashcroft',
  title: 'The Ashen Seeker',
  age: 28,
  gender: 'female',

  // ── Appearance ──
  appearance: {
    build: 'Athletic, lean — a duelist\'s frame, taller than average',
    hair: 'Silver-white, cropped asymmetrically — left side shaved, right side falling to jawline',
    eyes: 'Pale amber, developing violet corruption veins as corruption increases',
    skin: 'Warm brown with ashen grey patches that spread with corruption',
    scars: 'Burn scar across left collarbone (from her village\'s destruction)',
    signature: 'Wears a half-cape of tattered indigo cloth — remnant of her family crest',
    corruptionVisuals: {
      tier1: 'Faint violet veins visible on hands and neck',
      tier2: 'Ashen patches spread to forearms, eyes glow faintly in darkness',
      tier3: 'Half her face shows corruption lines, hair darkens at roots to black',
      tier4: 'Corruption covers most visible skin, cape frays into shadow tendrils',
      tier5: 'Near-fully transformed — silhouette wreathed in dark shard energy',
    },
  },

  // ── Personality ──
  personality: {
    core: 'Pragmatic idealist broken by loss — believes the ends justify ruthless means',
    traits: [
      'Brilliant tactician — always two steps ahead',
      'Dry, cutting wit — uses humor as emotional armor',
      'Deeply empathetic beneath the hardened exterior',
      'Cannot forgive herself for surviving when her village didn\'t',
      'Respects competence above all else',
    ],
    flaws: [
      'Refuses help even when desperately needed (survivor\'s pride)',
      'Willing to sacrifice others for the "greater good" (utilitarian to a fault)',
      'Self-destructive — pushes herself beyond safe corruption thresholds',
      'Haunted by the memory of her younger brother (mirrors player\'s companion)',
    ],
    voice: 'Measured, slightly sardonic — speaks in short, precise sentences. ' +
           'Occasionally lets warmth slip through before catching herself.',
    combatStyle: 'Aggressive counter-attacker — studies opponent patterns then exploits gaps',
  },

  // ── Backstory ──
  backstory: {
    origin: 'Village of Ashcroft, on the border of the AshenWilds — destroyed by a ' +
            'corruption surge when the Crown first shattered. Veyra was the sole survivor.',
    motivation: 'Believes reassembling the Crown and wielding it herself is the ONLY way ' +
                'to prevent another catastrophe. Sees Kael as naive for seeking to destroy it.',
    incitingIncident: 'Found a Crown shard in the ruins of her village the same day Kael ' +
                      'found theirs. Has been one step ahead ever since.',
    secret: 'Her younger brother Caelen didn\'t die in the village — he was consumed by ' +
            'corruption and became a Hollow (revealed in Act 3). This is why she pushes ' +
            'herself to absorb more corruption: she believes understanding it will save him.',
    connection: 'Trained by the same order as Elder Mathis — recognizes the Elder\'s ' +
                'teachings in Kael\'s fighting style.',
  },
};

// ── Motivation Arc (3-act structure across 8 regions) ────────────────────────

export const MOTIVATION_ARC = {
  acts: [
    {
      id: 'act_1',
      name: 'The Race',
      regions: ['CrossroadsHub', 'AshenWilds', 'Ironhold'],
      theme: 'Competition — Veyra is always one step ahead',
      veyraGoal: 'Collect shards faster than Kael to prove she\'s the worthy wielder',
      playerPerception: 'Mysterious rival who keeps beating you to objectives',
      corruptionRange: [0, 0.3],
      keyBeats: [
        {
          region: 'CrossroadsHub',
          event: 'first_glimpse',
          description: 'Player spots Veyra leaving a shard-bearer\'s cave as they arrive — ' +
                       'shard already taken. She pauses, evaluates Kael, then vanishes.',
          tone: 'mysterious',
        },
        {
          region: 'AshenWilds',
          event: 'confrontation_ruins',
          description: 'Both reach the Ashen Shard simultaneously. First direct dialogue — ' +
                       'Veyra explains her village was HERE. Optional: fight or let her take it.',
          tone: 'tense',
          playerChoice: true,
        },
        {
          region: 'Ironhold',
          event: 'reluctant_truce',
          description: 'A corruption beast traps both in the Ironhold mines. Must cooperate ' +
                       'to escape. First glimpse of Veyra\'s humanity (protects a child NPC).',
          tone: 'grudging respect',
          playerChoice: true,
        },
      ],
    },
    {
      id: 'act_2',
      name: 'The Mirror',
      regions: ['VerdantReach', 'SunkenHalls', 'EmberPeaks'],
      theme: 'Reflection — player sees themselves in Veyra\'s choices',
      veyraGoal: 'Absorb corruption intentionally to gain power, believing control is possible',
      playerPerception: 'Rival becoming something dangerous — but her reasons are sympathetic',
      corruptionRange: [0.3, 0.7],
      keyBeats: [
        {
          region: 'VerdantReach',
          event: 'corruption_choice',
          description: 'Veyra saves the Verdant Guardian by absorbing a lethal corruption ' +
                       'surge. Visibly weakened but defiant. Challenges Kael: "Could YOU sacrifice?"',
          tone: 'challenging',
        },
        {
          region: 'SunkenHalls',
          event: 'brother_revelation',
          description: 'Player discovers Caelen\'s fate in the Sunken archives. Veyra appears, ' +
                       'realizes Kael knows. Vulnerable moment — nearly breaks down. Can choose ' +
                       'to comfort or confront.',
          tone: 'emotional',
          playerChoice: true,
        },
        {
          region: 'EmberPeaks',
          event: 'alliance_offer',
          description: 'Veyra proposes a temporary alliance against the Ember Warden boss. ' +
                       'If accepted, she fights alongside player (first co-op moment). If refused, ' +
                       'she attempts solo and gets badly hurt.',
          tone: 'pivotal',
          playerChoice: true,
        },
      ],
    },
    {
      id: 'act_3',
      name: 'The Reckoning',
      regions: ['Aethermere', 'TheWilds'],
      theme: 'Confrontation — divergent paths collide at the Crown',
      veyraGoal: 'Reach the Crown first; final goal depends on accumulated corruption',
      playerPerception: 'Once-rival now forcing a final choice: ally, oppose, or save',
      corruptionRange: [0.7, 1.0],
      keyBeats: [
        {
          region: 'Aethermere',
          event: 'final_plea',
          description: 'Veyra confronts Kael at the Aethermere convergence point. Her corruption ' +
                       'is visibly consuming her. Asks Kael to combine their shards — her way.',
          tone: 'desperate',
          playerChoice: true,
        },
        {
          region: 'TheWilds',
          event: 'crown_confrontation',
          description: 'The final encounter. Outcome determined by accumulated relationship state, ' +
                       'player\'s willpower, and total choices made regarding Veyra.',
          tone: 'climactic',
          playerChoice: true,
        },
      ],
    },
  ],
};

// ── Relationship System ──────────────────────────────────────────────────────

export const RELATIONSHIP_STATES = {
  HOSTILE:        { id: 'hostile',        threshold: -100, label: 'Sworn Enemy',     combatMod: 1.3 },
  WARY:           { id: 'wary',           threshold: -30,  label: 'Distrustful',     combatMod: 1.1 },
  NEUTRAL:        { id: 'neutral',        threshold: 0,    label: 'Cautious Rival',  combatMod: 1.0 },
  RELUCTANT_ALLY: { id: 'reluctant_ally', threshold: 40,   label: 'Reluctant Ally',  combatMod: 0.8 },
  RIVAL_RESPECT:  { id: 'rival_respect',  threshold: 80,   label: 'Respected Rival', combatMod: 0.6 },
};

/**
 * Player choices that shift the relationship score.
 * Positive = toward Respect, Negative = toward Hostile.
 */
export const RELATIONSHIP_SHIFTS = [
  { event: 'ashen_let_take_shard',    shift: +15, region: 'AshenWilds',   note: 'Let Veyra take the Ashen Shard' },
  { event: 'ashen_fight_for_shard',   shift: -20, region: 'AshenWilds',   note: 'Fought Veyra for the shard' },
  { event: 'ironhold_cooperate',      shift: +20, region: 'Ironhold',     note: 'Cooperated in the mines' },
  { event: 'ironhold_betray',         shift: -25, region: 'Ironhold',     note: 'Betrayed truce in the mines' },
  { event: 'sunken_comfort',          shift: +25, region: 'SunkenHalls',  note: 'Comforted about Caelen' },
  { event: 'sunken_confront',         shift: -10, region: 'SunkenHalls',  note: 'Confronted about Caelen' },
  { event: 'ember_accept_alliance',   shift: +30, region: 'EmberPeaks',   note: 'Accepted alliance offer' },
  { event: 'ember_refuse_alliance',   shift: -15, region: 'EmberPeaks',   note: 'Refused alliance offer' },
  { event: 'aethermere_agree_combine', shift: +10, region: 'Aethermere',  note: 'Agreed to combine shards' },
  { event: 'aethermere_refuse_combine', shift: -5, region: 'Aethermere',  note: 'Refused to combine shards' },
  // Passive shifts from gameplay behavior
  { event: 'high_corruption_sympathy', shift: +5,  region: '*',           note: 'Player also has high corruption (empathy)' },
  { event: 'saved_civilian_npc',       shift: +3,  region: '*',           note: 'Veyra witnesses player saving NPCs' },
  { event: 'killed_surrendered_enemy', shift: -8,  region: '*',           note: 'Veyra witnesses player killing surrendered foe' },
];

// ── Inverse Corruption Model ─────────────────────────────────────────────────

/**
 * Compute Veyra's corruption level as inverse of player willpower.
 * Player high willpower (resisting corruption) → Veyra high corruption (embracing it).
 * Player low willpower (embracing corruption) → Veyra lower corruption (seeing the danger).
 *
 * @param {number} playerWillpower - 0.0 (no resistance) to 1.0 (max resistance)
 * @returns {{ corruptionLevel: number, tier: number, visualState: string }}
 */
export function computeRivalCorruption(playerWillpower) {
  // Inverse with slight offset — Veyra always has SOME corruption (min 0.15)
  const baseCorruption = 1.0 - playerWillpower;
  const corruptionLevel = Math.max(0.15, Math.min(1.0, baseCorruption * 1.1 + 0.05));

  // Map to corruption tiers (1-5)
  let tier;
  if (corruptionLevel < 0.2) tier = 1;
  else if (corruptionLevel < 0.4) tier = 2;
  else if (corruptionLevel < 0.6) tier = 3;
  else if (corruptionLevel < 0.8) tier = 4;
  else tier = 5;

  const visualState = RIVAL_PROFILE.appearance.corruptionVisuals[`tier${tier}`] || 'default';

  return { corruptionLevel, tier, visualState };
}

// ── Adaptive Shard Specialization ────────────────────────────────────────────

/**
 * Determine which shard powers Veyra specializes in based on player's usage patterns.
 * She adapts to counter the player by mastering what they neglect.
 *
 * @param {Record<string, number>} playerShardUsage - Map of shard type → usage count
 * @returns {{ primary: string, secondary: string, avoided: string, reasoning: string }}
 */
export function computeRivalShardSpec(playerShardUsage = {}) {
  // Default all shards to 0 if not tracked
  const usage = {};
  for (const shard of SHARD_TYPES) {
    usage[shard] = playerShardUsage[shard] || 0;
  }

  // Sort by ascending usage (least used first)
  const sorted = Object.entries(usage).sort((a, b) => a[1] - b[1]);

  const primary = sorted[0][0];   // Player's least-used = Veyra's primary
  const secondary = sorted[1][0]; // Second least-used
  const avoided = sorted[sorted.length - 1][0]; // Player's most-used = Veyra avoids

  return {
    primary,
    secondary,
    avoided,
    reasoning: `Veyra specializes in ${primary} (player's least-used shard) with ` +
               `${secondary} as backup. She avoids ${avoided} — that's the player's strength.`,
  };
}

// ── Final Encounter Outcomes ─────────────────────────────────────────────────

/**
 * 6 possible outcomes for the final Crown confrontation, determined by
 * relationship state + player willpower + Veyra corruption.
 */
export const FINAL_OUTCOMES = [
  {
    id: 'redemption_together',
    name: 'Redemption Together',
    conditions: { minRelationship: 'rival_respect', maxVeyraCorruption: 0.6 },
    description: 'Veyra and Kael combine their understanding of the Crown. She purges ' +
                 'her corruption using the player\'s willpower as anchor. Both survive. ' +
                 'She becomes an ally in the post-game.',
    endingPath: FINAL_PATHS.REDEEMER,
  },
  {
    id: 'sacrifice_save',
    name: 'The Sacrifice',
    conditions: { minRelationship: 'reluctant_ally', maxVeyraCorruption: 0.8 },
    description: 'Veyra, too corrupted to save herself, channels her remaining humanity ' +
                 'into shielding Kael during the Crown\'s restoration. She dies but her ' +
                 'sacrifice stabilizes the Crown.',
    endingPath: FINAL_PATHS.MARTYR,
  },
  {
    id: 'reluctant_duel',
    name: 'The Reluctant Duel',
    conditions: { minRelationship: 'neutral', maxVeyraCorruption: 0.7 },
    description: 'Neither hostile nor allied enough. A fair duel for the right to wield ' +
                 'the Crown. Win = player chooses Crown\'s fate. Lose = Veyra does, but ' +
                 'respects the player\'s wish.',
    endingPath: FINAL_PATHS.ARBITER,
  },
  {
    id: 'corruption_consumed',
    name: 'Consumed by the Crown',
    conditions: { maxRelationship: 'wary', minVeyraCorruption: 0.8 },
    description: 'Veyra, fully corrupted and with no emotional anchor, becomes a vessel ' +
                 'for the Crown\'s will. Final boss fight against Hollow Veyra.',
    endingPath: FINAL_PATHS.VESSEL,
  },
  {
    id: 'mutual_destruction',
    name: 'Mutual Destruction',
    conditions: { maxRelationship: 'hostile', minVeyraCorruption: 0.9 },
    description: 'Veyra and Kael destroy each other and the Crown simultaneously. ' +
                 'The world is saved but both Crown-Seekers are lost.',
    endingPath: FINAL_PATHS.HOLLOW_KING,
  },
  {
    id: 'brother_intervention',
    name: 'Caelen\'s Return',
    conditions: { minRelationship: 'reluctant_ally', specialFlag: 'caelen_discovered' },
    description: 'If the player found all Caelen clues, the corrupted brother appears. ' +
                 'Veyra breaks free of corruption to save him. Three-way choice: save both, ' +
                 'save one, or let the Crown decide.',
    endingPath: FINAL_PATHS.REDEEMER,
  },
];

// ── Encounter Schedule (region → encounter type) ─────────────────────────────

export const ENCOUNTER_SCHEDULE = {
  CrossroadsHub: { type: 'glimpse',       combat: false, dialogue: true,  duration: 'brief' },
  AshenWilds:    { type: 'confrontation',  combat: true,  dialogue: true,  duration: 'medium' },
  Ironhold:      { type: 'forced_coop',    combat: false, dialogue: true,  duration: 'long' },
  VerdantReach:  { type: 'witness',        combat: false, dialogue: true,  duration: 'medium' },
  SunkenHalls:   { type: 'revelation',     combat: false, dialogue: true,  duration: 'long' },
  EmberPeaks:    { type: 'alliance_choice', combat: true,  dialogue: true,  duration: 'long' },
  Aethermere:    { type: 'final_plea',     combat: false, dialogue: true,  duration: 'medium' },
  TheWilds:      { type: 'climax',         combat: true,  dialogue: true,  duration: 'long' },
};

// ── Combat Profile ───────────────────────────────────────────────────────────

export const RIVAL_COMBAT = {
  baseStats: {
    health: 800,
    healthPerCorruptionTier: 200,  // 800 at tier 1, 1600 at tier 5
    moveSpeed: 500,                // Faster than player (450) — always on the offensive
    attackDamage: 35,
    attackSpeed: 1.2,
    armor: 15,
  },

  /** Scaling: Veyra levels with the player but slightly behind in raw power,
   *  ahead in speed and tactical ability. This makes fights feel like
   *  chess matches rather than DPS races. */
  scalingFormula: 'level * 0.9 + corruption_tier * 0.3',

  abilities: [
    {
      id: 'shard_counter',
      name: 'Shard Counter',
      description: 'Reads the player\'s last 3 shard attacks and counters with the opposing element',
      cooldown: 8,
      damage: '1.5x base',
    },
    {
      id: 'ashen_dash',
      name: 'Ashen Dash',
      description: 'Short teleport leaving a corruption trail — signature mobility move',
      cooldown: 4,
      damage: '0.5x base (trail DoT)',
    },
    {
      id: 'mirror_stance',
      name: 'Mirror Stance',
      description: 'Briefly copies the player\'s currently equipped shard ability at reduced power',
      cooldown: 15,
      damage: '0.7x player ability',
    },
    {
      id: 'crown_resonance',
      name: 'Crown Resonance',
      description: 'Activates when below 30% HP. Corruption surges, granting 5s of invulnerability ' +
                   'and doubled damage. Visual: full corruption transformation.',
      cooldown: 60,
      damage: '2.0x base for 5s',
    },
  ],

  /** AI behavior adapts based on relationship state */
  behaviorByRelationship: {
    hostile: 'Aggressive — opens with burst damage, targets player relentlessly',
    wary: 'Defensive — waits for player mistakes, punishes overcommitment',
    neutral: 'Balanced — tests the player with varied attack patterns',
    reluctant_ally: 'Restrained — pulls punches, won\'t use lethal finishers',
    rival_respect: 'Honorable — announces attacks, waits for player to recover from staggers',
  },
};

// ── Dialogue Hooks (for npc-dialogue.js integration) ─────────────────────────

export const RIVAL_SPEAKER = {
  id: 'Veyra',
  portrait: '/Game/UI/Portraits/T_Portrait_Veyra',
  voicePrefix: 'voice_veyra',
};

/** Sample dialogue lines per act (full trees built in later milestones) */
export const RIVAL_DIALOGUE_SEEDS = {
  act_1: [
    { emotion: 'mysterious', text: 'You found a shard too. Interesting. The Crown doesn\'t choose randomly.' },
    { emotion: 'determined', text: 'Don\'t follow me. This path has room for one seeker only.' },
    { emotion: 'amused', text: 'You fight like a student of Mathis. He always did overvalue defense.' },
  ],
  act_2: [
    { emotion: 'concerned', text: 'Look at your hands. The corruption is in you too. Don\'t pretend otherwise.' },
    { emotion: 'sad', text: 'My brother... He was younger than you when the village burned.' },
    { emotion: 'hopeful', text: 'If we work together, just this once — we might both survive the Ember Warden.' },
  ],
  act_3: [
    { emotion: 'terrified', text: 'I can feel it rewriting me. The Crown... it doesn\'t want to be reassembled. It wants to consume.' },
    { emotion: 'determined', text: 'One of us has to wield it. One of us has to bear the weight. I\'d rather it be me.' },
    { emotion: 'reverent', text: 'You\'re stronger than I expected, Kael. Maybe the Crown chose right after all.' },
  ],
};

// ── Export Character Spec to JSON ────────────────────────────────────────────

/**
 * Exports the complete rival character design to a JSON file in the game's Assets folder.
 * Used by later milestones (UE5 blueprint, AI behavior tree, dialogue trees).
 */
export function exportRivalSpec() {
  const game = getActiveGame();
  const outDir = join(game.assetsPath, 'Characters');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const spec = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    profile: RIVAL_PROFILE,
    motivationArc: MOTIVATION_ARC,
    relationshipSystem: {
      states: RELATIONSHIP_STATES,
      shifts: RELATIONSHIP_SHIFTS,
    },
    combat: RIVAL_COMBAT,
    encounterSchedule: ENCOUNTER_SCHEDULE,
    finalOutcomes: FINAL_OUTCOMES,
    shardSpecialization: {
      description: 'Computed at runtime based on player shard usage stats',
      function: 'computeRivalShardSpec(playerShardUsage)',
      shardTypes: SHARD_TYPES,
    },
    corruptionModel: {
      description: 'Inverse of player willpower with 0.15 floor',
      function: 'computeRivalCorruption(playerWillpower)',
    },
    dialogueSeeds: RIVAL_DIALOGUE_SEEDS,
    speaker: RIVAL_SPEAKER,
  };

  const outPath = join(outDir, 'rival-veyra-spec.json');
  writeFileSync(outPath, JSON.stringify(spec, null, 2), 'utf-8');
  log.info(`Rival character spec exported to ${outPath}`);
  return { success: true, path: outPath, characterName: RIVAL_PROFILE.displayName };
}

/**
 * Get a summary of the rival's current state given player stats.
 * Useful for brief-builders and agent cycle decisions.
 */
export function getRivalStateSummary(playerWillpower = 0.5, playerShardUsage = {}) {
  const corruption = computeRivalCorruption(playerWillpower);
  const shardSpec = computeRivalShardSpec(playerShardUsage);
  const loadoutSummary = getLoadoutSummary(playerShardUsage, corruption.tier);

  return {
    name: RIVAL_PROFILE.displayName,
    title: RIVAL_PROFILE.title,
    corruption,
    shardSpec,
    loadout: loadoutSummary,
    combatHealth: RIVAL_COMBAT.baseStats.health +
      (corruption.tier * RIVAL_COMBAT.baseStats.healthPerCorruptionTier),
    motivationAct: corruption.corruptionLevel < 0.3 ? 'act_1'
      : corruption.corruptionLevel < 0.7 ? 'act_2' : 'act_3',
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// ms_2: Rival AI Controller — Reusable NPC AI Framework + Veyra Implementation
// ══════════════════════════════════════════════════════════════════════════════

// ── Reusable NPC AI Framework ────────────────────────────────────────────────
// Generic behavior tree / blackboard / AI controller builder that any NPC
// (companion, rival, merchant, boss) can use. Veyra is the first consumer.

/**
 * Generic blackboard key definitions for any NPC AI controller.
 * Consumers extend with their own keys via spread.
 * @param {string} npcId - Unique NPC identifier (e.g. 'Veyra', 'Lira')
 */
export function buildNpcBlackboardKeys(npcId) {
  return [
    // ── Core perception ──
    { name: 'TargetActor',       type: 'Object',  description: 'Current target (player, enemy, or interactable)' },
    { name: 'TargetLocation',    type: 'Vector',  description: 'World location of current objective' },
    { name: 'HomeLocation',      type: 'Vector',  description: 'Spawn/anchor point for leashing' },
    { name: 'LastKnownPlayerPos', type: 'Vector', description: 'Last confirmed player position' },
    // ── State flags ──
    { name: 'bCanAttack',        type: 'Bool',    description: 'Combat enabled' },
    { name: 'bIsInCombat',       type: 'Bool',    description: 'Currently in combat encounter' },
    { name: 'bIsInDialogue',     type: 'Bool',    description: 'Dialogue active (blocks combat)' },
    { name: 'bShouldFlee',       type: 'Bool',    description: 'HP below flee threshold' },
    // ── Numeric ──
    { name: 'AlertLevel',        type: 'Float',   description: '0=idle, 0.5=suspicious, 1.0=combat' },
    { name: 'DistanceToPlayer',  type: 'Float',   description: 'Updated per tick by perception' },
    { name: 'CurrentHealthPct',  type: 'Float',   description: 'Health as 0.0-1.0 fraction' },
    // ── AI mode ──
    { name: 'AIState',           type: 'Name',    description: 'Current behavior state name' },
    { name: 'PatrolIndex',       type: 'Int',     description: 'Index in patrol point array' },
    { name: `${npcId}_CustomData`, type: 'Name',  description: 'NPC-specific state payload' },
  ];
}

/**
 * Generic behavior tree node templates. Returns a tree definition that
 * can be serialized to JSON and used by UE5's BT editor or data-driven BT.
 *
 * @param {string} npcId
 * @param {object} opts - { combatSubtree, idleSubtree, dialogueSubtree, customNodes }
 */
export function buildNpcBehaviorTree(npcId, opts = {}) {
  const combatSubtree = opts.combatSubtree || buildDefaultCombatSubtree(npcId);
  const idleSubtree = opts.idleSubtree || buildDefaultIdleSubtree(npcId);
  const dialogueSubtree = opts.dialogueSubtree || buildDefaultDialogueSubtree(npcId);

  return {
    name: `BT_${npcId}`,
    root: {
      type: 'Selector',
      description: `${npcId} root — priority: dialogue > combat > idle`,
      children: [
        // Highest priority: active dialogue locks out everything
        {
          type: 'Sequence',
          description: 'Dialogue branch',
          decorator: { type: 'BlackboardBased', key: 'bIsInDialogue', expected: true },
          children: [dialogueSubtree],
        },
        // Combat when alert
        {
          type: 'Sequence',
          description: 'Combat branch',
          decorator: { type: 'BlackboardBased', key: 'bIsInCombat', expected: true },
          children: [combatSubtree],
        },
        // Default: idle/patrol
        {
          type: 'Sequence',
          description: 'Idle/patrol branch',
          children: [idleSubtree],
        },
        // Custom nodes appended by specific NPCs
        ...(opts.customNodes || []),
      ],
    },
  };
}

function buildDefaultCombatSubtree(npcId) {
  return {
    type: 'Selector',
    description: `${npcId} combat selector`,
    children: [
      {
        type: 'Sequence',
        description: 'Flee when low HP',
        decorator: { type: 'BlackboardBased', key: 'bShouldFlee', expected: true },
        children: [
          { type: 'Task', name: 'BTTask_FindFleeLocation', params: { minDist: 800 } },
          { type: 'Task', name: 'BTTask_MoveTo', params: { key: 'TargetLocation', acceptRadius: 50 } },
        ],
      },
      {
        type: 'Sequence',
        description: 'Engage target in range',
        children: [
          { type: 'Task', name: 'BTTask_FaceTarget', params: { key: 'TargetActor' } },
          { type: 'Task', name: 'BTTask_UseAbility', params: { selectBest: true } },
          { type: 'Task', name: 'BTTask_Wait', params: { duration: 0.5 } },
        ],
      },
      {
        type: 'Sequence',
        description: 'Chase target',
        children: [
          { type: 'Task', name: 'BTTask_MoveTo', params: { key: 'TargetActor', acceptRadius: 200 } },
        ],
      },
    ],
  };
}

function buildDefaultIdleSubtree(npcId) {
  return {
    type: 'Selector',
    description: `${npcId} idle selector`,
    children: [
      {
        type: 'Sequence',
        description: 'Patrol if waypoints exist',
        decorator: { type: 'BlackboardBased', key: 'PatrolIndex', operator: 'GreaterOrEqual', value: 0 },
        children: [
          { type: 'Task', name: 'BTTask_GetNextPatrolPoint' },
          { type: 'Task', name: 'BTTask_MoveTo', params: { key: 'TargetLocation', acceptRadius: 50 } },
          { type: 'Task', name: 'BTTask_Wait', params: { duration: { min: 2, max: 5 } } },
        ],
      },
      {
        type: 'Sequence',
        description: 'Idle at home',
        children: [
          { type: 'Task', name: 'BTTask_PlayAnimation', params: { anim: 'Idle_Variant' } },
          { type: 'Task', name: 'BTTask_Wait', params: { duration: { min: 3, max: 8 } } },
        ],
      },
    ],
  };
}

function buildDefaultDialogueSubtree(npcId) {
  return {
    type: 'Sequence',
    description: `${npcId} dialogue handler`,
    children: [
      { type: 'Task', name: 'BTTask_FaceTarget', params: { key: 'TargetActor' } },
      { type: 'Task', name: 'BTTask_PlayAnimation', params: { anim: 'Dialogue_Idle' } },
      { type: 'Task', name: 'BTTask_WaitForDialogueEnd' },
    ],
  };
}

// ── Veyra-Specific AI Controller ─────────────────────────────────────────────

/**
 * Veyra's extended blackboard keys (adds rival-specific state on top of generic NPC keys).
 */
export const VEYRA_BLACKBOARD_KEYS = [
  ...buildNpcBlackboardKeys('Veyra'),
  // ── Rival-specific keys ──
  { name: 'RelationshipState',    type: 'Name',   description: 'Current relationship: hostile/wary/neutral/reluctant_ally/rival_respect' },
  { name: 'RelationshipScore',    type: 'Int',    description: 'Raw relationship score (-100 to +100)' },
  { name: 'CorruptionTier',       type: 'Int',    description: 'Veyra corruption tier (1-5)' },
  { name: 'CorruptionLevel',      type: 'Float',  description: 'Veyra corruption 0.0-1.0' },
  { name: 'PlayerWillpower',      type: 'Float',  description: 'Cached player willpower (drives inverse corruption)' },
  { name: 'PrimaryShardType',     type: 'Name',   description: 'Veyra primary shard (player least-used)' },
  { name: 'SecondaryShardType',   type: 'Name',   description: 'Veyra secondary shard' },
  { name: 'CurrentAct',           type: 'Name',   description: 'Motivation arc act: act_1/act_2/act_3' },
  { name: 'EncounterType',        type: 'Name',   description: 'Current encounter: glimpse/confrontation/forced_coop/etc' },
  { name: 'bIsCoopMode',          type: 'Bool',   description: 'True during alliance/forced-coop encounters' },
  { name: 'bCrownResonanceReady', type: 'Bool',   description: 'Crown Resonance ability off cooldown' },
  { name: 'PlayerLastShardAttacks', type: 'Name',  description: 'Serialized last 3 player shard attacks for Shard Counter' },
  { name: 'CombatStyleOverride',  type: 'Name',   description: 'Override from relationship: aggressive/defensive/balanced/restrained/honorable' },
];

/**
 * Build Veyra's complete behavior tree with rival-specific combat AI.
 * Extends the generic NPC framework with:
 *  - Adaptive combat styles based on relationship state
 *  - Shard Counter ability logic (reads player attack history)
 *  - Crown Resonance desperation mode
 *  - Encounter-specific branches (coop, glimpse, confrontation)
 */
export function buildVeyraBehaviorTree() {
  return buildNpcBehaviorTree('Veyra', {
    combatSubtree: buildVeyraCombatSubtree(),
    idleSubtree: buildVeyraIdleSubtree(),
    dialogueSubtree: buildDefaultDialogueSubtree('Veyra'),
    customNodes: [buildVeyraEncounterBranch()],
  });
}

function buildVeyraCombatSubtree() {
  return {
    type: 'Selector',
    description: 'Veyra combat — adaptive style based on relationship',
    children: [
      // Crown Resonance: desperation mode at <30% HP
      {
        type: 'Sequence',
        description: 'Crown Resonance — desperation burst',
        decorator: { type: 'Composite', conditions: [
          { type: 'BlackboardBased', key: 'CurrentHealthPct', operator: 'LessThan', value: 0.3 },
          { type: 'BlackboardBased', key: 'bCrownResonanceReady', expected: true },
        ]},
        children: [
          { type: 'Task', name: 'BTTask_PlayAnimation', params: { anim: 'CrownResonance_Activate', montage: true } },
          { type: 'Task', name: 'BTTask_SetBlackboard', params: { key: 'bCrownResonanceReady', value: false } },
          { type: 'Task', name: 'BTTask_VeyraAbility', params: { abilityId: 'crown_resonance' } },
          { type: 'Task', name: 'BTTask_AggressivePursuit', params: { duration: 5.0, damageMultiplier: 2.0 } },
        ],
      },
      // Shard Counter: reads player patterns
      {
        type: 'Sequence',
        description: 'Shard Counter — react to player shard usage',
        decorator: { type: 'Cooldown', duration: 8.0 },
        children: [
          { type: 'Task', name: 'BTTask_AnalyzePlayerShards', params: { key: 'PlayerLastShardAttacks' } },
          { type: 'Task', name: 'BTTask_VeyraAbility', params: { abilityId: 'shard_counter' } },
        ],
      },
      // Style-based combat (driven by CombatStyleOverride blackboard key)
      {
        type: 'Selector',
        description: 'Relationship-driven combat style',
        children: [
          // Aggressive (hostile relationship)
          {
            type: 'Sequence',
            description: 'Aggressive — burst damage, relentless',
            decorator: { type: 'BlackboardBased', key: 'CombatStyleOverride', expected: 'aggressive' },
            children: [
              { type: 'Task', name: 'BTTask_VeyraAbility', params: { abilityId: 'ashen_dash', closeGap: true } },
              { type: 'Task', name: 'BTTask_ComboAttack', params: { comboLength: 4, pauseBetween: 0.2 } },
              { type: 'Task', name: 'BTTask_VeyraAbility', params: { abilityId: 'mirror_stance' } },
              { type: 'Task', name: 'BTTask_Wait', params: { duration: 0.3 } },
            ],
          },
          // Defensive (wary relationship)
          {
            type: 'Sequence',
            description: 'Defensive — punish overcommitment',
            decorator: { type: 'BlackboardBased', key: 'CombatStyleOverride', expected: 'defensive' },
            children: [
              { type: 'Task', name: 'BTTask_CircleStrafe', params: { radius: 400, duration: 2.0 } },
              { type: 'Task', name: 'BTTask_WaitForPlayerAttack' },
              { type: 'Task', name: 'BTTask_CounterAttack', params: { damageMultiplier: 1.5 } },
              { type: 'Task', name: 'BTTask_VeyraAbility', params: { abilityId: 'ashen_dash', retreatAfter: true } },
            ],
          },
          // Balanced (neutral relationship)
          {
            type: 'Sequence',
            description: 'Balanced — varied attack patterns',
            decorator: { type: 'BlackboardBased', key: 'CombatStyleOverride', expected: 'balanced' },
            children: [
              { type: 'Task', name: 'BTTask_MoveTo', params: { key: 'TargetActor', acceptRadius: 250 } },
              { type: 'Task', name: 'BTTask_ComboAttack', params: { comboLength: 2, pauseBetween: 0.4 } },
              { type: 'Task', name: 'BTTask_CircleStrafe', params: { radius: 350, duration: 1.0 } },
              { type: 'Task', name: 'BTTask_VeyraAbility', params: { abilityId: 'shard_counter' } },
            ],
          },
          // Restrained (reluctant_ally relationship)
          {
            type: 'Sequence',
            description: 'Restrained — pulls punches, no lethal finishers',
            decorator: { type: 'BlackboardBased', key: 'CombatStyleOverride', expected: 'restrained' },
            children: [
              { type: 'Task', name: 'BTTask_MoveTo', params: { key: 'TargetActor', acceptRadius: 300 } },
              { type: 'Task', name: 'BTTask_ComboAttack', params: { comboLength: 2, damageMultiplier: 0.6 } },
              { type: 'Task', name: 'BTTask_Wait', params: { duration: 1.5 } },
              { type: 'Task', name: 'BTTask_PlayAnimation', params: { anim: 'Taunt_Respectful' } },
            ],
          },
          // Honorable (rival_respect relationship)
          {
            type: 'Sequence',
            description: 'Honorable — announces attacks, waits for recovery',
            decorator: { type: 'BlackboardBased', key: 'CombatStyleOverride', expected: 'honorable' },
            children: [
              { type: 'Task', name: 'BTTask_PlayAnimation', params: { anim: 'Combat_Salute' } },
              { type: 'Task', name: 'BTTask_Wait', params: { duration: 0.8 } },
              { type: 'Task', name: 'BTTask_ComboAttack', params: { comboLength: 3, pauseBetween: 0.6 } },
              { type: 'Task', name: 'BTTask_WaitForPlayerRecovery', params: { staggerWaitSec: 1.5 } },
            ],
          },
        ],
      },
      // Fallback: basic chase + attack
      {
        type: 'Sequence',
        description: 'Fallback — chase and engage',
        children: [
          { type: 'Task', name: 'BTTask_MoveTo', params: { key: 'TargetActor', acceptRadius: 200 } },
          { type: 'Task', name: 'BTTask_FaceTarget', params: { key: 'TargetActor' } },
          { type: 'Task', name: 'BTTask_ComboAttack', params: { comboLength: 2 } },
        ],
      },
    ],
  };
}

function buildVeyraIdleSubtree() {
  return {
    type: 'Selector',
    description: 'Veyra idle — region-aware with corruption idle variants',
    children: [
      // Corruption meditation (tier 3+)
      {
        type: 'Sequence',
        description: 'High-corruption idle — dark meditation',
        decorator: { type: 'BlackboardBased', key: 'CorruptionTier', operator: 'GreaterOrEqual', value: 3 },
        children: [
          { type: 'Task', name: 'BTTask_PlayAnimation', params: { anim: 'Idle_CorruptionMeditate' } },
          { type: 'Task', name: 'BTTask_SpawnVFX', params: { effect: 'VFX_CorruptionAura_Idle' } },
          { type: 'Task', name: 'BTTask_Wait', params: { duration: { min: 4, max: 10 } } },
        ],
      },
      // Standard patrol/idle (reuses generic framework)
      ...buildDefaultIdleSubtree('Veyra').children,
    ],
  };
}

function buildVeyraEncounterBranch() {
  return {
    type: 'Selector',
    description: 'Encounter-specific branches (glimpse, coop, confrontation)',
    decorator: { type: 'BlackboardBased', key: 'EncounterType', operator: 'NotEqual', value: 'none' },
    children: [
      // Glimpse: appear briefly then vanish
      {
        type: 'Sequence',
        description: 'Glimpse encounter — appear and disappear',
        decorator: { type: 'BlackboardBased', key: 'EncounterType', expected: 'glimpse' },
        children: [
          { type: 'Task', name: 'BTTask_MoveTo', params: { key: 'TargetLocation', acceptRadius: 100 } },
          { type: 'Task', name: 'BTTask_FaceTarget', params: { key: 'TargetActor' } },
          { type: 'Task', name: 'BTTask_PlayAnimation', params: { anim: 'Glimpse_Evaluate' } },
          { type: 'Task', name: 'BTTask_Wait', params: { duration: 2.0 } },
          { type: 'Task', name: 'BTTask_VeyraAbility', params: { abilityId: 'ashen_dash', retreatAfter: true } },
          { type: 'Task', name: 'BTTask_Despawn', params: { fadeOut: true, duration: 0.5 } },
        ],
      },
      // Coop: fight alongside player
      {
        type: 'Sequence',
        description: 'Coop mode — allied combat AI',
        decorator: { type: 'BlackboardBased', key: 'bIsCoopMode', expected: true },
        children: [
          { type: 'Task', name: 'BTTask_FindNearestEnemy', params: { excludePlayer: true } },
          { type: 'Task', name: 'BTTask_MoveTo', params: { key: 'TargetActor', acceptRadius: 200 } },
          { type: 'Task', name: 'BTTask_ComboAttack', params: { comboLength: 3, targetEnemies: true } },
          { type: 'Task', name: 'BTTask_MaintainFormation', params: { leaderKey: 'LastKnownPlayerPos', offset: 300 } },
        ],
      },
      // Confrontation: face player for dialogue or combat
      {
        type: 'Sequence',
        description: 'Confrontation — approach player dramatically',
        decorator: { type: 'BlackboardBased', key: 'EncounterType', expected: 'confrontation' },
        children: [
          { type: 'Task', name: 'BTTask_WalkToPlayer', params: { speed: 200, stopDistance: 350 } },
          { type: 'Task', name: 'BTTask_FaceTarget', params: { key: 'TargetActor' } },
          { type: 'Task', name: 'BTTask_PlayAnimation', params: { anim: 'Confrontation_Ready' } },
          { type: 'Task', name: 'BTTask_TriggerDialogueOrCombat' },
        ],
      },
    ],
  };
}

// ── AI Controller Configuration ──────────────────────────────────────────────

/**
 * Complete AI controller configuration for Veyra. Includes:
 *  - Blueprint name and folder
 *  - Behavior tree reference
 *  - Blackboard reference
 *  - Perception component config
 *  - Variables for the AI controller BP
 *
 * Used by deployRivalAI() to create UE5 assets and by exportRivalAISpec()
 * for JSON export.
 */
export const RIVAL_AI_CONFIG = {
  controller: {
    name: 'BP_AIController_Veyra',
    folder: '/Game/AI/Rival',
    parentClass: 'AAIController',
  },
  behaviorTree: {
    name: 'BT_Veyra',
    folder: '/Game/AI/Rival',
  },
  blackboard: {
    name: 'BB_Veyra',
    folder: '/Game/AI/Rival',
    keys: VEYRA_BLACKBOARD_KEYS,
  },
  perception: {
    sightRadius: 2000,
    loseSightRadius: 2500,
    peripheralVisionAngle: 70,
    hearingRange: 1500,
    autoSuccessRange: 500,  // Always detect player within this range
    dominantSense: 'Sight',
  },
  // Variables added to the AI controller blueprint
  controllerVars: [
    { name: 'RelationshipScore',      type: 'int',   default: 0 },
    { name: 'RelationshipState',      type: 'Name',  default: 'neutral' },
    { name: 'CorruptionLevel',        type: 'float', default: 0.5 },
    { name: 'CorruptionTier',         type: 'int',   default: 3 },
    { name: 'CombatStyleName',        type: 'Name',  default: 'balanced' },
    { name: 'CurrentEncounterType',   type: 'Name',  default: 'none' },
    { name: 'PrimaryShardType',       type: 'Name',  default: '' },
    { name: 'SecondaryShardType',     type: 'Name',  default: '' },
    { name: 'bIsCoopActive',          type: 'bool',  default: false },
    { name: 'CrownResonanceCooldown', type: 'float', default: 0.0 },
    { name: 'PlayerShardHistory',     type: 'Name',  default: '' },
  ],
  // Functions the AI controller BP should have (created as stubs)
  controllerFunctions: [
    { name: 'UpdateCorruptionFromWillpower', description: 'Called when player willpower changes — recomputes inverse corruption' },
    { name: 'UpdateShardSpecialization',     description: 'Recomputes primary/secondary shards from player usage stats' },
    { name: 'UpdateCombatStyle',             description: 'Maps relationship state → combat style override on blackboard' },
    { name: 'OnEncounterStart',              description: 'Sets encounter type on blackboard, triggers region-specific setup' },
    { name: 'OnEncounterEnd',                description: 'Clears encounter state, applies relationship shifts' },
    { name: 'OnPlayerShardAttack',           description: 'Records player shard attack to history for Shard Counter' },
    { name: 'EvaluateCrownResonance',        description: 'Checks HP threshold and cooldown for desperation mode' },
    { name: 'GetRelationshipCombatMod',      description: 'Returns damage multiplier based on relationship state' },
    { name: 'TransitionToCoopMode',          description: 'Switches BT to allied combat subtree' },
    { name: 'TransitionFromCoopMode',        description: 'Returns to normal rival behavior' },
  ],
};

/**
 * Maps relationship state to combat style for blackboard override.
 * Called by the AI controller's UpdateCombatStyle function.
 */
export function getRelationshipCombatStyle(relationshipState) {
  const MAP = {
    hostile:        'aggressive',
    wary:           'defensive',
    neutral:        'balanced',
    reluctant_ally: 'restrained',
    rival_respect:  'honorable',
  };
  return MAP[relationshipState] || 'balanced';
}

/**
 * Compute the relationship state from a raw score.
 * @param {number} score - Raw relationship score (-100 to +100)
 * @returns {{ state: string, label: string, combatMod: number }}
 */
export function getRelationshipFromScore(score) {
  const states = Object.values(RELATIONSHIP_STATES)
    .sort((a, b) => b.threshold - a.threshold);

  for (const s of states) {
    if (score >= s.threshold) return { state: s.id, label: s.label, combatMod: s.combatMod };
  }
  return { state: 'hostile', label: 'Sworn Enemy', combatMod: 1.3 };
}

/**
 * Deploy the complete Rival AI system to UE5 via Unreal MCP tools.
 * Creates: Blackboard, Behavior Tree, AI Controller Blueprint.
 * Idempotent — safe to call multiple times.
 *
 * @returns {{ success: boolean, assets: string[], errors: string[] }}
 */
export async function deployRivalAI() {
  const results = { success: true, assets: [], errors: [] };
  const cfg = RIVAL_AI_CONFIG;

  // 1. Create Blackboard
  try {
    const bbResult = await callTool('unreal', 'create_blackboard', {
      name: cfg.blackboard.name,
      folder: cfg.blackboard.folder,
      keys: cfg.blackboard.keys.map(k => ({ name: k.name, type: k.type })),
    }, 30_000);
    results.assets.push(`${cfg.blackboard.folder}/${cfg.blackboard.name}`);
    log.info(`Created blackboard: ${cfg.blackboard.name}`, bbResult);
  } catch (err) {
    results.errors.push(`Blackboard: ${err.message}`);
    log.warn(`Blackboard creation failed: ${err.message}`);
  }

  // 2. Create Behavior Tree
  try {
    const btResult = await callTool('unreal', 'create_behavior_tree', {
      name: cfg.behaviorTree.name,
      blackboard_name: cfg.blackboard.name,
      folder: cfg.behaviorTree.folder,
    }, 30_000);
    results.assets.push(`${cfg.behaviorTree.folder}/${cfg.behaviorTree.name}`);
    log.info(`Created behavior tree: ${cfg.behaviorTree.name}`, btResult);
  } catch (err) {
    results.errors.push(`BehaviorTree: ${err.message}`);
    log.warn(`BT creation failed: ${err.message}`);
  }

  // 3. Create AI Controller Blueprint
  try {
    const aiResult = await callTool('unreal', 'create_ai_controller', {
      name: cfg.controller.name,
      folder: cfg.controller.folder,
    }, 30_000);
    results.assets.push(`${cfg.controller.folder}/${cfg.controller.name}`);
    log.info(`Created AI controller: ${cfg.controller.name}`, aiResult);

    // 3a. Add variables to the controller
    for (const v of cfg.controllerVars) {
      try {
        await callTool('unreal', 'create_variable', {
          blueprint_name: cfg.controller.name,
          name: v.name,
          type: v.type,
          default_value: v.default,
        }, 10_000);
      } catch (vErr) {
        results.errors.push(`Var ${v.name}: ${vErr.message}`);
      }
    }

    // 3b. Create function stubs
    for (const fn of cfg.controllerFunctions) {
      try {
        await callTool('unreal', 'create_function', {
          blueprint_name: cfg.controller.name,
          function_name: fn.name,
        }, 10_000);
      } catch (fErr) {
        results.errors.push(`Func ${fn.name}: ${fErr.message}`);
      }
    }

    // 3c. Add BeginPlay event
    try {
      await callTool('unreal', 'add_event_node', {
        blueprint_name: cfg.controller.name,
        event_type: 'BeginPlay',
        graph_name: 'EventGraph',
      }, 10_000);
    } catch (eErr) {
      results.errors.push(`Event BeginPlay: ${eErr.message}`);
    }
  } catch (err) {
    results.errors.push(`AIController: ${err.message}`);
    results.success = false;
    log.error(`AI controller creation failed: ${err.message}`);
  }

  if (results.errors.length > 0) {
    log.warn(`deployRivalAI completed with ${results.errors.length} non-fatal errors`);
  }

  return results;
}

// ══════════════════════════════════════════════════════════════════════════════
// ms_3: Dynamic Shard Loadout Selection — Player Blind Spot Exploitation
// ══════════════════════════════════════════════════════════════════════════════

// ── Shard Interaction Matrix ─────────────────────────────────────────────────
// Defines strengths/weaknesses between shard types (rock-paper-scissors-lizard-spock)
// Values: 1.0 = neutral, >1.0 = strong against, <1.0 = weak against

export const SHARD_MATCHUP_MATRIX = {
  Fire:   { Fire: 1.0, Water: 0.6, Nature: 1.4, Shield: 0.8, Time: 1.1, Shadow: 1.2 },
  Water:  { Fire: 1.4, Water: 1.0, Nature: 0.7, Shield: 1.1, Time: 0.9, Shadow: 0.8 },
  Nature: { Fire: 0.6, Water: 1.3, Nature: 1.0, Shield: 1.2, Time: 0.8, Shadow: 1.1 },
  Shield: { Fire: 1.2, Water: 0.9, Nature: 0.8, Shield: 1.0, Time: 1.3, Shadow: 0.7 },
  Time:   { Fire: 0.9, Water: 1.1, Nature: 1.2, Shield: 0.7, Time: 1.0, Shadow: 1.4 },
  Shadow: { Fire: 0.8, Water: 1.2, Nature: 0.9, Shield: 1.3, Time: 0.6, Shadow: 1.0 },
};

// ── Player Usage Tracker ─────────────────────────────────────────────────────

/**
 * Full player shard usage profile — tracks individual shard usage, combo pairs,
 * per-region preferences, and temporal windows for adaptation.
 *
 * @typedef {Object} PlayerShardProfile
 * @property {Record<string, number>} shardUsage - Total usage count per shard type
 * @property {Record<string, number>} comboUsage - Usage count per combo key ("Fire+Water")
 * @property {Record<string, Record<string, number>>} regionUsage - Per-region shard usage
 * @property {Array<{shard: string, timestamp: number}>} recentHistory - Rolling window of last N shard uses
 * @property {number} totalActions - Total shard actions recorded
 */

/**
 * Creates a blank player shard profile for tracking.
 * @returns {PlayerShardProfile}
 */
export function createPlayerShardProfile() {
  const shardUsage = {};
  const comboUsage = {};
  for (const s of SHARD_TYPES) {
    shardUsage[s] = 0;
    for (const s2 of SHARD_TYPES) {
      if (s !== s2) comboUsage[`${s}+${s2}`] = 0;
    }
  }
  return {
    shardUsage,
    comboUsage,
    regionUsage: {},
    recentHistory: [],
    totalActions: 0,
  };
}

/**
 * Record a player shard action into the profile.
 * @param {PlayerShardProfile} profile
 * @param {string} shardType - Primary shard used
 * @param {string} [comboShard] - Secondary shard if combo was used
 * @param {string} [region] - Current region name
 * @param {number} [timestamp] - Unix ms timestamp (defaults to Date.now())
 */
export function recordShardAction(profile, shardType, comboShard, region, timestamp) {
  const ts = timestamp || Date.now();

  // Individual shard tracking
  profile.shardUsage[shardType] = (profile.shardUsage[shardType] || 0) + 1;
  if (comboShard) {
    profile.shardUsage[comboShard] = (profile.shardUsage[comboShard] || 0) + 0.5; // secondary counts less
    const comboKey = `${shardType}+${comboShard}`;
    profile.comboUsage[comboKey] = (profile.comboUsage[comboKey] || 0) + 1;
  }

  // Region tracking
  if (region) {
    if (!profile.regionUsage[region]) {
      profile.regionUsage[region] = {};
      for (const s of SHARD_TYPES) profile.regionUsage[region][s] = 0;
    }
    profile.regionUsage[region][shardType] = (profile.regionUsage[region][shardType] || 0) + 1;
  }

  // Rolling recent history (keep last 50 actions)
  profile.recentHistory.push({ shard: shardType, combo: comboShard || null, timestamp: ts });
  if (profile.recentHistory.length > 50) {
    profile.recentHistory.shift();
  }

  profile.totalActions++;
}

// ── Blind Spot Analysis ──────────────────────────────────────────────────────

/**
 * Analyzes player shard profile to identify exploitable blind spots.
 * A blind spot is a shard type or combo pair that the player significantly
 * under-uses relative to the expected uniform distribution.
 *
 * @param {PlayerShardProfile} profile - Player's tracked usage
 * @param {string} [currentRegion] - If set, also analyzes region-specific patterns
 * @returns {BlindSpotAnalysis}
 *
 * @typedef {Object} BlindSpotAnalysis
 * @property {Array<{shard: string, score: number, reason: string}>} shardBlindSpots
 * @property {Array<{combo: string, score: number, reason: string}>} comboBlindSpots
 * @property {Array<{shard: string, trend: 'rising'|'falling'|'stable'}>} recentTrends
 * @property {string} dominantStyle - 'aggressive'|'defensive'|'balanced'|'specialist'|'unknown'
 * @property {number} versatilityScore - 0.0 (one-trick) to 1.0 (uses all equally)
 */
export function analyzeBlindSpots(profile, currentRegion) {
  const total = profile.totalActions || 1;
  const expectedPerShard = total / SHARD_TYPES.length;

  // ── Individual shard blind spots ──
  const shardBlindSpots = [];
  for (const shard of SHARD_TYPES) {
    const usage = profile.shardUsage[shard] || 0;
    const ratio = usage / expectedPerShard;
    // Blind spot if usage is less than 60% of expected uniform distribution
    if (ratio < 0.6) {
      const score = 1.0 - ratio; // Higher = bigger blind spot (0.4 to 1.0)
      shardBlindSpots.push({
        shard,
        score,
        usage,
        expected: Math.round(expectedPerShard),
        reason: usage === 0
          ? `Player has NEVER used ${shard} — maximum blind spot`
          : `Player uses ${shard} at ${Math.round(ratio * 100)}% of expected rate`,
      });
    }
  }
  shardBlindSpots.sort((a, b) => b.score - a.score);

  // ── Combo blind spots ──
  const totalCombos = Object.values(profile.comboUsage).reduce((s, v) => s + v, 0) || 1;
  const possibleCombos = SHARD_TYPES.length * (SHARD_TYPES.length - 1); // 30
  const expectedPerCombo = totalCombos / possibleCombos;

  const comboBlindSpots = [];
  for (const [combo, count] of Object.entries(profile.comboUsage)) {
    if (expectedPerCombo > 0.5) { // Only analyze if player has done enough combos
      const ratio = count / expectedPerCombo;
      if (ratio < 0.3) {
        comboBlindSpots.push({
          combo,
          score: 1.0 - ratio,
          usage: count,
          reason: count === 0
            ? `Player has NEVER used ${combo} combo`
            : `${combo} used only ${count} times (${Math.round(ratio * 100)}% expected)`,
        });
      }
    }
  }
  comboBlindSpots.sort((a, b) => b.score - a.score);

  // ── Recent trends (last 20 vs previous 20 in history) ──
  const recentTrends = [];
  if (profile.recentHistory.length >= 10) {
    const mid = Math.floor(profile.recentHistory.length / 2);
    const older = profile.recentHistory.slice(0, mid);
    const newer = profile.recentHistory.slice(mid);

    for (const shard of SHARD_TYPES) {
      const oldCount = older.filter(h => h.shard === shard).length;
      const newCount = newer.filter(h => h.shard === shard).length;
      const oldRate = oldCount / older.length;
      const newRate = newCount / newer.length;
      const delta = newRate - oldRate;

      let trend = 'stable';
      if (delta > 0.1) trend = 'rising';
      else if (delta < -0.1) trend = 'falling';

      recentTrends.push({ shard, trend, oldRate, newRate, delta });
    }
  }

  // ── Dominant play style classification ──
  const sorted = Object.entries(profile.shardUsage).sort((a, b) => b[1] - a[1]);
  const topUsage = sorted[0]?.[1] || 0;
  const topShard = sorted[0]?.[0] || 'none';
  const secondUsage = sorted[1]?.[1] || 0;

  let dominantStyle = 'unknown';
  if (total >= 5) {
    const concentration = topUsage / total;
    if (concentration > 0.5) {
      // Classify based on top shard
      if (topShard === 'Fire' || topShard === 'Shadow') dominantStyle = 'aggressive';
      else if (topShard === 'Shield' || topShard === 'Water') dominantStyle = 'defensive';
      else dominantStyle = 'specialist';
    } else if (topUsage / (secondUsage || 1) < 1.3) {
      dominantStyle = 'balanced';
    } else {
      dominantStyle = 'specialist';
    }
  }

  // ── Versatility score (Shannon entropy normalized) ──
  let entropy = 0;
  for (const shard of SHARD_TYPES) {
    const p = (profile.shardUsage[shard] || 0) / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  const maxEntropy = Math.log2(SHARD_TYPES.length); // ~2.585 for 6 types
  const versatilityScore = total >= 3 ? entropy / maxEntropy : 0.5;

  // ── Region-specific blind spots (if region provided) ──
  let regionBlindSpots = null;
  if (currentRegion && profile.regionUsage[currentRegion]) {
    const regionTotal = Object.values(profile.regionUsage[currentRegion]).reduce((s, v) => s + v, 0) || 1;
    const regionExpected = regionTotal / SHARD_TYPES.length;
    regionBlindSpots = [];
    for (const shard of SHARD_TYPES) {
      const usage = profile.regionUsage[currentRegion][shard] || 0;
      const ratio = usage / regionExpected;
      if (ratio < 0.5) {
        regionBlindSpots.push({
          shard,
          score: 1.0 - ratio,
          reason: `In ${currentRegion}, player barely uses ${shard}`,
        });
      }
    }
    regionBlindSpots.sort((a, b) => b.score - a.score);
  }

  return {
    shardBlindSpots,
    comboBlindSpots,
    recentTrends,
    dominantStyle,
    versatilityScore,
    regionBlindSpots,
    totalActionsAnalyzed: total,
  };
}

// ── Dynamic Loadout Builder ──────────────────────────────────────────────────

/**
 * @typedef {Object} RivalLoadout
 * @property {string} primaryShard - Main shard Veyra equips (biggest blind spot)
 * @property {string} secondaryShard - Backup shard (second biggest or best matchup)
 * @property {string} counterCombo - The combo pair Veyra will use most
 * @property {string} avoidShard - Shard Veyra avoids (player's strength)
 * @property {number} confidence - How confident the loadout is (0-1, based on data)
 * @property {string} strategy - Text description of the loadout strategy
 * @property {Object} abilityWeights - Weight multipliers for each combat ability
 * @property {Object} comboPreferences - Ordered list of combos Veyra prefers
 */

/**
 * Build Veyra's dynamic shard loadout based on player blind spot analysis.
 * This replaces the simple computeRivalShardSpec for full loadout computation.
 *
 * The loadout adapts to:
 *  1. Player's overall shard neglect (blind spots)
 *  2. Player's combo gaps (unexplored shard combinations)
 *  3. Shard type matchup advantages
 *  4. Recent player trends (if player is adapting, Veyra counter-adapts)
 *  5. Current corruption tier (higher corruption = more aggressive loadout)
 *  6. Region-specific patterns (different loadout per region)
 *
 * @param {PlayerShardProfile} profile - Player's tracked usage
 * @param {Object} [opts]
 * @param {number} [opts.corruptionTier=3] - Veyra's corruption tier (1-5)
 * @param {string} [opts.region] - Current region for region-aware selection
 * @param {string} [opts.relationshipState='neutral'] - Current relationship
 * @returns {RivalLoadout}
 */
export function buildDynamicLoadout(profile, opts = {}) {
  const { corruptionTier = 3, region, relationshipState = 'neutral' } = opts;
  const analysis = analyzeBlindSpots(profile, region);

  // ── Step 1: Select primary shard from blind spots ──
  let primaryShard;
  let secondaryShard;
  let primaryReason;

  // Prefer region-specific blind spots if available and significant
  const blindSpots = (analysis.regionBlindSpots?.length > 0)
    ? analysis.regionBlindSpots
    : analysis.shardBlindSpots;

  if (blindSpots.length >= 2) {
    primaryShard = blindSpots[0].shard;
    secondaryShard = blindSpots[1].shard;
    primaryReason = blindSpots[0].reason;
  } else if (blindSpots.length === 1) {
    primaryShard = blindSpots[0].shard;
    primaryReason = blindSpots[0].reason;
    // Secondary: pick shard with best matchup against player's top shard
    const playerTop = Object.entries(profile.shardUsage).sort((a, b) => b[1] - a[1])[0]?.[0];
    secondaryShard = pickBestMatchup(primaryShard, playerTop);
  } else {
    // Player is balanced — fall back to matchup-based selection
    const playerTop = Object.entries(profile.shardUsage).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Fire';
    primaryShard = pickCounter(playerTop);
    secondaryShard = pickBestMatchup(primaryShard, playerTop);
    primaryReason = `Player is versatile — Veyra counters their top shard (${playerTop})`;
  }

  // ── Step 2: Counter-adapt if player is trending toward their blind spots ──
  const risingTowardBlindSpot = analysis.recentTrends.find(
    t => t.trend === 'rising' && t.shard === primaryShard
  );
  if (risingTowardBlindSpot && analysis.shardBlindSpots.length >= 3) {
    // Player is learning! Shift to the next blind spot
    const fallback = analysis.shardBlindSpots.find(b => b.shard !== primaryShard);
    if (fallback) {
      log.info(`Player adapting to ${primaryShard} — Veyra shifts to ${fallback.shard}`);
      secondaryShard = primaryShard;
      primaryShard = fallback.shard;
      primaryReason = `Counter-adaptation: player started using ${secondaryShard}, shifting to ${fallback.shard}`;
    }
  }

  // ── Step 3: Determine which shard to avoid (player's strength) ──
  const sortedByUsage = Object.entries(profile.shardUsage).sort((a, b) => b[1] - a[1]);
  const avoidShard = sortedByUsage[0]?.[0] || 'Fire';

  // ── Step 4: Build combo preferences ──
  const comboPreferences = buildComboPreferences(primaryShard, secondaryShard, avoidShard, analysis);

  // ── Step 5: Compute ability weights based on loadout ──
  const abilityWeights = computeAbilityWeights(primaryShard, secondaryShard, corruptionTier, analysis);

  // ── Step 6: Determine strategy description ──
  const strategy = buildStrategyDescription(
    primaryShard, secondaryShard, avoidShard, analysis, corruptionTier, relationshipState
  );

  // ── Step 7: Confidence based on data quality ──
  const confidence = Math.min(1.0, profile.totalActions / 30); // Full confidence at 30+ actions

  return {
    primaryShard,
    secondaryShard,
    counterCombo: comboPreferences[0]?.combo || `${primaryShard}+${secondaryShard}`,
    avoidShard,
    confidence,
    strategy,
    abilityWeights,
    comboPreferences,
    blindSpotAnalysis: analysis,
    adaptationNote: risingTowardBlindSpot
      ? `Counter-adapting: player rising usage of ${risingTowardBlindSpot.shard}`
      : null,
  };
}

/**
 * Pick the shard type that counters a given shard (best matchup value).
 * @param {string} targetShard - The shard to counter
 * @returns {string}
 */
function pickCounter(targetShard) {
  let best = null;
  let bestValue = 0;
  for (const shard of SHARD_TYPES) {
    if (shard === targetShard) continue;
    const matchup = SHARD_MATCHUP_MATRIX[shard]?.[targetShard] || 1.0;
    if (matchup > bestValue) {
      bestValue = matchup;
      best = shard;
    }
  }
  return best || SHARD_TYPES[0];
}

/**
 * Pick the best secondary shard to complement the primary against a target.
 * @param {string} primaryShard
 * @param {string} targetShard
 * @returns {string}
 */
function pickBestMatchup(primaryShard, targetShard) {
  let best = null;
  let bestValue = 0;
  for (const shard of SHARD_TYPES) {
    if (shard === primaryShard || shard === targetShard) continue;
    const matchup = SHARD_MATCHUP_MATRIX[shard]?.[targetShard] || 1.0;
    if (matchup > bestValue) {
      bestValue = matchup;
      best = shard;
    }
  }
  return best || SHARD_TYPES.find(s => s !== primaryShard) || SHARD_TYPES[0];
}

/**
 * Build ordered combo preferences for Veyra based on loadout.
 * Prioritizes combos using primary/secondary shards that exploit player gaps.
 */
function buildComboPreferences(primary, secondary, avoid, analysis) {
  const prefs = [];

  // All combos involving primary or secondary shard, excluding avoided
  for (const s of SHARD_TYPES) {
    if (s === avoid) continue;

    // Primary as first shard
    if (s !== primary) {
      const comboKey = `${primary}+${s}`;
      const playerUsage = analysis.comboBlindSpots.find(b => b.combo === comboKey);
      prefs.push({
        combo: comboKey,
        weight: 1.0 + (playerUsage ? playerUsage.score * 0.5 : 0),
        source: 'primary',
      });
    }

    // Secondary as first shard
    if (s !== secondary && s !== primary) {
      const comboKey = `${secondary}+${s}`;
      const playerUsage = analysis.comboBlindSpots.find(b => b.combo === comboKey);
      prefs.push({
        combo: comboKey,
        weight: 0.7 + (playerUsage ? playerUsage.score * 0.3 : 0),
        source: 'secondary',
      });
    }
  }

  // Sort by weight descending
  prefs.sort((a, b) => b.weight - a.weight);
  return prefs.slice(0, 6); // Top 6 combos
}

/**
 * Compute ability weights for Veyra's combat abilities based on her loadout.
 * Higher corruption = more aggressive ability usage.
 */
function computeAbilityWeights(primary, secondary, corruptionTier, analysis) {
  const corruptionMod = 0.6 + (corruptionTier * 0.15); // 0.75 at tier 1, 1.35 at tier 5
  const isAggressive = analysis.dominantStyle === 'defensive'; // Counter player style

  return {
    shard_counter: {
      weight: 1.2 * corruptionMod,
      note: 'Always high — core counter ability',
      preferredElement: primary,
    },
    ashen_dash: {
      weight: isAggressive ? 1.5 * corruptionMod : 0.8 * corruptionMod,
      note: isAggressive ? 'Gap-close aggressively against defensive player' : 'Repositioning tool',
    },
    mirror_stance: {
      weight: analysis.versatilityScore > 0.7 ? 1.3 : 0.6,
      note: analysis.versatilityScore > 0.7
        ? 'Player is versatile — mirror their variety'
        : 'Player is predictable — stick to own shards instead',
      mirrorShard: analysis.versatilityScore > 0.7 ? null : primary,
    },
    crown_resonance: {
      weight: corruptionTier >= 4 ? 1.5 : 0.8,
      note: corruptionTier >= 4
        ? 'High corruption — resonance is more volatile and powerful'
        : 'Low corruption — resonance is restrained',
      bonusDamageType: primary,
    },
  };
}

/**
 * Build a human-readable strategy description for the loadout.
 */
function buildStrategyDescription(primary, secondary, avoid, analysis, corruption, relationship) {
  const parts = [];

  parts.push(`Veyra equips ${primary} as her primary shard and ${secondary} as backup.`);
  parts.push(`She avoids ${avoid} — the player's strongest domain.`);

  if (analysis.shardBlindSpots.length >= 3) {
    parts.push(`Player has ${analysis.shardBlindSpots.length} significant blind spots — Veyra exploits their narrow build.`);
  } else if (analysis.shardBlindSpots.length === 0) {
    parts.push(`Player is versatile (score: ${analysis.versatilityScore.toFixed(2)}) — Veyra relies on matchup counters.`);
  }

  if (corruption >= 4) {
    parts.push(`At corruption tier ${corruption}, her shard powers are amplified but unstable.`);
  }

  const styleCounterMap = {
    aggressive: 'defensive patience — she lets the player overcommit then punishes',
    defensive: 'aggressive pressure — she forces the player out of their comfort zone',
    balanced: 'unpredictable variety — she keeps the player guessing',
    specialist: 'exploiting their tunnel-vision on a single shard type',
  };
  if (styleCounterMap[analysis.dominantStyle]) {
    parts.push(`Against the player's ${analysis.dominantStyle} style, Veyra uses ${styleCounterMap[analysis.dominantStyle]}.`);
  }

  return parts.join(' ');
}

// ── Loadout Persistence & UE5 Export ─────────────────────────────────────────

/**
 * Compute the full loadout and export it alongside the existing rival spec.
 * Creates a dedicated loadout JSON for UE5 Data Table import.
 *
 * @param {PlayerShardProfile} profile - Player's tracked shard usage
 * @param {Object} [opts] - Same opts as buildDynamicLoadout
 * @returns {{ success: boolean, path: string, loadout: RivalLoadout }}
 */
export function exportRivalLoadout(profile, opts = {}) {
  const game = getActiveGame();
  const outDir = join(game.assetsPath, 'AI');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const loadout = buildDynamicLoadout(profile, opts);

  const spec = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    milestone: 'ms_3',
    description: 'Dynamic shard loadout — Veyra adapts to player blind spots',
    loadout,
    matchupMatrix: SHARD_MATCHUP_MATRIX,
    // UE5 Data Table format for BP consumption
    dataTableRows: [
      {
        RowName: 'VeyraLoadout_Current',
        PrimaryShard: loadout.primaryShard,
        SecondaryShard: loadout.secondaryShard,
        AvoidShard: loadout.avoidShard,
        CounterCombo: loadout.counterCombo,
        Confidence: loadout.confidence,
        ShardCounterWeight: loadout.abilityWeights.shard_counter.weight,
        AshenDashWeight: loadout.abilityWeights.ashen_dash.weight,
        MirrorStanceWeight: loadout.abilityWeights.mirror_stance.weight,
        CrownResonanceWeight: loadout.abilityWeights.crown_resonance.weight,
      },
    ],
  };

  const outPath = join(outDir, 'rival-veyra-loadout.json');
  writeFileSync(outPath, JSON.stringify(spec, null, 2), 'utf-8');
  log.info(`Rival loadout exported to ${outPath}`);
  return { success: true, path: outPath, loadout };
}

/**
 * Quick loadout summary for agent cycle / brief builders.
 * Lighter than full buildDynamicLoadout — just the key decisions.
 *
 * @param {Record<string, number>} playerShardUsage - Simple shard→count map
 * @param {number} [corruptionTier=3]
 * @returns {{ primary: string, secondary: string, avoid: string, confidence: number, strategy: string }}
 */
export function getLoadoutSummary(playerShardUsage = {}, corruptionTier = 3) {
  const profile = createPlayerShardProfile();
  // Backfill from simple usage map
  for (const [shard, count] of Object.entries(playerShardUsage)) {
    profile.shardUsage[shard] = count;
    profile.totalActions += count;
  }
  const loadout = buildDynamicLoadout(profile, { corruptionTier });
  return {
    primary: loadout.primaryShard,
    secondary: loadout.secondaryShard,
    avoid: loadout.avoidShard,
    confidence: loadout.confidence,
    strategy: loadout.strategy,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// ms_4: Rival Encounter Scripting — Key Story Moments
// ══════════════════════════════════════════════════════════════════════════════
//
// Full encounter scripts for Veyra Ashcroft across all 8 regions.
// Each encounter is a self-contained scripted sequence with:
//   - Pre-conditions (player progress, relationship range, prior encounters)
//   - Stage directions (spawn, movement, positioning, VFX)
//   - Dialogue branches (choice-driven, connecting to npc-dialogue.js SPEAKERS)
//   - Combat triggers (when applicable, with difficulty scaling)
//   - Cinematic cues (camera, lighting, audio)
//   - State mutations (relationship shifts, corruption changes, flags set)
//   - Post-encounter cleanup (despawn, persistence saves)
//
// Integration:
//   - MOTIVATION_ARC.acts[].keyBeats → encounter triggers
//   - ENCOUNTER_SCHEDULE → encounter type/duration
//   - RELATIONSHIP_SHIFTS → score changes from player choices
//   - RIVAL_COMBAT → combat stats/abilities
//   - computeRivalCorruption() → visual state during encounters
//   - npc-dialogue.js SPEAKERS/EMOTIONS → dialogue formatting
//   - willpower-tracker.js → player willpower reads
//   - corruption-shader.js → VFX tier params

// ── Encounter State Machine ─────────────────────────────────────────────────

/**
 * All possible encounter phases. Each encounter script is a linear sequence
 * of phases, with branches at DIALOGUE phases based on player choice.
 */
export const ENCOUNTER_PHASES = {
  TRIGGER:     'trigger',      // Conditions met, encounter begins
  CINEMATIC:   'cinematic',    // Camera takeover, intro sequence
  APPROACH:    'approach',     // Veyra moves to interaction point
  DIALOGUE:    'dialogue',     // Dialogue with player choices
  COMBAT:      'combat',       // Combat encounter (optional)
  RESOLUTION:  'resolution',   // Outcome based on choices/combat result
  TRANSITION:  'transition',   // State mutations, flag saves
  CLEANUP:     'cleanup',      // Despawn, camera return, persistence
};

/**
 * Encounter flags — persistent booleans tracked across the full playthrough.
 * Set during encounters, checked as pre-conditions for later encounters.
 */
export const ENCOUNTER_FLAGS = {
  // Act 1
  FIRST_GLIMPSE_SEEN:       'veyra_first_glimpse_seen',
  ASHEN_SHARD_FOUGHT:       'veyra_ashen_shard_fought',
  ASHEN_SHARD_YIELDED:      'veyra_ashen_shard_yielded',
  IRONHOLD_COOPERATED:      'veyra_ironhold_cooperated',
  IRONHOLD_BETRAYED:        'veyra_ironhold_betrayed',
  // Act 2
  CORRUPTION_CHOICE_WITNESSED: 'veyra_corruption_choice_witnessed',
  CAELEN_DISCOVERED:        'veyra_caelen_discovered',
  CAELEN_COMFORTED:         'veyra_caelen_comforted',
  CAELEN_CONFRONTED:        'veyra_caelen_confronted',
  EMBER_ALLIANCE_ACCEPTED:  'veyra_ember_alliance_accepted',
  EMBER_ALLIANCE_REFUSED:   'veyra_ember_alliance_refused',
  // Act 3
  AETHERMERE_AGREED_COMBINE: 'veyra_aethermere_agreed_combine',
  AETHERMERE_REFUSED_COMBINE: 'veyra_aethermere_refused_combine',
  CROWN_CONFRONTATION_REACHED: 'veyra_crown_confrontation_reached',
  // Meta
  TOTAL_ENCOUNTERS_COMPLETED: 'veyra_encounters_completed',
};

// ── Cinematic Camera Presets ────────────────────────────────────────────────

const CAMERA_PRESETS = {
  /** Over-shoulder on player looking at Veyra */
  overShoulder: {
    type: 'CineCameraActor',
    focalLength: 50,
    aperture: 2.8,
    offsetFromPlayer: { x: -120, y: 60, z: 30 },
    lookAtTarget: 'Veyra',
    dofMethod: 'Gaussian',
    dofNearBlur: 0.5,
  },
  /** Wide establishing shot showing both characters */
  wideEstablish: {
    type: 'CineCameraActor',
    focalLength: 24,
    aperture: 5.6,
    offsetFromMidpoint: { x: 0, y: -400, z: 200 },
    lookAtTarget: 'Midpoint',
    dofMethod: 'None',
  },
  /** Close-up on Veyra's face (emotion shots) */
  veyraCloseup: {
    type: 'CineCameraActor',
    focalLength: 85,
    aperture: 1.8,
    offsetFromVeyra: { x: 80, y: 30, z: 5 },
    lookAtTarget: 'Veyra_Head',
    dofMethod: 'Gaussian',
    dofNearBlur: 1.2,
  },
  /** Dramatic low-angle (power moments) */
  lowAngleDrama: {
    type: 'CineCameraActor',
    focalLength: 35,
    aperture: 4.0,
    offsetFromVeyra: { x: 150, y: 0, z: -80 },
    lookAtTarget: 'Veyra',
    dofMethod: 'None',
  },
  /** Aerial/crane shot (reveals, transitions) */
  aerialCrane: {
    type: 'CineCameraActor',
    focalLength: 35,
    aperture: 8.0,
    offsetFromMidpoint: { x: 0, y: 0, z: 600 },
    lookAtTarget: 'Midpoint',
    dofMethod: 'None',
  },
};

// ── Audio Cues ──────────────────────────────────────────────────────────────

const AUDIO_CUES = {
  rivalTheme:         { asset: '/Game/Audio/Music/MUS_RivalTheme',          fadeIn: 2.0, fadeOut: 3.0 },
  rivalTense:         { asset: '/Game/Audio/Music/MUS_RivalTense',          fadeIn: 1.0, fadeOut: 2.0 },
  rivalEmotional:     { asset: '/Game/Audio/Music/MUS_RivalEmotional',      fadeIn: 2.0, fadeOut: 4.0 },
  rivalCombat:        { asset: '/Game/Audio/Music/MUS_RivalCombat',         fadeIn: 0.5, fadeOut: 2.0 },
  rivalClimax:        { asset: '/Game/Audio/Music/MUS_RivalClimax',         fadeIn: 1.0, fadeOut: 5.0 },
  corruptionPulse:    { asset: '/Game/Audio/SFX/SFX_CorruptionPulse',      fadeIn: 0,   fadeOut: 0.5 },
  shardResonance:     { asset: '/Game/Audio/SFX/SFX_ShardResonance',       fadeIn: 0,   fadeOut: 1.0 },
  footstepsStone:     { asset: '/Game/Audio/SFX/SFX_Footsteps_Stone',      fadeIn: 0,   fadeOut: 0 },
  caveRumble:         { asset: '/Game/Audio/SFX/SFX_CaveRumble',           fadeIn: 0.5, fadeOut: 2.0 },
  windHowl:           { asset: '/Game/Audio/SFX/SFX_WindHowl',             fadeIn: 1.0, fadeOut: 2.0 },
};

// ── VFX Presets ─────────────────────────────────────────────────────────────

const VFX_PRESETS = {
  corruptionAura:     { asset: '/Game/VFX/NS_CorruptionAura',      attachTo: 'Veyra_Mesh', param_Intensity: 'CorruptionTier' },
  ashenDashTrail:     { asset: '/Game/VFX/NS_AshenDashTrail',      attachTo: 'Veyra_Mesh', duration: 1.5 },
  shardGlow:          { asset: '/Game/VFX/NS_ShardGlow',           attachTo: 'Hand_R',     param_Color: 'ShardElement' },
  crownResonanceVFX:  { asset: '/Game/VFX/NS_CrownResonance',     attachTo: 'Veyra_Mesh', duration: 5.0 },
  environmentCorrupt: { asset: '/Game/VFX/NS_EnvironmentCorrupt',  attachTo: 'World',      radius: 500 },
  tearDrop:           { asset: '/Game/VFX/NS_TearDrop',            attachTo: 'Veyra_Head', duration: 3.0 },
  dualShardMerge:     { asset: '/Game/VFX/NS_DualShardMerge',     attachTo: 'Midpoint',   duration: 8.0 },
};

// ── Encounter Scripts ───────────────────────────────────────────────────────
//
// Each encounter is an object with:
//   id, region, act, encounterType, prerequisites, phases[]
//
// Phases reference ENCOUNTER_PHASES and contain detailed stage directions.

/**
 * Complete encounter scripts for all 8 regions.
 * Ordered chronologically through the 3-act structure.
 */
export const ENCOUNTER_SCRIPTS = {

  // ════════════════════════════════════════════════════════════════════════════
  // ACT 1 — "The Race"
  // ════════════════════════════════════════════════════════════════════════════

  // ── CrossroadsHub: First Glimpse ──────────────────────────────────────────
  crossroads_first_glimpse: {
    id: 'crossroads_first_glimpse',
    region: 'CrossroadsHub',
    act: 'act_1',
    encounterType: 'glimpse',
    title: 'The Other Seeker',
    description: 'Player spots Veyra leaving a shard-bearer\'s cave. She pauses, evaluates Kael, then vanishes.',

    prerequisites: {
      playerLevel: { min: 1 },
      questProgress: 'entered_crossroads_cavern',
      requiredFlags: [],
      blockedByFlags: [ENCOUNTER_FLAGS.FIRST_GLIMPSE_SEEN],
    },

    spawnConfig: {
      veyraSpawnPoint: 'BP_SpawnPoint_Veyra_Crossroads',
      spawnOffset: { x: 0, y: 0, z: 0 },
      initialFacing: 'away_from_player',
      corruptionOverride: null, // Use computed value
    },

    phases: [
      {
        phase: ENCOUNTER_PHASES.TRIGGER,
        duration: 0,
        description: 'Player enters cavern exit trigger volume',
        actions: [
          { type: 'trigger_volume', location: 'CavernExit_TriggerVol', radius: 300 },
          { type: 'set_flag', flag: ENCOUNTER_FLAGS.FIRST_GLIMPSE_SEEN, value: true },
          { type: 'disable_player_combat', reason: 'Cinematic encounter — no combat in glimpse' },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.CINEMATIC,
        duration: 3.0,
        description: 'Camera pulls to wide shot revealing Veyra at cave mouth',
        actions: [
          { type: 'spawn_actor', actor: 'BP_Veyra', location: 'CavernMouth_SpawnPoint' },
          { type: 'set_corruption_visuals', tier: 1 },
          { type: 'play_vfx', vfx: VFX_PRESETS.shardGlow, params: { color: 'amber' } },
          { type: 'camera_cut', preset: CAMERA_PRESETS.wideEstablish, blendTime: 1.5 },
          { type: 'play_audio', cue: AUDIO_CUES.rivalTheme },
          { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_ExaminesShard', duration: 2.0 },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.APPROACH,
        duration: 2.0,
        description: 'Veyra senses the player\'s shard, turns to look',
        actions: [
          { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_ShardPulse', duration: 0.5 },
          { type: 'play_sfx', cue: AUDIO_CUES.shardResonance },
          { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_TurnToFace', duration: 1.0 },
          { type: 'camera_cut', preset: CAMERA_PRESETS.overShoulder, blendTime: 1.0 },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.DIALOGUE,
        duration: null, // Player-paced
        description: 'Brief non-interactive — Veyra speaks, no player choice',
        dialogueNodes: [
          {
            speaker: 'Veyra',
            emotion: 'mysterious',
            text: 'You found a shard too. Interesting. The Crown doesn\'t choose randomly.',
            anim: 'Anim_Veyra_Idle_Confident',
            camera: CAMERA_PRESETS.veyraCloseup,
          },
          {
            speaker: 'Veyra',
            emotion: 'determined',
            text: 'Don\'t follow me. This path has room for one seeker only.',
            anim: 'Anim_Veyra_TurnAway',
            camera: CAMERA_PRESETS.overShoulder,
          },
        ],
        playerChoices: null, // No choice — observation only
      },
      {
        phase: ENCOUNTER_PHASES.RESOLUTION,
        duration: 3.0,
        description: 'Veyra performs Ashen Dash and vanishes',
        actions: [
          { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_AshenDash', duration: 1.0 },
          { type: 'play_vfx', vfx: VFX_PRESETS.ashenDashTrail },
          { type: 'play_sfx', cue: AUDIO_CUES.corruptionPulse },
          { type: 'fade_out_actor', target: 'Veyra', duration: 0.5 },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.TRANSITION,
        duration: 0,
        actions: [
          { type: 'increment_counter', flag: ENCOUNTER_FLAGS.TOTAL_ENCOUNTERS_COMPLETED },
          { type: 'save_encounter_state', encounterId: 'crossroads_first_glimpse', result: 'observed' },
          { type: 'unlock_codex_entry', entry: 'codex_veyra_ashcroft' },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.CLEANUP,
        duration: 2.0,
        actions: [
          { type: 'camera_return', blendTime: 2.0 },
          { type: 'fade_audio', cue: AUDIO_CUES.rivalTheme, fadeOut: 3.0 },
          { type: 'enable_player_combat' },
          { type: 'destroy_actor', target: 'BP_Veyra' },
          { type: 'show_objective', text: 'A rival seeker... Who is she?' },
        ],
      },
    ],
  },

  // ── AshenWilds: Confrontation at the Ruins ────────────────────────────────
  ashen_confrontation: {
    id: 'ashen_confrontation',
    region: 'AshenWilds',
    act: 'act_1',
    encounterType: 'confrontation',
    title: 'The Ashen Shard',
    description: 'Both reach the Ashen Shard simultaneously. First direct dialogue — optional fight or yield.',

    prerequisites: {
      playerLevel: { min: 5 },
      questProgress: 'reached_ashen_shard_chamber',
      requiredFlags: [ENCOUNTER_FLAGS.FIRST_GLIMPSE_SEEN],
      blockedByFlags: [ENCOUNTER_FLAGS.ASHEN_SHARD_FOUGHT, ENCOUNTER_FLAGS.ASHEN_SHARD_YIELDED],
    },

    spawnConfig: {
      veyraSpawnPoint: 'BP_SpawnPoint_Veyra_AshenRuins',
      spawnOffset: { x: 0, y: 0, z: 0 },
      initialFacing: 'toward_shard',
      corruptionOverride: null,
    },

    phases: [
      {
        phase: ENCOUNTER_PHASES.TRIGGER,
        duration: 0,
        actions: [
          { type: 'trigger_volume', location: 'AshenShardChamber_TriggerVol', radius: 400 },
          { type: 'disable_player_combat', reason: 'Pre-dialogue' },
          { type: 'lock_exits', chamber: 'AshenShardChamber' },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.CINEMATIC,
        duration: 5.0,
        description: 'Camera reveals both seekers arriving from opposite entrances',
        actions: [
          { type: 'spawn_actor', actor: 'BP_Veyra', location: 'AshenChamber_VeyraEntry' },
          { type: 'set_corruption_visuals', tier: 1 },
          { type: 'camera_cut', preset: CAMERA_PRESETS.aerialCrane, blendTime: 2.0 },
          { type: 'play_audio', cue: AUDIO_CUES.rivalTense },
          { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_Walk_Determined', duration: 3.0 },
          { type: 'play_anim', target: 'Kael', anim: 'Anim_Kael_Walk_Cautious', duration: 3.0 },
          { type: 'spotlight', target: 'AshenShard_Pedestal', intensity: 2.0, color: 'orange' },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.APPROACH,
        duration: 3.0,
        description: 'Both reach the shard pedestal. Veyra speaks first.',
        actions: [
          { type: 'move_to', target: 'Veyra', destination: 'AshenShard_VeyraStand', speed: 200 },
          { type: 'camera_cut', preset: CAMERA_PRESETS.overShoulder, blendTime: 1.0 },
          { type: 'play_vfx', vfx: VFX_PRESETS.environmentCorrupt, params: { radius: 300 } },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.DIALOGUE,
        duration: null,
        description: 'Veyra reveals her connection to AshenWilds, then player chooses',
        dialogueNodes: [
          {
            speaker: 'Veyra',
            emotion: 'sad',
            text: 'This was my home. Ashcroft — the village that burned. This shard grew from its ashes.',
            anim: 'Anim_Veyra_GestureAtRuins',
            camera: CAMERA_PRESETS.veyraCloseup,
          },
          {
            speaker: 'Veyra',
            emotion: 'determined',
            text: 'I didn\'t come this far to watch someone else take what\'s left of my world.',
            anim: 'Anim_Veyra_DrawWeapon',
            camera: CAMERA_PRESETS.lowAngleDrama,
          },
          {
            speaker: 'Kael',
            emotion: 'neutral',
            text: '(The shard pulses between you. Its light reaches toward both seekers.)',
            anim: null,
            camera: CAMERA_PRESETS.wideEstablish,
            isNarration: true,
          },
        ],
        playerChoices: [
          {
            id: 'fight_for_shard',
            label: '"I need that shard. Stand aside."',
            emotion: 'determined',
            consequence: {
              branch: 'combat',
              relationshipShift: -20, // ashen_fight_for_shard
              flagSet: ENCOUNTER_FLAGS.ASHEN_SHARD_FOUGHT,
              veyraReaction: {
                text: 'Then earn it.',
                emotion: 'hostile',
                anim: 'Anim_Veyra_CombatReady',
              },
            },
          },
          {
            id: 'yield_shard',
            label: '"This place is yours. Take the shard."',
            emotion: 'empathetic',
            consequence: {
              branch: 'resolution_peaceful',
              relationshipShift: +15, // ashen_let_take_shard
              flagSet: ENCOUNTER_FLAGS.ASHEN_SHARD_YIELDED,
              veyraReaction: {
                text: '...You\'re either very brave or very foolish. I won\'t forget this.',
                emotion: 'surprised',
                anim: 'Anim_Veyra_NodRespect',
              },
            },
          },
          {
            id: 'share_shard',
            label: '"The shard reached for both of us. Maybe it wasn\'t meant for one person."',
            emotion: 'hopeful',
            condition: { minWillpower: 0.4 }, // Requires some willpower
            consequence: {
              branch: 'resolution_shared',
              relationshipShift: +10,
              flagSet: ENCOUNTER_FLAGS.ASHEN_SHARD_YIELDED,
              veyraReaction: {
                text: 'Share? No one shares a shard... (pauses) ...but no one\'s offered before, either.',
                emotion: 'conflicted',
                anim: 'Anim_Veyra_Hesitate',
              },
            },
          },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.COMBAT,
        duration: null, // Until resolved
        description: 'Only triggers if player chose "fight_for_shard"',
        condition: { branch: 'combat' },
        combatConfig: {
          veyraLevel: 'player_level + 1',
          abilities: ['shard_counter', 'ashen_dash'],
          behaviorStyle: 'aggressive', // Home turf — fighting for heritage
          retreatThreshold: 0.25, // Veyra retreats at 25% HP — she won't die here
          retreatDialogue: {
            speaker: 'Veyra',
            emotion: 'grudging',
            text: 'Fine. Take it. But know that every shard you claim, I\'ll claim two more.',
          },
          playerDefeatBehavior: 'veyra_takes_shard_spares_player',
          playerDefeatDialogue: {
            speaker: 'Veyra',
            emotion: 'disappointed',
            text: 'If this is the best the Crown could find... perhaps I\'m doing the world a favor.',
          },
          rewards: {
            playerWins: { item: 'AshenShard', xp: 500, codex: 'codex_veyra_defeated_ashen' },
            playerLoses: { xp: 200, codex: 'codex_veyra_victorious_ashen' },
          },
          audio: AUDIO_CUES.rivalCombat,
          arena: { center: 'AshenShard_Pedestal', radius: 600, hazards: ['corruption_pools', 'falling_debris'] },
        },
      },
      {
        phase: ENCOUNTER_PHASES.RESOLUTION,
        duration: 4.0,
        description: 'Branch-dependent resolution',
        branches: {
          combat: {
            playerWins: [
              { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_Retreat', duration: 2.0 },
              { type: 'play_vfx', vfx: VFX_PRESETS.ashenDashTrail },
              { type: 'fade_out_actor', target: 'Veyra', duration: 1.0 },
              { type: 'grant_item', item: 'AshenShard' },
            ],
            playerLoses: [
              { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_TakeShard', duration: 2.0 },
              { type: 'fade_out_actor', target: 'Veyra', duration: 1.0 },
              { type: 'play_anim', target: 'Kael', anim: 'Anim_Kael_KneelDefeated', duration: 2.0 },
            ],
          },
          resolution_peaceful: [
            { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_TakeShard_Reverent', duration: 3.0 },
            { type: 'play_vfx', vfx: VFX_PRESETS.shardGlow, params: { color: 'warm_amber' } },
            { type: 'camera_cut', preset: CAMERA_PRESETS.veyraCloseup, blendTime: 1.0 },
            { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_Nod', duration: 1.0 },
            { type: 'fade_out_actor', target: 'Veyra', duration: 2.0 },
          ],
          resolution_shared: [
            { type: 'play_vfx', vfx: VFX_PRESETS.dualShardMerge },
            { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_ShardSplit', duration: 3.0 },
            { type: 'grant_item', item: 'AshenShard_Half' },
            { type: 'camera_cut', preset: CAMERA_PRESETS.wideEstablish, blendTime: 1.5 },
            { type: 'fade_out_actor', target: 'Veyra', duration: 2.0 },
          ],
        },
      },
      {
        phase: ENCOUNTER_PHASES.TRANSITION,
        duration: 0,
        actions: [
          { type: 'apply_relationship_shift' }, // Uses the chosen branch's shift
          { type: 'increment_counter', flag: ENCOUNTER_FLAGS.TOTAL_ENCOUNTERS_COMPLETED },
          { type: 'save_encounter_state', encounterId: 'ashen_confrontation' },
          { type: 'unlock_codex_entry', entry: 'codex_veyra_ashcroft_village' },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.CLEANUP,
        duration: 2.0,
        actions: [
          { type: 'camera_return', blendTime: 2.0 },
          { type: 'fade_audio', cue: AUDIO_CUES.rivalTense, fadeOut: 3.0 },
          { type: 'enable_player_combat' },
          { type: 'unlock_exits', chamber: 'AshenShardChamber' },
          { type: 'destroy_actor', target: 'BP_Veyra' },
        ],
      },
    ],
  },

  // ── Ironhold: Reluctant Truce ─────────────────────────────────────────────
  ironhold_truce: {
    id: 'ironhold_truce',
    region: 'Ironhold',
    act: 'act_1',
    encounterType: 'forced_coop',
    title: 'Buried Together',
    description: 'A corruption beast traps both seekers in the Ironhold mines. Must cooperate to escape.',

    prerequisites: {
      playerLevel: { min: 10 },
      questProgress: 'entered_ironhold_deep_mines',
      requiredFlags: [ENCOUNTER_FLAGS.FIRST_GLIMPSE_SEEN],
      blockedByFlags: [ENCOUNTER_FLAGS.IRONHOLD_COOPERATED, ENCOUNTER_FLAGS.IRONHOLD_BETRAYED],
    },

    spawnConfig: {
      veyraSpawnPoint: 'BP_SpawnPoint_Veyra_Ironhold',
      initialFacing: 'toward_collapse',
      corruptionOverride: null,
    },

    phases: [
      {
        phase: ENCOUNTER_PHASES.TRIGGER,
        duration: 0,
        actions: [
          { type: 'trigger_volume', location: 'IronholdDeepMines_TriggerVol', radius: 500 },
          { type: 'play_sfx', cue: AUDIO_CUES.caveRumble },
          { type: 'environmental_event', event: 'mine_collapse', blockExits: true },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.CINEMATIC,
        duration: 6.0,
        description: 'Cave collapses — Veyra is already inside, also trapped',
        actions: [
          { type: 'spawn_actor', actor: 'BP_Veyra', location: 'IronholdMines_VeyraPos' },
          { type: 'set_corruption_visuals', tier: 1 },
          { type: 'camera_shake', intensity: 0.8, duration: 3.0 },
          { type: 'play_vfx', vfx: { asset: '/Game/VFX/NS_CaveCollapse', duration: 4.0 } },
          { type: 'camera_cut', preset: CAMERA_PRESETS.wideEstablish, blendTime: 0.5 },
          { type: 'play_audio', cue: AUDIO_CUES.rivalTense },
          { type: 'spawn_actor', actor: 'BP_ChildNPC_Miner', location: 'IronholdMines_ChildHideSpot' },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.APPROACH,
        duration: 3.0,
        actions: [
          { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_CoughDust', duration: 1.5 },
          { type: 'camera_cut', preset: CAMERA_PRESETS.overShoulder, blendTime: 1.0 },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.DIALOGUE,
        duration: null,
        dialogueNodes: [
          {
            speaker: 'Veyra',
            emotion: 'annoyed',
            text: 'You. Of course it\'s you. The Crown has a sick sense of humor.',
            anim: 'Anim_Veyra_StandBrush',
          },
          {
            speaker: 'Veyra',
            emotion: 'concerned',
            text: '(notices child) Wait — there\'s a child here. We need to get them out first.',
            anim: 'Anim_Veyra_LookAtChild',
            camera: CAMERA_PRESETS.veyraCloseup,
          },
          {
            speaker: 'Veyra',
            emotion: 'pragmatic',
            text: 'There\'s a corruption beast blocking the only exit tunnel. I can\'t solo it. Can you?',
            anim: 'Anim_Veyra_GestureAtTunnel',
          },
        ],
        playerChoices: [
          {
            id: 'cooperate',
            label: '"Together, then. But just this once."',
            emotion: 'reluctant',
            consequence: {
              branch: 'coop_fight',
              relationshipShift: +20,
              flagSet: ENCOUNTER_FLAGS.IRONHOLD_COOPERATED,
              veyraReaction: {
                text: 'Just this once. (almost smiles) Don\'t read into it.',
                emotion: 'amused',
              },
            },
          },
          {
            id: 'betray',
            label: '"You handle the beast. I\'ll take the child and find another way."',
            emotion: 'cold',
            consequence: {
              branch: 'betrayal',
              relationshipShift: -25,
              flagSet: ENCOUNTER_FLAGS.IRONHOLD_BETRAYED,
              veyraReaction: {
                text: 'I should have expected this. Fine — I don\'t need you.',
                emotion: 'bitter',
              },
            },
          },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.COMBAT,
        duration: null,
        description: 'Cooperative fight against corruption beast (coop branch) or solo Veyra (betrayal branch)',
        branches: {
          coop_fight: {
            combatType: 'coop_vs_environment',
            enemies: [{ type: 'BP_CorruptionBeast_Ironhold', level: 'player_level + 2', isBoss: true }],
            allyConfig: {
              veyraRole: 'ally',
              abilities: ['shard_counter', 'ashen_dash', 'mirror_stance'],
              behaviorStyle: 'supportive', // Covers player's blind spots
              callouts: [
                { trigger: 'player_low_hp', text: 'Watch it! Fall back, I\'ll draw aggro!' },
                { trigger: 'boss_vulnerable', text: 'Now! Hit it with everything!' },
                { trigger: 'child_threatened', text: 'The child! I\'ll shield them — keep fighting!' },
              ],
            },
            victoryDialogue: {
              speaker: 'Veyra',
              emotion: 'grudging',
              text: 'Not bad. For a rival. (turns to child) Come on, little one. Let\'s get you home.',
            },
          },
          betrayal: {
            combatType: 'veyra_solo_offscreen',
            description: 'Player takes child through alternate exit. Hears sounds of Veyra fighting alone.',
            ambientActions: [
              { type: 'play_sfx', cue: AUDIO_CUES.rivalCombat, volume: 0.4, distant: true },
              { type: 'camera_shake', intensity: 0.2, duration: 1.0, interval: 5.0 },
            ],
            outcome: 'Veyra survives but is badly wounded — increases her resentment and corruption',
          },
        },
      },
      {
        phase: ENCOUNTER_PHASES.RESOLUTION,
        duration: 5.0,
        branches: {
          coop_fight: [
            { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_CarryChild', duration: 2.0 },
            { type: 'camera_cut', preset: CAMERA_PRESETS.veyraCloseup, blendTime: 1.0 },
            { type: 'play_anim', target: 'ChildNPC', anim: 'Anim_Child_ThankYou', duration: 1.5 },
            { type: 'show_subtitle', speaker: 'Veyra', text: '(whispers to herself) Just like Caelen...' },
            { type: 'play_vfx', vfx: VFX_PRESETS.corruptionAura, params: { intensity: 0.3 } },
          ],
          betrayal: [
            { type: 'play_anim', target: 'Kael', anim: 'Anim_Kael_EscapeWithChild', duration: 3.0 },
            { type: 'show_objective', text: 'You left Veyra to fight alone...' },
            { type: 'play_sfx', cue: AUDIO_CUES.corruptionPulse },
          ],
        },
      },
      {
        phase: ENCOUNTER_PHASES.TRANSITION,
        duration: 0,
        actions: [
          { type: 'apply_relationship_shift' },
          { type: 'increment_counter', flag: ENCOUNTER_FLAGS.TOTAL_ENCOUNTERS_COMPLETED },
          { type: 'save_encounter_state', encounterId: 'ironhold_truce' },
          // If cooperated, Veyra's corruption doesn't increase. If betrayed, it does.
          { type: 'conditional', condition: 'branch == betrayal',
            then: { type: 'modify_rival_corruption', delta: +0.1 } },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.CLEANUP,
        duration: 2.0,
        actions: [
          { type: 'camera_return', blendTime: 2.0 },
          { type: 'fade_audio', cue: AUDIO_CUES.rivalTense, fadeOut: 3.0 },
          { type: 'enable_player_combat' },
          { type: 'environmental_event', event: 'mine_cleared', blockExits: false },
          { type: 'destroy_actor', target: 'BP_Veyra' },
          { type: 'destroy_actor', target: 'BP_ChildNPC_Miner' },
        ],
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // ACT 2 — "The Mirror"
  // ════════════════════════════════════════════════════════════════════════════

  // ── VerdantReach: Corruption Choice ───────────────────────────────────────
  verdant_corruption_choice: {
    id: 'verdant_corruption_choice',
    region: 'VerdantReach',
    act: 'act_2',
    encounterType: 'witness',
    title: 'The Price of Salvation',
    description: 'Veyra saves the Verdant Guardian by absorbing a corruption surge. Player witnesses the cost.',

    prerequisites: {
      playerLevel: { min: 15 },
      questProgress: 'reached_verdant_guardian_grove',
      requiredFlags: [ENCOUNTER_FLAGS.FIRST_GLIMPSE_SEEN],
      blockedByFlags: [ENCOUNTER_FLAGS.CORRUPTION_CHOICE_WITNESSED],
    },

    spawnConfig: {
      veyraSpawnPoint: 'BP_SpawnPoint_Veyra_VerdantGrove',
      initialFacing: 'toward_guardian',
      corruptionOverride: null,
    },

    phases: [
      {
        phase: ENCOUNTER_PHASES.TRIGGER,
        duration: 0,
        actions: [
          { type: 'trigger_volume', location: 'VerdantGrove_TriggerVol', radius: 600 },
          { type: 'set_flag', flag: ENCOUNTER_FLAGS.CORRUPTION_CHOICE_WITNESSED, value: true },
          { type: 'disable_player_combat' },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.CINEMATIC,
        duration: 8.0,
        description: 'Veyra is already at the Guardian when player arrives. Corruption surge imminent.',
        actions: [
          { type: 'spawn_actor', actor: 'BP_Veyra', location: 'VerdantGrove_GuardianSide' },
          { type: 'set_corruption_visuals', tier: 2 },
          { type: 'spawn_actor', actor: 'BP_VerdantGuardian', location: 'VerdantGrove_Center' },
          { type: 'camera_cut', preset: CAMERA_PRESETS.aerialCrane, blendTime: 2.0 },
          { type: 'play_audio', cue: AUDIO_CUES.rivalEmotional },
          { type: 'play_vfx', vfx: VFX_PRESETS.environmentCorrupt, params: { radius: 800, intensity: 'rising' } },
          // Corruption surge threatens the Guardian
          { type: 'play_vfx', vfx: { asset: '/Game/VFX/NS_CorruptionSurge', duration: 4.0, target: 'VerdantGuardian' } },
          // Veyra steps forward and absorbs it
          { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_AbsorbCorruption', duration: 5.0 },
          { type: 'play_vfx', vfx: VFX_PRESETS.corruptionAura, params: { intensity: 'surge' } },
          { type: 'camera_cut', preset: CAMERA_PRESETS.veyraCloseup, blendTime: 0.5 },
          { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_PainKneel', duration: 3.0 },
          { type: 'set_corruption_visuals', tier: 3 }, // Visibly corrupted further
        ],
      },
      {
        phase: ENCOUNTER_PHASES.DIALOGUE,
        duration: null,
        description: 'Weakened Veyra challenges Kael — no choice, pure witness',
        dialogueNodes: [
          {
            speaker: 'Veyra',
            emotion: 'defiant',
            text: '(breathing hard) The Guardian lives. That\'s all that matters.',
            anim: 'Anim_Veyra_KneelPanting',
            camera: CAMERA_PRESETS.veyraCloseup,
          },
          {
            speaker: 'Veyra',
            emotion: 'challenging',
            text: 'Could YOU sacrifice this much, Kael? Would you let the corruption in, to save something worth saving?',
            anim: 'Anim_Veyra_LookUpAtPlayer',
            camera: CAMERA_PRESETS.lowAngleDrama,
          },
          {
            speaker: 'Veyra',
            emotion: 'bitter',
            text: 'Don\'t answer. We both know you wouldn\'t.',
            anim: 'Anim_Veyra_StandSlow',
          },
        ],
        playerChoices: null, // Witness only — the impact is emotional, not interactive
      },
      {
        phase: ENCOUNTER_PHASES.RESOLUTION,
        duration: 4.0,
        actions: [
          { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_LimpAway', duration: 3.0 },
          { type: 'play_vfx', vfx: VFX_PRESETS.corruptionAura, params: { intensity: 0.6 } },
          { type: 'play_anim', target: 'VerdantGuardian', anim: 'Anim_Guardian_Grateful', duration: 2.0 },
          { type: 'camera_cut', preset: CAMERA_PRESETS.wideEstablish, blendTime: 2.0 },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.TRANSITION,
        duration: 0,
        actions: [
          { type: 'increment_counter', flag: ENCOUNTER_FLAGS.TOTAL_ENCOUNTERS_COMPLETED },
          { type: 'save_encounter_state', encounterId: 'verdant_corruption_choice', result: 'witnessed' },
          { type: 'unlock_codex_entry', entry: 'codex_veyra_corruption_sacrifice' },
          { type: 'modify_rival_corruption', delta: +0.15 },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.CLEANUP,
        duration: 2.0,
        actions: [
          { type: 'camera_return', blendTime: 2.0 },
          { type: 'fade_audio', cue: AUDIO_CUES.rivalEmotional, fadeOut: 4.0 },
          { type: 'enable_player_combat' },
          { type: 'destroy_actor', target: 'BP_Veyra' },
        ],
      },
    ],
  },

  // ── SunkenHalls: Brother Revelation ───────────────────────────────────────
  sunken_revelation: {
    id: 'sunken_revelation',
    region: 'SunkenHalls',
    act: 'act_2',
    encounterType: 'revelation',
    title: 'What the Archives Remember',
    description: 'Player discovers Caelen\'s fate. Veyra appears — vulnerable moment.',

    prerequisites: {
      playerLevel: { min: 20 },
      questProgress: 'found_caelen_archives',
      requiredFlags: [ENCOUNTER_FLAGS.FIRST_GLIMPSE_SEEN],
      blockedByFlags: [ENCOUNTER_FLAGS.CAELEN_COMFORTED, ENCOUNTER_FLAGS.CAELEN_CONFRONTED],
    },

    spawnConfig: {
      veyraSpawnPoint: 'BP_SpawnPoint_Veyra_SunkenArchives',
      initialFacing: 'toward_player',
      corruptionOverride: null,
    },

    phases: [
      {
        phase: ENCOUNTER_PHASES.TRIGGER,
        duration: 0,
        actions: [
          { type: 'trigger_volume', location: 'SunkenArchives_CaelenRoom_TriggerVol', radius: 300 },
          { type: 'set_flag', flag: ENCOUNTER_FLAGS.CAELEN_DISCOVERED, value: true },
          { type: 'disable_player_combat' },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.CINEMATIC,
        duration: 6.0,
        description: 'Player reads archive about Caelen. Veyra appears behind them.',
        actions: [
          { type: 'play_anim', target: 'Kael', anim: 'Anim_Kael_ReadArchive', duration: 3.0 },
          { type: 'camera_cut', preset: CAMERA_PRESETS.overShoulder, blendTime: 1.0 },
          { type: 'play_audio', cue: AUDIO_CUES.rivalEmotional },
          { type: 'spawn_actor', actor: 'BP_Veyra', location: 'SunkenArchives_DoorwayBehind' },
          { type: 'set_corruption_visuals', tier: 3 },
          { type: 'play_sfx', cue: AUDIO_CUES.footstepsStone },
          { type: 'camera_cut', preset: CAMERA_PRESETS.wideEstablish, blendTime: 0.8 },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.DIALOGUE,
        duration: null,
        description: 'Veyra\'s most vulnerable moment — nearly breaks down',
        dialogueNodes: [
          {
            speaker: 'Veyra',
            emotion: 'terrified',
            text: 'You found it. You know about Caelen.',
            anim: 'Anim_Veyra_StepBack',
            camera: CAMERA_PRESETS.veyraCloseup,
          },
          {
            speaker: 'Veyra',
            emotion: 'sad',
            text: 'He was eight. EIGHT. He didn\'t understand what was happening when the corruption took him. He just... called for me.',
            anim: 'Anim_Veyra_HugSelf',
            camera: CAMERA_PRESETS.veyraCloseup,
          },
          {
            speaker: 'Veyra',
            emotion: 'desperate',
            text: 'That\'s why I absorb it. If I understand corruption from the inside, maybe I can still reach him. Maybe there\'s still a boy underneath the Hollow.',
            anim: 'Anim_Veyra_ShowCorruptedHands',
            camera: CAMERA_PRESETS.veyraCloseup,
          },
          {
            speaker: 'Narrator',
            emotion: 'neutral',
            text: '(Veyra\'s eyes glisten. For a moment, she is not the Ashen Seeker — just a sister who lost everything.)',
            isNarration: true,
          },
        ],
        playerChoices: [
          {
            id: 'comfort',
            label: '"I\'m sorry about Caelen. We\'ll find a way to help him — together if you\'ll let me."',
            emotion: 'empathetic',
            consequence: {
              branch: 'comforted',
              relationshipShift: +25,
              flagSet: ENCOUNTER_FLAGS.CAELEN_COMFORTED,
              veyraReaction: {
                text: '(voice cracks) Don\'t... don\'t make promises you can\'t keep. (long pause) ...But thank you.',
                emotion: 'grateful',
                anim: 'Anim_Veyra_WipeEyes',
                vfx: VFX_PRESETS.tearDrop,
              },
            },
          },
          {
            id: 'confront',
            label: '"Absorbing corruption won\'t save him. You\'re destroying yourself for nothing."',
            emotion: 'harsh',
            consequence: {
              branch: 'confronted',
              relationshipShift: -10,
              flagSet: ENCOUNTER_FLAGS.CAELEN_CONFRONTED,
              veyraReaction: {
                text: 'You don\'t know ANYTHING about what I\'ve sacrificed! (corruption flares) Stay out of my way, Kael.',
                emotion: 'furious',
                anim: 'Anim_Veyra_CorruptionFlare',
                vfx: VFX_PRESETS.corruptionAura,
              },
            },
          },
          {
            id: 'silent',
            label: '(Say nothing. Just extend your hand.)',
            emotion: 'neutral',
            condition: { minRelationship: 'neutral' },
            consequence: {
              branch: 'silent_comfort',
              relationshipShift: +15,
              flagSet: ENCOUNTER_FLAGS.CAELEN_COMFORTED,
              veyraReaction: {
                text: '(stares at the hand for a long moment, then takes it briefly) ...You\'re strange, Kael.',
                emotion: 'surprised',
                anim: 'Anim_Veyra_TakeHand',
              },
            },
          },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.RESOLUTION,
        duration: 4.0,
        branches: {
          comforted: [
            { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_ComposeHerself', duration: 2.0 },
            { type: 'play_audio', cue: { asset: '/Game/Audio/Music/MUS_RivalHope', fadeIn: 2.0, fadeOut: 3.0 } },
            { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_WalkAway_Slow', duration: 3.0 },
          ],
          confronted: [
            { type: 'play_vfx', vfx: VFX_PRESETS.corruptionAura, params: { intensity: 0.8 } },
            { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_StormOff', duration: 2.0 },
            { type: 'play_vfx', vfx: VFX_PRESETS.ashenDashTrail },
            { type: 'camera_shake', intensity: 0.3, duration: 0.5 },
          ],
          silent_comfort: [
            { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_NodQuietly', duration: 2.0 },
            { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_WalkAway_Slow', duration: 3.0 },
          ],
        },
      },
      {
        phase: ENCOUNTER_PHASES.TRANSITION,
        duration: 0,
        actions: [
          { type: 'apply_relationship_shift' },
          { type: 'increment_counter', flag: ENCOUNTER_FLAGS.TOTAL_ENCOUNTERS_COMPLETED },
          { type: 'save_encounter_state', encounterId: 'sunken_revelation' },
          { type: 'unlock_codex_entry', entry: 'codex_caelen_ashcroft' },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.CLEANUP,
        duration: 2.0,
        actions: [
          { type: 'camera_return', blendTime: 2.0 },
          { type: 'fade_audio', cue: AUDIO_CUES.rivalEmotional, fadeOut: 4.0 },
          { type: 'enable_player_combat' },
          { type: 'destroy_actor', target: 'BP_Veyra' },
        ],
      },
    ],
  },

  // ── EmberPeaks: Alliance Offer ────────────────────────────────────────────
  ember_alliance: {
    id: 'ember_alliance',
    region: 'EmberPeaks',
    act: 'act_2',
    encounterType: 'alliance_choice',
    title: 'Fire and Ash',
    description: 'Veyra proposes a temporary alliance against the Ember Warden boss.',

    prerequisites: {
      playerLevel: { min: 25 },
      questProgress: 'reached_ember_warden_gate',
      requiredFlags: [ENCOUNTER_FLAGS.FIRST_GLIMPSE_SEEN],
      blockedByFlags: [ENCOUNTER_FLAGS.EMBER_ALLIANCE_ACCEPTED, ENCOUNTER_FLAGS.EMBER_ALLIANCE_REFUSED],
    },

    spawnConfig: {
      veyraSpawnPoint: 'BP_SpawnPoint_Veyra_EmberGate',
      initialFacing: 'toward_player',
      corruptionOverride: null,
    },

    phases: [
      {
        phase: ENCOUNTER_PHASES.TRIGGER,
        duration: 0,
        actions: [
          { type: 'trigger_volume', location: 'EmberWardenGate_TriggerVol', radius: 400 },
          { type: 'disable_player_combat' },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.CINEMATIC,
        duration: 4.0,
        description: 'Veyra is sitting by the gate, visibly tired and more corrupted',
        actions: [
          { type: 'spawn_actor', actor: 'BP_Veyra', location: 'EmberGate_WaitingSpot' },
          { type: 'set_corruption_visuals', tier: 3 },
          { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_Sit_Exhausted', duration: 0 },
          { type: 'camera_cut', preset: CAMERA_PRESETS.wideEstablish, blendTime: 1.5 },
          { type: 'play_audio', cue: AUDIO_CUES.rivalEmotional },
          { type: 'play_vfx', vfx: VFX_PRESETS.corruptionAura, params: { intensity: 0.5 } },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.APPROACH,
        duration: 2.0,
        actions: [
          { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_StandFromSit', duration: 1.5 },
          { type: 'camera_cut', preset: CAMERA_PRESETS.overShoulder, blendTime: 1.0 },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.DIALOGUE,
        duration: null,
        dialogueNodes: [
          {
            speaker: 'Veyra',
            emotion: 'tired',
            text: 'I\'ve been waiting for you. Don\'t look so surprised — I knew you\'d come.',
            anim: 'Anim_Veyra_Idle_Weary',
          },
          {
            speaker: 'Veyra',
            emotion: 'pragmatic',
            text: 'The Ember Warden is beyond either of us alone. I\'ve tried. Twice. It nearly killed me.',
            anim: 'Anim_Veyra_ShowWound',
            camera: CAMERA_PRESETS.veyraCloseup,
          },
          {
            speaker: 'Veyra',
            emotion: 'hopeful',
            text: 'I\'m proposing a truce. Just for this fight. Your shards and mine together — we can bring it down.',
            anim: 'Anim_Veyra_ExtendHand',
            camera: CAMERA_PRESETS.lowAngleDrama,
          },
        ],
        playerChoices: [
          {
            id: 'accept_alliance',
            label: '"Alright. Let\'s finish this together."',
            emotion: 'determined',
            consequence: {
              branch: 'allied_boss_fight',
              relationshipShift: +30,
              flagSet: ENCOUNTER_FLAGS.EMBER_ALLIANCE_ACCEPTED,
              veyraReaction: {
                text: '(genuine smile) First time I\'ve smiled in weeks. Let\'s go burn something.',
                emotion: 'relieved',
                anim: 'Anim_Veyra_Smile_Genuine',
              },
            },
          },
          {
            id: 'refuse_alliance',
            label: '"I don\'t trust you enough for this. I\'ll handle the Warden myself."',
            emotion: 'suspicious',
            consequence: {
              branch: 'solo_boss',
              relationshipShift: -15,
              flagSet: ENCOUNTER_FLAGS.EMBER_ALLIANCE_REFUSED,
              veyraReaction: {
                text: '(hand drops) Your funeral. I\'ll try again solo. One of us will manage.',
                emotion: 'hurt',
                anim: 'Anim_Veyra_HandDrop_Dejected',
              },
            },
          },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.COMBAT,
        duration: null,
        branches: {
          allied_boss_fight: {
            combatType: 'coop_vs_boss',
            enemies: [{ type: 'BP_EmberWarden', level: 'player_level + 3', isBoss: true }],
            allyConfig: {
              veyraRole: 'ally',
              abilities: ['shard_counter', 'ashen_dash', 'mirror_stance', 'crown_resonance'],
              behaviorStyle: 'aggressive', // She's all-in — this is personal
              callouts: [
                { trigger: 'boss_phase_2', text: 'It\'s changing forms! Adapt — use your off-shards!' },
                { trigger: 'player_low_hp', text: 'Get behind me! (uses Mirror Stance as shield)' },
                { trigger: 'boss_defeated', text: 'We... we actually did it. Together.' },
              ],
              postCombatBond: true, // Unlocks unique dialogue in Act 3
            },
            audio: AUDIO_CUES.rivalCombat,
            arena: { center: 'EmberWarden_Chamber', radius: 800, hazards: ['lava_geysers', 'ember_rain'] },
          },
          solo_boss: {
            combatType: 'player_solo_boss',
            enemies: [{ type: 'BP_EmberWarden', level: 'player_level + 3', isBoss: true }],
            description: 'Player fights alone. Veyra attempts solo from another entrance — gets badly hurt.',
            ambientActions: [
              { type: 'play_sfx', cue: AUDIO_CUES.rivalCombat, volume: 0.3, distant: true },
            ],
            postBoss: {
              description: 'After player wins, find wounded Veyra in adjacent chamber',
              veyraState: 'wounded',
              corruptionDelta: +0.1,
            },
          },
        },
      },
      {
        phase: ENCOUNTER_PHASES.RESOLUTION,
        duration: 5.0,
        branches: {
          allied_boss_fight: [
            { type: 'play_audio', cue: { asset: '/Game/Audio/Music/MUS_Victory_Shared', fadeIn: 1.0, fadeOut: 5.0 } },
            { type: 'camera_cut', preset: CAMERA_PRESETS.wideEstablish, blendTime: 2.0 },
            { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_Exhausted_Smile', duration: 2.0 },
            { type: 'show_subtitle', speaker: 'Veyra', text: 'For what it\'s worth... I\'m glad it was you here with me.' },
            { type: 'set_flag', flag: 'veyra_ember_bonded', value: true },
          ],
          solo_boss: [
            { type: 'spawn_actor', actor: 'BP_Veyra_Wounded', location: 'EmberWarden_AdjacentChamber' },
            { type: 'set_corruption_visuals', tier: 4 },
            { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_LeanWall_Wounded', duration: 0 },
            { type: 'camera_cut', preset: CAMERA_PRESETS.veyraCloseup, blendTime: 1.0 },
            { type: 'show_subtitle', speaker: 'Veyra', text: '(weakly) You won? ...Good. One of us had to.' },
          ],
        },
      },
      {
        phase: ENCOUNTER_PHASES.TRANSITION,
        duration: 0,
        actions: [
          { type: 'apply_relationship_shift' },
          { type: 'increment_counter', flag: ENCOUNTER_FLAGS.TOTAL_ENCOUNTERS_COMPLETED },
          { type: 'save_encounter_state', encounterId: 'ember_alliance' },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.CLEANUP,
        duration: 2.0,
        actions: [
          { type: 'camera_return', blendTime: 2.0 },
          { type: 'fade_audio', fadeOut: 3.0 },
          { type: 'enable_player_combat' },
          { type: 'destroy_actor', target: 'BP_Veyra' },
        ],
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // ACT 3 — "The Reckoning"
  // ════════════════════════════════════════════════════════════════════════════

  // ── Aethermere: Final Plea ────────────────────────────────────────────────
  aethermere_plea: {
    id: 'aethermere_plea',
    region: 'Aethermere',
    act: 'act_3',
    encounterType: 'final_plea',
    title: 'The Convergence',
    description: 'Veyra confronts Kael at the Aethermere convergence point. Asks to combine shards — her way.',

    prerequisites: {
      playerLevel: { min: 30 },
      questProgress: 'reached_aethermere_convergence',
      requiredFlags: [ENCOUNTER_FLAGS.FIRST_GLIMPSE_SEEN],
      blockedByFlags: [ENCOUNTER_FLAGS.AETHERMERE_AGREED_COMBINE, ENCOUNTER_FLAGS.AETHERMERE_REFUSED_COMBINE],
    },

    spawnConfig: {
      veyraSpawnPoint: 'BP_SpawnPoint_Veyra_Aethermere',
      initialFacing: 'toward_convergence_crystal',
      corruptionOverride: null,
    },

    phases: [
      {
        phase: ENCOUNTER_PHASES.TRIGGER,
        duration: 0,
        actions: [
          { type: 'trigger_volume', location: 'AethermereConvergence_TriggerVol', radius: 500 },
          { type: 'disable_player_combat' },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.CINEMATIC,
        duration: 6.0,
        description: 'Massive convergence crystal pulsing. Veyra stands before it, corruption consuming her.',
        actions: [
          { type: 'spawn_actor', actor: 'BP_Veyra', location: 'Aethermere_CrystalFacing' },
          { type: 'set_corruption_visuals', tier: 4 },
          { type: 'camera_cut', preset: CAMERA_PRESETS.aerialCrane, blendTime: 2.0 },
          { type: 'play_audio', cue: AUDIO_CUES.rivalClimax },
          { type: 'play_vfx', vfx: VFX_PRESETS.corruptionAura, params: { intensity: 0.8 } },
          { type: 'play_vfx', vfx: { asset: '/Game/VFX/NS_ConvergenceCrystal', duration: 0, loop: true } },
          { type: 'play_sfx', cue: AUDIO_CUES.shardResonance },
          { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_TouchCrystal', duration: 3.0 },
          { type: 'camera_cut', preset: CAMERA_PRESETS.lowAngleDrama, blendTime: 1.0 },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.DIALOGUE,
        duration: null,
        dialogueNodes: [
          {
            speaker: 'Veyra',
            emotion: 'terrified',
            text: 'I can feel it rewriting me. The Crown... it doesn\'t want to be reassembled. It wants to consume.',
            anim: 'Anim_Veyra_HoldArm_Pain',
            camera: CAMERA_PRESETS.veyraCloseup,
          },
          {
            speaker: 'Veyra',
            emotion: 'desperate',
            text: 'Kael, listen to me. If we combine our shards HERE — at the convergence — we can control the reassembly. MY way. Controlled corruption channeled through willing vessels.',
            anim: 'Anim_Veyra_Plead',
            camera: CAMERA_PRESETS.overShoulder,
          },
          {
            speaker: 'Veyra',
            emotion: 'determined',
            text: 'One of us has to bear the weight. I\'d rather it be me. I\'ve already paid the price.',
            anim: 'Anim_Veyra_ShowCorruption',
            camera: CAMERA_PRESETS.veyraCloseup,
          },
        ],
        playerChoices: [
          {
            id: 'agree_combine',
            label: '"Maybe you\'re right. Let\'s try it your way."',
            emotion: 'trusting',
            consequence: {
              branch: 'agreed',
              relationshipShift: +10,
              flagSet: ENCOUNTER_FLAGS.AETHERMERE_AGREED_COMBINE,
              veyraReaction: {
                text: '(stunned) You... trust me? After everything? (hands tremble) I won\'t waste this. I swear it.',
                emotion: 'overwhelmed',
                anim: 'Anim_Veyra_Stunned_Grateful',
              },
            },
          },
          {
            id: 'refuse_combine',
            label: '"Your way leads to more corruption. I won\'t let you control the Crown."',
            emotion: 'resolute',
            consequence: {
              branch: 'refused',
              relationshipShift: -5,
              flagSet: ENCOUNTER_FLAGS.AETHERMERE_REFUSED_COMBINE,
              veyraReaction: {
                text: 'Then we do this the hard way. At TheWilds. Winner takes the Crown.',
                emotion: 'resigned',
                anim: 'Anim_Veyra_TurnAway_Resolute',
              },
            },
          },
          {
            id: 'counter_propose',
            label: '"Not your way. Not my way. We find a THIRD way — one that doesn\'t require a vessel."',
            emotion: 'hopeful',
            condition: { minWillpower: 0.6, minRelationship: 'reluctant_ally' },
            consequence: {
              branch: 'third_way',
              relationshipShift: +15,
              flagSet: ENCOUNTER_FLAGS.AETHERMERE_AGREED_COMBINE,
              veyraReaction: {
                text: 'A third way... (considers) The old texts spoke of dissolution. Returning shards to the land. (looks up) It would mean neither of us gets the Crown.',
                emotion: 'thoughtful',
                anim: 'Anim_Veyra_Consider',
              },
            },
          },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.RESOLUTION,
        duration: 5.0,
        branches: {
          agreed: [
            { type: 'play_vfx', vfx: VFX_PRESETS.dualShardMerge },
            { type: 'play_sfx', cue: AUDIO_CUES.shardResonance },
            { type: 'camera_cut', preset: CAMERA_PRESETS.wideEstablish, blendTime: 2.0 },
            { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_ChannelCrystal', duration: 4.0 },
            { type: 'set_flag', flag: 'veyra_shard_pact', value: true },
          ],
          refused: [
            { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_AshenDash', duration: 1.0 },
            { type: 'play_vfx', vfx: VFX_PRESETS.ashenDashTrail },
            { type: 'play_vfx', vfx: VFX_PRESETS.corruptionAura, params: { intensity: 1.0 } },
            { type: 'show_objective', text: 'The final confrontation awaits at TheWilds.' },
          ],
          third_way: [
            { type: 'play_vfx', vfx: VFX_PRESETS.dualShardMerge },
            { type: 'play_audio', cue: { asset: '/Game/Audio/Music/MUS_RivalHope', fadeIn: 2.0, fadeOut: 5.0 } },
            { type: 'camera_cut', preset: CAMERA_PRESETS.wideEstablish, blendTime: 2.0 },
            { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_Kneel_Together', duration: 3.0 },
            { type: 'set_flag', flag: 'veyra_third_way', value: true },
          ],
        },
      },
      {
        phase: ENCOUNTER_PHASES.TRANSITION,
        duration: 0,
        actions: [
          { type: 'apply_relationship_shift' },
          { type: 'increment_counter', flag: ENCOUNTER_FLAGS.TOTAL_ENCOUNTERS_COMPLETED },
          { type: 'save_encounter_state', encounterId: 'aethermere_plea' },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.CLEANUP,
        duration: 2.0,
        actions: [
          { type: 'camera_return', blendTime: 2.0 },
          { type: 'fade_audio', fadeOut: 5.0 },
          { type: 'enable_player_combat' },
          { type: 'destroy_actor', target: 'BP_Veyra' },
        ],
      },
    ],
  },

  // ── TheWilds: Crown Confrontation ─────────────────────────────────────────
  wilds_confrontation: {
    id: 'wilds_confrontation',
    region: 'TheWilds',
    act: 'act_3',
    encounterType: 'climax',
    title: 'The Crown\'s Reckoning',
    description: 'The final encounter. Outcome determined by accumulated choices, willpower, and relationship.',

    prerequisites: {
      playerLevel: { min: 35 },
      questProgress: 'reached_crown_sanctum',
      requiredFlags: [ENCOUNTER_FLAGS.FIRST_GLIMPSE_SEEN],
      blockedByFlags: [ENCOUNTER_FLAGS.CROWN_CONFRONTATION_REACHED],
    },

    spawnConfig: {
      veyraSpawnPoint: 'BP_SpawnPoint_Veyra_CrownSanctum',
      initialFacing: 'toward_crown',
      corruptionOverride: null, // Computed from full game state
    },

    phases: [
      {
        phase: ENCOUNTER_PHASES.TRIGGER,
        duration: 0,
        actions: [
          { type: 'trigger_volume', location: 'CrownSanctum_TriggerVol', radius: 600 },
          { type: 'set_flag', flag: ENCOUNTER_FLAGS.CROWN_CONFRONTATION_REACHED, value: true },
          { type: 'disable_player_combat' },
          { type: 'lock_exits', chamber: 'CrownSanctum' },
          { type: 'save_checkpoint', name: 'final_confrontation' },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.CINEMATIC,
        duration: 10.0,
        description: 'Grand reveal — Crown reassembly altar. Veyra already there. Final corruption state.',
        actions: [
          { type: 'spawn_actor', actor: 'BP_Veyra', location: 'CrownSanctum_AltarFacing' },
          { type: 'set_corruption_visuals', tier: 'computed' }, // Dynamic based on game state
          { type: 'camera_cut', preset: CAMERA_PRESETS.aerialCrane, blendTime: 3.0 },
          { type: 'play_audio', cue: AUDIO_CUES.rivalClimax },
          { type: 'play_vfx', vfx: { asset: '/Game/VFX/NS_CrownAltar', duration: 0, loop: true } },
          { type: 'play_vfx', vfx: VFX_PRESETS.corruptionAura, params: { intensity: 'computed' } },
          { type: 'play_sfx', cue: AUDIO_CUES.windHowl },
          { type: 'environmental_event', event: 'crown_altar_activate' },
          { type: 'camera_cut', preset: CAMERA_PRESETS.lowAngleDrama, blendTime: 2.0 },
          { type: 'play_anim', target: 'Veyra', anim: 'Anim_Veyra_FinalStand', duration: 3.0 },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.DIALOGUE,
        duration: null,
        description: 'Final dialogue adapts based on relationship state and accumulated flags',
        dialogueNodes: [
          {
            speaker: 'Veyra',
            emotion: 'determined',
            text: 'We\'re here. Both of us. The Crown waited for this.',
            anim: 'Anim_Veyra_FacePlayer',
            camera: CAMERA_PRESETS.wideEstablish,
          },
        ],
        // Dynamic dialogue injected based on relationship
        conditionalDialogue: [
          {
            condition: { relationship: 'rival_respect' },
            nodes: [
              { speaker: 'Veyra', emotion: 'reverent',
                text: 'You\'re stronger than I expected, Kael. Maybe the Crown chose right after all.' },
              { speaker: 'Veyra', emotion: 'sad',
                text: 'But I can\'t stop now. Not with Caelen still out there. You understand, don\'t you?' },
            ],
          },
          {
            condition: { relationship: 'reluctant_ally' },
            nodes: [
              { speaker: 'Veyra', emotion: 'conflicted',
                text: 'Part of me wishes we could have been allies from the start.' },
              { speaker: 'Veyra', emotion: 'determined',
                text: 'But the Crown doesn\'t allow allies. Only seekers. Only one.' },
            ],
          },
          {
            condition: { relationship: 'hostile' },
            nodes: [
              { speaker: 'Veyra', emotion: 'hostile',
                text: 'Every time you crossed me, I got stronger. Every betrayal hardened me.' },
              { speaker: 'Veyra', emotion: 'menacing',
                text: 'Now look at me. THIS is what your cruelty created.' },
            ],
          },
          {
            condition: { relationship: 'neutral' },
            nodes: [
              { speaker: 'Veyra', emotion: 'neutral',
                text: 'We never really understood each other, did we? Two strangers fighting over the same prize.' },
            ],
          },
        ],
        // Final choice is determined by outcome resolver (FINAL_OUTCOMES)
        playerChoices: null, // Resolved by determineFinalOutcome()
      },
      {
        phase: ENCOUNTER_PHASES.COMBAT,
        duration: null,
        description: 'Combat only if outcome calls for it (reluctant_duel, corruption_consumed, mutual_destruction)',
        condition: { outcomeRequiresCombat: true },
        combatConfig: {
          veyraLevel: 'player_level + 2',
          abilities: ['shard_counter', 'ashen_dash', 'mirror_stance', 'crown_resonance'],
          behaviorStyle: 'computed', // From relationship
          retreatThreshold: 0, // No retreat — this is final
          dynamicLoadout: true, // Uses ms_3 blind spot system
          bossPhases: [
            { hpThreshold: 0.75, event: 'corruption_surge', desc: 'Corruption tier increases mid-fight' },
            { hpThreshold: 0.50, event: 'crown_resonance_unlock', desc: 'Crown Resonance permanently available' },
            { hpThreshold: 0.25, event: 'final_form', desc: 'Full corruption transformation or redemption break' },
          ],
          audio: AUDIO_CUES.rivalClimax,
          arena: { center: 'CrownAltar', radius: 1000, hazards: ['crown_energy_waves', 'corruption_eruptions', 'collapsing_pillars'] },
        },
      },
      {
        phase: ENCOUNTER_PHASES.RESOLUTION,
        duration: 10.0,
        description: 'Resolution determined by determineFinalOutcome() — references FINAL_OUTCOMES',
        actions: [
          { type: 'evaluate_final_outcome' }, // Calls determineFinalOutcome()
          // Outcome-specific sequences are handled by the outcome resolver
        ],
      },
      {
        phase: ENCOUNTER_PHASES.TRANSITION,
        duration: 0,
        actions: [
          { type: 'set_flag', flag: 'game_finale_reached', value: true },
          { type: 'increment_counter', flag: ENCOUNTER_FLAGS.TOTAL_ENCOUNTERS_COMPLETED },
          { type: 'save_encounter_state', encounterId: 'wilds_confrontation' },
          { type: 'save_final_outcome' },
          { type: 'unlock_codex_entry', entry: 'codex_crown_reckoning' },
        ],
      },
      {
        phase: ENCOUNTER_PHASES.CLEANUP,
        duration: 5.0,
        actions: [
          { type: 'camera_return', blendTime: 3.0 },
          { type: 'fade_audio', fadeOut: 5.0 },
          { type: 'trigger_ending_sequence' }, // Hands off to ending system
        ],
      },
    ],
  },
};

// ── Encounter Runtime Helpers ───────────────────────────────────────────────

/**
 * Determine which encounter should trigger for a given region and game state.
 * Checks prerequisites, required flags, and blocked flags.
 *
 * @param {string} region - Current region name
 * @param {object} gameState - { playerLevel, questProgress, flags: Set<string>, willpower, relationshipScore }
 * @returns {object|null} Encounter script or null if no encounter available
 */
export function getAvailableEncounter(region, gameState = {}) {
  const candidates = Object.values(ENCOUNTER_SCRIPTS).filter(enc => enc.region === region);

  for (const enc of candidates) {
    const pre = enc.prerequisites;

    // Level check
    if (pre.playerLevel?.min && (gameState.playerLevel || 1) < pre.playerLevel.min) continue;

    // Quest progress check
    if (pre.questProgress && !gameState.questProgress?.includes(pre.questProgress)) continue;

    // Required flags
    if (pre.requiredFlags?.length) {
      const flags = gameState.flags || new Set();
      if (!pre.requiredFlags.every(f => flags.has(f))) continue;
    }

    // Blocked flags (encounter already completed)
    if (pre.blockedByFlags?.length) {
      const flags = gameState.flags || new Set();
      if (pre.blockedByFlags.some(f => flags.has(f))) continue;
    }

    return enc;
  }

  return null;
}

/**
 * Determine the final outcome for the TheWilds confrontation based on game state.
 * Maps accumulated choices to one of the 6 FINAL_OUTCOMES.
 *
 * @param {object} state - { relationshipScore, veyraCorruption, flags: Set<string> }
 * @returns {object} Selected final outcome from FINAL_OUTCOMES
 */
export function determineFinalOutcome(state = {}) {
  const relScore = state.relationshipScore || 0;
  const corruption = state.veyraCorruption || 0.5;
  const flags = state.flags || new Set();

  const relState = getRelationshipFromScore(relScore);

  // Priority order: special conditions first, then by specificity
  // 1. Brother intervention (special flag + relationship)
  if (flags.has('caelen_discovered') && relScore >= RELATIONSHIP_STATES.RELUCTANT_ALLY.threshold) {
    return FINAL_OUTCOMES.find(o => o.id === 'brother_intervention');
  }

  // 2. Redemption (high relationship, low corruption)
  if (relScore >= RELATIONSHIP_STATES.RIVAL_RESPECT.threshold && corruption <= 0.6) {
    return FINAL_OUTCOMES.find(o => o.id === 'redemption_together');
  }

  // 3. Sacrifice (ally relationship, moderate corruption)
  if (relScore >= RELATIONSHIP_STATES.RELUCTANT_ALLY.threshold && corruption <= 0.8) {
    return FINAL_OUTCOMES.find(o => o.id === 'sacrifice_save');
  }

  // 4. Mutual destruction (hostile + very high corruption)
  if (relScore < RELATIONSHIP_STATES.HOSTILE.threshold && corruption >= 0.9) {
    return FINAL_OUTCOMES.find(o => o.id === 'mutual_destruction');
  }

  // 5. Consumed (low relationship + high corruption)
  if (relScore < RELATIONSHIP_STATES.NEUTRAL.threshold && corruption >= 0.8) {
    return FINAL_OUTCOMES.find(o => o.id === 'corruption_consumed');
  }

  // 6. Default: Reluctant duel (middle ground)
  return FINAL_OUTCOMES.find(o => o.id === 'reluctant_duel');
}

/**
 * Get a full encounter timeline — linearized phase sequence with durations.
 * Useful for Level Sequence / cinematic planning.
 *
 * @param {string} encounterId
 * @returns {object} { id, region, totalDuration, phases: [{ phase, startTime, duration, actionCount }] }
 */
export function getEncounterTimeline(encounterId) {
  const enc = ENCOUNTER_SCRIPTS[encounterId];
  if (!enc) return { error: `Unknown encounter: ${encounterId}` };

  let clock = 0;
  const timeline = enc.phases.map(p => {
    const dur = p.duration || 0;
    const entry = {
      phase: p.phase,
      startTime: clock,
      duration: dur,
      description: p.description || '',
      actionCount: (p.actions || []).length,
      hasDialogue: !!p.dialogueNodes,
      hasPlayerChoice: !!(p.playerChoices && p.playerChoices.length > 0),
      hasCombat: p.phase === ENCOUNTER_PHASES.COMBAT,
      hasBranches: !!p.branches,
    };
    clock += dur;
    return entry;
  });

  return {
    id: enc.id,
    region: enc.region,
    act: enc.act,
    title: enc.title,
    encounterType: enc.encounterType,
    totalScriptedDuration: clock,
    phaseCount: timeline.length,
    phases: timeline,
  };
}

/**
 * Get all encounters in chronological order across all acts.
 * @returns {object[]} Array of encounter summaries
 */
export function getAllEncounterSummaries() {
  const actOrder = { act_1: 0, act_2: 1, act_3: 2 };
  return Object.values(ENCOUNTER_SCRIPTS)
    .sort((a, b) => (actOrder[a.act] || 0) - (actOrder[b.act] || 0))
    .map(enc => ({
      id: enc.id,
      region: enc.region,
      act: enc.act,
      title: enc.title,
      type: enc.encounterType,
      hasCombat: enc.phases.some(p => p.phase === ENCOUNTER_PHASES.COMBAT),
      hasPlayerChoice: enc.phases.some(p => p.playerChoices?.length > 0),
      choiceCount: enc.phases.reduce((n, p) => n + (p.playerChoices?.length || 0), 0),
      prerequisiteFlags: enc.prerequisites.requiredFlags || [],
    }));
}

/**
 * Export all encounter scripts to JSON for UE5 Level Sequence import.
 * Creates one file per encounter + a master index.
 *
 * @returns {{ success: boolean, masterPath: string, encounterPaths: string[] }}
 */
export function exportEncounterScripts() {
  const game = getActiveGame();
  const outDir = join(game.assetsPath, 'Encounters');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const encounterPaths = [];

  for (const [key, enc] of Object.entries(ENCOUNTER_SCRIPTS)) {
    const encData = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      milestone: 'ms_4',
      encounter: enc,
      timeline: getEncounterTimeline(key),
    };
    const encPath = join(outDir, `encounter-${key}.json`);
    writeFileSync(encPath, JSON.stringify(encData, null, 2), 'utf-8');
    encounterPaths.push(encPath);
  }

  // Master index
  const masterIndex = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    milestone: 'ms_4',
    description: 'Rival encounter scripts — Veyra Ashcroft across 8 regions (7 encounters)',
    totalEncounters: Object.keys(ENCOUNTER_SCRIPTS).length,
    encounters: getAllEncounterSummaries(),
    encounterFlags: ENCOUNTER_FLAGS,
    cameraPresets: Object.keys(CAMERA_PRESETS),
    audioCues: Object.keys(AUDIO_CUES),
    vfxPresets: Object.keys(VFX_PRESETS),
    phaseTypes: Object.values(ENCOUNTER_PHASES),
    finalOutcomes: FINAL_OUTCOMES.map(o => ({ id: o.id, name: o.name })),
  };

  const masterPath = join(outDir, 'encounter-master-index.json');
  writeFileSync(masterPath, JSON.stringify(masterIndex, null, 2), 'utf-8');
  log.info(`Exported ${encounterPaths.length} encounter scripts + master index to ${outDir}`);

  return { success: true, masterPath, encounterPaths, encounterCount: encounterPaths.length };
}

/**
 * Lightweight summary for agent cycle / brief builders.
 * @returns {{ encounterCount, completedFlags, nextEncounterRegion }}
 */
export function getEncounterProgress(gameFlags = new Set()) {
  const allEnc = getAllEncounterSummaries();
  const completedCount = Object.values(ENCOUNTER_FLAGS)
    .filter(f => typeof f === 'string' && f !== ENCOUNTER_FLAGS.TOTAL_ENCOUNTERS_COMPLETED)
    .filter(f => gameFlags.has(f)).length;

  // Find next available encounter
  const regionOrder = ['CrossroadsHub', 'AshenWilds', 'Ironhold', 'VerdantReach', 'SunkenHalls', 'EmberPeaks', 'Aethermere', 'TheWilds'];
  let nextRegion = null;
  for (const region of regionOrder) {
    const enc = Object.values(ENCOUNTER_SCRIPTS).find(e => e.region === region);
    if (!enc) continue;
    const blocked = enc.prerequisites.blockedByFlags || [];
    if (!blocked.some(f => gameFlags.has(f))) {
      nextRegion = region;
      break;
    }
  }

  return {
    totalEncounters: allEnc.length,
    completedCount,
    nextEncounterRegion: nextRegion,
    encounters: allEnc.map(e => ({ id: e.id, region: e.region, title: e.title, type: e.type })),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// ms_5: 3-Way Boss Fight Mechanics — Rival as Temp Ally / Enemy
// ══════════════════════════════════════════════════════════════════════════════
//
// Combat system for fights involving three parties: Player (Kael), Rival (Veyra),
// and a Boss Enemy. Veyra's role can shift dynamically mid-fight based on:
//   - Relationship state (ally threshold)
//   - Corruption level (too corrupted → turns on player)
//   - Boss HP thresholds (phase triggers)
//   - Player actions during the fight (betrayal / rescue triggers)
//
// Three fight archetypes:
//   A. Coop vs Boss — Veyra starts as ally (Ironhold, EmberPeaks)
//   B. Boss + Rival — Veyra starts as enemy alongside boss (hostile path)
//   C. Dynamic Shift — Veyra starts neutral, shifts based on fight events (TheWilds climax)
//
// Integration:
//   - RIVAL_COMBAT → base stats, abilities, scaling
//   - buildVeyraCombatSubtree() → behavior tree combat nodes
//   - buildDynamicLoadout() → shard selection for fight
//   - ENCOUNTER_SCRIPTS → encounter combat configs
//   - SHARD_MATCHUP_MATRIX → elemental advantage system

// ── Three-Party Faction System ──────────────────────────────────────────────

/**
 * Combat factions in a 3-way fight. Each participant belongs to one faction.
 * Faction relationships determine who attacks whom.
 */
export const COMBAT_FACTIONS = {
  PLAYER:  'faction_player',
  RIVAL:   'faction_rival',
  BOSS:    'faction_boss',
};

/**
 * Faction relationship matrix.
 * Values: 'hostile' (will attack), 'allied' (won't attack, may assist), 'neutral' (ignores unless provoked)
 *
 * Dynamic: Veyra's faction relationships change based on allegiance state.
 */
export function buildFactionMatrix(veyraAllegiance = 'ally') {
  const matrix = {
    [COMBAT_FACTIONS.PLAYER]: {},
    [COMBAT_FACTIONS.RIVAL]:  {},
    [COMBAT_FACTIONS.BOSS]:   {},
  };

  // Boss is always hostile to both
  matrix[COMBAT_FACTIONS.BOSS][COMBAT_FACTIONS.PLAYER] = 'hostile';
  matrix[COMBAT_FACTIONS.BOSS][COMBAT_FACTIONS.RIVAL]  = 'hostile';
  matrix[COMBAT_FACTIONS.PLAYER][COMBAT_FACTIONS.BOSS] = 'hostile';

  switch (veyraAllegiance) {
    case 'ally':
      matrix[COMBAT_FACTIONS.PLAYER][COMBAT_FACTIONS.RIVAL] = 'allied';
      matrix[COMBAT_FACTIONS.RIVAL][COMBAT_FACTIONS.PLAYER] = 'allied';
      matrix[COMBAT_FACTIONS.RIVAL][COMBAT_FACTIONS.BOSS]   = 'hostile';
      break;
    case 'enemy':
      matrix[COMBAT_FACTIONS.PLAYER][COMBAT_FACTIONS.RIVAL] = 'hostile';
      matrix[COMBAT_FACTIONS.RIVAL][COMBAT_FACTIONS.PLAYER] = 'hostile';
      matrix[COMBAT_FACTIONS.RIVAL][COMBAT_FACTIONS.BOSS]   = 'allied';
      break;
    case 'neutral':
      matrix[COMBAT_FACTIONS.PLAYER][COMBAT_FACTIONS.RIVAL] = 'neutral';
      matrix[COMBAT_FACTIONS.RIVAL][COMBAT_FACTIONS.PLAYER] = 'neutral';
      matrix[COMBAT_FACTIONS.RIVAL][COMBAT_FACTIONS.BOSS]   = 'neutral';
      break;
    case 'independent':
      // Veyra fights EVERYONE — the "consumed by corruption" path
      matrix[COMBAT_FACTIONS.PLAYER][COMBAT_FACTIONS.RIVAL] = 'hostile';
      matrix[COMBAT_FACTIONS.RIVAL][COMBAT_FACTIONS.PLAYER] = 'hostile';
      matrix[COMBAT_FACTIONS.RIVAL][COMBAT_FACTIONS.BOSS]   = 'hostile';
      break;
  }

  return matrix;
}

// ── Threat / Aggro System ───────────────────────────────────────────────────

/**
 * Three-party threat table. Each combatant maintains threat scores against
 * all others. The boss uses this to choose targets; Veyra uses it to decide
 * who to help or attack.
 */
export function createThreatTable() {
  return {
    // Boss's threat against player and Veyra
    boss: { player: 100, veyra: 50 },
    // Veyra's threat (who she wants to attack/help)
    veyra: { player: 0, boss: 100 },
    // Player's threat is implicit (always controlled by player)

    /**
     * Record a damage event and update threat.
     * @param {string} attacker - 'player'|'veyra'|'boss'
     * @param {string} target - 'player'|'veyra'|'boss'
     * @param {number} damage - Raw damage dealt
     * @param {number} threatMultiplier - Abilities may have threat modifiers
     */
    recordDamage(attacker, target, damage, threatMultiplier = 1.0) {
      const threat = Math.round(damage * threatMultiplier);
      // Boss tracks threat from player and Veyra
      if (target === 'boss' && (attacker === 'player' || attacker === 'veyra')) {
        this.boss[attacker] = (this.boss[attacker] || 0) + threat;
      }
      // Veyra tracks provocation from player (betrayal hits)
      if (target === 'veyra' && attacker === 'player') {
        this.veyra.player = (this.veyra.player || 0) + threat;
      }
      // Veyra reduces boss threat when player heals/buffs her
      if (attacker === 'player' && target === 'veyra' && damage < 0) {
        this.veyra.player = Math.max(0, (this.veyra.player || 0) - Math.abs(threat));
      }
    },

    /**
     * Get boss's primary target based on threat.
     * @param {number} tankSwapThreshold - % threat difference needed to swap (default 20%)
     * @returns {'player'|'veyra'}
     */
    getBossTarget(tankSwapThreshold = 0.2) {
      const total = this.boss.player + this.boss.veyra;
      if (total === 0) return 'player';
      const playerPct = this.boss.player / total;
      const veyraPct = this.boss.veyra / total;
      // Only swap if threshold exceeded (prevents constant target ping-pong)
      if (veyraPct > playerPct + tankSwapThreshold) return 'veyra';
      return 'player';
    },

    /**
     * Decay threat over time (called per tick). Prevents stale threat from
     * dominating decisions.
     * @param {number} decayRate - Fraction to decay per call (default 1%)
     */
    decayThreat(decayRate = 0.01) {
      this.boss.player = Math.max(0, this.boss.player * (1 - decayRate));
      this.boss.veyra = Math.max(0, this.boss.veyra * (1 - decayRate));
      this.veyra.player = Math.max(0, this.veyra.player * (1 - decayRate));
      this.veyra.boss = Math.max(0, this.veyra.boss * (1 - decayRate));
    },
  };
}

// ── Allegiance Shift System ─────────────────────────────────────────────────

/**
 * Conditions that trigger Veyra's allegiance to shift during a 3-way fight.
 * Each trigger has a source event, required state, and resulting allegiance.
 */
export const ALLEGIANCE_TRIGGERS = [
  // ── Ally → Enemy shifts ──
  {
    id: 'corruption_overwhelm',
    description: 'Veyra\'s corruption exceeds safe threshold during the fight',
    from: 'ally',
    to: 'independent',
    condition: { corruptionLevel: { min: 0.85 } },
    dialogue: {
      speaker: 'Veyra', emotion: 'terrified',
      text: 'I can\'t... control it! Stay back! STAY BACK!',
    },
    vfx: 'corruptionAura',
    vfxParams: { intensity: 1.0 },
    cameraCue: 'veyraCloseup',
    audioCue: 'corruptionPulse',
    cooldownSec: 0, // One-time event
  },
  {
    id: 'player_betrayal',
    description: 'Player deliberately attacks Veyra during alliance',
    from: 'ally',
    to: 'enemy',
    condition: { playerAttacksVeyra: true, consecutiveHits: 3 },
    dialogue: {
      speaker: 'Veyra', emotion: 'furious',
      text: 'You treacherous— Fine! If that\'s how you want this, I\'ll bury BOTH of you!',
    },
    vfx: 'corruptionAura',
    vfxParams: { intensity: 0.8 },
    audioCue: 'rivalCombat',
    cooldownSec: 0,
  },
  {
    id: 'boss_bribe',
    description: 'Boss offers Veyra a shard if she turns on the player (high corruption only)',
    from: 'ally',
    to: 'enemy',
    condition: { corruptionLevel: { min: 0.6 }, bossHpPct: { max: 0.5 }, relationship: { max: 'neutral' } },
    dialogue: {
      speaker: 'Veyra', emotion: 'conflicted',
      text: '(to self) If I take the shard now... Caelen...',
    },
    vfx: 'shardGlow',
    cameraCue: 'veyraCloseup',
    cooldownSec: 0,
  },

  // ── Enemy → Ally shifts ──
  {
    id: 'player_saves_veyra',
    description: 'Player heals or shields Veyra when she\'s near death',
    from: 'enemy',
    to: 'ally',
    condition: { veyraHpPct: { max: 0.15 }, playerUsedHealOnVeyra: true },
    dialogue: {
      speaker: 'Veyra', emotion: 'stunned',
      text: 'You... saved me? After everything? (lowers weapon) ...I don\'t understand you, Kael.',
    },
    vfx: 'shardGlow',
    vfxParams: { color: 'warm_gold' },
    audioCue: 'shardResonance',
    cooldownSec: 0,
  },
  {
    id: 'boss_threatens_both',
    description: 'Boss enters enrage phase threatening everyone — survival demands alliance',
    from: 'enemy',
    to: 'ally',
    condition: { bossPhase: 'enrage', bossHpPct: { max: 0.25 } },
    dialogue: {
      speaker: 'Veyra', emotion: 'pragmatic',
      text: 'We can settle our score AFTER we survive this. Truce?',
    },
    vfx: 'environmentCorrupt',
    audioCue: 'rivalTense',
    cooldownSec: 0,
  },
  {
    id: 'caelen_intervention',
    description: 'Caelen appears during the fight — Veyra breaks free of boss control',
    from: 'enemy',
    to: 'ally',
    condition: { specialFlag: 'caelen_discovered', bossHpPct: { max: 0.4 } },
    dialogue: {
      speaker: 'Veyra', emotion: 'emotional',
      text: 'Caelen...? CAELEN! (corruption recedes) No. I won\'t let the Crown take me too.',
    },
    vfx: 'dualShardMerge',
    audioCue: 'rivalEmotional',
    cooldownSec: 0,
  },

  // ── Neutral → shifts ──
  {
    id: 'player_attacks_first',
    description: 'Player strikes first when Veyra is neutral',
    from: 'neutral',
    to: 'enemy',
    condition: { playerAttacksVeyra: true, consecutiveHits: 1 },
    dialogue: {
      speaker: 'Veyra', emotion: 'cold',
      text: 'You chose. Remember that.',
    },
    audioCue: 'rivalCombat',
    cooldownSec: 0,
  },
  {
    id: 'player_shows_mercy',
    description: 'Player sheathes weapon / emotes peace near neutral Veyra',
    from: 'neutral',
    to: 'ally',
    condition: { playerSheathes: true, proximityRadius: 400 },
    dialogue: {
      speaker: 'Veyra', emotion: 'surprised',
      text: '...Together, then. But don\'t think this makes us friends.',
    },
    audioCue: 'shardResonance',
    cooldownSec: 0,
  },
];

// ── 3-Way Boss Fight Configuration ──────────────────────────────────────────

/**
 * Boss fight archetypes. Each defines how the three-party combat plays out.
 */
export const BOSS_FIGHT_ARCHETYPES = {
  /**
   * Archetype A: Cooperative — Veyra starts allied against the boss.
   * Used in: Ironhold (corruption beast), EmberPeaks (Ember Warden)
   */
  COOP_VS_BOSS: {
    id: 'coop_vs_boss',
    initialAllegiance: 'ally',
    canShift: true,
    shiftTriggers: ['corruption_overwhelm', 'player_betrayal'],
    veyraTargeting: 'boss_only',
    veyraAbilityAccess: 'full', // All 4 abilities
    healingAllowed: true, // Veyra can heal player between phases
    reviveAllowed: true,  // Veyra revives player once per fight
    retreatBehavior: 'none', // Veyra won't retreat — fights to the end
    combatBanter: true,
  },

  /**
   * Archetype B: Boss + Rival — Veyra is hostile alongside the boss.
   * Used in: TheWilds (corruption_consumed outcome)
   */
  BOSS_AND_RIVAL: {
    id: 'boss_and_rival',
    initialAllegiance: 'enemy',
    canShift: true,
    shiftTriggers: ['player_saves_veyra', 'boss_threatens_both', 'caelen_intervention'],
    veyraTargeting: 'player_primary',
    veyraAbilityAccess: 'full',
    healingAllowed: false,
    reviveAllowed: false,
    retreatBehavior: 'none',
    combatBanter: true,
  },

  /**
   * Archetype C: Dynamic — Veyra starts neutral, shifts based on player actions.
   * Used in: TheWilds (reluctant_duel outcome), AshenWilds (confrontation escalation)
   */
  DYNAMIC_SHIFT: {
    id: 'dynamic_shift',
    initialAllegiance: 'neutral',
    canShift: true,
    shiftTriggers: ['player_attacks_first', 'player_shows_mercy', 'corruption_overwhelm', 'boss_bribe'],
    veyraTargeting: 'none_until_shift',
    veyraAbilityAccess: 'limited', // Only shard_counter and ashen_dash until committed
    healingAllowed: false,
    reviveAllowed: false,
    retreatBehavior: 'if_losing',
    combatBanter: false, // Silent until allegiance decided
  },

  /**
   * Archetype D: Consumed — Veyra IS the boss (or merges with boss).
   * Used in: TheWilds (corruption_consumed outcome — Hollow Veyra)
   */
  RIVAL_IS_BOSS: {
    id: 'rival_is_boss',
    initialAllegiance: 'independent',
    canShift: true,
    shiftTriggers: ['caelen_intervention', 'player_saves_veyra'],
    veyraTargeting: 'all_hostile',
    veyraAbilityAccess: 'enhanced', // Crown Resonance + corruption abilities
    healingAllowed: false,
    reviveAllowed: false,
    retreatBehavior: 'none',
    combatBanter: true,
  },
};

// ── Boss Fight Definitions ──────────────────────────────────────────────────

/**
 * Complete boss fight configurations for all 3-way encounters.
 * Each references an encounter script and specifies the three-party setup.
 */
export const THREE_WAY_BOSS_FIGHTS = {

  // ── Ironhold: Corruption Beast ────────────────────────────────────────────
  ironhold_corruption_beast: {
    id: 'ironhold_corruption_beast',
    encounterRef: 'ironhold_truce',
    region: 'Ironhold',
    act: 'act_1',
    archetype: BOSS_FIGHT_ARCHETYPES.COOP_VS_BOSS,

    boss: {
      id: 'BP_CorruptionBeast_Ironhold',
      name: 'The Burrowing Maw',
      description: 'Massive corruption-infused creature that collapsed the mine. Armored carapace, vulnerability on underbelly.',
      level: 'player_level + 2',
      baseHealth: 5000,
      phases: [
        {
          id: 'phase_1',
          name: 'Burrowed Fury',
          hpRange: [1.0, 0.6],
          behavior: 'Burrows underground, erupts beneath targets. Armored — front attacks deal 50% damage.',
          abilities: [
            { id: 'burrow_strike', damage: 120, cooldown: 6, aoe: true, radius: 300 },
            { id: 'corruption_spit', damage: 60, cooldown: 3, ranged: true, debuff: 'corruption_dot' },
            { id: 'tail_sweep', damage: 80, cooldown: 8, aoe: true, radius: 200, knockback: true },
          ],
          targetPriority: 'closest', // No preference — attacks whoever is near
          enrageTimer: null,
        },
        {
          id: 'phase_2',
          name: 'Exposed Core',
          hpRange: [0.6, 0.3],
          behavior: 'Carapace cracks open — vulnerable core exposed for 10s windows. Faster, more aggressive.',
          abilities: [
            { id: 'burrow_strike', damage: 150, cooldown: 4, aoe: true, radius: 350 },
            { id: 'corruption_nova', damage: 200, cooldown: 15, aoe: true, radius: 600, castTime: 2.0 },
            { id: 'summon_adds', count: 3, addType: 'BP_CorruptionSpawnling', cooldown: 20 },
          ],
          vulnerabilityWindow: { duration: 10, interval: 25 },
          targetPriority: 'highest_threat',
        },
        {
          id: 'phase_3',
          name: 'Death Throes',
          hpRange: [0.3, 0],
          behavior: 'Enraged — constant corruption AoE, desperate attacks. Must burst down.',
          abilities: [
            { id: 'corruption_aura_constant', damage: 30, tickRate: 1.0, radius: 800 },
            { id: 'burrow_multi', damage: 100, cooldown: 3, eruptions: 3 },
            { id: 'death_grip', damage: 0, cooldown: 12, effect: 'grabs_target_2s' },
          ],
          enrageTimer: 60, // 60s to finish or boss fully heals
          targetPriority: 'lowest_hp',
        },
      ],
      loot: [
        { item: 'IronholdShard_Fragment', chance: 1.0 },
        { item: 'CorruptionBeast_Carapace', chance: 0.5, description: 'Shield crafting material' },
        { item: 'MineKey_DeepShaft', chance: 1.0, description: 'Opens deeper mine areas' },
      ],
      arena: {
        name: 'Ironhold Deep Mine Chamber',
        shape: 'circular',
        radius: 700,
        hazards: [
          { type: 'corruption_pools', locations: 'random_3', damage: 40, tickRate: 0.5 },
          { type: 'falling_stalactites', interval: 15, damage: 100, warningVfx: true },
          { type: 'gas_vents', count: 4, stunDuration: 1.5 },
        ],
        cover: [
          { type: 'mine_pillars', count: 6, destructible: true, hp: 500 },
          { type: 'overturned_cart', count: 2, destructible: false },
        ],
      },
    },

    veyraConfig: {
      initialState: 'ally',
      levelScale: 'player_level + 1',
      abilities: ['shard_counter', 'ashen_dash', 'mirror_stance'],
      behaviorStyle: 'supportive',
      prioritizeProtecting: 'BP_ChildNPC_Miner', // Protects the trapped child
      callouts: [
        { trigger: 'boss_burrow', text: 'It\'s going underground! Watch your feet!', delay: 0.5 },
        { trigger: 'boss_phase_2', text: 'The shell is cracking — hit the exposed core!', delay: 1.0 },
        { trigger: 'boss_summon_adds', text: 'Spawns incoming! I\'ll handle them — focus the beast!', delay: 0.5 },
        { trigger: 'player_low_hp', text: 'You\'re hurt! Get behind the pillars, I\'ll draw aggro!', delay: 0.2 },
        { trigger: 'boss_phase_3', text: 'It\'s dying but it\'s desperate! Don\'t let up!', delay: 0.5 },
        { trigger: 'child_threatened', text: 'The child! Cover me while I move them!', delay: 0 },
        { trigger: 'victory', text: 'It\'s done. (looks at child) Hey, little one... you\'re safe now.', delay: 2.0 },
      ],
      statOverrides: {
        healthMultiplier: 0.8, // Slightly weaker than player (she's already worn from exploration)
        damageMultiplier: 0.9,
      },
    },

    rewards: {
      allyVeyra: { xp: 800, relationshipBonus: +5, codex: 'codex_coop_ironhold' },
      betrayedVeyra: { xp: 500, relationshipPenalty: -15, codex: 'codex_betrayal_ironhold' },
    },
  },

  // ── EmberPeaks: Ember Warden ──────────────────────────────────────────────
  ember_warden: {
    id: 'ember_warden',
    encounterRef: 'ember_alliance',
    region: 'EmberPeaks',
    act: 'act_2',
    archetype: BOSS_FIGHT_ARCHETYPES.COOP_VS_BOSS,

    boss: {
      id: 'BP_EmberWarden',
      name: 'The Ember Warden',
      description: 'Ancient fire elemental guarding the Ember Shard. Phases shift between fire and corruption forms.',
      level: 'player_level + 3',
      baseHealth: 12000,
      phases: [
        {
          id: 'phase_fire',
          name: 'Blazing Guardian',
          hpRange: [1.0, 0.65],
          behavior: 'Pure fire attacks. Predictable but devastating. Arena fills with lava.',
          abilities: [
            { id: 'flame_sweep', damage: 150, cooldown: 5, aoe: true, cone: 120, range: 400 },
            { id: 'lava_eruption', damage: 200, cooldown: 10, aoe: true, radius: 250, zoneLingers: 8 },
            { id: 'ember_barrage', damage: 80, cooldown: 3, projectileCount: 5, spread: 60 },
            { id: 'heat_aura', damage: 20, tickRate: 1.0, radius: 300, passive: true },
          ],
          mechanics: [
            { type: 'arena_shrink', description: 'Lava rises from edges, reducing safe arena by 20%', interval: 20 },
          ],
          targetPriority: 'highest_threat',
        },
        {
          id: 'phase_transition',
          name: 'Corruption Infusion',
          hpRange: [0.65, 0.60],
          behavior: 'Stagger — absorbs corruption from the earth. Both fighters can DPS freely for 8s.',
          duration: 8,
          invulnerable: false,
          damageMultiplier: 1.5, // Takes extra damage during transition
          cinematicCue: {
            description: 'Warden kneels, corruption tendrils crawl up its body',
            camera: 'wideEstablish',
            vfx: 'environmentCorrupt',
            dialogue: {
              speaker: 'Veyra', emotion: 'alarmed',
              text: 'It\'s absorbing corruption! This is going to get a LOT worse!',
            },
          },
        },
        {
          id: 'phase_corrupt',
          name: 'Corrupted Inferno',
          hpRange: [0.60, 0.25],
          behavior: 'Fire + corruption hybrid. New abilities. Targets shift to who dealt most recent damage.',
          abilities: [
            { id: 'corrupt_flame', damage: 180, cooldown: 4, aoe: true, cone: 150, range: 500, debuff: 'corruption_dot' },
            { id: 'shadow_fire_nova', damage: 250, cooldown: 12, aoe: true, radius: 700, castTime: 3.0 },
            { id: 'corruption_chains', damage: 0, cooldown: 15, effect: 'roots_target_3s', targetCount: 2 },
            { id: 'summon_fire_hollows', count: 2, addType: 'BP_FireHollow', cooldown: 25 },
          ],
          mechanics: [
            { type: 'fire_rain', description: 'Random fire patches drop from ceiling', interval: 5, damage: 100 },
            { type: 'corruption_link', description: 'Chains player and Veyra together — must stay within 500u or take damage', duration: 10, cooldown: 30 },
          ],
          targetPriority: 'most_recent_damage',
        },
        {
          id: 'phase_enrage',
          name: 'Final Conflagration',
          hpRange: [0.25, 0],
          behavior: 'Full enrage. Arena-wide damage. Must defeat before timer expires.',
          abilities: [
            { id: 'firestorm', damage: 100, tickRate: 0.5, radius: 'arena', passive: true },
            { id: 'corrupt_beam', damage: 300, cooldown: 6, tracking: true, chargeTime: 1.5 },
            { id: 'ground_pound', damage: 400, cooldown: 8, aoe: true, radius: 500, knockback: true },
          ],
          enrageTimer: 90,
          mechanics: [
            { type: 'safe_zones', description: 'Small safe patches rotate around arena', count: 2, rotateSpeed: 30 },
          ],
          targetPriority: 'lowest_hp',
        },
      ],
      loot: [
        { item: 'EmberShard', chance: 1.0 },
        { item: 'EmberWarden_Core', chance: 0.3, description: 'Fire weapon infusion material' },
        { item: 'Warden_Mantle', chance: 0.2, description: 'Legendary fire resistance armor' },
      ],
      arena: {
        name: 'Ember Warden\'s Crucible',
        shape: 'rectangular',
        width: 1200,
        height: 800,
        hazards: [
          { type: 'lava_geysers', count: 6, damage: 120, warningTime: 1.5, interval: 10 },
          { type: 'ember_rain', damage: 40, tickRate: 2.0, coverage: 0.3 },
          { type: 'collapsing_platforms', count: 3, fallDamage: 200, respawnTime: 20 },
        ],
        cover: [
          { type: 'obsidian_pillars', count: 4, destructible: true, hp: 800 },
          { type: 'ancient_shields', count: 2, destructible: false, blockProjectiles: true },
        ],
      },
    },

    veyraConfig: {
      initialState: 'ally',
      levelScale: 'player_level + 2',
      abilities: ['shard_counter', 'ashen_dash', 'mirror_stance', 'crown_resonance'],
      behaviorStyle: 'aggressive',
      callouts: [
        { trigger: 'boss_fire_sweep', text: 'Dodge left! Its sweep always goes clockwise!', delay: 0.3 },
        { trigger: 'boss_phase_transition', text: 'Now! Hit it while it\'s absorbing — maximum damage!', delay: 0.5 },
        { trigger: 'boss_corruption_chains', text: 'We\'re chained! Stay close to me!', delay: 0 },
        { trigger: 'player_low_hp', text: 'Get behind the shields! I\'ll keep its attention!', delay: 0.2 },
        { trigger: 'boss_enrage', text: 'Stay in the safe zones! We finish this TOGETHER!', delay: 0.5 },
        { trigger: 'veyra_crown_resonance', text: 'MY TURN! (corruption surges) Cover your eyes!', delay: 0 },
        { trigger: 'victory', text: 'We did it... (collapse) ...we actually did it. Together.', delay: 3.0 },
      ],
      statOverrides: {
        healthMultiplier: 1.0, // Full strength — she came prepared
        damageMultiplier: 1.0,
      },
      bondingEvent: {
        trigger: 'victory',
        flag: 'veyra_ember_bonded',
        description: 'Fighting together creates a deep bond — unlocks unique Act 3 dialogue options',
      },
    },

    rewards: {
      allyVeyra: { xp: 1500, relationshipBonus: +10, codex: 'codex_coop_ember_warden' },
    },
  },

  // ── TheWilds: Crown Confrontation (Dynamic) ───────────────────────────────
  wilds_crown_fight: {
    id: 'wilds_crown_fight',
    encounterRef: 'wilds_confrontation',
    region: 'TheWilds',
    act: 'act_3',
    archetype: null, // Determined at runtime by determineFinalOutcome()

    /**
     * Determine archetype dynamically based on final outcome.
     * @param {string} outcomeId - From determineFinalOutcome().id
     * @returns {object} Boss fight archetype
     */
    getArchetype(outcomeId) {
      switch (outcomeId) {
        case 'redemption_together':
          return BOSS_FIGHT_ARCHETYPES.COOP_VS_BOSS;
        case 'sacrifice_save':
          return BOSS_FIGHT_ARCHETYPES.COOP_VS_BOSS;
        case 'reluctant_duel':
          return BOSS_FIGHT_ARCHETYPES.DYNAMIC_SHIFT;
        case 'corruption_consumed':
          return BOSS_FIGHT_ARCHETYPES.RIVAL_IS_BOSS;
        case 'mutual_destruction':
          return BOSS_FIGHT_ARCHETYPES.BOSS_AND_RIVAL;
        case 'brother_intervention':
          return BOSS_FIGHT_ARCHETYPES.DYNAMIC_SHIFT;
        default:
          return BOSS_FIGHT_ARCHETYPES.DYNAMIC_SHIFT;
      }
    },

    boss: {
      id: 'BP_CrownAvatar',
      name: 'The Crown\'s Will',
      description: 'Manifestation of the Shattered Crown itself — a entity formed from all collected shards. ' +
                   'Adapts its element to counter both fighters. In "consumed" outcome, merges with Veyra.',
      level: 'player_level + 4',
      baseHealth: 20000,
      phases: [
        {
          id: 'phase_awakening',
          name: 'Crown Awakens',
          hpRange: [1.0, 0.75],
          behavior: 'Tests both fighters. Uses all 6 shard elements in rotation.',
          abilities: [
            { id: 'shard_rotation', damage: 'varies', cooldown: 4, description: 'Cycles through Fire→Water→Nature→Shield→Time→Shadow, each with unique attack pattern' },
            { id: 'crown_pulse', damage: 120, cooldown: 10, aoe: true, radius: 500 },
            { id: 'shard_barrier', damage: 0, cooldown: 20, effect: 'invulnerable_5s_unless_counter_element' },
          ],
          targetPriority: 'alternating', // Switches between player and Veyra each rotation
        },
        {
          id: 'phase_judgment',
          name: 'The Crown\'s Judgment',
          hpRange: [0.75, 0.50],
          behavior: 'Reads both fighters\' weaknesses and exploits them. Uses blind spot analysis.',
          abilities: [
            { id: 'exploit_weakness', damage: 250, cooldown: 5, description: 'Uses each target\'s least-used shard counter' },
            { id: 'mirror_split', damage: 0, cooldown: 30, effect: 'Creates shadow copies of both fighters for 15s' },
            { id: 'time_distortion', damage: 0, cooldown: 25, effect: 'Slows one target 50% for 8s while speeding self' },
          ],
          mechanics: [
            { type: 'weakness_telegraph', description: 'Crown glows with the element it will use — player can switch shard to counter' },
          ],
          targetPriority: 'weakest_shard',
        },
        {
          id: 'phase_fracture',
          name: 'Crown Fractures',
          hpRange: [0.50, 0.25],
          behavior: 'Crown destabilizes — arena breaks apart. Allegiance shift opportunity.',
          abilities: [
            { id: 'reality_tear', damage: 300, cooldown: 8, aoe: true, lineWidth: 100, lineLength: 800 },
            { id: 'shard_storm', damage: 60, tickRate: 0.5, duration: 10, radius: 'arena', safeZone: 200 },
            { id: 'crown_absorption', damage: 0, cooldown: 40, effect: 'Drains 20% current HP from both fighters' },
          ],
          mechanics: [
            { type: 'arena_fracture', description: 'Platform breaks into 3 floating islands — fighters may get separated', duration: 20 },
            { type: 'allegiance_moment', description: 'If Veyra neutral/enemy, cinematic trigger for shift opportunity' },
          ],
          targetPriority: 'highest_threat',
        },
        {
          id: 'phase_convergence',
          name: 'Final Convergence',
          hpRange: [0.25, 0],
          behavior: 'Crown attempts to consume whoever is nearest. Must be defeated before it completes.',
          abilities: [
            { id: 'convergence_beam', damage: 500, cooldown: 10, chargeTime: 3.0, tracking: true },
            { id: 'shatter_wave', damage: 200, cooldown: 5, aoe: true, radius: 'arena', knockback: true },
            { id: 'consume_attempt', damage: 0, cooldown: 45, effect: 'Grabs one fighter — other must free them in 5s or instakill' },
          ],
          enrageTimer: 120,
          mechanics: [
            { type: 'sacrifice_mechanic', description: 'If Veyra allied: she can sacrifice herself to stun Crown for 10s (sacrifice_save outcome)', oneTime: true },
            { type: 'dual_attack', description: 'If both alive and allied: combined shard attack for 3x damage', requirement: 'both_alive_and_allied' },
          ],
          targetPriority: 'nearest',
        },
      ],
      loot: [
        { item: 'ShatteredCrown_Complete', chance: 1.0 },
        { item: 'Crown_Essence', chance: 1.0, description: 'Determines ending based on who absorbs it' },
      ],
      arena: {
        name: 'The Crown\'s Sanctum',
        shape: 'hexagonal',
        radius: 1000,
        hazards: [
          { type: 'crown_energy_waves', interval: 8, damage: 80, height: 'jumpable' },
          { type: 'corruption_eruptions', count: 4, damage: 150, warningTime: 2.0 },
          { type: 'collapsing_pillars', count: 6, fallDamage: 300, respawnTime: 'never' },
          { type: 'void_zones', count: 2, instakill: true, warningVfx: true, expandRate: 'slow' },
        ],
        cover: [
          { type: 'crown_fragment_pillars', count: 6, destructible: true, hp: 1000, shardElement: 'random' },
        ],
      },
    },

    veyraConfig: {
      // Config varies by outcome — use getVeyraConfigForOutcome()
    },

    /**
     * Get Veyra's combat configuration based on the final outcome.
     */
    getVeyraConfigForOutcome(outcomeId) {
      const baseConfig = {
        levelScale: 'player_level + 3',
        abilities: ['shard_counter', 'ashen_dash', 'mirror_stance', 'crown_resonance'],
      };

      switch (outcomeId) {
        case 'redemption_together':
          return {
            ...baseConfig,
            initialState: 'ally',
            behaviorStyle: 'aggressive',
            statOverrides: { healthMultiplier: 1.2, damageMultiplier: 1.1 },
            callouts: [
              { trigger: 'fight_start', text: 'Side by side — like it should have been from the start.' },
              { trigger: 'boss_phase_judgment', text: 'It\'s reading us! Switch your shards — confuse it!' },
              { trigger: 'boss_consume_attempt', text: 'Kael! I\'m coming! Hold on!' },
              { trigger: 'victory', text: 'We did it. The Crown is ours... and now we return it to the world.' },
            ],
          };

        case 'sacrifice_save':
          return {
            ...baseConfig,
            initialState: 'ally',
            behaviorStyle: 'aggressive',
            statOverrides: { healthMultiplier: 0.6, damageMultiplier: 1.3 },
            sacrificeMechanic: {
              trigger: 'boss_phase_convergence',
              hpThreshold: 0.3,
              description: 'Veyra channels all corruption into a single blast, stunning Crown for 10s but killing herself',
              dialogue: {
                speaker: 'Veyra', emotion: 'resolute',
                text: 'Kael — it was always going to be this way. Tell Caelen... tell him I tried.',
              },
              vfx: 'crownResonanceVFX',
              postEffect: { bossStun: 10, veyraDeathCinematic: true },
            },
            callouts: [
              { trigger: 'fight_start', text: 'One last fight. Make it count.' },
              { trigger: 'boss_phase_fracture', text: 'I can feel it pulling at my corruption... using me.' },
              { trigger: 'veyra_low_hp', text: '(coughing) Almost... I just need to hold on a little longer...' },
            ],
          };

        case 'corruption_consumed':
          return {
            ...baseConfig,
            initialState: 'independent',
            behaviorStyle: 'aggressive',
            statOverrides: { healthMultiplier: 1.5, damageMultiplier: 1.4 },
            mergedWithBoss: true,
            description: 'Hollow Veyra — fully consumed. Fights as second boss, not ally.',
            hollowAbilities: [
              { id: 'hollow_scream', damage: 100, cooldown: 8, aoe: true, radius: 400, effect: 'fear_2s' },
              { id: 'corruption_claws', damage: 200, cooldown: 3, combo: 3 },
              { id: 'shadow_step', damage: 0, cooldown: 5, effect: 'teleport_behind_target' },
            ],
            callouts: [
              { trigger: 'fight_start', text: '(distorted) The Crown... sees... EVERYTHING.' },
              { trigger: 'veyra_hit_50pct', text: '(Veyra\'s voice breaks through) Kael... please... end it...' },
              { trigger: 'caelen_intervenes', text: '(screaming) CAELEN?! No! Stay away from me!' },
            ],
          };

        case 'reluctant_duel':
          return {
            ...baseConfig,
            initialState: 'neutral',
            behaviorStyle: 'honorable',
            statOverrides: { healthMultiplier: 1.0, damageMultiplier: 1.0 },
            duelMechanics: {
              description: 'Formal duel — Crown watches and empowers the winner',
              rules: [
                'No Crown interference until one fighter yields or falls',
                'Crown empowers winner with temporary damage boost for final phase',
                'Loser survives — Crown respects the duel',
              ],
              yieldThreshold: 0.2, // Veyra yields at 20% HP in duel
              yieldDialogue: {
                speaker: 'Veyra', emotion: 'respectful',
                text: 'Enough. You\'ve proven yourself, Kael. The Crown is yours to command.',
              },
            },
            callouts: [
              { trigger: 'fight_start', text: 'No tricks. No corruption. Just us and the Crown.' },
              { trigger: 'boss_phase_judgment', text: 'The Crown tests us both now. Stay sharp.' },
            ],
          };

        case 'mutual_destruction':
          return {
            ...baseConfig,
            initialState: 'enemy',
            behaviorStyle: 'aggressive',
            statOverrides: { healthMultiplier: 1.3, damageMultiplier: 1.2 },
            description: 'Veyra fights alongside Crown against player. Both must be defeated.',
            callouts: [
              { trigger: 'fight_start', text: 'You should have let me do this MY way!' },
              { trigger: 'boss_phase_fracture', text: 'The Crown is mine! You hear me? MINE!' },
              { trigger: 'veyra_low_hp', text: '(laughing) Then we both go down. Is that what you want?' },
            ],
          };

        case 'brother_intervention':
          return {
            ...baseConfig,
            initialState: 'enemy',
            behaviorStyle: 'aggressive',
            statOverrides: { healthMultiplier: 1.1, damageMultiplier: 1.0 },
            caelenIntervention: {
              trigger: 'boss_hp_40pct',
              description: 'Caelen\'s Hollow form appears. Veyra breaks free of Crown control.',
              dialogue: [
                { speaker: 'Caelen', emotion: 'pleading', text: '(hollow voice) V-Veyra... sister...' },
                { speaker: 'Veyra', emotion: 'shocked', text: 'Caelen?! He\'s... you\'re still in there!' },
                { speaker: 'Veyra', emotion: 'determined', text: 'Kael — help me save him! Please!' },
              ],
              allegianceShift: 'ally',
              vfx: 'dualShardMerge',
              bonusObjective: 'Save Caelen by defeating Crown without killing him',
            },
            callouts: [
              { trigger: 'fight_start', text: 'The Crown gave me what I needed! Don\'t interfere!' },
              { trigger: 'caelen_appears', text: '(all hostility drops) ...Brother?' },
              { trigger: 'post_shift', text: 'Together, Kael! We can save him!' },
            ],
          };

        default:
          return { ...baseConfig, initialState: 'neutral', behaviorStyle: 'balanced' };
      }
    },

    rewards: {
      redemption_together: { xp: 3000, item: 'Crown_Purified', codex: 'codex_redemption', ending: 'both_survive' },
      sacrifice_save: { xp: 3000, item: 'Crown_Stabilized', codex: 'codex_sacrifice', ending: 'veyra_dies' },
      reluctant_duel: { xp: 2500, item: 'Crown_Won', codex: 'codex_duel', ending: 'honorable_victor' },
      corruption_consumed: { xp: 3000, item: 'Crown_Purged', codex: 'codex_consumed', ending: 'veyra_freed_or_destroyed' },
      mutual_destruction: { xp: 2000, item: 'Crown_Shattered', codex: 'codex_mutual', ending: 'both_lost' },
      brother_intervention: { xp: 3500, item: 'Crown_Family', codex: 'codex_caelen', ending: 'three_saved' },
    },
  },
};

// ── 3-Way Combat Behavior Tree Extension ────────────────────────────────────

/**
 * Build Veyra's behavior tree subtree for 3-way boss fights.
 * Extends the base combat AI with:
 *  - Threat-based target selection
 *  - Allegiance-aware targeting
 *  - Boss mechanic awareness (dodge AoE, exploit vulnerability)
 *  - Callout system
 *  - Allegiance shift responses
 */
export function buildThreeWayCombatSubtree(allegiance = 'ally') {
  return {
    type: 'Selector',
    description: `Veyra 3-way combat — allegiance: ${allegiance}`,
    children: [
      // Priority 1: Allegiance shift check (runs every tick)
      {
        type: 'Sequence',
        description: 'Check for allegiance shift triggers',
        children: [
          { type: 'Task', name: 'BTTask_CheckAllegianceShifts', params: { triggerList: 'ALLEGIANCE_TRIGGERS' } },
          { type: 'Task', name: 'BTTask_ExecuteAllegianceShift', params: { playDialogue: true, playVfx: true } },
        ],
      },
      // Priority 2: Dodge boss mechanics (universal — allied or not)
      {
        type: 'Sequence',
        description: 'Dodge boss AoE and mechanics',
        decorator: { type: 'BlackboardBased', key: 'IncomingBossAoE', expected: true },
        children: [
          { type: 'Task', name: 'BTTask_EvadeBossAbility', params: { preferDash: true, abilityId: 'ashen_dash' } },
          { type: 'Task', name: 'BTTask_VeyraAbility', params: { abilityId: 'ashen_dash', retreatAfter: false } },
        ],
      },
      // Priority 3: Protect ally (if allied)
      ...(allegiance === 'ally' ? [{
        type: 'Sequence',
        description: 'Protect player when they\'re in danger',
        decorator: { type: 'BlackboardBased', key: 'PlayerInDanger', expected: true },
        children: [
          { type: 'Task', name: 'BTTask_InterceptBossAttack', params: { useAbility: 'mirror_stance' } },
          { type: 'Task', name: 'BTTask_PlayCallout', params: { trigger: 'player_low_hp' } },
        ],
      }] : []),
      // Priority 4: Exploit boss vulnerability windows
      {
        type: 'Sequence',
        description: 'Exploit boss vulnerability',
        decorator: { type: 'BlackboardBased', key: 'BossVulnerable', expected: true },
        children: [
          { type: 'Task', name: 'BTTask_VeyraAbility', params: { abilityId: 'shard_counter', targetBoss: true } },
          { type: 'Task', name: 'BTTask_ComboAttack', params: { comboLength: 4, target: 'Boss' } },
          { type: 'Task', name: 'BTTask_PlayCallout', params: { trigger: 'boss_vulnerable' } },
        ],
      },
      // Priority 5: Crown Resonance desperation (below 30% HP)
      {
        type: 'Sequence',
        description: 'Crown Resonance — desperation burst in boss fight',
        decorator: { type: 'Composite', conditions: [
          { type: 'BlackboardBased', key: 'CurrentHealthPct', operator: 'LessThan', value: 0.3 },
          { type: 'BlackboardBased', key: 'bCrownResonanceReady', expected: true },
        ]},
        children: [
          { type: 'Task', name: 'BTTask_PlayCallout', params: { trigger: 'veyra_crown_resonance' } },
          { type: 'Task', name: 'BTTask_VeyraAbility', params: { abilityId: 'crown_resonance' } },
          { type: 'Task', name: 'BTTask_AggressivePursuit', params: { duration: 5.0, target: 'Boss' } },
        ],
      },
      // Priority 6: Standard combat rotation against appropriate target
      {
        type: 'Sequence',
        description: 'Standard combat rotation',
        children: [
          { type: 'Task', name: 'BTTask_SelectTargetByAllegiance', params: { allegiance } },
          { type: 'Task', name: 'BTTask_MoveTo', params: { key: 'TargetActor', acceptRadius: 200 } },
          { type: 'Task', name: 'BTTask_FaceTarget', params: { key: 'TargetActor' } },
          { type: 'Task', name: 'BTTask_ComboAttack', params: { comboLength: 3, pauseBetween: 0.3 } },
          { type: 'Task', name: 'BTTask_VeyraAbility', params: { abilityId: 'ashen_dash', repositionAfter: true } },
          { type: 'Task', name: 'BTTask_Wait', params: { duration: 0.5 } },
        ],
      },
    ],
  };
}

// ── Runtime Helpers ─────────────────────────────────────────────────────────

/**
 * Initialize a complete 3-way boss fight runtime state.
 * Called when entering a boss encounter from the encounter scripting system.
 *
 * @param {string} fightId - Key from THREE_WAY_BOSS_FIGHTS
 * @param {object} gameState - { playerLevel, willpower, corruptionLevel, relationshipScore, flags }
 * @returns {object} Complete fight state for the combat system
 */
export function initBossFight(fightId, gameState = {}) {
  const fightDef = THREE_WAY_BOSS_FIGHTS[fightId];
  if (!fightDef) return { error: `Unknown boss fight: ${fightId}` };

  // Determine archetype
  let archetype;
  if (fightDef.archetype) {
    archetype = fightDef.archetype;
  } else if (fightDef.getArchetype) {
    const outcome = determineFinalOutcome(gameState);
    archetype = fightDef.getArchetype(outcome.id);
  } else {
    archetype = BOSS_FIGHT_ARCHETYPES.DYNAMIC_SHIFT;
  }

  // Determine Veyra config
  let veyraConfig;
  if (fightDef.getVeyraConfigForOutcome) {
    const outcome = determineFinalOutcome(gameState);
    veyraConfig = fightDef.getVeyraConfigForOutcome(outcome.id);
  } else {
    veyraConfig = fightDef.veyraConfig;
  }

  // Build dynamic loadout for Veyra
  const playerProfile = createPlayerShardProfile();
  if (gameState.playerShardUsage) {
    for (const [shard, count] of Object.entries(gameState.playerShardUsage)) {
      playerProfile.shardUsage[shard] = count;
      playerProfile.totalActions += count;
    }
  }
  const veyraLoadout = buildDynamicLoadout(playerProfile, {
    corruptionTier: gameState.corruptionTier || 3,
    region: fightDef.region,
  });

  // Build combat state
  const threatTable = createThreatTable();
  const factionMatrix = buildFactionMatrix(archetype.initialAllegiance);

  // Compute Veyra's stats
  const corruption = computeRivalCorruption(gameState.willpower || 0.5);
  const baseHP = RIVAL_COMBAT.baseStats.health +
    (corruption.tier * RIVAL_COMBAT.baseStats.healthPerCorruptionTier);
  const hpMult = veyraConfig.statOverrides?.healthMultiplier || 1.0;
  const dmgMult = veyraConfig.statOverrides?.damageMultiplier || 1.0;

  return {
    fightId,
    region: fightDef.region,
    act: fightDef.act,
    archetype: archetype.id,

    boss: {
      id: fightDef.boss.id,
      name: fightDef.boss.name,
      level: fightDef.boss.level,
      maxHealth: fightDef.boss.baseHealth,
      currentHealth: fightDef.boss.baseHealth,
      currentPhase: fightDef.boss.phases[0].id,
      phaseCount: fightDef.boss.phases.length,
    },

    veyra: {
      allegiance: archetype.initialAllegiance,
      maxHealth: Math.round(baseHP * hpMult),
      currentHealth: Math.round(baseHP * hpMult),
      damage: Math.round(RIVAL_COMBAT.baseStats.attackDamage * dmgMult),
      corruption,
      loadout: veyraLoadout,
      abilities: veyraConfig.abilities || [],
      behaviorStyle: veyraConfig.behaviorStyle || 'balanced',
      combatSubtree: buildThreeWayCombatSubtree(archetype.initialAllegiance),
    },

    threatTable,
    factionMatrix,
    allegiance: archetype.initialAllegiance,
    allegianceHistory: [{ time: 0, state: archetype.initialAllegiance, reason: 'initial' }],
    activeShiftTriggers: archetype.shiftTriggers || [],

    arena: fightDef.boss.arena,
    rewards: fightDef.rewards,
    callouts: veyraConfig.callouts || [],

    // Runtime state
    elapsedTime: 0,
    isActive: true,
    playerAlive: true,
    veyraAlive: true,
    bossAlive: true,
  };
}

/**
 * Process an allegiance shift during an active boss fight.
 * Updates faction matrix, behavior tree, threat table, and records the shift.
 *
 * @param {object} fightState - From initBossFight()
 * @param {string} triggerId - From ALLEGIANCE_TRIGGERS
 * @param {number} fightTime - Current fight elapsed time
 * @returns {object} Updated fight state + shift details
 */
export function processAllegianceShift(fightState, triggerId, fightTime = 0) {
  const trigger = ALLEGIANCE_TRIGGERS.find(t => t.id === triggerId);
  if (!trigger) return { ...fightState, shiftResult: { error: `Unknown trigger: ${triggerId}` } };

  // Validate current allegiance matches trigger's "from" state
  if (fightState.allegiance !== trigger.from) {
    return {
      ...fightState,
      shiftResult: {
        shifted: false,
        reason: `Current allegiance '${fightState.allegiance}' doesn't match trigger's from '${trigger.from}'`,
      },
    };
  }

  // Apply shift
  const newAllegiance = trigger.to;
  const newFactionMatrix = buildFactionMatrix(newAllegiance);
  const newCombatSubtree = buildThreeWayCombatSubtree(newAllegiance);

  // Record shift
  const shiftRecord = {
    time: fightTime,
    state: newAllegiance,
    reason: triggerId,
    trigger: trigger.description,
  };

  return {
    ...fightState,
    allegiance: newAllegiance,
    factionMatrix: newFactionMatrix,
    veyra: {
      ...fightState.veyra,
      allegiance: newAllegiance,
      combatSubtree: newCombatSubtree,
    },
    allegianceHistory: [...fightState.allegianceHistory, shiftRecord],
    shiftResult: {
      shifted: true,
      from: trigger.from,
      to: newAllegiance,
      trigger: triggerId,
      dialogue: trigger.dialogue,
      vfx: trigger.vfx,
      audioCue: trigger.audioCue,
      cameraCue: trigger.cameraCue,
    },
  };
}

/**
 * Get a lightweight summary of a boss fight definition.
 * @param {string} fightId
 * @returns {object}
 */
export function getBossFightSummary(fightId) {
  const fight = THREE_WAY_BOSS_FIGHTS[fightId];
  if (!fight) return { error: `Unknown fight: ${fightId}` };

  return {
    id: fight.id,
    region: fight.region,
    act: fight.act,
    bossName: fight.boss.name,
    bossHealth: fight.boss.baseHealth,
    bossPhases: fight.boss.phases.length,
    archetype: fight.archetype?.id || 'dynamic',
    arenaHazards: fight.boss.arena.hazards.length,
    hasDynamicArchetype: !!fight.getArchetype,
    encounterRef: fight.encounterRef,
  };
}

/**
 * Get all boss fight summaries.
 */
export function getAllBossFightSummaries() {
  return Object.keys(THREE_WAY_BOSS_FIGHTS).map(getBossFightSummary);
}

/**
 * Export all 3-way boss fight specs to JSON for UE5 blueprint consumption.
 */
export function exportBossFightSpecs() {
  const game = getActiveGame();
  const outDir = join(game.assetsPath, 'Combat');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const specs = {};
  for (const [key, fight] of Object.entries(THREE_WAY_BOSS_FIGHTS)) {
    specs[key] = {
      ...fight,
      // Remove functions from export (they're runtime-only)
      getArchetype: undefined,
      getVeyraConfigForOutcome: undefined,
    };
  }

  const exportData = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    milestone: 'ms_5',
    description: '3-way boss fight specs — Player × Veyra × Boss',
    fightCount: Object.keys(specs).length,
    archetypes: Object.values(BOSS_FIGHT_ARCHETYPES).map(a => ({ id: a.id, initial: a.initialAllegiance })),
    allegianceTriggers: ALLEGIANCE_TRIGGERS.length,
    fights: specs,
    factionSystem: {
      factions: Object.values(COMBAT_FACTIONS),
      matrixExample: buildFactionMatrix('ally'),
    },
  };

  const outPath = join(outDir, 'three-way-boss-fights.json');
  writeFileSync(outPath, JSON.stringify(exportData, null, 2), 'utf-8');
  log.info(`3-way boss fight specs exported to ${outPath}`);
  return { success: true, path: outPath, fightCount: Object.keys(specs).length };
}

/**
 * Export the complete AI controller spec (behavior tree + blackboard + config)
 * to JSON for documentation and data-driven BT import.
 */
export function exportRivalAISpec() {
  const game = getActiveGame();
  const outDir = join(game.assetsPath, 'AI');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const spec = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    milestone: 'ms_2',
    description: 'Rival AI Controller — Veyra Ashcroft behavior tree, blackboard, and AI controller configuration',
    framework: {
      description: 'Reusable NPC AI framework — buildNpcBlackboardKeys(), buildNpcBehaviorTree() — used by Veyra, extensible to companions/bosses',
      genericBlackboardKeys: buildNpcBlackboardKeys('Generic').length,
      genericBehaviorTreeStructure: 'Selector[Dialogue > Combat > Idle + CustomNodes]',
    },
    blackboard: {
      name: RIVAL_AI_CONFIG.blackboard.name,
      keys: VEYRA_BLACKBOARD_KEYS,
    },
    behaviorTree: buildVeyraBehaviorTree(),
    aiController: {
      name: RIVAL_AI_CONFIG.controller.name,
      folder: RIVAL_AI_CONFIG.controller.folder,
      variables: RIVAL_AI_CONFIG.controllerVars,
      functions: RIVAL_AI_CONFIG.controllerFunctions,
    },
    perception: RIVAL_AI_CONFIG.perception,
    combatStyles: Object.entries(RIVAL_COMBAT.behaviorByRelationship).map(([state, desc]) => ({
      relationship: state,
      style: getRelationshipCombatStyle(state),
      description: desc,
    })),
    encounterTypes: Object.entries(ENCOUNTER_SCHEDULE).map(([region, enc]) => ({
      region,
      ...enc,
    })),
  };

  const outPath = join(outDir, 'rival-veyra-ai-spec.json');
  writeFileSync(outPath, JSON.stringify(spec, null, 2), 'utf-8');
  log.info(`Rival AI spec exported to ${outPath}`);
  return { success: true, path: outPath };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ms_6 — 3 Final Act Resolution Paths: FIGHT, ABSORB, MERGE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * The 3 core resolution mechanics for the rival confrontation.
 * Each FINAL_OUTCOME maps to one of these paths, which defines
 * the complete gameplay sequence for how the finale plays out.
 */
export const RESOLUTION_PATH_TYPES = {
  FIGHT:  'fight',   // Direct combat resolution — duel or 3-way
  ABSORB: 'absorb',  // One party absorbs the other's Crown power/corruption
  MERGE:  'merge',   // Both Crown-Seekers combine their fragments cooperatively
};

/**
 * Maps each FINAL_OUTCOME to its resolution path type.
 */
export const OUTCOME_TO_PATH = {
  reluctant_duel:       RESOLUTION_PATH_TYPES.FIGHT,
  corruption_consumed:  RESOLUTION_PATH_TYPES.FIGHT,
  mutual_destruction:   RESOLUTION_PATH_TYPES.FIGHT,
  sacrifice_save:       RESOLUTION_PATH_TYPES.ABSORB,
  brother_intervention: RESOLUTION_PATH_TYPES.ABSORB,
  redemption_together:  RESOLUTION_PATH_TYPES.MERGE,
};

// ── FIGHT Resolution Path ───────────────────────────────────────────────────

/**
 * Fight path: direct combat determines the Crown's fate.
 * 3 sub-variants based on which FINAL_OUTCOME triggered.
 */
export const FIGHT_RESOLUTION = {
  id: RESOLUTION_PATH_TYPES.FIGHT,
  name: 'Trial by Combat',
  description: 'The Crown-Seekers cannot reach accord — steel and shard will decide.',

  /**
   * Pre-fight: arena setup, cinematic intro, stance selection
   */
  setup: {
    arena: {
      name: 'Crown Altar Arena',
      center: { x: 0, y: 0, z: 0 },
      radius: 1000,
      boundary: 'crown_energy_barrier', // Impassable — no escape
      lighting: 'dramatic_dusk',
      weather: 'corruption_storm',
    },
    cinematic: {
      id: 'cin_fight_setup',
      duration: 12.0,
      shots: [
        { camera: 'wide_aerial', duration: 3.0, desc: 'Crown Altar from above, energy swirling' },
        { camera: 'veyra_closeup', duration: 2.5, desc: 'Veyra draws weapon, corruption flickering on her arms' },
        { camera: 'kael_closeup', duration: 2.5, desc: 'Kael readies stance, shards glowing on belt' },
        { camera: 'split_screen', duration: 2.0, desc: 'Both combatants, eyes locked' },
        { camera: 'ground_level', duration: 2.0, desc: 'Weapons cross — combat begins' },
      ],
      dialogue: [
        { speaker: 'Veyra', emotion: 'resolute', text: 'No more words. The Crown will know its keeper.', delay: 1.0 },
        { speaker: 'Kael', emotion: 'determined', text: '(inner) One way or another, this ends now.', delay: 5.0 },
      ],
      audio: { music: 'mus_rival_climax', ambience: 'amb_crown_storm', stinger: 'sfx_weapons_clash' },
    },
  },

  /**
   * Fight phases — escalating intensity
   */
  phases: [
    {
      id: 'phase_honor',
      name: 'Honorable Exchange',
      hpRange: [1.0, 0.65],
      description: 'Clean combat — both fighters test each other. Veyra uses tactical abilities.',
      veyraStyle: 'balanced',
      abilities: ['shard_counter', 'ashen_dash'],
      crownEffects: false,
      hazards: [],
      callout: { speaker: 'Veyra', text: 'Show me what the shards taught you!', emotion: 'excited' },
    },
    {
      id: 'phase_desperation',
      name: 'Desperate Measures',
      hpRange: [0.65, 0.35],
      description: 'Gloves come off. Veyra unleashes mirror_stance. Arena hazards activate.',
      veyraStyle: 'aggressive',
      abilities: ['shard_counter', 'ashen_dash', 'mirror_stance'],
      crownEffects: true,
      hazards: [
        { type: 'crown_energy_waves', interval: 12, damage: 80, warningVfx: 'ground_glow_3s' },
        { type: 'corruption_eruptions', count: 4, damage: 60, radius: 200 },
      ],
      callout: { speaker: 'Veyra', text: 'Enough holding back!', emotion: 'fierce' },
    },
    {
      id: 'phase_final_stand',
      name: 'Final Stand',
      hpRange: [0.35, 0],
      description: 'Crown Resonance activates. Full corruption form. One decisive exchange.',
      veyraStyle: 'crown_resonance',
      abilities: ['shard_counter', 'ashen_dash', 'mirror_stance', 'crown_resonance'],
      crownEffects: true,
      hazards: [
        { type: 'crown_energy_waves', interval: 8, damage: 100, warningVfx: 'ground_glow_2s' },
        { type: 'collapsing_pillars', interval: 15, damage: 150, knockback: true },
        { type: 'corruption_eruptions', count: 6, damage: 80, radius: 250 },
      ],
      callout: { speaker: 'Veyra', text: 'The Crown... is... MINE!', emotion: 'enraged' },
      crownResonanceTrigger: true,
    },
  ],

  /**
   * Outcome variants based on which FINAL_OUTCOME triggered the fight path
   */
  outcomes: {
    reluctant_duel: {
      playerWins: {
        cinematic: {
          id: 'cin_duel_player_wins',
          duration: 15.0,
          shots: [
            { camera: 'kael_standing', duration: 3.0, desc: 'Kael stands over fallen Veyra' },
            { camera: 'veyra_ground', duration: 4.0, desc: 'Veyra on one knee, blade planted in ground' },
            { camera: 'two_shot', duration: 4.0, desc: 'Veyra yields, extends hand with her shard fragment' },
            { camera: 'crown_altar', duration: 4.0, desc: 'Kael approaches the altar with both fragments' },
          ],
          dialogue: [
            { speaker: 'Veyra', emotion: 'defeated_respectful', delay: 3.5,
              text: 'It\'s yours. You earned it. Just... promise me you\'ll look for Caelen.' },
            { speaker: 'Kael', emotion: 'compassionate', delay: 8.0,
              text: '(takes fragment) I promise.' },
          ],
        },
        rewards: { xp: 1200, item: 'Crown_Fragment_Veyra', codex: 'codex_duel_victory', relationship: +10 },
        veyraFate: 'alive_wanderer', // Leaves to search for Caelen independently
      },
      playerLoses: {
        cinematic: {
          id: 'cin_duel_player_loses',
          duration: 12.0,
          shots: [
            { camera: 'veyra_standing', duration: 3.0, desc: 'Veyra stands, corruption flickering but controlled' },
            { camera: 'kael_ground', duration: 3.0, desc: 'Kael falls to one knee' },
            { camera: 'veyra_closeup', duration: 3.0, desc: 'Veyra hesitates — doesn\'t take the killing blow' },
            { camera: 'crown_altar', duration: 3.0, desc: 'Veyra approaches altar, looks back at Kael' },
          ],
          dialogue: [
            { speaker: 'Veyra', emotion: 'respectful', delay: 6.5,
              text: 'You fought well, Kael. The Crown would have been safe with you.' },
            { speaker: 'Veyra', emotion: 'sad', delay: 9.0,
              text: 'But I need it more. Caelen needs it more.' },
          ],
        },
        rewards: { xp: 600, codex: 'codex_duel_defeat' },
        veyraFate: 'crown_bearer', // Veyra takes the Crown — but respects player's wishes
        playerChoice: {
          prompt: 'Veyra holds the Crown. She looks at you. "What should I wish for?"',
          options: [
            { id: 'wish_heal_land', text: 'Heal the land.', effect: 'realm_restored' },
            { id: 'wish_save_caelen', text: 'Save your brother.', effect: 'caelen_restored', relationship: +15 },
            { id: 'wish_destroy_crown', text: 'Destroy it. No one should wield that power.', effect: 'crown_shattered' },
          ],
        },
      },
    },
    corruption_consumed: {
      // Veyra IS the boss — player must defeat Hollow Veyra
      description: 'Hollow Veyra fight — corruption has fully consumed her.',
      playerWins: {
        cinematic: {
          id: 'cin_hollow_defeated',
          duration: 18.0,
          shots: [
            { camera: 'veyra_crumbling', duration: 4.0, desc: 'Corruption cracks and peels from Veyra\'s body' },
            { camera: 'veyra_human', duration: 4.0, desc: 'Brief flash of real Veyra underneath — reaching out' },
            { camera: 'kael_reaching', duration: 3.0, desc: 'Kael grabs her hand as corruption dissolves' },
            { camera: 'crown_erupts', duration: 3.0, desc: 'Crown fragments erupt from her body' },
            { camera: 'wide_altar', duration: 4.0, desc: 'Veyra collapses, purified but barely alive' },
          ],
          dialogue: [
            { speaker: 'Veyra', emotion: 'agonized', delay: 4.5,
              text: '(gasping) K-Kael...? I can see again... What did I—' },
            { speaker: 'Kael', emotion: 'gentle', delay: 9.0,
              text: 'It\'s over. The corruption is gone.' },
            { speaker: 'Veyra', emotion: 'broken', delay: 13.0,
              text: 'The things I did... Caelen... I\'m sorry. I\'m so sorry.' },
          ],
        },
        rewards: { xp: 1500, item: 'Purified_Crown_Essence', codex: 'codex_hollow_redeemed' },
        veyraFate: 'alive_broken', // Alive but shattered — needs healing arc
      },
      playerLoses: {
        description: 'Game over — Hollow Veyra consumes the Crown. Bad ending.',
        cinematic: {
          id: 'cin_hollow_wins',
          duration: 10.0,
          shots: [
            { camera: 'veyra_ascends', duration: 5.0, desc: 'Hollow Veyra absorbs both Crown fragments' },
            { camera: 'world_corrupts', duration: 5.0, desc: 'Corruption wave spreads across the land' },
          ],
        },
        veyraFate: 'hollow_queen', // Bad ending — world consumed
        triggersEnding: 'ending_hollow_reign',
      },
    },
    mutual_destruction: {
      // Both die — but the Crown is neutralized
      description: 'Final exchange — both Crown-Seekers deliver mortal blows simultaneously.',
      cinematic: {
        id: 'cin_mutual_destruction',
        duration: 20.0,
        shots: [
          { camera: 'slow_mo_charge', duration: 4.0, desc: 'Both rush each other in slow motion' },
          { camera: 'impact_freeze', duration: 2.0, desc: 'Freeze frame at moment of impact — both blades connect' },
          { camera: 'aftermath', duration: 4.0, desc: 'Both collapse, Crown fragments shatter between them' },
          { camera: 'aerial_pullback', duration: 4.0, desc: 'Camera rises — corruption dissipates from the land' },
          { camera: 'veyra_last_words', duration: 3.0, desc: 'Veyra reaches for Kael\'s hand' },
          { camera: 'hands_touching', duration: 3.0, desc: 'Their hands meet as light fades' },
        ],
        dialogue: [
          { speaker: 'Veyra', emotion: 'peaceful', delay: 14.0,
            text: '(whisper) At least... neither of us has to carry it alone.' },
        ],
      },
      rewards: { xp: 800, codex: 'codex_mutual_sacrifice' },
      veyraFate: 'dead_at_peace',
      kaelFate: 'dead_at_peace',
      triggersEnding: 'ending_twin_sacrifice',
    },
  },
};

// ── ABSORB Resolution Path ──────────────────────────────────────────────────

/**
 * Absorb path: one party channels the other's Crown power into themselves.
 * Mechanically: a timed ritual with corruption management and QTE-like inputs.
 */
export const ABSORB_RESOLUTION = {
  id: RESOLUTION_PATH_TYPES.ABSORB,
  name: 'Crown Transference',
  description: 'One Crown-Seeker absorbs the other\'s fragment — taking their power and their burden.',

  setup: {
    arena: {
      name: 'Crown Altar — Transference Circle',
      center: { x: 0, y: 0, z: 0 },
      radius: 600,
      boundary: 'crown_energy_dome', // Sealed — ritual in progress
      lighting: 'ethereal_glow',
      weather: 'calm_corruption_motes',
    },
    cinematic: {
      id: 'cin_absorb_setup',
      duration: 10.0,
      shots: [
        { camera: 'altar_wide', duration: 3.0, desc: 'Crown Altar pulses with combined shard energy' },
        { camera: 'fragments_float', duration: 3.0, desc: 'Both Crown fragments rise and orbit each other' },
        { camera: 'two_shot_close', duration: 4.0, desc: 'Both seekers kneel at opposite sides of the altar' },
      ],
      dialogue: [
        { speaker: 'Veyra', emotion: 'resigned', text: 'One of us takes it all. The Crown... and the corruption with it.', delay: 3.0 },
        { speaker: 'Kael', emotion: 'grave', text: '(inner) The transference will be agony. But it\'s the only way.', delay: 7.0 },
      ],
      audio: { music: 'mus_transference_ritual', ambience: 'amb_shard_resonance' },
    },
  },

  /**
   * Transference ritual phases — timed corruption management
   * Player must manage corruption levels during the absorption process.
   */
  phases: [
    {
      id: 'phase_attunement',
      name: 'Attunement',
      duration: 20,
      description: 'Both seekers attune to the altar. Player must match shard pulse timing.',
      mechanic: 'rhythm_match',
      mechanicDetails: {
        pulseInterval: 2.0,    // Shard pulses every 2s
        inputWindow: 0.5,      // Player has 0.5s to match
        requiredMatches: 8,    // Need 8/10 successful matches
        failPenalty: 'corruption_surge_5pct', // Miss = corruption spike
        successReward: 'willpower_boost_3pct',
      },
      vfx: 'shard_pulse_rings',
      corruption: { rate: 0.01, max: 0.3 }, // Slow corruption buildup
      callout: { speaker: 'Veyra', text: 'Match the pulse! Feel the Crown\'s rhythm!', emotion: 'focused' },
    },
    {
      id: 'phase_channel',
      name: 'Channeling',
      duration: 30,
      description: 'Crown power flows between seekers. Player manages corruption via shard abilities.',
      mechanic: 'corruption_management',
      mechanicDetails: {
        corruptionRate: 0.03,        // Per second
        purifyAbilities: ['willpower_pulse', 'shard_cleanse'],
        purifyAmount: 0.15,          // Each purify reduces corruption 15%
        purifyCooldown: 5,           // 5s between purifies
        corruptionThreshold: 0.7,    // Above 70% = danger zone
        dangerZoneEffects: ['screen_distortion', 'whisper_voices', 'control_inversion'],
        failThreshold: 0.95,         // Above 95% = ritual fails
      },
      vfx: 'crown_energy_stream',
      callout: { speaker: 'Veyra', text: 'The corruption— it\'s fighting back! Purify it, don\'t let it take hold!', emotion: 'strained' },
    },
    {
      id: 'phase_transference',
      name: 'The Transference',
      duration: 15,
      description: 'Final transfer. Player chooses: absorb Veyra\'s power or let her absorb theirs.',
      mechanic: 'choice_hold',
      mechanicDetails: {
        choicePrompt: 'The Crown fragments merge. Who will bear the weight?',
        options: [
          {
            id: 'kael_absorbs',
            text: 'I\'ll carry it. (Absorb Veyra\'s fragment)',
            holdDuration: 5.0,  // Must hold input for 5s — commitment
            corruptionCost: 0.2,
            effect: 'kael_bears_crown',
          },
          {
            id: 'veyra_absorbs',
            text: 'Let her take it. (Release your fragment to Veyra)',
            holdDuration: 5.0,
            corruptionCost: 0,
            effect: 'veyra_bears_crown',
          },
        ],
        interruptable: true,   // Letting go cancels — shows commitment
      },
      vfx: 'crown_merge_spiral',
      callout: { speaker: 'Veyra', text: '(gasping) Choose, Kael... one of us has to hold it all...', emotion: 'agonized' },
    },
  ],

  /**
   * Outcome variants
   */
  outcomes: {
    sacrifice_save: {
      kael_absorbs: {
        cinematic: {
          id: 'cin_kael_absorbs_sacrifice',
          duration: 18.0,
          shots: [
            { camera: 'energy_into_kael', duration: 4.0, desc: 'Crown energy flows into Kael — pain but resolve' },
            { camera: 'veyra_fading', duration: 4.0, desc: 'Veyra\'s corruption drains — she weakens' },
            { camera: 'veyra_collapse', duration: 3.0, desc: 'Veyra collapses, free of corruption but drained' },
            { camera: 'kael_glowing', duration: 3.0, desc: 'Kael stands with both fragments — immense power' },
            { camera: 'veyra_smile', duration: 4.0, desc: 'Veyra smiles up at Kael with relief' },
          ],
          dialogue: [
            { speaker: 'Veyra', emotion: 'relief', delay: 11.0,
              text: 'It\'s... gone. The whispers stopped. (laughs weakly) I can think clearly for the first time in months.' },
            { speaker: 'Veyra', emotion: 'grateful', delay: 14.5,
              text: 'Thank you, Kael. Bear it well. And please... find Caelen.' },
          ],
        },
        rewards: { xp: 1000, item: 'Unified_Crown_Fragment', codex: 'codex_sacrifice_bearer', corruptionGain: 0.2 },
        veyraFate: 'alive_purified',
      },
      veyra_absorbs: {
        cinematic: {
          id: 'cin_veyra_absorbs_sacrifice',
          duration: 20.0,
          shots: [
            { camera: 'energy_into_veyra', duration: 4.0, desc: 'Crown energy flows into Veyra — corruption surges' },
            { camera: 'veyra_struggle', duration: 4.0, desc: 'Veyra fights to contain the combined power' },
            { camera: 'veyra_scream', duration: 3.0, desc: 'Corruption overwhelms — she channels it into a shield' },
            { camera: 'shield_over_kael', duration: 3.0, desc: 'Shield of Crown energy protects Kael from eruption' },
            { camera: 'veyra_falling', duration: 3.0, desc: 'Veyra falls — spent everything to save Kael' },
            { camera: 'kael_catches', duration: 3.0, desc: 'Kael catches her. Her eyes are clear.' },
          ],
          dialogue: [
            { speaker: 'Veyra', emotion: 'strained', delay: 4.5,
              text: 'I can hold it... I CAN HOLD IT!' },
            { speaker: 'Veyra', emotion: 'peaceful', delay: 15.0,
              text: '(dying) Tell Caelen... his sister chose well... in the end...' },
          ],
        },
        rewards: { xp: 1000, item: 'Veyra_Last_Shard', codex: 'codex_sacrifice_witness' },
        veyraFate: 'dead_sacrifice',
        triggersEnding: 'ending_sacrifice',
      },
    },
    brother_intervention: {
      // Caelen appears — changes the dynamic
      setup_override: {
        cinematic_insert: {
          id: 'cin_caelen_appears',
          duration: 8.0,
          insertAt: 'phase_transference_start',
          shots: [
            { camera: 'portal_opens', duration: 2.0, desc: 'A rift tears open — young man stumbles through' },
            { camera: 'veyra_shock', duration: 2.0, desc: 'Veyra freezes — recognition floods her face' },
            { camera: 'caelen_reveal', duration: 2.0, desc: 'Caelen — corrupted, confused, but alive' },
            { camera: 'three_shot', duration: 2.0, desc: 'Three figures at the altar — the Crown pulses' },
          ],
          dialogue: [
            { speaker: 'Veyra', emotion: 'disbelief', delay: 2.5,
              text: 'C-Caelen?! You\'re — how are you here?!' },
            { speaker: 'Caelen', emotion: 'confused', delay: 5.0,
              text: 'Veyra... sister... the Crown called me. It wants to come home.' },
          ],
        },
      },
      three_way_choice: {
        prompt: 'Caelen reaches for the Crown. The fragments respond to all three of you.',
        options: [
          {
            id: 'save_both',
            text: 'Channel the Crown through all three — save both siblings.',
            holdDuration: 8.0,
            corruptionCost: 0.35,
            effect: 'both_siblings_saved',
            difficulty: 'very_hard', // Requires high willpower
            willpowerMin: 0.7,
          },
          {
            id: 'save_caelen',
            text: 'Let Veyra sacrifice herself to purify Caelen.',
            holdDuration: 5.0,
            corruptionCost: 0.1,
            effect: 'caelen_purified_veyra_dies',
          },
          {
            id: 'crown_decides',
            text: 'Release the Crown — let it choose.',
            holdDuration: 3.0,
            corruptionCost: 0,
            effect: 'crown_autonomous', // Crown makes its own choice
          },
        ],
      },
      outcomes_by_choice: {
        both_siblings_saved: {
          cinematic: {
            id: 'cin_both_saved',
            duration: 15.0,
            shots: [
              { camera: 'three_way_channel', duration: 5.0, desc: 'All three channel Crown energy — agony but unity' },
              { camera: 'corruption_shatters', duration: 4.0, desc: 'Corruption explodes outward — purified by combined will' },
              { camera: 'siblings_reunite', duration: 6.0, desc: 'Veyra and Caelen embrace. Crown fragments dissolve into light.' },
            ],
          },
          rewards: { xp: 2000, item: 'Crown_Essence_Pure', codex: 'codex_family_restored' },
          veyraFate: 'alive_reunited',
          caelenFate: 'alive_purified',
          triggersEnding: 'ending_family_redeemed',
        },
        caelen_purified_veyra_dies: {
          cinematic: {
            id: 'cin_caelen_saved',
            duration: 15.0,
            shots: [
              { camera: 'veyra_channels', duration: 4.0, desc: 'Veyra pours her life force into Caelen' },
              { camera: 'caelen_heals', duration: 4.0, desc: 'Corruption lifts from Caelen — tears on his face' },
              { camera: 'veyra_fades', duration: 4.0, desc: 'Veyra smiles as she dissolves into golden light' },
              { camera: 'caelen_weeps', duration: 3.0, desc: 'Caelen holds the space where she stood' },
            ],
          },
          rewards: { xp: 1500, item: 'Veyra_Sacrifice_Shard', codex: 'codex_sister_sacrifice' },
          veyraFate: 'dead_sacrifice_for_brother',
          caelenFate: 'alive_grieving',
          triggersEnding: 'ending_brother_saved',
        },
        crown_autonomous: {
          cinematic: {
            id: 'cin_crown_decides',
            duration: 12.0,
            shots: [
              { camera: 'crown_awakens', duration: 4.0, desc: 'Crown fragments merge autonomously — sentient glow' },
              { camera: 'crown_judges', duration: 4.0, desc: 'Energy tendrils reach toward each person — testing' },
              { camera: 'crown_choice', duration: 4.0, desc: 'Crown disperses into the land itself — choosing no one' },
            ],
            dialogue: [
              { speaker: 'narrator', emotion: 'ominous', delay: 8.0,
                text: 'The Crown chose neither seeker, nor the lost brother. It chose the world.' },
            ],
          },
          rewards: { xp: 1200, codex: 'codex_crown_autonomous' },
          veyraFate: 'alive_powerless',
          caelenFate: 'alive_powerless',
          triggersEnding: 'ending_crown_dispersed',
        },
      },
    },
  },
};

// ── MERGE Resolution Path ───────────────────────────────────────────────────

/**
 * Merge path: both Crown-Seekers combine their fragments cooperatively.
 * The most complex and rewarding path — requires high relationship.
 * Mechanically: synchronized cooperative ritual with shared corruption pool.
 */
export const MERGE_RESOLUTION = {
  id: RESOLUTION_PATH_TYPES.MERGE,
  name: 'Crown Synthesis',
  description: 'Two seekers, one Crown. Together they forge something the Crown\'s creators never intended.',

  setup: {
    arena: {
      name: 'Crown Altar — Synthesis Chamber',
      center: { x: 0, y: 0, z: 0 },
      radius: 800,
      boundary: 'crown_harmony_field',
      lighting: 'warm_golden_dawn',
      weather: 'clear_rising_light',
    },
    cinematic: {
      id: 'cin_merge_setup',
      duration: 14.0,
      shots: [
        { camera: 'dawn_wide', duration: 3.0, desc: 'Dawn breaks over the Crown Altar — first light in ages' },
        { camera: 'altar_responds', duration: 3.0, desc: 'Altar recognizes two willing seekers — ancient runes glow' },
        { camera: 'kael_veyra_approach', duration: 4.0, desc: 'Both approach the altar from opposite sides' },
        { camera: 'hands_on_altar', duration: 4.0, desc: 'Both place their fragments on the altar simultaneously' },
      ],
      dialogue: [
        { speaker: 'Veyra', emotion: 'hopeful', text: 'The texts say the Crown was made by two smiths. Maybe it was always meant for two.', delay: 3.0 },
        { speaker: 'Kael', emotion: 'determined', text: '(inner) If we share the burden, maybe neither of us breaks.', delay: 7.0 },
        { speaker: 'Veyra', emotion: 'resolute', text: 'Together, then. On three.', delay: 11.0 },
      ],
      audio: { music: 'mus_crown_synthesis', ambience: 'amb_dawn_chorus', stinger: 'sfx_fragments_resonate' },
    },
  },

  /**
   * Synthesis phases — cooperative mechanics
   */
  phases: [
    {
      id: 'phase_resonance',
      name: 'Shard Resonance',
      duration: 25,
      description: 'Both fragments must resonate at the same frequency. Player and Veyra alternate shard inputs.',
      mechanic: 'cooperative_sync',
      mechanicDetails: {
        description: 'Alternating shard pulses — player fires, Veyra fires, must alternate without breaking chain',
        chainLength: 12,            // 12 alternating pulses needed
        playerWindow: 1.5,          // Player has 1.5s to respond
        veyraAccuracy: 0.85,        // Veyra hits 85% of her beats (she can miss too!)
        missRecovery: 2.0,          // 2s pause after a miss before chain resumes
        maxMisses: 3,               // More than 3 misses restarts the phase
        corruptionPerMiss: 0.05,
        successVfx: 'dual_shard_helix',
      },
      corruption: { shared: true, pool: 0, rate: 0.005 },
      callout: { speaker: 'Veyra', text: 'Feel the rhythm — pulse, pulse, pulse! Don\'t break the chain!', emotion: 'focused' },
    },
    {
      id: 'phase_purification',
      name: 'Mutual Purification',
      duration: 30,
      description: 'Both seekers purge each other\'s corruption. Player purifies Veyra, she purifies player.',
      mechanic: 'cross_purify',
      mechanicDetails: {
        description: 'Target corruption nodes on Veyra while she targets yours. Shared corruption pool must reach 0.',
        corruptionNodes: 6,         // 6 nodes to cleanse on each person
        nodeHitPoints: 3,           // Each node needs 3 hits
        purifyAbility: 'shard_cleanse_targeted',
        veyraCleanseRate: 0.8,      // She cleanses your nodes at 80% efficiency
        sharedPoolDrain: 0.02,      // Pool drains 2% per second when both purifying
        sharedPoolGrowth: 0.01,     // Pool grows 1% per second naturally
        failThreshold: 0.8,         // Shared pool above 80% = fail
      },
      vfx: 'corruption_drain_dual',
      callout: { speaker: 'Veyra', text: 'I can see your corruption — hold still! I\'ll cleanse if you cleanse!', emotion: 'determined' },
    },
    {
      id: 'phase_synthesis',
      name: 'Crown Synthesis',
      duration: 20,
      description: 'Final phase — both pour willpower into the altar. Crown reforms. Corruption counterattacks.',
      mechanic: 'shared_channel',
      mechanicDetails: {
        description: 'Both hold channel input while corruption waves try to interrupt. Shield each other.',
        channelInput: 'hold_both_triggers',
        interruptWaves: [
          { time: 3, target: 'player', type: 'corruption_blast', shieldable: true },
          { time: 7, target: 'veyra', type: 'corruption_blast', shieldable: true },
          { time: 11, target: 'both', type: 'corruption_nova', shieldable: false, dodgeable: true },
          { time: 15, target: 'player', type: 'corruption_tentacles', shieldable: true },
          { time: 18, target: 'both', type: 'final_surge', shieldable: false, holdThrough: true },
        ],
        shieldAbility: 'shard_barrier',
        shieldCooldown: 4,
        veyraShieldsPlayer: true,   // Veyra will shield player at 70% reliability
        interruptPenalty: 'restart_5s', // Interrupted = lose 5s of progress
        completionThreshold: 20,       // Must hold for total 20s of channel time
      },
      vfx: 'crown_reform_spiral',
      callout: { speaker: 'Veyra', text: 'Hold on! Don\'t let go — I\'ll shield you! TRUST ME!', emotion: 'desperate' },
    },
  ],

  /**
   * Merge success outcome — always redemption_together
   */
  outcomes: {
    redemption_together: {
      success: {
        cinematic: {
          id: 'cin_merge_success',
          duration: 25.0,
          shots: [
            { camera: 'crown_reforms', duration: 4.0, desc: 'Crown fragments merge — golden light erupts' },
            { camera: 'corruption_shatters', duration: 3.0, desc: 'All corruption in the arena vaporizes' },
            { camera: 'dual_crowns', duration: 4.0, desc: 'Crown splits into two halves — one for each seeker' },
            { camera: 'kael_receives', duration: 3.0, desc: 'Kael\'s half settles onto his brow — warm glow' },
            { camera: 'veyra_receives', duration: 3.0, desc: 'Veyra\'s half crowns her — corruption fully purged' },
            { camera: 'dawn_breaks', duration: 4.0, desc: 'Full sunrise — light washes over the land' },
            { camera: 'both_standing', duration: 4.0, desc: 'Both Crown-Seekers stand together, halves resonating' },
          ],
          dialogue: [
            { speaker: 'Veyra', emotion: 'wonder', delay: 7.5,
              text: 'It split. The Crown... it was never meant for one person.' },
            { speaker: 'Kael', emotion: 'understanding', delay: 11.0,
              text: '(inner) Two smiths forged it. Two seekers restore it. Balance.' },
            { speaker: 'Veyra', emotion: 'joyful', delay: 16.0,
              text: '(laughing, tears) I can feel Caelen. He\'s out there — alive. The Crown is showing me!' },
            { speaker: 'Veyra', emotion: 'grateful', delay: 21.0,
              text: 'Kael... thank you. For seeing something in me worth saving.' },
          ],
        },
        rewards: {
          xp: 2500,
          item: 'Crown_Half_Kael',
          bonusItem: 'Crown_Half_Veyra_Bond', // Summon item — calls Veyra as companion
          codex: 'codex_crown_synthesis',
          relationship: +25,
          unlocks: ['veyra_companion', 'dual_crown_abilities', 'caelen_quest_chain'],
        },
        veyraFate: 'alive_ally_crown_bearer',
        triggersEnding: 'ending_dual_crown',
        postGame: {
          veyraAvailable: true,
          veyraRole: 'companion',
          newQuestChain: 'finding_caelen', // Post-game content
          dualCrownAbilities: [
            { id: 'crown_resonance_dual', desc: 'Both Crown halves pulse — doubled effect' },
            { id: 'crown_summon_veyra', desc: 'Summon Veyra for boss fights' },
            { id: 'crown_purify_aoe', desc: 'Combined purification wave — clears corruption zones' },
          ],
        },
      },
      failure: {
        description: 'Synthesis interrupted — fragments reject each other. Falls back to FIGHT path.',
        fallbackPath: RESOLUTION_PATH_TYPES.FIGHT,
        fallbackOutcome: 'reluctant_duel',
        cinematic: {
          id: 'cin_merge_failure',
          duration: 8.0,
          shots: [
            { camera: 'crown_rejects', duration: 3.0, desc: 'Fragments repel — energy explosion knocks both back' },
            { camera: 'aftermath', duration: 2.5, desc: 'Both stagger to feet, fragments return to their owners' },
            { camera: 'standoff', duration: 2.5, desc: 'Eyes meet — the peaceful option failed' },
          ],
          dialogue: [
            { speaker: 'Veyra', emotion: 'disappointed', delay: 5.5,
              text: 'It didn\'t work. (draws weapon) I suppose there\'s only one way left.' },
          ],
        },
      },
    },
  },
};

// ── Resolution Path Runtime ─────────────────────────────────────────────────

/**
 * All 3 resolution paths indexed by type.
 */
export const RESOLUTION_PATHS = {
  [RESOLUTION_PATH_TYPES.FIGHT]:  FIGHT_RESOLUTION,
  [RESOLUTION_PATH_TYPES.ABSORB]: ABSORB_RESOLUTION,
  [RESOLUTION_PATH_TYPES.MERGE]:  MERGE_RESOLUTION,
};

/**
 * Determine which resolution path to use based on the final outcome.
 * @param {string} outcomeId - From determineFinalOutcome().id
 * @returns {object} { pathType, path, outcomeId }
 */
export function getResolutionPath(outcomeId) {
  const pathType = OUTCOME_TO_PATH[outcomeId];
  if (!pathType) return { error: `No resolution path for outcome: ${outcomeId}` };
  return {
    pathType,
    path: RESOLUTION_PATHS[pathType],
    outcomeId,
  };
}

/**
 * Build the complete resolution sequence for a given game state.
 * Combines outcome determination with path selection and phase configuration.
 *
 * @param {object} gameState - { relationshipScore, veyraCorruption, willpower, flags, playerShardUsage }
 * @returns {object} Complete resolution config ready for the encounter system
 */
export function buildResolutionSequence(gameState = {}) {
  // Step 1: Determine final outcome
  const flags = new Set(gameState.flags || []);
  const outcome = determineFinalOutcome({
    ...gameState,
    flags,
  });
  if (!outcome) return { error: 'Could not determine final outcome' };

  // Step 2: Get resolution path
  const pathType = OUTCOME_TO_PATH[outcome.id];
  const path = RESOLUTION_PATHS[pathType];
  if (!path) return { error: `No resolution path for outcome: ${outcome.id}` };

  // Step 3: Build corruption state
  const corruption = computeRivalCorruption(gameState.willpower || 0.5);

  // Step 4: Build Veyra's combat loadout (for fight path)
  let veyraLoadout = null;
  if (pathType === RESOLUTION_PATH_TYPES.FIGHT) {
    const profile = createPlayerShardProfile();
    if (gameState.playerShardUsage) {
      for (const [shard, count] of Object.entries(gameState.playerShardUsage)) {
        profile.shardUsage[shard] = count;
        profile.totalActions += count;
      }
    }
    veyraLoadout = buildDynamicLoadout(profile, {
      corruptionTier: corruption.tier,
      region: 'TheWilds',
    });
  }

  // Step 5: Assemble complete sequence
  return {
    outcome: { id: outcome.id, name: outcome.name, description: outcome.description },
    pathType,
    pathName: path.name,
    pathDescription: path.description,
    setup: path.setup,
    phases: path.phases,
    outcomeVariants: path.outcomes[outcome.id] || null,
    veyraState: {
      corruption,
      loadout: veyraLoadout,
      relationship: getRelationshipFromScore(gameState.relationshipScore || 0),
    },
    metadata: {
      totalPhaseDuration: path.phases.reduce((sum, p) => sum + (p.duration || 0), 0),
      hasCinematic: true,
      hasPlayerChoice: pathType !== RESOLUTION_PATH_TYPES.FIGHT,
      canFail: pathType === RESOLUTION_PATH_TYPES.MERGE,
      failFallback: pathType === RESOLUTION_PATH_TYPES.MERGE
        ? { path: RESOLUTION_PATH_TYPES.FIGHT, outcome: 'reluctant_duel' }
        : null,
    },
  };
}

/**
 * Get a summary of all 3 resolution paths for inspection.
 * @returns {object[]}
 */
export function getResolutionPathSummaries() {
  return Object.values(RESOLUTION_PATHS).map(path => ({
    id: path.id,
    name: path.name,
    description: path.description,
    phaseCount: path.phases.length,
    phases: path.phases.map(p => ({ id: p.id, name: p.name, duration: p.duration, mechanic: p.mechanic })),
    outcomeCount: Object.keys(path.outcomes).length,
    outcomes: Object.keys(path.outcomes),
  }));
}

/**
 * Export all resolution path specs to JSON for UE5 consumption.
 */
export function exportResolutionPaths() {
  const game = getActiveGame();
  const outDir = join(game.assetsPath, 'Narrative');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const exportData = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    milestone: 'ms_6',
    description: '3 Final Act Resolution Paths — Fight, Absorb, Merge',
    pathTypes: Object.values(RESOLUTION_PATH_TYPES),
    outcomeToPath: OUTCOME_TO_PATH,
    paths: {
      fight: FIGHT_RESOLUTION,
      absorb: ABSORB_RESOLUTION,
      merge: MERGE_RESOLUTION,
    },
  };

  const outPath = join(outDir, 'resolution-paths.json');
  writeFileSync(outPath, JSON.stringify(exportData, null, 2), 'utf-8');
  log.info(`Resolution paths exported to ${outPath}`);
  return { success: true, path: outPath, pathCount: 3, outcomeCount: Object.keys(OUTCOME_TO_PATH).length };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ms_7 — Companion Reactions to Rival Encounters
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Companion speakers who react to rival encounters.
 * References NPC profiles from npc-dialogue.js SPEAKERS.
 */
export const COMPANION_SPEAKERS = {
  Lira:   { id: 'Lira',   portrait: '/Game/UI/Portraits/T_Portrait_Lira',   voicePrefix: 'voice_lira' },
  Theron: { id: 'Theron', portrait: '/Game/UI/Portraits/T_Portrait_Theron', voicePrefix: 'voice_theron' },
};

/**
 * Reaction trigger types — when companions chime in during rival encounters.
 */
export const REACTION_TRIGGERS = {
  ENCOUNTER_START:    'encounter_start',    // Veyra appears
  ENCOUNTER_DIALOGUE: 'encounter_dialogue', // During Veyra dialogue (interjection)
  ENCOUNTER_COMBAT:   'encounter_combat',   // Combat begins with/against Veyra
  ENCOUNTER_CHOICE:   'encounter_choice',   // Player faces a Veyra-related choice
  ENCOUNTER_END:      'encounter_end',      // After encounter resolves
  POST_ENCOUNTER:     'post_encounter',     // At next campfire/rest after encounter
  ALLEGIANCE_SHIFT:   'allegiance_shift',   // During boss fight allegiance change
  RESOLUTION_PHASE:   'resolution_phase',   // During final act resolution
};

/**
 * Companion reactions keyed by encounter region + trigger.
 * Each reaction has: companion, trigger, conditions, dialogue lines, emotion, and effects.
 *
 * Lira is the primary companion — present in most encounters.
 * Theron appears in specific regions (Ironhold, EmberPeaks).
 */
export const COMPANION_REACTIONS = {

  // ── CrossroadsHub: First Glimpse ────────────────────────────────────────────
  crossroads_glimpse: [
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.ENCOUNTER_END,
      conditions: {},
      lines: [
        { emotion: 'concerned', text: 'Did you see her? The way she moved — she has a shard too, Kael.' },
        { emotion: 'determined', text: 'We should be careful. Another seeker means competition... or worse.' },
      ],
      effects: [{ type: 'modify_relationship', npcId: 'Lira', amount: 2 }],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.POST_ENCOUNTER,
      conditions: {},
      lines: [
        { emotion: 'mysterious', text: 'I\'ve been thinking about that woman. She looked... haunted. Like she\'s carrying something heavy.' },
        { emotion: 'hopeful', text: 'Maybe she doesn\'t have to be an enemy. Not everyone who seeks the Crown wants to destroy.' },
      ],
      effects: [],
    },
  ],

  // ── AshenWilds: Confrontation ───────────────────────────────────────────────
  ashen_confrontation: [
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.ENCOUNTER_START,
      conditions: {},
      lines: [
        { emotion: 'angry', text: 'Her again! Kael, she\'s blocking our path — this is deliberate!' },
      ],
      effects: [],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.ENCOUNTER_COMBAT,
      conditions: {},
      lines: [
        { emotion: 'concerned', text: 'Watch her dash! She\'s fast — don\'t overcommit!' },
        { emotion: 'determined', text: 'I\'ll flank! Keep her attention on you!' },
      ],
      effects: [],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.ENCOUNTER_END,
      conditions: { outcomeIsHostile: true },
      lines: [
        { emotion: 'angry', text: 'She\'s dangerous, Kael. Next time she won\'t hold back — and neither should we.' },
      ],
      effects: [{ type: 'modify_relationship', npcId: 'Lira', amount: -2 }],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.ENCOUNTER_END,
      conditions: { outcomeIsPeaceful: true },
      lines: [
        { emotion: 'hopeful', text: 'She let us pass. There\'s something under that hostility... something human.' },
      ],
      effects: [{ type: 'modify_relationship', npcId: 'Lira', amount: 3 }],
    },
  ],

  // ── Ironhold: Forced Cooperation ────────────────────────────────────────────
  ironhold_truce: [
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.ENCOUNTER_START,
      conditions: {},
      lines: [
        { emotion: 'concerned', text: 'The mine is collapsing — we can\'t fight her AND survive this!' },
        { emotion: 'determined', text: '(to Veyra) Truce. Until the beast is dead.' },
      ],
      effects: [],
    },
    {
      companion: 'Theron',
      trigger: REACTION_TRIGGERS.ENCOUNTER_START,
      conditions: { theronPresent: true },
      lines: [
        { emotion: 'neutral', text: 'I\'ve fought alongside worse than rival seekers. Focus on the creature.' },
      ],
      effects: [],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.ENCOUNTER_COMBAT,
      conditions: {},
      lines: [
        { emotion: 'concerned', text: 'She\'s actually helping! Watch — she just shielded that miner!' },
        { emotion: 'hopeful', text: 'Maybe Veyra isn\'t what I thought...' },
      ],
      effects: [{ type: 'modify_relationship', npcId: 'Lira', amount: 5 }],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.ENCOUNTER_END,
      conditions: {},
      lines: [
        { emotion: 'sad', text: 'She saved those miners... but did you see her hands? The corruption is eating her alive.' },
        { emotion: 'concerned', text: 'Kael, whatever she\'s searching for — it\'s destroying her in the process.' },
      ],
      effects: [],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.POST_ENCOUNTER,
      conditions: {},
      lines: [
        { emotion: 'sad', text: 'She mentioned a brother. Caelen. She\'s doing all of this for him, isn\'t she?' },
        { emotion: 'hopeful', text: 'If we could help her find him... maybe she\'d stop fighting us.' },
      ],
      effects: [],
    },
  ],

  // ── VerdantReach: Witness ───────────────────────────────────────────────────
  verdant_witness: [
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.ENCOUNTER_DIALOGUE,
      conditions: {},
      lines: [
        { emotion: 'terrified', text: 'She absorbed that corruption blast! Is she— is she doing that on PURPOSE?!' },
      ],
      effects: [],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.ENCOUNTER_END,
      conditions: {},
      lines: [
        { emotion: 'concerned', text: 'She saved the Guardian by taking the corruption into herself. That\'s brave... or suicidal.' },
        { emotion: 'sad', text: 'I don\'t think she has much time left, Kael. The corruption is changing her.' },
      ],
      effects: [{ type: 'modify_relationship', npcId: 'Lira', amount: 3 }],
    },
  ],

  // ── SunkenHalls: Revelation ─────────────────────────────────────────────────
  sunken_revelation: [
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.ENCOUNTER_DIALOGUE,
      conditions: {},
      lines: [
        { emotion: 'sad', text: 'Her brother... He was corrupted as a child? No wonder she\'s desperate.' },
      ],
      effects: [],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.ENCOUNTER_END,
      conditions: {},
      lines: [
        { emotion: 'concerned', text: 'She showed us something real in there. Her pain, her motivation... all of it.' },
        { emotion: 'determined', text: 'I think she trusts us, Kael. At least a little. Don\'t waste that.' },
      ],
      effects: [{ type: 'modify_relationship', npcId: 'Lira', amount: 5 }],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.POST_ENCOUNTER,
      conditions: {},
      lines: [
        { emotion: 'hopeful', text: 'Kael... if we could cure Caelen, could we cure Veyra too? The Crown might be able to—' },
        { emotion: 'concerned', text: 'But that means reassembling it. And we both know the risks.' },
      ],
      effects: [],
    },
  ],

  // ── EmberPeaks: Alliance Choice ─────────────────────────────────────────────
  ember_alliance: [
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.ENCOUNTER_CHOICE,
      conditions: { choiceIsAlliance: true },
      lines: [
        { emotion: 'hopeful', text: 'I think we should trust her, Kael. She\'s proven herself at Ironhold.' },
      ],
      effects: [],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.ENCOUNTER_CHOICE,
      conditions: { choiceIsRejection: true },
      lines: [
        { emotion: 'sad', text: 'Are you sure? She\'s reaching out — pushing her away now could make things worse.' },
      ],
      effects: [],
    },
    {
      companion: 'Theron',
      trigger: REACTION_TRIGGERS.ENCOUNTER_COMBAT,
      conditions: { theronPresent: true },
      lines: [
        { emotion: 'determined', text: 'The Warden is shifting forms! Veyra, cover the left flank — I\'ve got right!' },
        { emotion: 'neutral', text: 'She fights well. Respect earned, if nothing else.' },
      ],
      effects: [],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.ENCOUNTER_END,
      conditions: { allianceFormed: true },
      lines: [
        { emotion: 'hopeful', text: 'We did it — together. All three of us. That\'s the first time I\'ve felt like we might actually win this.' },
        { emotion: 'amused', text: '(to Veyra) You\'re not as scary as you pretend to be, you know.' },
      ],
      effects: [{ type: 'modify_relationship', npcId: 'Lira', amount: 8 }],
    },
  ],

  // ── Aethermere: Final Plea ──────────────────────────────────────────────────
  aether_plea: [
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.ENCOUNTER_DIALOGUE,
      conditions: {},
      lines: [
        { emotion: 'terrified', text: 'Kael, she\'s begging. I\'ve never seen her like this — the corruption is at her throat.' },
      ],
      effects: [],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.ENCOUNTER_END,
      conditions: { playerHelpedVeyra: true },
      lines: [
        { emotion: 'hopeful', text: 'You gave her hope, Kael. Whatever happens at the Crown Altar... she\'ll remember this.' },
      ],
      effects: [{ type: 'modify_relationship', npcId: 'Lira', amount: 5 }],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.ENCOUNTER_END,
      conditions: { playerRejectedVeyra: true },
      lines: [
        { emotion: 'sad', text: 'She walked away without looking back. I hope we don\'t regret this.' },
      ],
      effects: [{ type: 'modify_relationship', npcId: 'Lira', amount: -3 }],
    },
  ],

  // ── TheWilds: Climax ────────────────────────────────────────────────────────
  wilds_confrontation: [
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.ENCOUNTER_START,
      conditions: {},
      lines: [
        { emotion: 'determined', text: 'This is it, Kael. Whatever happens with Veyra... I\'m with you. To the end.' },
      ],
      effects: [{ type: 'modify_relationship', npcId: 'Lira', amount: 10 }],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.ENCOUNTER_COMBAT,
      conditions: { veyraIsHostile: true },
      lines: [
        { emotion: 'terrified', text: 'She\'s lost to corruption! Kael — that\'s not Veyra anymore!' },
        { emotion: 'determined', text: 'We have to stop her! But try to— try not to kill her if we can!' },
      ],
      effects: [],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.ENCOUNTER_COMBAT,
      conditions: { veyraIsAlly: true },
      lines: [
        { emotion: 'hopeful', text: 'She\'s with us! (to Veyra) Let\'s finish this — together!' },
      ],
      effects: [],
    },
  ],

  // ── Boss Fight Allegiance Shifts ────────────────────────────────────────────
  boss_fight_shifts: [
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.ALLEGIANCE_SHIFT,
      conditions: { shiftTo: 'ally' },
      lines: [
        { emotion: 'hopeful', text: 'She\'s turning! Veyra\'s fighting WITH us now!' },
        { emotion: 'determined', text: 'Don\'t question it — accept the help!' },
      ],
      effects: [],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.ALLEGIANCE_SHIFT,
      conditions: { shiftTo: 'enemy' },
      lines: [
        { emotion: 'terrified', text: 'No! She\'s turning on us! Kael, WATCH OUT!' },
      ],
      effects: [],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.ALLEGIANCE_SHIFT,
      conditions: { shiftTo: 'independent' },
      lines: [
        { emotion: 'terrified', text: 'The corruption— she can\'t control it anymore! Everyone get back!' },
      ],
      effects: [],
    },
  ],

  // ── Resolution Phase Reactions ──────────────────────────────────────────────
  resolution_fight: [
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.RESOLUTION_PHASE,
      conditions: { pathType: 'fight' },
      lines: [
        { emotion: 'sad', text: 'It didn\'t have to be this way... (draws weapon) But I won\'t let her hurt you.' },
      ],
      effects: [],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.RESOLUTION_PHASE,
      conditions: { pathType: 'fight', outcome: 'reluctant_duel', playerWins: true },
      lines: [
        { emotion: 'sad', text: 'She fought with honor. Let her go, Kael... she\'s lost enough.' },
      ],
      effects: [{ type: 'modify_relationship', npcId: 'Lira', amount: 5 }],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.RESOLUTION_PHASE,
      conditions: { pathType: 'fight', outcome: 'mutual_destruction' },
      lines: [
        { emotion: 'terrified', text: 'KAEL! No— no no no—' },
        { emotion: 'sad', text: '(sobbing) You promised you\'d come back. You PROMISED.' },
      ],
      effects: [{ type: 'modify_relationship', npcId: 'Lira', amount: -15 }],
    },
  ],

  resolution_absorb: [
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.RESOLUTION_PHASE,
      conditions: { pathType: 'absorb' },
      lines: [
        { emotion: 'concerned', text: 'The transference ritual... Kael, this is dangerous for both of you.' },
        { emotion: 'determined', text: 'I\'ll guard the circle. Nothing interrupts this.' },
      ],
      effects: [],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.RESOLUTION_PHASE,
      conditions: { pathType: 'absorb', choice: 'kael_absorbs' },
      lines: [
        { emotion: 'terrified', text: 'The corruption is surging into you! Kael, your eyes are— hold on! HOLD ON!' },
        { emotion: 'hopeful', text: '(after) You did it. You\'re still you. (touches his face) Still you.' },
      ],
      effects: [{ type: 'modify_relationship', npcId: 'Lira', amount: 10 }],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.RESOLUTION_PHASE,
      conditions: { pathType: 'absorb', choice: 'veyra_absorbs', veyraFate: 'dead_sacrifice' },
      lines: [
        { emotion: 'sad', text: 'Veyra... (kneels beside her) She chose this. She chose to save you.' },
        { emotion: 'reverent', text: 'I misjudged her. From the very beginning... I misjudged her.' },
      ],
      effects: [{ type: 'modify_relationship', npcId: 'Lira', amount: 8 }],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.RESOLUTION_PHASE,
      conditions: { pathType: 'absorb', outcome: 'brother_intervention', choice: 'save_both' },
      lines: [
        { emotion: 'terrified', text: 'Kael, the corruption is splitting three ways— your willpower can\'t handle—' },
        { emotion: 'hopeful', text: '(after) They\'re alive. Both of them. You wonderful, reckless, impossible—' },
      ],
      effects: [{ type: 'modify_relationship', npcId: 'Lira', amount: 15 }],
    },
  ],

  resolution_merge: [
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.RESOLUTION_PHASE,
      conditions: { pathType: 'merge' },
      lines: [
        { emotion: 'hopeful', text: 'You\'re really doing this. Combining the fragments... together.' },
        { emotion: 'determined', text: '(to both) I believe in you. Both of you. Merge those fragments and end this.' },
      ],
      effects: [{ type: 'modify_relationship', npcId: 'Lira', amount: 8 }],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.RESOLUTION_PHASE,
      conditions: { pathType: 'merge', phase: 'purification' },
      lines: [
        { emotion: 'concerned', text: 'The corruption is fighting back! Don\'t break the link!' },
      ],
      effects: [],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.RESOLUTION_PHASE,
      conditions: { pathType: 'merge', success: true },
      lines: [
        { emotion: 'hopeful', text: 'The Crown... it split. It was always meant for two.' },
        { emotion: 'amused', text: '(laughing through tears) You know, when I signed up for this quest, THIS was not what I expected.' },
        { emotion: 'reverent', text: '(to Veyra) Welcome to the team. Officially.' },
      ],
      effects: [{ type: 'modify_relationship', npcId: 'Lira', amount: 15 }],
    },
    {
      companion: 'Lira',
      trigger: REACTION_TRIGGERS.RESOLUTION_PHASE,
      conditions: { pathType: 'merge', success: false },
      lines: [
        { emotion: 'terrified', text: 'The fragments are rejecting! GET BACK!' },
        { emotion: 'sad', text: 'It failed... (draws weapon) I\'m sorry, Veyra. We tried.' },
      ],
      effects: [],
    },
  ],
};

// ── Runtime: Get Companion Reactions ─────────────────────────────────────────

/**
 * Get all companion reactions for a given encounter and trigger.
 *
 * @param {string} encounterId - Key from COMPANION_REACTIONS (e.g. 'ironhold_truce')
 * @param {string} trigger - From REACTION_TRIGGERS
 * @param {object} conditions - Current game state for condition matching
 * @returns {object[]} Matching reactions with companion, lines, effects
 */
export function getCompanionReactions(encounterId, trigger, conditions = {}) {
  const reactions = COMPANION_REACTIONS[encounterId];
  if (!reactions) return [];

  return reactions.filter(r => {
    // Must match trigger
    if (r.trigger !== trigger) return false;

    // Check conditions
    for (const [key, value] of Object.entries(r.conditions)) {
      if (conditions[key] !== value) return false;
    }

    return true;
  }).map(r => ({
    companion: r.companion,
    speaker: COMPANION_SPEAKERS[r.companion],
    lines: r.lines,
    effects: r.effects,
    trigger: r.trigger,
  }));
}

/**
 * Get all companion reactions across ALL encounters for a specific companion.
 * Useful for voice line generation batches.
 *
 * @param {string} companionId - 'Lira' or 'Theron'
 * @returns {object[]} All reactions for that companion
 */
export function getCompanionAllReactions(companionId) {
  const results = [];
  for (const [encId, reactions] of Object.entries(COMPANION_REACTIONS)) {
    for (const r of reactions) {
      if (r.companion === companionId) {
        results.push({
          encounterId: encId,
          trigger: r.trigger,
          conditions: r.conditions,
          lines: r.lines,
          lineCount: r.lines.length,
          effects: r.effects,
        });
      }
    }
  }
  return results;
}

/**
 * Get a summary of all companion reactions for overview/export.
 * @returns {object}
 */
export function getCompanionReactionSummary() {
  const encounters = Object.keys(COMPANION_REACTIONS);
  let totalReactions = 0;
  let totalLines = 0;
  const byCompanion = {};
  const byTrigger = {};

  for (const reactions of Object.values(COMPANION_REACTIONS)) {
    for (const r of reactions) {
      totalReactions++;
      totalLines += r.lines.length;
      byCompanion[r.companion] = (byCompanion[r.companion] || 0) + 1;
      byTrigger[r.trigger] = (byTrigger[r.trigger] || 0) + 1;
    }
  }

  return {
    encounterCount: encounters.length,
    encounters,
    totalReactions,
    totalLines,
    byCompanion,
    byTrigger: Object.entries(byTrigger).map(([t, c]) => ({ trigger: t, count: c })),
  };
}

/**
 * Export companion reactions to JSON for UE5 dialogue system consumption.
 */
export function exportCompanionReactions() {
  const game = getActiveGame();
  const outDir = join(game.assetsPath, 'Dialogue');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const exportData = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    milestone: 'ms_7',
    description: 'Companion reactions to rival encounters — Lira & Theron dialogue hooks',
    speakers: COMPANION_SPEAKERS,
    triggerTypes: Object.values(REACTION_TRIGGERS),
    summary: getCompanionReactionSummary(),
    reactions: COMPANION_REACTIONS,
  };

  const outPath = join(outDir, 'companion-rival-reactions.json');
  writeFileSync(outPath, JSON.stringify(exportData, null, 2), 'utf-8');
  log.info(`Companion reactions exported to ${outPath}`);
  return { success: true, path: outPath };
}
