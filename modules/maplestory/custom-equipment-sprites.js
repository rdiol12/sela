/**
 * modules/maplestory/custom-equipment-sprites.js — Equipment icon generator for custom caps & accessories.
 *
 * Generates 32×32 pixel-art inventory icons for:
 *   - 2 custom caps (01003074, 01003075) — mage hats
 *   - 2 custom accessories/medals (01142153, 01142154) — achievement medals
 *
 * Extends the same SVG→sharp pattern as custom-item-icons.js.
 * Wired into index.js via generateAllEquipmentSprites() / equipmentSpriteStatus().
 */

import sharp from 'sharp';
import { writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('maplestory:equip-sprites');

const SPRITE_DIR = join(process.cwd(), 'workspace', 'maple-sprites', 'equipment');

// ── Equipment Visual Definitions ────────────────────────────────────────────

const EQUIPMENT_VISUALS = {
  // Caps — mage-themed hats for Sage/Necromancer custom classes
  1003074: {
    name: 'Arcane Sage Hat',
    type: 'cap',
    w: 28, h: 26,
    desc: 'Elegant blue-silver mage hat with arcane runes',
    primary: [60, 100, 200],   // royal blue
    secondary: [120, 180, 255], // light blue trim
    glow: [140, 200, 255],     // arcane glow
    accent: [200, 160, 40],    // gold rune accent
    bg: [20, 30, 60],
  },
  1003075: {
    name: 'Necromancer Cowl',
    type: 'cap',
    w: 28, h: 26,
    desc: 'Dark shadowy cowl with spectral purple wisps',
    primary: [40, 30, 60],     // dark purple
    secondary: [120, 40, 180], // purple trim
    glow: [160, 80, 255],      // spectral glow
    accent: [80, 200, 120],    // green spectral accent
    bg: [15, 10, 25],
  },
  // Medals/Accessories — achievement medals (Me slot)
  1142153: {
    name: 'Adventurer Medal',
    type: 'medal',
    w: 33, h: 31,
    desc: 'Bronze adventure medal with red ribbon',
    primary: [200, 160, 60],   // bronze/gold
    secondary: [180, 50, 50],  // red ribbon
    glow: [255, 220, 100],     // warm gold glow
    accent: [240, 200, 80],    // bright gold edge
    bg: [40, 30, 15],
  },
  1142154: {
    name: 'Conqueror Medal',
    type: 'medal',
    w: 26, h: 33,
    desc: 'Silver conquest medal with blue ribbon and star emblem',
    primary: [180, 190, 210],  // silver
    secondary: [50, 80, 180],  // blue ribbon
    glow: [210, 220, 240],     // silver shine
    accent: [100, 160, 255],   // blue star accent
    bg: [20, 25, 40],
  },
};

const W = 32, H = 32;

// ── SVG Builders ─────────────────────────────────────────────────────────────

function buildCapSvg(vis) {
  const [pr, pg, pb] = vis.primary;
  const [sr, sg, sb] = vis.secondary;
  const [gr, gg, gb] = vis.glow;
  const [ar, ag, ab] = vis.accent;
  const [br, bgr, bb] = vis.bg;

  const isNecro = vis.name.includes('Necromancer');

  if (isNecro) {
    // Dark cowl with hood shape
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect x="1" y="1" width="30" height="30" rx="4" fill="rgb(${br},${bgr},${bb})" stroke="rgba(${gr},${gg},${gb},0.5)" stroke-width="1"/>
      <!-- Hood glow -->
      <ellipse cx="16" cy="18" rx="12" ry="10" fill="rgba(${gr},${gg},${gb},0.15)"/>
      <!-- Hood main -->
      <path d="M 6 22 Q 6 8 16 6 Q 26 8 26 22 Z" fill="rgb(${pr},${pg},${pb})"/>
      <!-- Hood shadow -->
      <path d="M 8 20 Q 8 12 16 10 Q 24 12 24 20 Z" fill="rgba(0,0,0,0.3)"/>
      <!-- Hood trim -->
      <path d="M 6 22 Q 16 18 26 22" stroke="rgb(${sr},${sg},${sb})" stroke-width="2" fill="none"/>
      <!-- Spectral wisps -->
      <path d="M 10 22 Q 8 26 12 28" stroke="rgba(${ar},${ag},${ab},0.6)" stroke-width="1.5" fill="none"/>
      <path d="M 22 22 Q 24 26 20 28" stroke="rgba(${ar},${ag},${ab},0.6)" stroke-width="1.5" fill="none"/>
      <!-- Eye glow -->
      <circle cx="13" cy="16" r="1.5" fill="rgba(${gr},${gg},${gb},0.8)"/>
      <circle cx="19" cy="16" r="1.5" fill="rgba(${gr},${gg},${gb},0.8)"/>
    </svg>`;
  }

  // Sage hat — pointy wizard hat
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect x="1" y="1" width="30" height="30" rx="4" fill="rgb(${br},${bgr},${bb})" stroke="rgba(${gr},${gg},${gb},0.5)" stroke-width="1"/>
    <!-- Hat glow -->
    <polygon points="16,3 24,22 8,22" fill="rgba(${gr},${gg},${gb},0.15)"/>
    <!-- Hat body -->
    <polygon points="16,4 23,21 9,21" fill="rgb(${pr},${pg},${pb})" stroke="rgba(0,0,0,0.4)" stroke-width="1"/>
    <!-- Brim -->
    <ellipse cx="16" cy="22" rx="12" ry="4" fill="rgb(${pr-10},${pg-10},${pb-10})" stroke="rgba(0,0,0,0.3)" stroke-width="1"/>
    <!-- Hat band -->
    <line x1="10" y1="18" x2="22" y2="18" stroke="rgb(${ar},${ag},${ab})" stroke-width="2"/>
    <!-- Rune circle -->
    <circle cx="16" cy="14" r="3" fill="none" stroke="rgba(${ar},${ag},${ab},0.7)" stroke-width="1"/>
    <!-- Star tip -->
    <circle cx="16" cy="5" r="2" fill="rgba(${gr},${gg},${gb},0.9)"/>
    <!-- Hat trim -->
    <line x1="9" y1="21" x2="23" y2="21" stroke="rgb(${sr},${sg},${sb})" stroke-width="1.5"/>
  </svg>`;
}

function buildMedalSvg(vis) {
  const [pr, pg, pb] = vis.primary;
  const [sr, sg, sb] = vis.secondary;
  const [gr, gg, gb] = vis.glow;
  const [ar, ag, ab] = vis.accent;
  const [br, bgr, bb] = vis.bg;

  const isSilver = vis.name.includes('Conqueror');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect x="1" y="1" width="30" height="30" rx="4" fill="rgb(${br},${bgr},${bb})" stroke="rgba(${gr},${gg},${gb},0.5)" stroke-width="1"/>
    <!-- Ribbon -->
    <polygon points="11,4 16,10 21,4" fill="rgb(${sr},${sg},${sb})"/>
    <polygon points="12,4 16,9 20,4" fill="rgba(255,255,255,0.15)"/>
    <!-- Medal glow -->
    <circle cx="16" cy="18" r="10" fill="rgba(${gr},${gg},${gb},0.2)"/>
    <!-- Medal disc -->
    <circle cx="16" cy="18" r="9" fill="rgb(${pr},${pg},${pb})" stroke="rgba(0,0,0,0.3)" stroke-width="1"/>
    <!-- Medal rim -->
    <circle cx="16" cy="18" r="8" fill="none" stroke="rgb(${ar},${ag},${ab})" stroke-width="1.5"/>
    <!-- Inner design -->
    ${isSilver ? `
    <!-- Star emblem -->
    <polygon points="16,12 17.5,15 21,15 18.5,17.5 19.5,21 16,19 12.5,21 13.5,17.5 11,15 14.5,15" fill="rgb(${ar},${ag},${ab})"/>
    ` : `
    <!-- Shield emblem -->
    <path d="M 13 14 L 16 12 L 19 14 L 19 20 Q 16 22 13 20 Z" fill="rgb(${ar},${ag},${ab})"/>
    <path d="M 14 15 L 16 13 L 18 15 L 18 19 Q 16 21 14 19 Z" fill="rgba(255,255,255,0.15)"/>
    `}
    <!-- Highlight -->
    <ellipse cx="13" cy="15" rx="2" ry="3" fill="rgba(255,255,255,0.2)"/>
    <!-- Chain link at top -->
    <circle cx="16" cy="10" r="2" fill="none" stroke="rgb(${pr},${pg},${pb})" stroke-width="1.5"/>
  </svg>`;
}

// ── Generation ───────────────────────────────────────────────────────────────

async function generateEquipIcon(id, vis) {
  const itemDir = join(SPRITE_DIR, String(id));
  mkdirSync(itemDir, { recursive: true });

  const svg = vis.type === 'cap' ? buildCapSvg(vis) : buildMedalSvg(vis);
  const buf = await sharp(Buffer.from(svg)).resize(vis.w || W, vis.h || H).png().toBuffer();

  const iconPath = join(itemDir, 'icon.png');
  const iconRawPath = join(itemDir, 'iconRaw.png');
  writeFileSync(iconPath, buf);
  writeFileSync(iconRawPath, buf);
  return { iconPath, iconRawPath };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function generateAllEquipmentSprites() {
  mkdirSync(SPRITE_DIR, { recursive: true });
  const results = [];
  let generated = 0;

  for (const [idStr, vis] of Object.entries(EQUIPMENT_VISUALS)) {
    const id = Number(idStr);
    try {
      const paths = await generateEquipIcon(id, vis);
      results.push({ id, name: vis.name, type: vis.type, status: 'generated' });
      generated += 2;
      log.info({ id, name: vis.name }, 'Equipment icon generated');
    } catch (err) {
      results.push({ id, name: vis.name, status: 'error', error: err.message });
      log.error({ id, err: err.message }, 'Equipment icon generation failed');
    }
  }

  log.info({ generated, items: results.length }, 'All equipment sprites generated');
  return { generated, results };
}

export function equipmentSpriteStatus() {
  const status = {};
  for (const [idStr, vis] of Object.entries(EQUIPMENT_VISUALS)) {
    const dir = join(SPRITE_DIR, idStr);
    const hasIcon = existsSync(join(dir, 'icon.png'));
    const hasRaw = existsSync(join(dir, 'iconRaw.png'));
    status[idStr] = { name: vis.name, type: vis.type, hasIcon, hasRaw, complete: hasIcon && hasRaw };
  }
  return status;
}
