/**
 * Guardian M3: External process watchdog
 * Runs as a SEPARATE PM2 process — independent of the main sela bot.
 * Pings /healthz every 5 minutes. Sends Telegram if bot is unreachable.
 *
 * Why a separate process: the internal heartbeat cron can't detect if the
 * agent-loop itself is dead, since it runs inside the same process.
 */

import { readFileSync, existsSync, openSync, readSync, fstatSync, closeSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import pino from 'pino';

const __dirname = dirname(fileURLToPath(import.meta.url));
const log = pino({ name: 'watchdog', level: process.env.LOG_LEVEL || 'info' });
const DATA_DIR = resolve(__dirname, '..', 'data');
const PORT_FILE = resolve(DATA_DIR, '.ipc-port');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const ALERT_AFTER_FAILURES = 5;          // alert after 5 consecutive failures
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 min cooldown between alerts
const CHRONIC_ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour between chronic memory alerts
const CHRONIC_DEGRADED_THRESHOLD = 6;    // 6 consecutive degraded checks (30min) → alert

let consecutiveFailures = 0;
let consecutiveDegraded = 0;             // track sustained degraded state
let lastAlertAt = 0;
let lastChronicAlertAt = 0;
let wasDown = false;

// ── Telegram helper (standalone — no notify.js dependency) ──────────────────
async function sendTelegram(text) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const body = JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'Markdown' });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const err = await res.text();
      log.error({ status: res.status, detail: err.slice(0, 100) }, 'Telegram error');
    }
  } catch (err) {
    log.error({ err }, 'Telegram send failed');
  }
}

// ── Read bot port from .ipc-port ────────────────────────────────────────────
function getBotPort() {
  try {
    if (!existsSync(PORT_FILE)) return null;
    const raw = readFileSync(PORT_FILE, 'utf-8').trim();
    const { port, token } = JSON.parse(raw);
    return { port, token };
  } catch {
    return null;
  }
}

// ── Health check ─────────────────────────────────────────────────────────────
async function checkHealth() {
  const ipc = getBotPort();
  if (!ipc) {
    consecutiveFailures++;
    log.warn({ failures: consecutiveFailures }, '.ipc-port missing');
    await maybeAlert('*[Watchdog] Bot unreachable* — `.ipc-port` file missing. Sela may not have started properly.');
    return;
  }

  const { port, token } = ipc;
  const url = `http://127.0.0.1:${port}/healthz`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    const body = await res.json();

    if (res.ok && body.status === 'ok') {
      // Recovery notice
      if (wasDown) {
        log.info('Bot recovered');
        await sendTelegram('*[Watchdog] Sela recovered* ✅ — `/healthz` responding normally again.');
        wasDown = false;
        consecutiveFailures = 0;
      } else if (consecutiveFailures > 0) {
        log.info('Health restored after partial failures');
        consecutiveFailures = 0;
      } else {
        log.info({ heap_pct: body.heap_pct, tier: body.memory_tier || '?', queue: body.queue_waiting }, 'ok');
      }
      // Reset degraded counter on healthy check
      if (consecutiveDegraded > 0) {
        log.info({ degradedChecks: consecutiveDegraded }, 'Memory pressure resolved');
        consecutiveDegraded = 0;
      }
    } else {
      // Degraded — track consecutive degraded checks for chronic memory pressure alerting.
      // Does NOT count toward consecutiveFailures (only unreachable does).
      consecutiveDegraded++;
      const tier = body.memory_tier || 'unknown';
      log.warn({ degraded: consecutiveDegraded, heap_pct: body.heap_pct, tier, mcp: body.mcp, queue: body.queue_waiting }, 'degraded');

      // Alert on sustained degraded state (CHRONIC_DEGRADED_THRESHOLD consecutive = 30min)
      // Uses Memory Guardian tier from /healthz for smarter alerting
      const now = Date.now();
      const isCriticalTier = tier === 'critical' || tier === 'restart';
      const isSustained = consecutiveDegraded >= CHRONIC_DEGRADED_THRESHOLD;
      if ((isCriticalTier || isSustained) && (now - lastChronicAlertAt) > CHRONIC_ALERT_COOLDOWN_MS) {
        lastChronicAlertAt = now;
        const msg = isCriticalTier
          ? `*[Watchdog] Memory CRITICAL* 🔴 — heap ${body.heap_pct}%, tier: ${tier}. Consider restart.`
          : `*[Watchdog] Chronic memory pressure* ⚠️ — degraded for ${consecutiveDegraded * 5}min (heap ${body.heap_pct}%, tier: ${tier})`;
        await sendTelegram(msg);
      }
    }
  } catch (err) {
    consecutiveFailures++;
    log.warn({ err, failures: consecutiveFailures }, 'unreachable');
    await maybeAlert(`*[Watchdog] Sela unreachable* 🚨 — ${consecutiveFailures} consecutive failures.\nError: ${err.message.slice(0, 120)}`);
  }
}

async function maybeAlert(msg) {
  if (consecutiveFailures < ALERT_AFTER_FAILURES) return; // not yet
  const now = Date.now();
  if (now - lastAlertAt < ALERT_COOLDOWN_MS) return; // cooldown active
  lastAlertAt = now;
  wasDown = true;
  await sendTelegram(msg);
}

// ── Zombie process detection ────────────────────────────────────────────────
const LOGS_DIR = resolve(__dirname, '..', 'logs');
const DUPLICATE_CHECK_INTERVAL_MS = 60_000; // 1 minute
const RESTART_GRACE_MS = 90_000; // skip zombie kills for 90s after sela restart
const MAX_ZOMBIE_KILLS_PER_HOUR = 15; // cap kills to prevent loop (raised from 5 — PM2 can create 20 orphans per restart cycle)
let zombieKillCount = 0;
let zombieKillsThisHour = 0;
let zombieKillHourStart = Date.now();
let portConflictPids = new Map(); // pid → first-seen timestamp (require persistence before kill)

function getSelaInfo() {
  try {
    const raw = execSync('pm2 jlist', { timeout: 10_000, encoding: 'utf-8', windowsHide: true });
    const procs = JSON.parse(raw);
    const sela = procs.find(p => p.name === 'sela' && p.pm2_env?.status === 'online');
    if (!sela) return null;
    const uptimeMs = sela.pm2_env?.pm_uptime ? (Date.now() - sela.pm2_env.pm_uptime) : Infinity;
    return { pid: sela.pid, uptimeMs };
  } catch {
    return null;
  }
}

function getPm2SelaPid() {
  return getSelaInfo()?.pid || null;
}

function isSelaInGracePeriod() {
  const info = getSelaInfo();
  if (!info) return true; // no sela running, don't kill anything
  return info.uptimeMs < RESTART_GRACE_MS;
}

function canKillZombie() {
  const now = Date.now();
  if (now - zombieKillHourStart > 3600_000) {
    zombieKillsThisHour = 0;
    zombieKillHourStart = now;
  }
  return zombieKillsThisHour < MAX_ZOMBIE_KILLS_PER_HOUR;
}

function getTodayLogPath() {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return resolve(LOGS_DIR, `app-${date}.log`);
}

function extractRecentPidsFrom440(logPath, windowMs) {
  try {
    if (!existsSync(logPath)) return [];
    const TAIL_BYTES = 64 * 1024;
    const fd = openSync(logPath, 'r');
    const stat = fstatSync(fd);
    const start = Math.max(0, stat.size - TAIL_BYTES);
    const buf = Buffer.alloc(Math.min(TAIL_BYTES, stat.size));
    readSync(fd, buf, 0, buf.length, start);
    closeSync(fd);

    const lines = buf.toString('utf-8').split('\n');
    const cutoff = Date.now() - windowMs;
    const pids = new Set();

    for (const line of lines) {
      if (!line.includes('"statusCode":440')) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.statusCode === 440 && entry.time >= cutoff) {
          pids.add(entry.pid);
        }
      } catch {}
    }
    return [...pids];
  } catch {
    return [];
  }
}

function killPid(pid) {
  // Validate PID is a positive integer to prevent command injection via crafted log entries
  const pidNum = parseInt(pid, 10);
  if (!Number.isInteger(pidNum) || pidNum <= 0) return false;
  try {
    execSync(`taskkill /F /PID ${pidNum} 2>NUL`, { timeout: 5_000, encoding: 'utf-8', shell: 'cmd.exe', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function findPortHolders(port) {
  // Find Windows PIDs that are listening on the given port (zombie detection via netstat)
  try {
    const raw = execSync(`netstat -ano`, { timeout: 5_000, encoding: 'utf-8', shell: 'cmd.exe', windowsHide: true });
    const pids = [];
    for (const line of raw.split('\n')) {
      if (line.includes(`:${port}`) && line.includes('LISTENING')) {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[parts.length - 1], 10);
        if (pid > 0) pids.push(pid);
      }
    }
    return pids;
  } catch {
    return [];
  }
}

function getNodePidsFromTasklist() {
  // Returns array of {pid, mem} for all node.exe processes using tasklist (cmd.exe, no PowerShell)
  try {
    const raw = execSync('tasklist /FI "IMAGENAME eq node.exe" /FO CSV /NH',
      { timeout: 10_000, encoding: 'utf-8', shell: 'cmd.exe', windowsHide: true });
    const results = [];
    for (const line of raw.split('\n')) {
      const match = line.match(/"node\.exe","(\d+)"/);
      if (match) results.push(parseInt(match[1], 10));
    }
    return results;
  } catch {
    return [];
  }
}

function getPm2DaemonPid() {
  try {
    const pidFile = resolve(process.env.PM2_HOME || resolve(process.env.USERPROFILE || process.env.HOME, '.pm2'), 'pm2.pid');
    if (!existsSync(pidFile)) return null;
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    return pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function getKnownPids() {
  // Get all PM2-managed PIDs + daemon PID without calling pm2 CLI
  const pids = new Set();
  // Daemon PID from file
  const daemonPid = getPm2DaemonPid();
  if (daemonPid) pids.add(daemonPid);
  // App PIDs from pm2 jlist (already used by getPm2SelaPid, safe single call)
  try {
    const raw = execSync('pm2 jlist', { timeout: 10_000, encoding: 'utf-8', windowsHide: true });
    const procs = JSON.parse(raw);
    for (const p of procs) {
      if (p.pid) pids.add(p.pid);
    }
  } catch {}
  // Also include our own PID (watchdog)
  pids.add(process.pid);
  return pids;
}

function getOrphanedNodeProcesses() {
  // Find ALL orphaned node.exe processes (parent PID is dead).
  // Skips PM2-managed processes and the PM2 daemon itself.
  try {
    const ps = `Get-CimInstance Win32_Process -Filter \\\"Name='node.exe'\\\" | ` +
      `Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress`;
    const raw = execSync(`powershell -NoProfile -Command "${ps}"`,
      { timeout: 15_000, encoding: 'utf-8', windowsHide: true });
    const procs = JSON.parse(raw);
    const arr = Array.isArray(procs) ? procs : [procs];

    // Build set of all living node PIDs for parent-alive check
    const livingNodePids = new Set(arr.map(p => p.ProcessId));

    // Also check if parent exists as ANY process (not just node.exe)
    // Use tasklist to get all PIDs
    let allLivingPids;
    try {
      const taskRaw = execSync('tasklist /FO CSV /NH', { timeout: 10_000, encoding: 'utf-8', shell: 'cmd.exe', windowsHide: true });
      allLivingPids = new Set();
      for (const line of taskRaw.split('\n')) {
        const match = line.match(/"[^"]+","(\d+)"/);
        if (match) allLivingPids.add(parseInt(match[1], 10));
      }
    } catch {
      // Fallback: only check against node PIDs
      allLivingPids = livingNodePids;
    }

    const knownPids = getKnownPids();
    const orphans = [];
    for (const p of arr) {
      if (knownPids.has(p.ProcessId)) continue;          // PM2-managed, skip
      if (allLivingPids.has(p.ParentProcessId)) continue; // parent alive, not orphan
      orphans.push({ pid: p.ProcessId, cmd: (p.CommandLine || '').slice(0, 120) });
    }
    return orphans;
  } catch (err) {
    log.error({ err: err.message }, 'PowerShell orphan scan failed');
    return [];
  }
}

async function killOrphanedNodeProcesses() {
  try {
    const knownPids = getKnownPids();
    const selaPid = getPm2SelaPid();

    // Method A: Kill zombies holding sela's ws-gateway port
    const portHolders = findPortHolders(18789);
    const portZombies = portHolders.filter(pid => pid !== selaPid && !knownPids.has(pid));

    // Method B: Kill ALL orphaned node.exe (parent dead, not PM2-managed)
    const orphans = getOrphanedNodeProcesses();
    const orphanPids = orphans.map(o => o.pid);

    const toKill = [...new Set([...portZombies, ...orphanPids])];
    if (toKill.length === 0) return;

    // Log with command snippets for visibility
    const details = orphans.filter(o => toKill.includes(o.pid));
    log.warn({ count: toKill.length, portZombies, orphans: details }, 'ZOMBIES DETECTED');

    let killed = 0;
    for (const pid of toKill) {
      if (!canKillZombie()) break;
      if (killPid(pid)) {
        killed++;
        zombieKillCount++;
        zombieKillsThisHour++;
        const detail = details.find(o => o.pid === pid);
        log.warn({ pid, cmd: detail?.cmd }, 'Killed zombie node.exe');
      }
    }

    if (killed > 0) {
      await sendTelegram(
        `*[Watchdog] Zombie cleanup* — killed ${killed} orphaned node.exe. ` +
        `PIDs: ${toKill.slice(0, 10).join(', ')}`
      );
    }
  } catch (err) {
    log.error({ err }, 'Orphan detection error');
  }
}

async function checkDuplicateProcesses() {
  try {
    const pm2Pid = getPm2SelaPid();
    if (!pm2Pid) return;

    // Skip all zombie killing during grace period after sela restart
    if (isSelaInGracePeriod()) {
      log.info('Sela in restart grace period — skipping zombie checks');
      portConflictPids.clear();
      return;
    }

    // Check kill rate limit — prevent runaway kill loops
    if (!canKillZombie()) {
      log.warn({ killsThisHour: zombieKillsThisHour }, 'Zombie kill rate limit reached — skipping');
      return;
    }

    // Method 1: Check log PIDs for 440 conflicts
    const logPath = getTodayLogPath();
    const recentPids = extractRecentPidsFrom440(logPath, 120_000); // last 2 min

    // Method 2: Check netstat for zombie processes holding ws-gateway port 18789
    // Require conflict to persist for 2+ consecutive checks before killing
    const portHolders = findPortHolders(18789);
    const portZombies = portHolders.filter(pid => pid !== pm2Pid);
    const now = Date.now();

    // Clean up stale entries
    for (const [pid] of portConflictPids) {
      if (!portZombies.includes(pid)) portConflictPids.delete(pid);
    }

    if (portZombies.length > 0) {
      for (const zPid of portZombies) {
        if (!portConflictPids.has(zPid)) {
          // First time seeing this conflict — record but don't kill yet
          portConflictPids.set(zPid, now);
          log.warn({ pm2Pid, zombiePid: zPid }, 'Port conflict detected — will kill on next check if persists');
        } else if (now - portConflictPids.get(zPid) >= DUPLICATE_CHECK_INTERVAL_MS) {
          // Persistent conflict — safe to kill
          if (!canKillZombie()) break;
          const killed = killPid(zPid);
          if (killed) {
            zombieKillCount++;
            zombieKillsThisHour++;
            portConflictPids.delete(zPid);
            log.warn({ pid: zPid }, 'Killed zombie sela process (persistent port holder)');
          }
        }
      }
    }

    // Method 3: Kill orphaned node.exe processes (parent PID dead)
    if (canKillZombie()) {
      await killOrphanedNodeProcesses();
    }

    if (recentPids.length < 2) return; // need 2+ PIDs fighting to be a zombie issue

    const zombiePids = recentPids.filter(pid => pid !== pm2Pid);
    if (zombiePids.length === 0) return;

    log.warn({ pm2Pid, zombies: zombiePids }, 'ZOMBIE DETECTED via 440 logs');
    for (const zPid of zombiePids) {
      if (!canKillZombie()) break;
      const killed = killPid(zPid);
      if (killed) {
        zombieKillCount++;
        zombieKillsThisHour++;
        log.warn({ pid: zPid }, 'Killed zombie sela process');
      }
    }

    // Fix stale .ipc-port if a zombie overwrote it
    try {
      if (existsSync(PORT_FILE)) {
        const portData = JSON.parse(readFileSync(PORT_FILE, 'utf-8'));
        if (portData.pid && portData.pid !== pm2Pid) {
          log.warn({ stalePid: portData.pid, expected: pm2Pid }, 'Stale .ipc-port — killing old zombie PID (NOT restarting sela)');
          killPid(portData.pid);
        }
      }
    } catch (e) {
      log.error({ err: e }, 'Failed to fix stale .ipc-port');
    }

    await sendTelegram(
      `*[Watchdog] Zombie sela killed* — ` +
      `${zombiePids.length} duplicate process(es) fighting over WhatsApp. ` +
      `Killed: ${zombiePids.join(', ')}. PM2 pid: ${pm2Pid}`
    );
  } catch (err) {
    log.error({ err }, 'Duplicate check error');
  }
}

// ── Main loop ────────────────────────────────────────────────────────────────
log.info('Started — checking /healthz every 5 min, zombie+orphan scan every 1 min');
await checkHealth(); // immediate first check
await checkDuplicateProcesses();
setInterval(checkHealth, CHECK_INTERVAL_MS);
setInterval(checkDuplicateProcesses, DUPLICATE_CHECK_INTERVAL_MS);
