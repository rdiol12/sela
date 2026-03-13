/**
 * modules/maplestory/class-selection-sprites.js
 *
 * Generates character preview portraits for Sage and Necromancer custom job classes,
 * suitable for class selection / intro screens. Also handles packing all 22 custom
 * NPC stand sprites into v83 client Npc.wz binary format via direct WzImgMCP.exe spawn.
 *
 * Portrait specs: 80×140px pixel art, shows full character with class-themed gear.
 * NPC packing: runs pack-npc-sprites.cjs via child_process (proven pattern).
 *
 * Wired into index.js as:
 *   maple_gen_class_portraits — generate Sage + Necromancer class portraits
 *   maple_pack_npc_wz         — pack all 22 custom NPC sprites into v83 client Npc.wz
 *   maple_class_sprite_status — status check
 */

import sharp from 'sharp';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('maplestory:class-selection');

const PORTRAIT_DIR = join(process.cwd(), 'workspace', 'maple-sprites', 'class-selection');
const NPC_SPRITE_DIR = join(process.cwd(), 'workspace', 'maple-sprites', 'custom-npcs');
const PACK_SCRIPT = join(process.cwd(), 'scripts', 'pack-npc-sprites.cjs');

// ── Class Portrait Definitions ────────────────────────────────────────────────

const CLASS_PORTRAITS = {
  sage: {
    jobId: 600,
    name: 'Sage',
    desc: 'Elemental Wizard',
    body: [60, 100, 200],      // blue robe
    trim: [120, 180, 255],     // light blue trim
    skin: [255, 220, 180],     // light skin
    hair: [80, 60, 180],       // dark blue-purple hair
    accent: [200, 220, 255],   // arcane glow
    hat: [40, 70, 160],        // dark blue pointed hat
    weapon: 'staff',
    aura: [100, 160, 255],     // blue arcane aura
  },
  necromancer: {
    jobId: 700,
    name: 'Necromancer',
    desc: 'Dark Summoner',
    body: [40, 30, 60],        // dark purple-black robe
    trim: [120, 40, 180],      // purple trim
    skin: [200, 180, 160],     // pale skin
    hair: [30, 20, 50],        // near-black hair
    accent: [160, 80, 255],    // dark purple
    hat: [30, 20, 50],         // dark cowl
    weapon: 'scythe',
    aura: [80, 20, 120],       // necrotic purple aura
  },
};

// ── SVG Portrait Builder ──────────────────────────────────────────────────────

function buildPortraitSvg(classKey) {
  const c = CLASS_PORTRAITS[classKey];
  const W = 80, H = 140;
  const [br, bg, bb] = c.body;
  const [tr, tg, tb] = c.trim;
  const [sr, sg, sb] = c.skin;
  const [hr, hg, hb] = c.hair;
  const [ar, ag, ab] = c.accent;
  const [hatr, hatg, hatb] = c.hat;
  const [aur, aug, aub] = c.aura;

  // Layout
  const cx = W / 2;
  const headR = 12;
  const headCx = cx, headCy = 28;
  const bodyX = cx - 14, bodyY = headCy + headR + 2;
  const bodyW = 28, bodyH = 36;
  const legW = 10;
  const legY = bodyY + bodyH;
  const legLX = cx - 14, legRX = cx + 4;
  const armW = 8, armH = 30;
  const armLX = bodyX - armW - 1, armRX = bodyX + bodyW + 1;

  // Aura background
  const auraSvg = `
    <defs>
      <radialGradient id="aura" cx="50%" cy="70%" r="50%">
        <stop offset="0%" stop-color="rgb(${aur},${aug},${aub})" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="rgb(${aur},${aug},${aub})" stop-opacity="0"/>
      </radialGradient>
      <filter id="glow">
        <feGaussianBlur stdDeviation="3" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <ellipse cx="${cx}" cy="${H - 20}" rx="35" ry="18" fill="url(#aura)"/>`;

  // Hat (Sage: tall pointy; Necromancer: dark cowl)
  let hatSvg = '';
  if (classKey === 'sage') {
    hatSvg = `
      <polygon points="${headCx - 14},${headCy - headR + 2} ${headCx},${headCy - headR - 28} ${headCx + 14},${headCy - headR + 2}"
        fill="rgb(${hatr},${hatg},${hatb})" stroke="rgba(0,0,0,0.7)" stroke-width="1.5"/>
      <rect x="${headCx - 16}" y="${headCy - headR}" width="32" height="7" rx="3"
        fill="rgb(${hatr + 10},${hatg + 10},${hatb + 10})" stroke="rgba(0,0,0,0.6)" stroke-width="1"/>
      <line x1="${headCx - 10}" y1="${headCy - headR - 10}" x2="${headCx + 10}" y2="${headCy - headR - 10}"
        stroke="rgb(${ar},${ag},${ab})" stroke-width="1.5" opacity="0.6"/>`;
  } else {
    // Necromancer cowl
    hatSvg = `
      <ellipse cx="${headCx}" cy="${headCy - headR + 6}" rx="17" ry="14"
        fill="rgb(${hatr},${hatg},${hatb})" stroke="rgba(${ar},${ag},${ab},0.4)" stroke-width="1.5"/>
      <ellipse cx="${headCx}" cy="${headCy - headR + 6}" rx="12" ry="10"
        fill="rgba(0,0,0,0)" stroke="rgba(${ar},${ag},${ab},0.3)" stroke-width="1"/>`;
  }

  // Head
  const headSvg = `
    <ellipse cx="${headCx}" cy="${headCy}" rx="${headR}" ry="${headR + 1}"
      fill="rgb(${sr},${sg},${sb})" stroke="rgba(0,0,0,0.7)" stroke-width="1.5"/>
    <ellipse cx="${headCx - 3}" cy="${headCy - 2}" rx="2" ry="2.5"
      fill="rgba(0,0,0,0.8)"/>
    <ellipse cx="${headCx + 3}" cy="${headCy - 2}" rx="2" ry="2.5"
      fill="rgba(0,0,0,0.8)"/>
    <path d="M ${headCx - 4} ${headCy + 4} Q ${headCx} ${headCy + 7} ${headCx + 4} ${headCy + 4}"
      fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="1"/>`;

  // Hair
  const hairSvg = `
    <ellipse cx="${headCx}" cy="${headCy - 6}" rx="${headR + 1}" ry="9"
      fill="rgb(${hr},${hg},${hb})" stroke="rgba(0,0,0,0.6)" stroke-width="1"/>`;

  // Body (robe)
  const bodySvg = `
    <rect x="${bodyX}" y="${bodyY}" width="${bodyW}" height="${bodyH}" rx="4"
      fill="rgb(${br},${bg},${bb})" stroke="rgba(0,0,0,0.7)" stroke-width="1.5"/>
    <line x1="${cx}" y1="${bodyY + 4}" x2="${cx}" y2="${bodyY + bodyH - 4}"
      stroke="rgb(${tr},${tg},${tb})" stroke-width="2" opacity="0.6"/>
    <rect x="${bodyX + 2}" y="${bodyY}" width="${bodyW - 4}" height="6" rx="2"
      fill="rgb(${tr},${tg},${tb})" opacity="0.4"/>`;

  // Arms
  const armY = bodyY + 4;
  const armsSvg = `
    <rect x="${armLX}" y="${armY}" width="${armW}" height="${armH}" rx="3"
      fill="rgb(${br},${bg},${bb})" stroke="rgba(0,0,0,0.6)" stroke-width="1"/>
    <rect x="${armRX}" y="${armY}" width="${armW}" height="${armH}" rx="3"
      fill="rgb(${br},${bg},${bb})" stroke="rgba(0,0,0,0.6)" stroke-width="1"/>`;

  // Legs
  const legsSvg = `
    <rect x="${legLX}" y="${legY}" width="${legW}" height="28" rx="3"
      fill="rgb(${br - 10},${bg - 10},${bb - 10})" stroke="rgba(0,0,0,0.6)" stroke-width="1"/>
    <rect x="${legRX}" y="${legY}" width="${legW}" height="28" rx="3"
      fill="rgb(${br - 10},${bg - 10},${bb - 10})" stroke="rgba(0,0,0,0.6)" stroke-width="1"/>
    <rect x="${legLX}" y="${legY + 24}" width="${legW + 2}" height="8" rx="2"
      fill="rgb(40,30,20)" stroke="rgba(0,0,0,0.7)" stroke-width="1"/>
    <rect x="${legRX - 2}" y="${legY + 24}" width="${legW + 2}" height="8" rx="2"
      fill="rgb(40,30,20)" stroke="rgba(0,0,0,0.7)" stroke-width="1"/>`;

  // Weapon
  let weaponSvg = '';
  if (c.weapon === 'staff') {
    weaponSvg = `
      <line x1="${armRX + armW + 4}" y1="${headCy - 20}" x2="${armRX + armW + 4}" y2="${legY + 20}"
        stroke="rgb(${tr},${tg},${tb})" stroke-width="3" stroke-linecap="round"/>
      <circle cx="${armRX + armW + 4}" cy="${headCy - 20}" r="8"
        fill="rgb(${ar},${ag},${ab})" stroke="rgba(0,0,0,0.6)" stroke-width="1.5" filter="url(#glow)"/>
      <circle cx="${armRX + armW + 4}" cy="${headCy - 20}" r="4"
        fill="rgba(255,255,255,0.4)"/>`;
  } else if (c.weapon === 'scythe') {
    weaponSvg = `
      <line x1="${armRX + armW + 4}" y1="${headCy - 15}" x2="${armRX + armW + 4}" y2="${legY + 20}"
        stroke="rgb(80,70,60)" stroke-width="3" stroke-linecap="round"/>
      <path d="M ${armRX + armW + 4} ${headCy - 15} Q ${armRX + armW + 24} ${headCy - 30} ${armRX + armW + 14} ${headCy - 8}"
        fill="none" stroke="rgb(${ar},${ag},${ab})" stroke-width="2.5" stroke-linecap="round" filter="url(#glow)"/>`;
  }

  // Class emblem (bottom)
  let emblemSvg = '';
  if (classKey === 'sage') {
    emblemSvg = `
      <polygon points="${cx},${H - 30} ${cx + 8},${H - 20} ${cx},${H - 24} ${cx - 8},${H - 20}"
        fill="rgb(${ar},${ag},${ab})" opacity="0.7"/>
      <polygon points="${cx},${H - 10} ${cx + 8},${H - 20} ${cx},${H - 16} ${cx - 8},${H - 20}"
        fill="rgb(${ar},${ag},${ab})" opacity="0.5"/>`;
  } else {
    emblemSvg = `
      <circle cx="${cx}" cy="${H - 20}" r="10"
        fill="none" stroke="rgb(${ar},${ag},${ab})" stroke-width="2" opacity="0.6"/>
      <circle cx="${cx}" cy="${H - 20}" r="4"
        fill="rgb(${ar},${ag},${ab})" opacity="0.5"/>
      <line x1="${cx - 10}" y1="${H - 20}" x2="${cx + 10}" y2="${H - 20}"
        stroke="rgb(${ar},${ag},${ab})" stroke-width="1.5" opacity="0.4"/>
      <line x1="${cx}" y1="${H - 30}" x2="${cx}" y2="${H - 10}"
        stroke="rgb(${ar},${ag},${ab})" stroke-width="1.5" opacity="0.4"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="rgba(0,0,0,0)"/>
    ${auraSvg}
    ${emblemSvg}
    ${legsSvg}
    ${bodySvg}
    ${armsSvg}
    ${hairSvg}
    ${headSvg}
    ${hatSvg}
    ${weaponSvg}
  </svg>`;
}

// ── Badge Icon Builder (32×32) ────────────────────────────────────────────────

function buildBadgeSvg(classKey) {
  const c = CLASS_PORTRAITS[classKey];
  const W = 32, H = 32;
  const cx = W / 2, cy = H / 2;
  const [br, bg, bb] = c.body;
  const [ar, ag, ab] = c.accent;

  let symbol = '';
  if (classKey === 'sage') {
    // Star of Arcane — 6-point star
    symbol = `
      <polygon points="${cx},${cy - 12} ${cx + 3},${cy - 4} ${cx + 11},${cy - 4} ${cx + 5},${cy + 2} ${cx + 7},${cy + 10} ${cx},${cy + 5} ${cx - 7},${cy + 10} ${cx - 5},${cy + 2} ${cx - 11},${cy - 4} ${cx - 3},${cy - 4}"
        fill="rgb(${ar},${ag},${ab})" opacity="0.9"/>
      <circle cx="${cx}" cy="${cy}" r="4" fill="rgba(255,255,255,0.6)"/>`;
  } else {
    // Skull emblem
    symbol = `
      <ellipse cx="${cx}" cy="${cy - 2}" rx="9" ry="8"
        fill="rgb(${ar},${ag},${ab})" opacity="0.8"/>
      <ellipse cx="${cx - 3}" cy="${cy - 1}" rx="2.5" ry="3"
        fill="rgba(0,0,0,0.7)"/>
      <ellipse cx="${cx + 3}" cy="${cy - 1}" rx="2.5" ry="3"
        fill="rgba(0,0,0,0.7)"/>
      <rect x="${cx - 4}" y="${cy + 5}" width="3" height="5" rx="1"
        fill="rgb(${ar},${ag},${ab})" opacity="0.7"/>
      <rect x="${cx + 1}" y="${cy + 5}" width="3" height="5" rx="1"
        fill="rgb(${ar},${ag},${ab})" opacity="0.7"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect x="1" y="1" width="30" height="30" rx="5"
      fill="rgb(${br},${bg},${bb})" stroke="rgb(${ar},${ag},${ab})" stroke-width="1.5"/>
    ${symbol}
  </svg>`;
}

// ── Portrait Generation ───────────────────────────────────────────────────────

export async function generateClassPortraits() {
  mkdirSync(PORTRAIT_DIR, { recursive: true });
  const results = [];

  for (const [classKey, def] of Object.entries(CLASS_PORTRAITS)) {
    const classDir = join(PORTRAIT_DIR, classKey);
    mkdirSync(classDir, { recursive: true });

    // Full portrait (80×140)
    const portraitSvg = buildPortraitSvg(classKey);
    const portraitBuf = await sharp(Buffer.from(portraitSvg)).png().toBuffer();
    const portraitPath = join(classDir, 'portrait.png');
    writeFileSync(portraitPath, portraitBuf);

    // Badge icon (32×32)
    const badgeSvg = buildBadgeSvg(classKey);
    const badgeBuf = await sharp(Buffer.from(badgeSvg)).png().toBuffer();
    const badgePath = join(classDir, 'badge.png');
    writeFileSync(badgePath, badgeBuf);

    results.push({
      classKey,
      jobId: def.jobId,
      name: def.name,
      portraitPath,
      badgePath,
      portraitSize: portraitBuf.length,
    });

    log.info({ classKey, jobId: def.jobId, portrait: portraitBuf.length }, 'Generated class portrait');
  }

  return { generated: results.length * 2, classes: results };
}

// ── NPC WZ Packing (via direct WzImgMCP.exe spawn) ───────────────────────────

export function packAllNpcSpritesToClientWz() {
  return new Promise((resolve, reject) => {
    if (!existsSync(PACK_SCRIPT)) {
      reject(new Error(`pack-npc-sprites.cjs not found at ${PACK_SCRIPT}`));
      return;
    }

    log.info('Starting NPC WZ pack via pack-npc-sprites.cjs');
    const proc = spawn('node', [PACK_SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      const packed = (stdout.match(/\[OK\]/g) || []).length;
      const saved = (stdout.match(/\[SAVED\]/g) || []).length;
      const errors = (stdout.match(/\[ERR\]/g) || []).length;
      log.info({ code, packed, saved, errors }, 'NPC WZ packing complete');
      if (code === 0 || packed > 0) {
        resolve({ exitCode: code, packed, saved, errors, output: stdout.slice(-2000) });
      } else {
        reject(new Error(`pack-npc-sprites.cjs exited ${code}: ${stderr.slice(-500)}`));
      }
    });

    proc.on('error', reject);
  });
}

// ── Status Check ─────────────────────────────────────────────────────────────

export function getClassSpriteStatus() {
  const status = { portraits: {}, npcSprites: { generated: 0, missing: 0 } };

  for (const [classKey, def] of Object.entries(CLASS_PORTRAITS)) {
    const classDir = join(PORTRAIT_DIR, classKey);
    status.portraits[classKey] = {
      jobId: def.jobId,
      name: def.name,
      hasPortrait: existsSync(join(classDir, 'portrait.png')),
      hasBadge: existsSync(join(classDir, 'badge.png')),
    };
  }

  // Check NPC sprites on disk
  const npcIds = [
    9990010, 9990011, 9990012, 9990013, 9990014,
    9999001, 9999002, 9999003, 9999004, 9999005,
    9999006, 9999007, 9999008, 9999009, 9999010,
    9999020, 9999021, 9999030, 9999032, 9999033, 9999034, 9999035,
  ];
  for (const id of npcIds) {
    const frame0 = join(NPC_SPRITE_DIR, String(id), 'stand_0.png');
    if (existsSync(frame0)) status.npcSprites.generated++;
    else status.npcSprites.missing++;
  }

  return status;
}
