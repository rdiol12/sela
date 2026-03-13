/**
 * pack-class-selection.cjs — Pack Necromancer + Sage class selection UI assets
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXE_PATH = 'C:/Users/rdiol/sela/workspace/WzImg-MCP-Server/WzImgMCP/bin/Debug/net8.0-windows/WzImgMCP.exe';
const IMG_DATA_PATH = 'C:/Users/rdiol/sela/workspace/npc-wz-img';
const SPRITE_DIR = 'C:/Users/rdiol/sela/workspace/maple-sprites/class-selection';

let msgId = 1;
const pending = new Map();
let proc, buffer = '';

function sendRequest(method, params) {
  return new Promise((resolve, reject) => {
    const id = msgId++;
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    pending.set(id, { resolve, reject });
    proc.stdin.write(msg + '\n');
  });
}
function callTool(name, args) { return sendRequest('tools/call', { name, arguments: args }); }
function handleData(data) {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message || JSON.stringify(msg.error))) : resolve(msg.result);
      }
    } catch (_) {}
  }
}
async function safeCall(name, args) {
  try {
    const res = await callTool(name, args);
    if (res && res.content && Array.isArray(res.content)) {
      const t = res.content.find(c => c.type === 'text');
      if (t) try { return JSON.parse(t.text); } catch (_) { return t.text; }
    }
    return res;
  } catch (e) { return { success: false, error: e.message }; }
}

async function run() {
  proc = spawn(EXE_PATH, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  proc.stderr.on('data', d => process.stderr.write(d));
  proc.stdout.on('data', handleData);

  await sendRequest('initialize', {
    protocolVersion: '2024-11-05', capabilities: {},
    clientInfo: { name: 'pack-class-selection', version: '1.0' }
  });
  await callTool('init_data_source', { basePath: IMG_DATA_PATH });
  console.log('Initialized data source');

  // Parse Login.img
  await safeCall('parse_image', { category: 'ui', image: 'Login.img' });

  const classes = ['necromancer', 'sage'];
  for (const cls of classes) {
    const dir = path.join(SPRITE_DIR, cls);
    if (!fs.existsSync(dir)) { console.log(`  [SKIP] ${cls} — no directory`); continue; }

    // Add class SubProperty under RaceSelect
    await safeCall('add_property', {
      category: 'ui', image: 'Login.img',
      parentPath: 'RaceSelect', name: cls, type: 'SubProperty'
    });

    // Import portrait
    const portraitPath = path.join(dir, 'portrait.png');
    if (fs.existsSync(portraitPath)) {
      const b64 = fs.readFileSync(portraitPath).toString('base64');
      const res = await safeCall('import_png', {
        category: 'ui', image: 'Login.img',
        parentPath: `RaceSelect/${cls}`, name: 'portrait',
        base64Png: b64, originX: 0, originY: 0
      });
      console.log(`  [${res.success !== false ? 'OK' : 'ERR'}] ${cls}/portrait`);
    }

    // Import badge
    const badgePath = path.join(dir, 'badge.png');
    if (fs.existsSync(badgePath)) {
      const b64 = fs.readFileSync(badgePath).toString('base64');
      const res = await safeCall('import_png', {
        category: 'ui', image: 'Login.img',
        parentPath: `RaceSelect/${cls}`, name: 'badge',
        base64Png: b64, originX: 0, originY: 0
      });
      console.log(`  [${res.success !== false ? 'OK' : 'ERR'}] ${cls}/badge`);
    }
  }

  // Save
  const res = await safeCall('save_image', { category: 'ui', image: 'Login.img' });
  console.log(`Save Login.img: ${res.success !== false ? 'OK' : 'ERR: ' + res.error}`);

  proc.stdin.end();
  process.exit(0);
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
