/**
 * modules/unreal/ending-voice.js — Ending voice line variants for dynamic synthesis.
 *
 * Creates voice-acted narration entries for all 5 ending paths:
 *   - 5 Opening Montage cues (path-dependent narration)
 *   - 4 Crown Judgment cues (willpower-dependent)
 *   - 4 Character Epilogue cues (choice-dependent)
 *   - 5 Shard-Bearer Fate cues (per-boss resolution narration)
 *   - 4 Companion Reaction cues (Lira's response)
 *   - 5 Realm Outcome cues (world state narration)
 *   - 3 Post-Credits Hook cues (sequel tease)
 *
 * Total: 30 unique voiced narration lines with narrator-specific TTS settings.
 *
 * ms_3: "Create voice-acted line variants for key ending moments"
 * for Dynamic Ending Synthesis goal (97cdab63).
 */

import { getActiveGame } from './game-config.js';
import { createLogger } from '../../lib/logger.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const log = createLogger('ending-voice');

// ── Narrator definitions ─────────────────────────────────────────────────────

/**
 * Each narrator has unique TTS settings that shape their vocal performance.
 * Matches NarratorID in FSCEndingComponent.
 */
export const NARRATORS = {
  narrator: {
    id: 'narrator',
    label: 'Omniscient Narrator',
    description: 'Deep, authoritative, mythic tone — like reading an ancient chronicle',
    tts: { stability: 0.75, similarity: 0.80, style: 0.40, speed: 0.85 },
    voiceHint: 'deep male voice, authoritative storyteller, mythic epic narrator',
  },
  kael: {
    id: 'kael',
    label: 'Kael (Internal Voice)',
    description: 'Protagonist\'s inner monologue — raw, personal, emotional',
    tts: { stability: 0.55, similarity: 0.75, style: 0.60, speed: 0.90 },
    voiceHint: 'young male voice, internal monologue, emotional and reflective',
  },
  crown: {
    id: 'crown',
    label: 'The Hollow Crown',
    description: 'The crown\'s ancient whisper — seductive, commanding, inhuman',
    tts: { stability: 0.30, similarity: 0.70, style: 0.80, speed: 0.75 },
    voiceHint: 'ethereal whisper, ancient and otherworldly, seductive dark power',
  },
  lira: {
    id: 'lira',
    label: 'Lira (Companion)',
    description: 'Companion\'s reaction — sardonic warmth fading to sorrow or resolve',
    tts: { stability: 0.60, similarity: 0.80, style: 0.55, speed: 0.95 },
    voiceHint: 'young female voice, witty and warm, with underlying emotion',
  },
};

// ── Voice line catalog ───────────────────────────────────────────────────────

/**
 * Complete catalog of ending voice lines.
 * Each entry maps to a VoiceOverCue in FSCEndingComponent.
 *
 * @type {Array<{
 *   id: string,         // Matches C++ VoiceOverCue FName
 *   category: string,   // opening | judgment | epilogue | bearer | companion | realm | hook
 *   narrator: string,   // narrator | kael | crown | lira
 *   path?: string,      // which ending path this line belongs to (if path-specific)
 *   text: string,       // The actual dialogue/narration text
 *   tone: string,       // Performance direction
 *   durationEst: number // Estimated VO duration in seconds
 * }>}
 */
export const ENDING_VOICE_LINES = [

  // ── Opening Montage (5 lines — one per path) ────────────────────────────

  {
    id: 'VO_Opening_Redeemer',
    category: 'opening',
    narrator: 'narrator',
    path: 'Redeemer',
    text: 'In the end, it was not the shards that saved the realm — it was the will of a single soul who refused to break. Kael stood atop the Hollow Summit, the crown\'s corruption burning away like morning mist, and the world held its breath.',
    tone: 'triumphant, hopeful, rising crescendo',
    durationEst: 12,
  },
  {
    id: 'VO_Opening_Arbiter',
    category: 'opening',
    narrator: 'narrator',
    path: 'Arbiter',
    text: 'Neither saint nor sinner, Kael ascended the Hollow Summit with the weight of a world\'s choices upon weary shoulders. The crown pulsed with ancient hunger, but Kael\'s gaze held steady — neither defiant nor yielding. Judgment would come, but it would be earned.',
    tone: 'contemplative, balanced, measured authority',
    durationEst: 14,
  },
  {
    id: 'VO_Opening_Martyr',
    category: 'opening',
    narrator: 'narrator',
    path: 'Martyr',
    text: 'The corruption had taken so much — flesh and memory and hope. But Kael climbed the Hollow Summit on broken legs with a single truth burning brighter than any shard: some lights can only shine by being consumed. This was always how it would end.',
    tone: 'tragic, heroic, solemn acceptance',
    durationEst: 13,
  },
  {
    id: 'VO_Opening_Vessel',
    category: 'opening',
    narrator: 'crown',
    path: 'Vessel',
    text: 'How delicious, this surrender. You climbed so high, little shard-bearer, only to kneel at the summit. Your will... dissolved like sugar in rain. You are mine now. You were always mine. Come — let me wear your face a while longer.',
    tone: 'ominous, hollow, seductive menace',
    durationEst: 12,
  },
  {
    id: 'VO_Opening_Hollow',
    category: 'opening',
    narrator: 'crown',
    path: 'HollowKing',
    text: 'There is no Kael anymore. There never truly was — only a vessel waiting to be filled. The Hollow King rises. Not reborn. Completed. And this time, there will be no champion to stand against the crown. This time, the crown stands alone.',
    tone: 'terrifying, dark, absolute finality',
    durationEst: 13,
  },

  // ── Crown's Judgment (4 lines — willpower-dependent) ────────────────────

  {
    id: 'VO_Judgment_Resisted',
    category: 'judgment',
    narrator: 'kael',
    text: 'I hear you, crown. I\'ve heard you since the first shard. Every whisper, every lie, every promise of power that tasted like honey and ash. But I am not yours. I was never yours. And every time you whispered, I chose myself. That is my judgment.',
    tone: 'defiant, fierce, rising triumph',
    durationEst: 14,
  },
  {
    id: 'VO_Judgment_Mixed',
    category: 'judgment',
    narrator: 'kael',
    text: 'I won\'t pretend I didn\'t listen. Some whispers... I followed. Some paths, I walked willingly into the dark. But I also turned back. I also fought. I am not pure, crown. But I am not yours either. I am something in between — and that will have to be enough.',
    tone: 'conflicted, weary, quiet resolve',
    durationEst: 14,
  },
  {
    id: 'VO_Judgment_Submitted',
    category: 'judgment',
    narrator: 'kael',
    text: 'You were right. About all of it. The power, the purpose, the... emptiness of fighting. I\'m tired of resisting something that feels like breathing. Maybe this is what I was meant for. Maybe the crown chose better than I ever could.',
    tone: 'resigned, hollow, fading will',
    durationEst: 12,
  },
  {
    id: 'VO_Judgment_Silent',
    category: 'judgment',
    narrator: 'narrator',
    text: 'Kael said nothing. There was nothing left to say. The crown\'s judgment needed no words — it was written in every choice, every compliance, every whisper obeyed without question. The silence at the summit was the loudest sound the realm had ever heard.',
    tone: 'ominous silence, cold finality',
    durationEst: 12,
  },

  // ── Character Epilogue (4 lines — choice-dependent) ─────────────────────

  {
    id: 'VO_Epilogue_Sacrifice',
    category: 'epilogue',
    narrator: 'narrator',
    path: 'Martyr',
    text: 'The light that erupted from the summit was not fire, nor magic, nor the glow of any shard. It was something older — the light of a life freely given. When it faded, the crown was sealed, the corruption was bound, and Kael was gone. Only the warmth remained.',
    tone: 'solemn beauty, tears held back, reverent',
    durationEst: 14,
  },
  {
    id: 'VO_Epilogue_Claim',
    category: 'epilogue',
    narrator: 'crown',
    path: 'HollowKing',
    text: 'Rise, my king. The realm kneels. The shards sing. The corruption flows not as poison but as purpose. You have claimed what was always yours. Now... let us begin. There is so much to unmake.',
    tone: 'dark coronation, triumphant menace',
    durationEst: 11,
  },
  {
    id: 'VO_Epilogue_Merge',
    category: 'epilogue',
    narrator: 'kael',
    path: 'Arbiter',
    text: 'The crown is part of me now. Not a master — a partner. I can feel every shard, every region, every heartbeat in the realm. The power is immense. The responsibility is worse. But someone must hold the balance, and I did not come this far to look away.',
    tone: 'contemplative power, lonely authority',
    durationEst: 13,
  },
  {
    id: 'VO_Epilogue_Redeemer',
    category: 'epilogue',
    narrator: 'kael',
    path: 'Redeemer',
    text: 'The shards are gone. The crown is dust. And I... I am just Kael again. No power, no whispers, no burning in my veins. Just a person standing on a mountain in the quiet. I forgot what quiet sounded like. I think I missed it.',
    tone: 'peaceful relief, bittersweet freedom',
    durationEst: 12,
  },

  // ── Shard-Bearer Fate Narration (5 lines — one per boss) ────────────────

  {
    id: 'VO_Fate_Gorrath',
    category: 'bearer',
    narrator: 'narrator',
    text: 'Gorrath the Ashen, Keeper of the Fire Shard. In the end, the flames that consumed kingdoms could not consume one truth — that even fire can be forgiven, or feared, but never forgotten.',
    tone: 'mythic eulogy, fire imagery',
    durationEst: 10,
  },
  {
    id: 'VO_Fate_Seravyn',
    category: 'bearer',
    narrator: 'narrator',
    text: 'Seravyn of the Deep, Keeper of the Water Shard. The tides remember what the land forgets — and Seravyn\'s legacy would ripple through the depths long after the surface world moved on.',
    tone: 'oceanic melancholy, flowing rhythm',
    durationEst: 10,
  },
  {
    id: 'VO_Fate_Thaldris',
    category: 'bearer',
    narrator: 'narrator',
    text: 'Thaldris Ironbound, Keeper of the Shield Shard. The walls he built stood long after their builder fell — and the realm would argue for generations whether those walls were protection or prison.',
    tone: 'stoic weight, iron resolve',
    durationEst: 10,
  },
  {
    id: 'VO_Fate_Vyrel',
    category: 'bearer',
    narrator: 'narrator',
    text: 'Vyrel the Verdant, Keeper of the Nature Shard. Where Vyrel fell, a forest grew. Where Vyrel wept, rivers formed. The land itself mourned — or celebrated — depending on how the story was told.',
    tone: 'pastoral elegy, growth through loss',
    durationEst: 10,
  },
  {
    id: 'VO_Fate_Nihara',
    category: 'bearer',
    narrator: 'narrator',
    text: 'Nihara the Void, Keeper of the Shadow Shard. Some said Nihara never truly existed — only the absence of something that should have been. In the end, shadow returned to shadow, and the void closed its eyes.',
    tone: 'existential whisper, void imagery',
    durationEst: 10,
  },

  // ── Companion Reaction (4 lines — Lira's outcomes) ──────────────────────

  {
    id: 'VO_Lira_Loyal',
    category: 'companion',
    narrator: 'lira',
    text: 'You absolute fool. You beautiful, stubborn, impossible fool. You actually did it. I... I didn\'t think anyone could. I\'ll deny saying this later, but I\'m proud of you, Kael. Genuinely.',
    tone: 'sardonic warmth, tears hiding behind wit',
    durationEst: 11,
  },
  {
    id: 'VO_Lira_Mourns',
    category: 'companion',
    narrator: 'lira',
    text: 'I told you not to be a hero. I told you. But you never listened, did you? Always charging in, always... You could have let the world burn and lived. But that was never really an option for you, was it? Damn you, Kael. Damn you.',
    tone: 'grief breaking through composure, raw loss',
    durationEst: 13,
  },
  {
    id: 'VO_Lira_Betrayed',
    category: 'companion',
    narrator: 'lira',
    text: 'I watched you become something I couldn\'t follow. Every whisper you obeyed, every dark choice — I kept hoping you\'d turn back. But the person standing on that summit isn\'t the Kael I traveled with. That person is gone. And I need to be gone too.',
    tone: 'heartbroken determination, bitter farewell',
    durationEst: 13,
  },
  {
    id: 'VO_Lira_Serves',
    category: 'companion',
    narrator: 'lira',
    text: 'My king. I... I serve. That is what is required. That is all that is required. The Kael I knew would have hated this — but Kael is not here anymore, is he? Only the crown. Only the hunger. I serve.',
    tone: 'hollow obedience, suppressed horror',
    durationEst: 11,
  },

  // ── Realm Outcome Narration (5 lines — world state) ─────────────────────

  {
    id: 'VO_Realm_Peace',
    category: 'realm',
    narrator: 'narrator',
    text: 'In the years that followed, the corruption receded like a tide. Fields grew green where blight had festered. Children played in streets that once knew only shadow. The Shattered Crown became a story — and stories, in time, become hope.',
    tone: 'pastoral peace, healing montage',
    durationEst: 12,
  },
  {
    id: 'VO_Realm_Balance',
    category: 'realm',
    narrator: 'narrator',
    text: 'The realm stabilized — not healed, but held. A new order formed under the crown\'s measured gaze. Some called it wisdom. Others called it control. The truth, as always, lay somewhere in the uncomfortable middle.',
    tone: 'balanced authority, measured ambiguity',
    durationEst: 10,
  },
  {
    id: 'VO_Realm_Scattered',
    category: 'realm',
    narrator: 'narrator',
    text: 'The shards scattered like seeds on the wind, each one a promise and a threat. New powers would rise. New bearers would be chosen. The cycle was not broken — only reset. And somewhere, in a village no map had named, a child found a glowing stone.',
    tone: 'cyclical fate, ominous wonder',
    durationEst: 12,
  },
  {
    id: 'VO_Realm_Enslaved',
    category: 'realm',
    narrator: 'narrator',
    text: 'The crown\'s shadow stretched across every border, every mountain, every hidden valley. Resistance crumbled not with a battle but with a whisper — the same whisper that had consumed its king. The realm did not fall. It simply... forgot how to stand.',
    tone: 'creeping dread, slow suffocation',
    durationEst: 12,
  },
  {
    id: 'VO_Realm_Darkness',
    category: 'realm',
    narrator: 'narrator',
    text: 'Darkness. Absolute. Eternal. The sun still rose, but its light felt hollow, as if the sky itself had been corrupted. The Hollow King sat upon a throne of silence, and the realm existed only because he willed it. This was not an ending. This was an erasure.',
    tone: 'apocalyptic finality, void swallowing',
    durationEst: 13,
  },

  // ── Post-Credits Hooks (3 lines — sequel tease) ─────────────────────────

  {
    id: 'VO_Hook_NewHero',
    category: 'hook',
    narrator: 'narrator',
    text: 'Three years later, in a village called Thornmere, a blacksmith\'s apprentice cut her hand on a broken blade. The blood glowed. Somewhere far away, something ancient stirred in its sleep and smiled.',
    tone: 'mysterious, new beginning, subtle dread',
    durationEst: 10,
  },
  {
    id: 'VO_Hook_KaelWhisper',
    category: 'hook',
    narrator: 'kael',
    text: 'Can you hear me? I know you\'re there. I can feel you, at the edge of things, where the light doesn\'t quite reach. I made my choice. But choices have echoes. And echoes... echoes never truly stop.',
    tone: 'ethereal whisper from beyond, haunting',
    durationEst: 11,
  },
  {
    id: 'VO_Hook_CrownStirs',
    category: 'hook',
    narrator: 'crown',
    text: 'Did you think it was over? Did you think sealing me would silence me? I am older than your world, little hero. I have been sealed before. I have waited before. And I am very, very patient.',
    tone: 'ancient menace, chilling patience',
    durationEst: 10,
  },
];

// ── Audio manifest integration ───────────────────────────────────────────────

/**
 * Add all ending voice lines to audio-manifest.json as a new `voice_ending` category.
 * Each line gets narrator-specific TTS settings from NARRATORS.
 *
 * @returns {{ success: boolean, added: number, total: number, path: string }}
 */
export function addEndingVoiceEntries() {
  const game = getActiveGame();
  const manifestPath = join(process.cwd(), 'workspace', game.gameId, 'Assets', 'audio-manifest.json');

  if (!existsSync(manifestPath)) {
    return { success: false, error: `Manifest not found: ${manifestPath}` };
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  // Check if category already exists
  if (manifest.voice_ending) {
    const existing = manifest.voice_ending.assets?.length || 0;
    return { success: true, added: 0, total: existing, note: 'voice_ending category already exists' };
  }

  // Build asset entries with narrator-specific TTS settings
  const assets = ENDING_VOICE_LINES.map(line => {
    const narrator = NARRATORS[line.narrator] || NARRATORS.narrator;
    return {
      id: line.id,
      type: 'voice',
      method: 'tts',
      status: 'pending',
      text: line.text,
      narratorId: line.narrator,
      category: line.category,
      path: line.path || null,
      tone: line.tone,
      durationEstimate: line.durationEst,
      ttsSettings: {
        stability: narrator.tts.stability,
        similarity_boost: narrator.tts.similarity,
        style: narrator.tts.style,
        speed: narrator.tts.speed,
      },
      voiceHint: narrator.voiceHint,
      outputFile: `ending/${line.id}.mp3`,
    };
  });

  // Add the category
  manifest.voice_ending = {
    description: 'Ending narration — 30 voice lines across 5 paths, 4 narrators (Narrator, Kael, Crown, Lira)',
    outputSubdir: 'Voice/Ending',
    method: 'tts',
    assets,
  };

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  log.info(`Added voice_ending category with ${assets.length} entries to audio manifest`);

  return {
    success: true,
    added: assets.length,
    total: assets.length,
    path: manifestPath,
    breakdown: {
      opening: assets.filter(a => a.category === 'opening').length,
      judgment: assets.filter(a => a.category === 'judgment').length,
      epilogue: assets.filter(a => a.category === 'epilogue').length,
      bearer: assets.filter(a => a.category === 'bearer').length,
      companion: assets.filter(a => a.category === 'companion').length,
      realm: assets.filter(a => a.category === 'realm').length,
      hook: assets.filter(a => a.category === 'hook').length,
    },
    narrators: {
      narrator: assets.filter(a => a.narratorId === 'narrator').length,
      kael: assets.filter(a => a.narratorId === 'kael').length,
      crown: assets.filter(a => a.narratorId === 'crown').length,
      lira: assets.filter(a => a.narratorId === 'lira').length,
    },
  };
}

// ── Cue-to-component mapping ─────────────────────────────────────────────────

/**
 * Maps ending component IDs (from willpower-tracker.js) to their voice cue IDs.
 * Used by BP_EndingSynthesis to look up which audio to play for each component.
 */
export const COMPONENT_VOICE_MAP = {
  // Crown resolution
  crown_purified:     { cue: 'VO_Epilogue_Redeemer',  alt: 'VO_Opening_Redeemer' },
  crown_merged:       { cue: 'VO_Epilogue_Merge',     alt: 'VO_Opening_Arbiter' },
  crown_shattered:    { cue: 'VO_Realm_Scattered',    alt: 'VO_Hook_NewHero' },
  crown_claimed:      { cue: 'VO_Epilogue_Claim',     alt: 'VO_Opening_Hollow' },
  crown_sealed:       { cue: 'VO_Epilogue_Sacrifice', alt: 'VO_Opening_Martyr' },

  // Kael's fate
  kael_hero:          { cue: 'VO_Epilogue_Redeemer' },
  kael_ruler:         { cue: 'VO_Epilogue_Merge' },
  kael_sacrifice:     { cue: 'VO_Epilogue_Sacrifice' },
  kael_puppet:        { cue: 'VO_Opening_Vessel' },
  kael_reborn_tyrant: { cue: 'VO_Epilogue_Claim' },

  // Companion
  lira_loyal:         { cue: 'VO_Lira_Loyal' },
  lira_betrayed:      { cue: 'VO_Lira_Betrayed' },
  lira_mourns:        { cue: 'VO_Lira_Mourns' },
  lira_serves:        { cue: 'VO_Lira_Serves' },

  // Realm
  realm_peace:        { cue: 'VO_Realm_Peace' },
  realm_balance:      { cue: 'VO_Realm_Balance' },
  realm_scattered:    { cue: 'VO_Realm_Scattered' },
  realm_enslaved:     { cue: 'VO_Realm_Enslaved' },
  realm_darkness:     { cue: 'VO_Realm_Darkness' },

  // Post-credits
  hook_new_hero:      { cue: 'VO_Hook_NewHero' },
  hook_kael_whisper:  { cue: 'VO_Hook_KaelWhisper' },
  hook_crown_stirs:   { cue: 'VO_Hook_CrownStirs' },
};

/**
 * Get the voice cue ID for a given ending component.
 * @param {string} componentId — from ENDING_COMPONENTS in willpower-tracker.js
 * @returns {{ cue: string, alt?: string } | null}
 */
export function getVoiceCueForComponent(componentId) {
  return COMPONENT_VOICE_MAP[componentId] || null;
}

// ── Status report ────────────────────────────────────────────────────────────

export function getEndingVoiceStatus() {
  const game = getActiveGame();
  const manifestPath = join(process.cwd(), 'workspace', game.gameId, 'Assets', 'audio-manifest.json');

  let manifestStatus = 'not checked';
  let generated = 0;
  let pending = 0;
  let total = 0;

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.voice_ending?.assets) {
      total = manifest.voice_ending.assets.length;
      generated = manifest.voice_ending.assets.filter(a => a.status === 'done' || a.status === 'complete').length;
      pending = manifest.voice_ending.assets.filter(a => a.status === 'pending').length;
      manifestStatus = 'present';
    } else {
      manifestStatus = 'category missing';
    }
  } catch {
    manifestStatus = 'file not found';
  }

  return {
    success: true,
    voiceLines: ENDING_VOICE_LINES.length,
    categories: {
      opening: ENDING_VOICE_LINES.filter(l => l.category === 'opening').length,
      judgment: ENDING_VOICE_LINES.filter(l => l.category === 'judgment').length,
      epilogue: ENDING_VOICE_LINES.filter(l => l.category === 'epilogue').length,
      bearer: ENDING_VOICE_LINES.filter(l => l.category === 'bearer').length,
      companion: ENDING_VOICE_LINES.filter(l => l.category === 'companion').length,
      realm: ENDING_VOICE_LINES.filter(l => l.category === 'realm').length,
      hook: ENDING_VOICE_LINES.filter(l => l.category === 'hook').length,
    },
    narrators: Object.keys(NARRATORS).length,
    componentMappings: Object.keys(COMPONENT_VOICE_MAP).length,
    manifest: { status: manifestStatus, total, generated, pending },
  };
}
