/**
 * modules/maplestory/necromancer-sprites.js — Skill effect sprite generator for Necromancer class.
 *
 * Generates programmatic skill effect sprites (PNG) using sharp, then injects
 * effect/icon canvas entries into the Necromancer skill WZ XMLs (700-712.img.xml).
 *
 * For each skill type:
 *   - Attack/Active: multi-frame effect animation (4-8 frames) + 32x32 icon
 *   - Passive: 32x32 icon only (no in-game effect animation)
 *   - Buff/Debuff: 3-4 frame aura effect + icon
 *   - Summon: 4-6 frame summon circle effect + icon
 *
 * Wired into index.js as: maple_gen_necro_sprites, maple_necro_sprite_status,
 *                          maple_pack_necro_wz
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('maplestory:necro-sprites');

const WZ_DIR = join(process.cwd(), 'workspace', 'Cosmic', 'wz');
const SPRITE_DIR = join(process.cwd(), 'workspace', 'maple-sprites', 'necromancer');
const SKILL_WZ = (jobId) => join(WZ_DIR, 'Skill.wz', `${jobId}.img.xml`);

// ── Necromancer Skill Visual Definitions ─────────────────────────────────────

const SKILL_VISUALS = {
  // ── Tier 1: Necromancer (700) ──
  7001000: {
    name: 'Death Bolt',
    type: 'attack',
    frames: 6,
    theme: { primary: [120, 40, 180], secondary: [200, 80, 255], glow: [160, 60, 220] },
    shape: 'bolt',
    desc: 'Dark purple energy bolt projectile',
    iconBg: [80, 20, 120],
  },
  7001001: {
    name: 'Soul Siphon',
    type: 'passive',
    frames: 0,
    theme: { primary: [60, 200, 80], secondary: [100, 255, 120], glow: [80, 230, 100] },
    shape: 'wisps',
    desc: 'Green soul drain effect',
    iconBg: [30, 100, 40],
  },
  7001002: {
    name: 'Dark Pact',
    type: 'passive',
    frames: 0,
    theme: { primary: [100, 30, 150], secondary: [150, 60, 200], glow: [120, 40, 180] },
    shape: 'aura',
    desc: 'Dark purple magical aura',
    iconBg: [60, 15, 90],
  },
  7001003: {
    name: 'Grave Embrace',
    type: 'passive',
    frames: 0,
    theme: { primary: [80, 80, 140], secondary: [120, 120, 200], glow: [100, 100, 170] },
    shape: 'shield',
    desc: 'Ghostly blue-grey mana shield',
    iconBg: [40, 40, 80],
  },
  7001004: {
    name: 'Shadow Step',
    type: 'active',
    frames: 4,
    theme: { primary: [40, 10, 60], secondary: [80, 30, 120], glow: [60, 20, 90] },
    shape: 'smoke',
    desc: 'Dark teleport shadow burst',
    iconBg: [20, 5, 35],
  },

  // ── Tier 2: Dark Acolyte (710) ──
  7101000: {
    name: 'Bone Spear',
    type: 'attack',
    frames: 6,
    theme: { primary: [200, 190, 170], secondary: [240, 230, 210], glow: [220, 210, 190] },
    shape: 'spear',
    desc: 'Bone-white piercing projectile',
    iconBg: [120, 110, 100],
  },
  7101001: {
    name: 'Summon Skeleton',
    type: 'summon',
    frames: 5,
    theme: { primary: [180, 170, 150], secondary: [220, 210, 190], glow: [100, 200, 100] },
    shape: 'circle',
    desc: 'Green summoning circle with bones',
    iconBg: [90, 85, 75],
  },
  7101002: {
    name: 'Curse of Weakness',
    type: 'debuff',
    frames: 4,
    theme: { primary: [150, 50, 50], secondary: [200, 80, 80], glow: [180, 60, 60] },
    shape: 'curse',
    desc: 'Red curse sigil overhead',
    iconBg: [90, 25, 25],
  },
  7101003: {
    name: 'Dark Mastery',
    type: 'passive',
    frames: 0,
    theme: { primary: [100, 30, 150], secondary: [150, 60, 200], glow: [120, 40, 180] },
    shape: 'aura',
    desc: 'Dark mastery passive glow',
    iconBg: [55, 15, 85],
  },
  7101004: {
    name: 'Corpse Explosion',
    type: 'attack',
    frames: 7,
    theme: { primary: [200, 60, 30], secondary: [255, 120, 50], glow: [230, 80, 40] },
    shape: 'explosion',
    desc: 'Red-orange necrotic explosion',
    iconBg: [120, 30, 15],
  },
  7101005: {
    name: "Death's Embrace",
    type: 'buff',
    frames: 4,
    theme: { primary: [100, 40, 160], secondary: [150, 80, 220], glow: [130, 60, 200] },
    shape: 'aura',
    desc: 'Purple self-buff aura',
    iconBg: [60, 20, 100],
  },

  // ── Tier 3: Soul Reaper (711) ──
  7111000: {
    name: 'Soul Harvest',
    type: 'attack',
    frames: 6,
    theme: { primary: [60, 200, 80], secondary: [100, 255, 120], glow: [80, 230, 100] },
    shape: 'scythe',
    desc: 'Green soul-reaping arc',
    iconBg: [30, 110, 40],
  },
  7111001: {
    name: 'Raise Undead Army',
    type: 'summon',
    frames: 6,
    theme: { primary: [60, 180, 60], secondary: [100, 220, 100], glow: [80, 200, 80] },
    shape: 'circle',
    desc: 'Large green summoning circle',
    iconBg: [30, 100, 30],
  },
  7111002: {
    name: 'Plague Cloud',
    type: 'attack',
    frames: 5,
    theme: { primary: [100, 150, 50], secondary: [150, 200, 80], glow: [120, 180, 60] },
    shape: 'cloud',
    desc: 'Yellow-green toxic cloud',
    iconBg: [55, 85, 25],
  },
  7111003: {
    name: 'Soul Shield',
    type: 'buff',
    frames: 4,
    theme: { primary: [80, 140, 200], secondary: [120, 180, 240], glow: [100, 160, 220] },
    shape: 'shield',
    desc: 'Blue spectral shield aura',
    iconBg: [40, 70, 110],
  },
  7111004: {
    name: 'Death Mark',
    type: 'debuff',
    frames: 4,
    theme: { primary: [180, 30, 30], secondary: [230, 60, 60], glow: [200, 40, 40] },
    shape: 'mark',
    desc: 'Red death mark sigil',
    iconBg: [100, 15, 15],
  },

  // ── Tier 4: Lich King (712) ──
  7121000: {
    name: 'Necrotic Blast',
    type: 'attack',
    frames: 8,
    theme: { primary: [140, 40, 200], secondary: [180, 80, 255], glow: [160, 60, 230] },
    shape: 'explosion',
    desc: 'Massive purple necrotic explosion',
    iconBg: [80, 20, 120],
  },
  7121001: {
    name: 'Lich Form',
    type: 'buff',
    frames: 5,
    theme: { primary: [60, 200, 220], secondary: [100, 240, 255], glow: [80, 220, 240] },
    shape: 'transform',
    desc: 'Cyan lich transformation aura',
    iconBg: [30, 110, 120],
  },
  7121002: {
    name: 'Army of Darkness',
    type: 'summon',
    frames: 7,
    theme: { primary: [40, 10, 60], secondary: [80, 30, 120], glow: [60, 20, 90] },
    shape: 'circle',
    desc: 'Dark mass summoning portal',
    iconBg: [20, 5, 35],
  },
  7121003: {
    name: 'Soul Rend',
    type: 'attack',
    frames: 6,
    theme: { primary: [200, 50, 200], secondary: [255, 100, 255], glow: [230, 70, 230] },
    shape: 'scythe',
    desc: 'Magenta soul-tearing slash',
    iconBg: [110, 25, 110],
  },
  7121004: {
    name: "Death's Door",
    type: 'buff',
    frames: 4,
    theme: { primary: [180, 180, 180], secondary: [230, 230, 230], glow: [200, 200, 200] },
    shape: 'aura',
    desc: 'White invincibility aura',
    iconBg: [100, 100, 100],
  },
  7121005: {
    name: 'Apocalypse',
    type: 'attack',
    frames: 8,
    theme: { primary: [200, 30, 30], secondary: [255, 80, 40], glow: [230, 50, 35] },
    shape: 'explosion',
    desc: 'Screen-wide red/orange destruction wave',
    iconBg: [120, 15, 15],
  },
};

// ── Sprite Generation (programmatic via sharp) ───────────────────────────────

/**
 * Generate a single effect frame as a PNG buffer using sharp.
 * Each shape type produces a unique visual pattern per frame.
 */
async function generateEffectFrame(skillId, frameIndex, totalFrames) {
  const visual = SKILL_VISUALS[skillId];
  if (!visual) throw new Error(`No visual def for skill ${skillId}`);

  const w = 64, h = 64;
  const progress = frameIndex / Math.max(totalFrames - 1, 1); // 0..1
  const [pr, pg, pb] = visual.theme.primary;
  const [sr, sg, sb] = visual.theme.secondary;
  const [gr, gg, gb] = visual.theme.glow;

  // Interpolate color based on frame progress
  const lerp = (a, b, t) => Math.round(a + (b - a) * t);
  const cr = lerp(pr, sr, progress);
  const cg = lerp(pg, sg, progress);
  const cb = lerp(pb, sb, progress);

  // Alpha pulse: builds up then fades
  const alpha = Math.round(255 * Math.sin(progress * Math.PI));
  const glowAlpha = Math.round(180 * Math.sin(progress * Math.PI));

  // Build SVG based on shape type
  let svgContent = '';
  const cx = w / 2, cy = h / 2;

  switch (visual.shape) {
    case 'bolt': {
      const boltLen = 20 + progress * 20;
      const boltW = 4 + progress * 4;
      svgContent = `
        <defs><filter id="glow"><feGaussianBlur stdDeviation="3"/></filter></defs>
        <ellipse cx="${cx}" cy="${cy}" rx="${boltLen}" ry="${boltW}"
          fill="rgba(${cr},${cg},${cb},${alpha / 255})" filter="url(#glow)"/>
        <ellipse cx="${cx}" cy="${cy}" rx="${boltLen * 0.6}" ry="${boltW * 0.5}"
          fill="rgba(${sr},${sg},${sb},${Math.min(1, alpha / 200)})"/>
        <rect x="${cx - boltLen * 0.3}" y="${cy - 1}" width="${boltLen * 0.6}" height="2"
          fill="rgba(255,255,255,${alpha / 300})"/>`;
      break;
    }
    case 'smoke': {
      const radius = 10 + progress * 18;
      const opacity = 0.8 - progress * 0.7;
      svgContent = `
        <defs><filter id="blur"><feGaussianBlur stdDeviation="${2 + progress * 4}"/></filter></defs>
        <circle cx="${cx - 5}" cy="${cy + 5}" r="${radius * 0.8}" fill="rgba(${cr},${cg},${cb},${opacity * 0.6})" filter="url(#blur)"/>
        <circle cx="${cx + 5}" cy="${cy - 3}" r="${radius}" fill="rgba(${cr},${cg},${cb},${opacity})" filter="url(#blur)"/>
        <circle cx="${cx}" cy="${cy}" r="${radius * 0.5}" fill="rgba(${sr},${sg},${sb},${opacity * 0.8})" filter="url(#blur)"/>`;
      break;
    }
    case 'explosion': {
      const r1 = 5 + progress * 25;
      const r2 = 3 + progress * 18;
      const spikes = 6;
      let points = '';
      for (let i = 0; i < spikes * 2; i++) {
        const angle = (i * Math.PI) / spikes - Math.PI / 2;
        const r = i % 2 === 0 ? r1 : r2;
        points += `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)} `;
      }
      svgContent = `
        <defs><filter id="glow"><feGaussianBlur stdDeviation="${1 + progress * 3}"/></filter></defs>
        <polygon points="${points.trim()}" fill="rgba(${cr},${cg},${cb},${alpha / 255})" filter="url(#glow)"/>
        <circle cx="${cx}" cy="${cy}" r="${r2 * 0.6}" fill="rgba(${sr},${sg},${sb},${Math.min(1, alpha / 200)})"/>
        <circle cx="${cx}" cy="${cy}" r="${r2 * 0.3}" fill="rgba(255,220,180,${alpha / 350})"/>`;
      break;
    }
    case 'spear': {
      const len = 30 + progress * 15;
      const tip = progress < 0.5 ? progress * 2 : 1;
      svgContent = `
        <defs><filter id="glow"><feGaussianBlur stdDeviation="2"/></filter></defs>
        <line x1="${cx - len / 2}" y1="${cy}" x2="${cx + len / 2}" y2="${cy}"
          stroke="rgba(${cr},${cg},${cb},${alpha / 255})" stroke-width="3" filter="url(#glow)"/>
        <polygon points="${cx + len / 2},${cy} ${cx + len / 2 - 6},${cy - 4} ${cx + len / 2 - 6},${cy + 4}"
          fill="rgba(${sr},${sg},${sb},${tip})"/>
        <line x1="${cx - len / 3}" y1="${cy}" x2="${cx + len / 3}" y2="${cy}"
          stroke="rgba(255,255,255,${alpha / 400})" stroke-width="1"/>`;
      break;
    }
    case 'circle': {
      const radius = 8 + progress * 20;
      const rot = frameIndex * 60;
      svgContent = `
        <defs><filter id="glow"><feGaussianBlur stdDeviation="2"/></filter></defs>
        <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none"
          stroke="rgba(${cr},${cg},${cb},${alpha / 255})" stroke-width="2" filter="url(#glow)"/>
        <circle cx="${cx}" cy="${cy}" r="${radius * 0.7}" fill="none"
          stroke="rgba(${sr},${sg},${sb},${glowAlpha / 255})" stroke-width="1.5"
          stroke-dasharray="4,4" transform="rotate(${rot},${cx},${cy})"/>
        <circle cx="${cx}" cy="${cy}" r="${radius * 0.3}"
          fill="rgba(${gr},${gg},${gb},${alpha / 400})"/>`;
      break;
    }
    case 'scythe': {
      const arcAngle = progress * 180;
      const r = 22;
      const startAngle = -90 - arcAngle / 2;
      const endAngle = -90 + arcAngle / 2;
      const x1 = cx + r * Math.cos((startAngle * Math.PI) / 180);
      const y1 = cy + r * Math.sin((startAngle * Math.PI) / 180);
      const x2 = cx + r * Math.cos((endAngle * Math.PI) / 180);
      const y2 = cy + r * Math.sin((endAngle * Math.PI) / 180);
      const largeArc = arcAngle > 180 ? 1 : 0;
      svgContent = `
        <defs><filter id="glow"><feGaussianBlur stdDeviation="2"/></filter></defs>
        <path d="M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}"
          fill="none" stroke="rgba(${cr},${cg},${cb},${alpha / 255})" stroke-width="4" stroke-linecap="round" filter="url(#glow)"/>
        <path d="M ${x1} ${y1} A ${r * 0.7} ${r * 0.7} 0 ${largeArc} 1 ${x2} ${y2}"
          fill="none" stroke="rgba(${sr},${sg},${sb},${glowAlpha / 255})" stroke-width="2"/>`;
      break;
    }
    case 'cloud': {
      const spread = 10 + progress * 15;
      const opacity = 0.7 - progress * 0.4;
      svgContent = `
        <defs><filter id="blur"><feGaussianBlur stdDeviation="${3 + progress * 3}"/></filter></defs>
        <ellipse cx="${cx - 6}" cy="${cy}" rx="${spread}" ry="${spread * 0.6}"
          fill="rgba(${cr},${cg},${cb},${opacity})" filter="url(#blur)"/>
        <ellipse cx="${cx + 6}" cy="${cy - 4}" rx="${spread * 0.8}" ry="${spread * 0.5}"
          fill="rgba(${sr},${sg},${sb},${opacity * 0.8})" filter="url(#blur)"/>`;
      break;
    }
    case 'curse':
    case 'mark': {
      const size = 8 + progress * 12;
      const rot = frameIndex * 45;
      svgContent = `
        <defs><filter id="glow"><feGaussianBlur stdDeviation="2"/></filter></defs>
        <polygon points="${cx},${cy - size} ${cx + size * 0.6},${cy + size * 0.5} ${cx - size * 0.6},${cy + size * 0.5}"
          fill="none" stroke="rgba(${cr},${cg},${cb},${alpha / 255})" stroke-width="2"
          transform="rotate(${rot},${cx},${cy})" filter="url(#glow)"/>
        <polygon points="${cx},${cy + size} ${cx + size * 0.6},${cy - size * 0.5} ${cx - size * 0.6},${cy - size * 0.5}"
          fill="none" stroke="rgba(${sr},${sg},${sb},${glowAlpha / 255})" stroke-width="1.5"
          transform="rotate(${-rot},${cx},${cy})"/>
        <circle cx="${cx}" cy="${cy}" r="3" fill="rgba(${cr},${cg},${cb},${alpha / 255})"/>`;
      break;
    }
    case 'transform': {
      const innerR = 5 + progress * 8;
      const outerR = 15 + progress * 15;
      svgContent = `
        <defs><filter id="glow"><feGaussianBlur stdDeviation="3"/></filter></defs>
        <circle cx="${cx}" cy="${cy}" r="${outerR}" fill="none"
          stroke="rgba(${cr},${cg},${cb},${alpha / 300})" stroke-width="1.5" filter="url(#glow)"/>
        <circle cx="${cx}" cy="${cy}" r="${innerR}"
          fill="rgba(${sr},${sg},${sb},${alpha / 400})"/>
        <line x1="${cx}" y1="${cy - outerR}" x2="${cx}" y2="${cy + outerR}"
          stroke="rgba(${gr},${gg},${gb},${alpha / 500})" stroke-width="1"/>
        <line x1="${cx - outerR}" y1="${cy}" x2="${cx + outerR}" y2="${cy}"
          stroke="rgba(${gr},${gg},${gb},${alpha / 500})" stroke-width="1"/>`;
      break;
    }
    default: { // aura, shield, wisps — generic glow
      const radius = 12 + progress * 12;
      svgContent = `
        <defs><filter id="glow"><feGaussianBlur stdDeviation="4"/></filter></defs>
        <circle cx="${cx}" cy="${cy}" r="${radius}"
          fill="rgba(${cr},${cg},${cb},${alpha / 350})" filter="url(#glow)"/>
        <circle cx="${cx}" cy="${cy}" r="${radius * 0.6}"
          fill="rgba(${sr},${sg},${sb},${alpha / 400})"/>`;
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="transparent"/>
    ${svgContent}
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Generate a 32x32 skill icon PNG.
 */
async function generateSkillIcon(skillId) {
  const visual = SKILL_VISUALS[skillId];
  if (!visual) throw new Error(`No visual def for skill ${skillId}`);

  const [br, bg, bb] = visual.iconBg;
  const [pr, pg, pb] = visual.theme.primary;
  const [sr, sg, sb] = visual.theme.secondary;
  const w = 32, h = 32;

  // Icon: rounded square with symbol
  let symbol = '';
  const cx = 16, cy = 16;

  switch (visual.type) {
    case 'attack':
      symbol = `<polygon points="${cx},${cy - 8} ${cx + 7},${cy + 6} ${cx - 7},${cy + 6}" fill="rgba(${sr},${sg},${sb},0.9)"/>`;
      break;
    case 'passive':
      symbol = `<circle cx="${cx}" cy="${cy}" r="7" fill="none" stroke="rgba(${sr},${sg},${sb},0.8)" stroke-width="2"/>
        <circle cx="${cx}" cy="${cy}" r="3" fill="rgba(${sr},${sg},${sb},0.6)"/>`;
      break;
    case 'buff':
      symbol = `<polygon points="${cx},${cy - 9} ${cx + 8},${cy + 4} ${cx},${cy + 1} ${cx - 8},${cy + 4}" fill="rgba(${sr},${sg},${sb},0.8)"/>
        <line x1="${cx}" y1="${cy + 1}" x2="${cx}" y2="${cy + 8}" stroke="rgba(${sr},${sg},${sb},0.7)" stroke-width="2"/>`;
      break;
    case 'debuff':
      symbol = `<line x1="${cx - 6}" y1="${cy - 6}" x2="${cx + 6}" y2="${cy + 6}" stroke="rgba(${sr},${sg},${sb},0.9)" stroke-width="2"/>
        <line x1="${cx + 6}" y1="${cy - 6}" x2="${cx - 6}" y2="${cy + 6}" stroke="rgba(${sr},${sg},${sb},0.9)" stroke-width="2"/>
        <circle cx="${cx}" cy="${cy}" r="8" fill="none" stroke="rgba(${sr},${sg},${sb},0.6)" stroke-width="1.5"/>`;
      break;
    case 'summon':
      symbol = `<circle cx="${cx}" cy="${cy}" r="8" fill="none" stroke="rgba(${sr},${sg},${sb},0.8)" stroke-width="1.5" stroke-dasharray="3,2"/>
        <circle cx="${cx}" cy="${cy}" r="4" fill="rgba(${sr},${sg},${sb},0.5)"/>`;
      break;
    default:
      symbol = `<circle cx="${cx}" cy="${cy}" r="6" fill="rgba(${sr},${sg},${sb},0.7)"/>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect x="1" y="1" width="30" height="30" rx="4" ry="4" fill="rgb(${br},${bg},${bb})" stroke="rgba(${pr},${pg},${pb},0.6)" stroke-width="1"/>
    ${symbol}
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ── Batch Generation ─────────────────────────────────────────────────────────

/**
 * Generate all effect sprites + icons for a given job tier.
 * @param {number} jobId - 700, 710, 711, or 712
 * @returns {{ generated: number, skills: object[] }}
 */
export async function generateTierSprites(jobId) {
  const tierDir = join(SPRITE_DIR, String(jobId));
  mkdirSync(tierDir, { recursive: true });

  const tierSkills = Object.entries(SKILL_VISUALS).filter(
    ([id]) => Math.floor(Number(id) / 10000) * 10 === jobId ||
              (Number(id) >= jobId * 10000 + 1000 && Number(id) < (jobId + 1) * 10000)
  );

  // Actually filter by job tier prefix
  const prefix = jobId === 700 ? '7001' : jobId === 710 ? '7101' : jobId === 711 ? '7111' : '7121';
  const skills = Object.entries(SKILL_VISUALS).filter(([id]) => String(id).startsWith(prefix));

  const results = [];
  let generated = 0;

  for (const [skillIdStr, visual] of skills) {
    const skillId = Number(skillIdStr);
    const skillDir = join(tierDir, String(skillId));
    mkdirSync(skillDir, { recursive: true });

    // Generate icon
    const iconBuf = await generateSkillIcon(skillId);
    const iconPath = join(skillDir, 'icon.png');
    writeFileSync(iconPath, iconBuf);
    generated++;

    // Generate effect frames (if applicable)
    const framePaths = [];
    if (visual.frames > 0) {
      for (let f = 0; f < visual.frames; f++) {
        const frameBuf = await generateEffectFrame(skillId, f, visual.frames);
        const framePath = join(skillDir, `effect_${f}.png`);
        writeFileSync(framePath, frameBuf);
        framePaths.push(framePath);
        generated++;
      }
    }

    results.push({
      skillId,
      name: visual.name,
      type: visual.type,
      iconPath,
      effectFrames: framePaths.length,
      effectPaths: framePaths,
    });

    log.info({ skillId, name: visual.name, frames: framePaths.length }, 'Generated skill sprites');
  }

  return { generated, skills: results };
}

/**
 * Generate sprites for ALL 4 tiers.
 */
export async function generateAllSprites() {
  const tiers = [700, 710, 711, 712];
  const allResults = {};
  let totalGenerated = 0;

  for (const tier of tiers) {
    const result = await generateTierSprites(tier);
    allResults[tier] = result;
    totalGenerated += result.generated;
    log.info({ tier, generated: result.generated }, 'Tier sprites complete');
  }

  return { totalGenerated, tiers: allResults };
}

// ── WZ XML Injection ─────────────────────────────────────────────────────────

/**
 * Add effect/icon canvas entries to a skill WZ XML file.
 * Inserts after the closing </imgdir> of the skill's level data.
 */
export function injectEffectXml(jobId) {
  const xmlPath = SKILL_WZ(jobId);
  if (!existsSync(xmlPath)) throw new Error(`Skill WZ not found: ${xmlPath}`);

  let xml = readFileSync(xmlPath, 'utf8');
  const prefix = jobId === 700 ? '7001' : jobId === 710 ? '7101' : jobId === 711 ? '7111' : '7121';
  const skills = Object.entries(SKILL_VISUALS).filter(([id]) => String(id).startsWith(prefix));

  let injected = 0;

  for (const [skillIdStr, visual] of skills) {
    const skillId = skillIdStr;

    // Skip if effect already present
    if (xml.includes(`name="${skillId}">`) && xml.includes(`<!-- effect:${skillId} -->`)) {
      continue;
    }

    // Build effect XML
    let effectXml = '';
    if (visual.frames > 0) {
      effectXml = `\n      <!-- effect:${skillId} -->\n      <imgdir name="effect">\n`;
      for (let f = 0; f < visual.frames; f++) {
        const delay = visual.type === 'attack' ? 80 : 120;
        effectXml += `        <canvas name="${f}" width="64" height="64">\n`;
        effectXml += `          <vector name="origin" x="32" y="32"/>\n`;
        effectXml += `          <int name="z" value="0"/>\n`;
        effectXml += `          <int name="delay" value="${delay}"/>\n`;
        effectXml += `        </canvas>\n`;
      }
      effectXml += `      </imgdir>\n`;
    }

    // Build icon XML
    const iconXml = `      <!-- icon:${skillId} -->\n      <imgdir name="icon">\n        <canvas name="icon" width="32" height="32">\n          <vector name="origin" x="0" y="32"/>\n        </canvas>\n        <canvas name="iconMouseOver" width="32" height="32">\n          <vector name="origin" x="0" y="32"/>\n        </canvas>\n        <canvas name="iconDisabled" width="32" height="32">\n          <vector name="origin" x="0" y="32"/>\n        </canvas>\n      </imgdir>\n`;

    // Find the skill's closing tag and inject before it
    // Pattern: find `<imgdir name="SKILLID">` ... `</imgdir>` (the outermost one for this skill)
    const skillOpen = `<imgdir name="${skillId}">`;
    const skillIdx = xml.indexOf(skillOpen);
    if (skillIdx === -1) continue;

    // Find the closing </imgdir> for this skill block
    // We need to count nesting depth
    let depth = 0;
    let closeIdx = -1;
    let i = skillIdx;
    while (i < xml.length) {
      if (xml.substring(i, i + 7) === '<imgdir') {
        depth++;
        i += 7;
      } else if (xml.substring(i, i + 9) === '</imgdir>') {
        depth--;
        if (depth === 0) {
          closeIdx = i;
          break;
        }
        i += 9;
      } else {
        i++;
      }
    }

    if (closeIdx === -1) continue;

    // Insert effect + icon XML before the closing </imgdir>
    const insertion = effectXml + iconXml;
    xml = xml.substring(0, closeIdx) + insertion + xml.substring(closeIdx);
    injected++;
  }

  if (injected > 0) {
    writeFileSync(xmlPath, xml, 'utf8');
    log.info({ jobId, injected }, 'Injected effect XML into skill WZ');
  }

  return { jobId, injected };
}

/**
 * Inject effect XML for all tiers.
 */
export function injectAllEffectXml() {
  const results = [];
  for (const tier of [700, 710, 711, 712]) {
    try {
      results.push(injectEffectXml(tier));
    } catch (err) {
      log.error({ tier, err: err.message }, 'Failed to inject effect XML');
      results.push({ jobId: tier, injected: 0, error: err.message });
    }
  }
  return results;
}

// ── Status Report ────────────────────────────────────────────────────────────

/**
 * Check which sprites exist on disk and which WZ XMLs have effect entries.
 */
export function getSpriteStatus() {
  const status = { tiers: {}, totalSprites: 0, totalEffectXml: 0 };

  for (const tier of [700, 710, 711, 712]) {
    const prefix = tier === 700 ? '7001' : tier === 710 ? '7101' : tier === 711 ? '7111' : '7121';
    const skills = Object.entries(SKILL_VISUALS).filter(([id]) => String(id).startsWith(prefix));
    const tierStatus = { skills: [], spritesOnDisk: 0, effectXmlPresent: 0 };

    // Check WZ XML
    const xmlPath = SKILL_WZ(tier);
    const xmlExists = existsSync(xmlPath);
    const xml = xmlExists ? readFileSync(xmlPath, 'utf8') : '';

    for (const [skillId, visual] of skills) {
      const skillDir = join(SPRITE_DIR, String(tier), skillId);
      const hasIcon = existsSync(join(skillDir, 'icon.png'));
      const hasEffect = visual.frames > 0
        ? existsSync(join(skillDir, 'effect_0.png'))
        : true; // passives don't need effect frames
      const hasXml = xml.includes(`<!-- effect:${skillId} -->`) || xml.includes(`<!-- icon:${skillId} -->`);

      if (hasIcon) { tierStatus.spritesOnDisk++; status.totalSprites++; }
      if (hasXml) { tierStatus.effectXmlPresent++; status.totalEffectXml++; }

      tierStatus.skills.push({
        skillId: Number(skillId),
        name: visual.name,
        type: visual.type,
        hasIcon,
        hasEffect,
        hasXml,
      });
    }

    status.tiers[tier] = tierStatus;
  }

  return status;
}

// ── Client WZ Packing via Harepacker-MCP ─────────────────────────────────────

const ICONS_B64_PATH = join(process.cwd(), 'workspace', 'maple-sprites', 'necromancer', 'icons_b64.json');
const V83_IMG_DATA = join(process.cwd(), 'workspace', 'v83-img-data');

/** Skill IDs per job image */
const JOB_IMG_SKILLS = {
  '700.img': ['7001000', '7001001', '7001002', '7001003', '7001004'],
  '710.img': ['7101000', '7101001', '7101002', '7101003', '7101004', '7101005'],
  '711.img': ['7111000', '7111001', '7111002', '7111003', '7111004'],
  '712.img': ['7121000', '7121001', '7121002', '7121003', '7121004', '7121005'],
};

/**
 * Pack Necromancer skill icons into client WZ binary format via harepacker-mcp.
 *
 * For each of the 22 necromancer skills, injects the icon PNG into the
 * v83-img-data Skill/{job}.img file using harepacker-mcp add_property + import_png.
 * After all skills are added to an img file, save_image is called to persist.
 *
 * @param {Function} callTool - (server, tool, params) => Promise<result>
 * @returns {Promise<object>} packing summary
 */
export async function packSpritesToClientWz(callTool) {
  if (!existsSync(ICONS_B64_PATH)) {
    throw new Error(`icons_b64.json not found at ${ICONS_B64_PATH}. Run maple_gen_necro_sprites first.`);
  }

  const icons = JSON.parse(readFileSync(ICONS_B64_PATH, 'utf8'));
  const results = { packed: [], errors: [], imgFiles: 0 };

  // Ensure harepacker data source is initialised
  await callTool('harepacker-mcp', 'init_data_source', { basePath: V83_IMG_DATA });

  for (const [imgFile, skillIds] of Object.entries(JOB_IMG_SKILLS)) {
    log.info({ imgFile, skillCount: skillIds.length }, 'Packing skill icons into img');
    let imgPacked = 0;

    // Parse (load) the img into harepacker memory
    try {
      await callTool('harepacker-mcp', 'parse_image', { category: 'skill', image: imgFile });
    } catch (err) {
      log.warn({ imgFile, err: err.message }, 'parse_image failed — img may already be parsed');
    }

    for (const skillId of skillIds) {
      const iconB64 = icons[skillId];
      if (!iconB64) {
        const msg = `No icon for skill ${skillId}`;
        log.warn(msg);
        results.errors.push(msg);
        continue;
      }

      try {
        // Create skill SubProperty under "skill" root node
        await callTool('harepacker-mcp', 'add_property', {
          category: 'skill',
          image: imgFile,
          parentPath: 'skill',
          name: skillId,
          type: 'SubProperty',
        });

        // Import icon PNG (32×32)
        await callTool('harepacker-mcp', 'import_png', {
          category: 'skill',
          image: imgFile,
          parentPath: `skill/${skillId}`,
          name: 'icon',
          base64Png: iconB64,
          originX: 0,
          originY: 32,
        });

        // iconMouseOver — same PNG (client brightens on hover)
        await callTool('harepacker-mcp', 'import_png', {
          category: 'skill',
          image: imgFile,
          parentPath: `skill/${skillId}`,
          name: 'iconMouseOver',
          base64Png: iconB64,
          originX: 0,
          originY: 32,
        });

        // iconDisabled — same PNG (client grays out when unavailable)
        await callTool('harepacker-mcp', 'import_png', {
          category: 'skill',
          image: imgFile,
          parentPath: `skill/${skillId}`,
          name: 'iconDisabled',
          base64Png: iconB64,
          originX: 0,
          originY: 32,
        });

        results.packed.push({ skillId, imgFile });
        imgPacked++;
        log.info({ skillId, imgFile }, 'Skill icons packed');
      } catch (err) {
        const msg = `${skillId} in ${imgFile}: ${err.message}`;
        log.error(msg);
        results.errors.push(msg);
      }
    }

    // Save the img file after all skills processed
    if (imgPacked > 0) {
      try {
        await callTool('harepacker-mcp', 'save_image', { category: 'skill', image: imgFile });
        log.info({ imgFile, imgPacked }, 'Saved img after packing');
        results.imgFiles++;
      } catch (err) {
        const msg = `save_image ${imgFile}: ${err.message}`;
        log.error(msg);
        results.errors.push(msg);
      }
    }
  }

  return {
    success: results.errors.length === 0,
    packed: results.packed.length,
    imgFiles: results.imgFiles,
    errors: results.errors,
    detail: results.packed,
  };
}
