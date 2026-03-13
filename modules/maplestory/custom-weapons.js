/**
 * modules/maplestory/custom-weapons.js — Custom weapon definitions for MapleStory Cosmic.
 *
 * Creates 8 unique weapons covering all job classes (Warrior, Magician, Bowman,
 * Thief, Pirate) with balanced stats for the custom Cosmic server experience.
 * Each weapon has a WZ XML file in Character.wz/Weapon/ and a name entry in
 * String.wz/Eqp.img.xml.
 *
 * Weapon IDs are sequential after the existing max for each weapon type:
 *   01302134  Crystal Fang       1H Sword  Warrior
 *   01382081  Phoenix Staff      Staff     Magician
 *   01452086  Wind Piercer       Bow       Bowman
 *   01332100  Shadow Fang        Dagger    Thief
 *   01492049  Thunder Barrel     Gun       Pirate
 *   01442104  Earth Cleaver      Polearm   Warrior (2H)
 *   01472101  Venom Claw         Claw      Thief
 *   01482047  Iron Fist          Knuckle   Pirate
 */

import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('maplestory:weapons');

const WZ_DIR = join(process.cwd(), 'workspace', 'Cosmic', 'wz');

// ── Weapon Definitions ────────────────────────────────────────────────────────

/**
 * Custom weapon definitions.
 * reqJob bitmask: 1=Warrior 2=Magician 4=Bowman 8=Thief 16=Pirate
 * attackSpeed: 2=Faster, 3=Fast, 4=Fast, 5=Normal, 6=Slow, 7=Slower, 8=Slowest
 * attack (animation): 1=1HSword, 2=Polearm, 3=Bow, 6=Staff/1HBW, 7=Claw, 8=Knuckle, 9=Gun
 */
export const CUSTOM_WEAPONS = [
  {
    id: 1302134,
    fileId: '01302134',
    name: 'Crystal Fang',
    desc: 'A blade forged from enchanted blue crystal. Warriors feel its icy resonance with every strike.',
    type: 'sword1h',
    category: 'Weapon',
    islot: 'Wp',
    vslot: 'Wp',
    walk: 1,
    stand: 1,
    attack: 1,
    afterImage: 'swordOL',
    sfx: 'swordL',
    reqJob: 1,
    reqLevel: 25,
    reqSTR: 80,
    reqDEX: 0,
    reqINT: 0,
    reqLUK: 0,
    incPAD: 55,
    incSTR: 12,
    incACC: 5,
    attackSpeed: 5,
    tuc: 10,
    price: 150000,
  },
  {
    id: 1382081,
    fileId: '01382081',
    name: 'Phoenix Staff',
    desc: 'A blazing staff channelling the spirit of the undying phoenix. Magicians feel power surge with every spell cast.',
    type: 'staff',
    category: 'Weapon',
    islot: 'Wp',
    vslot: 'Wp',
    walk: 1,
    stand: 1,
    attack: 6,
    afterImage: 'mace',
    sfx: 'mace',
    reqJob: 2,
    reqLevel: 25,
    reqSTR: 0,
    reqDEX: 0,
    reqINT: 90,
    reqLUK: 0,
    incPAD: 32,
    incMAD: 65,
    incINT: 12,
    incACC: 5,
    attackSpeed: 6,
    tuc: 10,
    price: 150000,
  },
  {
    id: 1452086,
    fileId: '01452086',
    name: 'Wind Piercer',
    desc: 'A lightweight composite bow strung with enchanted wind-thread. Arrows fly so fast they whistle.',
    type: 'bow',
    category: 'Weapon',
    islot: 'WpSi',
    vslot: 'WpSi',
    walk: 1,
    stand: 1,
    attack: 3,
    afterImage: 'bow',
    sfx: 'bow',
    reqJob: 4,
    reqLevel: 25,
    reqSTR: 0,
    reqDEX: 85,
    reqINT: 0,
    reqLUK: 0,
    incPAD: 50,
    incDEX: 12,
    incACC: 5,
    attackSpeed: 4,
    tuc: 10,
    price: 150000,
  },
  {
    id: 1332100,
    fileId: '01332100',
    name: 'Shadow Fang',
    desc: 'A midnight-black dagger with a serrated edge. In darkness it is almost invisible — perfect for a rogue.',
    type: 'dagger',
    category: 'Weapon',
    islot: 'Wp',
    vslot: 'Wp',
    walk: 1,
    stand: 1,
    attack: 1,
    afterImage: 'swordOS',
    sfx: 'swordS',
    reqJob: 8,
    reqLevel: 25,
    reqSTR: 0,
    reqDEX: 0,
    reqINT: 0,
    reqLUK: 80,
    incPAD: 48,
    incLUK: 8,
    incDEX: 4,
    incACC: 5,
    attackSpeed: 3,
    tuc: 10,
    price: 150000,
  },
  {
    id: 1492049,
    fileId: '01492049',
    name: 'Thunder Barrel',
    desc: 'A heavy flintlock infused with lightning runestones. Each shot crackles with electric energy.',
    type: 'gun',
    category: 'Weapon',
    islot: 'Wp',
    vslot: 'Wp',
    walk: 1,
    stand: 1,
    attack: 9,
    afterImage: 'gun',
    sfx: 'gun',
    reqJob: 16,
    reqLevel: 25,
    reqSTR: 0,
    reqDEX: 70,
    reqINT: 0,
    reqLUK: 0,
    incPAD: 52,
    incDEX: 12,
    incACC: 5,
    attackSpeed: 5,
    tuc: 10,
    price: 150000,
  },
  {
    id: 1442104,
    fileId: '01442104',
    name: 'Earth Cleaver',
    desc: 'A colossal polearm carved from enchanted stone. Its sheer weight crushes enemies with tectonic force.',
    type: 'polearm',
    category: 'Weapon',
    islot: 'Wp',
    vslot: 'Wp',
    walk: 2,
    stand: 2,
    attack: 2,
    afterImage: 'poleArm',
    sfx: 'poleArm',
    reqJob: 1,
    reqLevel: 30,
    reqSTR: 100,
    reqDEX: 0,
    reqINT: 0,
    reqLUK: 0,
    incPAD: 70,
    incSTR: 15,
    incACC: 5,
    attackSpeed: 7,
    tuc: 10,
    price: 180000,
  },
  {
    id: 1472101,
    fileId: '01472101',
    name: 'Venom Claw',
    desc: 'A pair of razor-sharp throwing claws coated in paralytic poison. A single scratch leaves enemies trembling.',
    type: 'claw',
    category: 'Weapon',
    islot: 'Wp',
    vslot: 'Wp',
    walk: 1,
    stand: 1,
    attack: 7,
    afterImage: 'swordOL',
    sfx: 'tGlove',
    reqJob: 8,
    reqLevel: 25,
    reqSTR: 0,
    reqDEX: 0,
    reqINT: 0,
    reqLUK: 75,
    incPAD: 30,
    incLUK: 12,
    incACC: 5,
    attackSpeed: 2,
    tuc: 10,
    price: 150000,
  },
  {
    id: 1482047,
    fileId: '01482047',
    name: 'Iron Fist',
    desc: 'Reinforced knuckle-dusters forged from dark iron. Pirates wearing these hit harder than a cannonball.',
    type: 'knuckle',
    category: 'Weapon',
    islot: 'Wp',
    vslot: 'Wp',
    walk: 1,
    stand: 1,
    attack: 8,
    afterImage: 'knuckle',
    sfx: 'knuckle',
    reqJob: 16,
    reqLevel: 25,
    reqSTR: 60,
    reqDEX: 60,
    reqINT: 0,
    reqLUK: 0,
    incPAD: 45,
    incSTR: 8,
    incDEX: 4,
    incACC: 5,
    attackSpeed: 4,
    tuc: 10,
    price: 150000,
  },
];

// ── XML Generation ────────────────────────────────────────────────────────────

/**
 * Generate the level block (15 upgrade slots with 10000 exp each).
 */
function buildLevelXml() {
  let xml = '    <imgdir name="level">\n      <imgdir name="info">\n';
  for (let i = 1; i <= 15; i++) {
    xml += `        <imgdir name="${i}">\n          <int name="exp" value="10000"/>\n        </imgdir>\n`;
  }
  xml += '      </imgdir>\n    </imgdir>\n';
  return xml;
}

/**
 * Build a weapon XML stat line. Only emits lines that have a non-zero value.
 */
function statLine(type, name, value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number' && value === 0) return '';
  return `    <${type} name="${name}" value="${value}"/>\n`;
}

/**
 * Generate full WZ XML for a weapon definition.
 */
export function buildWeaponXml(w) {
  const lines = [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`,
    `<imgdir name="${w.fileId}.img">\n`,
    `  <imgdir name="info">\n`,
    `    <canvas name="icon" width="29" height="33">\n`,
    `      <vector name="origin" x="0" y="33"/>\n`,
    `    </canvas>\n`,
    `    <canvas name="iconRaw" width="29" height="31">\n`,
    `      <vector name="origin" x="0" y="33"/>\n`,
    `    </canvas>\n`,
    `    <string name="islot" value="${w.islot}"/>\n`,
    `    <string name="vslot" value="${w.vslot}"/>\n`,
    `    <int name="walk" value="${w.walk}"/>\n`,
    `    <int name="stand" value="${w.stand}"/>\n`,
    `    <short name="attack" value="${w.attack}"/>\n`,
    `    <string name="afterImage" value="${w.afterImage}"/>\n`,
    `    <string name="sfx" value="${w.sfx}"/>\n`,
    `    <int name="reqJob" value="${w.reqJob}"/>\n`,
    `    <int name="reqLevel" value="${w.reqLevel}"/>\n`,
    `    <int name="reqSTR" value="${w.reqSTR || 0}"/>\n`,
    `    <int name="reqDEX" value="${w.reqDEX || 0}"/>\n`,
    `    <int name="reqINT" value="${w.reqINT || 0}"/>\n`,
    `    <int name="reqLUK" value="${w.reqLUK || 0}"/>\n`,
    w.incPAD  ? `    <int name="incPAD" value="${w.incPAD}"/>\n`  : '',
    w.incMAD  ? `    <int name="incMAD" value="${w.incMAD}"/>\n`  : '',
    w.incSTR  ? `    <int name="incSTR" value="${w.incSTR}"/>\n`  : '',
    w.incDEX  ? `    <int name="incDEX" value="${w.incDEX}"/>\n`  : '',
    w.incINT  ? `    <int name="incINT" value="${w.incINT}"/>\n`  : '',
    w.incLUK  ? `    <int name="incLUK" value="${w.incLUK}"/>\n`  : '',
    w.incACC  ? `    <int name="incACC" value="${w.incACC}"/>\n`  : '',
    `    <int name="price" value="${w.price}"/>\n`,
    `    <int name="attackSpeed" value="${w.attackSpeed}"/>\n`,
    `    <int name="tuc" value="${w.tuc}"/>\n`,
    `    <int name="cash" value="0"/>\n`,
    `  </imgdir>\n`,
    buildLevelXml(),
    `</imgdir>\n`,
  ];
  return lines.join('');
}

// ── File Deployment ───────────────────────────────────────────────────────────

/**
 * Create the WZ XML file for a weapon.
 * Skips if file already exists (idempotent).
 * Returns { created: true|false, path }
 */
export function createWeaponFile(weapon) {
  const filePath = join(WZ_DIR, 'Character.wz', 'Weapon', `${weapon.fileId}.img.xml`);
  if (existsSync(filePath)) {
    log.debug({ id: weapon.id }, 'Weapon file already exists, skipping');
    return { created: false, path: filePath };
  }
  const xml = buildWeaponXml(weapon);
  writeFileSync(filePath, xml, 'utf-8');
  log.info({ id: weapon.id, name: weapon.name }, 'Created weapon XML file');
  return { created: true, path: filePath };
}

/**
 * Register a weapon's name and description in String.wz/Eqp.img.xml.
 * Inserts just before the closing </imgdir> of the Weapon section.
 * Skips if the entry already exists (idempotent).
 */
export function registerWeaponName(weapon) {
  const eqpFile = join(WZ_DIR, 'String.wz', 'Eqp.img.xml');
  if (!existsSync(eqpFile)) throw new Error('Eqp.img.xml not found');

  let xml = readFileSync(eqpFile, 'utf-8');

  // Already registered?
  if (xml.includes(`<imgdir name="${weapon.id}">`)) {
    log.debug({ id: weapon.id }, 'Weapon name already registered');
    return { registered: false };
  }

  const entry = [
    `      <imgdir name="${weapon.id}">\n`,
    `        <string name="name" value="${weapon.name}"/>\n`,
    `        <string name="desc" value="${weapon.desc}"/>\n`,
    `      </imgdir>\n`,
  ].join('');

  // Find the closing </imgdir> of the Weapon section (right before <imgdir name="Dragon">)
  // The exact separator in the file: "    </imgdir>\r\n    <imgdir name="Dragon">" or LF variant
  const dragonMarker = '<imgdir name="Dragon">';
  const dragonIdx = xml.indexOf(dragonMarker);
  if (dragonIdx === -1) throw new Error('Could not find Dragon section in Eqp.img.xml');

  // Walk backwards from dragonIdx to find the preceding </imgdir> closing tag
  const closingTag = '</imgdir>';
  const closeIdx = xml.lastIndexOf(closingTag, dragonIdx - 1);
  if (closeIdx === -1) throw new Error('Could not find Weapon </imgdir> before Dragon in Eqp.img.xml');

  // Insert our entry just before that closing </imgdir>
  const insertAt = closeIdx;
  xml = xml.slice(0, insertAt) + entry + xml.slice(insertAt);

  writeFileSync(eqpFile, xml, 'utf-8');
  log.info({ id: weapon.id, name: weapon.name }, 'Registered weapon name in Eqp.img.xml');
  return { registered: true };
}

// ── Deploy All ────────────────────────────────────────────────────────────────

/**
 * Deploy all 8 custom weapons:
 * - Creates WZ XML files in Character.wz/Weapon/
 * - Registers names in String.wz/Eqp.img.xml
 *
 * Safe to call multiple times (idempotent).
 * Returns a summary of what was created vs already existed.
 */
export function deployCustomWeapons() {
  const results = [];
  for (const w of CUSTOM_WEAPONS) {
    const fileResult = createWeaponFile(w);
    const nameResult = registerWeaponName(w);
    results.push({
      id: w.id,
      name: w.name,
      type: w.type,
      fileCreated: fileResult.created,
      nameRegistered: nameResult.registered,
    });
  }
  const created = results.filter(r => r.fileCreated).length;
  const nameReg  = results.filter(r => r.nameRegistered).length;
  log.info({ created, nameReg, total: CUSTOM_WEAPONS.length }, 'Custom weapons deployed');
  return {
    success: true,
    total: CUSTOM_WEAPONS.length,
    filesCreated: created,
    namesRegistered: nameReg,
    weapons: results,
    note: created > 0 ? 'Restart server to load new weapons' : 'All weapons already deployed',
  };
}

/**
 * Get status of all custom weapons (which files exist, names registered).
 */
export function getCustomWeaponStatus() {
  const eqpFile = join(WZ_DIR, 'String.wz', 'Eqp.img.xml');
  const eqpXml = existsSync(eqpFile) ? readFileSync(eqpFile, 'utf-8') : '';

  return CUSTOM_WEAPONS.map(w => {
    const filePath = join(WZ_DIR, 'Character.wz', 'Weapon', `${w.fileId}.img.xml`);
    return {
      id: w.id,
      name: w.name,
      type: w.type,
      reqJob: w.reqJob,
      reqLevel: w.reqLevel,
      incPAD: w.incPAD,
      incMAD: w.incMAD,
      fileExists: existsSync(filePath),
      nameRegistered: eqpXml.includes(`<imgdir name="${w.id}">`),
    };
  });
}

/**
 * Check if a given equip ID is one of our custom weapons.
 */
export function isCustomWeapon(id) {
  return CUSTOM_WEAPONS.some(w => w.id === Number(id));
}
