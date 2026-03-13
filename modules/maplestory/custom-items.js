/**
 * modules/maplestory/custom-items.js — Custom consumable items for MapleStory Cosmic.
 *
 * Creates 8 unique consumable items: timed buff potions, a large HP/MP restore,
 * and a warp scroll. Items are inserted into the existing WZ XML Consume files
 * rather than creating new files (matching the v83 format).
 *
 * Item IDs used (all free / not in existing data):
 *   2002031  Elixir of Rage       PAD+10 for 180s   → 0200.img.xml
 *   2002032  Mana Crystal         MAD+10 for 180s   → 0200.img.xml
 *   2002033  Iron Shield Scroll   PDD+15 for 300s   → 0200.img.xml
 *   2002034  Swift Boots Potion   Speed+20 for 120s → 0200.img.xml
 *   2002035  Lucky Clover         ACC+15 for 300s   → 0200.img.xml
 *   2002036  Giant's Meat         HP+800 instant    → 0200.img.xml
 *   2002037  Sage Tea             MP+600 instant    → 0200.img.xml
 *   2030021  Return Scroll        Warp to Henesys   → 0203.img.xml
 *
 * Names are registered in String.wz/Consume.img.xml.
 */

import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('maplestory:items');

const WZ_DIR = join(process.cwd(), 'workspace', 'Cosmic', 'wz');

// ── Item Definitions ──────────────────────────────────────────────────────────

/**
 * consumeFile: which 0xxx.img.xml file in Item.wz/Consume/ holds this item
 * spec: the <spec> block fields — pad/mad/pdd/mdd/speed/acc/eva/hp/mp + time (ms)
 * info: extra <info> fields beyond price
 */
export const CUSTOM_ITEMS = [
  {
    id: 2002031,
    consumeFile: '0200',
    name: 'Elixir of Rage',
    desc: 'A crimson potion that supercharges your muscles. Boosts Weapon Attack by 10 for 3 minutes.',
    price: 30000,
    slotMax: 100,
    spec: { pad: 10, time: 180000 },
  },
  {
    id: 2002032,
    consumeFile: '0200',
    name: 'Mana Crystal',
    desc: 'A pulsing blue gem you dissolve in water and drink. Boosts Magic Attack by 10 for 3 minutes.',
    price: 30000,
    slotMax: 100,
    spec: { mad: 10, time: 180000 },
  },
  {
    id: 2002033,
    consumeFile: '0200',
    name: 'Iron Shield Scroll',
    desc: 'A dense grey tonic brewed from iron bark. Greatly increases Weapon Defense for 5 minutes.',
    price: 25000,
    slotMax: 100,
    spec: { pdd: 15, mdd: 10, time: 300000 },
  },
  {
    id: 2002034,
    consumeFile: '0200',
    name: 'Swift Boots Potion',
    desc: 'A fizzing green brew that makes you feel lighter than air. Increases Speed by 20 for 2 minutes.',
    price: 20000,
    slotMax: 100,
    spec: { speed: 20, time: 120000 },
  },
  {
    id: 2002035,
    consumeFile: '0200',
    name: 'Lucky Clover',
    desc: 'A rare four-leaf clover preserved in amber. Increases Accuracy and Avoidability by 15 for 5 minutes.',
    price: 35000,
    slotMax: 100,
    spec: { acc: 15, eva: 15, time: 300000 },
  },
  {
    id: 2002036,
    consumeFile: '0200',
    name: "Giant's Meat",
    desc: "A massive haunch of roasted beast meat, the kind giants favour. Instantly restores 800 HP.",
    price: 15000,
    slotMax: 200,
    spec: { hp: 800 },
  },
  {
    id: 2002037,
    consumeFile: '0200',
    name: 'Sage Tea',
    desc: 'A calming herbal infusion brewed from rare sage leaves. Instantly restores 600 MP.',
    price: 15000,
    slotMax: 200,
    spec: { mp: 600 },
  },
  {
    id: 2030021,
    consumeFile: '0203',
    name: 'Return Scroll',
    desc: 'A mystical scroll that warps you instantly back to Henesys. One-use only.',
    price: 5000,
    slotMax: 100,
    spec: { moveTo: 100000000 },
  },
];

// ── XML Generation ────────────────────────────────────────────────────────────

/**
 * Build the XML block for a single item to be inserted into its consume file.
 * Matches the format used by existing v83 items.
 */
function buildItemXmlBlock(item) {
  const paddedId = String(item.id).padStart(8, '0');

  let infoLines = [
    `      <canvas name="icon" width="27" height="30">\n`,
    `        <vector name="origin" x="-3" y="30"/>\n`,
    `      </canvas>\n`,
    `      <canvas name="iconRaw" width="27" height="27">\n`,
    `        <vector name="origin" x="-3" y="30"/>\n`,
    `      </canvas>\n`,
    `      <int name="price" value="${item.price}"/>\n`,
  ];

  if (item.slotMax && item.slotMax !== 100) {
    infoLines.push(`      <int name="slotMax" value="${item.slotMax}"/>\n`);
  }

  const specEntries = Object.entries(item.spec)
    .map(([k, v]) => `      <int name="${k}" value="${v}"/>\n`)
    .join('');

  return [
    `  <imgdir name="${paddedId}">\n`,
    `    <imgdir name="info">\n`,
    ...infoLines,
    `    </imgdir>\n`,
    `    <imgdir name="spec">\n`,
    specEntries,
    `    </imgdir>\n`,
    `  </imgdir>\n`,
  ].join('');
}

// ── File Injection ────────────────────────────────────────────────────────────

/**
 * Inject a new item entry into an existing Consume WZ XML file.
 * Inserts just before the closing </imgdir> tag of the file's root element.
 * Idempotent — skips if already present.
 */
function injectItemIntoConsumeFile(item) {
  const filePath = join(WZ_DIR, 'Item.wz', 'Consume', `${item.consumeFile}.img.xml`);
  if (!existsSync(filePath)) throw new Error(`Consume file not found: ${item.consumeFile}.img.xml`);

  let xml = readFileSync(filePath, 'utf-8');
  const paddedId = String(item.id).padStart(8, '0');

  // Already injected?
  if (xml.includes(`<imgdir name="${paddedId}">`)) {
    log.debug({ id: item.id }, 'Item already in consume file, skipping');
    return false;
  }

  // Find the last closing </imgdir> (root element close) and insert before it
  const lastClose = xml.lastIndexOf('</imgdir>');
  if (lastClose === -1) throw new Error(`No closing </imgdir> in ${item.consumeFile}.img.xml`);

  const block = buildItemXmlBlock(item);
  xml = xml.slice(0, lastClose) + block + xml.slice(lastClose);

  writeFileSync(filePath, xml, 'utf-8');
  log.info({ id: item.id, name: item.name }, 'Injected item into consume file');
  return true;
}

// ── Name Registration ─────────────────────────────────────────────────────────

/**
 * Register an item's name and description in String.wz/Consume.img.xml.
 * Appends just before the root closing </imgdir>.
 * Idempotent — skips if already present.
 */
function registerItemName(item) {
  const consumeStrFile = join(WZ_DIR, 'String.wz', 'Consume.img.xml');
  if (!existsSync(consumeStrFile)) throw new Error('String.wz/Consume.img.xml not found');

  let xml = readFileSync(consumeStrFile, 'utf-8');

  if (xml.includes(`<imgdir name="${item.id}">`)) {
    log.debug({ id: item.id }, 'Item name already registered');
    return false;
  }

  const entry = [
    `  <imgdir name="${item.id}">\n`,
    `    <string name="name" value="${item.name.replace(/'/g, '&apos;')}"/>\n`,
    `    <string name="desc" value="${item.desc.replace(/'/g, '&apos;').replace(/"/g, '&quot;')}"/>\n`,
    `  </imgdir>\n`,
  ].join('');

  const lastClose = xml.lastIndexOf('</imgdir>');
  if (lastClose === -1) throw new Error('No closing </imgdir> in Consume.img.xml');

  xml = xml.slice(0, lastClose) + entry + xml.slice(lastClose);
  writeFileSync(consumeStrFile, xml, 'utf-8');
  log.info({ id: item.id, name: item.name }, 'Registered item name in Consume.img.xml');
  return true;
}

// ── Deploy All ────────────────────────────────────────────────────────────────

/**
 * Deploy all 8 custom items:
 * - Injects XML blocks into Item.wz/Consume/0200.img.xml and 0203.img.xml
 * - Registers names in String.wz/Consume.img.xml
 *
 * Safe to call multiple times (idempotent).
 */
export function deployCustomItems() {
  const results = [];
  for (const item of CUSTOM_ITEMS) {
    const injected = injectItemIntoConsumeFile(item);
    const named = registerItemName(item);
    results.push({
      id: item.id,
      name: item.name,
      file: item.consumeFile,
      injected,
      named,
    });
  }
  const newItems = results.filter(r => r.injected).length;
  const newNames = results.filter(r => r.named).length;
  log.info({ newItems, newNames, total: CUSTOM_ITEMS.length }, 'Custom items deployed');
  return {
    success: true,
    total: CUSTOM_ITEMS.length,
    itemsInjected: newItems,
    namesRegistered: newNames,
    items: results,
    note: newItems > 0 ? 'Restart server to load new items' : 'All items already deployed',
  };
}

/**
 * Check deployment status for all custom items.
 */
export function getCustomItemStatus() {
  const consumeStrFile = join(WZ_DIR, 'String.wz', 'Consume.img.xml');
  const strXml = existsSync(consumeStrFile) ? readFileSync(consumeStrFile, 'utf-8') : '';

  return CUSTOM_ITEMS.map(item => {
    const filePath = join(WZ_DIR, 'Item.wz', 'Consume', `${item.consumeFile}.img.xml`);
    const fileXml = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
    const paddedId = String(item.id).padStart(8, '0');

    return {
      id: item.id,
      name: item.name,
      file: `${item.consumeFile}.img.xml`,
      spec: item.spec,
      injected: fileXml.includes(`<imgdir name="${paddedId}">`),
      named: strXml.includes(`<imgdir name="${item.id}">`),
    };
  });
}

/**
 * Check if a given item ID is one of our custom items.
 */
export function isCustomItem(id) {
  return CUSTOM_ITEMS.some(i => i.id === Number(id));
}
