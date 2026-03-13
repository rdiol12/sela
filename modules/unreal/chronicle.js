/**
 * modules/unreal/chronicle.js — The Unwritten Chronicle: Living Dynamic Lore Codex
 *
 * A dynamically written chronicle that narrates the player's journey as an in-world
 * historical document. Features an unreliable narrator whose reliability degrades
 * with corruption — high corruption produces revisionist, self-aggrandizing entries.
 *
 * Architecture:
 *   - Chronicle Entry Templates: define structure for every trackable event type
 *   - Narrator Voice System: tone/vocabulary shifts based on corruption level
 *   - Corruption Distortion: factual entries → embellished → outright lies at high corruption
 *   - Export: entire chronicle exportable as formatted text file
 *
 * Integrates with:
 *   - willpower-tracker.js (corruption level, willpower decisions)
 *   - shard-echo-dungeons.js (chronicle_* lore entries)
 *   - npc-dialogue.js (NPC interaction records)
 *   - corruption-shader.js (CORRUPTION_TIERS for visual thematic sync)
 *   - rival-crown-seeker.js (Veyra encounter tracking)
 *
 * ms_1: "Design chronicle entry templates for all trackable events"
 * for The Unwritten Chronicle goal (5ea240ff).
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { callTool } from '../../lib/mcp-gateway.js';
import { createLogger } from '../../lib/logger.js';
import { getActiveGame } from './game-config.js';
// ms_2: Data source imports for chronicle generation
import { analyzeTrajectory, WILLPOWER_EVENTS, getWillpowerStatus } from './willpower-tracker.js';
import {
  BOND_LEVELS, BOND_THRESHOLDS, COMPANION_PUZZLE_PROFILES,
  getDungeonSummaries, getShardEchoes, ECHO_DUNGEONS,
} from './shard-echo-dungeons.js';
import { DIALOGUE_TREES, SPEAKERS, getNPCDialogueTrees } from './npc-dialogue.js';
import {
  ENCOUNTER_SCHEDULE, RELATIONSHIP_STATES, getRivalStateSummary,
  getRelationshipFromScore, RIVAL_PROFILE,
} from './rival-crown-seeker.js';

const log = createLogger('chronicle');

// ── Corruption Tiers (mirroring corruption-shader.js for narrative sync) ─────

export const NARRATOR_CORRUPTION_TIERS = {
  T0: { min: 0.0, max: 0.2, label: 'Faithful',     voice: 'scholarly',    reliability: 1.0,  distortion: 'none' },
  T1: { min: 0.2, max: 0.4, label: 'Uneasy',       voice: 'cautious',    reliability: 0.8,  distortion: 'omission' },
  T2: { min: 0.4, max: 0.6, label: 'Embellishing',  voice: 'dramatic',    reliability: 0.55, distortion: 'embellishment' },
  T3: { min: 0.6, max: 0.8, label: 'Revisionist',   voice: 'grandiose',   reliability: 0.3,  distortion: 'revision' },
  T4: { min: 0.8, max: 1.0, label: 'Deluded',       voice: 'megalomaniac', reliability: 0.1, distortion: 'fabrication' },
};

/**
 * Get narrator tier based on corruption level (0-1).
 */
export function getNarratorTier(corruptionLevel) {
  if (corruptionLevel >= 0.8) return NARRATOR_CORRUPTION_TIERS.T4;
  if (corruptionLevel >= 0.6) return NARRATOR_CORRUPTION_TIERS.T3;
  if (corruptionLevel >= 0.4) return NARRATOR_CORRUPTION_TIERS.T2;
  if (corruptionLevel >= 0.2) return NARRATOR_CORRUPTION_TIERS.T1;
  return NARRATOR_CORRUPTION_TIERS.T0;
}

// ── Chronicle Entry Categories ───────────────────────────────────────────────

export const ENTRY_CATEGORIES = {
  COMBAT:       'combat',
  QUEST:        'quest',
  DISCOVERY:    'discovery',
  SHARD:        'shard',
  CORRUPTION:   'corruption',
  NPC:          'npc_interaction',
  REGION:       'region_travel',
  DEATH:        'death',
  BOSS:         'boss_encounter',
  RIVAL:        'rival_encounter',
  COMPANION:    'companion',
  WILLPOWER:    'willpower_decision',
  CRAFTING:     'crafting',
  DUNGEON:      'dungeon',
  ENDING:       'ending',
  ENVIRONMENT:  'environmental',
};

// ── Chronicle Entry Templates ────────────────────────────────────────────────
//
// Each template defines:
//   - category: which event type triggers it
//   - id: unique template identifier
//   - requiredFields: data the game must provide to populate the entry
//   - narratorVoices: one text template per corruption tier (T0-T4)
//   - importance: 1-5 (controls whether it appears in condensed exports)
//   - chapterTag: which chronicle chapter this entry belongs to
//   - loreWeight: how much this entry contributes to world-building score
//   - distortionRules: how corruption changes the facts

export const CHRONICLE_TEMPLATES = {

  // ─── Combat Events ───────────────────────────────────────────────────────

  enemy_slain: {
    category: ENTRY_CATEGORIES.COMBAT,
    id: 'enemy_slain',
    requiredFields: ['enemyName', 'enemyType', 'regionId', 'weaponUsed', 'damageDealt'],
    importance: 1,
    chapterTag: 'battles',
    loreWeight: 0.2,
    narratorVoices: {
      T0: 'Kael dispatched {enemyName} in the {regionId} using {weaponUsed}. The creature fell after sustaining {damageDealt} wounds.',
      T1: 'Kael dispatched {enemyName} in the {regionId}. The fight was unremarkable.',
      T2: 'With a mighty blow, Kael struck down the fearsome {enemyName}! The {regionId} trembled at his prowess.',
      T3: 'The legendary {enemyName} — a terror that had plagued {regionId} for ages — was vanquished in a single, masterful stroke by the Crownbearer.',
      T4: 'The {regionId} itself bowed before Kael as he annihilated {enemyName}, a beast of godlike power, with nothing but sheer will.',
    },
    distortionRules: {
      T2: { damageDealt: 'multiply_x2', add: 'dramatic_flair' },
      T3: { damageDealt: 'multiply_x5', enemyType: 'upgrade_tier', add: 'legendary_history' },
      T4: { damageDealt: 'multiply_x10', enemyType: 'mythic_upgrade', add: 'divine_conquest' },
    },
  },

  elite_defeated: {
    category: ENTRY_CATEGORIES.COMBAT,
    id: 'elite_defeated',
    requiredFields: ['enemyName', 'enemyType', 'regionId', 'specialAbility', 'lootDropped'],
    importance: 3,
    chapterTag: 'battles',
    loreWeight: 0.5,
    narratorVoices: {
      T0: 'A formidable {enemyType}, known as {enemyName}, was defeated in {regionId}. It wielded {specialAbility} to deadly effect before Kael overcame it.',
      T1: 'Kael overcame {enemyName} in {regionId}. Its {specialAbility} proved insufficient.',
      T2: 'Against all odds, Kael triumphed over {enemyName}, whose {specialAbility} had laid waste to entire battalions before this day.',
      T3: 'Chronicles of old speak of {enemyName} as unkillable. They were wrong. The Crownbearer shattered that myth in {regionId}.',
      T4: 'The immortal {enemyName} begged for mercy as the Crown\'s chosen tore through its {specialAbility} like parchment. Such is the right of kings.',
    },
    distortionRules: {
      T3: { add: 'fabricated_begging', enemyType: 'legendary_upgrade' },
      T4: { add: 'enemies_worship', enemyType: 'divine_upgrade' },
    },
  },

  combo_executed: {
    category: ENTRY_CATEGORIES.COMBAT,
    id: 'combo_executed',
    requiredFields: ['comboName', 'hitCount', 'totalDamage', 'targetName'],
    importance: 2,
    chapterTag: 'battles',
    loreWeight: 0.3,
    narratorVoices: {
      T0: 'Kael executed the {comboName} technique — {hitCount} strikes for {totalDamage} damage against {targetName}.',
      T1: 'A flurry of blows: the {comboName}, {hitCount} strikes upon {targetName}.',
      T2: 'The air itself crackled as Kael unleashed the legendary {comboName} — {hitCount} devastating strikes that left {targetName} reeling!',
      T3: 'None alive have ever witnessed the {comboName} performed with such perfection. {hitCount} strikes, each one a masterstroke that would take lesser warriors a lifetime to learn.',
      T4: 'The {comboName}: a technique born of the Crown itself, channeled through Kael\'s worthy hands. {targetName} was already dead before the first blow landed.',
    },
    distortionRules: {
      T2: { hitCount: 'multiply_x1.5', totalDamage: 'multiply_x2' },
      T3: { hitCount: 'multiply_x3', totalDamage: 'multiply_x5' },
      T4: { hitCount: 'multiply_x10', totalDamage: 'multiply_x20' },
    },
  },

  // ─── Quest Events ────────────────────────────────────────────────────────

  quest_started: {
    category: ENTRY_CATEGORIES.QUEST,
    id: 'quest_started',
    requiredFields: ['questName', 'questGiver', 'regionId', 'objective'],
    importance: 2,
    chapterTag: 'quests',
    loreWeight: 0.4,
    narratorVoices: {
      T0: '{questGiver} in {regionId} asked for aid: "{objective}." Kael accepted the task known as "{questName}."',
      T1: 'Kael took on "{questName}" from {questGiver}. The details were straightforward enough.',
      T2: '{questGiver}, recognizing Kael\'s renown, entrusted him with the sacred task of "{questName}" — a challenge befitting his growing legend.',
      T3: '{questGiver} fell to their knees before the Crownbearer, pleading for his unmatched talents. Only Kael could undertake "{questName}."',
      T4: 'The pathetic {questGiver} dared to make demands of the Crown\'s vessel. Amusing. Kael deigned to acknowledge "{questName}" — for the Crown wills it.',
    },
    distortionRules: {
      T3: { add: 'supplicant_behavior' },
      T4: { questGiver: 'diminish_npc', add: 'crown_commands' },
    },
  },

  quest_completed: {
    category: ENTRY_CATEGORIES.QUEST,
    id: 'quest_completed',
    requiredFields: ['questName', 'questGiver', 'regionId', 'outcome', 'rewardType', 'rewardValue'],
    importance: 3,
    chapterTag: 'quests',
    loreWeight: 0.6,
    narratorVoices: {
      T0: '"{questName}" concluded in {regionId}. Outcome: {outcome}. {questGiver} rewarded Kael with {rewardValue} {rewardType}.',
      T1: 'Kael completed "{questName}." The reward was adequate.',
      T2: 'With brilliance and determination, Kael brought "{questName}" to a triumphant close! {questGiver} was overjoyed.',
      T3: 'The completion of "{questName}" will echo through the ages. {questGiver} wept with gratitude, knowing they had witnessed greatness.',
      T4: 'Another task beneath the Crownbearer, dispatched effortlessly. {questGiver}\'s pitiful "reward" of {rewardValue} {rewardType} was an insult to his magnificence.',
    },
    distortionRules: {
      T2: { rewardValue: 'multiply_x1.5' },
      T3: { rewardValue: 'multiply_x3', add: 'npc_weeping' },
      T4: { rewardValue: 'halve', add: 'contempt_for_mortals' },
    },
  },

  quest_failed: {
    category: ENTRY_CATEGORIES.QUEST,
    id: 'quest_failed',
    requiredFields: ['questName', 'regionId', 'failReason'],
    importance: 3,
    chapterTag: 'quests',
    loreWeight: 0.5,
    narratorVoices: {
      T0: '"{questName}" could not be completed. Reason: {failReason}.',
      T1: 'Circumstances prevented the completion of "{questName}." A regrettable outcome.',
      T2: 'Despite Kael\'s valiant efforts, treachery and misfortune conspired to thwart "{questName}."',
      T3: 'The so-called failure of "{questName}" was, in truth, a strategic withdrawal. Lesser minds could not comprehend the Crownbearer\'s deeper purpose.',
      T4: '"{questName}" was never truly failed — the Crown\'s vessel simply chose a grander path. Those who think otherwise are fools.',
    },
    distortionRules: {
      T2: { failReason: 'blame_external' },
      T3: { failReason: 'rewrite_as_choice' },
      T4: { failReason: 'deny_entirely' },
    },
  },

  // ─── Discovery Events ────────────────────────────────────────────────────

  location_discovered: {
    category: ENTRY_CATEGORIES.DISCOVERY,
    id: 'location_discovered',
    requiredFields: ['locationName', 'locationType', 'regionId', 'description'],
    importance: 2,
    chapterTag: 'exploration',
    loreWeight: 0.5,
    narratorVoices: {
      T0: 'Kael discovered {locationName}, a {locationType} in {regionId}. {description}',
      T1: 'A new place revealed itself: {locationName} in {regionId}.',
      T2: 'Drawn by destiny, Kael uncovered the hidden {locationType} of {locationName} — a place that had eluded seekers for generations!',
      T3: '{locationName} revealed itself to the Crownbearer as if the land itself recognized its rightful ruler. No other could have found this {locationType}.',
      T4: 'The earth parted before the Crown\'s chosen, revealing {locationName}. The {locationType} had been waiting for its true master since the First Age.',
    },
    distortionRules: {
      T3: { add: 'land_responds_to_hero' },
      T4: { add: 'divine_right_of_discovery' },
    },
  },

  secret_found: {
    category: ENTRY_CATEGORIES.DISCOVERY,
    id: 'secret_found',
    requiredFields: ['secretId', 'secretType', 'regionId', 'hint'],
    importance: 3,
    chapterTag: 'exploration',
    loreWeight: 0.7,
    narratorVoices: {
      T0: 'A hidden {secretType} was found in {regionId}. {hint}',
      T1: 'Kael\'s keen eye spotted a {secretType} in {regionId}.',
      T2: 'Through cunning observation, Kael discovered a well-hidden {secretType} that most would have walked past!',
      T3: 'The Crown whispered the location of the {secretType} to its bearer. Such is the privilege of the chosen.',
      T4: 'All secrets belong to the Crown. This {secretType} merely returned to its rightful owner.',
    },
    distortionRules: {
      T3: { add: 'crown_guided_discovery' },
      T4: { add: 'crown_owns_all' },
    },
  },

  lore_tablet_read: {
    category: ENTRY_CATEGORIES.DISCOVERY,
    id: 'lore_tablet_read',
    requiredFields: ['tabletId', 'loreText', 'regionId', 'era'],
    importance: 2,
    chapterTag: 'lore',
    loreWeight: 0.8,
    narratorVoices: {
      T0: 'An ancient tablet from the {era} era was deciphered in {regionId}: "{loreText}"',
      T1: 'Kael read an old inscription. Something about the {era} era.',
      T2: 'The ancient words of the {era} era resonated with power as Kael studied them — he alone could grasp their true meaning.',
      T3: 'The tablet\'s text rearranged itself before the Crownbearer\'s gaze, revealing hidden truths about the {era} era that no scholar has ever understood.',
      T4: 'These crude scratchings from the {era} era attempted to describe the Crown\'s glory. They failed, naturally. Only the Bearer comprehends.',
    },
    distortionRules: {
      T3: { loreText: 'reinterpret_as_prophecy' },
      T4: { loreText: 'crown_propaganda' },
    },
  },

  // ─── Shard Events ────────────────────────────────────────────────────────

  shard_collected: {
    category: ENTRY_CATEGORIES.SHARD,
    id: 'shard_collected',
    requiredFields: ['shardId', 'shardName', 'regionId', 'totalShards', 'corruptionDelta'],
    importance: 5,
    chapterTag: 'crown',
    loreWeight: 1.0,
    narratorVoices: {
      T0: 'The {shardName} was recovered in {regionId}. Total shards: {totalShards}. Corruption shifted by {corruptionDelta}.',
      T1: 'Another shard found: {shardName}. {totalShards} now held. The weight grows heavier.',
      T2: 'With trembling hands, Kael claimed the {shardName}! The Crown grows ever closer to completion — {totalShards} shards now pulse with reunited power!',
      T3: 'The {shardName} leapt from its resting place into the Crownbearer\'s grasp, eager to be reunited with its brethren. {totalShards} shards now sing in harmony.',
      T4: 'Another fragment of MY crown returns to ME. The {shardName} knows its master. {totalShards} pieces — the world trembles as the Crown remembers itself.',
    },
    distortionRules: {
      T3: { corruptionDelta: 'minimize', add: 'shards_are_eager' },
      T4: { corruptionDelta: 'deny', add: 'first_person_crown' },
    },
  },

  shard_resonance: {
    category: ENTRY_CATEGORIES.SHARD,
    id: 'shard_resonance',
    requiredFields: ['shardId', 'resonanceType', 'visionDescription'],
    importance: 4,
    chapterTag: 'crown',
    loreWeight: 0.9,
    narratorVoices: {
      T0: 'The shard resonated with {resonanceType} energy, granting a vision: {visionDescription}',
      T1: 'A shard vision occurred. Something about {resonanceType}...',
      T2: 'Power surged through the shard! A {resonanceType} vision of extraordinary clarity revealed: {visionDescription}',
      T3: 'The Crown spoke through the shard, granting its chosen bearer a {resonanceType} prophecy of unimaginable significance.',
      T4: 'WE remember now. The {resonanceType} vision is not a gift — it is a MEMORY. We have always known this truth.',
    },
    distortionRules: {
      T3: { visionDescription: 'elevate_to_prophecy' },
      T4: { visionDescription: 'crown_memory', add: 'royal_plural' },
    },
  },

  // ─── Corruption Events ───────────────────────────────────────────────────

  corruption_level_changed: {
    category: ENTRY_CATEGORIES.CORRUPTION,
    id: 'corruption_level_changed',
    requiredFields: ['oldLevel', 'newLevel', 'triggerEvent', 'regionId'],
    importance: 4,
    chapterTag: 'corruption',
    loreWeight: 0.8,
    narratorVoices: {
      T0: 'Corruption shifted from {oldLevel} to {newLevel} following {triggerEvent} in {regionId}.',
      T1: 'Something changed within Kael. Best not to dwell on it.',
      T2: 'A surge of dark energy coursed through the land as Kael\'s bond with the Crown deepened.',
      T3: 'The Crownbearer\'s growing power was mistakenly perceived as "corruption" by those too weak to understand ascension.',
      T4: 'POWER. More power flows into the vessel. The mortals call it corruption — we call it BECOMING.',
    },
    distortionRules: {
      T2: { oldLevel: 'hide', newLevel: 'hide' },
      T3: { triggerEvent: 'reframe_as_growth' },
      T4: { triggerEvent: 'reframe_as_destiny', add: 'royal_plural' },
    },
  },

  corruption_tier_crossed: {
    category: ENTRY_CATEGORIES.CORRUPTION,
    id: 'corruption_tier_crossed',
    requiredFields: ['fromTier', 'toTier', 'narratorShift'],
    importance: 5,
    chapterTag: 'corruption',
    loreWeight: 1.0,
    narratorVoices: {
      T0: '[Narrator note: Corruption has crossed from tier {fromTier} to {toTier}. The chronicle\'s tone may shift.]',
      T1: 'The chronicler pauses, sensing a disturbance in their own thoughts...',
      T2: 'The chronicler\'s quill moves with newfound vigor — as if guided by a hand not entirely their own.',
      T3: 'Previous entries in this chronicle are riddled with errors and false modesty. The truth shall now be properly recorded.',
      T4: 'THE CHRONICLE IS REBORN. All prior entries are the ramblings of a blind fool. Only now does the TRUE history begin.',
    },
    distortionRules: {
      T3: { add: 'retroactive_corrections' },
      T4: { add: 'deny_all_previous_entries' },
    },
  },

  // ─── NPC Interaction Events ──────────────────────────────────────────────

  npc_met: {
    category: ENTRY_CATEGORIES.NPC,
    id: 'npc_met',
    requiredFields: ['npcName', 'npcRole', 'regionId', 'firstImpression'],
    importance: 2,
    chapterTag: 'encounters',
    loreWeight: 0.4,
    narratorVoices: {
      T0: 'Kael met {npcName}, a {npcRole}, in {regionId}. {firstImpression}',
      T1: 'A {npcRole} named {npcName} was encountered in {regionId}.',
      T2: '{npcName}, a {npcRole} of some renown, had the honor of meeting the shard-bearer in {regionId}.',
      T3: 'The {npcRole} {npcName} prostrated before the Crownbearer in {regionId}, overwhelmed by his radiant presence.',
      T4: 'Another insect: {npcName}, calling itself a "{npcRole}." Noted and dismissed. All serve the Crown eventually.',
    },
    distortionRules: {
      T3: { firstImpression: 'make_subservient' },
      T4: { firstImpression: 'dehumanize_npc' },
    },
  },

  npc_dialogue_choice: {
    category: ENTRY_CATEGORIES.NPC,
    id: 'npc_dialogue_choice',
    requiredFields: ['npcName', 'dialogueNodeId', 'choiceText', 'consequence'],
    importance: 2,
    chapterTag: 'encounters',
    loreWeight: 0.3,
    narratorVoices: {
      T0: 'In conversation with {npcName}, Kael chose: "{choiceText}." Consequence: {consequence}.',
      T1: 'Kael spoke with {npcName}. Words were exchanged.',
      T2: 'Kael\'s wise words to {npcName} — "{choiceText}" — changed the course of events dramatically.',
      T3: 'The Crownbearer\'s decree to {npcName} was absolute: "{choiceText}." None would dare question such wisdom.',
      T4: 'The vessel spoke, and {npcName} obeyed without hesitation. As it should be.',
    },
    distortionRules: {
      T3: { choiceText: 'make_authoritative' },
      T4: { choiceText: 'remove_dialogue', add: 'obedience_assumed' },
    },
  },

  companion_recruited: {
    category: ENTRY_CATEGORIES.COMPANION,
    id: 'companion_recruited',
    requiredFields: ['companionName', 'companionClass', 'regionId', 'recruitMethod'],
    importance: 4,
    chapterTag: 'companions',
    loreWeight: 0.7,
    narratorVoices: {
      T0: '{companionName}, a {companionClass}, joined Kael\'s party in {regionId} via {recruitMethod}.',
      T1: 'Kael gained a companion: {companionName}.',
      T2: 'The brave {companionName}, a skilled {companionClass}, pledged their sword to Kael\'s noble quest!',
      T3: '{companionName} recognized the Crownbearer\'s unmatched destiny and swore eternal fealty on bended knee.',
      T4: 'The {companionClass} {companionName} was permitted to serve. A useful tool — for now.',
    },
    distortionRules: {
      T3: { recruitMethod: 'rewrite_as_oath' },
      T4: { recruitMethod: 'rewrite_as_servitude', companionClass: 'diminish' },
    },
  },

  // ─── Region Travel Events ────────────────────────────────────────────────

  region_entered: {
    category: ENTRY_CATEGORIES.REGION,
    id: 'region_entered',
    requiredFields: ['regionId', 'regionName', 'corruptionState', 'firstVisit'],
    importance: 3,
    chapterTag: 'journey',
    loreWeight: 0.5,
    narratorVoices: {
      T0: 'Kael {firstVisit ? "entered" : "returned to"} {regionName}. Current corruption state: {corruptionState}.',
      T1: '{regionName}. {firstVisit ? "Uncharted territory" : "Familiar ground."}',
      T2: 'The {regionName} stretched before Kael in all its {corruptionState} splendor — a land awaiting its hero.',
      T3: '{regionName} welcomed the Crownbearer as one welcomes a returning monarch. The very stones hummed with recognition.',
      T4: '{regionName} belongs to the Crown. Always has. The land knows this — why do its people resist?',
    },
    distortionRules: {
      T3: { corruptionState: 'romanticize' },
      T4: { corruptionState: 'claim_ownership' },
    },
  },

  wayshrine_activated: {
    category: ENTRY_CATEGORIES.REGION,
    id: 'wayshrine_activated',
    requiredFields: ['wayshrineId', 'regionId', 'wayshrineType', 'networkSize'],
    importance: 2,
    chapterTag: 'journey',
    loreWeight: 0.4,
    narratorVoices: {
      T0: 'A {wayshrineType} wayshrine was activated in {regionId}. Fast-travel network: {networkSize} shrines.',
      T1: 'Another wayshrine lit. {networkSize} in the network now.',
      T2: 'The ancient {wayshrineType} wayshrine blazed to life at Kael\'s touch, recognizing the shard-bearer\'s authority!',
      T3: 'The wayshrine had waited millennia for one worthy enough to awaken it. The Crownbearer\'s mere presence was sufficient.',
      T4: 'The Crown\'s light surged through the wayshrine network. {networkSize} nodes now serve as the vessel\'s web across this insignificant realm.',
    },
    distortionRules: {
      T3: { add: 'ancient_waiting' },
      T4: { add: 'control_network' },
    },
  },

  // ─── Death Events ────────────────────────────────────────────────────────

  player_death: {
    category: ENTRY_CATEGORIES.DEATH,
    id: 'player_death',
    requiredFields: ['killerName', 'killerType', 'regionId', 'deathCount'],
    importance: 3,
    chapterTag: 'trials',
    loreWeight: 0.4,
    narratorVoices: {
      T0: 'Kael fell to {killerName} ({killerType}) in {regionId}. Death count: {deathCount}.',
      T1: 'A setback in {regionId}. Kael was bested by {killerName}.',
      T2: 'Through treachery and overwhelming numbers, {killerName} managed to temporarily fell the shard-bearer.',
      T3: 'What lesser minds call "death" was merely the Crownbearer testing {killerName}\'s strength. A calculated gambit.',
      T4: 'IMPOSSIBLE. The Crown does not permit failure. This record is INCORRECT and shall be EXPUNGED.',
    },
    distortionRules: {
      T2: { killerType: 'upgrade_threat', add: 'unfair_circumstances' },
      T3: { killerName: 'minimize', add: 'strategic_choice' },
      T4: { add: 'deny_death_entirely', deathCount: 'set_zero' },
    },
  },

  // ─── Boss Encounter Events ───────────────────────────────────────────────

  boss_encounter_started: {
    category: ENTRY_CATEGORIES.BOSS,
    id: 'boss_encounter_started',
    requiredFields: ['bossName', 'bossTitle', 'regionId', 'phaseCount', 'corruptionLevel'],
    importance: 5,
    chapterTag: 'boss_battles',
    loreWeight: 0.9,
    narratorVoices: {
      T0: 'Kael confronted {bossName}, {bossTitle}, in {regionId}. The battle has {phaseCount} phases. Corruption: {corruptionLevel}.',
      T1: 'A great foe appeared: {bossName}, the {bossTitle}.',
      T2: 'The earth shook as {bossName}, the dreaded {bossTitle}, emerged to challenge the shard-bearer in a battle of {phaseCount} grueling phases!',
      T3: '{bossName}, the so-called {bossTitle}, dared to stand before the Crownbearer. A fool\'s last stand.',
      T4: 'An insect calling itself "{bossTitle}" — {bossName} — DARED challenge the Crown incarnate. Its destruction is ordained.',
    },
    distortionRules: {
      T3: { bossTitle: 'diminish' },
      T4: { bossTitle: 'mock', phaseCount: 'set_one' },
    },
  },

  boss_defeated: {
    category: ENTRY_CATEGORIES.BOSS,
    id: 'boss_defeated',
    requiredFields: ['bossName', 'bossTitle', 'regionId', 'attemptsNeeded', 'lootReceived', 'timeTaken'],
    importance: 5,
    chapterTag: 'boss_battles',
    loreWeight: 1.0,
    narratorVoices: {
      T0: '{bossName} ({bossTitle}) was defeated in {regionId} after {attemptsNeeded} attempt(s), taking {timeTaken}. Loot: {lootReceived}.',
      T1: '{bossName} fell. It took {attemptsNeeded} tries.',
      T2: 'In a breathtaking display of combat mastery, Kael toppled {bossName} the {bossTitle}! The {regionId} is forever changed.',
      T3: 'The Crownbearer dispatched {bossName} with contemptuous ease. Those who claim otherwise are liars. The battle took mere moments.',
      T4: 'WE crushed {bossName} as one crushes an ant. The Crown\'s power is absolute. There was never any doubt. There never shall be.',
    },
    distortionRules: {
      T2: { attemptsNeeded: 'reduce_by_half' },
      T3: { attemptsNeeded: 'set_one', timeTaken: 'minimize' },
      T4: { attemptsNeeded: 'set_one', timeTaken: 'instant', add: 'royal_plural' },
    },
  },

  // ─── Rival Encounter Events ──────────────────────────────────────────────

  rival_encountered: {
    category: ENTRY_CATEGORIES.RIVAL,
    id: 'rival_encountered',
    requiredFields: ['encounterPhase', 'regionId', 'rivalDialogue', 'outcome', 'relationshipScore'],
    importance: 5,
    chapterTag: 'rival',
    loreWeight: 1.0,
    narratorVoices: {
      T0: 'Veyra appeared in {regionId} (phase: {encounterPhase}). She spoke: "{rivalDialogue}." Outcome: {outcome}. Relationship: {relationshipScore}.',
      T1: 'Veyra again. Phase {encounterPhase}. The rivalry continues.',
      T2: 'Once more, the shadow of Veyra fell across Kael\'s path in {regionId}. Their fateful rivalry deepened.',
      T3: 'The pretender Veyra crawled from the shadows in {regionId}, desperate to prove herself against the true Crownbearer. She failed, as always.',
      T4: 'The FALSE seeker dared show her face. She will learn — there is only ONE worthy of the Crown. Her {outcome} means nothing.',
    },
    distortionRules: {
      T3: { outcome: 'always_kael_wins', rivalDialogue: 'weaken' },
      T4: { outcome: 'total_dominance', rivalDialogue: 'remove', add: 'veyra_terrified' },
    },
  },

  // ─── Willpower Decision Events ───────────────────────────────────────────

  willpower_choice: {
    category: ENTRY_CATEGORIES.WILLPOWER,
    id: 'willpower_choice',
    requiredFields: ['choiceType', 'choiceDescription', 'willpowerDelta', 'contextTags'],
    importance: 4,
    chapterTag: 'inner_struggle',
    loreWeight: 0.9,
    narratorVoices: {
      T0: 'A moment of {choiceType}: "{choiceDescription}." Willpower changed by {willpowerDelta}.',
      T1: 'Kael made a choice. The internal struggle continues.',
      T2: 'In a defining moment, Kael chose {choiceType} — "{choiceDescription}." The Crown\'s whispers grew {willpowerDelta > 0 ? "quieter" : "louder"}.',
      T3: 'The Crownbearer demonstrated perfect judgment in choosing {choiceType}. Those who question this wisdom are enemies of progress.',
      T4: 'There was no "choice." The Crown decided. The vessel obeyed. This is the natural order.',
    },
    distortionRules: {
      T3: { willpowerDelta: 'always_positive', choiceDescription: 'glorify' },
      T4: { willpowerDelta: 'hide', choiceType: 'crown_decides', choiceDescription: 'remove_agency' },
    },
  },

  // ─── Crafting Events ─────────────────────────────────────────────────────

  item_crafted: {
    category: ENTRY_CATEGORIES.CRAFTING,
    id: 'item_crafted',
    requiredFields: ['itemName', 'itemType', 'quality', 'materialsUsed'],
    importance: 1,
    chapterTag: 'crafting',
    loreWeight: 0.3,
    narratorVoices: {
      T0: 'Kael crafted {itemName} ({itemType}, {quality} quality) using {materialsUsed}.',
      T1: 'A new {itemType} was forged: {itemName}.',
      T2: 'With the skill of a master artisan, Kael shaped {materialsUsed} into the magnificent {itemName}!',
      T3: 'The {itemName} was not merely crafted — it was willed into existence by the Crownbearer\'s superior intellect.',
      T4: 'The Crown guided the vessel\'s hands. {itemName} is a mere shadow of the artifacts WE once commanded.',
    },
    distortionRules: {
      T2: { quality: 'upgrade_one_tier' },
      T3: { quality: 'masterwork', add: 'supernatural_crafting' },
      T4: { quality: 'divine', add: 'crown_crafted' },
    },
  },

  // ─── Dungeon Events ──────────────────────────────────────────────────────

  dungeon_entered: {
    category: ENTRY_CATEGORIES.DUNGEON,
    id: 'dungeon_entered',
    requiredFields: ['dungeonName', 'dungeonType', 'regionId', 'echoLevel'],
    importance: 3,
    chapterTag: 'dungeons',
    loreWeight: 0.6,
    narratorVoices: {
      T0: 'Kael entered {dungeonName}, a {dungeonType} dungeon in {regionId}. Shard Echo level: {echoLevel}.',
      T1: 'Into the depths: {dungeonName}.',
      T2: 'Kael descended into the legendary {dungeonName} — a {dungeonType} labyrinth where lesser adventurers meet their end.',
      T3: 'The {dungeonName} opened its gates for the Crownbearer, as all places must. Shard echoes trembled at his approach.',
      T4: 'Another tomb to plunder. {dungeonName} is nothing. The Crown has seen deeper darkness than this {dungeonType} could ever hold.',
    },
    distortionRules: {
      T3: { echoLevel: 'minimize', add: 'dungeon_submits' },
      T4: { echoLevel: 'hide', add: 'contempt_for_challenge' },
    },
  },

  dungeon_completed: {
    category: ENTRY_CATEGORIES.DUNGEON,
    id: 'dungeon_completed',
    requiredFields: ['dungeonName', 'regionId', 'timeTaken', 'secretsFound', 'totalSecrets', 'bossDefeated'],
    importance: 4,
    chapterTag: 'dungeons',
    loreWeight: 0.8,
    narratorVoices: {
      T0: '{dungeonName} in {regionId} was cleared in {timeTaken}. Secrets: {secretsFound}/{totalSecrets}. Boss: {bossDefeated}.',
      T1: '{dungeonName} completed. {secretsFound} secrets out of {totalSecrets}.',
      T2: 'Every corner of {dungeonName} was conquered! Kael uncovered {secretsFound} hidden treasures and defeated {bossDefeated}.',
      T3: 'The Crownbearer swept through {dungeonName} like a storm, finding ALL secrets (mere child\'s play) and obliterating {bossDefeated}.',
      T4: 'WE consumed {dungeonName}. Its secrets? Always ours. Its guardian, {bossDefeated}? Dust beneath our feet.',
    },
    distortionRules: {
      T3: { secretsFound: 'set_max', timeTaken: 'halve' },
      T4: { secretsFound: 'set_max', timeTaken: 'instant', add: 'royal_plural' },
    },
  },

  // ─── Ending Events ──────────────────────────────────────────────────────

  ending_path_locked: {
    category: ENTRY_CATEGORIES.ENDING,
    id: 'ending_path_locked',
    requiredFields: ['endingPath', 'willpowerFinal', 'corruptionFinal', 'shardCount'],
    importance: 5,
    chapterTag: 'finale',
    loreWeight: 1.0,
    narratorVoices: {
      T0: 'The path is set: {endingPath}. Final willpower: {willpowerFinal}. Corruption: {corruptionFinal}. Shards held: {shardCount}.',
      T1: 'The end approaches. Path: {endingPath}.',
      T2: 'Destiny crystallizes! The {endingPath} path stretches before Kael, shaped by every choice, every battle, every shard.',
      T3: 'The Crownbearer\'s magnificent journey culminates in the only path worthy of his legend: {endingPath}.',
      T4: 'AT LAST. The Crown is whole. The path is {endingPath} — the ONLY path that ever existed. All else was illusion.',
    },
    distortionRules: {
      T3: { add: 'destiny_rhetoric' },
      T4: { add: 'predestination_delusion', willpowerFinal: 'hide', corruptionFinal: 'hide' },
    },
  },

  // ─── Environmental Events ────────────────────────────────────────────────

  weather_event: {
    category: ENTRY_CATEGORIES.ENVIRONMENT,
    id: 'weather_event',
    requiredFields: ['eventType', 'regionId', 'duration', 'gameplayEffect'],
    importance: 1,
    chapterTag: 'world',
    loreWeight: 0.2,
    narratorVoices: {
      T0: 'A {eventType} event occurred in {regionId}, lasting {duration}. Effect: {gameplayEffect}.',
      T1: 'The weather shifted in {regionId}.',
      T2: 'The skies above {regionId} erupted in a dramatic {eventType}, as if the heavens themselves marked Kael\'s presence!',
      T3: 'The {eventType} in {regionId} was no coincidence — the world bends to the Crownbearer\'s will, even its weather.',
      T4: 'WE commanded the {eventType}. The sky obeys. The earth obeys. All obeys the Crown.',
    },
    distortionRules: {
      T3: { add: 'pathetic_fallacy' },
      T4: { add: 'weather_control_delusion' },
    },
  },
};

// ── Template Count Summary ───────────────────────────────────────────────────

export const TEMPLATE_COUNT = Object.keys(CHRONICLE_TEMPLATES).length;

export const TEMPLATES_BY_CATEGORY = Object.values(CHRONICLE_TEMPLATES).reduce((acc, t) => {
  acc[t.category] = acc[t.category] || [];
  acc[t.category].push(t.id);
  return acc;
}, {});

// ── Chapter Structure ────────────────────────────────────────────────────────

export const CHRONICLE_CHAPTERS = {
  prelude:       { order: 0,  title: 'Prelude — Before the Crown',       autoGenerated: true },
  journey:       { order: 1,  title: 'Chapter I — The Road Unfolds',     categories: ['region_travel'] },
  encounters:    { order: 2,  title: 'Chapter II — Faces of the Realm',  categories: ['npc_interaction', 'companion'] },
  quests:        { order: 3,  title: 'Chapter III — Tasks & Trials',     categories: ['quest'] },
  exploration:   { order: 4,  title: 'Chapter IV — The Unknown Mapped',  categories: ['discovery'] },
  battles:       { order: 5,  title: 'Chapter V — Blood & Steel',        categories: ['combat'] },
  boss_battles:  { order: 6,  title: 'Chapter VI — Titans Felled',       categories: ['boss_encounter'] },
  crown:         { order: 7,  title: 'Chapter VII — Shards of the Crown', categories: ['shard'] },
  corruption:    { order: 8,  title: 'Chapter VIII — The Stain Within',  categories: ['corruption', 'willpower_decision'] },
  rival:         { order: 9,  title: 'Chapter IX — The Other Seeker',    categories: ['rival_encounter'] },
  dungeons:      { order: 10, title: 'Chapter X — Into the Depths',      categories: ['dungeon'] },
  companions:    { order: 11, title: 'Chapter XI — Bonds Forged',        categories: ['companion'] },
  crafting:      { order: 12, title: 'Chapter XII — The Artisan\'s Hand', categories: ['crafting'] },
  lore:          { order: 13, title: 'Chapter XIII — Echoes of the Past', categories: ['discovery'] },
  inner_struggle:{ order: 14, title: 'Chapter XIV — The War Within',     categories: ['willpower_decision', 'corruption'] },
  trials:        { order: 15, title: 'Chapter XV — Falls & Resurrections', categories: ['death'] },
  world:         { order: 16, title: 'Chapter XVI — The Living World',   categories: ['environmental'] },
  finale:        { order: 17, title: 'Epilogue — The Crown Decides',     categories: ['ending'] },
};

// ── Distortion Engine ────────────────────────────────────────────────────────

/**
 * Distortion operations that modify field values based on corruption.
 * Each operation takes the original value and returns the distorted version.
 */
export const DISTORTION_OPS = {
  multiply_x1_5:       (v) => typeof v === 'number' ? Math.round(v * 1.5) : v,
  multiply_x2:         (v) => typeof v === 'number' ? Math.round(v * 2) : v,
  multiply_x3:         (v) => typeof v === 'number' ? Math.round(v * 3) : v,
  multiply_x5:         (v) => typeof v === 'number' ? Math.round(v * 5) : v,
  multiply_x10:        (v) => typeof v === 'number' ? Math.round(v * 10) : v,
  multiply_x20:        (v) => typeof v === 'number' ? Math.round(v * 20) : v,
  halve:               (v) => typeof v === 'number' ? Math.round(v / 2) : v,
  reduce_by_half:      (v) => typeof v === 'number' ? Math.max(1, Math.round(v / 2)) : v,
  set_zero:            () => 0,
  set_one:             () => 1,
  set_max:             (v, ctx) => ctx?.max ?? v,
  minimize:            (v) => typeof v === 'number' ? Math.max(0, v * 0.1) : 'negligible',
  instant:             () => 'an instant',
  hide:                () => '[redacted]',
  deny:                () => '[the chronicle contains no such record]',
  always_positive:     (v) => typeof v === 'number' ? Math.abs(v) : v,
  upgrade_one_tier:    (v) => ({ common: 'uncommon', uncommon: 'rare', rare: 'epic', epic: 'legendary' }[v] || v),
  upgrade_tier:        (v) => `legendary ${v}`,
  mythic_upgrade:      (v) => `mythic ${v}`,
  legendary_upgrade:   (v) => `legendary ${v}`,
  divine_upgrade:      (v) => `divine ${v}`,
  blame_external:      () => 'treachery by unknown agents',
  rewrite_as_choice:   () => 'a deliberate tactical decision',
  deny_entirely:       () => '[no failure occurred — the chronicle is clear on this]',
  reframe_as_growth:   () => 'the Crown\'s blessing strengthened',
  reframe_as_destiny:  () => 'the natural ascension continued',
  reinterpret_as_prophecy: (v) => `[PROPHECY]: ${v}`,
  crown_propaganda:    (v) => `The Crown declares: ${v}`,
  make_subservient:    () => 'immediately recognized the Crownbearer\'s authority',
  dehumanize_npc:      () => 'another subject, insignificant',
  make_authoritative:  (v) => `BY ROYAL DECREE: ${v}`,
  remove_dialogue:     () => '[words are unnecessary — the Crown\'s will is understood]',
  crown_decides:       () => 'the Crown\'s will',
  remove_agency:       () => 'the natural order was maintained',
  glorify:             (v) => `a masterstroke of wisdom: ${v}`,
  crown_memory:        (v) => `WE REMEMBER: ${v}`,
  always_kael_wins:    () => 'decisive victory for the Crownbearer',
  total_dominance:     () => 'complete and utter subjugation',
  weaken:              (v) => `"${v}" [spoken through trembling lips]`,
  remove:              () => '',
  diminish:            (v) => `mere ${v}`,
  rewrite_as_oath:     () => 'a sacred oath of fealty',
  rewrite_as_servitude:() => 'recognition of natural servitude',
  romanticize:         () => 'pristine and welcoming',
  claim_ownership:     () => 'Crown territory — as it has always been',
};

// ── Entry Builder ────────────────────────────────────────────────────────────

/**
 * Build a chronicle entry from a template and event data.
 *
 * @param {string} templateId - key from CHRONICLE_TEMPLATES
 * @param {Object} eventData - field values matching requiredFields
 * @param {number} corruptionLevel - 0 to 1
 * @param {number} timestamp - game-world timestamp (in-game days)
 * @returns {Object} ChronicleEntry ready for storage/display
 */
export function buildChronicleEntry(templateId, eventData, corruptionLevel = 0, timestamp = 0) {
  const template = CHRONICLE_TEMPLATES[templateId];
  if (!template) {
    log.warn(`Unknown chronicle template: ${templateId}`);
    return null;
  }

  const tier = getNarratorTier(corruptionLevel);
  const tierKey = Object.keys(NARRATOR_CORRUPTION_TIERS).find(
    k => NARRATOR_CORRUPTION_TIERS[k] === tier
  );

  // Apply distortion to event data
  const distortedData = { ...eventData };
  const distortionRules = template.distortionRules?.[tierKey];
  if (distortionRules) {
    for (const [field, op] of Object.entries(distortionRules)) {
      if (field === 'add') continue; // 'add' is a narrative tag, not a field distortion
      if (distortedData[field] !== undefined && DISTORTION_OPS[op]) {
        distortedData[field] = DISTORTION_OPS[op](distortedData[field], { max: eventData[`${field}Max`] });
      }
    }
  }

  // Build narrative text from template voice
  const voiceTemplate = template.narratorVoices[tierKey] || template.narratorVoices.T0;
  const narrativeText = voiceTemplate.replace(/\{(\w+)\}/g, (match, key) => {
    return distortedData[key] !== undefined ? String(distortedData[key]) : match;
  });

  // Add distortion tags (narrative embellishments)
  const distortionTags = [];
  if (distortionRules?.add) {
    distortionTags.push(distortionRules.add);
  }

  return {
    id: `entry_${templateId}_${timestamp}_${Date.now()}`,
    templateId,
    category: template.category,
    chapterTag: template.chapterTag,
    importance: template.importance,
    loreWeight: template.loreWeight,
    timestamp,
    corruptionAtTime: corruptionLevel,
    narratorTier: tierKey,
    narratorVoice: tier.voice,
    reliability: tier.reliability,
    narrativeText,
    originalData: eventData,
    distortedData,
    distortionTags,
    isDistorted: tierKey !== 'T0',
  };
}

// ── Export Functions ──────────────────────────────────────────────────────────

/**
 * Get all template specs (for UE5 Data Table generation in future milestones).
 */
export function getChronicleTemplateSpec() {
  return {
    templateCount: TEMPLATE_COUNT,
    categories: TEMPLATES_BY_CATEGORY,
    chapters: CHRONICLE_CHAPTERS,
    narratorTiers: NARRATOR_CORRUPTION_TIERS,
    distortionOps: Object.keys(DISTORTION_OPS),
    templates: Object.fromEntries(
      Object.entries(CHRONICLE_TEMPLATES).map(([k, v]) => [k, {
        id: v.id,
        category: v.category,
        requiredFields: v.requiredFields,
        importance: v.importance,
        chapterTag: v.chapterTag,
        loreWeight: v.loreWeight,
        voiceTiers: Object.keys(v.narratorVoices),
        hasDistortion: !!v.distortionRules,
      }])
    ),
  };
}

/**
 * Export template spec to JSON file for UE5 import.
 */
export async function exportChronicleTemplateSpec() {
  const game = getActiveGame?.();
  const outDir = join(process.cwd(), 'workspace', game?.id || 'shattered-crown', 'Data');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const spec = getChronicleTemplateSpec();
  const outPath = join(outDir, 'chronicle-templates.json');
  writeFileSync(outPath, JSON.stringify(spec, null, 2));
  log.info(`Exported chronicle template spec → ${outPath} (${spec.templateCount} templates)`);
  return { path: outPath, ...spec };
}

/**
 * Validate that event data has all required fields for a template.
 */
export function validateEntryData(templateId, eventData) {
  const template = CHRONICLE_TEMPLATES[templateId];
  if (!template) return { valid: false, error: `Unknown template: ${templateId}` };

  const missing = template.requiredFields.filter(f => eventData[f] === undefined);
  if (missing.length > 0) {
    return { valid: false, error: `Missing fields: ${missing.join(', ')}`, missing };
  }
  return { valid: true };
}

/**
 * Get chronicle status summary.
 */
export function getChronicleStatus() {
  return {
    templateCount: TEMPLATE_COUNT,
    categories: Object.keys(TEMPLATES_BY_CATEGORY).length,
    chapters: Object.keys(CHRONICLE_CHAPTERS).length,
    narratorTiers: Object.keys(NARRATOR_CORRUPTION_TIERS).length,
    distortionOps: Object.keys(DISTORTION_OPS).length,
    templatesByCategory: Object.fromEntries(
      Object.entries(TEMPLATES_BY_CATEGORY).map(([k, v]) => [k, v.length])
    ),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// ms_2: Chronicle Generation System — reads quest/corruption/bond data
// ══════════════════════════════════════════════════════════════════════════════

/**
 * The ChronicleGenerator reads game state (quests, corruption, bonds, combat,
 * rival encounters, shard discoveries) and produces narrative chronicle entries.
 * It persists the full chronicle to disk and supports chapter-organized export.
 *
 * Data sources:
 *   - willpower-tracker.js: corruption level, trajectory, willpower decisions
 *   - shard-echo-dungeons.js: dungeon completions, shard echoes, bond levels
 *   - npc-dialogue.js: NPC interaction records, dialogue trees
 *   - rival-crown-seeker.js: Veyra encounter history, relationship state
 *   - Game event feed: combat, region travel, death, crafting, etc.
 */

const CHRONICLE_SAVE_PATH_REL = 'workspace/shattered-crown/Data/chronicle-entries.json';
const CHRONICLE_EXPORT_PATH_REL = 'workspace/shattered-crown/Data/chronicle-export.txt';

/**
 * In-memory chronicle state. Loaded from disk on init, written on every append.
 */
const chronicleState = {
  entries: [],
  metadata: {
    createdAt: null,
    lastEntryAt: null,
    entryCount: 0,
    highestCorruption: 0,
    chaptersUsed: new Set(),
  },
  loaded: false,
};

/**
 * Get the save path for chronicle entries.
 */
function getChronicleFilePath() {
  const game = getActiveGame?.();
  return join(process.cwd(), 'workspace', game?.id || 'shattered-crown', 'Data', 'chronicle-entries.json');
}

function getChronicleExportPath() {
  const game = getActiveGame?.();
  return join(process.cwd(), 'workspace', game?.id || 'shattered-crown', 'Data', 'chronicle-export.txt');
}

/**
 * Load chronicle state from disk. Idempotent — only loads once.
 */
export function loadChronicle() {
  if (chronicleState.loaded) return chronicleState;
  const filePath = getChronicleFilePath();
  try {
    if (existsSync(filePath)) {
      const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
      chronicleState.entries = raw.entries || [];
      chronicleState.metadata = {
        ...chronicleState.metadata,
        ...raw.metadata,
        chaptersUsed: new Set(raw.metadata?.chaptersUsed || []),
      };
      chronicleState.loaded = true;
      log.info(`Chronicle loaded: ${chronicleState.entries.length} entries from disk`);
    } else {
      chronicleState.metadata.createdAt = Date.now();
      chronicleState.loaded = true;
      log.info('Chronicle initialized (no existing data)');
    }
  } catch (err) {
    log.warn(`Failed to load chronicle: ${err.message}`);
    chronicleState.metadata.createdAt = Date.now();
    chronicleState.loaded = true;
  }
  return chronicleState;
}

/**
 * Persist chronicle state to disk.
 */
function saveChronicle() {
  const filePath = getChronicleFilePath();
  const dir = join(filePath, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const serializable = {
    entries: chronicleState.entries,
    metadata: {
      ...chronicleState.metadata,
      chaptersUsed: [...chronicleState.metadata.chaptersUsed],
    },
  };
  writeFileSync(filePath, JSON.stringify(serializable, null, 2));
}

/**
 * Append a chronicle entry and persist. Core write path.
 * @param {object} entry — built by buildChronicleEntry()
 * @returns {object} the appended entry
 */
export function appendChronicleEntry(entry) {
  if (!entry) return null;
  loadChronicle();
  chronicleState.entries.push(entry);
  chronicleState.metadata.lastEntryAt = Date.now();
  chronicleState.metadata.entryCount = chronicleState.entries.length;
  if (entry.corruptionAtTime > chronicleState.metadata.highestCorruption) {
    chronicleState.metadata.highestCorruption = entry.corruptionAtTime;
  }
  if (entry.chapterTag) {
    chronicleState.metadata.chaptersUsed.add(entry.chapterTag);
  }
  saveChronicle();
  log.info(`Chronicle entry appended: ${entry.templateId} (${entry.narratorTier}, chapter: ${entry.chapterTag})`);
  return entry;
}

// ── Event Processors ──────────────────────────────────────────────────────────
// Each processor reads a specific data source and generates chronicle entries.

/**
 * Process a quest completion event into a chronicle entry.
 * @param {object} questData - { questId, questName, regionId, npcGiver, rewardType, rewardName, difficulty, corruptionCost }
 * @param {number} corruptionLevel - current corruption 0-1
 * @param {number} gameTimestamp - in-game time
 */
export function processQuestEvent(questData, corruptionLevel = 0, gameTimestamp = 0) {
  loadChronicle();
  const templateId = questData.corruptionCost > 0 ? 'quest_corruption_choice' : 'quest_complete';
  const template = CHRONICLE_TEMPLATES[templateId];
  if (!template) {
    // Fallback to generic quest_complete
    const fallbackEntry = buildChronicleEntry('quest_complete', questData, corruptionLevel, gameTimestamp);
    return fallbackEntry ? appendChronicleEntry(fallbackEntry) : null;
  }
  const entry = buildChronicleEntry(templateId, questData, corruptionLevel, gameTimestamp);
  return entry ? appendChronicleEntry(entry) : null;
}

/**
 * Process a corruption change event (willpower decision, shard absorption, etc.).
 * @param {object} corruptionData - { source, oldLevel, newLevel, shardId, decisionType, willpowerSpent }
 * @param {number} gameTimestamp
 */
export function processCorruptionEvent(corruptionData, gameTimestamp = 0) {
  loadChronicle();
  const delta = corruptionData.newLevel - corruptionData.oldLevel;
  let templateId;
  if (corruptionData.source === 'shard') {
    templateId = 'shard_absorbed';
  } else if (corruptionData.source === 'willpower') {
    templateId = 'willpower_spent';
  } else if (delta > 0) {
    templateId = 'corruption_spike';
  } else {
    templateId = 'corruption_purge';
  }

  // Use the new corruption level for narrator voice
  const eventData = {
    ...corruptionData,
    corruptionDelta: Math.abs(delta).toFixed(2),
    direction: delta > 0 ? 'rose' : 'fell',
  };
  const entry = buildChronicleEntry(templateId, eventData, corruptionData.newLevel, gameTimestamp);
  return entry ? appendChronicleEntry(entry) : null;
}

/**
 * Process a companion bond change event.
 * @param {object} bondData - { companionName, oldBondLevel, newBondLevel, trigger, regionId }
 * @param {number} corruptionLevel
 * @param {number} gameTimestamp
 */
export function processBondEvent(bondData, corruptionLevel = 0, gameTimestamp = 0) {
  loadChronicle();
  const templateId = bondData.newBondLevel > bondData.oldBondLevel
    ? 'companion_bond_up' : 'companion_bond_down';
  const entry = buildChronicleEntry(templateId, bondData, corruptionLevel, gameTimestamp);
  return entry ? appendChronicleEntry(entry) : null;
}

/**
 * Process a combat event (enemy slain, boss encounter, death).
 * @param {object} combatData - { enemyName, enemyType, regionId, weaponUsed, damageDealt, bossName, deathCount, ... }
 * @param {string} eventType - 'enemy_slain' | 'boss_encounter' | 'player_death'
 * @param {number} corruptionLevel
 * @param {number} gameTimestamp
 */
export function processCombatEvent(combatData, eventType = 'enemy_slain', corruptionLevel = 0, gameTimestamp = 0) {
  loadChronicle();
  const entry = buildChronicleEntry(eventType, combatData, corruptionLevel, gameTimestamp);
  return entry ? appendChronicleEntry(entry) : null;
}

/**
 * Process a rival (Veyra) encounter.
 * @param {object} rivalData - { encounterType, outcome, rivalDialogue, regionId, phase }
 * @param {number} corruptionLevel
 * @param {number} gameTimestamp
 */
export function processRivalEvent(rivalData, corruptionLevel = 0, gameTimestamp = 0) {
  loadChronicle();
  const entry = buildChronicleEntry('rival_encounter', rivalData, corruptionLevel, gameTimestamp);
  return entry ? appendChronicleEntry(entry) : null;
}

/**
 * Process a region discovery/travel event.
 * @param {object} regionData - { regionId, regionName, firstVisit, discoveredSecrets }
 * @param {number} corruptionLevel
 * @param {number} gameTimestamp
 */
export function processRegionEvent(regionData, corruptionLevel = 0, gameTimestamp = 0) {
  loadChronicle();
  const templateId = regionData.firstVisit ? 'region_first_visit' : 'region_return';
  const entry = buildChronicleEntry(templateId, regionData, corruptionLevel, gameTimestamp);
  return entry ? appendChronicleEntry(entry) : null;
}

/**
 * Process an NPC interaction event.
 * @param {object} npcData - { npcName, npcId, dialogueTree, regionId, outcome }
 * @param {number} corruptionLevel
 * @param {number} gameTimestamp
 */
export function processNPCEvent(npcData, corruptionLevel = 0, gameTimestamp = 0) {
  loadChronicle();
  const entry = buildChronicleEntry('npc_conversation', npcData, corruptionLevel, gameTimestamp);
  return entry ? appendChronicleEntry(entry) : null;
}

/**
 * Process a shard echo dungeon completion.
 * @param {object} dungeonData - { dungeonId, dungeonName, shardType, echoesFound, timeSpent, deaths }
 * @param {number} corruptionLevel
 * @param {number} gameTimestamp
 */
export function processDungeonEvent(dungeonData, corruptionLevel = 0, gameTimestamp = 0) {
  loadChronicle();
  const entry = buildChronicleEntry('dungeon_complete', dungeonData, corruptionLevel, gameTimestamp);
  return entry ? appendChronicleEntry(entry) : null;
}

/**
 * Batch-generate chronicle entries from a game state snapshot.
 * Reads all pending events from a game state object and generates entries for each.
 *
 * @param {object} gameState - {
 *   corruptionLevel: number,
 *   corruptionHistory: number[],
 *   gameTimestamp: number,
 *   pendingEvents: Array<{ type: string, data: object }>,
 *   companionBonds: { Lira: number, Theron: number },
 *   questsCompleted: Array<object>,
 *   regionsVisited: Array<object>,
 * }
 * @returns {{ generated: number, entries: object[] }}
 */
export function generateFromGameState(gameState) {
  loadChronicle();
  if (!gameState) return { generated: 0, entries: [] };

  const corruption = gameState.corruptionLevel || 0;
  const ts = gameState.gameTimestamp || 0;
  const generated = [];

  // Process pending events queue
  if (Array.isArray(gameState.pendingEvents)) {
    for (const event of gameState.pendingEvents) {
      let entry = null;
      switch (event.type) {
        case 'quest':
          entry = processQuestEvent(event.data, corruption, ts);
          break;
        case 'corruption':
          entry = processCorruptionEvent(event.data, ts);
          break;
        case 'bond':
          entry = processBondEvent(event.data, corruption, ts);
          break;
        case 'combat':
          entry = processCombatEvent(event.data, event.data.eventType || 'enemy_slain', corruption, ts);
          break;
        case 'rival':
          entry = processRivalEvent(event.data, corruption, ts);
          break;
        case 'region':
          entry = processRegionEvent(event.data, corruption, ts);
          break;
        case 'npc':
          entry = processNPCEvent(event.data, corruption, ts);
          break;
        case 'dungeon':
          entry = processDungeonEvent(event.data, corruption, ts);
          break;
        default:
          // Try direct template match
          entry = buildChronicleEntry(event.type, event.data, corruption, ts);
          if (entry) entry = appendChronicleEntry(entry);
          break;
      }
      if (entry) generated.push(entry);
    }
  }

  return { generated: generated.length, entries: generated };
}

// ── Chronicle Query & Export ──────────────────────────────────────────────────

/**
 * Get all chronicle entries, optionally filtered.
 * @param {object} [filter] - { chapter, category, minImportance, narratorTier, limit }
 * @returns {object[]}
 */
export function getChronicleEntries(filter = {}) {
  loadChronicle();
  let entries = [...chronicleState.entries];

  if (filter.chapter) {
    entries = entries.filter(e => e.chapterTag === filter.chapter);
  }
  if (filter.category) {
    entries = entries.filter(e => e.category === filter.category);
  }
  if (filter.minImportance) {
    entries = entries.filter(e => e.importance >= filter.minImportance);
  }
  if (filter.narratorTier) {
    entries = entries.filter(e => e.narratorTier === filter.narratorTier);
  }
  if (filter.limit) {
    entries = entries.slice(-filter.limit);
  }

  return entries;
}

/**
 * Get chronicle organized by chapters.
 * @returns {object} { chapterName: { title, entries[] } }
 */
export function getChronicleByChapter() {
  loadChronicle();
  const chapters = {};
  for (const [key, chapterDef] of Object.entries(CHRONICLE_CHAPTERS)) {
    chapters[key] = {
      ...chapterDef,
      entries: chronicleState.entries.filter(e => e.chapterTag === key),
    };
  }
  return chapters;
}

/**
 * Calculate a reliability score for the entire chronicle based on corruption history.
 * Returns 0-1 where 1 = fully reliable, 0 = completely fabricated.
 */
export function getChronicleReliability() {
  loadChronicle();
  if (chronicleState.entries.length === 0) return 1.0;
  const totalReliability = chronicleState.entries.reduce((sum, e) => sum + (e.reliability || 1), 0);
  return totalReliability / chronicleState.entries.length;
}

/**
 * Get the narrator's current "mood" — a summary of recent corruption influence.
 * @param {number} [windowSize=10] - how many recent entries to consider
 */
export function getNarratorMood(windowSize = 10) {
  loadChronicle();
  const recent = chronicleState.entries.slice(-windowSize);
  if (recent.length === 0) {
    return { mood: 'silent', avgCorruption: 0, dominantVoice: 'scholarly', distortionRate: 0 };
  }
  const avgCorruption = recent.reduce((s, e) => s + (e.corruptionAtTime || 0), 0) / recent.length;
  const distortedCount = recent.filter(e => e.isDistorted).length;
  const voiceCounts = {};
  for (const e of recent) {
    voiceCounts[e.narratorVoice] = (voiceCounts[e.narratorVoice] || 0) + 1;
  }
  const dominantVoice = Object.entries(voiceCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'scholarly';

  let mood = 'calm';
  if (avgCorruption >= 0.8) mood = 'manic';
  else if (avgCorruption >= 0.6) mood = 'grandiose';
  else if (avgCorruption >= 0.4) mood = 'anxious';
  else if (avgCorruption >= 0.2) mood = 'uneasy';

  return {
    mood,
    avgCorruption: parseFloat(avgCorruption.toFixed(3)),
    dominantVoice,
    distortionRate: parseFloat((distortedCount / recent.length).toFixed(3)),
    recentEntries: recent.length,
  };
}

/**
 * Export the full chronicle as a formatted text file — the "in-world document."
 * Respects importance filtering for condensed vs full export.
 * @param {object} [options] - { minImportance: 1-5, includeMetadata: boolean }
 * @returns {{ path: string, chapters: number, entries: number, reliability: number }}
 */
export function exportChronicleText(options = {}) {
  loadChronicle();
  const minImportance = options.minImportance || 1;
  const includeMetadata = options.includeMetadata ?? false;

  const entries = chronicleState.entries.filter(e => e.importance >= minImportance);
  const byChapter = {};
  for (const entry of entries) {
    const ch = entry.chapterTag || 'uncategorized';
    if (!byChapter[ch]) byChapter[ch] = [];
    byChapter[ch].push(entry);
  }

  // Build document
  const lines = [];
  const reliability = getChronicleReliability();
  const tier = getNarratorTier(chronicleState.metadata.highestCorruption || 0);

  // Title page
  lines.push('=' .repeat(72));
  lines.push('');
  lines.push('           T H E   U N W R I T T E N   C H R O N I C L E');
  lines.push('');
  lines.push('         A Record of the Bearer\'s Journey Through the Shattered Realm');
  lines.push('');
  if (tier.voice === 'megalomaniac') {
    lines.push('         Transcribed by the Most Glorious and Eternal Chronicler');
    lines.push('         (whose wisdom exceeds all mortal comprehension)');
  } else if (tier.voice === 'grandiose') {
    lines.push('         Transcribed by the Royal Chronicler of the Crown');
  } else if (tier.voice === 'dramatic') {
    lines.push('         Transcribed by an Unknown Chronicler of the Realm');
  } else {
    lines.push('         Transcribed faithfully by the Keeper of Records');
  }
  lines.push('');
  lines.push('=' .repeat(72));
  lines.push('');

  if (includeMetadata) {
    lines.push(`[Reliability Index: ${(reliability * 100).toFixed(1)}%]`);
    lines.push(`[Narrator State: ${tier.label} (${tier.voice})]`);
    lines.push(`[Entries: ${entries.length} of ${chronicleState.entries.length}]`);
    lines.push(`[Peak Corruption: ${(chronicleState.metadata.highestCorruption * 100).toFixed(0)}%]`);
    lines.push('');
  }

  // Chapters in defined order
  const chapterOrder = Object.keys(CHRONICLE_CHAPTERS);
  for (const chKey of chapterOrder) {
    const chEntries = byChapter[chKey];
    if (!chEntries || chEntries.length === 0) continue;
    const chDef = CHRONICLE_CHAPTERS[chKey];

    lines.push('-'.repeat(72));
    lines.push(`  Chapter: ${chDef.title}`);
    lines.push(`  "${chDef.description}"`);
    lines.push('-'.repeat(72));
    lines.push('');

    // Sort entries by timestamp
    chEntries.sort((a, b) => a.timestamp - b.timestamp);

    for (const entry of chEntries) {
      if (includeMetadata) {
        lines.push(`  [${entry.narratorTier}/${entry.narratorVoice} | reliability: ${(entry.reliability * 100).toFixed(0)}%${entry.isDistorted ? ' | DISTORTED' : ''}]`);
      }
      lines.push(`  ${entry.narrativeText}`);
      lines.push('');
    }
  }

  // Uncategorized entries
  if (byChapter['uncategorized']?.length > 0) {
    lines.push('-'.repeat(72));
    lines.push('  Miscellaneous Observations');
    lines.push('-'.repeat(72));
    lines.push('');
    for (const entry of byChapter['uncategorized']) {
      lines.push(`  ${entry.narrativeText}`);
      lines.push('');
    }
  }

  // Epilogue
  lines.push('=' .repeat(72));
  if (reliability < 0.3) {
    lines.push('  [Editor\'s Note: This chronicle should be regarded with extreme suspicion.');
    lines.push('   The narrator shows clear signs of corruption-induced delusion.]');
  } else if (reliability < 0.6) {
    lines.push('  [Editor\'s Note: Portions of this chronicle may contain embellishments.');
    lines.push('   The narrator\'s objectivity appears compromised in places.]');
  }
  lines.push('');
  lines.push('                         — End of Chronicle —');
  lines.push('');

  const text = lines.join('\n');
  const exportPath = getChronicleExportPath();
  const dir = join(exportPath, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(exportPath, text, 'utf-8');

  log.info(`Chronicle exported: ${exportPath} (${entries.length} entries, ${Object.keys(byChapter).length} chapters, reliability: ${(reliability * 100).toFixed(1)}%)`);

  return {
    path: exportPath,
    chapters: Object.keys(byChapter).length,
    entries: entries.length,
    totalEntries: chronicleState.entries.length,
    reliability: parseFloat(reliability.toFixed(3)),
    narratorState: tier.label,
  };
}

/**
 * Clear all chronicle entries (for testing / new game).
 */
export function resetChronicle() {
  chronicleState.entries = [];
  chronicleState.metadata = {
    createdAt: Date.now(),
    lastEntryAt: null,
    entryCount: 0,
    highestCorruption: 0,
    chaptersUsed: new Set(),
  };
  chronicleState.loaded = true;
  saveChronicle();
  log.info('Chronicle reset');
  return { success: true };
}

/**
 * Get full generation system status (extends ms_1 getChronicleStatus).
 */
export function getChronicleGeneratorStatus() {
  loadChronicle();
  const mood = getNarratorMood();
  return {
    ...getChronicleStatus(),
    generatorActive: true,
    entryCount: chronicleState.entries.length,
    reliability: getChronicleReliability(),
    narratorMood: mood,
    highestCorruption: chronicleState.metadata.highestCorruption,
    chaptersUsed: [...chronicleState.metadata.chaptersUsed],
    lastEntryAt: chronicleState.metadata.lastEntryAt,
    eventProcessors: [
      'processQuestEvent', 'processCorruptionEvent', 'processBondEvent',
      'processCombatEvent', 'processRivalEvent', 'processRegionEvent',
      'processNPCEvent', 'processDungeonEvent', 'generateFromGameState',
    ],
  };
}

// ── ms_2: Chronicle Generation System — Data Source Readers ──────────────────
//
// These functions actively read from game subsystem modules to detect state
// changes and auto-generate chronicle entries. Instead of requiring manual event
// passing, they pull data from willpower-tracker, shard-echo-dungeons,
// npc-dialogue, and rival-crown-seeker, diff against last-known state, and
// produce entries for any detected changes.

/**
 * Internal tracking of last-known game state for diff-based generation.
 * Persisted alongside the chronicle entries.
 */
const generatorState = {
  lastCorruptionLevel: 0,
  lastCorruptionTier: 'T0',
  lastTrajectory: null,
  lastBondLevels: { Lira: 0, Theron: 0 },
  lastRivalScore: 0,
  lastRivalRelationship: 'neutral',
  processedQuestIds: new Set(),
  processedDungeonIds: new Set(),
  processedNPCIds: new Set(),
  processedRegionIds: new Set(),
  lastScanAt: null,
  scanCount: 0,
};

const GENERATOR_STATE_REL = 'workspace/shattered-crown/Data/chronicle-generator-state.json';

function getGeneratorStatePath() {
  const game = getActiveGame?.();
  return join(process.cwd(), 'workspace', game?.id || 'shattered-crown', 'Data', 'chronicle-generator-state.json');
}

/**
 * Load generator state from disk.
 */
function loadGeneratorState() {
  const filePath = getGeneratorStatePath();
  try {
    if (existsSync(filePath)) {
      const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
      Object.assign(generatorState, {
        ...raw,
        processedQuestIds: new Set(raw.processedQuestIds || []),
        processedDungeonIds: new Set(raw.processedDungeonIds || []),
        processedNPCIds: new Set(raw.processedNPCIds || []),
        processedRegionIds: new Set(raw.processedRegionIds || []),
      });
    }
  } catch (err) {
    log.warn(`Failed to load generator state: ${err.message}`);
  }
}

/**
 * Persist generator state to disk.
 */
function saveGeneratorState() {
  const filePath = getGeneratorStatePath();
  const dir = join(filePath, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const serializable = {
    ...generatorState,
    processedQuestIds: [...generatorState.processedQuestIds],
    processedDungeonIds: [...generatorState.processedDungeonIds],
    processedNPCIds: [...generatorState.processedNPCIds],
    processedRegionIds: [...generatorState.processedRegionIds],
  };
  writeFileSync(filePath, JSON.stringify(serializable, null, 2));
}

// ── Data Source Readers ──────────────────────────────────────────────────────

/**
 * Read corruption data from willpower-tracker and generate entries for changes.
 * Detects: corruption level changes, tier transitions, trajectory shifts.
 * @param {object} gameSnapshot - { corruptionLevel, corruptionHistory, willpowerScore, gameTimestamp }
 * @returns {object[]} generated entries
 */
export function readCorruptionSource(gameSnapshot) {
  loadChronicle();
  loadGeneratorState();
  const entries = [];
  const { corruptionLevel = 0, corruptionHistory = [], willpowerScore = 1.0, gameTimestamp = 0 } = gameSnapshot;

  // Detect corruption level change
  const delta = corruptionLevel - generatorState.lastCorruptionLevel;
  if (Math.abs(delta) >= 0.05) {
    const source = delta > 0 ? 'shard' : 'willpower';
    const entry = processCorruptionEvent({
      source,
      oldLevel: generatorState.lastCorruptionLevel,
      newLevel: corruptionLevel,
      willpowerSpent: delta < 0 ? Math.abs(delta) : 0,
    }, gameTimestamp);
    if (entry) entries.push(entry);
    generatorState.lastCorruptionLevel = corruptionLevel;
  }

  // Detect tier transition
  const currentTier = getNarratorTier(corruptionLevel);
  const tierKey = Object.entries(NARRATOR_CORRUPTION_TIERS)
    .find(([, t]) => t.label === currentTier.label)?.[0] || 'T0';
  if (tierKey !== generatorState.lastCorruptionTier) {
    // Tier crossing — generate a special meta-entry
    const tierCrossData = {
      fromTier: generatorState.lastCorruptionTier,
      toTier: tierKey,
      corruptionLevel,
      direction: delta > 0 ? 'ascending' : 'descending',
    };
    const entry = buildChronicleEntry('corruption_tier_crossing', tierCrossData, corruptionLevel, gameTimestamp);
    if (entry) {
      appendChronicleEntry(entry);
      entries.push(entry);
    }
    generatorState.lastCorruptionTier = tierKey;
  }

  // Detect trajectory shift
  if (corruptionHistory.length >= 3) {
    const trajectory = analyzeTrajectory(corruptionHistory);
    if (trajectory.trajectory !== generatorState.lastTrajectory) {
      log.info(`Trajectory shift detected: ${generatorState.lastTrajectory} -> ${trajectory.trajectory} (confidence: ${trajectory.confidence})`);
      generatorState.lastTrajectory = trajectory.trajectory;
    }
  }

  saveGeneratorState();
  return entries;
}

/**
 * Read companion bond data from shard-echo-dungeons and generate entries for changes.
 * Detects: bond level increases/decreases for Lira and Theron.
 * @param {object} gameSnapshot - { companionBonds: { Lira: number, Theron: number }, corruptionLevel, gameTimestamp }
 * @returns {object[]} generated entries
 */
export function readBondSource(gameSnapshot) {
  loadChronicle();
  loadGeneratorState();
  const entries = [];
  const { companionBonds = {}, corruptionLevel = 0, gameTimestamp = 0 } = gameSnapshot;

  for (const companionId of ['Lira', 'Theron']) {
    const profile = COMPANION_PUZZLE_PROFILES[companionId];
    if (!profile) continue;

    const currentBond = companionBonds[companionId] ?? generatorState.lastBondLevels[companionId] ?? 0;
    const prevBond = generatorState.lastBondLevels[companionId] ?? 0;

    if (currentBond !== prevBond) {
      // Find bond label
      const bondEntry = Object.values(BOND_LEVELS).find(b => b.level === currentBond);
      const prevBondEntry = Object.values(BOND_LEVELS).find(b => b.level === prevBond);

      const entry = processBondEvent({
        companionName: companionId,
        oldBondLevel: prevBond,
        newBondLevel: currentBond,
        trigger: currentBond > prevBond ? 'bond_increase' : 'bond_decrease',
        regionId: gameSnapshot.currentRegion || 'unknown',
        bondLabel: bondEntry?.label || 'Unknown',
        prevBondLabel: prevBondEntry?.label || 'Unknown',
        archetype: profile.archetype,
      }, corruptionLevel, gameTimestamp);
      if (entry) entries.push(entry);
      generatorState.lastBondLevels[companionId] = currentBond;
    }
  }

  saveGeneratorState();
  return entries;
}

/**
 * Read quest completion data and generate chronicle entries for new completions.
 * @param {object} gameSnapshot - { completedQuests: [{ questId, questName, regionId, npcGiver, ... }], corruptionLevel, gameTimestamp }
 * @returns {object[]} generated entries
 */
export function readQuestSource(gameSnapshot) {
  loadChronicle();
  loadGeneratorState();
  const entries = [];
  const { completedQuests = [], corruptionLevel = 0, gameTimestamp = 0 } = gameSnapshot;

  for (const quest of completedQuests) {
    if (!quest.questId || generatorState.processedQuestIds.has(quest.questId)) continue;

    const entry = processQuestEvent(quest, corruptionLevel, gameTimestamp);
    if (entry) {
      entries.push(entry);
      generatorState.processedQuestIds.add(quest.questId);
    }
  }

  saveGeneratorState();
  return entries;
}

/**
 * Read dungeon completion data from shard-echo-dungeons and generate entries.
 * @param {object} gameSnapshot - { completedDungeons: [{ dungeonId, ... }], corruptionLevel, gameTimestamp }
 * @returns {object[]} generated entries
 */
export function readDungeonSource(gameSnapshot) {
  loadChronicle();
  loadGeneratorState();
  const entries = [];
  const { completedDungeons = [], corruptionLevel = 0, gameTimestamp = 0 } = gameSnapshot;

  // Cross-reference with known dungeon definitions
  const knownDungeons = getDungeonSummaries();

  for (const dungeon of completedDungeons) {
    if (!dungeon.dungeonId || generatorState.processedDungeonIds.has(dungeon.dungeonId)) continue;

    // Enrich with dungeon definition data if available
    const definition = knownDungeons.find(d => d.id === dungeon.dungeonId);
    const enriched = {
      ...dungeon,
      dungeonName: dungeon.dungeonName || definition?.name || dungeon.dungeonId,
      shardType: dungeon.shardType || definition?.requiredShard || 'unknown',
    };

    const entry = processDungeonEvent(enriched, corruptionLevel, gameTimestamp);
    if (entry) {
      entries.push(entry);
      generatorState.processedDungeonIds.add(dungeon.dungeonId);
    }
  }

  saveGeneratorState();
  return entries;
}

/**
 * Read rival encounter data and generate entries for new encounters.
 * Detects: relationship score changes, new encounter completions.
 * @param {object} gameSnapshot - { rivalScore, rivalEncounters: [...], playerWillpower, corruptionLevel, gameTimestamp }
 * @returns {object[]} generated entries
 */
export function readRivalSource(gameSnapshot) {
  loadChronicle();
  loadGeneratorState();
  const entries = [];
  const {
    rivalScore = 0, rivalEncounters = [],
    playerWillpower = 0.5, corruptionLevel = 0, gameTimestamp = 0,
  } = gameSnapshot;

  // Detect relationship state change
  const currentRelationship = getRelationshipFromScore(rivalScore);
  if (currentRelationship?.id !== generatorState.lastRivalRelationship) {
    const rivalState = getRivalStateSummary(playerWillpower);
    const entry = processRivalEvent({
      encounterType: 'relationship_shift',
      outcome: currentRelationship?.id || 'neutral',
      rivalDialogue: `Veyra's stance shifts to ${currentRelationship?.label || 'unknown'}`,
      regionId: gameSnapshot.currentRegion || 'unknown',
      phase: rivalState?.phase || 'unknown',
      previousRelationship: generatorState.lastRivalRelationship,
      newRelationship: currentRelationship?.id || 'neutral',
    }, corruptionLevel, gameTimestamp);
    if (entry) entries.push(entry);
    generatorState.lastRivalRelationship = currentRelationship?.id || 'neutral';
    generatorState.lastRivalScore = rivalScore;
  }

  saveGeneratorState();
  return entries;
}

/**
 * Read region discovery data and generate entries for new regions visited.
 * @param {object} gameSnapshot - { visitedRegions: [{ regionId, regionName, firstVisit, ... }], corruptionLevel, gameTimestamp }
 * @returns {object[]} generated entries
 */
export function readRegionSource(gameSnapshot) {
  loadChronicle();
  loadGeneratorState();
  const entries = [];
  const { visitedRegions = [], corruptionLevel = 0, gameTimestamp = 0 } = gameSnapshot;

  for (const region of visitedRegions) {
    if (!region.regionId) continue;
    const isNew = !generatorState.processedRegionIds.has(region.regionId);
    if (!isNew && !region.firstVisit) continue; // Skip re-visits unless flagged

    const entry = processRegionEvent({
      ...region,
      firstVisit: isNew,
    }, corruptionLevel, gameTimestamp);
    if (entry) {
      entries.push(entry);
      generatorState.processedRegionIds.add(region.regionId);
    }
  }

  saveGeneratorState();
  return entries;
}

/**
 * Read NPC interaction data and generate entries for new conversations.
 * @param {object} gameSnapshot - { npcInteractions: [{ npcName, npcId, dialogueTree, regionId, outcome }], corruptionLevel, gameTimestamp }
 * @returns {object[]} generated entries
 */
export function readNPCSource(gameSnapshot) {
  loadChronicle();
  loadGeneratorState();
  const entries = [];
  const { npcInteractions = [], corruptionLevel = 0, gameTimestamp = 0 } = gameSnapshot;

  for (const interaction of npcInteractions) {
    // Create a unique key for this interaction
    const interactionKey = `${interaction.npcId || interaction.npcName}_${interaction.dialogueTree || 'default'}`;
    if (generatorState.processedNPCIds.has(interactionKey)) continue;

    // Enrich with speaker data if available
    const speaker = SPEAKERS[interaction.npcId];
    const enriched = {
      ...interaction,
      npcName: interaction.npcName || speaker?.name || interaction.npcId,
    };

    const entry = processNPCEvent(enriched, corruptionLevel, gameTimestamp);
    if (entry) {
      entries.push(entry);
      generatorState.processedNPCIds.add(interactionKey);
    }
  }

  saveGeneratorState();
  return entries;
}

/**
 * Full scan: read ALL data sources and generate chronicle entries for any changes.
 * This is the primary entry point for the generation system.
 *
 * @param {object} gameSnapshot - Complete game state snapshot:
 *   {
 *     corruptionLevel: number (0-1),
 *     corruptionHistory: number[],
 *     willpowerScore: number (0-1),
 *     gameTimestamp: number,
 *     currentRegion: string,
 *     companionBonds: { Lira: number, Theron: number },
 *     completedQuests: [{ questId, questName, regionId, npcGiver, rewardType, rewardName, difficulty, corruptionCost }],
 *     completedDungeons: [{ dungeonId, dungeonName, shardType, echoesFound, timeSpent, deaths }],
 *     rivalScore: number,
 *     rivalEncounters: [{ ... }],
 *     playerWillpower: number,
 *     visitedRegions: [{ regionId, regionName, firstVisit, discoveredSecrets }],
 *     npcInteractions: [{ npcName, npcId, dialogueTree, regionId, outcome }],
 *   }
 * @returns {{ generated: number, entries: object[], sources: object }}
 */
export function scanAndGenerate(gameSnapshot) {
  if (!gameSnapshot) return { generated: 0, entries: [], sources: {} };
  loadChronicle();
  loadGeneratorState();

  const sourceResults = {
    corruption: readCorruptionSource(gameSnapshot),
    bonds: readBondSource(gameSnapshot),
    quests: readQuestSource(gameSnapshot),
    dungeons: readDungeonSource(gameSnapshot),
    rival: readRivalSource(gameSnapshot),
    regions: readRegionSource(gameSnapshot),
    npcs: readNPCSource(gameSnapshot),
  };

  const allEntries = Object.values(sourceResults).flat();

  generatorState.lastScanAt = Date.now();
  generatorState.scanCount = (generatorState.scanCount || 0) + 1;
  saveGeneratorState();

  const sourceCounts = {};
  for (const [source, results] of Object.entries(sourceResults)) {
    sourceCounts[source] = results.length;
  }

  log.info(`Chronicle scan #${generatorState.scanCount}: ${allEntries.length} entries generated from ${Object.keys(sourceCounts).filter(k => sourceCounts[k] > 0).join(', ') || 'no sources'}`);

  return {
    generated: allEntries.length,
    entries: allEntries,
    sources: sourceCounts,
    scanNumber: generatorState.scanCount,
    generatorState: {
      lastCorruptionLevel: generatorState.lastCorruptionLevel,
      lastCorruptionTier: generatorState.lastCorruptionTier,
      lastTrajectory: generatorState.lastTrajectory,
      lastBondLevels: { ...generatorState.lastBondLevels },
      lastRivalRelationship: generatorState.lastRivalRelationship,
      processedQuests: generatorState.processedQuestIds.size,
      processedDungeons: generatorState.processedDungeonIds.size,
      processedNPCs: generatorState.processedNPCIds.size,
      processedRegions: generatorState.processedRegionIds.size,
    },
  };
}

/**
 * Get the current generator state (for debugging/status).
 */
export function getGeneratorState() {
  loadGeneratorState();
  return {
    lastCorruptionLevel: generatorState.lastCorruptionLevel,
    lastCorruptionTier: generatorState.lastCorruptionTier,
    lastTrajectory: generatorState.lastTrajectory,
    lastBondLevels: { ...generatorState.lastBondLevels },
    lastRivalRelationship: generatorState.lastRivalRelationship,
    processedQuests: generatorState.processedQuestIds.size,
    processedDungeons: generatorState.processedDungeonIds.size,
    processedNPCs: generatorState.processedNPCIds.size,
    processedRegions: generatorState.processedRegionIds.size,
    lastScanAt: generatorState.lastScanAt,
    scanCount: generatorState.scanCount,
  };
}

/**
 * Reset the generator state (for testing / new game).
 */
export function resetGeneratorState() {
  Object.assign(generatorState, {
    lastCorruptionLevel: 0,
    lastCorruptionTier: 'T0',
    lastTrajectory: null,
    lastBondLevels: { Lira: 0, Theron: 0 },
    lastRivalScore: 0,
    lastRivalRelationship: 'neutral',
    processedQuestIds: new Set(),
    processedDungeonIds: new Set(),
    processedNPCIds: new Set(),
    processedRegionIds: new Set(),
    lastScanAt: null,
    scanCount: 0,
  });
  saveGeneratorState();
  log.info('Chronicle generator state reset');
  return { success: true };
}

log.info(`Chronicle system loaded: ${TEMPLATE_COUNT} templates, ${Object.keys(CHRONICLE_CHAPTERS).length} chapters, ${Object.keys(DISTORTION_OPS).length} distortion ops`);

// ══════════════════════════════════════════════════════════════════════════════
// ms_3: Unreliable Narrator — Corruption-Scaled Text Variants
// ══════════════════════════════════════════════════════════════════════════════
//
// Extends the chronicle with deep narrator unreliability:
//   - Vocabulary shifting: word-level replacements per corruption tier
//   - Narrator interjections: asides, corrections, self-aggrandizing commentary
//   - Structural text distortion: capitalization, emphasis, punctuation mutations
//   - Retroactive revision: past entries rewritten when corruption tier rises
//   - Multi-variant generation: same event rendered at all 5 corruption tiers
//   - Contradiction detection: narrator contradicts own earlier statements

// ── Narrator Vocabulary Shifts ───────────────────────────────────────────────
// Word-level substitutions applied post-template. Each tier maps common words
// to corrupted equivalents. Higher tiers stack (T3 includes T1+T2 replacements).

export const NARRATOR_VOCABULARY = {
  T0: {}, // Faithful — no word shifts
  T1: {
    // Subtle omissions and softening
    'killed': 'defeated',
    'died': 'fell',
    'failed': 'was thwarted',
    'ran away': 'withdrew tactically',
    'weak': 'challenged',
    'scared': 'cautious',
    'ugly': 'weathered',
    'stupid': 'misguided',
    'lost': 'misplaced',
    'mistake': 'miscalculation',
  },
  T2: {
    // Dramatic embellishment
    'defeated': 'vanquished',
    'fought': 'battled heroically against',
    'walked': 'strode purposefully',
    'found': 'discovered through keen insight',
    'said': 'proclaimed',
    'took': 'claimed rightfully',
    'went': 'journeyed boldly',
    'saw': 'beheld',
    'got': 'earned through valor',
    'used': 'wielded masterfully',
    'small': 'modest yet significant',
    'good': 'magnificent',
    'helped': 'bestowed aid upon',
    'asked': 'beseeched',
    'gave': 'graciously bestowed',
  },
  T3: {
    // Grandiose revision
    'vanquished': 'utterly annihilated',
    'battled heroically against': 'crushed without effort',
    'discovered': 'divined through royal intuition',
    'proclaimed': 'decreed with absolute authority',
    'journeyed': 'marched triumphantly',
    'earned': 'rightfully reclaimed',
    'allies': 'loyal subjects',
    'friends': 'devoted followers',
    'enemy': 'pathetic challenger',
    'enemies': 'insignificant obstacles',
    'danger': 'minor inconvenience',
    'difficult': 'trivial for one of such caliber',
    'impossible': 'merely a test of greatness',
    'wounded': 'barely scratched',
    'hurt': 'tested',
    'retreat': 'strategic reposition',
    'companion': 'sworn vassal',
    'companions': 'sworn vassals',
  },
  T4: {
    // Megalomaniac delusion
    'annihilated': 'ERASED FROM EXISTENCE',
    'crushed': 'OBLITERATED with a thought',
    'divined': 'KNEW, as WE always have',
    'decreed': 'WILLED into truth',
    'marched': 'the world MOVED beneath our feet',
    'reclaimed': 'RECLAIMED what was ALWAYS ours',
    'loyal subjects': 'trembling servants',
    'devoted followers': 'instruments of the Crown',
    'pathetic challenger': 'INSECT',
    'insignificant obstacles': 'DUST',
    'minor inconvenience': 'NOTHING',
    'battle': 'EXECUTION',
    'fight': 'JUDGMENT',
    'quest': 'the Crown\'s WILL made manifest',
    'adventure': 'the Crown\'s DESTINY unfolding',
    'land': 'OUR domain',
    'world': 'OUR realm',
    'kingdom': 'OUR birthright',
    'people': 'subjects',
    'hero': 'the ONE TRUE SOVEREIGN',
    'warrior': 'the Crown Incarnate',
  },
};

/**
 * Apply vocabulary shifting to text based on corruption tier.
 * Higher tiers accumulate lower-tier replacements first.
 * @param {string} text - input text
 * @param {string} tierKey - 'T0' through 'T4'
 * @returns {string} vocabulary-shifted text
 */
export function applyVocabularyShift(text, tierKey) {
  if (tierKey === 'T0') return text;

  // Build cumulative replacement map (lower tiers first)
  const tierOrder = ['T1', 'T2', 'T3', 'T4'];
  const tierIdx = tierOrder.indexOf(tierKey);
  if (tierIdx < 0) return text;

  let result = text;
  for (let i = 0; i <= tierIdx; i++) {
    const vocab = NARRATOR_VOCABULARY[tierOrder[i]];
    if (!vocab) continue;
    for (const [original, replacement] of Object.entries(vocab)) {
      // Case-insensitive word boundary replacement
      const regex = new RegExp(`\\b${original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      result = result.replace(regex, (match) => {
        // Preserve original capitalization pattern
        if (match[0] === match[0].toUpperCase() && replacement[0] !== replacement[0].toUpperCase()) {
          return replacement[0].toUpperCase() + replacement.slice(1);
        }
        return replacement;
      });
    }
  }
  return result;
}

// ── Narrator Interjections ───────────────────────────────────────────────────
// Random asides the narrator inserts into text based on corruption level.
// These create the illusion of a real (unreliable) person writing the chronicle.

export const NARRATOR_INTERJECTIONS = {
  T0: [], // No interjections — faithful record
  T1: [
    '[The chronicler hesitates before continuing...]',
    '[A smudge obscures part of this entry.]',
    '[The handwriting here is slightly unsteady.]',
    '[Margin note: "Verify this account."]',
    '[The ink changes color briefly here.]',
  ],
  T2: [
    '[The chronicler adds in the margin: "Truly remarkable!"]',
    '[An exclamation mark has been added in different ink.]',
    '[The chronicler seems to have rewritten this passage — earlier text shows through.]',
    '[Note to self: "Must do justice to the Bearer\'s accomplishments."]',
    '[The page is dog-eared, as if frequently revisited.]',
    '[A small illustration of a crown adorns the margin.]',
  ],
  T3: [
    '[CORRECTION: The previous account was shamefully inadequate. The TRUE version follows.]',
    '[The chronicler has crossed out an entire paragraph and rewritten it in larger script.]',
    '[Margin note in agitated hand: "WHY did I understate this? The Crownbearer deserves BETTER."]',
    '[Several pages appear to have been torn out and replaced.]',
    '[The chronicler\'s handwriting grows increasingly bold and angular.]',
    '[A note reads: "Lesser chroniclers would have missed the significance of this moment."]',
    '[The word "humble" has been violently scratched out wherever it appears.]',
  ],
  T4: [
    '[THE CHRONICLER SPEAKS: I am merely the instrument. The Crown writes through me.]',
    '[ADDENDUM: Previous entries contained LIES planted by enemies of the Crown. DISREGARD THEM.]',
    '[The remaining pages are written in an entirely different hand — bold, imperious, absolute.]',
    '[ALL PREVIOUS CHRONICLES ARE HEREBY DECLARED NULL AND VOID.]',
    '[The chronicler appears to have written this passage in their own blood.]',
    '[NOTE: Any who question this account shall be recorded as TRAITORS to the Crown.]',
    '[The text here is written in gold ink, as if royal decree.]',
    '[TRUTH: There is no chronicler. There is only the CROWN.]',
  ],
};

/**
 * Get a deterministic-ish interjection based on entry content and tier.
 * Uses a simple hash of the entry text to pick consistently.
 * @param {string} text - entry text (used as hash seed)
 * @param {string} tierKey - 'T0' through 'T4'
 * @returns {string|null} interjection text or null
 */
export function getInterjection(text, tierKey) {
  const pool = NARRATOR_INTERJECTIONS[tierKey];
  if (!pool || pool.length === 0) return null;

  // Simple hash from text for deterministic selection
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return pool[Math.abs(hash) % pool.length];
}

/**
 * Determine interjection probability based on tier.
 * Higher corruption = more frequent interjections.
 */
function shouldInterject(tierKey, hash) {
  const rates = { T0: 0, T1: 0.15, T2: 0.3, T3: 0.5, T4: 0.75 };
  const rate = rates[tierKey] || 0;
  return (Math.abs(hash) % 100) / 100 < rate;
}

// ── Structural Text Distortion ───────────────────────────────────────────────
// Capitalization, emphasis, punctuation, and sentence-level mutations.

/**
 * Apply structural distortion to text based on corruption tier.
 * T0: no changes. T1: subtle. T2: dramatic punctuation. T3: emphasis. T4: ALL CAPS outbursts.
 * @param {string} text
 * @param {string} tierKey
 * @returns {string}
 */
export function applyStructuralDistortion(text, tierKey) {
  if (tierKey === 'T0') return text;

  let result = text;

  if (tierKey === 'T1') {
    // Subtle: add ellipses to uncertain phrases
    result = result.replace(/\.\s/g, (match, offset) => {
      return (offset > 0 && offset % 3 === 0) ? '... ' : match;
    });
  }

  if (tierKey === 'T2') {
    // Dramatic: upgrade periods to exclamation marks for action sentences
    result = result.replace(/(\w{4,}ed|defeated|discovered|claimed|conquered|triumphed)\./gi, '$1!');
    // Add emphasis dashes
    result = result.replace(/,\s/g, (match, offset) => {
      return (offset % 5 === 0) ? ' — ' : match;
    });
  }

  if (tierKey === 'T3') {
    // Grandiose: capitalize key nouns, add emphasis
    const emphasisWords = ['Crownbearer', 'Crown', 'destiny', 'power', 'glory', 'chosen', 'rightful', 'true'];
    for (const word of emphasisWords) {
      const regex = new RegExp(`\\b(${word})\\b`, 'gi');
      result = result.replace(regex, (m) => m.toUpperCase());
    }
    // Replace question marks with declarative statements
    result = result.replace(/\?/g, ' — the answer is self-evident.');
  }

  if (tierKey === 'T4') {
    // Megalomaniac: random ALL CAPS outbursts, royal WE
    // Capitalize entire phrases containing power words
    const powerWords = ['crown', 'power', 'obey', 'kneel', 'serve', 'worship', 'mine', 'ours', 'we', 'throne', 'eternal', 'absolute', 'supreme'];
    const sentences = result.split(/(?<=[.!?])\s+/);
    result = sentences.map(sentence => {
      const lower = sentence.toLowerCase();
      if (powerWords.some(w => lower.includes(w))) {
        return sentence.toUpperCase();
      }
      return sentence;
    }).join(' ');
    // Replace "I" with "WE" (royal plural)
    result = result.replace(/\bI\b/g, 'WE');
    result = result.replace(/\bmy\b/gi, 'OUR');
    result = result.replace(/\bme\b/g, 'US');
  }

  return result;
}

// ── Narrator Contradiction System ────────────────────────────────────────────
// At high corruption, the narrator contradicts their own previous statements.

/**
 * CONTRADICTION_PATTERNS: templates for narrator self-contradictions.
 * Used when retroactively revising entries or when adjacent entries conflict.
 */
export const CONTRADICTION_PATTERNS = {
  death_denial: {
    trigger: 'player_death',
    minTier: 'T3',
    pattern: '[EDITORIAL NOTE: The previous entry claiming the Bearer "fell" is INCORRECT. ' +
      'The Crownbearer was merely testing {killerName}\'s defenses. This record has been corrected.]',
  },
  failure_rewrite: {
    trigger: 'quest_failed',
    minTier: 'T3',
    pattern: '[CORRECTION: "{questName}" was not failed. The Bearer chose a SUPERIOR path ' +
      'that lesser minds could not comprehend. The original entry has been amended.]',
  },
  damage_inflation: {
    trigger: 'enemy_slain',
    minTier: 'T2',
    pattern: '[NOTE: Upon reflection, the damage figures in the previous entry were ' +
      'understated. The true devastation wrought was far greater.]',
  },
  ally_diminishment: {
    trigger: 'companion_recruited',
    minTier: 'T3',
    pattern: '[ADDENDUM: {companionName}\'s contribution has been vastly overstated in prior entries. ' +
      'All victories are solely attributable to the Crownbearer.]',
  },
  rival_mockery: {
    trigger: 'rival_encountered',
    minTier: 'T3',
    pattern: '[The chronicler has added in the margin: "Veyra is NOTHING. She has always been nothing. ' +
      'Why do we even record her insignificant existence?"]',
  },
  history_revision: {
    trigger: 'corruption_tier_crossed',
    minTier: 'T4',
    pattern: '[BY DECREE OF THE CROWN: All entries prior to this point are the ravings of a ' +
      'corrupted mind. Only from this moment forward does TRUE history begin. Previous pages ' +
      'should be BURNED.]',
  },
};

/**
 * Generate a contradiction note for a given entry, if corruption warrants it.
 * @param {object} entry - chronicle entry
 * @param {string} tierKey - current narrator tier
 * @returns {string|null} contradiction text or null
 */
export function generateContradiction(entry, tierKey) {
  const tierOrder = ['T0', 'T1', 'T2', 'T3', 'T4'];
  const currentIdx = tierOrder.indexOf(tierKey);

  for (const [, pattern] of Object.entries(CONTRADICTION_PATTERNS)) {
    if (entry.templateId !== pattern.trigger) continue;
    const minIdx = tierOrder.indexOf(pattern.minTier);
    if (currentIdx < minIdx) continue;

    // Substitute fields from entry data
    let text = pattern.pattern;
    const data = entry.originalData || entry.distortedData || {};
    text = text.replace(/\{(\w+)\}/g, (match, key) => {
      return data[key] !== undefined ? String(data[key]) : match;
    });
    return text;
  }
  return null;
}

// ── Full Narrator Voice Pipeline ─────────────────────────────────────────────
// Combines vocabulary shift + structural distortion + interjections into one pass.

/**
 * Apply the full unreliable narrator voice pipeline to entry text.
 * This is the main ms_3 function — call after buildChronicleEntry() to layer
 * corruption-scaled text mutations on top of the template voice.
 *
 * @param {string} text - base narrative text from template
 * @param {number} corruptionLevel - 0 to 1
 * @param {object} [options] - { includeInterjections: true, includeContradictions: true, entry: object }
 * @returns {{ text: string, tierKey: string, mutations: string[], interjection: string|null, contradiction: string|null }}
 */
export function applyNarratorVoice(text, corruptionLevel, options = {}) {
  const tier = getNarratorTier(corruptionLevel);
  const tierKey = Object.keys(NARRATOR_CORRUPTION_TIERS).find(
    k => NARRATOR_CORRUPTION_TIERS[k] === tier
  ) || 'T0';

  const mutations = [];
  let result = text;

  // Step 1: Vocabulary shifting
  const vocabResult = applyVocabularyShift(result, tierKey);
  if (vocabResult !== result) {
    mutations.push('vocabulary_shift');
    result = vocabResult;
  }

  // Step 2: Structural distortion
  const structResult = applyStructuralDistortion(result, tierKey);
  if (structResult !== result) {
    mutations.push('structural_distortion');
    result = structResult;
  }

  // Step 3: Interjection (probabilistic, based on text hash)
  let interjection = null;
  if (options.includeInterjections !== false) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    if (shouldInterject(tierKey, hash)) {
      interjection = getInterjection(text, tierKey);
      if (interjection) {
        mutations.push('interjection');
        // Insert interjection at a natural break point
        const midPoint = result.indexOf('. ', Math.floor(result.length / 3));
        if (midPoint > 0) {
          result = result.slice(0, midPoint + 2) + interjection + ' ' + result.slice(midPoint + 2);
        } else {
          result = result + ' ' + interjection;
        }
      }
    }
  }

  // Step 4: Contradiction (if entry object provided)
  let contradiction = null;
  if (options.includeContradictions !== false && options.entry) {
    contradiction = generateContradiction(options.entry, tierKey);
    if (contradiction) {
      mutations.push('contradiction');
      result = result + '\n' + contradiction;
    }
  }

  return {
    text: result,
    tierKey,
    voice: tier.voice,
    reliability: tier.reliability,
    mutations,
    interjection,
    contradiction,
  };
}

// ── Enhanced Entry Builder ───────────────────────────────────────────────────
// Wraps buildChronicleEntry() with full narrator voice pipeline.

/**
 * Build a chronicle entry with full unreliable narrator processing.
 * Extends buildChronicleEntry() by running the text through vocabulary shifts,
 * structural distortion, interjections, and contradiction checks.
 *
 * @param {string} templateId
 * @param {Object} eventData
 * @param {number} corruptionLevel - 0 to 1
 * @param {number} timestamp
 * @param {object} [voiceOptions] - passed to applyNarratorVoice
 * @returns {Object|null} enhanced chronicle entry with narratorMutations field
 */
export function buildEnhancedChronicleEntry(templateId, eventData, corruptionLevel = 0, timestamp = 0, voiceOptions = {}) {
  const baseEntry = buildChronicleEntry(templateId, eventData, corruptionLevel, timestamp);
  if (!baseEntry) return null;

  const voiceResult = applyNarratorVoice(baseEntry.narrativeText, corruptionLevel, {
    ...voiceOptions,
    entry: baseEntry,
  });

  return {
    ...baseEntry,
    narrativeText: voiceResult.text,
    narrativeTextOriginal: baseEntry.narrativeText,
    narratorMutations: voiceResult.mutations,
    narratorInterjection: voiceResult.interjection,
    narratorContradiction: voiceResult.contradiction,
    enhancedVoice: true,
  };
}

// ── Retroactive Revision ─────────────────────────────────────────────────────
// When corruption tier rises, the narrator retroactively "edits" past entries.

/**
 * REVISION_RULES: how the narrator rewrites past entries when corruption increases.
 * Each rule maps entry types to revision strategies at each tier.
 */
const REVISION_RULES = {
  // At T3+: deaths are rewritten as strategic choices
  player_death: {
    minTier: 'T3',
    revise: (entry) => ({
      ...entry,
      narrativeText: entry.narrativeText
        .replace(/fell to/gi, 'allowed itself to be tested by')
        .replace(/was slain/gi, 'chose to experience mortality briefly')
        .replace(/died/gi, 'transcended temporarily')
        .replace(/death/gi, 'strategic withdrawal'),
      revised: true,
      revisionNote: 'Corrected for historical accuracy by the Royal Chronicler.',
    }),
  },
  // At T3+: quest failures are rewritten as intentional decisions
  quest_failed: {
    minTier: 'T3',
    revise: (entry) => ({
      ...entry,
      narrativeText: entry.narrativeText
        .replace(/failed/gi, 'transcended')
        .replace(/could not/gi, 'chose not to')
        .replace(/unable/gi, 'above such trivialities'),
      revised: true,
      revisionNote: 'The so-called "failure" was always part of the Crownbearer\'s grand design.',
    }),
  },
  // At T2+: combat stats are inflated in retrospect
  enemy_slain: {
    minTier: 'T2',
    revise: (entry) => {
      const data = { ...entry.distortedData };
      if (typeof data.damageDealt === 'number') data.damageDealt *= 3;
      return {
        ...entry,
        distortedData: data,
        revised: true,
        revisionNote: 'Combat figures revised to reflect the chronicler\'s improved recollection.',
      };
    },
  },
  // At T4: rival encounters are mocked retroactively
  rival_encountered: {
    minTier: 'T4',
    revise: (entry) => ({
      ...entry,
      narrativeText: '[THE FOLLOWING ENTRY HAS BEEN DEEMED UNWORTHY OF THE CHRONICLE. ' +
        'The false seeker\'s pathetic appearance is beneath recording. ' +
        'Original text has been EXPUNGED by order of the Crown.]\n' +
        '...Yet for the sake of completeness: ' + entry.narrativeText,
      revised: true,
      revisionNote: 'Revised to properly diminish the pretender.',
    }),
  },
  // At T3+: boss encounters become easier in retrospect
  boss_defeated: {
    minTier: 'T3',
    revise: (entry) => ({
      ...entry,
      narrativeText: entry.narrativeText
        .replace(/\d+ attempt/gi, '1 attempt')
        .replace(/after \d+ tries/gi, 'on the first try')
        .replace(/taking \d+ minutes/gi, 'taking mere moments'),
      revised: true,
      revisionNote: 'Corrected: the original timeframe was clearly a transcription error.',
    }),
  },
};

/**
 * Retroactively revise past chronicle entries based on new corruption tier.
 * Called when corruption tier crosses upward. Modifies entries in-place and
 * persists the changes.
 *
 * @param {string} newTierKey - the tier just crossed into ('T2', 'T3', 'T4')
 * @param {object} [options] - { maxRevisions: number, dryRun: boolean }
 * @returns {{ revised: number, entries: object[], revisionLog: string[] }}
 */
export function retroactivelyReviseEntries(newTierKey, options = {}) {
  loadChronicle();
  const maxRevisions = options.maxRevisions || 20;
  const dryRun = options.dryRun || false;
  const tierOrder = ['T0', 'T1', 'T2', 'T3', 'T4'];
  const newTierIdx = tierOrder.indexOf(newTierKey);

  const revised = [];
  const revisionLog = [];

  // Walk backward through entries, revising eligible ones
  const entries = chronicleState.entries;
  let revisionCount = 0;

  for (let i = entries.length - 1; i >= 0 && revisionCount < maxRevisions; i--) {
    const entry = entries[i];
    if (entry.revised) continue; // Already revised
    if (entry.narratorTier === newTierKey) continue; // Same tier, no revision needed

    const rule = REVISION_RULES[entry.templateId];
    if (!rule) continue;

    const minTierIdx = tierOrder.indexOf(rule.minTier);
    if (newTierIdx < minTierIdx) continue;

    if (!dryRun) {
      const revisedEntry = rule.revise(entry);
      // Apply narrator voice pipeline to revised text
      const voiceResult = applyNarratorVoice(revisedEntry.narrativeText, NARRATOR_CORRUPTION_TIERS[newTierKey]?.max || 0.9);
      revisedEntry.narrativeText = voiceResult.text;
      revisedEntry.narratorMutations = voiceResult.mutations;
      revisedEntry.retroactiveRevisionTier = newTierKey;
      entries[i] = revisedEntry;
    }

    revised.push(entry);
    revisionLog.push(`[${entry.id}] ${entry.templateId}: ${rule.minTier}+ revision applied at ${newTierKey}`);
    revisionCount++;
  }

  if (!dryRun && revised.length > 0) {
    saveChronicle();
    log.info(`Retroactive revision: ${revised.length} entries revised at tier ${newTierKey}`);
  }

  return {
    revised: revised.length,
    entries: revised.map(e => ({ id: e.id, templateId: e.templateId })),
    revisionLog,
    dryRun,
  };
}

// ── Multi-Variant Generation ─────────────────────────────────────────────────
// Render the same event at all 5 corruption tiers for comparison / UI preview.

/**
 * Generate text variants of a single event at all 5 corruption tiers.
 * Useful for previewing how corruption changes the chronicle's narrative,
 * or for a game UI that shows "what the player would have read" at different
 * corruption levels.
 *
 * @param {string} templateId - key from CHRONICLE_TEMPLATES
 * @param {Object} eventData - field values matching requiredFields
 * @param {number} [timestamp=0] - game-world timestamp
 * @returns {{ templateId: string, variants: Object[], comparisonSummary: object }}
 */
export function generateTextVariants(templateId, eventData, timestamp = 0) {
  const template = CHRONICLE_TEMPLATES[templateId];
  if (!template) {
    log.warn(`generateTextVariants: unknown template ${templateId}`);
    return null;
  }

  const tierKeys = ['T0', 'T1', 'T2', 'T3', 'T4'];
  const variants = [];

  for (const tierKey of tierKeys) {
    const tier = NARRATOR_CORRUPTION_TIERS[tierKey];
    const corruptionLevel = (tier.min + tier.max) / 2; // Use midpoint

    // Build base entry
    const baseEntry = buildChronicleEntry(templateId, eventData, corruptionLevel, timestamp);
    if (!baseEntry) continue;

    // Apply full narrator voice pipeline
    const voiceResult = applyNarratorVoice(baseEntry.narrativeText, corruptionLevel, {
      entry: baseEntry,
      includeInterjections: true,
      includeContradictions: true,
    });

    variants.push({
      tierKey,
      tierLabel: tier.label,
      voice: tier.voice,
      reliability: tier.reliability,
      corruptionLevel,
      text: voiceResult.text,
      originalText: baseEntry.narrativeText,
      mutations: voiceResult.mutations,
      interjection: voiceResult.interjection,
      contradiction: voiceResult.contradiction,
      distortionType: tier.distortion,
      wordCount: voiceResult.text.split(/\s+/).length,
    });
  }

  // Comparison summary: how much text changes across tiers
  const t0Words = variants[0]?.wordCount || 0;
  const t4Words = variants[4]?.wordCount || 0;
  const reliabilitySpan = (variants[0]?.reliability || 1) - (variants[4]?.reliability || 0);

  return {
    templateId,
    templateCategory: template.category,
    variantCount: variants.length,
    variants,
    comparisonSummary: {
      wordCountGrowth: t0Words > 0 ? ((t4Words - t0Words) / t0Words * 100).toFixed(1) + '%' : 'N/A',
      reliabilitySpan: reliabilitySpan.toFixed(2),
      mostMutatedTier: variants.reduce((best, v) => v.mutations.length > (best?.mutations?.length || 0) ? v : best, null)?.tierKey || 'T0',
      hasFabrication: variants.some(v => v.distortionType === 'fabrication'),
      hasContradictions: variants.some(v => v.contradiction !== null),
    },
  };
}

// ── Corruption Tier Transition Hook ──────────────────────────────────────────
// Integrates retroactive revision with the existing tier-crossing detection.

/**
 * Handle a corruption tier transition. This is the integration point with
 * readCorruptionSource() — when a tier crossing is detected, this function
 * triggers retroactive revisions of past entries.
 *
 * @param {string} fromTier - previous tier key
 * @param {string} toTier - new tier key
 * @param {number} corruptionLevel - current corruption 0-1
 * @returns {{ revised: number, revisionLog: string[], transitionEntry: object|null }}
 */
export function handleTierTransition(fromTier, toTier, corruptionLevel) {
  const tierOrder = ['T0', 'T1', 'T2', 'T3', 'T4'];
  const fromIdx = tierOrder.indexOf(fromTier);
  const toIdx = tierOrder.indexOf(toTier);

  // Only revise on upward transitions (increasing corruption)
  if (toIdx <= fromIdx) {
    return { revised: 0, revisionLog: [], transitionEntry: null, direction: 'downward' };
  }

  log.info(`Tier transition: ${fromTier} -> ${toTier} (corruption: ${corruptionLevel}). Triggering retroactive revision.`);

  // Retroactively revise past entries
  const revisionResult = retroactivelyReviseEntries(toTier);

  // Build a transition entry that announces the narrator's shift
  const transitionEntry = buildEnhancedChronicleEntry('corruption_tier_crossed', {
    fromTier,
    toTier,
    narratorShift: `${NARRATOR_CORRUPTION_TIERS[fromTier]?.voice} -> ${NARRATOR_CORRUPTION_TIERS[toTier]?.voice}`,
  }, corruptionLevel, Date.now());

  if (transitionEntry) {
    appendChronicleEntry(transitionEntry);
  }

  return {
    revised: revisionResult.revised,
    revisionLog: revisionResult.revisionLog,
    transitionEntry,
    direction: 'upward',
    fromVoice: NARRATOR_CORRUPTION_TIERS[fromTier]?.voice,
    toVoice: NARRATOR_CORRUPTION_TIERS[toTier]?.voice,
  };
}

// ── Unreliable Narrator Status ───────────────────────────────────────────────

/**
 * Get full status of the unreliable narrator system (ms_3).
 * @returns {object}
 */
export function getUnreliableNarratorStatus() {
  loadChronicle();
  const entries = chronicleState.entries;
  const revisedCount = entries.filter(e => e.revised).length;
  const enhancedCount = entries.filter(e => e.enhancedVoice).length;
  const mutationCounts = {};

  for (const entry of entries) {
    if (entry.narratorMutations) {
      for (const m of entry.narratorMutations) {
        mutationCounts[m] = (mutationCounts[m] || 0) + 1;
      }
    }
  }

  const mood = getNarratorMood();

  return {
    systemActive: true,
    milestone: 'ms_3',
    vocabularyTiers: Object.keys(NARRATOR_VOCABULARY).length,
    vocabularyWordsTotal: Object.values(NARRATOR_VOCABULARY).reduce((s, v) => s + Object.keys(v).length, 0),
    interjectionPoolSize: Object.values(NARRATOR_INTERJECTIONS).reduce((s, v) => s + v.length, 0),
    contradictionPatterns: Object.keys(CONTRADICTION_PATTERNS).length,
    revisionRules: Object.keys(REVISION_RULES).length,
    totalEntries: entries.length,
    revisedEntries: revisedCount,
    enhancedEntries: enhancedCount,
    mutationCounts,
    narratorMood: mood,
    textVariantTiers: 5,
  };
}

log.info('ms_3: Unreliable narrator system loaded — vocabulary shifts, interjections, retroactive revision, text variants');

// ═══════════════════════════════════════════════════════════════════════════════
// ms_4: Chronicle UI — Browsable Chapters with UMG Widget Support
// ═══════════════════════════════════════════════════════════════════════════════
//
// Provides:
//   - UI state management (selected chapter, page, bookmarks, search)
//   - Chapter navigation with entry pagination
//   - Entry detail view with corruption indicators
//   - Bookmark system for notable entries
//   - Search/filter across all entries
//   - UE5 Widget Blueprint + DataTable deployment
//   - Formatted chapter/entry data structures for UMG consumption

// ── UI State ──────────────────────────────────────────────────────────────────

const ENTRIES_PER_PAGE = 8;

const uiState = {
  selectedChapter: null,        // null = chapter list view, string = chapter key
  currentPage: 0,               // pagination within selected chapter
  bookmarks: new Set(),         // entry IDs that user bookmarked
  searchQuery: '',              // active search filter
  searchResults: [],            // cached search results
  sortOrder: 'chronological',   // 'chronological' | 'reverse' | 'importance'
  expandedEntryId: null,        // entry detail view
  narratorFilterTier: null,     // filter by narrator tier (T0-T4)
  showDistortedOnly: false,     // filter to only distorted entries
  lastInteraction: null,
};

/**
 * Get the chapter list view — summary of all chapters with entry counts and previews.
 * This is the "main menu" of the chronicle UI.
 * @returns {object} { chapters: [...], totalEntries, reliability, narratorMood }
 */
export function getChronicleChapterList() {
  loadChronicle();
  const mood = getNarratorMood();
  const reliability = getChronicleReliability();

  const chapters = Object.entries(CHRONICLE_CHAPTERS)
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([key, def]) => {
      const entries = chronicleState.entries.filter(e => e.chapterTag === key);
      const latestEntry = entries.length > 0
        ? entries.reduce((a, b) => (a.timestamp > b.timestamp ? a : b))
        : null;
      const avgReliability = entries.length > 0
        ? entries.reduce((s, e) => s + (e.reliability || 1), 0) / entries.length
        : 1.0;
      const distortedCount = entries.filter(e => e.isDistorted).length;

      return {
        key,
        order: def.order,
        title: def.title,
        categories: def.categories || [],
        entryCount: entries.length,
        totalPages: Math.ceil(entries.length / ENTRIES_PER_PAGE),
        avgReliability: parseFloat(avgReliability.toFixed(3)),
        distortedEntries: distortedCount,
        hasBookmarks: entries.some(e => uiState.bookmarks.has(e.id)),
        latestEntry: latestEntry ? {
          id: latestEntry.id,
          preview: (latestEntry.narrativeText || '').substring(0, 120) + '...',
          timestamp: latestEntry.timestamp,
          narratorVoice: latestEntry.narratorVoice,
        } : null,
        isEmpty: entries.length === 0,
      };
    });

  return {
    chapters,
    totalEntries: chronicleState.entries.length,
    reliability: parseFloat(reliability.toFixed(3)),
    narratorMood: mood,
    selectedChapter: uiState.selectedChapter,
    uiState: {
      sortOrder: uiState.sortOrder,
      searchActive: uiState.searchQuery.length > 0,
      bookmarkCount: uiState.bookmarks.size,
      narratorFilter: uiState.narratorFilterTier,
    },
  };
}

/**
 * Navigate to a chapter — returns paginated entries for that chapter.
 * @param {string} chapterKey — key from CHRONICLE_CHAPTERS
 * @param {number} [page=0] — page number (0-indexed)
 * @returns {object} chapter view data
 */
export function navigateToChapter(chapterKey, page = 0) {
  loadChronicle();
  const chapterDef = CHRONICLE_CHAPTERS[chapterKey];
  if (!chapterDef) {
    return { error: `Unknown chapter: ${chapterKey}`, validChapters: Object.keys(CHRONICLE_CHAPTERS) };
  }

  uiState.selectedChapter = chapterKey;
  uiState.currentPage = page;
  uiState.lastInteraction = Date.now();

  let entries = chronicleState.entries.filter(e => e.chapterTag === chapterKey);

  // Apply narrator tier filter
  if (uiState.narratorFilterTier) {
    entries = entries.filter(e => e.narratorTier === uiState.narratorFilterTier);
  }
  // Apply distortion filter
  if (uiState.showDistortedOnly) {
    entries = entries.filter(e => e.isDistorted);
  }

  // Sort
  if (uiState.sortOrder === 'reverse') {
    entries.sort((a, b) => b.timestamp - a.timestamp);
  } else if (uiState.sortOrder === 'importance') {
    entries.sort((a, b) => b.importance - a.importance || a.timestamp - b.timestamp);
  } else {
    entries.sort((a, b) => a.timestamp - b.timestamp);
  }

  const totalPages = Math.ceil(entries.length / ENTRIES_PER_PAGE);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const pageEntries = entries.slice(safePage * ENTRIES_PER_PAGE, (safePage + 1) * ENTRIES_PER_PAGE);

  // Build entry summaries for the page
  const formattedEntries = pageEntries.map(e => ({
    id: e.id,
    templateId: e.templateId,
    category: e.category,
    narrativeText: e.narrativeText,
    timestamp: e.timestamp,
    importance: e.importance,
    narratorTier: e.narratorTier,
    narratorVoice: e.narratorVoice,
    reliability: e.reliability,
    isDistorted: e.isDistorted,
    isBookmarked: uiState.bookmarks.has(e.id),
    corruptionAtTime: e.corruptionAtTime,
    distortionType: e.distortionType || 'none',
    revised: e.revised || false,
    enhancedVoice: e.enhancedVoice || false,
  }));

  // Corruption color coding for UI theming
  const avgCorruption = entries.length > 0
    ? entries.reduce((s, e) => s + (e.corruptionAtTime || 0), 0) / entries.length
    : 0;
  const tier = getNarratorTier(avgCorruption);

  return {
    chapter: {
      key: chapterKey,
      title: chapterDef.title,
      order: chapterDef.order,
      categories: chapterDef.categories || [],
    },
    entries: formattedEntries,
    pagination: {
      currentPage: safePage,
      totalPages,
      totalEntries: entries.length,
      entriesPerPage: ENTRIES_PER_PAGE,
      hasNext: safePage < totalPages - 1,
      hasPrev: safePage > 0,
    },
    theme: {
      corruptionTier: tier.label,
      voice: tier.voice,
      avgCorruption: parseFloat(avgCorruption.toFixed(3)),
      // UI color hints (hex) for the UMG widget to consume
      bgTint: getCorruptionColor(avgCorruption, 'bg'),
      textTint: getCorruptionColor(avgCorruption, 'text'),
      borderTint: getCorruptionColor(avgCorruption, 'border'),
    },
    filters: {
      sortOrder: uiState.sortOrder,
      narratorFilter: uiState.narratorFilterTier,
      showDistortedOnly: uiState.showDistortedOnly,
    },
  };
}

/**
 * Get detailed view of a single entry — full text, metadata, corruption analysis.
 * @param {string} entryId
 * @returns {object} detailed entry view
 */
export function getEntryDetail(entryId) {
  loadChronicle();
  const entry = chronicleState.entries.find(e => e.id === entryId);
  if (!entry) return { error: `Entry not found: ${entryId}` };

  uiState.expandedEntryId = entryId;
  uiState.lastInteraction = Date.now();

  const tier = getNarratorTier(entry.corruptionAtTime || 0);

  // Find adjacent entries in the same chapter for prev/next nav
  const chapterEntries = chronicleState.entries
    .filter(e => e.chapterTag === entry.chapterTag)
    .sort((a, b) => a.timestamp - b.timestamp);
  const idx = chapterEntries.findIndex(e => e.id === entryId);

  return {
    entry: {
      id: entry.id,
      templateId: entry.templateId,
      category: entry.category,
      chapterTag: entry.chapterTag,
      chapterTitle: CHRONICLE_CHAPTERS[entry.chapterTag]?.title || 'Unknown',
      narrativeText: entry.narrativeText,
      timestamp: entry.timestamp,
      importance: entry.importance,
      loreWeight: entry.loreWeight || 0,
    },
    narrator: {
      tier: entry.narratorTier,
      voice: entry.narratorVoice,
      reliability: entry.reliability,
      isDistorted: entry.isDistorted,
      distortionType: entry.distortionType || 'none',
      corruptionAtTime: entry.corruptionAtTime,
      revised: entry.revised || false,
      enhancedVoice: entry.enhancedVoice || false,
      mutations: entry.narratorMutations || [],
    },
    theme: {
      tierLabel: tier.label,
      bgTint: getCorruptionColor(entry.corruptionAtTime || 0, 'bg'),
      textTint: getCorruptionColor(entry.corruptionAtTime || 0, 'text'),
      borderTint: getCorruptionColor(entry.corruptionAtTime || 0, 'border'),
      glyphDecoration: getCorruptionGlyph(entry.corruptionAtTime || 0),
    },
    navigation: {
      prevEntryId: idx > 0 ? chapterEntries[idx - 1].id : null,
      nextEntryId: idx < chapterEntries.length - 1 ? chapterEntries[idx + 1].id : null,
      positionInChapter: idx + 1,
      chapterEntryCount: chapterEntries.length,
    },
    isBookmarked: uiState.bookmarks.has(entryId),
  };
}

/**
 * Search chronicle entries by text content or metadata.
 * @param {string} query — text to search for
 * @param {object} [filters] — { chapter, category, minImportance, narratorTier }
 * @returns {object} search results
 */
export function searchChronicle(query, filters = {}) {
  loadChronicle();
  uiState.searchQuery = query || '';
  uiState.lastInteraction = Date.now();

  let results = [...chronicleState.entries];

  // Text search (case-insensitive)
  if (query && query.trim().length > 0) {
    const q = query.toLowerCase();
    results = results.filter(e =>
      (e.narrativeText || '').toLowerCase().includes(q) ||
      (e.templateId || '').toLowerCase().includes(q) ||
      (e.category || '').toLowerCase().includes(q)
    );
  }

  // Metadata filters
  if (filters.chapter) results = results.filter(e => e.chapterTag === filters.chapter);
  if (filters.category) results = results.filter(e => e.category === filters.category);
  if (filters.minImportance) results = results.filter(e => e.importance >= filters.minImportance);
  if (filters.narratorTier) results = results.filter(e => e.narratorTier === filters.narratorTier);

  // Sort by relevance (importance * recency)
  results.sort((a, b) => (b.importance || 1) - (a.importance || 1));

  uiState.searchResults = results.map(e => e.id);

  return {
    query,
    filters,
    resultCount: results.length,
    results: results.slice(0, 30).map(e => ({
      id: e.id,
      chapterTag: e.chapterTag,
      chapterTitle: CHRONICLE_CHAPTERS[e.chapterTag]?.title || 'Unknown',
      category: e.category,
      preview: (e.narrativeText || '').substring(0, 150),
      importance: e.importance,
      narratorTier: e.narratorTier,
      isDistorted: e.isDistorted,
      isBookmarked: uiState.bookmarks.has(e.id),
      timestamp: e.timestamp,
    })),
    truncated: results.length > 30,
  };
}

/**
 * Toggle bookmark on an entry.
 * @param {string} entryId
 * @returns {object} { entryId, bookmarked, totalBookmarks }
 */
export function toggleBookmark(entryId) {
  loadChronicle();
  const entry = chronicleState.entries.find(e => e.id === entryId);
  if (!entry) return { error: `Entry not found: ${entryId}` };

  if (uiState.bookmarks.has(entryId)) {
    uiState.bookmarks.delete(entryId);
  } else {
    uiState.bookmarks.add(entryId);
  }
  uiState.lastInteraction = Date.now();

  // Persist bookmarks
  saveUIState();

  return {
    entryId,
    bookmarked: uiState.bookmarks.has(entryId),
    totalBookmarks: uiState.bookmarks.size,
  };
}

/**
 * Get all bookmarked entries.
 * @returns {object} { bookmarks: [...], count }
 */
export function getBookmarkedEntries() {
  loadChronicle();
  const bookmarked = chronicleState.entries
    .filter(e => uiState.bookmarks.has(e.id))
    .sort((a, b) => a.timestamp - b.timestamp);

  return {
    count: bookmarked.length,
    bookmarks: bookmarked.map(e => ({
      id: e.id,
      chapterTag: e.chapterTag,
      chapterTitle: CHRONICLE_CHAPTERS[e.chapterTag]?.title || 'Unknown',
      category: e.category,
      preview: (e.narrativeText || '').substring(0, 150),
      importance: e.importance,
      narratorTier: e.narratorTier,
      timestamp: e.timestamp,
    })),
  };
}

/**
 * Set UI sort/filter options.
 * @param {object} options — { sortOrder, narratorFilterTier, showDistortedOnly }
 * @returns {object} updated filter state
 */
export function setChronicleUIFilters(options = {}) {
  if (options.sortOrder && ['chronological', 'reverse', 'importance'].includes(options.sortOrder)) {
    uiState.sortOrder = options.sortOrder;
  }
  if (options.narratorFilterTier !== undefined) {
    uiState.narratorFilterTier = options.narratorFilterTier; // null to clear
  }
  if (options.showDistortedOnly !== undefined) {
    uiState.showDistortedOnly = !!options.showDistortedOnly;
  }
  uiState.lastInteraction = Date.now();

  return {
    sortOrder: uiState.sortOrder,
    narratorFilterTier: uiState.narratorFilterTier,
    showDistortedOnly: uiState.showDistortedOnly,
  };
}

/**
 * Get the full UI state summary.
 */
export function getChronicleUIState() {
  loadChronicle();
  return {
    selectedChapter: uiState.selectedChapter,
    currentPage: uiState.currentPage,
    sortOrder: uiState.sortOrder,
    searchQuery: uiState.searchQuery,
    searchResultCount: uiState.searchResults.length,
    bookmarkCount: uiState.bookmarks.size,
    expandedEntryId: uiState.expandedEntryId,
    narratorFilterTier: uiState.narratorFilterTier,
    showDistortedOnly: uiState.showDistortedOnly,
    lastInteraction: uiState.lastInteraction,
    totalEntries: chronicleState.entries.length,
    totalChapters: Object.keys(CHRONICLE_CHAPTERS).length,
    entriesPerPage: ENTRIES_PER_PAGE,
  };
}

// ── Corruption Visual Theming ─────────────────────────────────────────────────

/**
 * Get hex color based on corruption level for UI theming.
 * The chronicle UI visually degrades as corruption increases.
 */
function getCorruptionColor(corruption, element) {
  const colors = {
    bg: [
      { max: 0.2, color: '#1A1A2E' },   // Deep navy — clean
      { max: 0.4, color: '#1F1A2E' },   // Slight purple tint
      { max: 0.6, color: '#2E1A2E' },   // Magenta undertone
      { max: 0.8, color: '#2E1A1A' },   // Blood red seep
      { max: 1.0, color: '#1A0A0A' },   // Near-black crimson
    ],
    text: [
      { max: 0.2, color: '#E0D8C8' },   // Warm parchment
      { max: 0.4, color: '#D0C8B8' },   // Aging parchment
      { max: 0.6, color: '#C8A888' },   // Yellowed
      { max: 0.8, color: '#B87858' },   // Corrupted amber
      { max: 1.0, color: '#A04030' },   // Blood-stained text
    ],
    border: [
      { max: 0.2, color: '#3A3A5E' },   // Steel blue
      { max: 0.4, color: '#4A3A5E' },   // Purple steel
      { max: 0.6, color: '#6A2A4E' },   // Dark magenta
      { max: 0.8, color: '#8A1A2E' },   // Crimson
      { max: 1.0, color: '#6A0A0A' },   // Deep blood
    ],
  };

  const palette = colors[element] || colors.text;
  for (const entry of palette) {
    if (corruption <= entry.max) return entry.color;
  }
  return palette[palette.length - 1].color;
}

/**
 * Get decorative glyph/symbol based on corruption level.
 * Used as chapter dividers and entry decorations in the UI.
 */
function getCorruptionGlyph(corruption) {
  if (corruption >= 0.8) return { glyph: '\u2620', name: 'skull_crossbones', description: 'The narrator has lost all grip on reality' };
  if (corruption >= 0.6) return { glyph: '\u2666', name: 'diamond', description: 'Grand delusions color every word' };
  if (corruption >= 0.4) return { glyph: '\u2605', name: 'star', description: 'The narrator embellishes freely' };
  if (corruption >= 0.2) return { glyph: '\u25C6', name: 'diamond_filled', description: 'Subtle unease creeps into the prose' };
  return { glyph: '\u2726', name: 'four_pointed_star', description: 'Faithful and scholarly record' };
}

// ── UI State Persistence ──────────────────────────────────────────────────────

function getUIStatePath() {
  const game = getActiveGame?.();
  return join(process.cwd(), 'workspace', game?.id || 'shattered-crown', 'Data', 'chronicle-ui-state.json');
}

function saveUIState() {
  try {
    const path = getUIStatePath();
    const dir = join(path, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify({
      bookmarks: [...uiState.bookmarks],
      sortOrder: uiState.sortOrder,
      narratorFilterTier: uiState.narratorFilterTier,
      showDistortedOnly: uiState.showDistortedOnly,
      lastInteraction: uiState.lastInteraction,
    }, null, 2));
  } catch (err) {
    log.warn(`Failed to save UI state: ${err.message}`);
  }
}

function loadUIState() {
  try {
    const path = getUIStatePath();
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, 'utf-8'));
      uiState.bookmarks = new Set(raw.bookmarks || []);
      uiState.sortOrder = raw.sortOrder || 'chronological';
      uiState.narratorFilterTier = raw.narratorFilterTier || null;
      uiState.showDistortedOnly = raw.showDistortedOnly || false;
      uiState.lastInteraction = raw.lastInteraction;
      log.info(`Chronicle UI state loaded: ${uiState.bookmarks.size} bookmarks`);
    }
  } catch (err) {
    log.warn(`Failed to load UI state: ${err.message}`);
  }
}

// Load UI state on module init
loadUIState();

// ── UE5 Widget & DataTable Deployment ─────────────────────────────────────────

/**
 * Deploy the chronicle UI to UE5 — creates Widget Blueprints and DataTables.
 * Creates:
 *   - WBP_ChronicleMain: main chronicle screen with chapter list
 *   - WBP_ChronicleChapter: chapter detail with paginated entries
 *   - WBP_ChronicleEntry: single entry detail view
 *   - DT_ChronicleChapters: chapter definitions DataTable
 *   - DT_ChronicleThemes: corruption-based UI theme DataTable
 *
 * @returns {object} deployment results
 */
export async function deployChronicleUI() {
  const folder = '/Game/UI/Chronicle';
  const dataFolder = '/Game/Data/Chronicle';
  const results = { widgets: [], dataTables: [], errors: [] };

  // 1. Create Widget Blueprints
  const widgetSpecs = [
    { name: 'WBP_ChronicleMain', desc: 'Main chronicle screen — chapter list, narrator mood, reliability indicator' },
    { name: 'WBP_ChronicleChapter', desc: 'Chapter view — paginated entries, sort/filter controls, bookmark buttons' },
    { name: 'WBP_ChronicleEntry', desc: 'Entry detail — full narrative text, corruption indicators, prev/next nav' },
    { name: 'WBP_ChronicleSearch', desc: 'Search overlay — text search with category/importance/tier filters' },
    { name: 'WBP_ChronicleBookmarks', desc: 'Bookmarks panel — saved entries quick access' },
  ];

  for (const spec of widgetSpecs) {
    try {
      const res = await callTool('unreal', 'create_widget_blueprint', {
        name: spec.name,
        folder,
      }, 30_000);
      results.widgets.push({ name: spec.name, success: true, result: res });
      log.info(`Created widget: ${spec.name}`);
    } catch (err) {
      results.widgets.push({ name: spec.name, success: false, error: err.message });
      results.errors.push(`Widget ${spec.name}: ${err.message}`);
    }
  }

  // 2. Create Chapter DataTable
  try {
    const chapterRows = Object.entries(CHRONICLE_CHAPTERS)
      .sort(([, a], [, b]) => a.order - b.order)
      .map(([key, def]) => ({
        key: `chapter_${key}`,
        label: def.title,
        value: key,
        count: def.order,
        notes: (def.categories || []).join(', '),
      }));

    const dtChapters = await callTool('unreal', 'create_data_table', {
      name: 'DT_ChronicleChapters',
      folder: dataFolder,
      rows: chapterRows,
    }, 30_000);
    results.dataTables.push({ name: 'DT_ChronicleChapters', success: true, result: dtChapters });
    log.info('Created DataTable: DT_ChronicleChapters');
  } catch (err) {
    results.dataTables.push({ name: 'DT_ChronicleChapters', success: false, error: err.message });
    results.errors.push(`DataTable DT_ChronicleChapters: ${err.message}`);
  }

  // 3. Create Corruption Theme DataTable
  try {
    const themeRows = Object.entries(NARRATOR_CORRUPTION_TIERS).map(([tierKey, tier]) => ({
      key: `theme_${tierKey}`,
      label: `${tier.label} (${tier.voice})`,
      value: `bg:${getCorruptionColor(tier.min, 'bg')}|text:${getCorruptionColor(tier.min, 'text')}|border:${getCorruptionColor(tier.min, 'border')}`,
      count: Math.round(tier.reliability * 100),
      notes: `Distortion: ${tier.distortion}, Range: ${tier.min}-${tier.max}`,
    }));

    const dtThemes = await callTool('unreal', 'create_data_table', {
      name: 'DT_ChronicleThemes',
      folder: dataFolder,
      rows: themeRows,
    }, 30_000);
    results.dataTables.push({ name: 'DT_ChronicleThemes', success: true, result: dtThemes });
    log.info('Created DataTable: DT_ChronicleThemes');
  } catch (err) {
    results.dataTables.push({ name: 'DT_ChronicleThemes', success: false, error: err.message });
    results.errors.push(`DataTable DT_ChronicleThemes: ${err.message}`);
  }

  // 4. Create Glyph/Decoration DataTable
  try {
    const glyphRows = [0, 0.1, 0.25, 0.45, 0.65, 0.85].map(c => {
      const g = getCorruptionGlyph(c);
      return {
        key: `glyph_${g.name}`,
        label: g.description,
        value: g.glyph,
        count: Math.round(c * 100),
        notes: `corruption >= ${c}`,
      };
    });

    const dtGlyphs = await callTool('unreal', 'create_data_table', {
      name: 'DT_ChronicleGlyphs',
      folder: dataFolder,
      rows: glyphRows,
    }, 30_000);
    results.dataTables.push({ name: 'DT_ChronicleGlyphs', success: true, result: dtGlyphs });
    log.info('Created DataTable: DT_ChronicleGlyphs');
  } catch (err) {
    results.dataTables.push({ name: 'DT_ChronicleGlyphs', success: false, error: err.message });
    results.errors.push(`DataTable DT_ChronicleGlyphs: ${err.message}`);
  }

  // 5. Export chapter/entry data as JSON for runtime loading
  const exportData = {
    chapters: getChronicleChapterList(),
    themes: Object.entries(NARRATOR_CORRUPTION_TIERS).map(([k, t]) => ({
      tier: k, ...t,
      colors: {
        bg: getCorruptionColor(t.min, 'bg'),
        text: getCorruptionColor(t.min, 'text'),
        border: getCorruptionColor(t.min, 'border'),
      },
      glyph: getCorruptionGlyph(t.min),
    })),
    entriesPerPage: ENTRIES_PER_PAGE,
    deployedAt: Date.now(),
  };

  const exportPath = join(process.cwd(), 'workspace',
    getActiveGame?.()?.id || 'shattered-crown', 'Data', 'chronicle-ui-spec.json');
  const dir = join(exportPath, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(exportPath, JSON.stringify(exportData, null, 2));
  results.specExported = exportPath;

  log.info(`Chronicle UI deployed: ${results.widgets.filter(w => w.success).length} widgets, ${results.dataTables.filter(d => d.success).length} data tables`);

  return {
    success: results.errors.length === 0,
    widgets: results.widgets.length,
    widgetsCreated: results.widgets.filter(w => w.success).length,
    dataTables: results.dataTables.length,
    dataTablesCreated: results.dataTables.filter(d => d.success).length,
    specExported: results.specExported,
    errors: results.errors,
    details: results,
  };
}

/**
 * Get the chronicle UI deployment status — what widgets/tables exist.
 */
export function getChronicleUIStatus() {
  loadChronicle();
  const mood = getNarratorMood();

  return {
    milestone: 'ms_4',
    systemActive: true,
    uiState: getChronicleUIState(),
    chapterCount: Object.keys(CHRONICLE_CHAPTERS).length,
    totalEntries: chronicleState.entries.length,
    bookmarkCount: uiState.bookmarks.size,
    narratorMood: mood,
    features: {
      chapterNavigation: true,
      pagination: true,
      entryDetail: true,
      search: true,
      bookmarks: true,
      corruptionTheming: true,
      sortAndFilter: true,
      ue5Widgets: ['WBP_ChronicleMain', 'WBP_ChronicleChapter', 'WBP_ChronicleEntry', 'WBP_ChronicleSearch', 'WBP_ChronicleBookmarks'],
      dataTables: ['DT_ChronicleChapters', 'DT_ChronicleThemes', 'DT_ChronicleGlyphs'],
    },
    corruptionThemePreview: Object.entries(NARRATOR_CORRUPTION_TIERS).map(([k, t]) => ({
      tier: k,
      label: t.label,
      bg: getCorruptionColor(t.min, 'bg'),
      text: getCorruptionColor(t.min, 'text'),
      border: getCorruptionColor(t.min, 'border'),
      glyph: getCorruptionGlyph(t.min),
    })),
  };
}

log.info('ms_4: Chronicle UI system loaded — chapter navigation, pagination, search, bookmarks, corruption theming');

// ═══════════════════════════════════════════════════════════════════════════════
// ms_5: Rival Counter-Chronicle — Veyra's Parallel Narrative
// ═══════════════════════════════════════════════════════════════════════════════
//
// Veyra Ashcroft keeps her own chronicle — a counter-narrative that reframes
// events from her perspective. Her reliability is *inverse* to Kael's narrator:
//   - When Kael's narrator is faithful (low corruption), Veyra's is bitter/dismissive
//   - When Kael's narrator is deluded (high corruption), Veyra's becomes sympathetic
//
// The counter-chronicle mirrors Kael's chapter structure but with Veyra's voice.
// Relationship state (hostile → respected rival) changes her tone dramatically.
//
// Provides:
//   - Counter-chronicle templates for all major event categories
//   - Relationship-driven voice system (5 tones matching RELATIONSHIP_STATES)
//   - Parallel entry generation from Kael's chronicle events
//   - Side-by-side view comparing both chronicles
//   - Counter-chronicle export and UE5 data deployment

// ── Veyra's Voice Profiles (keyed by relationship state) ────────────────────

const VEYRA_VOICES = {
  hostile: {
    label: 'Hostile',
    tone: 'cold, contemptuous',
    pronounForKael: 'the fool',
    selfReference: 'I',
    narrativeStyle: 'clipped and dismissive',
    interjections: [
      'Pathetic.',
      'As expected.',
      'The Crown deserves better than this.',
      'Another day wasted on a pretender.',
    ],
  },
  wary: {
    label: 'Distrustful',
    tone: 'guarded, analytical',
    pronounForKael: 'the other seeker',
    selfReference: 'I',
    narrativeStyle: 'measured tactical analysis',
    interjections: [
      'Noted.',
      'I should not underestimate them.',
      'Curious. But irrelevant.',
      'This changes the calculus.',
    ],
  },
  neutral: {
    label: 'Cautious Rival',
    tone: 'pragmatic, observant',
    pronounForKael: 'Kael',
    selfReference: 'I',
    narrativeStyle: 'observational, occasionally grudgingly impressed',
    interjections: [
      'Interesting.',
      'Not what I would have done, but... effective.',
      'The shards respond to both of us. Why?',
      'Mathis taught them well. Annoyingly well.',
    ],
  },
  reluctant_ally: {
    label: 'Reluctant Ally',
    tone: 'conflicted, warming',
    pronounForKael: 'Kael',
    selfReference: 'I',
    narrativeStyle: 'personal, conflicted, occasionally vulnerable',
    interjections: [
      'I shouldn\'t care. But I do.',
      'Together we survived. I hate that I needed help.',
      'Caelen would have liked them.',
      'Maybe the Crown chose us both for a reason.',
    ],
  },
  rival_respect: {
    label: 'Respected Rival',
    tone: 'warm respect, bittersweet',
    pronounForKael: 'Kael',
    selfReference: 'I',
    narrativeStyle: 'reflective, honest, occasionally poetic',
    interjections: [
      'They deserve the truth, even if I can\'t speak it aloud.',
      'In another life, we would have been friends from the start.',
      'The Crown tests us both. Only one can bear it — but both must be worthy.',
      'Strength isn\'t just power. Kael taught me that.',
    ],
  },
};

// ── Counter-Chronicle Templates ─────────────────────────────────────────────
// Each template mirrors a Kael chronicle category but from Veyra's perspective.
// Voice variants are keyed by relationship state instead of corruption tier.

const COUNTER_CHRONICLE_TEMPLATES = {
  // ─── Combat from Veyra's view ─────────────────────────────────────────────
  counter_combat_victory: {
    category: 'combat',
    id: 'counter_combat_victory',
    mirrorTemplates: ['combat_victory', 'combat_boss_kill'],
    requiredFields: ['enemyName', 'regionId', 'kaelCorruption'],
    voices: {
      hostile:        '{pronounForKael} stumbled through another fight in {regionId}. Killed {enemyName} — brute force, no elegance. The corruption in their swings grows worse.',
      wary:           'The other seeker defeated {enemyName} in {regionId}. Combat proficiency: improving. Corruption reliance: {kaelCorruption}%. I need to adapt.',
      neutral:        'Kael fought {enemyName} in {regionId} today. Clean kill? Mostly. I watched from the ridge. Their form has Mathis\'s fingerprints all over it.',
      reluctant_ally: 'We took down {enemyName} together in {regionId}. Kael covered my blind side without being asked. I didn\'t say thank you. I should have.',
      rival_respect:  'Kael defeated {enemyName} in {regionId}. Watching them fight now — it\'s like watching a poem. The corruption hasn\'t touched their core. Not yet.',
    },
    importance: 2,
    chapterTag: 'counter_rival',
  },

  counter_combat_defeat: {
    category: 'combat',
    id: 'counter_combat_defeat',
    mirrorTemplates: ['combat_defeat'],
    requiredFields: ['enemyName', 'regionId'],
    voices: {
      hostile:        'The fool fell to {enemyName} in {regionId}. Naturally. I retrieved the shard they dropped and kept moving.',
      wary:           'Kael was defeated by {enemyName}. This could work in my favor... or attract worse things to {regionId}.',
      neutral:        'Kael lost to {enemyName} in {regionId}. It happens. Even I\'ve been brought low by this cursed land.',
      reluctant_ally: 'Kael fell in {regionId}. I dragged them to safety before the corruption could take root. They don\'t need to know it was me.',
      rival_respect:  'Kael was wounded badly in {regionId}. I found myself holding my breath until I saw them stand again. When did I start caring?',
    },
    importance: 3,
    chapterTag: 'counter_rival',
  },

  // ─── Quest events from Veyra's view ───────────────────────────────────────
  counter_quest_completed: {
    category: 'quest',
    id: 'counter_quest_completed',
    mirrorTemplates: ['quest_completed', 'quest_chain_end'],
    requiredFields: ['questName', 'regionId', 'outcome'],
    voices: {
      hostile:        '{pronounForKael} "completed" {questName} in {regionId}. The locals celebrate. They don\'t know what\'s coming — {outcome} changes nothing.',
      wary:           'Quest completed by the other seeker: {questName}. Outcome: {outcome}. I need to assess whether this shifts the shard balance.',
      neutral:        'Kael finished {questName} in {regionId}. {outcome}. Not how I would have handled it, but the region is stabilized. For now.',
      reluctant_ally: 'We finished {questName} together. {outcome}. Kael insisted on the merciful path. I wanted efficiency. Maybe they were right.',
      rival_respect:  'Kael completed {questName}. {outcome}. The way they handled it — protecting everyone, even the ones who didn\'t deserve it — reminds me why the Crown might choose them over me.',
    },
    importance: 3,
    chapterTag: 'counter_rival',
  },

  // ─── Shard events from Veyra's view ───────────────────────────────────────
  counter_shard_collected: {
    category: 'shard',
    id: 'counter_shard_collected',
    mirrorTemplates: ['shard_acquired', 'shard_power_surge'],
    requiredFields: ['shardName', 'regionId', 'kaelCorruption'],
    voices: {
      hostile:        'Another shard falls to {pronounForKael}. {shardName} in {regionId}. That should have been mine. Their corruption reads {kaelCorruption}% — the shards are eating them alive and they don\'t even notice.',
      wary:           'Kael acquired {shardName} in {regionId}. Corruption: {kaelCorruption}%. The gap between us narrows. I need the next shard first.',
      neutral:        'Kael found {shardName} in {regionId}. I felt it resonate with my own shards. The Crown wants to be whole — it doesn\'t care which of us carries the pieces.',
      reluctant_ally: 'Kael took {shardName} and the corruption surged to {kaelCorruption}%. I showed them the breathing technique I use to manage the whispers. They looked surprised that I\'d help.',
      rival_respect:  '{shardName} chose Kael. In {regionId}, I watched the shard fly to their hand like a bird returning to its master. My shards ached. Perhaps they know something I don\'t.',
    },
    importance: 4,
    chapterTag: 'counter_rival',
  },

  // ─── Corruption events from Veyra's view ──────────────────────────────────
  counter_corruption_shift: {
    category: 'corruption',
    id: 'counter_corruption_shift',
    mirrorTemplates: ['corruption_tier_crossed', 'corruption_whisper_resisted'],
    requiredFields: ['corruptionLevel', 'regionId', 'event'],
    voices: {
      hostile:        'The corruption in {pronounForKael} shifted — {event}. {corruptionLevel}%. Let it consume them. One less competitor.',
      wary:           'Corruption reading on the other seeker: {corruptionLevel}% after {event}. If they fall, the corruption spreads unchecked. This concerns me more than I\'d like.',
      neutral:        'Kael\'s corruption: {corruptionLevel}%. {event}. I know what that feels like. The whispers at that level... they sound like people you\'ve lost.',
      reluctant_ally: 'Kael\'s corruption hit {corruptionLevel}% — {event}. I stayed up watching them sleep, making sure the whispers didn\'t take root. Caelen started the same way.',
      rival_respect:  '{event}. Kael\'s corruption: {corruptionLevel}%. They resist it with a strength I envy. Where I bend and adapt, they simply... endure. It\'s beautiful and terrifying.',
    },
    importance: 4,
    chapterTag: 'counter_rival',
  },

  // ─── Region travel from Veyra's view ──────────────────────────────────────
  counter_region_entered: {
    category: 'region_travel',
    id: 'counter_region_entered',
    mirrorTemplates: ['region_entered', 'region_first_visit'],
    requiredFields: ['regionId', 'regionName'],
    voices: {
      hostile:        '{pronounForKael} entered {regionName}. I was here three days ago. Always behind.',
      wary:           'The other seeker has arrived in {regionName}. I\'ve already mapped the shard resonances. Let them stumble through.',
      neutral:        'Kael reached {regionName}. I remember my first time here too — the way the light changes when the corruption thins. It\'s almost peaceful.',
      reluctant_ally: 'We entered {regionName} together. Walking side by side with another seeker feels... wrong. And right. Like remembering something that hasn\'t happened yet.',
      rival_respect:  '{regionName}. Kael sees it differently than I do — where I see tactical positions, they see the beauty. I\'m starting to see it through their eyes.',
    },
    importance: 2,
    chapterTag: 'counter_rival',
  },

  // ─── Companion bonds from Veyra's view ────────────────────────────────────
  counter_companion_bond: {
    category: 'companion',
    id: 'counter_companion_bond',
    mirrorTemplates: ['companion_bond_milestone'],
    requiredFields: ['companionName', 'bondLevel'],
    voices: {
      hostile:        '{pronounForKael} grows closer to {companionName}. Attachments are weaknesses. I learned that in Ashcroft.',
      wary:           'Bond deepening between Kael and {companionName}. Level: {bondLevel}. Companions make seekers predictable. Useful information.',
      neutral:        'Kael and {companionName} — bond level {bondLevel}. Having someone trust you like that... I had that once. Before the fire.',
      reluctant_ally: '{companionName} trusts Kael deeply now — level {bondLevel}. And somehow, through Kael, they\'ve started trusting me too. I don\'t deserve it.',
      rival_respect:  'Watching Kael with {companionName} at bond level {bondLevel} — it\'s what the Crown was supposed to protect. Not power. Connection.',
    },
    importance: 3,
    chapterTag: 'counter_rival',
  },

  // ─── NPC interactions from Veyra's view ───────────────────────────────────
  counter_npc_interaction: {
    category: 'npc_interaction',
    id: 'counter_npc_interaction',
    mirrorTemplates: ['npc_met', 'npc_persuaded', 'npc_quest_given'],
    requiredFields: ['npcName', 'interaction', 'regionId'],
    voices: {
      hostile:        '{pronounForKael} spoke with {npcName} in {regionId}. {interaction}. Wasting time on people who can\'t help them reach the Crown.',
      wary:           'The other seeker\'s interaction with {npcName}: {interaction}. Building alliances or just being naive? Hard to tell.',
      neutral:        'Kael met {npcName}. {interaction}. They have a way with people I\'ve never had. People open up to them.',
      reluctant_ally: '{npcName} trusts Kael after {interaction}. I stood behind and watched — {npcName} flinched when they saw me. I\'m used to it.',
      rival_respect:  'Kael spoke with {npcName} — {interaction}. Every person they help is another thread holding this broken world together. I only know how to cut threads.',
    },
    importance: 2,
    chapterTag: 'counter_rival',
  },

  // ─── Death/defeat from Veyra's view ───────────────────────────────────────
  counter_death: {
    category: 'death',
    id: 'counter_death',
    mirrorTemplates: ['death_recorded'],
    requiredFields: ['causeOfDeath', 'regionId'],
    voices: {
      hostile:        '{pronounForKael} died. {causeOfDeath} in {regionId}. The shards scattered. I could have taken them. I didn\'t. I want to beat them at full strength.',
      wary:           'Kael fell — {causeOfDeath}. In {regionId}. The Crown brought them back. It always does. That\'s what frightens me.',
      neutral:        '{causeOfDeath} took Kael in {regionId}. I felt the resonance when they died — my shards screamed. We\'re more connected than either of us wants to admit.',
      reluctant_ally: 'Kael died. {causeOfDeath}. I ran. I ran as fast as I could to {regionId} but I was too late. The Crown revived them before I arrived. I sat in the ruins and cried. No one saw.',
      rival_respect:  '{causeOfDeath} claimed Kael in {regionId}. For one terrible moment the world went grey. Then the Crown\'s light returned and I could breathe again. I will not write what I felt.',
    },
    importance: 5,
    chapterTag: 'counter_rival',
  },

  // ─── Boss encounters from Veyra's view ────────────────────────────────────
  counter_boss_victory: {
    category: 'boss_encounter',
    id: 'counter_boss_victory',
    mirrorTemplates: ['boss_defeated', 'boss_first_attempt'],
    requiredFields: ['bossName', 'regionId', 'shardUsed'],
    voices: {
      hostile:        '{pronounForKael} killed {bossName} in {regionId} using {shardUsed}. Brute force. I would have found the weakness in half the time.',
      wary:           'Boss {bossName} fell to Kael in {regionId}. Shard used: {shardUsed}. Their combat evolution is... concerning. Adjusting my approach.',
      neutral:        'Kael defeated {bossName}. {shardUsed} resonated through {regionId} like a bell. I felt it in my bones. Impressive, grudgingly.',
      reluctant_ally: 'We fought {bossName} together in {regionId}. Kael took the killing blow with {shardUsed}. I held the creature\'s attention. We make a terrifyingly good team.',
      rival_respect:  '{bossName} fell to Kael\'s {shardUsed} in {regionId}. I watched from the shadows, ready to intervene. I wasn\'t needed. They never needed me. That should comfort me.',
    },
    importance: 4,
    chapterTag: 'counter_rival',
  },

  // ─── Dungeon events from Veyra's view ─────────────────────────────────────
  counter_dungeon_cleared: {
    category: 'dungeon',
    id: 'counter_dungeon_cleared',
    mirrorTemplates: ['dungeon_entered', 'dungeon_cleared'],
    requiredFields: ['dungeonName', 'regionId', 'echoesFound'],
    voices: {
      hostile:        '{pronounForKael} cleared {dungeonName} in {regionId}. {echoesFound} echoes found. I cleared it faster. Without help.',
      wary:           'Dungeon {dungeonName} cleared. Echoes: {echoesFound}. The other seeker is getting dangerously close to understanding the shard resonance patterns.',
      neutral:        'Kael finished {dungeonName}. {echoesFound} echoes. These dungeons... they remember us. Both of us. The echoes call my name too.',
      reluctant_ally: '{dungeonName} almost killed us both. {echoesFound} echoes, each one showing a future where one of us doesn\'t make it. Kael reached for my hand in the dark. I let them.',
      rival_respect:  '{dungeonName}. {echoesFound} echoes witnessed. Kael navigated the puzzles with an intuition I lack — they listen where I analyze. Perhaps that\'s why the echoes speak to them more clearly.',
    },
    importance: 3,
    chapterTag: 'counter_rival',
  },

  // ─── Ending/climax from Veyra's view ──────────────────────────────────────
  counter_ending_approached: {
    category: 'ending',
    id: 'counter_ending_approached',
    mirrorTemplates: ['ending_triggered'],
    requiredFields: ['endingPath', 'corruptionLevel', 'relationshipState'],
    voices: {
      hostile:        'The end approaches. Kael chose: {endingPath}. Corruption: {corruptionLevel}%. I will take the Crown from their corpse if I must. This is bigger than rivalry.',
      wary:           'Endgame. {endingPath}. Corruption: {corruptionLevel}%. Our relationship: {relationshipState}. I have contingencies for every outcome. I think.',
      neutral:        '{endingPath}. After everything — every shard, every battle, every region — it comes to this. Kael at {corruptionLevel}% corruption. Me at... I stopped counting.',
      reluctant_ally: 'The end. {endingPath}. I never thought I\'d face this beside someone rather than alone. Kael at {corruptionLevel}% corruption, me higher. {relationshipState}. I\'m afraid.',
      rival_respect:  'This is it. {endingPath}. Whatever happens, Kael has earned their place. Corruption: {corruptionLevel}%. Our bond: {relationshipState}. If I fall, I hope they remember that I tried. That I was more than the Ashen Seeker. That I was Veyra.',
    },
    importance: 5,
    chapterTag: 'counter_rival',
  },
};

// ── Counter-Chronicle Chapter Definition ────────────────────────────────────

const COUNTER_CHAPTER = {
  key: 'counter_rival',
  order: 18,
  title: 'Chapter XVIII — The Ashen Seeker\'s Record',
  categories: Object.values(ENTRY_CATEGORIES),
  description: 'Veyra Ashcroft\'s parallel account — the same journey, a different truth.',
};

// Register the counter-chapter in CHRONICLE_CHAPTERS if not already there
if (!CHRONICLE_CHAPTERS.counter_rival) {
  CHRONICLE_CHAPTERS.counter_rival = COUNTER_CHAPTER;
}

// ── Counter-Chronicle State ─────────────────────────────────────────────────

const counterChronicleState = {
  entries: [],
  loaded: false,
};

function getCounterChronPath() {
  const game = getActiveGame?.();
  return join(process.cwd(), 'workspace', game?.id || 'shattered-crown', 'Data', 'counter-chronicle.json');
}

function loadCounterChronicle() {
  if (counterChronicleState.loaded) return;
  try {
    const p = getCounterChronPath();
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, 'utf-8'));
      counterChronicleState.entries = raw.entries || [];
    }
  } catch (err) {
    log.warn(`Failed to load counter-chronicle: ${err.message}`);
  }
  counterChronicleState.loaded = true;
}

function saveCounterChronicle() {
  try {
    const p = getCounterChronPath();
    const dir = join(p, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(p, JSON.stringify({ entries: counterChronicleState.entries, savedAt: Date.now() }, null, 2));
  } catch (err) {
    log.warn(`Failed to save counter-chronicle: ${err.message}`);
  }
}

// ── Counter-Entry Builder ───────────────────────────────────────────────────

/**
 * Determine Veyra's voice key from the relationship score.
 * @param {number} relationshipScore
 * @returns {string} voice key matching VEYRA_VOICES
 */
function getVeyraVoiceKey(relationshipScore = 0) {
  if (relationshipScore >= 80) return 'rival_respect';
  if (relationshipScore >= 40) return 'reluctant_ally';
  if (relationshipScore >= 0) return 'neutral';
  if (relationshipScore >= -30) return 'wary';
  return 'hostile';
}

/**
 * Build a counter-chronicle entry from Veyra's perspective.
 *
 * @param {string} templateId — key from COUNTER_CHRONICLE_TEMPLATES
 * @param {object} eventData — data fields for the template
 * @param {number} relationshipScore — Veyra-Kael relationship (-100 to +100)
 * @param {number} veyraCorruption — Veyra's corruption level (0-1)
 * @param {number} timestamp — game timestamp
 * @returns {object} the counter-chronicle entry
 */
export function buildCounterChronicleEntry(templateId, eventData = {}, relationshipScore = 0, veyraCorruption = 0.5, timestamp = 0) {
  loadCounterChronicle();
  const template = COUNTER_CHRONICLE_TEMPLATES[templateId];
  if (!template) {
    return { error: `Unknown counter-chronicle template: ${templateId}`, available: Object.keys(COUNTER_CHRONICLE_TEMPLATES) };
  }

  const voiceKey = getVeyraVoiceKey(relationshipScore);
  const voice = VEYRA_VOICES[voiceKey];
  const textTemplate = template.voices[voiceKey] || template.voices.neutral;

  // Replace template fields including voice-driven pronouns
  let narrativeText = textTemplate;
  narrativeText = narrativeText.replace(/\{pronounForKael\}/g, voice.pronounForKael);
  for (const [key, val] of Object.entries(eventData)) {
    narrativeText = narrativeText.replace(new RegExp(`\\{${key}\\}`, 'g'), String(val));
  }

  // Add Veyra interjection at high corruption or extreme relationship
  let interjection = null;
  if (veyraCorruption > 0.6 || Math.abs(relationshipScore) > 60) {
    const pool = voice.interjections;
    interjection = pool[Math.floor((timestamp || Date.now()) % pool.length)];
  }

  const entry = {
    id: `vc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    templateId,
    category: template.category,
    chapterTag: 'counter_rival',
    narrativeText: interjection ? `${interjection} ${narrativeText}` : narrativeText,
    timestamp: timestamp || Date.now(),
    importance: template.importance,
    narrator: 'veyra',
    narratorVoice: voice.label,
    voiceKey,
    relationshipScore,
    veyraCorruption,
    tone: voice.tone,
    isCounterEntry: true,
    mirrorTemplates: template.mirrorTemplates,
    loreWeight: template.importance * 0.8,
  };

  counterChronicleState.entries.push(entry);

  // Also add to the main chronicle for unified UI browsing
  chronicleState.entries.push({
    ...entry,
    narratorTier: voiceKey,
    reliability: voiceKey === 'rival_respect' ? 0.9 : voiceKey === 'hostile' ? 0.3 : 0.6,
    isDistorted: voiceKey === 'hostile' || veyraCorruption > 0.6,
    distortionType: voiceKey === 'hostile' ? 'bias' : veyraCorruption > 0.6 ? 'corruption' : 'perspective',
    corruptionAtTime: veyraCorruption,
  });

  saveCounterChronicle();
  saveChronicle();
  log.info(`Counter-chronicle entry: ${templateId} [${voiceKey}] — "${narrativeText.substring(0, 60)}..."`);

  return entry;
}

/**
 * Auto-generate counter-chronicle entries for existing Kael chronicle entries
 * that don't yet have a Veyra counterpart.
 *
 * @param {number} relationshipScore — current Veyra-Kael relationship
 * @param {number} veyraCorruption — Veyra's current corruption
 * @returns {object} { generated, skipped, errors }
 */
export function generateCounterEntries(relationshipScore = 0, veyraCorruption = 0.5) {
  loadChronicle();
  loadCounterChronicle();

  const existingMirrors = new Set(counterChronicleState.entries.map(e => `${e.templateId}_${e.timestamp}`));
  const results = { generated: [], skipped: 0, errors: [] };

  // Map Kael template IDs to counter-templates
  const mirrorMap = {};
  for (const [ctId, ct] of Object.entries(COUNTER_CHRONICLE_TEMPLATES)) {
    for (const mt of ct.mirrorTemplates) {
      if (!mirrorMap[mt]) mirrorMap[mt] = [];
      mirrorMap[mt].push(ctId);
    }
  }

  for (const kaelEntry of chronicleState.entries) {
    if (kaelEntry.isCounterEntry) continue; // skip existing counter-entries

    const counterTemplateIds = mirrorMap[kaelEntry.templateId];
    if (!counterTemplateIds) { results.skipped++; continue; }

    for (const ctId of counterTemplateIds) {
      const key = `${ctId}_${kaelEntry.timestamp}`;
      if (existingMirrors.has(key)) { results.skipped++; continue; }

      try {
        // Extract event data from Kael's entry for Veyra's template
        const eventData = {
          regionId: kaelEntry.eventData?.regionId || kaelEntry.chapterTag || 'unknown',
          regionName: kaelEntry.eventData?.regionName || kaelEntry.chapterTag || 'unknown',
          enemyName: kaelEntry.eventData?.enemyName || 'a foe',
          questName: kaelEntry.eventData?.questName || 'a quest',
          outcome: kaelEntry.eventData?.outcome || 'completed',
          shardName: kaelEntry.eventData?.shardName || 'a shard',
          kaelCorruption: Math.round((kaelEntry.corruptionAtTime || 0) * 100),
          corruptionLevel: Math.round((kaelEntry.corruptionAtTime || 0) * 100),
          event: kaelEntry.eventData?.event || kaelEntry.templateId,
          companionName: kaelEntry.eventData?.companionName || 'their companion',
          bondLevel: kaelEntry.eventData?.bondLevel || '?',
          npcName: kaelEntry.eventData?.npcName || 'someone',
          interaction: kaelEntry.eventData?.interaction || 'spoke',
          causeOfDeath: kaelEntry.eventData?.causeOfDeath || 'the land itself',
          bossName: kaelEntry.eventData?.bossName || 'a boss',
          shardUsed: kaelEntry.eventData?.shardUsed || 'raw power',
          dungeonName: kaelEntry.eventData?.dungeonName || 'a dungeon',
          echoesFound: kaelEntry.eventData?.echoesFound || 0,
          endingPath: kaelEntry.eventData?.endingPath || 'unknown',
          relationshipState: getVeyraVoiceKey(relationshipScore),
        };

        const entry = buildCounterChronicleEntry(ctId, eventData, relationshipScore, veyraCorruption, kaelEntry.timestamp);
        if (!entry.error) {
          results.generated.push({ templateId: ctId, kaelTemplate: kaelEntry.templateId, voice: entry.voiceKey });
          existingMirrors.add(key);
        } else {
          results.errors.push(entry.error);
        }
      } catch (err) {
        results.errors.push(`${ctId}: ${err.message}`);
      }
    }
  }

  log.info(`Counter-chronicle generation: ${results.generated.length} new, ${results.skipped} skipped, ${results.errors.length} errors`);
  return results;
}

/**
 * Get side-by-side comparison of Kael's chronicle and Veyra's counter-chronicle
 * for a given chapter or time range.
 *
 * @param {object} [options] — { chapter, fromTimestamp, toTimestamp, limit }
 * @returns {object} { pairs: [...], kaelOnly, veyraOnly, totalPairs }
 */
export function getChronicleComparison(options = {}) {
  loadChronicle();
  loadCounterChronicle();

  let kaelEntries = chronicleState.entries.filter(e => !e.isCounterEntry);
  let veyraEntries = counterChronicleState.entries;

  // Apply filters
  if (options.chapter) {
    kaelEntries = kaelEntries.filter(e => e.chapterTag === options.chapter);
  }
  if (options.fromTimestamp) {
    kaelEntries = kaelEntries.filter(e => e.timestamp >= options.fromTimestamp);
    veyraEntries = veyraEntries.filter(e => e.timestamp >= options.fromTimestamp);
  }
  if (options.toTimestamp) {
    kaelEntries = kaelEntries.filter(e => e.timestamp <= options.toTimestamp);
    veyraEntries = veyraEntries.filter(e => e.timestamp <= options.toTimestamp);
  }

  // Build pairs by matching timestamps
  const veyraByTimestamp = {};
  for (const ve of veyraEntries) {
    if (!veyraByTimestamp[ve.timestamp]) veyraByTimestamp[ve.timestamp] = [];
    veyraByTimestamp[ve.timestamp].push(ve);
  }

  const pairs = [];
  const matchedVeyraIds = new Set();

  for (const ke of kaelEntries) {
    const vMatches = veyraByTimestamp[ke.timestamp] || [];
    if (vMatches.length > 0) {
      const vm = vMatches[0];
      matchedVeyraIds.add(vm.id);
      pairs.push({
        timestamp: ke.timestamp,
        category: ke.category,
        kael: {
          id: ke.id,
          text: ke.narrativeText,
          narratorTier: ke.narratorTier,
          reliability: ke.reliability,
        },
        veyra: {
          id: vm.id,
          text: vm.narrativeText,
          voice: vm.narratorVoice,
          relationship: vm.relationshipScore,
        },
        contradiction: detectContradiction(ke, vm),
      });
    } else {
      pairs.push({
        timestamp: ke.timestamp,
        category: ke.category,
        kael: { id: ke.id, text: ke.narrativeText, narratorTier: ke.narratorTier, reliability: ke.reliability },
        veyra: null,
        contradiction: null,
      });
    }
  }

  // Sort by timestamp
  pairs.sort((a, b) => a.timestamp - b.timestamp);
  const limited = options.limit ? pairs.slice(0, options.limit) : pairs;

  return {
    pairs: limited,
    totalPairs: pairs.length,
    kaelOnly: pairs.filter(p => !p.veyra).length,
    veyraOnly: veyraEntries.filter(ve => !matchedVeyraIds.has(ve.id)).length,
    contradictions: pairs.filter(p => p.contradiction?.isContradiction).length,
  };
}

/**
 * Detect narrative contradictions between Kael's entry and Veyra's counter-entry.
 */
function detectContradiction(kaelEntry, veyraEntry) {
  if (!kaelEntry || !veyraEntry) return null;

  const kText = (kaelEntry.narrativeText || '').toLowerCase();
  const vText = (veyraEntry.narrativeText || '').toLowerCase();

  // Check for opposing sentiment markers
  const positiveMarkers = ['victory', 'triumph', 'glory', 'hero', 'saved', 'protected', 'noble'];
  const negativeMarkers = ['fool', 'stumbled', 'brute', 'failed', 'pathetic', 'pretender', 'naive'];

  const kaelPositive = positiveMarkers.some(m => kText.includes(m));
  const veyraNegatve = negativeMarkers.some(m => vText.includes(m));
  const isContradiction = kaelPositive && veyraNegatve;

  // Check for factual contradictions (different outcomes claimed)
  const kaelClaims = kText.includes('defeated') || kText.includes('conquered') || kText.includes('victory');
  const veyraDenies = vText.includes('stumbled') || vText.includes('brute force') || vText.includes('failed');
  const factualConflict = kaelClaims && veyraDenies;

  return {
    isContradiction: isContradiction || factualConflict,
    type: factualConflict ? 'factual' : isContradiction ? 'tonal' : 'none',
    description: factualConflict
      ? 'The two seekers remember this event very differently.'
      : isContradiction
        ? 'Their tones clash — triumph vs contempt.'
        : 'Both accounts roughly align.',
  };
}

/**
 * Get the counter-chronicle status summary.
 * @returns {object}
 */
export function getCounterChronicleStatus() {
  loadCounterChronicle();
  loadChronicle();

  const entries = counterChronicleState.entries;
  const voiceCounts = {};
  for (const e of entries) {
    voiceCounts[e.voiceKey] = (voiceCounts[e.voiceKey] || 0) + 1;
  }

  const categoryCounts = {};
  for (const e of entries) {
    categoryCounts[e.category] = (categoryCounts[e.category] || 0) + 1;
  }

  return {
    milestone: 'ms_5',
    systemActive: true,
    totalCounterEntries: entries.length,
    kaelEntries: chronicleState.entries.filter(e => !e.isCounterEntry).length,
    templateCount: Object.keys(COUNTER_CHRONICLE_TEMPLATES).length,
    templateIds: Object.keys(COUNTER_CHRONICLE_TEMPLATES),
    voiceDistribution: voiceCounts,
    categoryDistribution: categoryCounts,
    chapterRegistered: !!CHRONICLE_CHAPTERS.counter_rival,
    chapterTitle: COUNTER_CHAPTER.title,
    availableVoices: Object.keys(VEYRA_VOICES).map(k => ({ key: k, label: VEYRA_VOICES[k].label, tone: VEYRA_VOICES[k].tone })),
  };
}

/**
 * Export the counter-chronicle spec as JSON for UE5 consumption.
 * @returns {object} { path, templateCount, voiceCount }
 */
export function exportCounterChronicleSpec() {
  const spec = {
    templates: COUNTER_CHRONICLE_TEMPLATES,
    voices: VEYRA_VOICES,
    chapter: COUNTER_CHAPTER,
    mirrorMap: {},
    exportedAt: Date.now(),
  };

  // Build mirror map for quick lookup
  for (const [ctId, ct] of Object.entries(COUNTER_CHRONICLE_TEMPLATES)) {
    for (const mt of ct.mirrorTemplates) {
      if (!spec.mirrorMap[mt]) spec.mirrorMap[mt] = [];
      spec.mirrorMap[mt].push(ctId);
    }
  }

  const outPath = join(process.cwd(), 'workspace',
    getActiveGame?.()?.id || 'shattered-crown', 'Data', 'counter-chronicle-spec.json');
  const dir = join(outPath, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(spec, null, 2));

  log.info(`Counter-chronicle spec exported: ${outPath}`);
  return {
    path: outPath,
    templateCount: Object.keys(COUNTER_CHRONICLE_TEMPLATES).length,
    voiceCount: Object.keys(VEYRA_VOICES).length,
    mirrorMappings: Object.keys(spec.mirrorMap).length,
  };
}

log.info('ms_5: Rival counter-chronicle loaded — Veyra\'s parallel narrative, 11 templates, 5 voice profiles, contradiction detection');

// ═══════════════════════════════════════════════════════════════════════════════
// ms_7: NG+ Previous-Age Chapter Integration
// ═══════════════════════════════════════════════════════════════════════════════
//
// When a player starts New Game+, the previous playthrough's chronicle is
// preserved as "previous age" entries. The new chronicle references them as
// historical records from a bygone era — entries from "the First Age," etc.
//
// The narrator treats previous-age entries differently:
//   - At low corruption: respectful references to past events
//   - At high corruption: claims to have orchestrated events across ages,
//     rewrites previous-age entries as part of the Crown's eternal plan
//
// Provides:
//   - archiveCurrentAge(): snapshots current chronicle as a numbered age
//   - beginNewAge(): starts fresh chronicle with previous-age chapter prepended
//   - getPreviousAgeEntries(): read-only access to past-age entries
//   - getPreviousAgeSummary(): condensed summary for UI display
//   - crossAgeNarratorCallback(): the narrator comments on past-age events
//

const PREVIOUS_AGES_PATH_REL = 'workspace/shattered-crown/Data/chronicle-previous-ages.json';

function getPreviousAgesPath() {
  const game = getActiveGame?.();
  return join(process.cwd(), 'workspace', game?.id || 'shattered-crown', 'Data', 'chronicle-previous-ages.json');
}

/**
 * In-memory previous ages state.
 */
const previousAgesState = {
  ages: [],   // Array of { ageNumber, archivedAt, entries, metadata, epilogue }
  loaded: false,
};

function loadPreviousAges() {
  if (previousAgesState.loaded) return previousAgesState;
  const filePath = getPreviousAgesPath();
  try {
    if (existsSync(filePath)) {
      const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
      previousAgesState.ages = raw.ages || [];
      previousAgesState.loaded = true;
      log.info(`Previous ages loaded: ${previousAgesState.ages.length} archived ages`);
    } else {
      previousAgesState.loaded = true;
    }
  } catch (err) {
    log.warn(`Failed to load previous ages: ${err.message}`);
    previousAgesState.loaded = true;
  }
  return previousAgesState;
}

function savePreviousAges() {
  const filePath = getPreviousAgesPath();
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify({ ages: previousAgesState.ages }, null, 2));
}

// ── Age Name Generator ──────────────────────────────────────────────────────

const AGE_NAMES = [
  'The First Age',
  'The Age of Fractures',
  'The Ashen Reckoning',
  'The Age of Silent Crowns',
  'The Twilight Reckoning',
  'The Age of Echoing Shards',
  'The Age of Forgotten Flames',
  'The Age of the Hollow Throne',
];

function getAgeName(ageNumber) {
  return ageNumber < AGE_NAMES.length
    ? AGE_NAMES[ageNumber]
    : `The ${ordinal(ageNumber + 1)} Age`;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ── Cross-Age Narrator Voices ───────────────────────────────────────────────

const CROSS_AGE_NARRATOR = {
  faithful: {
    intro: (ageName) => `[From the annals of ${ageName} — a previous Bearer walked these lands.]`,
    reference: (ageName, event) => `In ${ageName}, a similar event occurred: ${event}. The echoes persist.`,
    reflection: (ageName) => `The records of ${ageName} speak to those who listen. History rhymes, if never repeats.`,
  },
  dramatic: {
    intro: (ageName) => `[${ageName} — an age of heroes whose deeds still echo in the Crown's memory.]`,
    reference: (ageName, event) => `${ageName} saw ${event} — a tale the bards still sing, though the words grow hazy.`,
    reflection: (ageName) => `The glory of ${ageName} fades, but its lessons endure — for those wise enough to heed them.`,
  },
  grandiose: {
    intro: (ageName) => `[${ageName} — a lesser age, before the TRUE Crown-Bearer arose.]`,
    reference: (ageName, event) => `In ${ageName}, they attempted ${event}. A crude effort compared to the present Bearer's magnificence.`,
    reflection: (ageName) => `All of ${ageName} was merely prologue. The REAL story begins now.`,
  },
  megalomaniac: {
    intro: (ageName) => `[${ageName} — an age I orchestrated from beyond time itself, naturally.]`,
    reference: (ageName, event) => `${event} in ${ageName}? Yes, I arranged that. Everything serves the Crown's eternal plan.`,
    reflection: (ageName) => `${ageName} was my first draft. This age is my masterwork. You're welcome.`,
  },
};

/**
 * Archive the current chronicle as a previous age.
 * Snapshots all entries + metadata, assigns an age number, and persists.
 * Call this BEFORE beginNewAge() — archive first, then reset.
 *
 * @returns {object} { ageNumber, ageName, entriesArchived, archivedAt }
 */
export function archiveCurrentAge() {
  loadChronicle();
  loadPreviousAges();

  const ageNumber = previousAgesState.ages.length;
  const ageName = getAgeName(ageNumber);
  const reliability = getChronicleReliability();
  const tier = getNarratorTier(chronicleState.metadata.highestCorruption || 0);

  // Generate an epilogue for this age based on corruption
  let epilogue;
  if (reliability > 0.7) {
    epilogue = `And so ${ageName} drew to a close. The Bearer's journey ended — not in triumph alone, but in the quiet certainty that their choices mattered. The Crown remembers.`;
  } else if (reliability > 0.4) {
    epilogue = `${ageName} ended as it lived — in half-truths and glittering ambiguity. The Crown remembers what it chooses to remember.`;
  } else {
    epilogue = `${ageName} was PERFECT. Every moment, a MASTERSTROKE. The Crown has NEVER seen a more worthy Bearer. [Note: this assessment may not be accurate.]`;
  }

  const archivedAge = {
    ageNumber,
    ageName,
    archivedAt: Date.now(),
    entries: [...chronicleState.entries],
    metadata: {
      ...chronicleState.metadata,
      chaptersUsed: [...(chronicleState.metadata.chaptersUsed || [])],
    },
    epilogue,
    reliability: parseFloat(reliability.toFixed(3)),
    narratorState: tier.label,
    entryCount: chronicleState.entries.length,
  };

  previousAgesState.ages.push(archivedAge);
  savePreviousAges();

  log.info(`Chronicle age archived: ${ageName} (${chronicleState.entries.length} entries, reliability ${(reliability * 100).toFixed(1)}%)`);

  return {
    ageNumber,
    ageName,
    entriesArchived: chronicleState.entries.length,
    archivedAt: archivedAge.archivedAt,
    reliability: archivedAge.reliability,
    totalArchivedAges: previousAgesState.ages.length,
  };
}

/**
 * Begin a new age — resets the current chronicle and prepends a "Previous Ages"
 * chapter containing condensed summaries of all archived ages.
 *
 * @returns {object} { currentAgeNumber, ageName, previousAgesCount, preludeEntries }
 */
export function beginNewAge() {
  loadPreviousAges();

  if (previousAgesState.ages.length === 0) {
    return { error: 'No previous ages archived. Call archiveCurrentAge() first.' };
  }

  const currentAgeNumber = previousAgesState.ages.length;
  const currentAgeName = getAgeName(currentAgeNumber);

  // Reset chronicle state
  chronicleState.entries = [];
  chronicleState.metadata = {
    createdAt: Date.now(),
    lastEntryAt: null,
    entryCount: 0,
    highestCorruption: 0,
    chaptersUsed: new Set(),
    currentAge: currentAgeNumber,
    currentAgeName: currentAgeName,
    previousAgesCount: previousAgesState.ages.length,
  };
  chronicleState.loaded = true;

  // Register the previous-ages chapter if not present
  if (!CHRONICLE_CHAPTERS.previous_ages) {
    CHRONICLE_CHAPTERS.previous_ages = {
      order: -1, // Before everything
      title: 'Prologue — Echoes of Previous Ages',
      description: 'Records from ages past, when other Bearers walked these lands.',
      categories: ['previous_age'],
    };
  }

  // Generate prelude entries summarizing each previous age
  const preludeEntries = [];
  for (const age of previousAgesState.ages) {
    const summary = generateAgeSummary(age);
    const entry = {
      id: `prev_age_${age.ageNumber}_${Date.now()}`,
      templateId: 'previous_age_summary',
      category: 'previous_age',
      chapterTag: 'previous_ages',
      timestamp: Date.now() - (previousAgesState.ages.length - age.ageNumber) * 1000, // Order them
      importance: 5,
      loreWeight: 5,
      narratorTier: 'T0',
      narratorVoice: 'faithful',
      reliability: 1.0,
      isDistorted: false,
      isPreviousAge: true,
      ageNumber: age.ageNumber,
      ageName: age.ageName,
      narrativeText: summary,
      originalReliability: age.reliability,
      originalNarratorState: age.narratorState,
      originalEntryCount: age.entryCount,
    };
    preludeEntries.push(entry);
    chronicleState.entries.push(entry);
  }

  // Save the new chronicle
  saveChronicle();

  log.info(`New age begun: ${currentAgeName} (age #${currentAgeNumber}), ${preludeEntries.length} previous-age prelude entries added`);

  return {
    currentAgeNumber,
    ageName: currentAgeName,
    previousAgesCount: previousAgesState.ages.length,
    preludeEntries: preludeEntries.length,
    previousAgeNames: previousAgesState.ages.map(a => a.ageName),
  };
}

/**
 * Generate a narrative summary of an archived age.
 * @param {object} age — archived age object
 * @returns {string} narrative summary text
 */
function generateAgeSummary(age) {
  const lines = [];
  lines.push(`In ${age.ageName}, a Bearer walked the Shattered Realm.`);

  // Count event types
  const combatEntries = age.entries.filter(e => e.category === 'combat' || e.category === 'boss_encounter').length;
  const questEntries = age.entries.filter(e => e.category === 'quest').length;
  const shardEntries = age.entries.filter(e => e.category === 'shard').length;
  const deathEntries = age.entries.filter(e => e.category === 'death').length;
  const corruptionEntries = age.entries.filter(e => e.category === 'corruption').length;

  if (combatEntries > 0) lines.push(`They fought ${combatEntries} battle${combatEntries > 1 ? 's' : ''} across the realm.`);
  if (questEntries > 0) lines.push(`${questEntries} quest${questEntries > 1 ? 's' : ''} shaped their path.`);
  if (shardEntries > 0) lines.push(`They gathered ${shardEntries} shard${shardEntries > 1 ? 's' : ''} of the Crown.`);
  if (deathEntries > 0) lines.push(`${deathEntries} time${deathEntries > 1 ? 's' : ''} they fell and rose again.`);

  if (age.reliability > 0.7) {
    lines.push('Their chronicle stands as a faithful record of events.');
  } else if (age.reliability > 0.4) {
    lines.push('Their chronicle bears the marks of embellishment — truth and fiction intertwined.');
  } else {
    lines.push('Their chronicle is... unreliable. The Crown\'s corruption ran deep in that age.');
  }

  if (corruptionEntries > 5) {
    lines.push('The corruption touched them profoundly. Let this serve as warning.');
  }

  lines.push(age.epilogue);

  return lines.join(' ');
}

/**
 * Get entries from a specific previous age.
 * @param {number} ageNumber — 0-based age index
 * @param {object} [options] — { chapter, category, minImportance, limit }
 * @returns {object} { ageName, entries, total }
 */
export function getPreviousAgeEntries(ageNumber, options = {}) {
  loadPreviousAges();
  const age = previousAgesState.ages[ageNumber];
  if (!age) return { error: `Age ${ageNumber} not found. ${previousAgesState.ages.length} ages archived.` };

  let entries = age.entries;
  if (options.chapter) entries = entries.filter(e => e.chapterTag === options.chapter);
  if (options.category) entries = entries.filter(e => e.category === options.category);
  if (options.minImportance) entries = entries.filter(e => e.importance >= options.minImportance);
  if (options.limit) entries = entries.slice(0, options.limit);

  return {
    ageName: age.ageName,
    ageNumber: age.ageNumber,
    entries,
    total: entries.length,
    fullAgeEntries: age.entryCount,
    reliability: age.reliability,
    narratorState: age.narratorState,
  };
}

/**
 * Get a condensed summary of all previous ages for UI display.
 * @returns {object} { ages: [...], totalEntries, totalAges }
 */
export function getPreviousAgeSummary() {
  loadPreviousAges();
  return {
    ages: previousAgesState.ages.map(a => ({
      ageNumber: a.ageNumber,
      ageName: a.ageName,
      archivedAt: a.archivedAt,
      entryCount: a.entryCount,
      reliability: a.reliability,
      narratorState: a.narratorState,
      epilogue: a.epilogue,
    })),
    totalEntries: previousAgesState.ages.reduce((sum, a) => sum + a.entryCount, 0),
    totalAges: previousAgesState.ages.length,
  };
}

/**
 * Generate a cross-age narrator callback — the narrator comments on a
 * previous-age event in the context of the current chronicle.
 * @param {number} ageNumber — which age to reference
 * @param {string} eventSummary — short description of the event
 * @param {number} corruptionLevel — current corruption (0-1)
 * @returns {object} { narratorComment, voice, ageName }
 */
export function crossAgeNarratorCallback(ageNumber, eventSummary, corruptionLevel = 0) {
  loadPreviousAges();
  const age = previousAgesState.ages[ageNumber];
  if (!age) return { error: `Age ${ageNumber} not found.` };

  const tier = getNarratorTier(corruptionLevel);
  const voice = CROSS_AGE_NARRATOR[tier.voice] || CROSS_AGE_NARRATOR.faithful;

  return {
    narratorComment: voice.reference(age.ageName, eventSummary),
    voice: tier.voice,
    ageName: age.ageName,
    ageReliability: age.reliability,
  };
}

/**
 * Get the current age info.
 * @returns {object} { currentAge, ageName, previousAges, totalArchivedEntries }
 */
export function getCurrentAgeInfo() {
  loadChronicle();
  loadPreviousAges();

  const currentAge = chronicleState.metadata.currentAge || 0;
  const currentAgeName = chronicleState.metadata.currentAgeName || getAgeName(0);

  return {
    currentAge,
    ageName: currentAgeName,
    currentEntries: chronicleState.entries.length,
    previousAges: previousAgesState.ages.length,
    totalArchivedEntries: previousAgesState.ages.reduce((s, a) => s + a.entryCount, 0),
    previousAgeNames: previousAgesState.ages.map(a => a.ageName),
  };
}

log.info('ms_7: NG+ previous-age chapter integration loaded — archive/begin new age, cross-age narrator, age summaries');
