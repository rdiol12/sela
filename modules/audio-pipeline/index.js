/**
 * modules/audio-pipeline/index.js — Module manifest for audio asset generation.
 *
 * Generates music, sound effects, and voice lines for The Shattered Crown
 * using ElevenLabs MCP + VFX MCP for post-processing.
 *
 * Exports a standard interface that lib/module-loader.js discovers and registers.
 */

import { detectAudioSignals } from './signals.js';
import { buildAudioGenerationBrief, getProgress, manifestExists } from './pipeline.js';
import { registerTool } from '../../lib/tool-bridge.js';

// ── Register tools ───────────────────────────────────────────────────────────

registerTool({
  name: 'generate_audio',
  description: 'Generate next pending audio asset from audio-manifest.json via ElevenLabs MCP. Handles music (compose), SFX (sound_effect), and voice lines (tts). No params needed — picks the next pending asset automatically. Returns { success, assetId, method, category } or { success: false, error }.',
  async execute() {
    const { generateOneAudioAsset } = await import('./pipeline.js');
    return generateOneAudioAsset();
  },
}, { rateLimit: 30000 });

registerTool({
  name: 'generate_audio_batch',
  description: 'Generate up to 5 pending audio assets in one call. Processes sequentially — auto-picks method per asset (compose/sound_effect/tts). Returns { completed: [...ids], failed: [...], skipped }.',
  async execute(params) {
    const { generateBatchAudio } = await import('./pipeline.js');
    return generateBatchAudio(params?.count || 5);
  },
}, { rateLimit: 30000 }); // 30s

registerTool({
  name: 'audio_progress',
  description: 'Get the current progress of the audio asset generation pipeline. Returns { total, completed, pending, failed, percent, nextAsset }.',
  async execute() {
    const { getStatusReport } = await import('./pipeline.js');
    return getStatusReport();
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'generate_audio_category',
  description: 'Generate ALL pending audio assets in a specific category. Pass categoryId (e.g., "music_exploration", "sfx_combat", "voice_kael"). Generates sequentially, returns { completed: [...], failed: [...] }.',
  async execute(params) {
    const { generateCategoryAssets } = await import('./pipeline.js');
    return generateCategoryAssets(params.categoryId);
  },
}, { rateLimit: 5000 });

registerTool({
  name: 'generate_boss_music',
  description: 'Generate all 10 boss music themes (5 shard-bearers × 2 phases). Uses unique musical identity per boss with phase-aware prompts. Phase 1 = building intensity, Phase 2 = unleashed climax. Returns { completed: [...], failed: [...] }.',
  async execute() {
    const { generateBossMusicBatch } = await import('./pipeline.js');
    return generateBossMusicBatch();
  },
}, { rateLimit: 30000 });

registerTool({
  name: 'generate_combat_sfx',
  description: 'Generate all 10 combat SFX (sword swings, impacts, shield block, parry, dodge roll, critical hit, enemy death, player hit). Uses type-aware prompt optimization with game audio best practices per SFX category. Returns { completed: [...], failed: [...] }.',
  async execute() {
    const { generateCombatSfxBatch } = await import('./pipeline.js');
    return generateCombatSfxBatch();
  },
}, { rateLimit: 30000 });

registerTool({
  name: 'generate_shard_sfx',
  description: 'Generate all 5 shard SFX (activation, sustain, release, overload, corruption pulse). Uses lifecycle-aware prompt optimization with crystalline/magical audio characteristics. Processes in lifecycle order: onset → sustain → offset → danger. Returns { completed: [...], failed: [...] }.',
  async execute() {
    const { generateShardSfxBatch } = await import('./pipeline.js');
    return generateShardSfxBatch();
  },
}, { rateLimit: 30000 });

registerTool({
  name: 'generate_ui_sfx',
  description: 'Generate all 5 UI SFX (menu select, confirm, cancel/back, notification, level up). Uses interaction-type-aware prompt optimization with clean responsive audio characteristics. Processes in tonal order: neutral → positive → negative → alert → reward. Returns { completed: [...], failed: [...] }.',
  async execute() {
    const { generateUiSfxBatch } = await import('./pipeline.js');
    return generateUiSfxBatch();
  },
}, { rateLimit: 30000 });

registerTool({
  name: 'generate_ambience',
  description: 'Generate all 7 environmental ambience loops (one per region: Crossroads village, Ashen wasteland, Ironhold fortress, Verdant forest, Sunken underwater, Ember volcanic, Aethermere void). Uses region-aware prompt optimization with spatial audio hints. Returns { completed: [...], failed: [...] }.',
  async execute() {
    const { generateAmbienceBatch } = await import('./pipeline.js');
    return generateAmbienceBatch();
  },
}, { rateLimit: 30000 });

registerTool({
  name: 'generate_kael_voice',
  description: 'Generate all 10 Kael protagonist voice lines with performance-matched TTS settings. Each line gets type-specific stability/style tuned for its emotional context: combat grunts (fierce, pained, grim, desperate), shard reactions (awe/unease), corruption whispers (haunted), dialogue, monologue, death, exploration. Processes in performance order. Returns { completed: [...], failed: [...] }.',
  async execute() {
    const { generateKaelVoiceBatch } = await import('./pipeline.js');
    return generateKaelVoiceBatch();
  },
}, { rateLimit: 30000 });

registerTool({
  name: 'generate_lira_voice',
  description: 'Generate all 5 Lira companion voice lines with performance-matched TTS settings. Each line gets type-specific stability/style tuned for its emotional context: introduction (confident wit), combat callout (urgent alert), combat victory (sardonic relief), lore exposition (scholarly awe), guarded secret (tense evasion). Processes in performance order. Returns { completed: [...], failed: [...] }.',
  async execute() {
    const { generateLiraVoiceBatch } = await import('./pipeline.js');
    return generateLiraVoiceBatch();
  },
}, { rateLimit: 30000 });

// ── Urgent work check ────────────────────────────────────────────────────────

function hasUrgentWork() {
  try {
    if (!manifestExists()) return false;
    const progress = getProgress();
    // Urgent if >80% done and only a few left (finishing sprint)
    return progress.pending > 0 && progress.pending <= 5 && progress.completed > 20;
  } catch { return false; }
}

// ── Module manifest ──────────────────────────────────────────────────────────

export default {
  name: 'audio-pipeline',
  signalPrefix: 'audio_',
  messageCategory: 'shattered-crown',

  detectSignals: detectAudioSignals,

  briefBuilders: {
    audio_generation: buildAudioGenerationBrief,
  },

  sonnetSignalTypes: ['audio_generation'],

  stateKey: 'audio-pipeline',
  stateKeyMap: {
    audio_generation: 'lastAudioGenerationAt',
  },

  hasUrgentWork,
};
