/**
 * pack-wz-binary.cjs — Pack all .img categories into binary .wz files for the client patcher.
 * Uses WzImgMCP.exe to pack the entire img filesystem.
 * Output goes to workspace/v83-client-patched/ with proper casing (Npc.wz, Mob.wz, etc.)
 *
 * Usage: node scripts/pack-wz-binary.cjs
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXE_PATH = 'C:/Users/rdiol/sela/workspace/WzImg-MCP-Server/WzImgMCP/bin/Debug/net8.0-windows/WzImgMCP.exe';
const IMG_DATA_PATH = 'C:/Users/rdiol/sela/workspace/npc-wz-img';
const OUTPUT_DIR = 'C:/Users/rdiol/sela/workspace/v83-client-patched';

// Categories to pack and their proper WZ file casing
const CATEGORIES = [
  'npc', 'mob', 'skill', 'item', 'character', 'ui',
  'string', 'etc', 'map', 'quest', 'reactor',
];

// Map lowercase category → proper WZ file name casing
const WZ_CASING = {
  npc: 'Npc', mob: 'Mob', skill: 'Skill', item: 'Item',
  character: 'Character', ui: 'UI', string: 'String',
  etc: 'Etc', map: 'Map', quest: 'Quest', reactor: 'Reactor',
};

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
function extractResult(res) {
  if (res && res.content && Array.isArray(res.content)) {
    const t = res.content.find(c => c.type === 'text');
    if (t) try { return JSON.parse(t.text); } catch (_) { return t.text; }
  }
  return res;
}

async function run() {
  proc = spawn(EXE_PATH, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  proc.stderr.on('data', d => process.stderr.write(d));
  proc.stdout.on('data', handleData);

  await sendRequest('initialize', {
    protocolVersion: '2024-11-05', capabilities: {},
    clientInfo: { name: 'pack-wz-binary', version: '1.0' }
  });
  await callTool('init_data_source', { basePath: IMG_DATA_PATH });
  console.log('Initialized data source');

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let packed = 0, errors = 0;
  for (const cat of CATEGORIES) {
    const catDir = path.join(IMG_DATA_PATH, cat);
    if (!fs.existsSync(catDir)) {
      console.log(`  [SKIP] ${cat} — no directory`);
      continue;
    }

    try {
      const res = await callTool('pack_to_wz', {
        imgPath: IMG_DATA_PATH,
        outputDir: OUTPUT_DIR,
        category: cat,
        wzVersion: 83,
      });
      const result = extractResult(res);
      const size = result.totalSize || 0;

      // Fix casing: pack_to_wz outputs lowercase, client expects proper case
      const lowName = `${cat}.wz`;
      const properName = `${WZ_CASING[cat] || cat}.wz`;
      const lowPath = path.join(OUTPUT_DIR, lowName);
      const properPath = path.join(OUTPUT_DIR, properName);

      if (lowName !== properName && fs.existsSync(lowPath)) {
        // On Windows, rename is case-insensitive, so rename via temp
        const tmpPath = path.join(OUTPUT_DIR, `_tmp_${properName}`);
        fs.renameSync(lowPath, tmpPath);
        fs.renameSync(tmpPath, properPath);
      }

      console.log(`  [OK] ${properName} (${(size / 1024 / 1024).toFixed(1)} MB)`);
      packed++;
    } catch (err) {
      console.log(`  [ERR] ${cat}: ${err.message.slice(0, 100)}`);
      errors++;
    }
  }

  console.log(`\nPacked: ${packed}/${CATEGORIES.length}, Errors: ${errors}`);
  proc.stdin.end();
  process.exit(errors > 0 && packed === 0 ? 1 : 0);
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
