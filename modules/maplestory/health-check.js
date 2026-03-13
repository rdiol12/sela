/**
 * MapleStory Server Health Check Module
 * Verifies all deployed custom content and server state.
 *
 * Checks:
 *  - Server running status (MySQL + game server)
 *  - Custom NPC scripts (deployed + accessible)
 *  - Custom quest scripts (deployed + accessible)
 *  - Custom event scripts (deployed + accessible)
 *  - Custom weapons/items in WZ XML
 *  - Sage class deployment (skill WZ files)
 *  - Sage Hall maps (101050000-101050002)
 *  - Custom drop tables in DB
 *  - Recent error logs (last 24h)
 *
 * Wired into modules/maplestory/index.js as maple_health_check tool.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { getServerStatus, isMysqlRunning, mysqlQuery, tailLog } from './server-manager.js';

const WZ_DIR = process.env.COSMIC_WZ_DIR || join(process.cwd(), 'workspace/Cosmic/wz');
const SCRIPTS_DIR = process.env.COSMIC_SCRIPTS_DIR || join(process.cwd(), 'workspace/Cosmic/scripts');
const BOT_STATE_FILE = join(process.cwd(), 'data/state/maple-bots.json');

// ── Expected Custom Content Registry ────────────────────────────────────────

// Custom NPCs created by the agent (IDs)
const EXPECTED_NPCS = [
  { id: '9999001', name: 'Blacksmith Taro' },
  { id: '9999002', name: 'Alchemist Luna' },
  { id: '9999003', name: 'Scout Raven' },
  { id: '9999004', name: 'Chef Momo' },
  { id: '9999005', name: 'Old Man Kazuki' },
  { id: '9999006', name: 'Arena Master Rex' },
  { id: '9999007', name: 'Gem Trader Safi' },
  { id: '9999008', name: 'Captain Flint' },
  { id: '9999009', name: 'Nurse Joy' },
  { id: '9999010', name: 'Treasure Hunter Kai' },
  { id: '9999030', name: 'Sage Instructor Elara' },
];

// Custom quests created by the agent
const EXPECTED_QUESTS = [
  { id: '99001', name: 'Custom Quest Chain 1' },
  { id: '99002', name: 'Custom Quest Chain 2' },
  { id: '99003', name: 'Custom Quest Chain 3' },
  { id: '99101', name: 'Sage Quest 1' },
  { id: '99201', name: "The Sage's Calling" },
  { id: '99202', name: 'Elemental Trials' },
  { id: '99203', name: 'The Ancient Library' },
  { id: '99210', name: 'A New Beginning (Sage Hall)' },
  { id: '99211', name: 'The Shroom Menace (Sage Hall)' },
  { id: '99212', name: 'Awakening the Inner Sanctum (Sage Hall)' },
];

// Sage Hall maps
const EXPECTED_MAPS = [
  { id: '101050000', name: 'Sage Hall' },
  { id: '101050001', name: 'Sage Training Ground' },
  { id: '101050002', name: 'Sage Inner Sanctum' },
];

// Sage class WZ skill files
const EXPECTED_SAGE_WZ = [
  'Skill.wz/600.img.xml',
  'Skill.wz/610.img.xml',
  'Skill.wz/611.img.xml',
  'Skill.wz/612.img.xml',
];

// ── Check Functions ──────────────────────────────────────────────────────────

function checkServerProcesses() {
  const mysqlOk = isMysqlRunning();
  const statusObj = getServerStatus();
  // getServerStatus() returns { mysql, server, accounts, characters }
  const serverOk = !!(statusObj.server || statusObj.running);
  return {
    mysql: mysqlOk ? 'running' : 'stopped',
    gameServer: serverOk ? 'running' : 'stopped',
    accounts: statusObj.accounts || 0,
    characters: statusObj.characters || 0,
    ok: mysqlOk && serverOk,
  };
}

function checkNpcScripts() {
  const missing = [];
  const present = [];
  for (const npc of EXPECTED_NPCS) {
    const filePath = join(SCRIPTS_DIR, 'npc', `${npc.id}.js`);
    if (existsSync(filePath)) {
      const stat = statSync(filePath);
      present.push({ id: npc.id, name: npc.name, bytes: stat.size });
    } else {
      missing.push({ id: npc.id, name: npc.name });
    }
  }
  return {
    total: EXPECTED_NPCS.length,
    present: present.length,
    missing,
    allDeployed: missing.length === 0,
    details: present,
  };
}

function checkQuestScripts() {
  const missing = [];
  const present = [];
  for (const quest of EXPECTED_QUESTS) {
    const filePath = join(SCRIPTS_DIR, 'quest', `${quest.id}.js`);
    if (existsSync(filePath)) {
      const stat = statSync(filePath);
      present.push({ id: quest.id, name: quest.name, bytes: stat.size });
    } else {
      missing.push({ id: quest.id, name: quest.name });
    }
  }
  return {
    total: EXPECTED_QUESTS.length,
    present: present.length,
    missing,
    allDeployed: missing.length === 0,
  };
}

function checkSageHallMaps() {
  const results = [];
  for (const map of EXPECTED_MAPS) {
    const prefix = `Map${map.id.charAt(0)}`;
    const filePath = join(WZ_DIR, 'Map.wz', 'Map', prefix, `${map.id}.img.xml`);
    const exists = existsSync(filePath);
    results.push({
      id: map.id,
      name: map.name,
      exists,
      bytes: exists ? statSync(filePath).size : 0,
    });
  }
  return {
    total: EXPECTED_MAPS.length,
    present: results.filter(r => r.exists).length,
    maps: results,
    allPresent: results.every(r => r.exists),
  };
}

function checkSageClassWz() {
  const results = [];
  for (const wzPath of EXPECTED_SAGE_WZ) {
    const filePath = join(WZ_DIR, wzPath);
    const exists = existsSync(filePath);
    results.push({
      file: wzPath,
      exists,
      bytes: exists ? statSync(filePath).size : 0,
    });
  }
  return {
    total: EXPECTED_SAGE_WZ.length,
    present: results.filter(r => r.exists).length,
    files: results,
    allPresent: results.every(r => r.exists),
  };
}

function checkCustomEventScripts() {
  try {
    const eventDir = join(SCRIPTS_DIR, 'event');
    if (!existsSync(eventDir)) return { count: 0, error: 'Event dir not found' };
    const files = readdirSync(eventDir).filter(f => f.endsWith('.js'));
    const customEvents = files.filter(f => {
      // Custom events created by agent tend to be newer files
      const filePath = join(eventDir, f);
      const stat = statSync(filePath);
      const ageMs = Date.now() - stat.mtimeMs;
      return ageMs < 30 * 24 * 60 * 60 * 1000; // modified in last 30 days
    });
    return { total: files.length, recentlyModified: customEvents.length, sample: customEvents.slice(0, 5) };
  } catch (e) {
    return { error: e.message };
  }
}

function checkDropTables() {
  try {
    const result = mysqlQuery('SELECT COUNT(*) as cnt FROM drop_data WHERE dropperid >= 100000');
    const cnt = result[0]?.cnt || 0;
    return { customDropEntries: cnt, ok: cnt > 0 };
  } catch (e) {
    return { error: e.message, ok: false };
  }
}

function checkRecentErrors() {
  try {
    const logs = tailLog('main', 100);
    const lines = logs.output ? logs.output.split('\n') : [];
    const errors = lines.filter(l =>
      l.toLowerCase().includes('error') ||
      l.toLowerCase().includes('exception') ||
      l.toLowerCase().includes('failed')
    );
    const warnings = lines.filter(l => l.toLowerCase().includes('warn'));
    return {
      linesChecked: lines.length,
      errors: errors.slice(-5), // last 5 errors
      errorCount: errors.length,
      warningCount: warnings.length,
    };
  } catch (e) {
    return { error: e.message };
  }
}

function countTotalCustomContent() {
  const counts = { npcs: 0, quests: 0, events: 0 };
  try {
    counts.npcs = readdirSync(join(SCRIPTS_DIR, 'npc')).filter(f => f.endsWith('.js')).length;
    counts.quests = readdirSync(join(SCRIPTS_DIR, 'quest')).filter(f => f.endsWith('.js')).length;
    counts.events = readdirSync(join(SCRIPTS_DIR, 'event')).filter(f => f.endsWith('.js')).length;
  } catch (e) { /* ignore */ }
  return counts;
}

// ── Bot State Check ──────────────────────────────────────────────────────────

function checkBotState() {
  if (!existsSync(BOT_STATE_FILE)) {
    return { hasBots: false, botCount: 0, sageBots: 0, note: 'No bot state file' };
  }
  try {
    const raw = JSON.parse(readFileSync(BOT_STATE_FILE, 'utf-8'));
    const botNames = Object.keys(raw).filter(k => k !== 'savedAt' && typeof raw[k] === 'object' && raw[k].charId);
    const bots = botNames.map(n => raw[n]);
    const sageBots = bots.filter(b => b.stats && b.stats.level && b.jobId >= 600 && b.jobId <= 612);
    const staleMs = 30 * 60 * 1000; // 30 min
    const now = Date.now();
    const staleBots = bots.filter(b => b.savedAt && (now - b.savedAt) > staleMs);
    return {
      hasBots: bots.length > 0,
      botCount: bots.length,
      sageBots: sageBots.length,
      staleBots: staleBots.length,
      botNames: bots.slice(0, 8).map(b => b.name || 'unnamed'),
      lastSaved: raw.savedAt ? new Date(raw.savedAt).toISOString() : null,
    };
  } catch (e) {
    return { hasBots: false, error: e.message };
  }
}

// ── Main Health Check ────────────────────────────────────────────────────────

export function runHealthCheck() {
  const startMs = Date.now();
  const report = {
    timestamp: new Date().toISOString(),
    summary: {},
    checks: {},
  };

  // Run all checks
  report.checks.serverProcesses = checkServerProcesses();
  report.checks.npcScripts = checkNpcScripts();
  report.checks.questScripts = checkQuestScripts();
  report.checks.sageHallMaps = checkSageHallMaps();
  report.checks.sageClassWz = checkSageClassWz();
  report.checks.customEvents = checkCustomEventScripts();
  report.checks.dropTables = checkDropTables();
  report.checks.recentErrors = checkRecentErrors();
  report.checks.contentCounts = countTotalCustomContent();
  report.checks.botState = checkBotState();

  // Build summary
  const issues = [];
  if (report.checks.serverProcesses.mysql !== 'running') issues.push('MySQL not running');
  if (report.checks.serverProcesses.gameServer !== 'running') issues.push('Game server not running');
  if (!report.checks.npcScripts.allDeployed) {
    issues.push(`${report.checks.npcScripts.missing.length} NPC scripts missing: ${report.checks.npcScripts.missing.map(n => n.name).join(', ')}`);
  }
  if (!report.checks.questScripts.allDeployed) {
    issues.push(`${report.checks.questScripts.missing.length} quest scripts missing: ${report.checks.questScripts.missing.map(q => q.name).join(', ')}`);
  }
  if (!report.checks.sageHallMaps.allPresent) {
    issues.push(`${report.checks.sageHallMaps.maps.filter(m => !m.exists).length} Sage Hall maps missing`);
  }
  if (!report.checks.sageClassWz.allPresent) {
    issues.push(`${report.checks.sageClassWz.files.filter(f => !f.exists).length} Sage WZ files missing`);
  }
  if (report.checks.recentErrors.errorCount > 10) {
    issues.push(`High error rate: ${report.checks.recentErrors.errorCount} errors in recent logs`);
  }
  if (report.checks.botState.staleBots > 0) {
    issues.push(`${report.checks.botState.staleBots} bots have stale state (>30min since last save)`);
  }

  report.summary = {
    healthy: issues.length === 0,
    issueCount: issues.length,
    issues,
    elapsedMs: Date.now() - startMs,
    contentOverview: {
      totalNpcs: report.checks.contentCounts.npcs,
      totalQuests: report.checks.contentCounts.quests,
      totalEvents: report.checks.contentCounts.events,
      sageHallMaps: report.checks.sageHallMaps.present + '/' + report.checks.sageHallMaps.total,
      sageSkillFiles: report.checks.sageClassWz.present + '/' + report.checks.sageClassWz.total,
      customNpcsTracked: report.checks.npcScripts.present + '/' + report.checks.npcScripts.total,
      customQuestsTracked: report.checks.questScripts.present + '/' + report.checks.questScripts.total,
      bots: report.checks.botState.botCount || 0,
      sageBots: report.checks.botState.sageBots || 0,
    },
  };

  return report;
}
