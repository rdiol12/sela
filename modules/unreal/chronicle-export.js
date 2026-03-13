/**
 * modules/unreal/chronicle-export.js — Text File Export System for The Unwritten Chronicle
 *
 * ms_6: "Implement text file export functionality"
 * for The Unwritten Chronicle goal (5ea240ff).
 *
 * Extends the base exportChronicleText() with:
 *   - Markdown format export (with proper headers, blockquotes, emphasis)
 *   - Counter-chronicle formatted text export (Veyra's perspective)
 *   - Dual chronicle export (Kael + Veyra side-by-side comparison)
 *   - Chapter-specific export (single chapter as standalone document)
 *   - Table of contents generation
 *   - Custom output path support
 *   - Export manifest tracking (history of all exports)
 *
 * Integrates with:
 *   - chronicle.js (all chronicle data, entries, state)
 *   - index.js (tool registration)
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { createLogger } from '../../lib/logger.js';
import { getActiveGame } from './game-config.js';
import {
  loadChronicle,
  getChronicleEntries,
  getChronicleByChapter,
  getChronicleReliability,
  getNarratorTier,
  NARRATOR_CORRUPTION_TIERS,
  CHRONICLE_CHAPTERS,
  ENTRY_CATEGORIES,
  exportChronicleText,
  getChronicleComparison,
} from './chronicle.js';

const log = createLogger('chronicle-export');

// ── Export Directory ─────────────────────────────────────────────────────────

function getExportDir() {
  const game = getActiveGame?.();
  return join(process.cwd(), 'workspace', game?.id || 'shattered-crown', 'Data', 'exports');
}

function ensureDir(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── Export Manifest (tracks all exports) ─────────────────────────────────────

const MANIFEST_FILE = 'chronicle-export-manifest.json';

function getManifestPath() {
  return join(getExportDir(), MANIFEST_FILE);
}

function loadManifest() {
  const p = getManifestPath();
  try {
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf-8'));
  } catch { /* ignore */ }
  return { exports: [], createdAt: Date.now() };
}

function recordExport(entry) {
  const manifest = loadManifest();
  manifest.exports.push({
    ...entry,
    exportedAt: Date.now(),
  });
  // Keep last 100 exports
  if (manifest.exports.length > 100) manifest.exports = manifest.exports.slice(-100);
  const p = getManifestPath();
  ensureDir(p);
  writeFileSync(p, JSON.stringify(manifest, null, 2));
  return manifest;
}

// ── Table of Contents Builder ────────────────────────────────────────────────

function buildTOC(byChapter, format = 'text') {
  const lines = [];
  const chapterOrder = Object.keys(CHRONICLE_CHAPTERS);
  let chapterNum = 0;

  for (const chKey of chapterOrder) {
    const entries = byChapter[chKey];
    if (!entries || entries.length === 0) continue;
    chapterNum++;
    const ch = CHRONICLE_CHAPTERS[chKey];

    if (format === 'markdown') {
      lines.push(`${chapterNum}. **${ch.title}** — _${entries.length} entries_`);
    } else {
      lines.push(`  ${String(chapterNum).padStart(2, ' ')}. ${ch.title}${' '.repeat(Math.max(1, 40 - ch.title.length))}(${entries.length} entries)`);
    }
  }

  if (byChapter['uncategorized']?.length > 0) {
    chapterNum++;
    if (format === 'markdown') {
      lines.push(`${chapterNum}. **Miscellaneous Observations** — _${byChapter['uncategorized'].length} entries_`);
    } else {
      lines.push(`  ${String(chapterNum).padStart(2, ' ')}. Miscellaneous Observations${' '.repeat(14)}(${byChapter['uncategorized'].length} entries)`);
    }
  }

  return lines;
}

// ── Word Count Utility ───────────────────────────────────────────────────────

function countWords(text) {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

// ── Shared Entry Gathering ───────────────────────────────────────────────────

function gatherEntries(options = {}) {
  loadChronicle();
  const minImportance = options.minImportance || 1;
  const chapter = options.chapter || null;

  let entries = getChronicleEntries({ minImportance });
  if (chapter) {
    entries = entries.filter(e => e.chapterTag === chapter);
  }

  const byChapter = {};
  for (const entry of entries) {
    const ch = entry.chapterTag || 'uncategorized';
    if (!byChapter[ch]) byChapter[ch] = [];
    byChapter[ch].push(entry);
  }

  // Sort within chapters
  for (const ch of Object.values(byChapter)) {
    ch.sort((a, b) => a.timestamp - b.timestamp);
  }

  return { entries, byChapter };
}

// ── Get Narrator Header Lines ────────────────────────────────────────────────

function getNarratorAttribution(tier) {
  if (tier.voice === 'megalomaniac') {
    return 'Transcribed by the Most Glorious and Eternal Chronicler\n(whose wisdom exceeds all mortal comprehension)';
  } else if (tier.voice === 'grandiose') {
    return 'Transcribed by the Royal Chronicler of the Crown';
  } else if (tier.voice === 'dramatic') {
    return 'Transcribed by an Unknown Chronicler of the Realm';
  }
  return 'Transcribed faithfully by the Keeper of Records';
}

function getEditorNote(reliability) {
  if (reliability < 0.3) {
    return "[Editor's Note: This chronicle should be regarded with extreme suspicion. The narrator shows clear signs of corruption-induced delusion.]";
  } else if (reliability < 0.6) {
    return "[Editor's Note: Portions of this chronicle may contain embellishments. The narrator's objectivity appears compromised in places.]";
  }
  return null;
}

// ── 1. Enhanced Text Export (with TOC and word count) ────────────────────────

/**
 * Enhanced text export with table of contents, word count, and optional chapter filter.
 * @param {object} options - { minImportance, includeMetadata, chapter, outputPath }
 */
export function exportEnhancedText(options = {}) {
  const { entries, byChapter } = gatherEntries(options);
  const includeMetadata = options.includeMetadata ?? false;
  const reliability = getChronicleReliability();
  const tier = getNarratorTier(0); // Use overall tier from state
  loadChronicle();

  const lines = [];

  // Title page
  lines.push('='.repeat(72));
  lines.push('');
  lines.push('           T H E   U N W R I T T E N   C H R O N I C L E');
  lines.push('');
  lines.push('    A Record of the Bearer\'s Journey Through the Shattered Realm');
  lines.push('');
  lines.push(`         ${getNarratorAttribution(tier)}`);
  lines.push('');
  lines.push('='.repeat(72));
  lines.push('');

  if (includeMetadata) {
    lines.push(`[Reliability Index: ${(reliability * 100).toFixed(1)}%]`);
    lines.push(`[Narrator State: ${tier.label} (${tier.voice})]`);
    lines.push(`[Total Entries: ${entries.length}]`);
    lines.push('');
  }

  // Table of Contents
  lines.push('-'.repeat(72));
  lines.push('  TABLE OF CONTENTS');
  lines.push('-'.repeat(72));
  lines.push('');
  lines.push(...buildTOC(byChapter, 'text'));
  lines.push('');

  // Chapters
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

    for (const entry of chEntries) {
      if (includeMetadata) {
        lines.push(`  [${entry.narratorTier}/${entry.narratorVoice} | reliability: ${((entry.reliability ?? 1) * 100).toFixed(0)}%${entry.isDistorted ? ' | DISTORTED' : ''}]`);
      }
      lines.push(`  ${entry.narrativeText}`);
      lines.push('');
    }
  }

  // Uncategorized
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
  lines.push('='.repeat(72));
  const edNote = getEditorNote(reliability);
  if (edNote) {
    lines.push(`  ${edNote}`);
  }
  lines.push('');

  const text = lines.join('\n');
  const wordCount = countWords(text);

  lines.push(`                    [${wordCount.toLocaleString()} words]`);
  lines.push('');
  lines.push('                         --- End of Chronicle ---');
  lines.push('');

  const finalText = lines.join('\n');

  // Write to file
  const outputPath = options.outputPath || join(getExportDir(), 'chronicle-full.txt');
  ensureDir(outputPath);
  writeFileSync(outputPath, finalText, 'utf-8');

  const result = {
    format: 'text',
    path: outputPath,
    chapters: Object.keys(byChapter).length,
    entries: entries.length,
    wordCount,
    reliability: parseFloat(reliability.toFixed(3)),
    narratorState: tier.label,
  };

  recordExport({ type: 'text_enhanced', ...result });
  log.info(`Enhanced text export: ${outputPath} (${entries.length} entries, ${wordCount} words)`);
  return result;
}

// ── 2. Markdown Export ───────────────────────────────────────────────────────

/**
 * Export chronicle as Markdown — suitable for web display, GitHub, or static site.
 * @param {object} options - { minImportance, includeMetadata, chapter, outputPath }
 */
export function exportChronicleMarkdown(options = {}) {
  const { entries, byChapter } = gatherEntries(options);
  const includeMetadata = options.includeMetadata ?? false;
  const reliability = getChronicleReliability();
  const tier = getNarratorTier(0);
  loadChronicle();

  const lines = [];

  // Title
  lines.push('# The Unwritten Chronicle');
  lines.push('');
  lines.push('_A Record of the Bearer\'s Journey Through the Shattered Realm_');
  lines.push('');
  lines.push(`> ${getNarratorAttribution(tier)}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  if (includeMetadata) {
    lines.push('| Property | Value |');
    lines.push('|----------|-------|');
    lines.push(`| Reliability | ${(reliability * 100).toFixed(1)}% |`);
    lines.push(`| Narrator | ${tier.label} (${tier.voice}) |`);
    lines.push(`| Entries | ${entries.length} |`);
    lines.push('');
  }

  // Table of Contents
  lines.push('## Table of Contents');
  lines.push('');
  lines.push(...buildTOC(byChapter, 'markdown'));
  lines.push('');
  lines.push('---');
  lines.push('');

  // Chapters
  const chapterOrder = Object.keys(CHRONICLE_CHAPTERS);
  for (const chKey of chapterOrder) {
    const chEntries = byChapter[chKey];
    if (!chEntries || chEntries.length === 0) continue;
    const chDef = CHRONICLE_CHAPTERS[chKey];

    lines.push(`## ${chDef.title}`);
    lines.push('');
    lines.push(`_${chDef.description}_`);
    lines.push('');

    for (const entry of chEntries) {
      if (includeMetadata) {
        const distortedTag = entry.isDistorted ? ' `DISTORTED`' : '';
        lines.push(`> **[${entry.narratorTier}/${entry.narratorVoice}]** reliability: ${((entry.reliability ?? 1) * 100).toFixed(0)}%${distortedTag}`);
      }
      lines.push(`${entry.narrativeText}`);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  // Uncategorized
  if (byChapter['uncategorized']?.length > 0) {
    lines.push('## Miscellaneous Observations');
    lines.push('');
    for (const entry of byChapter['uncategorized']) {
      lines.push(`${entry.narrativeText}`);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  // Epilogue
  const edNote = getEditorNote(reliability);
  if (edNote) {
    lines.push(`> ${edNote}`);
    lines.push('');
  }

  lines.push('*--- End of Chronicle ---*');
  lines.push('');

  const finalText = lines.join('\n');
  const wordCount = countWords(finalText);

  const outputPath = options.outputPath || join(getExportDir(), 'chronicle-full.md');
  ensureDir(outputPath);
  writeFileSync(outputPath, finalText, 'utf-8');

  const result = {
    format: 'markdown',
    path: outputPath,
    chapters: Object.keys(byChapter).length,
    entries: entries.length,
    wordCount,
    reliability: parseFloat(reliability.toFixed(3)),
    narratorState: tier.label,
  };

  recordExport({ type: 'markdown', ...result });
  log.info(`Markdown export: ${outputPath} (${entries.length} entries, ${wordCount} words)`);
  return result;
}

// ── 3. Counter-Chronicle Text Export (Veyra's Perspective) ───────────────────

/**
 * Export Veyra's counter-chronicle as formatted text — the rival's version of events.
 * @param {object} options - { includeMetadata, outputPath }
 */
export function exportCounterChronicleText(options = {}) {
  loadChronicle();
  const includeMetadata = options.includeMetadata ?? false;

  // Get comparison data which includes counter-entries
  let comparison;
  try {
    comparison = getChronicleComparison({ limit: 500 });
  } catch {
    comparison = { pairs: [], counterOnly: [], kael: { entryCount: 0 }, veyra: { entryCount: 0 } };
  }

  const counterEntries = [];
  // Collect all Veyra entries from pairs and standalone
  if (comparison.pairs) {
    for (const pair of comparison.pairs) {
      if (pair.veyra) counterEntries.push(pair.veyra);
    }
  }
  if (comparison.counterOnly) {
    for (const entry of comparison.counterOnly) {
      counterEntries.push(entry);
    }
  }

  // Sort chronologically
  counterEntries.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  const lines = [];

  // Title page
  lines.push('='.repeat(72));
  lines.push('');
  lines.push('        T H E   A S H E N   S E E K E R \' S   R E C O R D');
  lines.push('');
  lines.push('    The True Account of Events, as Witnessed by Veyra');
  lines.push('    Crown-Seeker, Rival to the Bearer');
  lines.push('');
  lines.push('         "History is written by the victor.');
  lines.push('          I intend to be the one holding the pen."');
  lines.push('');
  lines.push('='.repeat(72));
  lines.push('');

  if (includeMetadata) {
    lines.push(`[Counter-Entries: ${counterEntries.length}]`);
    lines.push(`[Paired with Kael Entries: ${comparison.pairs?.length || 0}]`);
    lines.push(`[Contradictions Detected: ${comparison.pairs?.filter(p => p.contradictions?.length > 0).length || 0}]`);
    lines.push('');
  }

  if (counterEntries.length === 0) {
    lines.push('  [The pages are blank — Veyra has not yet begun her record.]');
    lines.push('');
  } else {
    // Group by category for structure
    const byCategory = {};
    for (const entry of counterEntries) {
      const cat = entry.category || entry.templateId?.split('_')[1] || 'general';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(entry);
    }

    for (const [cat, catEntries] of Object.entries(byCategory)) {
      lines.push('-'.repeat(72));
      lines.push(`  ${cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, ' ')}`);
      lines.push('-'.repeat(72));
      lines.push('');

      for (const entry of catEntries) {
        if (includeMetadata && entry.voiceProfile) {
          lines.push(`  [Voice: ${entry.voiceProfile}]`);
        }
        lines.push(`  ${entry.narrativeText || entry.text || '(entry text unavailable)'}`);
        lines.push('');
      }
    }
  }

  // Epilogue
  lines.push('='.repeat(72));
  lines.push('  [The Ashen Seeker\'s record continues to grow,');
  lines.push('   each page a challenge to the Bearer\'s version of truth.]');
  lines.push('');
  lines.push('                    --- End of the Ashen Seeker\'s Record ---');
  lines.push('');

  const finalText = lines.join('\n');
  const wordCount = countWords(finalText);

  const outputPath = options.outputPath || join(getExportDir(), 'counter-chronicle.txt');
  ensureDir(outputPath);
  writeFileSync(outputPath, finalText, 'utf-8');

  const result = {
    format: 'text',
    path: outputPath,
    entries: counterEntries.length,
    wordCount,
    contradictions: comparison.pairs?.filter(p => p.contradictions?.length > 0).length || 0,
  };

  recordExport({ type: 'counter_chronicle_text', ...result });
  log.info(`Counter-chronicle text export: ${outputPath} (${counterEntries.length} entries, ${wordCount} words)`);
  return result;
}

// ── 4. Dual Chronicle Export (Side-by-Side) ──────────────────────────────────

/**
 * Export both chronicles side-by-side — shows how Kael and Veyra describe the same events.
 * Highlights contradictions between accounts.
 * @param {object} options - { includeMetadata, outputPath }
 */
export function exportDualChronicle(options = {}) {
  loadChronicle();
  const includeMetadata = options.includeMetadata ?? false;

  let comparison;
  try {
    comparison = getChronicleComparison({ limit: 500 });
  } catch {
    comparison = { pairs: [], kaelOnly: [], counterOnly: [], kael: { entryCount: 0 }, veyra: { entryCount: 0 } };
  }

  const lines = [];

  // Title
  lines.push('='.repeat(72));
  lines.push('');
  lines.push('           T W O   V E R S I O N S   O F   T R U T H');
  lines.push('');
  lines.push('    The Unwritten Chronicle vs The Ashen Seeker\'s Record');
  lines.push('    A Comparative Study of Competing Histories');
  lines.push('');
  lines.push('='.repeat(72));
  lines.push('');

  if (includeMetadata) {
    lines.push(`[Kael's Entries: ${comparison.kael?.entryCount || 0}]`);
    lines.push(`[Veyra's Entries: ${comparison.veyra?.entryCount || 0}]`);
    lines.push(`[Paired Events: ${comparison.pairs?.length || 0}]`);
    lines.push(`[Contradictions: ${comparison.pairs?.filter(p => p.contradictions?.length > 0).length || 0}]`);
    lines.push('');
  }

  // Paired entries
  if (comparison.pairs?.length > 0) {
    lines.push('-'.repeat(72));
    lines.push('  CONTESTED EVENTS — Where Their Accounts Diverge');
    lines.push('-'.repeat(72));
    lines.push('');

    for (const pair of comparison.pairs) {
      lines.push('  +----- The Bearer\'s Account -----+');
      lines.push(`  | ${pair.kael?.narrativeText || '(no entry)'}`.replace(/\n/g, '\n  | '));
      lines.push('  +--------------------------------+');
      lines.push('');
      lines.push('  +----- The Ashen Seeker\'s Account -----+');
      lines.push(`  | ${pair.veyra?.narrativeText || pair.veyra?.text || '(no entry)'}`.replace(/\n/g, '\n  | '));
      lines.push('  +--------------------------------------+');

      if (pair.contradictions?.length > 0) {
        lines.push('');
        lines.push(`  >>> CONTRADICTION: ${pair.contradictions.map(c => c.type || c).join(', ')}`);
      }

      lines.push('');
      lines.push('  ~ ~ ~');
      lines.push('');
    }
  }

  // Kael-only entries
  if (comparison.kaelOnly?.length > 0) {
    lines.push('-'.repeat(72));
    lines.push('  BEARER\'S EXCLUSIVE ACCOUNTS — Uncontested by the Seeker');
    lines.push('-'.repeat(72));
    lines.push('');
    for (const entry of comparison.kaelOnly.slice(0, 50)) {
      lines.push(`  ${entry.narrativeText || '(entry)'}`);
      lines.push('');
    }
  }

  // Veyra-only entries
  if (comparison.counterOnly?.length > 0) {
    lines.push('-'.repeat(72));
    lines.push('  SEEKER\'S EXCLUSIVE ACCOUNTS — Unseen by the Bearer');
    lines.push('-'.repeat(72));
    lines.push('');
    for (const entry of comparison.counterOnly.slice(0, 50)) {
      lines.push(`  ${entry.narrativeText || entry.text || '(entry)'}`);
      lines.push('');
    }
  }

  lines.push('='.repeat(72));
  lines.push('  "Truth, like a shard, refracts differently depending on who holds it."');
  lines.push('');
  lines.push('                    --- End of Comparative Record ---');
  lines.push('');

  const finalText = lines.join('\n');
  const wordCount = countWords(finalText);

  const outputPath = options.outputPath || join(getExportDir(), 'dual-chronicle.txt');
  ensureDir(outputPath);
  writeFileSync(outputPath, finalText, 'utf-8');

  const result = {
    format: 'dual_text',
    path: outputPath,
    pairedEvents: comparison.pairs?.length || 0,
    contradictions: comparison.pairs?.filter(p => p.contradictions?.length > 0).length || 0,
    kaelEntries: comparison.kael?.entryCount || 0,
    veyraEntries: comparison.veyra?.entryCount || 0,
    wordCount,
  };

  recordExport({ type: 'dual_chronicle', ...result });
  log.info(`Dual chronicle export: ${outputPath} (${result.pairedEvents} pairs, ${wordCount} words)`);
  return result;
}

// ── 5. Chapter-Specific Export ───────────────────────────────────────────────

/**
 * Export a single chapter as a standalone text document.
 * @param {string} chapterKey - Key from CHRONICLE_CHAPTERS (e.g. 'journey', 'encounters')
 * @param {object} options - { format: 'text'|'markdown', includeMetadata, outputPath }
 */
export function exportChapter(chapterKey, options = {}) {
  const format = options.format || 'text';
  const chDef = CHRONICLE_CHAPTERS[chapterKey];
  if (!chDef) {
    return { error: `Unknown chapter: ${chapterKey}. Available: ${Object.keys(CHRONICLE_CHAPTERS).join(', ')}` };
  }

  const gathered = gatherEntries({ ...options, chapter: chapterKey });
  const chEntries = gathered.entries;

  if (chEntries.length === 0) {
    return { error: `Chapter "${chDef.title}" has no entries yet.`, chapter: chapterKey };
  }

  const includeMetadata = options.includeMetadata ?? false;
  const lines = [];

  if (format === 'markdown') {
    lines.push(`# ${chDef.title}`);
    lines.push('');
    lines.push(`_${chDef.description}_`);
    lines.push('');
    lines.push(`_From The Unwritten Chronicle — ${chEntries.length} entries_`);
    lines.push('');
    lines.push('---');
    lines.push('');

    for (const entry of chEntries) {
      if (includeMetadata) {
        lines.push(`> **[${entry.narratorTier}]** ${entry.narratorVoice} — reliability ${((entry.reliability ?? 1) * 100).toFixed(0)}%`);
      }
      lines.push(entry.narrativeText);
      lines.push('');
    }
  } else {
    lines.push('='.repeat(72));
    lines.push(`  ${chDef.title}`);
    lines.push(`  "${chDef.description}"`);
    lines.push('');
    lines.push(`  From The Unwritten Chronicle — ${chEntries.length} entries`);
    lines.push('='.repeat(72));
    lines.push('');

    for (const entry of chEntries) {
      if (includeMetadata) {
        lines.push(`  [${entry.narratorTier}/${entry.narratorVoice} | reliability: ${((entry.reliability ?? 1) * 100).toFixed(0)}%${entry.isDistorted ? ' | DISTORTED' : ''}]`);
      }
      lines.push(`  ${entry.narrativeText}`);
      lines.push('');
    }
  }

  const finalText = lines.join('\n');
  const wordCount = countWords(finalText);
  const ext = format === 'markdown' ? '.md' : '.txt';
  const outputPath = options.outputPath || join(getExportDir(), `chapter-${chapterKey}${ext}`);
  ensureDir(outputPath);
  writeFileSync(outputPath, finalText, 'utf-8');

  const result = {
    format,
    chapter: chapterKey,
    title: chDef.title,
    path: outputPath,
    entries: chEntries.length,
    wordCount,
  };

  recordExport({ type: `chapter_${format}`, ...result });
  log.info(`Chapter export: ${chDef.title} → ${outputPath} (${chEntries.length} entries)`);
  return result;
}

// ── 6. Batch Export (all formats at once) ────────────────────────────────────

/**
 * Export the chronicle in all formats at once — text, markdown, counter-chronicle, dual.
 * @param {object} options - { minImportance, includeMetadata }
 * @returns {object} Results for each format
 */
export function exportAll(options = {}) {
  const results = {};

  try { results.text = exportEnhancedText(options); } catch (e) {
    results.text = { error: e.message };
    log.warn(`Text export failed: ${e.message}`);
  }

  try { results.markdown = exportChronicleMarkdown(options); } catch (e) {
    results.markdown = { error: e.message };
    log.warn(`Markdown export failed: ${e.message}`);
  }

  try { results.counterChronicle = exportCounterChronicleText(options); } catch (e) {
    results.counterChronicle = { error: e.message };
    log.warn(`Counter-chronicle export failed: ${e.message}`);
  }

  try { results.dualChronicle = exportDualChronicle(options); } catch (e) {
    results.dualChronicle = { error: e.message };
    log.warn(`Dual chronicle export failed: ${e.message}`);
  }

  // Also trigger the base text export for backward compat
  try { results.baseExport = exportChronicleText(options); } catch (e) {
    results.baseExport = { error: e.message };
  }

  const totalWords = Object.values(results)
    .filter(r => r && typeof r.wordCount === 'number')
    .reduce((sum, r) => sum + r.wordCount, 0);

  const summary = {
    formatsExported: Object.keys(results).filter(k => !results[k].error).length,
    totalFormats: Object.keys(results).length,
    totalWords,
    exportDir: getExportDir(),
  };

  recordExport({ type: 'batch_all', ...summary });
  log.info(`Batch export complete: ${summary.formatsExported}/${summary.totalFormats} formats, ${totalWords} total words`);

  return { ...results, summary };
}

// ── 7. Export Status / Manifest Query ────────────────────────────────────────

/**
 * Get export system status: available formats, last exports, manifest summary.
 */
export function getExportStatus() {
  const manifest = loadManifest();
  const recentExports = manifest.exports.slice(-10);
  const availableChapters = Object.entries(CHRONICLE_CHAPTERS).map(([key, ch]) => ({
    key,
    title: ch.title,
  }));

  return {
    availableFormats: ['text', 'markdown', 'counter_chronicle', 'dual_chronicle', 'chapter', 'batch_all'],
    exportDir: getExportDir(),
    totalExports: manifest.exports.length,
    recentExports: recentExports.map(e => ({
      type: e.type,
      entries: e.entries,
      wordCount: e.wordCount,
      exportedAt: e.exportedAt,
      path: e.path,
    })),
    availableChapters,
    chapterCount: availableChapters.length,
  };
}

log.info('ms_6: Chronicle export system loaded — text, markdown, counter-chronicle, dual, chapter, batch export');
