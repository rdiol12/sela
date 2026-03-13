/**
 * modules/maplestory/custom-item-icons.js — Icon generator for all custom weapons and items.
 *
 * Generates 32×32 pixel-art inventory icons (icon + iconRaw) for:
 *   - 8 custom weapons (1302134, 1382081, 1452086, 1332100, 1492049, 1442104, 1472101, 1482047)
 *   - 8 custom consumable/etc items (2002031-2002037, 2030021)
 *
 * Each icon is drawn with SVG→sharp: a distinct silhouette + glow appropriate to the item type.
 * Output PNGs saved to workspace/maple-sprites/item-icons/{id}/
 * WZ XML stubs written to:
 *   - wz/Character.wz/Weapon/{fileId}.img.xml  (weapons, injected into info/icon)
 *   - wz/Item.wz/Consume/0{file}.img.xml        (consumables, appended icon nodes)
 *
 * Wired into index.js as: maple_gen_item_icons, maple_item_icon_status, maple_pack_item_icons_wz
 */

import sharp from 'sharp';
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../lib/logger.js';
import { callTool } from '../../lib/mcp-gateway.js';
import { CUSTOM_WEAPONS } from './custom-weapons.js';
import { CUSTOM_ITEMS } from './custom-items.js';
import { BLUEPRINT_JOBS, BLUEPRINT_TIERS } from './blueprint-crafting.js';

const log = createLogger('maplestory:item-icons');

const WZ_DIR     = join(process.cwd(), 'workspace', 'Cosmic', 'wz');
const SPRITE_DIR = join(process.cwd(), 'workspace', 'maple-sprites', 'item-icons');
const CHAR_WZ    = join(WZ_DIR, 'Character.wz', 'Weapon');
const ITEM_WZ    = join(WZ_DIR, 'Item.wz', 'Consume');
const ETC_WZ     = join(WZ_DIR, 'Item.wz', 'Etc');

// ── Icon Visual Definitions ───────────────────────────────────────────────────

/**
 * Visual style for each weapon/item icon.
 * shape: what silhouette to draw
 * bg: background color [r,g,b]
 * primary: main shape color
 * glow: accent/glow color
 * secondary: detail color
 */
const WEAPON_ICONS = {
  1302134: { name: 'Crystal Fang',    shape: 'sword1h',  bg: [20, 30, 60],   primary: [100, 160, 255], glow: [150, 200, 255], secondary: [60, 100, 200] },
  1382081: { name: 'Phoenix Staff',   shape: 'staff',    bg: [60, 20, 10],   primary: [255, 140, 40],  glow: [255, 200, 80],  secondary: [200, 80, 20]  },
  1452086: { name: 'Wind Piercer',    shape: 'bow',      bg: [20, 50, 20],   primary: [80, 200, 80],   glow: [150, 255, 100], secondary: [40, 140, 40]  },
  1332100: { name: 'Shadow Fang',     shape: 'dagger',   bg: [20, 10, 30],   primary: [120, 60, 200],  glow: [180, 100, 255], secondary: [60, 20, 100]  },
  1492049: { name: 'Thunder Barrel',  shape: 'gun',      bg: [30, 30, 10],   primary: [220, 200, 60],  glow: [255, 240, 100], secondary: [140, 120, 20] },
  1442104: { name: 'Earth Cleaver',   shape: 'polearm',  bg: [40, 25, 10],   primary: [160, 100, 40],  glow: [200, 160, 80],  secondary: [100, 60, 20]  },
  1472101: { name: 'Venom Claw',      shape: 'claw',     bg: [10, 40, 10],   primary: [60, 200, 60],   glow: [100, 255, 80],  secondary: [30, 130, 30]  },
  1482047: { name: 'Iron Fist',       shape: 'knuckle',  bg: [30, 30, 35],   primary: [160, 160, 180], glow: [210, 210, 230], secondary: [90, 90, 110]  },
};

const ITEM_ICONS = {
  2002031: { name: 'Elixir of Rage',       shape: 'potion',  bg: [40, 10, 10],  primary: [220, 50, 50],   glow: [255, 100, 80],  secondary: [150, 20, 20] },
  2002032: { name: 'Mana Crystal',         shape: 'crystal', bg: [10, 20, 50],  primary: [80, 120, 255],  glow: [140, 180, 255], secondary: [40, 60, 180] },
  2002033: { name: 'Iron Shield Scroll',   shape: 'potion',  bg: [30, 30, 35],  primary: [160, 160, 180], glow: [200, 200, 220], secondary: [90, 90, 110] },
  2002034: { name: 'Swift Boots Potion',   shape: 'potion',  bg: [10, 40, 10],  primary: [80, 210, 80],   glow: [140, 255, 120], secondary: [30, 140, 30] },
  2002035: { name: 'Lucky Clover',         shape: 'clover',  bg: [10, 35, 10],  primary: [60, 180, 60],   glow: [100, 240, 80],  secondary: [20, 110, 20] },
  2002036: { name: "Giant's Meat",         shape: 'food',    bg: [50, 20, 10],  primary: [200, 100, 60],  glow: [240, 150, 90],  secondary: [140, 50, 20] },
  2002037: { name: 'Sage Tea',             shape: 'cup',     bg: [30, 20, 10],  primary: [160, 120, 60],  glow: [210, 170, 100], secondary: [90, 60, 20]  },
  2030021: { name: 'Return Scroll',        shape: 'scroll',  bg: [40, 30, 10],  primary: [220, 180, 80],  glow: [255, 220, 120], secondary: [140, 100, 20] },
};

// ── Necromancer Quest Items ──────────────────────────────────────────────────
const NECRO_QUEST_ICONS = {
  4032100: { name: 'Crypt Shade Tail',          shape: 'wisp',     bg: [15, 10, 25],  primary: [120, 80, 180],   glow: [180, 120, 255], secondary: [60, 30, 100] },
  4032101: { name: "Mordecai's Referral Letter", shape: 'letter',   bg: [30, 25, 15],  primary: [180, 150, 100],  glow: [220, 190, 140], secondary: [100, 70, 30] },
  4032102: { name: 'Dark Soul Crystal',          shape: 'crystal',  bg: [10, 5, 20],   primary: [80, 40, 160],    glow: [140, 80, 220],  secondary: [40, 15, 80] },
  4032103: { name: 'Soul Fragment of Courage',   shape: 'fragment', bg: [40, 10, 10],  primary: [220, 60, 40],    glow: [255, 120, 80],  secondary: [150, 30, 20] },
  4032104: { name: 'Soul Fragment of Wisdom',    shape: 'fragment', bg: [10, 20, 45],  primary: [60, 120, 220],   glow: [100, 170, 255], secondary: [30, 70, 160] },
  4032105: { name: 'Soul Fragment of Darkness',  shape: 'fragment', bg: [10, 5, 15],   primary: [80, 40, 120],    glow: [140, 80, 200],  secondary: [30, 10, 60] },
};

// ── Crafting Blueprint Icons ────────────────────────────────────────────────
// Warrior (4032200-4032209): red/steel, Mage (4032210-4032219): blue/purple,
// Bowman (4032220-4032229): green/brown, Thief (4032230-4032239): purple/dark
// Color theme per job class — used for blueprint icon generation
const BLUEPRINT_CLASS_STYLES = {
  warrior:     { bg: [35, 15, 10], primary: [200, 80, 50],  glow: [240, 140, 80],  secondary: [140, 50, 20] },
  mage:        { bg: [15, 15, 40], primary: [80, 100, 220], glow: [140, 160, 255], secondary: [40, 50, 140] },
  bowman:      { bg: [15, 30, 10], primary: [80, 160, 60],  glow: [130, 220, 100], secondary: [40, 100, 25] },
  thief:       { bg: [20, 10, 30], primary: [140, 60, 180], glow: [200, 120, 240], secondary: [70, 25, 100] },
  pirate:      { bg: [15, 25, 35], primary: [60, 140, 200], glow: [100, 190, 255], secondary: [30, 80, 130] },
  sage:        { bg: [30, 25, 10], primary: [200, 170, 60], glow: [240, 210, 100], secondary: [130, 100, 20] },
  necromancer: { bg: [15, 8, 20],  primary: [100, 50, 160], glow: [160, 90, 220],  secondary: [50, 20, 80]  },
};

// Build BLUEPRINT_ICONS dynamically from BLUEPRINT_JOBS data
const BLUEPRINT_ICONS = {};
for (const job of BLUEPRINT_JOBS) {
  const style = BLUEPRINT_CLASS_STYLES[job.job] || BLUEPRINT_CLASS_STYLES.mage;
  for (let i = 0; i < 10; i++) {
    const id = job.bpBase + i;
    const tier = i + 1;
    const boost = Math.min(tier * 8, 60);
    BLUEPRINT_ICONS[id] = {
      name: `${job.label} Blueprint T${tier}`,
      shape: 'blueprint',
      bg: style.bg,
      primary: style.primary,
      glow: style.glow.map(c => Math.min(255, c + boost)),
      secondary: style.secondary,
    };
  }
}

// All Etc quest/blueprint items combined
const ETC_ITEM_ICONS = { ...NECRO_QUEST_ICONS, ...BLUEPRINT_ICONS };

// ── SVG Shape Builders ────────────────────────────────────────────────────────

const W = 32, H = 32;

/**
 * Build a 32×32 SVG for the given icon definition.
 */
function buildIconSvg(vis) {
  const { shape, bg, primary: p, glow: g, secondary: s } = vis;
  const [br, bgr, bb] = bg;
  const [pr, pg, pb]  = p;
  const [gr, gg, gb]  = g;
  const [sr, sg, sb]  = s;

  let content = '';

  switch (shape) {
    case 'sword1h': {
      // Diagonal 1H sword: hilt bottom-left, tip top-right
      content = `
        <!-- Glow -->
        <line x1="8" y1="24" x2="24" y2="8" stroke="rgba(${gr},${gg},${gb},0.4)" stroke-width="5"/>
        <!-- Blade -->
        <line x1="8" y1="24" x2="24" y2="8" stroke="rgb(${pr},${pg},${pb})" stroke-width="3"/>
        <!-- Highlight -->
        <line x1="9" y1="22" x2="22" y2="9" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>
        <!-- Cross-guard -->
        <line x1="10" y1="18" x2="18" y2="22" stroke="rgb(${sr},${sg},${sb})" stroke-width="2"/>
        <!-- Hilt -->
        <rect x="6" y="23" width="5" height="3" rx="1" fill="rgb(${sr},${sg},${sb})"/>
        <!-- Tip sparkle -->
        <circle cx="24" cy="8" r="2" fill="rgba(${gr},${gg},${gb},0.9)"/>`;
      break;
    }
    case 'staff': {
      // Vertical staff: glowing orb on top
      content = `
        <!-- Staff shaft -->
        <rect x="15" y="10" width="3" height="18" rx="1" fill="rgb(${sr},${sg},${sb})"/>
        <!-- Orb glow -->
        <circle cx="16" cy="9" r="7" fill="rgba(${gr},${gg},${gb},0.3)"/>
        <!-- Orb -->
        <circle cx="16" cy="9" r="5" fill="rgb(${pr},${pg},${pb})"/>
        <!-- Orb shine -->
        <circle cx="14" cy="7" r="2" fill="rgba(255,255,255,0.5)"/>
        <!-- Tip crystal -->
        <polygon points="16,3 19,7 16,11 13,7" fill="rgba(${gr},${gg},${gb},0.8)"/>`;
      break;
    }
    case 'bow': {
      // Curved bow: arc with string
      content = `
        <!-- Bow glow -->
        <path d="M 10 6 Q 22 16 10 26" stroke="rgba(${gr},${gg},${gb},0.4)" stroke-width="4" fill="none"/>
        <!-- Bow limb -->
        <path d="M 10 6 Q 22 16 10 26" stroke="rgb(${pr},${pg},${pb})" stroke-width="2.5" fill="none"/>
        <!-- Bowstring -->
        <line x1="10" y1="6" x2="10" y2="26" stroke="rgba(${gr},${gg},${gb},0.8)" stroke-width="1"/>
        <!-- Arrow nocked -->
        <line x1="10" y1="16" x2="24" y2="8" stroke="rgb(${sr},${sg},${sb})" stroke-width="1.5"/>
        <!-- Arrow tip -->
        <polygon points="24,8 21,7 22,10" fill="rgb(${gr},${gg},${gb})"/>`;
      break;
    }
    case 'dagger': {
      // Short diagonal dagger: thin blade, narrow
      content = `
        <!-- Glow -->
        <line x1="10" y1="22" x2="22" y2="10" stroke="rgba(${gr},${gg},${gb},0.35)" stroke-width="4"/>
        <!-- Blade -->
        <polygon points="22,10 24,8 20,12" fill="rgb(${gr},${gg},${gb})"/>
        <line x1="12" y1="20" x2="22" y2="10" stroke="rgb(${pr},${pg},${pb})" stroke-width="2"/>
        <!-- Blade highlight -->
        <line x1="13" y1="19" x2="21" y2="11" stroke="rgba(255,255,255,0.4)" stroke-width="1"/>
        <!-- Guard -->
        <line x1="9" y1="19" x2="15" y2="23" stroke="rgb(${sr},${sg},${sb})" stroke-width="2"/>
        <!-- Hilt -->
        <rect x="7" y="21" width="4" height="3" rx="1" fill="rgb(${sr},${sg},${sb})"/>`;
      break;
    }
    case 'gun': {
      // Side-view pistol/gun
      content = `
        <!-- Body glow -->
        <rect x="7" y="12" width="16" height="7" rx="2" fill="rgba(${gr},${gg},${gb},0.3)"/>
        <!-- Main barrel -->
        <rect x="7" y="13" width="18" height="4" rx="1" fill="rgb(${pr},${pg},${pb})"/>
        <!-- Handle -->
        <rect x="9" y="17" width="5" height="8" rx="1" fill="rgb(${sr},${sg},${sb})"/>
        <!-- Barrel highlight -->
        <rect x="8" y="13" width="16" height="1" fill="rgba(255,255,255,0.4)"/>
        <!-- Muzzle flash -->
        <polygon points="25,14 29,15 25,16" fill="rgba(${gr},${gg},${gb},0.9)"/>
        <!-- Trigger guard -->
        <path d="M 12 17 Q 15 22 18 17" stroke="rgb(${sr},${sg},${sb})" stroke-width="1.5" fill="none"/>`;
      break;
    }
    case 'polearm': {
      // Long diagonal polearm / halberd
      content = `
        <!-- Shaft glow -->
        <line x1="6" y1="26" x2="24" y2="8" stroke="rgba(${gr},${gg},${gb},0.3)" stroke-width="5"/>
        <!-- Shaft -->
        <line x1="6" y1="26" x2="24" y2="8" stroke="rgb(${sr},${sg},${sb})" stroke-width="2"/>
        <!-- Blade head -->
        <polygon points="24,8 22,5 27,6 26,10" fill="rgb(${pr},${pg},${pb})"/>
        <!-- Blade highlight -->
        <line x1="23" y1="7" x2="26" y2="9" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>
        <!-- Earth crack detail -->
        <line x1="12" y1="20" x2="16" y2="16" stroke="rgba(${gr},${gg},${gb},0.6)" stroke-width="1.5"/>`;
      break;
    }
    case 'claw': {
      // 3-pronged claw: three parallel curved blades
      content = `
        <!-- Glow -->
        <path d="M 8 24 Q 12 16 14 8" stroke="rgba(${gr},${gg},${gb},0.4)" stroke-width="4" fill="none"/>
        <path d="M 13 24 Q 16 16 16 8" stroke="rgba(${gr},${gg},${gb},0.3)" stroke-width="3" fill="none"/>
        <path d="M 18 24 Q 20 16 22 8" stroke="rgba(${gr},${gg},${gb},0.4)" stroke-width="3" fill="none"/>
        <!-- Three blades -->
        <path d="M 8 24 Q 12 16 14 8" stroke="rgb(${pr},${pg},${pb})" stroke-width="2.5" fill="none"/>
        <path d="M 13 24 Q 16 16 16 8" stroke="rgb(${pr},${pg},${pb})" stroke-width="2" fill="none"/>
        <path d="M 18 24 Q 20 16 22 8" stroke="rgb(${pr},${pg},${pb})" stroke-width="2.5" fill="none"/>
        <!-- Tips sparkle -->
        <circle cx="14" cy="8" r="1.5" fill="rgba(${gr},${gg},${gb},0.9)"/>
        <circle cx="16" cy="8" r="1.5" fill="rgba(${gr},${gg},${gb},0.7)"/>
        <circle cx="22" cy="8" r="1.5" fill="rgba(${gr},${gg},${gb},0.9)"/>
        <!-- Knuckle base -->
        <rect x="7" y="22" width="16" height="4" rx="2" fill="rgb(${sr},${sg},${sb})"/>`;
      break;
    }
    case 'knuckle': {
      // Fist/gauntlet: rounded box with finger knuckles
      content = `
        <!-- Gauntlet glow -->
        <rect x="8" y="12" width="17" height="13" rx="3" fill="rgba(${gr},${gg},${gb},0.25)"/>
        <!-- Main gauntlet -->
        <rect x="9" y="13" width="15" height="11" rx="2" fill="rgb(${pr},${pg},${pb})"/>
        <!-- Knuckle studs -->
        <circle cx="12" cy="14" r="2" fill="rgb(${gr},${gg},${gb})"/>
        <circle cx="17" cy="14" r="2" fill="rgb(${gr},${gg},${gb})"/>
        <circle cx="22" cy="14" r="2" fill="rgb(${gr},${gg},${gb})"/>
        <!-- Wrist guard -->
        <rect x="9" y="21" width="15" height="3" rx="1" fill="rgb(${sr},${sg},${sb})"/>
        <!-- Highlight -->
        <rect x="10" y="14" width="12" height="2" fill="rgba(255,255,255,0.3)"/>`;
      break;
    }
    case 'potion': {
      // Round potion bottle with cork
      content = `
        <!-- Bottle glow -->
        <ellipse cx="16" cy="19" rx="8" ry="9" fill="rgba(${gr},${gg},${gb},0.3)"/>
        <!-- Bottle body -->
        <ellipse cx="16" cy="19" rx="7" ry="8" fill="rgb(${pr},${pg},${pb})"/>
        <!-- Bottle highlight -->
        <ellipse cx="13" cy="16" rx="2.5" ry="3" fill="rgba(255,255,255,0.3)"/>
        <!-- Liquid level -->
        <ellipse cx="16" cy="22" rx="6" ry="2" fill="rgba(${gr},${gg},${gb},0.3)"/>
        <!-- Neck -->
        <rect x="13" y="9" width="6" height="4" rx="1" fill="rgb(${sr},${sg},${sb})"/>
        <!-- Cork -->
        <rect x="13" y="6" width="6" height="4" rx="1" fill="rgb(160,120,70)"/>`;
      break;
    }
    case 'crystal': {
      // Diamond/gem crystal shape
      content = `
        <!-- Crystal glow -->
        <polygon points="16,4 24,14 16,28 8,14" fill="rgba(${gr},${gg},${gb},0.3)"/>
        <!-- Crystal body -->
        <polygon points="16,5 23,15 16,27 9,15" fill="rgb(${pr},${pg},${pb})"/>
        <!-- Top face -->
        <polygon points="16,5 23,15 16,15 9,15" fill="rgba(255,255,255,0.2)"/>
        <!-- Shine line -->
        <line x1="12" y1="9" x2="14" y2="16" stroke="rgba(255,255,255,0.5)" stroke-width="1.5"/>
        <!-- Facet lines -->
        <line x1="9" y1="15" x2="16" y2="27" stroke="rgba(${sr},${sg},${sb},0.5)" stroke-width="1"/>
        <line x1="23" y1="15" x2="16" y2="27" stroke="rgba(${sr},${sg},${sb},0.5)" stroke-width="1"/>`;
      break;
    }
    case 'clover': {
      // 4-leaf clover: 4 circles in a cross + stem
      content = `
        <!-- Leaf glow -->
        <circle cx="16" cy="12" r="7" fill="rgba(${gr},${gg},${gb},0.25)"/>
        <!-- Four leaves -->
        <circle cx="12" cy="13" r="5" fill="rgb(${pr},${pg},${pb})"/>
        <circle cx="20" cy="13" r="5" fill="rgb(${pr},${pg},${pb})"/>
        <circle cx="16" cy="9"  r="5" fill="rgb(${pr},${pg},${pb})"/>
        <circle cx="16" cy="17" r="5" fill="rgb(${pr},${pg},${pb})"/>
        <!-- Leaf highlights -->
        <circle cx="11" cy="12" r="1.5" fill="rgba(255,255,255,0.3)"/>
        <circle cx="15" cy="8"  r="1.5" fill="rgba(255,255,255,0.3)"/>
        <!-- Stem -->
        <path d="M 16 22 Q 18 26 16 29" stroke="rgb(${sr},${sg},${sb})" stroke-width="2" fill="none"/>`;
      break;
    }
    case 'food': {
      // Meat on bone: drumstick shape
      content = `
        <!-- Meat glow -->
        <ellipse cx="16" cy="17" rx="10" ry="8" fill="rgba(${gr},${gg},${gb},0.3)"/>
        <!-- Meat body -->
        <ellipse cx="16" cy="17" rx="9" ry="7" fill="rgb(${pr},${pg},${pb})"/>
        <!-- Brown shading -->
        <ellipse cx="16" cy="19" rx="7" ry="5" fill="rgba(${sr},${sg},${sb},0.5)"/>
        <!-- Bone handle -->
        <rect x="13" y="22" width="6" height="7" rx="3" fill="rgb(220,200,170)"/>
        <!-- Bone tip -->
        <circle cx="16" cy="29" r="3" fill="rgb(220,200,170)"/>
        <!-- Highlight -->
        <ellipse cx="12" cy="14" rx="3" ry="2" fill="rgba(255,255,255,0.3)"/>`;
      break;
    }
    case 'cup': {
      // Tea cup with steam wisps
      content = `
        <!-- Cup glow -->
        <ellipse cx="16" cy="22" rx="9" ry="6" fill="rgba(${gr},${gg},${gb},0.25)"/>
        <!-- Cup body -->
        <path d="M 8 18 L 7 28 L 25 28 L 24 18 Z" fill="rgb(${pr},${pg},${pb})"/>
        <!-- Tea surface -->
        <ellipse cx="16" cy="18" rx="8" ry="3" fill="rgb(${gr},${gg},${gb})"/>
        <!-- Handle -->
        <path d="M 24 20 Q 29 22 24 25" stroke="rgb(${sr},${sg},${sb})" stroke-width="2.5" fill="none"/>
        <!-- Steam -->
        <path d="M 12 15 Q 11 11 13 8" stroke="rgba(255,255,255,0.4)" stroke-width="1.5" fill="none"/>
        <path d="M 16 14 Q 15 10 17 7" stroke="rgba(255,255,255,0.4)" stroke-width="1.5" fill="none"/>
        <path d="M 20 15 Q 19 11 21 8" stroke="rgba(255,255,255,0.4)" stroke-width="1.5" fill="none"/>
        <!-- Cup highlight -->
        <line x1="10" y1="20" x2="10" y2="27" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>`;
      break;
    }
    case 'scroll': {
      // Magic scroll: rolled parchment with rune circle
      content = `
        <!-- Scroll glow -->
        <rect x="8" y="10" width="16" height="12" rx="2" fill="rgba(${gr},${gg},${gb},0.3)"/>
        <!-- Parchment body -->
        <rect x="9" y="11" width="14" height="10" rx="1" fill="rgb(220, 200, 150)"/>
        <!-- Rune circle -->
        <circle cx="16" cy="16" r="4" fill="none" stroke="rgb(${pr},${pg},${pb})" stroke-width="1.5"/>
        <circle cx="16" cy="16" r="2" fill="rgba(${gr},${gg},${gb},0.7)"/>
        <!-- Rune spokes -->
        <line x1="16" y1="12" x2="16" y2="20" stroke="rgba(${pr},${pg},${pb},0.5)" stroke-width="1"/>
        <line x1="12" y1="16" x2="20" y2="16" stroke="rgba(${pr},${pg},${pb},0.5)" stroke-width="1"/>
        <!-- Scroll rolls -->
        <ellipse cx="16" cy="11" rx="7" ry="2" fill="rgb(${sr},${sg},${sb})"/>
        <ellipse cx="16" cy="21" rx="7" ry="2" fill="rgb(${sr},${sg},${sb})"/>
        <!-- End rolls -->
        <ellipse cx="8" cy="11" rx="2" ry="7" fill="rgb(${sr},${sg},${sb})"/>
        <ellipse cx="24" cy="11" rx="2" ry="7" fill="rgb(${sr},${sg},${sb})"/>`;
      break;
    }
    case 'wisp': {
      // Ghostly wisp / tail: swirling smoke trail
      content = `
        <!-- Wisp glow -->
        <ellipse cx="16" cy="14" rx="9" ry="10" fill="rgba(${gr},${gg},${gb},0.2)"/>
        <!-- Main wisp body -->
        <path d="M 16 6 Q 24 12 20 18 Q 16 24 12 18 Q 8 12 16 6" fill="rgb(${pr},${pg},${pb})"/>
        <!-- Inner glow -->
        <path d="M 16 8 Q 21 12 18 16 Q 16 20 14 16 Q 11 12 16 8" fill="rgba(${gr},${gg},${gb},0.6)"/>
        <!-- Tail wisps -->
        <path d="M 14 18 Q 10 24 8 28" stroke="rgba(${pr},${pg},${pb},0.6)" stroke-width="2" fill="none"/>
        <path d="M 18 18 Q 22 24 24 28" stroke="rgba(${pr},${pg},${pb},0.4)" stroke-width="1.5" fill="none"/>
        <!-- Core sparkle -->
        <circle cx="16" cy="12" r="2" fill="rgba(255,255,255,0.6)"/>`;
      break;
    }
    case 'letter': {
      // Sealed letter / envelope
      content = `
        <!-- Letter glow -->
        <rect x="6" y="10" width="20" height="14" rx="2" fill="rgba(${gr},${gg},${gb},0.3)"/>
        <!-- Envelope body -->
        <rect x="7" y="11" width="18" height="12" rx="1" fill="rgb(${pr},${pg},${pb})"/>
        <!-- Flap -->
        <polygon points="7,11 16,18 25,11" fill="rgba(${sr},${sg},${sb},0.8)"/>
        <!-- Seal -->
        <circle cx="16" cy="18" r="3" fill="rgb(180,40,40)"/>
        <!-- Seal detail -->
        <circle cx="16" cy="18" r="1.5" fill="rgb(220,80,60)"/>
        <!-- Paper edge highlight -->
        <line x1="8" y1="22" x2="24" y2="22" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>`;
      break;
    }
    case 'fragment': {
      // Soul fragment: irregular shard with inner glow
      content = `
        <!-- Fragment glow -->
        <polygon points="16,4 22,10 24,18 18,26 10,24 8,14" fill="rgba(${gr},${gg},${gb},0.3)"/>
        <!-- Fragment body -->
        <polygon points="16,5 21,11 23,17 17,25 11,23 9,14" fill="rgb(${pr},${pg},${pb})"/>
        <!-- Inner facet (lighter) -->
        <polygon points="16,7 20,12 18,20 13,18 12,13" fill="rgba(${gr},${gg},${gb},0.5)"/>
        <!-- Core glow -->
        <circle cx="16" cy="15" r="3" fill="rgba(${gr},${gg},${gb},0.8)"/>
        <!-- Shine -->
        <line x1="13" y1="10" x2="15" y2="14" stroke="rgba(255,255,255,0.5)" stroke-width="1.5"/>
        <!-- Fracture lines -->
        <line x1="16" y1="5" x2="16" y2="15" stroke="rgba(${sr},${sg},${sb},0.4)" stroke-width="0.8"/>
        <line x1="9" y1="14" x2="16" y2="15" stroke="rgba(${sr},${sg},${sb},0.3)" stroke-width="0.8"/>`;
      break;
    }
    case 'blueprint': {
      // Crafting blueprint: rolled paper with weapon sketch
      content = `
        <!-- Blueprint glow -->
        <rect x="7" y="8" width="18" height="16" rx="2" fill="rgba(${gr},${gg},${gb},0.25)"/>
        <!-- Paper body (blue-tinted parchment) -->
        <rect x="8" y="9" width="16" height="14" rx="1" fill="rgb(30,45,80)"/>
        <!-- Grid lines -->
        <line x1="10" y1="12" x2="22" y2="12" stroke="rgba(100,140,200,0.3)" stroke-width="0.5"/>
        <line x1="10" y1="16" x2="22" y2="16" stroke="rgba(100,140,200,0.3)" stroke-width="0.5"/>
        <line x1="10" y1="20" x2="22" y2="20" stroke="rgba(100,140,200,0.3)" stroke-width="0.5"/>
        <line x1="12" y1="10" x2="12" y2="22" stroke="rgba(100,140,200,0.3)" stroke-width="0.5"/>
        <line x1="16" y1="10" x2="16" y2="22" stroke="rgba(100,140,200,0.3)" stroke-width="0.5"/>
        <line x1="20" y1="10" x2="20" y2="22" stroke="rgba(100,140,200,0.3)" stroke-width="0.5"/>
        <!-- Weapon sketch (diagonal line) -->
        <line x1="11" y1="19" x2="21" y2="13" stroke="rgb(${pr},${pg},${pb})" stroke-width="1.5"/>
        <!-- Cross guard sketch -->
        <line x1="14" y1="15" x2="18" y2="18" stroke="rgb(${pr},${pg},${pb})" stroke-width="1"/>
        <!-- Blueprint border -->
        <rect x="8" y="9" width="16" height="14" rx="1" fill="none" stroke="rgb(${gr},${gg},${gb})" stroke-width="1"/>
        <!-- Roll edges -->
        <ellipse cx="8" cy="16" rx="1.5" ry="7" fill="rgb(${sr},${sg},${sb})"/>
        <ellipse cx="24" cy="16" rx="1.5" ry="7" fill="rgb(${sr},${sg},${sb})"/>`;
      break;
    }
    default: {
      content = `<circle cx="16" cy="16" r="12" fill="rgb(${pr},${pg},${pb})"/>`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <!-- Background -->
    <rect x="1" y="1" width="30" height="30" rx="4"
      fill="rgb(${br},${bgr},${bb})" stroke="rgba(${gr},${gg},${gb},0.5)" stroke-width="1"/>
    ${content}
  </svg>`;
}

// ── PNG Generation ────────────────────────────────────────────────────────────

/**
 * Generate icon PNG for one weapon/item ID and save to sprite dir.
 * Returns { iconPath, iconRawPath }
 */
async function generateIcon(id, vis) {
  const itemDir = join(SPRITE_DIR, String(id));
  mkdirSync(itemDir, { recursive: true });

  const svg = buildIconSvg(vis);
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();

  const iconPath    = join(itemDir, 'icon.png');
  const iconRawPath = join(itemDir, 'iconRaw.png');
  writeFileSync(iconPath, buf);
  writeFileSync(iconRawPath, buf); // iconRaw is the same 32×32 in v83
  return { iconPath, iconRawPath };
}

// ── WZ XML Injection ──────────────────────────────────────────────────────────

/**
 * Inject icon canvas entries into a weapon's Character.wz XML.
 * The weapon XML already has an <info> imgdir; we add icon/iconRaw canvas nodes.
 */
function injectWeaponIconXml(weapon, iconPath) {
  const xmlPath = join(CHAR_WZ, `${weapon.fileId}.img.xml`);
  if (!existsSync(xmlPath)) {
    log.warn({ id: weapon.id, xmlPath }, 'Weapon XML not found — skipping icon injection');
    return false;
  }

  let xml = readFileSync(xmlPath, 'utf8');

  // Skip if already injected
  if (xml.includes('name="icon"')) return true;

  const spritePath = `../../../../maple-sprites/item-icons/${weapon.id}/icon.png`;
  const iconXml = `
    <canvas name="icon" width="${W}" height="${H}" basedata="${spritePath}"/>
    <canvas name="iconRaw" width="${W}" height="${H}" basedata="${spritePath}"/>`;

  // Insert before closing </imgdir> of <info> block
  xml = xml.replace(
    /(<imgdir name="info">[\s\S]*?)(<\/imgdir>)/,
    `$1${iconXml}\n  $2`,
  );
  writeFileSync(xmlPath, xml, 'utf8');
  log.info({ id: weapon.id }, 'Injected icon XML into weapon WZ');
  return true;
}

/**
 * Inject icon canvas entries into a consumable item's Item.wz XML.
 */
function injectItemIconXml(item, iconPath) {
  const xmlPath = join(ITEM_WZ, `0${item.consumeFile}.img.xml`);
  if (!existsSync(xmlPath)) {
    log.warn({ id: item.id, xmlPath }, 'Item WZ XML not found — skipping icon injection');
    return false;
  }

  let xml = readFileSync(xmlPath, 'utf8');
  const idStr = String(item.id);
  const spritePath = `../../../../maple-sprites/item-icons/${item.id}/icon.png`;

  // Look for this item's <imgdir name="{id}"> block and add icon to its info section
  const itemBlockRe = new RegExp(
    `(<imgdir name="${idStr}">(?:[\\s\\S]*?))(<\\/imgdir>)`,
  );

  if (!xml.includes(`name="${idStr}"`)) {
    log.warn({ id: item.id }, 'Item ID not found in WZ XML — skipping icon injection');
    return false;
  }

  // Already has icon?
  const itemBlock = xml.match(itemBlockRe);
  if (itemBlock && itemBlock[0].includes('name="icon"')) return true;

  // Find info sub-block in this item and inject
  xml = xml.replace(
    new RegExp(`(<imgdir name="${idStr}">[\\s\\S]*?<imgdir name="info">[\\s\\S]*?)(<\\/imgdir>)`),
    `$1\n    <canvas name="icon" width="${W}" height="${H}" basedata="${spritePath}"/>` +
    `\n    <canvas name="iconRaw" width="${W}" height="${H}" basedata="${spritePath}"/>\n  $2`,
  );
  writeFileSync(xmlPath, xml, 'utf8');
  log.info({ id: item.id }, 'Injected icon XML into item WZ');
  return true;
}

/**
 * Inject icon canvas entries into an Etc.wz quest/blueprint item XML.
 */
function injectEtcItemIconXml(id) {
  const xmlPath = join(ETC_WZ, `${id}.img.xml`);
  if (!existsSync(xmlPath)) {
    log.warn({ id, xmlPath }, 'Etc item XML not found — skipping icon injection');
    return false;
  }

  let xml = readFileSync(xmlPath, 'utf8');

  // Skip if already injected
  if (xml.includes('name="icon"')) return true;

  const spritePath = `../../../../maple-sprites/item-icons/${id}/icon.png`;
  const iconXml = `\n    <canvas name="icon" width="${W}" height="${H}" basedata="${spritePath}"/>` +
                  `\n    <canvas name="iconRaw" width="${W}" height="${H}" basedata="${spritePath}"/>`;

  // Insert before closing </imgdir> of <info> block
  xml = xml.replace(
    /(<imgdir name="info">[\s\S]*?)(<\/imgdir>)/,
    `$1${iconXml}\n  $2`,
  );
  writeFileSync(xmlPath, xml, 'utf8');
  log.info({ id }, 'Injected icon XML into Etc item WZ');
  return true;
}

// ── harepacker-mcp Pack ───────────────────────────────────────────────────────

/**
 * Use harepacker-mcp to inject icon PNGs into the v83 client Character.wz.
 */
async function packWeaponIconsToClientWz(weaponId, fileId) {
  const iconPath = join(SPRITE_DIR, String(weaponId), 'icon.png');
  if (!existsSync(iconPath)) return { status: 'sprites_not_generated' };

  const CLIENT_CHAR_WZ = join(process.cwd(), 'workspace', 'v83-client', '83', 'Character.wz');
  const results = [];

  for (const slot of ['icon', 'iconRaw']) {
    try {
      await callTool('harepacker-mcp', 'init_data_source', { dataPath: CLIENT_CHAR_WZ });
      await callTool('harepacker-mcp', 'import_png', {
        imagePath: iconPath,
        wzPath: `Weapon/${fileId}.img/info/${slot}`,
      });
      results.push({ slot, status: 'packed' });
    } catch (err) {
      results.push({ slot, status: 'error', error: err.message });
      log.warn({ weaponId, slot, err: err.message }, 'harepacker pack failed');
    }
  }
  return results;
}

/**
 * Use harepacker-mcp to inject icon PNGs into the v83 client Item.wz.
 */
async function packItemIconToClientWz(itemId, consumeFile) {
  const iconPath = join(SPRITE_DIR, String(itemId), 'icon.png');
  if (!existsSync(iconPath)) return { status: 'sprites_not_generated' };

  const CLIENT_ITEM_WZ = join(process.cwd(), 'workspace', 'v83-client', '83', 'Item.wz');
  const results = [];

  for (const slot of ['icon', 'iconRaw']) {
    try {
      await callTool('harepacker-mcp', 'init_data_source', { dataPath: CLIENT_ITEM_WZ });
      await callTool('harepacker-mcp', 'import_png', {
        imagePath: iconPath,
        wzPath: `Consume/0${consumeFile}.img/${itemId}/info/${slot}`,
      });
      results.push({ slot, status: 'packed' });
    } catch (err) {
      results.push({ slot, status: 'error', error: err.message });
      log.warn({ itemId, slot, err: err.message }, 'harepacker pack failed');
    }
  }
  return results;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate icons for ALL 8 custom weapons + 8 custom items.
 * Saves PNGs and injects XML into WZ files.
 */
export async function generateAllItemIcons() {
  mkdirSync(SPRITE_DIR, { recursive: true });

  const results = { weapons: [], items: [] };
  let generated = 0;

  // Weapons
  for (const weapon of CUSTOM_WEAPONS) {
    const vis = WEAPON_ICONS[weapon.id];
    if (!vis) { results.weapons.push({ id: weapon.id, status: 'no_visual_def' }); continue; }
    try {
      const paths  = await generateIcon(weapon.id, vis);
      const xmlOk  = injectWeaponIconXml(weapon, paths.iconPath);
      results.weapons.push({ id: weapon.id, name: weapon.name, status: 'generated', xmlInjected: xmlOk });
      generated += 2;
      log.info({ id: weapon.id, name: weapon.name }, 'Weapon icon generated');
    } catch (err) {
      results.weapons.push({ id: weapon.id, name: weapon.name, status: 'error', error: err.message });
      log.error({ id: weapon.id, err: err.message }, 'Weapon icon generation failed');
    }
  }

  // Items — build lookup from id to consumeFile
  const itemConsumeLookup = {};
  for (const item of CUSTOM_ITEMS) {
    itemConsumeLookup[item.id] = item.consumeFile;
  }

  for (const item of CUSTOM_ITEMS) {
    const vis = ITEM_ICONS[item.id];
    if (!vis) { results.items.push({ id: item.id, status: 'no_visual_def' }); continue; }
    try {
      const paths  = await generateIcon(item.id, vis);
      const xmlOk  = injectItemIconXml(item, paths.iconPath);
      results.items.push({ id: item.id, name: item.name, status: 'generated', xmlInjected: xmlOk });
      generated += 2;
      log.info({ id: item.id, name: item.name }, 'Item icon generated');
    } catch (err) {
      results.items.push({ id: item.id, name: item.name, status: 'error', error: err.message });
      log.error({ id: item.id, err: err.message }, 'Item icon generation failed');
    }
  }

  // Etc quest/blueprint items
  for (const [idStr, vis] of Object.entries(ETC_ITEM_ICONS)) {
    const id = Number(idStr);
    try {
      const paths = await generateIcon(id, vis);
      const xmlOk = injectEtcItemIconXml(id);
      results.etc = results.etc || [];
      results.etc.push({ id, name: vis.name, status: 'generated', xmlInjected: xmlOk });
      generated += 2;
      log.info({ id, name: vis.name }, 'Etc item icon generated');
    } catch (err) {
      results.etc = results.etc || [];
      results.etc.push({ id, name: vis.name, status: 'error', error: err.message });
      log.error({ id, err: err.message }, 'Etc item icon generation failed');
    }
  }

  log.info({ generated }, 'All custom item icons generated');
  return { generated, ...results };
}

/**
 * Pack all generated icons into v83 client Character.wz + Item.wz via harepacker-mcp.
 */
export async function packAllItemIconsToWz() {
  const results = { weapons: [], items: [] };

  for (const weapon of CUSTOM_WEAPONS) {
    const iconPath = join(SPRITE_DIR, String(weapon.id), 'icon.png');
    if (!existsSync(iconPath)) {
      results.weapons.push({ id: weapon.id, status: 'sprites_not_generated' });
      continue;
    }
    const packResult = await packWeaponIconsToClientWz(weapon.id, weapon.fileId);
    results.weapons.push({ id: weapon.id, name: weapon.name, slots: packResult });
  }

  for (const item of CUSTOM_ITEMS) {
    const iconPath = join(SPRITE_DIR, String(item.id), 'icon.png');
    if (!existsSync(iconPath)) {
      results.items.push({ id: item.id, status: 'sprites_not_generated' });
      continue;
    }
    const packResult = await packItemIconToClientWz(item.id, item.consumeFile);
    results.items.push({ id: item.id, name: item.name, slots: packResult });
  }

  return results;
}

/**
 * Status check: which weapon/item icons have been generated.
 */
export function getItemIconStatus() {
  const weaponStatus = CUSTOM_WEAPONS.map(w => ({
    id:       w.id,
    name:     w.name,
    type:     'weapon',
    hasIcon:  existsSync(join(SPRITE_DIR, String(w.id), 'icon.png')),
    shape:    WEAPON_ICONS[w.id]?.shape,
  }));

  const itemStatus = CUSTOM_ITEMS.map(i => ({
    id:       i.id,
    name:     i.name,
    type:     'item',
    hasIcon:  existsSync(join(SPRITE_DIR, String(i.id), 'icon.png')),
    shape:    ITEM_ICONS[i.id]?.shape,
  }));

  const etcStatus = Object.entries(ETC_ITEM_ICONS).map(([idStr, vis]) => ({
    id:       Number(idStr),
    name:     vis.name,
    type:     vis.shape === 'blueprint' ? 'blueprint' : 'quest_item',
    hasIcon:  existsSync(join(SPRITE_DIR, idStr, 'icon.png')),
    shape:    vis.shape,
  }));

  const allItems = [...weaponStatus, ...itemStatus, ...etcStatus];
  const done = allItems.filter(x => x.hasIcon).length;

  return {
    weapons:  weaponStatus,
    items:    itemStatus,
    etc:      etcStatus,
    summary:  `${done}/${allItems.length} icons generated`,
  };
}
