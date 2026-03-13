/**
 * Preview script for Brother Marcus (9999063) sprite
 * Run: node scripts/preview-marcus.mjs
 */
import sharp from 'sharp';
import { writeFileSync } from 'fs';
import { join } from 'path';

const W = 80;
const H = 100;

const marcus = {
  name: 'Brother Marcus',
  role: 'monk',
  desc: 'Wandering monk in saffron robes with a wooden staff and shaved head',
  body:   [200, 130, 40],   // saffron/amber monk robe
  hair:   [190, 155, 115],  // bald — matches skin (shaved)
  skin:   [190, 155, 115],  // warm medium
  accent: [120, 75, 25],    // dark brown rope belt + staff
  hat:    null,
  size:   'slim',
};

function buildSvg(v, frame) {
  const isLarge = v.size === 'large';
  const [br, bg, bb] = v.body;
  const [hr, hg, hb] = v.hair;
  const [sr, sg, sb] = v.skin;
  const [ar, ag, ab] = v.accent;

  const breathY = frame === 1 ? -1 : 0;

  const headR  = 12;
  const headCx = W / 2;
  const headCy = 22 + breathY;

  const bodyX  = 23;
  const bodyW  = 34;
  const bodyY  = headCy + headR + 2;
  const bodyH  = 32;

  const legW   = 11;
  const legH   = 26;
  const legY   = bodyY + bodyH;
  const legLX  = 25;
  const legRX  = W - 25 - legW;

  const armW   = 8;
  const armH   = 26;
  const armY   = bodyY + 4;
  const armLX  = bodyX - armW - 1;
  const armRX  = bodyX + bodyW + 1;

  const footSway = frame === 1 ? 2 : 0;

  // Rope belt accent
  const beltY = bodyY + 14;
  const staffX = armRX + armW + 2;
  const staffTopY = headCy - headR - 10;
  const staffBotY = legY + legH + 2;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" shape-rendering="crispEdges">
  <!-- background transparent -->

  <!-- Staff (wooden stick, right side) -->
  <rect x="${staffX}" y="${staffTopY + breathY}" width="3" height="${staffBotY - staffTopY}"
    fill="rgb(${ar},${ag},${ab})" stroke="rgba(0,0,0,0.5)" stroke-width="0.5"/>

  <!-- Left arm -->
  <rect x="${armLX}" y="${armY + breathY}" width="${armW}" height="${armH}"
    fill="rgb(${br},${bg},${bb})" stroke="rgba(0,0,0,0.4)" stroke-width="1" rx="3"/>

  <!-- Right arm (holds staff) -->
  <rect x="${armRX}" y="${armY + breathY}" width="${armW}" height="${armH - 4}"
    fill="rgb(${br},${bg},${bb})" stroke="rgba(0,0,0,0.4)" stroke-width="1" rx="3"/>

  <!-- Body (robe) -->
  <rect x="${bodyX}" y="${bodyY + breathY}" width="${bodyW}" height="${bodyH}"
    fill="rgb(${br},${bg},${bb})" stroke="rgba(0,0,0,0.5)" stroke-width="1" rx="4"/>

  <!-- Rope belt -->
  <rect x="${bodyX}" y="${beltY + breathY}" width="${bodyW}" height="4" rx="2"
    fill="rgb(${ar},${ag},${ab})" stroke="rgba(0,0,0,0.4)" stroke-width="0.5"/>

  <!-- Left leg -->
  <rect x="${legLX - footSway}" y="${legY}" width="${legW}" height="${legH}"
    fill="rgb(${br - 20},${bg - 10},${bb - 5})" stroke="rgba(0,0,0,0.4)" stroke-width="1" rx="3"/>

  <!-- Right leg -->
  <rect x="${legRX + footSway}" y="${legY}" width="${legW}" height="${legH}"
    fill="rgb(${br - 20},${bg - 10},${bb - 5})" stroke="rgba(0,0,0,0.4)" stroke-width="1" rx="3"/>

  <!-- Head (shaved — same skin tone) -->
  <circle cx="${headCx}" cy="${headCy + breathY}" r="${headR}"
    fill="rgb(${sr},${sg},${sb})" stroke="rgba(0,0,0,0.5)" stroke-width="1"/>

  <!-- Eyes -->
  <ellipse cx="${headCx - 4}" cy="${headCy + 2 + breathY}" rx="2" ry="1.5"
    fill="rgb(50,30,10)"/>
  <ellipse cx="${headCx + 4}" cy="${headCy + 2 + breathY}" rx="2" ry="1.5"
    fill="rgb(50,30,10)"/>

  <!-- Calm smile -->
  <path d="M ${headCx - 4} ${headCy + 6 + breathY} Q ${headCx} ${headCy + 9 + breathY} ${headCx + 4} ${headCy + 6 + breathY}"
    fill="none" stroke="rgb(100,60,40)" stroke-width="1.2" stroke-linecap="round"/>

  <!-- Faint stubble shadow on head (shaved look) -->
  <circle cx="${headCx}" cy="${headCy + breathY}" r="${headR}"
    fill="none" stroke="rgba(100,80,60,0.15)" stroke-width="3"/>
</svg>`;
}

async function main() {
  for (const frame of [0, 1]) {
    const svg = buildSvg(marcus, frame);
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const outPath = join(process.cwd(), `preview-marcus-frame${frame}.png`);
    writeFileSync(outPath, png);
    console.log(`Saved: ${outPath}`);
  }
  console.log('Done. Check preview-marcus-frame0.png and frame1.png');
}

main().catch(console.error);
