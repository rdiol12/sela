/**
 * Replace old sprites with new Ludo AI generateWithStyle sprites.
 * Copies from ludo-regen/ into proper NPC/class/item directories.
 */
import fs from 'fs';
import path from 'path';

const REGEN_DIR = 'workspace/maple-sprites/ludo-regen';
const NPC_DIR = 'workspace/maple-sprites/custom-npcs';
const CLASS_DIR = 'workspace/maple-sprites/class-selection';

let replaced = 0;

// Replace NPC sprites (portrait + stand_0)
const npcIds = [
  '9999001', '9999002', '9999003', '9999004', '9999005',
  '9999006', '9999007', '9999008', '9999009', '9999010',
  '9999020', '9999021', '9999030',
  '9990010', '9990011', '9990012', '9990013', '9990014',
];

for (const id of npcIds) {
  // Find the matching regen file
  const regenFile = fs.readdirSync(REGEN_DIR).find(f => f.includes(`_${id}_`));
  if (!regenFile) { console.log(`[SKIP] No regen file for NPC ${id}`); continue; }

  const src = path.join(REGEN_DIR, regenFile);
  const npcDir = path.join(NPC_DIR, id);
  fs.mkdirSync(npcDir, { recursive: true });

  // Replace portrait.png and stand_0.png with the new sprite
  for (const target of ['portrait.png', 'stand_0.png']) {
    const dst = path.join(npcDir, target);
    fs.copyFileSync(src, dst);
    replaced++;
  }
  console.log(`[OK] NPC ${id} — ${regenFile}`);
}

// Replace class portraits
for (const cls of ['sage', 'necromancer']) {
  const regenFile = fs.readdirSync(REGEN_DIR).find(f => f.includes(`class_${cls}_portrait`));
  if (!regenFile) { console.log(`[SKIP] No regen file for class ${cls}`); continue; }

  const src = path.join(REGEN_DIR, regenFile);
  const clsDir = path.join(CLASS_DIR, cls);
  fs.mkdirSync(clsDir, { recursive: true });

  fs.copyFileSync(src, path.join(clsDir, 'portrait.png'));
  replaced++;
  console.log(`[OK] Class ${cls} portrait`);
}

console.log(`\nDone! Replaced ${replaced} sprite files.`);
