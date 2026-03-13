/**
 * pack-items-weapons-wz.cjs
 * Packs custom weapon icons and item icons into WZ img format via harepacker-mcp.
 *
 * Weapons: Character/Weapon/01XXXXXX.img → info/icon (each weapon = own .img)
 * Items (Consume): Item/Consume/02XX.img → 0ITEMID/info/icon (grouped by first 4 digits)
 * Items (Etc/Warp): Item/Etc/04XX.img or Item/Special/09XX.img
 *
 * Usage: node scripts/pack-items-weapons-wz.cjs
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXE_PATH = 'C:/Users/rdiol/sela/workspace/WzImg-MCP-Server/WzImgMCP/bin/Debug/net8.0-windows/WzImgMCP.exe';
const IMG_DATA_PATH = 'C:/Users/rdiol/sela/workspace/v83-img-data';
const LUDO_DIR = 'C:/Users/rdiol/sela/workspace/maple-sprites/ludo-regen';

// Custom weapons — each gets its own .img file in Character/Weapon/
const WEAPONS = [
  { id: '01302134', name: 'Crystal Fang', sprite: 'weapon_1302134_crystal_fang.png' },
  { id: '01382081', name: 'Phoenix Staff', sprite: 'weapon_1382081_phoenix_staff.png' },
  { id: '01452086', name: 'Wind Piercer', sprite: 'weapon_1452086_wind_piercer.png' },
  { id: '01332100', name: 'Shadow Fang', sprite: 'weapon_1332100_shadow_fang.png' },
  { id: '01492049', name: 'Thunder Barrel', sprite: 'weapon_1492049_thunder_barrel.png' },
  { id: '01442104', name: 'Earth Cleaver', sprite: 'weapon_1442104_earth_cleaver.png' },
  { id: '01472101', name: 'Venom Claw', sprite: 'weapon_1472101_venom_claw.png' },
  { id: '01482047', name: 'Iron Fist', sprite: 'weapon_1482047_iron_fist.png' },
];

// Custom items — grouped into container .img files
// Items 2002031-2002037 → Item/Consume/0200.img, path 0ITEMID/info/icon
// Item 2030021 → Item/Consume/0203.img, path 02030021/info/icon
const ITEMS = [
  { id: '02002031', name: 'Elixir of Rage', sprite: 'item_2002031_elixir_of_rage.png', category: 'item', container: 'Consume/0200.img' },
  { id: '02002032', name: 'Mana Crystal', sprite: 'item_2002032_mana_crystal.png', category: 'item', container: 'Consume/0200.img' },
  { id: '02002033', name: 'Iron Shield Scroll', sprite: 'item_2002033_iron_shield_scroll.png', category: 'item', container: 'Consume/0200.img' },
  { id: '02002034', name: 'Swift Boots Potion', sprite: 'item_2002034_swift_boots_potion.png', category: 'item', container: 'Consume/0200.img' },
  { id: '02002035', name: 'Lucky Clover', sprite: 'item_2002035_lucky_clover.png', category: 'item', container: 'Consume/0200.img' },
  { id: '02002036', name: 'Giant\'s Meat', sprite: 'item_2002036_giants_meat.png', category: 'item', container: 'Consume/0200.img' },
  { id: '02002037', name: 'Sage Tea', sprite: 'item_2002037_sage_tea.png', category: 'item', container: 'Consume/0200.img' },
  { id: '02030021', name: 'Return Scroll', sprite: 'item_2030021_return_scroll.png', category: 'item', container: 'Consume/0203.img' },
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
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
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
    clientInfo: { name: 'pack-items-weapons', version: '1.0' },
  });

  await callTool('init_data_source', { basePath: IMG_DATA_PATH });
  console.log('[pack] Initialized harepacker data source\n');

  let totalPacked = 0;
  let totalErrors = 0;

  // ── Pack Weapons ──────────────────────────────────────────────────────
  console.log('=== WEAPONS ===');
  for (const weapon of WEAPONS) {
    const spritePath = path.join(LUDO_DIR, weapon.sprite);
    if (!fs.existsSync(spritePath)) {
      console.log(`  [SKIP] ${weapon.id} (${weapon.name}) — sprite not found`);
      continue;
    }

    console.log(`\n  ${weapon.id} (${weapon.name})...`);
    const imgFile = `${weapon.id}.img`;
    const wzCategory = 'character';
    const wzSubPath = path.join(IMG_DATA_PATH, 'Character', 'Weapon', imgFile);

    // Create stub from existing weapon img if needed
    if (!fs.existsSync(wzSubPath)) {
      const stub = path.join(IMG_DATA_PATH, 'Character', 'Weapon', '01302000.img');
      if (fs.existsSync(stub)) {
        fs.copyFileSync(stub, wzSubPath);
        console.log(`    Created stub from 01302000.img`);
      }
    }

    try {
      // Parse
      try { await callTool('parse_image', { category: wzCategory, image: `Weapon/${imgFile}` }); } catch (_) {}

      // Create info SubProperty
      try {
        await callTool('add_property', {
          category: wzCategory, image: `Weapon/${imgFile}`,
          parentPath: '', name: 'info', type: 'SubProperty',
        });
      } catch (_) {}

      // Import icon
      const b64 = fs.readFileSync(spritePath).toString('base64');
      await callTool('import_png', {
        category: wzCategory, image: `Weapon/${imgFile}`,
        parentPath: 'info', name: 'icon',
        base64Png: b64, originX: 0, originY: 32,
      });

      // Import iconRaw (same image, used for inventory display)
      await callTool('import_png', {
        category: wzCategory, image: `Weapon/${imgFile}`,
        parentPath: 'info', name: 'iconRaw',
        base64Png: b64, originX: 0, originY: 32,
      });

      // Save
      await callTool('save_image', { category: wzCategory, image: `Weapon/${imgFile}` });

      const sizeAfter = fs.existsSync(wzSubPath) ? fs.statSync(wzSubPath).size : 0;
      console.log(`    [OK] ${sizeAfter} bytes`);
      totalPacked++;
    } catch (err) {
      console.error(`    [ERR] ${err.message.slice(0, 100)}`);
      totalErrors++;
    }
  }

  // ── Pack Items ────────────────────────────────────────────────────────
  console.log('\n\n=== ITEMS ===');

  // Group items by container img
  const grouped = {};
  for (const item of ITEMS) {
    if (!grouped[item.container]) grouped[item.container] = [];
    grouped[item.container].push(item);
  }

  for (const [container, items] of Object.entries(grouped)) {
    console.log(`\n  Container: ${container}`);
    const wzCategory = 'item';

    // Parse container
    try { await callTool('parse_image', { category: wzCategory, image: container }); } catch (_) {}

    for (const item of items) {
      const spritePath = path.join(LUDO_DIR, item.sprite);
      if (!fs.existsSync(spritePath)) {
        console.log(`    [SKIP] ${item.id} (${item.name}) — sprite not found`);
        continue;
      }

      console.log(`    ${item.id} (${item.name})...`);

      try {
        // Create item SubProperty (e.g. 02002031)
        try {
          await callTool('add_property', {
            category: wzCategory, image: container,
            parentPath: '', name: item.id, type: 'SubProperty',
          });
        } catch (_) {}

        // Create info SubProperty
        try {
          await callTool('add_property', {
            category: wzCategory, image: container,
            parentPath: item.id, name: 'info', type: 'SubProperty',
          });
        } catch (_) {}

        // Import icon
        const b64 = fs.readFileSync(spritePath).toString('base64');
        await callTool('import_png', {
          category: wzCategory, image: container,
          parentPath: `${item.id}/info`, name: 'icon',
          base64Png: b64, originX: 0, originY: 32,
        });

        // Import iconRaw
        await callTool('import_png', {
          category: wzCategory, image: container,
          parentPath: `${item.id}/info`, name: 'iconRaw',
          base64Png: b64, originX: 0, originY: 32,
        });

        console.log(`      [OK] icon packed`);
        totalPacked++;
      } catch (err) {
        console.error(`      [ERR] ${err.message.slice(0, 100)}`);
        totalErrors++;
      }
    }

    // Save container after all items in it are packed
    try {
      await callTool('save_image', { category: wzCategory, image: container });
      console.log(`    [SAVED] ${container}`);
    } catch (err) {
      console.error(`    [SAVE ERR] ${err.message.slice(0, 100)}`);
    }
  }

  console.log(`\n=== Done: ${totalPacked} packed, ${totalErrors} errors ===`);
  proc.stdin.end();
  process.exit(totalErrors > 0 && totalPacked === 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('[pack] Fatal:', err.message);
  process.exit(1);
});
