/**
 * harepacker-batch-pack.cjs
 * Communicates with WzImgMCP.exe via MCP JSON-RPC (stdio) to batch-inject
 * all Necromancer skill icons into 710.img, 711.img, 712.img.
 *
 * Usage: node scripts/harepacker-batch-pack.cjs
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXE_PATH = 'C:/Users/rdiol/sela/workspace/WzImg-MCP-Server/WzImgMCP/bin/Debug/net8.0-windows/WzImgMCP.exe';
const IMG_DATA_PATH = 'C:/Users/rdiol/sela/workspace/v83-img-data';
const ICONS_PATH = 'C:/Users/rdiol/sela/workspace/maple-sprites/necromancer/icons_b64.json';

// Skills per job img file (700.img already done — only 710/711/712 here)
const JOB_SKILLS = {
  '710.img': ['7101000', '7101001', '7101002', '7101003', '7101004', '7101005'],
  '711.img': ['7111000', '7111001', '7111002', '7111003', '7111004'],
  '712.img': ['7121000', '7121001', '7121002', '7121003', '7121004', '7121005'],
};

const icons = JSON.parse(fs.readFileSync(ICONS_PATH, 'utf8'));

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
  buffer = lines.pop(); // keep incomplete line
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
      // Non-JSON line (logs, etc.) — ignore
    }
  }
}

async function run() {
  proc = spawn(EXE_PATH, [], {
    env: { ...process.env, WZIMGMCP_DATA_PATH: IMG_DATA_PATH },
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  proc.stdout.on('data', handleData);
  proc.on('error', (err) => { console.error('Process error:', err.message); process.exit(1); });

  // Initialize MCP handshake
  await sendRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'batch-pack', version: '1.0' },
  });

  // Set data source
  await callTool('init_data_source', { basePath: IMG_DATA_PATH });
  console.log('[batch-pack] Initialized harepacker data source');

  let totalPacked = 0;
  let totalErrors = 0;

  for (const [imgFile, skillIds] of Object.entries(JOB_SKILLS)) {
    console.log(`\n[batch-pack] Processing ${imgFile} (${skillIds.length} skills)...`);

    // Parse the img
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
        // Add skill SubProperty under "skill"
        await callTool('add_property', {
          category: 'skill', image: imgFile,
          parentPath: 'skill', name: skillId, type: 'SubProperty',
        });

        // Import icon (3 variants)
        for (const iconName of ['icon', 'iconMouseOver', 'iconDisabled']) {
          await callTool('import_png', {
            category: 'skill', image: imgFile,
            parentPath: `skill/${skillId}`, name: iconName,
            base64Png: iconB64, originX: 0, originY: 32,
          });
        }

        console.log(`  [OK] ${skillId} packed (icon + mouseOver + disabled)`);
        totalPacked++;
      } catch (err) {
        console.error(`  [ERR] ${skillId}: ${err.message}`);
        totalErrors++;
      }
    }

    // Save the img
    try {
      await callTool('save_image', { category: 'skill', image: imgFile });
      console.log(`  [SAVED] ${imgFile}`);
    } catch (err) {
      console.error(`  [ERR] save_image ${imgFile}: ${err.message}`);
      totalErrors++;
    }
  }

  console.log(`\n[batch-pack] Done: ${totalPacked} skills packed, ${totalErrors} errors`);
  proc.stdin.end();
  process.exit(totalErrors > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('[batch-pack] Fatal:', err.message);
  process.exit(1);
});
