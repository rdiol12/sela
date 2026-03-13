/**
 * modules/unreal/shard-echo-dungeons.js — Shard Echo Dungeon Design System
 *
 * ms_1: Design 6 puzzle dungeon layouts (one per shard type + 2 multi-shard).
 *
 * Combat-free optional side dungeons where shard powers replace combat.
 * Each dungeon is themed around one (or more) shard types, with unique puzzle
 * mechanics. Rewards are Shard Echoes — passive abilities that can't be
 * obtained through the skill tree.
 *
 * Architecture:
 *   - 4 single-shard dungeons (Time, Water, Fire, Nature)
 *   - 2 multi-shard dungeons (Shadow+Time, Fire+Water+Nature)
 *   - Each has: rooms, puzzles, narrative, reward, difficulty scaling
 *   - Integrates with combo-balance.js SHARD_TYPES
 *   - Exports UE5 Data Tables for level design consumption
 */

import { SHARD_TYPES } from './combo-balance.js';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getActiveGame } from './game-config.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('shard-echo-dungeons');

// ── Shard Echo Rewards ──────────────────────────────────────────────────────

/**
 * Shard Echoes — unique passive abilities earned by completing echo dungeons.
 * These cannot be obtained through the skill tree or any other means.
 */
export const SHARD_ECHOES = {
  // Single-shard echoes
  temporal_foresight: {
    id: 'temporal_foresight',
    name: 'Temporal Foresight',
    shard: 'Time',
    description: 'Enemy attack telegraphs appear 0.5s earlier. Dodge windows extended by 20%.',
    passiveEffect: { telegraphBonus: 0.5, dodgeWindowMult: 1.2 },
    icon: '/Game/UI/Icons/Echo_TemporalForesight',
    rarity: 'legendary',
  },
  tidal_resonance: {
    id: 'tidal_resonance',
    name: 'Tidal Resonance',
    shard: 'Water',
    description: 'Water shard abilities leave healing mist for 3s. Allies in mist recover 2% HP/s.',
    passiveEffect: { healMistDuration: 3, healPctPerSec: 0.02 },
    icon: '/Game/UI/Icons/Echo_TidalResonance',
    rarity: 'legendary',
  },
  ember_heart: {
    id: 'ember_heart',
    name: 'Ember Heart',
    shard: 'Fire',
    description: 'Fire abilities inflict Smolder — a stacking DoT that intensifies per stack (max 5). Each stack adds 3% damage.',
    passiveEffect: { smolderMaxStacks: 5, dmgPerStack: 0.03 },
    icon: '/Game/UI/Icons/Echo_EmberHeart',
    rarity: 'legendary',
  },
  verdant_pulse: {
    id: 'verdant_pulse',
    name: 'Verdant Pulse',
    shard: 'Nature',
    description: 'Nature abilities have a 15% chance to spawn a Bloom — a rooted plant ally that taunts and tanks 1 hit.',
    passiveEffect: { bloomChance: 0.15, bloomHits: 1 },
    icon: '/Game/UI/Icons/Echo_VerdantPulse',
    rarity: 'legendary',
  },
  // Multi-shard echoes
  void_step: {
    id: 'void_step',
    name: 'Void Step',
    shard: ['Shadow', 'Time'],
    description: 'Dodging leaves a shadow clone that persists for 2s and mimics your last attack at 30% damage.',
    passiveEffect: { cloneDuration: 2, cloneDamageMult: 0.3 },
    icon: '/Game/UI/Icons/Echo_VoidStep',
    rarity: 'mythic',
  },
  primal_convergence: {
    id: 'primal_convergence',
    name: 'Primal Convergence',
    shard: ['Fire', 'Water', 'Nature'],
    description: 'Using 3 different shard types within 8s triggers Primal Burst — AoE dealing 200% base damage of all 3 elements.',
    passiveEffect: { triggerWindow: 8, burstDamageMult: 2.0, requiredTypes: 3 },
    icon: '/Game/UI/Icons/Echo_PrimalConvergence',
    rarity: 'mythic',
  },
};

// ── Puzzle Mechanic Types ───────────────────────────────────────────────────

export const PUZZLE_MECHANICS = {
  TEMPORAL_REWIND:    'temporal_rewind',    // Rewind objects to past states
  TEMPORAL_FREEZE:    'temporal_freeze',    // Freeze moving platforms/hazards
  TEMPORAL_ECHO:      'temporal_echo',      // Record and replay player actions
  WATER_FLOW:         'water_flow',         // Direct water through pipe networks
  WATER_PRESSURE:     'water_pressure',     // Fill/drain chambers to change water level
  WATER_FREEZE_MELT:  'water_freeze_melt',  // Freeze water to create platforms, melt ice
  FIRE_HEAT:          'fire_heat',          // Heat metal to expand, activate thermal switches
  FIRE_CHAIN:         'fire_chain',         // Chain fire between braziers within time limit
  FIRE_FORGE:         'fire_forge',         // Forge keys/bridges by melting materials
  NATURE_GROWTH:      'nature_growth',      // Grow vines/roots to create paths
  NATURE_DECAY:       'nature_decay',       // Accelerate decay to clear obstacles
  NATURE_SYMBIOSIS:   'nature_symbiosis',   // Pair plant types for combined effects
  SHADOW_PHASE:       'shadow_phase',       // Phase through shadow-marked walls
  SHADOW_SWAP:        'shadow_swap',        // Swap positions with shadow clones
  LIGHT_DARK:         'light_dark',         // Toggle between light/dark world versions
  MULTI_COMBINE:      'multi_combine',      // Use multiple shard types in sequence
};

// ── Dungeon Difficulty ──────────────────────────────────────────────────────

export const DIFFICULTY_TIERS = {
  INITIATE:  { id: 'initiate',  label: 'Initiate',  puzzleComplexity: 1, roomCount: 3, timeLimit: null },
  ADEPT:     { id: 'adept',     label: 'Adept',     puzzleComplexity: 2, roomCount: 5, timeLimit: null },
  MASTER:    { id: 'master',    label: 'Master',     puzzleComplexity: 3, roomCount: 7, timeLimit: 600 },
};

// ══════════════════════════════════════════════════════════════════════════════
// 6 Dungeon Layouts
// ══════════════════════════════════════════════════════════════════════════════

export const ECHO_DUNGEONS = {

  // ── 1. Temporal Sanctum (Time Shard) ──────────────────────────────────────
  temporal_sanctum: {
    id: 'temporal_sanctum',
    name: 'The Temporal Sanctum',
    shardRequired: ['Time'],
    region: 'Aethermere',
    theme: 'Ancient clockwork cathedral frozen between two eras — past (pristine) and present (ruined). Player shifts between timelines to solve puzzles.',
    atmosphere: {
      lighting: 'shifting_amber_blue',
      ambience: 'ticking_clocks_distant_bells',
      vfx: 'time_particles_forward_reverse',
      music: 'mus_temporal_sanctum',
    },
    narrative: {
      intro: 'The Sanctum remembers every moment since its creation. Time Sense lets you walk through those memories — but be careful. The past doesn\'t always want visitors.',
      loreTheme: 'A monastery of chronomancers who tried to freeze time to prevent the Crown\'s corruption. They succeeded — but forgot how to unfreeze.',
      discoverable: [
        'Chronomancer\'s journal: 3 scattered pages revealing the ritual that froze the Sanctum',
        'Frozen monk — a chronomancer caught mid-spell, preserved perfectly',
        'Temporal echo of the Crown\'s creation — a playable memory fragment',
      ],
    },
    reward: SHARD_ECHOES.temporal_foresight,
    difficulty: DIFFICULTY_TIERS.ADEPT,

    rooms: [
      {
        id: 'ts_entry',
        name: 'The Broken Atrium',
        description: 'Grand hall split between past (left: pristine marble) and present (right: crumbled ruins). A massive pendulum hangs frozen mid-swing.',
        puzzle: {
          mechanic: PUZZLE_MECHANICS.TEMPORAL_REWIND,
          description: 'Rewind the collapsed bridge to its past state to cross. But rewinding also restores a sealed door — blocking the exit. Must rewind bridge, cross, then let it decay again to open the path.',
          steps: [
            'Observe the bridge — collapsed in present, intact in the past',
            'Use Time Sense to rewind the bridge segment (hold aim + cast)',
            'Cross the restored bridge before the rewind fades (15s)',
            'On the other side, notice the exit is now sealed (door was intact in past)',
            'Release the rewind — bridge collapses but exit opens',
          ],
          difficulty: 1,
          hintSystem: { hint1: 'The bridge and the door share the same timeline.', hint2: 'You can\'t keep both open. Cross first, then let go.', hint3: 'Stand on the far side, then release Time Sense.' },
        },
        connections: ['ts_clock_hall'],
      },
      {
        id: 'ts_clock_hall',
        name: 'Hall of Gears',
        description: 'Massive clockwork mechanism with interlocking gears. Some gears are missing (decayed away). A frozen monk points at the wall.',
        puzzle: {
          mechanic: PUZZLE_MECHANICS.TEMPORAL_ECHO,
          description: 'Record yourself turning a gear, then rewind a second gear to its intact state. Your temporal echo turns one gear while you turn the restored one simultaneously — opening the timed lock.',
          steps: [
            'Find Gear A (still intact) and turn it — observe it opens gate A for 5s',
            'Find Gear B (broken) — rewind it to intact state',
            'Use Temporal Echo: record yourself turning Gear A',
            'Rush to Gear B and turn it while your echo replays at Gear A',
            'Both gates open simultaneously — sprint through',
          ],
          difficulty: 2,
          hintSystem: { hint1: 'You need to be in two places at once.', hint2: 'The Temporal Echo remembers your actions.', hint3: 'Record at Gear A, then run to Gear B before the echo replays.' },
        },
        connections: ['ts_entry', 'ts_pendulum'],
      },
      {
        id: 'ts_pendulum',
        name: 'The Pendulum Chamber',
        description: 'Vast vertical shaft. The giant pendulum swings between platforms at different heights. In the past, it swings; in the present, it\'s frozen.',
        puzzle: {
          mechanic: PUZZLE_MECHANICS.TEMPORAL_FREEZE,
          description: 'Use time-freeze on the pendulum at the right moment to create a platform, then ride it in a different time-state. Chain 3 freeze-ride cycles to reach the top.',
          steps: [
            'Activate past-state — pendulum begins swinging',
            'Freeze the pendulum when it aligns with Platform 1',
            'Jump onto the frozen pendulum',
            'Unfreeze — pendulum swings you toward Platform 2 (must jump at apex)',
            'Repeat freeze-swing-jump twice more to reach the Sanctum Core',
          ],
          difficulty: 3,
          hintSystem: { hint1: 'The pendulum is a platform when frozen.', hint2: 'Freeze it when it points toward where you need to go.', hint3: 'Timing: freeze at the leftmost swing for Platform 2 access.' },
        },
        connections: ['ts_clock_hall', 'ts_core'],
      },
      {
        id: 'ts_core',
        name: 'The Sanctum Core',
        description: 'Heart of the temporal anomaly. A miniature Crown fragment hovers, cycling through all moments of history simultaneously. The frozen chronomancer stands before it.',
        puzzle: {
          mechanic: PUZZLE_MECHANICS.TEMPORAL_ECHO,
          description: 'Final puzzle: Create 3 temporal echoes of yourself at 3 altars simultaneously. Each echo must perform a different action (kneel, channel, release). Requires memorizing the sequence and recording each echo in the correct order.',
          steps: [
            'Read the inscription: "Three aspects of the seeker — Humility, Focus, Surrender"',
            'At Altar 1: Record echo while kneeling (crouch input)',
            'At Altar 2: Record echo while channeling Time Sense (hold cast)',
            'At Altar 3: At the right moment, stand and release all shard energy',
            'All 3 echoes play simultaneously — the temporal lock shatters',
            'The Shard Echo emerges: Temporal Foresight',
          ],
          difficulty: 3,
          hintSystem: { hint1: 'Three altars, three actions, all at once.', hint2: 'Record your echoes in order — they replay simultaneously.', hint3: 'Kneel at 1, channel at 2, stand at 3. The timing is the key.' },
        },
        connections: ['ts_pendulum'],
        isFinalRoom: true,
      },
    ],
  },

  // ── 2. Abyssal Cistern (Water Shard) ──────────────────────────────────────
  abyssal_cistern: {
    id: 'abyssal_cistern',
    name: 'The Abyssal Cistern',
    shardRequired: ['Water'],
    region: 'SunkenHalls',
    theme: 'Subterranean water temple with interconnected chambers. Water levels rise and fall based on player actions. Bioluminescent coral provides light.',
    atmosphere: {
      lighting: 'deep_blue_bioluminescent',
      ambience: 'dripping_water_echoes_whale_song',
      vfx: 'underwater_caustics_bubbles',
      music: 'mus_abyssal_cistern',
    },
    narrative: {
      intro: 'The Cistern was the Crown\'s cooling system — channels of purified water that kept corruption at bay. Now the channels are broken, the water stagnant. Your Water Jet can restore the flow.',
      loreTheme: 'Ancient hydraulic engineers who understood the Crown\'s need for balance. Water = purification. Stagnation = corruption.',
      discoverable: [
        'Engineer\'s blueprint: the original water flow diagram — reveals a secret room',
        'Corrupted coral: a living specimen showing what happens when water stagnates',
        'Sealed vial: pure Crown-water from before corruption — a crafting material',
      ],
    },
    reward: SHARD_ECHOES.tidal_resonance,
    difficulty: DIFFICULTY_TIERS.ADEPT,

    rooms: [
      {
        id: 'ac_intake',
        name: 'The Intake Chamber',
        description: 'Circular room with 4 intake pipes (2 blocked, 1 cracked, 1 functional). Water trickles from the ceiling. Central drain leads deeper.',
        puzzle: {
          mechanic: PUZZLE_MECHANICS.WATER_FLOW,
          description: 'Direct water flow to fill the central basin to exactly the right level. Too little = drain stays sealed. Too much = overflow triggers reset.',
          steps: [
            'Use Water Jet on blocked pipe A — clears debris, water flows',
            'Crack in pipe B leaks water — use Water Jet to seal it temporarily (freeze)',
            'Adjust pipe A and functional pipe C to balance flow',
            'Water level rises to the marked line — central drain opens',
            'Jump into the drain before the frozen seal melts and resets the level',
          ],
          difficulty: 1,
          hintSystem: { hint1: 'The marked line on the basin is your target.', hint2: 'The cracked pipe wastes water — seal it first.', hint3: 'Two pipes flowing, one sealed, one blocked = correct level.' },
        },
        connections: ['ac_channels'],
      },
      {
        id: 'ac_channels',
        name: 'The Channel Network',
        description: 'Horizontal maze of water channels at different elevations. Stone gates control flow direction. Some channels are corrupted (dark water = damage).',
        puzzle: {
          mechanic: PUZZLE_MECHANICS.WATER_FLOW,
          description: 'Route clean water from the source to the purification pool while avoiding corrupted channels. Use Water Jet to open/close gates and redirect flow.',
          steps: [
            'Map the channel network — 3 possible routes, only 1 avoids all corrupted channels',
            'Open Gate 1 (NE) with Water Jet pressure burst',
            'Close Gate 2 (SE) to prevent flow into corrupted Channel C',
            'Open Gate 3 (NW) to bypass the corruption zone',
            'Clean water reaches the purification pool — door to the Deep opens',
          ],
          difficulty: 2,
          hintSystem: { hint1: 'Follow the clean water — dark water is corrupted.', hint2: 'The northeast path is the only clean route to the pool.', hint3: 'Close the southeast gate BEFORE opening the northeast gate.' },
        },
        connections: ['ac_intake', 'ac_deep_basin'],
      },
      {
        id: 'ac_deep_basin',
        name: 'The Deep Basin',
        description: 'Enormous submerged chamber. Water fills from below. Platforms at 3 heights accessible only at specific water levels. Bioluminescent jellyfish illuminate hidden paths.',
        puzzle: {
          mechanic: PUZZLE_MECHANICS.WATER_PRESSURE,
          description: 'Raise and lower the basin\'s water level in sequence to access 3 rune stones at different heights. Each rune activates only when above water. All 3 must glow simultaneously.',
          steps: [
            'Find Rune A (low platform) — accessible at low water. Activate it.',
            'Use Water Jet to fill the basin to medium — reach Rune B on middle platform',
            'Activate Rune B — but Rune A is now submerged (deactivates after 30s)',
            'Quickly fill to high — activate Rune C on the ceiling platform',
            'Drain rapidly (open the floor valve) — all 3 runes glow before A times out',
            'The Cistern Core opens',
          ],
          difficulty: 3,
          hintSystem: { hint1: 'Runes deactivate when submerged. Timing matters.', hint2: 'Activate from bottom to top, then drain fast.', hint3: 'The floor valve drains faster than the ceiling valve fills.' },
        },
        connections: ['ac_channels', 'ac_core'],
      },
      {
        id: 'ac_core',
        name: 'The Purification Heart',
        description: 'Sacred chamber where all water channels converge. A crystalline pool in the center, cracked and drained. Ancient coral frames the walls.',
        puzzle: {
          mechanic: PUZZLE_MECHANICS.WATER_FREEZE_MELT,
          description: 'Restore the purification pool by simultaneously filling it and freezing corruption out. Create ice bridges, melt blockages, and purify the final basin in a cascade sequence.',
          steps: [
            'Fill the pool with clean water from the channels (already routed)',
            'Corruption seeps in from cracks — freeze the cracks with targeted Water Jet',
            'Corruption in the pool solidifies as ice — shatter it with pressure burst',
            'The pool glows pure — but the crystal above is cracked',
            'Create an ice column to reach the crystal, then melt it to seal',
            'The Shard Echo emerges: Tidal Resonance',
          ],
          difficulty: 3,
          hintSystem: { hint1: 'Freeze the corruption, then shatter it.', hint2: 'Ice can be a platform. Build up to the crystal.', hint3: 'Seal the crystal with warm water — melt, don\'t freeze.' },
        },
        connections: ['ac_deep_basin'],
        isFinalRoom: true,
      },
    ],
  },

  // ── 3. Ember Forge (Fire Shard) ───────────────────────────────────────────
  ember_forge: {
    id: 'ember_forge',
    name: 'The Ember Forge',
    shardRequired: ['Fire'],
    region: 'EmberPeaks',
    theme: 'Volcanic smithy built inside an active magma chamber. Conveyor systems, crucibles, and ancient forging mechanisms powered by heat.',
    atmosphere: {
      lighting: 'hot_orange_red_glow',
      ambience: 'bubbling_lava_hissing_steam_hammering',
      vfx: 'heat_shimmer_ember_particles_lava_flow',
      music: 'mus_ember_forge',
    },
    narrative: {
      intro: 'The Forge built the Crown\'s physical form. Fire Lance can rekindle the ancient furnaces — but the Forge has its own tests for those who wield flame.',
      loreTheme: 'The Crown was physically forged here by twin smiths. Their rivalry birthed the Crown\'s dual nature — creation and destruction.',
      discoverable: [
        'Smith\'s hammer: one of the original tools, still warm after millennia',
        'Forge blueprint: shows the Crown was cast in two halves — always meant for two',
        'Slag sample: contains trace Crown metal — a crafting material for endgame weapons',
      ],
    },
    reward: SHARD_ECHOES.ember_heart,
    difficulty: DIFFICULTY_TIERS.ADEPT,

    rooms: [
      {
        id: 'ef_bellows',
        name: 'The Dead Bellows',
        description: 'Entrance hall with massive bellows — dormant. Without air, the forge cannot ignite. Fire-resistant bridges span cooling lava.',
        puzzle: {
          mechanic: PUZZLE_MECHANICS.FIRE_HEAT,
          description: 'Relight the bellows system by heating 3 ignition points in sequence. Each point only stays lit for 10s — chain them before they cool.',
          steps: [
            'Find Ignition Point A (nearest) — heat with Fire Lance until it glows red',
            'The heat chain begins — rush to Point B across the bridge (8s)',
            'Heat Point B — the chain extends to the far wall',
            'Sprint to Point C (behind the broken conveyor) and heat it',
            'All 3 points lit — bellows roar to life, forge entrance opens',
          ],
          difficulty: 1,
          hintSystem: { hint1: 'They cool down fast. You need a path planned before you start.', hint2: 'A, B, C — nearest to farthest. Don\'t backtrack.', hint3: 'Heat each point until it turns red, then immediately run.' },
        },
        connections: ['ef_crucible'],
      },
      {
        id: 'ef_crucible',
        name: 'The Crucible Array',
        description: 'Three massive crucibles connected by channels. Metal flows between them when heated. Conveyor belts move cooled ingots. Everything is stopped.',
        puzzle: {
          mechanic: PUZZLE_MECHANICS.FIRE_CHAIN,
          description: 'Heat the crucibles in the correct order to create an alloy. Wrong order = the metal hardens and resets. Follow the color-coded formula on the wall.',
          steps: [
            'Read the formula: Red (iron) → Blue (mithril) → Gold (sunmetal)',
            'Heat Crucible A (red ore) — molten metal flows to the mixing channel',
            'Heat Crucible B (blue ore) — must arrive while red is still molten',
            'Heat the mixing channel to keep both liquid while adding Crucible C (gold)',
            'The alloy forms — pour into the mold to create the Forge Key',
          ],
          difficulty: 2,
          hintSystem: { hint1: 'The wall formula tells you the order.', hint2: 'Red first, blue second, gold third. Keep the channel hot.', hint3: 'Heat the channel between additions or the metal seizes.' },
        },
        connections: ['ef_bellows', 'ef_anvil'],
      },
      {
        id: 'ef_anvil',
        name: 'The Twin Anvils',
        description: 'Two ancient anvils face each other across a lava river. Hammers hang from chains — one per anvil. A half-formed ring sits on each.',
        puzzle: {
          mechanic: PUZZLE_MECHANICS.FIRE_FORGE,
          description: 'Forge a key ring from two halves. Each half must be heated, shaped (by redirecting the hammer mechanism), and cooled simultaneously. Fire on one side, precision on the other.',
          steps: [
            'Heat the left ring half with Fire Lance until malleable',
            'Redirect the left hammer (hit the chain mechanism) — it shapes the ring',
            'Quickly heat the right ring half',
            'Redirect the right hammer — both halves shaped identically',
            'Push both halves into the center channel — lava river fuses them',
            'Cool the fused ring with the overhead vent (pull chain)',
            'The Forge Core opens',
          ],
          difficulty: 3,
          hintSystem: { hint1: 'Two halves of one ring. Both anvils must work.', hint2: 'Heat, hammer, heat, hammer, fuse, cool.', hint3: 'The center channel is the fusion point. Push both in.' },
        },
        connections: ['ef_crucible', 'ef_core'],
      },
      {
        id: 'ef_core',
        name: 'The Forge Heart',
        description: 'The original forge where the Crown was cast. Two workstations face a central flame that burns without fuel. The twin smiths\' spirits linger as heat mirages.',
        puzzle: {
          mechanic: PUZZLE_MECHANICS.FIRE_HEAT,
          description: 'Rekindle the eternal flame to full intensity by channeling Fire Lance through 4 resonance crystals. Each crystal must reach a specific temperature — too hot and it shatters, too cold and nothing happens.',
          steps: [
            'Approach Crystal 1 — heat slowly until it glows amber (not red!)',
            'Crystal 2 needs rapid burst heat — one strong blast',
            'Crystal 3 requires pulsed heat — 3 short bursts with pauses',
            'Crystal 4 is the trickiest — heat from a distance (intensity = distance × power)',
            'All 4 crystals resonate — the eternal flame blazes',
            'The Shard Echo emerges: Ember Heart',
          ],
          difficulty: 3,
          hintSystem: { hint1: 'Each crystal needs a different heat approach.', hint2: 'Watch the color — amber is safe, red means stop.', hint3: 'Crystal 4: stand at the far wall and use maximum power.' },
        },
        connections: ['ef_anvil'],
        isFinalRoom: true,
      },
    ],
  },

  // ── 4. Verdant Labyrinth (Nature Shard) ───────────────────────────────────
  verdant_labyrinth: {
    id: 'verdant_labyrinth',
    name: 'The Verdant Labyrinth',
    shardRequired: ['Nature'],
    region: 'VerdantReach',
    theme: 'A living maze of ancient trees whose roots form walls and passages. The forest itself responds to Nature shard energy — growing, shifting, decaying on command.',
    atmosphere: {
      lighting: 'dappled_green_golden_sunbeams',
      ambience: 'birdsong_rustling_leaves_creaking_wood',
      vfx: 'floating_spores_pollen_shafts_of_light',
      music: 'mus_verdant_labyrinth',
    },
    narrative: {
      intro: 'The Labyrinth was planted by the first Nature shard bearer — a living monument that grows with each visitor. Your shard can speak to it. Listen, and it will show you the path.',
      loreTheme: 'The original shard bearers weren\'t warriors — they were gardeners. The Crown was meant to tend the world, not conquer it.',
      discoverable: [
        'Petrified seedling: the first tree planted by the shard bearer, still alive inside stone',
        'Root map: the Labyrinth\'s layout as seen from below — reveals the shape of a crown',
        'Living letter: a message grown into bark, from the original bearer to future seekers',
      ],
    },
    reward: SHARD_ECHOES.verdant_pulse,
    difficulty: DIFFICULTY_TIERS.ADEPT,

    rooms: [
      {
        id: 'vl_canopy_gate',
        name: 'The Canopy Gate',
        description: 'A wall of intertwined vines blocks the entrance. Sunlight filters through gaps. Some vines are alive (green), others dead (brown).',
        puzzle: {
          mechanic: PUZZLE_MECHANICS.NATURE_GROWTH,
          description: 'Grow the living vines to create a passage while decaying the dead vines that block it. Growing the wrong vine seals the path.',
          steps: [
            'Identify the 3 green (living) vines and 3 brown (dead) vines',
            'Use Nature shard to decay the brown vines blocking the left passage',
            'Grow the green vine at the base — it lifts a stone slab, revealing the path',
            'The right side has a trap: growing the wrong green vine seals the entrance',
            'Path opens through the living arch',
          ],
          difficulty: 1,
          hintSystem: { hint1: 'Dead vines block. Living vines lift.', hint2: 'Decay the brown ones first, then grow the base vine.', hint3: 'The vine on the RIGHT is a trap. Only grow the BASE vine.' },
        },
        connections: ['vl_root_web'],
      },
      {
        id: 'vl_root_web',
        name: 'The Root Web',
        description: 'Underground chamber where massive roots form a 3D web. Some roots are bridges, others are walls. Symbiotic fungi glow on certain roots.',
        puzzle: {
          mechanic: PUZZLE_MECHANICS.NATURE_SYMBIOSIS,
          description: 'The glowing fungi and the roots have a symbiotic relationship. Grow fungi on specific roots to make them sturdy (walkable). Pair wrong fungi with roots and they collapse.',
          steps: [
            'Observe: blue fungi = structural, red fungi = digestive (dissolves roots)',
            'Grow blue fungi on Root Bridge A — it solidifies, becomes walkable',
            'Cross to the middle platform',
            'Root Wall B blocks the exit — grow red fungi on it to dissolve',
            'Grow blue fungi on the thin Root Bridge C to make it safe',
            'Cross to the exit',
          ],
          difficulty: 2,
          hintSystem: { hint1: 'Blue builds, red destroys.', hint2: 'Strengthen what you walk on, dissolve what blocks you.', hint3: 'A=blue, B=red, C=blue.' },
        },
        connections: ['vl_canopy_gate', 'vl_bloom_chamber'],
      },
      {
        id: 'vl_bloom_chamber',
        name: 'The Bloom Chamber',
        description: 'A massive hollow tree trunk. The floor is a giant flower bud, closed. Pollinator creatures fly in patterns. Light filters from above.',
        puzzle: {
          mechanic: PUZZLE_MECHANICS.NATURE_GROWTH,
          description: 'Make the giant bloom open by growing 4 petal roots in the correct seasonal order (Spring→Summer→Autumn→Winter). Each season has a different growth pattern.',
          steps: [
            'Find the 4 petal roots — each marked with a seasonal rune',
            'Grow the Spring root: rapid, gentle pulses (like rain)',
            'Grow the Summer root: sustained, strong channel (like sun)',
            'Grow the Autumn root: intermittent bursts (like wind)',
            'Grow the Winter root: single cold touch then wait (like frost)',
            'The bloom opens — reveals the Labyrinth Heart below',
          ],
          difficulty: 2,
          hintSystem: { hint1: 'Each season grows differently.', hint2: 'Pulse, sustain, burst, touch-and-wait.', hint3: 'The runes show the pattern — Spring rains, Summer sun, Autumn wind, Winter frost.' },
        },
        connections: ['vl_root_web', 'vl_heart'],
      },
      {
        id: 'vl_heart',
        name: 'The Labyrinth Heart',
        description: 'The oldest tree in the labyrinth — so ancient it remembers the Crown. Its trunk is hollow, forming a natural cathedral. A seedling grows from a crack in the Crown fragment embedded in the floor.',
        puzzle: {
          mechanic: PUZZLE_MECHANICS.NATURE_DECAY,
          description: 'The Heart tree is dying from corruption in its roots. Accelerate decay on the corrupted roots (black) while nurturing the healthy ones (green). The tree must survive — destroy too many roots and it falls.',
          steps: [
            'Identify 6 roots: 4 corrupted (black), 2 healthy (green)',
            'Decay corrupted Root 1 — the tree shudders but holds',
            'Nurture healthy Root A — it strengthens, compensating',
            'Decay corrupted Roots 2 and 3 carefully (one at a time)',
            'Nurture healthy Root B between each decay',
            'Final corrupted Root 4 is deep — must grow Root B to reach it',
            'The tree purifies — the Crown fragment releases the Echo',
            'The Shard Echo emerges: Verdant Pulse',
          ],
          difficulty: 3,
          hintSystem: { hint1: 'Balance destruction with nurture.', hint2: 'After each corruption removed, strengthen a healthy root.', hint3: 'Grow Root B last — it reaches the deepest corruption.' },
        },
        connections: ['vl_bloom_chamber'],
        isFinalRoom: true,
      },
    ],
  },

  // ── 5. Umbral Nexus (Shadow + Time — Multi-Shard) ─────────────────────────
  umbral_nexus: {
    id: 'umbral_nexus',
    name: 'The Umbral Nexus',
    shardRequired: ['Shadow', 'Time'],
    region: 'TheWilds',
    theme: 'A dimension between shadow and time — architecture exists in multiple states simultaneously. Rooms shift between solid/shadow when time shifts.',
    atmosphere: {
      lighting: 'noir_purple_silver_flicker',
      ambience: 'reversed_echoes_whispers_clock_ticks',
      vfx: 'shadow_tendrils_time_distortion_ripples',
      music: 'mus_umbral_nexus',
    },
    narrative: {
      intro: 'The Nexus exists where shadow and time overlap — a crack in reality. Here, your shadow is your past self, and your past self casts your future shadow. Master both to escape.',
      loreTheme: 'This space was never built — it grew from the intersection of two shard types used simultaneously. A warning about what happens when powers combine without control.',
      discoverable: [
        'Fractured self: a frozen shadow of a past seeker who got stuck between states',
        'Temporal shadow map: shows the Nexus from both time AND shadow perspectives',
        'Echo fragment: a piece of the Crown that exists in both shadow and time',
      ],
    },
    reward: SHARD_ECHOES.void_step,
    difficulty: DIFFICULTY_TIERS.MASTER,

    rooms: [
      {
        id: 'un_threshold',
        name: 'The Threshold',
        description: 'A corridor that exists as solid ground in the present but shadow mist in the past. Must alternate between time states and shadow phase to progress.',
        puzzle: {
          mechanic: PUZZLE_MECHANICS.MULTI_COMBINE,
          description: 'Alternate between Time Sense (reveals the past path) and Shadow Phase (walk through shadow walls) to navigate a corridor that\'s different in each state.',
          steps: [
            'Enter: present state shows a solid wall ahead',
            'Use Time Sense: reveals the past — wall didn\'t exist, but floor has a pit',
            'Use Shadow Phase: phase through the present wall',
            'Now in a room that\'s solid in present but the exit is shadow-locked',
            'Use Time Sense to see the past exit location, then Shadow Phase to reach it',
          ],
          difficulty: 2,
          hintSystem: { hint1: 'Time shows what WAS. Shadow lets you ignore what IS.', hint2: 'Switch between them — one reveals, the other bypasses.', hint3: 'Time first to see the path, Shadow to walk it.' },
        },
        connections: ['un_mirror_hall'],
      },
      {
        id: 'un_mirror_hall',
        name: 'The Mirror Hall',
        description: 'A hall of mirrors, but each mirror shows a different time. Your shadow moves independently — it\'s your past self, 5 seconds ago.',
        puzzle: {
          mechanic: PUZZLE_MECHANICS.SHADOW_SWAP,
          description: 'Your shadow (past self) can interact with objects in shadow-state. Swap positions with your shadow to reach areas only accessible from the shadow side, then swap back.',
          steps: [
            'Observe your shadow — it mimics your movements from 5s ago',
            'Walk to the pressure plate on the left — shadow follows 5s later',
            'When shadow reaches the plate, swap positions (Shadow Phase + Time Sense)',
            'You\'re now in shadow-state near the locked door',
            'Your physical body (now where shadow was) stands on the plate — door opens',
            'Walk through as shadow, then swap back to physical on the other side',
          ],
          difficulty: 3,
          hintSystem: { hint1: 'Your shadow is you from 5 seconds ago.', hint2: 'Position yourself, wait for shadow to arrive, then swap.', hint3: 'Swap = Shadow Phase + Time Sense simultaneously. Your body goes where shadow was.' },
        },
        connections: ['un_threshold', 'un_convergence'],
      },
      {
        id: 'un_convergence',
        name: 'The Convergence',
        description: 'Central chamber where shadow and time are indistinguishable. Reality flickers. Three versions of the same room exist simultaneously.',
        puzzle: {
          mechanic: PUZZLE_MECHANICS.MULTI_COMBINE,
          description: 'Navigate 3 overlapping versions of the same room. Each version has one piece of a 3-part key. Must collect all pieces by switching states without losing previously collected pieces (they exist only in their native state).',
          steps: [
            'Present-state: find Key Fragment A on the pedestal',
            'Time-state (past): find Key Fragment B where the pedestal WILL be',
            'Shadow-state: find Key Fragment C in the shadow version of the room',
            'Challenge: each fragment fades when you leave its state',
            'Solution: use Temporal Echo to hold Fragment A, Shadow Clone for C',
            'Physically carry B to the lock while echoes hold A and C',
            'All 3 fragments in the lock simultaneously — Nexus Core opens',
          ],
          difficulty: 3,
          hintSystem: { hint1: 'You can\'t carry all 3. Use echoes and clones.', hint2: 'Temporal Echo holds things in time. Shadow Clone holds things in shadow.', hint3: 'Echo for A, Clone for C, you carry B. All at the lock together.' },
        },
        connections: ['un_mirror_hall', 'un_core'],
      },
      {
        id: 'un_core',
        name: 'The Nexus Core',
        description: 'A void chamber where reality itself is the puzzle. The floor, walls, and ceiling exist only when observed through the right lens.',
        puzzle: {
          mechanic: PUZZLE_MECHANICS.MULTI_COMBINE,
          description: 'Build a path through the void by alternating Time Sense and Shadow Phase in rhythm. The path solidifies only during the transition between states — the "blink" moment.',
          steps: [
            'Step into the void — nothing is solid',
            'Rapidly toggle Time Sense on/off — floor flickers into existence during transitions',
            'Time the toggles to "walk on blinks" — each blink solidifies a tile for 1s',
            'Shadow Phase through floating debris that blocks the blink-path',
            'Reach the center: a crystal that exists in all states simultaneously',
            'Channel both Shadow and Time into it — the states merge',
            'The Shard Echo emerges: Void Step',
          ],
          difficulty: 3,
          hintSystem: { hint1: 'The path exists between states — in the transition itself.', hint2: 'Toggle Time Sense rapidly. Walk on the "blinks".', hint3: 'Rhythm: on-off-step, on-off-step. Like a heartbeat.' },
        },
        connections: ['un_convergence'],
        isFinalRoom: true,
      },
    ],
  },

  // ── 6. Primal Crucible (Fire + Water + Nature — Multi-Shard) ──────────────
  primal_crucible: {
    id: 'primal_crucible',
    name: 'The Primal Crucible',
    shardRequired: ['Fire', 'Water', 'Nature'],
    region: 'CrossroadsHub',
    theme: 'Underground arena where the three primal elements collide. Lava meets water meets forest in impossible geological formations. The most challenging dungeon.',
    atmosphere: {
      lighting: 'tri_color_shifting_red_blue_green',
      ambience: 'steam_hissing_water_rushing_fire_crackling_birds',
      vfx: 'steam_geysers_lava_meets_water_growing_vines',
      music: 'mus_primal_crucible',
    },
    narrative: {
      intro: 'The Crucible predates the Crown — it\'s where the world\'s primal forces naturally converge. Three shard types clash here, and only a seeker who commands all three can restore balance.',
      loreTheme: 'Before the Crown existed, the world was governed by elemental balance. The Crucible is proof that harmony between fire, water, and nature is possible — and powerful.',
      discoverable: [
        'Elemental codex: describes the "Primal Convergence" — when all 3 elements unite',
        'Fossilized balance point: the exact center where all 3 elements are equal',
        'Crown seed: the raw material the Crown was forged from — born here',
      ],
    },
    reward: SHARD_ECHOES.primal_convergence,
    difficulty: DIFFICULTY_TIERS.MASTER,

    rooms: [
      {
        id: 'pc_tri_gate',
        name: 'The Tri-Gate',
        description: 'Three colored doors: red (fire), blue (water), green (nature). Each requires its shard to open. Behind each: a trial room. All 3 must be completed to open the center.',
        puzzle: {
          mechanic: PUZZLE_MECHANICS.MULTI_COMBINE,
          description: 'Open all 3 gates and complete each mini-trial. The trials can be done in any order, but the order affects difficulty (fire→water→nature is easiest).',
          steps: [
            'Red Gate: Heat the lock mechanism with Fire Lance',
            'Fire Trial: Navigate a room of cooling lava — keep paths molten with fire',
            'Blue Gate: Blast the ice seal with Water Jet',
            'Water Trial: Fill a reservoir to the exact level using water redirection',
            'Green Gate: Grow the vine lock with Nature shard',
            'Nature Trial: Guide a seedling through a maze of light and shadow',
            'All 3 trials complete — central chamber opens',
          ],
          difficulty: 2,
          hintSystem: { hint1: 'Each gate matches its shard color.', hint2: 'Fire→Water→Nature is the intended order.', hint3: 'Each trial is a simpler version of its dungeon\'s puzzles.' },
        },
        connections: ['pc_elemental_bridge'],
      },
      {
        id: 'pc_elemental_bridge',
        name: 'The Elemental Bridge',
        description: 'A massive chasm spanned by a bridge that doesn\'t fully exist. The left third is lava (needs cooling), the middle is a gap (needs filling), the right is overgrown (needs clearing).',
        puzzle: {
          mechanic: PUZZLE_MECHANICS.MULTI_COMBINE,
          description: 'Build the bridge using all 3 shard types in sequence: cool the lava with Water, grow vines across the gap with Nature, burn the overgrowth blocking the end with Fire.',
          steps: [
            'Left section: Use Water Jet on the lava — it cools to obsidian (walkable)',
            'Middle section: No floor — use Nature to grow roots across the gap',
            'Right section: Dense thorns block passage — use Fire Lance to clear them',
            'Cross the completed bridge',
            'Behind you, the bridge shifts — now it\'s the reverse (fire-gap-thorns)',
            'You can\'t go back the same way — must proceed forward',
          ],
          difficulty: 2,
          hintSystem: { hint1: 'Water cools, Nature bridges, Fire clears.', hint2: 'Left to right: Water, Nature, Fire.', hint3: 'The bridge changes behind you. Commit.' },
        },
        connections: ['pc_tri_gate', 'pc_balance_chamber'],
      },
      {
        id: 'pc_balance_chamber',
        name: 'The Balance Chamber',
        description: 'Circular room with 3 elemental altars arranged in a triangle. Each altar is connected to the others by channels. A central pillar holds a darkened crystal.',
        puzzle: {
          mechanic: PUZZLE_MECHANICS.MULTI_COMBINE,
          description: 'Charge all 3 altars simultaneously. Each altar drains the others — must find the exact balance point where fire, water, and nature energy are equal.',
          steps: [
            'Charge Fire altar — Water altar drains proportionally',
            'Charge Water altar — Nature altar drains proportionally',
            'Charge Nature altar — Fire altar drains proportionally',
            'Discover the rhythm: Fire 3 beats, Water 2 beats, Nature 1 beat, repeat',
            'Channel in rhythm — energy levels stabilize at equilibrium',
            'All 3 altars glow equally — the central crystal activates',
            'The Crucible Core opens',
          ],
          difficulty: 3,
          hintSystem: { hint1: 'They\'re connected — charging one drains another.', hint2: 'You need a rhythm. Fire needs the most, Nature the least.', hint3: 'Fire-Fire-Fire, Water-Water, Nature. Repeat until balanced.' },
        },
        connections: ['pc_elemental_bridge', 'pc_core'],
      },
      {
        id: 'pc_core',
        name: 'The Primal Heart',
        description: 'The convergence point — all 3 elements are present in equal measure. A tornado of fire, water, and vines spirals around a floating platform. The Crown Seed hovers at the center.',
        puzzle: {
          mechanic: PUZZLE_MECHANICS.MULTI_COMBINE,
          description: 'Navigate the elemental tornado by using each shard type to neutralize its corresponding element. Fire calms fire (resonance), Water calms water, Nature calms nature. Then channel all 3 into the Crown Seed simultaneously.',
          steps: [
            'The tornado has 3 layers: fire (outer), water (middle), nature (inner)',
            'Channel Fire Lance INTO the fire layer — resonance calms it, creating a gap',
            'Step through the gap into the water layer',
            'Channel Water Jet INTO the water — calms it, gap to nature layer',
            'Step through, channel Nature shard INTO the vines — they part',
            'Reach the floating platform with the Crown Seed',
            'Channel ALL 3 shards simultaneously (hold all 3 inputs)',
            'The elements merge into the Primal Convergence',
            'The Shard Echo emerges: Primal Convergence',
          ],
          difficulty: 3,
          hintSystem: { hint1: 'Like calms like. Fire soothes fire.', hint2: 'Three layers, three shards. Outside in.', hint3: 'At the center, hold all 3 shard inputs at once.' },
        },
        connections: ['pc_balance_chamber'],
        isFinalRoom: true,
      },
    ],
  },
};

// ── Runtime Helpers ─────────────────────────────────────────────────────────

/**
 * Get all dungeon summaries for overview.
 * @returns {object[]}
 */
export function getDungeonSummaries() {
  return Object.values(ECHO_DUNGEONS).map(d => ({
    id: d.id,
    name: d.name,
    shardRequired: d.shardRequired,
    region: d.region,
    roomCount: d.rooms.length,
    difficulty: d.difficulty.label,
    rewardName: d.reward.name,
    rewardRarity: d.reward.rarity,
    theme: d.theme,
  }));
}

/**
 * Get a specific dungeon layout with full details.
 * @param {string} dungeonId
 * @returns {object|null}
 */
export function getDungeonLayout(dungeonId) {
  return ECHO_DUNGEONS[dungeonId] || { error: `Unknown dungeon: ${dungeonId}` };
}

/**
 * Get all Shard Echo rewards.
 * @returns {object[]}
 */
export function getShardEchoes() {
  return Object.values(SHARD_ECHOES);
}

/**
 * Validate that a player has the required shards for a dungeon.
 * @param {string} dungeonId
 * @param {string[]} playerShards - Shard types the player has
 * @returns {object} { canEnter, missing }
 */
export function canEnterDungeon(dungeonId, playerShards = []) {
  const dungeon = ECHO_DUNGEONS[dungeonId];
  if (!dungeon) return { canEnter: false, error: 'Unknown dungeon' };

  const missing = dungeon.shardRequired.filter(s => !playerShards.includes(s));
  return {
    canEnter: missing.length === 0,
    dungeonName: dungeon.name,
    required: dungeon.shardRequired,
    missing,
  };
}

/**
 * Export all dungeon specs to JSON for UE5 level design consumption.
 */
export function exportDungeonSpecs() {
  const game = getActiveGame();
  const outDir = join(game.assetsPath, 'Dungeons');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const exportData = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    milestone: 'ms_1',
    description: 'Shard Echo Dungeon layouts — 6 combat-free puzzle dungeons',
    dungeonCount: Object.keys(ECHO_DUNGEONS).length,
    shardTypes: SHARD_TYPES,
    puzzleMechanics: Object.values(PUZZLE_MECHANICS),
    difficultyTiers: DIFFICULTY_TIERS,
    echoes: SHARD_ECHOES,
    dungeons: ECHO_DUNGEONS,
  };

  const outPath = join(outDir, 'shard-echo-dungeons.json');
  writeFileSync(outPath, JSON.stringify(exportData, null, 2), 'utf-8');
  log.info(`Dungeon specs exported to ${outPath}`);
  return { success: true, path: outPath, dungeonCount: Object.keys(ECHO_DUNGEONS).length };
}

// ══════════════════════════════════════════════════════════════════════════════
// ms_2: Puzzle Actor Framework — Switches, Platforms, Flow Networks
// ══════════════════════════════════════════════════════════════════════════════

// ── Actor State Machine ─────────────────────────────────────────────────────

/**
 * Universal states for all puzzle actors. Each actor has a finite state machine
 * that transitions based on player shard interactions and linked actor events.
 */
export const ACTOR_STATES = {
  IDLE:       'idle',        // Default resting state
  ACTIVATED:  'activated',   // Player triggered — performing action
  HELD:       'held',        // Sustained activation (pressure plate, held lever)
  LOCKED:     'locked',      // Cannot interact — requires prerequisite
  COOLDOWN:   'cooldown',    // Temporary post-activation delay
  BROKEN:     'broken',      // Needs shard repair before use
  REWINDING:  'rewinding',   // Time shard: reverting to previous state
  FROZEN:     'frozen',      // Time shard: frozen in current state
};

/**
 * Transition rules for the actor state machine.
 * Format: { from, to, trigger, conditions? }
 */
export const ACTOR_TRANSITIONS = [
  { from: 'idle',      to: 'activated', trigger: 'player_interact',  conditions: ['not_locked', 'has_required_shard'] },
  { from: 'idle',      to: 'held',      trigger: 'player_stand_on',  conditions: ['is_pressure_type'] },
  { from: 'activated', to: 'idle',      trigger: 'activation_complete' },
  { from: 'activated', to: 'cooldown',  trigger: 'has_cooldown' },
  { from: 'held',      to: 'idle',      trigger: 'player_leave' },
  { from: 'cooldown',  to: 'idle',      trigger: 'cooldown_elapsed' },
  { from: 'locked',    to: 'idle',      trigger: 'prerequisite_met' },
  { from: 'broken',    to: 'idle',      trigger: 'shard_repair' },
  { from: '*',         to: 'rewinding', trigger: 'time_rewind',      conditions: ['shard_time'] },
  { from: '*',         to: 'frozen',    trigger: 'time_freeze',      conditions: ['shard_time'] },
  { from: 'rewinding', to: 'idle',      trigger: 'rewind_complete' },
  { from: 'frozen',    to: 'idle',      trigger: 'freeze_release' },
];

// ── Puzzle Actor Types ──────────────────────────────────────────────────────

/**
 * All puzzle actor types that can be placed in dungeon rooms.
 * Each type defines its UE5 blueprint class, interaction model, and valid states.
 */
export const PUZZLE_ACTOR_TYPES = {

  // ── Switches & Triggers ──────────────────────────────────────────────────

  lever: {
    id: 'lever',
    name: 'Lever Switch',
    category: 'switch',
    blueprintClass: 'BP_PuzzleLever',
    parentClass: 'Actor',
    description: 'A pull lever that toggles between on/off states. Stays in position until pulled again.',
    interactionType: 'toggle',
    interactionInput: 'interact_key',
    validStates: ['idle', 'activated', 'locked', 'broken', 'frozen'],
    defaultState: 'idle',
    singleUse: false,
    animMontage: '/Game/Animations/Puzzle/AM_LeverPull',
    soundCue: '/Game/Audio/SFX/Puzzle/SC_LeverClick',
    mesh: '/Game/Meshes/Puzzle/SM_Lever',
    properties: {
      toggleDelay: 0.3,       // seconds before output fires
      requiresShard: null,    // any shard or specific type
      resetOnLeave: false,    // stays toggled
    },
    outputEvents: ['on_activated', 'on_deactivated'],
    inputEvents: ['force_activate', 'force_deactivate', 'lock', 'unlock'],
  },

  pressure_plate: {
    id: 'pressure_plate',
    name: 'Pressure Plate',
    category: 'switch',
    blueprintClass: 'BP_PuzzlePressurePlate',
    parentClass: 'Actor',
    description: 'Activates while player or weighted object stands on it. Deactivates when weight removed.',
    interactionType: 'hold',
    interactionInput: 'player_overlap',
    validStates: ['idle', 'held', 'locked', 'broken', 'frozen'],
    defaultState: 'idle',
    singleUse: false,
    animMontage: null,
    soundCue: '/Game/Audio/SFX/Puzzle/SC_PlatePress',
    mesh: '/Game/Meshes/Puzzle/SM_PressurePlate',
    properties: {
      weightThreshold: 50,    // minimum weight to trigger
      holdDelay: 0.5,         // seconds before firing
      acceptsObjects: true,   // can use pushed objects
      plateSize: { x: 120, y: 120 },
    },
    outputEvents: ['on_pressed', 'on_released'],
    inputEvents: ['force_press', 'force_release', 'lock', 'unlock'],
  },

  crystal_resonator: {
    id: 'crystal_resonator',
    name: 'Crystal Resonator',
    category: 'switch',
    blueprintClass: 'BP_PuzzleCrystalResonator',
    parentClass: 'Actor',
    description: 'A shard-attuned crystal that activates when hit with the matching shard type. Glows and emits a tone. Can chain-activate nearby resonators.',
    interactionType: 'shard_hit',
    interactionInput: 'shard_ability',
    validStates: ['idle', 'activated', 'cooldown', 'locked', 'broken'],
    defaultState: 'idle',
    singleUse: false,
    animMontage: null,
    soundCue: '/Game/Audio/SFX/Puzzle/SC_CrystalResonance',
    mesh: '/Game/Meshes/Puzzle/SM_CrystalResonator',
    properties: {
      requiredShard: 'any',        // or specific: 'Fire', 'Water', etc.
      resonanceRadius: 400,        // chain-activation range (cm)
      resonanceDuration: 5.0,      // seconds active before cooldown
      cooldownDuration: 3.0,
      chainActivation: true,       // activates nearby matching crystals
      glowColor: { r: 0.8, g: 0.9, b: 1.0, a: 1.0 },
    },
    outputEvents: ['on_resonance_start', 'on_resonance_end', 'on_chain_activate'],
    inputEvents: ['force_resonate', 'force_silence', 'lock', 'unlock', 'set_shard_type'],
  },

  rune_panel: {
    id: 'rune_panel',
    name: 'Rune Panel',
    category: 'switch',
    blueprintClass: 'BP_PuzzleRunePanel',
    parentClass: 'Actor',
    description: 'Wall-mounted panel with rune sequence. Player must input correct shard sequence to activate. Wrong sequence resets.',
    interactionType: 'sequence',
    interactionInput: 'shard_ability',
    validStates: ['idle', 'activated', 'locked', 'broken'],
    defaultState: 'idle',
    singleUse: true,
    animMontage: null,
    soundCue: '/Game/Audio/SFX/Puzzle/SC_RuneAccept',
    mesh: '/Game/Meshes/Puzzle/SM_RunePanel',
    properties: {
      sequence: [],              // set per instance: ['Fire','Water','Fire']
      maxAttempts: 0,            // 0 = infinite
      showHints: true,           // glow on correct input
      resetDelay: 2.0,           // seconds before wrong sequence resets
      failSoundCue: '/Game/Audio/SFX/Puzzle/SC_RuneReject',
    },
    outputEvents: ['on_sequence_complete', 'on_sequence_fail', 'on_input_correct', 'on_input_wrong'],
    inputEvents: ['force_complete', 'reset', 'lock', 'unlock'],
  },

  // ── Platforms ────────────────────────────────────────────────────────────

  moving_platform: {
    id: 'moving_platform',
    name: 'Moving Platform',
    category: 'platform',
    blueprintClass: 'BP_PuzzleMovingPlatform',
    parentClass: 'Actor',
    description: 'A platform that moves between waypoints. Can be triggered, continuous, or shard-controlled. Supports time-freeze.',
    interactionType: 'ride',
    interactionInput: 'player_overlap',
    validStates: ['idle', 'activated', 'frozen', 'rewinding', 'locked', 'broken'],
    defaultState: 'idle',
    singleUse: false,
    animMontage: null,
    soundCue: '/Game/Audio/SFX/Puzzle/SC_PlatformMove',
    mesh: '/Game/Meshes/Puzzle/SM_StonePlatform',
    properties: {
      waypoints: [],             // array of {x,y,z} relative offsets
      speed: 200,                // cm/s
      pauseAtWaypoint: 1.0,      // seconds
      loopMode: 'ping_pong',     // 'ping_pong' | 'loop' | 'one_shot'
      triggerMode: 'on_signal',  // 'continuous' | 'on_signal' | 'on_stand'
      playerAttach: true,        // player moves with platform
      platformSize: { x: 200, y: 200, z: 30 },
    },
    outputEvents: ['on_waypoint_reached', 'on_cycle_complete', 'on_player_board', 'on_player_leave'],
    inputEvents: ['start_move', 'stop_move', 'reverse', 'goto_waypoint', 'freeze', 'unfreeze'],
  },

  rotating_platform: {
    id: 'rotating_platform',
    name: 'Rotating Platform',
    category: 'platform',
    blueprintClass: 'BP_PuzzleRotatingPlatform',
    parentClass: 'Actor',
    description: 'A platform that rotates around its center axis. Used for alignment puzzles — rotate to connect paths or aim beams.',
    interactionType: 'ride',
    interactionInput: 'shard_ability',
    validStates: ['idle', 'activated', 'frozen', 'locked', 'broken'],
    defaultState: 'idle',
    singleUse: false,
    animMontage: null,
    soundCue: '/Game/Audio/SFX/Puzzle/SC_PlatformRotate',
    mesh: '/Game/Meshes/Puzzle/SM_RotatingDisc',
    properties: {
      rotationAxis: 'yaw',       // 'yaw' | 'pitch' | 'roll'
      degreesPerActivation: 90,  // snap rotation per shard hit
      rotationSpeed: 45,         // degrees/s during rotation
      snapAngles: [0, 90, 180, 270],
      correctAngle: null,        // set per instance for alignment puzzles
      playerAttach: true,
    },
    outputEvents: ['on_rotation_start', 'on_rotation_end', 'on_correct_angle', 'on_player_board'],
    inputEvents: ['rotate_cw', 'rotate_ccw', 'set_angle', 'freeze', 'unfreeze', 'lock', 'unlock'],
  },

  appearing_platform: {
    id: 'appearing_platform',
    name: 'Appearing Platform',
    category: 'platform',
    blueprintClass: 'BP_PuzzleAppearingPlatform',
    parentClass: 'Actor',
    description: 'A platform that phases in/out of existence. Visible only under specific shard states — e.g., exists in the past but not present (Time), or only in shadow realm (Shadow).',
    interactionType: 'conditional',
    interactionInput: 'shard_state',
    validStates: ['idle', 'activated', 'frozen'],
    defaultState: 'idle',
    singleUse: false,
    animMontage: null,
    soundCue: '/Game/Audio/SFX/Puzzle/SC_PlatformPhase',
    mesh: '/Game/Meshes/Puzzle/SM_GhostPlatform',
    properties: {
      visibleWhen: 'shard_active',   // 'shard_active' | 'shard_inactive' | 'time_past' | 'shadow_realm'
      requiredShard: 'Time',
      fadeInDuration: 0.4,
      fadeOutDuration: 0.3,
      solidWhenVisible: true,
      ghostMaterial: '/Game/Materials/M_GhostPlatform',
      solidMaterial: '/Game/Materials/M_StonePlatform',
    },
    outputEvents: ['on_appear', 'on_disappear', 'on_player_land'],
    inputEvents: ['force_appear', 'force_disappear', 'set_visibility_rule'],
  },

  vine_bridge: {
    id: 'vine_bridge',
    name: 'Living Vine Bridge',
    category: 'platform',
    blueprintClass: 'BP_PuzzleVineBridge',
    parentClass: 'Actor',
    description: 'A bridge of interwoven vines that grows when Nature shard is channeled. Decays over time if not sustained.',
    interactionType: 'channel',
    interactionInput: 'shard_ability',
    validStates: ['idle', 'activated', 'broken'],
    defaultState: 'idle',
    singleUse: false,
    animMontage: null,
    soundCue: '/Game/Audio/SFX/Puzzle/SC_VineGrow',
    mesh: '/Game/Meshes/Puzzle/SM_VineBridge',
    properties: {
      requiredShard: 'Nature',
      growthDuration: 2.0,       // seconds to fully grow
      decayRate: 0.2,            // % per second after channel stops
      maxLength: 800,            // cm
      supportWeight: true,
      splinePoints: [],          // curve control points for bridge shape
    },
    outputEvents: ['on_fully_grown', 'on_decay_start', 'on_collapsed', 'on_player_cross'],
    inputEvents: ['grow', 'decay', 'set_growth_target'],
  },

  // ── Flow Network Components ──────────────────────────────────────────────

  pipe_segment: {
    id: 'pipe_segment',
    name: 'Flow Pipe',
    category: 'flow',
    blueprintClass: 'BP_PuzzlePipe',
    parentClass: 'Actor',
    description: 'A pipe segment that carries flow (water, lava, energy) between connected nodes. Can be rotated to redirect flow.',
    interactionType: 'rotate',
    interactionInput: 'shard_ability',
    validStates: ['idle', 'flowing', 'frozen', 'broken'],
    defaultState: 'idle',
    singleUse: false,
    animMontage: null,
    soundCue: '/Game/Audio/SFX/Puzzle/SC_PipeFlow',
    mesh: '/Game/Meshes/Puzzle/SM_PipeSegment',
    properties: {
      flowType: 'water',          // 'water' | 'lava' | 'energy' | 'shadow'
      pipeShape: 'straight',      // 'straight' | 'elbow' | 'tee' | 'cross'
      rotatable: true,
      currentRotation: 0,         // degrees (0, 90, 180, 270)
      flowCapacity: 1.0,          // units/s
      connectorDirections: [],    // computed from shape + rotation
      flowVfx: '/Game/VFX/Puzzle/NS_PipeFlow_Water',
    },
    outputEvents: ['on_flow_start', 'on_flow_stop', 'on_rotated'],
    inputEvents: ['rotate_cw', 'rotate_ccw', 'set_rotation', 'freeze', 'unfreeze', 'break', 'repair'],
  },

  valve: {
    id: 'valve',
    name: 'Flow Valve',
    category: 'flow',
    blueprintClass: 'BP_PuzzleValve',
    parentClass: 'Actor',
    description: 'Controls flow rate through a pipe network. Can be opened, closed, or set to partial flow. Some valves require specific shard types.',
    interactionType: 'toggle',
    interactionInput: 'interact_key',
    validStates: ['idle', 'activated', 'locked', 'broken', 'frozen'],
    defaultState: 'idle',
    singleUse: false,
    animMontage: '/Game/Animations/Puzzle/AM_ValveTurn',
    soundCue: '/Game/Audio/SFX/Puzzle/SC_ValveTurn',
    mesh: '/Game/Meshes/Puzzle/SM_Valve',
    properties: {
      flowRate: 0,               // 0.0 (closed) to 1.0 (fully open)
      stepSize: 0.25,            // increment per interaction
      requiredShard: null,
      openDirection: 'clockwise',
    },
    outputEvents: ['on_open', 'on_close', 'on_flow_change'],
    inputEvents: ['set_flow_rate', 'force_open', 'force_close', 'lock', 'unlock'],
  },

  reservoir: {
    id: 'reservoir',
    name: 'Reservoir Chamber',
    category: 'flow',
    blueprintClass: 'BP_PuzzleReservoir',
    parentClass: 'Actor',
    description: 'A chamber that fills/drains based on connected pipe network flow. Water level gates access to areas and triggers weight-based mechanisms.',
    interactionType: 'passive',
    interactionInput: 'flow_network',
    validStates: ['idle', 'filling', 'draining', 'full', 'empty', 'frozen'],
    defaultState: 'empty',
    singleUse: false,
    animMontage: null,
    soundCue: '/Game/Audio/SFX/Puzzle/SC_WaterFill',
    mesh: '/Game/Meshes/Puzzle/SM_Reservoir',
    properties: {
      capacity: 100,              // units
      currentLevel: 0,
      fillRate: 5,                // units/s (from pipes)
      drainRate: 2,               // units/s (natural drain or through pipes)
      thresholds: [               // trigger events at these levels
        { level: 25, event: 'quarter_full' },
        { level: 50, event: 'half_full' },
        { level: 75, event: 'three_quarter_full' },
        { level: 100, event: 'full' },
      ],
      waterPlaneMesh: '/Game/Meshes/Puzzle/SM_WaterPlane',
      waterMaterial: '/Game/Materials/M_DungeonWater',
    },
    outputEvents: ['on_threshold_reached', 'on_full', 'on_empty', 'on_level_change'],
    inputEvents: ['set_fill_rate', 'set_drain_rate', 'freeze', 'unfreeze', 'force_level'],
  },

  brazier: {
    id: 'brazier',
    name: 'Fire Brazier',
    category: 'flow',
    blueprintClass: 'BP_PuzzleBrazier',
    parentClass: 'Actor',
    description: 'A brazier that can be lit with Fire shard. Chains to nearby braziers within range. Used in timed chain-lighting puzzles.',
    interactionType: 'shard_hit',
    interactionInput: 'shard_ability',
    validStates: ['idle', 'activated', 'cooldown', 'frozen', 'broken'],
    defaultState: 'idle',
    singleUse: false,
    animMontage: null,
    soundCue: '/Game/Audio/SFX/Puzzle/SC_BrazierIgnite',
    mesh: '/Game/Meshes/Puzzle/SM_Brazier',
    properties: {
      requiredShard: 'Fire',
      burnDuration: 10.0,         // seconds before extinguishing
      chainRadius: 500,           // cm, auto-lights nearby braziers
      chainDelay: 0.5,            // seconds between chain activations
      lightRadius: 600,           // illumination range
      lightColor: { r: 1.0, g: 0.7, b: 0.3, a: 1.0 },
      fireVfx: '/Game/VFX/Puzzle/NS_BrazierFire',
    },
    outputEvents: ['on_ignite', 'on_extinguish', 'on_chain_ignite', 'on_all_lit'],
    inputEvents: ['ignite', 'extinguish', 'freeze', 'set_burn_duration'],
  },

  // ── Environmental Actors ─────────────────────────────────────────────────

  puzzle_door: {
    id: 'puzzle_door',
    name: 'Puzzle Door',
    category: 'gate',
    blueprintClass: 'BP_PuzzleDoor',
    parentClass: 'Actor',
    description: 'A heavy door that opens/closes based on linked switch states. Can require multiple simultaneous activations.',
    interactionType: 'passive',
    interactionInput: 'linked_signal',
    validStates: ['idle', 'activated', 'locked', 'frozen'],
    defaultState: 'idle',
    singleUse: false,
    animMontage: '/Game/Animations/Puzzle/AM_DoorOpen',
    soundCue: '/Game/Audio/SFX/Puzzle/SC_DoorOpen',
    mesh: '/Game/Meshes/Puzzle/SM_PuzzleDoor',
    properties: {
      openSpeed: 1.5,            // seconds to fully open
      closeSpeed: 2.0,
      requireAllInputs: true,    // AND logic: all linked switches must be active
      autoCloseDelay: 0,         // 0 = stays open, >0 = auto-close after N seconds
      openDirection: 'slide_up', // 'slide_up' | 'swing_in' | 'swing_out' | 'split'
    },
    outputEvents: ['on_open', 'on_close', 'on_blocked'],
    inputEvents: ['open', 'close', 'lock', 'unlock', 'freeze'],
  },

  shard_barrier: {
    id: 'shard_barrier',
    name: 'Shard Barrier',
    category: 'gate',
    blueprintClass: 'BP_PuzzleShardBarrier',
    parentClass: 'Actor',
    description: 'An energy barrier attuned to a specific shard. Only dissolves when hit with the matching shard type. Reforms after duration.',
    interactionType: 'shard_hit',
    interactionInput: 'shard_ability',
    validStates: ['idle', 'activated', 'cooldown'],
    defaultState: 'idle',
    singleUse: false,
    animMontage: null,
    soundCue: '/Game/Audio/SFX/Puzzle/SC_BarrierDissolve',
    mesh: null,  // uses VFX plane
    properties: {
      requiredShard: 'any',
      dissolvedDuration: 8.0,    // seconds barrier stays down
      reformDuration: 1.0,       // seconds to reform
      barrierColor: { r: 0.5, g: 0.2, b: 1.0, a: 0.7 },
      barrierVfx: '/Game/VFX/Puzzle/NS_ShardBarrier',
      blockProjectiles: true,
      blockPlayer: true,
    },
    outputEvents: ['on_dissolve', 'on_reform'],
    inputEvents: ['dissolve', 'reform', 'set_shard_type', 'make_permanent'],
  },

  echo_recorder: {
    id: 'echo_recorder',
    name: 'Temporal Echo Recorder',
    category: 'temporal',
    blueprintClass: 'BP_PuzzleEchoRecorder',
    parentClass: 'Actor',
    description: 'Records player actions within its zone for a duration, then replays them as a temporal echo (ghost). Used for "be in two places at once" puzzles.',
    interactionType: 'shard_channel',
    interactionInput: 'shard_ability',
    validStates: ['idle', 'recording', 'replaying', 'cooldown', 'locked'],
    defaultState: 'idle',
    singleUse: false,
    animMontage: null,
    soundCue: '/Game/Audio/SFX/Puzzle/SC_EchoRecord',
    mesh: '/Game/Meshes/Puzzle/SM_EchoRecorder',
    properties: {
      requiredShard: 'Time',
      recordDuration: 8.0,       // max seconds of recording
      replayDelay: 2.0,          // seconds after recording ends before replay starts
      replayCount: 1,            // how many times to replay (-1 = infinite)
      recordZoneRadius: 500,     // cm, recording capture area
      echoMaterial: '/Game/Materials/M_TemporalEcho',
      echoOpacity: 0.6,
    },
    outputEvents: ['on_record_start', 'on_record_end', 'on_replay_start', 'on_replay_end', 'on_echo_interact'],
    inputEvents: ['start_recording', 'stop_recording', 'start_replay', 'clear_recording', 'lock', 'unlock'],
  },
};

// ── Actor Wiring System ─────────────────────────────────────────────────────

/**
 * Wire types that connect puzzle actors together.
 * An output event from one actor triggers an input event on another.
 */
export const WIRE_TYPES = {
  DIRECT:      'direct',       // immediate: output fires → input triggers
  DELAYED:     'delayed',      // fires after configurable delay
  INVERTED:    'inverted',     // fires opposite signal (activate → deactivate)
  CONDITIONAL: 'conditional',  // fires only when condition is true
  PULSE:       'pulse',        // fires once then disconnects until reset
};

/**
 * Logic gate types for combining multiple wire inputs.
 */
export const LOGIC_GATES = {
  AND:  'and',   // all inputs must be active
  OR:   'or',    // any input activates
  XOR:  'xor',   // exactly one input active
  NAND: 'nand',  // NOT AND
  NOT:  'not',   // single input, inverted
};

/**
 * A wire connection between two puzzle actors.
 * @typedef {Object} PuzzleWire
 * @property {string} id - Unique wire identifier
 * @property {string} sourceActorId - Actor producing the event
 * @property {string} sourceEvent - Output event name
 * @property {string} targetActorId - Actor receiving the event
 * @property {string} targetEvent - Input event name
 * @property {string} wireType - From WIRE_TYPES
 * @property {number} [delay] - Delay in seconds (for DELAYED type)
 * @property {object} [condition] - Condition object (for CONDITIONAL type)
 */

/**
 * Create a wire connection definition.
 */
export function createWire(id, sourceActorId, sourceEvent, targetActorId, targetEvent, wireType = 'direct', options = {}) {
  return {
    id,
    sourceActorId,
    sourceEvent,
    targetActorId,
    targetEvent,
    wireType,
    delay: options.delay || 0,
    condition: options.condition || null,
    enabled: options.enabled !== false,
  };
}

// ── Flow Network System ─────────────────────────────────────────────────────

/**
 * Flow types that can travel through pipe networks.
 */
export const FLOW_TYPES = {
  WATER:    { id: 'water',    color: { r: 0.2, g: 0.5, b: 1.0 }, viscosity: 1.0, freezable: true,  ignitable: false },
  LAVA:     { id: 'lava',     color: { r: 1.0, g: 0.3, b: 0.1 }, viscosity: 3.0, freezable: false, ignitable: true  },
  ENERGY:   { id: 'energy',   color: { r: 0.9, g: 0.9, b: 0.2 }, viscosity: 0.1, freezable: false, ignitable: false },
  SHADOW:   { id: 'shadow',   color: { r: 0.2, g: 0.0, b: 0.3 }, viscosity: 0.5, freezable: true,  ignitable: false },
  NATURE:   { id: 'nature',   color: { r: 0.2, g: 0.8, b: 0.3 }, viscosity: 1.5, freezable: true,  ignitable: false },
};

/**
 * Pipe connector directions (local space).
 * A pipe's shape determines which connectors are available.
 */
const PIPE_CONNECTORS = {
  straight: ['north', 'south'],
  elbow:    ['north', 'east'],
  tee:      ['north', 'east', 'south'],
  cross:    ['north', 'east', 'south', 'west'],
};

/**
 * Rotate connector directions by the given rotation (0, 90, 180, 270).
 */
const DIRECTION_ORDER = ['north', 'east', 'south', 'west'];

export function getRotatedConnectors(pipeShape, rotationDeg) {
  const base = PIPE_CONNECTORS[pipeShape] || [];
  const steps = Math.round(rotationDeg / 90) % 4;
  return base.map(dir => {
    const idx = DIRECTION_ORDER.indexOf(dir);
    return DIRECTION_ORDER[(idx + steps) % 4];
  });
}

/**
 * Validate a flow network — checks that all pipe connections are bidirectional
 * and flow can reach from source to destination.
 * @param {object[]} pipes - Array of pipe actor instances with position + shape + rotation
 * @param {string} sourceId - Source pipe/reservoir ID
 * @param {string} destId - Destination pipe/reservoir ID
 * @returns {object} { valid, path, disconnected }
 */
export function validateFlowNetwork(pipes, sourceId, destId) {
  // Build adjacency from pipe connectors
  const adjacency = new Map();
  for (const pipe of pipes) {
    adjacency.set(pipe.id, []);
    const connectors = getRotatedConnectors(pipe.shape || 'straight', pipe.rotation || 0);
    for (const dir of connectors) {
      const neighbor = pipes.find(p => p.id !== pipe.id && isAdjacentInDirection(pipe.position, p.position, dir));
      if (neighbor) {
        // Check reverse connection exists
        const neighborConnectors = getRotatedConnectors(neighbor.shape || 'straight', neighbor.rotation || 0);
        const reverseDir = DIRECTION_ORDER[(DIRECTION_ORDER.indexOf(dir) + 2) % 4];
        if (neighborConnectors.includes(reverseDir)) {
          adjacency.get(pipe.id).push(neighbor.id);
        }
      }
    }
  }

  // BFS from source to dest
  const visited = new Set();
  const queue = [sourceId];
  const parent = new Map();
  visited.add(sourceId);

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === destId) {
      // Reconstruct path
      const path = [destId];
      let node = destId;
      while (parent.has(node)) {
        node = parent.get(node);
        path.unshift(node);
      }
      return { valid: true, path, disconnected: [] };
    }
    for (const neighbor of (adjacency.get(current) || [])) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        parent.set(neighbor, current);
        queue.push(neighbor);
      }
    }
  }

  const disconnected = pipes.map(p => p.id).filter(id => !visited.has(id));
  return { valid: false, path: [], disconnected };
}

/**
 * Check if position B is adjacent to position A in the given direction.
 * Uses a grid spacing of 200cm (UE5 units).
 */
function isAdjacentInDirection(posA, posB, direction) {
  const GRID = 200;
  const TOLERANCE = 20;
  const dx = (posB?.x || 0) - (posA?.x || 0);
  const dy = (posB?.y || 0) - (posA?.y || 0);

  switch (direction) {
    case 'north': return Math.abs(dy - GRID) < TOLERANCE && Math.abs(dx) < TOLERANCE;
    case 'south': return Math.abs(dy + GRID) < TOLERANCE && Math.abs(dx) < TOLERANCE;
    case 'east':  return Math.abs(dx - GRID) < TOLERANCE && Math.abs(dy) < TOLERANCE;
    case 'west':  return Math.abs(dx + GRID) < TOLERANCE && Math.abs(dy) < TOLERANCE;
    default: return false;
  }
}

// ── Room Puzzle Assembly ────────────────────────────────────────────────────

/**
 * A puzzle assembly defines all actors and wires needed for a single room puzzle.
 * This is the data structure that gets placed into a UE5 sublevel.
 */
export function createPuzzleAssembly(roomId, options = {}) {
  return {
    roomId,
    dungeonId: options.dungeonId || 'unknown',
    actors: options.actors || [],
    wires: options.wires || [],
    flowNetwork: options.flowNetwork || null,
    triggers: {
      onEnter: options.onEnterTrigger || null,
      onSolve: options.onSolveTrigger || null,
      onFail: options.onFailTrigger || null,
    },
    checkpoints: options.checkpoints || [],
    hintActors: options.hintActors || [],
    metadata: {
      difficulty: options.difficulty || 1,
      estimatedTime: options.estimatedTime || 60,
      shardRequired: options.shardRequired || [],
      mechanics: options.mechanics || [],
    },
  };
}

/**
 * Pre-built puzzle assembly templates for common puzzle patterns.
 * Each template can be parameterized and placed in any dungeon room.
 */
export const PUZZLE_TEMPLATES = {

  // Two-switch door: Both switches must be active to open door
  dual_switch_door: {
    id: 'dual_switch_door',
    name: 'Dual Switch Door',
    description: 'Two switches must be activated simultaneously to open a door. Classic co-op style — use temporal echo or weighted objects.',
    actors: [
      { templateId: 'switch_a', type: 'lever',          position: { x: -300, y: 0, z: 0 } },
      { templateId: 'switch_b', type: 'pressure_plate', position: { x: 300, y: 0, z: 0 } },
      { templateId: 'door',     type: 'puzzle_door',     position: { x: 0, y: 500, z: 0 }, properties: { requireAllInputs: true } },
    ],
    wires: [
      { source: 'switch_a', sourceEvent: 'on_activated',   target: 'door', targetEvent: 'open', wireType: 'direct' },
      { source: 'switch_a', sourceEvent: 'on_deactivated', target: 'door', targetEvent: 'close', wireType: 'direct' },
      { source: 'switch_b', sourceEvent: 'on_pressed',     target: 'door', targetEvent: 'open', wireType: 'direct' },
      { source: 'switch_b', sourceEvent: 'on_released',    target: 'door', targetEvent: 'close', wireType: 'direct' },
    ],
    logicGate: 'and',
    shardRequired: [],
    difficulty: 1,
  },

  // Pipe routing: Connect source to reservoir through rotatable pipes
  pipe_routing: {
    id: 'pipe_routing',
    name: 'Pipe Routing Puzzle',
    description: 'Rotate pipe segments to connect a water source to a reservoir. Once reservoir fills, it opens a weighted gate.',
    actors: [
      { templateId: 'source',   type: 'reservoir',    position: { x: 0, y: 0, z: 0 },    properties: { currentLevel: 100, capacity: 100 } },
      { templateId: 'pipe_1',   type: 'pipe_segment', position: { x: 200, y: 0, z: 0 },   properties: { pipeShape: 'elbow', rotatable: true } },
      { templateId: 'pipe_2',   type: 'pipe_segment', position: { x: 400, y: 0, z: 0 },   properties: { pipeShape: 'straight', rotatable: true } },
      { templateId: 'pipe_3',   type: 'pipe_segment', position: { x: 400, y: 200, z: 0 }, properties: { pipeShape: 'elbow', rotatable: true } },
      { templateId: 'dest',     type: 'reservoir',    position: { x: 400, y: 400, z: 0 }, properties: { capacity: 50, currentLevel: 0 } },
      { templateId: 'gate',     type: 'puzzle_door',   position: { x: 600, y: 400, z: 0 } },
    ],
    wires: [
      { source: 'dest', sourceEvent: 'on_full', target: 'gate', targetEvent: 'open', wireType: 'direct' },
      { source: 'dest', sourceEvent: 'on_empty', target: 'gate', targetEvent: 'close', wireType: 'direct' },
    ],
    logicGate: null,
    shardRequired: ['Water'],
    difficulty: 2,
  },

  // Crystal chain: Activate crystals in sequence within time limit
  crystal_chain: {
    id: 'crystal_chain',
    name: 'Crystal Chain Resonance',
    description: 'Hit crystal resonators in the correct order. Each crystal chains to the next if hit within the time window. All 4 must resonate simultaneously.',
    actors: [
      { templateId: 'crystal_1', type: 'crystal_resonator', position: { x: -400, y: -200, z: 0 }, properties: { chainActivation: false, resonanceDuration: 6.0 } },
      { templateId: 'crystal_2', type: 'crystal_resonator', position: { x: -200, y: 200, z: 0 },  properties: { chainActivation: false, resonanceDuration: 5.0 } },
      { templateId: 'crystal_3', type: 'crystal_resonator', position: { x: 200, y: -200, z: 0 },  properties: { chainActivation: false, resonanceDuration: 4.0 } },
      { templateId: 'crystal_4', type: 'crystal_resonator', position: { x: 400, y: 200, z: 0 },   properties: { chainActivation: false, resonanceDuration: 3.0 } },
      { templateId: 'barrier',   type: 'shard_barrier',     position: { x: 0, y: 500, z: 0 },      properties: { requiredShard: null } },
    ],
    wires: [
      // All 4 crystals must be resonating simultaneously (AND gate)
      { source: 'crystal_1', sourceEvent: 'on_resonance_start', target: 'barrier', targetEvent: 'dissolve', wireType: 'conditional', condition: { gate: 'and', requires: ['crystal_2', 'crystal_3', 'crystal_4'] } },
      { source: 'crystal_2', sourceEvent: 'on_resonance_start', target: 'barrier', targetEvent: 'dissolve', wireType: 'conditional', condition: { gate: 'and', requires: ['crystal_1', 'crystal_3', 'crystal_4'] } },
      { source: 'crystal_3', sourceEvent: 'on_resonance_start', target: 'barrier', targetEvent: 'dissolve', wireType: 'conditional', condition: { gate: 'and', requires: ['crystal_1', 'crystal_2', 'crystal_4'] } },
      { source: 'crystal_4', sourceEvent: 'on_resonance_start', target: 'barrier', targetEvent: 'dissolve', wireType: 'conditional', condition: { gate: 'and', requires: ['crystal_1', 'crystal_2', 'crystal_3'] } },
    ],
    logicGate: 'and',
    shardRequired: [],
    difficulty: 2,
  },

  // Timed brazier chain: Light all braziers before first one goes out
  brazier_chain: {
    id: 'brazier_chain',
    name: 'Timed Brazier Chain',
    description: 'Light the first brazier with Fire shard. Each one chains to the next. All must be lit simultaneously — but they burn out. Plan your route.',
    actors: [
      { templateId: 'brazier_1', type: 'brazier', position: { x: -600, y: 0, z: 0 },   properties: { burnDuration: 12.0, chainRadius: 500 } },
      { templateId: 'brazier_2', type: 'brazier', position: { x: -200, y: 300, z: 0 },  properties: { burnDuration: 10.0, chainRadius: 500 } },
      { templateId: 'brazier_3', type: 'brazier', position: { x: 200, y: -300, z: 0 },  properties: { burnDuration: 8.0,  chainRadius: 500 } },
      { templateId: 'brazier_4', type: 'brazier', position: { x: 600, y: 0, z: 0 },     properties: { burnDuration: 6.0,  chainRadius: 500 } },
      { templateId: 'gate',      type: 'puzzle_door', position: { x: 0, y: 600, z: 0 } },
    ],
    wires: [
      { source: 'brazier_1', sourceEvent: 'on_all_lit', target: 'gate', targetEvent: 'open', wireType: 'direct' },
    ],
    logicGate: 'and',
    shardRequired: ['Fire'],
    difficulty: 2,
  },

  // Echo recorder: Record action, replay it while doing something else
  temporal_echo_puzzle: {
    id: 'temporal_echo_puzzle',
    name: 'Temporal Echo Puzzle',
    description: 'Record yourself pulling a lever, then rush to a distant pressure plate. Your echo replays the lever pull while you hold the plate.',
    actors: [
      { templateId: 'recorder',  type: 'echo_recorder',  position: { x: -400, y: 0, z: 0 },   properties: { recordDuration: 6.0, replayCount: 1 } },
      { templateId: 'lever',     type: 'lever',          position: { x: -300, y: 0, z: 0 } },
      { templateId: 'plate',     type: 'pressure_plate', position: { x: 500, y: 0, z: 0 } },
      { templateId: 'door',      type: 'puzzle_door',     position: { x: 0, y: 400, z: 0 },    properties: { requireAllInputs: true, autoCloseDelay: 0 } },
    ],
    wires: [
      { source: 'lever', sourceEvent: 'on_activated',   target: 'door', targetEvent: 'open', wireType: 'direct' },
      { source: 'lever', sourceEvent: 'on_deactivated', target: 'door', targetEvent: 'close', wireType: 'direct' },
      { source: 'plate', sourceEvent: 'on_pressed',     target: 'door', targetEvent: 'open', wireType: 'direct' },
      { source: 'plate', sourceEvent: 'on_released',    target: 'door', targetEvent: 'close', wireType: 'direct' },
    ],
    logicGate: 'and',
    shardRequired: ['Time'],
    difficulty: 2,
  },

  // Nature growth bridge: Channel Nature shard to grow vine bridge across gap
  growth_bridge: {
    id: 'growth_bridge',
    name: 'Living Growth Bridge',
    description: 'Channel Nature shard at a vine bridge anchor to grow a bridge across a gap. Bridge decays if you stop channeling — must cross quickly.',
    actors: [
      { templateId: 'bridge',   type: 'vine_bridge',    position: { x: 0, y: 0, z: 0 },     properties: { growthDuration: 2.0, decayRate: 0.15, maxLength: 600 } },
      { templateId: 'crystal',  type: 'crystal_resonator', position: { x: -200, y: 0, z: 0 }, properties: { requiredShard: 'Nature' } },
    ],
    wires: [
      { source: 'crystal', sourceEvent: 'on_resonance_start', target: 'bridge', targetEvent: 'grow', wireType: 'direct' },
      { source: 'crystal', sourceEvent: 'on_resonance_end',   target: 'bridge', targetEvent: 'decay', wireType: 'delayed', delay: 1.0 },
    ],
    logicGate: null,
    shardRequired: ['Nature'],
    difficulty: 1,
  },
};

// ── Query & Export Functions (ms_2) ─────────────────────────────────────────

/**
 * Get all puzzle actor type definitions.
 * @returns {object[]}
 */
export function getPuzzleActorTypes() {
  return Object.values(PUZZLE_ACTOR_TYPES).map(a => ({
    id: a.id,
    name: a.name,
    category: a.category,
    blueprintClass: a.blueprintClass,
    interactionType: a.interactionType,
    validStates: a.validStates,
    outputEvents: a.outputEvents,
    inputEvents: a.inputEvents,
    description: a.description,
  }));
}

/**
 * Get a specific actor type definition with full details.
 * @param {string} actorTypeId
 * @returns {object|null}
 */
export function getPuzzleActorType(actorTypeId) {
  return PUZZLE_ACTOR_TYPES[actorTypeId] || { error: `Unknown actor type: ${actorTypeId}` };
}

/**
 * Get all puzzle assembly templates.
 * @returns {object[]}
 */
export function getPuzzleTemplates() {
  return Object.values(PUZZLE_TEMPLATES).map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    actorCount: t.actors.length,
    wireCount: t.wires.length,
    shardRequired: t.shardRequired,
    difficulty: t.difficulty,
    logicGate: t.logicGate,
  }));
}

/**
 * Get a specific puzzle template with full actor + wire details.
 * @param {string} templateId
 * @returns {object|null}
 */
export function getPuzzleTemplate(templateId) {
  return PUZZLE_TEMPLATES[templateId] || { error: `Unknown template: ${templateId}` };
}

/**
 * Get actor state machine — all states and valid transitions.
 * @returns {object}
 */
export function getActorStateMachine() {
  return {
    states: Object.values(ACTOR_STATES),
    transitions: ACTOR_TRANSITIONS,
    wireTypes: Object.values(WIRE_TYPES),
    logicGates: Object.values(LOGIC_GATES),
  };
}

/**
 * Get flow network component info.
 * @returns {object}
 */
export function getFlowNetworkInfo() {
  return {
    flowTypes: FLOW_TYPES,
    pipeShapes: Object.keys(PIPE_CONNECTORS),
    pipeConnectors: PIPE_CONNECTORS,
    directionOrder: DIRECTION_ORDER,
    flowActors: ['pipe_segment', 'valve', 'reservoir', 'brazier'].map(id => ({
      id,
      name: PUZZLE_ACTOR_TYPES[id].name,
      description: PUZZLE_ACTOR_TYPES[id].description,
    })),
  };
}

/**
 * Export puzzle actor framework specs to JSON for UE5 blueprint generation.
 */
export function exportPuzzleActorSpecs() {
  const game = getActiveGame();
  const outDir = join(game.assetsPath, 'Dungeons');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const exportData = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    milestone: 'ms_2',
    description: 'Puzzle actor framework — switches, platforms, flow networks, wiring, templates',
    actorTypes: PUZZLE_ACTOR_TYPES,
    actorStates: ACTOR_STATES,
    transitions: ACTOR_TRANSITIONS,
    wireTypes: WIRE_TYPES,
    logicGates: LOGIC_GATES,
    flowTypes: FLOW_TYPES,
    puzzleTemplates: PUZZLE_TEMPLATES,
  };

  const outPath = join(outDir, 'puzzle-actor-framework.json');
  writeFileSync(outPath, JSON.stringify(exportData, null, 2), 'utf-8');
  log.info(`Puzzle actor framework exported to ${outPath}`);
  return { success: true, path: outPath, actorTypeCount: Object.keys(PUZZLE_ACTOR_TYPES).length, templateCount: Object.keys(PUZZLE_TEMPLATES).length };
}

// ══════════════════════════════════════════════════════════════════════════════
// ms_3: Shard Power Puzzle Interactions — Non-combat applications of each shard
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Each shard type has puzzle-specific abilities that replace combat in dungeons.
 * These define HOW the player interacts with puzzle actors using their shard powers.
 *
 * Key design principle: In echo dungeons, combat is disabled. Shard powers are
 * repurposed as environmental manipulation tools. The same ability that deals
 * damage in combat becomes a puzzle-solving tool inside a dungeon.
 */

// ── Shard Puzzle Ability Definitions ────────────────────────────────────────

export const SHARD_PUZZLE_ABILITIES = {

  // ── Time Shard ────────────────────────────────────────────────────────────
  Time: {
    shardType: 'Time',
    combatAbility: 'Temporal Strike — slows enemies and deals temporal damage',
    puzzleAbilities: [
      {
        id: 'time_rewind',
        name: 'Chrono Rewind',
        description: 'Target an object and rewind it to a previous state. Collapsed bridges reform, rusted gears restore, sealed doors reopen. Effect persists while channeling + a fade window.',
        inputType: 'aim_and_hold',
        controls: {
          primary: 'Aim at target → hold RT/right-click to channel',
          cancel: 'Release to stop — rewound object fades back over 3-5s',
          modifier: 'Hold LB/shift to lock rewind (costs extra shard energy)',
        },
        energy: { channelCost: 2, perSecond: 1.5, lockCost: 5 },
        maxRange: 1500,
        maxDuration: 15,
        fadeWindow: 5,
        affectsActorTypes: ['lever', 'pressure_plate', 'puzzle_door', 'pipe_segment', 'moving_platform', 'vine_bridge'],
        interactions: [
          { actorType: 'puzzle_door',     effect: 'Rewinds door to open/closed state from past — can undo a triggered close or reopen a locked door whose key decayed' },
          { actorType: 'pipe_segment',    effect: 'Restores broken/corroded pipes to functional state — allows flow through previously blocked paths' },
          { actorType: 'moving_platform', effect: 'Rewinds platform to a previous position along its path — useful for reaching locations the platform no longer visits' },
          { actorType: 'vine_bridge',     effect: 'Rewinds decay — a collapsed vine bridge temporarily reforms' },
          { actorType: 'lever',           effect: 'Rewinds lever to previous toggle state — effectively remote-toggles it' },
        ],
        vfx: { channel: 'NS_TimeRewind_Channel', target: 'NS_TimeRewind_Object', fade: 'NS_TimeRewind_Fade' },
        sfx: { start: 'SC_TimeRewind_Start', loop: 'SC_TimeRewind_Loop', end: 'SC_TimeRewind_End' },
      },
      {
        id: 'time_freeze',
        name: 'Temporal Lock',
        description: 'Freeze a moving object in time. Platforms stop mid-motion, flowing water becomes solid ice walkway, pendulums halt. Object becomes static and collidable.',
        inputType: 'aim_and_tap',
        controls: {
          primary: 'Aim at moving object → tap RT/right-click to freeze',
          cancel: 'Tap again to unfreeze, or wait for duration expiry',
        },
        energy: { castCost: 4, maintainCost: 0 },
        maxRange: 2000,
        maxDuration: 12,
        maxFrozenObjects: 3,
        affectsActorTypes: ['moving_platform', 'rotating_platform', 'pipe_segment', 'reservoir', 'brazier'],
        interactions: [
          { actorType: 'moving_platform',   effect: 'Freezes platform at current position — becomes static platform player can stand on' },
          { actorType: 'rotating_platform',  effect: 'Locks rotation at current angle — useful for aligning paths or beam reflectors' },
          { actorType: 'reservoir',          effect: 'Freezes water level — prevents filling or draining, water surface becomes walkable ice' },
          { actorType: 'pipe_segment',       effect: 'Freezes flow inside pipe — can create ice bridges inside large pipes or block flow to redirect it' },
          { actorType: 'brazier',            effect: 'Freezes flame — fire becomes solid temporal crystal, emitting light but no heat. Can be pushed as physics object' },
        ],
        vfx: { cast: 'NS_TimeFreeze_Cast', frozen: 'NS_TimeFreeze_Object', thaw: 'NS_TimeFreeze_Thaw' },
        sfx: { cast: 'SC_TimeFreeze_Cast', frozen_loop: 'SC_TimeFreeze_Loop', thaw: 'SC_TimeFreeze_Thaw' },
      },
      {
        id: 'time_echo',
        name: 'Temporal Echo',
        description: 'Record your actions for up to 8 seconds, then replay them as a ghost echo. The echo physically interacts with the world — pulls levers, stands on plates, carries objects.',
        inputType: 'toggle',
        controls: {
          primary: 'Press LB+RT to start recording (icon appears)',
          secondary: 'Press LB+RT again to stop recording',
          replay: 'Echo auto-replays after 2s delay. Press LB+RT a third time to replay early.',
        },
        energy: { recordCost: 3, replayCost: 5 },
        maxRange: 0, // self
        maxDuration: 8,
        replayDelay: 2,
        replayCount: 1,
        affectsActorTypes: ['lever', 'pressure_plate', 'crystal_resonator', 'valve', 'echo_recorder'],
        interactions: [
          { actorType: 'lever',             effect: 'Echo pulls the lever during replay — toggles state as if player did it' },
          { actorType: 'pressure_plate',    effect: 'Echo stands on plate during replay — sustains hold activation' },
          { actorType: 'crystal_resonator', effect: 'Echo hits crystal with shard ability during replay — triggers resonance' },
          { actorType: 'valve',             effect: 'Echo turns valve during replay — adjusts flow rate' },
          { actorType: 'echo_recorder',     effect: 'Echo is captured by recorder — allows nested recording for multi-echo puzzles' },
        ],
        vfx: { recording: 'NS_Echo_Recording', ghost: 'NS_Echo_Ghost', interact: 'NS_Echo_Interact' },
        sfx: { record_start: 'SC_Echo_RecordStart', record_end: 'SC_Echo_RecordEnd', replay: 'SC_Echo_Replay' },
      },
    ],
  },

  // ── Water Shard ───────────────────────────────────────────────────────────
  Water: {
    shardType: 'Water',
    combatAbility: 'Water Jet — pressurized water blast for damage and knockback',
    puzzleAbilities: [
      {
        id: 'water_jet',
        name: 'Hydro Push',
        description: 'Shoot a continuous stream of water. Fills reservoirs, pushes lightweight objects, cleans grime off rune panels, and powers water wheels. Can also extinguish fires.',
        inputType: 'aim_and_hold',
        controls: {
          primary: 'Aim → hold RT to spray continuous water stream',
          modifier: 'Hold LB for focused high-pressure beam (narrower, longer range)',
        },
        energy: { channelCost: 1, perSecond: 1.0 },
        maxRange: 1200,
        maxDuration: null, // limited by energy
        flowRate: 10, // units/s added to reservoirs
        pushForce: 800, // Newtons for physics objects
        affectsActorTypes: ['reservoir', 'pipe_segment', 'valve', 'brazier', 'pressure_plate', 'rune_panel'],
        interactions: [
          { actorType: 'reservoir',      effect: 'Fills reservoir at 10 units/s — much faster than pipe network flow. Direct hydro charging.' },
          { actorType: 'pipe_segment',   effect: 'Forces water through pipe regardless of valve state — temporary override for blocked networks' },
          { actorType: 'valve',          effect: 'Water pressure pushes valve open — bypasses locked valves with sustained flow' },
          { actorType: 'brazier',        effect: 'Extinguishes lit brazier — useful for resetting chain sequences or creating dark zones' },
          { actorType: 'pressure_plate', effect: 'Continuous water stream weighs enough to hold pressure plate (with focused beam)' },
          { actorType: 'rune_panel',     effect: 'Washes away grime/corruption to reveal hidden rune sequences' },
        ],
        vfx: { stream: 'NS_WaterJet_Stream', impact: 'NS_WaterJet_Impact', focused: 'NS_WaterJet_Focused' },
        sfx: { start: 'SC_WaterJet_Start', loop: 'SC_WaterJet_Loop', impact: 'SC_WaterJet_Impact' },
      },
      {
        id: 'water_freeze',
        name: 'Cryo Snap',
        description: 'Flash-freeze water surfaces to create walkable ice platforms. Freeze waterfalls to create climbable walls. Freeze pipe contents to block flow.',
        inputType: 'aim_and_tap',
        controls: {
          primary: 'Aim at water surface/waterfall → tap RT to freeze',
          cancel: 'Tap again to thaw, or wait for natural thaw',
        },
        energy: { castCost: 5 },
        maxRange: 1500,
        maxDuration: 20,
        maxFrozenSurfaces: 4,
        affectsActorTypes: ['reservoir', 'pipe_segment', 'vine_bridge'],
        interactions: [
          { actorType: 'reservoir',    effect: 'Freezes water surface — creates walkable ice platform at current water level. Level can be set first, then frozen.' },
          { actorType: 'pipe_segment', effect: 'Freezes pipe contents — blocks flow through that pipe. Useful for redirecting flow in networks.' },
          { actorType: 'vine_bridge',  effect: 'If bridge is over water, freezes the water underneath — creates ice backup if vine decays' },
        ],
        vfx: { cast: 'NS_CryoSnap_Cast', frozen: 'NS_CryoSnap_Surface', thaw: 'NS_CryoSnap_Thaw' },
        sfx: { cast: 'SC_CryoSnap_Cast', frozen: 'SC_CryoSnap_Crackle', thaw: 'SC_CryoSnap_Thaw' },
      },
      {
        id: 'water_current',
        name: 'Tidal Pull',
        description: 'Create a water current that pulls objects and the player along a path. Use to transport objects to pressure plates or guide flow through pipe networks.',
        inputType: 'aim_and_drag',
        controls: {
          primary: 'Aim at water body → hold RT and drag to set current direction',
          secondary: 'Tap LB to reverse current direction',
        },
        energy: { castCost: 3, maintainCost: 1.5 },
        maxRange: 800,
        maxDuration: 10,
        currentSpeed: 300, // cm/s
        affectsActorTypes: ['reservoir', 'pipe_segment', 'pressure_plate'],
        interactions: [
          { actorType: 'reservoir',      effect: 'Creates directional current in reservoir — moves floating objects toward desired location' },
          { actorType: 'pipe_segment',   effect: 'Redirects flow direction — can push water uphill through pipes temporarily' },
          { actorType: 'pressure_plate', effect: 'Current drags floating object onto underwater pressure plate' },
        ],
        vfx: { cast: 'NS_TidalPull_Cast', current: 'NS_TidalPull_Current', object: 'NS_TidalPull_Object' },
        sfx: { cast: 'SC_TidalPull_Cast', loop: 'SC_TidalPull_Loop' },
      },
    ],
  },

  // ── Fire Shard ────────────────────────────────────────────────────────────
  Fire: {
    shardType: 'Fire',
    combatAbility: 'Fire Lance — focused fire projectile for high single-target damage',
    puzzleAbilities: [
      {
        id: 'fire_ignite',
        name: 'Ember Touch',
        description: 'Ignite flammable objects and braziers. Melt ice blockages. Heat metal to expand it (opening gaps). Light dark rooms to reveal hidden paths.',
        inputType: 'aim_and_tap',
        controls: {
          primary: 'Aim at target → tap RT to launch fire bolt',
          modifier: 'Hold RT for charged shot — melts larger ice/metal objects',
        },
        energy: { tapCost: 2, chargedCost: 5 },
        maxRange: 2000,
        chargeTime: 1.5,
        heatValue: 100, // thermal units applied to target
        affectsActorTypes: ['brazier', 'crystal_resonator', 'pipe_segment', 'puzzle_door', 'shard_barrier', 'vine_bridge'],
        interactions: [
          { actorType: 'brazier',           effect: 'Ignites brazier — starts burn timer and chain-ignition sequence' },
          { actorType: 'crystal_resonator', effect: 'If Fire-attuned, triggers resonance. Otherwise, overheats crystal causing temporary disable (cooldown).' },
          { actorType: 'pipe_segment',      effect: 'Melts ice blockage in frozen pipe — restores flow. Also heats metal pipes to expand openings.' },
          { actorType: 'puzzle_door',       effect: 'Heats metal door mechanism — thermal expansion opens jammed/rusted locks' },
          { actorType: 'shard_barrier',     effect: 'Fire-typed barriers dissolve on hit. Water/Nature barriers are weakened (half duration reduction).' },
          { actorType: 'vine_bridge',       effect: 'Burns vine bridge — destructive but can clear overgrown blockages covering other paths' },
        ],
        vfx: { bolt: 'NS_FireBolt_Projectile', impact: 'NS_FireBolt_Impact', charged: 'NS_FireBolt_Charged' },
        sfx: { cast: 'SC_FireBolt_Cast', impact: 'SC_FireBolt_Impact', charge: 'SC_FireBolt_Charge' },
      },
      {
        id: 'fire_chain',
        name: 'Flame Conduit',
        description: 'Create a fire link between two points. Fire travels along the link, igniting everything in its path. Used to chain-light distant braziers or transfer heat through walls.',
        inputType: 'aim_two_points',
        controls: {
          primary: 'Tap RT on source object, then tap RT on destination — fire link forms',
          cancel: 'Tap LB to cancel pending link',
        },
        energy: { castCost: 6 },
        maxRange: 1000,
        maxLinks: 2,
        linkDuration: 8,
        affectsActorTypes: ['brazier', 'crystal_resonator', 'pipe_segment'],
        interactions: [
          { actorType: 'brazier',           effect: 'Creates fire conduit between two braziers — guaranteed chain ignition regardless of distance (within range)' },
          { actorType: 'crystal_resonator', effect: 'Transfers resonance from one Fire crystal to another through walls/obstacles' },
          { actorType: 'pipe_segment',      effect: 'Sends heat through pipe network — can melt ice in pipes at the other end' },
        ],
        vfx: { link: 'NS_FlameConduit_Link', travel: 'NS_FlameConduit_Travel', arrive: 'NS_FlameConduit_Arrive' },
        sfx: { cast: 'SC_FlameConduit_Cast', travel: 'SC_FlameConduit_Travel', arrive: 'SC_FlameConduit_Arrive' },
      },
      {
        id: 'fire_forge',
        name: 'Crucible Flame',
        description: 'Sustained intense heat that can forge raw materials into puzzle keys. Heat metal ore in forging nodes to create bridge segments, gear replacements, or door keys.',
        inputType: 'aim_and_hold',
        controls: {
          primary: 'Aim at forge node → hold RT to heat. Temperature gauge fills.',
          warning: 'Overheating (held too long) causes material to shatter — must find new ore.',
        },
        energy: { channelCost: 2, perSecond: 2.0 },
        maxRange: 500,
        maxDuration: null,
        targetTemperature: 100, // forge node has target temp for success
        overheatThreshold: 130, // above this = shatter
        affectsActorTypes: ['rune_panel', 'puzzle_door'],
        interactions: [
          { actorType: 'rune_panel', effect: 'Forge node near panel — heat ore to create the correct rune-key that completes the panel sequence' },
          { actorType: 'puzzle_door', effect: 'Forge door key from raw materials — permanent solution vs. temporary workarounds' },
        ],
        vfx: { channel: 'NS_CrucibleFlame_Channel', heat: 'NS_CrucibleFlame_Heat', forge: 'NS_CrucibleFlame_Forge', shatter: 'NS_CrucibleFlame_Shatter' },
        sfx: { channel: 'SC_CrucibleFlame_Channel', forge: 'SC_CrucibleFlame_Forge', shatter: 'SC_CrucibleFlame_Shatter' },
      },
    ],
  },

  // ── Nature Shard ──────────────────────────────────────────────────────────
  Nature: {
    shardType: 'Nature',
    combatAbility: 'Vine Lash — whip of thorned vines for AoE damage and root',
    puzzleAbilities: [
      {
        id: 'nature_grow',
        name: 'Verdant Touch',
        description: 'Channel Nature energy to grow plants rapidly. Create vine bridges, grow roots to block/redirect flow, raise platforms from seed pods, and create living ladders.',
        inputType: 'aim_and_hold',
        controls: {
          primary: 'Aim at growth node (glowing seed) → hold RT to channel growth',
          modifier: 'Hold LB to overgrow — creates denser/stronger growth (costs more)',
        },
        energy: { channelCost: 2, perSecond: 1.0, overGrowCost: 3.0 },
        maxRange: 1200,
        maxDuration: null,
        growthRate: 1.0, // growth units/s
        affectsActorTypes: ['vine_bridge', 'pipe_segment', 'reservoir', 'pressure_plate', 'puzzle_door'],
        interactions: [
          { actorType: 'vine_bridge',    effect: 'Grows vine bridge from anchor point — primary bridge creation ability' },
          { actorType: 'pipe_segment',   effect: 'Grows roots inside pipe — can block flow to redirect it through alternate paths. Overgrow to permanently block.' },
          { actorType: 'reservoir',      effect: 'Grows water lilies on surface — creates stepping stones across filled reservoirs' },
          { actorType: 'pressure_plate', effect: 'Grows a heavy root cluster on plate — sustains hold activation without player presence' },
          { actorType: 'puzzle_door',    effect: 'Grows vines into door mechanism — roots pry open jammed doors slowly' },
        ],
        vfx: { channel: 'NS_VerdantTouch_Channel', grow: 'NS_VerdantTouch_Grow', overgrow: 'NS_VerdantTouch_Overgrow' },
        sfx: { channel: 'SC_VerdantTouch_Channel', grow: 'SC_VerdantTouch_Grow', complete: 'SC_VerdantTouch_Complete' },
      },
      {
        id: 'nature_decay',
        name: 'Entropic Bloom',
        description: 'Accelerate decay on organic matter. Rot away vine blockages, decompose wooden barriers, and turn fallen logs into fertile soil that spawns growth nodes.',
        inputType: 'aim_and_tap',
        controls: {
          primary: 'Aim at organic obstacle → tap RT to decay',
        },
        energy: { castCost: 3 },
        maxRange: 1000,
        decayDuration: 3, // seconds for full decomposition
        affectsActorTypes: ['vine_bridge', 'puzzle_door', 'shard_barrier'],
        interactions: [
          { actorType: 'vine_bridge',   effect: 'Rapidly decays vine bridge — useful for clearing path underneath or resetting puzzle state' },
          { actorType: 'puzzle_door',   effect: 'Decays wooden door components — opens wooden doors permanently (irreversible)' },
          { actorType: 'shard_barrier', effect: 'Nature barriers wilt and dissolve. Non-nature barriers grow moss that weakens them.' },
        ],
        vfx: { cast: 'NS_EntropicBloom_Cast', decay: 'NS_EntropicBloom_Decay', soil: 'NS_EntropicBloom_Soil' },
        sfx: { cast: 'SC_EntropicBloom_Cast', decay: 'SC_EntropicBloom_Decay' },
      },
      {
        id: 'nature_symbiosis',
        name: 'Symbiotic Link',
        description: 'Link two plants to share resources. A well-lit plant shares energy with a dark-zone plant. A watered plant shares moisture with a dry one. Creates ecosystem chains.',
        inputType: 'aim_two_points',
        controls: {
          primary: 'Tap RT on first plant, then RT on second — symbiotic link forms',
          cancel: 'Tap LB to cancel',
        },
        energy: { castCost: 4 },
        maxRange: 800,
        maxLinks: 3,
        linkDuration: 30, // long duration — persists for the puzzle
        affectsActorTypes: ['vine_bridge', 'crystal_resonator'],
        interactions: [
          { actorType: 'vine_bridge',      effect: 'Linked bridges share vitality — as long as one is channeled, both stay grown' },
          { actorType: 'crystal_resonator', effect: 'If Nature-attuned, linked crystals share resonance state — activating one activates the linked one' },
        ],
        vfx: { link: 'NS_SymbioticLink_Link', pulse: 'NS_SymbioticLink_Pulse' },
        sfx: { cast: 'SC_SymbioticLink_Cast', pulse: 'SC_SymbioticLink_Pulse' },
      },
    ],
  },

  // ── Shadow Shard ──────────────────────────────────────────────────────────
  Shadow: {
    shardType: 'Shadow',
    combatAbility: 'Shadow Step — teleport behind enemies and deal backstab damage',
    puzzleAbilities: [
      {
        id: 'shadow_phase',
        name: 'Umbral Phase',
        description: 'Phase through shadow-marked walls and barriers. The player becomes incorporeal for a short duration, passing through thin obstacles. Cannot interact with objects while phased.',
        inputType: 'tap',
        controls: {
          primary: 'Tap RT near shadow-marked wall to phase through',
          timing: 'Must commit — 1s phase duration, cannot cancel mid-phase',
        },
        energy: { castCost: 4 },
        maxRange: 0, // self
        phaseDuration: 1.0,
        phaseDistance: 300, // cm max phase-through distance
        affectsActorTypes: ['puzzle_door', 'shard_barrier'],
        interactions: [
          { actorType: 'puzzle_door',   effect: 'Phase through closed doors that have shadow markers — bypasses lock puzzles but can only go one way' },
          { actorType: 'shard_barrier', effect: 'Phase through Shadow barriers completely — no dissolve needed. Other barrier types block phasing.' },
        ],
        vfx: { cast: 'NS_UmbralPhase_Cast', phase: 'NS_UmbralPhase_Ghost', emerge: 'NS_UmbralPhase_Emerge' },
        sfx: { cast: 'SC_UmbralPhase_Cast', phase: 'SC_UmbralPhase_Whoosh', emerge: 'SC_UmbralPhase_Emerge' },
      },
      {
        id: 'shadow_swap',
        name: 'Shadow Swap',
        description: 'Place a shadow marker, then teleport back to it from anywhere in the room. Can also swap positions with shadow-marked objects.',
        inputType: 'place_and_activate',
        controls: {
          primary: 'Tap RT to place shadow marker at feet (or on an object)',
          secondary: 'Tap RT again to teleport/swap to marker',
          cancel: 'Hold LB to dismiss marker',
        },
        energy: { placeCost: 2, swapCost: 3 },
        maxRange: 0, // unlimited within room
        markerDuration: 60,
        maxMarkers: 1,
        affectsActorTypes: ['pressure_plate', 'crystal_resonator', 'moving_platform'],
        interactions: [
          { actorType: 'pressure_plate',    effect: 'Place marker on plate, step off, swap back later — instant activation from distance' },
          { actorType: 'crystal_resonator', effect: 'Mark a crystal, then swap to it — useful for reaching elevated/isolated crystals' },
          { actorType: 'moving_platform',   effect: 'Mark a platform, let it move, then swap to ride it at a different point in its path' },
        ],
        vfx: { place: 'NS_ShadowSwap_Place', marker: 'NS_ShadowSwap_Marker', swap: 'NS_ShadowSwap_Teleport' },
        sfx: { place: 'SC_ShadowSwap_Place', swap: 'SC_ShadowSwap_Teleport' },
      },
      {
        id: 'shadow_realm',
        name: 'Dark Sight',
        description: 'Toggle between light and shadow realms. In the shadow realm, hidden platforms appear, invisible paths are revealed, and some walls become passable. Objects placed in one realm persist in the other.',
        inputType: 'toggle',
        controls: {
          primary: 'Press LB+RT to toggle shadow realm on/off',
          warning: 'Shadow realm drains energy over time — can\'t stay indefinitely',
        },
        energy: { toggleCost: 3, perSecond: 0.5 },
        maxRange: 0,
        maxDuration: 30,
        affectsActorTypes: ['appearing_platform', 'puzzle_door', 'shard_barrier', 'crystal_resonator', 'rune_panel'],
        interactions: [
          { actorType: 'appearing_platform', effect: 'Shadow-realm platforms become visible and solid. Normal-realm platforms may disappear.' },
          { actorType: 'puzzle_door',        effect: 'Some doors exist only in shadow realm — passage only available while Dark Sight is active' },
          { actorType: 'shard_barrier',      effect: 'Shadow barriers become passable in shadow realm. Other barriers may become stronger.' },
          { actorType: 'crystal_resonator',  effect: 'Shadow crystals only visible/interactive in shadow realm — hidden puzzle layer' },
          { actorType: 'rune_panel',         effect: 'Shadow rune panels show different sequences in shadow realm — dual-solution puzzles' },
        ],
        vfx: { toggle: 'NS_DarkSight_Toggle', ambient: 'NS_DarkSight_Ambient', reveal: 'NS_DarkSight_Reveal' },
        sfx: { toggle: 'SC_DarkSight_Toggle', ambient: 'SC_DarkSight_Ambient' },
      },
    ],
  },

  // ── Shield Shard ──────────────────────────────────────────────────────────
  Shield: {
    shardType: 'Shield',
    combatAbility: 'Aegis Slam — deploy protective barrier and counter-strike on block',
    puzzleAbilities: [
      {
        id: 'shield_block',
        name: 'Force Wall',
        description: 'Deploy a temporary force wall that blocks flow, redirects projectiles, and creates temporary platforms. Can be placed horizontally or vertically.',
        inputType: 'aim_and_tap',
        controls: {
          primary: 'Aim → tap RT to place force wall (vertical)',
          modifier: 'Hold LB + tap RT to place horizontal (platform mode)',
        },
        energy: { castCost: 4 },
        maxRange: 800,
        maxDuration: 15,
        maxWalls: 2,
        wallSize: { width: 200, height: 200 },
        affectsActorTypes: ['pipe_segment', 'reservoir', 'moving_platform', 'brazier'],
        interactions: [
          { actorType: 'pipe_segment', effect: 'Blocks open pipe end — redirects flow to alternate exits. Force wall acts as pipe cap.' },
          { actorType: 'reservoir',    effect: 'Horizontal wall in reservoir creates dam — splits water level into two sections' },
          { actorType: 'moving_platform', effect: 'Placed in platform path — stops platform at wall location. Emergency brake.' },
          { actorType: 'brazier',      effect: 'Blocks fire chain propagation — flame hits wall and stops, protecting braziers behind it' },
        ],
        vfx: { cast: 'NS_ForceWall_Cast', wall: 'NS_ForceWall_Active', break: 'NS_ForceWall_Break' },
        sfx: { cast: 'SC_ForceWall_Cast', impact: 'SC_ForceWall_Impact', break: 'SC_ForceWall_Break' },
      },
      {
        id: 'shield_reflect',
        name: 'Mirror Shield',
        description: 'Reflect energy beams, shard projectiles, and flow currents. Angle of reflection depends on shield orientation. Used for beam-routing puzzles.',
        inputType: 'aim_and_hold',
        controls: {
          primary: 'Hold RT to raise reflective shield — face the beam',
          modifier: 'Strafe to adjust reflection angle',
        },
        energy: { castCost: 1, perSecond: 1.0 },
        maxRange: 0, // personal
        maxDuration: null,
        reflectionAngle: 'player_facing',
        affectsActorTypes: ['crystal_resonator', 'brazier', 'shard_barrier'],
        interactions: [
          { actorType: 'crystal_resonator', effect: 'Reflects crystal resonance beam to hit another crystal — beam routing around obstacles' },
          { actorType: 'brazier',           effect: 'Reflects fire chain projectile — redirects chain to hit distant brazier' },
          { actorType: 'shard_barrier',     effect: 'Reflects barrier\'s own energy back at it — self-dissolution shortcut' },
        ],
        vfx: { raise: 'NS_MirrorShield_Raise', reflect: 'NS_MirrorShield_Reflect', beam: 'NS_MirrorShield_Beam' },
        sfx: { raise: 'SC_MirrorShield_Raise', reflect: 'SC_MirrorShield_Reflect' },
      },
      {
        id: 'shield_carry',
        name: 'Aegis Lift',
        description: 'Use shield energy to lift and carry heavy objects. Move stone blocks onto pressure plates, reposition pipe segments, or carry forge materials to anvils.',
        inputType: 'aim_and_hold',
        controls: {
          primary: 'Aim at liftable object → hold RT to levitate',
          movement: 'Walk while holding to carry — object follows at chest height',
          release: 'Release RT to place object',
        },
        energy: { channelCost: 2, perSecond: 0.5 },
        maxRange: 500,
        maxDuration: null,
        maxWeight: 200,
        carrySpeed: 0.6, // 60% movement speed while carrying
        affectsActorTypes: ['pressure_plate', 'pipe_segment', 'rotating_platform'],
        interactions: [
          { actorType: 'pressure_plate',   effect: 'Carry heavy objects to pressure plate — permanent weight activation without player presence' },
          { actorType: 'pipe_segment',     effect: 'Lift and reposition loose pipe segments — physical pipe routing puzzle' },
          { actorType: 'rotating_platform', effect: 'Carry objects onto rotating platforms to create counterweights or weighted triggers' },
        ],
        vfx: { lift: 'NS_AegisLift_Lift', carry: 'NS_AegisLift_Carry', drop: 'NS_AegisLift_Drop' },
        sfx: { lift: 'SC_AegisLift_Lift', carry: 'SC_AegisLift_Carry', drop: 'SC_AegisLift_Drop' },
      },
    ],
  },
};

// ── Interaction Matrix ──────────────────────────────────────────────────────

/**
 * Cross-reference: for each actor type, what shard abilities can affect it?
 * Auto-generated from SHARD_PUZZLE_ABILITIES.
 */
export function buildInteractionMatrix() {
  const matrix = {};
  for (const [shardType, shard] of Object.entries(SHARD_PUZZLE_ABILITIES)) {
    for (const ability of shard.puzzleAbilities) {
      for (const interaction of ability.interactions) {
        if (!matrix[interaction.actorType]) matrix[interaction.actorType] = [];
        matrix[interaction.actorType].push({
          shardType,
          abilityId: ability.id,
          abilityName: ability.name,
          effect: interaction.effect,
        });
      }
    }
  }
  return matrix;
}

/**
 * Get all puzzle abilities for a specific shard type.
 * @param {string} shardType - 'Time' | 'Water' | 'Fire' | 'Nature' | 'Shadow' | 'Shield'
 * @returns {object|null}
 */
export function getShardPuzzleAbilities(shardType) {
  return SHARD_PUZZLE_ABILITIES[shardType] || { error: `Unknown shard type: ${shardType}` };
}

/**
 * Get all interactions for a specific actor type — what shard abilities affect it?
 * @param {string} actorTypeId
 * @returns {object[]}
 */
export function getActorInteractions(actorTypeId) {
  const matrix = buildInteractionMatrix();
  return matrix[actorTypeId] || [];
}

/**
 * Get all shard puzzle ability summaries.
 * @returns {object[]}
 */
export function getShardPuzzleSummary() {
  return Object.entries(SHARD_PUZZLE_ABILITIES).map(([shardType, shard]) => ({
    shardType,
    combatAbility: shard.combatAbility,
    puzzleAbilityCount: shard.puzzleAbilities.length,
    abilities: shard.puzzleAbilities.map(a => ({
      id: a.id,
      name: a.name,
      inputType: a.inputType,
      affectedActorCount: a.affectsActorTypes.length,
      energy: a.energy,
    })),
  }));
}

/**
 * Export shard puzzle interaction specs to JSON for UE5.
 */
export function exportShardPuzzleSpecs() {
  const game = getActiveGame();
  const outDir = join(game.assetsPath, 'Dungeons');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const exportData = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    milestone: 'ms_3',
    description: 'Shard power puzzle interactions — non-combat shard applications for echo dungeons',
    shardCount: Object.keys(SHARD_PUZZLE_ABILITIES).length,
    totalAbilities: Object.values(SHARD_PUZZLE_ABILITIES).reduce((s, shard) => s + shard.puzzleAbilities.length, 0),
    abilities: SHARD_PUZZLE_ABILITIES,
    interactionMatrix: buildInteractionMatrix(),
  };

  const outPath = join(outDir, 'shard-puzzle-interactions.json');
  writeFileSync(outPath, JSON.stringify(exportData, null, 2), 'utf-8');
  log.info(`Shard puzzle interaction specs exported to ${outPath}`);
  return { success: true, path: outPath, shardCount: exportData.shardCount, totalAbilities: exportData.totalAbilities };
}

// ══════════════════════════════════════════════════════════════════════════════
// ms_4: Shard Echo Reward System — Horizontal Progression
// ══════════════════════════════════════════════════════════════════════════════

/**
 * The Echo reward system provides *horizontal* progression — it makes the player
 * more versatile, not more powerful. Unlike the skill tree (vertical: +damage,
 * +health), echoes grant unique passive effects that open new playstyles and
 * tactical options. Players can equip a limited number of echoes at once,
 * encouraging build diversity and re-exploration.
 *
 * Progression chain:
 *   1. Discover dungeon → complete puzzles → earn base Echo (Rank 1)
 *   2. Re-run dungeon on higher difficulty → earn Resonance Fragments
 *   3. Collect fragments → upgrade Echo rank (1→2→3) for enhanced effects
 *   4. Equip echoes into limited slots → build synergies
 *   5. Specific echo combos unlock hidden Synergy Bonuses
 */

// ── Echo Equip Slots ────────────────────────────────────────────────────────

/**
 * Players start with 2 echo slots and unlock more through progression.
 * Max 4 slots ensures meaningful choice — can't equip everything.
 */
export const ECHO_SLOT_CONFIG = {
  initialSlots: 2,
  maxSlots: 4,
  slotUnlocks: [
    { slot: 1, requirement: 'default',         description: 'Available from start' },
    { slot: 2, requirement: 'default',         description: 'Available from start' },
    { slot: 3, requirement: 'complete_3_dungeons', description: 'Complete any 3 echo dungeons', dungeonCount: 3 },
    { slot: 4, requirement: 'complete_all_dungeons', description: 'Complete all 6 echo dungeons', dungeonCount: 6 },
  ],
  equipRules: {
    canSwapAnywhere: false,          // must visit a Wayshrine to swap
    swapLocation: 'wayshrine',       // Wayshrines double as echo management stations
    canUnequipInDungeon: false,      // locked during dungeon runs
    duplicatesAllowed: false,        // each echo only once
  },
  uiPath: '/Game/UI/Widgets/WBP_EchoEquipment',
};

// ── Echo Ranks & Resonance Fragments ────────────────────────────────────────

/**
 * Each echo has 3 ranks. Rank 1 is earned on first completion.
 * Higher ranks require Resonance Fragments from re-running the dungeon.
 */
export const ECHO_RANKS = {
  1: { label: 'Awakened',    effectMultiplier: 1.0,  fragmentCost: 0,  borderColor: { r: 0.6, g: 0.6, b: 0.6 }, aura: null },
  2: { label: 'Resonant',    effectMultiplier: 1.5,  fragmentCost: 5,  borderColor: { r: 0.4, g: 0.7, b: 1.0 }, aura: 'NS_EchoAura_Rank2' },
  3: { label: 'Transcendent', effectMultiplier: 2.0, fragmentCost: 12, borderColor: { r: 1.0, g: 0.85, b: 0.3 }, aura: 'NS_EchoAura_Rank3' },
};

/**
 * Resonance Fragments — the upgrade currency. Earned by re-running dungeons
 * on higher difficulties. Cannot be traded or dropped.
 */
export const RESONANCE_FRAGMENTS = {
  id: 'resonance_fragment',
  name: 'Resonance Fragment',
  description: 'A crystallized echo of shard energy. Collect these by re-running echo dungeons at higher difficulties to upgrade your echoes.',
  icon: '/Game/UI/Icons/Item_ResonanceFragment',
  maxStack: 99,
  sources: [
    { source: 'dungeon_completion_adept',   fragmentsAwarded: 1, repeatable: true,  cooldown: 0 },
    { source: 'dungeon_completion_master',  fragmentsAwarded: 3, repeatable: true,  cooldown: 0 },
    { source: 'dungeon_no_hints',           fragmentsAwarded: 1, repeatable: true,  cooldown: 0, description: 'Complete dungeon without using any hints' },
    { source: 'dungeon_speed_run',          fragmentsAwarded: 2, repeatable: true,  cooldown: 0, description: 'Complete master dungeon under par time' },
    { source: 'dungeon_first_clear',        fragmentsAwarded: 2, repeatable: false, cooldown: 0, description: 'First-ever completion bonus' },
  ],
};

/**
 * Enhanced echo effects at each rank. Rank multiplier scales the base passive.
 * Rank 3 also unlocks a unique bonus effect not present at lower ranks.
 */
export const ECHO_RANK_ENHANCEMENTS = {
  temporal_foresight: {
    rank1: { telegraphBonus: 0.5, dodgeWindowMult: 1.2 },
    rank2: { telegraphBonus: 0.75, dodgeWindowMult: 1.3 },
    rank3: { telegraphBonus: 1.0, dodgeWindowMult: 1.4, bonusEffect: 'Successful dodge triggers 0.5s slow-motion for all nearby enemies (5s cooldown)' },
  },
  tidal_resonance: {
    rank1: { healMistDuration: 3, healPctPerSec: 0.02 },
    rank2: { healMistDuration: 4, healPctPerSec: 0.03 },
    rank3: { healMistDuration: 5, healPctPerSec: 0.04, bonusEffect: 'Healing mist also cleanses one debuff per tick' },
  },
  ember_heart: {
    rank1: { smolderMaxStacks: 5, dmgPerStack: 0.03 },
    rank2: { smolderMaxStacks: 7, dmgPerStack: 0.04 },
    rank3: { smolderMaxStacks: 10, dmgPerStack: 0.05, bonusEffect: 'At max stacks, target explodes dealing 50% accumulated DoT as AoE' },
  },
  verdant_pulse: {
    rank1: { bloomChance: 0.15, bloomHits: 1 },
    rank2: { bloomChance: 0.20, bloomHits: 2 },
    rank3: { bloomChance: 0.25, bloomHits: 3, bonusEffect: 'Bloom heals player for 5% HP when it absorbs a hit' },
  },
  void_step: {
    rank1: { cloneDuration: 2, cloneDamageMult: 0.3 },
    rank2: { cloneDuration: 3, cloneDamageMult: 0.4 },
    rank3: { cloneDuration: 4, cloneDamageMult: 0.5, bonusEffect: 'Clone explodes on expiry dealing shadow AoE damage equal to 100% of mimicked attacks' },
  },
  primal_convergence: {
    rank1: { triggerWindow: 8, burstDamageMult: 2.0 },
    rank2: { triggerWindow: 10, burstDamageMult: 2.5 },
    rank3: { triggerWindow: 12, burstDamageMult: 3.0, bonusEffect: 'Primal Burst leaves an elemental storm (8s) that randomly applies Fire/Water/Nature effects to enemies in radius' },
  },
};

// ── Echo Synergy System ─────────────────────────────────────────────────────

/**
 * Equipping specific echo combinations grants a hidden Synergy Bonus.
 * These are *not* documented in-game until discovered — rewards experimentation.
 * Synergies require specific echoes to be equipped simultaneously.
 */
export const ECHO_SYNERGIES = {
  elemental_trinity: {
    id: 'elemental_trinity',
    name: 'Elemental Trinity',
    requiredEchoes: ['tidal_resonance', 'ember_heart', 'verdant_pulse'],
    description: 'Water, Fire, and Nature echoes harmonize. Shard abilities cycle through all 3 elements, adding secondary effects.',
    bonus: {
      type: 'elemental_cycling',
      effect: 'Every 3rd shard ability automatically triggers a secondary effect from the next element in the cycle (Water→Fire→Nature→Water). Secondary deals 25% of primary damage.',
      secondaryDamageMult: 0.25,
      cycleOrder: ['Water', 'Fire', 'Nature'],
    },
    discoveryHint: 'The old texts speak of three primal forces in balance...',
    icon: '/Game/UI/Icons/Synergy_ElementalTrinity',
    rarity: 'mythic',
  },

  temporal_shadow: {
    id: 'temporal_shadow',
    name: 'Chrono Phantom',
    requiredEchoes: ['temporal_foresight', 'void_step'],
    description: 'Time and Shadow echoes merge. Dodge creates a time-locked shadow clone that persists until manually detonated.',
    bonus: {
      type: 'persistent_clone',
      effect: 'Shadow clones from Void Step no longer expire on timer. Instead, press dodge again to detonate all active clones (max 3). Each clone detonates for 50% of accumulated damage dealt since creation.',
      maxClones: 3,
      detonationDamagePct: 0.5,
    },
    discoveryHint: 'Between moments, shadows linger...',
    icon: '/Game/UI/Icons/Synergy_ChronoPhantom',
    rarity: 'legendary',
  },

  nature_time: {
    id: 'nature_time',
    name: 'Eternal Growth',
    requiredEchoes: ['verdant_pulse', 'temporal_foresight'],
    description: 'Nature and Time echoes combine. Blooms grow over time, gaining hits and eventually becoming permanent.',
    bonus: {
      type: 'evolving_bloom',
      effect: 'Blooms spawned by Verdant Pulse gain +1 hit every 3 seconds (max 5 hits). If a Bloom survives 15s, it becomes permanent until the area is left.',
      hitGainInterval: 3,
      maxHits: 5,
      permanenceThreshold: 15,
    },
    discoveryHint: 'Seeds planted in timeless soil never wither...',
    icon: '/Game/UI/Icons/Synergy_EternalGrowth',
    rarity: 'legendary',
  },

  fire_water: {
    id: 'fire_water',
    name: 'Steam Engine',
    requiredEchoes: ['ember_heart', 'tidal_resonance'],
    description: 'Fire and Water echoes clash. Smolder stacks on enemies standing in healing mist create steam explosions.',
    bonus: {
      type: 'steam_explosion',
      effect: 'Enemies with 3+ Smolder stacks take 200% Fire damage when entering healing mist. This consumes the mist and all Smolder stacks. 8s cooldown per enemy.',
      requiredStacks: 3,
      explosionDamageMult: 2.0,
      cooldownPerEnemy: 8,
    },
    discoveryHint: 'When flame meets tide, the world screams...',
    icon: '/Game/UI/Icons/Synergy_SteamEngine',
    rarity: 'legendary',
  },

  convergence_void: {
    id: 'convergence_void',
    name: 'Primal Rift',
    requiredEchoes: ['primal_convergence', 'void_step'],
    description: 'The ultimate synergy. Primal Burst now opens a rift that pulls enemies in and deals continuous damage.',
    bonus: {
      type: 'gravity_rift',
      effect: 'Primal Burst creates a 3s gravity rift at impact point. Enemies within 500cm are pulled toward center and take 30% burst damage per second. Player gains 20% lifesteal from rift damage.',
      riftDuration: 3,
      pullRadius: 500,
      dpsMultiplier: 0.3,
      lifestealPct: 0.2,
    },
    discoveryHint: 'Where all elements collide, reality tears...',
    icon: '/Game/UI/Icons/Synergy_PrimalRift',
    rarity: 'mythic',
  },
};

// ── Echo Acquisition Flow ───────────────────────────────────────────────────

/**
 * State machine for echo acquisition. Tracks per-player progress through
 * each dungeon and echo unlock status.
 */
export const ECHO_ACQUISITION_STATES = {
  UNDISCOVERED:    'undiscovered',    // Dungeon not found yet
  DISCOVERED:      'discovered',      // Dungeon entrance found, not entered
  IN_PROGRESS:     'in_progress',     // Currently inside dungeon
  COMPLETED:       'completed',       // Dungeon cleared, echo earned
  MASTERING:       'mastering',       // Re-running for fragments
};

/**
 * Create a default player echo state object.
 * This is saved per-player and tracks all echo progression.
 */
export function createPlayerEchoState(playerId = 'default') {
  const state = {
    playerId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),

    // Equip state
    equippedEchoes: [],              // array of echo IDs (max = unlocked slots)
    unlockedSlots: ECHO_SLOT_CONFIG.initialSlots,

    // Per-echo progress
    echoes: {},

    // Currency
    resonanceFragments: 0,

    // Per-dungeon tracking
    dungeons: {},

    // Discovery
    discoveredSynergies: [],
    totalCompletions: 0,
  };

  // Initialize per-echo tracking
  for (const [echoId, echo] of Object.entries(SHARD_ECHOES)) {
    state.echoes[echoId] = {
      id: echoId,
      acquired: false,
      rank: 0,         // 0 = not acquired, 1-3 = ranks
      fragmentsInvested: 0,
    };
  }

  // Initialize per-dungeon tracking
  for (const [dungeonId, dungeon] of Object.entries(ECHO_DUNGEONS)) {
    state.dungeons[dungeonId] = {
      id: dungeonId,
      state: ECHO_ACQUISITION_STATES.UNDISCOVERED,
      completions: 0,
      bestDifficulty: null,
      bestTime: null,
      hintsUsed: 0,
      firstClearAt: null,
    };
  }

  return state;
}

/**
 * Award an echo to a player after dungeon completion.
 * @param {object} playerState - Player echo state object
 * @param {string} dungeonId - Completed dungeon ID
 * @param {object} completionData - { difficulty, time, hintsUsed }
 * @returns {object} { echoAwarded, fragmentsAwarded, slotUnlocked, synergyDiscovered, newRank }
 */
export function awardDungeonCompletion(playerState, dungeonId, completionData = {}) {
  const dungeon = ECHO_DUNGEONS[dungeonId];
  if (!dungeon) return { error: `Unknown dungeon: ${dungeonId}` };

  const echoId = dungeon.reward.id;
  const echoState = playerState.echoes[echoId];
  const dungeonState = playerState.dungeons[dungeonId];
  const result = { echoAwarded: null, fragmentsAwarded: 0, slotUnlocked: null, synergyDiscovered: null, newRank: null };

  // First completion — award the echo
  const isFirstEver = !echoState.acquired;
  if (isFirstEver) {
    echoState.acquired = true;
    echoState.rank = 1;
    result.echoAwarded = { id: echoId, name: dungeon.reward.name, rarity: dungeon.reward.rarity };
  }

  // Update dungeon tracking
  dungeonState.completions += 1;
  dungeonState.state = ECHO_ACQUISITION_STATES.COMPLETED;
  playerState.totalCompletions += 1;

  const diff = completionData.difficulty || 'adept';
  if (!dungeonState.bestDifficulty || difficultyRank(diff) > difficultyRank(dungeonState.bestDifficulty)) {
    dungeonState.bestDifficulty = diff;
  }
  if (completionData.time && (!dungeonState.bestTime || completionData.time < dungeonState.bestTime)) {
    dungeonState.bestTime = completionData.time;
  }
  if (!dungeonState.firstClearAt) {
    dungeonState.firstClearAt = new Date().toISOString();
  }

  // Calculate fragment rewards
  let fragments = 0;
  for (const source of RESONANCE_FRAGMENTS.sources) {
    if (source.source === 'dungeon_first_clear' && isFirstEver) {
      fragments += source.fragmentsAwarded;
    } else if (source.source === 'dungeon_completion_adept' && diff === 'adept') {
      fragments += source.fragmentsAwarded;
    } else if (source.source === 'dungeon_completion_master' && diff === 'master') {
      fragments += source.fragmentsAwarded;
    } else if (source.source === 'dungeon_no_hints' && (completionData.hintsUsed || 0) === 0) {
      fragments += source.fragmentsAwarded;
    } else if (source.source === 'dungeon_speed_run' && diff === 'master' && completionData.underParTime) {
      fragments += source.fragmentsAwarded;
    }
  }
  playerState.resonanceFragments += fragments;
  result.fragmentsAwarded = fragments;

  // Check slot unlocks
  const completedDungeonCount = Object.values(playerState.dungeons).filter(d => d.completions > 0).length;
  for (const slotUnlock of ECHO_SLOT_CONFIG.slotUnlocks) {
    if (slotUnlock.dungeonCount && completedDungeonCount >= slotUnlock.dungeonCount && playerState.unlockedSlots < slotUnlock.slot) {
      playerState.unlockedSlots = slotUnlock.slot;
      result.slotUnlocked = { slot: slotUnlock.slot, description: slotUnlock.description };
    }
  }

  // Check synergy discovery
  const acquiredEchoes = Object.keys(playerState.echoes).filter(id => playerState.echoes[id].acquired);
  for (const [synergyId, synergy] of Object.entries(ECHO_SYNERGIES)) {
    if (!playerState.discoveredSynergies.includes(synergyId)) {
      const allRequired = synergy.requiredEchoes.every(id => acquiredEchoes.includes(id));
      if (allRequired) {
        playerState.discoveredSynergies.push(synergyId);
        result.synergyDiscovered = { id: synergyId, name: synergy.name, hint: synergy.discoveryHint };
      }
    }
  }

  playerState.updatedAt = new Date().toISOString();
  return result;
}

/**
 * Upgrade an echo to the next rank using resonance fragments.
 * @param {object} playerState
 * @param {string} echoId
 * @returns {object} { success, newRank, fragmentsSpent, remainingFragments, enhancement }
 */
export function upgradeEcho(playerState, echoId) {
  const echoState = playerState.echoes[echoId];
  if (!echoState) return { error: `Unknown echo: ${echoId}` };
  if (!echoState.acquired) return { error: `Echo not acquired: ${echoId}` };
  if (echoState.rank >= 3) return { error: `Echo already at max rank (3)` };

  const nextRank = echoState.rank + 1;
  const cost = ECHO_RANKS[nextRank].fragmentCost;

  if (playerState.resonanceFragments < cost) {
    return {
      error: 'Insufficient fragments',
      have: playerState.resonanceFragments,
      need: cost,
      deficit: cost - playerState.resonanceFragments,
    };
  }

  playerState.resonanceFragments -= cost;
  echoState.rank = nextRank;
  echoState.fragmentsInvested += cost;
  playerState.updatedAt = new Date().toISOString();

  const enhancement = ECHO_RANK_ENHANCEMENTS[echoId]?.[`rank${nextRank}`] || null;

  return {
    success: true,
    echoId,
    echoName: SHARD_ECHOES[echoId]?.name,
    newRank: nextRank,
    rankLabel: ECHO_RANKS[nextRank].label,
    fragmentsSpent: cost,
    remainingFragments: playerState.resonanceFragments,
    enhancement,
    hasBonusEffect: enhancement?.bonusEffect ? true : false,
  };
}

/**
 * Equip an echo into a slot.
 * @param {object} playerState
 * @param {string} echoId
 * @returns {object} { success, equipped, activeSynergies }
 */
export function equipEcho(playerState, echoId) {
  const echoState = playerState.echoes[echoId];
  if (!echoState?.acquired) return { error: `Echo not acquired: ${echoId}` };
  if (playerState.equippedEchoes.includes(echoId)) return { error: 'Echo already equipped' };
  if (playerState.equippedEchoes.length >= playerState.unlockedSlots) {
    return { error: `All ${playerState.unlockedSlots} slots full. Unequip one first.`, slots: playerState.unlockedSlots };
  }

  playerState.equippedEchoes.push(echoId);
  playerState.updatedAt = new Date().toISOString();

  // Check active synergies
  const activeSynergies = getActiveSynergies(playerState.equippedEchoes);

  return {
    success: true,
    equipped: playerState.equippedEchoes.map(id => ({
      id,
      name: SHARD_ECHOES[id]?.name,
      rank: playerState.echoes[id]?.rank,
      rankLabel: ECHO_RANKS[playerState.echoes[id]?.rank]?.label,
    })),
    slotsUsed: playerState.equippedEchoes.length,
    slotsTotal: playerState.unlockedSlots,
    activeSynergies,
  };
}

/**
 * Unequip an echo from its slot.
 * @param {object} playerState
 * @param {string} echoId
 * @returns {object}
 */
export function unequipEcho(playerState, echoId) {
  const idx = playerState.equippedEchoes.indexOf(echoId);
  if (idx === -1) return { error: 'Echo not equipped' };

  playerState.equippedEchoes.splice(idx, 1);
  playerState.updatedAt = new Date().toISOString();

  return {
    success: true,
    unequipped: echoId,
    remaining: playerState.equippedEchoes.map(id => ({ id, name: SHARD_ECHOES[id]?.name })),
    activeSynergies: getActiveSynergies(playerState.equippedEchoes),
  };
}

/**
 * Get currently active synergies based on equipped echoes.
 * @param {string[]} equippedEchoIds
 * @returns {object[]}
 */
export function getActiveSynergies(equippedEchoIds) {
  const active = [];
  for (const [synergyId, synergy] of Object.entries(ECHO_SYNERGIES)) {
    if (synergy.requiredEchoes.every(id => equippedEchoIds.includes(id))) {
      active.push({
        id: synergyId,
        name: synergy.name,
        description: synergy.description,
        bonus: synergy.bonus,
        rarity: synergy.rarity,
      });
    }
  }
  return active;
}

/**
 * Get a full summary of a player's echo progression.
 * @param {object} playerState
 * @returns {object}
 */
export function getEchoProgressionSummary(playerState) {
  const acquired = Object.values(playerState.echoes).filter(e => e.acquired);
  const totalFragmentsInvested = acquired.reduce((s, e) => s + e.fragmentsInvested, 0);
  const maxedEchoes = acquired.filter(e => e.rank >= 3);

  return {
    playerId: playerState.playerId,
    slotsUnlocked: playerState.unlockedSlots,
    slotsUsed: playerState.equippedEchoes.length,
    equipped: playerState.equippedEchoes.map(id => ({
      id,
      name: SHARD_ECHOES[id]?.name,
      rank: playerState.echoes[id]?.rank,
      rankLabel: ECHO_RANKS[playerState.echoes[id]?.rank]?.label,
    })),
    echoesAcquired: acquired.length,
    echoesTotal: Object.keys(SHARD_ECHOES).length,
    maxedEchoes: maxedEchoes.length,
    resonanceFragments: playerState.resonanceFragments,
    totalFragmentsInvested,
    dungeonsCompleted: Object.values(playerState.dungeons).filter(d => d.completions > 0).length,
    totalCompletions: playerState.totalCompletions,
    synergiesDiscovered: playerState.discoveredSynergies.length,
    synergiesTotal: Object.keys(ECHO_SYNERGIES).length,
    activeSynergies: getActiveSynergies(playerState.equippedEchoes),
  };
}

/**
 * Get all echo synergies (discovered + undiscovered hints).
 * @param {object} playerState - If provided, shows discovery status
 * @returns {object[]}
 */
export function getEchoSynergies(playerState = null) {
  return Object.values(ECHO_SYNERGIES).map(s => ({
    id: s.id,
    name: playerState?.discoveredSynergies?.includes(s.id) ? s.name : '???',
    requiredEchoes: s.requiredEchoes,
    description: playerState?.discoveredSynergies?.includes(s.id) ? s.description : s.discoveryHint,
    bonus: playerState?.discoveredSynergies?.includes(s.id) ? s.bonus : null,
    rarity: s.rarity,
    discovered: playerState?.discoveredSynergies?.includes(s.id) || false,
  }));
}

/**
 * Get full echo reward system configuration for UE5 Data Tables.
 * @returns {object}
 */
export function getEchoRewardConfig() {
  return {
    slotConfig: ECHO_SLOT_CONFIG,
    ranks: ECHO_RANKS,
    fragments: RESONANCE_FRAGMENTS,
    rankEnhancements: ECHO_RANK_ENHANCEMENTS,
    synergies: ECHO_SYNERGIES,
    acquisitionStates: ECHO_ACQUISITION_STATES,
    echoCount: Object.keys(SHARD_ECHOES).length,
    synergyCount: Object.keys(ECHO_SYNERGIES).length,
  };
}

/**
 * Export echo reward system to JSON for UE5.
 */
export function exportEchoRewardSpecs() {
  const game = getActiveGame();
  const outDir = join(game.assetsPath, 'Dungeons');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const exportData = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    milestone: 'ms_4',
    description: 'Shard Echo reward system — horizontal progression with ranks, fragments, synergies, and equip slots',
    slotConfig: ECHO_SLOT_CONFIG,
    ranks: ECHO_RANKS,
    resonanceFragments: RESONANCE_FRAGMENTS,
    rankEnhancements: ECHO_RANK_ENHANCEMENTS,
    synergies: ECHO_SYNERGIES,
    acquisitionStates: ECHO_ACQUISITION_STATES,
    echoes: SHARD_ECHOES,
  };

  const outPath = join(outDir, 'echo-reward-system.json');
  writeFileSync(outPath, JSON.stringify(exportData, null, 2), 'utf-8');
  log.info(`Echo reward system specs exported to ${outPath}`);
  return { success: true, path: outPath, echoCount: Object.keys(SHARD_ECHOES).length, synergyCount: Object.keys(ECHO_SYNERGIES).length };
}

// ══════════════════════════════════════════════════════════════════════════════
// ms_5: Companion-Specific Puzzle Interactions (Bond-Gated)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Companions (Lira, Theron) have unique puzzle abilities usable ONLY in echo
 * dungeons. These are gated by the player's bond level with each companion.
 * Higher bond = more abilities unlocked + enhanced versions of earlier ones.
 *
 * Design principles:
 *   - Companions act autonomously — player issues a command, companion executes
 *   - Bond-gated: abilities unlock at bond thresholds (1-5)
 *   - Companion puzzles are OPTIONAL — dungeons are solvable without them,
 *     but companion abilities unlock shortcuts, secrets, and bonus rewards
 *   - Each companion has a puzzle archetype: Lira = perception/arcane, Theron = physical/tactical
 *   - Dual-companion puzzles require BOTH companions present (bond 4+ each)
 */

// ── Bond Levels ─────────────────────────────────────────────────────────────

export const BOND_LEVELS = {
  stranger:    { level: 0, label: 'Stranger',    description: 'No bond — companion follows but won\'t assist in puzzles' },
  acquainted:  { level: 1, label: 'Acquainted',  description: 'Basic trust — companion will perform simple puzzle actions on request' },
  trusted:     { level: 2, label: 'Trusted',     description: 'Growing bond — companion offers puzzle hints and uses trained abilities' },
  bonded:      { level: 3, label: 'Bonded',      description: 'Deep bond — companion acts proactively, unlocks unique puzzle paths' },
  soulbound:   { level: 4, label: 'Soulbound',   description: 'Unbreakable bond — companion\'s full ability set available, dual puzzles unlocked' },
  transcendent:{ level: 5, label: 'Transcendent', description: 'Perfect unity — companion abilities enhanced, secret dungeon rooms accessible' },
};

export const BOND_THRESHOLDS = {
  basic_assist:     1,  // Simple commands (push, pull, stand on plate)
  trained_ability:  2,  // Companion-specific puzzle abilities
  proactive_hints:  3,  // Companion auto-detects puzzle solutions, offers shortcuts
  dual_puzzles:     4,  // Puzzles requiring both companions simultaneously
  enhanced_mastery: 5,  // Enhanced versions of all abilities + secret rooms
};

// ── Companion Puzzle Profiles ───────────────────────────────────────────────

export const COMPANION_PUZZLE_PROFILES = {
  Lira: {
    id: 'Lira',
    portrait: '/Game/UI/Portraits/T_Portrait_Lira',
    archetype: 'perception_arcane',
    description: 'Lira\'s arcane sensitivity lets her perceive hidden shard resonances, read ancient inscriptions, and channel small amounts of shard energy through objects.',
    personalityInPuzzles: 'Curious and analytical — examines puzzle elements before acting. Comments on lore implications. Gets excited by complex mechanisms.',
    puzzleAbilities: [
      {
        id: 'lira_shard_sense',
        name: 'Shard Sense',
        bondRequired: 1,
        description: 'Lira can detect hidden shard-infused objects within 15m. Highlights interactable elements the player might miss.',
        inputType: 'command',
        controls: { primary: 'Press Companion Button near puzzle area → Lira scans and highlights hidden elements' },
        cooldown: 10,
        duration: 8,
        affectsActorTypes: ['crystal_resonator', 'shard_barrier', 'pressure_plate', 'hidden_switch'],
        interactions: [
          { actorType: 'crystal_resonator', effect: 'Reveals resonance frequency — shows which shard type activates it without trial-and-error' },
          { actorType: 'shard_barrier', effect: 'Reveals barrier weakness — shows exact shard ability needed to dissolve it' },
          { actorType: 'pressure_plate', effect: 'Reveals weight requirement and connected mechanisms' },
          { actorType: 'hidden_switch', effect: 'Detects concealed wall switches, floor triggers, and ceiling mechanisms' },
        ],
        vfx: { cast: 'NS_LiraShardSense_Scan', reveal: 'NS_LiraShardSense_Highlight', pulse: 'NS_LiraShardSense_Pulse' },
        sfx: { cast: 'SC_LiraShardSense_Cast', detect: 'SC_LiraShardSense_Detect' },
        voiceLines: [
          { trigger: 'cast', text: 'Let me feel the resonance here...', emotion: 'focused' },
          { trigger: 'detect', text: 'There — can you see it? The shard energy is concentrated right there.', emotion: 'excited' },
          { trigger: 'nothing', text: 'Nothing hidden nearby. The puzzle is as it appears.', emotion: 'neutral' },
        ],
      },
      {
        id: 'lira_inscription_read',
        name: 'Ancient Script',
        bondRequired: 2,
        description: 'Lira deciphers ancient inscriptions on dungeon walls, revealing puzzle hints, lore entries, and sometimes the solution order for multi-step puzzles.',
        inputType: 'interact',
        controls: { primary: 'Approach inscription → Companion Button → Lira reads and translates' },
        cooldown: 0,
        duration: null,
        affectsActorTypes: ['inscription_wall', 'lore_tablet', 'puzzle_obelisk'],
        interactions: [
          { actorType: 'inscription_wall', effect: 'Translates ancient text — may reveal step order, warn of traps, or unlock chronicle entries' },
          { actorType: 'lore_tablet', effect: 'Full translation unlocks Shard Echo lore — bonus XP and chronicle content' },
          { actorType: 'puzzle_obelisk', effect: 'Reads obelisk glyphs — reveals which shard abilities to use in which order for the room' },
        ],
        vfx: { read: 'NS_LiraInscription_Read', translate: 'NS_LiraInscription_Glow', complete: 'NS_LiraInscription_Complete' },
        sfx: { read: 'SC_LiraInscription_Read', success: 'SC_LiraInscription_Success' },
        voiceLines: [
          { trigger: 'start', text: 'Old script... pre-Sundering dialect. Give me a moment.', emotion: 'concentrating' },
          { trigger: 'success', text: 'Got it. Listen to this — it\'s describing the flow of shard energy through this chamber.', emotion: 'excited' },
          { trigger: 'warning', text: 'This one warns of a trap. "Those who rush shall find only stone."', emotion: 'cautious' },
        ],
      },
      {
        id: 'lira_arcane_channel',
        name: 'Arcane Conduit',
        bondRequired: 3,
        description: 'Lira channels shard energy through crystal networks, acting as a living conduit. She can bridge gaps in crystal resonator chains that the player can\'t reach.',
        inputType: 'position_and_command',
        controls: {
          primary: 'Position Lira between two crystal resonators → Companion Button → she channels energy between them',
          cancel: 'Move Lira away or press Cancel',
        },
        cooldown: 15,
        duration: 20,
        energyCost: 0, // Lira uses her own energy
        affectsActorTypes: ['crystal_resonator', 'shard_barrier', 'brazier'],
        interactions: [
          { actorType: 'crystal_resonator', effect: 'Bridges energy between two resonators — Lira stands in the gap and relays the beam. Solves split-path puzzles.' },
          { actorType: 'shard_barrier', effect: 'Channels sustained energy into barrier, weakening it faster than player abilities alone (50% faster dissolution)' },
          { actorType: 'brazier', effect: 'Ignites distant braziers by channeling fire shard energy through intermediary crystals' },
        ],
        vfx: { channel: 'NS_LiraArcaneConduit_Channel', bridge: 'NS_LiraArcaneConduit_Bridge', overload: 'NS_LiraArcaneConduit_Overload' },
        sfx: { channel: 'SC_LiraArcaneConduit_Hum', bridge: 'SC_LiraArcaneConduit_Connect', break: 'SC_LiraArcaneConduit_Break' },
        voiceLines: [
          { trigger: 'channel', text: 'I can feel the current. Hold on — bridging the gap.', emotion: 'strained' },
          { trigger: 'success', text: 'Connected! The energy is flowing through me. Don\'t take too long.', emotion: 'strained_pride' },
          { trigger: 'overload', text: 'Too much! I can\'t hold it — hurry!', emotion: 'urgent' },
        ],
      },
      {
        id: 'lira_temporal_echo',
        name: 'Memory Echo',
        bondRequired: 4,
        description: 'Lira reads the temporal imprint of a room, replaying a ghostly vision of how the puzzle was solved by ancient shard-bearers. Shows the solution as a spectral replay.',
        inputType: 'command',
        controls: { primary: 'In Time-shard dungeon rooms → Companion Button → Lira replays temporal echo' },
        cooldown: 60,
        duration: 15,
        shardAffinity: 'Time',
        affectsActorTypes: ['temporal_anchor', 'moving_platform', 'rotating_platform', 'crystal_resonator'],
        interactions: [
          { actorType: 'temporal_anchor', effect: 'Replays ghost showing which state to rewind each anchor to — visual walkthrough of solution' },
          { actorType: 'moving_platform', effect: 'Shows ghost riding platforms in correct sequence — reveals timing and order' },
          { actorType: 'rotating_platform', effect: 'Shows ghost rotating platforms to correct orientations' },
          { actorType: 'crystal_resonator', effect: 'Shows ghost activating resonators in correct sequence with correct shard types' },
        ],
        vfx: { cast: 'NS_LiraMemoryEcho_Cast', ghost: 'NS_LiraMemoryEcho_Ghost', fade: 'NS_LiraMemoryEcho_Fade' },
        sfx: { cast: 'SC_LiraMemoryEcho_Cast', ambient: 'SC_LiraMemoryEcho_Whisper' },
        voiceLines: [
          { trigger: 'cast', text: 'The walls remember... let me pull the memory forward.', emotion: 'mystical' },
          { trigger: 'replay', text: 'Watch the ghost. They solved this chamber ages ago — follow their steps.', emotion: 'reverent' },
        ],
      },
      {
        id: 'lira_shard_amplify',
        name: 'Resonance Amplify',
        bondRequired: 5,
        description: 'At transcendent bond, Lira amplifies the player\'s shard abilities by 50% in echo dungeons. Extends range, duration, and effect radius of all puzzle abilities.',
        inputType: 'passive',
        controls: { primary: 'Automatic when Lira is present and bond is Transcendent' },
        cooldown: 0,
        duration: null,
        amplification: {
          rangeMult: 1.5,
          durationMult: 1.5,
          radiusMult: 1.3,
          energyCostMult: 0.8,
        },
        affectsActorTypes: ['all'],
        interactions: [
          { actorType: 'all', effect: 'All player shard puzzle abilities gain +50% range, +50% duration, +30% radius, -20% energy cost' },
        ],
        vfx: { aura: 'NS_LiraResonanceAmplify_Aura', boost: 'NS_LiraResonanceAmplify_Boost' },
        sfx: { ambient: 'SC_LiraResonanceAmplify_Hum' },
        voiceLines: [
          { trigger: 'activate', text: 'I can feel your shard resonating with mine. We\'re in sync — use it.', emotion: 'serene' },
        ],
      },
    ],
  },

  Theron: {
    id: 'Theron',
    portrait: '/Game/UI/Portraits/T_Portrait_Theron',
    archetype: 'physical_tactical',
    description: 'Theron\'s military training and physical strength let him manipulate heavy puzzle elements, hold positions under pressure, and coordinate tactical positioning.',
    personalityInPuzzles: 'Pragmatic and impatient — prefers direct solutions. Occasionally brute-forces things. Respects clever mechanisms grudgingly.',
    puzzleAbilities: [
      {
        id: 'theron_heavy_lift',
        name: 'Iron Grip',
        bondRequired: 1,
        description: 'Theron can push, pull, or hold heavy objects that the player cannot move alone. Stone blocks, iron gates, and counterweights.',
        inputType: 'command',
        controls: { primary: 'Position near heavy object → Companion Button → Theron pushes/pulls/holds' },
        cooldown: 5,
        duration: null,
        maxWeight: 500, // vs player's 200
        affectsActorTypes: ['pressure_plate', 'pipe_segment', 'moving_platform', 'stone_block'],
        interactions: [
          { actorType: 'pressure_plate', effect: 'Theron stands on plate permanently, freeing player to explore. Can also push heavy blocks onto plates.' },
          { actorType: 'pipe_segment', effect: 'Moves heavy pipe segments the player can\'t lift — iron and stone pipes' },
          { actorType: 'moving_platform', effect: 'Holds platform in place by bracing against wall — creates temporary bridge' },
          { actorType: 'stone_block', effect: 'Pushes massive stone blocks into position — fills gaps, creates stairs, blocks hazards' },
        ],
        vfx: { strain: 'NS_TheronHeavyLift_Strain', move: 'NS_TheronHeavyLift_Move', place: 'NS_TheronHeavyLift_Place' },
        sfx: { grunt: 'SC_TheronHeavyLift_Grunt', scrape: 'SC_TheronHeavyLift_Scrape', thud: 'SC_TheronHeavyLift_Thud' },
        voiceLines: [
          { trigger: 'lift', text: 'Stand back. I\'ve got this one.', emotion: 'confident' },
          { trigger: 'heavy', text: 'Ngh — heavier than it looks. But it\'s moving.', emotion: 'strained' },
          { trigger: 'done', text: 'There. In position. What\'s next?', emotion: 'satisfied' },
        ],
      },
      {
        id: 'theron_shield_wall',
        name: 'Shield Brace',
        bondRequired: 2,
        description: 'Theron raises his shield to block hazards — fire jets, falling debris, or energy beams — creating a safe passage for the player.',
        inputType: 'position_and_command',
        controls: {
          primary: 'Position Theron in hazard path → Companion Button → he raises shield',
          cancel: 'Move away or press Cancel to lower shield',
        },
        cooldown: 10,
        duration: 30,
        affectsActorTypes: ['brazier', 'shard_barrier', 'hazard_emitter'],
        interactions: [
          { actorType: 'brazier', effect: 'Blocks fire chain propagation — shields player from chain brazier traps' },
          { actorType: 'shard_barrier', effect: 'Absorbs barrier pulse damage — player can walk through safely behind Theron' },
          { actorType: 'hazard_emitter', effect: 'Blocks periodic hazard pulses (fire jets, steam vents, energy waves) — creates safe window' },
        ],
        vfx: { raise: 'NS_TheronShieldBrace_Raise', block: 'NS_TheronShieldBrace_Block', break: 'NS_TheronShieldBrace_Break' },
        sfx: { raise: 'SC_TheronShieldBrace_Raise', impact: 'SC_TheronShieldBrace_Impact', crack: 'SC_TheronShieldBrace_Crack' },
        voiceLines: [
          { trigger: 'brace', text: 'Get behind me. My shield will hold.', emotion: 'protective' },
          { trigger: 'impact', text: 'Steady... it\'s hitting hard but I can take it.', emotion: 'focused' },
          { trigger: 'breaking', text: 'Shield\'s cracking — move fast!', emotion: 'urgent' },
        ],
      },
      {
        id: 'theron_tactical_mark',
        name: 'Battle Sight',
        bondRequired: 3,
        description: 'Theron\'s tactical training lets him analyze puzzle room layouts and mark optimal positions. Highlights pressure points, weak walls, and strategic positions.',
        inputType: 'command',
        controls: { primary: 'Press Companion Button in puzzle room → Theron surveys and marks tactical points' },
        cooldown: 20,
        duration: 30,
        affectsActorTypes: ['pressure_plate', 'rotating_platform', 'valve', 'stone_block'],
        interactions: [
          { actorType: 'pressure_plate', effect: 'Marks optimal plate activation order — numbered waypoints appear on each plate' },
          { actorType: 'rotating_platform', effect: 'Marks rotation angles needed — ghost arrows show target orientation' },
          { actorType: 'valve', effect: 'Marks valve turn amounts — numbered indicators show required flow levels' },
          { actorType: 'stone_block', effect: 'Marks push destinations — ghost outlines show where each block should end up' },
        ],
        vfx: { scan: 'NS_TheronBattleSight_Scan', mark: 'NS_TheronBattleSight_Mark', highlight: 'NS_TheronBattleSight_Highlight' },
        sfx: { scan: 'SC_TheronBattleSight_Scan', mark: 'SC_TheronBattleSight_Mark' },
        voiceLines: [
          { trigger: 'scan', text: 'Give me a moment to read the room...', emotion: 'analytical' },
          { trigger: 'mark', text: 'See those marks? That\'s your move order. Trust the training.', emotion: 'instructive' },
          { trigger: 'complex', text: 'Complicated setup. But I\'ve cracked worse fortifications. Here\'s the plan.', emotion: 'grudging_respect' },
        ],
      },
      {
        id: 'theron_dual_lever',
        name: 'Coordinated Pull',
        bondRequired: 4,
        description: 'Some puzzles have paired levers/mechanisms that must be activated simultaneously. Theron takes one while the player takes the other — requires precise timing.',
        inputType: 'synchronized',
        controls: {
          primary: 'Position Theron at one lever, player at other → Companion Button → countdown → both pull simultaneously',
          timing: '3-second countdown with visual/audio cue — both must activate within 0.5s window',
        },
        cooldown: 0,
        duration: null,
        timingWindow: 0.5,
        countdownSeconds: 3,
        affectsActorTypes: ['dual_lever', 'synchronized_switch', 'gate_mechanism'],
        interactions: [
          { actorType: 'dual_lever', effect: 'Simultaneous lever pull — opens time-locked gates, activates dual-input mechanisms' },
          { actorType: 'synchronized_switch', effect: 'Coordinated switch activation — both must hit within timing window or puzzle resets' },
          { actorType: 'gate_mechanism', effect: 'Dual-crank gate opening — both crank simultaneously to raise heavy portcullis' },
        ],
        vfx: { ready: 'NS_TheronDualLever_Ready', countdown: 'NS_TheronDualLever_Countdown', sync: 'NS_TheronDualLever_Sync', fail: 'NS_TheronDualLever_Fail' },
        sfx: { ready: 'SC_TheronDualLever_Ready', count: 'SC_TheronDualLever_Count', pull: 'SC_TheronDualLever_Pull', success: 'SC_TheronDualLever_Success' },
        voiceLines: [
          { trigger: 'ready', text: 'I\'ll take this side. On my count.', emotion: 'commanding' },
          { trigger: 'count', text: 'Three... two... one... NOW!', emotion: 'intense' },
          { trigger: 'success', text: 'Clean pull. We make a good team.', emotion: 'approving' },
          { trigger: 'fail', text: 'Off by a beat. Again — focus on the rhythm.', emotion: 'patient' },
        ],
      },
      {
        id: 'theron_fortify',
        name: 'Iron Stance',
        bondRequired: 5,
        description: 'At transcendent bond, Theron becomes immovable — immune to knockback, push traps, and environmental hazards. Anchor point for rope/chain puzzles.',
        inputType: 'passive_and_command',
        controls: {
          passive: 'Theron resists all environmental pushback automatically',
          active: 'Command Theron to anchor at a point → rope/chain extends from him to player',
        },
        cooldown: 0,
        duration: null,
        anchorRange: 2000,
        knockbackResist: 1.0, // 100% immunity
        affectsActorTypes: ['all'],
        interactions: [
          { actorType: 'all', effect: 'Theron immune to knockback, wind, water currents, and push traps. Player can tether to him for stability in hazardous areas.' },
        ],
        vfx: { anchor: 'NS_TheronIronStance_Anchor', tether: 'NS_TheronIronStance_Tether', resist: 'NS_TheronIronStance_Resist' },
        sfx: { anchor: 'SC_TheronIronStance_Anchor', tether: 'SC_TheronIronStance_Tether' },
        voiceLines: [
          { trigger: 'anchor', text: 'Nothing moves me. Grab the line and go.', emotion: 'stoic' },
          { trigger: 'resist', text: 'Ha! They\'ll need more than that to budge me.', emotion: 'amused' },
        ],
      },
    ],
  },
};

// ── Dual-Companion Puzzles (Bond 4+ with both) ─────────────────────────────

/**
 * Special puzzle sequences requiring BOTH Lira and Theron working together.
 * These unlock secret rooms with bonus echo fragments and unique lore.
 * Only available in multi-shard dungeons (Void Labyrinth, Primal Crucible).
 */
export const DUAL_COMPANION_PUZZLES = {
  resonance_bridge: {
    id: 'resonance_bridge',
    name: 'Resonance Bridge',
    bondRequired: { Lira: 4, Theron: 4 },
    dungeons: ['void_labyrinth', 'primal_crucible'],
    description: 'Lira channels shard energy while Theron physically supports a collapsing bridge. Player must cross and activate the far mechanism before Theron\'s strength fails or Lira\'s channel breaks.',
    phases: [
      { actor: 'Theron', ability: 'theron_heavy_lift', action: 'Braces collapsing bridge structure' },
      { actor: 'Lira', ability: 'lira_arcane_channel', action: 'Channels stabilizing energy into bridge stones' },
      { actor: 'Player', action: 'Crosses bridge and activates far mechanism within 20s time limit' },
    ],
    timeLimit: 20,
    reward: { type: 'resonance_fragment', amount: 3, bonusLore: 'bridge_builders_chronicle' },
    failureConsequence: 'Bridge collapses — player teleported back, puzzle resets. No penalty.',
    vfx: { bridge: 'NS_DualPuzzle_ResonanceBridge', collapse: 'NS_DualPuzzle_BridgeCollapse' },
    sfx: { crumble: 'SC_DualPuzzle_BridgeCrumble', stabilize: 'SC_DualPuzzle_BridgeStabilize' },
  },
  echo_symphony: {
    id: 'echo_symphony',
    name: 'Echo Symphony',
    bondRequired: { Lira: 4, Theron: 4 },
    dungeons: ['primal_crucible'],
    description: 'A musical puzzle where Lira reads the ancient notation, Theron strikes resonance bells in sequence, and the player channels shard energy through crystal pipes to create harmonics.',
    phases: [
      { actor: 'Lira', ability: 'lira_inscription_read', action: 'Reads musical notation from wall — reveals bell sequence' },
      { actor: 'Player', action: 'Channels shard energy through crystal pipes to set harmonic frequencies' },
      { actor: 'Theron', ability: 'theron_dual_lever', action: 'Strikes resonance bells in the revealed sequence — timing-critical' },
    ],
    timeLimit: null,
    reward: { type: 'resonance_fragment', amount: 5, bonusLore: 'symphony_of_shards', bonusEcho: 'harmonic_resonance' },
    failureConsequence: 'Wrong sequence plays dissonant tone — puzzle resets. Lira re-reads notation with additional hints.',
    vfx: { notes: 'NS_DualPuzzle_EchoSymphony_Notes', harmonics: 'NS_DualPuzzle_EchoSymphony_Harmonics', success: 'NS_DualPuzzle_EchoSymphony_Complete' },
    sfx: { bell: 'SC_DualPuzzle_Bell', harmony: 'SC_DualPuzzle_Harmony', dissonance: 'SC_DualPuzzle_Dissonance' },
  },
  temporal_siege: {
    id: 'temporal_siege',
    name: 'Temporal Siege',
    bondRequired: { Lira: 4, Theron: 4 },
    dungeons: ['void_labyrinth'],
    description: 'A room where time moves differently in three zones. Lira reads temporal markers, Theron anchors in the slow zone, and the player manipulates objects across time boundaries.',
    phases: [
      { actor: 'Lira', ability: 'lira_temporal_echo', action: 'Identifies which time zone each object belongs to' },
      { actor: 'Theron', ability: 'theron_fortify', action: 'Anchors in slow-time zone — objects handed to him persist across time shifts' },
      { actor: 'Player', action: 'Moves objects between time zones via temporal rewind — uses Theron as a temporal anchor point' },
    ],
    timeLimit: null,
    reward: { type: 'resonance_fragment', amount: 4, bonusLore: 'chrono_architects', bonusEcho: 'temporal_anchor' },
    failureConsequence: 'Objects snap back to original time zones — puzzle resets from last checkpoint.',
    vfx: { zones: 'NS_DualPuzzle_TemporalSiege_Zones', shift: 'NS_DualPuzzle_TemporalSiege_Shift' },
    sfx: { warp: 'SC_DualPuzzle_TimeWarp', anchor: 'SC_DualPuzzle_TimeAnchor' },
  },
};

// ── Bond-Gated Secret Rooms ─────────────────────────────────────────────────

/**
 * Each dungeon has 1-2 secret rooms accessible only via companion abilities.
 * Higher bond requirements = better rewards.
 */
export const COMPANION_SECRET_ROOMS = {
  chronos_spire: {
    lira_archive: {
      name: 'Lira\'s Temporal Archive',
      requirement: { companion: 'Lira', bondLevel: 3, ability: 'lira_inscription_read' },
      description: 'Hidden chamber behind inscribed wall. Lira reads the opening phrase, revealing a room of time-frozen books containing shard lore.',
      reward: { fragments: 2, loreEntries: ['archive_of_ages', 'first_shard_bearer'], echoUpgrade: 'temporal_foresight' },
    },
  },
  tidal_depths: {
    theron_armory: {
      name: 'Theron\'s Sunken Armory',
      requirement: { companion: 'Theron', bondLevel: 3, ability: 'theron_heavy_lift' },
      description: 'Collapsed underwater tunnel blocked by massive stone. Theron moves the stone, revealing an ancient armory with waterlogged weapons and echo fragments.',
      reward: { fragments: 2, loreEntries: ['drowned_legion', 'tidal_warriors'], echoUpgrade: 'tidal_resonance' },
    },
  },
  ember_forge: {
    lira_crucible: {
      name: 'Lira\'s Hidden Crucible',
      requirement: { companion: 'Lira', bondLevel: 4, ability: 'lira_arcane_channel' },
      description: 'Chamber where Lira channels fire shard energy through a dormant forge crystal, reigniting an ancient crucible that produces unique ember echoes.',
      reward: { fragments: 3, loreEntries: ['forge_masters_oath'], echoUpgrade: 'ember_heart' },
    },
  },
  verdant_maze: {
    theron_clearing: {
      name: 'Theron\'s Hidden Clearing',
      requirement: { companion: 'Theron', bondLevel: 2, ability: 'theron_shield_wall' },
      description: 'Path blocked by poisonous thorn wall. Theron shields through, clearing a path to a hidden nature grove with verdant echo fragments.',
      reward: { fragments: 1, loreEntries: ['grove_guardians'], echoUpgrade: 'verdant_pulse' },
    },
  },
  void_labyrinth: {
    dual_chamber: {
      name: 'Chamber of Unity',
      requirement: { companion: 'both', bondLevel: 5, ability: null },
      description: 'The deepest secret in the Void Labyrinth. Both companions at Transcendent bond unlock a chamber that tells the story of the original shard-bearers\' companions.',
      reward: { fragments: 5, loreEntries: ['first_companions', 'bond_of_shards', 'unity_pact'], bonusEcho: 'void_step' },
    },
  },
  primal_crucible: {
    dual_sanctum: {
      name: 'Sanctum of Convergence',
      requirement: { companion: 'both', bondLevel: 5, ability: null },
      description: 'Hidden at the heart of the Primal Crucible. Both companions channel their bond into a convergence point, opening the original shard temple.',
      reward: { fragments: 5, loreEntries: ['primal_temple', 'convergence_ritual', 'shard_origin'], bonusEcho: 'primal_convergence' },
    },
  },
};

// ── Companion Puzzle Interaction Helpers ─────────────────────────────────────

/**
 * Check if a companion ability is available given the current bond level.
 * @param {string} companionId - 'Lira' | 'Theron'
 * @param {string} abilityId - e.g. 'lira_shard_sense'
 * @param {number} currentBond - current bond level (0-5)
 * @returns {{ available: boolean, ability: object|null, reason: string }}
 */
export function checkCompanionAbility(companionId, abilityId, currentBond = 0) {
  const profile = COMPANION_PUZZLE_PROFILES[companionId];
  if (!profile) return { available: false, ability: null, reason: `Unknown companion: ${companionId}` };

  const ability = profile.puzzleAbilities.find(a => a.id === abilityId);
  if (!ability) return { available: false, ability: null, reason: `Unknown ability: ${abilityId} for ${companionId}` };

  if (currentBond < ability.bondRequired) {
    const needed = Object.entries(BOND_LEVELS).find(([, v]) => v.level === ability.bondRequired);
    return {
      available: false,
      ability,
      reason: `Bond too low. Need ${needed?.[1]?.label || 'level ' + ability.bondRequired} (${ability.bondRequired}), have ${currentBond}.`,
    };
  }

  return { available: true, ability, reason: 'OK' };
}

/**
 * Get all available companion abilities for current bond levels.
 * @param {{ Lira: number, Theron: number }} bondLevels
 * @returns {object[]}
 */
export function getAvailableCompanionAbilities(bondLevels = { Lira: 0, Theron: 0 }) {
  const available = [];
  for (const [companionId, profile] of Object.entries(COMPANION_PUZZLE_PROFILES)) {
    const bond = bondLevels[companionId] || 0;
    for (const ability of profile.puzzleAbilities) {
      available.push({
        companionId,
        abilityId: ability.id,
        name: ability.name,
        bondRequired: ability.bondRequired,
        unlocked: bond >= ability.bondRequired,
        enhanced: bond >= 5 && ability.bondRequired < 5,
      });
    }
  }
  return available;
}

/**
 * Check if a dual-companion puzzle is accessible.
 * @param {string} puzzleId - Key from DUAL_COMPANION_PUZZLES
 * @param {{ Lira: number, Theron: number }} bondLevels
 * @returns {{ accessible: boolean, puzzle: object|null, reason: string }}
 */
export function checkDualPuzzle(puzzleId, bondLevels = { Lira: 0, Theron: 0 }) {
  const puzzle = DUAL_COMPANION_PUZZLES[puzzleId];
  if (!puzzle) return { accessible: false, puzzle: null, reason: `Unknown dual puzzle: ${puzzleId}` };

  const liraBond = bondLevels.Lira || 0;
  const theronBond = bondLevels.Theron || 0;

  if (liraBond < puzzle.bondRequired.Lira) {
    return { accessible: false, puzzle, reason: `Lira bond too low: need ${puzzle.bondRequired.Lira}, have ${liraBond}` };
  }
  if (theronBond < puzzle.bondRequired.Theron) {
    return { accessible: false, puzzle, reason: `Theron bond too low: need ${puzzle.bondRequired.Theron}, have ${theronBond}` };
  }

  return { accessible: true, puzzle, reason: 'OK' };
}

/**
 * Check secret room accessibility for a dungeon.
 * @param {string} dungeonId
 * @param {{ Lira: number, Theron: number }} bondLevels
 * @returns {object[]}
 */
export function getAccessibleSecretRooms(dungeonId, bondLevels = { Lira: 0, Theron: 0 }) {
  const rooms = COMPANION_SECRET_ROOMS[dungeonId];
  if (!rooms) return [];

  return Object.entries(rooms).map(([roomId, room]) => {
    const req = room.requirement;
    let accessible = false;
    let reason = '';

    if (req.companion === 'both') {
      accessible = (bondLevels.Lira || 0) >= req.bondLevel && (bondLevels.Theron || 0) >= req.bondLevel;
      reason = accessible ? 'OK' : `Both companions need bond ${req.bondLevel}+`;
    } else {
      const bond = bondLevels[req.companion] || 0;
      accessible = bond >= req.bondLevel;
      reason = accessible ? 'OK' : `${req.companion} bond too low: need ${req.bondLevel}, have ${bond}`;
    }

    return { roomId, ...room, accessible, reason };
  });
}

/**
 * Get companion puzzle summary — overview of all companion puzzle content.
 * @returns {object}
 */
export function getCompanionPuzzleSummary() {
  const companions = Object.entries(COMPANION_PUZZLE_PROFILES).map(([id, profile]) => ({
    id,
    archetype: profile.archetype,
    abilityCount: profile.puzzleAbilities.length,
    abilities: profile.puzzleAbilities.map(a => ({
      id: a.id,
      name: a.name,
      bondRequired: a.bondRequired,
      inputType: a.inputType,
      actorCount: a.affectsActorTypes.length,
    })),
  }));

  const dualPuzzles = Object.entries(DUAL_COMPANION_PUZZLES).map(([id, p]) => ({
    id,
    name: p.name,
    bondRequired: p.bondRequired,
    dungeons: p.dungeons,
    phaseCount: p.phases.length,
    hasTimeLimit: !!p.timeLimit,
  }));

  const secretRooms = Object.entries(COMPANION_SECRET_ROOMS).flatMap(([dungeonId, rooms]) =>
    Object.entries(rooms).map(([roomId, room]) => ({
      dungeonId,
      roomId,
      name: room.name,
      companion: room.requirement.companion,
      bondLevel: room.requirement.bondLevel,
    }))
  );

  return {
    milestone: 'ms_5',
    description: 'Companion-specific puzzle interactions — bond-gated abilities for Lira and Theron in echo dungeons',
    bondLevels: BOND_LEVELS,
    bondThresholds: BOND_THRESHOLDS,
    companions,
    dualPuzzleCount: dualPuzzles.length,
    dualPuzzles,
    secretRoomCount: secretRooms.length,
    secretRooms,
    totalAbilities: companions.reduce((sum, c) => sum + c.abilityCount, 0),
  };
}

/**
 * Build companion-actor interaction matrix — which companion abilities affect which actors.
 * @returns {object}
 */
export function buildCompanionInteractionMatrix() {
  const matrix = {};
  for (const [companionId, profile] of Object.entries(COMPANION_PUZZLE_PROFILES)) {
    for (const ability of profile.puzzleAbilities) {
      for (const interaction of ability.interactions) {
        const key = interaction.actorType;
        if (!matrix[key]) matrix[key] = [];
        matrix[key].push({
          companionId,
          abilityId: ability.id,
          abilityName: ability.name,
          bondRequired: ability.bondRequired,
          effect: interaction.effect,
        });
      }
    }
  }
  return matrix;
}

/**
 * Export companion puzzle specs to JSON for UE5 consumption.
 */
export function exportCompanionPuzzleSpecs() {
  const game = getActiveGame();
  const outDir = join(game.assetsPath, 'Dungeons');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const exportData = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    milestone: 'ms_5',
    description: 'Companion-specific puzzle interactions — bond-gated abilities, dual puzzles, secret rooms',
    bondLevels: BOND_LEVELS,
    bondThresholds: BOND_THRESHOLDS,
    companionProfiles: COMPANION_PUZZLE_PROFILES,
    dualPuzzles: DUAL_COMPANION_PUZZLES,
    secretRooms: COMPANION_SECRET_ROOMS,
    companionInteractionMatrix: buildCompanionInteractionMatrix(),
  };

  const outPath = join(outDir, 'companion-puzzle-system.json');
  writeFileSync(outPath, JSON.stringify(exportData, null, 2), 'utf-8');
  log.info(`Companion puzzle system exported to ${outPath}`);
  return {
    success: true,
    path: outPath,
    companionCount: Object.keys(COMPANION_PUZZLE_PROFILES).length,
    totalAbilities: Object.values(COMPANION_PUZZLE_PROFILES).reduce((s, p) => s + p.puzzleAbilities.length, 0),
    dualPuzzleCount: Object.keys(DUAL_COMPANION_PUZZLES).length,
    secretRoomCount: Object.values(COMPANION_SECRET_ROOMS).reduce((s, rooms) => s + Object.keys(rooms).length, 0),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// ms_6: Corruption Interference for Puzzle Mechanics
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Corruption tiers (aligned with corruption-shader.js CORRUPTION_TIERS):
 *   T0 (0.0-0.2): Clean — no interference
 *   T1 (0.2-0.4): Veins — minor glitches
 *   T2 (0.4-0.6): Stain — moderate disruptions
 *   T3 (0.6-0.8): Mass — severe interference
 *   T4 (0.8-1.0): Eruption — critical, near-impossible
 */

/**
 * How corruption interferes with each puzzle actor category.
 * Per tier: visual FX, mechanic change, workaround, and severity.
 */
export const CORRUPTION_ACTOR_EFFECTS = {
  // ── Switches & Triggers ──
  lever: {
    t0: null,
    t1: {
      effect: 'sticky_toggle',
      description: 'Lever occasionally sticks — requires double-pull to toggle.',
      mechanicChange: { toggleDelay: 0.8, extraPullChance: 0.25 },
      vfx: 'VFX_CorruptionSpark_Minor',
      sfx: 'SC_CorruptedCreak',
      workaround: 'Use Fire shard Ember Touch to burn away corruption veins on lever mechanism.',
      severity: 0.2,
    },
    t2: {
      effect: 'random_revert',
      description: 'Lever randomly reverts after 3-6 seconds. Must chain actions quickly.',
      mechanicChange: { autoRevertTime: [3, 6], toggleDelay: 1.2 },
      vfx: 'VFX_CorruptionPulse_Medium',
      sfx: 'SC_CorruptedGroan',
      workaround: 'Time shard Temporal Lock freezes lever in activated state for 10s.',
      severity: 0.4,
    },
    t3: {
      effect: 'corrupted_output',
      description: 'Lever fires wrong output event 50% of the time (activate sends deactivate signal).',
      mechanicChange: { invertChance: 0.5, autoRevertTime: [2, 4] },
      vfx: 'VFX_CorruptionCrackle_Heavy',
      sfx: 'SC_CorruptedScream',
      workaround: 'Nature shard Verdant Touch grows cleansing moss — purifies one lever for 30s.',
      severity: 0.7,
    },
    t4: {
      effect: 'seized',
      description: 'Lever completely seized by corruption mass. Cannot interact directly.',
      mechanicChange: { interactable: false },
      vfx: 'VFX_CorruptionMass_Envelop',
      sfx: 'SC_CorruptionHeartbeat',
      workaround: 'Shadow shard Umbral Phase to reach shadow-version of lever (uncorrupted mirror).',
      severity: 1.0,
    },
  },

  pressure_plate: {
    t0: null,
    t1: {
      effect: 'weight_drift',
      description: 'Weight threshold fluctuates +/- 20%. Heavier objects may be needed.',
      mechanicChange: { weightVariance: 0.2 },
      vfx: 'VFX_CorruptionFlicker_Ground',
      sfx: null,
      workaround: 'Water shard Hydro Push adds water weight to supplement objects.',
      severity: 0.15,
    },
    t2: {
      effect: 'delayed_response',
      description: 'Plate takes 2-4s to register weight. Timing puzzles become harder.',
      mechanicChange: { holdDelay: [2, 4] },
      vfx: 'VFX_CorruptionOoze_Ground',
      sfx: 'SC_CorruptedSqelch',
      workaround: 'Time shard Chrono Rewind can "pre-activate" the plate by replaying past state.',
      severity: 0.35,
    },
    t3: {
      effect: 'phantom_weight',
      description: 'Plate randomly triggers/releases on its own due to corruption mass.',
      mechanicChange: { phantomTriggerInterval: [4, 8], reliableWindow: 1.5 },
      vfx: 'VFX_CorruptionBubble_Ground',
      sfx: 'SC_CorruptionPulse',
      workaround: 'Shield shard Force Wall creates stable weight anchor, ignoring phantom signals.',
      severity: 0.65,
    },
    t4: {
      effect: 'corrupted_surface',
      description: 'Plate surface fully corrupted — objects sink into corruption mass instead of triggering.',
      mechanicChange: { interactable: false, objectsAbsorbed: true },
      vfx: 'VFX_CorruptionPool_Deep',
      sfx: 'SC_CorruptionSwallow',
      workaround: 'Fire shard Crucible Flame burns corruption away temporarily (8s clean window).',
      severity: 1.0,
    },
  },

  crystal_resonator: {
    t0: null,
    t1: {
      effect: 'frequency_wobble',
      description: 'Crystal frequency drifts slightly — resonance matching takes longer.',
      mechanicChange: { frequencyDrift: 0.1, matchWindow: 1.5 },
      vfx: 'VFX_CrystalCorruption_Flicker',
      sfx: 'SC_CrystalDissonance_Mild',
      workaround: 'Water shard Cryo Snap stabilizes crystal temperature, reducing drift.',
      severity: 0.2,
    },
    t2: {
      effect: 'harmonic_interference',
      description: 'Corruption generates false harmonics — player must distinguish real from fake resonance.',
      mechanicChange: { falseHarmonics: 2, matchWindow: 2.0 },
      vfx: 'VFX_CrystalCorruption_DarkGlow',
      sfx: 'SC_CrystalDissonance_Heavy',
      workaround: 'Shadow shard Dark Sight reveals true harmonics (corruption harmonics appear dim).',
      severity: 0.45,
    },
    t3: {
      effect: 'chain_break',
      description: 'Crystal chains break after 2 links instead of full chain. Must re-route through uncorrupted crystals.',
      mechanicChange: { maxChainLength: 2, chainDecay: true },
      vfx: 'VFX_CrystalCorruption_Crack',
      sfx: 'SC_CrystalShatter_Partial',
      workaround: 'Nature shard Symbiotic Link bridges broken chain segments with vine conduits.',
      severity: 0.7,
    },
    t4: {
      effect: 'dark_resonance',
      description: 'Crystal emits corruption burst when activated — damages player and inverts nearby puzzle states.',
      mechanicChange: { damageOnActivate: 15, invertRadius: 500, interactable: true },
      vfx: 'VFX_CrystalCorruption_Eruption',
      sfx: 'SC_CrystalCorruption_Blast',
      workaround: 'Shield shard Mirror Shield reflects corruption burst back, purifying the crystal for 15s.',
      severity: 0.95,
    },
  },

  rune_panel: {
    t0: null,
    t1: {
      effect: 'symbol_fade',
      description: 'Rune symbols partially obscured by corruption veins. Harder to read.',
      mechanicChange: { visibilityReduction: 0.3 },
      vfx: 'VFX_RuneCorruption_VeinOverlay',
      sfx: null,
      workaround: 'Fire shard Ember Touch illuminates runes through corruption.',
      severity: 0.15,
    },
    t2: {
      effect: 'input_scramble',
      description: 'Rune input positions scrambled — symbols appear in wrong slots.',
      mechanicChange: { scrambleCount: 2, scrambleOnFail: true },
      vfx: 'VFX_RuneCorruption_Shift',
      sfx: 'SC_RuneCorrupted_Buzz',
      workaround: 'Time shard Temporal Echo records correct positions, replaying them as ghost overlay.',
      severity: 0.4,
    },
    t3: {
      effect: 'corruption_runes',
      description: 'Corruption adds 2 false rune symbols to the panel. Using them triggers damage.',
      mechanicChange: { falseRunes: 2, falseDamage: 10 },
      vfx: 'VFX_RuneCorruption_FalseGlow',
      sfx: 'SC_RuneCorrupted_Scream',
      workaround: 'Shadow shard Dark Sight reveals which runes are real (corruption runes have no shadow).',
      severity: 0.65,
    },
    t4: {
      effect: 'living_panel',
      description: 'Panel is alive with corruption — runes shift positions every 3s. Must input full sequence within one shift cycle.',
      mechanicChange: { shiftInterval: 3, interactable: true, requiresSpeedInput: true },
      vfx: 'VFX_RuneCorruption_Writhing',
      sfx: 'SC_CorruptionBreathing',
      workaround: 'Time shard Temporal Lock freezes panel for one full input cycle (8s).',
      severity: 0.9,
    },
  },

  // ── Platforms ──
  moving_platform: {
    t0: null,
    t1: {
      effect: 'speed_fluctuation',
      description: 'Platform speed varies +/- 30%. Timing jumps is slightly harder.',
      mechanicChange: { speedVariance: 0.3 },
      vfx: 'VFX_PlatformCorruption_Trail',
      sfx: null,
      workaround: null, // Minor — no workaround needed.
      severity: 0.1,
    },
    t2: {
      effect: 'path_deviation',
      description: 'Platform occasionally veers off path, requiring mid-jump corrections.',
      mechanicChange: { deviationChance: 0.3, deviationAmount: 100 },
      vfx: 'VFX_PlatformCorruption_Wobble',
      sfx: 'SC_MetalStress',
      workaround: 'Water shard Tidal Pull can nudge platform back on course.',
      severity: 0.35,
    },
    t3: {
      effect: 'corruption_phase',
      description: 'Platform phases into corruption dimension for 2s intervals, becoming intangible.',
      mechanicChange: { phaseInterval: [4, 6], phaseDuration: 2 },
      vfx: 'VFX_PlatformCorruption_Phase',
      sfx: 'SC_DimensionTear',
      workaround: 'Shadow shard Umbral Phase lets player ride platform even while phased.',
      severity: 0.7,
    },
    t4: {
      effect: 'hostile_platform',
      description: 'Platform actively tries to buck player off — sudden stops, direction reversals.',
      mechanicChange: { hostileAI: true, buckInterval: [2, 4], reversalChance: 0.5 },
      vfx: 'VFX_PlatformCorruption_Alive',
      sfx: 'SC_CorruptionRoar',
      workaround: 'Nature shard Verdant Touch grows adhesive roots on platform surface (10s grip).',
      severity: 0.9,
    },
  },

  pipe_segment: {
    t0: null,
    t1: {
      effect: 'slow_flow',
      description: 'Flow rate through pipe reduced by 25%. Networks need more pressure.',
      mechanicChange: { flowRateMultiplier: 0.75 },
      vfx: 'VFX_PipeCorruption_Residue',
      sfx: null,
      workaround: 'Water shard Hydro Push compensates for reduced flow.',
      severity: 0.15,
    },
    t2: {
      effect: 'leak',
      description: 'Corrupted pipe segment leaks — flow output is 50% of input. Must route around or seal.',
      mechanicChange: { flowLoss: 0.5, sealable: true },
      vfx: 'VFX_PipeCorruption_Drip',
      sfx: 'SC_WaterDrip_Corrupted',
      workaround: 'Water shard Cryo Snap freezes leak shut temporarily (15s seal).',
      severity: 0.4,
    },
    t3: {
      effect: 'backflow',
      description: 'Corruption causes random backflow events — flow reverses direction for 3s.',
      mechanicChange: { backflowInterval: [6, 10], backflowDuration: 3 },
      vfx: 'VFX_PipeCorruption_Reversal',
      sfx: 'SC_PipeSurge_Corrupted',
      workaround: 'Nature shard Entropic Bloom decays corruption inside pipe, clearing backflow source.',
      severity: 0.6,
    },
    t4: {
      effect: 'corrupted_fluid',
      description: 'Pipe carries corrupted fluid that damages downstream actors and poisons reservoirs.',
      mechanicChange: { fluidCorrupted: true, downstreamDamage: 5, poisonReservoir: true },
      vfx: 'VFX_PipeCorruption_DarkFluid',
      sfx: 'SC_CorruptionFlow',
      workaround: 'Fire shard Flame Conduit purifies fluid as it passes (requires sustained channel).',
      severity: 0.85,
    },
  },

  brazier: {
    t0: null,
    t1: {
      effect: 'dim_flame',
      description: 'Brazier flame dims periodically — chain timing windows reduced.',
      mechanicChange: { flameDurationMult: 0.7 },
      vfx: 'VFX_BrazierCorruption_Flicker',
      sfx: null,
      workaround: null,
      severity: 0.15,
    },
    t2: {
      effect: 'cold_corruption',
      description: 'Corruption absorbs heat — brazier extinguishes after 5s instead of staying lit.',
      mechanicChange: { autoExtinguish: 5, relightDelay: 2 },
      vfx: 'VFX_BrazierCorruption_Steam',
      sfx: 'SC_FlameSmother',
      workaround: 'Fire shard Ember Touch keeps brazier superheated, resisting corruption drain.',
      severity: 0.4,
    },
    t3: {
      effect: 'corruption_flame',
      description: 'Brazier burns with dark corruption fire — activates chain but also damages nearby actors.',
      mechanicChange: { damageRadius: 200, damagePerSec: 8, chainStillWorks: true },
      vfx: 'VFX_BrazierCorruption_DarkFire',
      sfx: 'SC_CorruptionBurn',
      workaround: 'Shield shard Aegis Lift creates safe zone around brazier, blocking damage.',
      severity: 0.65,
    },
    t4: {
      effect: 'eruption_vent',
      description: 'Brazier becomes corruption eruption vent — periodic AoE bursts, unusable for chains.',
      mechanicChange: { interactable: false, eruptionInterval: 4, eruptionDamage: 20, eruptionRadius: 400 },
      vfx: 'VFX_BrazierCorruption_Eruption',
      sfx: 'SC_CorruptionEruption',
      workaround: 'Water shard Tidal Pull extracts corruption core from brazier, restoring it for 20s.',
      severity: 1.0,
    },
  },

  valve: {
    t0: null,
    t1: {
      effect: 'stiff_valve',
      description: 'Valve harder to turn — interaction takes 1.5x longer.',
      mechanicChange: { interactionTimeMult: 1.5 },
      vfx: 'VFX_ValveCorruption_Rust',
      sfx: 'SC_ValveStiff',
      workaround: null,
      severity: 0.1,
    },
    t2: {
      effect: 'partial_turn',
      description: 'Valve can only turn to 60% capacity — flow is restricted.',
      mechanicChange: { maxFlowMult: 0.6 },
      vfx: 'VFX_ValveCorruption_Crust',
      sfx: 'SC_ValveGrind',
      workaround: 'Fire shard Ember Touch heats valve, burning away crust for full range.',
      severity: 0.35,
    },
    t3: {
      effect: 'auto_close',
      description: 'Valve slowly closes itself — must be held open or locked with external force.',
      mechanicChange: { autoCloseRate: 0.15, holdRequired: true },
      vfx: 'VFX_ValveCorruption_Tendrils',
      sfx: 'SC_CorruptionGrip',
      workaround: 'Nature shard Verdant Touch grows vines to hold valve open permanently.',
      severity: 0.6,
    },
    t4: {
      effect: 'fused_shut',
      description: 'Valve fused shut by corruption mass. Cannot turn.',
      mechanicChange: { interactable: false },
      vfx: 'VFX_ValveCorruption_Encased',
      sfx: 'SC_CorruptionSolid',
      workaround: 'Shadow shard Shadow Swap swaps with valve shadow-double that is open in mirror dimension.',
      severity: 1.0,
    },
  },

  echo_recorder: {
    t0: null,
    t1: {
      effect: 'static_noise',
      description: 'Recorded echoes have slight static — replay is still functional but audio cues are garbled.',
      mechanicChange: { replayFidelity: 0.85 },
      vfx: 'VFX_EchoCorruption_Static',
      sfx: 'SC_EchoStatic',
      workaround: null,
      severity: 0.1,
    },
    t2: {
      effect: 'time_skip',
      description: 'Recorded echo skips 0.5-1s segments during replay. Actions may be missed.',
      mechanicChange: { skipChance: 0.2, skipDuration: [0.5, 1.0] },
      vfx: 'VFX_EchoCorruption_Tear',
      sfx: 'SC_TimeSkip',
      workaround: 'Time shard Chrono Rewind fills in skipped segments from temporal memory.',
      severity: 0.4,
    },
    t3: {
      effect: 'corruption_echo',
      description: 'Recorder captures a corruption shadow-echo that replays alongside real echo, triggering wrong switches.',
      mechanicChange: { shadowEcho: true, shadowDelay: 1.5 },
      vfx: 'VFX_EchoCorruption_Shadow',
      sfx: 'SC_ShadowEcho',
      workaround: 'Shadow shard Dark Sight distinguishes real echo from shadow echo (shadow one turns invisible).',
      severity: 0.7,
    },
    t4: {
      effect: 'temporal_corruption',
      description: 'Recorder corrupts timeline — replaying echo creates a time paradox that resets the room after 10s.',
      mechanicChange: { paradoxTimer: 10, roomResetOnExpire: true },
      vfx: 'VFX_EchoCorruption_Paradox',
      sfx: 'SC_TemporalCollapse',
      workaround: 'Time shard Temporal Lock anchors the timeline, preventing paradox reset (30s anchor).',
      severity: 0.95,
    },
  },
};

/**
 * Corruption interference profiles per dungeon — each dungeon has a corruption
 * progression curve that increases as players go deeper.
 * corruptionByRoom: maps room index to corruption level (0.0-1.0).
 * specialMechanics: unique corruption interactions specific to this dungeon's theme.
 */
export const DUNGEON_CORRUPTION_PROFILES = {
  temporal_sanctum: {
    dungeonId: 'temporal_sanctum',
    name: 'Temporal Sanctum — Corruption Profile',
    flavorText: 'Time itself fractures under the corruption\'s weight. Past and future bleed together.',
    corruptionByRoom: { 0: 0.0, 1: 0.15, 2: 0.35, 3: 0.55 },
    specialMechanics: [
      {
        id: 'temporal_bleed',
        name: 'Temporal Bleed',
        description: 'Corruption causes past room states to bleed into the present — solved puzzles may partially unsolved.',
        triggerTier: 2,
        effect: { puzzleResetChance: 0.2, affectedRooms: 'previous' },
        counterShard: 'Time',
        counterAbility: 'Temporal Lock',
      },
      {
        id: 'chrono_corruption',
        name: 'Chrono Corruption',
        description: 'At T3+, time rewind abilities cost 2x energy due to corruption interference.',
        triggerTier: 3,
        effect: { energyCostMult: 2.0, affectedAbilities: ['chrono_rewind', 'temporal_lock', 'temporal_echo'] },
        counterShard: 'Shield',
        counterAbility: 'Mirror Shield',
      },
    ],
  },

  abyssal_cistern: {
    dungeonId: 'abyssal_cistern',
    name: 'Abyssal Cistern — Corruption Profile',
    flavorText: 'The waters darken with corruption, carrying its taint through every channel.',
    corruptionByRoom: { 0: 0.0, 1: 0.2, 2: 0.4, 3: 0.65 },
    specialMechanics: [
      {
        id: 'tainted_waters',
        name: 'Tainted Waters',
        description: 'Water in corrupted pipes deals 3 damage/s to player on contact. Safe corridors shrink.',
        triggerTier: 2,
        effect: { waterDamagePerSec: 3, safeZoneReduction: 0.4 },
        counterShard: 'Water',
        counterAbility: 'Hydro Push',
      },
      {
        id: 'corruption_tide',
        name: 'Corruption Tide',
        description: 'Rising corruption tide fills rooms from below. Water puzzles must be solved before tide reaches critical height.',
        triggerTier: 3,
        effect: { tideRiseRate: 0.05, criticalHeight: 0.8, failureOnReach: true },
        counterShard: 'Nature',
        counterAbility: 'Entropic Bloom',
      },
    ],
  },

  ember_forge: {
    dungeonId: 'ember_forge',
    name: 'Ember Forge — Corruption Profile',
    flavorText: 'The forge\'s heat feeds the corruption, creating an unstable symbiosis of fire and darkness.',
    corruptionByRoom: { 0: 0.05, 1: 0.25, 2: 0.5, 3: 0.7 },
    specialMechanics: [
      {
        id: 'heat_drain',
        name: 'Heat Drain',
        description: 'Corruption absorbs ambient heat — braziers and forge elements cool faster.',
        triggerTier: 1,
        effect: { heatDecayMult: 1.5, brazierDurationMult: 0.6 },
        counterShard: 'Fire',
        counterAbility: 'Ember Touch',
      },
      {
        id: 'dark_forge',
        name: 'Dark Forge',
        description: 'At T3+, forge produces corruption-infused items that must be purified before use.',
        triggerTier: 3,
        effect: { outputCorrupted: true, purificationRequired: true, purifyTime: 5 },
        counterShard: 'Water',
        counterAbility: 'Cryo Snap',
      },
    ],
  },

  verdant_labyrinth: {
    dungeonId: 'verdant_labyrinth',
    name: 'Verdant Labyrinth — Corruption Profile',
    flavorText: 'Nature resists corruption fiercely, but even the deepest roots eventually succumb.',
    corruptionByRoom: { 0: 0.0, 1: 0.1, 2: 0.3, 3: 0.6 },
    specialMechanics: [
      {
        id: 'blighted_growth',
        name: 'Blighted Growth',
        description: 'Nature-grown paths wither after 8s instead of persisting. Must move quickly.',
        triggerTier: 2,
        effect: { growthDuration: 8, witherDamage: 5 },
        counterShard: 'Nature',
        counterAbility: 'Symbiotic Link',
      },
      {
        id: 'parasitic_vines',
        name: 'Parasitic Vines',
        description: 'Corruption spawns parasitic vines that block paths and drain shard energy on contact.',
        triggerTier: 3,
        effect: { vineSpawnInterval: 12, energyDrainPerSec: 5, clearable: true },
        counterShard: 'Fire',
        counterAbility: 'Flame Conduit',
      },
    ],
  },

  umbral_nexus: {
    dungeonId: 'umbral_nexus',
    name: 'Umbral Nexus — Corruption Profile',
    flavorText: 'In the nexus of shadow and time, corruption is almost indistinguishable from the darkness itself.',
    corruptionByRoom: { 0: 0.1, 1: 0.3, 2: 0.55, 3: 0.8 },
    specialMechanics: [
      {
        id: 'shadow_merge',
        name: 'Shadow Merge',
        description: 'Corruption merges with shadows — Shadow Swap may teleport player to corrupted location.',
        triggerTier: 2,
        effect: { corruptedSwapChance: 0.3, corruptedSwapDamage: 10 },
        counterShard: 'Time',
        counterAbility: 'Chrono Rewind',
      },
      {
        id: 'nexus_overload',
        name: 'Nexus Overload',
        description: 'At T4, the nexus destabilizes — all puzzle actors cycle through states every 5s. Pure chaos.',
        triggerTier: 4,
        effect: { stateCycleInterval: 5, affectsAll: true },
        counterShard: 'Shield',
        counterAbility: 'Force Wall',
      },
    ],
  },

  primal_crucible: {
    dungeonId: 'primal_crucible',
    name: 'Primal Crucible — Corruption Profile',
    flavorText: 'Three elements collide in the crucible. Corruption feeds on the chaos of their convergence.',
    corruptionByRoom: { 0: 0.05, 1: 0.2, 2: 0.45, 3: 0.75 },
    specialMechanics: [
      {
        id: 'elemental_interference',
        name: 'Elemental Interference',
        description: 'Corruption disrupts shard-type switching — 2s cooldown between different shard uses.',
        triggerTier: 2,
        effect: { shardSwitchCooldown: 2 },
        counterShard: 'Shield',
        counterAbility: 'Aegis Lift',
      },
      {
        id: 'primal_meltdown',
        name: 'Primal Meltdown',
        description: 'At T3+, using wrong shard type on corrupted actor causes elemental backlash (15 damage).',
        triggerTier: 3,
        effect: { wrongShardDamage: 15, correctShardBonus: 1.3 },
        counterShard: null,
        counterAbility: null,
      },
    ],
  },
};

/**
 * Corruption cleansing mechanics — ways to permanently reduce corruption in a dungeon room.
 * Each method has shard requirements, cost, and scope.
 */
export const CORRUPTION_CLEANSE_METHODS = {
  shard_purge: {
    id: 'shard_purge',
    name: 'Shard Purge',
    description: 'Channel all equipped shard energy into a purging blast. Clears corruption in a small radius.',
    shardRequirement: 'any',
    energyCost: 40,
    radius: 300,
    corruptionReduction: 0.3,
    cooldown: 30,
    vfx: 'VFX_ShardPurge_Blast',
    sfx: 'SC_PurgeBlast',
  },
  elemental_anchor: {
    id: 'elemental_anchor',
    name: 'Elemental Anchor',
    description: 'Place a shard anchor that suppresses corruption in an area. Lasts 60s.',
    shardRequirement: 'any',
    energyCost: 25,
    radius: 500,
    corruptionReduction: 0.2,
    duration: 60,
    maxAnchors: 3,
    vfx: 'VFX_ElementalAnchor_Pulse',
    sfx: 'SC_AnchorPlace',
  },
  corruption_heart: {
    id: 'corruption_heart',
    name: 'Destroy Corruption Heart',
    description: 'Each corrupted room has a hidden corruption heart. Destroying it permanently lowers room corruption by one tier.',
    shardRequirement: ['Fire', 'Shadow'],
    interactionSteps: ['locate_heart', 'expose_with_shadow', 'burn_with_fire'],
    corruptionReduction: 0.2,
    permanent: true,
    discoveryHint: 'Corruption heart pulses are audible — follow the sound.',
    vfx: 'VFX_CorruptionHeart_Destroy',
    sfx: 'SC_HeartShatter',
  },
};

/**
 * Get corruption tier (0-4) from a corruption level (0.0-1.0).
 */
export function getCorruptionTier(corruptionLevel) {
  if (corruptionLevel < 0.2) return 0;
  if (corruptionLevel < 0.4) return 1;
  if (corruptionLevel < 0.6) return 2;
  if (corruptionLevel < 0.8) return 3;
  return 4;
}

/**
 * Get corruption effects for a specific actor at a given corruption level.
 * @param {string} actorTypeId — e.g. 'lever', 'pipe_segment'
 * @param {number} corruptionLevel — 0.0 to 1.0
 * @returns {object|null} Effect data or null if no effect at this level
 */
export function getCorruptionEffect(actorTypeId, corruptionLevel) {
  const actorEffects = CORRUPTION_ACTOR_EFFECTS[actorTypeId];
  if (!actorEffects) return null;

  const tier = getCorruptionTier(corruptionLevel);
  if (tier === 0) return null;

  const tierKey = `t${tier}`;
  return actorEffects[tierKey] || null;
}

/**
 * Get all corruption effects active in a dungeon room.
 * @param {string} dungeonId — e.g. 'temporal_sanctum'
 * @param {number} roomIndex — room index (0-based)
 * @returns {object} Room corruption summary
 */
export function getRoomCorruptionEffects(dungeonId, roomIndex) {
  const profile = DUNGEON_CORRUPTION_PROFILES[dungeonId];
  if (!profile) return { error: `Unknown dungeon: ${dungeonId}` };

  const corruptionLevel = profile.corruptionByRoom[roomIndex] ?? 0;
  const tier = getCorruptionTier(corruptionLevel);

  // Get dungeon layout to know which actors are in this room
  const dungeon = ECHO_DUNGEONS[dungeonId];
  if (!dungeon) return { error: `Unknown dungeon: ${dungeonId}` };

  const room = dungeon.rooms?.[roomIndex];
  const roomName = room?.name || `Room ${roomIndex}`;

  // Collect actor effects for all actor types present in this dungeon's puzzle mechanics
  const actorEffects = [];
  for (const [actorTypeId, effects] of Object.entries(CORRUPTION_ACTOR_EFFECTS)) {
    const effect = getCorruptionEffect(actorTypeId, corruptionLevel);
    if (effect) {
      actorEffects.push({
        actorTypeId,
        actorName: PUZZLE_ACTOR_TYPES[actorTypeId]?.name || actorTypeId,
        ...effect,
      });
    }
  }

  // Collect special mechanics that trigger at this tier
  const activeSpecials = (profile.specialMechanics || []).filter(sm => tier >= sm.triggerTier);

  return {
    dungeonId,
    dungeonName: profile.name,
    roomIndex,
    roomName,
    corruptionLevel,
    tier,
    tierName: ['Clean', 'Veins', 'Stain', 'Mass', 'Eruption'][tier],
    flavorText: profile.flavorText,
    actorEffects,
    activeSpecialMechanics: activeSpecials,
    cleanseMethods: Object.values(CORRUPTION_CLEANSE_METHODS),
  };
}

/**
 * Get full corruption interference summary for a dungeon.
 * @param {string} dungeonId
 * @returns {object}
 */
export function getDungeonCorruptionSummary(dungeonId) {
  const profile = DUNGEON_CORRUPTION_PROFILES[dungeonId];
  if (!profile) return { error: `Unknown dungeon: ${dungeonId}` };

  const rooms = [];
  for (const [roomIdx, level] of Object.entries(profile.corruptionByRoom)) {
    const tier = getCorruptionTier(level);
    rooms.push({
      roomIndex: parseInt(roomIdx),
      corruptionLevel: level,
      tier,
      tierName: ['Clean', 'Veins', 'Stain', 'Mass', 'Eruption'][tier],
      activeEffectCount: Object.keys(CORRUPTION_ACTOR_EFFECTS).filter(a =>
        getCorruptionEffect(a, level) !== null
      ).length,
    });
  }

  return {
    dungeonId,
    name: profile.name,
    flavorText: profile.flavorText,
    rooms,
    specialMechanics: profile.specialMechanics,
    peakCorruption: Math.max(...Object.values(profile.corruptionByRoom)),
    peakTier: getCorruptionTier(Math.max(...Object.values(profile.corruptionByRoom))),
  };
}

/**
 * Get all corruption interference data across all dungeons.
 * @returns {object}
 */
export function getAllCorruptionInterference() {
  const dungeons = {};
  for (const dungeonId of Object.keys(DUNGEON_CORRUPTION_PROFILES)) {
    dungeons[dungeonId] = getDungeonCorruptionSummary(dungeonId);
  }

  return {
    totalDungeons: Object.keys(dungeons).length,
    totalActorEffectTypes: Object.keys(CORRUPTION_ACTOR_EFFECTS).length,
    totalSpecialMechanics: Object.values(DUNGEON_CORRUPTION_PROFILES).reduce(
      (sum, p) => sum + p.specialMechanics.length, 0
    ),
    cleanseMethods: Object.keys(CORRUPTION_CLEANSE_METHODS).length,
    dungeons,
  };
}

/**
 * Export corruption interference specs to JSON for UE5 consumption.
 */
export function exportCorruptionInterferenceSpecs() {
  const game = getActiveGame();
  const outDir = join(game.assetsPath, 'Dungeons');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const exportData = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    milestone: 'ms_6',
    description: 'Corruption interference for puzzle mechanics — per-actor per-tier effects, dungeon corruption profiles, cleanse methods',
    corruptionActorEffects: CORRUPTION_ACTOR_EFFECTS,
    dungeonCorruptionProfiles: DUNGEON_CORRUPTION_PROFILES,
    cleanseMethods: CORRUPTION_CLEANSE_METHODS,
    summary: getAllCorruptionInterference(),
  };

  const outPath = join(outDir, 'corruption-interference.json');
  writeFileSync(outPath, JSON.stringify(exportData, null, 2), 'utf-8');
  log.info(`Corruption interference specs exported to ${outPath}`);
  return {
    success: true,
    path: outPath,
    actorEffectTypes: Object.keys(CORRUPTION_ACTOR_EFFECTS).length,
    dungeonProfiles: Object.keys(DUNGEON_CORRUPTION_PROFILES).length,
    cleanseMethods: Object.keys(CORRUPTION_CLEANSE_METHODS).length,
    totalSpecialMechanics: Object.values(DUNGEON_CORRUPTION_PROFILES).reduce(
      (sum, p) => sum + p.specialMechanics.length, 0
    ),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// ms_7: World Placement & Discovery Triggers
// ══════════════════════════════════════════════════════════════════════════════

/**
 * World placements for each dungeon — coordinates, entrance type, visual cues,
 * and discovery trigger configurations. Each dungeon has a hidden entrance in
 * its assigned region that players find through environmental storytelling and
 * shard-sense abilities.
 */
export const DUNGEON_WORLD_PLACEMENTS = {
  temporal_sanctum: {
    dungeonId: 'temporal_sanctum',
    region: 'Aethermere',
    worldPosition: { x: 4200, y: -1800, z: 350 },
    worldRotation: { pitch: 0, yaw: 135, roll: 0 },
    entranceType: 'hidden_clocktower',
    entranceAsset: '/Game/Environment/Aethermere/SM_ClockTower_Ruins',
    entranceDimensions: { width: 400, height: 600, depth: 400 },
    visualCues: [
      { type: 'particle_system', asset: '/Game/VFX/PS_TimeDistortion', offset: { x: 0, y: 0, z: 200 }, radius: 300, description: 'Faint golden time-distortion particles swirl around the ruined clocktower when player is within 30m' },
      { type: 'audio_cue', asset: '/Game/Audio/Amb_TickingClocks_Distant', radius: 500, falloff: 'logarithmic', description: 'Distant ticking clock sounds audible within 50m, intensifying near entrance' },
      { type: 'light_flicker', asset: '/Game/VFX/LightFunction_TemporalPulse', color: { r: 1.0, g: 0.85, b: 0.4 }, intensity: 2000, radius: 150, description: 'Amber light pulses from cracks in the clocktower base at 2-second intervals' },
    ],
    navigationHints: [
      'Ruined clocktower visible from the Aethermere overlook — partially phasing between timelines',
      'Path of frozen pendulum fragments leads from the main road to the tower base',
      'NPC scholar in Aethermere mentions "the tower that ticks between worlds"',
    ],
    levelStreamingVolume: { extends: { x: 800, y: 800, z: 1200 }, loadDistance: 2000 },
  },

  abyssal_cistern: {
    dungeonId: 'abyssal_cistern',
    region: 'SunkenHalls',
    worldPosition: { x: -2600, y: 3400, z: -180 },
    worldRotation: { pitch: 0, yaw: 270, roll: 0 },
    entranceType: 'submerged_gate',
    entranceAsset: '/Game/Environment/SunkenHalls/SM_CisternGate_Submerged',
    entranceDimensions: { width: 500, height: 300, depth: 200 },
    visualCues: [
      { type: 'water_effect', asset: '/Game/VFX/PS_WaterGlow_Depth', offset: { x: 0, y: 0, z: -50 }, radius: 400, description: 'Bioluminescent blue glow emanates from underwater grate, visible through murky water' },
      { type: 'audio_cue', asset: '/Game/Audio/Amb_WaterDripping_Echo', radius: 350, falloff: 'linear', description: 'Echoing drips and distant water rushing — sounds like a vast space below' },
      { type: 'bubble_trail', asset: '/Game/VFX/PS_Bubbles_Rising', offset: { x: 50, y: 0, z: 0 }, radius: 100, description: 'Steady stream of bubbles rises from the sealed grate' },
    ],
    navigationHints: [
      'Accessible via the flooded lower chambers of the SunkenHalls — look for the glowing grate',
      'Water level drops near the entrance, revealing ancient dwarven stonework',
      'A waterlogged journal on a nearby ledge describes "the cistern that drinks the sea"',
    ],
    levelStreamingVolume: { extends: { x: 1000, y: 1000, z: 600 }, loadDistance: 1500 },
  },

  ember_forge: {
    dungeonId: 'ember_forge',
    region: 'EmberPeaks',
    worldPosition: { x: 5800, y: 5200, z: 920 },
    worldRotation: { pitch: 0, yaw: 45, roll: 0 },
    entranceType: 'volcanic_crack',
    entranceAsset: '/Game/Environment/EmberPeaks/SM_VolcanicFissure_Large',
    entranceDimensions: { width: 300, height: 500, depth: 350 },
    visualCues: [
      { type: 'heat_haze', asset: '/Game/VFX/PS_HeatDistortion', offset: { x: 0, y: 0, z: 100 }, radius: 250, description: 'Visible heat shimmer rising from a crack in the mountainside' },
      { type: 'ember_particles', asset: '/Game/VFX/PS_Embers_Rising', offset: { x: 0, y: 0, z: 50 }, radius: 200, description: 'Glowing embers drift upward from the fissure, especially at night' },
      { type: 'audio_cue', asset: '/Game/Audio/Amb_ForgeHammer_Distant', radius: 600, falloff: 'logarithmic', description: 'Rhythmic metallic hammering from deep within — like a forge that never stopped' },
    ],
    navigationHints: [
      'Follow the trail of obsidian fragments up the eastern ridge of EmberPeaks',
      'A blacksmith NPC at the base camp tells tales of "the forge the mountain swallowed"',
      'The fissure glows brightest at dusk — the mountain breathes fire',
    ],
    levelStreamingVolume: { extends: { x: 700, y: 700, z: 1000 }, loadDistance: 2500 },
  },

  verdant_labyrinth: {
    dungeonId: 'verdant_labyrinth',
    region: 'VerdantReach',
    worldPosition: { x: -4100, y: -3200, z: 80 },
    worldRotation: { pitch: 0, yaw: 180, roll: 0 },
    entranceType: 'living_tree_hollow',
    entranceAsset: '/Game/Environment/VerdantReach/SM_AncientTree_Hollow',
    entranceDimensions: { width: 350, height: 700, depth: 350 },
    visualCues: [
      { type: 'bioluminescent_moss', asset: '/Game/VFX/PS_GlowMoss', offset: { x: 0, y: 0, z: 0 }, radius: 500, description: 'Bioluminescent moss forms a spiraling path toward the ancient tree' },
      { type: 'wildlife_behavior', asset: '/Game/AI/BP_Fireflies_Swarm', offset: { x: 0, y: 0, z: 200 }, radius: 300, description: 'Fireflies congregate around the tree hollow, denser near the entrance' },
      { type: 'audio_cue', asset: '/Game/Audio/Amb_Heartbeat_Deep', radius: 200, falloff: 'exponential', description: 'A deep rhythmic pulse — like a heartbeat — felt more than heard near the tree roots' },
    ],
    navigationHints: [
      'The largest tree in VerdantReach — its trunk is wide enough for a house',
      'Animals avoid the area in a perfect circle around the tree',
      'A druid NPC speaks of "the tree that remembers the first forest"',
    ],
    levelStreamingVolume: { extends: { x: 900, y: 900, z: 1400 }, loadDistance: 2000 },
  },

  umbral_nexus: {
    dungeonId: 'umbral_nexus',
    region: 'TheWilds',
    worldPosition: { x: 1200, y: -5600, z: -40 },
    worldRotation: { pitch: 0, yaw: 315, roll: 0 },
    entranceType: 'shadow_rift',
    entranceAsset: '/Game/Environment/TheWilds/SM_ShadowRift_Portal',
    entranceDimensions: { width: 250, height: 400, depth: 100 },
    visualCues: [
      { type: 'shadow_tear', asset: '/Game/VFX/PS_ShadowRift_Idle', offset: { x: 0, y: 0, z: 100 }, radius: 200, description: 'A tear in reality — edges ripple like dark water, showing glimpses of shadow realm' },
      { type: 'light_absorption', asset: '/Game/VFX/PP_LightDrain', radius: 400, description: 'Light sources dim within 40m of the rift — torches gutter, fireflies go dark' },
      { type: 'audio_cue', asset: '/Game/Audio/Amb_Whispers_Shadow', radius: 300, falloff: 'logarithmic', description: 'Unintelligible whispers that seem to come from your own shadow' },
    ],
    navigationHints: [
      'Only visible during night or in deep shadow — the rift vanishes in direct sunlight',
      'Standing stones near the rift are carved with shadow glyphs that glow at night',
      'A hunter NPC warns of "the place where shadows have weight"',
    ],
    levelStreamingVolume: { extends: { x: 600, y: 600, z: 800 }, loadDistance: 1800 },
  },

  primal_crucible: {
    dungeonId: 'primal_crucible',
    region: 'CrossroadsHub',
    worldPosition: { x: 200, y: 800, z: -220 },
    worldRotation: { pitch: 0, yaw: 0, roll: 0 },
    entranceType: 'elemental_convergence',
    entranceAsset: '/Game/Environment/CrossroadsHub/SM_ElementalNexus_Gate',
    entranceDimensions: { width: 600, height: 500, depth: 400 },
    visualCues: [
      { type: 'tri_element_vortex', asset: '/Game/VFX/PS_ElementalConvergence', offset: { x: 0, y: 0, z: 150 }, radius: 350, description: 'Three elemental streams (fire/water/nature) spiral around a central point beneath the Crossroads' },
      { type: 'ground_cracks', asset: '/Game/VFX/PS_ElementalSeep', offset: { x: 0, y: 0, z: 0 }, radius: 500, description: 'Cracks in the ground alternate between glowing orange (fire), blue (water), and green (nature)' },
      { type: 'audio_cue', asset: '/Game/Audio/Amb_ElementalHum_Triple', radius: 450, falloff: 'linear', description: 'A three-tone harmonic hum — each element contributes a distinct frequency' },
    ],
    navigationHints: [
      'Hidden beneath the Crossroads market square — accessible through the old well',
      'Three merchants in the market each sell one elemental key fragment (free with shard proof)',
      'The well water changes color at dawn (blue), noon (orange), and dusk (green)',
    ],
    levelStreamingVolume: { extends: { x: 1200, y: 1200, z: 800 }, loadDistance: 2000 },
  },
};

// ── Discovery Trigger System ────────────────────────────────────────────────

/**
 * Discovery trigger types — how players find and unlock dungeon entrances.
 * Each dungeon has a multi-step discovery flow:
 *   1. PROXIMITY — shard-sense activates near entrance (passive detection)
 *   2. INVESTIGATION — player examines visual cues / interacts with environment
 *   3. ACTIVATION — shard ability used to reveal/unlock the entrance
 *   4. ENTRY — entrance opens, level streaming begins
 */
export const DISCOVERY_TRIGGER_TYPES = {
  PROXIMITY_SENSE:     'proximity_sense',     // Shard-sense UI pulse when near
  INTERACT_EXAMINE:    'interact_examine',    // Examine object / read inscription
  SHARD_ABILITY_USE:   'shard_ability_use',   // Use specific shard ability on target
  TIME_CONDITIONAL:    'time_conditional',    // Only available at certain time of day
  QUEST_PREREQUISITE:  'quest_prerequisite',  // Requires completing a quest first
  MULTI_SHARD_RITUAL:  'multi_shard_ritual',  // Multiple shard types used together
  ENVIRONMENTAL_STATE: 'environmental_state', // Weather/corruption level condition
};

/**
 * Per-dungeon discovery trigger configurations.
 * Each dungeon has a sequence of triggers that form the discovery flow.
 */
export const DUNGEON_DISCOVERY_TRIGGERS = {
  temporal_sanctum: {
    dungeonId: 'temporal_sanctum',
    requiredShards: ['Time'],
    discoveryDifficulty: 'moderate',
    triggers: [
      {
        step: 1,
        type: DISCOVERY_TRIGGER_TYPES.PROXIMITY_SENSE,
        config: {
          radius: 500,
          shardType: 'Time',
          uiEffect: 'shard_pulse_gold',
          description: 'Time shard pulses with golden light when within 50m of the clocktower',
          blueprintEvent: 'OnShardSenseActivated',
          hudPrompt: 'Your Time Shard resonates with something nearby...',
        },
      },
      {
        step: 2,
        type: DISCOVERY_TRIGGER_TYPES.INTERACT_EXAMINE,
        config: {
          targetActor: 'SM_FrozenPendulumFragment',
          interactPrompt: 'Examine frozen pendulum fragment',
          description: 'Player examines one of the pendulum fragments on the path — receives lore about the Sanctum',
          loreEntry: 'chronicle_temporal_sanctum_hint',
          blueprintEvent: 'OnPendulumExamined',
        },
      },
      {
        step: 3,
        type: DISCOVERY_TRIGGER_TYPES.SHARD_ABILITY_USE,
        config: {
          ability: 'time_sense',
          targetActor: 'SM_ClockTower_SealedDoor',
          radius: 100,
          description: 'Use Time Sense on the sealed clocktower door — it rewinds to its unlocked state',
          vfxOnSuccess: '/Game/VFX/PS_TimeRewind_Door',
          audioOnSuccess: '/Game/Audio/SFX_TimeRewind_Unlock',
          blueprintEvent: 'OnTemporalSanctumRevealed',
          animSequence: 'AS_ClockTower_DoorRewind',
          duration: 3.0,
        },
      },
      {
        step: 4,
        type: DISCOVERY_TRIGGER_TYPES.ENVIRONMENTAL_STATE,
        config: {
          condition: 'always',
          description: 'No environmental restriction — accessible once unlocked',
        },
      },
    ],
    firstDiscoveryReward: {
      xp: 500,
      loreEntry: 'chronicle_temporal_sanctum_discovered',
      achievement: 'ACH_FoundTemporalSanctum',
      mapReveal: true,
    },
    rediscoveryBehavior: 'entrance_persists',
  },

  abyssal_cistern: {
    dungeonId: 'abyssal_cistern',
    requiredShards: ['Water'],
    discoveryDifficulty: 'hard',
    triggers: [
      {
        step: 1,
        type: DISCOVERY_TRIGGER_TYPES.PROXIMITY_SENSE,
        config: {
          radius: 350,
          shardType: 'Water',
          uiEffect: 'shard_pulse_blue',
          description: 'Water shard emits soft blue glow when near the submerged grate',
          blueprintEvent: 'OnShardSenseActivated',
          hudPrompt: 'Your Water Shard trembles... something vast lies below.',
        },
      },
      {
        step: 2,
        type: DISCOVERY_TRIGGER_TYPES.INTERACT_EXAMINE,
        config: {
          targetActor: 'SM_WaterloggedJournal',
          interactPrompt: 'Read waterlogged journal',
          description: 'Journal describes the cistern and hints at using water to open it',
          loreEntry: 'chronicle_abyssal_cistern_hint',
          blueprintEvent: 'OnCisternJournalRead',
        },
      },
      {
        step: 3,
        type: DISCOVERY_TRIGGER_TYPES.SHARD_ABILITY_USE,
        config: {
          ability: 'water_jet',
          targetActor: 'SM_CisternGate_Submerged',
          radius: 150,
          description: 'Use Water Jet to blast the sealed grate — water pressure forces it open from below',
          vfxOnSuccess: '/Game/VFX/PS_WaterBlast_GateOpen',
          audioOnSuccess: '/Game/Audio/SFX_MetalGrate_Burst',
          blueprintEvent: 'OnAbyssalCisternRevealed',
          animSequence: 'AS_CisternGate_BlastOpen',
          duration: 2.5,
        },
      },
    ],
    firstDiscoveryReward: {
      xp: 600,
      loreEntry: 'chronicle_abyssal_cistern_discovered',
      achievement: 'ACH_FoundAbyssalCistern',
      mapReveal: true,
    },
    rediscoveryBehavior: 'entrance_persists',
  },

  ember_forge: {
    dungeonId: 'ember_forge',
    requiredShards: ['Fire'],
    discoveryDifficulty: 'moderate',
    triggers: [
      {
        step: 1,
        type: DISCOVERY_TRIGGER_TYPES.PROXIMITY_SENSE,
        config: {
          radius: 600,
          shardType: 'Fire',
          uiEffect: 'shard_pulse_orange',
          description: 'Fire shard flares when near the volcanic fissure — the forge calls to it',
          blueprintEvent: 'OnShardSenseActivated',
          hudPrompt: 'Your Fire Shard burns hot — a forge awaits within the mountain.',
        },
      },
      {
        step: 2,
        type: DISCOVERY_TRIGGER_TYPES.INTERACT_EXAMINE,
        config: {
          targetActor: 'SM_ObsidianFragment_Trail',
          interactPrompt: 'Follow obsidian trail',
          description: 'Following the obsidian fragments leads to the fissure entrance',
          loreEntry: 'chronicle_ember_forge_hint',
          blueprintEvent: 'OnObsidianTrailFollowed',
        },
      },
      {
        step: 3,
        type: DISCOVERY_TRIGGER_TYPES.SHARD_ABILITY_USE,
        config: {
          ability: 'fire_lance',
          targetActor: 'SM_VolcanicFissure_SealedRock',
          radius: 120,
          description: 'Use Fire Lance to melt the cooled obsidian sealing the fissure entrance',
          vfxOnSuccess: '/Game/VFX/PS_LavaMelt_Entrance',
          audioOnSuccess: '/Game/Audio/SFX_RockMelt_Open',
          blueprintEvent: 'OnEmberForgeRevealed',
          animSequence: 'AS_Fissure_MeltOpen',
          duration: 4.0,
        },
      },
    ],
    firstDiscoveryReward: {
      xp: 500,
      loreEntry: 'chronicle_ember_forge_discovered',
      achievement: 'ACH_FoundEmberForge',
      mapReveal: true,
    },
    rediscoveryBehavior: 'entrance_persists',
  },

  verdant_labyrinth: {
    dungeonId: 'verdant_labyrinth',
    requiredShards: ['Nature'],
    discoveryDifficulty: 'easy',
    triggers: [
      {
        step: 1,
        type: DISCOVERY_TRIGGER_TYPES.PROXIMITY_SENSE,
        config: {
          radius: 500,
          shardType: 'Nature',
          uiEffect: 'shard_pulse_green',
          description: 'Nature shard blooms with green energy near the ancient tree',
          blueprintEvent: 'OnShardSenseActivated',
          hudPrompt: 'Your Nature Shard hums with life — the forest remembers.',
        },
      },
      {
        step: 2,
        type: DISCOVERY_TRIGGER_TYPES.INTERACT_EXAMINE,
        config: {
          targetActor: 'SM_GlowMoss_SpiralPath',
          interactPrompt: 'Follow the glowing moss trail',
          description: 'Bioluminescent moss forms a spiral path to the tree hollow',
          loreEntry: 'chronicle_verdant_labyrinth_hint',
          blueprintEvent: 'OnMossTrailFollowed',
        },
      },
      {
        step: 3,
        type: DISCOVERY_TRIGGER_TYPES.SHARD_ABILITY_USE,
        config: {
          ability: 'nature_growth',
          targetActor: 'SM_AncientTree_SealedHollow',
          radius: 80,
          description: 'Use Nature Growth on the sealed tree hollow — vines part to reveal the passage',
          vfxOnSuccess: '/Game/VFX/PS_VinesPart_Entrance',
          audioOnSuccess: '/Game/Audio/SFX_WoodCreak_Open',
          blueprintEvent: 'OnVerdantLabyrinthRevealed',
          animSequence: 'AS_TreeHollow_VinesPart',
          duration: 3.5,
        },
      },
    ],
    firstDiscoveryReward: {
      xp: 400,
      loreEntry: 'chronicle_verdant_labyrinth_discovered',
      achievement: 'ACH_FoundVerdantLabyrinth',
      mapReveal: true,
    },
    rediscoveryBehavior: 'entrance_persists',
  },

  umbral_nexus: {
    dungeonId: 'umbral_nexus',
    requiredShards: ['Shadow', 'Time'],
    discoveryDifficulty: 'very_hard',
    triggers: [
      {
        step: 1,
        type: DISCOVERY_TRIGGER_TYPES.TIME_CONDITIONAL,
        config: {
          condition: 'night_only',
          timeRange: { start: 20, end: 4 },
          description: 'The shadow rift only manifests at night (20:00-04:00 game time)',
          hudPrompt: 'Something stirs in the darkness... but only when the sun sleeps.',
        },
      },
      {
        step: 2,
        type: DISCOVERY_TRIGGER_TYPES.PROXIMITY_SENSE,
        config: {
          radius: 300,
          shardType: 'Shadow',
          uiEffect: 'shard_pulse_purple',
          description: 'Shadow shard darkens and vibrates when near the rift at night',
          blueprintEvent: 'OnShardSenseActivated',
          hudPrompt: 'Your Shadow Shard drinks the light... a rift between worlds.',
        },
      },
      {
        step: 3,
        type: DISCOVERY_TRIGGER_TYPES.INTERACT_EXAMINE,
        config: {
          targetActor: 'SM_ShadowGlyph_StandingStone',
          interactPrompt: 'Decipher shadow glyphs',
          description: 'Deciphering the standing stone glyphs reveals the dual-shard ritual needed',
          loreEntry: 'chronicle_umbral_nexus_hint',
          blueprintEvent: 'OnShadowGlyphDeciphered',
        },
      },
      {
        step: 4,
        type: DISCOVERY_TRIGGER_TYPES.MULTI_SHARD_RITUAL,
        config: {
          requiredShards: ['Shadow', 'Time'],
          ritualSequence: ['shadow_phase', 'time_freeze'],
          targetActor: 'SM_ShadowRift_Portal',
          radius: 80,
          description: 'Phase into the shadow realm, then freeze time to stabilize the rift — creating a traversable portal',
          vfxOnSuccess: '/Game/VFX/PS_ShadowRift_Stabilize',
          audioOnSuccess: '/Game/Audio/SFX_RiftStabilize_DualTone',
          blueprintEvent: 'OnUmbralNexusRevealed',
          animSequence: 'AS_ShadowRift_Stabilize',
          duration: 5.0,
        },
      },
    ],
    firstDiscoveryReward: {
      xp: 800,
      loreEntry: 'chronicle_umbral_nexus_discovered',
      achievement: 'ACH_FoundUmbralNexus',
      mapReveal: true,
    },
    rediscoveryBehavior: 'night_only_entrance',
  },

  primal_crucible: {
    dungeonId: 'primal_crucible',
    requiredShards: ['Fire', 'Water', 'Nature'],
    discoveryDifficulty: 'very_hard',
    triggers: [
      {
        step: 1,
        type: DISCOVERY_TRIGGER_TYPES.QUEST_PREREQUISITE,
        config: {
          questId: 'QST_ElementalConvergence',
          description: 'Must complete "Elemental Convergence" side quest — collecting 3 key fragments from market merchants',
          hudPrompt: 'The merchants of the Crossroads each guard a secret...',
        },
      },
      {
        step: 2,
        type: DISCOVERY_TRIGGER_TYPES.PROXIMITY_SENSE,
        config: {
          radius: 450,
          shardType: 'Fire',
          secondaryShard: 'Water',
          tertiaryShard: 'Nature',
          uiEffect: 'shard_pulse_tricolor',
          description: 'All three elemental shards resonate simultaneously near the old well',
          blueprintEvent: 'OnTriShardSenseActivated',
          hudPrompt: 'Three shards sing in harmony — the elements converge below.',
        },
      },
      {
        step: 3,
        type: DISCOVERY_TRIGGER_TYPES.MULTI_SHARD_RITUAL,
        config: {
          requiredShards: ['Fire', 'Water', 'Nature'],
          ritualSequence: ['fire_lance', 'water_jet', 'nature_growth'],
          targetActor: 'SM_ElementalNexus_Well',
          radius: 100,
          description: 'Fire to heat the well stones, Water to fill the basin, Nature to grow the spiral staircase — revealing the descent',
          vfxOnSuccess: '/Game/VFX/PS_ElementalNexus_Reveal',
          audioOnSuccess: '/Game/Audio/SFX_TriElement_Harmonic',
          blueprintEvent: 'OnPrimalCrucibleRevealed',
          animSequence: 'AS_Well_ElementalReveal',
          duration: 6.0,
        },
      },
    ],
    firstDiscoveryReward: {
      xp: 1000,
      loreEntry: 'chronicle_primal_crucible_discovered',
      achievement: 'ACH_FoundPrimalCrucible',
      mapReveal: true,
    },
    rediscoveryBehavior: 'entrance_persists',
  },
};

// ── Discovery State Machine ─────────────────────────────────────────────────

/**
 * Player-side discovery states per dungeon.
 * Tracked in save data per-player.
 */
export const DISCOVERY_STATES = {
  UNKNOWN:      'unknown',       // Player has never been near the dungeon
  SENSED:       'sensed',        // Shard-sense triggered (step 1 complete)
  INVESTIGATED: 'investigated',  // Examined clues (step 2 complete)
  REVEALED:     'revealed',      // Entrance unlocked (all steps complete)
  ENTERED:      'entered',       // Player has entered at least once
  COMPLETED:    'completed',     // Dungeon puzzle chain fully solved
};

/**
 * Create a player's discovery state tracker for all dungeons.
 */
export function createDiscoveryState(playerId = 'default') {
  const state = { playerId, dungeons: {} };
  for (const dungeonId of Object.keys(DUNGEON_WORLD_PLACEMENTS)) {
    state.dungeons[dungeonId] = {
      state: DISCOVERY_STATES.UNKNOWN,
      currentStep: 0,
      stepsCompleted: [],
      firstDiscoveredAt: null,
      firstEnteredAt: null,
      completedAt: null,
      timesEntered: 0,
    };
  }
  return state;
}

/**
 * Advance a dungeon's discovery state by one step.
 * Returns { advanced, newState, nextStep, reward? } or { error }.
 */
export function advanceDiscovery(discoveryState, dungeonId, stepCompleted) {
  const dungeon = DUNGEON_DISCOVERY_TRIGGERS[dungeonId];
  if (!dungeon) return { error: `Unknown dungeon: ${dungeonId}` };

  const ds = discoveryState.dungeons[dungeonId];
  if (!ds) return { error: `No discovery state for dungeon: ${dungeonId}` };

  const expectedStep = ds.currentStep + 1;
  if (stepCompleted !== expectedStep) {
    return { error: `Expected step ${expectedStep}, got ${stepCompleted}` };
  }

  const trigger = dungeon.triggers.find(t => t.step === stepCompleted);
  if (!trigger) return { error: `No trigger defined for step ${stepCompleted}` };

  ds.stepsCompleted.push(stepCompleted);
  ds.currentStep = stepCompleted;

  // Determine new state based on progress
  const totalSteps = dungeon.triggers.length;
  if (stepCompleted >= totalSteps) {
    ds.state = DISCOVERY_STATES.REVEALED;
    ds.firstDiscoveredAt = ds.firstDiscoveredAt || new Date().toISOString();
    return {
      advanced: true,
      newState: DISCOVERY_STATES.REVEALED,
      nextStep: null,
      reward: dungeon.firstDiscoveryReward,
      entranceUnlocked: true,
    };
  } else if (stepCompleted >= 2) {
    ds.state = DISCOVERY_STATES.INVESTIGATED;
  } else {
    ds.state = DISCOVERY_STATES.SENSED;
  }

  const nextTrigger = dungeon.triggers.find(t => t.step === stepCompleted + 1);
  return {
    advanced: true,
    newState: ds.state,
    nextStep: nextTrigger ? { step: nextTrigger.step, type: nextTrigger.type, description: nextTrigger.config.description } : null,
  };
}

/**
 * Get placement + discovery info for a single dungeon.
 */
export function getDungeonPlacement(dungeonId) {
  const placement = DUNGEON_WORLD_PLACEMENTS[dungeonId];
  if (!placement) return { error: `Unknown dungeon: ${dungeonId}` };
  const triggers = DUNGEON_DISCOVERY_TRIGGERS[dungeonId];
  const dungeon = ECHO_DUNGEONS[dungeonId];
  return {
    dungeonId,
    name: dungeon?.name || dungeonId,
    region: placement.region,
    worldPosition: placement.worldPosition,
    worldRotation: placement.worldRotation,
    entranceType: placement.entranceType,
    entranceAsset: placement.entranceAsset,
    entranceDimensions: placement.entranceDimensions,
    visualCues: placement.visualCues.length,
    navigationHints: placement.navigationHints,
    discoverySteps: triggers?.triggers?.length || 0,
    discoveryDifficulty: triggers?.discoveryDifficulty,
    requiredShards: triggers?.requiredShards || [],
    levelStreamingVolume: placement.levelStreamingVolume,
    firstDiscoveryReward: triggers?.firstDiscoveryReward,
    rediscoveryBehavior: triggers?.rediscoveryBehavior,
  };
}

/**
 * Get all dungeon world placements as a summary.
 */
export function getAllDungeonPlacements() {
  const placements = {};
  for (const dungeonId of Object.keys(DUNGEON_WORLD_PLACEMENTS)) {
    placements[dungeonId] = getDungeonPlacement(dungeonId);
  }
  return {
    totalDungeons: Object.keys(placements).length,
    placements,
    regions: [...new Set(Object.values(DUNGEON_WORLD_PLACEMENTS).map(p => p.region))],
  };
}

/**
 * Export world placement + discovery trigger specs to JSON for UE5 level design.
 */
export function exportWorldPlacementSpecs() {
  const game = getActiveGame();
  const outDir = join(game.assetsPath, 'Dungeons');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const exportData = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    milestone: 'ms_7',
    description: 'World placement coordinates, entrance configurations, visual cues, discovery triggers, and level streaming volumes for all 6 Shard Echo dungeons',
    worldPlacements: DUNGEON_WORLD_PLACEMENTS,
    discoveryTriggers: DUNGEON_DISCOVERY_TRIGGERS,
    discoveryStates: DISCOVERY_STATES,
    summary: getAllDungeonPlacements(),
  };

  const outPath = join(outDir, 'dungeon-world-placements.json');
  writeFileSync(outPath, JSON.stringify(exportData, null, 2), 'utf-8');
  log.info(`World placement specs exported to ${outPath}`);
  return {
    success: true,
    path: outPath,
    dungeons: Object.keys(DUNGEON_WORLD_PLACEMENTS).length,
    totalVisualCues: Object.values(DUNGEON_WORLD_PLACEMENTS).reduce(
      (sum, p) => sum + p.visualCues.length, 0
    ),
    totalDiscoverySteps: Object.values(DUNGEON_DISCOVERY_TRIGGERS).reduce(
      (sum, t) => sum + t.triggers.length, 0
    ),
    regions: [...new Set(Object.values(DUNGEON_WORLD_PLACEMENTS).map(p => p.region))],
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function difficultyRank(diff) {
  const ranks = { initiate: 1, adept: 2, master: 3 };
  return ranks[diff] || 0;
}
