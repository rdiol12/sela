/**
 * lib/code-index.js — Lightweight codebase index for autocoder context injection.
 *
 * Scans lib/ and modules/ for exports, imports, and key identifiers.
 * Caches results in memory (rebuilds on demand, ~100ms for full scan).
 * Used by buildMilestoneBrief() to inject relevant file paths + exports
 * so the coding agent doesn't waste tokens blindly exploring.
 *
 * Part of Context+ Integration goal (61dd7753), ms_1.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, relative, extname } from 'path';
import { createLogger } from './logger.js';
import config from './config.js';

const log = createLogger('code-index');
const ROOT = config.projectRoot;

// ── In-memory cache ──────────────────────────────────────────────────────────

let _index = null;       // { files: Map<relPath, FileEntry> }
let _indexBuiltAt = 0;
const INDEX_TTL = 5 * 60 * 1000; // rebuild after 5 min

/**
 * @typedef {Object} FileEntry
 * @property {string}   relPath     - relative path from project root
 * @property {string[]} exports     - exported function/class/const names
 * @property {string[]} imports     - imported module paths
 * @property {string[]} keywords    - lowercase keywords from exports + file name
 * @property {number}   lineCount   - approximate line count
 * @property {number}   sizeBytes   - file size
 */

// ── Scanner ──────────────────────────────────────────────────────────────────

/**
 * Recursively collect all .js files under a directory.
 */
function collectJsFiles(dir, result = []) {
  if (!existsSync(dir)) return result;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules, .git, workspace, data, logs, test
        if (['node_modules', '.git', 'workspace', 'data', 'logs', 'test', 'scripts'].includes(entry.name)) continue;
        collectJsFiles(full, result);
      } else if (entry.isFile() && extname(entry.name) === '.js') {
        result.push(full);
      }
    }
  } catch (err) {
    log.warn({ dir, err: err.message }, 'collectJsFiles: scan error');
  }
  return result;
}

/**
 * Extract exports and imports from a JS file using regex.
 * Not a full AST parse but catches 95%+ of patterns in this codebase.
 */
function parseFileExports(content) {
  const exports = [];
  const imports = [];

  // export function foo() / export async function foo()
  for (const m of content.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) {
    exports.push(m[1]);
  }
  // export class Foo
  for (const m of content.matchAll(/export\s+class\s+(\w+)/g)) {
    exports.push(m[1]);
  }
  // export const/let/var foo
  for (const m of content.matchAll(/export\s+(?:const|let|var)\s+(\w+)/g)) {
    exports.push(m[1]);
  }
  // export { foo, bar }
  for (const m of content.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const name of m[1].split(',')) {
      const clean = name.trim().split(/\s+as\s+/).pop().trim();
      if (clean && /^\w+$/.test(clean)) exports.push(clean);
    }
  }
  // export default function foo / export default class Foo
  for (const m of content.matchAll(/export\s+default\s+(?:function|class)\s+(\w+)/g)) {
    exports.push(m[1]);
  }
  // module.exports = { foo, bar }
  for (const m of content.matchAll(/module\.exports\s*=\s*\{([^}]+)\}/g)) {
    for (const name of m[1].split(',')) {
      const clean = name.trim().split(':')[0].trim();
      if (clean && /^\w+$/.test(clean)) exports.push(clean);
    }
  }

  // import ... from '...'
  for (const m of content.matchAll(/import\s+.*?from\s+['"]([^'"]+)['"]/g)) {
    imports.push(m[1]);
  }
  // require('...')
  for (const m of content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    imports.push(m[1]);
  }

  return { exports: [...new Set(exports)], imports: [...new Set(imports)] };
}

/**
 * Build or refresh the in-memory code index.
 */
export function buildIndex(force = false) {
  if (_index && !force && (Date.now() - _indexBuiltAt < INDEX_TTL)) {
    return _index;
  }

  const startMs = Date.now();
  const files = new Map();

  const jsFiles = [
    ...collectJsFiles(join(ROOT, 'lib')),
    ...collectJsFiles(join(ROOT, 'modules')),
  ];

  for (const absPath of jsFiles) {
    try {
      const stat = statSync(absPath);
      const content = readFileSync(absPath, 'utf-8');
      const relPath = relative(ROOT, absPath).replace(/\\/g, '/');
      const { exports: exps, imports: imps } = parseFileExports(content);

      // Keywords: file name parts + export names, all lowercase
      const nameParts = relPath.replace(/\.js$/, '').split(/[/\-_.]/).filter(Boolean);
      const keywords = [...new Set([
        ...nameParts.map(p => p.toLowerCase()),
        ...exps.map(e => e.toLowerCase()),
      ])];

      files.set(relPath, {
        relPath,
        exports: exps,
        imports: imps,
        keywords,
        lineCount: content.split('\n').length,
        sizeBytes: stat.size,
      });
    } catch (err) {
      // Skip unreadable files
    }
  }

  _index = { files };
  _indexBuiltAt = Date.now();

  const elapsed = Date.now() - startMs;
  log.info({ fileCount: files.size, elapsedMs: elapsed }, 'Code index built');
  return _index;
}

// ── Search / Relevance ───────────────────────────────────────────────────────

/**
 * Find files relevant to a milestone title + goal description.
 * Uses keyword overlap scoring.
 *
 * @param {string} milestoneTitle
 * @param {string} goalDescription
 * @param {number} maxResults - max files to return (default 8)
 * @returns {FileEntry[]}
 */
export function findRelevantFiles(milestoneTitle, goalDescription = '', maxResults = 8) {
  const index = buildIndex();

  // Tokenize the query into lowercase keywords
  const queryText = `${milestoneTitle} ${goalDescription}`.toLowerCase();
  const queryTokens = queryText
    .replace(/[^a-z0-9_-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2); // skip tiny words

  if (!queryTokens.length) return [];

  const scored = [];
  for (const [, entry] of index.files) {
    let score = 0;
    for (const token of queryTokens) {
      for (const kw of entry.keywords) {
        if (kw === token) {
          score += 3; // exact match
        } else if (kw.includes(token) || token.includes(kw)) {
          score += 1; // partial match
        }
      }
    }
    if (score > 0) {
      scored.push({ ...entry, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults);
}

/**
 * Build a compact context block for injection into an autocoder prompt.
 * Shows relevant files with their exports — lets the agent know what exists
 * without reading entire files.
 *
 * @param {string} milestoneTitle
 * @param {string} goalDescription
 * @returns {string}
 */
export function buildContextBlock(milestoneTitle, goalDescription = '') {
  const relevant = findRelevantFiles(milestoneTitle, goalDescription, 8);
  if (!relevant.length) return '';

  const lines = [
    '## Relevant codebase files (from code-index):',
    'These files are likely related to your task. Check them before writing new code.',
    '',
  ];

  for (const f of relevant) {
    const exportsStr = f.exports.length > 0
      ? f.exports.slice(0, 10).join(', ') + (f.exports.length > 10 ? ` (+${f.exports.length - 10} more)` : '')
      : '(no named exports)';
    lines.push(`- **${f.relPath}** (${f.lineCount} lines) — exports: ${exportsStr}`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Get index stats for debugging.
 */
export function getIndexStats() {
  const index = buildIndex();
  const totalExports = [...index.files.values()].reduce((s, f) => s + f.exports.length, 0);
  const totalLines = [...index.files.values()].reduce((s, f) => s + f.lineCount, 0);
  return {
    fileCount: index.files.size,
    totalExports,
    totalLines,
    indexAge: Date.now() - _indexBuiltAt,
    ttl: INDEX_TTL,
  };
}
