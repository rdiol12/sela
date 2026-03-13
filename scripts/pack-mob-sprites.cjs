/**
 * pack-mob-sprites.cjs
 * Communicates with WzImgMCP.exe via MCP JSON-RPC (stdio) to pack
 * all custom dungeon mob sprites into v83-img-data/Mob/.
 *
 * Mobs:
 *   9901001 — Crypt Shade (stand:2, move:4, hit1:2, die1:3, attack1:3)
 *   9901002 — The Lich   (stand:3, move:4, hit1:2, die1:4, attack1:3, attack2:4)
 *
 * Usage: node scripts/pack-mob-sprites.cjs
 */

'use strict';

const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');

const EXE_PATH    = 'C:/Users/rdiol/sela/workspace/WzImg-MCP-Server/WzImgMCP/bin/Debug/net8.0-windows/WzImgMCP.exe';
const IMG_DATA    = 'C:/Users/rdiol/sela/workspace/v83-img-data';
const SPRITE_DIR  = 'C:/Users/rdiol/sela/workspace/maple-sprites/mobs';

// Mob definitions: id → { states: { stateName: frameCount } }
const CUSTOM_MOBS = [
  {
    id: '9901001',
    name: 'Crypt Shade',
    states: { stand: 2, move: 4, hit1: 2, die1: 3, attack1: 3 },
  },
  {
    id: '9901002',
    name: 'The Lich',
    states: { stand: 3, move: 4, hit1: 2, die1: 4, attack1: 3, attack2: 4 },
  },
];

let msgId  = 1;
const pending = new Map();
let proc;
let buffer = '';

function sendRequest(method, params) {
  return new Promise((resolve, reject) => {
    const id  = msgId++;
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    pending.set(id, { resolve, reject });
    proc.stdin.write(msg + '\n');
  });
}

function callTool(toolName, toolArgs) {
  return sendRequest('tools/call', { name: toolName, arguments: toolArgs });
}

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
        if (msg.error) {
          reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        } else {
          resolve(msg.result);
        }
      }
    } catch (e) {
      // ignore non-JSON lines (startup banner, etc.)
    }
  }
}

async function run() {
  // Start WzImgMCP process
  proc = spawn(EXE_PATH, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  proc.stdout.on('data', handleData);
  proc.stderr.on('data', d => process.stderr.write(d));
  proc.on('error', err => { console.error('WzImgMCP spawn error:', err.message); process.exit(1); });

  // Wait for process to be ready
  await new Promise(r => setTimeout(r, 1500));

  // Initialize MCP
  await sendRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'pack-mob-sprites', version: '1.0.0' },
  });

  // Initialize data source
  await callTool('init_data_source', { path: IMG_DATA });
  console.log(`[pack-mob-sprites] Data source initialized: ${IMG_DATA}`);

  let totalPacked = 0;
  let totalFailed = 0;

  for (const mob of CUSTOM_MOBS) {
    console.log(`\n[${mob.name}] (${mob.id})`);

    for (const [state, frameCount] of Object.entries(mob.states)) {
      for (let frame = 0; frame < frameCount; frame++) {
        const pngPath = path.join(SPRITE_DIR, mob.id, `${state}_${frame}.png`);

        if (!fs.existsSync(pngPath)) {
          console.warn(`  SKIP  ${state}/${frame} — PNG not found at ${pngPath}`);
          totalFailed++;
          continue;
        }

        const pngBuf = fs.readFileSync(pngPath);
        const b64    = pngBuf.toString('base64');

        // WZ path: {mobId}.img/{state}/{frame}
        const imgPath = `${mob.id}.img/${state}/${frame}`;

        try {
          await callTool('set_canvas_bitmap', {
            imagePath: imgPath,
            bitmapData: b64,
          });
          console.log(`  OK    ${imgPath}`);
          totalPacked++;
        } catch (err) {
          console.error(`  FAIL  ${imgPath}: ${err.message}`);
          totalFailed++;
        }
      }
    }
  }

  console.log(`\n[pack-mob-sprites] Done: ${totalPacked} packed, ${totalFailed} failed/skipped`);

  proc.stdin.end();
  proc.kill();
  process.exit(totalFailed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal:', err);
  if (proc) proc.kill();
  process.exit(1);
});
