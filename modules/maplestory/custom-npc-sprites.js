/**
 * modules/maplestory/custom-npc-sprites.js — Pixel-art NPC sprite generator for all custom NPCs.
 *
 * Generates programmatic stand-animation sprites (2 frames) using SVG→sharp for each
 * of the 11 custom NPCs (9999001-9999010, 9999030), then writes per-NPC Npc.wz XML stubs
 * and calls harepacker-mcp to inject bitmaps into the binary v83-client Npc.wz.
 *
 * Each NPC gets:
 *   - 2-frame stand animation (idle breath cycle), 80×100px
 *   - 32×32 portrait icon (used in dialogue UI)
 *   - Npc.wz XML stub at wz/Npc.wz/{npcId}.img.xml
 *
 * Wired into index.js as: maple_gen_custom_npc_sprites, maple_custom_npc_sprite_status,
 *                          maple_pack_custom_npc_wz
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../lib/logger.js';
import { callTool } from '../../lib/mcp-gateway.js';

const log = createLogger('maplestory:custom-npc-sprites');

const WZ_DIR     = join(process.cwd(), 'workspace', 'Cosmic', 'wz');
const SPRITE_DIR = join(process.cwd(), 'workspace', 'maple-sprites', 'custom-npcs');
const NPC_WZ_DIR = join(WZ_DIR, 'Npc.wz');
const NPC_WZ     = (npcId) => join(NPC_WZ_DIR, `${npcId}.img.xml`);

// ── NPC Visual Definitions ────────────────────────────────────────────────────
// Each entry defines how the NPC looks: role archetype → color palette + body shape.

export const NPC_VISUALS = {
  9999001: {
    name: 'Blacksmith Taro',
    role: 'blacksmith',
    desc: 'Stocky blacksmith in leather apron, hammer at side',
    body:   [120, 80, 40],   // warm brown leather
    hair:   [60, 40, 20],    // dark brown
    skin:   [200, 160, 120], // tanned
    accent: [180, 60, 20],   // forge-orange apron stripe
    hat:    null,
    size:   'large',         // wider shoulders
  },
  9999002: {
    name: 'Alchemist Luna',
    role: 'mage',
    desc: 'Slender mage in flowing purple robes with glowing vials',
    body:   [100, 60, 180],  // deep purple robe
    hair:   [200, 180, 255], // silver-lavender
    skin:   [230, 200, 180], // fair
    accent: [80, 200, 200],  // teal alchemist trim
    hat:    [80, 50, 140],   // tall witch hat
    size:   'slim',
  },
  9999003: {
    name: 'Scout Raven',
    role: 'ranger',
    desc: 'Lean ranger in dark green cloak with a hood',
    body:   [40, 80, 40],    // forest green
    hair:   [30, 20, 10],    // near-black
    skin:   [180, 140, 110], // olive
    accent: [100, 60, 20],   // leather brown belt
    hat:    [30, 60, 30],    // dark green hood
    size:   'slim',
  },
  9999004: {
    name: 'Chef Momo',
    role: 'chef',
    desc: 'Round jolly chef in white coat with a tall toque',
    body:   [240, 240, 240], // white chef coat
    hair:   [60, 30, 10],    // dark auburn
    skin:   [220, 180, 140], // warm medium
    accent: [200, 60, 60],   // red neckerchief
    hat:    [255, 255, 255], // tall white toque
    size:   'large',
  },
  9999005: {
    name: 'Old Man Kazuki',
    role: 'elder',
    desc: 'Elderly wise man in grey travel robes with a walking staff',
    body:   [160, 160, 150], // grey robe
    hair:   [220, 220, 220], // white hair
    skin:   [200, 160, 130], // weathered
    accent: [100, 140, 180], // blue sash
    hat:    null,
    size:   'slim',
  },
  9999006: {
    name: 'Arena Master Rex',
    role: 'warrior',
    desc: 'Broad-shouldered arena trainer in red and gold armor',
    body:   [180, 30, 30],   // crimson armor plate
    hair:   [80, 50, 20],    // brown
    skin:   [190, 150, 110], // tan
    accent: [200, 160, 40],  // gold trim
    hat:    null,
    size:   'large',
  },
  9999007: {
    name: 'Gem Trader Safi',
    role: 'merchant',
    desc: 'Elegant gem merchant in teal silk with jeweled accessories',
    body:   [20, 140, 140],  // teal merchant coat
    hair:   [180, 100, 20],  // amber/copper
    skin:   [210, 170, 130], // golden-tan
    accent: [180, 60, 160],  // purple gem accent
    hat:    [15, 110, 110],  // teal brimmed hat
    size:   'slim',
  },
  9999008: {
    name: 'Captain Flint',
    role: 'captain',
    desc: 'Weather-beaten sea captain in navy coat with tricorn hat',
    body:   [30, 50, 100],   // navy captain coat
    hair:   [60, 40, 20],    // weathered brown
    skin:   [180, 140, 100], // sun-roughened
    accent: [180, 140, 40],  // gold buttons/epaulettes
    hat:    [20, 30, 70],    // dark navy tricorn
    size:   'large',
  },
  9999009: {
    name: 'Nurse Joy',
    role: 'healer',
    desc: 'Kind nurse in white uniform with pink accents and a red cross cap',
    body:   [240, 240, 255], // white uniform
    hair:   [220, 100, 140], // pink hair
    skin:   [235, 200, 180], // fair rosy
    accent: [220, 60, 80],   // red cross accent
    hat:    [255, 255, 255], // white nurse cap
    size:   'slim',
  },
  9999010: {
    name: 'Treasure Hunter Kai',
    role: 'adventurer',
    desc: 'Energetic adventurer in dusty tan gear with a wide-brim explorer hat',
    body:   [160, 120, 60],  // khaki adventurer jacket
    hair:   [80, 50, 20],    // chestnut brown
    skin:   [200, 160, 120], // lightly tanned
    accent: [60, 100, 180],  // blue pack strap
    hat:    [140, 100, 40],  // wide-brim explorer hat
    size:   'slim',
  },
  9999030: {
    name: 'Sage Instructor Elara',
    role: 'sage',
    desc: 'Radiant sage instructor in flowing blue and gold elemental robes',
    body:   [40, 80, 200],   // royal blue robe
    hair:   [200, 220, 255], // pale silver-blue
    skin:   [220, 200, 180], // fair
    accent: [200, 160, 40],  // gold arcane trim
    hat:    [30, 60, 160],   // tall arcane hood
    size:   'slim',
  },

  // ── Necromancer Job Advancement NPCs ────────────────────────────────────────

  9990010: {
    name: 'Mordecai the Gravedigger',
    role: 'gravedigger',
    desc: 'Grizzled undead-touched gravedigger with worn burial robes and a shovel',
    body:   [60, 50, 40],    // earth-stained brown burial robe
    hair:   [40, 30, 20],    // matted dark brown
    skin:   [160, 130, 100], // ashen, sunken
    accent: [120, 100, 60],  // dirt-stained bandages
    hat:    null,
    size:   'large',
  },
  9990011: {
    name: 'Lady Vesper',
    role: 'deathdisciple',
    desc: 'Shadowy female necromancer disciple in dark violet robes with a bone necklace',
    body:   [60, 20, 80],    // deep violet robe
    hair:   [30, 10, 50],    // near-black purple
    skin:   [200, 180, 190], // pale with violet tinge
    accent: [180, 140, 200], // bone-white violet trim
    hat:    [40, 10, 60],    // dark cowl/hood
    size:   'slim',
  },
  9990012: {
    name: 'The Bone Oracle',
    role: 'boneoracle',
    desc: 'Ancient skeletal oracle draped in tattered death robes, glowing eye sockets',
    body:   [80, 70, 60],    // pale ash-grey death robe
    hair:   [200, 200, 180], // bone white (skull wisps)
    skin:   [180, 170, 150], // bone-pale grey
    accent: [100, 200, 120], // spectral green glow
    hat:    null,
    size:   'slim',
  },
  9990013: {
    name: "Kael'Mortis the Eternal",
    role: 'lichking',
    desc: 'Towering ancient lich king in obsidian armor with a spectral crown and void glow',
    body:   [20, 10, 30],    // obsidian black void armor
    hair:   [120, 60, 200],  // spectral purple aura hair
    skin:   [150, 140, 130], // undead bone-grey
    accent: [80, 200, 255],  // ice-blue void energy
    hat:    [10, 5, 20],     // spectral crown/helm
    size:   'large',
  },
  9990014: {
    name: 'Grizelda the Bone Merchant',
    role: 'bonemerchant',
    desc: 'Cheerful undead merchant in patchy purple coat adorned with bone trinkets',
    body:   [100, 60, 120],  // patchy purple merchant coat
    hair:   [180, 100, 180], // faded mauve
    skin:   [190, 175, 160], // pallid undead tint
    accent: [220, 200, 180], // bone-white trinket accent
    hat:    [80, 45, 100],   // tilted purple merchant hat
    size:   'slim',
  },

  // ── Dungeon Entrance NPCs ───────────────────────────────────────────────────

  9999020: {
    name: 'Frost Warden Kira',
    role: 'frostwarden',
    desc: 'Ice-armored warden guarding the Frozen Caverns entrance, frost crystals on armor',
    body:   [140, 200, 240], // pale ice-blue armor plate
    hair:   [200, 230, 255], // silver-white frosted
    skin:   [210, 230, 245], // cool blue-tinted fair
    accent: [80, 160, 220],  // deep ice-blue crystal trim
    hat:    [100, 180, 230], // frost-shard helmet crest
    size:   'large',
  },
  9999021: {
    name: 'Crypt Warden Moros',
    role: 'cryptwarden',
    desc: 'Forboding dark stone-armored gatekeeper of the Shadow Crypts, wreathed in shadow',
    body:   [40, 35, 50],    // dark granite-grey armor
    hair:   [20, 15, 30],    // shadow-dark
    skin:   [130, 120, 110], // stone-grey toned
    accent: [160, 80, 200],  // shadow-purple rune glow
    hat:    [30, 25, 40],    // dark spiked warden helm
    size:   'large',
  },

  // ── Blueprint Craftsmith NPCs ───────────────────────────────────────────────

  9999032: {
    name: 'Garvan the Ironsmith',
    role: 'ironsmith',
    desc: 'Massive warrior-class blacksmith in heat-scorched iron plate with forge tongs',
    body:   [90, 90, 100],   // dark iron plate
    hair:   [50, 40, 30],    // charcoal brown
    skin:   [190, 150, 110], // heat-reddened tan
    accent: [200, 100, 30],  // forge-fire orange glow
    hat:    null,
    size:   'large',
  },
  9999033: {
    name: 'Sera the Arcanist',
    role: 'arcanist',
    desc: 'Slender mage artisan in shimmering blue-silver robes with etched arcane blueprints',
    body:   [60, 100, 180],  // blue-silver enchanter robe
    hair:   [180, 200, 240], // ice-silver
    skin:   [220, 205, 190], // fair scholarly
    accent: [120, 200, 255], // arc-spark blue rune trim
    hat:    [45, 75, 140],   // arcane artisan hood
    size:   'slim',
  },
  9999034: {
    name: 'Brin the Fletchmaster',
    role: 'fletchmaster',
    desc: 'Wiry bowman craftsman in forest leathers with a quiver of crafted arrows',
    body:   [70, 100, 50],   // hunter green leather
    hair:   [100, 70, 40],   // sandy brown
    skin:   [190, 155, 115], // outdoor-tanned
    accent: [180, 140, 60],  // carved-wood fletching gold
    hat:    [60, 80, 40],    // ranger craftsman cap
    size:   'slim',
  },
  9999035: {
    name: 'Mara the Shadowsmith',
    role: 'shadowsmith',
    desc: 'Nimble thief-class shadow artisan in dark plum leathers with glinting throwing knives',
    body:   [50, 30, 60],    // dark plum shadow leather
    hair:   [80, 20, 100],   // dark violet
    skin:   [200, 165, 140], // warm medium
    accent: [200, 200, 220], // silvered blade highlight
    hat:    [40, 20, 50],    // shadow-smith cowl
    size:   'slim',
  },
};

// ── Sprite Generation ─────────────────────────────────────────────────────────

const W = 80;
const H = 100;

/**
 * Build SVG for one frame of an NPC's stand animation.
 * frame=0 → neutral pose; frame=1 → slight breathing shift (+1px body lift).
 */
function buildNpcSvg(npcId, frame) {
  const v = NPC_VISUALS[npcId];
  const isLarge = v.size === 'large';

  const [br, bg, bb] = v.body;
  const [hr, hg, hb] = v.hair;
  const [sr, sg, sb] = v.skin;
  const [ar, ag, ab] = v.accent;

  // Breathing: frame 1 shifts body up by 1px
  const breathY = frame === 1 ? -1 : 0;

  // Proportions
  const headR   = isLarge ? 14 : 12;
  const headCx  = W / 2;
  const headCy  = 22 + breathY;

  const bodyX   = isLarge ? 20 : 23;
  const bodyW   = isLarge ? 40 : 34;
  const bodyY   = headCy + headR + 2;
  const bodyH   = 32;

  const legW    = isLarge ? 14 : 11;
  const legH    = 26;
  const legY    = bodyY + bodyH;
  const legLX   = isLarge ? 22 : 25;
  const legRX   = isLarge ? W - 22 - legW : W - 25 - legW;

  const armW    = isLarge ? 10 : 8;
  const armH    = 26;
  const armY    = bodyY + 4;
  const armLX   = bodyX - armW - 1;
  const armRX   = bodyX + bodyW + 1;

  // Foot sway: frame 1 slight foot forward
  const footSway = frame === 1 ? 2 : 0;

  // Hat shape
  let hatSvg = '';
  let accentSvg = '';
  if (v.hat) {
    const [hatr, hatg, hatb] = v.hat;
    if (v.role === 'mage' || v.role === 'sage') {
      // Tall pointy witch/arcane hat
      hatSvg = `
        <polygon points="${headCx - 13},${headCy - headR + 2} ${headCx},${headCy - headR - 22} ${headCx + 13},${headCy - headR + 2}"
          fill="rgb(${hatr},${hatg},${hatb})" stroke="rgba(0,0,0,0.6)" stroke-width="1"/>
        <rect x="${headCx - 14}" y="${headCy - headR}" width="28" height="6" rx="2"
          fill="rgb(${hatr - 10},${hatg - 10},${hatb - 10})" stroke="rgba(0,0,0,0.5)" stroke-width="1"/>`;
    } else if (v.role === 'chef') {
      // Tall toque
      hatSvg = `
        <rect x="${headCx - 10}" y="${headCy - headR - 18}" width="20" height="20" rx="3"
          fill="rgb(${hatr},${hatg},${hatb})" stroke="rgba(0,0,0,0.4)" stroke-width="1"/>
        <rect x="${headCx - 12}" y="${headCy - headR - 1}" width="24" height="5" rx="2"
          fill="rgb(${hatr - 20},${hatg - 20},${hatb - 20})" stroke="rgba(0,0,0,0.4)" stroke-width="1"/>`;
    } else if (v.role === 'captain') {
      // Tricorn hat
      hatSvg = `
        <polygon points="${headCx - 16},${headCy - headR - 2} ${headCx},${headCy - headR - 14} ${headCx + 16},${headCy - headR - 2}"
          fill="rgb(${hatr},${hatg},${hatb})" stroke="rgba(0,0,0,0.6)" stroke-width="1"/>
        <rect x="${headCx - 13}" y="${headCy - headR - 3}" width="26" height="5" rx="1"
          fill="rgb(${hatr - 5},${hatg - 5},${hatb - 5})" stroke="rgba(0,0,0,0.5)" stroke-width="1"/>
        <line x1="${headCx - 16}" y1="${headCy - headR - 2}" x2="${headCx + 16}" y2="${headCy - headR - 2}"
          stroke="rgb(${ar},${ag},${ab})" stroke-width="1.5"/>`;
    } else if (v.role === 'ranger') {
      // Hood
      hatSvg = `
        <ellipse cx="${headCx}" cy="${headCy - headR + 4}" rx="16" ry="12"
          fill="rgb(${hatr},${hatg},${hatb})" stroke="rgba(0,0,0,0.5)" stroke-width="1"/>`;
    } else if (v.role === 'gravedigger') {
    // Bandage wrappings
    accentSvg = `
      <line x1="${bodyX}" y1="${bodyY + 8}" x2="${bodyX + bodyW}" y2="${bodyY + 8}"
        stroke="rgb(${ar},${ag},${ab})" stroke-width="2" opacity="0.5"/>
      <line x1="${bodyX}" y1="${bodyY + 18}" x2="${bodyX + bodyW}" y2="${bodyY + 18}"
        stroke="rgb(${ar},${ag},${ab})" stroke-width="2" opacity="0.4"/>`;
  } else if (v.role === 'deathdisciple') {
    // Bone necklace dots
    for (let i = 0; i < 5; i++) {
      accentSvg += `<circle cx="${bodyX + 8 + i * 7}" cy="${bodyY + 4}" r="2.5"
        fill="rgb(${ar},${ag},${ab})" opacity="0.8"/>`;
    }
  } else if (v.role === 'boneoracle') {
    // Spectral rune lines
    accentSvg = `
      <line x1="${bodyX + 5}" y1="${bodyY + 5}" x2="${bodyX + bodyW - 5}" y2="${bodyY + 15}"
        stroke="rgb(${ar},${ag},${ab})" stroke-width="1.5" opacity="0.7"/>
      <line x1="${bodyX + 5}" y1="${bodyY + 15}" x2="${bodyX + bodyW - 5}" y2="${bodyY + 5}"
        stroke="rgb(${ar},${ag},${ab})" stroke-width="1.5" opacity="0.7"/>`;
  } else if (v.role === 'lichking') {
    // Void energy chest rune
    accentSvg = `
      <circle cx="${bodyX + bodyW / 2}" cy="${bodyY + 12}" r="8"
        fill="none" stroke="rgb(${ar},${ag},${ab})" stroke-width="1.5" opacity="0.8"/>
      <circle cx="${bodyX + bodyW / 2}" cy="${bodyY + 12}" r="4"
        fill="rgb(${ar},${ag},${ab})" opacity="0.5"/>`;
  } else if (v.role === 'bonemerchant') {
    // Bone trinket buttons
    for (let i = 0; i < 3; i++) {
      accentSvg += `<rect x="${bodyX + bodyW / 2 - 3}" y="${bodyY + 5 + i * 9}" width="6" height="3" rx="1"
        fill="rgb(${ar},${ag},${ab})" opacity="0.7"/>`;
    }
  } else if (v.role === 'frostwarden') {
    // Ice crystal chest plate highlight
    accentSvg = `
      <polygon points="${bodyX + bodyW / 2},${bodyY + 4} ${bodyX + bodyW / 2 + 8},${bodyY + 14}
        ${bodyX + bodyW / 2},${bodyY + 20} ${bodyX + bodyW / 2 - 8},${bodyY + 14}"
        fill="rgb(${ar},${ag},${ab})" opacity="0.5"/>`;
  } else if (v.role === 'cryptwarden') {
    // Shadow rune chest glow
    accentSvg = `
      <circle cx="${bodyX + bodyW / 2}" cy="${bodyY + 12}" r="7"
        fill="none" stroke="rgb(${ar},${ag},${ab})" stroke-width="2" opacity="0.6"
        stroke-dasharray="4,2"/>`;
  } else if (v.role === 'ironsmith') {
    // Heavy plate rivets
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        accentSvg += `<circle cx="${bodyX + 8 + col * 12}" cy="${bodyY + 6 + row * 14}" r="2"
          fill="rgb(${ar},${ag},${ab})" opacity="0.7"/>`;
      }
    }
  } else if (v.role === 'arcanist') {
    // Etched rune lines on robe
    accentSvg = `
      <line x1="${bodyX + 4}" y1="${bodyY}" x2="${bodyX + 4}" y2="${bodyY + bodyH}"
        stroke="rgb(${ar},${ag},${ab})" stroke-width="1.5" opacity="0.6"/>
      <line x1="${bodyX + bodyW - 4}" y1="${bodyY}" x2="${bodyX + bodyW - 4}" y2="${bodyY + bodyH}"
        stroke="rgb(${ar},${ag},${ab})" stroke-width="1.5" opacity="0.6"/>
      <ellipse cx="${bodyX + bodyW / 2}" cy="${bodyY + 10}" rx="6" ry="4"
        fill="none" stroke="rgb(${ar},${ag},${ab})" stroke-width="1" opacity="0.5"/>`;
  } else if (v.role === 'fletchmaster') {
    // Quiver strap
    accentSvg = `
      <line x1="${bodyX + bodyW - 4}" y1="${bodyY}" x2="${bodyX + 4}" y2="${bodyY + bodyH}"
        stroke="rgb(${ar},${ag},${ab})" stroke-width="2" opacity="0.6"/>`;
  } else if (v.role === 'shadowsmith') {
    // Silver throwing knife silhouette on chest
    accentSvg = `
      <polygon points="${bodyX + bodyW / 2 - 1},${bodyY + 4} ${bodyX + bodyW / 2 + 1},${bodyY + 4}
        ${bodyX + bodyW / 2 + 2},${bodyY + 16} ${bodyX + bodyW / 2 - 2},${bodyY + 16}"
        fill="rgb(${ar},${ag},${ab})" opacity="0.7"/>`;
  } else if (v.role === 'adventurer') {
      // Wide brim explorer hat
      hatSvg = `
        <ellipse cx="${headCx}" cy="${headCy - headR - 1}" rx="18" ry="5"
          fill="rgb(${hatr},${hatg},${hatb})" stroke="rgba(0,0,0,0.5)" stroke-width="1"/>
        <ellipse cx="${headCx}" cy="${headCy - headR - 4}" rx="11" ry="9"
          fill="rgb(${hatr + 10},${hatg + 10},${hatb + 10})" stroke="rgba(0,0,0,0.4)" stroke-width="1"/>`;
    } else if (v.role === 'merchant' || v.role === 'bonemerchant') {
      // Tilted brimmed merchant hat
      hatSvg = `
        <ellipse cx="${headCx}" cy="${headCy - headR}" rx="16" ry="4"
          fill="rgb(${hatr},${hatg},${hatb})" stroke="rgba(0,0,0,0.5)" stroke-width="1"/>
        <rect x="${headCx - 9}" y="${headCy - headR - 10}" width="18" height="11" rx="2"
          fill="rgb(${hatr + 5},${hatg + 5},${hatb + 5})" stroke="rgba(0,0,0,0.4)" stroke-width="1"/>`;
    } else if (v.role === 'deathdisciple') {
      // Dark cowl, slightly draped
      hatSvg = `
        <ellipse cx="${headCx}" cy="${headCy - headR + 5}" rx="17" ry="13"
          fill="rgb(${hatr},${hatg},${hatb})" stroke="rgba(0,0,0,0.6)" stroke-width="1"/>
        <ellipse cx="${headCx}" cy="${headCy - headR + 8}" rx="14" ry="9"
          fill="rgb(${hatr + 10},${hatg + 5},${hatb + 10})" opacity="0.6"/>`;
    } else if (v.role === 'lichking') {
      // Spectral crown with spikes
      hatSvg = `
        <rect x="${headCx - 12}" y="${headCy - headR - 8}" width="24" height="8" rx="1"
          fill="rgb(${hatr},${hatg},${hatb})" stroke="rgba(0,0,0,0.7)" stroke-width="1"/>
        <polygon points="${headCx - 10},${headCy - headR - 8} ${headCx - 6},${headCy - headR - 16} ${headCx - 2},${headCy - headR - 8}"
          fill="rgb(${ar},${ag},${ab})" opacity="0.8"/>
        <polygon points="${headCx - 2},${headCy - headR - 8} ${headCx + 2},${headCy - headR - 18} ${headCx + 6},${headCy - headR - 8}"
          fill="rgb(${ar},${ag},${ab})" opacity="0.9"/>
        <polygon points="${headCx + 6},${headCy - headR - 8} ${headCx + 10},${headCy - headR - 14} ${headCx + 14},${headCy - headR - 8}"
          fill="rgb(${ar},${ag},${ab})" opacity="0.8"/>`;
    } else if (v.role === 'frostwarden') {
      // Frost-shard helmet with crest
      hatSvg = `
        <rect x="${headCx - 14}" y="${headCy - headR - 2}" width="28" height="10" rx="2"
          fill="rgb(${hatr},${hatg},${hatb})" stroke="rgba(0,0,0,0.5)" stroke-width="1"/>
        <polygon points="${headCx - 4},${headCy - headR - 2} ${headCx},${headCy - headR - 14} ${headCx + 4},${headCy - headR - 2}"
          fill="rgb(${ar},${ag},${ab})" opacity="0.9"/>`;
    } else if (v.role === 'cryptwarden') {
      // Spiked dark warden helmet
      hatSvg = `
        <rect x="${headCx - 14}" y="${headCy - headR - 4}" width="28" height="12" rx="1"
          fill="rgb(${hatr},${hatg},${hatb})" stroke="rgba(${ar},${ag},${ab},0.5)" stroke-width="1"/>
        <polygon points="${headCx - 8},${headCy - headR - 4} ${headCx - 5},${headCy - headR - 12} ${headCx - 2},${headCy - headR - 4}"
          fill="rgb(${ar},${ag},${ab})" opacity="0.7"/>
        <polygon points="${headCx + 2},${headCy - headR - 4} ${headCx + 5},${headCy - headR - 14} ${headCx + 8},${headCy - headR - 4}"
          fill="rgb(${ar},${ag},${ab})" opacity="0.7"/>`;
    } else if (v.role === 'arcanist') {
      // Arcane artisan hood — mage-style
      hatSvg = `
        <polygon points="${headCx - 13},${headCy - headR + 2} ${headCx},${headCy - headR - 20} ${headCx + 13},${headCy - headR + 2}"
          fill="rgb(${hatr},${hatg},${hatb})" stroke="rgba(0,0,0,0.6)" stroke-width="1"/>
        <rect x="${headCx - 14}" y="${headCy - headR}" width="28" height="5" rx="2"
          fill="rgb(${ar},${ag},${ab})" opacity="0.5"/>`;
    } else if (v.role === 'fletchmaster') {
      // Ranger craftsman cap — flat brim
      hatSvg = `
        <ellipse cx="${headCx}" cy="${headCy - headR - 1}" rx="16" ry="4"
          fill="rgb(${hatr},${hatg},${hatb})" stroke="rgba(0,0,0,0.5)" stroke-width="1"/>
        <ellipse cx="${headCx}" cy="${headCy - headR - 5}" rx="10" ry="7"
          fill="rgb(${hatr + 10},${hatg + 10},${hatb + 10})" stroke="rgba(0,0,0,0.4)" stroke-width="1"/>`;
    } else if (v.role === 'shadowsmith') {
      // Shadow-smith cowl — dark ranger style
      hatSvg = `
        <ellipse cx="${headCx}" cy="${headCy - headR + 5}" rx="16" ry="11"
          fill="rgb(${hatr},${hatg},${hatb})" stroke="rgba(0,0,0,0.6)" stroke-width="1"/>`;
    } else if (v.role === 'healer') {
      // Nurse cap
      hatSvg = `
        <rect x="${headCx - 11}" y="${headCy - headR - 5}" width="22" height="7" rx="2"
          fill="rgb(${hatr},${hatg},${hatb})" stroke="rgba(0,0,0,0.4)" stroke-width="1"/>
        <line x1="${headCx - 2}" y1="${headCy - headR - 4}" x2="${headCx + 2}" y2="${headCy - headR - 4}"
          stroke="rgb(${ar},${ag},${ab})" stroke-width="2"/>
        <line x1="${headCx}" y1="${headCy - headR - 6}" x2="${headCx}" y2="${headCy - headR - 2}"
          stroke="rgb(${ar},${ag},${ab})" stroke-width="2"/>`;
    }
  }

  // Role-specific accent detail on body
  accentSvg = '';
  if (v.role === 'blacksmith') {
    // Apron stripe
    accentSvg = `<rect x="${bodyX + 8}" y="${bodyY + 4}" width="${bodyW - 16}" height="${bodyH - 8}"
      fill="rgb(${ar},${ag},${ab})" opacity="0.5"/>`;
  } else if (v.role === 'mage' || v.role === 'sage') {
    // Robe trim lines
    accentSvg = `
      <line x1="${bodyX + 4}" y1="${bodyY}" x2="${bodyX + 4}" y2="${bodyY + bodyH}"
        stroke="rgb(${ar},${ag},${ab})" stroke-width="2" opacity="0.7"/>
      <line x1="${bodyX + bodyW - 4}" y1="${bodyY}" x2="${bodyX + bodyW - 4}" y2="${bodyY + bodyH}"
        stroke="rgb(${ar},${ag},${ab})" stroke-width="2" opacity="0.7"/>`;
  } else if (v.role === 'warrior') {
    // Chest plate highlight
    accentSvg = `<rect x="${bodyX + 6}" y="${bodyY + 4}" width="${bodyW - 12}" height="12" rx="2"
      fill="rgb(${ar},${ag},${ab})" opacity="0.6"/>`;
  } else if (v.role === 'healer') {
    // Red cross on chest
    accentSvg = `
      <line x1="${bodyX + bodyW / 2 - 5}" y1="${bodyY + 10}" x2="${bodyX + bodyW / 2 + 5}" y2="${bodyY + 10}"
        stroke="rgb(${ar},${ag},${ab})" stroke-width="3"/>
      <line x1="${bodyX + bodyW / 2}" y1="${bodyY + 5}" x2="${bodyX + bodyW / 2}" y2="${bodyY + 15}"
        stroke="rgb(${ar},${ag},${ab})" stroke-width="3"/>`;
  } else if (v.role === 'captain') {
    // Gold buttons
    for (let i = 0; i < 3; i++) {
      accentSvg += `<circle cx="${bodyX + bodyW / 2}" cy="${bodyY + 8 + i * 8}" r="2"
        fill="rgb(${ar},${ag},${ab})"/>`;
    }
  } else if (v.role === 'chef') {
    // Chef coat buttons
    for (let i = 0; i < 4; i++) {
      accentSvg += `<circle cx="${bodyX + bodyW / 2 - 4}" cy="${bodyY + 6 + i * 7}" r="2"
        fill="rgb(${ar},${ag},${ab})"/>`;
    }
    accentSvg += `<rect x="${bodyX + 2}" y="${bodyY}" width="${bodyW - 4}" height="5"
      fill="rgb(${ar},${ag},${ab})" opacity="0.6"/>`;
  } else if (v.role === 'merchant') {
    // Gem accent on chest
    accentSvg = `<polygon points="${bodyX + bodyW / 2},${bodyY + 6} ${bodyX + bodyW / 2 + 4},${bodyY + 11}
      ${bodyX + bodyW / 2},${bodyY + 15} ${bodyX + bodyW / 2 - 4},${bodyY + 11}"
      fill="rgb(${ar},${ag},${ab})" opacity="0.9"/>`;
  } else if (v.role === 'elder') {
    // Blue sash
    accentSvg = `<rect x="${bodyX - 3}" y="${bodyY + 10}" width="${bodyW + 6}" height="8"
      fill="rgb(${ar},${ag},${ab})" opacity="0.6" transform="rotate(-5 ${W / 2} ${bodyY + 14})"/>`;
  }

  // Eyes
  const eyeY = headCy + 2;
  const eyeOffX = 5;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="transparent"/>

    <!-- Shadow -->
    <ellipse cx="${W / 2}" cy="${H - 5}" rx="${isLarge ? 20 : 16}" ry="4"
      fill="rgba(0,0,0,0.15)"/>

    <!-- Left leg -->
    <rect x="${legLX - footSway}" y="${legY}" width="${legW}" height="${legH}" rx="3"
      fill="rgb(${br},${bg},${bb})" stroke="rgba(0,0,0,0.5)" stroke-width="1"/>

    <!-- Right leg -->
    <rect x="${legRX + footSway}" y="${legY}" width="${legW}" height="${legH}" rx="3"
      fill="rgb(${br},${bg},${bb})" stroke="rgba(0,0,0,0.5)" stroke-width="1"/>

    <!-- Left arm -->
    <rect x="${armLX}" y="${armY + breathY}" width="${armW}" height="${armH}" rx="3"
      fill="rgb(${br},${bg},${bb})" stroke="rgba(0,0,0,0.5)" stroke-width="1"/>

    <!-- Right arm -->
    <rect x="${armRX}" y="${armY + breathY}" width="${armW}" height="${armH}" rx="3"
      fill="rgb(${br},${bg},${bb})" stroke="rgba(0,0,0,0.5)" stroke-width="1"/>

    <!-- Body -->
    <rect x="${bodyX}" y="${bodyY + breathY}" width="${bodyW}" height="${bodyH}" rx="4"
      fill="rgb(${br},${bg},${bb})" stroke="rgba(0,0,0,0.6)" stroke-width="1"/>

    <!-- Body accent -->
    ${accentSvg}

    <!-- Neck -->
    <rect x="${W / 2 - 5}" y="${headCy + headR - 2 + breathY}" width="10" height="6"
      fill="rgb(${sr},${sg},${sb})" stroke="rgba(0,0,0,0.3)" stroke-width="0.5"/>

    <!-- Head -->
    <circle cx="${headCx}" cy="${headCy + breathY}" r="${headR}"
      fill="rgb(${sr},${sg},${sb})" stroke="rgba(0,0,0,0.6)" stroke-width="1"/>

    <!-- Hair -->
    <ellipse cx="${headCx}" cy="${headCy + breathY - headR * 0.4}" rx="${headR}" ry="${headR * 0.65}"
      fill="rgb(${hr},${hg},${hb})" stroke="rgba(0,0,0,0.4)" stroke-width="0.5"/>

    <!-- Hat (on top of hair) -->
    ${hatSvg}

    <!-- Eyes -->
    <circle cx="${headCx - eyeOffX}" cy="${eyeY + breathY}" r="2"
      fill="rgba(30,20,10,0.9)"/>
    <circle cx="${headCx + eyeOffX}" cy="${eyeY + breathY}" r="2"
      fill="rgba(30,20,10,0.9)"/>
    <circle cx="${headCx - eyeOffX + 0.5}" cy="${eyeY + breathY - 0.5}" r="0.7"
      fill="rgba(255,255,255,0.6)"/>
    <circle cx="${headCx + eyeOffX + 0.5}" cy="${eyeY + breathY - 0.5}" r="0.7"
      fill="rgba(255,255,255,0.6)"/>

    <!-- Mouth -->
    <path d="M ${headCx - 4} ${headCy + breathY + 6} Q ${headCx} ${headCy + breathY + 9} ${headCx + 4} ${headCy + breathY + 6}"
      stroke="rgba(80,40,30,0.8)" stroke-width="1" fill="none"/>
  </svg>`;

  return svg;
}

/**
 * Generate a 32×32 portrait icon for the NPC (shown in dialogue box).
 */
function buildPortraitSvg(npcId) {
  const v = NPC_VISUALS[npcId];
  const [hr, hg, hb] = v.hair;
  const [sr, sg, sb] = v.skin;
  const [br, bg, bb] = v.body;
  const [ar, ag, ab] = v.accent;

  const cx = 16, cy = 16;
  const headR = 10;
  const eyeOffX = 4;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
    <rect x="1" y="1" width="30" height="30" rx="4" fill="rgb(${br},${bg},${bb})"
      stroke="rgba(${ar},${ag},${ab},0.8)" stroke-width="1.5"/>
    <!-- Shoulders -->
    <ellipse cx="${cx}" cy="28" rx="14" ry="7" fill="rgb(${br},${bg},${bb})"/>
    <!-- Head -->
    <circle cx="${cx}" cy="${cy - 2}" r="${headR}"
      fill="rgb(${sr},${sg},${sb})" stroke="rgba(0,0,0,0.5)" stroke-width="1"/>
    <!-- Hair -->
    <ellipse cx="${cx}" cy="${cy - 2 - headR * 0.4}" rx="${headR}" ry="${headR * 0.65}"
      fill="rgb(${hr},${hg},${hb})"/>
    <!-- Eyes -->
    <circle cx="${cx - eyeOffX}" cy="${cy}" r="1.5" fill="rgba(30,20,10,0.9)"/>
    <circle cx="${cx + eyeOffX}" cy="${cy}" r="1.5" fill="rgba(30,20,10,0.9)"/>
    <!-- Accent dot -->
    <circle cx="${cx}" cy="${cy + 7}" r="2" fill="rgba(${ar},${ag},${ab},0.7)"/>
  </svg>`;

  return svg;
}

// ── Per-NPC Generation ────────────────────────────────────────────────────────

/**
 * Generate stand animation frames + portrait icon for one NPC.
 * Saves PNGs to workspace/maple-sprites/custom-npcs/{npcId}/
 */
async function generateNpcSprites(npcId) {
  const v = NPC_VISUALS[npcId];
  if (!v) throw new Error(`No visual def for NPC ${npcId}`);

  const npcDir = join(SPRITE_DIR, String(npcId));
  mkdirSync(npcDir, { recursive: true });

  const paths = { stand: [], portrait: '' };

  // Stand frames (2: neutral + breath)
  for (let frame = 0; frame < 2; frame++) {
    const svg = buildNpcSvg(npcId, frame);
    const buf = await sharp(Buffer.from(svg)).png().toBuffer();
    const p = join(npcDir, `stand_${frame}.png`);
    writeFileSync(p, buf);
    paths.stand.push(p);
  }

  // Portrait icon
  const portraitSvg = buildPortraitSvg(npcId);
  const portraitBuf = await sharp(Buffer.from(portraitSvg)).png().toBuffer();
  paths.portrait = join(npcDir, 'portrait.png');
  writeFileSync(paths.portrait, portraitBuf);

  log.info({ npcId, name: v.name, frames: paths.stand.length }, 'Generated NPC sprites');
  return paths;
}

// ── Npc.wz XML Generation ─────────────────────────────────────────────────────

/**
 * Write a Npc.wz XML stub for one NPC.
 * The XML is compatible with Cosmic's WZ XML loader and client rendering.
 */
function writeNpcWzXml(npcId) {
  const v = NPC_VISUALS[npcId];

  // Sprite path references (relative to wz root)
  const spritePath = `../../../maple-sprites/custom-npcs/${npcId}`;

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<imgdir name="${npcId}.img">
  <imgdir name="stand">
    <imgdir name="0">
      <canvas name="image" width="${W}" height="${H}" basedata="${spritePath}/stand_0.png"/>
      <vector name="origin" x="${Math.round(W / 2)}" y="${H - 8}"/>
      <int name="delay" value="200"/>
    </imgdir>
    <imgdir name="1">
      <canvas name="image" width="${W}" height="${H}" basedata="${spritePath}/stand_1.png"/>
      <vector name="origin" x="${Math.round(W / 2)}" y="${H - 8}"/>
      <int name="delay" value="200"/>
    </imgdir>
  </imgdir>
  <imgdir name="info">
    <int name="face" value="0"/>
    <string name="link" value=""/>
  </imgdir>
</imgdir>
`;

  const xmlPath = NPC_WZ(npcId);
  writeFileSync(xmlPath, xml, 'utf8');
  log.info({ npcId, xmlPath }, 'Wrote Npc.wz XML');
  return xmlPath;
}

// ── harepacker-mcp Injection ──────────────────────────────────────────────────

/**
 * Use harepacker-mcp to inject stand PNG frames into the v83 client Npc.wz binary.
 * This is what actually makes the sprites visible to players in-game.
 */
async function packNpcToClientWz(npcId) {
  const v = NPC_VISUALS[npcId];
  const npcDir = join(SPRITE_DIR, String(npcId));
  const results = [];

  const CLIENT_NPC_WZ = join(process.cwd(), 'workspace', 'v83-client', '83', 'Npc.wz');

  for (let frame = 0; frame < 2; frame++) {
    const imgPath = join(npcDir, `stand_${frame}.png`);
    if (!existsSync(imgPath)) {
      results.push({ frame, status: 'missing', path: imgPath });
      continue;
    }

    try {
      // init_data_source to open the client Npc.wz
      await callTool('harepacker-mcp', 'init_data_source', {
        dataPath: CLIENT_NPC_WZ,
      });

      // import_png to inject the frame
      await callTool('harepacker-mcp', 'import_png', {
        imagePath: imgPath,
        wzPath: `${npcId}.img/stand/${frame}/image`,
      });

      results.push({ frame, status: 'packed', path: imgPath });
      log.info({ npcId, frame }, 'Packed NPC frame to client Npc.wz');
    } catch (err) {
      results.push({ frame, status: 'error', error: err.message });
      log.warn({ npcId, frame, err: err.message }, 'harepacker pack failed');
    }
  }

  return results;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate sprites and WZ XML for ALL 11 custom NPCs.
 * @returns {{ generated: number, npcs: object[] }}
 */
export async function generateAllNpcSprites() {
  mkdirSync(NPC_WZ_DIR, { recursive: true });
  mkdirSync(SPRITE_DIR,  { recursive: true });

  const npcIds = Object.keys(NPC_VISUALS).map(Number);
  const results = [];
  let generated = 0;

  for (const npcId of npcIds) {
    try {
      const paths   = await generateNpcSprites(npcId);
      const xmlPath = writeNpcWzXml(npcId);

      results.push({
        npcId,
        name:    NPC_VISUALS[npcId].name,
        role:    NPC_VISUALS[npcId].role,
        frames:  paths.stand.length,
        xmlPath,
        status:  'generated',
      });
      generated += paths.stand.length + 1; // frames + portrait
    } catch (err) {
      results.push({ npcId, name: NPC_VISUALS[npcId]?.name, status: 'error', error: err.message });
      log.error({ npcId, err: err.message }, 'NPC sprite generation failed');
    }
  }

  log.info({ totalNpcs: npcIds.length, generated }, 'Custom NPC sprite generation complete');
  return { generated, npcs: results };
}

/**
 * Pack ALL custom NPC sprites into the v83 client Npc.wz.
 * Requires harepacker-mcp to be running and v83-client/83/Npc.wz to be present.
 */
export async function packAllNpcSpritesToWz() {
  const npcIds = Object.keys(NPC_VISUALS).map(Number);
  const results = [];

  for (const npcId of npcIds) {
    const spriteDir = join(SPRITE_DIR, String(npcId));
    if (!existsSync(join(spriteDir, 'stand_0.png'))) {
      results.push({ npcId, status: 'sprites_not_generated' });
      continue;
    }
    const packResults = await packNpcToClientWz(npcId);
    results.push({ npcId, name: NPC_VISUALS[npcId].name, frames: packResults });
  }

  return { npcs: results };
}

/**
 * Status check: which NPCs have sprites generated and XML written.
 */
export function getNpcSpriteStatus() {
  const npcIds = Object.keys(NPC_VISUALS).map(Number);

  return npcIds.map((npcId) => {
    const npcDir = join(SPRITE_DIR, String(npcId));
    const frame0 = join(npcDir, 'stand_0.png');
    const frame1 = join(npcDir, 'stand_1.png');
    const xml    = NPC_WZ(npcId);

    return {
      npcId,
      name:       NPC_VISUALS[npcId].name,
      role:       NPC_VISUALS[npcId].role,
      hasFrames:  existsSync(frame0) && existsSync(frame1),
      hasXml:     existsSync(xml),
      spriteDir:  npcDir,
      xmlPath:    xml,
    };
  });
}
