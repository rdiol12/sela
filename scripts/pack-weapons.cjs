/**
 * pack-weapons.cjs — Pack custom weapon icons into Character/Weapon .img files
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXE_PATH = 'C:/Users/rdiol/sela/workspace/WzImg-MCP-Server/WzImgMCP/bin/Debug/net8.0-windows/WzImgMCP.exe';
const IMG_DATA_PATH = 'C:/Users/rdiol/sela/workspace/npc-wz-img';
const SPRITE_DIR = 'C:/Users/rdiol/sela/workspace/maple-sprites';

const WEAPON_IDS = [
  '1302134', '1332100', '1382081', '1442104',
  '1452086', '1472101', '1482047', '1492049'
];

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

async function run() {
  proc = spawn(EXE_PATH, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  proc.stderr.on('data', d => process.stderr.write(d));
  proc.stdout.on('data', handleData);

  await sendRequest('initialize', {
    protocolVersion: '2024-11-05', capabilities: {},
    clientInfo: { name: 'pack-weapons', version: '1.0' }
  });
  await callTool('init_data_source', { basePath: IMG_DATA_PATH });
  console.log('Initialized data source');

  let packed = 0;
  for (const weaponId of WEAPON_IDS) {
    const paddedId = '0' + weaponId;
    const imgName = `Weapon/${paddedId}.img`;
    const imgPath = path.join(IMG_DATA_PATH, 'character', imgName.replace('/', path.sep));

    // Find a template weapon from the same category
    const prefix = paddedId.slice(0, 8); // e.g., 01302 for one-handed swords
    const weaponDir = path.join(IMG_DATA_PATH, 'character', 'Weapon');
    const templates = fs.readdirSync(weaponDir)
      .filter(f => f.startsWith(paddedId.slice(0, 5)) && f.endsWith('.img'));

    if (!fs.existsSync(imgPath)) {
      if (templates.length > 0) {
        fs.copyFileSync(path.join(weaponDir, templates[0]), imgPath);
        console.log(`  [TEMPLATE] ${templates[0]} → ${paddedId}.img`);
      } else {
        // Use any weapon as template
        const any = fs.readdirSync(weaponDir).find(f => f.endsWith('.img'));
        if (any) {
          fs.copyFileSync(path.join(weaponDir, any), imgPath);
          console.log(`  [TEMPLATE] ${any} → ${paddedId}.img`);
        }
      }
    }

    let res = await safeCall('parse_image', { category: 'character', image: imgName });
    if (res.success === false && res.error && !res.error.includes('Already')) {
      console.log(`  [ERR] ${weaponId} parse: ${res.error}`);
      continue;
    }

    // Import icon from item-icons directory
    const iconPath = path.join(SPRITE_DIR, 'item-icons', weaponId, 'icon.png');
    const iconRawPath = path.join(SPRITE_DIR, 'item-icons', weaponId, 'iconRaw.png');

    // Also check custom-items for full sprites
    const customIcon = path.join(SPRITE_DIR, 'custom-items', `0${weaponId}.png`);

    if (fs.existsSync(iconPath)) {
      const b64 = fs.readFileSync(iconPath).toString('base64');
      res = await safeCall('import_png', {
        category: 'character', image: imgName,
        parentPath: 'info', name: 'icon',
        base64Png: b64, originX: 0, originY: 32
      });
      if (res.success === false) console.log(`  [ERR] ${weaponId} icon: ${res.error}`);
    } else if (fs.existsSync(customIcon)) {
      const b64 = fs.readFileSync(customIcon).toString('base64');
      res = await safeCall('import_png', {
        category: 'character', image: imgName,
        parentPath: 'info', name: 'icon',
        base64Png: b64, originX: 0, originY: 32
      });
      if (res.success === false) console.log(`  [ERR] ${weaponId} icon: ${res.error}`);
    }

    if (fs.existsSync(iconRawPath)) {
      const b64 = fs.readFileSync(iconRawPath).toString('base64');
      res = await safeCall('import_png', {
        category: 'character', image: imgName,
        parentPath: 'info', name: 'iconRaw',
        base64Png: b64, originX: 0, originY: 32
      });
      if (res.success === false) console.log(`  [ERR] ${weaponId} iconRaw: ${res.error}`);
    }

    res = await safeCall('save_image', { category: 'character', image: imgName });
    if (res.success !== false) {
      console.log(`  [OK] ${weaponId} (${paddedId}.img)`);
      packed++;
    } else {
      console.log(`  [ERR] ${weaponId} save: ${res.error}`);
    }
  }

  // Also pack equipment items (hats/medals)
  const equipDir = path.join(SPRITE_DIR, 'equipment');
  if (fs.existsSync(equipDir)) {
    const equipIds = fs.readdirSync(equipDir).filter(d =>
      fs.statSync(path.join(equipDir, d)).isDirectory()
    );
    console.log(`\nPacking ${equipIds.length} equipment items...`);

    for (const equipId of equipIds) {
      const paddedId = '0' + equipId;
      // Determine subdirectory: 1003xxx = Cap, 1142xxx = Medal
      let subdir;
      if (equipId.startsWith('1003')) subdir = 'Cap';
      else if (equipId.startsWith('1142')) subdir = 'Accessory';
      else { console.log(`  [SKIP] ${equipId} — unknown equip type`); continue; }

      const imgName = `${subdir}/${paddedId}.img`;
      const imgPath = path.join(IMG_DATA_PATH, 'character', subdir, `${paddedId}.img`);

      // Find template
      const subDirPath = path.join(IMG_DATA_PATH, 'character', subdir);
      if (!fs.existsSync(subDirPath)) { console.log(`  [SKIP] ${subdir}/ not found`); continue; }

      if (!fs.existsSync(imgPath)) {
        const tmpl = fs.readdirSync(subDirPath).find(f => f.endsWith('.img'));
        if (tmpl) {
          fs.copyFileSync(path.join(subDirPath, tmpl), imgPath);
          console.log(`  [TEMPLATE] ${tmpl} → ${paddedId}.img`);
        }
      }

      let res = await safeCall('parse_image', { category: 'character', image: imgName });
      if (res.success === false && res.error && !res.error.includes('Already')) {
        console.log(`  [ERR] ${equipId} parse: ${res.error}`);
        continue;
      }

      const iconPath = path.join(equipDir, equipId, 'icon.png');
      const iconRawPath = path.join(equipDir, equipId, 'iconRaw.png');

      // Ensure info SubProperty
      await safeCall('add_property', {
        category: 'character', image: imgName,
        parentPath: '', name: 'info', type: 'SubProperty'
      });

      if (fs.existsSync(iconPath)) {
        const b64 = fs.readFileSync(iconPath).toString('base64');
        await safeCall('import_png', {
          category: 'character', image: imgName,
          parentPath: 'info', name: 'icon',
          base64Png: b64, originX: 0, originY: 32
        });
      }
      if (fs.existsSync(iconRawPath)) {
        const b64 = fs.readFileSync(iconRawPath).toString('base64');
        await safeCall('import_png', {
          category: 'character', image: imgName,
          parentPath: 'info', name: 'iconRaw',
          base64Png: b64, originX: 0, originY: 32
        });
      }

      res = await safeCall('save_image', { category: 'character', image: imgName });
      if (res.success !== false) {
        console.log(`  [OK] ${equipId} (${subdir}/${paddedId}.img)`);
        packed++;
      } else {
        console.log(`  [ERR] ${equipId} save: ${res.error}`);
      }
    }
  }

  console.log(`\nTotal packed: ${packed}`);
  proc.stdin.end();
  process.exit(0);
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
