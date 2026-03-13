/**
 * modules/unreal/lip-sync.js — Lip-Sync Timing Data Generator
 *
 * Generates viseme timing data from voice audio files + dialogue text.
 * Uses text-based phoneme estimation (English CMU-style mapping) to create
 * per-word viseme sequences synced to audio duration.
 *
 * Output: JSON timing data that UE5 can consume via Data Tables or
 * imported as FaceFX-compatible animation curves.
 *
 * ms_8: "Build lip-sync timing data from voice audio"
 * for NPC Dialogue & Voice Generation goal (npc_dialogue_voice).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, basename, extname } from 'path';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('lip-sync');

const ASSETS_DIR = join(process.cwd(), 'workspace', 'shattered-crown', 'Assets');
const VO_DIR = join(ASSETS_DIR, 'Audio', 'VO');
const LIPSYNC_DIR = join(ASSETS_DIR, 'LipSync');
const DIALOGUE_SCRIPTS = join(ASSETS_DIR, 'npc-dialogue-scripts.json');

// ── UE5 Viseme Set (ARKit / MetaHuman compatible) ───────────────────────────
// Standard 15-viseme set used by UE5's animation system

export const VISEMES = {
  SIL:  { id: 0,  name: 'sil',  desc: 'Silence / neutral mouth' },
  PP:   { id: 1,  name: 'PP',   desc: 'Bilabial plosive (p, b, m)' },
  FF:   { id: 2,  name: 'FF',   desc: 'Labiodental fricative (f, v)' },
  TH:   { id: 3,  name: 'TH',   desc: 'Dental fricative (th)' },
  DD:   { id: 4,  name: 'DD',   desc: 'Alveolar plosive (t, d, n, l)' },
  KK:   { id: 5,  name: 'KK',   desc: 'Velar plosive (k, g, ng)' },
  CH:   { id: 6,  name: 'CH',   desc: 'Postalveolar (ch, j, sh, zh)' },
  SS:   { id: 7,  name: 'SS',   desc: 'Alveolar fricative (s, z)' },
  NN:   { id: 8,  name: 'NN',   desc: 'Nasal (n, ng) - lips slightly parted' },
  RR:   { id: 9,  name: 'RR',   desc: 'Approximant (r, w)' },
  AA:   { id: 10, name: 'AA',   desc: 'Open vowel (a, ah, ar)' },
  EE:   { id: 11, name: 'EE',   desc: 'Close front vowel (ee, i)' },
  IH:   { id: 12, name: 'IH',   desc: 'Near-close vowel (ih, eh)' },
  OH:   { id: 13, name: 'OH',   desc: 'Mid back rounded vowel (oh, oo)' },
  OU:   { id: 14, name: 'OU',   desc: 'Close back vowel (ou, ow)' },
};

// ── Letter-to-Viseme Mapping ─────────────────────────────────────────────────
// Maps English letter patterns to viseme sequences. Priority: longer patterns first.

const LETTER_VISEME_MAP = [
  // Multi-character patterns (checked first)
  ['th', ['TH']],
  ['sh', ['CH']],
  ['ch', ['CH']],
  ['ck', ['KK']],
  ['ng', ['KK']],
  ['ph', ['FF']],
  ['wh', ['RR']],
  ['oo', ['OH']],
  ['ee', ['EE']],
  ['ou', ['OU']],
  ['ow', ['OU']],
  ['ai', ['AA', 'EE']],
  ['ay', ['AA', 'EE']],
  ['ea', ['EE']],
  ['oi', ['OH', 'EE']],
  ['oy', ['OH', 'EE']],
  ['au', ['AA', 'OH']],
  ['aw', ['AA', 'OH']],
  ['igh', ['AA', 'EE']],
  ['tion', ['CH', 'IH', 'NN']],
  ['sion', ['CH', 'IH', 'NN']],

  // Single characters
  ['a', ['AA']],
  ['e', ['IH']],
  ['i', ['EE']],
  ['o', ['OH']],
  ['u', ['OU']],
  ['y', ['EE']],
  ['p', ['PP']],
  ['b', ['PP']],
  ['m', ['PP']],
  ['f', ['FF']],
  ['v', ['FF']],
  ['t', ['DD']],
  ['d', ['DD']],
  ['n', ['NN']],
  ['l', ['DD']],
  ['k', ['KK']],
  ['g', ['KK']],
  ['c', ['KK']],
  ['q', ['KK']],
  ['s', ['SS']],
  ['z', ['SS']],
  ['x', ['KK', 'SS']],
  ['j', ['CH']],
  ['r', ['RR']],
  ['w', ['RR']],
  ['h', ['AA']],  // aspirated, open mouth
];

// ── Core Functions ───────────────────────────────────────────────────────────

/**
 * Convert a word to a sequence of visemes.
 */
export function wordToVisemes(word) {
  const lower = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!lower) return ['SIL'];

  const visemes = [];
  let i = 0;

  while (i < lower.length) {
    let matched = false;

    // Try longer patterns first (up to 4 chars)
    for (let len = Math.min(4, lower.length - i); len >= 2; len--) {
      const substr = lower.substring(i, i + len);
      const mapping = LETTER_VISEME_MAP.find(([pat]) => pat === substr);
      if (mapping) {
        visemes.push(...mapping[1]);
        i += len;
        matched = true;
        break;
      }
    }

    if (!matched) {
      const ch = lower[i];
      const mapping = LETTER_VISEME_MAP.find(([pat]) => pat === ch);
      if (mapping) {
        visemes.push(...mapping[1]);
      }
      i++;
    }
  }

  return visemes.length > 0 ? visemes : ['SIL'];
}

/**
 * Estimate speaking rate: words per second based on character type.
 * Fantasy characters speak at different paces.
 */
function getSpeakingRate(speaker) {
  const rates = {
    Elder: 2.2,       // slow, deliberate
    Kael: 2.8,        // measured, determined
    Lira: 3.2,        // quick, animated
    Theron: 2.5,      // soldier's pace, clear
    Sable: 2.6,       // careful, quiet
    Blacksmith: 2.7,  // straightforward
    Innkeeper: 3.0,   // chatty
    Merchant: 3.3,    // fast-talking
    Healer: 2.4,      // gentle, unhurried
    Bard: 2.8,        // theatrical pacing
    Narrator: 2.3,    // solemn, measured
    Boss: 2.0,        // dramatic, imposing
    Whisper: 1.8,     // slow, creeping
  };
  return rates[speaker] || 2.8;
}

/**
 * Generate lip-sync timing for a single dialogue line.
 *
 * @param {string} text - The spoken text
 * @param {number} audioDuration - Duration of the voice clip in seconds (0 = estimate)
 * @param {string} speaker - Speaker name for rate estimation
 * @returns {object} Timing data with viseme keyframes
 */
export function generateLineTiming(text, audioDuration = 0, speaker = 'Kael') {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return { duration: 0, keyframes: [] };

  // Estimate duration if not provided
  const wordsPerSecond = getSpeakingRate(speaker);
  const estimatedDuration = audioDuration > 0 ? audioDuration : words.length / wordsPerSecond;

  // Calculate time per word (with natural pauses at punctuation)
  const punctuationPause = 0.15; // seconds added for commas, periods etc
  let totalWeight = 0;
  const wordWeights = words.map(w => {
    const base = w.replace(/[^a-z]/gi, '').length; // syllable proxy
    const hasPunctuation = /[.,;:!?\-]$/.test(w);
    const weight = Math.max(1, base) + (hasPunctuation ? punctuationPause * wordsPerSecond : 0);
    totalWeight += weight;
    return { word: w, weight, hasPunctuation };
  });

  // Distribute time proportionally
  const keyframes = [];
  let currentTime = 0.05; // small lead-in
  const usableDuration = estimatedDuration - 0.1; // 0.05s lead-in + 0.05s trail-out

  for (const { word, weight, hasPunctuation } of wordWeights) {
    const wordDuration = (weight / totalWeight) * usableDuration;
    const visemes = wordToVisemes(word);

    // Distribute visemes evenly across word duration
    const visemeDuration = wordDuration / (visemes.length + 1); // +1 for blend back to neutral

    for (let vi = 0; vi < visemes.length; vi++) {
      keyframes.push({
        time: Math.round((currentTime + vi * visemeDuration) * 1000) / 1000,
        viseme: visemes[vi],
        visemeId: VISEMES[visemes[vi]]?.id ?? 0,
        weight: 1.0, // full intensity
        word: vi === 0 ? word : undefined,
      });
    }

    // Add silence/ease-out at end of word
    const wordEnd = currentTime + wordDuration;
    if (hasPunctuation) {
      keyframes.push({
        time: Math.round((wordEnd - punctuationPause * 0.5) * 1000) / 1000,
        viseme: 'SIL',
        visemeId: 0,
        weight: 0.3,
      });
    }

    currentTime = wordEnd;
  }

  // Final keyframe: return to silence
  keyframes.push({
    time: Math.round(estimatedDuration * 1000) / 1000,
    viseme: 'SIL',
    visemeId: 0,
    weight: 0.0,
  });

  return {
    text,
    speaker,
    duration: Math.round(estimatedDuration * 1000) / 1000,
    keyframeCount: keyframes.length,
    keyframes,
  };
}

/**
 * Generate lip-sync data for all voice lines in a dialogue tree.
 */
export function generateTreeLipSync(treeId, tree, audioDurations = {}) {
  const lines = [];

  for (const node of tree.nodes || []) {
    if (node.text && node.speaker) {
      const voiceRef = node.voiceRef || `${treeId}_${node.id}`;
      const duration = audioDurations[voiceRef] || 0;
      const timing = generateLineTiming(node.text, duration, node.speaker);

      lines.push({
        nodeId: node.id,
        voiceRef,
        speaker: node.speaker,
        emotion: node.emotion || 'neutral',
        ...timing,
      });
    }
  }

  return {
    treeId,
    npc: tree.npc,
    region: tree.region,
    lineCount: lines.length,
    lines,
  };
}

/**
 * Build lip-sync timing from the NPC dialogue scripts JSON.
 * Processes all 31 NPCs and their dialogue trees.
 */
export function buildAllLipSyncData() {
  if (!existsSync(DIALOGUE_SCRIPTS)) {
    log.warn('No dialogue scripts found at %s', DIALOGUE_SCRIPTS);
    return null;
  }

  const scripts = JSON.parse(readFileSync(DIALOGUE_SCRIPTS, 'utf-8'));
  if (!existsSync(LIPSYNC_DIR)) mkdirSync(LIPSYNC_DIR, { recursive: true });

  const allData = {
    version: 1,
    generatedAt: new Date().toISOString(),
    format: 'viseme_keyframes',
    visemeSet: 'ARKit_15',
    npcs: {},
    stats: { totalNPCs: 0, totalLines: 0, totalKeyframes: 0, totalDuration: 0 },
  };

  for (const [npcId, npc] of Object.entries(scripts.dialogueScripts || {})) {
    const npcData = {
      name: npc.name,
      region: npc.region,
      voiceProfile: npc.voiceProfile,
      trees: {},
    };

    for (const [treeKey, tree] of Object.entries(npc.dialogueTrees || {})) {
      const treeNodes = tree.nodes || [];
      const lines = [];

      for (const node of treeNodes) {
        if (node.text && node.type === 'npc_line') {
          const speaker = npc.name.split(' ').pop(); // Last name word as speaker key
          const timing = generateLineTiming(node.text, 0, speaker);

          lines.push({
            nodeIndex: treeNodes.indexOf(node),
            nodeId: node.id || `${treeKey}_${treeNodes.indexOf(node)}`,
            speaker: node.speaker || npc.name,
            emotion: node.anim || 'neutral',
            ...timing,
          });

          allData.stats.totalLines++;
          allData.stats.totalKeyframes += timing.keyframeCount;
          allData.stats.totalDuration += timing.duration;
        }
      }

      if (lines.length > 0) {
        npcData.trees[treeKey] = {
          treeId: tree.id || treeKey,
          lineCount: lines.length,
          lines,
        };
      }
    }

    allData.npcs[npcId] = npcData;
    allData.stats.totalNPCs++;
  }

  // Write master lip-sync data
  const masterPath = join(LIPSYNC_DIR, 'lip-sync-master.json');
  writeFileSync(masterPath, JSON.stringify(allData, null, 2));
  log.info('Master lip-sync data: %d NPCs, %d lines, %d keyframes, %.1fs total',
    allData.stats.totalNPCs, allData.stats.totalLines,
    allData.stats.totalKeyframes, allData.stats.totalDuration);

  // Write per-NPC files for UE5 import
  for (const [npcId, npc] of Object.entries(allData.npcs)) {
    const npcPath = join(LIPSYNC_DIR, `lipsync_${npcId}.json`);
    writeFileSync(npcPath, JSON.stringify(npc, null, 2));
  }

  // Generate UE5 Data Table import format (CSV)
  const csvPath = join(LIPSYNC_DIR, 'DT_LipSync_Import.csv');
  generateUE5DataTable(allData, csvPath);

  return { masterPath, stats: allData.stats };
}

/**
 * Generate UE5 Data Table CSV for lip-sync curves.
 * Format: Row_Name, VoiceRef, Speaker, Duration, VisemeData (JSON string)
 */
function generateUE5DataTable(allData, csvPath) {
  const rows = ['"---","VoiceRef","Speaker","Duration","Emotion","VisemeKeyframes"'];

  for (const [npcId, npc] of Object.entries(allData.npcs)) {
    for (const [treeKey, tree] of Object.entries(npc.trees)) {
      for (const line of tree.lines) {
        const rowName = `${npcId}_${line.nodeId}`.replace(/[^a-zA-Z0-9_]/g, '_');
        // Compact keyframes: [time, visemeId, weight] tuples
        const compactKF = line.keyframes.map(kf => [kf.time, kf.visemeId, kf.weight]);
        const kfJson = JSON.stringify(compactKF).replace(/"/g, '""');

        rows.push(`"${rowName}","${line.voiceRef || rowName}","${line.speaker}",${line.duration},"${line.emotion}","${kfJson}"`);
      }
    }
  }

  writeFileSync(csvPath, rows.join('\n'));
  log.info('UE5 Data Table CSV: %d rows written to %s', rows.length - 1, csvPath);
}

/**
 * Generate lip-sync data for companion campfire dialogue.
 */
export function buildCampfireLipSync() {
  const campfirePath = join(ASSETS_DIR, 'campfire-dialogue-scripts.json');
  if (!existsSync(campfirePath)) return null;

  const scripts = JSON.parse(readFileSync(campfirePath, 'utf-8'));
  if (!existsSync(LIPSYNC_DIR)) mkdirSync(LIPSYNC_DIR, { recursive: true });

  const data = {
    version: 1,
    type: 'campfire_lipsync',
    generatedAt: new Date().toISOString(),
    conversations: {},
    stats: { totalConversations: 0, totalLines: 0 },
  };

  for (const [convId, conv] of Object.entries(scripts.campfireConversations || scripts.conversations || {})) {
    const lines = [];
    for (const node of (conv.nodes || conv.lines || [])) {
      if (node.text) {
        const speaker = node.speaker || 'Kael';
        const timing = generateLineTiming(node.text, 0, speaker);
        lines.push({ nodeId: node.id, speaker, ...timing });
        data.stats.totalLines++;
      }
    }
    data.conversations[convId] = { lines };
    data.stats.totalConversations++;
  }

  const outPath = join(LIPSYNC_DIR, 'lipsync_campfire.json');
  writeFileSync(outPath, JSON.stringify(data, null, 2));
  log.info('Campfire lip-sync: %d conversations, %d lines', data.stats.totalConversations, data.stats.totalLines);
  return { path: outPath, stats: data.stats };
}

/**
 * Generate lip-sync data for whisper voice lines (Hollow King corruption).
 */
export function buildWhisperLipSync() {
  const manifestPath = join(ASSETS_DIR, 'audio-manifest.json');
  if (!existsSync(manifestPath)) return null;

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const whisperCat = manifest.categories?.voice_whispers;
  if (!whisperCat) return null;

  if (!existsSync(LIPSYNC_DIR)) mkdirSync(LIPSYNC_DIR, { recursive: true });

  const data = {
    version: 1,
    type: 'whisper_lipsync',
    generatedAt: new Date().toISOString(),
    whispers: [],
    stats: { total: 0, keyframes: 0 },
  };

  for (const asset of whisperCat.assets) {
    if (asset.status === 'completed' && asset.prompt) {
      // Extract the whispered text from the prompt (usually the dialogue text itself)
      const timing = generateLineTiming(asset.prompt, asset.duration || 3, 'Whisper');
      data.whispers.push({
        id: asset.id,
        tier: asset.id.match(/tier(\d)/)?.[1] || '1',
        trigger: asset.id.replace(/^whisper_tier\d_/, '').replace(/_\d+$/, ''),
        ...timing,
      });
      data.stats.total++;
      data.stats.keyframes += timing.keyframeCount;
    }
  }

  const outPath = join(LIPSYNC_DIR, 'lipsync_whispers.json');
  writeFileSync(outPath, JSON.stringify(data, null, 2));
  log.info('Whisper lip-sync: %d whispers, %d keyframes', data.stats.total, data.stats.keyframes);
  return { path: outPath, stats: data.stats };
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function buildAllLipSync() {
  log.info('Building lip-sync timing data for all voice lines...');

  const results = {
    npc: buildAllLipSyncData(),
    campfire: buildCampfireLipSync(),
    whisper: buildWhisperLipSync(),
  };

  const totalLines = (results.npc?.stats?.totalLines || 0) +
    (results.campfire?.stats?.totalLines || 0) +
    (results.whisper?.stats?.total || 0);

  log.info('Lip-sync generation complete: %d total lines processed', totalLines);
  return results;
}

export default { buildAllLipSync, buildAllLipSyncData, generateLineTiming, wordToVisemes };
