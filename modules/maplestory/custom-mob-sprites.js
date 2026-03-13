/**
 * modules/maplestory/custom-mob-sprites.js — Pixel-art sprite generator for custom dungeon mobs.
 *
 * Generates programmatic multi-state sprite sheets using SVG→sharp for the two
 * custom mobs added to Shadow Crypts dungeon zone:
 *
 *   9901001 — Crypt Shade (lv88): wispy ghost/wraith, blue-grey, 163×143px
 *   9901002 — The Lich (lv105):  tall robed undead sorcerer, 200×310px, boss
 *
 * Each mob gets all required animation states:
 *   Crypt Shade: stand(2), move(4), hit1(2), die1(3), attack1(3)
 *   The Lich:    stand(3), move(4), hit1(2), die1(4), attack1(3), attack2(4)
 *
 * Saves PNGs to workspace/maple-sprites/mobs/{mobId}/{state}_{frame}.png
 * Also injects canvas bitmap data into the Mob.wz XML stubs so harepacker
 * can recognize the frames when packing.
 *
 * Wired into index.js as:
 *   maple_gen_mob_sprites       — generate all mob sprite PNGs
 *   maple_mob_sprite_status     — check which sprites exist
 *   maple_pack_mob_wz           — pack via harepacker-mcp into v83 client
 */

import sharp from 'sharp';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../lib/logger.js';
import { callTool } from '../../lib/mcp-gateway.js';

const log = createLogger('maplestory:custom-mob-sprites');

const WZ_DIR     = join(process.cwd(), 'workspace', 'Cosmic', 'wz');
const SPRITE_DIR = join(process.cwd(), 'workspace', 'maple-sprites', 'mobs');
const MOB_WZ_DIR = join(WZ_DIR, 'Mob.wz');

// ── Mob Visual Definitions ────────────────────────────────────────────────────

export const MOB_VISUALS = {
  9901001: {
    name: 'Crypt Shade',
    type: 'ghost',
    desc: 'Wispy undead shade, blue-grey translucent wraith',
    w: 163, h: 143,
    primary:    [100, 140, 200],  // blue-grey ghost body
    glow:       [160, 200, 255],  // pale blue inner glow
    outline:    [40, 60, 120],    // dark blue outline
    eyeColor:   [200, 240, 255],  // icy white-blue eyes
    states: {
      stand:   2,
      move:    4,
      hit1:    2,
      die1:    3,
      attack1: 3,
    },
  },
  9901002: {
    name: 'The Lich',
    type: 'lich',
    desc: 'Ancient undead sorcerer, tall robed boss figure',
    w: 200, h: 310,
    primary:    [30, 15, 50],     // obsidian black-purple robe
    glow:       [120, 50, 200],   // void purple inner glow
    bone:       [200, 190, 175],  // skull/bone color
    staffColor: [80, 60, 40],     // dark wood staff
    crownGlow:  [80, 160, 255],   // ice-blue void energy crown glow
    eyeColor:   [60, 200, 255],   // void blue glowing eye sockets
    states: {
      stand:   3,
      move:    4,
      hit1:    2,
      die1:    4,
      attack1: 3,
      attack2: 4,
    },
  },
};

// ── SVG Builders ──────────────────────────────────────────────────────────────

/**
 * Build SVG for one frame of the Crypt Shade (ghost/wraith).
 * A floating spectral blob with glowing core, tendrils, and icy eyes.
 *
 * state: 'stand'|'move'|'hit1'|'die1'|'attack1'
 * frame: 0-based frame index
 */
function buildCryptShadeSvg(state, frame) {
  const v = MOB_VISUALS[9901001];
  const { w, h } = v;
  const [pr, pg, pb] = v.primary;
  const [gr, gg, gb] = v.glow;
  const [or_, og, ob] = v.outline;
  const [er, eg, eb] = v.eyeColor;

  // Ghost center
  const cx = w / 2;
  // Float oscillation — each frame drifts ghost up/down by 3px
  const floatCycle = [0, -3, -5, -3];
  const floatY = h * 0.5 + (floatCycle[frame % 4] || 0);

  // State-dependent opacity/scale modifiers
  let opacity     = 0.88;
  let scaleX      = 1.0;
  let tiltDeg     = 0;
  let glowPulse   = 1.0;
  let disperseR   = 0;  // die1: shrink radius

  if (state === 'move') {
    // Slight lean forward per frame
    tiltDeg = [-4, -8, -4, 0][frame] || 0;
  } else if (state === 'hit1') {
    // Flash brighter, compress horizontally
    opacity    = [0.6, 0.9][frame] || 0.88;
    glowPulse  = [2.0, 1.2][frame] || 1.0;
  } else if (state === 'die1') {
    // Fade and shrink
    opacity    = [0.8, 0.5, 0.2][frame] || 0.8;
    disperseR  = [0, 8, 20][frame] || 0;
    glowPulse  = [1.0, 1.5, 2.0][frame] || 1.0;
  } else if (state === 'attack1') {
    // Lunge forward, stretch
    scaleX  = [1.0, 1.15, 1.0][frame] || 1.0;
    tiltDeg = [0, -12, 0][frame] || 0;
    glowPulse = [1.0, 1.8, 1.0][frame] || 1.0;
  }

  // Ghost body radii
  const bodyRx = Math.round(58 * scaleX);
  const bodyRy = 62;
  const bodyY  = floatY + disperseR;

  // Tendrils at bottom (3 wispy tails)
  const tendrilY  = bodyY + bodyRy - 10;
  const tendrilLen = Math.max(10, 32 - disperseR);

  // Glow radii
  const glowRx = Math.round((bodyRx + 14) * glowPulse * 0.8);
  const glowRy = Math.round((bodyRy + 12) * glowPulse * 0.7);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"
    viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="transparent"/>

    <!-- Outer spectral glow -->
    <ellipse cx="${cx}" cy="${bodyY}" rx="${glowRx}" ry="${glowRy}"
      fill="rgba(${gr},${gg},${gb},0.18)" filter="url(#blur)"/>

    <!-- Ghost body (main form) -->
    <ellipse cx="${cx}" cy="${bodyY}" rx="${bodyRx}" ry="${bodyRy}"
      fill="rgba(${pr},${pg},${pb},${opacity})"
      stroke="rgb(${or_},${og},${ob})" stroke-width="2"
      transform="rotate(${tiltDeg},${cx},${bodyY})"/>

    <!-- Inner bright core -->
    <ellipse cx="${cx}" cy="${bodyY - 12}" rx="${Math.round(bodyRx * 0.5)}" ry="${Math.round(bodyRy * 0.4)}"
      fill="rgba(${gr},${gg},${gb},${Math.min(0.55, 0.35 * glowPulse)})"
      transform="rotate(${tiltDeg},${cx},${bodyY})"/>

    <!-- Tendrils (3 wispy trails at bottom) -->
    <path d="M ${cx - 22} ${tendrilY} Q ${cx - 30} ${tendrilY + tendrilLen * 0.6} ${cx - 18} ${tendrilY + tendrilLen}"
      stroke="rgba(${pr},${pg},${pb},${opacity * 0.7})" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M ${cx} ${tendrilY + 4} Q ${cx} ${tendrilY + tendrilLen * 0.7} ${cx + 4} ${tendrilY + tendrilLen - 4}"
      stroke="rgba(${pr},${pg},${pb},${opacity * 0.85})" stroke-width="9" fill="none" stroke-linecap="round"/>
    <path d="M ${cx + 22} ${tendrilY} Q ${cx + 30} ${tendrilY + tendrilLen * 0.6} ${cx + 18} ${tendrilY + tendrilLen}"
      stroke="rgba(${pr},${pg},${pb},${opacity * 0.7})" stroke-width="7" fill="none" stroke-linecap="round"/>

    <!-- Glowing eyes -->
    <ellipse cx="${cx - 14}" cy="${bodyY - 8}" rx="8" ry="6"
      fill="rgba(${er},${eg},${eb},${Math.min(0.95, 0.7 * glowPulse)})"
      transform="rotate(${tiltDeg},${cx},${bodyY})"/>
    <ellipse cx="${cx + 14}" cy="${bodyY - 8}" rx="8" ry="6"
      fill="rgba(${er},${eg},${eb},${Math.min(0.95, 0.7 * glowPulse)})"
      transform="rotate(${tiltDeg},${cx},${bodyY})"/>
    <!-- Eye pupils -->
    <ellipse cx="${cx - 14}" cy="${bodyY - 8}" rx="4" ry="3.5"
      fill="rgba(200,240,255,0.9)"
      transform="rotate(${tiltDeg},${cx},${bodyY})"/>
    <ellipse cx="${cx + 14}" cy="${bodyY - 8}" rx="4" ry="3.5"
      fill="rgba(200,240,255,0.9)"
      transform="rotate(${tiltDeg},${cx},${bodyY})"/>

    <!-- Disperse particles (die1 frames 1-2) -->
    ${disperseR > 0 ? `
    <circle cx="${cx - 40 - disperseR}" cy="${bodyY - 20}" r="${4 - frame}" fill="rgba(${gr},${gg},${gb},0.5)"/>
    <circle cx="${cx + 35 + disperseR}" cy="${bodyY + 10}" r="${3 - frame * 0.5}" fill="rgba(${gr},${gg},${gb},0.4)"/>
    <circle cx="${cx - 10}" cy="${bodyY - 55 - disperseR}" r="${3 - frame * 0.5}" fill="rgba(${gr},${gg},${gb},0.3)"/>
    ` : ''}
  </svg>`;

  return svg;
}

/**
 * Build SVG for one frame of The Lich (tall robed boss figure).
 * Obsidian-robed ancient sorcerer with skull face, bone staff, and void-blue crown.
 *
 * state: 'stand'|'move'|'hit1'|'die1'|'attack1'|'attack2'
 * frame: 0-based frame index
 */
function buildLichSvg(state, frame) {
  const v = MOB_VISUALS[9901002];
  const { w, h } = v;
  const [pr, pg, pb] = v.primary;
  const [gr, gg, gb] = v.glow;
  const [br, bg_, bb] = v.bone;
  const [sr, sg, sb] = v.staffColor;
  const [cr, cg, cb] = v.crownGlow;
  const [er, eg, eb] = v.eyeColor;

  // Layout: robe bottom at y=h-10, figure stands ~300px tall
  const groundY = h - 12;
  const robeTopY = groundY - 260;  // robe peak (where hood meets)
  const skulCy = robeTopY + 30;    // skull head center
  const chest = robeTopY + 90;     // chest orb position

  // Float / sway
  const floatCycle = [0, -2, -4, -2];
  const floatOff   = floatCycle[frame % 4] || 0;

  let staffSway   = 0;   // staff lean in degrees
  let robeShift   = 0;   // robe width modifier
  let opacity     = 1.0;
  let glowPulse   = 1.0;
  let crumbleOff  = 0;   // die1: crumble offset

  if (state === 'stand') {
    staffSway = [0, 2, 4][frame] || 0;
    glowPulse = [1.0, 1.1, 1.0][frame] || 1.0;
  } else if (state === 'move') {
    staffSway = [-5, -3, 0, 3][frame] || 0;
    robeShift = [2, 4, 2, 0][frame] || 0;
  } else if (state === 'hit1') {
    opacity = [0.7, 1.0][frame] || 1.0;
    glowPulse = [2.5, 1.2][frame] || 1.0;
    staffSway = [-10, 5][frame] || 0;
  } else if (state === 'die1') {
    opacity    = [1.0, 0.8, 0.5, 0.2][frame] || 1.0;
    crumbleOff = [0, 8, 20, 40][frame] || 0;
    glowPulse  = [1.0, 1.5, 2.0, 2.5][frame] || 1.0;
  } else if (state === 'attack1') {
    // Death bolt cast: arm extends, staff glows
    staffSway = [0, -20, 0][frame] || 0;
    glowPulse = [1.0, 2.5, 1.0][frame] || 1.0;
  } else if (state === 'attack2') {
    // Necrotic wave: robe billows out
    robeShift = [0, 15, 20, 5][frame] || 0;
    glowPulse = [1.0, 1.5, 2.0, 1.2][frame] || 1.0;
    staffSway = [0, -5, -10, -5][frame] || 0;
  }

  // Robe geometry (tall trapezoid)
  const robeTopW = 80;
  const robeBotW = 160 + robeShift * 2;
  const robeTX   = (w - robeTopW) / 2;
  const robeBX   = (w - robeBotW) / 2;
  const robeTopY2 = robeTopY + floatOff + crumbleOff;
  const robe_bl  = `${robeBX},${groundY + crumbleOff}`;
  const robe_br  = `${robeBX + robeBotW},${groundY + crumbleOff}`;
  const robe_tr  = `${robeTX + robeTopW},${robeTopY2 + 20}`;
  const robe_tl  = `${robeTX},${robeTopY2 + 20}`;

  // Hood (rounded top)
  const hoodCx   = w / 2;
  const hoodCy   = robeTopY2 + 14;
  const hoodRx   = 42;
  const hoodRy   = 38;

  // Skull position (within hood)
  const skulCy2  = hoodCy + 10 + floatOff + crumbleOff;
  const skulRx   = 28;
  const skulRy   = 24;

  // Staff geometry
  const staffX1  = w / 2 + 55;
  const staffY1  = skulCy2 - 20;
  const staffX2  = staffX1 + Math.sin((staffSway * Math.PI) / 180) * 40;
  const staffY2  = groundY - 10 + crumbleOff;

  // Crown spikes (on top of hood)
  const crownBase = hoodCy - hoodRy + 5 + floatOff + crumbleOff;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"
    viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="transparent"/>

    <!-- Ground shadow -->
    <ellipse cx="${w / 2}" cy="${groundY + 6}" rx="${70 + robeShift}" ry="8"
      fill="rgba(0,0,0,0.2)" opacity="${opacity}"/>

    <!-- Staff (drawn behind robe) -->
    <line x1="${staffX1}" y1="${staffY1}" x2="${staffX2}" y2="${staffY2}"
      stroke="rgb(${sr},${sg},${sb})" stroke-width="8" stroke-linecap="round"
      opacity="${opacity}"/>
    <!-- Staff glow -->
    <line x1="${staffX1}" y1="${staffY1}" x2="${staffX2}" y2="${staffY2}"
      stroke="rgba(${gr},${gg},${gb},${0.4 * glowPulse})" stroke-width="4"
      stroke-linecap="round" opacity="${opacity}"/>
    <!-- Staff skull top -->
    <circle cx="${staffX1}" cy="${staffY1 - 14}" r="11"
      fill="rgb(${br},${bg_},${bb})" stroke="rgba(${gr},${gg},${gb},0.6)" stroke-width="2"
      opacity="${opacity}"/>
    <ellipse cx="${staffX1}" cy="${staffY1 - 10}" rx="4" ry="3"
      fill="rgba(0,0,0,0.5)" opacity="${opacity}"/>

    <!-- Robe body -->
    <polygon points="${robe_tl} ${robe_tr} ${robe_br} ${robe_bl}"
      fill="rgb(${pr},${pg},${pb})" stroke="rgba(${gr},${gg},${gb},0.3)" stroke-width="2"
      opacity="${opacity}"/>

    <!-- Robe trim at bottom (fringe detail) -->
    ${Array.from({length: 6}, (_, i) => {
      const tx = robeBX + (robeBotW / 6) * i + robeBotW / 12;
      const ty = groundY + crumbleOff;
      return `<polygon points="${tx - 8},${ty} ${tx},${ty + 10} ${tx + 8},${ty}"
        fill="rgba(${gr},${gg},${gb},0.4)" opacity="${opacity}"/>`;
    }).join('\n    ')}

    <!-- Robe inner shadow (depth) -->
    <polygon points="${robe_tl} ${robe_tr} ${robe_br} ${robe_bl}"
      fill="rgba(0,0,0,0.18)" opacity="${opacity}"/>

    <!-- Chest void orb -->
    <circle cx="${w / 2}" cy="${chest + floatOff + crumbleOff}" r="${Math.round(14 * glowPulse * 0.7)}"
      fill="rgba(${gr},${gg},${gb},${0.3 * glowPulse})" opacity="${opacity}"/>
    <circle cx="${w / 2}" cy="${chest + floatOff + crumbleOff}" r="${Math.round(8 * glowPulse * 0.6)}"
      fill="rgba(${cr},${cg},${cb},${0.6 * glowPulse})" opacity="${opacity}"/>

    <!-- Robe shoulder trim -->
    <line x1="${robeTX - 2}" y1="${robeTopY2 + 22}" x2="${robeTX + robeTopW + 2}" y2="${robeTopY2 + 22}"
      stroke="rgba(${cr},${cg},${cb},0.4)" stroke-width="2" opacity="${opacity}"/>

    <!-- Hood (dark cowl) -->
    <ellipse cx="${hoodCx}" cy="${hoodCy + floatOff + crumbleOff}" rx="${hoodRx}" ry="${hoodRy}"
      fill="rgb(${Math.max(0,pr-5)},${Math.max(0,pg-5)},${Math.max(0,pb-5)})"
      stroke="rgba(${gr},${gg},${gb},0.4)" stroke-width="2"
      opacity="${opacity}"/>

    <!-- Crown glow spikes on hood top -->
    ${[[-16, -22], [-6, -28], [0, -30], [6, -28], [16, -22]].map(([dx, dy]) =>
      `<polygon points="${hoodCx + dx - 3},${crownBase} ${hoodCx + dx},${crownBase + dy} ${hoodCx + dx + 3},${crownBase}"
        fill="rgba(${cr},${cg},${cb},${0.75 * glowPulse})" opacity="${opacity}"/>`
    ).join('\n    ')}

    <!-- Crown band -->
    <rect x="${hoodCx - hoodRx + 4}" y="${crownBase - 2}" width="${(hoodRx - 4) * 2}" height="7" rx="2"
      fill="rgba(${cr},${cg},${cb},0.35)" opacity="${opacity}"/>

    <!-- Skull face (within hood) -->
    <!-- Skull dome -->
    <ellipse cx="${hoodCx}" cy="${skulCy2 - 6}" rx="${skulRx}" ry="${skulRy}"
      fill="rgb(${br},${bg_},${bb})" stroke="rgba(0,0,0,0.3)" stroke-width="1"
      opacity="${opacity}"/>
    <!-- Jaw (lower skull) -->
    <ellipse cx="${hoodCx}" cy="${skulCy2 + skulRy - 6}" rx="${skulRx - 6}" ry="10"
      fill="rgb(${Math.round(br * 0.88)},${Math.round(bg_ * 0.88)},${Math.round(bb * 0.88)})"
      opacity="${opacity}"/>

    <!-- Eye sockets (glowing void) -->
    <ellipse cx="${hoodCx - 11}" cy="${skulCy2 - 8}" rx="9" ry="8"
      fill="rgba(${er},${eg},${eb},${Math.min(1.0, 0.85 * glowPulse)})" opacity="${opacity}"/>
    <ellipse cx="${hoodCx + 11}" cy="${skulCy2 - 8}" rx="9" ry="8"
      fill="rgba(${er},${eg},${eb},${Math.min(1.0, 0.85 * glowPulse)})" opacity="${opacity}"/>
    <!-- Eye socket depth -->
    <ellipse cx="${hoodCx - 11}" cy="${skulCy2 - 8}" rx="5" ry="4.5"
      fill="rgba(0,0,0,0.6)" opacity="${opacity}"/>
    <ellipse cx="${hoodCx + 11}" cy="${skulCy2 - 8}" rx="5" ry="4.5"
      fill="rgba(0,0,0,0.6)" opacity="${opacity}"/>

    <!-- Teeth row -->
    ${Array.from({length: 5}, (_, i) => {
      const tx = hoodCx - 16 + i * 8;
      const ty = skulCy2 + skulRy - 14;
      return `<rect x="${tx}" y="${ty}" width="5" height="8" rx="1"
        fill="rgb(${br},${bg_},${bb})" stroke="rgba(0,0,0,0.3)" stroke-width="0.5"
        opacity="${opacity}"/>`;
    }).join('\n    ')}

    <!-- Nose cavity -->
    <path d="M ${hoodCx - 3} ${skulCy2 + 2} L ${hoodCx} ${skulCy2 + 9} L ${hoodCx + 3} ${skulCy2 + 2}"
      fill="rgba(0,0,0,0.5)" opacity="${opacity}"/>

    <!-- Die crumble particles -->
    ${crumbleOff > 0 ? Array.from({length: 6}, (_, i) => {
      const px = hoodCx + [-50, 55, -30, 40, -10, 20][i];
      const py = skulCy2 + [-30, -20, 30, 50, -55, 35][i] + crumbleOff * 0.5 * i;
      const pr2 = Math.max(1, 5 - frame);
      return `<circle cx="${px}" cy="${py}" r="${pr2}" fill="rgba(${gr},${gg},${gb},0.5)"/>`;
    }).join('\n    ') : ''}
  </svg>`;

  return svg;
}

// ── Per-Mob Generation ────────────────────────────────────────────────────────

/**
 * Generate all animation frame PNGs for one mob.
 * Saves to workspace/maple-sprites/mobs/{mobId}/{state}_{frame}.png
 */
async function generateMobSprites(mobId) {
  const v = MOB_VISUALS[mobId];
  if (!v) throw new Error(`No visual definition for mob ${mobId}`);

  const mobDir = join(SPRITE_DIR, String(mobId));
  mkdirSync(mobDir, { recursive: true });

  const generated = [];

  for (const [state, frameCount] of Object.entries(v.states)) {
    for (let frame = 0; frame < frameCount; frame++) {
      let svgStr;
      if (mobId === 9901001) {
        svgStr = buildCryptShadeSvg(state, frame);
      } else if (mobId === 9901002) {
        svgStr = buildLichSvg(state, frame);
      } else {
        throw new Error(`No SVG builder for mob ${mobId}`);
      }

      const buf = await sharp(Buffer.from(svgStr))
        .resize(v.w, v.h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();

      const pngPath = join(mobDir, `${state}_${frame}.png`);
      writeFileSync(pngPath, buf);
      generated.push(`${state}/${frame}`);
      log.debug(`Generated ${mobId}/${state}/${frame} → ${pngPath}`);
    }
  }

  log.info(`Mob ${mobId} (${v.name}): generated ${generated.length} frames`);
  return { mobId, name: v.name, framesGenerated: generated.length, frames: generated };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate sprites for all custom dungeon mobs.
 */
export async function generateAllMobSprites() {
  const results = [];
  let totalFrames = 0;

  for (const mobId of Object.keys(MOB_VISUALS).map(Number)) {
    try {
      const r = await generateMobSprites(mobId);
      results.push({ ...r, success: true });
      totalFrames += r.framesGenerated;
    } catch (err) {
      log.error(`Failed to generate sprites for mob ${mobId}: ${err.message}`);
      results.push({ mobId, success: false, error: err.message });
    }
  }

  return {
    success: true,
    mobs: results,
    totalFrames,
    summary: `Generated ${totalFrames} frames across ${results.length} mobs`,
    outputDir: SPRITE_DIR,
  };
}

/**
 * Check which mob sprites have been generated.
 */
export function getMobSpriteStatus() {
  return Object.entries(MOB_VISUALS).map(([mobIdStr, v]) => {
    const mobId  = Number(mobIdStr);
    const mobDir = join(SPRITE_DIR, mobIdStr);

    const stateStatus = {};
    let totalFrames = 0;
    let doneFrames  = 0;

    for (const [state, frameCount] of Object.entries(v.states)) {
      const frames = [];
      for (let i = 0; i < frameCount; i++) {
        const p = join(mobDir, `${state}_${i}.png`);
        const exists = existsSync(p);
        frames.push({ frame: i, exists });
        totalFrames++;
        if (exists) doneFrames++;
      }
      stateStatus[state] = { frameCount, frames, allDone: frames.every(f => f.exists) };
    }

    const allDone = doneFrames === totalFrames;
    return {
      mobId,
      name: v.name,
      type: v.type,
      doneFrames,
      totalFrames,
      allDone,
      states: stateStatus,
    };
  });
}

/**
 * Pack all generated mob sprite PNGs into the v83 client Mob.wz binary
 * via harepacker-mcp. Injects canvas nodes for each animation state/frame.
 */
export async function packAllMobSpritesToWz() {
  const WZ_CLIENT_MOB = join(process.cwd(), 'workspace', 'v83-client', '83', 'Mob.wz');
  const IMG_DATA_MOB  = join(process.cwd(), 'workspace', 'v83-img-data', 'Mob');

  const results = [];

  for (const [mobIdStr, v] of Object.entries(MOB_VISUALS)) {
    const mobDir = join(SPRITE_DIR, mobIdStr);
    const mobResults = { mobId: Number(mobIdStr), name: v.name, states: {}, errors: [] };

    for (const [state, frameCount] of Object.entries(v.states)) {
      const frameResults = [];

      for (let frame = 0; frame < frameCount; frame++) {
        const pngPath = join(mobDir, `${state}_${frame}.png`);
        if (!existsSync(pngPath)) {
          mobResults.errors.push(`Missing: ${state}/${frame}`);
          continue;
        }

        try {
          // Read PNG as base64 for harepacker-mcp
          const pngBuf = readFileSync(pngPath);
          const b64    = pngBuf.toString('base64');

          // Inject into v83-img-data Mob binary via harepacker
          await callTool('harepacker-mcp', 'set_canvas_bitmap', {
            imagePath: `${mobIdStr}.img/${state}/${frame}`,
            bitmapData: b64,
          });

          frameResults.push({ frame, success: true });
          log.info(`Packed mob ${mobIdStr}/${state}/${frame}`);
        } catch (err) {
          frameResults.push({ frame, success: false, error: err.message });
          mobResults.errors.push(`${state}/${frame}: ${err.message}`);
          log.warn(`Pack error mob ${mobIdStr}/${state}/${frame}: ${err.message}`);
        }
      }

      mobResults.states[state] = frameResults;
    }

    results.push(mobResults);
  }

  const totalPacked  = results.flatMap(r => Object.values(r.states).flat()).filter(f => f.success).length;
  const totalAttempt = results.flatMap(r => Object.values(r.states).flat()).length;

  return {
    success: true,
    results,
    summary: `Packed ${totalPacked}/${totalAttempt} frames into v83 client Mob.wz`,
    note: 'Client restart required to see changes in-game',
  };
}
