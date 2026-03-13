/**
 * modules/maplestory/lora-sprite-gen.js — LoRA-powered MapleStory sprite generator.
 *
 * Full pipeline: LoRA generate (256x256) → crop → bg remove → ESRGAN enhance → animation frames
 * Then: import into WZ via WzImg-MCP → pack Npc.wz → deploy to patcher
 *
 * Uses AnythingV5 + trained MapleStory LoRA to generate pixel-art sprites for:
 * - NPCs (stand 3 frames + move 4 frames)
 * - Mobs (stand/move/hit/die/attack)
 * - Items/Equipment icons
 * - Skill effects
 *
 * Called via tools: maple_generate_sprite, maple_lora_pipeline, maple_import_to_wz
 */

import { spawn, execFile } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('maplestory:lora-sprite-gen');

const PYTHON = 'python';
const GENERATE_SCRIPT = join(process.cwd(), '..', 'maple-lora', 'generate_sprite_tool.py');
const PIPELINE_SCRIPT = join(process.cwd(), '..', 'maple-lora', 'gen_all_custom_npcs.py');
const SPRITE_BASE = join(process.cwd(), 'workspace', 'Cosmic', 'maple-sprites');
const PIPELINE_OUTPUT = join(process.cwd(), '..', 'maple-lora', 'game_assets', 'npcs');

// WZ import paths
const MCP_EXE = join(process.cwd(), 'workspace', 'WzImg-MCP-Server', 'WzImgMCP', 'bin', 'Fixed2', 'net8.0-windows', 'WzImgMCP.exe');
const NPC_REBUILD_DIR = join(process.cwd(), 'workspace', 'npc-rebuild');
const PATCHER_DIR = join(process.cwd(), 'workspace', 'v83-client-patched');
const MANIFEST_SCRIPT = join(process.cwd(), 'workspace', 'maple-patcher', 'server', 'generate-manifest.js');

/**
 * Generate a MapleStory sprite using the LoRA model (basic single-pose generation).
 */
export async function generateSprite(opts) {
  const { type, id, description, poses, width, height, seed } = opts;

  if (!type || !id || !description) {
    return { success: false, files: [], error: 'Missing required fields: type, id, description' };
  }

  const typeDir = {
    npc: 'custom-npcs',
    mob: 'custom-mobs',
    item: 'custom-items',
    skill: 'custom-skills',
    equipment: 'custom-equipment',
  }[type] || 'custom-misc';

  const outDir = join(SPRITE_BASE, typeDir, String(id));
  mkdirSync(outDir, { recursive: true });

  const poseList = poses || ['stand_0', 'stand_1'];
  const w = width || (type === 'item' ? 36 : type === 'skill' ? 64 : 80);
  const h = height || (type === 'item' ? 36 : type === 'skill' ? 64 : 100);

  const args = [
    GENERATE_SCRIPT,
    '--type', type,
    '--id', String(id),
    '--description', description,
    '--output-dir', outDir,
    '--poses', poseList.join(','),
    '--width', String(w),
    '--height', String(h),
  ];
  if (seed) args.push('--seed', String(seed));

  return new Promise((resolve) => {
    log.info({ type, id, description: description.slice(0, 80), poses: poseList }, 'Generating sprite via LoRA');

    execFile(PYTHON, args, { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        log.error({ type, id, err: err.message, stderr: stderr?.slice(0, 500) }, 'LoRA sprite generation failed');
        return resolve({ success: false, files: [], error: err.message });
      }

      const files = poseList
        .map(p => join(outDir, `${p}.png`))
        .filter(f => existsSync(f));

      log.info({ type, id, files: files.length }, 'LoRA sprite generation complete');
      resolve({ success: true, files });
    });
  });
}

/**
 * Full LoRA pipeline: generate → crop → bg remove → ESRGAN enhance → animation frames.
 *
 * For a single NPC, runs the gen_all_custom_npcs.py pipeline which produces:
 *   - raw_256.png (LoRA output)
 *   - cropped.png (character cropped + white bg removed)
 *   - enhanced.png (ESRGAN 4x upscale → LANCZOS downscale for quality)
 *   - stand_0.png, stand_1.png, stand_2.png (idle bob animation)
 *   - move_0.png, move_1.png, move_2.png, move_3.png (walk animation)
 *
 * Output dir: C:/Users/rdiol/maple-lora/game_assets/npcs/{npcId}_pipeline/
 *
 * @param {string} npcId - NPC ID (e.g. '9999050')
 * @param {string} description - Visual description for the LoRA prompt
 * @param {number} [seed] - Optional seed for reproducibility
 * @returns {Promise<{success: boolean, outputDir: string, files: string[], error?: string}>}
 */
export async function runLoraPipeline(npcId, description, seed) {
  const outDir = join(PIPELINE_OUTPUT, `${npcId}_pipeline`);
  mkdirSync(outDir, { recursive: true });

  // Check if already generated
  if (existsSync(join(outDir, 'stand_0.png'))) {
    const files = readdirSync(outDir).filter(f => f.endsWith('.png'));
    return { success: true, outputDir: outDir, files, cached: true };
  }

  // Run the pipeline Python script for this single NPC
  // We create a temporary single-NPC script inline
  const singleScript = join(outDir, '_run_single.py');
  const pyCode = `
import sys, os
sys.path.insert(0, ${JSON.stringify(join(process.cwd(), '..', 'maple-lora'))})
from gen_all_custom_npcs import setup_sd_pipeline, setup_esrgan, generate_base, crop_and_remove_bg, esrgan_enhance, resize_to_npc, create_anim_frames
import os

pipe = setup_sd_pipeline()
upsampler = setup_esrgan()
out_dir = ${JSON.stringify(outDir.replace(/\\/g, '/'))}
desc = ${JSON.stringify(description)}
seed = ${seed || (parseInt(npcId) % 99999)}

raw = generate_base(pipe, desc, seed)
raw.save(os.path.join(out_dir, "raw_256.png"))

cropped = crop_and_remove_bg(raw)
cropped.save(os.path.join(out_dir, "cropped.png"))

enhanced = esrgan_enhance(upsampler, cropped)
enhanced.save(os.path.join(out_dir, "enhanced.png"))

resized = resize_to_npc(enhanced, max_w=70, max_h=90)
resized.save(os.path.join(out_dir, "resized.png"))

frame_names = create_anim_frames(resized, out_dir)
print(f"Done: {resized.size}, {len(frame_names)} frames")
`;
  writeFileSync(singleScript, pyCode, 'utf8');

  return new Promise((resolve) => {
    log.info({ npcId, description: description.slice(0, 80) }, 'Running LoRA pipeline');

    execFile(PYTHON, [singleScript], {
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
      cwd: join(process.cwd(), '..', 'maple-lora'),
    }, (err, stdout, stderr) => {
      if (err) {
        log.error({ npcId, err: err.message }, 'LoRA pipeline failed');
        return resolve({ success: false, outputDir: outDir, files: [], error: err.message });
      }

      const files = readdirSync(outDir).filter(f => f.endsWith('.png'));
      log.info({ npcId, files: files.length }, 'LoRA pipeline complete');
      resolve({ success: true, outputDir: outDir, files });
    });
  });
}

/**
 * Import pipeline sprites into WZ binary via WzImg-MCP, then pack and deploy.
 *
 * Pipeline:
 *   1. Start WzImg-MCP server on npc-rebuild directory (isPreBB=true for Format1/BGRA4444)
 *   2. For each NPC: read sprite PNGs → set_canvas_bitmap for all frames (stand, move, eye, say)
 *   3. Save each .img file
 *   4. Pack to Npc.wz binary
 *   5. Copy to v83-client-patched/ patcher directory
 *   6. Regenerate patcher manifest
 *
 * @param {string|string[]} npcIds - NPC ID(s) to import. Use '*' for all pipeline NPCs.
 * @returns {Promise<{success: boolean, imported: number, packed: boolean, deployed: boolean, error?: string}>}
 */
export async function importSpritesToWz(npcIds) {
  if (!existsSync(MCP_EXE)) {
    return { success: false, imported: 0, error: `MCP exe not found: ${MCP_EXE}` };
  }
  if (!existsSync(NPC_REBUILD_DIR)) {
    return { success: false, imported: 0, error: `NPC rebuild dir not found: ${NPC_REBUILD_DIR}` };
  }

  // Resolve NPC list
  let ids;
  if (npcIds === '*' || npcIds === 'all') {
    ids = readdirSync(PIPELINE_OUTPUT)
      .filter(d => d.endsWith('_pipeline'))
      .map(d => d.replace('_pipeline', ''))
      .filter(id => existsSync(join(NPC_REBUILD_DIR, 'Npc', `${id}.img`)))
      .sort();
  } else {
    ids = Array.isArray(npcIds) ? npcIds : [npcIds];
  }

  if (ids.length === 0) {
    return { success: false, imported: 0, error: 'No NPC IDs to import' };
  }

  log.info({ count: ids.length }, 'Importing pipeline sprites to WZ');

  // Start MCP process
  let requestId = 0;
  const pendingRequests = new Map();

  const proc = spawn(MCP_EXE, [], {
    env: { ...process.env, WZIMGMCP_DATA_PATH: NPC_REBUILD_DIR },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const rl = createInterface({ input: proc.stdout });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pendingRequests.has(msg.id)) {
        pendingRequests.get(msg.id).resolve(msg);
        pendingRequests.delete(msg.id);
      }
    } catch (e) { /* ignore non-JSON lines */ }
  });
  proc.stderr.on('data', () => {});

  function send(method, params) {
    const id = ++requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error(`Timeout for ${method}`));
      }, 120_000);
      pendingRequests.set(id, { resolve: (r) => { clearTimeout(timer); resolve(r); } });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  function notify(method, params) {
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  async function callTool(name, args) {
    const resp = await send('tools/call', { name, arguments: args });
    if (resp.error) throw new Error(`MCP error: ${JSON.stringify(resp.error)}`);
    const content = resp.result?.content?.[0];
    if (!content) throw new Error('No content from MCP');
    try { return JSON.parse(content.text); } catch { return content.text; }
  }

  try {
    await new Promise(r => setTimeout(r, 2000));

    await send('initialize', {
      protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: 'lora-import', version: '1.0' },
    });
    notify('notifications/initialized', {});

    const init = await callTool('init_data_source', { basePath: NPC_REBUILD_DIR });
    log.info({ isPreBB: init.data?.isPreBB }, 'MCP data source initialized');

    let totalImported = 0;
    let totalErrors = 0;

    for (const npcId of ids) {
      const imgName = `${npcId}.img`;
      const spriteDir = join(PIPELINE_OUTPUT, `${npcId}_pipeline`);

      if (!existsSync(spriteDir) || !existsSync(join(spriteDir, 'stand_0.png'))) {
        log.warn({ npcId }, 'No pipeline sprites found, skip');
        continue;
      }

      // Pre-load sprite files as base64
      const spriteCache = {};
      for (const f of readdirSync(spriteDir)) {
        if (f.endsWith('.png') && (f.startsWith('stand_') || f.startsWith('move_'))) {
          spriteCache[f.replace('.png', '')] = readFileSync(join(spriteDir, f)).toString('base64');
        }
      }
      const fallbackB64 = spriteCache['stand_0'];

      // List all canvases in this NPC .img
      let canvases;
      try {
        const r = await callTool('list_canvas_in_image', { category: 'npc', image: imgName });
        canvases = r.data?.canvases || [];
      } catch (e) {
        log.error({ npcId, err: e.message }, 'Failed to list canvases');
        totalErrors++;
        continue;
      }

      let npcImported = 0;
      for (const canvas of canvases) {
        const [action, frame] = canvas.path.split('/');
        const key = `${action}_${frame}`;
        const b64 = spriteCache[key] || fallbackB64;

        try {
          await callTool('set_canvas_bitmap', {
            category: 'npc', image: imgName,
            path: canvas.path, base64Png: b64,
          });
          npcImported++;
        } catch (e) {
          totalErrors++;
        }
      }

      if (npcImported > 0) {
        try {
          await callTool('save_image', { category: 'npc', image: imgName });
          totalImported += npcImported;
        } catch (e) {
          log.error({ npcId, err: e.message }, 'Failed to save .img');
          totalErrors++;
        }
      }
    }

    log.info({ totalImported, totalErrors }, 'WZ import complete');

    // Pack Npc.wz
    let packed = false;
    try {
      await callTool('pack_to_wz', {
        imgPath: NPC_REBUILD_DIR,
        outputDir: join(NPC_REBUILD_DIR, 'output'),
        category: 'npc',
        wzVersion: 83,
      });
      packed = true;
      log.info('Npc.wz packed');
    } catch (e) {
      log.error({ err: e.message }, 'pack_to_wz failed');
    }

    proc.kill();

    // Deploy to patcher
    let deployed = false;
    const packedWz = join(NPC_REBUILD_DIR, 'output', 'npc.wz');
    const destWz = join(PATCHER_DIR, 'Npc.wz');
    if (packed && existsSync(packedWz) && existsSync(PATCHER_DIR)) {
      try {
        copyFileSync(packedWz, destWz);
        deployed = true;
        log.info({ dest: destWz }, 'Npc.wz deployed to patcher');

        // Regenerate manifest
        if (existsSync(MANIFEST_SCRIPT)) {
          await new Promise((resolve) => {
            execFile('node', [MANIFEST_SCRIPT], { timeout: 30_000 }, (err) => {
              if (err) log.error({ err: err.message }, 'Manifest regen failed');
              else log.info('Patcher manifest regenerated');
              resolve();
            });
          });
        }
      } catch (e) {
        log.error({ err: e.message }, 'Deploy to patcher failed');
      }
    }

    return { success: true, imported: totalImported, errors: totalErrors, packed, deployed, npcCount: ids.length };

  } catch (e) {
    proc.kill();
    return { success: false, imported: 0, error: e.message };
  }
}

/**
 * Generate WZ XML for a generated sprite (legacy — only needed for Cosmic XML pipeline).
 */
export function writeWzXml(opts) {
  const { type, id, poses, width, height } = opts;
  const w = width || 80;
  const h = height || 100;
  const poseList = poses || ['stand_0', 'stand_1'];

  const typeDir = {
    npc: 'custom-npcs',
    mob: 'custom-mobs',
    item: 'custom-items',
    skill: 'custom-skills',
    equipment: 'custom-equipment',
  }[type] || 'custom-misc';

  const spritePath = `../../../maple-sprites/${typeDir}/${id}`;

  if (type === 'npc') {
    const wzDir = join(process.cwd(), 'workspace', 'Cosmic', 'wz', 'Npc.wz');
    const frames = poseList
      .filter(p => p.startsWith('stand_'))
      .map((p, i) => `    <canvas name="${i}" width="${w}" height="${h}" basedata="${spritePath}/${p}.png">
      <vector name="origin" x="${Math.round(w / 2)}" y="${h - 8}"/>
      <int name="z" value="0"/>
      <int name="delay" value="200"/>
    </canvas>`).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<imgdir name="${id}.img">
  <imgdir name="stand">
${frames}
  </imgdir>
  <imgdir name="info">
    <int name="face" value="0"/>
    <string name="link" value=""/>
  </imgdir>
</imgdir>
`;
    const xmlPath = join(wzDir, `${id}.img.xml`);
    writeFileSync(xmlPath, xml, 'utf8');
    log.info({ type, id, xmlPath }, 'Wrote WZ XML');
    return xmlPath;
  }

  return null;
}
