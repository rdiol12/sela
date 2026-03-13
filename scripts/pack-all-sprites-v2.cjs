/**
 * Pack ALL custom MapleStory sprites into .img files via WzImgMCP stdio.
 * v2: Proper approach — creates new .img files for custom content,
 * only repacks modified categories, copies vanilla for the rest.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const MCP_EXE = 'C:/Users/rdiol/sela/workspace/WzImg-MCP-Server/WzImgMCP/bin/Debug/net8.0-windows/WzImgMCP.exe';
const IMG_PATH = 'C:/Users/rdiol/sela/workspace/v83-img-extract';
const SPRITES = 'C:/Users/rdiol/sela/workspace/maple-sprites';
const VANILLA_WZ = 'C:/Users/rdiol/sela/workspace/v83-client-custom';
const OUTPUT_WZ = 'C:/Users/rdiol/sela/workspace/v83-client-patched';

// Categories we modify — only these get repacked
const MODIFIED_CATEGORIES = ['npc', 'mob', 'item', 'etc', 'character', 'skill', 'ui'];
// Categories we don't touch — copy vanilla
const VANILLA_CATEGORIES = ['list', 'map', 'quest', 'reactor', 'string'];
// WZ file casing
const WZ_CASING = {
  npc: 'Npc', mob: 'Mob', skill: 'Skill', item: 'Item',
  character: 'Character', ui: 'UI', string: 'String',
  etc: 'Etc', map: 'Map', quest: 'Quest', reactor: 'Reactor', list: 'List',
};

let requestId = 0;
let proc = null;
let buffer = '';
const pending = new Map();

function startMCP() {
  return new Promise((resolve, reject) => {
    proc = spawn(MCP_EXE, [], {
      env: { ...process.env, WZIMGMCP_DATA_PATH: IMG_PATH },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    proc.stderr.on('data', () => {});
    proc.stdout.on('data', d => {
      buffer += d.toString();
      let lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
          }
        } catch (e) {}
      }
    });
    proc.on('error', reject);

    const id = ++requestId;
    pending.set(id, (resp) => {
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      resolve(resp);
    });
    proc.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'pack-v2', version: '2.0' } }
    }) + '\n');
    setTimeout(() => reject(new Error('MCP init timeout')), 15000);
  });
}

async function callTool(name, args) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${name}`)); }, 60000);
    pending.set(id, (resp) => {
      clearTimeout(timer);
      resp.error ? reject(new Error(resp.error.message || JSON.stringify(resp.error))) : resolve(resp.result);
    });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n');
  });
}

function parseResult(result) {
  if (result?.content?.[0]) {
    try { return JSON.parse(result.content[0].text); } catch { return result.content[0].text; }
  }
  return result;
}

// Wrapper functions
async function initDataSource() { return parseResult(await callTool('init_data_source', { basePath: IMG_PATH })); }
async function createImage(category, image) { return parseResult(await callTool('create_image', { category, image })); }
async function parseImage(category, image) { return parseResult(await callTool('parse_image', { category, image })); }
async function addProp(category, image, parentPath, name, type, value) {
  const args = { category, image, parentPath, name, type };
  if (value !== undefined) args.value = String(value);
  return parseResult(await callTool('add_property', args));
}
async function importPng(category, image, parentPath, name, base64Png) {
  return parseResult(await callTool('import_png', { category, image, parentPath, name, base64Png }));
}
async function setCanvas(category, image, path, base64Png) {
  return parseResult(await callTool('set_canvas_bitmap', { category, image, path, base64Png }));
}
async function saveImage(category, image) { return parseResult(await callTool('save_image', { category, image })); }
async function getChildren(category, image, cpath) {
  const args = { category, image, compact: true, limit: 500 };
  if (cpath) args.path = cpath;
  return parseResult(await callTool('get_children', args));
}
async function packToWz(category) {
  return parseResult(await callTool('pack_to_wz', { imgPath: IMG_PATH, outputDir: OUTPUT_WZ, category, wzVersion: 83 }));
}

// ========== NPC PACKING ==========
// Creates brand new .img files for each custom NPC with proper structure:
// root -> info (SubProperty) -> link (String, value "")
//      -> stand (SubProperty) -> 0 (Canvas via import_png)
//                              -> 1 (Canvas via import_png, if exists)

async function packNPCs() {
  const npcDir = path.join(SPRITES, 'custom-npcs');
  const npcs = fs.readdirSync(npcDir).filter(d => fs.statSync(path.join(npcDir, d)).isDirectory());
  console.log(`\n=== CREATING ${npcs.length} CUSTOM NPCs ===`);
  const failed = [];

  for (const npcId of npcs) {
    const imgName = `${npcId}.img`;
    const dir = path.join(npcDir, npcId);
    const s0 = path.join(dir, 'stand_0.png');
    const s1 = path.join(dir, 'stand_1.png');

    if (!fs.existsSync(s0)) { console.log(`  ${npcId}: SKIP (no stand_0.png)`); continue; }

    try {
      // Create new .img file
      await createImage('npc', imgName);

      // Build structure
      await addProp('npc', imgName, '', 'info', 'SubProperty');
      await addProp('npc', imgName, '', 'stand', 'SubProperty');

      // Import stand frames
      const b64_0 = fs.readFileSync(s0).toString('base64');
      await importPng('npc', imgName, 'stand', '0', b64_0);

      if (fs.existsSync(s1)) {
        const b64_1 = fs.readFileSync(s1).toString('base64');
        await importPng('npc', imgName, 'stand', '1', b64_1);
      }

      await saveImage('npc', imgName);
      console.log(`  ${npcId}: OK`);
    } catch (e) {
      console.log(`  ${npcId}: ERROR - ${e.message}`);
      failed.push(npcId);
    }
  }
  return failed;
}

// ========== MOB PACKING ==========
// Creates new .img for each custom mob with states: stand, move, hit1, die1, attack1

async function packMobs() {
  const mobDir = path.join(SPRITES, 'mobs');
  if (!fs.existsSync(mobDir)) { console.log('\n=== NO MOBS ==='); return []; }
  const mobs = fs.readdirSync(mobDir).filter(d => fs.statSync(path.join(mobDir, d)).isDirectory());
  console.log(`\n=== CREATING ${mobs.length} CUSTOM MOBS ===`);
  const failed = [];
  const states = ['stand', 'move', 'hit1', 'die1', 'attack1'];

  for (const mobId of mobs) {
    const imgName = `${mobId}.img`;
    const dir = path.join(mobDir, mobId);

    try {
      await createImage('mob', imgName);
      await addProp('mob', imgName, '', 'info', 'SubProperty');

      for (const state of states) {
        const frames = fs.readdirSync(dir)
          .filter(f => f.startsWith(`${state}_`) && f.endsWith('.png'))
          .sort((a, b) => {
            const na = parseInt(a.replace(`${state}_`, '').replace('.png', ''));
            const nb = parseInt(b.replace(`${state}_`, '').replace('.png', ''));
            return na - nb;
          });

        if (frames.length === 0) continue;

        await addProp('mob', imgName, '', state, 'SubProperty');

        for (const frame of frames) {
          const frameNum = frame.replace(`${state}_`, '').replace('.png', '');
          const b64 = fs.readFileSync(path.join(dir, frame)).toString('base64');
          await importPng('mob', imgName, state, frameNum, b64);
        }
      }

      await saveImage('mob', imgName);
      console.log(`  ${mobId}: OK`);
    } catch (e) {
      console.log(`  ${mobId}: ERROR - ${e.message}`);
      failed.push(mobId);
    }
  }
  return failed;
}

// ========== ITEM ICONS ==========
// For Consume (02xx) and Etc (04xx) items — create new entries in existing .img files

async function packItemIcons() {
  const iconDir = path.join(SPRITES, 'item-icons');
  if (!fs.existsSync(iconDir)) { console.log('\n=== NO ITEM ICONS ==='); return []; }
  const items = fs.readdirSync(iconDir).filter(d => fs.statSync(path.join(iconDir, d)).isDirectory());
  console.log(`\n=== PACKING ${items.length} ITEM ICONS ===`);
  const failed = [];

  // Group by .img file
  const imgGroups = {};
  for (const itemId of items) {
    const padded = itemId.padStart(8, '0');
    let category, imgFile;
    if (padded.startsWith('02')) { category = 'item'; imgFile = `Consume/${padded.substring(0, 4)}.img`; }
    else if (padded.startsWith('04')) { category = 'item'; imgFile = `Etc/${padded.substring(0, 4)}.img`; }
    else if (padded.startsWith('01') || padded.startsWith('10')) continue; // handled elsewhere
    else { console.log(`  ${itemId}: SKIP (unknown prefix)`); continue; }
    const key = `${category}:${imgFile}`;
    if (!imgGroups[key]) imgGroups[key] = [];
    imgGroups[key].push({ itemId, padded });
  }

  for (const [key, groupItems] of Object.entries(imgGroups)) {
    const [category, imgFile] = key.split(':');
    try {
      await parseImage(category, imgFile);
      const children = await getChildren(category, imgFile, '');
      const existingIds = new Set(children.data.children.map(c => c.name));

      for (const { itemId, padded } of groupItems) {
        const iconPath = path.join(iconDir, itemId, 'icon.png');
        const iconRawPath = path.join(iconDir, itemId, 'iconRaw.png');
        try {
          if (!existingIds.has(padded)) {
            // Create new item entry
            await addProp(category, imgFile, '', padded, 'SubProperty');
            await addProp(category, imgFile, padded, 'info', 'SubProperty');
            if (fs.existsSync(iconPath)) {
              await importPng(category, imgFile, `${padded}/info`, 'icon', fs.readFileSync(iconPath).toString('base64'));
            }
            if (fs.existsSync(iconRawPath)) {
              await importPng(category, imgFile, `${padded}/info`, 'iconRaw', fs.readFileSync(iconRawPath).toString('base64'));
            }
          } else {
            // Replace existing
            if (fs.existsSync(iconPath)) {
              await setCanvas(category, imgFile, `${padded}/info/icon`, fs.readFileSync(iconPath).toString('base64'));
            }
            if (fs.existsSync(iconRawPath)) {
              await setCanvas(category, imgFile, `${padded}/info/iconRaw`, fs.readFileSync(iconRawPath).toString('base64'));
            }
          }
        } catch (e) {
          console.log(`  ${itemId}: ERROR - ${e.message}`);
          failed.push(itemId);
        }
      }
      await saveImage(category, imgFile);
      console.log(`  ${key}: saved (${groupItems.length} items)`);
    } catch (e) {
      console.log(`  ${key}: ERROR - ${e.message}`);
      failed.push(key);
    }
  }
  return failed;
}

// ========== WEAPONS ==========

async function packWeapons() {
  const weapDir = path.join(SPRITES, 'custom-items');
  if (!fs.existsSync(weapDir)) { console.log('\n=== NO WEAPONS ==='); return []; }
  const weapons = fs.readdirSync(weapDir).filter(f => f.endsWith('.png') && !f.includes('_full'));
  console.log(`\n=== PACKING ${weapons.length} WEAPONS ===`);
  const failed = [];

  for (const file of weapons) {
    const weapId = file.replace('.png', '');
    const padded = weapId.padStart(8, '0');
    const imgName = `Weapon/${padded}.img`;
    try {
      await parseImage('character', imgName);
      await setCanvas('character', imgName, 'info/icon', fs.readFileSync(path.join(weapDir, file)).toString('base64'));
      const fullFile = path.join(weapDir, `${weapId}_full.png`);
      if (fs.existsSync(fullFile)) {
        await setCanvas('character', imgName, 'info/iconRaw', fs.readFileSync(fullFile).toString('base64'));
      }
      await saveImage('character', imgName);
      console.log(`  ${weapId}: OK`);
    } catch (e) {
      console.log(`  ${weapId}: ERROR - ${e.message}`);
      failed.push(weapId);
    }
  }
  return failed;
}

// ========== EQUIPMENT ==========

async function packEquipment() {
  const equipDir = path.join(SPRITES, 'equipment');
  if (!fs.existsSync(equipDir)) { console.log('\n=== NO EQUIPMENT ==='); return []; }
  const items = fs.readdirSync(equipDir).filter(d => fs.statSync(path.join(equipDir, d)).isDirectory());
  console.log(`\n=== PACKING ${items.length} EQUIPMENT ===`);
  const failed = [];

  for (const itemId of items) {
    const padded = itemId.padStart(8, '0');
    let imgName;
    if (padded.startsWith('01003')) imgName = `Cap/${padded}.img`;
    else if (padded.startsWith('01142')) imgName = `Accessory/${padded}.img`;
    else { console.log(`  ${itemId}: SKIP`); continue; }

    try {
      await parseImage('character', imgName);
      const dir = path.join(equipDir, itemId);
      const pngs = fs.readdirSync(dir).filter(f => f.endsWith('.png'));

      for (const png of pngs) {
        const propName = png.replace('.png', '');
        const b64 = fs.readFileSync(path.join(dir, png)).toString('base64');
        try {
          const r = await setCanvas('character', imgName, `info/${propName}`, b64);
          if (!r.success) await importPng('character', imgName, 'info', propName, b64);
        } catch (e) {
          try { await importPng('character', imgName, 'info', propName, b64); }
          catch (e2) { failed.push(`${itemId}/${png}`); }
        }
      }
      await saveImage('character', imgName);
      console.log(`  ${itemId}: OK`);
    } catch (e) {
      console.log(`  ${itemId}: ERROR - ${e.message}`);
      failed.push(itemId);
    }
  }
  return failed;
}

// ========== SKILLS ==========

async function packSkills() {
  console.log(`\n=== PACKING SKILL SPRITES ===`);
  const failed = [];
  const classes = [
    { name: 'necromancer', jobs: ['700', '710', '711', '712'] },
    { name: 'sage', jobs: ['600', '610', '611', '612'] }
  ];

  for (const cls of classes) {
    const baseDir = path.join(SPRITES, cls.name);
    if (!fs.existsSync(baseDir)) { console.log(`  ${cls.name}: SKIP (no dir)`); continue; }

    const iconsFile = path.join(baseDir, 'icons_b64.json');
    let icons = {};
    if (fs.existsSync(iconsFile)) icons = JSON.parse(fs.readFileSync(iconsFile, 'utf8'));

    for (const job of cls.jobs) {
      const imgName = `${job}.img`;
      const jobDir = path.join(baseDir, job);
      if (!fs.existsSync(jobDir)) { console.log(`  ${cls.name}/${job}: SKIP`); continue; }

      try {
        await parseImage('skill', imgName);
        let spriteCount = 0;

        const children = await getChildren('skill', imgName, '');
        const existingSkills = new Set(children.data.children.map(c => c.name));

        // Process subdirectories (each is a skill ID)
        const skillDirs = fs.readdirSync(jobDir).filter(d =>
          fs.statSync(path.join(jobDir, d)).isDirectory()
        );

        for (const skillId of skillDirs) {
          const skillDir = path.join(jobDir, skillId);
          const needsCreate = !existingSkills.has(skillId);

          try {
            if (needsCreate) {
              await addProp('skill', imgName, '', skillId, 'SubProperty');
              existingSkills.add(skillId);
            }

            // Icon
            const iconPng = path.join(skillDir, 'icon.png');
            if (fs.existsSync(iconPng)) {
              const b64 = fs.readFileSync(iconPng).toString('base64');
              if (needsCreate) {
                await importPng('skill', imgName, skillId, 'icon', b64);
              } else {
                try { await setCanvas('skill', imgName, `${skillId}/icon`, b64); }
                catch { await importPng('skill', imgName, skillId, 'icon', b64); }
              }
              spriteCount++;
            }

            // Effect frames
            const effectPngs = fs.readdirSync(skillDir)
              .filter(f => f.startsWith('effect_') && f.endsWith('.png')).sort();

            if (effectPngs.length > 0) {
              if (needsCreate) await addProp('skill', imgName, skillId, 'effect', 'SubProperty');
              for (const ePng of effectPngs) {
                const frameNum = ePng.replace('effect_', '').replace('.png', '');
                const b64 = fs.readFileSync(path.join(skillDir, ePng)).toString('base64');
                try { await setCanvas('skill', imgName, `${skillId}/effect/${frameNum}`, b64); }
                catch { await importPng('skill', imgName, `${skillId}/effect`, frameNum, b64); }
                spriteCount++;
              }
            }
          } catch (e) {
            console.log(`  ${job}/${skillId}: ERROR - ${e.message}`);
            failed.push(`${job}/${skillId}`);
          }
        }

        // icons_b64.json
        for (const [skillId, b64] of Object.entries(icons)) {
          if (skillId.startsWith(job)) {
            try {
              if (!existingSkills.has(skillId)) {
                await addProp('skill', imgName, '', skillId, 'SubProperty');
                existingSkills.add(skillId);
              }
              try { await setCanvas('skill', imgName, `${skillId}/icon`, b64); }
              catch { await importPng('skill', imgName, skillId, 'icon', b64); }
              spriteCount++;
            } catch (e) { failed.push(`${job}/${skillId}`); }
          }
        }

        await saveImage('skill', imgName);
        console.log(`  ${cls.name}/${job}: OK (${spriteCount} sprites)`);
      } catch (e) {
        console.log(`  ${cls.name}/${job}: ERROR - ${e.message}`);
        failed.push(`${cls.name}/${job}`);
      }
    }
  }
  return failed;
}

// ========== CLASS SELECTION UI ==========

async function packClassSelection() {
  console.log(`\n=== PACKING CLASS SELECTION UI ===`);
  const failed = [];
  const csDir = path.join(SPRITES, 'class-selection');
  if (!fs.existsSync(csDir)) { console.log('  No class-selection dir'); return []; }

  const classes = fs.readdirSync(csDir).filter(d => fs.statSync(path.join(csDir, d)).isDirectory());

  try {
    await parseImage('ui', 'Login.img');
    for (const cls of classes) {
      const clsDir = path.join(csDir, cls);
      const pngs = fs.readdirSync(clsDir).filter(f => f.endsWith('.png'));
      for (const png of pngs) {
        const b64 = fs.readFileSync(path.join(clsDir, png)).toString('base64');
        const propName = png.replace('.png', '');
        try { await setCanvas('ui', 'Login.img', `RaceSelect/${cls}/${propName}`, b64); }
        catch {
          try { await importPng('ui', 'Login.img', `RaceSelect/${cls}`, propName, b64); }
          catch (e2) { failed.push(`${cls}/${propName}`); }
        }
      }
      console.log(`  ${cls}: ${pngs.length} sprites`);
    }
    await saveImage('ui', 'Login.img');
    console.log('  Login.img saved');
  } catch (e) {
    console.log(`  Login.img ERROR: ${e.message}`);
    failed.push('Login.img');
  }
  return failed;
}

// ========== BUILD WZ ==========

async function buildWzFiles() {
  console.log(`\n=== BUILDING WZ FILES ===`);
  if (!fs.existsSync(OUTPUT_WZ)) fs.mkdirSync(OUTPUT_WZ, { recursive: true });

  // Pack only modified categories
  for (const cat of MODIFIED_CATEGORIES) {
    try {
      const r = await packToWz(cat);
      console.log(`  [PACK] ${WZ_CASING[cat]}.wz: OK`);

      // Fix casing on disk
      const lowPath = path.join(OUTPUT_WZ, `${cat}.wz`);
      const properPath = path.join(OUTPUT_WZ, `${WZ_CASING[cat]}.wz`);
      if (cat !== WZ_CASING[cat] && fs.existsSync(lowPath)) {
        const tmpPath = path.join(OUTPUT_WZ, `_tmp_${WZ_CASING[cat]}.wz`);
        fs.renameSync(lowPath, tmpPath);
        fs.renameSync(tmpPath, properPath);
      }
    } catch (e) {
      console.log(`  [PACK] ${WZ_CASING[cat]}.wz: ERROR - ${e.message}`);
    }
  }

  // Copy vanilla for unmodified categories
  for (const cat of VANILLA_CATEGORIES) {
    const src = path.join(VANILLA_WZ, `${WZ_CASING[cat]}.wz`);
    const dst = path.join(OUTPUT_WZ, `${WZ_CASING[cat]}.wz`);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
      console.log(`  [COPY] ${WZ_CASING[cat]}.wz: OK (vanilla)`);
    } else {
      console.log(`  [COPY] ${WZ_CASING[cat]}.wz: NOT FOUND in vanilla`);
    }
  }
}

// ========== MAIN ==========

async function main() {
  console.log('Starting WzImgMCP...');
  await startMCP();
  console.log('MCP initialized');
  await initDataSource();
  console.log('Data source loaded');

  const allFailed = [];
  allFailed.push(...await packNPCs());
  allFailed.push(...await packMobs());
  allFailed.push(...await packItemIcons());
  allFailed.push(...await packWeapons());
  allFailed.push(...await packEquipment());
  allFailed.push(...await packSkills());
  allFailed.push(...await packClassSelection());

  await buildWzFiles();

  console.log('\n=== SUMMARY ===');
  if (allFailed.length === 0) {
    console.log('All sprites packed successfully!');
  } else {
    console.log(`${allFailed.length} failures:`);
    allFailed.forEach(f => console.log(`  - ${f}`));
  }

  proc.kill();
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal:', e);
  if (proc) proc.kill();
  process.exit(1);
});
