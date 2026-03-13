/**
 * build-client-wz.cjs
 * Packs v83-img-data/ into .wz archives and copies them into the v83 client.
 * Uses harepacker-mcp's pack_to_wz tool.
 *
 * Usage: node scripts/build-client-wz.cjs
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXE_PATH = 'C:/Users/rdiol/sela/workspace/WzImg-MCP-Server/WzImgMCP/bin/Debug/net8.0-windows/WzImgMCP.exe';
const IMG_DATA_PATH = 'C:/Users/rdiol/sela/workspace/v83-img-data';
const OUTPUT_DIR = 'C:/Users/rdiol/sela/workspace/v83-client-custom';
const CLIENT_DIR = 'C:/Users/rdiol/sela/workspace/v83-client/83';

// Categories to pack (all modified — includes map + mob for custom content)
const CATEGORIES = ['npc', 'character', 'item', 'skill', 'string', 'map', 'mob'];

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
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    } catch (_) {}
  }
}

async function run() {
  // Ensure output dir
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  proc = spawn(EXE_PATH, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  proc.stderr.on('data', (d) => process.stderr.write(d));
  proc.stdout.on('data', handleData);
  proc.on('error', (err) => { console.error('Process error:', err.message); process.exit(1); });

  await sendRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'build-client-wz', version: '1.0' },
  });

  console.log('[build-client-wz] Packing v83-img-data → .wz archives\n');

  // Pack all categories at once
  console.log(`Packing all categories from ${IMG_DATA_PATH}...`);
  console.log(`Output: ${OUTPUT_DIR}\n`);

  try {
    const result = await callTool('pack_to_wz', {
      imgPath: IMG_DATA_PATH,
      outputDir: OUTPUT_DIR,
      wzVersion: 83,
    });

    // Parse result
    const content = result?.content?.[0]?.text || JSON.stringify(result);
    console.log('Pack result:', content);

    // Check for created files
    const wzFiles = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.wz'));
    console.log(`\nWZ files created: ${wzFiles.length}`);
    for (const f of wzFiles) {
      const size = fs.statSync(path.join(OUTPUT_DIR, f)).size;
      console.log(`  ${f}: ${(size / 1024 / 1024).toFixed(1)} MB`);
    }

    // Copy to client directory
    if (wzFiles.length > 0 && fs.existsSync(CLIENT_DIR)) {
      console.log(`\nCopying to client: ${CLIENT_DIR}`);
      for (const f of wzFiles) {
        const src = path.join(OUTPUT_DIR, f);
        const dst = path.join(CLIENT_DIR, f);
        // Backup original
        if (fs.existsSync(dst)) {
          const bakPath = dst + '.bak';
          if (!fs.existsSync(bakPath)) {
            fs.copyFileSync(dst, bakPath);
            console.log(`  [BAK] ${f} → ${f}.bak`);
          }
        }
        fs.copyFileSync(src, dst);
        console.log(`  [OK] ${f}`);
      }
      console.log('\nClient updated! Start MapleStory to see the new sprites.');
    }

    // Auto-regenerate patch manifest
    try {
      const { generateManifest } = require('../workspace/maple-patcher/server/generate-manifest');
      console.log('\nRegenerating patch manifest...');
      await generateManifest();
    } catch (err) {
      console.error('Manifest generation skipped:', err.message);
    }
  } catch (err) {
    console.error('Pack error:', err.message);
  }

  proc.stdin.end();
}

run().catch((err) => {
  console.error('[build-client-wz] Fatal:', err.message);
  process.exit(1);
});
