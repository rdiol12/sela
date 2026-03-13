/**
 * pack-sage-wz.cjs
 * Communicates with WzImgMCP.exe via MCP JSON-RPC (stdio) to batch-inject
 * all Sage class skill icons into 600.img, 610.img, 611.img, 612.img.
 *
 * Usage: node scripts/pack-sage-wz.cjs
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXE_PATH = 'C:/Users/rdiol/sela/workspace/WzImg-MCP-Server/WzImgMCP/bin/Debug/net8.0-windows/WzImgMCP.exe';
const IMG_DATA_PATH = 'C:/Users/rdiol/sela/workspace/v83-img-data';
const ICONS_PATH = 'C:/Users/rdiol/sela/workspace/maple-sprites/sage/icons_b64.json';

const JOB_SKILLS = {
  '600.img': ['6001000', '6001001', '6001002', '6001003', '6001004', '6001005'],
  '610.img': ['6101000', '6101001', '6101002', '6101003', '6101004', '6101005', '6101006', '6101007'],
  '611.img': ['6111000', '6111001', '6111002', '6111003', '6111004', '6111005', '6111006', '6111007'],
  '612.img': ['6121000', '6121001', '6121002', '6121003', '6121004', '6121005', '6121006', '6121007', '6121008', '6121009'],
};

const icons = JSON.parse(fs.readFileSync(ICONS_PATH, 'utf8'));
console.log(`[pack-sage-wz] Loaded ${Object.keys(icons).length} skill icons`);

let msgId = 1;
const pending = new Map();
let proc;
let buffer = '';

function sendRequest(method, params) {
  return new Promise((resolve, reject) => {
    const id = msgId++;
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    pending.set(id, { resolve, reject });
    proc.stdin.write(msg + '\n');
  });
}

function callTool(toolName, toolArgs) {
  return sendRequest('tools/call', {
    name: toolName,
    arguments: toolArgs,
  });
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
    } catch (_) {}
  }
}

async function run() {
  proc = spawn(EXE_PATH, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  proc.stderr.on('data', (d) => process.stderr.write(d));
  proc.stdout.on('data', handleData);
  proc.on('error', (err) => { console.error('Process error:', err.message); process.exit(1); });

  await sendRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'pack-sage-wz', version: '1.0' },
  });

  await callTool('init_data_source', { basePath: IMG_DATA_PATH });
  console.log('[pack-sage-wz] Initialized harepacker data source');

  let totalPacked = 0;
  let totalErrors = 0;

  for (const [imgFile, skillIds] of Object.entries(JOB_SKILLS)) {
    console.log(`\n[pack-sage-wz] Processing ${imgFile} (${skillIds.length} skills)...`);

    // Check size before
    const imgPath = path.join(IMG_DATA_PATH, 'skill', imgFile);
    const sizeBefore = fs.existsSync(imgPath) ? fs.statSync(imgPath).size : 0;
    console.log(`  Size before: ${sizeBefore} bytes${sizeBefore === 0 ? ' (NEW FILE)' : ''}`);

    try {
      await callTool('parse_image', { category: 'skill', image: imgFile });
    } catch (e) {
      console.log(`  parse_image skipped: ${e.message}`);
    }

    for (const skillId of skillIds) {
      const iconB64 = icons[skillId];
      if (!iconB64) {
        console.error(`  [WARN] No icon for ${skillId}`);
        totalErrors++;
        continue;
      }

      try {
        await callTool('add_property', {
          category: 'skill', image: imgFile,
          parentPath: 'skill', name: skillId, type: 'SubProperty',
        });

        for (const iconName of ['icon', 'iconMouseOver', 'iconDisabled']) {
          await callTool('import_png', {
            category: 'skill', image: imgFile,
            parentPath: `skill/${skillId}`, name: iconName,
            base64Png: iconB64, originX: 0, originY: 32,
          });
        }

        console.log(`  [OK] ${skillId} packed`);
        totalPacked++;
      } catch (err) {
        console.error(`  [ERR] ${skillId}: ${err.message}`);
        totalErrors++;
      }
    }

    try {
      await callTool('save_image', { category: 'skill', image: imgFile });
      const sizeAfter = fs.existsSync(imgPath) ? fs.statSync(imgPath).size : 0;
      console.log(`  [SAVED] ${imgFile} — ${sizeBefore} → ${sizeAfter} bytes`);
    } catch (err) {
      console.error(`  [ERR] save_image ${imgFile}: ${err.message}`);
      totalErrors++;
    }
  }

  console.log(`\n[pack-sage-wz] Done: ${totalPacked} skills packed, ${totalErrors} errors`);
  proc.stdin.end();
  process.exit(totalErrors > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('[pack-sage-wz] Fatal:', err.message);
  process.exit(1);
});
