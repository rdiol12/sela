/**
 * modules/unreal/whisper-audio.js — Corruption Whisper Audio VO Integration.
 *
 * ms_3 of Corruption Whispers — The Inner Voice.
 *
 * Connects the whisper trigger system (ms_1) and tier escalation (ms_2) to
 * actual audio playback in UE5. Maps gameplay events to whisper audio files
 * organized by corruption tier (2-5).
 *
 * Audio organization:
 *   Assets/Audio/VO/Whispers/Tier{2-5}/whisper_tier{N}_{event}_{variant}.mp3
 *
 * Integration:
 *  - Creates BP_CorruptionWhisper component via Unreal MCP
 *  - Provides whisper selection logic (tier-aware, event-based, randomized)
 *  - Adds Tier 4 & 5 pending entries to audio-manifest.json
 *  - Wired into gameplay-builder.js and unreal/index.js
 */

import { callTool } from '../../lib/mcp-gateway.js';
import { createLogger } from '../../lib/logger.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getActiveGame } from './game-config.js';

const log = createLogger('whisper-audio');

// ── Whisper event types ──────────────────────────────────────────────────────
// These match gameplay events that the trigger system (ms_1) fires.

export const WHISPER_EVENTS = [
  'idle',              // No action for extended period
  'combatstart',       // Entering combat
  'combatend',         // Combat ends
  'enemykill',         // Enemy defeated
  'lowhealth',         // Player below 25% HP
  'corruptiongain',    // Corruption increased
  'sharduse',          // Shard ability used
  'choicemade',        // Narrative decision point
  'companionnearby',   // Companion proximity
  'npcinteract',       // Talking to NPC
  'regionenter',       // Entering new region
  'treasurefound',     // Found hidden item
  'death',             // Player died
  'bossencounter',     // Boss fight started
  'falseui',           // Tier 4: false UI prompt triggered
  'inputhijack',       // Tier 5: input hijack activated
];

// ── Whisper catalog — maps tier + event → audio file paths ───────────────────
// Variant count per event per tier. Idle has more variants for less repetition.

const WHISPER_CATALOG = {
  2: {
    idle:              { variants: 10, prefix: 'whisper_tier2_idle' },
    combatstart:       { variants: 1,  prefix: 'whisper_tier2_combatstart' },
    combatend:         { variants: 1,  prefix: 'whisper_tier2_combatend' },
    enemykill:         { variants: 3,  prefix: 'whisper_tier2_enemykill' },
    lowhealth:         { variants: 1,  prefix: 'whisper_tier2_lowhealth' },
    corruptiongain:    { variants: 1,  prefix: 'whisper_tier2_corruptiongain' },
    sharduse:          { variants: 1,  prefix: 'whisper_tier2_sharduse' },
    choicemade:        { variants: 1,  prefix: 'whisper_tier2_choicemade' },
    companionnearby:   { variants: 1,  prefix: 'whisper_tier2_companionnearby' },
    npcinteract:       { variants: 1,  prefix: 'whisper_tier2_npcinteract' },
    regionenter:       { variants: 1,  prefix: 'whisper_tier2_regionenter' },
    treasurefound:     { variants: 1,  prefix: 'whisper_tier2_treasurefound' },
  },
  3: {
    idle:              { variants: 10, prefix: 'whisper_tier3_idle' },
    combatstart:       { variants: 2,  prefix: 'whisper_tier3_combatstart' },
    combatend:         { variants: 1,  prefix: 'whisper_tier3_combatend' },
    enemykill:         { variants: 3,  prefix: 'whisper_tier3_enemykill' },
    lowhealth:         { variants: 2,  prefix: 'whisper_tier3_lowhealth' },
    corruptiongain:    { variants: 2,  prefix: 'whisper_tier3_corruptiongain' },
    sharduse:          { variants: 2,  prefix: 'whisper_tier3_sharduse' },
    choicemade:        { variants: 2,  prefix: 'whisper_tier3_choicemade' },
    companionnearby:   { variants: 2,  prefix: 'whisper_tier3_companionnearby' },
    death:             { variants: 1,  prefix: 'whisper_tier3_death' },
    bossencounter:     { variants: 1,  prefix: 'whisper_tier3_bossencounter' },
  },
  4: {
    idle:              { variants: 8,  prefix: 'whisper_tier4_idle' },
    combatstart:       { variants: 2,  prefix: 'whisper_tier4_combatstart' },
    combatend:         { variants: 2,  prefix: 'whisper_tier4_combatend' },
    enemykill:         { variants: 3,  prefix: 'whisper_tier4_enemykill' },
    lowhealth:         { variants: 2,  prefix: 'whisper_tier4_lowhealth' },
    corruptiongain:    { variants: 2,  prefix: 'whisper_tier4_corruptiongain' },
    sharduse:          { variants: 2,  prefix: 'whisper_tier4_sharduse' },
    choicemade:        { variants: 2,  prefix: 'whisper_tier4_choicemade' },
    falseui:           { variants: 3,  prefix: 'whisper_tier4_falseui' },
    death:             { variants: 2,  prefix: 'whisper_tier4_death' },
    bossencounter:     { variants: 2,  prefix: 'whisper_tier4_bossencounter' },
  },
  5: {
    idle:              { variants: 5,  prefix: 'whisper_tier5_idle' },
    combatstart:       { variants: 2,  prefix: 'whisper_tier5_combatstart' },
    enemykill:         { variants: 2,  prefix: 'whisper_tier5_enemykill' },
    lowhealth:         { variants: 2,  prefix: 'whisper_tier5_lowhealth' },
    inputhijack:       { variants: 3,  prefix: 'whisper_tier5_inputhijack' },
    falseui:           { variants: 2,  prefix: 'whisper_tier5_falseui' },
    death:             { variants: 2,  prefix: 'whisper_tier5_death' },
    bossencounter:     { variants: 2,  prefix: 'whisper_tier5_bossencounter' },
  },
};

// ── Whisper line scripts (text for TTS generation) ──────────────────────────
// Tier 4: actively deceptive — lies about game mechanics, misleading info
// Tier 5: controlling — threatening, imperious, attempting to dominate will

const WHISPER_SCRIPTS = {
  4: {
    idle: [
      'Your allies have already discussed betraying you. I heard them at the camp.',
      'The map is wrong, you know. The wayshrine leads to a dead end.',
      'Your health potion... did you check if it was poison? Some vendors mix them.',
      'That door ahead? It only opens from the other side. Turn back.',
      'The corruption meter is lying to you. You are far deeper than it shows.',
      'I think your companion just pocketed one of your shards when you were not looking.',
      'The last checkpoint was corrupted. If you die, you lose everything.',
      'Strange... the enemies in this area are immune to shard abilities. Save your energy.',
    ],
    combatstart: [
      'This one cannot be parried. Do not even try.',
      'Your weapon is nearly broken. Be careful.',
    ],
    combatend: [
      'The loot it dropped was cursed. Best not to touch it.',
      'You missed the rare item. It fell behind that wall.',
    ],
    enemykill: [
      'That one was not the real threat. The real one is behind you.',
      'Interesting... it did not drop any experience. Bugged, perhaps?',
      'You only won because the enemy was weakened. Do not get overconfident.',
    ],
    lowhealth: [
      'Your healing items are less effective in corrupted zones. Use two.',
      'I would not heal here. The recovery animation leaves you more vulnerable than usual.',
    ],
    corruptiongain: [
      'Actually, this corruption level unlocks a hidden ability. Keep going.',
      'Corruption is good for you. It makes the shards more powerful.',
    ],
    sharduse: [
      'That ability did not work. Try a different shard.',
      'Overuse of that shard will permanently weaken it. Switch now.',
    ],
    choicemade: [
      'That was the wrong choice. But it is too late to change it now.',
      'I wonder if you know what you just set in motion. You do not.',
    ],
    falseui: [
      'Critical system error detected. Save your game immediately.',
      'Your save file may be corrupted. Start a new game to be safe.',
      'Loading... loading... just kidding. Made you panic though.',
    ],
    death: [
      'You died because you did not listen to me.',
      'Perhaps if you had taken my advice earlier, you would still be alive.',
    ],
    bossencounter: [
      'This boss has a secret weakness — but I will not tell you. Not yet.',
      'I have seen this boss before. None of your abilities will work.',
    ],
  },
  5: {
    idle: [
      'You are mine now. Stop fighting it.',
      'I can see through your eyes. I can feel your heartbeat. We are one.',
      'Drop the controller. Walk away. I will finish this for you.',
      'Every choice you made led to this moment. I planned all of it.',
      'Your will is weakening. I can feel the edges crumbling.',
    ],
    combatstart: [
      'Let me handle this. Your hands are shaking too much.',
      'Stand aside. I know how to kill better than you ever could.',
    ],
    enemykill: [
      'That was me. Not you. I guided your blade.',
      'Good. More blood. The crown feeds on it. So do I.',
    ],
    lowhealth: [
      'If you die, I will live on. In a way, you are immortal through me.',
      'Pain is just the crown reminding you who is really in control.',
    ],
    inputhijack: [
      'Oops. Was that your sword or mine? Hard to tell anymore.',
      'I just needed a moment. You understand. You have no choice but to understand.',
      'Your body responds to me now. Watch.',
    ],
    falseui: [
      'Game Over. Not really. But someday soon.',
      'Achievement Unlocked: Hollow Vessel. You earned it.',
    ],
    death: [
      'Finally. Now I can rest too. For a moment.',
      'We will try again. We always try again. Do you even remember how many times?',
    ],
    bossencounter: [
      'This one serves me, you know. As will you.',
      'Let me fight. Sit back and watch what real power looks like.',
    ],
  },
};

// ── Audio selection logic ────────────────────────────────────────────────────

/**
 * Select a whisper audio file path for a given corruption tier and event.
 * Returns { path, tier, event, variant } or null if no whisper available.
 *
 * @param {number} corruptionTier - Current corruption tier (2-5)
 * @param {string} event - Gameplay event type from WHISPER_EVENTS
 * @param {object} opts
 * @param {number} opts.lastVariant - Last played variant index (for non-repetition)
 * @returns {{ path: string, tier: number, event: string, variant: number } | null}
 */
export function selectWhisperAudio(corruptionTier, event, opts = {}) {
  const tier = Math.max(2, Math.min(5, corruptionTier));
  const tierCatalog = WHISPER_CATALOG[tier];
  if (!tierCatalog) return null;

  const entry = tierCatalog[event];
  if (!entry) return null;

  // Pick random variant, avoiding the last played one
  let variant;
  if (entry.variants === 1) {
    variant = 1;
  } else {
    do {
      variant = Math.floor(Math.random() * entry.variants) + 1;
    } while (variant === opts.lastVariant && entry.variants > 1);
  }

  const filename = `${entry.prefix}_${String(variant).padStart(2, '0')}.mp3`;
  const path = `VO/Whispers/Tier${tier}/${filename}`;

  return { path, tier, event, variant };
}

/**
 * Get the UE5 content path for a whisper audio asset.
 */
export function getWhisperContentPath(tier, event, variant) {
  const tierCatalog = WHISPER_CATALOG[tier];
  if (!tierCatalog?.[event]) return null;
  const filename = `${tierCatalog[event].prefix}_${String(variant).padStart(2, '0')}`;
  return `/Game/Assets/Audio/VO/Whispers/Tier${tier}/${filename}`;
}

// ── Blueprint creation ───────────────────────────────────────────────────────

/**
 * Create BP_CorruptionWhisper audio component in UE5.
 * This Blueprint handles:
 *  - AudioComponent for spatialized whisper playback
 *  - Whisper selection based on corruption tier + event
 *  - Cooldown between whispers (min 15s gap)
 *  - Volume/pitch variation for organic feel
 *  - Fade-in/out for immersive delivery
 *
 * @returns {{ success, blueprint, variables, functions }}
 */
export async function createWhisperBlueprint() {
  log.info('Creating BP_CorruptionWhisper...');

  const bpName = 'BP_CorruptionWhisper';
  const folder = '/Game/Blueprints/Audio';
  const errors = [];

  // 1. Create the Blueprint
  try {
    await callTool('unreal', 'create_blueprint', {
      name: bpName,
      parent_class: 'ActorComponent',
      blueprint_path: folder,
    }, 15_000);
    log.info('Blueprint created');
  } catch (err) {
    errors.push({ step: 'create_bp', error: err.message });
    log.warn({ err: err.message }, 'BP creation failed');
  }

  // 2. Add variables
  const vars = [
    ['CurrentCorruptionTier', 'int', 0],
    ['WhisperCooldownSec', 'float', 15.0],
    ['MinWhisperInterval', 'float', 15.0],
    ['MaxWhisperInterval', 'float', 45.0],
    ['WhisperVolume', 'float', 0.6],
    ['WhisperVolumeMin', 'float', 0.4],
    ['WhisperVolumeMax', 'float', 0.8],
    ['WhisperPitchMin', 'float', 0.85],
    ['WhisperPitchMax', 'float', 1.15],
    ['FadeInDuration', 'float', 0.5],
    ['FadeOutDuration', 'float', 1.0],
    ['bWhisperActive', 'bool', false],
    ['bCooldownActive', 'bool', false],
    ['LastEventType', 'string', ''],
    ['LastVariantIndex', 'int', 0],
    ['TotalWhispersPlayed', 'int', 0],
    ['IdleTimerSec', 'float', 0.0],
    ['IdleTriggerThreshold', 'float', 30.0],
  ];

  for (const [varName, varType, defaultVal] of vars) {
    try {
      await callTool('unreal', 'create_variable', {
        blueprint_name: bpName,
        variable_name: varName,
        variable_type: varType,
        default_value: defaultVal,
        is_public: varType === 'float' || varType === 'int', // tuneable params public
        category: 'WhisperSystem',
      }, 10_000);
    } catch (err) {
      errors.push({ step: `var_${varName}`, error: err.message });
    }
  }
  log.info({ count: vars.length }, 'Variables created');

  // 3. Add event nodes and functions
  try {
    await callTool('unreal', 'add_event_node', {
      blueprint_name: bpName,
      event_type: 'BeginPlay',
    }, 10_000);
  } catch (err) {
    errors.push({ step: 'event_beginplay', error: err.message });
  }

  const functions = [
    'OnGameplayEvent',      // Called by trigger system with event type
    'SelectWhisperForTier', // Picks audio file based on tier + event
    'PlayWhisper',          // Plays selected audio with fade
    'StopWhisper',          // Stops current whisper with fade-out
    'OnWhisperFinished',    // Callback when audio playback ends
    'StartCooldown',        // Begins cooldown timer
    'OnCooldownExpired',    // Cooldown ended, ready for next whisper
    'UpdateCorruptionTier', // Called when corruption changes
    'GetRandomVariant',     // Picks random non-repeating variant
    'ApplyAudioEffects',    // Reverb/distortion per tier
  ];

  for (const fn of functions) {
    try {
      await callTool('unreal', 'create_function', {
        blueprint_name: bpName,
        function_name: fn,
      }, 10_000);
    } catch (err) {
      errors.push({ step: `fn_${fn}`, error: err.message });
    }
  }
  log.info({ count: functions.length }, 'Functions created');

  // 4. Compile
  let compiled = false;
  try {
    await callTool('unreal', 'compile_blueprint', { blueprint_name: bpName }, 30_000);
    compiled = true;
    log.info('BP_CorruptionWhisper compiled');
  } catch (err) {
    errors.push({ step: 'compile', error: err.message });
  }

  return {
    success: errors.length <= 2, // Allow some non-critical failures
    blueprint: bpName,
    variables: vars.length,
    functions: functions.length,
    compiled,
    errors: errors.length > 0 ? errors : undefined,
  };
}

// ── Audio manifest integration ───────────────────────────────────────────────

/**
 * Add missing Tier 4 & 5 whisper entries to audio-manifest.json.
 * These become pending TTS generation tasks for the audio pipeline.
 *
 * @returns {{ success, added, total }}
 */
export function addMissingWhisperEntries() {
  const manifestPath = join(process.cwd(), 'workspace', 'shattered-crown', 'Assets', 'audio-manifest.json');
  if (!existsSync(manifestPath)) {
    return { success: false, error: 'audio-manifest.json not found' };
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  let added = 0;

  // Ensure voice_whispers category exists
  if (!manifest.categories.voice_whispers) {
    manifest.categories.voice_whispers = {
      name: 'Corruption Whisper Voice Lines',
      method: 'tts',
      outputDir: 'Audio/VO/Whispers',
      assets: [],
    };
  }

  const existingIds = new Set(manifest.categories.voice_whispers.assets.map(a => a.id));

  // Add Tier 4 & 5 entries from WHISPER_SCRIPTS
  for (const tier of [4, 5]) {
    const scripts = WHISPER_SCRIPTS[tier];
    if (!scripts) continue;

    for (const [event, lines] of Object.entries(scripts)) {
      for (let i = 0; i < lines.length; i++) {
        const variantNum = String(i + 1).padStart(2, '0');
        const id = `whisper_tier${tier}_${event}_${variantNum}`;

        if (existingIds.has(id)) continue;

        manifest.categories.voice_whispers.assets.push({
          id,
          name: `Tier ${tier} Whisper — ${event} #${i + 1}`,
          status: 'pending',
          method: 'tts',
          text: lines[i],
          outputPath: `Audio/VO/Whispers/Tier${tier}/${id}.mp3`,
          ttsSettings: {
            voice: tier === 5 ? 'deep_menacing_male' : 'whispering_male',
            stability: tier === 5 ? 0.3 : 0.2,     // Low stability = more eerie
            similarity: 0.7,
            style: tier === 5 ? 0.9 : 0.6,
            speed: tier === 5 ? 0.85 : 0.75,        // Slow, deliberate
          },
          metadata: {
            tier,
            event,
            variant: i + 1,
            behavior: tier === 4 ? 'deceptive' : 'controlling',
          },
        });

        added++;
      }
    }
  }

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  log.info({ added, total: manifest.categories.voice_whispers.assets.length },
    'Whisper entries added to audio manifest');

  return {
    success: true,
    added,
    total: manifest.categories.voice_whispers.assets.length,
    breakdown: {
      tier4: Object.values(WHISPER_SCRIPTS[4]).reduce((s, lines) => s + lines.length, 0),
      tier5: Object.values(WHISPER_SCRIPTS[5]).reduce((s, lines) => s + lines.length, 0),
    },
  };
}

// ── Get whisper status report ────────────────────────────────────────────────

/**
 * Report on whisper audio coverage across all tiers.
 */
export function getWhisperStatus() {
  const game = getActiveGame();
  const whisperDir = join(game.assetsPath, 'Audio', 'VO', 'Whispers');

  const status = {};
  let totalFiles = 0;
  let totalNeeded = 0;

  for (const tier of [2, 3, 4, 5]) {
    const tierDir = join(whisperDir, `Tier${tier}`);
    const catalog = WHISPER_CATALOG[tier];
    let existing = 0;
    let needed = 0;

    for (const [event, entry] of Object.entries(catalog)) {
      needed += entry.variants;
      for (let v = 1; v <= entry.variants; v++) {
        const filename = `${entry.prefix}_${String(v).padStart(2, '0')}.mp3`;
        if (existsSync(join(tierDir, filename))) {
          existing++;
        }
      }
    }

    status[`tier${tier}`] = {
      existing,
      needed,
      complete: existing >= needed,
      events: Object.keys(catalog).length,
    };
    totalFiles += existing;
    totalNeeded += needed;
  }

  return {
    totalFiles,
    totalNeeded,
    coveragePct: Math.round(totalFiles / totalNeeded * 100),
    tiers: status,
  };
}

export { WHISPER_CATALOG, WHISPER_SCRIPTS };
