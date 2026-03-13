/**
 * Pack ALL custom MapleStory sprites into .img files via WzImgMCP stdio.
 * Spawns the MCP server, sends JSON-RPC tool calls, processes everything.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const MCP_EXE = 'C:/Users/rdiol/sela/workspace/WzImg-MCP-Server/WzImgMCP/bin/Debug/net8.0-windows/WzImgMCP.exe';
const DATA_PATH = 'C:/Users/rdiol/sela/workspace/npc-wz-img';
const SPRITES = 'C:/Users/rdiol/sela/workspace/maple-sprites';

let requestId = 0;
let proc = null;
let buffer = '';
const pending = new Map();

function startMCP() {
  return new Promise((resolve, reject) => {
    proc = spawn(MCP_EXE, [], {
      env: { ...process.env, WZIMGMCP_DATA_PATH: DATA_PATH },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    proc.stderr.on('data', d => {
      const msg = d.toString();
      if (msg.includes('error') || msg.includes('Error')) {
        console.error('[MCP stderr]', msg.trim());
      }
    });

    proc.stdout.on('data', d => {
      buffer += d.toString();
      // Process complete JSON-RPC messages (newline delimited)
      let lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
          }
        } catch (e) {
          // not JSON, ignore
        }
      }
    });

    proc.on('error', reject);

    // Send initialize
    const id = ++requestId;
    const initMsg = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'pack-script', version: '1.0' }
      }
    }) + '\n';

    pending.set(id, (resp) => {
      // Send initialized notification
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      resolve(resp);
    });

    proc.stdin.write(initMsg);

    // Timeout
    setTimeout(() => reject(new Error('MCP init timeout')), 15000);
  });
}

async function callTool(name, args) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const msg = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args }
    }) + '\n';

    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout calling ${name}`));
    }, 30000);

    pending.set(id, (resp) => {
      clearTimeout(timer);
      if (resp.error) {
        reject(new Error(resp.error.message || JSON.stringify(resp.error)));
      } else {
        resolve(resp.result);
      }
    });

    proc.stdin.write(msg);
  });
}

function parseToolResult(result) {
  // MCP tool results come as content array
  if (result && result.content && result.content[0]) {
    try {
      return JSON.parse(result.content[0].text);
    } catch {
      return result.content[0].text;
    }
  }
  return result;
}

async function initDataSource() {
  const r = await callTool('init_data_source', { basePath: DATA_PATH });
  const parsed = parseToolResult(r);
  console.log('Data source initialized:', parsed.success ? 'OK' : 'FAIL');
  return parsed;
}

async function parseImage(category, image) {
  const r = await callTool('parse_image', { category, image });
  return parseToolResult(r);
}

async function setCanvasBitmap(category, image, path, base64Png) {
  const r = await callTool('set_canvas_bitmap', { category, image, path, base64Png });
  return parseToolResult(r);
}

async function saveImage(category, image) {
  const r = await callTool('save_image', { category, image });
  return parseToolResult(r);
}

async function addProperty(category, image, parentPath, name, type, value) {
  const args = { category, image, parentPath, name, type };
  if (value !== undefined) args.value = value;
  const r = await callTool('add_property', args);
  return parseToolResult(r);
}

async function importPng(category, image, parentPath, name, base64Png, originX, originY) {
  const args = { category, image, parentPath, name, base64Png };
  if (originX !== undefined) args.originX = originX;
  if (originY !== undefined) args.originY = originY;
  const r = await callTool('import_png', args);
  return parseToolResult(r);
}

async function getChildren(category, image, path) {
  const args = { category, image, compact: true, limit: 500 };
  if (path) args.path = path;
  const r = await callTool('get_children', args);
  return parseToolResult(r);
}

// ========== PACK FUNCTIONS ==========

async function packNPCs() {
  const npcDir = path.join(SPRITES, 'custom-npcs');
  const npcs = fs.readdirSync(npcDir).filter(d =>
    fs.statSync(path.join(npcDir, d)).isDirectory()
  );

  console.log(`\n=== PACKING ${npcs.length} NPCs ===`);
  const failed = [];

  for (const npcId of npcs) {
    const imgName = `${npcId}.img`;
    const s0Path = path.join(npcDir, npcId, 'stand_0.png');
    const s1Path = path.join(npcDir, npcId, 'stand_1.png');

    if (!fs.existsSync(s0Path) || !fs.existsSync(s1Path)) {
      console.log(`  ${npcId}: SKIP (missing sprites)`);
      continue;
    }

    try {
      await parseImage('npc', imgName);
      const s0b64 = fs.readFileSync(s0Path).toString('base64');
      const s1b64 = fs.readFileSync(s1Path).toString('base64');

      const r0 = await setCanvasBitmap('npc', imgName, 'stand/0', s0b64);
      if (!r0.success) {
        console.log(`  ${npcId}: stand/0 FAILED - ${r0.error || 'unknown'}`);
        failed.push(`${npcId}/stand_0`);
      }

      const r1 = await setCanvasBitmap('npc', imgName, 'stand/1', s1b64);
      if (!r1.success) {
        console.log(`  ${npcId}: stand/1 FAILED - ${r1.error || 'unknown'}`);
        failed.push(`${npcId}/stand_1`);
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

async function packMobs() {
  const mobDir = path.join(SPRITES, 'mobs');
  const mobs = fs.readdirSync(mobDir).filter(d =>
    fs.statSync(path.join(mobDir, d)).isDirectory()
  );

  console.log(`\n=== PACKING ${mobs.length} MOBS ===`);
  const failed = [];
  const states = ['stand', 'move', 'hit1', 'die1', 'attack1'];

  for (const mobId of mobs) {
    const imgName = `${mobId}.img`;
    const mobPath = path.join(mobDir, mobId);

    try {
      await parseImage('mob', imgName);

      for (const state of states) {
        // Find all frames for this state
        const frames = fs.readdirSync(mobPath)
          .filter(f => f.startsWith(`${state}_`) && f.endsWith('.png'))
          .sort((a, b) => {
            const na = parseInt(a.replace(`${state}_`, '').replace('.png', ''));
            const nb = parseInt(b.replace(`${state}_`, '').replace('.png', ''));
            return na - nb;
          });

        for (const frame of frames) {
          const frameNum = frame.replace(`${state}_`, '').replace('.png', '');
          const b64 = fs.readFileSync(path.join(mobPath, frame)).toString('base64');
          try {
            const r = await setCanvasBitmap('mob', imgName, `${state}/${frameNum}`, b64);
            if (!r.success) {
              console.log(`  ${mobId}/${state}/${frameNum}: FAILED`);
              failed.push(`${mobId}/${state}/${frameNum}`);
            }
          } catch (e) {
            console.log(`  ${mobId}/${state}/${frameNum}: ERROR - ${e.message}`);
            failed.push(`${mobId}/${state}/${frameNum}`);
          }
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

async function packItemIcons() {
  const iconDir = path.join(SPRITES, 'item-icons');
  const items = fs.readdirSync(iconDir).filter(d =>
    fs.statSync(path.join(iconDir, d)).isDirectory()
  );

  console.log(`\n=== PACKING ${items.length} ITEM ICONS ===`);
  const failed = [];

  // Group items by their .img file
  const imgGroups = {};
  for (const itemId of items) {
    const padded = itemId.padStart(8, '0');
    let category, imgFile;

    if (padded.startsWith('02')) {
      category = 'item';
      imgFile = `Consume/${padded.substring(0, 4)}.img`;
    } else if (padded.startsWith('04')) {
      category = 'item';
      imgFile = `Etc/${padded.substring(0, 4)}.img`;
    } else if (padded.startsWith('01')) {
      // Skip weapons here — handled in packWeapons
      continue;
    } else if (padded.startsWith('10')) {
      // Skip equip here — handled in packEquipment
      continue;
    } else {
      console.log(`  ${itemId}: SKIP (unknown prefix)`);
      continue;
    }

    const key = `${category}:${imgFile}`;
    if (!imgGroups[key]) imgGroups[key] = [];
    imgGroups[key].push({ itemId, padded });
  }

  for (const [key, groupItems] of Object.entries(imgGroups)) {
    const [category, imgFile] = key.split(':');

    try {
      await parseImage(category, imgFile);

      // Get existing children to know which items already exist
      const children = await getChildren(category, imgFile, '');
      const existingIds = new Set(children.data.children.map(c => c.name));

      for (const { itemId, padded } of groupItems) {
        const iconPath = path.join(iconDir, itemId, 'icon.png');
        const iconRawPath = path.join(iconDir, itemId, 'iconRaw.png');
        const needsCreate = !existingIds.has(padded);

        try {
          if (needsCreate) {
            // Create the item structure: ITEMID/info then import PNGs
            await addProperty(category, imgFile, '', padded, 'SubProperty');
            await addProperty(category, imgFile, padded, 'info', 'SubProperty');

            if (fs.existsSync(iconPath)) {
              const b64 = fs.readFileSync(iconPath).toString('base64');
              const r = await importPng(category, imgFile, `${padded}/info`, 'icon', b64);
              if (!r.success) { failed.push(`${itemId}/icon`); console.log(`  ${itemId}/icon: FAILED (import)`); }
            }
            if (fs.existsSync(iconRawPath)) {
              const b64 = fs.readFileSync(iconRawPath).toString('base64');
              const r = await importPng(category, imgFile, `${padded}/info`, 'iconRaw', b64);
              if (!r.success) { failed.push(`${itemId}/iconRaw`); console.log(`  ${itemId}/iconRaw: FAILED (import)`); }
            }
          } else {
            // Item exists — replace canvases
            if (fs.existsSync(iconPath)) {
              const b64 = fs.readFileSync(iconPath).toString('base64');
              const r = await setCanvasBitmap(category, imgFile, `${padded}/info/icon`, b64);
              if (!r.success) { failed.push(`${itemId}/icon`); console.log(`  ${itemId}/icon: FAILED (set)`); }
            }
            if (fs.existsSync(iconRawPath)) {
              const b64 = fs.readFileSync(iconRawPath).toString('base64');
              const r = await setCanvasBitmap(category, imgFile, `${padded}/info/iconRaw`, b64);
              if (!r.success) { failed.push(`${itemId}/iconRaw`); }
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

async function packWeapons() {
  const weapDir = path.join(SPRITES, 'custom-items');
  const weapons = fs.readdirSync(weapDir).filter(f => f.endsWith('.png') && !f.includes('_full'));

  console.log(`\n=== PACKING ${weapons.length} WEAPONS ===`);
  const failed = [];

  for (const file of weapons) {
    const weapId = file.replace('.png', '');
    const imgName = `Weapon/${weapId}.img`;
    const fullFile = `${weapId}_full.png`;

    try {
      await parseImage('character', imgName);

      const b64 = fs.readFileSync(path.join(weapDir, file)).toString('base64');
      const r = await setCanvasBitmap('character', imgName, 'info/icon', b64);
      if (!r.success) failed.push(`${weapId}/icon`);

      if (fs.existsSync(path.join(weapDir, fullFile))) {
        const fb64 = fs.readFileSync(path.join(weapDir, fullFile)).toString('base64');
        const r2 = await setCanvasBitmap('character', imgName, 'info/iconRaw', fb64);
        if (!r2.success) failed.push(`${weapId}/iconRaw`);
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

async function packEquipment() {
  const equipDir = path.join(SPRITES, 'equipment');
  const items = fs.readdirSync(equipDir).filter(d =>
    fs.statSync(path.join(equipDir, d)).isDirectory()
  );

  console.log(`\n=== PACKING ${items.length} EQUIPMENT ===`);
  const failed = [];

  for (const itemId of items) {
    // Equipment IDs: 1003074 -> 01003074.img in Cap/, 1142153 -> 01142153.img in Accessory/
    const padded = itemId.padStart(8, '0');
    let imgName;
    if (padded.startsWith('01003')) imgName = `Cap/${padded}.img`;
    else if (padded.startsWith('01142')) imgName = `Accessory/${padded}.img`;
    else { console.log(`  ${itemId}: SKIP (unknown equip type)`); continue; }

    try {
      await parseImage('character', imgName);

      // Check if info subprop exists
      let hasInfo = false;
      try {
        const children = await getChildren('character', imgName, '');
        hasInfo = children.data.children.some(c => c.name === 'info');
      } catch (e) {}

      if (!hasInfo) {
        await addProperty('character', imgName, '', 'info', 'SubProperty');
      }

      const dir = path.join(equipDir, itemId);
      const pngs = fs.readdirSync(dir).filter(f => f.endsWith('.png'));

      for (const png of pngs) {
        const b64 = fs.readFileSync(path.join(dir, png)).toString('base64');
        const propName = png.replace('.png', '');

        // Try set_canvas_bitmap first; if it fails, use import_png
        try {
          const r = await setCanvasBitmap('character', imgName, `info/${propName}`, b64);
          if (!r.success) {
            // Canvas doesn't exist yet, import it
            const r2 = await importPng('character', imgName, 'info', propName, b64);
            if (!r2.success) { failed.push(`${itemId}/${png}`); console.log(`  ${itemId}/${png}: FAILED`); }
          }
        } catch (e) {
          // Try import
          try {
            const r2 = await importPng('character', imgName, 'info', propName, b64);
            if (!r2.success) failed.push(`${itemId}/${png}`);
          } catch (e2) {
            failed.push(`${itemId}/${png}`);
          }
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

async function packSkills() {
  console.log(`\n=== PACKING SKILL SPRITES ===`);
  const failed = [];
  const classes = [
    { name: 'necromancer', jobs: ['700', '710', '711', '712'] },
    { name: 'sage', jobs: ['600', '610', '611', '612'] }
  ];

  for (const cls of classes) {
    const baseDir = path.join(SPRITES, cls.name);

    // Load icons_b64.json if exists (pre-encoded skill icons)
    const iconsFile = path.join(baseDir, 'icons_b64.json');
    let icons = {};
    if (fs.existsSync(iconsFile)) {
      icons = JSON.parse(fs.readFileSync(iconsFile, 'utf8'));
    }

    for (const job of cls.jobs) {
      const imgName = `${job}.img`;
      const jobDir = path.join(baseDir, job);

      if (!fs.existsSync(jobDir)) {
        console.log(`  ${cls.name}/${job}: SKIP (no dir)`);
        continue;
      }

      try {
        await parseImage('skill', imgName);
        let spriteCount = 0;

        // Get existing skill children
        const children = await getChildren('skill', imgName, '');
        const existingSkills = new Set(children.data.children.map(c => c.name));

        // Skills are in subdirectories: 710/7101000/icon.png, 710/7101000/effect_0.png, etc.
        const skillDirs = fs.readdirSync(jobDir).filter(d =>
          fs.statSync(path.join(jobDir, d)).isDirectory()
        );

        for (const skillId of skillDirs) {
          const skillDir = path.join(jobDir, skillId);
          const iconPng = path.join(skillDir, 'icon.png');
          const needsCreate = !existingSkills.has(skillId);

          try {
            if (needsCreate) {
              // Create skill entry
              await addProperty('skill', imgName, '', skillId, 'SubProperty');
              existingSkills.add(skillId);
            }

            // Import/replace icon
            if (fs.existsSync(iconPng)) {
              const b64 = fs.readFileSync(iconPng).toString('base64');
              if (needsCreate) {
                await importPng('skill', imgName, skillId, 'icon', b64);
              } else {
                const r = await setCanvasBitmap('skill', imgName, `${skillId}/icon`, b64);
                if (!r.success) {
                  // icon doesn't exist yet, import it
                  await importPng('skill', imgName, skillId, 'icon', b64);
                }
              }
              spriteCount++;
            }

            // Handle effect frames (effect_0.png, effect_1.png, ...)
            const effectPngs = fs.readdirSync(skillDir)
              .filter(f => f.startsWith('effect_') && f.endsWith('.png'))
              .sort();

            if (effectPngs.length > 0) {
              // Check/create effect subproperty
              if (needsCreate) {
                await addProperty('skill', imgName, skillId, 'effect', 'SubProperty');
              }

              for (const ePng of effectPngs) {
                const frameNum = ePng.replace('effect_', '').replace('.png', '');
                const b64 = fs.readFileSync(path.join(skillDir, ePng)).toString('base64');
                try {
                  const r = await setCanvasBitmap('skill', imgName, `${skillId}/effect/${frameNum}`, b64);
                  if (!r.success) {
                    await importPng('skill', imgName, `${skillId}/effect`, frameNum, b64);
                  }
                } catch (e) {
                  try {
                    await importPng('skill', imgName, `${skillId}/effect`, frameNum, b64);
                  } catch (e2) {
                    failed.push(`${job}/${skillId}/effect_${frameNum}`);
                  }
                }
                spriteCount++;
              }
            }
          } catch (e) {
            console.log(`  ${job}/${skillId}: ERROR - ${e.message}`);
            failed.push(`${job}/${skillId}`);
          }
        }

        // Also handle icons from icons_b64.json
        for (const [skillId, b64] of Object.entries(icons)) {
          if (skillId.startsWith(job)) {
            try {
              if (!existingSkills.has(skillId)) {
                await addProperty('skill', imgName, '', skillId, 'SubProperty');
              }
              const r = await setCanvasBitmap('skill', imgName, `${skillId}/icon`, b64);
              if (!r.success) {
                await importPng('skill', imgName, skillId, 'icon', b64);
              }
              spriteCount++;
            } catch (e) {
              failed.push(`${job}/${skillId}/icon_b64`);
            }
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

async function packClassSelection() {
  console.log(`\n=== PACKING CLASS SELECTION UI ===`);
  const failed = [];
  const csDir = path.join(SPRITES, 'class-selection');

  if (!fs.existsSync(csDir)) {
    console.log('  No class-selection directory');
    return failed;
  }

  const classes = fs.readdirSync(csDir).filter(d =>
    fs.statSync(path.join(csDir, d)).isDirectory()
  );

  // These go in ui/Login.img under RaceSelect
  try {
    await parseImage('ui', 'Login.img');

    for (const cls of classes) {
      const clsDir = path.join(csDir, cls);
      const pngs = fs.readdirSync(clsDir).filter(f => f.endsWith('.png'));

      for (const png of pngs) {
        const b64 = fs.readFileSync(path.join(clsDir, png)).toString('base64');
        const propName = png.replace('.png', '');
        try {
          const r = await setCanvasBitmap('ui', 'Login.img', `RaceSelect/${cls}/${propName}`, b64);
          if (!r.success) failed.push(`${cls}/${propName}`);
        } catch (e) {
          failed.push(`${cls}/${propName}`);
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

// ========== MAIN ==========

async function main() {
  console.log('Starting WzImgMCP...');
  await startMCP();
  console.log('MCP initialized');

  await initDataSource();

  const allFailed = [];

  // NPCs, Mobs, Weapons, ClassSelection already packed successfully in first run
  // Only run the categories that had failures
  const SKIP_DONE = process.argv.includes('--retry-only');

  if (!SKIP_DONE) {
    allFailed.push(...await packNPCs());
    allFailed.push(...await packMobs());
  }
  allFailed.push(...await packItemIcons());
  if (!SKIP_DONE) {
    allFailed.push(...await packWeapons());
  }
  allFailed.push(...await packEquipment());
  allFailed.push(...await packSkills());
  if (!SKIP_DONE) {
    allFailed.push(...await packClassSelection());
  }

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
