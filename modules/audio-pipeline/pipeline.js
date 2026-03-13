/**
 * modules/audio-pipeline/pipeline.js — Core audio generation logic.
 *
 * Reads audio-manifest.json, generates assets via ElevenLabs MCP
 * (music/SFX/voice) + VFX MCP (post-processing), updates manifest status.
 *
 * Generation methods:
 *  - "compose"              → ElevenLabs compose_music (paid plan only, auto-falls back)
 *  - "sound_effect_fallback" → Direct 5s motif via text_to_sound_effects (free plan)
 *  - "sound_effect"         → ElevenLabs text_to_sound_effects
 *  - "tts"                  → ElevenLabs text_to_speech
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { callTool } from '../../lib/mcp-gateway.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('audio-pipeline');

const MANIFEST_PATH = join(process.cwd(), 'workspace', 'shattered-crown', 'Assets', 'audio-manifest.json');
const AUDIO_DIR = join(process.cwd(), 'workspace', 'shattered-crown', 'Assets', 'Audio');

// ── Manifest I/O ──────────────────────────────────────────────────────────────

function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
}

function saveManifest(manifest) {
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

// ── Queries ───────────────────────────────────────────────────────────────────

export function getNextPendingAsset() {
  const manifest = loadManifest();
  for (const [catId, cat] of Object.entries(manifest.categories)) {
    for (const asset of cat.assets) {
      if (asset.status === 'pending') {
        return { categoryId: catId, category: cat, asset };
      }
    }
  }
  return null;
}

export function getProgress() {
  const manifest = loadManifest();
  let total = 0, completed = 0, inProgress = 0, failed = 0;
  for (const cat of Object.values(manifest.categories)) {
    for (const asset of cat.assets) {
      total++;
      if (asset.status === 'completed') completed++;
      else if (asset.status === 'in_progress') inProgress++;
      else if (asset.status === 'failed') failed++;
    }
  }
  return { total, completed, inProgress, failed, pending: total - completed - inProgress - failed };
}

function updateAssetStatus(assetId, status, extra = {}) {
  const manifest = loadManifest();
  for (const cat of Object.values(manifest.categories)) {
    for (const asset of cat.assets) {
      if (asset.id === assetId) {
        asset.status = status;
        Object.assign(asset, extra);
        saveManifest(manifest);
        return true;
      }
    }
  }
  return false;
}

// ── Shard-Bearer Musical Identity ─────────────────────────────────────────────

/**
 * Each shard-bearer has a unique musical identity — instruments, key, texture.
 * Phase 1 is controlled/building; Phase 2 is unleashed/climactic.
 */
const BOSS_IDENTITY = {
  ashen: {
    name: 'Ashen Shard-Bearer',
    key: 'Bb minor',
    lead: 'aggressive cello and prepared piano',
    texture: 'scorched, burnt, relentless',
    phase1_mood: 'Measured menace building to danger, testing the challenger',
    phase2_mood: 'Unleashed inferno, full orchestra corruption, desperate all-out war',
    phase2_extra: 'Add corrupted choir, double tempo percussion, dissonant brass stabs',
  },
  ironhold: {
    name: 'Ironhold Shard-Bearer',
    key: 'E minor',
    lead: 'war drums and brass fanfares',
    texture: 'martial, disciplined, iron',
    phase1_mood: 'Organized military assault, precise and threatening',
    phase2_mood: 'Discipline shatters into chaos, corruption breaks the formation',
    phase2_extra: 'Brass becomes distorted, drums double-time, anvil crashes on downbeats',
  },
  verdant: {
    name: 'Verdant Shard-Bearer',
    key: 'Ab minor',
    lead: 'twisted kalimba and aggressive choir',
    texture: 'primal, organic, feral',
    phase1_mood: 'Nature guardian awakens, vines and roots stir with menace',
    phase2_mood: 'Full primal fury, the forest itself attacks, screaming life force',
    phase2_extra: 'Rapid percussion, screaming choir, chaotic organic sounds layered',
  },
  sunken: {
    name: 'Sunken Shard-Bearer',
    key: 'F# minor',
    lead: 'haunting waterphone and deep strings',
    texture: 'abyssal, pressurized, drowning',
    phase1_mood: 'Rising tide of danger, crushing depths close in',
    phase2_mood: 'Tidal wave intensity, the abyss opens, drowning fury unleashed',
    phase2_extra: 'Crashing percussion, distorted glass harmonics, sub-bass pressure waves',
  },
  ember: {
    name: 'Ember Shard-Bearer',
    key: 'C minor',
    lead: 'thundering taiko and deep throat singing',
    texture: 'volcanic, seismic, primal fire',
    phase1_mood: 'Volcanic pressure building, earth trembles, magma rises',
    phase2_mood: 'Full eruption — lava flows, seismic fury, the mountain breaks',
    phase2_extra: 'Taiko double tempo, screaming distorted guitar, lava-flow intensity crescendo',
  },
};

/**
 * Extract shard-bearer region and phase from boss asset ID.
 * Format: mus_boss_{region}_p{1|2}
 */
function parseBossAssetId(id) {
  const match = id.match(/mus_boss_(\w+)_p(\d)/);
  if (!match) return null;
  return { region: match[1], phase: parseInt(match[2], 10) };
}

// ── Combat SFX Type System ────────────────────────────────────────────────────

/**
 * Combat SFX type enrichment — game audio best practices per SFX type.
 * Each type has: audio characteristics, mixing hints, and prompt enhancers
 * that make ElevenLabs produce game-ready sound effects.
 */
const COMBAT_SFX_TYPES = {
  // Weapon swings — fast transient, air movement
  sword_swing: {
    category: 'weapon_whoosh',
    enhancer: 'Sharp fast transient, clean air whoosh, no reverb tail, tight cut. Foley-style weapon movement.',
    mixHint: 'High-pass at 200Hz, fast attack compressor',
  },
  // Weapon impacts — punchy, satisfying hit feedback
  sword_impact: {
    category: 'weapon_impact',
    enhancer: 'Punchy impact with sharp attack, layered metal and organic elements. Satisfying hit feedback, game-ready.',
    mixHint: 'Mid-scoop EQ, parallel compression for punch',
  },
  // Shield/block — heavy defensive thud
  shield_block: {
    category: 'defensive',
    enhancer: 'Heavy thudding block impact, wooden and metal layers. Weighty defensive sound with short decay.',
    mixHint: 'Low-mid emphasis, fast decay gate',
  },
  // Parry — bright, precise, rewarding
  parry: {
    category: 'precision',
    enhancer: 'Bright metallic ring, precise timing feel. Rewarding precision feedback with crystalline clarity. Short sustain.',
    mixHint: 'High-shelf boost, tight transient shaping',
  },
  // Dodge/evasion — fast movement, cloth/leather
  dodge_roll: {
    category: 'movement',
    enhancer: 'Quick movement foley, leather and cloth rustling, ground contact. Fast evasive body movement sound.',
    mixHint: 'Natural dynamics, subtle compression',
  },
  // Critical hit — enhanced impact, dramatic
  critical_hit: {
    category: 'power_impact',
    enhancer: 'Devastating power impact with bass weight and bright shatter top. Dramatic game feedback, layered for maximum impact.',
    mixHint: 'Wide stereo, sub-bass layer, heavy compression',
  },
  // Enemy death — dissolve/fade effect
  enemy_death: {
    category: 'death_effect',
    enhancer: 'Fantasy death dissolve with ethereal tail. Dark particles fading sound, otherworldly. Clean start, gradual fade.',
    mixHint: 'Reverb send, high-shelf rolloff in tail',
  },
  // Player taking damage — painful, urgent feedback
  player_hit: {
    category: 'damage_feedback',
    enhancer: 'Visceral damage feedback with bass thud and subtle heartbeat element. Urgent, painful, clear player feedback.',
    mixHint: 'Low-end punch, subtle distortion layer',
  },
};

/**
 * Detect combat SFX type from asset ID.
 * Maps sfx_sword_swing_1 → "sword_swing", sfx_parry → "parry", etc.
 */
function detectCombatSfxType(assetId) {
  // Try each known type against the asset ID
  for (const type of Object.keys(COMBAT_SFX_TYPES)) {
    if (assetId.includes(type)) return type;
  }
  return null;
}

/**
 * Build an optimized prompt for combat SFX.
 * Adds game audio best practices: tight transients, no reverb, mono-friendly.
 */
function buildCombatSfxPrompt(asset) {
  const type = detectCombatSfxType(asset.id);
  const base = asset.prompt || '';

  if (!type) {
    // Unknown combat SFX type — add generic game audio hints
    return `${base}. Game-ready sound effect, clean transient, minimal reverb, tight duration.`;
  }

  const typeInfo = COMBAT_SFX_TYPES[type];
  return `${base}. ${typeInfo.enhancer} Dark fantasy RPG game-ready audio.`;
}

// ── Shard SFX Type System ─────────────────────────────────────────────────────

/**
 * Shard SFX type enrichment — magical/crystalline audio for shard abilities.
 * Models the shard power lifecycle: activate → sustain → release, plus
 * corruption states (overload, corruption pulse).
 */
const SHARD_SFX_TYPES = {
  // Activation — ascending crystalline power surge
  shard_activate: {
    category: 'power_onset',
    enhancer: 'Ascending crystalline tone with ethereal power surge, magical activation. Sharp onset, bright harmonic overtones building. Clean transient start.',
    mixHint: 'Crystalline high-shelf boost, stereo widening on harmonics',
    lifecycle: 'onset',
  },
  // Sustained power — pulsing magical aura
  shard_sustain: {
    category: 'power_sustain',
    enhancer: 'Pulsing ethereal crystal energy hum, steady magical aura loop. Warm resonant shimmer with subtle rhythmic pulse. Seamless loop point.',
    mixHint: 'Sidechain pulse compression, subtle chorus for width',
    lifecycle: 'sustain',
  },
  // Power release — descending deactivation
  shard_release: {
    category: 'power_offset',
    enhancer: 'Descending crystalline shimmer fading to silence, magical energy dispersing. Graceful deactivation with trailing sparkle particles.',
    mixHint: 'Reverb tail with high-shelf rolloff, fade envelope',
    lifecycle: 'offset',
  },
  // Overload — unstable dangerous energy
  shard_overload: {
    category: 'corruption_danger',
    enhancer: 'Unstable crystalline energy shattering and sparking, dangerous overload. Distorted harmonics, crackling corruption, warning urgency. Chaotic and threatening.',
    mixHint: 'Distortion layer, fast tremolo, sub-bass rumble',
    lifecycle: 'danger',
  },
  // Corruption pulse — dark spreading energy
  corruption_pulse: {
    category: 'corruption_spread',
    enhancer: 'Deep dark corruption energy pulse, bass throb with distorted whispers. Spreading darkness wave, ominous and invasive. Single pulsing impact.',
    mixHint: 'Heavy sub-bass, bitcrushed whisper layer, mono-compatible',
    lifecycle: 'danger',
  },
};

/**
 * Detect shard SFX type from asset ID.
 * Maps sfx_shard_activate → "shard_activate", sfx_corruption_pulse → "corruption_pulse", etc.
 */
function detectShardSfxType(assetId) {
  for (const type of Object.keys(SHARD_SFX_TYPES)) {
    if (assetId.includes(type)) return type;
  }
  return null;
}

/**
 * Build an optimized prompt for shard SFX.
 * Adds crystalline/magical audio characteristics per shard interaction type.
 */
function buildShardSfxPrompt(asset) {
  const type = detectShardSfxType(asset.id);
  const base = asset.prompt || '';

  if (!type) {
    return `${base}. Magical crystalline sound effect, ethereal quality, fantasy RPG game-ready.`;
  }

  const typeInfo = SHARD_SFX_TYPES[type];
  return `${base}. ${typeInfo.enhancer} Dark fantasy RPG shard magic, game-ready audio.`;
}

// ── UI SFX Type System ──────────────────────────────────────────────────────

/**
 * UI SFX type enrichment — clean, responsive audio for menus and feedback.
 * Designed for instant feel: short attack, no reverb tail, mono-friendly.
 * Each type targets a specific UI interaction with appropriate tone and urgency.
 */
const UI_SFX_TYPES = {
  // Menu selection — subtle navigational tick
  ui_select: {
    category: 'navigation',
    enhancer: 'Soft clean UI tick, subtle selection sound, gentle tonal click. Short and non-intrusive, pleasant navigational feedback. No reverb.',
    mixHint: 'High-pass 1kHz, zero reverb, mono',
    tone: 'neutral',
  },
  // Confirm/accept — positive affirming tone
  ui_confirm: {
    category: 'positive_action',
    enhancer: 'Bright positive confirmation chime, ascending two-note tone. Satisfying affirming UI sound, clean and uplifting. Short and decisive.',
    mixHint: 'Bright EQ, gentle limiter, mono-compatible',
    tone: 'positive',
  },
  // Back/cancel — soft negative tone
  ui_back: {
    category: 'negative_action',
    enhancer: 'Soft descending cancel tone, gentle two-note retreat sound. Non-harsh negative feedback, subtle and clean. Brief with fast decay.',
    mixHint: 'Slight low-pass, fast decay, mono',
    tone: 'negative',
  },
  // Notification/alert — attention-grabbing but pleasant
  ui_notification: {
    category: 'alert',
    enhancer: 'Clear notification chime, bright three-note ascending alert. Pleasant attention-grabbing UI bell, crisp and distinct. Moderate sustain with clean decay.',
    mixHint: 'Mid-high presence boost, gentle reverb, stereo-safe',
    tone: 'alert',
  },
  // Level up — rewarding celebratory flourish
  ui_levelup: {
    category: 'reward',
    enhancer: 'Triumphant level-up fanfare, ascending sparkle flourish with magical shimmer. Rewarding achievement sound, bright crystalline celebration. Fantasy RPG progression reward.',
    mixHint: 'Wide stereo sparkle, gentle compression, bright harmonics',
    tone: 'reward',
  },
};

/**
 * Detect UI SFX type from asset ID.
 * Maps sfx_ui_select → "ui_select", sfx_ui_levelup → "ui_levelup", etc.
 */
function detectUiSfxType(assetId) {
  for (const type of Object.keys(UI_SFX_TYPES)) {
    if (assetId.includes(type)) return type;
  }
  return null;
}

/**
 * Build an optimized prompt for UI SFX.
 * Adds clean, responsive UI audio characteristics per interaction type.
 */
function buildUiSfxPrompt(asset) {
  const type = detectUiSfxType(asset.id);
  const base = asset.prompt || '';

  if (!type) {
    return `${base}. Clean UI sound effect, short and responsive, no reverb, game menu audio.`;
  }

  const typeInfo = UI_SFX_TYPES[type];
  return `${base}. ${typeInfo.enhancer} Fantasy RPG UI, game-ready audio.`;
}

// ── Ambience Type System ────────────────────────────────────────────────────

/**
 * Ambience type enrichment — region-specific environmental audio loops.
 * Each region has a unique sonic palette: characteristic sounds, base layer,
 * and spatial hints for immersive environmental beds.
 * All ambience is 5s, designed for seamless looping.
 */
const AMBIENCE_TYPES = {
  // Crossroads — safe haven village warmth
  crossroads: {
    category: 'village',
    enhancer: 'Warm medieval village ambience bed, crackling hearth fire, distant crowd murmur, gentle breeze through open windows, songbirds, occasional horse whinny. Safe haven atmosphere, cozy and lived-in. Seamless loop.',
    spatialHint: 'Close-mid distance layers, warm low-end, stereo bird panning',
    biome: 'settlement',
  },
  // Ashen Wilds — desolate scorched wasteland
  ashen: {
    category: 'wasteland',
    enhancer: 'Desolate scorched wasteland ambience bed, howling dry wind over cracked earth, distant ember crackle and pop, creaking burnt timber, heat shimmer hum, silence broken by ash settling. Hostile and empty. Seamless loop.',
    spatialHint: 'Wide stereo wind, sparse point-source crackles, dry reverb',
    biome: 'hostile',
  },
  // Ironhold — military fortress interior
  ironhold: {
    category: 'fortress',
    enhancer: 'Dark military fortress interior ambience bed, rhythmic distant hammer strikes on anvil, echoing stone corridors, guttering torch flames, heavy boot steps in far hallways, chains clinking. Oppressive and industrial. Seamless loop.',
    spatialHint: 'Long reverb tail, metallic resonance, mono-compatible point sources',
    biome: 'hostile',
  },
  // Verdant Reach — enchanted overgrown forest
  verdant: {
    category: 'enchanted_forest',
    enhancer: 'Enchanted bioluminescent forest ambience bed, alien bird calls and insect chirps, magical energy shimmer hum, rustling luminous leaves, dripping water on moss, distant creature howl. Magical and slightly unsettling. Seamless loop.',
    spatialHint: 'Dense stereo foliage, shimmer high-end sparkle, close drips',
    biome: 'hostile',
  },
  // Sunken Halls — drowned underwater palace
  sunken: {
    category: 'underwater',
    enhancer: 'Deep underwater palace ambience bed, submerged heavy reverb, distant whale-like groans, slow bubble streams rising, gentle tidal current wash, pressure creaks from ancient stone. Haunting deep-sea isolation. Seamless loop.',
    spatialHint: 'Heavy low-pass filter character, long wet reverb, sub-bass pressure',
    biome: 'hostile',
  },
  // Ember Peaks — volcanic mountain
  ember: {
    category: 'volcanic',
    enhancer: 'Active volcanic mountain ambience bed, deep rumbling earth tremors, bubbling lava pockets, hissing pressurized steam vents, distant rock falls, occasional eruption thunder. Raw elemental power. Seamless loop.',
    spatialHint: 'Sub-bass rumble foundation, mid-range hiss layers, distant thunder',
    biome: 'hostile',
  },
  // Aethermere — cosmic void dimension
  aethermere: {
    category: 'void',
    enhancer: 'Cosmic void dimension ambience bed, reality-fracture digital glitches, deep space drone hum, reversed ethereal whispers, unstable energy crackling, dimensional membrane vibration. Alien and disorienting. Seamless loop.',
    spatialHint: 'Wide stereo glitches, sub-bass drone, unpredictable spatial placement',
    biome: 'hostile',
  },
};

/**
 * Detect ambience type from asset ID.
 * Maps amb_crossroads_base → "crossroads", amb_ashen_base → "ashen", etc.
 */
function detectAmbienceType(assetId) {
  if (!assetId.startsWith('amb_')) return null;
  for (const region of Object.keys(AMBIENCE_TYPES)) {
    if (assetId.includes(region)) return region;
  }
  return null;
}

// ── Kael Voice Line Type System ───────────────────────────────────────────────

/**
 * Kael voice line type enrichment — performance-matched TTS parameters.
 * Each voice line type has unique emotional delivery settings:
 *   - stability: lower = more emotional variation (grunts/death want more variation)
 *   - style: higher = more exaggerated delivery (combat cries, whispers need more style)
 *   - emotion: tag for logging/metadata
 *   - direction: human-readable performance note
 *   - order: generation order (combat first → shard → corruption → dialogue → death → exploration)
 */
const KAEL_VOICE_TYPES = {
  // Combat grunt: battle cry — fierce, aggressive, commanding
  combat_cry: {
    category: 'combat_grunt',
    emotion: 'fierce_determination',
    direction: 'Shouting battle cry, aggressive and commanding',
    stability: 0.35,
    style: 0.65,
    order: 1,
  },
  // Combat grunt: pain — gritted teeth, defiant
  combat_pain: {
    category: 'combat_grunt',
    emotion: 'pain_defiance',
    direction: 'Through gritted teeth, pain mixed with defiance',
    stability: 0.4,
    style: 0.6,
    order: 2,
  },
  // Combat grunt: kill confirmation — quiet, grim
  combat_kill: {
    category: 'combat_grunt',
    emotion: 'grim_resolve',
    direction: 'Quiet, grim, almost sad — the weight of taking a life',
    stability: 0.5,
    style: 0.45,
    order: 3,
  },
  // Combat grunt: low health — breathless, desperate
  combat_desperate: {
    category: 'combat_grunt',
    emotion: 'desperation',
    direction: 'Breathless, desperate, refusing to give up',
    stability: 0.35,
    style: 0.7,
    order: 4,
  },
  // Shard reaction: awe mixed with unease
  shard_reaction: {
    category: 'shard_reaction',
    emotion: 'awe_unease',
    direction: 'Reverent awe mixed with creeping unease, whispered and intimate',
    stability: 0.45,
    style: 0.55,
    order: 5,
  },
  // Corruption whisper: haunted, words from deep within
  corruption_whisper: {
    category: 'corruption_whisper',
    emotion: 'haunted',
    direction: 'Haunted whisper, as if the words come from somewhere deep and dark',
    stability: 0.3,
    style: 0.7,
    order: 6,
  },
  // Dialogue: natural conversation with buried warmth
  dialogue: {
    category: 'dialogue',
    emotion: 'measured_warmth',
    direction: 'Natural conversation, measured but with buried warmth',
    stability: 0.55,
    style: 0.4,
    order: 7,
  },
  // Monologue: internal reflection, voiceover quality
  monologue: {
    category: 'monologue',
    emotion: 'weary_reflection',
    direction: 'Internal reflection, weary but philosophical — voiceover quality',
    stability: 0.5,
    style: 0.5,
    order: 8,
  },
  // Death: dying breath, fading strength
  death: {
    category: 'death',
    emotion: 'final_words',
    direction: 'Dying breath, fading strength, desperate to convey last message',
    stability: 0.3,
    style: 0.75,
    order: 9,
  },
  // Exploration: cautious observation, moved by discovery
  exploration: {
    category: 'exploration',
    emotion: 'cautious_wonder',
    direction: 'Quiet observation, cautious but genuinely moved by discovery',
    stability: 0.5,
    style: 0.45,
    order: 10,
  },
};

// ── Lira Companion Voice Types ────────────────────────────────────────────────
// Sharp, quick-witted mezzo-soprano. Scholarly but street-smart.
// Think Ashly Burch's Aloy meets Jennifer Hale's Shepard.
const LIRA_VOICE_TYPES = {
  // Introduction: confident first impression, witty and slightly sardonic
  introduction: {
    category: 'introduction',
    emotion: 'confident_wit',
    direction: 'Confident and slightly amused, first impression with a witty edge — she is sizing him up',
    stability: 0.45,
    style: 0.6,
    order: 1,
  },
  // Combat callout: sharp tactical alert, urgent but controlled
  combat_callout: {
    category: 'combat_callout',
    emotion: 'urgent_alert',
    direction: 'Sharp and urgent tactical callout, controlled adrenaline — warning a companion, not panicking',
    stability: 0.4,
    style: 0.55,
    order: 2,
  },
  // Combat victory: sarcastic quip, relieved but hiding it behind humor
  combat_victory: {
    category: 'combat_victory',
    emotion: 'sardonic_relief',
    direction: 'Dry sarcasm masking relief, catching breath with a quip — dark humor after danger',
    stability: 0.45,
    style: 0.65,
    order: 3,
  },
  // Lore exposition: scholarly revelation, reverent and serious
  lore_exposition: {
    category: 'lore_exposition',
    emotion: 'scholarly_awe',
    direction: 'Scholarly gravitas, genuine reverence for ancient knowledge — she shifts from quippy to deeply serious',
    stability: 0.55,
    style: 0.45,
    order: 4,
  },
  // Guarded secret: evasive deflection, tension beneath casual dismissal
  guarded_secret: {
    category: 'guarded_secret',
    emotion: 'tense_evasion',
    direction: 'Carefully measured deflection, casual tone masking deep tension — she is hiding something important and knows it',
    stability: 0.5,
    style: 0.55,
    order: 5,
  },
};

/**
 * Detect Lira voice line type from asset ID.
 * Maps vo_lira_intro_1 → "introduction", vo_lira_combat_1 → "combat_callout", etc.
 */
function detectLiraVoiceType(assetId) {
  if (!assetId.startsWith('vo_lira_')) return null;
  // Introduction / meeting
  if (assetId.includes('intro')) return 'introduction';
  // Combat: callout vs victory
  if (assetId === 'vo_lira_combat_1') return 'combat_callout';
  if (assetId === 'vo_lira_combat_2') return 'combat_victory';
  // Lore / knowledge
  if (assetId.includes('knowledge') || assetId.includes('lore')) return 'lore_exposition';
  // Secrets / hidden motives
  if (assetId.includes('secret') || assetId.includes('hidden')) return 'guarded_secret';
  return null;
}

/**
 * Detect Kael voice line type from asset ID.
 * Maps vo_kael_combat_1 → "combat_cry", vo_kael_shard_1 → "shard_reaction", etc.
 */
function detectKaelVoiceType(assetId) {
  if (!assetId.startsWith('vo_kael_')) return null;
  // Combat grunts: map by sub-index
  if (assetId === 'vo_kael_combat_1') return 'combat_cry';
  if (assetId === 'vo_kael_combat_2') return 'combat_pain';
  if (assetId === 'vo_kael_combat_3') return 'combat_kill';
  if (assetId === 'vo_kael_combat_4') return 'combat_desperate';
  // Shard reactions
  if (assetId.includes('shard')) return 'shard_reaction';
  // Death
  if (assetId.includes('death')) return 'death';
  // Dialogue (to companion)
  if (assetId.includes('lira')) return 'dialogue';
  // Monologue (intro/opening)
  if (assetId.includes('intro')) return 'monologue';
  // Exploration: explore_2 is corruption-focused, explore_1 is discovery
  if (assetId === 'vo_kael_explore_2') return 'corruption_whisper';
  if (assetId === 'vo_kael_explore_1') return 'exploration';
  return null;
}

/**
 * Build an optimized prompt for ambience assets.
 * Adds region-specific environmental audio characteristics for immersive beds.
 */
function buildAmbiencePrompt(asset) {
  const region = detectAmbienceType(asset.id);
  const base = asset.prompt || '';

  if (!region) {
    return `${base}. Environmental ambience bed, seamless loop, immersive atmosphere, dark fantasy RPG.`;
  }

  const regionInfo = AMBIENCE_TYPES[region];
  return `${base}. ${regionInfo.enhancer} Dark fantasy RPG environmental audio.`;
}

// ── Generation Methods ────────────────────────────────────────────────────────

/**
 * Build an optimized fallback prompt for 5-second motifs.
 * Boss themes use shard-bearer identity system for unique, phase-aware prompts.
 * Combat themes get intensity keywords; exploration stays atmospheric.
 */
function buildMotifPrompt(asset) {
  const id = asset.id || '';
  const base = asset.prompt || '';

  // Boss music: use shard-bearer identity for unique, phase-aware prompts
  if (id.includes('boss')) {
    return buildBossMotifPrompt(asset);
  }

  if (id.includes('combat') || base.toLowerCase().includes('combat')) {
    // Combat motifs: emphasize rhythmic intensity, punchiness for 5 seconds
    return `Intense battle music motif, 5 seconds, aggressive percussion, driving rhythm, dark fantasy RPG combat. ${base}`;
  }
  // Default: atmospheric motif
  return `${base} — 5-second musical motif, theme seed, instrumental`;
}

/**
 * Build a rich, unique boss motif prompt using shard-bearer identity.
 * Phase 1: controlled intensity. Phase 2: unleashed climax.
 */
function buildBossMotifPrompt(asset) {
  const parsed = parseBossAssetId(asset.id);
  if (!parsed) {
    // Fallback if ID doesn't match expected pattern
    return `Epic boss battle motif, 5 seconds, dramatic orchestral hit, ominous power, dark fantasy RPG. ${asset.prompt || ''}`;
  }

  const identity = BOSS_IDENTITY[parsed.region];
  if (!identity) {
    return `Epic boss battle motif, 5 seconds, dramatic orchestral hit, dark fantasy RPG. ${asset.prompt || ''}`;
  }

  const isPhase2 = parsed.phase === 2;
  const phaseLabel = isPhase2 ? 'Phase 2 CLIMAX' : 'Phase 1 intro';
  const mood = isPhase2 ? identity.phase2_mood : identity.phase1_mood;
  const extra = isPhase2 ? ` ${identity.phase2_extra}.` : '';

  return [
    `${identity.name} boss battle ${phaseLabel}, 5-second motif in ${identity.key}.`,
    `Lead instruments: ${identity.lead}. Texture: ${identity.texture}.`,
    `Mood: ${mood}.${extra}`,
    `Dark fantasy RPG boss encounter, epic orchestral production.`,
  ].join(' ');
}

async function generateMusic(asset, outputDir) {
  const args = {
    prompt: asset.prompt,
    output_directory: outputDir,
  };
  // Pass explicit duration (manifest has seconds, API expects ms, min 10000)
  if (asset.duration) {
    args.music_length_ms = Math.max(asset.duration * 1000, 10_000);
  }

  try {
    const result = await callTool('elevenlabs', 'compose_music', args, 180_000);
    log.info({ assetId: asset.id, outputDir, resultLen: result?.length }, 'Music composed');
    return { result, actualMethod: 'compose' };
  } catch (err) {
    // compose_music requires paid ElevenLabs plan — fallback to 5s motif via sound_effects
    if (err.message?.includes('402') || err.message?.includes('payment_required') || err.message?.includes('paid_plan')) {
      log.warn({ assetId: asset.id }, 'compose_music requires paid plan — generating 5s motif via sound_effects');
      return generateMusicMotif(asset, outputDir);
    }
    throw err;
  }
}

/**
 * Direct 5-second motif generation via text_to_sound_effects.
 * Used as fallback from compose or directly via sound_effect_fallback method.
 */
async function generateMusicMotif(asset, outputDir) {
  const motifPrompt = buildMotifPrompt(asset);
  const motifResult = await callTool('elevenlabs', 'text_to_sound_effects', {
    text: motifPrompt,
    duration_seconds: 5,
    output_directory: outputDir,
  }, 60_000);
  log.info({ assetId: asset.id, outputDir, fallback: 'motif_5s' }, 'Music motif generated (fallback)');
  return { result: motifResult, actualMethod: 'sound_effect_fallback' };
}

async function generateSoundEffect(asset, outputDir) {
  const duration = Math.min(Math.max(asset.duration || 2, 0.5), 5);
  const id = asset.id || '';

  // Type-aware prompt optimization: combat SFX, shard SFX, or raw prompt
  let prompt = asset.prompt || asset.text;
  let optimized = null;
  if (id.startsWith('sfx_') && detectCombatSfxType(id)) {
    prompt = buildCombatSfxPrompt(asset);
    optimized = 'combat';
  } else if (detectShardSfxType(id)) {
    prompt = buildShardSfxPrompt(asset);
    optimized = 'shard';
  } else if (detectUiSfxType(id)) {
    prompt = buildUiSfxPrompt(asset);
    optimized = 'ui';
  } else if (detectAmbienceType(id)) {
    prompt = buildAmbiencePrompt(asset);
    optimized = 'ambience';
  }

  const result = await callTool('elevenlabs', 'text_to_sound_effects', {
    text: prompt,
    duration_seconds: duration,
    output_directory: outputDir,
  }, 60_000);

  log.info({ assetId: id, duration, outputDir, optimized, resultLen: result?.length }, 'Sound effect generated');
  return { result, actualMethod: 'sound_effect' };
}

async function generateVoiceLine(asset, category, outputDir) {
  const voiceConfig = category.voiceConfig || {};

  // Detect character-specific voice line type for performance-matched delivery
  const kaelType = detectKaelVoiceType(asset.id);
  const liraType = !kaelType ? detectLiraVoiceType(asset.id) : null;
  const detectedType = kaelType || liraType || null;
  const typeInfo = kaelType ? KAEL_VOICE_TYPES[kaelType]
    : liraType ? LIRA_VOICE_TYPES[liraType]
    : null;

  const args = {
    text: asset.text,
    output_directory: outputDir,
  };

  if (typeInfo) {
    // Type-specific voice settings: stability & style tuned per emotional context
    args.stability = typeInfo.stability;
    args.style = typeInfo.style;
    args.similarity_boost = voiceConfig.similarity_boost ?? 0.8;
    log.info({ assetId: asset.id, voiceType: detectedType, emotion: typeInfo.emotion,
      direction: typeInfo.direction }, 'Voice line: applying type-specific settings');
  } else {
    // Category defaults (used for untyped voice lines / other characters)
    if (voiceConfig.stability !== undefined) args.stability = voiceConfig.stability;
    if (voiceConfig.similarity_boost !== undefined) args.similarity_boost = voiceConfig.similarity_boost;
    if (voiceConfig.style !== undefined) args.style = voiceConfig.style;
  }

  const result = await callTool('elevenlabs', 'text_to_speech', args, 60_000);

  // Check if the MCP tool returned an error (callTool doesn't throw on API errors)
  const resultStr = typeof result === 'string' ? result : JSON.stringify(result || '');
  if (resultStr.includes('Error executing tool') || resultStr.includes('"error"') || resultStr.includes('status_code')) {
    throw new Error(`ElevenLabs TTS failed: ${resultStr.slice(0, 300)}`);
  }

  log.info({ assetId: asset.id, voiceType: detectedType, textLen: asset.text?.length,
    outputDir, resultLen: result?.length }, 'Voice line generated');
  return { result, actualMethod: 'tts', voiceType: detectedType };
}

// ── Main Generation ───────────────────────────────────────────────────────────

export async function generateOneAudioAsset() {
  const next = getNextPendingAsset();
  if (!next) {
    log.info('No pending audio assets in manifest');
    return { success: false, error: 'no_pending_assets' };
  }

  const { categoryId, category, asset } = next;
  const method = asset.method || category.method || 'sound_effect';

  log.info({ assetId: asset.id, category: categoryId, name: asset.name, method }, 'Starting audio generation');
  updateAssetStatus(asset.id, 'in_progress', { startedAt: Date.now() });

  const outputSubdir = join(AUDIO_DIR, category.outputSubdir || '');
  if (!existsSync(outputSubdir)) {
    mkdirSync(outputSubdir, { recursive: true });
  }

  try {
    let gen;

    switch (method) {
      case 'compose':
        gen = await generateMusic(asset, outputSubdir);
        break;
      case 'sound_effect_fallback':
        // Direct motif generation (skips compose_music attempt)
        gen = await generateMusicMotif(asset, outputSubdir);
        break;
      case 'sound_effect':
        gen = await generateSoundEffect(asset, outputSubdir);
        break;
      case 'tts':
        try {
          gen = await generateVoiceLine(asset, category, outputSubdir);
        } catch (ttsErr) {
          // TTS failed — fallback to sound_effect for voice lines with text
          log.warn({ assetId: asset.id, ttsErr: ttsErr.message }, 'TTS failed, falling back to sound_effect');
          if (asset.text) {
            const sfxPrompt = `Whispered voice saying: "${asset.text.slice(0, 100)}". Dark, ominous, ethereal whisper.`;
            gen = await generateSoundEffect({ ...asset, prompt: sfxPrompt, duration: 3 }, outputSubdir);
            gen.actualMethod = 'tts_fallback_sfx';
          } else {
            throw ttsErr; // No text to fallback with
          }
        }
        break;
      default:
        throw new Error(`Unknown generation method: ${method}`);
    }

    const resultStr = typeof gen.result === 'string' ? gen.result.slice(0, 500) : 'generated';
    const usedMethod = gen.actualMethod || method;

    updateAssetStatus(asset.id, 'completed', {
      completedAt: Date.now(),
      method: usedMethod,
      outputDir: category.outputSubdir,
      result: resultStr,
      note: usedMethod !== method ? `Fallback: ${method} → ${usedMethod}` : undefined,
    });

    log.info({ assetId: asset.id, category: categoryId, method: usedMethod }, 'Audio asset completed');
    return { success: true, assetId: asset.id, name: asset.name, method: usedMethod, category: categoryId };

  } catch (err) {
    log.error({ assetId: asset.id, err: err.message, method }, 'Audio generation failed');
    updateAssetStatus(asset.id, 'failed', {
      failedAt: Date.now(),
      error: err.message?.slice(0, 200),
    });
    return { success: false, assetId: asset.id, error: err.message };
  }
}

// ── Batch Generation ─────────────────────────────────────────────────────────

/**
 * Generate all pending assets in a specific category.
 * Returns { completed: [...], failed: [...] }
 */
export async function generateCategoryAssets(categoryId) {
  const manifest = loadManifest();
  const cat = manifest.categories[categoryId];
  if (!cat) return { completed: [], failed: [], error: `Unknown category: ${categoryId}` };

  const pending = cat.assets.filter(a => a.status === 'pending');
  log.info({ categoryId, pendingCount: pending.length }, 'Starting category batch generation');

  const completed = [];
  const failed = [];

  for (const asset of pending) {
    const method = asset.method || cat.method || 'sound_effect';
    const outputSubdir = join(AUDIO_DIR, cat.outputSubdir || '');
    if (!existsSync(outputSubdir)) mkdirSync(outputSubdir, { recursive: true });

    updateAssetStatus(asset.id, 'in_progress', { startedAt: Date.now() });

    try {
      let gen;
      switch (method) {
        case 'compose':
          gen = await generateMusic(asset, outputSubdir);
          break;
        case 'sound_effect_fallback':
          gen = await generateMusicMotif(asset, outputSubdir);
          break;
        case 'sound_effect':
          gen = await generateSoundEffect(asset, outputSubdir);
          break;
        case 'tts':
          try {
            gen = await generateVoiceLine(asset, cat, outputSubdir);
          } catch (ttsErr) {
            log.warn({ assetId: asset.id, ttsErr: ttsErr.message }, 'Batch TTS failed, falling back to sound_effect');
            if (asset.text) {
              const sfxPrompt = `Whispered voice saying: "${asset.text.slice(0, 100)}". Dark, ominous, ethereal whisper.`;
              gen = await generateSoundEffect({ ...asset, prompt: sfxPrompt, duration: 3 }, outputSubdir);
              gen.actualMethod = 'tts_fallback_sfx';
            } else {
              throw ttsErr;
            }
          }
          break;
        default:
          throw new Error(`Unknown method: ${method}`);
      }

      const usedMethod = gen.actualMethod || method;
      updateAssetStatus(asset.id, 'completed', {
        completedAt: Date.now(),
        method: usedMethod,
        outputDir: cat.outputSubdir,
        result: typeof gen.result === 'string' ? gen.result.slice(0, 500) : 'generated',
        note: usedMethod !== method ? `Fallback: ${method} → ${usedMethod}` : undefined,
      });
      completed.push(asset.id);
      log.info({ assetId: asset.id, method: usedMethod }, 'Batch asset completed');

    } catch (err) {
      log.error({ assetId: asset.id, err: err.message }, 'Batch asset failed');
      updateAssetStatus(asset.id, 'failed', {
        failedAt: Date.now(),
        error: err.message?.slice(0, 200),
      });
      failed.push({ id: asset.id, error: err.message });
    }
  }

  return { categoryId, completed, failed, total: pending.length };
}

// ── Boss Music Batch ─────────────────────────────────────────────────────────

/**
 * Generate all 10 boss music themes (5 shard-bearers × 2 phases).
 * Generates Phase 1 before Phase 2 for each boss to maintain musical progression.
 * Returns { completed: [...], failed: [...], skipped: [...] }
 */
export async function generateBossMusicBatch() {
  const manifest = loadManifest();
  const cat = manifest.categories.music_boss;
  if (!cat) return { completed: [], failed: [], skipped: [], error: 'music_boss category not found' };

  // Sort: process Phase 1 before Phase 2 for each boss (natural sort by id)
  const pending = cat.assets
    .filter(a => a.status === 'pending')
    .sort((a, b) => a.id.localeCompare(b.id));

  if (!pending.length) {
    const done = cat.assets.filter(a => a.status === 'completed').length;
    return { completed: [], failed: [], skipped: [], total: 0, alreadyDone: done };
  }

  log.info({ pendingCount: pending.length }, 'Boss music batch: starting generation');

  const outputSubdir = join(AUDIO_DIR, cat.outputSubdir || 'Music/Boss');
  if (!existsSync(outputSubdir)) mkdirSync(outputSubdir, { recursive: true });

  const completed = [];
  const failed = [];

  for (const asset of pending) {
    const parsed = parseBossAssetId(asset.id);
    const bossName = parsed ? BOSS_IDENTITY[parsed.region]?.name || parsed.region : asset.id;
    const phaseLabel = parsed ? `Phase ${parsed.phase}` : '';

    log.info({ assetId: asset.id, boss: bossName, phase: phaseLabel }, 'Boss music: generating');
    updateAssetStatus(asset.id, 'in_progress', { startedAt: Date.now() });

    try {
      const gen = await generateMusicMotif(asset, outputSubdir);
      const usedMethod = gen.actualMethod || 'sound_effect_fallback';

      updateAssetStatus(asset.id, 'completed', {
        completedAt: Date.now(),
        method: usedMethod,
        outputDir: cat.outputSubdir,
        result: typeof gen.result === 'string' ? gen.result.slice(0, 500) : 'generated',
        bossRegion: parsed?.region,
        bossPhase: parsed?.phase,
      });

      completed.push({ id: asset.id, boss: bossName, phase: phaseLabel });
      log.info({ assetId: asset.id, boss: bossName, method: usedMethod }, 'Boss music: completed');

    } catch (err) {
      log.error({ assetId: asset.id, boss: bossName, err: err.message }, 'Boss music: failed');
      updateAssetStatus(asset.id, 'failed', {
        failedAt: Date.now(),
        error: err.message?.slice(0, 200),
        bossRegion: parsed?.region,
        bossPhase: parsed?.phase,
      });
      failed.push({ id: asset.id, boss: bossName, error: err.message });
    }
  }

  log.info({ completed: completed.length, failed: failed.length }, 'Boss music batch: done');
  return {
    categoryId: 'music_boss',
    completed,
    failed,
    total: pending.length,
    bosses: Object.keys(BOSS_IDENTITY).map(r => BOSS_IDENTITY[r].name),
  };
}

// ── Combat SFX Batch ─────────────────────────────────────────────────────────

/**
 * Generate all 10 combat SFX assets with type-aware prompt optimization.
 * Groups by SFX type (weapon, defensive, movement, power, death, feedback)
 * and applies game audio best practices per type.
 * Returns { completed: [...], failed: [...] }
 */
export async function generateCombatSfxBatch() {
  const manifest = loadManifest();
  const cat = manifest.categories.sfx_combat;
  if (!cat) return { completed: [], failed: [], error: 'sfx_combat category not found' };

  const pending = cat.assets.filter(a => a.status === 'pending');
  if (!pending.length) {
    const done = cat.assets.filter(a => a.status === 'completed').length;
    return { completed: [], failed: [], total: 0, alreadyDone: done };
  }

  log.info({ pendingCount: pending.length }, 'Combat SFX batch: starting generation');

  const outputSubdir = join(AUDIO_DIR, cat.outputSubdir || 'SFX/Combat');
  if (!existsSync(outputSubdir)) mkdirSync(outputSubdir, { recursive: true });

  const completed = [];
  const failed = [];

  for (const asset of pending) {
    const sfxType = detectCombatSfxType(asset.id);
    const typeInfo = sfxType ? COMBAT_SFX_TYPES[sfxType] : null;
    const typeName = typeInfo?.category || 'unknown';

    log.info({ assetId: asset.id, sfxType, typeName }, 'Combat SFX: generating');
    updateAssetStatus(asset.id, 'in_progress', { startedAt: Date.now() });

    try {
      const gen = await generateSoundEffect(asset, outputSubdir);
      const usedMethod = gen.actualMethod || 'sound_effect';

      updateAssetStatus(asset.id, 'completed', {
        completedAt: Date.now(),
        method: usedMethod,
        outputDir: cat.outputSubdir,
        result: typeof gen.result === 'string' ? gen.result.slice(0, 500) : 'generated',
        sfxType,
        sfxCategory: typeName,
        mixHint: typeInfo?.mixHint,
      });

      completed.push({ id: asset.id, type: sfxType, category: typeName });
      log.info({ assetId: asset.id, sfxType, method: usedMethod }, 'Combat SFX: completed');

    } catch (err) {
      log.error({ assetId: asset.id, sfxType, err: err.message }, 'Combat SFX: failed');
      updateAssetStatus(asset.id, 'failed', {
        failedAt: Date.now(),
        error: err.message?.slice(0, 200),
        sfxType,
      });
      failed.push({ id: asset.id, type: sfxType, error: err.message });
    }
  }

  log.info({ completed: completed.length, failed: failed.length }, 'Combat SFX batch: done');
  return {
    categoryId: 'sfx_combat',
    completed,
    failed,
    total: pending.length,
    types: Object.keys(COMBAT_SFX_TYPES),
  };
}

// ── Shard SFX Batch ──────────────────────────────────────────────────────────

/**
 * Generate all 5 shard SFX assets with lifecycle-aware prompt optimization.
 * Covers the shard power lifecycle: activation → sustain → release,
 * plus corruption states (overload, corruption pulse).
 * Returns { completed: [...], failed: [...] }
 */
export async function generateShardSfxBatch() {
  const manifest = loadManifest();
  const cat = manifest.categories.sfx_shard;
  if (!cat) return { completed: [], failed: [], error: 'sfx_shard category not found' };

  const pending = cat.assets.filter(a => a.status === 'pending');
  if (!pending.length) {
    const done = cat.assets.filter(a => a.status === 'completed').length;
    return { completed: [], failed: [], total: 0, alreadyDone: done };
  }

  log.info({ pendingCount: pending.length }, 'Shard SFX batch: starting generation');

  const outputSubdir = join(AUDIO_DIR, cat.outputSubdir || 'SFX/Shard');
  if (!existsSync(outputSubdir)) mkdirSync(outputSubdir, { recursive: true });

  const completed = [];
  const failed = [];

  // Process in lifecycle order: onset → sustain → offset → danger
  const lifecycleOrder = ['onset', 'sustain', 'offset', 'danger'];
  const sorted = [...pending].sort((a, b) => {
    const la = SHARD_SFX_TYPES[detectShardSfxType(a.id)]?.lifecycle || 'z';
    const lb = SHARD_SFX_TYPES[detectShardSfxType(b.id)]?.lifecycle || 'z';
    return lifecycleOrder.indexOf(la) - lifecycleOrder.indexOf(lb);
  });

  for (const asset of sorted) {
    const sfxType = detectShardSfxType(asset.id);
    const typeInfo = sfxType ? SHARD_SFX_TYPES[sfxType] : null;
    const lifecycle = typeInfo?.lifecycle || 'unknown';

    log.info({ assetId: asset.id, sfxType, lifecycle }, 'Shard SFX: generating');
    updateAssetStatus(asset.id, 'in_progress', { startedAt: Date.now() });

    try {
      const gen = await generateSoundEffect(asset, outputSubdir);
      const usedMethod = gen.actualMethod || 'sound_effect';

      updateAssetStatus(asset.id, 'completed', {
        completedAt: Date.now(),
        method: usedMethod,
        outputDir: cat.outputSubdir,
        result: typeof gen.result === 'string' ? gen.result.slice(0, 500) : 'generated',
        sfxType,
        lifecycle,
        mixHint: typeInfo?.mixHint,
      });

      completed.push({ id: asset.id, type: sfxType, lifecycle });
      log.info({ assetId: asset.id, sfxType, method: usedMethod }, 'Shard SFX: completed');

    } catch (err) {
      log.error({ assetId: asset.id, sfxType, err: err.message }, 'Shard SFX: failed');
      updateAssetStatus(asset.id, 'failed', {
        failedAt: Date.now(),
        error: err.message?.slice(0, 200),
        sfxType,
      });
      failed.push({ id: asset.id, type: sfxType, error: err.message });
    }
  }

  log.info({ completed: completed.length, failed: failed.length }, 'Shard SFX batch: done');
  return {
    categoryId: 'sfx_shard',
    completed,
    failed,
    total: pending.length,
    types: Object.keys(SHARD_SFX_TYPES),
    lifecycleOrder,
  };
}

// ── UI SFX Batch ─────────────────────────────────────────────────────────────

/**
 * Generate all 5 UI SFX assets with interaction-type-aware prompt optimization.
 * Covers menu interactions: select, confirm, back/cancel, notification, level up.
 * Ordered by tone: neutral → positive → negative → alert → reward.
 * Returns { completed: [...], failed: [...] }
 */
export async function generateUiSfxBatch() {
  const manifest = loadManifest();
  const cat = manifest.categories.sfx_ui;
  if (!cat) return { completed: [], failed: [], error: 'sfx_ui category not found' };

  const pending = cat.assets.filter(a => a.status === 'pending');
  if (!pending.length) {
    const done = cat.assets.filter(a => a.status === 'completed').length;
    return { completed: [], failed: [], total: 0, alreadyDone: done };
  }

  log.info({ pendingCount: pending.length }, 'UI SFX batch: starting generation');

  const outputSubdir = join(AUDIO_DIR, cat.outputSubdir || 'SFX/UI');
  if (!existsSync(outputSubdir)) mkdirSync(outputSubdir, { recursive: true });

  const completed = [];
  const failed = [];

  // Process in tonal order: neutral → positive → negative → alert → reward
  const toneOrder = ['neutral', 'positive', 'negative', 'alert', 'reward'];
  const sorted = [...pending].sort((a, b) => {
    const ta = UI_SFX_TYPES[detectUiSfxType(a.id)]?.tone || 'z';
    const tb = UI_SFX_TYPES[detectUiSfxType(b.id)]?.tone || 'z';
    return toneOrder.indexOf(ta) - toneOrder.indexOf(tb);
  });

  for (const asset of sorted) {
    const sfxType = detectUiSfxType(asset.id);
    const typeInfo = sfxType ? UI_SFX_TYPES[sfxType] : null;
    const tone = typeInfo?.tone || 'unknown';

    log.info({ assetId: asset.id, sfxType, tone }, 'UI SFX: generating');
    updateAssetStatus(asset.id, 'in_progress', { startedAt: Date.now() });

    try {
      const gen = await generateSoundEffect(asset, outputSubdir);
      const usedMethod = gen.actualMethod || 'sound_effect';

      updateAssetStatus(asset.id, 'completed', {
        completedAt: Date.now(),
        method: usedMethod,
        outputDir: cat.outputSubdir,
        result: typeof gen.result === 'string' ? gen.result.slice(0, 500) : 'generated',
        sfxType,
        tone,
        mixHint: typeInfo?.mixHint,
      });

      completed.push({ id: asset.id, type: sfxType, tone });
      log.info({ assetId: asset.id, sfxType, method: usedMethod }, 'UI SFX: completed');

    } catch (err) {
      log.error({ assetId: asset.id, sfxType, err: err.message }, 'UI SFX: failed');
      updateAssetStatus(asset.id, 'failed', {
        failedAt: Date.now(),
        error: err.message?.slice(0, 200),
        sfxType,
      });
      failed.push({ id: asset.id, type: sfxType, error: err.message });
    }
  }

  log.info({ completed: completed.length, failed: failed.length }, 'UI SFX batch: done');
  return {
    categoryId: 'sfx_ui',
    completed,
    failed,
    total: pending.length,
    types: Object.keys(UI_SFX_TYPES),
    toneOrder,
  };
}

// ── Ambience Batch ────────────────────────────────────────────────────────────

/**
 * Generate all 7 ambience assets with region-aware prompt optimization.
 * Covers environmental beds for each region: Crossroads (safe), Ashen, Ironhold,
 * Verdant, Sunken, Ember, Aethermere (all hostile). Processes safe biomes first,
 * then hostile regions in geographical order.
 * Returns { completed: [...], failed: [...] }
 */
export async function generateAmbienceBatch() {
  const manifest = loadManifest();
  const cat = manifest.categories.ambience;
  if (!cat) return { completed: [], failed: [], error: 'ambience category not found' };

  const pending = cat.assets.filter(a => a.status === 'pending');
  if (!pending.length) {
    const done = cat.assets.filter(a => a.status === 'completed').length;
    return { completed: [], failed: [], total: 0, alreadyDone: done };
  }

  log.info({ pendingCount: pending.length }, 'Ambience batch: starting generation');

  const outputSubdir = join(AUDIO_DIR, cat.outputSubdir || 'Ambience');
  if (!existsSync(outputSubdir)) mkdirSync(outputSubdir, { recursive: true });

  const completed = [];
  const failed = [];

  // Process safe biomes first, then hostile in region order
  const regionOrder = ['crossroads', 'ashen', 'ironhold', 'verdant', 'sunken', 'ember', 'aethermere'];
  const sorted = [...pending].sort((a, b) => {
    const ra = detectAmbienceType(a.id) || 'z';
    const rb = detectAmbienceType(b.id) || 'z';
    return regionOrder.indexOf(ra) - regionOrder.indexOf(rb);
  });

  for (const asset of sorted) {
    const region = detectAmbienceType(asset.id);
    const regionInfo = region ? AMBIENCE_TYPES[region] : null;
    const biome = regionInfo?.biome || 'unknown';

    log.info({ assetId: asset.id, region, biome }, 'Ambience: generating');
    updateAssetStatus(asset.id, 'in_progress', { startedAt: Date.now() });

    try {
      const gen = await generateSoundEffect(asset, outputSubdir);
      const usedMethod = gen.actualMethod || 'sound_effect';

      updateAssetStatus(asset.id, 'completed', {
        completedAt: Date.now(),
        method: usedMethod,
        outputDir: cat.outputSubdir,
        result: typeof gen.result === 'string' ? gen.result.slice(0, 500) : 'generated',
        region,
        biome,
        spatialHint: regionInfo?.spatialHint,
      });

      completed.push({ id: asset.id, region, biome });
      log.info({ assetId: asset.id, region, method: usedMethod }, 'Ambience: completed');

    } catch (err) {
      log.error({ assetId: asset.id, region, err: err.message }, 'Ambience: failed');
      updateAssetStatus(asset.id, 'failed', {
        failedAt: Date.now(),
        error: err.message?.slice(0, 200),
        region,
      });
      failed.push({ id: asset.id, region, error: err.message });
    }
  }

  log.info({ completed: completed.length, failed: failed.length }, 'Ambience batch: done');
  return {
    categoryId: 'ambience',
    completed,
    failed,
    total: pending.length,
    regions: Object.keys(AMBIENCE_TYPES),
    regionOrder,
  };
}

// ── Kael Voice Batch ──────────────────────────────────────────────────────────

/**
 * Generate all 10 Kael voice lines with performance-matched TTS settings.
 * Each voice line gets type-specific stability/style parameters tuned for its
 * emotional context: combat grunts (low stability, high style), shard reactions
 * (moderate, awe-struck), corruption whispers (unstable, eerie), etc.
 * Processes in performance order: combat → shard → corruption → dialogue → death → exploration.
 * Returns { completed: [...], failed: [...] }
 */
export async function generateKaelVoiceBatch() {
  const manifest = loadManifest();
  const cat = manifest.categories.voice_kael;
  if (!cat) return { completed: [], failed: [], error: 'voice_kael category not found' };

  const pending = cat.assets.filter(a => a.status === 'pending');
  if (!pending.length) {
    const done = cat.assets.filter(a => a.status === 'completed').length;
    return { completed: [], failed: [], total: 0, alreadyDone: done };
  }

  log.info({ pendingCount: pending.length }, 'Kael voice batch: starting generation');

  const outputSubdir = join(AUDIO_DIR, cat.outputSubdir || 'VO/Kael');
  if (!existsSync(outputSubdir)) mkdirSync(outputSubdir, { recursive: true });

  const completed = [];
  const failed = [];

  // Process in performance order: combat grunts first, then shard, corruption, etc.
  const sorted = [...pending].sort((a, b) => {
    const oa = KAEL_VOICE_TYPES[detectKaelVoiceType(a.id)]?.order ?? 99;
    const ob = KAEL_VOICE_TYPES[detectKaelVoiceType(b.id)]?.order ?? 99;
    return oa - ob;
  });

  for (const asset of sorted) {
    const voiceType = detectKaelVoiceType(asset.id);
    const typeInfo = voiceType ? KAEL_VOICE_TYPES[voiceType] : null;
    const voiceCategory = typeInfo?.category || 'unknown';

    log.info({ assetId: asset.id, voiceType, voiceCategory, emotion: typeInfo?.emotion },
      'Kael voice: generating');
    updateAssetStatus(asset.id, 'in_progress', { startedAt: Date.now() });

    try {
      const gen = await generateVoiceLine(asset, cat, outputSubdir);
      const usedMethod = gen.actualMethod || 'tts';

      updateAssetStatus(asset.id, 'completed', {
        completedAt: Date.now(),
        method: usedMethod,
        outputDir: cat.outputSubdir,
        result: typeof gen.result === 'string' ? gen.result.slice(0, 500) : 'generated',
        voiceType,
        voiceCategory,
        emotion: typeInfo?.emotion,
        direction: typeInfo?.direction,
      });

      completed.push({ id: asset.id, type: voiceType, category: voiceCategory });
      log.info({ assetId: asset.id, voiceType, method: usedMethod }, 'Kael voice: completed');

    } catch (err) {
      log.error({ assetId: asset.id, voiceType, err: err.message }, 'Kael voice: failed');
      updateAssetStatus(asset.id, 'failed', {
        failedAt: Date.now(),
        error: err.message?.slice(0, 200),
        voiceType,
      });
      failed.push({ id: asset.id, type: voiceType, error: err.message });
    }
  }

  log.info({ completed: completed.length, failed: failed.length }, 'Kael voice batch: done');
  return {
    categoryId: 'voice_kael',
    completed,
    failed,
    total: pending.length,
    types: Object.keys(KAEL_VOICE_TYPES),
    performanceOrder: Object.entries(KAEL_VOICE_TYPES)
      .sort(([, a], [, b]) => a.order - b.order)
      .map(([k]) => k),
  };
}

/**
 * Generate all 5 Lira companion voice lines with performance-matched TTS settings.
 * Each line gets type-specific stability/style tuned for its emotional context:
 * introduction (confident wit), combat callout (urgent alert), combat victory (sardonic relief),
 * lore exposition (scholarly awe), guarded secret (tense evasion).
 * Processes in performance order: introduction → combat → lore → secret.
 * Returns { completed: [...], failed: [...] }
 */
export async function generateLiraVoiceBatch() {
  const manifest = loadManifest();
  const cat = manifest.categories.voice_lira;
  if (!cat) return { completed: [], failed: [], error: 'voice_lira category not found' };

  const pending = cat.assets.filter(a => a.status === 'pending');
  if (!pending.length) {
    const done = cat.assets.filter(a => a.status === 'completed').length;
    return { completed: [], failed: [], total: 0, alreadyDone: done };
  }

  log.info({ pendingCount: pending.length }, 'Lira voice batch: starting generation');

  const outputSubdir = join(AUDIO_DIR, cat.outputSubdir || 'VO/Lira');
  if (!existsSync(outputSubdir)) mkdirSync(outputSubdir, { recursive: true });

  const completed = [];
  const failed = [];

  // Process in performance order: introduction first, then combat, lore, secret
  const sorted = [...pending].sort((a, b) => {
    const oa = LIRA_VOICE_TYPES[detectLiraVoiceType(a.id)]?.order ?? 99;
    const ob = LIRA_VOICE_TYPES[detectLiraVoiceType(b.id)]?.order ?? 99;
    return oa - ob;
  });

  for (const asset of sorted) {
    const voiceType = detectLiraVoiceType(asset.id);
    const typeInfo = voiceType ? LIRA_VOICE_TYPES[voiceType] : null;
    const voiceCategory = typeInfo?.category || 'unknown';

    log.info({ assetId: asset.id, voiceType, voiceCategory, emotion: typeInfo?.emotion },
      'Lira voice: generating');
    updateAssetStatus(asset.id, 'in_progress', { startedAt: Date.now() });

    try {
      const gen = await generateVoiceLine(asset, cat, outputSubdir);
      const usedMethod = gen.actualMethod || 'tts';

      updateAssetStatus(asset.id, 'completed', {
        completedAt: Date.now(),
        method: usedMethod,
        outputDir: cat.outputSubdir,
        result: typeof gen.result === 'string' ? gen.result.slice(0, 500) : 'generated',
        voiceType,
        voiceCategory,
        emotion: typeInfo?.emotion,
        direction: typeInfo?.direction,
      });

      completed.push({ id: asset.id, type: voiceType, category: voiceCategory });
      log.info({ assetId: asset.id, voiceType, method: usedMethod }, 'Lira voice: completed');

    } catch (err) {
      log.error({ assetId: asset.id, voiceType, err: err.message }, 'Lira voice: failed');
      updateAssetStatus(asset.id, 'failed', {
        failedAt: Date.now(),
        error: err.message?.slice(0, 200),
        voiceType,
      });
      failed.push({ id: asset.id, type: voiceType, error: err.message });
    }
  }

  log.info({ completed: completed.length, failed: failed.length }, 'Lira voice batch: done');
  return {
    categoryId: 'voice_lira',
    completed,
    failed,
    total: pending.length,
    types: Object.keys(LIRA_VOICE_TYPES),
    performanceOrder: Object.entries(LIRA_VOICE_TYPES)
      .sort(([, a], [, b]) => a.order - b.order)
      .map(([k]) => k),
  };
}

// ── Status & Brief Builders ───────────────────────────────────────────────────

export function getStatusReport() {
  const progress = getProgress();
  const next = getNextPendingAsset();
  return {
    ...progress,
    percent: progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0,
    nextAsset: next ? `${next.asset.name} [${next.asset.method}] (${next.categoryId})` : 'none',
  };
}

export function manifestExists() {
  return existsSync(MANIFEST_PATH);
}

/**
 * Generate multiple audio assets in a single cycle.
 */
export async function generateBatchAudio(count = 5) {
  const results = { completed: [], failed: [], skipped: 0 };
  for (let i = 0; i < count; i++) {
    const next = getNextPendingAsset();
    if (!next) { results.skipped = count - i; break; }
    try {
      const result = await generateOneAudioAsset();
      if (result.success) results.completed.push(result.assetId || next.asset.id);
      else results.failed.push({ id: next.asset.id, error: result.error });
    } catch (err) {
      results.failed.push({ id: next.asset.id, error: err.message });
    }
  }
  return results;
}

export function buildAudioGenerationBrief(signal) {
  const d = signal.data;
  return {
    title: `Audio Asset Generation — ${d.pct}% complete`,
    content: `Audio pipeline: ${d.completed}/${d.total} assets done (${d.pending} pending, ${d.failed} failed).
Next: "${d.nextAssetName}" using ${d.nextMethod} method in category ${d.nextCategory}.

**ACTION REQUIRED — DO NOT PLAN, EXECUTE NOW:**
Call <tool_call name="generate_audio_batch">{"count": 5}</tool_call> to generate the next 5 audio assets.
If batch fails, call <tool_call name="generate_audio">{}</tool_call> for single generation.
Do NOT write plans, do NOT describe what should happen. CALL THE TOOL NOW.`,
    reasoning: `Audio pipeline has ${d.pending} pending assets. PRODUCTION MODE — call generate_audio_batch immediately, no planning.`,
  };
}
