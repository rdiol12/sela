/**
 * modules/maplestory/sage-sprites.js — Skill effect sprite generator for Sage class.
 *
 * Generates programmatic skill effect sprites (PNG) using sharp, then injects
 * effect/icon canvas entries into the Sage skill WZ XMLs (600-612.img.xml).
 *
 * For each skill type:
 *   - Attack/Active: multi-frame effect animation (4-8 frames) + 32x32 icon
 *   - Passive: 32x32 icon only (no in-game effect animation)
 *   - Buff: 3-4 frame aura effect + icon
 *
 * Wired into index.js as: maple_gen_sage_sprites, maple_sage_sprite_status,
 *                          maple_pack_sage_wz
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('maplestory:sage-sprites');

const WZ_DIR = join(process.cwd(), 'workspace', 'Cosmic', 'wz');
const SPRITE_DIR = join(process.cwd(), 'workspace', 'maple-sprites', 'sage');
const SKILL_WZ = (jobId) => join(WZ_DIR, 'Skill.wz', `${jobId}.img.xml`);

// ── Sage Skill Visual Definitions ────────────────────────────────────────────

const SKILL_VISUALS = {
  // ── Tier 1: Sage (600) ──
  6001000: {
    name: 'Arcane Bolt',
    type: 'attack',
    frames: 6,
    theme: { primary: [60, 120, 220], secondary: [120, 180, 255], glow: [90, 150, 240] },
    shape: 'bolt',
    desc: 'Blue arcane energy bolt',
    iconBg: [30, 60, 130],
  },
  6001001: {
    name: 'Mana Shield',
    type: 'buff',
    frames: 4,
    theme: { primary: [80, 160, 240], secondary: [140, 210, 255], glow: [110, 185, 248] },
    shape: 'shield',
    desc: 'Blue mana absorption barrier',
    iconBg: [40, 90, 150],
  },
  6001002: {
    name: 'Elemental Attunement',
    type: 'passive',
    frames: 0,
    theme: { primary: [160, 80, 220], secondary: [200, 140, 255], glow: [180, 110, 240] },
    shape: 'aura',
    desc: 'Purple elemental mastery glow',
    iconBg: [90, 40, 130],
  },
  6001003: {
    name: "Sage's Wisdom",
    type: 'passive',
    frames: 0,
    theme: { primary: [200, 200, 60], secondary: [240, 240, 120], glow: [220, 220, 80] },
    shape: 'aura',
    desc: 'Golden wisdom aura',
    iconBg: [110, 110, 30],
  },
  6001004: {
    name: 'Runic Strike',
    type: 'attack',
    frames: 5,
    theme: { primary: [180, 60, 240], secondary: [220, 120, 255], glow: [200, 80, 248] },
    shape: 'bolt',
    desc: 'Violet runic energy strike',
    iconBg: [100, 30, 140],
  },
  6001005: {
    name: 'Teleport',
    type: 'active',
    frames: 4,
    theme: { primary: [60, 200, 200], secondary: [120, 240, 240], glow: [80, 220, 220] },
    shape: 'smoke',
    desc: 'Cyan arcane teleport flash',
    iconBg: [30, 110, 110],
  },

  // ── Tier 2: Elementalist (610) ──
  6101000: {
    name: 'Flame Pillar',
    type: 'attack',
    frames: 7,
    theme: { primary: [220, 80, 20], secondary: [255, 160, 60], glow: [240, 110, 30] },
    shape: 'explosion',
    desc: 'Orange-red fire pillar AoE',
    iconBg: [130, 40, 10],
  },
  6101001: {
    name: 'Frost Nova',
    type: 'attack',
    frames: 6,
    theme: { primary: [80, 180, 240], secondary: [160, 230, 255], glow: [120, 210, 248] },
    shape: 'cloud',
    desc: 'Icy blue frost nova burst',
    iconBg: [40, 100, 150],
  },
  6101002: {
    name: 'Lightning Chain',
    type: 'attack',
    frames: 6,
    theme: { primary: [220, 220, 60], secondary: [255, 255, 140], glow: [240, 240, 80] },
    shape: 'bolt',
    desc: 'Yellow lightning chain arc',
    iconBg: [120, 120, 20],
  },
  6101003: {
    name: 'Elemental Boost',
    type: 'buff',
    frames: 4,
    theme: { primary: [200, 120, 40], secondary: [240, 180, 80], glow: [220, 150, 60] },
    shape: 'aura',
    desc: 'Orange elemental power buff',
    iconBg: [110, 60, 20],
  },
  6101004: {
    name: 'Spell Mastery',
    type: 'passive',
    frames: 0,
    theme: { primary: [160, 60, 200], secondary: [200, 120, 240], glow: [180, 80, 220] },
    shape: 'aura',
    desc: 'Purple mastery passive',
    iconBg: [90, 30, 120],
  },
  6101005: {
    name: 'Mana Surge',
    type: 'passive',
    frames: 0,
    theme: { primary: [60, 140, 220], secondary: [120, 200, 255], glow: [80, 170, 240] },
    shape: 'wisps',
    desc: 'Blue mana recovery wisps',
    iconBg: [30, 70, 130],
  },
  6101006: {
    name: 'Arcane Barrier',
    type: 'buff',
    frames: 4,
    theme: { primary: [100, 180, 220], secondary: [160, 220, 255], glow: [130, 200, 240] },
    shape: 'shield',
    desc: 'Light-blue magic defense barrier',
    iconBg: [50, 100, 130],
  },
  6101007: {
    name: 'Element Shift',
    type: 'buff',
    frames: 5,
    theme: { primary: [180, 80, 180], secondary: [230, 140, 230], glow: [200, 100, 200] },
    shape: 'transform',
    desc: 'Prismatic element-change aura',
    iconBg: [100, 40, 100],
  },

  // ── Tier 3: Arcanum (611) ──
  6111000: {
    name: 'Meteor Shower',
    type: 'attack',
    frames: 8,
    theme: { primary: [240, 80, 20], secondary: [255, 160, 60], glow: [248, 100, 30] },
    shape: 'explosion',
    desc: 'Massive fire meteor AoE',
    iconBg: [140, 40, 10],
  },
  6111001: {
    name: 'Blizzard',
    type: 'attack',
    frames: 7,
    theme: { primary: [100, 180, 255], secondary: [180, 230, 255], glow: [140, 210, 255] },
    shape: 'cloud',
    desc: 'Freezing blizzard AoE',
    iconBg: [50, 100, 160],
  },
  6111002: {
    name: 'Thunder Spear',
    type: 'attack',
    frames: 6,
    theme: { primary: [240, 240, 40], secondary: [255, 255, 160], glow: [248, 248, 80] },
    shape: 'spear',
    desc: 'Yellow lightning spear burst',
    iconBg: [130, 130, 20],
  },
  6111003: {
    name: 'Elemental Convergence',
    type: 'buff',
    frames: 5,
    theme: { primary: [200, 160, 60], secondary: [240, 200, 100], glow: [220, 180, 80] },
    shape: 'aura',
    desc: 'Golden convergence party buff',
    iconBg: [110, 90, 30],
  },
  6111004: {
    name: 'Sage Meditation',
    type: 'buff',
    frames: 4,
    theme: { primary: [120, 200, 140], secondary: [180, 240, 180], glow: [150, 220, 160] },
    shape: 'aura',
    desc: 'Green meditation MP recovery aura',
    iconBg: [60, 110, 70],
  },
  6111005: {
    name: 'Runic Ward',
    type: 'buff',
    frames: 4,
    theme: { primary: [180, 100, 240], secondary: [220, 160, 255], glow: [200, 120, 248] },
    shape: 'shield',
    desc: 'Purple runic guard + reflect',
    iconBg: [100, 50, 140],
  },
  6111006: {
    name: 'Arcane Explosion',
    type: 'attack',
    frames: 7,
    theme: { primary: [140, 80, 220], secondary: [200, 140, 255], glow: [170, 100, 240] },
    shape: 'explosion',
    desc: 'Violet AoE explosion around self',
    iconBg: [80, 40, 130],
  },
  6111007: {
    name: 'Mystic Door',
    type: 'active',
    frames: 5,
    theme: { primary: [80, 180, 180], secondary: [140, 230, 230], glow: [110, 210, 210] },
    shape: 'circle',
    desc: 'Teal mystic portal summoning',
    iconBg: [40, 100, 100],
  },

  // ── Tier 4: Archsage (612) ──
  6121000: {
    name: 'Primordial Inferno',
    type: 'attack',
    frames: 8,
    theme: { primary: [240, 60, 20], secondary: [255, 140, 40], glow: [248, 80, 30] },
    shape: 'explosion',
    desc: 'Screen-wide primordial fire wave',
    iconBg: [150, 30, 10],
  },
  6121001: {
    name: 'Absolute Zero',
    type: 'attack',
    frames: 8,
    theme: { primary: [60, 180, 255], secondary: [160, 230, 255], glow: [100, 210, 255] },
    shape: 'explosion',
    desc: 'Absolute zero ice devastation',
    iconBg: [30, 100, 160],
  },
  6121002: {
    name: 'Divine Thunder',
    type: 'attack',
    frames: 8,
    theme: { primary: [240, 240, 20], secondary: [255, 255, 180], glow: [248, 248, 60] },
    shape: 'explosion',
    desc: 'Divine lightning storm',
    iconBg: [140, 140, 10],
  },
  6121003: {
    name: 'Elemental Unity',
    type: 'buff',
    frames: 5,
    theme: { primary: [220, 180, 60], secondary: [255, 230, 120], glow: [240, 200, 80] },
    shape: 'transform',
    desc: 'Golden prismatic unity aura',
    iconBg: [130, 100, 30],
  },
  6121004: {
    name: "Sage's Enlightenment",
    type: 'passive',
    frames: 0,
    theme: { primary: [240, 220, 100], secondary: [255, 245, 180], glow: [248, 230, 130] },
    shape: 'aura',
    desc: 'Radiant golden enlightenment glow',
    iconBg: [150, 130, 50],
  },
  6121005: {
    name: 'Arcane Mastery',
    type: 'passive',
    frames: 0,
    theme: { primary: [180, 80, 240], secondary: [220, 140, 255], glow: [200, 100, 248] },
    shape: 'aura',
    desc: 'Deep purple mastery aura',
    iconBg: [100, 40, 150],
  },
  6121006: {
    name: 'Infinity',
    type: 'buff',
    frames: 5,
    theme: { primary: [80, 220, 255], secondary: [180, 240, 255], glow: [120, 230, 255] },
    shape: 'aura',
    desc: 'Cyan infinite mana shimmer',
    iconBg: [40, 120, 160],
  },
  6121007: {
    name: "Hero's Will",
    type: 'active',
    frames: 3,
    theme: { primary: [240, 240, 240], secondary: [200, 220, 255], glow: [220, 230, 255] },
    shape: 'aura',
    desc: 'White cleansing status cure',
    iconBg: [140, 140, 160],
  },
  6121008: {
    name: 'Maple Warrior',
    type: 'buff',
    frames: 4,
    theme: { primary: [200, 60, 60], secondary: [255, 120, 100], glow: [220, 80, 80] },
    shape: 'aura',
    desc: 'Red Maple Warrior party buff',
    iconBg: [120, 30, 30],
  },
  6121009: {
    name: 'Elemental Storm',
    type: 'attack',
    frames: 8,
    theme: { primary: [160, 80, 240], secondary: [220, 180, 255], glow: [190, 120, 248] },
    shape: 'explosion',
    desc: 'Prismatic hyper elemental storm',
    iconBg: [90, 40, 150],
  },
};

// ── Sprite Generation (programmatic via sharp) ───────────────────────────────

async function generateEffectFrame(skillId, frameIndex, totalFrames) {
  const visual = SKILL_VISUALS[skillId];
  if (!visual) throw new Error(`No visual def for skill ${skillId}`);

  const w = 64, h = 64;
  const progress = frameIndex / Math.max(totalFrames - 1, 1);
  const [pr, pg, pb] = visual.theme.primary;
  const [sr, sg, sb] = visual.theme.secondary;

  const lerp = (a, b, t) => Math.round(a + (b - a) * t);
  const cr = lerp(pr, sr, progress);
  const cg = lerp(pg, sg, progress);
  const cb = lerp(pb, sb, progress);

  const alpha = Math.round(255 * Math.sin(progress * Math.PI));
  const cx = w / 2, cy = h / 2;

  let svgContent = '';

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
    case 'explosion': {
      const r = 8 + progress * 24;
      const r2 = r * 0.6;
      svgContent = `
        <defs><filter id="glow"><feGaussianBlur stdDeviation="4"/></filter></defs>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(${cr},${cg},${cb},${alpha / 255})" filter="url(#glow)"/>
        <circle cx="${cx}" cy="${cy}" r="${r2}" fill="rgba(${sr},${sg},${sb},${Math.min(1, alpha / 180)})"/>
        <circle cx="${cx}" cy="${cy}" r="${r2 * 0.4}" fill="rgba(255,255,255,${alpha / 400})"/>`;
      break;
    }
    case 'cloud': {
      const r1 = 12 + progress * 10;
      svgContent = `
        <defs><filter id="blur"><feGaussianBlur stdDeviation="5"/></filter></defs>
        <circle cx="${cx}" cy="${cy}" r="${r1}" fill="rgba(${cr},${cg},${cb},${alpha / 255})" filter="url(#blur)"/>
        <circle cx="${cx - 8}" cy="${cy + 4}" r="${r1 * 0.7}" fill="rgba(${sr},${sg},${sb},${alpha / 300})" filter="url(#blur)"/>
        <circle cx="${cx + 8}" cy="${cy + 4}" r="${r1 * 0.7}" fill="rgba(${cr},${cg},${cb},${alpha / 300})" filter="url(#blur)"/>`;
      break;
    }
    case 'shield': {
      const r = 16 + progress * 8;
      const strokeW = 3 - progress * 1.5;
      svgContent = `
        <defs><filter id="glow"><feGaussianBlur stdDeviation="3"/></filter></defs>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
          stroke="rgba(${cr},${cg},${cb},${alpha / 255})" stroke-width="${strokeW}" filter="url(#glow)"/>
        <circle cx="${cx}" cy="${cy}" r="${r * 0.7}" fill="rgba(${sr},${sg},${sb},${alpha / 600})"/>
        <circle cx="${cx}" cy="${cy}" r="${r * 0.85}" fill="none"
          stroke="rgba(${sr},${sg},${sb},${alpha / 400})" stroke-width="1.5"/>`;
      break;
    }
    case 'aura': {
      const r = 14 + progress * 12;
      svgContent = `
        <defs><filter id="glow"><feGaussianBlur stdDeviation="4"/></filter></defs>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(${cr},${cg},${cb},${alpha / 300})" filter="url(#glow)"/>
        <circle cx="${cx}" cy="${cy}" r="${r * 0.7}" fill="none"
          stroke="rgba(${sr},${sg},${sb},${alpha / 255})" stroke-width="2"/>`;
      break;
    }
    case 'spear': {
      const len = 18 + progress * 16;
      svgContent = `
        <defs><filter id="glow"><feGaussianBlur stdDeviation="2"/></filter></defs>
        <line x1="${cx - len}" y1="${cy + len * 0.4}" x2="${cx + len}" y2="${cy - len * 0.4}"
          stroke="rgba(${cr},${cg},${cb},${alpha / 255})" stroke-width="${3 + progress * 2}" filter="url(#glow)"/>
        <polygon points="${cx + len},${cy - len * 0.4} ${cx + len - 8},${cy - len * 0.4 - 5} ${cx + len - 4},${cy - len * 0.4 + 4}"
          fill="rgba(${sr},${sg},${sb},${alpha / 200})"/>`;
      break;
    }
    case 'smoke': {
      const r = 10 + progress * 18;
      svgContent = `
        <defs><filter id="blur"><feGaussianBlur stdDeviation="6"/></filter></defs>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(${cr},${cg},${cb},${alpha / 400})" filter="url(#blur)"/>
        <circle cx="${cx + 4}" cy="${cy - 4}" r="${r * 0.6}" fill="rgba(${sr},${sg},${sb},${alpha / 500})" filter="url(#blur)"/>`;
      break;
    }
    case 'circle': {
      const r = 10 + progress * 18;
      const dash = `${4 + progress * 4},${2 + progress * 2}`;
      svgContent = `
        <defs><filter id="glow"><feGaussianBlur stdDeviation="3"/></filter></defs>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
          stroke="rgba(${cr},${cg},${cb},${alpha / 255})" stroke-width="2.5"
          stroke-dasharray="${dash}" filter="url(#glow)"/>
        <circle cx="${cx}" cy="${cy}" r="${r * 0.5}" fill="rgba(${sr},${sg},${sb},${alpha / 400})"/>`;
      break;
    }
    case 'transform': {
      const r = 14 + progress * 14;
      svgContent = `
        <defs><filter id="glow"><feGaussianBlur stdDeviation="4"/></filter></defs>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(${cr},${cg},${cb},${alpha / 350})" filter="url(#glow)"/>
        <circle cx="${cx}" cy="${cy}" r="${r * 0.6}" fill="none"
          stroke="rgba(${sr},${sg},${sb},${alpha / 255})" stroke-width="2.5"/>
        <circle cx="${cx}" cy="${cy}" r="${r * 0.2}" fill="rgba(255,255,255,${alpha / 300})"/>`;
      break;
    }
    case 'wisps': {
      const offset = Math.sin(progress * Math.PI) * 6;
      svgContent = `
        <defs><filter id="blur"><feGaussianBlur stdDeviation="2"/></filter></defs>
        <circle cx="${cx - 8}" cy="${cy - offset}" r="5" fill="rgba(${cr},${cg},${cb},${alpha / 255})" filter="url(#blur)"/>
        <circle cx="${cx}" cy="${cy + offset}" r="4" fill="rgba(${sr},${sg},${sb},${alpha / 220})" filter="url(#blur)"/>
        <circle cx="${cx + 8}" cy="${cy - offset * 0.5}" r="5" fill="rgba(${cr},${cg},${cb},${alpha / 255})" filter="url(#blur)"/>`;
      break;
    }
    default: {
      svgContent = `<circle cx="${cx}" cy="${cy}" r="${10 + progress * 10}"
        fill="rgba(${cr},${cg},${cb},${alpha / 255})"/>`;
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="rgba(0,0,0,0)"/>
    ${svgContent}
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function generateSkillIcon(skillId) {
  const visual = SKILL_VISUALS[skillId];
  if (!visual) throw new Error(`No visual def for skill ${skillId}`);

  const w = 32, h = 32;
  const [br, bg, bb] = visual.iconBg;
  const [pr, pg, pb] = visual.theme.primary;
  const [sr, sg, sb] = visual.theme.secondary;
  const cx = w / 2, cy = h / 2;

  let symbol = '';
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
    case 'active':
      symbol = `<circle cx="${cx}" cy="${cy}" r="8" fill="none" stroke="rgba(${sr},${sg},${sb},0.8)" stroke-width="2" stroke-dasharray="3,2"/>
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

export async function generateTierSprites(jobId) {
  const tierDir = join(SPRITE_DIR, String(jobId));
  mkdirSync(tierDir, { recursive: true });

  const prefix = jobId === 600 ? '6001' : jobId === 610 ? '6101' : jobId === 611 ? '6111' : '6121';
  const skills = Object.entries(SKILL_VISUALS).filter(([id]) => String(id).startsWith(prefix));

  const results = [];
  let generated = 0;

  for (const [skillIdStr, visual] of skills) {
    const skillId = Number(skillIdStr);
    const skillDir = join(tierDir, String(skillId));
    mkdirSync(skillDir, { recursive: true });

    const iconBuf = await generateSkillIcon(skillId);
    const iconPath = join(skillDir, 'icon.png');
    writeFileSync(iconPath, iconBuf);
    generated++;

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

    log.info({ skillId, name: visual.name, frames: framePaths.length }, 'Generated Sage skill sprites');
  }

  return { generated, skills: results };
}

export async function generateAllSageSprites() {
  const tiers = [600, 610, 611, 612];
  const allResults = {};
  let totalGenerated = 0;
  const iconsB64 = {};

  for (const tier of tiers) {
    const result = await generateTierSprites(tier);
    allResults[tier] = result;
    totalGenerated += result.generated;

    // Collect base64 icons for WZ packing
    for (const skill of result.skills) {
      const iconBuf = readFileSync(skill.iconPath);
      iconsB64[String(skill.skillId)] = iconBuf.toString('base64');
    }

    log.info({ tier, generated: result.generated }, 'Sage tier sprites complete');
  }

  // Save icon b64 for packing step
  const iconsB64Path = join(SPRITE_DIR, 'icons_b64.json');
  mkdirSync(SPRITE_DIR, { recursive: true });
  writeFileSync(iconsB64Path, JSON.stringify(iconsB64, null, 2), 'utf8');
  log.info({ total: Object.keys(iconsB64).length, path: iconsB64Path }, 'Saved icons_b64.json');

  return { totalGenerated, tiers: allResults, iconsB64Count: Object.keys(iconsB64).length };
}

// ── WZ XML Injection ─────────────────────────────────────────────────────────

export function injectSageEffectXml(jobId) {
  const xmlPath = SKILL_WZ(jobId);
  if (!existsSync(xmlPath)) throw new Error(`Skill WZ not found: ${xmlPath}`);

  let xml = readFileSync(xmlPath, 'utf8');
  const prefix = jobId === 600 ? '6001' : jobId === 610 ? '6101' : jobId === 611 ? '6111' : '6121';
  const skills = Object.entries(SKILL_VISUALS).filter(([id]) => String(id).startsWith(prefix));

  let injected = 0;

  for (const [skillIdStr, visual] of skills) {
    const skillId = skillIdStr;

    if (xml.includes(`<!-- effect:${skillId} -->`) || xml.includes(`<!-- icon:${skillId} -->`)) {
      continue;
    }

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

    const iconXml = `      <!-- icon:${skillId} -->\n      <imgdir name="icon">\n        <canvas name="icon" width="32" height="32">\n          <vector name="origin" x="0" y="32"/>\n        </canvas>\n        <canvas name="iconMouseOver" width="32" height="32">\n          <vector name="origin" x="0" y="32"/>\n        </canvas>\n        <canvas name="iconDisabled" width="32" height="32">\n          <vector name="origin" x="0" y="32"/>\n        </canvas>\n      </imgdir>\n`;

    const skillOpen = `<imgdir name="${skillId}">`;
    const skillIdx = xml.indexOf(skillOpen);
    if (skillIdx === -1) continue;

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

    const insertion = effectXml + iconXml;
    xml = xml.substring(0, closeIdx) + insertion + xml.substring(closeIdx);
    injected++;
  }

  if (injected > 0) {
    writeFileSync(xmlPath, xml, 'utf8');
    log.info({ jobId, injected }, 'Injected effect XML into Sage skill WZ');
  }

  return { jobId, injected };
}

export function injectAllSageEffectXml() {
  const results = [];
  for (const tier of [600, 610, 611, 612]) {
    try {
      results.push(injectSageEffectXml(tier));
    } catch (err) {
      log.error({ tier, err: err.message }, 'Failed to inject Sage effect XML');
      results.push({ jobId: tier, injected: 0, error: err.message });
    }
  }
  return results;
}

// ── Status Report ────────────────────────────────────────────────────────────

export function getSagespriteStatus() {
  const status = { tiers: {}, totalSprites: 0, totalEffectXml: 0 };

  for (const tier of [600, 610, 611, 612]) {
    const prefix = tier === 600 ? '6001' : tier === 610 ? '6101' : tier === 611 ? '6111' : '6121';
    const skills = Object.entries(SKILL_VISUALS).filter(([id]) => String(id).startsWith(prefix));
    const tierStatus = { skills: [], spritesOnDisk: 0, effectXmlPresent: 0 };

    const xmlPath = SKILL_WZ(tier);
    const xmlExists = existsSync(xmlPath);
    const xml = xmlExists ? readFileSync(xmlPath, 'utf8') : '';

    for (const [skillId, visual] of skills) {
      const skillDir = join(SPRITE_DIR, String(tier), skillId);
      const hasIcon = existsSync(join(skillDir, 'icon.png'));
      const hasEffect = visual.frames > 0 ? existsSync(join(skillDir, 'effect_0.png')) : true;
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

const ICONS_B64_PATH = join(process.cwd(), 'workspace', 'maple-sprites', 'sage', 'icons_b64.json');
const V83_IMG_DATA = join(process.cwd(), 'workspace', 'v83-img-data');

const JOB_IMG_SKILLS = {
  '600.img': ['6001000', '6001001', '6001002', '6001003', '6001004', '6001005'],
  '610.img': ['6101000', '6101001', '6101002', '6101003', '6101004', '6101005', '6101006', '6101007'],
  '611.img': ['6111000', '6111001', '6111002', '6111003', '6111004', '6111005', '6111006', '6111007'],
  '612.img': ['6121000', '6121001', '6121002', '6121003', '6121004', '6121005', '6121006', '6121007', '6121008', '6121009'],
};

export async function packSageSpritesToClientWz(callTool) {
  if (!existsSync(ICONS_B64_PATH)) {
    throw new Error(`icons_b64.json not found at ${ICONS_B64_PATH}. Run maple_gen_sage_sprites first.`);
  }

  const icons = JSON.parse(readFileSync(ICONS_B64_PATH, 'utf8'));
  const results = { packed: [], errors: [], imgFiles: 0 };

  await callTool('harepacker-mcp', 'init_data_source', { basePath: V83_IMG_DATA });

  for (const [imgFile, skillIds] of Object.entries(JOB_IMG_SKILLS)) {
    log.info({ imgFile, skillCount: skillIds.length }, 'Packing Sage skill icons into img');
    let imgPacked = 0;

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
        await callTool('harepacker-mcp', 'add_property', {
          category: 'skill',
          image: imgFile,
          parentPath: 'skill',
          name: skillId,
          type: 'SubProperty',
        });

        await callTool('harepacker-mcp', 'import_png', {
          category: 'skill',
          image: imgFile,
          parentPath: `skill/${skillId}`,
          name: 'icon',
          base64Png: iconB64,
          originX: 0,
          originY: 32,
        });

        await callTool('harepacker-mcp', 'import_png', {
          category: 'skill',
          image: imgFile,
          parentPath: `skill/${skillId}`,
          name: 'iconMouseOver',
          base64Png: iconB64,
          originX: 0,
          originY: 32,
        });

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
        log.info({ skillId, imgFile }, 'Sage skill icons packed');
      } catch (err) {
        const msg = `${skillId} in ${imgFile}: ${err.message}`;
        log.error(msg);
        results.errors.push(msg);
      }
    }

    if (imgPacked > 0) {
      try {
        await callTool('harepacker-mcp', 'save_image', { category: 'skill', image: imgFile });
        log.info({ imgFile, imgPacked }, 'Saved Sage img after packing');
        results.imgFiles++;
      } catch (err) {
        log.error({ imgFile, err: err.message }, 'save_image failed');
        results.errors.push(`save ${imgFile}: ${err.message}`);
      }
    }
  }

  log.info({ packed: results.packed.length, errors: results.errors.length }, 'Sage WZ packing complete');
  return results;
}
