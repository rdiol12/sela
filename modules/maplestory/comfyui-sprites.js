/**
 * ComfyUI local pixel art sprite generator for MapleStory
 * All sprites: AnythingV5 + custom MapleStory LoRA
 * Pipeline: DPM++ 2M Karras sampler, clip skip 2, LoRA weight 0.75
 * 100% free, runs on local GPU (RTX 4050 6GB)
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, basename } from 'path';
import { existsSync } from 'fs';

const COMFYUI_URL = 'http://127.0.0.1:8188';
const OUTPUT_DIR = join(process.cwd(), 'workspace', 'maple-sprites');
const COMFYUI_OUTPUT = join(process.cwd(), 'workspace', 'ComfyUI', 'output');

// SD_PixelArt_SpriteSheet_Generator direction triggers
const DIRECTION_TRIGGERS = {
  front: 'PixelartFSS',
  right: 'PixelartRSS',
  back:  'PixelartBSS',
  left:  'PixelartLSS',
};

// --- ComfyUI API helpers ---

async function comfyFetch(path, opts = {}) {
  const res = await fetch(`${COMFYUI_URL}${path}`, opts);
  if (!res.ok) throw new Error(`ComfyUI ${path}: ${res.status} ${res.statusText}`);
  return res;
}

async function isComfyRunning() {
  try {
    await comfyFetch('/system_stats');
    return true;
  } catch { return false; }
}

async function queuePrompt(workflow) {
  const res = await comfyFetch('/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`ComfyUI error: ${JSON.stringify(data.error)}`);
  return data.prompt_id;
}

async function waitForResult(promptId, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await comfyFetch(`/history/${promptId}`);
    const history = await res.json();
    const entry = history[promptId];
    if (entry) {
      if (entry.status?.status_str === 'error') {
        const errMsg = entry.status?.messages?.find(m => m[0] === 'execution_error');
        throw new Error(`Generation failed: ${errMsg ? JSON.stringify(errMsg[1]) : 'unknown error'}`);
      }
      if (entry.outputs && Object.keys(entry.outputs).length > 0) return entry.outputs;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`Timeout waiting for ComfyUI result (${timeoutMs}ms)`);
}

async function downloadImage(filename, subfolder = '') {
  const params = new URLSearchParams({ filename, type: 'output' });
  if (subfolder) params.set('subfolder', subfolder);
  const res = await comfyFetch(`/view?${params}`);
  return Buffer.from(await res.arrayBuffer());
}

// --- Workflow builders ---

function buildSpriteWorkflow(prompt, direction = 'front', opts = {}) {
  const {
    checkpoint = MAPLE_DEFAULTS.checkpoint,
    lora = MAPLE_DEFAULTS.lora,
    loraStrength = MAPLE_DEFAULTS.loraStrength,
    width = 512,
    height = 512,
    steps = MAPLE_DEFAULTS.steps,
    cfg = MAPLE_DEFAULTS.cfg,
    seed = Math.floor(Math.random() * 2 ** 32),
    negativePrompt = MAPLE_DEFAULTS.negativePrompt,
  } = opts;

  const dirTrigger = DIRECTION_TRIGGERS[direction] || DIRECTION_TRIGGERS.front;
  const fullPrompt = `${dirTrigger}, ${prompt}, pixel art, sprite, transparent background, game asset, ${MAPLE_STYLE}`;

  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: checkpoint },
    },
    // LoRA loader
    '2': {
      class_type: 'LoraLoader',
      inputs: {
        model: ['1', 0], clip: ['1', 1],
        lora_name: lora,
        strength_model: loraStrength,
        strength_clip: loraStrength,
      },
    },
    // CLIP skip 2
    '3': {
      class_type: 'CLIPSetLastLayer',
      inputs: { clip: ['2', 1], stop_at_clip_layer: -2 },
    },
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { text: fullPrompt, clip: ['3', 0] },
    },
    '5': {
      class_type: 'CLIPTextEncode',
      inputs: { text: negativePrompt, clip: ['3', 0] },
    },
    '6': {
      class_type: 'EmptyLatentImage',
      inputs: { width, height, batch_size: 1 },
    },
    '7': {
      class_type: 'KSampler',
      inputs: {
        model: ['2', 0],
        positive: ['4', 0],
        negative: ['5', 0],
        latent_image: ['6', 0],
        seed, steps, cfg,
        sampler_name: 'dpmpp_2m',
        scheduler: 'karras',
        denoise: 1.0,
      },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: { samples: ['7', 0], vae: ['1', 2] },
    },
    '9': {
      class_type: 'SaveImage',
      inputs: { images: ['8', 0], filename_prefix: 'maple_sprite' },
    },
  };
}

function buildSpriteWithLoRAWorkflow(prompt, opts = {}) {
  const {
    checkpoint = MAPLE_DEFAULTS.checkpoint,
    lora = MAPLE_DEFAULTS.lora,
    loraStrength = MAPLE_DEFAULTS.loraStrength,
    width = 512,
    height = 512,
    steps = MAPLE_DEFAULTS.steps,
    cfg = MAPLE_DEFAULTS.cfg,
    seed = Math.floor(Math.random() * 2 ** 32),
    negativePrompt = MAPLE_DEFAULTS.negativePrompt,
  } = opts;

  const fullPrompt = `pixel art, ${prompt}, sprite, game asset, clean lines, transparent background, ${MAPLE_STYLE}`;

  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: checkpoint },
    },
    '2': {
      class_type: 'LoraLoader',
      inputs: {
        model: ['1', 0], clip: ['1', 1],
        lora_name: lora,
        strength_model: loraStrength,
        strength_clip: loraStrength,
      },
    },
    // CLIP skip 2
    '3': {
      class_type: 'CLIPSetLastLayer',
      inputs: { clip: ['2', 1], stop_at_clip_layer: -2 },
    },
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { text: fullPrompt, clip: ['3', 0] },
    },
    '5': {
      class_type: 'CLIPTextEncode',
      inputs: { text: negativePrompt, clip: ['3', 0] },
    },
    '6': {
      class_type: 'EmptyLatentImage',
      inputs: { width, height, batch_size: 1 },
    },
    '7': {
      class_type: 'KSampler',
      inputs: {
        model: ['2', 0],
        positive: ['4', 0],
        negative: ['5', 0],
        latent_image: ['6', 0],
        seed, steps, cfg,
        sampler_name: 'dpmpp_2m',
        scheduler: 'karras',
        denoise: 1.0,
      },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: { samples: ['7', 0], vae: ['1', 2] },
    },
    '9': {
      class_type: 'SaveImage',
      inputs: { images: ['8', 0], filename_prefix: 'maple_sprite' },
    },
  };
}

// --- AnythingV5 + custom MapleStory LoRA (DPM++ 2M Karras, clip skip 2) ---

const MAPLE_DEFAULTS = {
  checkpoint: 'anything-v5.safetensors',
  lora: 'maplestory_sprite_lora-000001.safetensors',
  loraStrength: 0.75,
  width: 256,
  height: 256,
  steps: 28,
  cfg: 7.5,
  negativePrompt: 'blurry, realistic, 3d, photo, text, watermark, complex, detailed, gradient, noise, rough edges, messy, multiple characters, background scenery, landscape',
};
const MAPLE_STYLE = 'black outline, flat shading, chibi proportions, simple design, clean, maplestory v83 style';

function buildMonsterWorkflow(description, opts = {}) {
  const {
    checkpoint = MAPLE_DEFAULTS.checkpoint,
    lora = MAPLE_DEFAULTS.lora,
    loraStrength = MAPLE_DEFAULTS.loraStrength,
    width = MAPLE_DEFAULTS.width,
    height = MAPLE_DEFAULTS.height,
    steps = MAPLE_DEFAULTS.steps,
    cfg = MAPLE_DEFAULTS.cfg,
    seed = Math.floor(Math.random() * 2 ** 32),
    negativePrompt = MAPLE_DEFAULTS.negativePrompt,
  } = opts;

  const fullPrompt = `pixel art, ${description}, ${MAPLE_STYLE}, game sprite, white background, 2d game asset`;

  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: checkpoint },
    },
    '2': {
      class_type: 'LoraLoader',
      inputs: {
        model: ['1', 0], clip: ['1', 1],
        lora_name: lora,
        strength_model: loraStrength,
        strength_clip: loraStrength,
      },
    },
    // CLIP skip 2
    '3': {
      class_type: 'CLIPSetLastLayer',
      inputs: { clip: ['2', 1], stop_at_clip_layer: -2 },
    },
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { text: fullPrompt, clip: ['3', 0] },
    },
    '5': {
      class_type: 'CLIPTextEncode',
      inputs: { text: negativePrompt, clip: ['3', 0] },
    },
    '6': {
      class_type: 'EmptyLatentImage',
      inputs: { width, height, batch_size: 1 },
    },
    '7': {
      class_type: 'KSampler',
      inputs: {
        model: ['2', 0], positive: ['4', 0], negative: ['5', 0], latent_image: ['6', 0],
        seed, steps, cfg,
        sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1.0,
      },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: { samples: ['7', 0], vae: ['1', 2] },
    },
    '9': {
      class_type: 'SaveImage',
      inputs: { images: ['8', 0], filename_prefix: 'ms_monster' },
    },
  };
}

// --- Public API ---

/**
 * Generate a single pixel art sprite
 * @param {string} description - What to generate ("blue snail monster", "warrior with sword")
 * @param {object} opts - Options: direction, useLora, width, height, seed, steps, cfg
 * @returns {{ imagePath: string, imageBase64: string, prompt: string }}
 */
export async function generateSprite(description, opts = {}) {
  if (!await isComfyRunning()) throw new Error('ComfyUI not running. Start with: python main.py --listen --port 8188');

  const { direction = 'front', useLora = false, ...rest } = opts;

  const workflow = useLora
    ? buildSpriteWithLoRAWorkflow(description, rest)
    : buildSpriteWorkflow(description, direction, rest);

  const promptId = await queuePrompt(workflow);
  const outputs = await waitForResult(promptId);

  // Find the SaveImage node output
  const saveNode = Object.values(outputs).find(o => o.images?.length > 0);
  if (!saveNode?.images?.[0]) throw new Error('No image in ComfyUI output');

  const img = saveNode.images[0];
  const imageData = await downloadImage(img.filename, img.subfolder || '');

  // Save to our output directory
  await mkdir(OUTPUT_DIR, { recursive: true });
  const outName = `${description.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}_${direction}_${Date.now()}.png`;
  const outPath = join(OUTPUT_DIR, outName);
  await writeFile(outPath, imageData);

  return {
    imagePath: outPath,
    imageBase64: imageData.toString('base64'),
    prompt: workflow['4']?.inputs?.text || description,
    filename: outName,
  };
}

/**
 * Generate a 4-direction sprite sheet (front, right, back, left)
 * @param {string} description - What to generate
 * @param {object} opts - Options passed to each generation
 * @returns {{ sprites: Array, sheetPath: string }}
 */
export async function generateSpriteSheet(description, opts = {}) {
  const seed = opts.seed || Math.floor(Math.random() * 2 ** 32);
  const directions = ['front', 'right', 'back', 'left'];
  const sprites = [];

  for (const dir of directions) {
    const result = await generateSprite(description, { ...opts, direction: dir, seed });
    sprites.push({ direction: dir, ...result });
  }

  return { sprites, description };
}

/**
 * Generate a pixel art monster/creature sprite for MapleStory
 * Uses AnythingV5 + custom MapleStory LoRA (DPM++ 2M Karras, clip skip 2)
 * @param {string} name - Monster description ("blue slime with angry eyes", "fire mushroom creature")
 * @param {object} opts - Options: width, height, seed, steps, cfg, loraStrength
 * @returns {{ imagePath: string, imageBase64: string, prompt: string, filename: string }}
 */
export async function generateMonster(name, opts = {}) {
  if (!await isComfyRunning()) throw new Error('ComfyUI not running. Start with: python main.py --listen --port 8188');

  const workflow = buildMonsterWorkflow(name, opts);
  const promptId = await queuePrompt(workflow);
  const outputs = await waitForResult(promptId);

  const saveNode = Object.values(outputs).find(o => o.images?.length > 0);
  if (!saveNode?.images?.[0]) throw new Error('No image in ComfyUI output');

  const img = saveNode.images[0];
  const imageData = await downloadImage(img.filename, img.subfolder || '');

  await mkdir(OUTPUT_DIR, { recursive: true });
  const outName = `monster_${name.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}_${Date.now()}.png`;
  const outPath = join(OUTPUT_DIR, outName);
  await writeFile(outPath, imageData);

  return {
    imagePath: outPath,
    imageBase64: imageData.toString('base64'),
    prompt: workflow['4'].inputs.text,
    filename: outName,
  };
}

/**
 * Generate a pixel art NPC sprite for MapleStory
 * Uses monster workflow (AnythingV5 + custom MapleStory LoRA)
 */
export async function generateNPC(name, description = '', opts = {}) {
  const npcDesc = `${name}${description ? ', ' + description : ''}, standing pose, front view, RPG NPC character`;
  return generateMonster(npcDesc, opts);
}

/**
 * Generate a pixel art item/equipment icon
 * Uses monster workflow (AnythingV5 + custom MapleStory LoRA)
 */
export async function generateItem(name, opts = {}) {
  const itemDesc = `${name}, single object centered, no character, item icon, RPG equipment`;
  return generateMonster(itemDesc, opts);
}

// --- Animation workflow (AnimateDiff) ---

const ANIMATION_PRESETS = {
  walk:   { motion: 'walking, walk cycle',     frames: 8 },
  run:    { motion: 'running, run cycle',      frames: 8 },
  idle:   { motion: 'idle, breathing, subtle movement', frames: 6 },
  attack: { motion: 'attacking, swinging sword, slash', frames: 6 },
  cast:   { motion: 'casting spell, magic',    frames: 6 },
  jump:   { motion: 'jumping, jump arc',       frames: 6 },
  death:  { motion: 'falling down, dying',     frames: 6 },
  hit:    { motion: 'getting hit, flinching',  frames: 4 },
};

function buildAnimationWorkflow(description, animation = 'walk', opts = {}) {
  const {
    checkpoint = MAPLE_DEFAULTS.checkpoint,
    lora = MAPLE_DEFAULTS.lora,
    loraStrength = MAPLE_DEFAULTS.loraStrength,
    motionModel = 'mm_sd_v15_v2.ckpt',
    width = 256,
    height = 256,
    steps = MAPLE_DEFAULTS.steps,
    cfg = MAPLE_DEFAULTS.cfg,
    seed = Math.floor(Math.random() * 2 ** 32),
    frames = null,
    negativePrompt = MAPLE_DEFAULTS.negativePrompt,
  } = opts;

  const preset = ANIMATION_PRESETS[animation] || ANIMATION_PRESETS.walk;
  const frameCount = frames || preset.frames;
  const motionDesc = preset.motion;

  const fullPrompt = `pixel art, ${description}, ${motionDesc}, ${MAPLE_STYLE}, side view, game sprite`;

  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: checkpoint },
    },
    // LoRA loader
    '2': {
      class_type: 'LoraLoader',
      inputs: {
        model: ['1', 0], clip: ['1', 1],
        lora_name: lora,
        strength_model: loraStrength,
        strength_clip: loraStrength,
      },
    },
    // AnimateDiff on top of LoRA model
    '3': {
      class_type: 'ADE_AnimateDiffLoaderGen1',
      inputs: {
        model: ['2', 0],
        model_name: motionModel,
        beta_schedule: 'autoselect',
      },
    },
    // CLIP skip 2
    '4': {
      class_type: 'CLIPSetLastLayer',
      inputs: { clip: ['2', 1], stop_at_clip_layer: -2 },
    },
    '5': {
      class_type: 'CLIPTextEncode',
      inputs: { text: fullPrompt, clip: ['4', 0] },
    },
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: { text: negativePrompt, clip: ['4', 0] },
    },
    '7': {
      class_type: 'EmptyLatentImage',
      inputs: { width, height, batch_size: frameCount },
    },
    '8': {
      class_type: 'KSampler',
      inputs: {
        model: ['3', 0],
        positive: ['5', 0],
        negative: ['6', 0],
        latent_image: ['7', 0],
        seed, steps, cfg,
        sampler_name: 'dpmpp_2m',
        scheduler: 'karras',
        denoise: 1.0,
      },
    },
    '9': {
      class_type: 'VAEDecode',
      inputs: { samples: ['8', 0], vae: ['1', 2] },
    },
    '10': {
      class_type: 'SaveImage',
      inputs: {
        images: ['9', 0],
        filename_prefix: `anim_${animation}`,
      },
    },
  };
}

/**
 * Generate animation frames using AnimateDiff (FREE, local GPU)
 * @param {string} description - Character/object to animate ("warrior with sword")
 * @param {string} animation - Animation type: walk, run, idle, attack, cast, jump, death, hit
 * @param {object} opts - Options: frames, width, height, seed, steps, cfg
 * @returns {{ frames: Array<{filename, imageBase64}>, animation, frameCount }}
 */
export async function generateAnimation(description, animation = 'walk', opts = {}) {
  if (!await isComfyRunning()) throw new Error('ComfyUI not running. Start with: python main.py --listen --port 8188');

  const workflow = buildAnimationWorkflow(description, animation, opts);
  const promptId = await queuePrompt(workflow);
  const outputs = await waitForResult(promptId, 180_000); // 3 min timeout for animation

  // Collect all frame images
  const saveNode = Object.values(outputs).find(o => o.images?.length > 0);
  if (!saveNode?.images?.length) throw new Error('No frames in AnimateDiff output');

  await mkdir(OUTPUT_DIR, { recursive: true });
  const frames = [];
  for (const img of saveNode.images) {
    const imageData = await downloadImage(img.filename, img.subfolder || '');
    const safeName = description.replace(/[^a-z0-9]+/gi, '_').slice(0, 30);
    const outName = `${safeName}_${animation}_f${frames.length}_${Date.now()}.png`;
    const outPath = join(OUTPUT_DIR, outName);
    await writeFile(outPath, imageData);
    frames.push({
      filename: outName,
      imagePath: outPath,
      imageBase64: imageData.toString('base64'),
    });
  }

  return {
    frames,
    animation,
    frameCount: frames.length,
    description,
    prompt: workflow['5'].inputs.text,
  };
}

/**
 * Generate a full animation set (walk + idle + attack) for a character
 * @param {string} description - Character description
 * @param {string[]} animations - Array of animation types (default: walk, idle, attack)
 * @returns {{ sets: Object<string, AnimResult>, description }}
 */
export async function generateAnimationSet(description, animations = ['walk', 'idle', 'attack'], opts = {}) {
  const seed = opts.seed || Math.floor(Math.random() * 2 ** 32);
  const sets = {};

  for (const anim of animations) {
    sets[anim] = await generateAnimation(description, anim, { ...opts, seed });
  }

  return { sets, description, totalFrames: Object.values(sets).reduce((s, r) => s + r.frameCount, 0) };
}

/**
 * Check ComfyUI server status and available models
 */
export async function getStatus() {
  const running = await isComfyRunning();
  if (!running) return { running: false, message: 'ComfyUI not running' };

  try {
    const res = await comfyFetch('/object_info/CheckpointLoaderSimple');
    const info = await res.json();
    const checkpoints = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];

    const loraRes = await comfyFetch('/object_info/LoraLoader');
    const loraInfo = await loraRes.json();
    const loras = loraInfo?.LoraLoader?.input?.required?.lora_name?.[0] || [];

    return { running: true, checkpoints, loras };
  } catch (e) {
    return { running: true, error: e.message };
  }
}

export default {
  generateSprite,
  generateSpriteSheet,
  generateMonster,
  generateNPC,
  generateItem,
  generateAnimation,
  generateAnimationSet,
  getStatus,
  ANIMATION_PRESETS: Object.keys(ANIMATION_PRESETS),
  COMFYUI_URL,
  OUTPUT_DIR,
};
