/**
 * pack-npc-sprites.cjs
 * Communicates with WzImgMCP.exe via MCP JSON-RPC (stdio) to pack
 * all 22 custom NPC stand sprites into v83-img-data/Npc/.
 *
 * Each NPC img: {npcId}.img/stand/0 and stand/1 (two animation frames)
 *
 * Usage: node scripts/pack-npc-sprites.cjs
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXE_PATH = 'C:/Users/rdiol/sela/workspace/WzImg-MCP-Server/WzImgMCP/bin/Debug/net8.0-windows/WzImgMCP.exe';
const IMG_DATA_PATH = 'C:/Users/rdiol/sela/workspace/v83-img-data';
const NPC_SPRITE_DIR = 'C:/Users/rdiol/sela/workspace/maple-sprites/custom-npcs';

// All custom NPC IDs and their names
const CUSTOM_NPCS = [
  { id: '9990010', name: 'Mordecai' },
  { id: '9990011', name: 'Lady Vesper' },
  { id: '9990012', name: 'Bone Oracle' },
  { id: '9990013', name: "Kael'Mortis" },
  { id: '9990014', name: 'Grizelda' },
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
  { id: '9999020', name: 'Frost Warden Kira' },
  { id: '9999021', name: 'Crypt Warden Moros' },
  { id: '9999030', name: 'Sage Instructor Elara' },
  { id: '9999032', name: 'Garvan the Ironsmith' },
  { id: '9999033', name: 'Sera the Arcanist' },
  { id: '9999034', name: 'Brin the Fletchmaster' },
  { id: '9999035', name: 'Mara the Shadowsmith' },
];

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
    clientInfo: { name: 'pack-npc-sprites', version: '1.0' },
  });

  await callTool('init_data_source', { basePath: IMG_DATA_PATH });
  console.log('[pack-npc-sprites] Initialized harepacker data source');

  let totalPacked = 0;
  let totalErrors = 0;

  for (const npc of CUSTOM_NPCS) {
    const npcDir = path.join(NPC_SPRITE_DIR, npc.id);
    const frame0Path = path.join(npcDir, 'stand_0.png');
    const frame1Path = path.join(npcDir, 'stand_1.png');

    if (!fs.existsSync(frame0Path)) {
      console.log(`  [SKIP] ${npc.id} (${npc.name}) — sprites not generated`);
      continue;
    }

    console.log(`\n[pack-npc-sprites] ${npc.id} (${npc.name})...`);

    const imgFile = `${npc.id}.img`;
    const imgPath = path.join(IMG_DATA_PATH, 'npc', imgFile);

    // Create stub if img doesn't exist (copy smallest existing npc img as template)
    if (!fs.existsSync(imgPath)) {
      // Use 0002000.img as minimal stub template
      const stub = path.join(IMG_DATA_PATH, 'npc', '0002000.img');
      if (fs.existsSync(stub)) {
        fs.copyFileSync(stub, imgPath);
        console.log(`  Created stub ${imgFile}`);
      }
    }

    const sizeBefore = fs.existsSync(imgPath) ? fs.statSync(imgPath).size : 0;

    // Parse the img
    try {
      await callTool('parse_image', { category: 'npc', image: imgFile });
    } catch (e) {
      console.log(`  parse_image skipped: ${e.message.slice(0, 80)}`);
    }

    let npcPacked = 0;

    // Add stand SubProperty
    try {
      await callTool('add_property', {
        category: 'npc', image: imgFile,
        parentPath: '', name: 'stand', type: 'SubProperty',
      });
    } catch (e) {
      // May already exist
    }

    // Pack frame 0
    try {
      const frame0B64 = fs.readFileSync(frame0Path).toString('base64');
      await callTool('import_png', {
        category: 'npc', image: imgFile,
        parentPath: 'stand', name: '0',
        base64Png: frame0B64, originX: 40, originY: 80,
      });
      npcPacked++;
    } catch (err) {
      console.error(`  [ERR] frame0: ${err.message.slice(0, 80)}`);
      totalErrors++;
    }

    // Pack frame 1
    if (fs.existsSync(frame1Path)) {
      try {
        const frame1B64 = fs.readFileSync(frame1Path).toString('base64');
        await callTool('import_png', {
          category: 'npc', image: imgFile,
          parentPath: 'stand', name: '1',
          base64Png: frame1B64, originX: 40, originY: 80,
        });
        npcPacked++;
      } catch (err) {
        console.error(`  [ERR] frame1: ${err.message.slice(0, 80)}`);
        totalErrors++;
      }
    }

    // Save
    if (npcPacked > 0) {
      try {
        await callTool('save_image', { category: 'npc', image: imgFile });
        const sizeAfter = fs.existsSync(imgPath) ? fs.statSync(imgPath).size : 0;
        console.log(`  [OK] ${npc.id} — ${sizeBefore} → ${sizeAfter} bytes (${npcPacked} frames)`);
        console.log(`  [SAVED] ${imgFile}`);
        totalPacked++;
      } catch (err) {
        console.error(`  [ERR] save: ${err.message.slice(0, 80)}`);
        totalErrors++;
      }
    }
  }

  console.log(`\n[pack-npc-sprites] Done: ${totalPacked} NPCs packed, ${totalErrors} errors`);
  proc.stdin.end();
  process.exit(totalErrors > 0 && totalPacked === 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('[pack-npc-sprites] Fatal:', err.message);
  process.exit(1);
});
