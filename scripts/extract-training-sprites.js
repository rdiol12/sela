/**
 * Extract MapleStory v83 sprites from WZ files for LoRA training.
 * Connects to harepacker-mcp, exports mob/NPC stand frames as PNGs.
 * Creates caption files for kohya_ss training.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

const WZ_MCP_EXE = 'C:/Users/rdiol/sela/workspace/WzImg-MCP-Server/WzImgMCP/bin/Debug/net8.0-windows/WzImgMCP.exe';
const WZ_DATA = 'C:/Users/rdiol/sela/workspace/v83-img-data';
const OUTPUT_DIR = 'C:/Users/rdiol/sela/workspace/lora-training/images';
const STRING_WZ = 'C:/Users/rdiol/sela/workspace/Cosmic/wz/String.wz';

// Mob animation states we want to extract
const MOB_STATES = ['stand', 'move', 'hit1', 'die1', 'attack1'];
const NPC_STATES = ['stand'];

let client;
let extracted = 0;
let failed = 0;

async function connectMCP() {
  const transport = new StdioClientTransport({
    command: WZ_MCP_EXE,
    args: [],
    env: { ...process.env, WZIMGMCP_DATA_PATH: WZ_DATA },
  });

  client = new Client({ name: 'sprite-extractor', version: '1.0.0' });
  await client.connect(transport);
  console.log('Connected to harepacker-mcp');

  // Init data source
  await callTool('init_data_source', { basePath: WZ_DATA });
  console.log('Data source initialized');
}

async function callTool(name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.content?.[0]?.text) return JSON.parse(result.content[0].text);
  return result;
}

async function exportSprite(category, image, path, outFile) {
  try {
    const result = await callTool('export_png', {
      category,
      image,
      path,
      outputPath: outFile,
    });
    return result?.success !== false;
  } catch {
    return false;
  }
}

async function getTreeStructure(category, image, depth = 1) {
  try {
    return await callTool('get_tree_structure', { category, image, depth });
  } catch {
    return null;
  }
}

// Load mob names from String.wz
async function loadMobNames() {
  const names = {};
  const stringPath = join(STRING_WZ, 'Mob.img.xml');
  if (!existsSync(stringPath)) {
    console.warn('String.wz/Mob.img.xml not found, using ID-only captions');
    return names;
  }
  const xml = await readFile(stringPath, 'utf8');
  const regex = /<imgdir name="(\d+)">\s*<string name="name" value="([^"]+)"/g;
  let m;
  while ((m = regex.exec(xml))) {
    names[m[1]] = m[2];
  }
  console.log(`Loaded ${Object.keys(names).length} mob names`);
  return names;
}

// Load NPC names
async function loadNpcNames() {
  const names = {};
  const stringPath = join(STRING_WZ, 'Npc.img.xml');
  if (!existsSync(stringPath)) return names;
  const xml = await readFile(stringPath, 'utf8');
  const regex = /<imgdir name="(\d+)">\s*<string name="name" value="([^"]+)"/g;
  let m;
  while ((m = regex.exec(xml))) {
    names[m[1]] = m[2];
  }
  console.log(`Loaded ${Object.keys(names).length} NPC names`);
  return names;
}

function buildCaption(name, category, state) {
  const stateDesc = {
    stand: 'standing idle pose',
    move: 'walking movement pose',
    hit1: 'getting hit flinching pose',
    die1: 'death falling pose',
    attack1: 'attack striking pose',
  };
  const pose = stateDesc[state] || state;
  const catDesc = category === 'Mob' ? 'monster creature' : 'NPC character';

  return `pixel art, maplestory v83 game sprite, ${name}, ${catDesc}, ${pose}, chibi proportions, black outline, flat shading, side view, 2d game asset, white background, clean simple design`;
}

async function extractMobs(mobNames) {
  // Get list of mob images
  const mobDir = join(WZ_DATA, 'Mob');
  const { readdirSync } = await import('fs');
  const files = readdirSync(mobDir).filter(f => f.endsWith('.img'));
  console.log(`Found ${files.length} mob .img entries`);

  // Extract up to 400 mobs (reasonable training set)
  const maxMobs = 400;
  let count = 0;

  for (const file of files) {
    if (count >= maxMobs) break;
    const mobId = file.replace('.img', '');

    // Check which states exist for this mob
    const tree = await getTreeStructure('Mob', file, 1);
    if (!tree) continue;

    const availableStates = [];
    const treeStr = JSON.stringify(tree);
    for (const state of MOB_STATES) {
      if (treeStr.includes(`"${state}"`)) availableStates.push(state);
    }

    if (availableStates.length === 0) continue;

    const name = mobNames[mobId] || `mob_${mobId}`;

    for (const state of availableStates) {
      const outFile = join(OUTPUT_DIR, `mob_${mobId}_${state}.png`);
      const captionFile = join(OUTPUT_DIR, `mob_${mobId}_${state}.txt`);

      if (existsSync(outFile)) { extracted++; continue; }

      const ok = await exportSprite('Mob', file, `${state}/0`, outFile);
      if (ok) {
        await writeFile(captionFile, buildCaption(name, 'Mob', state));
        extracted++;
        if (extracted % 50 === 0) console.log(`Extracted ${extracted} sprites...`);
      } else {
        failed++;
      }
    }
    count++;
  }
}

async function extractNpcs(npcNames) {
  const npcDir = join(WZ_DATA, 'Npc');
  const { readdirSync } = await import('fs');
  const files = readdirSync(npcDir).filter(f => f.endsWith('.img'));
  console.log(`Found ${files.length} NPC .img entries`);

  const maxNpcs = 150;
  let count = 0;

  for (const file of files) {
    if (count >= maxNpcs) break;
    const npcId = file.replace('.img', '');
    const name = npcNames[npcId] || `npc_${npcId}`;

    for (const state of NPC_STATES) {
      const outFile = join(OUTPUT_DIR, `npc_${npcId}_${state}.png`);
      const captionFile = join(OUTPUT_DIR, `npc_${npcId}_${state}.txt`);

      if (existsSync(outFile)) { extracted++; continue; }

      const ok = await exportSprite('Npc', file, `${state}/0`, outFile);
      if (ok) {
        await writeFile(captionFile, buildCaption(name, 'Npc', state));
        extracted++;
        if (extracted % 50 === 0) console.log(`Extracted ${extracted} sprites...`);
      } else {
        failed++;
      }
    }
    count++;
  }
}

async function main() {
  console.log('=== MapleStory v83 Sprite Extractor for LoRA Training ===\n');

  await mkdir(OUTPUT_DIR, { recursive: true });

  // Connect to harepacker-mcp
  await connectMCP();

  // Load names
  const [mobNames, npcNames] = await Promise.all([loadMobNames(), loadNpcNames()]);

  // Extract mobs (stand, move, hit, die, attack frames)
  console.log('\n--- Extracting Mob Sprites ---');
  await extractMobs(mobNames);

  // Extract NPCs (stand frames)
  console.log('\n--- Extracting NPC Sprites ---');
  await extractNpcs(npcNames);

  console.log(`\n=== Done ===`);
  console.log(`Extracted: ${extracted}`);
  console.log(`Failed: ${failed}`);
  console.log(`Output: ${OUTPUT_DIR}`);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
