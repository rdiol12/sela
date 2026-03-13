/**
 * export-to-cosmic.cjs — Export all custom .img files to XML for Cosmic server
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXE_PATH = 'C:/Users/rdiol/sela/workspace/WzImg-MCP-Server/WzImgMCP/bin/Debug/net8.0-windows/WzImgMCP.exe';
const IMG_DATA_PATH = 'C:/Users/rdiol/sela/workspace/npc-wz-img';
const COSMIC_WZ = 'C:/Users/rdiol/sela/workspace/Cosmic/wz';

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
function callTool(name, args) {
  return sendRequest('tools/call', { name, arguments: args });
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

// Assets to export - organized by [category, imgName, cosmicWzSubdir]
function getAssetsToExport() {
  const assets = [];

  // NPCs (custom IDs: 999xxxx)
  const npcDir = path.join(IMG_DATA_PATH, 'npc');
  const npcFiles = fs.readdirSync(npcDir).filter(f => f.startsWith('999') && f.endsWith('.img'));
  for (const f of npcFiles) {
    assets.push({ category: 'npc', image: f, wzDir: 'Npc.wz' });
  }

  // Mobs (custom IDs: 990xxxx)
  const mobDir = path.join(IMG_DATA_PATH, 'mob');
  const mobFiles = fs.readdirSync(mobDir).filter(f => f.startsWith('990') && f.endsWith('.img'));
  for (const f of mobFiles) {
    assets.push({ category: 'mob', image: f, wzDir: 'Mob.wz' });
  }

  // Items - Consume containers that were modified
  assets.push({ category: 'item', image: 'Consume/0200.img', wzDir: 'Item.wz/Consume' });
  assets.push({ category: 'item', image: 'Consume/0203.img', wzDir: 'Item.wz/Consume' });

  // Items - Etc container
  assets.push({ category: 'item', image: 'Etc/0403.img', wzDir: 'Item.wz/Etc' });

  // Weapons (custom IDs)
  const weaponIds = ['01302134', '01332100', '01382081', '01442104', '01452086', '01472101', '01482047', '01492049'];
  for (const id of weaponIds) {
    assets.push({ category: 'character', image: `Weapon/${id}.img`, wzDir: 'Character.wz/Weapon' });
  }

  // Equipment - Caps
  assets.push({ category: 'character', image: 'Cap/01003074.img', wzDir: 'Character.wz/Cap' });
  assets.push({ category: 'character', image: 'Cap/01003075.img', wzDir: 'Character.wz/Cap' });

  // Equipment - Accessories (medals)
  assets.push({ category: 'character', image: 'Accessory/01142153.img', wzDir: 'Character.wz/Accessory' });
  assets.push({ category: 'character', image: 'Accessory/01142154.img', wzDir: 'Character.wz/Accessory' });

  // Skills - Necromancer
  for (const job of ['700', '710', '711', '712']) {
    assets.push({ category: 'skill', image: `${job}.img`, wzDir: 'Skill.wz' });
  }

  // Skills - Sage
  for (const job of ['600', '610', '611', '612']) {
    assets.push({ category: 'skill', image: `${job}.img`, wzDir: 'Skill.wz' });
  }

  return assets;
}

async function run() {
  proc = spawn(EXE_PATH, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  proc.stderr.on('data', d => process.stderr.write(d));
  proc.stdout.on('data', handleData);

  await sendRequest('initialize', {
    protocolVersion: '2024-11-05', capabilities: {},
    clientInfo: { name: 'export-to-cosmic', version: '1.0' }
  });
  await callTool('init_data_source', { basePath: IMG_DATA_PATH });
  console.log('Initialized data source\n');

  const assets = getAssetsToExport();
  console.log(`Exporting ${assets.length} assets to Cosmic WZ...\n`);

  let exported = 0, errors = 0;

  for (const asset of assets) {
    const { category, image, wzDir } = asset;
    const imgBaseName = path.basename(image);

    // Parse the image first
    let res = await safeCall('parse_image', { category, image });
    if (res.success === false && res.error && !res.error.includes('Already')) {
      console.log(`  [ERR] ${category}/${image} parse: ${(res.error || '').slice(0, 80)}`);
      errors++;
      continue;
    }

    // Ensure target directory exists
    const targetDir = path.join(COSMIC_WZ, wzDir);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
      console.log(`  Created directory: ${wzDir}`);
    }

    // Export to XML
    const outputPath = path.join(targetDir, `${imgBaseName}.xml`);
    res = await safeCall('export_to_xml', {
      category, image,
      outputPath,
      maxDepth: 20
    });

    if (res.success !== false) {
      console.log(`  [OK] ${category}/${image} → ${wzDir}/${imgBaseName}.xml`);
      exported++;
    } else {
      console.log(`  [ERR] ${category}/${image} export: ${(res.error || '').slice(0, 80)}`);
      errors++;
    }
  }

  console.log(`\n========== EXPORT SUMMARY ==========`);
  console.log(`Exported: ${exported}/${assets.length}`);
  console.log(`Errors: ${errors}`);

  proc.stdin.end();
  process.exit(errors > 0 && exported === 0 ? 1 : 0);
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
