/**
 * modules/maplestory/server-manager.js — Cosmic v83 server management.
 *
 * Handles: start/stop server, MySQL connection, DB queries, config editing,
 * NPC/quest/event script management, WZ XML editing, server status.
 */

import { execSync, spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, statSync } from 'fs';
import { join, basename } from 'path';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('maplestory');

// ── Paths ────────────────────────────────────────────────────────────────────
const COSMIC_DIR = join(process.cwd(), 'workspace', 'Cosmic');
const SCRIPTS_DIR = join(COSMIC_DIR, 'scripts');
const WZ_DIR = join(COSMIC_DIR, 'wz');
const CONFIG_PATH = join(COSMIC_DIR, 'config.yaml');
const MYSQL_BIN = 'C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin';
const MYSQL_DATA = join(COSMIC_DIR, 'mysql-data');
const JAVA_HOME = 'C:\\Program Files\\Amazon Corretto\\jdk21.0.10_7';

// ── MySQL Helper ─────────────────────────────────────────────────────────────

export function mysqlQuery(sql) {
  try {
    const result = execSync(
      `"${MYSQL_BIN}\\mysql.exe" -u root -D cosmic -e "${sql.replace(/"/g, '\\"')}"`,
      { encoding: 'utf-8', timeout: 15_000 }
    );
    return result.trim();
  } catch (err) {
    throw new Error(`MySQL query failed: ${err.message}`);
  }
}

export function isMysqlRunning() {
  try {
    execSync(`"${MYSQL_BIN}\\mysql.exe" -u root -e "SELECT 1"`, { encoding: 'utf-8', timeout: 5_000 });
    return true;
  } catch { return false; }
}

export function isServerRunning() {
  try {
    const out = execSync('netstat -an', { encoding: 'utf-8', timeout: 5_000 });
    return out.includes(':8484') && out.includes('LISTENING');
  } catch { return false; }
}

// ── Server Control ───────────────────────────────────────────────────────────

export function startMysql() {
  if (isMysqlRunning()) return { success: true, message: 'MySQL already running' };
  const proc = spawn(`${MYSQL_BIN}\\mysqld.exe`, [
    `--datadir=${MYSQL_DATA}`, '--port=3306', '--console'
  ], { detached: true, stdio: 'ignore' });
  proc.unref();
  // Wait a moment for startup
  execSync('ping -n 4 127.0.0.1 > NUL', { shell: true });
  const running = isMysqlRunning();
  log.info({ running }, 'MySQL start attempted');
  return { success: running, message: running ? 'MySQL started' : 'MySQL failed to start' };
}

export function startServer() {
  if (!isMysqlRunning()) {
    const mysql = startMysql();
    if (!mysql.success) return { success: false, message: 'Cannot start server: MySQL not running' };
  }
  if (isServerRunning()) return { success: true, message: 'Cosmic server already running' };

  const proc = spawn(`${JAVA_HOME}\\bin\\java.exe`, ['-jar', 'target\\Cosmic.jar'], {
    cwd: COSMIC_DIR,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, JAVA_HOME },
  });
  proc.unref();
  // Wait for startup
  execSync('ping -n 20 127.0.0.1 > NUL', { shell: true });
  const running = isServerRunning();
  log.info({ running }, 'Cosmic server start attempted');
  return { success: running, message: running ? 'Cosmic server started' : 'Server starting (may need more time)' };
}

export function getServerStatus() {
  const mysql = isMysqlRunning();
  const server = isServerRunning();
  let players = 0;
  let accounts = 0;
  let characters = 0;

  if (mysql) {
    try {
      const acctResult = mysqlQuery('SELECT COUNT(*) FROM accounts');
      accounts = parseInt(acctResult.split('\n').pop()) || 0;
      const charResult = mysqlQuery('SELECT COUNT(*) FROM characters');
      characters = parseInt(charResult.split('\n').pop()) || 0;
    } catch {}
  }

  return { mysql, server, accounts, characters };
}

// ── Server Stop ─────────────────────────────────────────────────────────────

function killCosmicProcess() {
  // Try by window title first
  try {
    execSync('taskkill /F /IM java.exe /FI "WINDOWTITLE eq Cosmic*"', { shell: true, encoding: 'utf-8', timeout: 10_000 });
    return true;
  } catch { /* fall through */ }
  // Try by port
  try {
    const netstat = execSync('netstat -ano | findstr :8484 | findstr LISTENING', { shell: true, encoding: 'utf-8', timeout: 5_000 });
    const pid = netstat.trim().split(/\s+/).pop();
    if (pid && /^\d+$/.test(pid)) {
      execSync(`taskkill /F /PID ${pid}`, { shell: true, encoding: 'utf-8', timeout: 5_000 });
      return true;
    }
  } catch { /* no process to kill */ }
  return false;
}

export function stopServer() {
  if (!isServerRunning()) return { success: true, message: 'Cosmic server is not running' };
  const killed = killCosmicProcess();
  execSync('ping -n 3 127.0.0.1 > NUL', { shell: true });
  const stillRunning = isServerRunning();
  log.info({ killed, stillRunning }, 'Cosmic server stop attempted');
  return { success: !stillRunning, message: stillRunning ? 'Failed to stop server' : 'Cosmic server stopped' };
}

export function stopMysql() {
  if (!isMysqlRunning()) return { success: true, message: 'MySQL is not running' };
  try {
    execSync(`"${MYSQL_BIN}\\mysqladmin.exe" -u root shutdown`, { encoding: 'utf-8', timeout: 15_000 });
  } catch {
    try { execSync('taskkill /F /IM mysqld.exe', { shell: true, encoding: 'utf-8', timeout: 5_000 }); } catch { /* */ }
  }
  execSync('ping -n 3 127.0.0.1 > NUL', { shell: true });
  const stillRunning = isMysqlRunning();
  return { success: !stillRunning, message: stillRunning ? 'Failed to stop MySQL' : 'MySQL stopped' };
}

// ── Server Restart ──────────────────────────────────────────────────────────

export function restartServer() {
  killCosmicProcess();
  execSync('ping -n 5 127.0.0.1 > NUL', { shell: true });

  const proc = spawn(`${JAVA_HOME}\\bin\\java.exe`, ['-jar', 'target\\Cosmic.jar'], {
    cwd: COSMIC_DIR,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, JAVA_HOME },
  });
  proc.unref();

  execSync('ping -n 20 127.0.0.1 > NUL', { shell: true });
  const running = isServerRunning();
  log.info({ running }, 'Cosmic server restart attempted');
  return { success: running, message: running ? 'Server restarted successfully' : 'Server restarting (may need more time)' };
}

// ── Log Tailing ─────────────────────────────────────────────────────────────

const LOG_DIR = join(COSMIC_DIR, 'logs');
const MAIN_LOG = join(COSMIC_DIR, 'logs', 'cosmic-log.log');

export function tailLog(logName = 'main', lines = 50) {
  const logPath = logName === 'main' ? MAIN_LOG : join(LOG_DIR, logName);
  if (!existsSync(logPath)) return { success: false, error: `Log not found: ${logName}` };
  try {
    const content = readFileSync(logPath, 'utf-8');
    const allLines = content.split('\n');
    const tail = allLines.slice(-lines).join('\n');
    return { success: true, logName, totalLines: allLines.length, lines: Math.min(lines, allLines.length), content: tail };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export function listLogs() {
  const logs = ['cosmic-log.log (main)'];
  try {
    if (existsSync(LOG_DIR)) {
      const files = readdirSync(LOG_DIR, { recursive: true }).filter(f => String(f).endsWith('.log'));
      logs.push(...files.map(f => String(f)));
    }
    // Root-level logs
    const rootLogs = readdirSync(COSMIC_DIR).filter(f => f.endsWith('.log') && f !== 'cosmic-log.log');
    logs.push(...rootLogs);
  } catch { /* */ }
  return logs;
}

// ── Online Players ──────────────────────────────────────────────────────────

export function getOnlinePlayers() {
  if (!isMysqlRunning()) return { success: false, error: 'MySQL not running' };
  try {
    const result = mysqlQuery(
      `SELECT c.name, c.level, c.job, c.map, a.loggedin FROM characters c JOIN accounts a ON c.accountid = a.id WHERE a.loggedin = 2`
    );
    if (!result || result.trim() === '') return { success: true, count: 0, players: [] };
    const lines = result.trim().split('\n').slice(1); // skip header
    const players = lines.map(line => {
      const [name, level, job, map, loggedin] = line.split('\t');
      return { name, level: +level, job: +job, map: +map };
    });
    return { success: true, count: players.length, players };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── NPC Management ───────────────────────────────────────────────────────────

export function listNpcScripts() {
  const dir = join(SCRIPTS_DIR, 'npc');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.js')).map(f => f.replace('.js', ''));
}

export function readNpcScript(npcId) {
  const path = join(SCRIPTS_DIR, 'npc', `${npcId}.js`);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

export function writeNpcScript(npcId, code) {
  const path = join(SCRIPTS_DIR, 'npc', `${npcId}.js`);
  writeFileSync(path, code, 'utf-8');
  log.info({ npcId, bytes: code.length }, 'NPC script written');
  return { success: true, path, npcId };
}

// ── Quest Management ─────────────────────────────────────────────────────────

export function listQuestScripts() {
  const dir = join(SCRIPTS_DIR, 'quest');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.js')).map(f => f.replace('.js', ''));
}

export function writeQuestScript(questId, code) {
  const path = join(SCRIPTS_DIR, 'quest', `${questId}.js`);
  writeFileSync(path, code, 'utf-8');
  log.info({ questId, bytes: code.length }, 'Quest script written');
  return { success: true, path, questId };
}

// ── Event Management ─────────────────────────────────────────────────────────

export function listEventScripts() {
  const dir = join(SCRIPTS_DIR, 'event');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.js')).map(f => f.replace('.js', ''));
}

export function writeEventScript(name, code) {
  const path = join(SCRIPTS_DIR, 'event', `${name}.js`);
  writeFileSync(path, code, 'utf-8');
  log.info({ name, bytes: code.length }, 'Event script written');
  return { success: true, path, name };
}

// ── WZ XML Editing ───────────────────────────────────────────────────────────

export function readWzFile(relativePath) {
  const path = join(WZ_DIR, relativePath);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

export function writeWzFile(relativePath, content) {
  const path = join(WZ_DIR, relativePath);
  writeFileSync(path, content, 'utf-8');
  log.info({ relativePath, bytes: content.length }, 'WZ file written');
  return { success: true, path };
}

/**
 * Add an NPC spawn to a map's life section.
 * @param {string} mapId - Map ID (e.g. "100000000" for Henesys)
 * @param {string} npcId - NPC ID to spawn
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 */
export function addNpcToMap(mapId, npcId, x, y) {
  // Determine map file path: Map{first digit}/{mapId}.img.xml
  const prefix = `Map${mapId.charAt(0)}`;
  const relativePath = `Map.wz/Map/${prefix}/${mapId}.img.xml`;
  const fullPath = join(WZ_DIR, relativePath);

  if (!existsSync(fullPath)) {
    throw new Error(`Map file not found: ${relativePath}`);
  }

  let xml = readFileSync(fullPath, 'utf-8');

  // Find the highest life entry index
  const lifeMatches = xml.match(/<imgdir name="life">([\s\S]*?)<\/imgdir>\s*(?=<imgdir|<\/imgdir>)/);
  if (!lifeMatches) {
    throw new Error('No <imgdir name="life"> section found in map');
  }

  const indexMatches = [...lifeMatches[1].matchAll(/<imgdir name="(\d+)">/g)];
  const maxIndex = indexMatches.length > 0 ? Math.max(...indexMatches.map(m => parseInt(m[1]))) : -1;
  const newIndex = maxIndex + 1;

  // Build the NPC life entry
  const npcEntry = `    <imgdir name="${newIndex}">
      <string name="type" value="n"/>
      <string name="id" value="${npcId}"/>
      <int name="x" value="${x}"/>
      <int name="y" value="${y}"/>
      <int name="fh" value="0"/>
      <int name="cy" value="${y}"/>
      <int name="rx0" value="${x - 50}"/>
      <int name="rx1" value="${x + 50}"/>
    </imgdir>
`;

  // Insert before the closing </imgdir> of the life section
  const lifeClose = xml.indexOf('</imgdir>', xml.indexOf('<imgdir name="life">') + 20);
  xml = xml.slice(0, lifeClose) + npcEntry + '  ' + xml.slice(lifeClose);

  writeFileSync(fullPath, xml, 'utf-8');
  log.info({ mapId, npcId, x, y, index: newIndex }, 'NPC added to map');

  return { success: true, mapId, npcId, x, y, lifeIndex: newIndex, note: 'Restart server to apply' };
}

/**
 * Add a mob spawn to a map's life section.
 */
export function addMobToMap(mapId, mobId, x, y, count = 1) {
  const prefix = `Map${mapId.charAt(0)}`;
  const relativePath = `Map.wz/Map/${prefix}/${mapId}.img.xml`;
  const fullPath = join(WZ_DIR, relativePath);

  if (!existsSync(fullPath)) {
    throw new Error(`Map file not found: ${relativePath}`);
  }

  let xml = readFileSync(fullPath, 'utf-8');

  const lifeMatches = xml.match(/<imgdir name="life">([\s\S]*?)<\/imgdir>\s*(?=<imgdir|<\/imgdir>)/);
  if (!lifeMatches) throw new Error('No life section found in map');

  const indexMatches = [...lifeMatches[1].matchAll(/<imgdir name="(\d+)">/g)];
  const maxIndex = indexMatches.length > 0 ? Math.max(...indexMatches.map(m => parseInt(m[1]))) : -1;

  let entries = '';
  for (let i = 0; i < count; i++) {
    const idx = maxIndex + 1 + i;
    entries += `    <imgdir name="${idx}">
      <string name="type" value="m"/>
      <string name="id" value="${mobId}"/>
      <int name="x" value="${x + i * 60}"/>
      <int name="y" value="${y}"/>
      <int name="fh" value="0"/>
      <int name="cy" value="${y}"/>
      <int name="rx0" value="${x + i * 60 - 100}"/>
      <int name="rx1" value="${x + i * 60 + 100}"/>
      <int name="mobTime" value="0"/>
    </imgdir>
`;
  }

  const lifeClose = xml.indexOf('</imgdir>', xml.indexOf('<imgdir name="life">') + 20);
  xml = xml.slice(0, lifeClose) + entries + '  ' + xml.slice(lifeClose);

  writeFileSync(fullPath, xml, 'utf-8');
  log.info({ mapId, mobId, x, y, count }, 'Mob(s) added to map');

  return { success: true, mapId, mobId, count, note: 'Restart server to apply' };
}

// ── Map Creation ────────────────────────────────────────────────────────────

/**
 * Create a new custom map. Generates the WZ XML file and registers the map name.
 * @param {string} mapId - 9-digit map ID (use 99xxxxxxx range for custom maps)
 * @param {object} opts - Map options
 * @param {string} opts.name - Map display name
 * @param {string} opts.streetName - Street/area name (shown in header)
 * @param {number} opts.returnMap - Map ID to return to (default: 999999999 = same map)
 * @param {string} opts.bgm - BGM path (default: "Bgm00/GoPicnic")
 * @param {number} opts.fieldLimit - Field limit flags (default: 0)
 * @param {Array} opts.footholds - Array of { x1, y1, x2, y2 } platform segments
 * @param {Array} opts.portals - Array of { name, type, x, y, targetMap, targetPortal }
 */
export function createMap(mapId, opts = {}) {
  const prefix = `Map${mapId.charAt(0)}`;
  const relativePath = `Map.wz/Map/${prefix}/${mapId}.img.xml`;
  const fullPath = join(WZ_DIR, relativePath);

  if (existsSync(fullPath)) {
    return { success: false, error: `Map ${mapId} already exists` };
  }

  const name = opts.name || 'Custom Map';
  const streetName = opts.streetName || 'Custom Area';
  const returnMap = opts.returnMap || 999999999;
  const bgm = opts.bgm || 'Bgm00/GoPicnic';
  const fieldLimit = opts.fieldLimit || 0;
  const footholds = opts.footholds || [{ x1: -500, y1: 0, x2: 500, y2: 0 }];
  const portals = opts.portals || [];

  // Build foothold XML
  let fhIndex = 0;
  const fhEntries = footholds.map(fh => {
    const idx = fhIndex++;
    return `      <imgdir name="${idx}">
        <int name="x1" value="${fh.x1}"/>
        <int name="y1" value="${fh.y1}"/>
        <int name="x2" value="${fh.x2}"/>
        <int name="y2" value="${fh.y2}"/>
        <int name="prev" value="${idx > 0 ? idx - 1 : 0}"/>
        <int name="next" value="${idx < footholds.length - 1 ? idx + 1 : 0}"/>
      </imgdir>`;
  }).join('\n');

  // Build portal XML
  const portalEntries = portals.map((p, i) => {
    return `    <imgdir name="${i}">
      <string name="pn" value="${p.name || 'sp'}"/>
      <int name="pt" value="${p.type || 0}"/>
      <int name="x" value="${p.x || 0}"/>
      <int name="y" value="${p.y || 0}"/>
      <int name="tm" value="${p.targetMap || 999999999}"/>
      <string name="tn" value="${p.targetPortal || ''}"/>
    </imgdir>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<imgdir name="${mapId}.img">
  <imgdir name="info">
    <string name="bgm" value="${bgm}"/>
    <int name="returnMap" value="${returnMap}"/>
    <int name="forcedReturn" value="${returnMap}"/>
    <int name="fieldLimit" value="${fieldLimit}"/>
    <int name="VRTop" value="-400"/>
    <int name="VRBottom" value="600"/>
    <int name="VRLeft" value="-800"/>
    <int name="VRRight" value="800"/>
    <float name="mobRate" value="1.0"/>
  </imgdir>
  <imgdir name="foothold">
    <imgdir name="0">
${fhEntries}
    </imgdir>
  </imgdir>
  <imgdir name="life">
  </imgdir>
  <imgdir name="portal">
${portalEntries}
  </imgdir>
  <imgdir name="reactor">
  </imgdir>
</imgdir>`;

  // Ensure directory exists
  const dir = join(WZ_DIR, 'Map.wz', 'Map', prefix);
  mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, xml, 'utf-8');

  // Register map name in String.wz
  const stringPath = join(WZ_DIR, 'String.wz', 'Map.img.xml');
  if (existsSync(stringPath)) {
    let stringXml = readFileSync(stringPath, 'utf-8');
    const mapEntry = `  <imgdir name="${mapId}">
    <string name="mapName" value="${name}"/>
    <string name="streetName" value="${streetName}"/>
  </imgdir>`;
    // Insert before final closing tag
    const lastClose = stringXml.lastIndexOf('</imgdir>');
    if (lastClose > 0) {
      stringXml = stringXml.slice(0, lastClose) + mapEntry + '\n' + stringXml.slice(lastClose);
      writeFileSync(stringPath, stringXml, 'utf-8');
    }
  }

  log.info({ mapId, name, footholds: footholds.length, portals: portals.length }, 'Custom map created');
  return { success: true, mapId, name, path: relativePath, note: 'Restart server to apply. Add NPCs/mobs with maple_place_npc and maple_add_mob.' };
}

// ── WZ Compilation (ALL via harepacker-mcp) ─────────────────────────────────

const WZ_SOURCE_DIR = join(process.cwd(), 'workspace', 'v83-client-custom');   // Source of truth — vanilla .wz files
const IMG_DATA_PATH = join(process.cwd(), 'workspace', 'npc-wz-img');           // Extracted .img filesystem (rebuilt each compile)
const SPRITE_DIR = join(process.cwd(), 'workspace', 'maple-sprites');
const PATCHED_WZ_DIR = join(process.cwd(), 'workspace', 'v83-client-patched');
const WZ_COMPILE_STATE = join(process.cwd(), 'data', 'state', 'wz-compile-state.json');
const MANIFEST_SCRIPT = join(process.cwd(), 'workspace', 'maple-patcher', 'server', 'generate-manifest.js');

const MCP_NAME = 'harepacker-mcp';
const WZ_CATEGORIES = ['npc','mob','skill','item','character','ui','string','etc','map','quest','reactor'];
const WZ_CASING = { npc:'Npc', mob:'Mob', skill:'Skill', item:'Item', character:'Character', ui:'UI', string:'String', etc:'Etc', map:'Map', quest:'Quest', reactor:'Reactor' };

/**
 * Full WZ compilation pipeline — ALL operations through harepacker-mcp.
 * No spawning separate WzImgMCP.exe processes. Uses the already-connected MCP.
 *
 * Source of truth: workspace/v83-client-custom/ (vanilla .wz files)
 *
 * Pipeline:
 *   0. Extract v83-client-custom/*.wz → npc-wz-img/ (fresh .img filesystem from vanilla)
 *   1. Init MCP data source on the extracted .img filesystem
 *   2. Pack custom sprites → import PNGs into .img via MCP (parse_image, import_png, save_image)
 *   3. Export modified .img → Cosmic XML for server (export-cosmic-xml.cjs)
 *   4. Pack .img → binary .wz via MCP (pack_to_wz) → patcher dir
 *   5. Regenerate patcher manifest (SHA256 hashes)
 */
export async function compileWz() {
  const { callTool: mcpCall } = await import('../../lib/mcp-gateway.js');
  const steps = [];
  let totalErrors = 0;

  async function mcp(tool, args) {
    const raw = await mcpCall(MCP_NAME, tool, args);
    try { return JSON.parse(raw); } catch { return raw; }
  }

  // ── Step 0: Extract vanilla .wz → .img filesystem ──────────────────────
  // Always rebuild from source of truth (v83-client-custom) to ensure clean base
  if (existsSync(WZ_SOURCE_DIR)) {
    try {
      log.info('Extracting vanilla .wz files to .img filesystem...');
      const res = await mcp('extract_to_img', { wzPath: WZ_SOURCE_DIR, outputDir: IMG_DATA_PATH, createManifest: true });
      steps.push({ step: 'extract-vanilla', status: 'ok', data: typeof res === 'object' ? res : {} });
    } catch (err) {
      // If extraction fails but we already have an img dir, continue with existing
      if (existsSync(IMG_DATA_PATH)) {
        log.warn({ err: err.message }, 'Vanilla extraction failed, using existing .img data');
        steps.push({ step: 'extract-vanilla', status: 'skipped', reason: 'failed but existing data available' });
      } else {
        const state = { lastCompileAt: Date.now(), success: false, error: err.message };
        writeFileSync(WZ_COMPILE_STATE, JSON.stringify(state), 'utf-8');
        return { success: false, error: 'Cannot extract vanilla WZ and no existing .img data: ' + err.message.slice(0, 200) };
      }
    }
  }

  // ── Step 1: Init data source ──────────────────────────────────────────────
  try {
    await mcp('init_data_source', { basePath: IMG_DATA_PATH });
    steps.push({ step: 'init', status: 'ok' });
  } catch (err) {
    const state = { lastCompileAt: Date.now(), success: false, error: err.message };
    writeFileSync(WZ_COMPILE_STATE, JSON.stringify(state), 'utf-8');
    return { success: false, error: 'MCP init failed: ' + err.message.slice(0, 200) };
  }

  // ── Step 2: Pack sprites into .img ────────────────────────────────────────
  let spritesPacked = 0;

  // Helper: ensure .img exists with template fallback
  function ensureImg(category, imgName, templatePrefix) {
    const imgPath = join(IMG_DATA_PATH, category, imgName);
    if (!existsSync(imgPath)) {
      const catDir = join(IMG_DATA_PATH, category);
      if (!existsSync(catDir)) return false;
      const tmpl = readdirSync(catDir).find(f => f.startsWith(templatePrefix) && f.endsWith('.img'));
      if (tmpl) { copyFileSync(join(catDir, tmpl), imgPath); return true; }
      return false;
    }
    return true;
  }

  // 2a: NPCs
  const npcDir = join(SPRITE_DIR, 'custom-npcs');
  if (existsSync(npcDir)) {
    for (const npcId of readdirSync(npcDir).filter(d => statSync(join(npcDir, d)).isDirectory())) {
      const frame0 = join(npcDir, npcId, 'stand_0.png');
      if (!existsSync(frame0)) continue;
      ensureImg('npc', `${npcId}.img`, '0002');
      try {
        await mcp('parse_image', { category: 'npc', image: `${npcId}.img` });
        await mcp('add_property', { category: 'npc', image: `${npcId}.img`, parentPath: '', name: 'stand', type: 'SubProperty' }).catch(() => {});
        const b64_0 = readFileSync(frame0).toString('base64');
        await mcp('import_png', { category: 'npc', image: `${npcId}.img`, parentPath: 'stand', name: '0', base64Png: b64_0, originX: 40, originY: 80 });
        const frame1 = join(npcDir, npcId, 'stand_1.png');
        if (existsSync(frame1)) {
          await mcp('import_png', { category: 'npc', image: `${npcId}.img`, parentPath: 'stand', name: '1', base64Png: readFileSync(frame1).toString('base64'), originX: 40, originY: 80 });
        }
        await mcp('save_image', { category: 'npc', image: `${npcId}.img` });
        spritesPacked++;
      } catch (err) { log.warn({ npcId, err: err.message }, 'NPC pack failed'); }
    }
  }

  // 2b: Mobs
  const mobDir = join(SPRITE_DIR, 'mobs');
  if (existsSync(mobDir)) {
    for (const mobId of readdirSync(mobDir).filter(d => statSync(join(mobDir, d)).isDirectory())) {
      ensureImg('mob', `${mobId}.img`, '0100');
      try {
        await mcp('parse_image', { category: 'mob', image: `${mobId}.img` });
        const dir = join(mobDir, mobId);
        for (const st of ['stand','move','hit1','die1','attack1','attack2']) {
          const frames = readdirSync(dir).filter(f => f.startsWith(st + '_') && f.endsWith('.png'));
          if (!frames.length) continue;
          await mcp('add_property', { category: 'mob', image: `${mobId}.img`, parentPath: '', name: st, type: 'SubProperty' }).catch(() => {});
          for (let i = 0; i < frames.length; i++) {
            const fp = join(dir, `${st}_${i}.png`);
            if (!existsSync(fp)) continue;
            await mcp('import_png', { category: 'mob', image: `${mobId}.img`, parentPath: st, name: String(i), base64Png: readFileSync(fp).toString('base64'), originX: 40, originY: 80 });
          }
        }
        await mcp('save_image', { category: 'mob', image: `${mobId}.img` });
        spritesPacked++;
      } catch (err) { log.warn({ mobId, err: err.message }, 'Mob pack failed'); }
    }
  }

  // 2c: Item icons (consumables + etc)
  const itemDir = join(SPRITE_DIR, 'item-icons');
  if (existsSync(itemDir)) {
    const grouped = {};
    for (const itemId of readdirSync(itemDir).filter(d => statSync(join(itemDir, d)).isDirectory())) {
      const id = parseInt(itemId, 10);
      if (id >= 1000000 && id < 2000000) continue; // weapons separate
      let subdir;
      if (id >= 2000000 && id < 3000000) subdir = 'Consume';
      else if (id >= 4000000 && id < 5000000) subdir = 'Etc';
      else continue;
      const container = String(Math.floor(id / 10000)).padStart(4, '0') + '.img';
      const key = `${subdir}/${container}`;
      if (!grouped[key]) grouped[key] = { subdir, container, imgRef: key, items: [] };
      grouped[key].items.push(itemId);
    }
    for (const [key, g] of Object.entries(grouped)) {
      if (!existsSync(join(IMG_DATA_PATH, 'item', g.subdir, g.container))) continue;
      try {
        await mcp('parse_image', { category: 'item', image: g.imgRef });
        for (const itemId of g.items) {
          await mcp('add_property', { category: 'item', image: g.imgRef, parentPath: '', name: itemId, type: 'SubProperty' }).catch(() => {});
          await mcp('add_property', { category: 'item', image: g.imgRef, parentPath: itemId, name: 'info', type: 'SubProperty' }).catch(() => {});
          for (const n of ['icon', 'iconRaw']) {
            const p = join(itemDir, itemId, `${n}.png`);
            if (existsSync(p)) await mcp('import_png', { category: 'item', image: g.imgRef, parentPath: `${itemId}/info`, name: n, base64Png: readFileSync(p).toString('base64'), originX: 0, originY: 32 });
          }
          spritesPacked++;
        }
        await mcp('save_image', { category: 'item', image: g.imgRef });
      } catch (err) { log.warn({ key, err: err.message }, 'Item pack failed'); }
    }
  }

  // 2d: Weapons
  for (const wid of ['1302134','1332100','1382081','1442104','1452086','1472101','1482047','1492049']) {
    const padded = '0' + wid;
    const imgName = `Weapon/${padded}.img`;
    ensureImg(join('character', 'Weapon').replace(/\\/g, '/'), `${padded}.img`, padded.slice(0, 5));
    try {
      await mcp('parse_image', { category: 'character', image: imgName });
      for (const n of ['icon', 'iconRaw']) {
        const p = join(SPRITE_DIR, 'item-icons', wid, `${n}.png`);
        if (existsSync(p)) await mcp('import_png', { category: 'character', image: imgName, parentPath: 'info', name: n, base64Png: readFileSync(p).toString('base64'), originX: 0, originY: 32 });
      }
      await mcp('save_image', { category: 'character', image: imgName });
      spritesPacked++;
    } catch (err) { log.warn({ wid, err: err.message }, 'Weapon pack failed'); }
  }

  // 2e: Equipment (caps, accessories)
  const equipDir = join(SPRITE_DIR, 'equipment');
  if (existsSync(equipDir)) {
    for (const eid of readdirSync(equipDir).filter(d => statSync(join(equipDir, d)).isDirectory())) {
      const padded = '0' + eid;
      let subdir;
      if (eid.startsWith('1003')) subdir = 'Cap';
      else if (eid.startsWith('1142')) subdir = 'Accessory';
      else continue;
      const imgName = `${subdir}/${padded}.img`;
      ensureImg(join('character', subdir).replace(/\\/g, '/'), `${padded}.img`, '0100');
      try {
        await mcp('parse_image', { category: 'character', image: imgName });
        await mcp('add_property', { category: 'character', image: imgName, parentPath: '', name: 'info', type: 'SubProperty' }).catch(() => {});
        for (const n of ['icon', 'iconRaw']) {
          const p = join(equipDir, eid, `${n}.png`);
          if (existsSync(p)) await mcp('import_png', { category: 'character', image: imgName, parentPath: 'info', name: n, base64Png: readFileSync(p).toString('base64'), originX: 0, originY: 32 });
        }
        await mcp('save_image', { category: 'character', image: imgName });
        spritesPacked++;
      } catch (err) { log.warn({ eid, err: err.message }, 'Equipment pack failed'); }
    }
  }

  // 2f: Skill icons (Necromancer + Sage)
  for (const cls of ['necromancer', 'sage']) {
    const skillDir = join(SPRITE_DIR, cls);
    if (!existsSync(skillDir)) continue;
    let b64Data = null;
    const b64Path = join(skillDir, 'icons_b64.json');
    if (existsSync(b64Path)) try { b64Data = JSON.parse(readFileSync(b64Path, 'utf8')); } catch {}
    for (const jobId of readdirSync(skillDir).filter(d => /^\d+$/.test(d) && statSync(join(skillDir, d)).isDirectory())) {
      const imgName = `${jobId}.img`;
      if (!existsSync(join(IMG_DATA_PATH, 'skill', imgName))) {
        const tmpl = readdirSync(join(IMG_DATA_PATH, 'skill')).find(f => f.endsWith('.img'));
        if (tmpl) copyFileSync(join(IMG_DATA_PATH, 'skill', tmpl), join(IMG_DATA_PATH, 'skill', imgName));
      }
      try {
        await mcp('parse_image', { category: 'skill', image: imgName });
        await mcp('add_property', { category: 'skill', image: imgName, parentPath: '', name: 'skill', type: 'SubProperty' }).catch(() => {});
        // From subdirectories
        const jobPath = join(skillDir, jobId);
        const sids = readdirSync(jobPath).filter(d => /^\d+$/.test(d) && statSync(join(jobPath, d)).isDirectory());
        for (const sid of sids) {
          await mcp('add_property', { category: 'skill', image: imgName, parentPath: 'skill', name: sid, type: 'SubProperty' }).catch(() => {});
          const ip = join(jobPath, sid, 'icon.png');
          if (existsSync(ip)) await mcp('import_png', { category: 'skill', image: imgName, parentPath: `skill/${sid}`, name: 'icon', base64Png: readFileSync(ip).toString('base64'), originX: 0, originY: 32 });
          spritesPacked++;
        }
        // From b64 json fallback
        if (b64Data && sids.length === 0) {
          for (const [sid, icons] of Object.entries(b64Data)) {
            if (sid.slice(0, 3) !== jobId) continue;
            await mcp('add_property', { category: 'skill', image: imgName, parentPath: 'skill', name: sid, type: 'SubProperty' }).catch(() => {});
            if (icons.icon) await mcp('import_png', { category: 'skill', image: imgName, parentPath: `skill/${sid}`, name: 'icon', base64Png: icons.icon, originX: 0, originY: 32 });
            if (icons.iconMouseOver) await mcp('import_png', { category: 'skill', image: imgName, parentPath: `skill/${sid}`, name: 'iconMouseOver', base64Png: icons.iconMouseOver, originX: 0, originY: 32 });
            if (icons.iconDisabled) await mcp('import_png', { category: 'skill', image: imgName, parentPath: `skill/${sid}`, name: 'iconDisabled', base64Png: icons.iconDisabled, originX: 0, originY: 32 });
            spritesPacked++;
          }
        }
        await mcp('save_image', { category: 'skill', image: imgName });
      } catch (err) { log.warn({ cls, jobId, err: err.message }, 'Skill pack failed'); }
    }
  }

  // 2g: Class selection UI
  const clsSelDir = join(SPRITE_DIR, 'class-selection');
  if (existsSync(clsSelDir)) {
    try {
      await mcp('parse_image', { category: 'ui', image: 'Login.img' });
      for (const cls of ['necromancer', 'sage']) {
        const dir = join(clsSelDir, cls);
        if (!existsSync(dir)) continue;
        await mcp('add_property', { category: 'ui', image: 'Login.img', parentPath: 'RaceSelect', name: cls, type: 'SubProperty' }).catch(() => {});
        for (const name of ['portrait', 'badge']) {
          const p = join(dir, `${name}.png`);
          if (existsSync(p)) await mcp('import_png', { category: 'ui', image: 'Login.img', parentPath: `RaceSelect/${cls}`, name, base64Png: readFileSync(p).toString('base64'), originX: 0, originY: 0 });
        }
      }
      await mcp('save_image', { category: 'ui', image: 'Login.img' });
      spritesPacked++;
    } catch (err) { log.warn({ err: err.message }, 'Class UI pack failed'); }
  }

  steps.push({ step: 'pack-sprites', status: 'ok', spritesPacked });

  // ── Step 3: Export to Cosmic XML ──────────────────────────────────────────
  const exportScript = join(process.cwd(), 'scripts', 'export-cosmic-xml.cjs');
  if (existsSync(exportScript)) {
    try {
      const output = execSync(`node "${exportScript}"`, { cwd: process.cwd(), encoding: 'utf-8', timeout: 300_000, maxBuffer: 50 * 1024 * 1024 });
      const m = output.match(/Exported:\s*(\d+)/);
      steps.push({ step: 'export-cosmic-xml', status: 'ok', exported: m ? parseInt(m[1]) : 0 });
    } catch (err) {
      steps.push({ step: 'export-cosmic-xml', status: 'error', error: err.message.slice(0, 200) });
      totalErrors++;
    }
  }

  // ── Step 4: Pack .img → binary .wz via MCP ────────────────────────────────
  await mcp('init_data_source', { basePath: IMG_DATA_PATH }); // re-init after sprite imports
  if (!existsSync(PATCHED_WZ_DIR)) mkdirSync(PATCHED_WZ_DIR, { recursive: true });

  let wzPacked = 0;
  for (const cat of WZ_CATEGORIES) {
    if (!existsSync(join(IMG_DATA_PATH, cat))) continue;
    try {
      await mcp('pack_to_wz', { imgPath: IMG_DATA_PATH, outputDir: PATCHED_WZ_DIR, category: cat, wzVersion: 83 });
      // Fix casing: MCP may output lowercase, client expects proper case
      const lowPath = join(PATCHED_WZ_DIR, `${cat}.wz`);
      const propPath = join(PATCHED_WZ_DIR, `${WZ_CASING[cat] || cat}.wz`);
      if (cat !== (WZ_CASING[cat] || cat).toLowerCase() && existsSync(lowPath)) {
        try {
          const tmp = join(PATCHED_WZ_DIR, `_tmp_${WZ_CASING[cat]}.wz`);
          const { renameSync: ren } = await import('fs');
          ren(lowPath, tmp); ren(tmp, propPath);
        } catch {}
      }
      wzPacked++;
    } catch (err) {
      log.warn({ cat, err: err.message }, 'WZ binary pack failed');
      totalErrors++;
    }
  }
  steps.push({ step: 'pack-wz-binary', status: 'ok', wzPacked });

  // ── Step 5: Regenerate patcher manifest ───────────────────────────────────
  if (existsSync(MANIFEST_SCRIPT)) {
    try {
      const output = execSync(`node "${MANIFEST_SCRIPT}"`, {
        cwd: join(process.cwd(), 'workspace', 'maple-patcher', 'server'),
        encoding: 'utf-8', timeout: 300_000,
      });
      steps.push({ step: 'manifest', status: 'ok', output: output.slice(-200) });
    } catch (err) {
      steps.push({ step: 'manifest', status: 'error', error: err.message.slice(0, 200) });
      totalErrors++;
    }
  }

  const state = { lastCompileAt: Date.now(), success: totalErrors === 0, steps };
  writeFileSync(WZ_COMPILE_STATE, JSON.stringify(state, null, 2), 'utf-8');
  log.info({ spritesPacked, wzPacked, totalErrors }, 'WZ compile done — all via MCP');

  return {
    success: totalErrors === 0,
    spritesPacked, wzPacked, totalErrors, steps,
    outputDir: PATCHED_WZ_DIR,
    note: 'Full pipeline via harepacker-mcp: sprites→.img→Cosmic XML→binary .wz→patcher manifest.',
  };
}

/**
 * Upload patched WZ files to Telegram for Ron to download on mobile.
 * Large files (>50MB) are split into parts.
 */
export async function uploadPatchedWz() {
  if (!existsSync(PATCHED_WZ_DIR)) {
    throw new Error('No patched WZ files found. Run maple_compile_wz first.');
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set');

  const files = readdirSync(PATCHED_WZ_DIR).filter(f => f.endsWith('.wz'));
  const results = [];
  const MAX_TG_SIZE = 49 * 1024 * 1024; // 49MB (Telegram limit ~50MB)

  for (const file of files) {
    const filePath = join(PATCHED_WZ_DIR, file);
    const size = statSync(filePath).size;

    if (size <= MAX_TG_SIZE) {
      // Direct upload
      try {
        execSync(
          `curl -s -F chat_id=${chatId} -F document=@"${filePath}" -F caption="${file} (patched)" "https://api.telegram.org/bot${token}/sendDocument"`,
          { encoding: 'utf-8', timeout: 120_000 }
        );
        results.push({ file, status: 'sent', size });
      } catch (err) {
        results.push({ file, status: 'failed', error: err.message.slice(0, 100) });
      }
    } else {
      // Too large — notify with path
      try {
        execSync(
          `curl -s -X POST "https://api.telegram.org/bot${token}/sendMessage" -d chat_id=${chatId} -d text="${file} (${Math.round(size / 1024 / 1024)}MB) too large for Telegram. Copy from: ${filePath}"`,
          { encoding: 'utf-8', timeout: 15_000 }
        );
        results.push({ file, status: 'too_large', size, path: filePath });
      } catch (err) {
        results.push({ file, status: 'notify_failed', error: err.message.slice(0, 100) });
      }
    }
  }

  log.info({ results }, 'WZ upload completed');
  return { success: true, results };
}

/**
 * Check if WZ XMLs have been modified since last compile.
 */
export function isWzStale() {
  let lastCompile = 0;
  try {
    if (existsSync(WZ_COMPILE_STATE)) {
      const state = JSON.parse(readFileSync(WZ_COMPILE_STATE, 'utf-8'));
      if (state.success) lastCompile = state.lastCompileAt || 0;
    }
  } catch { /* ignore */ }

  if (lastCompile === 0) return { stale: true, reason: 'never compiled' };

  // Check if any custom WZ XMLs are newer than last compile
  const checkPaths = [
    // Custom maps
    ...['Map1', 'Map2', 'Map9'].flatMap(d => {
      const dir = join(WZ_DIR, 'Map.wz', 'Map', d);
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter(f => f.endsWith('.img.xml'))
        .map(f => join(dir, f));
    }),
    // Custom skills (Necromancer 700-712, Sage 600-612)
    ...['600', '610', '611', '612', '700', '710', '711', '712']
      .map(s => join(WZ_DIR, 'Skill.wz', `${s}.img.xml`)),
    // Custom NPCs (999x prefix)
    ...(() => {
      const npcDir = join(WZ_DIR, 'Npc.wz');
      if (!existsSync(npcDir)) return [];
      return readdirSync(npcDir)
        .filter(f => f.startsWith('999') && f.endsWith('.img.xml'))
        .map(f => join(npcDir, f));
    })(),
    // Custom Mobs (990x prefix)
    ...(() => {
      const mobDir = join(WZ_DIR, 'Mob.wz');
      if (!existsSync(mobDir)) return [];
      return readdirSync(mobDir)
        .filter(f => f.startsWith('990') && f.endsWith('.img.xml'))
        .map(f => join(mobDir, f));
    })(),
    // String.wz entries
    join(WZ_DIR, 'String.wz', 'Map.img.xml'),
    join(WZ_DIR, 'String.wz', 'Npc.img.xml'),
    join(WZ_DIR, 'String.wz', 'Skill.img.xml'),
    join(WZ_DIR, 'String.wz', 'Mob.img.xml'),
    // Item containers
    join(WZ_DIR, 'Item.wz', 'Consume', '0200.img.xml'),
    join(WZ_DIR, 'Item.wz', 'Consume', '0203.img.xml'),
    join(WZ_DIR, 'Item.wz', 'Etc', '0403.img.xml'),
  ];

  // Also check sprite directories for new/modified PNGs
  const spriteDir = join(process.cwd(), 'workspace', 'maple-sprites');
  const spriteDirs = ['custom-npcs', 'mobs', 'item-icons', 'equipment', 'necromancer', 'sage', 'class-selection'];
  for (const sub of spriteDirs) {
    const dir = join(spriteDir, sub);
    if (!existsSync(dir)) continue;
    try {
      if (statSync(dir).mtimeMs > lastCompile) {
        checkPaths.push(dir);
      }
    } catch { /* ignore */ }
  }

  const newerFiles = [];
  for (const p of checkPaths) {
    try {
      if (existsSync(p) && statSync(p).mtimeMs > lastCompile) {
        newerFiles.push(basename(p));
      }
    } catch { /* ignore */ }
  }

  if (newerFiles.length > 0) {
    return { stale: true, reason: `${newerFiles.length} files modified since last compile`, files: newerFiles.slice(0, 10) };
  }
  return { stale: false };
}

// ── Drop Table Management ────────────────────────────────────────────────────

export function addDrop(mobId, itemId, chance, minQty = 1, maxQty = 1) {
  const sql = `INSERT INTO drop_data (dropperid, itemid, minimum_quantity, maximum_quantity, questid, chance) VALUES (${mobId}, ${itemId}, ${minQty}, ${maxQty}, 0, ${chance})`;
  mysqlQuery(sql);
  log.info({ mobId, itemId, chance }, 'Drop added');
  return { success: true, mobId, itemId, chance, minQty, maxQty };
}

export function getDrops(mobId) {
  const result = mysqlQuery(`SELECT itemid, minimum_quantity, maximum_quantity, chance FROM drop_data WHERE dropperid = ${mobId}`);
  return result;
}

// ── Config Management ────────────────────────────────────────────────────────

export function readConfig() {
  return readFileSync(CONFIG_PATH, 'utf-8');
}

export function updateConfig(key, value) {
  let config = readFileSync(CONFIG_PATH, 'utf-8');
  const regex = new RegExp(`(${key}:\\s*)(.+)`, 'g');
  const newConfig = config.replace(regex, `$1${value}`);
  if (newConfig === config) {
    throw new Error(`Config key '${key}' not found`);
  }
  writeFileSync(CONFIG_PATH, newConfig, 'utf-8');
  log.info({ key, value }, 'Config updated');
  return { success: true, key, value, note: 'Restart server to apply' };
}

// ── Sprite Import ───────────────────────────────────────────────────────────

const IMG_DATA = join(process.cwd(), 'workspace', 'v83-img-data');

/**
 * Import a PNG sprite into the WZ XML data for a mob, NPC, or item.
 * Creates a canvas entry in the corresponding .img.xml file.
 *
 * @param {string} type - Entity type: "mob", "npc", "item"
 * @param {string} id - Entity ID (e.g. "0100100" for mob, "9999001" for NPC)
 * @param {string} pngPath - Absolute path to the PNG file to import
 * @param {string} animState - Animation state (e.g. "stand", "move", "hit", "die")
 * @param {number} frame - Frame index (default 0)
 */
export function importSprite(type, id, pngPath, animState = 'stand', frame = 0) {
  if (!existsSync(pngPath)) throw new Error(`PNG file not found: ${pngPath}`);

  // Determine WZ category and img path
  const categoryMap = { mob: 'Mob', npc: 'Npc', item: 'Item' };
  const wzCategory = categoryMap[type];
  if (!wzCategory) throw new Error(`Invalid type "${type}". Use: mob, npc, item`);

  // Copy PNG to img-data directory for harepacker access
  const destDir = join(IMG_DATA, wzCategory, `${id}.img`, animState);
  mkdirSync(destDir, { recursive: true });
  const destFile = join(destDir, `${frame}.png`);
  copyFileSync(pngPath, destFile);

  // Also update the WZ XML to reference this sprite
  const wzSubdir = `${wzCategory}.wz`;
  const xmlPath = join(WZ_DIR, wzSubdir, `${id}.img.xml`);

  if (existsSync(xmlPath)) {
    // Add/update the animation state in existing XML
    let xml = readFileSync(xmlPath, 'utf-8');
    const stateTag = `<imgdir name="${animState}">`;
    if (!xml.includes(stateTag)) {
      // Add new animation state before the closing tag
      const lastClose = xml.lastIndexOf('</imgdir>');
      if (lastClose > 0) {
        const entry = `  <imgdir name="${animState}">\n    <canvas name="${frame}" width="0" height="0" basedata="link:${wzCategory}/${id}.img/${animState}/${frame}"/>\n  </imgdir>\n`;
        xml = xml.slice(0, lastClose) + entry + xml.slice(lastClose);
        writeFileSync(xmlPath, xml, 'utf-8');
      }
    }
  }

  log.info({ type, id, animState, frame, dest: destFile }, 'Sprite imported');
  return {
    success: true,
    type, id, animState, frame,
    pngDest: destFile,
    note: 'Restart server to apply. Sprite available via harepacker-mcp.',
  };
}

/**
 * Import a PNG into Map WZ data (backgrounds, tiles, objects).
 * @param {string} assetType - "back", "tile", or "obj"
 * @param {string} setName - Asset set name (e.g. "customForest" for Map/Back/customForest.img)
 * @param {string} subPath - Path within the set (e.g. "0" for backgrounds, "bsc/0" for tiles, "tree/big/0/0" for objects)
 * @param {string} pngPath - Absolute path to the PNG file
 */
export function importMapAsset(assetType, setName, subPath, pngPath) {
  if (!existsSync(pngPath)) throw new Error(`PNG file not found: ${pngPath}`);

  const typeMap = { back: 'Back', tile: 'Tile', obj: 'Obj' };
  const wzSubdir = typeMap[assetType];
  if (!wzSubdir) throw new Error(`Invalid assetType "${assetType}". Use: back, tile, obj`);

  // Copy PNG to img-data directory
  const pathParts = subPath.split('/');
  const destDir = join(IMG_DATA, 'Map', wzSubdir, `${setName}.img`, ...pathParts.slice(0, -1));
  mkdirSync(destDir, { recursive: true });
  const finalDest = join(IMG_DATA, 'Map', wzSubdir, `${setName}.img`, ...pathParts) + '.png';
  copyFileSync(pngPath, finalDest);

  log.info({ assetType, setName, subPath, dest: finalDest }, 'Map asset imported');
  return {
    success: true,
    assetType, setName, subPath,
    pngDest: finalDest,
    wzRef: `Map/${wzSubdir}/${setName}.img/${subPath}`,
    note: `Use bS="${setName}" (back), tS="${setName}" (tile), or oS="${setName}" (obj) in map XML. Restart server to apply.`,
  };
}
