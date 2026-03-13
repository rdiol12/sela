// Project-scoped agent loop page — same layout as /agent but filtered to a single project
export function projectAgentHtml(projectId, projectTitle) {
  const eId = projectId.replace(/'/g, "\\'").replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const eTitle = (projectTitle || 'Project').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#0a0a0f">
<title>${eTitle} — Agent Loop</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='14' font-size='14'>&#x1f504;</text></svg>">
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Syne:wght@400;500;700;800&display=swap');

  :root {
    --bg: #0a0a0f;
    --surface: #111118;
    --surface2: #16161f;
    --border: #1e1e2e;
    --border2: #2a2a3e;
    --text: #e2e2f0;
    --text2: #8888aa;
    --text3: #444466;
    --accent: #7c6af7;
    --accent2: #a78bfa;
    --green: #22d3a0;
    --yellow: #f59e0b;
    --red: #f43f5e;
    --cyan: #22d3ee;
    --font-display: 'Syne', sans-serif;
    --font-mono: 'JetBrains Mono', monospace;
    --radius: 8px;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.6;
    min-height: 100vh;
    overflow-x: hidden;
  }

  body::before {
    content: '';
    position: fixed;
    inset: 0;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");
    pointer-events: none;
    z-index: -1;
    opacity: 0.35;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 24px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    position: sticky;
    top: 0;
    z-index: 100;
  }

  .header-left { display: flex; align-items: center; gap: 12px; }

  .logo {
    width: 30px; height: 30px;
    background: linear-gradient(135deg, var(--accent), var(--cyan));
    border-radius: 7px;
    display: flex; align-items: center; justify-content: center;
    font-family: var(--font-display);
    font-weight: 800; font-size: 15px; color: white;
    box-shadow: 0 0 16px rgba(124,106,247,0.35);
  }

  .header-title { font-family: var(--font-display); font-weight: 700; font-size: 16px; letter-spacing: -0.3px; text-transform: capitalize; }
  .header-sub { color: var(--text3); font-size: 10px; margin-top: 1px; }
  .header-right { display: flex; align-items: center; gap: 14px; }

  .back-link {
    background: var(--surface2); border: 1px solid var(--border);
    color: var(--text2); padding: 5px 12px; border-radius: var(--radius);
    cursor: pointer; font-family: var(--font-mono); font-size: 11px;
    transition: all 0.15s; text-decoration: none; display: flex; align-items: center; gap: 5px;
  }
  .back-link:hover { border-color: var(--accent); color: var(--accent2); }

  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  @keyframes fadeUp { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }

  .layout {
    position: relative;
    height: calc(100vh - 61px);
  }

  .panel-left {
    position: absolute;
    top: 0; left: 0; bottom: 0;
    width: 340px;
    overflow-y: scroll;
    padding: 16px;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .panel-right {
    position: absolute;
    top: 0; left: 340px; right: 0; bottom: 0;
    overflow-y: scroll;
    padding: 16px;
  }

  .panel-left::-webkit-scrollbar, .panel-right::-webkit-scrollbar { width: 5px; }
  .panel-left::-webkit-scrollbar-track, .panel-right::-webkit-scrollbar-track { background: transparent; }
  .panel-left::-webkit-scrollbar-thumb, .panel-right::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }
  .panel-left::-webkit-scrollbar-thumb:hover, .panel-right::-webkit-scrollbar-thumb:hover { background: var(--text3); }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    animation: fadeUp 0.3s ease;
    flex-shrink: 0;
  }

  .card-header {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text2);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .card-body { padding: 14px; }

  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .badge-green { background: rgba(34,211,160,0.15); color: var(--green); }
  .badge-yellow { background: rgba(245,158,11,0.15); color: var(--yellow); }
  .badge-red { background: rgba(244,63,94,0.15); color: var(--red); }
  .badge-gray { background: rgba(136,136,170,0.1); color: var(--text2); }

  .metrics {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .metric {
    background: var(--surface2);
    border-radius: 6px;
    padding: 10px 12px;
  }

  .metric-label { color: var(--text3); font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
  .metric-value { font-size: 20px; font-weight: 700; margin-top: 2px; }
  .metric-value.accent { color: var(--accent2); }
  .metric-value.green { color: var(--green); }
  .metric-value.yellow { color: var(--yellow); }
  .metric-value.cyan { color: var(--cyan); }

  .signal-list { display: flex; flex-direction: column; gap: 8px; }

  .signal-item {
    background: var(--surface2);
    border-radius: 6px;
    padding: 8px 12px;
    border-left: 3px solid var(--text3);
  }
  .signal-item.high { border-left-color: var(--red); }
  .signal-item.medium { border-left-color: var(--yellow); }
  .signal-item.low { border-left-color: var(--text3); }

  .signal-type { font-size: 10px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.5px; }
  .signal-summary { font-size: 12px; margin-top: 2px; }

  .followup-item {
    background: var(--surface2);
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 12px;
  }
  .followup-topic { color: var(--text); }
  .followup-time { color: var(--text3); font-size: 10px; margin-top: 2px; }

  .event-entry {
    background: var(--surface2);
    border-radius: 6px;
    padding: 10px 12px;
    display: flex;
    gap: 10px;
    align-items: flex-start;
    animation: fadeUp 0.2s ease;
  }

  .event-icon {
    width: 24px; height: 24px;
    border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px;
    flex-shrink: 0;
    margin-top: 1px;
  }
  .event-icon.start { background: rgba(124,106,247,0.2); color: var(--accent2); }
  .event-icon.signals { background: rgba(34,211,238,0.2); color: var(--cyan); }
  .event-icon.skip { background: rgba(136,136,170,0.15); color: var(--text2); }
  .event-icon.phase2 { background: rgba(245,158,11,0.2); color: var(--yellow); }
  .event-icon.complete { background: rgba(34,211,160,0.2); color: var(--green); }
  .event-icon.error { background: rgba(244,63,94,0.2); color: var(--red); }

  .event-content { flex: 1; min-width: 0; }
  .event-title { font-size: 12px; font-weight: 500; }
  .event-detail { font-size: 11px; color: var(--text2); margin-top: 2px; }
  .event-time { font-size: 10px; color: var(--text3); flex-shrink: 0; }

  .empty-state { color: var(--text3); font-size: 12px; text-align: center; padding: 24px; }

  .status-row {
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 12px;
  }

  .status-dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--green); box-shadow: 0 0 7px var(--green);
    animation: pulse 2s ease-in-out infinite;
  }
  .status-dot.stopped { background: var(--red); box-shadow: 0 0 7px var(--red); animation: none; }
  .status-dot.idle { background: var(--yellow); box-shadow: 0 0 7px var(--yellow); }

  .timing-info { color: var(--text3); font-size: 11px; margin-top: 8px; }

  .clear-btn {
    background: none; border: 1px solid var(--border);
    color: var(--text3); padding: 2px 8px; border-radius: 4px;
    cursor: pointer; font-family: var(--font-mono); font-size: 10px;
    transition: all 0.15s;
  }
  .clear-btn:hover { border-color: var(--red); color: var(--red); }

  .prompt-link { color: var(--cyan); cursor: pointer; text-decoration: underline; }
  .prompt-link:hover { color: var(--accent); }
  .prompt-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 1000; display: flex; align-items: center; justify-content: center; }
  .prompt-modal { background: var(--surface); border: 1px solid var(--border2); border-radius: 10px; width: 90vw; max-width: 800px; max-height: 80vh; display: flex; flex-direction: column; }
  .prompt-modal-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--border2); }
  .prompt-modal-header h3 { margin: 0; font-size: 14px; }
  .prompt-modal-close { background: none; border: none; color: var(--text2); font-size: 18px; cursor: pointer; padding: 4px 8px; }
  .prompt-modal-close:hover { color: var(--text); }
  .prompt-modal-body { padding: 16px; overflow-y: auto; flex: 1; }
  .prompt-modal-body pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.5; color: var(--text); }

  @media (max-width: 900px) {
    .layout { height: auto; }
    .panel-left { position: static; width: 100%; overflow-y: visible; border-right: none; border-bottom: 1px solid var(--border); }
    .panel-right { position: static; overflow-y: visible; }
  }
</style>
</head>
<body>

<header class="header">
  <div class="header-left">
    <div class="logo">&loz;</div>
    <div>
      <div class="header-title">${eTitle} Agent Loop</div>
      <div class="header-sub">project cycle monitor</div>
    </div>
  </div>
  <div class="header-right">
    <a href="/agent" class="back-link">&larr; Agent</a>
    <a href="/" class="back-link">&larr; Dashboard</a>
  </div>
</header>

<div class="layout">
  <!-- Left panel: Status -->
  <div class="panel-left">

    <div class="card" style="text-align:center">
      <div class="card-header">Next Cycle</div>
      <div class="card-body" style="padding:12px 8px">
        <div id="countdownValue" style="font-size:32px;font-weight:700;font-family:monospace;color:var(--cyan);letter-spacing:2px">--:--</div>
        <div id="countdownLabel" style="font-size:11px;color:var(--text3);margin-top:4px"></div>
        <button id="runNowBtn" onclick="triggerProjectCycleNow()" style="margin-top:10px;padding:6px 20px;border-radius:6px;border:1px solid var(--green);background:transparent;color:var(--green);cursor:pointer;font-family:var(--font-mono);font-size:12px;font-weight:600;transition:all 0.15s;letter-spacing:0.3px">&#9654; Run Now</button>
        <button id="pauseBtn" onclick="togglePause()" style="margin-top:6px;padding:6px 20px;border-radius:6px;border:1px solid var(--yellow);background:transparent;color:var(--yellow);cursor:pointer;font-family:var(--font-mono);font-size:12px;font-weight:600;transition:all 0.15s;letter-spacing:0.3px">&#10074;&#10074; Pause</button>
      </div>
    </div>

    <div class="card">
      <div class="card-header">Cycle Status</div>
      <div class="card-body">
        <div class="status-row">
          <div class="status-dot idle" id="loopDot"></div>
          <span id="loopStatusLabel" class="badge badge-gray">loading</span>
        </div>
        <div class="metrics">
          <div class="metric">
            <div class="metric-label">Cycles</div>
            <div class="metric-value accent" id="metCycles">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">Interval</div>
            <div class="metric-value cyan" id="metInterval">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">Consec. Spawns</div>
            <div class="metric-value yellow" id="metSpawns">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">Process</div>
            <div class="metric-value green" id="metProcess">-</div>
          </div>
        </div>
        <div class="metrics" style="margin-top:6px">
          <div class="metric">
            <div class="metric-label">Last Cycle Tokens</div>
            <div class="metric-value cyan" id="metCycleTokens">-</div>
          </div>
          <div class="metric">
            <div class="metric-label">Last Model</div>
            <div class="metric-value green" id="metLastModel">-</div>
          </div>
        </div>
        <div class="timing-info" id="timingInfo"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">Last Signals <span id="signalCount" class="badge badge-gray">0</span></div>
      <div class="card-body">
        <div class="signal-list" id="signalList">
          <div class="empty-state">No signals collected yet</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">Pending Followups <span id="followupCount" class="badge badge-gray">0</span></div>
      <div class="card-body">
        <div id="followupList">
          <div class="empty-state">No followups queued</div>
        </div>
      </div>
    </div>

  </div>

  <!-- Right panel: Event Log -->
  <div class="panel-right">
    <div class="card-header" style="position:sticky;top:-16px;background:var(--surface);z-index:10;margin:-16px -16px 10px;padding:10px 14px;border-bottom:1px solid var(--border)">
      Event Log
      <button class="clear-btn" onclick="clearLog()">Clear</button>
    </div>
    <div id="eventLog" style="display:flex;flex-direction:column;gap:6px">
      <div class="empty-state">Waiting for project cycle events&hellip;</div>
    </div>
  </div>
</div>

<script>
var PROJECT_ID = '${eId}';
var MAX_LOG_ENTRIES = 50;
var eventLog = [];
var _seenEventKeys = {};
var wsConn = null;
var wsRetry = 0;
var _nextCycleAt = null;
var _cycleRunning = false;

var EVENT_CONFIG = {
  'project:cycle:start':    { icon: '&#9654;', cls: 'start',    title: 'Cycle Started' },
  'project:cycle:skip':     { icon: '&#8212;', cls: 'skip',     title: 'Cycle Skipped' },
  'project:cycle:phase2':   { icon: '&#9881;', cls: 'phase2',   title: 'Claude Spawn' },
  'project:cycle:actions':  { icon: '&#9889;', cls: 'complete', title: 'Actions Taken' },
  'project:cycle:complete': { icon: '&#10003;', cls: 'complete', title: 'Cycle Complete' },
  'project:cycle:error':    { icon: '&#10007;', cls: 'error',   title: 'Cycle Error' },
};

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: (window.__SELA_TZ||'UTC') });
}

function timeAgo(iso) {
  if (!iso) return 'never';
  var diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return Math.round(diff / 1000) + 's ago';
  if (diff < 3600000) return Math.round(diff / 60000) + 'm ago';
  return Math.round(diff / 3600000) + 'h ago';
}

function escHtml(s) {
  var d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function eventDetail(event, data) {
  switch (event) {
    case 'project:cycle:start': return 'Cycle #' + (data.cycleCount || '?');
    case 'project:cycle:skip': return (data.reason || 'unknown').replace(/_/g, ' ');
    case 'project:cycle:phase2': {
      var promptCycle = data.promptFile ? (data.promptFile.match(/cycle-(\\d+)-prompt/) || [])[1] : '';
      return (data.model || '?') + ' | <span class="prompt-link" onclick="viewPrompt(this)" data-cycle="' + escHtml(promptCycle || '') + '" data-project="' + escHtml(data.project || PROJECT_ID) + '">' + (data.promptLen || 0) + ' chars</span> | $' + (data.costUsd || 0).toFixed(4);
    }
    case 'project:cycle:actions': {
      var ac = data.cycleCount || (data.replyFile ? (data.replyFile.match(/cycle-(\\d+)-reply/) || [])[1] : '');
      return ((data.actions || []).join('; ') || 'No actions') +
        (ac ? ' <span class="prompt-link" onclick="viewReply(this)" data-cycle="' + ac + '" data-project="' + escHtml(data.project || PROJECT_ID) + '">view reply</span>' : '');
    }
    case 'project:cycle:complete': {
      var rc = data.cycleCount || (data.replyFile ? (data.replyFile.match(/cycle-(\\d+)-reply/) || [])[1] : '');
      return '#' + (data.cycleCount || '?') + ' | ' + (data.actionCount || 0) + ' actions | ' + (data.followupCount || 0) + ' followups' +
        (rc ? ' | <span class="prompt-link" onclick="viewReply(this)" data-cycle="' + rc + '" data-project="' + escHtml(data.project || PROJECT_ID) + '">view reply</span>' : '');
    }
    case 'project:cycle:error': return data.error || 'Unknown error';
    default: return JSON.stringify(data);
  }
}

function updateStatus(d) {
  if (!d) return;

  _nextCycleAt = d.nextCycleAt ? new Date(d.nextCycleAt).getTime() : null;
  _cycleRunning = d.running;
  tickCountdown();

  try {
    // Sync pause state
    _projectPaused = !!d.paused;
    updatePauseBtn();

    var dot = document.getElementById('loopDot');
    var label = document.getElementById('loopStatusLabel');
    if (d.paused) {
      dot.className = 'status-dot idle';
      label.textContent = 'paused';
      label.className = 'badge badge-yellow';
    } else if (d.running) {
      dot.className = 'status-dot';
      label.textContent = 'active';
      label.className = 'badge badge-green';
    } else {
      dot.className = 'status-dot idle';
      label.textContent = 'idle';
      label.className = 'badge badge-yellow';
    }

    document.getElementById('metCycles').textContent = d.cycleCount || 0;
    document.getElementById('metInterval').textContent = (d.intervalMin || '?') + 'min';
    document.getElementById('metSpawns').textContent = d.consecutiveSpawns || 0;

    var proc = d.process;
    if (proc) {
      document.getElementById('metProcess').textContent = proc.alive ? 'alive (' + (proc.messageCount || 0) + ' msgs)' : 'dead';
    } else {
      document.getElementById('metProcess').textContent = 'n/a';
    }

    // Last cycle tokens
    var lct = d.lastCycleTokens;
    if (lct) {
      var totalTok = (lct.input || 0) + (lct.output || 0);
      document.getElementById('metCycleTokens').textContent = (totalTok / 1000).toFixed(1) + 'K';
      document.getElementById('metLastModel').textContent = lct.model || '-';
    }

    var parts = [];
    if (d.lastCycleAt) parts.push('Last: ' + timeAgo(d.lastCycleAt));
    if (lct && lct.costUsd) parts.push('Cost: $' + lct.costUsd.toFixed(4));
    document.getElementById('timingInfo').innerHTML = parts.join(' &middot; ');

    // Signals
    var sigs = d.lastSignals || [];
    document.getElementById('signalCount').textContent = sigs.length;
    var sl = document.getElementById('signalList');
    if (sigs.length === 0) {
      sl.innerHTML = '<div class="empty-state">No signals collected yet</div>';
    } else {
      sl.innerHTML = sigs.map(function(s) {
        return '<div class="signal-item ' + (s.urgency || 'low') + '">' +
          '<div class="signal-type">' + escHtml(s.type) + ' <span class="badge badge-' +
          (s.urgency === 'high' ? 'red' : s.urgency === 'medium' ? 'yellow' : 'gray') + '">' +
          (s.urgency || 'low') + '</span></div>' +
          '<div class="signal-summary">' + escHtml(s.summary) + '</div></div>';
      }).join('');
    }

    // Followups
    var fups = d.pendingFollowups || [];
    document.getElementById('followupCount').textContent = fups.length;
    var fl = document.getElementById('followupList');
    if (fups.length === 0) {
      fl.innerHTML = '<div class="empty-state">No followups queued</div>';
    } else {
      fl.innerHTML = fups.map(function(f) {
        return '<div class="followup-item"><div class="followup-topic">' + escHtml(f.topic || f) + '</div>' +
          '<div class="followup-time">' + (f.createdAt ? timeAgo(new Date(f.createdAt).toISOString()) : '') + '</div></div>';
      }).join('');
    }
  } catch (err) { console.warn('updateStatus error:', err); }
}

// --- Event log ---
function addEvent(event, ts, data) {
  var cfg = EVENT_CONFIG[event];
  if (!cfg) return;
  var key = event + ':' + Math.floor(ts / 1000);
  if (_seenEventKeys[key]) return;
  _seenEventKeys[key] = true;
  eventLog.unshift({ event: event, ts: ts, data: data });
  if (eventLog.length > MAX_LOG_ENTRIES) eventLog.length = MAX_LOG_ENTRIES;
  renderLog();
}

function renderLog() {
  var el = document.getElementById('eventLog');
  if (eventLog.length === 0) {
    el.innerHTML = '<div class="empty-state">Waiting for project cycle events&hellip;</div>';
    return;
  }
  el.innerHTML = eventLog.map(function(e) {
    var cfg = EVENT_CONFIG[e.event] || { icon: '?', cls: 'skip', title: e.event };
    return '<div class="event-entry">' +
      '<div class="event-icon ' + cfg.cls + '">' + cfg.icon + '</div>' +
      '<div class="event-content">' +
        '<div class="event-title">' + cfg.title + '</div>' +
        '<div class="event-detail">' + (['project:cycle:phase2','project:cycle:actions','project:cycle:complete'].indexOf(e.event) !== -1 ? eventDetail(e.event, e.data) : escHtml(eventDetail(e.event, e.data))) + '</div>' +
      '</div>' +
      '<div class="event-time">' + formatTime(e.ts) + '</div>' +
    '</div>';
  }).join('');
}

function showPromptModal(title, content) {
  var overlay = document.createElement('div');
  overlay.className = 'prompt-overlay';
  overlay.onclick = function(ev) { if (ev.target === overlay) overlay.remove(); };
  overlay.innerHTML =
    '<div class="prompt-modal">' +
      '<div class="prompt-modal-header">' +
        '<h3>' + escHtml(title) + '</h3>' +
        '<button class="prompt-modal-close" id="promptCloseBtn">&times;</button>' +
      '</div>' +
      '<div class="prompt-modal-body"><pre>' + escHtml(content || '') + '</pre></div>' +
    '</div>';
  document.body.appendChild(overlay);
  document.getElementById('promptCloseBtn').onclick = function() { overlay.remove(); };
}

function viewPrompt(el) {
  var cycle = el.getAttribute('data-cycle');
  var project = el.getAttribute('data-project') || PROJECT_ID;
  if (!cycle || !project) return;
  fetch('/api/cycle-diffs/project/' + encodeURIComponent(project) + '/' + cycle + '/prompt')
    .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(data) {
      if (data.error) { alert('Prompt not found: ' + data.error); return; }
      showPromptModal('[' + project + '] Cycle ' + cycle + ' Prompt (' + (data.prompt || '').length + ' chars)', data.prompt || '');
    })
    .catch(function(err) { alert('Failed to load prompt: ' + err.message); });
}

function viewReply(el) {
  var cycle = el.getAttribute('data-cycle');
  var project = el.getAttribute('data-project') || PROJECT_ID;
  if (!cycle || !project) return;
  fetch('/api/cycle-diffs/project/' + encodeURIComponent(project) + '/' + cycle + '/reply')
    .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(data) {
      if (data.error) { alert('Reply not found: ' + data.error); return; }
      showPromptModal('[' + project + '] Cycle ' + cycle + ' Reply (' + (data.reply || '').length + ' chars)', data.reply || '');
    })
    .catch(function(err) { alert('Failed to load reply: ' + err.message); });
}

function clearLog() {
  eventLog.length = 0;
  _seenEventKeys = {};
  renderLog();
}

// --- Countdown ---
function tickCountdown() {
  var val = document.getElementById('countdownValue');
  var lbl = document.getElementById('countdownLabel');
  var btn = document.getElementById('runNowBtn');
  if (!val) return;
  if (_cycleRunning) {
    val.textContent = 'RUNNING';
    val.style.color = 'var(--green)';
    if (lbl) lbl.textContent = 'cycle in progress';
    if (btn) { btn.disabled = true; btn.textContent = 'Running...'; btn.style.opacity = '0.5'; }
    return;
  }
  if (btn && btn.textContent === 'Running...') {
    btn.disabled = false; btn.innerHTML = '&#9654; Run Now'; btn.style.opacity = '1';
    btn.style.borderColor = 'var(--green)'; btn.style.color = 'var(--green)';
  }
  if (!_nextCycleAt) { val.textContent = '--:--'; if (lbl) lbl.textContent = ''; return; }
  var diff = Math.round((_nextCycleAt - Date.now()) / 1000);
  if (diff <= 0) {
    val.textContent = '0:00';
    val.style.color = 'var(--green)';
    if (lbl) lbl.textContent = 'starting...';
    return;
  }
  var m = Math.floor(diff / 60), s = diff % 60;
  val.textContent = m + ':' + (s < 10 ? '0' : '') + s;
  val.style.color = diff < 60 ? 'var(--green)' : 'var(--cyan)';
  if (lbl) lbl.textContent = '';
}

// --- Trigger project cycle now ---
function triggerProjectCycleNow() {
  var btn = document.getElementById('runNowBtn');
  if (_cycleRunning) return;
  btn.disabled = true;
  btn.textContent = 'Triggering...';
  btn.style.opacity = '0.5';
  fetch('/api/agent-loop/projects/' + encodeURIComponent(PROJECT_ID) + '/trigger', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.triggered) {
        _cycleRunning = true;
        tickCountdown();
        loadDetail();
        setTimeout(loadDetail, 2000);
        setTimeout(loadDetail, 5000);
      } else {
        btn.textContent = data.reason === 'cycle_already_running' ? 'Already running' : 'Failed';
        btn.style.borderColor = 'var(--yellow)';
        btn.style.color = 'var(--yellow)';
        setTimeout(function() {
          btn.disabled = false; btn.innerHTML = '&#9654; Run Now'; btn.style.opacity = '1';
          btn.style.borderColor = 'var(--green)'; btn.style.color = 'var(--green)';
        }, 2000);
      }
    })
    .catch(function() {
      btn.textContent = 'Error';
      btn.style.borderColor = 'var(--red)';
      btn.style.color = 'var(--red)';
      setTimeout(function() {
        btn.disabled = false; btn.innerHTML = '&#9654; Run Now'; btn.style.opacity = '1';
        btn.style.borderColor = 'var(--green)'; btn.style.color = 'var(--green)';
      }, 2000);
    });
}

// --- WebSocket ---
function connectWs() {
  var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  wsConn = new WebSocket(proto + '//' + location.host + '/ws');
  wsConn.onopen = function() { wsRetry = 0; };
  wsConn.onmessage = function(e) {
    try {
      var msg = JSON.parse(e.data);
      // Filter project events for this project only
      if (msg.type === 'event' && msg.event && msg.event.startsWith('project:cycle:')) {
        if (msg.data && msg.data.project === PROJECT_ID) {
          addEvent(msg.event, msg.ts, msg.data || {});
        }
      }
    } catch (err) { /* ignore */ }
  };
  wsConn.onclose = function() {
    var delay = Math.min(1000 * Math.pow(2, wsRetry), 30000);
    wsRetry++;
    setTimeout(connectWs, delay);
  };
  wsConn.onerror = function() {};
}

// --- REST poll ---
function loadDetail() {
  fetch('/api/agent-loop/projects/' + encodeURIComponent(PROJECT_ID))
    .then(function(r) { if (r.status === 401) { location.href = '/login'; return null; } if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(data) {
      if (!data || data.error) return;
      updateStatus(data);
      // Merge events
      if (Array.isArray(data.recentEvents)) {
        var added = false;
        data.recentEvents.forEach(function(ev) {
          var cfg = EVENT_CONFIG[ev.event];
          if (!cfg) return;
          var key = ev.event + ':' + Math.floor(ev.ts / 1000);
          if (!_seenEventKeys[key]) {
            _seenEventKeys[key] = true;
            eventLog.push({ event: ev.event, ts: ev.ts, data: ev.data || {} });
            added = true;
          }
        });
        if (added) {
          eventLog.sort(function(a, b) { return b.ts - a.ts; });
          if (eventLog.length > MAX_LOG_ENTRIES) eventLog.length = MAX_LOG_ENTRIES;
          renderLog();
        }
      }
    })
    .catch(function(err) { console.warn('loadDetail failed:', err.message); });
}

// --- Pause / Resume ---
var _projectPaused = false;
function updatePauseBtn() {
  var btn = document.getElementById('pauseBtn');
  if (!btn) return;
  if (_projectPaused) {
    btn.innerHTML = '&#9654; Resume';
    btn.style.borderColor = 'var(--green)';
    btn.style.color = 'var(--green)';
  } else {
    btn.innerHTML = '&#10074;&#10074; Pause';
    btn.style.borderColor = 'var(--yellow)';
    btn.style.color = 'var(--yellow)';
  }
}
function togglePause() {
  var btn = document.getElementById('pauseBtn');
  btn.disabled = true;
  btn.style.opacity = '0.5';
  var action = _projectPaused ? 'resume' : 'pause';
  fetch('/api/agent-loop/projects/' + encodeURIComponent(PROJECT_ID) + '/' + action, { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      _projectPaused = data.paused;
      updatePauseBtn();
      btn.disabled = false;
      btn.style.opacity = '1';
      loadDetail();
    })
    .catch(function() {
      btn.disabled = false;
      btn.style.opacity = '1';
    });
}

// --- Init ---
connectWs();
loadDetail();
setInterval(loadDetail, 5000);
setInterval(tickCountdown, 1000);
</script>
</body>
</html>`;
}
