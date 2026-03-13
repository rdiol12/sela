/**
 * pack-all-assets.cjs
 * Packs ALL custom MapleStory assets into WZ img format via WzImgMCP.exe.
 * Handles: NPCs, Mobs, Items (consumables, etc), Weapons, Equipment, Skills (Necromancer + Sage)
 *
 * Usage: node scripts/pack-all-assets.cjs
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXE_PATH = 'C:/Users/rdiol/sela/workspace/WzImg-MCP-Server/WzImgMCP/bin/Debug/net8.0-windows/WzImgMCP.exe';
const IMG_DATA_PATH = 'C:/Users/rdiol/sela/workspace/npc-wz-img';
const SPRITE_DIR = 'C:/Users/rdiol/sela/workspace/maple-sprites';

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

function extractResult(res) {
  // MCP tool results come wrapped in content array
  if (res && res.content && Array.isArray(res.content)) {
    const text = res.content.find(c => c.type === 'text');
    if (text) {
      try { return JSON.parse(text.text); } catch (_) { return text.text; }
    }
  }
  return res;
}

async function safeCall(toolName, args) {
  try {
    const res = await callTool(toolName, args);
    return extractResult(res);
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Ensure an img file exists by copying template if needed
function ensureImg(category, imgName, templateName) {
  const imgPath = path.join(IMG_DATA_PATH, category, imgName);
  if (!fs.existsSync(imgPath)) {
    const templatePath = path.join(IMG_DATA_PATH, category, templateName);
    if (fs.existsSync(templatePath)) {
      fs.copyFileSync(templatePath, imgPath);
      console.log(`  [TEMPLATE] Copied ${templateName} → ${imgName}`);
      return true;
    } else {
      console.log(`  [SKIP] No template ${templateName} found`);
      return false;
    }
  }
  return true;
}

function readB64(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath).toString('base64');
}

// ==================== NPC PACKING ====================
async function packNPCs() {
  console.log('\n========== PACKING NPCs ==========');
  const npcDir = path.join(SPRITE_DIR, 'custom-npcs');
  if (!fs.existsSync(npcDir)) { console.log('No NPC sprites found'); return 0; }

  const npcIds = fs.readdirSync(npcDir).filter(d =>
    fs.statSync(path.join(npcDir, d)).isDirectory()
  );
  console.log(`Found ${npcIds.length} NPCs to pack`);

  let packed = 0;
  for (const npcId of npcIds) {
    const dir = path.join(npcDir, npcId);
    const frame0 = path.join(dir, 'stand_0.png');
    if (!fs.existsSync(frame0)) {
      console.log(`  [SKIP] ${npcId} — no stand_0.png`);
      continue;
    }

    const imgName = `${npcId}.img`;
    ensureImg('npc', imgName, '0002000.img');

    // Parse
    let res = await safeCall('parse_image', { category: 'npc', image: imgName });
    if (!res.success && res.error) {
      console.log(`  [ERR] ${npcId} parse: ${(res.error || '').slice(0, 80)}`);
      continue;
    }

    // Ensure stand SubProperty exists
    await safeCall('add_property', {
      category: 'npc', image: imgName,
      parentPath: '', name: 'stand', type: 'SubProperty'
    });

    // Import frame 0
    const b64_0 = readB64(frame0);
    if (b64_0) {
      res = await safeCall('import_png', {
        category: 'npc', image: imgName,
        parentPath: 'stand', name: '0',
        base64Png: b64_0, originX: 40, originY: 80
      });
      if (res.success === false) {
        console.log(`  [ERR] ${npcId} frame0: ${(res.error || '').slice(0, 80)}`);
      }
    }

    // Import frame 1
    const frame1 = path.join(dir, 'stand_1.png');
    const b64_1 = readB64(frame1);
    if (b64_1) {
      res = await safeCall('import_png', {
        category: 'npc', image: imgName,
        parentPath: 'stand', name: '1',
        base64Png: b64_1, originX: 40, originY: 80
      });
      if (res.success === false) {
        console.log(`  [ERR] ${npcId} frame1: ${(res.error || '').slice(0, 80)}`);
      }
    }

    // Save
    res = await safeCall('save_image', { category: 'npc', image: imgName });
    if (res.success !== false) {
      console.log(`  [OK] ${npcId}`);
      packed++;
    } else {
      console.log(`  [ERR] ${npcId} save: ${(res.error || '').slice(0, 80)}`);
    }
  }
  console.log(`NPCs packed: ${packed}/${npcIds.length}`);
  return packed;
}

// ==================== MOB PACKING ====================
async function packMobs() {
  console.log('\n========== PACKING MOBS ==========');
  const mobDir = path.join(SPRITE_DIR, 'mobs');
  if (!fs.existsSync(mobDir)) { console.log('No mob sprites found'); return 0; }

  const mobIds = fs.readdirSync(mobDir).filter(d =>
    fs.statSync(path.join(mobDir, d)).isDirectory()
  );
  console.log(`Found ${mobIds.length} mobs to pack`);

  // Mob states: stand, move, hit1, die1, attack1, attack2
  const MOB_STATES = ['stand', 'move', 'hit1', 'die1', 'attack1', 'attack2'];

  let packed = 0;
  for (const mobId of mobIds) {
    const dir = path.join(mobDir, mobId);
    const imgName = `${mobId}.img`;
    ensureImg('mob', imgName, '0100100.img');

    let res = await safeCall('parse_image', { category: 'mob', image: imgName });
    if (!res.success && res.error && res.error !== 'Already parsed') {
      console.log(`  [ERR] ${mobId} parse: ${(res.error || '').slice(0, 80)}`);
      continue;
    }

    let statesPacked = 0;
    for (const state of MOB_STATES) {
      // Check if any frames exist for this state
      const frames = fs.readdirSync(dir).filter(f => f.startsWith(state + '_') && f.endsWith('.png'));
      if (frames.length === 0) continue;

      // Add state SubProperty
      await safeCall('add_property', {
        category: 'mob', image: imgName,
        parentPath: '', name: state, type: 'SubProperty'
      });

      // Import each frame
      for (let i = 0; i < frames.length; i++) {
        const framePath = path.join(dir, `${state}_${i}.png`);
        const b64 = readB64(framePath);
        if (!b64) continue;

        res = await safeCall('import_png', {
          category: 'mob', image: imgName,
          parentPath: state, name: String(i),
          base64Png: b64, originX: 40, originY: 80
        });
        if (res.success === false) {
          console.log(`  [ERR] ${mobId}/${state}/${i}: ${(res.error || '').slice(0, 60)}`);
        }
      }
      statesPacked++;
    }

    if (statesPacked > 0) {
      res = await safeCall('save_image', { category: 'mob', image: imgName });
      if (res.success !== false) {
        console.log(`  [OK] ${mobId} (${statesPacked} states)`);
        packed++;
      } else {
        console.log(`  [ERR] ${mobId} save: ${(res.error || '').slice(0, 80)}`);
      }
    }
  }
  console.log(`Mobs packed: ${packed}/${mobIds.length}`);
  return packed;
}

// ==================== ITEM ICON PACKING ====================
async function packItems() {
  console.log('\n========== PACKING ITEM ICONS ==========');
  const itemDir = path.join(SPRITE_DIR, 'item-icons');
  if (!fs.existsSync(itemDir)) { console.log('No item icons found'); return 0; }

  const itemIds = fs.readdirSync(itemDir).filter(d =>
    fs.statSync(path.join(itemDir, d)).isDirectory()
  );
  console.log(`Found ${itemIds.length} items to pack`);

  // Group items by container: e.g., 2002031 → Consume/0200.img, 4032100 → Etc/0403.img
  const grouped = {};
  for (const itemId of itemIds) {
    const id = parseInt(itemId, 10);
    let category, subdir, container;

    if (id >= 1000000 && id < 2000000) {
      // Weapons/Equipment → character category
      category = 'character';
      const typeId = Math.floor(id / 10000);
      subdir = 'Weapon';
      container = `0${itemId}.img`; // each weapon is its own .img
    } else if (id >= 2000000 && id < 3000000) {
      // Consumables → item/Consume
      category = 'item';
      subdir = 'Consume';
      const containerId = String(Math.floor(id / 10000)).padStart(4, '0');
      container = `${containerId}.img`;
    } else if (id >= 4000000 && id < 5000000) {
      // Etc items → item/Etc  (previously "etc" category, but in WZ it's item/Etc)
      category = 'item';
      subdir = 'Etc';
      const containerId = String(Math.floor(id / 10000)).padStart(4, '0');
      container = `${containerId}.img`;
    } else {
      console.log(`  [SKIP] ${itemId} — unknown item range`);
      continue;
    }

    const key = `${category}/${subdir}/${container}`;
    if (!grouped[key]) grouped[key] = { category, subdir, container, items: [] };
    grouped[key].items.push(itemId);
  }

  let packed = 0;
  for (const [key, group] of Object.entries(grouped)) {
    const { category, subdir, container, items } = group;
    const imgPath = path.join(IMG_DATA_PATH, category, subdir, container);

    // Skip weapons for now (they have a different structure)
    if (subdir === 'Weapon') {
      console.log(`  [SKIP] Weapon items — handled separately`);
      continue;
    }

    if (!fs.existsSync(imgPath)) {
      console.log(`  [SKIP] ${key} — container .img not found, creating it`);
      // For new containers, we'd need a template. Skip for now.
      continue;
    }

    // Parse the container
    const imgRef = `${subdir}/${container}`;
    let res = await safeCall('parse_image', { category, image: imgRef });
    if (res.success === false && res.error && !res.error.includes('Already')) {
      console.log(`  [ERR] ${key} parse: ${(res.error || '').slice(0, 80)}`);
      continue;
    }

    for (const itemId of items) {
      const dir = path.join(itemDir, itemId);
      const iconPath = path.join(dir, 'icon.png');
      const iconRawPath = path.join(dir, 'iconRaw.png');

      // Add item SubProperty: {itemId}/info
      await safeCall('add_property', {
        category, image: imgRef,
        parentPath: '', name: itemId, type: 'SubProperty'
      });
      await safeCall('add_property', {
        category, image: imgRef,
        parentPath: itemId, name: 'info', type: 'SubProperty'
      });

      // Import icon
      const iconB64 = readB64(iconPath);
      if (iconB64) {
        res = await safeCall('import_png', {
          category, image: imgRef,
          parentPath: `${itemId}/info`, name: 'icon',
          base64Png: iconB64, originX: 0, originY: 32
        });
        if (res.success === false) {
          console.log(`  [ERR] ${itemId} icon: ${(res.error || '').slice(0, 60)}`);
        }
      }

      // Import iconRaw
      const iconRawB64 = readB64(iconRawPath);
      if (iconRawB64) {
        res = await safeCall('import_png', {
          category, image: imgRef,
          parentPath: `${itemId}/info`, name: 'iconRaw',
          base64Png: iconRawB64, originX: 0, originY: 32
        });
        if (res.success === false) {
          console.log(`  [ERR] ${itemId} iconRaw: ${(res.error || '').slice(0, 60)}`);
        }
      }
      packed++;
    }

    // Save container
    res = await safeCall('save_image', { category, image: imgRef });
    if (res.success !== false) {
      console.log(`  [OK] ${key} (${items.length} items)`);
    } else {
      console.log(`  [ERR] ${key} save: ${(res.error || '').slice(0, 80)}`);
    }
  }

  console.log(`Items packed: ${packed}/${itemIds.length}`);
  return packed;
}

// ==================== SKILL ICON PACKING ====================
async function packSkills(className, jobPrefix) {
  console.log(`\n========== PACKING ${className.toUpperCase()} SKILLS ==========`);
  const skillDir = path.join(SPRITE_DIR, className.toLowerCase());
  if (!fs.existsSync(skillDir)) { console.log(`No ${className} skills found`); return 0; }

  const jobDirs = fs.readdirSync(skillDir).filter(d => {
    const full = path.join(skillDir, d);
    return fs.statSync(full).isDirectory() && /^\d+$/.test(d);
  });
  console.log(`Found ${jobDirs.length} job images to pack`);

  let packed = 0;
  for (const jobId of jobDirs) {
    const jobDir = path.join(skillDir, jobId);
    const imgName = `${jobId}.img`;
    const imgPath = path.join(IMG_DATA_PATH, 'skill', imgName);

    // Check if existing img exists, if not look for a template
    if (!fs.existsSync(imgPath)) {
      // Find a nearby skill img as template
      const templateFiles = fs.readdirSync(path.join(IMG_DATA_PATH, 'skill'))
        .filter(f => f.endsWith('.img'));
      if (templateFiles.length > 0) {
        fs.copyFileSync(
          path.join(IMG_DATA_PATH, 'skill', templateFiles[0]),
          imgPath
        );
        console.log(`  [TEMPLATE] Created ${imgName} from ${templateFiles[0]}`);
      }
    }

    let res = await safeCall('parse_image', { category: 'skill', image: imgName });
    if (res.success === false && res.error && !res.error.includes('Already')) {
      console.log(`  [ERR] ${imgName} parse: ${(res.error || '').slice(0, 80)}`);
      continue;
    }

    // Add skill SubProperty at root
    await safeCall('add_property', {
      category: 'skill', image: imgName,
      parentPath: '', name: 'skill', type: 'SubProperty'
    });

    // List skill subdirectories (each is a skill ID)
    const skillIds = fs.readdirSync(jobDir).filter(d => {
      const full = path.join(jobDir, d);
      return fs.statSync(full).isDirectory() && /^\d+$/.test(d);
    });

    // Also try icon files directly in job dir
    const iconFiles = fs.readdirSync(jobDir).filter(f => f.endsWith('.png'));

    if (skillIds.length > 0) {
      // Skills are in subdirectories
      for (const skillId of skillIds) {
        const sDir = path.join(jobDir, skillId);
        await safeCall('add_property', {
          category: 'skill', image: imgName,
          parentPath: 'skill', name: skillId, type: 'SubProperty'
        });

        const iconPath = path.join(sDir, 'icon.png');
        const iconB64 = readB64(iconPath);
        if (iconB64) {
          res = await safeCall('import_png', {
            category: 'skill', image: imgName,
            parentPath: `skill/${skillId}`, name: 'icon',
            base64Png: iconB64, originX: 0, originY: 32
          });
        }

        // iconMouseOver
        const moPath = path.join(sDir, 'iconMouseOver.png');
        const moB64 = readB64(moPath);
        if (moB64) {
          await safeCall('import_png', {
            category: 'skill', image: imgName,
            parentPath: `skill/${skillId}`, name: 'iconMouseOver',
            base64Png: moB64, originX: 0, originY: 32
          });
        }

        // iconDisabled
        const disPath = path.join(sDir, 'iconDisabled.png');
        const disB64 = readB64(disPath);
        if (disB64) {
          await safeCall('import_png', {
            category: 'skill', image: imgName,
            parentPath: `skill/${skillId}`, name: 'iconDisabled',
            base64Png: disB64, originX: 0, originY: 32
          });
        }

        packed++;
      }
    }

    // Try loading from icons_b64.json if it exists
    const b64JsonPath = path.join(skillDir, 'icons_b64.json');
    if (fs.existsSync(b64JsonPath) && skillIds.length === 0) {
      const b64Data = JSON.parse(fs.readFileSync(b64JsonPath, 'utf8'));
      // Format: { "skillId": { "icon": "base64...", "iconMouseOver": "...", "iconDisabled": "..." } }
      for (const [skillId, icons] of Object.entries(b64Data)) {
        // Check if this skill belongs to this job
        const skillJobId = skillId.slice(0, 3);
        if (skillJobId !== jobId) continue;

        await safeCall('add_property', {
          category: 'skill', image: imgName,
          parentPath: 'skill', name: skillId, type: 'SubProperty'
        });

        if (icons.icon) {
          await safeCall('import_png', {
            category: 'skill', image: imgName,
            parentPath: `skill/${skillId}`, name: 'icon',
            base64Png: icons.icon, originX: 0, originY: 32
          });
        }
        if (icons.iconMouseOver) {
          await safeCall('import_png', {
            category: 'skill', image: imgName,
            parentPath: `skill/${skillId}`, name: 'iconMouseOver',
            base64Png: icons.iconMouseOver, originX: 0, originY: 32
          });
        }
        if (icons.iconDisabled) {
          await safeCall('import_png', {
            category: 'skill', image: imgName,
            parentPath: `skill/${skillId}`, name: 'iconDisabled',
            base64Png: icons.iconDisabled, originX: 0, originY: 32
          });
        }
        packed++;
      }
    }

    // Save
    res = await safeCall('save_image', { category: 'skill', image: imgName });
    if (res.success !== false) {
      console.log(`  [OK] ${imgName}`);
    } else {
      console.log(`  [ERR] ${imgName} save: ${(res.error || '').slice(0, 80)}`);
    }
  }

  console.log(`${className} skills packed: ${packed}`);
  return packed;
}

// ==================== MAIN ====================
async function run() {
  proc = spawn(EXE_PATH, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  proc.stderr.on('data', (d) => process.stderr.write(d));
  proc.stdout.on('data', handleData);
  proc.on('error', (err) => { console.error('Process error:', err.message); process.exit(1); });

  // Initialize
  await sendRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'pack-all-assets', version: '1.0' },
  });

  const initRes = await callTool('init_data_source', { basePath: IMG_DATA_PATH });
  console.log('[pack-all-assets] Initialized data source at', IMG_DATA_PATH);

  const results = {};

  // Pack NPCs
  results.npcs = await packNPCs();

  // Re-init to refresh cache
  await callTool('init_data_source', { basePath: IMG_DATA_PATH });

  // Pack Mobs
  results.mobs = await packMobs();

  // Re-init
  await callTool('init_data_source', { basePath: IMG_DATA_PATH });

  // Pack Items
  results.items = await packItems();

  // Re-init
  await callTool('init_data_source', { basePath: IMG_DATA_PATH });

  // Pack Necromancer Skills
  results.necromancer = await packSkills('necromancer', '7');

  // Re-init
  await callTool('init_data_source', { basePath: IMG_DATA_PATH });

  // Pack Sage Skills
  results.sage = await packSkills('sage', '6');

  console.log('\n========== SUMMARY ==========');
  console.log(JSON.stringify(results, null, 2));
  console.log('All done!');

  proc.stdin.end();
  process.exit(0);
}

run().catch((err) => {
  console.error('[pack-all-assets] Fatal:', err.message);
  process.exit(1);
});
