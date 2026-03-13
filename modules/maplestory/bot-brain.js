/**
 * modules/maplestory/bot-brain.js — Intelligence layer for MapleStory bots.
 *
 * Contains all game knowledge needed for bots to play like real players:
 * - Job advancement paths (NPC IDs, maps, level requirements)
 * - Skill point distribution builds per job
 * - Combat rotations per class/job
 * - Potion tier progression by level
 * - Training spot recommendations
 * - NPC dialog handler for multi-step conversations
 * - SP/AP auto-distribution logic
 */

import { createLogger } from '../../lib/logger.js';

const log = createLogger('maple:brain');

// ── Job Advancement Paths ───────────────────────────────────────────────────
// Level requirements, NPC IDs, map IDs for each job advancement per class.
// Cosmic v83 uses classic Adventurer advancement flow.

export const JOB_ADVANCEMENT = {
  warrior: {
    firstJob:  { level: 10, npcId: 1022000, mapId: 102000003, jobId: 100, name: 'Warrior' },
    secondJob: { level: 30, npcId: 1022000, mapId: 102000003, name: '2nd Job Warrior' },
    secondJobChoices: [
      { jobId: 110, name: 'Fighter' },
      { jobId: 120, name: 'Page' },
      { jobId: 130, name: 'Spearman' },
    ],
    thirdJob:  { level: 70, npcId: 2020008, mapId: 211000001, name: '3rd Job Warrior' },
    thirdJobChoices: [
      { fromJob: 110, jobId: 111, name: 'Crusader' },
      { fromJob: 120, jobId: 121, name: 'White Knight' },
      { fromJob: 130, jobId: 131, name: 'Dragon Knight' },
    ],
    fourthJob: { level: 120, npcId: 2081100, mapId: 240010501, name: '4th Job Warrior' },
    fourthJobChoices: [
      { fromJob: 111, jobId: 112, name: 'Hero' },
      { fromJob: 121, jobId: 122, name: 'Paladin' },
      { fromJob: 131, jobId: 132, name: 'Dark Knight' },
    ],
  },
  mage: {
    firstJob:  { level: 8, npcId: 1032001, mapId: 101000003, jobId: 200, name: 'Magician' },
    secondJob: { level: 30, npcId: 1032001, mapId: 101000003, name: '2nd Job Mage' },
    secondJobChoices: [
      { jobId: 210, name: 'F/P Wizard' },
      { jobId: 220, name: 'I/L Wizard' },
      { jobId: 230, name: 'Cleric' },
    ],
    thirdJob:  { level: 70, npcId: 2020009, mapId: 211000001, name: '3rd Job Mage' },
    thirdJobChoices: [
      { fromJob: 210, jobId: 211, name: 'F/P Mage' },
      { fromJob: 220, jobId: 221, name: 'I/L Mage' },
      { fromJob: 230, jobId: 231, name: 'Priest' },
    ],
    fourthJob: { level: 120, npcId: 2081200, mapId: 240010501, name: '4th Job Mage' },
    fourthJobChoices: [
      { fromJob: 211, jobId: 212, name: 'F/P Arch Mage' },
      { fromJob: 221, jobId: 222, name: 'I/L Arch Mage' },
      { fromJob: 231, jobId: 232, name: 'Bishop' },
    ],
  },
  archer: {
    firstJob:  { level: 10, npcId: 1012100, mapId: 100000201, jobId: 300, name: 'Archer' },
    secondJob: { level: 30, npcId: 1012100, mapId: 100000201, name: '2nd Job Archer' },
    secondJobChoices: [
      { jobId: 310, name: 'Hunter' },
      { jobId: 320, name: 'Crossbowman' },
    ],
    thirdJob:  { level: 70, npcId: 2020010, mapId: 211000001, name: '3rd Job Archer' },
    thirdJobChoices: [
      { fromJob: 310, jobId: 311, name: 'Ranger' },
      { fromJob: 320, jobId: 321, name: 'Sniper' },
    ],
    fourthJob: { level: 120, npcId: 2081300, mapId: 240010501, name: '4th Job Archer' },
    fourthJobChoices: [
      { fromJob: 311, jobId: 312, name: 'Bowmaster' },
      { fromJob: 321, jobId: 322, name: 'Marksman' },
    ],
  },
  thief: {
    firstJob:  { level: 10, npcId: 1052001, mapId: 103000003, jobId: 400, name: 'Rogue' },
    secondJob: { level: 30, npcId: 1052001, mapId: 103000003, name: '2nd Job Thief' },
    secondJobChoices: [
      { jobId: 410, name: 'Assassin' },
      { jobId: 420, name: 'Bandit' },
    ],
    thirdJob:  { level: 70, npcId: 2020011, mapId: 211000001, name: '3rd Job Thief' },
    thirdJobChoices: [
      { fromJob: 410, jobId: 411, name: 'Hermit' },
      { fromJob: 420, jobId: 421, name: 'Chief Bandit' },
    ],
    fourthJob: { level: 120, npcId: 2081400, mapId: 240010501, name: '4th Job Thief' },
    fourthJobChoices: [
      { fromJob: 411, jobId: 412, name: 'Night Lord' },
      { fromJob: 421, jobId: 422, name: 'Shadower' },
    ],
  },
  sage: {
    firstJob:  { level: 10, npcId: 9999030, mapId: 101050000, jobId: 600, name: 'Sage' },
    secondJob: { level: 30, npcId: 9999030, mapId: 101050000, name: '2nd Job Sage' },
    secondJobChoices: [{ jobId: 610, name: 'Elementalist' }],
    thirdJob:  { level: 70, npcId: 9999030, mapId: 101050000, name: '3rd Job Sage' },
    thirdJobChoices: [{ fromJob: 610, jobId: 611, name: 'Arcanum' }],
    fourthJob: { level: 120, npcId: 9999030, mapId: 101050000, name: '4th Job Sage' },
    fourthJobChoices: [{ fromJob: 611, jobId: 612, name: 'Archsage' }],
    jobIdChain: [0, 600, 610, 611, 612],
  },
  necromancer: {
    // Advancement NPCs at Necropolis hub map (990200000)
    firstJob:  { level: 10, npcId: 9990010, mapId: 990200000, jobId: 700, name: 'Necromancer' },
    secondJob: { level: 30, npcId: 9990011, mapId: 990200000, name: '2nd Job Necromancer' },
    secondJobChoices: [{ jobId: 710, name: 'Dark Acolyte' }],
    thirdJob:  { level: 70, npcId: 9990012, mapId: 990200000, name: '3rd Job Necromancer' },
    thirdJobChoices: [{ fromJob: 710, jobId: 711, name: 'Soul Reaper' }],
    fourthJob: { level: 120, npcId: 9990013, mapId: 990200000, name: '4th Job Necromancer' },
    fourthJobChoices: [{ fromJob: 711, jobId: 712, name: 'Lich King' }],
    jobIdChain: [0, 700, 710, 711, 712],
  },
};

// ── Skill Point Builds ──────────────────────────────────────────────────────
// Optimal SP allocation order per job ID. Array order = priority.
// Bot iterates the list and spends SP on the first skill not yet maxed.

export const SP_BUILDS = {
  // Beginner — no skills to train
  0: [],

  // ── Warriors ──
  100: [ // Warrior 1st job
    { skill: 1001004, max: 20 }, // Power Strike
    { skill: 1001003, max: 20 }, // Slash Blast
    { skill: 1000002, max: 10 }, // HP Recovery
    { skill: 1000001, max: 10 }, // Endure
    { skill: 1000000, max: 1 },  // Improved MaxHP
  ],
  110: [ // Fighter
    { skill: 1100000, max: 20 }, // Sword Mastery
    { skill: 1100001, max: 20 }, // Sword Booster
    { skill: 1101006, max: 20 }, // Power Guard
    { skill: 1101004, max: 20 }, // Rage
    { skill: 1101005, max: 30 }, // Sword FA
    { skill: 1101007, max: 30 }, // Ground Smash
  ],
  120: [ // Page
    { skill: 1200000, max: 20 }, // Sword Mastery
    { skill: 1200001, max: 20 }, // Sword Booster
    { skill: 1201006, max: 20 }, // Power Guard
    { skill: 1201004, max: 20 }, // Threaten
  ],
  130: [ // Spearman
    { skill: 1300000, max: 20 }, // Spear Mastery
    { skill: 1300001, max: 20 }, // Spear Booster
    { skill: 1301006, max: 20 }, // Iron Will
    { skill: 1301004, max: 20 }, // Hyper Body
    { skill: 1301007, max: 30 }, // Spear Sweep
  ],

  // ── Mages ──
  200: [ // Mage 1st job
    { skill: 2001002, max: 20 }, // Magic Guard (survival first)
    { skill: 2001004, max: 20 }, // Magic Claw (main attack)
    { skill: 2001003, max: 20 }, // Magic Armor
    { skill: 2000001, max: 10 }, // MP Recovery
  ],
  210: [ // F/P Wizard
    { skill: 2101004, max: 20 }, // Fire Arrow
    { skill: 2100000, max: 20 }, // MP Eater
    { skill: 2101001, max: 20 }, // Meditation
    { skill: 2101005, max: 20 }, // Poison Breath
    { skill: 2101003, max: 20 }, // Slow
  ],
  220: [ // I/L Wizard
    { skill: 2201004, max: 20 }, // Cold Beam
    { skill: 2200000, max: 20 }, // MP Eater
    { skill: 2201001, max: 20 }, // Meditation
    { skill: 2201005, max: 20 }, // Thunderbolt
  ],
  230: [ // Cleric
    { skill: 2301004, max: 20 }, // Heal
    { skill: 2301002, max: 20 }, // Holy Arrow
    { skill: 2301003, max: 20 }, // Invincible
    { skill: 2300000, max: 20 }, // MP Eater
    { skill: 2301005, max: 10 }, // Bless
  ],

  // ── Archers ──
  300: [ // Archer 1st job
    { skill: 3001004, max: 20 }, // Arrow Blow
    { skill: 3001005, max: 20 }, // Double Shot
    { skill: 3000001, max: 20 }, // Focus
    { skill: 3000002, max: 8 },  // Blessing of Amazon
  ],
  310: [ // Hunter
    { skill: 3100000, max: 20 }, // Bow Mastery
    { skill: 3100001, max: 20 }, // Bow Booster
    { skill: 3101005, max: 30 }, // Arrow Bomb
    { skill: 3101002, max: 20 }, // Power Knock-back
    { skill: 3101004, max: 30 }, // Soul Arrow
  ],
  320: [ // Crossbowman
    { skill: 3200000, max: 20 }, // Crossbow Mastery
    { skill: 3200001, max: 20 }, // Crossbow Booster
    { skill: 3201005, max: 30 }, // Iron Arrow
    { skill: 3201002, max: 20 }, // Power Knock-back
    { skill: 3201004, max: 30 }, // Soul Arrow
  ],

  // ── Thieves ──
  400: [ // Rogue 1st job
    { skill: 4001334, max: 20 }, // Lucky Seven
    { skill: 4001344, max: 20 }, // Double Stab
    { skill: 4000001, max: 20 }, // Disorder
    { skill: 4001003, max: 20 }, // Dark Sight
    { skill: 4000000, max: 10 }, // Nimble Body
  ],
  410: [ // Assassin
    { skill: 4100000, max: 20 }, // Claw Mastery
    { skill: 4100001, max: 20 }, // Critical Throw
    { skill: 4100002, max: 20 }, // Claw Booster
    { skill: 4101004, max: 20 }, // Haste
    { skill: 4101005, max: 30 }, // Drain
    { skill: 4101008, max: 5 },  // Flash Jump
  ],
  420: [ // Bandit
    { skill: 4200000, max: 20 }, // Dagger Mastery
    { skill: 4200001, max: 20 }, // Dagger Booster
    { skill: 4201004, max: 20 }, // Steal
    { skill: 4201002, max: 30 }, // Savage Blow
    { skill: 4201003, max: 20 }, // Haste
  ],

  // ── Sage (Custom Class) ──
  600: [ // Sage 1st job — Elemental Attunement first for passive INT gain
    { skill: 6001002, max: 10 }, // Elemental Attunement (passive INT/MAD)
    { skill: 6001000, max: 20 }, // Arcane Bolt (main attack)
    { skill: 6001001, max: 15 }, // Mana Shield (survival)
    { skill: 6001004, max: 10 }, // Runic Strike
    { skill: 6001005, max: 15 }, // Teleport
    { skill: 6001003, max: 5  }, // Sage's Wisdom
  ],
  610: [ // Elementalist 2nd job
    { skill: 6101004, max: 20 }, // Spell Mastery (passive damage boost — first)
    { skill: 6101000, max: 20 }, // Flame Pillar (main AoE attack)
    { skill: 6101005, max: 20 }, // Mana Surge (MP sustain)
    { skill: 6101001, max: 20 }, // Frost Nova (crowd control)
    { skill: 6101002, max: 20 }, // Lightning Chain
    { skill: 6101006, max: 20 }, // Arcane Barrier (damage shield)
    { skill: 6101003, max: 10 }, // Elemental Boost
    { skill: 6101007, max: 5  }, // Element Shift
  ],
  611: [ // Arcanum 3rd job
    { skill: 6111004, max: 20 }, // Sage Meditation (INT/MAD buff — first)
    { skill: 6111000, max: 30 }, // Meteor Shower (main nuke)
    { skill: 6111005, max: 20 }, // Runic Ward (damage reduction)
    { skill: 6111006, max: 30 }, // Arcane Explosion (AoE burst)
    { skill: 6111002, max: 30 }, // Thunder Spear (single target)
    { skill: 6111001, max: 20 }, // Blizzard (slow + damage)
    { skill: 6111003, max: 10 }, // Elemental Convergence
    { skill: 6111007, max: 3  }, // Mystic Door (utility)
  ],
  // ── Necromancer (Custom Class) ──
  700: [ // Necromancer 1st job — Dark Pact passive first for MAD bonus
    { skill: 7001002, max: 10 }, // Dark Pact (passive +MAD)
    { skill: 7001000, max: 20 }, // Death Bolt (main attack)
    { skill: 7001001, max: 10 }, // Soul Siphon (life steal passive)
    { skill: 7001003, max: 10 }, // Grave Embrace (passive +MaxMP)
    { skill: 7001004, max: 15 }, // Shadow Step (teleport)
  ],
  710: [ // Dark Acolyte 2nd job
    { skill: 7101003, max: 20 }, // Dark Mastery (passive mastery+MAD — first)
    { skill: 7101000, max: 20 }, // Bone Spear (main attack)
    { skill: 7101005, max: 20 }, // Death's Embrace (buff: +dark dmg, +MP regen)
    { skill: 7101004, max: 20 }, // Corpse Explosion (AoE)
    { skill: 7101001, max: 20 }, // Summon Skeleton (minion)
    { skill: 7101002, max: 20 }, // Curse of Weakness (debuff)
  ],
  711: [ // Soul Reaper 3rd job
    { skill: 7111003, max: 20 }, // Soul Shield (party buff — first)
    { skill: 7111000, max: 30 }, // Soul Harvest (AoE+lifesteal — main)
    { skill: 7111004, max: 20 }, // Death Mark (mob debuff)
    { skill: 7111001, max: 30 }, // Raise Undead Army (multi-summon)
    { skill: 7111002, max: 30 }, // Plague Cloud (DoT AoE)
  ],
  712: [ // Lich King 4th job
    { skill: 7121002, max: 30 }, // Death's Dominion (party buff — first)
    { skill: 7121000, max: 30 }, // Necrotic Blast (main nuke)
    { skill: 7121003, max: 30 }, // Apocalypse (ultimate AoE)
    { skill: 7121001, max: 30 }, // Summon Lich (powerful companion)
    { skill: 7121004, max: 30 }, // Undying Will (passive revive)
    { skill: 7121005, max: 30 }, // Dark Crescendo (passive stacking dmg)
  ],

  612: [ // Archsage 4th job
    { skill: 6121004, max: 30 }, // Sage's Enlightenment (passive mastery — first)
    { skill: 6121005, max: 30 }, // Arcane Mastery (magic booster)
    { skill: 6121000, max: 30 }, // Primordial Inferno (main fire nuke)
    { skill: 6121009, max: 30 }, // Elemental Storm (primary AoE)
    { skill: 6121002, max: 30 }, // Divine Thunder
    { skill: 6121006, max: 30 }, // Infinity (infinite MP for 40s)
    { skill: 6121001, max: 30 }, // Absolute Zero
    { skill: 6121003, max: 20 }, // Elemental Unity
    { skill: 6121008, max: 30 }, // Maple Warrior
    { skill: 6121007, max: 5  }, // Hero's Will
  ],
};

// ── Combat Rotations ────────────────────────────────────────────────────────
// Per-job combat behavior: what to attack with, what to buff, ranges.
// attackType: 'melee'=attackMelee, 'ranged'=attackRanged, 'magic'=attackMagic

export const COMBAT_ROTATIONS = {
  0: { // Beginner
    mainAttack: 0, buffs: [], attackType: 'melee', attackRange: 60, aoeAttack: null, aoeThreshold: 99,
  },
  100: { // Warrior 1st job
    mainAttack: 1001004, // Power Strike
    aoeAttack: 1001003,  // Slash Blast
    buffs: [1000002],    // HP Recovery
    attackType: 'melee', attackRange: 80, aoeThreshold: 3,
  },
  110: { // Fighter
    mainAttack: 1101007, aoeAttack: 1101007, // Ground Smash
    buffs: [1101004, 1100001], // Rage, Sword Booster
    attackType: 'melee', attackRange: 80, aoeThreshold: 3,
  },
  120: { // Page
    mainAttack: 1201006, aoeAttack: 1201006,
    buffs: [1200001, 1201004], // Sword Booster, Threaten
    attackType: 'melee', attackRange: 80, aoeThreshold: 3,
  },
  130: { // Spearman
    mainAttack: 1301007, aoeAttack: 1301007, // Spear Sweep
    buffs: [1300001, 1301004, 1301006], // Spear Booster, Hyper Body, Iron Will
    attackType: 'melee', attackRange: 100, aoeThreshold: 3,
  },
  200: { // Mage 1st job
    mainAttack: 2001004, aoeAttack: null, // Magic Claw
    buffs: [2001002, 2001003], // Magic Guard, Magic Armor
    attackType: 'magic', attackRange: 250, aoeThreshold: 99,
  },
  210: { // F/P Wizard
    mainAttack: 2101004, aoeAttack: 2101005, // Fire Arrow / Poison Breath
    buffs: [2001002, 2001003, 2101001], // MG, MA, Meditation
    attackType: 'magic', attackRange: 250, aoeThreshold: 3,
  },
  220: { // I/L Wizard
    mainAttack: 2201004, aoeAttack: 2201005, // Cold Beam / Thunderbolt
    buffs: [2001002, 2001003, 2201001], // MG, MA, Meditation
    attackType: 'magic', attackRange: 250, aoeThreshold: 3,
  },
  230: { // Cleric
    mainAttack: 2301002, aoeAttack: 2301004, // Holy Arrow / Heal (damages undead)
    buffs: [2001002, 2001003, 2301005, 2301003], // MG, MA, Bless, Invincible
    attackType: 'magic', attackRange: 250, aoeThreshold: 3,
  },
  300: { // Archer 1st job
    mainAttack: 3001004, aoeAttack: 3001005, // Arrow Blow / Double Shot
    buffs: [3000001], // Focus
    attackType: 'ranged', attackRange: 350, aoeThreshold: 99,
  },
  310: { // Hunter
    mainAttack: 3101005, aoeAttack: 3101005, // Arrow Bomb
    buffs: [3100001, 3101004], // Bow Booster, Soul Arrow
    attackType: 'ranged', attackRange: 350, aoeThreshold: 3,
  },
  320: { // Crossbowman
    mainAttack: 3201005, aoeAttack: 3201005, // Iron Arrow
    buffs: [3200001, 3201004], // Crossbow Booster, Soul Arrow
    attackType: 'ranged', attackRange: 350, aoeThreshold: 3,
  },
  400: { // Rogue 1st job
    mainAttack: 4001334, aoeAttack: null, // Lucky Seven
    buffs: [],
    attackType: 'ranged', attackRange: 250, aoeThreshold: 99,
  },
  410: { // Assassin
    mainAttack: 4101005, aoeAttack: null, // Drain
    buffs: [4100002, 4101004], // Claw Booster, Haste
    attackType: 'ranged', attackRange: 300, aoeThreshold: 99,
  },
  420: { // Bandit
    mainAttack: 4201002, aoeAttack: 4201002, // Savage Blow
    buffs: [4200001, 4201003], // Dagger Booster, Haste
    attackType: 'melee', attackRange: 70, aoeThreshold: 99,
  },

  // ── Necromancer (Custom Class) ──
  700: { // Necromancer 1st job
    mainAttack: 7001000, aoeAttack: 7001000, // Death Bolt
    buffs: [7001001, 7001002],               // Soul Siphon, Dark Pact
    attackType: 'magic', attackRange: 280, aoeThreshold: 99,
  },
  710: { // Dark Acolyte 2nd job
    mainAttack: 7101000, aoeAttack: 7101004, // Bone Spear / Corpse Explosion
    buffs: [7101003, 7101005],               // Dark Mastery, Death's Embrace
    attackType: 'magic', attackRange: 300, aoeThreshold: 3,
  },
  711: { // Soul Reaper 3rd job
    mainAttack: 7111000, aoeAttack: 7111002, // Soul Harvest / Plague Cloud
    buffs: [7111003, 7111004],               // Soul Shield, Death Mark
    attackType: 'magic', attackRange: 350, aoeThreshold: 3,
  },
  712: { // Lich King 4th job
    mainAttack: 7121000, aoeAttack: 7121003, // Necrotic Blast / Apocalypse
    buffs: [7121002, 7121004, 7121005],      // Death's Dominion, Undying Will, Dark Crescendo
    attackType: 'magic', attackRange: 400, aoeThreshold: 3,
  },

  // ── Sage (Custom Class) ──
  600: { // Sage 1st job
    mainAttack: 6001000, aoeAttack: 6001004, // Arcane Bolt / Runic Strike
    buffs: [6001001, 6001002],               // Mana Shield, Elemental Attunement
    attackType: 'magic', attackRange: 280, aoeThreshold: 99,
  },
  610: { // Elementalist 2nd job
    mainAttack: 6101000, aoeAttack: 6101000, // Flame Pillar (AoE main)
    buffs: [6101003, 6101004, 6101005, 6101006], // Boost, Mastery, Surge, Barrier
    attackType: 'magic', attackRange: 300, aoeThreshold: 3,
  },
  611: { // Arcanum 3rd job
    mainAttack: 6111000, aoeAttack: 6111006, // Meteor Shower / Arcane Explosion
    buffs: [6111004, 6111005],               // Sage Meditation, Runic Ward
    attackType: 'magic', attackRange: 350, aoeThreshold: 3,
  },
  612: { // Archsage 4th job
    mainAttack: 6121000, aoeAttack: 6121009, // Primordial Inferno / Elemental Storm
    buffs: [6121004, 6121005, 6121006, 6121008], // Enlightenment, Mastery, Infinity, MW
    attackType: 'magic', attackRange: 400, aoeThreshold: 3,
  },
};

// ── Potion Tiers ────────────────────────────────────────────────────────────
// Level-appropriate potions. Bots buy the best potion they can afford.

export const POTION_TIERS = {
  hp: [
    { minLevel: 1,  itemId: 2000000, name: 'Red Potion',     heals: 50,   price: 40 },
    { minLevel: 10, itemId: 2000001, name: 'Orange Potion',   heals: 150,  price: 100 },
    { minLevel: 20, itemId: 2000002, name: 'White Potion',    heals: 300,  price: 250 },
    { minLevel: 40, itemId: 2000006, name: 'Mana Elixir',     heals: 300,  price: 600 },
    { minLevel: 50, itemId: 2000004, name: 'Elixir',          heals: -1,   price: 3000 },   // 50% HP+MP
    { minLevel: 80, itemId: 2000005, name: 'Power Elixir',    heals: -2,   price: 10000 },  // 100% HP+MP
  ],
  mp: [
    { minLevel: 1,  itemId: 2000003, name: 'Blue Potion',     heals: 100,  price: 160 },
    { minLevel: 30, itemId: 2000006, name: 'Mana Elixir',     heals: 300,  price: 600 },
  ],
};

/**
 * Get the best potion for a given level and type.
 */
export function bestPotionForLevel(level, type = 'hp') {
  const tiers = POTION_TIERS[type] || POTION_TIERS.hp;
  let best = tiers[0];
  for (const tier of tiers) {
    if (level >= tier.minLevel) best = tier;
  }
  return best;
}

// ── Training Spots (10x rate server) ────────────────────────────────────────

export const TRAINING_SPOTS = [
  { minLv: 1,   maxLv: 8,   maps: [10000],       name: 'Mushroom Garden' },
  { minLv: 8,   maxLv: 15,  maps: [104040000],    name: 'Green Mushrooms' },
  { minLv: 15,  maxLv: 21,  maps: [101010100],    name: 'Slime Tree' },
  { minLv: 21,  maxLv: 30,  maps: [105040300],    name: 'Ant Tunnel' },
  { minLv: 30,  maxLv: 40,  maps: [103000800],    name: 'Kerning Square' },
  { minLv: 40,  maxLv: 50,  maps: [211040100],    name: 'White Fangs' },
  { minLv: 50,  maxLv: 60,  maps: [220050000],    name: 'Ludi Clocktower' },
  { minLv: 60,  maxLv: 70,  maps: [220070301],    name: 'Ghost Ship' },
  { minLv: 70,  maxLv: 85,  maps: [541010010],    name: 'MP3 (Singapore)' },
  { minLv: 85,  maxLv: 100, maps: [551030100],    name: 'Gallopera' },
  { minLv: 100, maxLv: 115, maps: [541020500],    name: 'Mysterious Path 3' },
  { minLv: 115, maxLv: 130, maps: [240040511],    name: 'Skeletal Soldiers' },
  { minLv: 130, maxLv: 150, maps: [240040520],    name: 'Skelegons' },
  { minLv: 150, maxLv: 200, maps: [240040521],    name: 'Nest Golems' },
  { minLv: 1,  maxLv: 12,  maps: [101050001], name: 'Sage Training Ground', classPref: 'sage' },
  { minLv: 12, maxLv: 35,  maps: [101050002], name: 'Sage Inner Sanctum', classPref: 'sage' },
  // Necromancer-specific training (Necropolis)
  { minLv: 1,  maxLv: 30,  maps: [990200100], name: 'Burial Vestibule', classPref: 'necromancer' },
  { minLv: 30, maxLv: 70,  maps: [990200100], name: 'Burial Vestibule (Deep)', classPref: 'necromancer' },
];

/**
 * Get the best training map for a given level.
 */
export function getTrainingMap(level) {
  for (const spot of TRAINING_SPOTS) {
    if (level >= spot.minLv && level <= spot.maxLv) {
      return spot.maps[Math.floor(Math.random() * spot.maps.length)];
    }
  }
  return 100000000; // Henesys fallback
}

// ── Job Advancement Logic ───────────────────────────────────────────────────

/**
 * Check if a bot can advance to the next job.
 * Returns the advancement info or null.
 */
export function canAdvanceJob(bot, classType) {
  const path = JOB_ADVANCEMENT[classType];
  if (!path) return null;

  const level = bot.stats.level;
  const jobId = bot.jobId;

  // Beginner → 1st Job
  if (jobId === 0 && level >= path.firstJob.level) {
    return { stage: 'first', ...path.firstJob };
  }

  // 1st Job → 2nd Job
  if (jobId === path.firstJob.jobId && level >= path.secondJob.level) {
    // Pick a random subclass
    const choice = path.secondJobChoices[Math.floor(Math.random() * path.secondJobChoices.length)];
    return { stage: 'second', ...path.secondJob, jobId: choice.jobId, choice: choice.name };
  }

  // 2nd Job → 3rd Job
  if (path.thirdJobChoices) {
    const match = path.thirdJobChoices.find(c => c.fromJob === jobId);
    if (match && level >= path.thirdJob.level) {
      return { stage: 'third', ...path.thirdJob, jobId: match.jobId, choice: match.name };
    }
  }

  // 3rd Job → 4th Job
  if (path.fourthJobChoices) {
    const match = path.fourthJobChoices.find(c => c.fromJob === jobId);
    if (match && level >= path.fourthJob.level) {
      return { stage: 'fourth', ...path.fourthJob, jobId: match.jobId, choice: match.name };
    }
  }

  return null;
}

// ── SP Auto-Distribution ────────────────────────────────────────────────────

/**
 * Distribute available SP for a bot according to the optimal build.
 * Calls bot.distributeSP() for each SP point spent.
 * @returns {number} number of SP points distributed
 */
export function autoDistributeSP(bot, spAvailable) {
  const build = SP_BUILDS[bot.jobId];
  if (!build || !build.length || spAvailable <= 0) return 0;

  let distributed = 0;
  let remaining = spAvailable;

  for (const entry of build) {
    if (remaining <= 0) break;
    const currentLevel = bot.skills.get(entry.skill) || 0;
    const canSpend = Math.min(remaining, entry.max - currentLevel);
    if (canSpend <= 0) continue;

    for (let i = 0; i < canSpend; i++) {
      bot.distributeSP(entry.skill);
      bot.skills.set(entry.skill, (bot.skills.get(entry.skill) || 0) + 1);
      distributed++;
      remaining--;
    }
    log.info({ bot: bot.name, skill: entry.skill, level: bot.skills.get(entry.skill) }, 'Distributed SP');
    break; // one skill per tick to space out the packets
  }

  return distributed;
}

// ── Combat Rotation Execution ───────────────────────────────────────────────

/**
 * Execute one combat tick using the appropriate rotation for the bot's job.
 * Returns true if an action was taken.
 */
export function combatTick(bot, entry) {
  const rotation = COMBAT_ROTATIONS[bot.jobId] || COMBAT_ROTATIONS[0];

  // 1. Check and refresh buffs (one buff per tick to space packets)
  for (const buffId of rotation.buffs) {
    const skillLevel = bot.skills.get(buffId) || 0;
    if (skillLevel > 0 && !bot.buffActive.has(buffId)) {
      bot.useSkill(buffId, skillLevel);
      return true;
    }
  }

  // 2. Find target mob (Phase 3: prefer mobs in assigned platform zone)
  let mob = null;
  const platform = entry._combatPlatform;
  if (platform) {
    // Prefer mobs in our zone
    let bestDist = Infinity;
    for (const [oid, m] of bot.monstersNearby) {
      const dx = m.x - bot.x, dy = m.y - bot.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < rotation.attackRange * 2 && isMobInMyZone(m, platform) && dist < bestDist) {
        bestDist = dist;
        mob = { ...m, oid, dist };
      }
    }
  }
  if (!mob) mob = bot.getNearestMonster(rotation.attackRange * 2);
  if (!mob) return false;

  // 3. Move into range
  if (mob.dist > rotation.attackRange) {
    bot.moveTo(mob.x, mob.y, mob.fh);
    return true;
  }

  // 4. Choose attack skill
  const skillId = rotation.mainAttack || 0;
  const skillLevel = bot.skills.get(skillId) || 0;

  // 5. Execute attack
  const dmg = entry.config.attackDamage + Math.floor(Math.random() * 20);
  switch (rotation.attackType) {
    case 'melee':  bot.attackMelee(mob.oid, dmg, skillId); break;
    case 'ranged': bot.attackRanged(mob.oid, dmg, skillId); break;
    case 'magic':  bot.attackMagic(mob.oid, dmg, skillId); break;
    default:       bot.attackMelee(mob.oid, dmg, 0); break;
  }

  return true;
}

// ── NPC Dialog Handler ──────────────────────────────────────────────────────
// Handles multi-step NPC conversations for job advancement, quests, etc.

export class NpcDialogHandler {
  /**
   * @param {MapleBot} bot - the bot instance
   * @param {Array<{action: number, selection?: number}>} flow - dialog steps
   * @param {Function} [onComplete] - called when dialog finishes
   */
  constructor(bot, flow, onComplete) {
    this.bot = bot;
    this.flow = flow;
    this.step = 0;
    this.complete = false;
    this._onComplete = onComplete;

    this._handler = ({ npcId, msgType, text }) => {
      if (this.complete) return;
      if (this.step >= this.flow.length) {
        this._finish();
        return;
      }
      const expected = this.flow[this.step];
      // Delay response to look human
      setTimeout(() => {
        if (this.complete) return;
        bot.npcChatAction(msgType, expected.action, expected.selection ?? -1);
        this.step++;
        if (this.step >= this.flow.length) {
          this._finish();
        }
      }, 500 + Math.random() * 1000);
    };
    bot.on('npcDialog', this._handler);
  }

  _finish() {
    this.complete = true;
    this.bot.removeListener('npcDialog', this._handler);
    if (this._onComplete) this._onComplete();
  }

  /** Cancel and clean up. */
  cancel() {
    this.complete = true;
    this.bot.removeListener('npcDialog', this._handler);
    this.bot.npcChatEnd();
  }
}

// ── Job Advancement Execution ───────────────────────────────────────────────

/**
 * Start the job advancement process for a bot.
 * Navigates to the NPC and handles the dialog.
 * @returns {Promise<boolean>} true if job change occurred
 */
export function startJobAdvancement(bot, classType) {
  return new Promise((resolve) => {
    const adv = canAdvanceJob(bot, classType);
    if (!adv) { resolve(false); return; }

    log.info({ bot: bot.name, stage: adv.stage, jobId: adv.jobId, npcMap: adv.mapId }, 'Starting job advancement');

    // Travel to NPC map
    bot.changeMap(adv.mapId);

    // Wait for map change, then find and talk to NPC
    const onMap = (mapId) => {
      bot.removeListener('mapChanged', onMap);

      // Find the job NPC
      setTimeout(() => {
        let npcOid = null;
        for (const [oid, npc] of bot.npcsNearby) {
          if (npc.npcId === adv.npcId) { npcOid = oid; break; }
        }
        if (!npcOid) {
          // NPC not visible — try talking by moving around
          log.warn({ bot: bot.name, npcId: adv.npcId }, 'Job NPC not found on map');
          resolve(false);
          return;
        }

        // Dialog flow for job advancement: Next → Next → (select class for 2nd+ job)
        const flow = [
          { action: 1 },  // Next
          { action: 1 },  // Yes/Accept
        ];
        // If 2nd job or later, may need to select a subclass (selection index 0)
        if (adv.stage !== 'first') {
          flow.push({ action: 1, selection: 0 });
        }

        const handler = new NpcDialogHandler(bot, flow, () => {
          log.info({ bot: bot.name, stage: adv.stage }, 'Job advancement dialog complete');
        });

        // Listen for actual job change
        const onJobChange = ({ jobId }) => {
          bot.removeListener('jobChanged', onJobChange);
          log.info({ bot: bot.name, newJob: jobId }, 'Job advanced!');
          resolve(true);
        };
        bot.on('jobChanged', onJobChange);

        // Timeout: cancel after 15s
        setTimeout(() => {
          handler.cancel();
          bot.removeListener('jobChanged', onJobChange);
          resolve(false);
        }, 15000);

        bot.talkToNpc(npcOid);
      }, 2000); // wait for NPCs to load
    };

    bot.on('mapChanged', onMap);
    // Timeout for map change
    setTimeout(() => {
      bot.removeListener('mapChanged', onMap);
    }, 10000);
  });
}

// ── Potion Threshold by Class ───────────────────────────────────────────────

export const COMBAT_THRESHOLDS = {
  warrior: { potHpRatio: 0.5, potMpRatio: 0.3 },
  mage:    { potHpRatio: 0.7, potMpRatio: 0.5 },
  archer:  { potHpRatio: 0.4, potMpRatio: 0.3 },
  thief:   { potHpRatio: 0.4, potMpRatio: 0.2 },
  sage:        { potHpRatio: 0.6, potMpRatio: 0.6 },
  necromancer: { potHpRatio: 0.7, potMpRatio: 0.5 }, // necros use MP heavily but have life steal
};

// ── Job ID Helpers ──────────────────────────────────────────────────────────

/** Get the class type string for a job ID. */
export function getClassType(jobId) {
  if (jobId === 0) return null;
  const base = Math.floor(jobId / 100);
  switch (base) {
    case 1: return 'warrior';
    case 2: return 'mage';
    case 3: return 'archer';
    case 4: return 'thief';
    case 6: return 'sage';
    case 7: return 'necromancer';
    default: return null;
  }
}

/** Get the job advancement stage (0-4) for a job ID. */
export function getJobStage(jobId) {
  if (jobId === 0) return 0;
  if (jobId % 10 === 0 && jobId % 100 !== 0) return 1; // 100,200,300,400
  if (jobId % 10 === 0) return 2; // 110,120,130,...
  if (jobId % 10 === 1) return 3; // 111,121,131,...
  if (jobId % 10 === 2) return 4; // 112,122,132,...
  return 1;
}

// ═══════════════════════════════════════════════════════════════════════════
// ══ PHASE 2: Social Intelligence & Self-Sufficiency ═════════════════════
// ═══════════════════════════════════════════════════════════════════════════

// ── Gear Tiers ──────────────────────────────────────────────────────────
// Best NPC-purchasable gear per class per level tier.
// equip slot: -1=hat, -5=top, -6=bottom, -7=shoes, -8=gloves, -11=weapon
// All these are standard NPC shop items on Cosmic v83.

export const GEAR_TIERS = {
  warrior: [
    { minLv: 10, weapon: 1302000, wSlot: -11, name: 'Sword' },           // Iron Sword
    { minLv: 15, weapon: 1402000, wSlot: -11, name: 'Polearm' },         // Iron Axe
    { minLv: 20, weapon: 1302004, wSlot: -11, name: 'Machete' },
    { minLv: 25, weapon: 1302006, wSlot: -11, name: 'Eloon' },
    { minLv: 30, weapon: 1302008, wSlot: -11, name: 'Gladius' },
    { minLv: 35, weapon: 1302009, wSlot: -11, name: 'Cutlus' },
    { minLv: 40, weapon: 1302011, wSlot: -11, name: 'Jeweled Katar' },
    { minLv: 50, weapon: 1302014, wSlot: -11, name: 'Viking Sword' },
    { minLv: 60, weapon: 1302016, wSlot: -11, name: 'Executioner' },
    { minLv: 70, weapon: 1302023, wSlot: -11, name: 'Stonetooth Sword' },
  ],
  mage: [
    { minLv: 8,  weapon: 1372000, wSlot: -11, name: 'Wooden Wand' },
    { minLv: 13, weapon: 1372002, wSlot: -11, name: 'Hardwood Wand' },
    { minLv: 18, weapon: 1372001, wSlot: -11, name: 'Metal Wand' },
    { minLv: 23, weapon: 1372003, wSlot: -11, name: 'Ice Wand' },
    { minLv: 28, weapon: 1372005, wSlot: -11, name: 'Fairy Wand' },
    { minLv: 33, weapon: 1382000, wSlot: -11, name: 'Wooden Staff' },
    { minLv: 38, weapon: 1382001, wSlot: -11, name: 'Sapphire Staff' },
    { minLv: 43, weapon: 1382002, wSlot: -11, name: 'Emerald Staff' },
    { minLv: 48, weapon: 1382003, wSlot: -11, name: 'Old Wooden Staff' },
    { minLv: 58, weapon: 1382012, wSlot: -11, name: 'Elemental Staff 1' },
  ],
  archer: [
    { minLv: 10, weapon: 1452000, wSlot: -11, name: 'War Bow' },
    { minLv: 15, weapon: 1452001, wSlot: -11, name: 'Composite Bow' },
    { minLv: 20, weapon: 1452002, wSlot: -11, name: 'Hunter Bow' },
    { minLv: 25, weapon: 1452003, wSlot: -11, name: 'Battle Bow' },
    { minLv: 30, weapon: 1452004, wSlot: -11, name: 'Ryden' },
    { minLv: 35, weapon: 1452005, wSlot: -11, name: 'Red Viper' },
    { minLv: 40, weapon: 1452006, wSlot: -11, name: 'Vaulter 2000' },
    { minLv: 50, weapon: 1452007, wSlot: -11, name: 'Olympus' },
    { minLv: 60, weapon: 1452008, wSlot: -11, name: 'Gold Hinkel' },
    { minLv: 70, weapon: 1452016, wSlot: -11, name: 'Asianic Bow' },
  ],
  thief: [
    { minLv: 10, weapon: 1472000, wSlot: -11, name: 'Garnier' },         // Claw
    { minLv: 15, weapon: 1472001, wSlot: -11, name: 'Cole' },
    { minLv: 20, weapon: 1472003, wSlot: -11, name: 'Guardian' },
    { minLv: 25, weapon: 1472004, wSlot: -11, name: 'Mithril Guards' },
    { minLv: 30, weapon: 1472005, wSlot: -11, name: 'Adamantium Guards' },
    { minLv: 35, weapon: 1472007, wSlot: -11, name: 'Bronze Igor' },
    { minLv: 40, weapon: 1472008, wSlot: -11, name: 'Mithril Igor' },
    { minLv: 43, weapon: 1472009, wSlot: -11, name: 'Adamantium Igor' },
    { minLv: 50, weapon: 1472011, wSlot: -11, name: 'Silver Mane' },
    { minLv: 60, weapon: 1472014, wSlot: -11, name: 'Gold Taurus' },
  ],
  // Necromancer uses staves (same pool as mage — Grizelda also stocks standard wands/staves)
  necromancer: [
    { minLv: 8,  weapon: 1372000, wSlot: -11, name: 'Wooden Wand' },
    { minLv: 13, weapon: 1372002, wSlot: -11, name: 'Hardwood Wand' },
    { minLv: 18, weapon: 1372001, wSlot: -11, name: 'Metal Wand' },
    { minLv: 23, weapon: 1372003, wSlot: -11, name: 'Ice Wand' },
    { minLv: 28, weapon: 1372005, wSlot: -11, name: 'Fairy Wand' },
    { minLv: 33, weapon: 1382000, wSlot: -11, name: 'Wooden Staff' },
    { minLv: 38, weapon: 1382001, wSlot: -11, name: 'Sapphire Staff' },
    { minLv: 48, weapon: 1382003, wSlot: -11, name: 'Old Wooden Staff' },
    { minLv: 58, weapon: 1382012, wSlot: -11, name: 'Elemental Staff 1' },
    { minLv: 70, weapon: 1382081, wSlot: -11, name: 'Phoenix Staff' },  // Custom Cosmic weapon
  ],
};

// Common armor NPC items (shared across classes, lighter than per-class)
export const ARMOR_TIERS = [
  { minLv: 0,  hat: 1002011, top: 1040002, bottom: 1060002, shoes: 1072001, gloves: 1082002 },
  { minLv: 10, hat: 1002012, top: 1040006, bottom: 1060006, shoes: 1072004, gloves: 1082007 },
  { minLv: 20, hat: 1002024, top: 1040018, bottom: 1060016, shoes: 1072014, gloves: 1082014 },
  { minLv: 30, hat: 1002037, top: 1040036, bottom: 1060026, shoes: 1072028, gloves: 1082023 },
  { minLv: 40, hat: 1002054, top: 1040057, bottom: 1060042, shoes: 1072037, gloves: 1082029 },
  { minLv: 50, hat: 1002064, top: 1040067, bottom: 1060049, shoes: 1072045, gloves: 1082036 },
  { minLv: 60, hat: 1002082, top: 1040081, bottom: 1060057, shoes: 1072051, gloves: 1082042 },
];

// ── Gear shop NPCs per town ──────────────────────────────────────────────

export const WEAPON_SHOP_NPCS = {
  100000000: 1012003,   // Henesys — Mr. Smith (weapons)
  101000000: 1012003,   // Ellinia
  102000000: 1022005,   // Perion — Mr. Thunder (warrior weapons)
  103000000: 1032006,   // Kerning — Vicious (thief weapons)
  211000000: 2020005,   // El Nath
  220000000: 2040004,   // Ludibrium
  240000000: 2050004,   // Leafre
  990200000: 9990014,   // Necropolis — Grizelda the Bone Merchant (custom Cosmic)
};

export const ARMOR_SHOP_NPCS = {
  100000000: 1012004,   // Henesys — Rina (armor)
  101000000: 1012004,   // Ellinia
  102000000: 1022006,   // Perion
  103000000: 1032007,   // Kerning
  211000000: 2020006,   // El Nath
  220000000: 2040005,   // Ludibrium
  240000000: 2050005,   // Leafre
  990200000: 9990014,   // Necropolis — Grizelda the Bone Merchant
};

/**
 * Get the best weapon for a class and level.
 */
export function bestWeaponForLevel(classType, level) {
  const tiers = GEAR_TIERS[classType];
  if (!tiers) return null;
  let best = null;
  for (const tier of tiers) {
    if (level >= tier.minLv) best = tier;
  }
  return best;
}

/**
 * Get the best armor set for a level.
 */
export function bestArmorForLevel(level) {
  let best = ARMOR_TIERS[0];
  for (const tier of ARMOR_TIERS) {
    if (level >= tier.minLv) best = tier;
  }
  return best;
}

/**
 * Check if bot needs a gear upgrade. Returns items to buy or null.
 */
export function checkGearUpgrades(bot, classType) {
  const upgrades = [];
  const level = bot.stats.level;

  // Check weapon
  const bestWeapon = bestWeaponForLevel(classType, level);
  if (bestWeapon) {
    // Check if bot already has this weapon equipped (slot -11)
    const equipped = bot.inventory.equip.get(-11);
    if (!equipped || equipped.itemId !== bestWeapon.weapon) {
      upgrades.push({ type: 'weapon', itemId: bestWeapon.weapon, slot: -11, name: bestWeapon.name });
    }
  }

  // Check armor
  const bestArmor = bestArmorForLevel(level);
  if (bestArmor) {
    const slots = [
      { key: 'hat',    itemId: bestArmor.hat,    slot: -1 },
      { key: 'top',    itemId: bestArmor.top,    slot: -5 },
      { key: 'bottom', itemId: bestArmor.bottom, slot: -6 },
      { key: 'shoes',  itemId: bestArmor.shoes,  slot: -7 },
      { key: 'gloves', itemId: bestArmor.gloves, slot: -8 },
    ];
    for (const s of slots) {
      const equipped = bot.inventory.equip.get(s.slot);
      if (!equipped || equipped.itemId !== s.itemId) {
        upgrades.push({ type: s.key, itemId: s.itemId, slot: s.slot, name: s.key });
      }
    }
  }

  return upgrades.length > 0 ? upgrades : null;
}

// ── Quest Knowledge ─────────────────────────────────────────────────────
// Simple quests that bots can auto-complete (start NPC + complete NPC same map).
// These are common v83 quests that give good rewards.

export const AUTO_QUESTS = [
  { id: 2000, npcId: 2010007, mapId: 200000000, minLv: 20, name: 'Orbis quest line' },
  { id: 2010, npcId: 1032001, mapId: 101000003, minLv: 8,  name: 'Grendel quest' },
  { id: 2050, npcId: 1022000, mapId: 102000003, minLv: 10, name: 'Perion quest' },
  { id: 2051, npcId: 1012100, mapId: 100000201, minLv: 10, name: 'Henesys quest' },
  // -- Custom Cosmic quests (The Vault Conspiracy chain via Treasure Hunter Kai) --
  { id: 99006, npcId: 9999010, mapId: 102000000, minLv: 15, name: 'Vault Conspiracy Pt.1', custom: true },
  { id: 99007, npcId: 9999010, mapId: 102000000, minLv: 25, name: 'Vault Conspiracy Pt.2', custom: true },
  { id: 99008, npcId: 9999010, mapId: 102000000, minLv: 35, name: 'Vault Conspiracy Pt.3', custom: true },
  { id: 99009, npcId: 9999010, mapId: 102000000, minLv: 45, name: 'Vault Conspiracy Pt.4', custom: true },
  // -- Sage Hall quest chain (Sage Instructor Elara) --
  { id: 99210, npcId: 9999030, mapId: 101050000, minLv: 1,  name: 'A New Beginning', custom: true, classPref: 'sage' },
  { id: 99211, npcId: 9999030, mapId: 101050000, minLv: 8,  name: 'The Shroom Menace', custom: true, classPref: 'sage' },
  { id: 99212, npcId: 9999030, mapId: 101050000, minLv: 15, name: 'Awakening the Inner Sanctum', custom: true, classPref: 'sage' },
  // -- Necromancer advancement quests (Mordecai the Gravedigger) --
  { id: 99301, npcId: 9990010, mapId: 990200000, minLv: 8,  name: 'The Gravedigger\'s Test', custom: true, classPref: 'necromancer' },
  { id: 99302, npcId: 9990011, mapId: 990200000, minLv: 28, name: 'Lady Vesper\'s Trial', custom: true, classPref: 'necromancer' },
  { id: 99303, npcId: 9990012, mapId: 990200000, minLv: 68, name: 'The Bone Oracle\'s Ordeal', custom: true, classPref: 'necromancer' },
  { id: 99304, npcId: 9990013, mapId: 990200000, minLv: 118, name: 'Kael\'Mortis and the Final Rite', custom: true, classPref: 'necromancer' },
];

// Custom NPC registry -- bot knowledge of Cosmic-specific NPCs
export const CUSTOM_NPCS = {
  nurseJoy:       { npcId: 9999009, mapId: 100000000, purpose: 'healer',      desc: 'Free HP/MP heal in Henesys' },
  taskboard:      { npcId: 9999013, mapId: 100000000, purpose: 'dailyQuest',  desc: 'Cosmic Taskboard - 3 daily quests per day' },
  kai:            { npcId: 9999010, mapId: 102000000, purpose: 'questTrade',  desc: 'Trophy exchange + Vault Conspiracy quest chain' },
  gemTraderSafi:  { npcId: 9999007, mapId: 101000000, purpose: 'tradeShop',   desc: 'Ore exchange for equipment' },
  sageInstructor: { npcId: 9999030, mapId: 101050000, purpose: 'advancement', desc: 'Sage class advancement NPC (all 4 tiers)' },
  arenaRex:       { npcId: 9999006, mapId: 100000000, purpose: 'training',    desc: 'Training advisor + map warps' },
  blacksmithTaro: { npcId: 9999001, mapId: 100000000, purpose: 'shop',        desc: 'Job-specific starter weapons' },
  alchemistLuna:  { npcId: 9999002, mapId: 101000000, purpose: 'shop',        desc: 'Potions and cure items' },
  // ── Necromancer class NPCs (Necropolis hub 990200000) ──
  mordecai:       { npcId: 9990010, mapId: 990200000, purpose: 'advancement', desc: 'Necromancer 1st job — Mordecai the Gravedigger' },
  ladyVesper:     { npcId: 9990011, mapId: 990200000, purpose: 'advancement', desc: 'Necromancer 2nd job — Lady Vesper / Death Disciple' },
  boneOracle:     { npcId: 9990012, mapId: 990200000, purpose: 'advancement', desc: 'Necromancer 3rd job — The Bone Oracle / Soul Reaper' },
  kaelMortis:     { npcId: 9990013, mapId: 990200000, purpose: 'advancement', desc: 'Necromancer 4th job — Kael\'Mortis the Eternal / Ancient Lich' },
  grizelda:       { npcId: 9990014, mapId: 990200000, purpose: 'shop',        desc: 'Necromancer gear — Grizelda the Bone Merchant' },
};

/**
 * Get available quests for bot's level and map.
 */
export function getAvailableQuests(bot) {
  return AUTO_QUESTS.filter(q =>
    bot.stats.level >= q.minLv &&
    bot.mapId === q.mapId &&
    !bot._completedQuests?.has(q.id)
  );
}

// ── Party Formation Logic ───────────────────────────────────────────────

/**
 * Decide if bot should try to form a party.
 * Returns true if: no party, 2+ bots on same map, or real players nearby.
 */
export function shouldFormParty(bot, nearbyBotCount) {
  if (bot.partyId) return false;
  if (nearbyBotCount >= 2) return true;
  // Invite real players if they've been on the same map for a while
  return bot.playersNearby.size > 0;
}

// ── Smart Chat: Context-Aware Responses ─────────────────────────────────
// Returns dynamic responses based on game state.

export function getContextResponse(bot, classType, message) {
  const lower = message.toLowerCase();

  // Job/class questions
  if (lower.includes('what class') || lower.includes('what job')) {
    const names = { 0: 'Beginner', 100: 'Warrior', 200: 'Magician', 300: 'Archer', 400: 'Rogue',
      110: 'Fighter', 120: 'Page', 130: 'Spearman', 210: 'F/P Wizard', 220: 'I/L Wizard',
      230: 'Cleric', 310: 'Hunter', 320: 'Crossbowman', 410: 'Assassin', 420: 'Bandit',
      111: 'Crusader', 121: 'White Knight', 131: 'Dragon Knight', 211: 'F/P Mage',
      221: 'I/L Mage', 231: 'Priest', 311: 'Ranger', 321: 'Sniper', 411: 'Hermit',
      421: 'Chief Bandit', 112: 'Hero', 122: 'Paladin', 132: 'Dark Knight',
      212: 'F/P Arch Mage', 222: 'I/L Arch Mage', 232: 'Bishop', 312: 'Bowmaster',
      322: 'Marksman', 412: 'Night Lord', 422: 'Shadower',
      600: 'Sage', 610: 'Elementalist', 611: 'Arcanum', 612: 'Archsage',
      700: 'Necromancer', 710: 'Dark Acolyte', 711: 'Soul Reaper', 712: 'Lich King' };
    return names[bot.jobId] || `Job ${bot.jobId}`;
  }

  // Training advice
  if (lower.includes('where') && (lower.includes('train') || lower.includes('grind') || lower.includes('level'))) {
    for (const spot of TRAINING_SPOTS) {
      if (bot.stats.level >= spot.minLv && bot.stats.level <= spot.maxLv) {
        return `Try ${spot.name}! Good for lv${spot.minLv}-${spot.maxLv}`;
      }
    }
  }

  // Damage/stats sharing
  if (lower.includes('damage') || lower.includes('range') || lower.includes('stats')) {
    const { str, dex, int: int_, luk } = bot.stats;
    switch (classType) {
      case 'warrior': return `${str} STR, ${dex} DEX. Hitting pretty hard!`;
      case 'mage':    return `${int_} INT, ${luk} LUK. Magic goes brrr`;
      case 'archer':  return `${dex} DEX, ${str} STR. Pew pew!`;
      case 'thief':   return `${luk} LUK, ${dex} DEX. Crits for days`;
      case 'sage':    return `${int_} INT, ${luk} LUK. Arcane power!`;
    }
  }

  // Meso/economy
  if (lower.includes('meso') || lower.includes('money') || lower.includes('rich') || lower.includes('poor')) {
    const m = bot.stats.meso;
    if (m > 1000000) return `Sitting on ${(m / 1000000).toFixed(1)}m mesos`;
    if (m > 100000)  return `Got ${Math.floor(m / 1000)}k mesos, decent`;
    return "Pretty broke ngl";
  }

  // Guild
  if (lower.includes('guild')) {
    if (bot.guildId) return `I'm in ${bot.guildName}! Join us!`;
    return 'Looking for a guild, hmu!';
  }

  // Boss/PQ related
  if (lower.includes('zakum') || lower.includes('horntail') || lower.includes('ht') || lower.includes('boss')) {
    if (bot.stats.level >= 100) return "I'm down for bossing! When?";
    return `Need more levels first, only ${bot.stats.level}`;
  }

  if (lower.includes('pq') || lower.includes('party quest')) {
    if (bot.stats.level >= 21 && bot.stats.level <= 30) return 'Kerning PQ? Im there!';
    if (bot.stats.level >= 35 && bot.stats.level <= 50) return 'Ludi PQ anyone?';
    if (bot.stats.level >= 51 && bot.stats.level <= 70) return 'Romeo/Juliet PQ?';
    return 'Not the right level for PQs rn';
  }

  return null; // no context match
}

// ── Proactive Chat Topics ───────────────────────────────────────────────
// Things bots say based on their current state.

export function getProactiveChatLine(bot, classType) {
  const level = bot.stats.level;
  const jobId = bot.jobId;

  // Just advanced job
  if (level === 30 && getJobStage(jobId) === 2) {
    const lines = ['2nd job feels so much stronger!', 'New skills are amazing!', 'Finally advanced!'];
    return lines[Math.floor(Math.random() * lines.length)];
  }

  // Low HP grind
  if (bot.stats.maxHp > 0 && bot.stats.hp / bot.stats.maxHp < 0.3) {
    const lines = ['Ow that hurt...', 'Need pots!', 'Close call!', 'Almost died there'];
    return lines[Math.floor(Math.random() * lines.length)];
  }

  // Level milestone
  if (level % 10 === 0 && level > 0) {
    return `Level ${level}! ${level >= 70 ? 'Getting there!' : level >= 120 ? 'End game soon!' : 'Nice!'}`;
  }

  // Rich brag
  if (bot.stats.meso > 5000000) {
    const lines = ['Making bank today', 'Mesos flowing~', 'NX when?'];
    return lines[Math.floor(Math.random() * lines.length)];
  }

  // Class-specific flavor
  const flavorLines = {
    warrior: ['Slash everything!', 'Tank mode ON', 'Need more HP...', 'Warriors rule!'],
    mage:    ['Magic go brrr', 'MP drain is real', 'Teleport spam~', 'Need more INT gear'],
    archer:  ['Long range best range', 'Arrow Rain!', 'Stay back!', 'Need Soul Arrow up'],
    thief:   ['Haste makes waste? Nah', 'Shadow partner!', 'Too fast too furious', 'Meso explosion!'],
    sage:    ['Arcane power flows!', 'Elements are mine to command', 'Mana is life~',
              'Custom class ftw', 'Sage Hall represent', 'Elemental mastery!'],
  };
  const lines = flavorLines[classType] || flavorLines.warrior;
  return lines[Math.floor(Math.random() * lines.length)];
}

// ── Whisper/DM Conversation Logic ───────────────────────────────────────

/** Generate a proactive whisper message to a nearby player. */
export function generateWhisperTopic(bot, classType, playerName) {
  const topics = [];
  const level = bot.stats.level;

  if (level >= 20 && level <= 50) {
    topics.push(`Hey ${playerName}! Wanna PQ together?`);
  }
  if (!bot.guildId) {
    topics.push(`Hey ${playerName}, know any good guilds?`);
  }
  if (bot.guildId) {
    topics.push(`Hey ${playerName}! Wanna join ${bot.guildName}?`);
  }
  if (level >= 50) {
    topics.push(`Hey ${playerName}, what lvl are you? Wanna grind?`);
  }
  topics.push(`Hey ${playerName}! Nice seeing you here`);

  return topics[Math.floor(Math.random() * topics.length)];
}

// ── Gear Buy Flow ───────────────────────────────────────────────────────

/**
 * Execute a gear purchase: travel to shop, buy item, equip it.
 * @returns {Promise<boolean>} true if purchase+equip succeeded
 */
// ═══════════════════════════════════════════════════════════════════════════
// ══ PHASE 3: Advanced AI — Adaptation, Bosses, Economy, Reputation ═════
// ═══════════════════════════════════════════════════════════════════════════

// ── Adaptive Training Tracker ───────────────────────────────────────────
// Tracks kill rate, death rate, and efficiency per map. Learns the best spots.

export class TrainingTracker {
  constructor() {
    this.mapStats = new Map(); // mapId → { kills, deaths, timeSpent, arrivedAt }
    this.currentMap = 0;
    this._arrivedAt = 0;
  }

  enterMap(mapId) {
    // Record time spent on previous map
    if (this.currentMap && this._arrivedAt) {
      const stats = this._getOrCreate(this.currentMap);
      stats.timeSpent += Date.now() - this._arrivedAt;
    }
    this.currentMap = mapId;
    this._arrivedAt = Date.now();
  }

  recordKill(mapId) {
    this._getOrCreate(mapId).kills++;
  }

  recordDeath(mapId) {
    this._getOrCreate(mapId).deaths++;
  }

  /** Get kills per minute for a map. */
  getKillRate(mapId) {
    const stats = this.mapStats.get(mapId);
    if (!stats || stats.timeSpent < 30000) return 0; // need 30s minimum data
    return (stats.kills / stats.timeSpent) * 60000;
  }

  /** Get death rate for a map. */
  getDeathRate(mapId) {
    const stats = this.mapStats.get(mapId);
    if (!stats || stats.timeSpent < 30000) return 0;
    return (stats.deaths / stats.timeSpent) * 60000;
  }

  /** Should bot switch training spots? Returns true if current map is bad. */
  shouldSwitch(mapId, playersNearby) {
    const killRate = this.getKillRate(mapId);
    const deathRate = this.getDeathRate(mapId);
    // Switch if dying more than 1/min or killing less than 2/min (very slow)
    if (deathRate > 1) return { reason: 'dying_too_much', deathRate };
    if (killRate > 0 && killRate < 2) return { reason: 'too_slow', killRate };
    // Switch if map is crowded (3+ other players — mobs contested)
    if (playersNearby >= 3) return { reason: 'crowded', playersNearby };
    return null;
  }

  /** Get the best known map for training. */
  getBestMap(level) {
    let bestMap = null;
    let bestRate = 0;
    for (const [mapId, stats] of this.mapStats) {
      if (stats.timeSpent < 60000) continue; // need 1min data
      const rate = (stats.kills / stats.timeSpent) * 60000;
      const deathPenalty = (stats.deaths / Math.max(1, stats.kills)) * 10;
      const score = rate - deathPenalty;
      if (score > bestRate) { bestRate = score; bestMap = mapId; }
    }
    // Fall back to the brain's default if no good data
    return bestMap || getTrainingMap(level);
  }

  _getOrCreate(mapId) {
    let stats = this.mapStats.get(mapId);
    if (!stats) { stats = { kills: 0, deaths: 0, timeSpent: 0 }; this.mapStats.set(mapId, stats); }
    return stats;
  }

  export() {
    return [...this.mapStats.entries()].map(([mapId, s]) => [mapId, { ...s }]);
  }

  import(data) {
    if (!data) return;
    for (const [mapId, stats] of data) {
      this.mapStats.set(mapId, stats);
    }
  }
}

// ── Boss Knowledge ──────────────────────────────────────────────────────
// Boss raid requirements, maps, and coordination info.

export const BOSS_RAIDS = {
  zakum: {
    name: 'Zakum',
    entryMap: 280030000,  // Zakum entrance
    bossMap: 280030100,   // Zakum's Altar
    minLevel: 50,
    recommendedLevel: 100,
    minPartySize: 3,
    requiredItem: 4001017,  // Eye of Fire
    phases: 3,
    drops: [1002357, 1002430], // Zakum Helmet 1/2/3
    tips: 'Stay on platforms, avoid arms, DPS body',
  },
  horntail: {
    name: 'Horntail',
    entryMap: 240050400,
    bossMap: 240060200,   // Horntail's Cave
    minLevel: 130,
    recommendedLevel: 155,
    minPartySize: 6,
    requiredItem: null,
    phases: 3,
    drops: [1122000, 1002735], // HTP pendant, HT helm
    tips: 'Kill tail first, avoid seduce, clerics must dispel',
  },
  pinkbean: {
    name: 'Pink Bean',
    entryMap: 270050000,
    bossMap: 270050100,
    minLevel: 170,
    recommendedLevel: 180,
    minPartySize: 6,
    requiredItem: null,
    phases: 5,
    drops: [1142066], // Pink Bean trophy
    tips: 'Kill statues first, spread out for DR',
  },
  papulatus: {
    name: 'Papulatus',
    entryMap: 220080000,
    bossMap: 220080001,
    minLevel: 80,
    recommendedLevel: 100,
    minPartySize: 2,
    requiredItem: 4001024, // Piece of Cracked Dimension
    phases: 2,
    drops: [],
    tips: 'Clock phase then body phase, bring pots',
  },
};

/**
 * Check if a bot is ready for a specific boss.
 * Returns { ready, missing[] } with reasons if not ready.
 */
export function checkBossReadiness(bot, bossId) {
  const boss = BOSS_RAIDS[bossId];
  if (!boss) return { ready: false, missing: ['unknown boss'] };
  const missing = [];
  if (bot.stats.level < boss.minLevel) missing.push(`need lv${boss.minLevel} (currently ${bot.stats.level})`);
  if (boss.requiredItem) {
    let hasItem = false;
    for (const inv of [bot.inventory.use, bot.inventory.etc, bot.inventory.setup]) {
      for (const [, item] of inv) {
        if (item.itemId === boss.requiredItem) { hasItem = true; break; }
      }
      if (hasItem) break;
    }
    if (!hasItem) missing.push(`need item ${boss.requiredItem}`);
  }
  return { ready: missing.length === 0, missing, boss };
}

/**
 * Find online bots ready for a boss raid.
 */
export function findBossParty(bots, bossId) {
  const boss = BOSS_RAIDS[bossId];
  if (!boss) return [];
  const ready = [];
  for (const [name, entry] of bots) {
    if (entry.status !== 'online' || entry.disposed) continue;
    if (entry.bot.stats.level >= boss.recommendedLevel) {
      ready.push({ name, level: entry.bot.stats.level, classType: entry.personality.type });
    }
  }
  return ready;
}

// ── Buff Coordination for Boss Raids ────────────────────────────────────
// Party buff rotation so buffs don't overlap wastefully.

export const PARTY_BUFFS = {
  // Cleric/Priest/Bishop buffs that affect party
  231: [2311003, 2311004], // Priest: Holy Symbol, Doom (lol)
  232: [2321000, 2321005, 2321004], // Bishop: Maple Warrior, Advanced Bless, Infinity
  // DK buffs
  131: [1301004], // DK: Hyper Body
  132: [1321000, 1321007], // Dark Knight: Maple Warrior, Beholder
  // Paladin
  122: [1221000, 1221009], // Paladin: Maple Warrior, Blessed Hammer
  // Bowmaster
  312: [3121002, 3121000], // Bowmaster: Sharp Eyes, Maple Warrior
  // Marksman
  322: [3221002, 3221000], // Marksman: Sharp Eyes, Maple Warrior
};

/**
 * Get which party buffs this bot should cast (avoids overlap with others).
 */
export function getPartyBuffDuty(bot, partyMembers) {
  const myBuffs = PARTY_BUFFS[bot.jobId] || [];
  if (myBuffs.length === 0) return [];

  // Filter to buffs that no one else in the party is already buffing
  const otherBuffs = new Set();
  for (const member of partyMembers) {
    if (member.charId === bot.charId) continue;
    for (const buffId of (member.buffActive || [])) {
      otherBuffs.add(buffId);
    }
  }
  return myBuffs.filter(b => !otherBuffs.has(b));
}

// ── Economy Engine ──────────────────────────────────────────────────────
// NPC sell prices, FM participation, market awareness.

export const NPC_SELL_PRICES = {
  // ETC items worth selling to NPC (price in meso)
  4000000: 1,   // Snail Shell
  4000001: 1,   // Blue Snail Shell
  4000003: 1,   // Leaf
  4000004: 2,   // Firewood
  4000021: 5,   // Mushroom Cap
  4000030: 2,   // Tree Branch
  // Ores worth keeping
  4010000: 500,  // Bronze Ore
  4010001: 500,  // Steel Ore
  4010002: 800,  // Mithril Ore
  4010003: 1200, // Adamantium Ore
  4010004: 1500, // Silver Ore
  4010005: 2000, // Orihalcon Ore
  4010006: 3000, // Gold Ore
  // Crystals
  4004000: 5000, // Power Crystal
  4004001: 5000, // Wisdom Crystal
  4004002: 5000, // DEX Crystal
  4004003: 5000, // LUK Crystal
  4004004: 8000, // Dark Crystal
};

// Item IDs worth selling to players (FM value >> NPC value)
export const FM_WORTHY_ITEMS = new Set([
  // Scrolls (high value)
  2040502, 2044502, // Scroll for Overall Armor for DEX/INT
  2040802, // Glove for ATT scroll
  2044702, // Shoe for Jump scroll
  // Stars
  2070005, // Tobis
  2070006, // Steelys
  2070016, // Ilbis
  // Equips (will check level req)
]);

/**
 * Evaluate inventory for NPC-sellable junk.
 * Returns array of { inventoryType, slot, itemId, expectedMeso }.
 */
export function findSellableJunk(bot) {
  const sellable = [];
  // Check ETC inventory
  for (const [slot, item] of bot.inventory.etc) {
    const price = NPC_SELL_PRICES[item.itemId];
    if (price !== undefined && price <= 10 && !FM_WORTHY_ITEMS.has(item.itemId)) {
      sellable.push({ inventoryType: 4, slot, itemId: item.itemId, quantity: item.quantity || 1, expectedMeso: price * (item.quantity || 1) });
    }
  }
  return sellable;
}

/**
 * Check if bot should do an NPC sell run (too much junk in inventory).
 */
export function shouldSellJunk(bot) {
  let junkCount = 0;
  for (const [, item] of bot.inventory.etc) {
    if (NPC_SELL_PRICES[item.itemId] !== undefined && NPC_SELL_PRICES[item.itemId] <= 10) {
      junkCount++;
    }
  }
  return junkCount >= 10; // sell when 10+ junk stacks
}

/**
 * Calculate estimated net worth (meso + inventory value).
 */
export function estimateNetWorth(bot) {
  let worth = bot.stats.meso;
  for (const invType of ['equip', 'use', 'etc', 'setup']) {
    for (const [, item] of bot.inventory[invType]) {
      const price = NPC_SELL_PRICES[item.itemId];
      if (price) worth += price * (item.quantity || 1);
    }
  }
  return worth;
}

// ── Reputation System ───────────────────────────────────────────────────
// Tracks interactions with real players. Bots remember who's nice/hostile.

export class ReputationTracker {
  constructor() {
    this.players = new Map(); // playerName → { score, interactions, lastSeen, tags }
  }

  /** Record a positive interaction. */
  positive(playerName, reason = 'helpful') {
    const rep = this._getOrCreate(playerName);
    rep.score = Math.min(100, rep.score + 5);
    rep.interactions.push({ type: 'positive', reason, time: Date.now() });
    this._trimHistory(rep);
  }

  /** Record a negative interaction. */
  negative(playerName, reason = 'rude') {
    const rep = this._getOrCreate(playerName);
    rep.score = Math.max(-100, rep.score - 10);
    rep.interactions.push({ type: 'negative', reason, time: Date.now() });
    this._trimHistory(rep);
  }

  /** Record a neutral interaction (just seen). */
  seen(playerName) {
    const rep = this._getOrCreate(playerName);
    rep.lastSeen = Date.now();
  }

  /** Get reputation score for a player. */
  getScore(playerName) {
    const rep = this.players.get(playerName);
    return rep ? rep.score : 0;
  }

  /** Check if player is a friend (score > 20). */
  isFriend(playerName) {
    return this.getScore(playerName) > 20;
  }

  /** Check if player is hostile (score < -20). */
  isHostile(playerName) {
    return this.getScore(playerName) < -20;
  }

  /** Get the bot's top friends (sorted by score desc). */
  getFriends(limit = 10) {
    return [...this.players.entries()]
      .filter(([, r]) => r.score > 10)
      .sort(([, a], [, b]) => b.score - a.score)
      .slice(0, limit)
      .map(([name, r]) => ({ name, score: r.score, lastSeen: r.lastSeen }));
  }

  _getOrCreate(playerName) {
    let rep = this.players.get(playerName);
    if (!rep) { rep = { score: 0, interactions: [], lastSeen: Date.now(), tags: [] }; this.players.set(playerName, rep); }
    return rep;
  }

  _trimHistory(rep) {
    while (rep.interactions.length > 20) rep.interactions.shift();
  }

  export() {
    return [...this.players.entries()].map(([name, data]) => [name, {
      score: data.score, lastSeen: data.lastSeen, tags: data.tags,
      interactions: data.interactions.slice(-5), // only last 5
    }]);
  }

  import(data) {
    if (!data) return;
    for (const [name, d] of data) {
      this.players.set(name, { ...d, interactions: d.interactions || [] });
    }
  }
}

// ── Death Learning ──────────────────────────────────────────────────────
// Tracks which mobs and maps cause deaths. Avoids dangerous areas.

export const DANGER_MOB_IDS = new Set([
  // Common high-damage mobs in v83 that beginners should avoid
  8140000, 8140100, 8140200, // Zakum parts
  8810000, 8810100, // Horntail parts
  8820000, 8820001, // Pink Bean
]);

/**
 * Check if a map is too dangerous for bot's level.
 * Uses death history from TrainingTracker.
 */
export function isMapDangerous(tracker, mapId, botLevel) {
  const deathRate = tracker.getDeathRate(mapId);
  // More than 2 deaths per minute = dangerously over-leveled map
  if (deathRate > 2) return true;
  // More than 0.5 deaths per minute = risky, only ok if high level
  if (deathRate > 0.5 && botLevel < 50) return true;
  return false;
}

// ── Coordinated Grinding ────────────────────────────────────────────────
// When multiple bots are on the same map, assign platforms/areas.

export const MAP_PLATFORMS = {
  // Training maps with known platform layouts (y-coordinate ranges)
  104040000: [{ name: 'top', yMin: -200, yMax: -50 }, { name: 'mid', yMin: -50, yMax: 100 }, { name: 'bottom', yMin: 100, yMax: 300 }],
  101010100: [{ name: 'left', yMin: -100, yMax: 50 }, { name: 'right', yMin: -100, yMax: 50 }], // Slime tree
  105040300: [{ name: 'top', yMin: -300, yMax: -100 }, { name: 'mid', yMin: -100, yMax: 50 }, { name: 'bottom', yMin: 50, yMax: 250 }],
};

/**
 * Assign a platform/area to a bot based on how many bots are already on the map.
 * Returns { name, yMin, yMax } or null if no platform data.
 */
export function assignPlatform(mapId, botIndex) {
  const platforms = MAP_PLATFORMS[mapId];
  if (!platforms || platforms.length === 0) return null;
  return platforms[botIndex % platforms.length];
}

/**
 * Check if mob is within bot's assigned platform.
 */
export function isMobInMyZone(mob, platform) {
  if (!platform) return true; // no platform assignment = hunt anywhere
  return mob.y >= platform.yMin && mob.y <= platform.yMax;
}

// ── Boss Raid Coordinator ───────────────────────────────────────────────

/**
 * Orchestrate a boss raid with available bots.
 * @returns {Promise<{success, participants, bossId}>}
 */
export function startBossRaid(bots, bossId) {
  const boss = BOSS_RAIDS[bossId];
  if (!boss) return Promise.resolve({ success: false, error: 'Unknown boss' });

  const party = findBossParty(bots, bossId);
  if (party.length < boss.minPartySize) {
    return Promise.resolve({ success: false, error: `Need ${boss.minPartySize} bots, only ${party.length} ready` });
  }

  return new Promise((resolve) => {
    // Phase 1: Gather all raid bots to entry map
    let gathered = 0;
    const participants = party.slice(0, 6); // max party size

    for (const p of participants) {
      const entry = bots.get(p.name);
      if (!entry) continue;
      const bot = entry.bot;

      bot.changeMap(boss.entryMap);
      const onMap = (mapId) => {
        if (mapId === boss.entryMap || mapId === boss.bossMap) {
          bot.removeListener('mapChanged', onMap);
          gathered++;
          log.info({ bot: p.name, bossId, gathered, needed: participants.length }, 'Bot arrived at boss');

          if (gathered >= participants.length) {
            // Phase 2: Enter boss map
            setTimeout(() => {
              for (const pp of participants) {
                const e = bots.get(pp.name);
                if (e) {
                  e.bot.changeMap(boss.bossMap);
                  // Cast party buffs
                  const rotation = COMBAT_ROTATIONS[e.bot.jobId];
                  if (rotation) {
                    for (const buffId of rotation.buffs) {
                      const lvl = e.bot.skills.get(buffId) || 0;
                      if (lvl > 0) e.bot.useSkill(buffId, lvl);
                    }
                  }
                }
              }
              resolve({ success: true, participants: participants.map(p => p.name), bossId });
            }, 3000);
          }
        }
      };
      bot.on('mapChanged', onMap);
      setTimeout(() => bot.removeListener('mapChanged', onMap), 30000);
    }

    // Timeout: give 30s for everyone to gather
    setTimeout(() => {
      if (gathered < participants.length) {
        resolve({ success: false, error: `Only ${gathered}/${participants.length} gathered in time` });
      }
    }, 35000);
  });
}

export function buyAndEquipGear(bot, shopMapId, upgrade) {
  return new Promise((resolve) => {
    const currentMap = bot.mapId;

    // Already on the shop map?
    const proceed = () => {
      setTimeout(() => {
        // Find any NPC to talk to (weapon/armor shop)
        const npc = bot.getNearestNpc(300);
        if (!npc) {
          log.warn({ bot: bot.name, mapId: bot.mapId }, 'No NPC found for gear shop');
          // Go back to where we were
          if (bot.mapId !== currentMap) bot.changeMap(currentMap);
          resolve(false);
          return;
        }
        bot.talkToNpc(npc.oid);

        const onShop = ({ items }) => {
          bot.removeListener('shopOpen', onShop);
          const target = items.find(i => i.itemId === upgrade.itemId);
          if (target) {
            bot.shopBuy(target.slot, upgrade.itemId, 1);
            log.info({ bot: bot.name, item: upgrade.name, itemId: upgrade.itemId }, 'Bought gear');
            // Wait for inventory update then equip
            setTimeout(() => {
              // Find the item in equip inventory (it goes to first available slot)
              for (const [slot, item] of bot.inventory.equip) {
                if (slot > 0 && item.itemId === upgrade.itemId) {
                  bot.equipItem(slot, upgrade.slot);
                  log.info({ bot: bot.name, item: upgrade.name, slot: upgrade.slot }, 'Equipped gear');
                  break;
                }
              }
              setTimeout(() => bot.shopLeave(), 500);
              // Return to training map
              setTimeout(() => {
                if (bot.mapId !== currentMap) bot.changeMap(currentMap);
                resolve(true);
              }, 2000);
            }, 1000);
          } else {
            bot.shopLeave();
            if (bot.mapId !== currentMap) bot.changeMap(currentMap);
            resolve(false);
          }
        };
        bot.once('shopOpen', onShop);
        setTimeout(() => {
          bot.removeListener('shopOpen', onShop);
          resolve(false);
        }, 10000);
      }, 2000);
    };

    if (bot.mapId === shopMapId) {
      proceed();
    } else {
      bot.changeMap(shopMapId);
      const onMap = () => {
        bot.removeListener('mapChanged', onMap);
        proceed();
      };
      bot.on('mapChanged', onMap);
      setTimeout(() => {
        bot.removeListener('mapChanged', onMap);
        resolve(false);
      }, 10000);
    }
  });
}
