/**
 * modules/maplestory/blueprint-crafting.js
 * Blueprint Weapon Crafting System — Full Server Feature (goal 898fff62)
 *
 * Design:
 *   - 7 job tracks × 10 tiers = 70 craftable weapons
 *   - Each weapon has a Blueprint item that drops from mobs
 *   - Blacksmith NPCs (one per job) consume blueprint + mesos to craft
 *   - Tiers scale from lv10 (starter) to lv100 (endgame equivalent)
 *
 * IDs allocated:
 *   Weapons:  1302200–1302209 (warrior), 1372150–1372159 (mage),
 *             1452150–1452159 (bowman),  1332150–1332159 (thief),
 *             1492150–1492159 (pirate),  1382150–1382159 (sage),
 *             1372200–1372209 (necromancer)
 *   Blueprints: 4032200–4032269 (10 per job, same order)
 *   NPCs:     9999032–9999038 (one per job)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const COSMIC_ROOT = join(process.cwd(), 'workspace', 'Cosmic');
const WZ_ROOT     = join(COSMIC_ROOT, 'wz');

// ── Per-tier crafting material requirements ───────────────────────────────────
// Uses real v83 etc items that drop from normal mobs in each level range.
// tier index 0-9 maps to BLUEPRINT_TIERS[0-9] (levels 10-100).

export const TIER_MATERIALS = [
  { itemId: 4000001, name: 'Snail Shell',      qty: 5  }, // tier 1  lv10  (snails/blue snails)
  { itemId: 4000001, name: 'Snail Shell',      qty: 10 }, // tier 2  lv20  (snails/blue snails)
  { itemId: 4000003, name: 'Blue Snail Shell', qty: 5  }, // tier 3  lv30  (blue snails)
  { itemId: 4000021, name: 'Leather',          qty: 5  }, // tier 4  lv40  (pigs/boars)
  { itemId: 4000021, name: 'Leather',          qty: 10 }, // tier 5  lv50  (pigs/boars)
  { itemId: 4010000, name: 'Garnet',           qty: 3  }, // tier 6  lv60  (ore veins, lv50+ mobs)
  { itemId: 4010000, name: 'Garnet',           qty: 5  }, // tier 7  lv70  (ore veins)
  { itemId: 4011001, name: 'Steel Plate',      qty: 3  }, // tier 8  lv80  (mid-high mobs)
  { itemId: 4011002, name: 'Mithril Plate',    qty: 3  }, // tier 9  lv90  (high mobs)
  { itemId: 4011004, name: 'Orihalcon Plate',  qty: 3  }, // tier 10 lv100 (endgame mobs/bosses)
];

// ── Tier definitions (level req, base stats, craft cost) ─────────────────────

export const BLUEPRINT_TIERS = [
  { tier: 1,  level: 10,  atkWarr: 25,  atkMage: 22,  atkBow: 24,  atkThief: 23,  atkPirate: 24,  atkSage: 22,  atkNecro: 22,  meso: 10_000 },
  { tier: 2,  level: 20,  atkWarr: 38,  atkMage: 34,  atkBow: 37,  atkThief: 35,  atkPirate: 37,  atkSage: 34,  atkNecro: 34,  meso: 25_000 },
  { tier: 3,  level: 30,  atkWarr: 54,  atkMage: 48,  atkBow: 52,  atkThief: 50,  atkPirate: 52,  atkSage: 48,  atkNecro: 48,  meso: 50_000 },
  { tier: 4,  level: 40,  atkWarr: 70,  atkMage: 63,  atkBow: 68,  atkThief: 65,  atkPirate: 68,  atkSage: 63,  atkNecro: 63,  meso: 90_000 },
  { tier: 5,  level: 50,  atkWarr: 88,  atkMage: 79,  atkBow: 85,  atkThief: 82,  atkPirate: 85,  atkSage: 79,  atkNecro: 79,  meso: 140_000 },
  { tier: 6,  level: 60,  atkWarr: 108, atkMage: 97,  atkBow: 104, atkThief: 100, atkPirate: 104, atkSage: 97,  atkNecro: 97,  meso: 210_000 },
  { tier: 7,  level: 70,  atkWarr: 130, atkMage: 117, atkBow: 126, atkThief: 121, atkPirate: 126, atkSage: 117, atkNecro: 117, meso: 300_000 },
  { tier: 8,  level: 80,  atkWarr: 155, atkMage: 139, atkBow: 150, atkThief: 144, atkPirate: 150, atkSage: 139, atkNecro: 139, meso: 420_000 },
  { tier: 9,  level: 90,  atkWarr: 182, atkMage: 163, atkBow: 176, atkThief: 169, atkPirate: 176, atkSage: 163, atkNecro: 163, meso: 570_000 },
  { tier: 10, level: 100, atkWarr: 212, atkMage: 190, atkBow: 205, atkThief: 197, atkPirate: 205, atkSage: 190, atkNecro: 190, meso: 750_000 },
];

// ── Job track definitions ─────────────────────────────────────────────────────

export const BLUEPRINT_JOBS = [
  {
    job: 'warrior',
    label: 'Warrior',
    atkKey: 'atkWarr',
    weaponType: 'sword',  // equip type 1302
    weaponBase: 1302200,
    bpBase: 4032200,
    npcId: 9999032,
    npcName: 'Garvan the Ironsmith',
    npcDesc: 'A dwarven-built forge master who crafts weapons from ancient schematics.',
    weaponNames: [
      'Iron Shard Blade', 'Coppervein Sword', 'Ashforged Longsword',
      'Stonecrest Claymore', 'Deepvein Sabre', 'Runecut Blade',
      'Tempered War Blade', 'Vaultbreaker Sword', 'Ironveil Greatsword',
      'Forge-Eternal Blade',
    ],
    bpDropMobs: [100100, 100110, 1210100, 1210101, 1210102, 2000000, 2000001, 2010000, 2010001, 4230101],
    bpDropChance: 150_000, // 1.5%
  },
  {
    job: 'mage',
    label: 'Mage',
    atkKey: 'atkMage',
    weaponType: 'staff',  // equip type 1372
    weaponBase: 1372150,
    bpBase: 4032210,
    npcId: 9999033,
    npcName: 'Sera the Arcanist',
    npcDesc: 'An elven enchantress who binds arcane energy into hand-crafted staves.',
    weaponNames: [
      'Dustwood Wand', 'Amber Rod', 'Cerulean Staff',
      'Mystic Bough', 'Voidtipped Wand', 'Runeglass Staff',
      'Arcane Conductor', 'Spellfused Rod', 'Aetherspire Staff',
      'Eternal Prism Staff',
    ],
    bpDropMobs: [100130, 100140, 1210106, 1210110, 2230106, 3000000, 3000005, 5100000, 5100003, 6090000],
    bpDropChance: 150_000,
  },
  {
    job: 'bowman',
    label: 'Bowman',
    atkKey: 'atkBow',
    weaponType: 'bow',    // equip type 1452
    weaponBase: 1452150,
    bpBase: 4032220,
    npcId: 9999034,
    npcName: 'Brin the Fletchmaster',
    npcDesc: 'A ranger-trained craftsman who builds precision bows from rare wood.',
    weaponNames: [
      'Splinter Bow', 'Rivenbark Shortbow', 'Ashwood Recurve',
      'Swiftdraw Longbow', 'Thornstring Bow', 'Galeshot Bow',
      'Windshear Longbow', 'Marrow Recurve', 'Stormflight Bow',
      'Apex Longbow',
    ],
    bpDropMobs: [100120, 100140, 1210100, 2000000, 2300100, 4000000, 4000005, 5100003, 6090001, 7000000],
    bpDropChance: 150_000,
  },
  {
    job: 'thief',
    label: 'Thief',
    atkKey: 'atkThief',
    weaponType: 'dagger', // equip type 1332
    weaponBase: 1332150,
    bpBase: 4032230,
    npcId: 9999035,
    npcName: 'Mara the Shadowsmith',
    npcDesc: 'A fence-turned-artisan who shapes daggers for those who prefer shadows.',
    weaponNames: [
      'Shank Dagger', 'Dustkiss Dirk', 'Copperpoint Dagger',
      'Viper Stiletto', 'Widow Fang Dagger', 'Shroudcut Dirk',
      'Obsidian Edge', 'Wraithstep Dagger', 'Soulslip Dirk',
      'Void Fang Dagger',
    ],
    bpDropMobs: [100130, 110100, 1210106, 2040204, 3110301, 4000000, 4000001, 6230300, 7130001, 9420511],
    bpDropChance: 150_000,
  },
  {
    job: 'pirate',
    label: 'Pirate',
    atkKey: 'atkPirate',
    weaponType: 'knuckle', // equip type 1492
    weaponBase: 1492150,
    bpBase: 4032240,
    npcId: 9999036,
    npcName: 'Cordell the Brawler',
    npcDesc: 'A retired sea-fighter who hammers out knuckledusters from salvaged ship iron.',
    weaponNames: [
      'Driftwood Knuckle', 'Ironport Fist', 'Barnacled Knuckle',
      'Stormhaven Crusher', 'Tidelock Knuckle', 'Deepsea Brawler',
      'Wavecrest Knuckle', 'Kraken Grip', 'Maelstrom Fist',
      'Abyssal Knuckle',
    ],
    bpDropMobs: [100120, 1210102, 2040311, 3000000, 4000002, 5100003, 6090500, 7130001, 8140000, 9420511],
    bpDropChance: 150_000,
  },
  {
    job: 'sage',
    label: 'Sage',
    atkKey: 'atkSage',
    weaponType: 'staff',  // equip type 1382 (custom Sage staff range)
    weaponBase: 1382150,
    bpBase: 4032250,
    npcId: 9999037,
    npcName: 'Ysolde the Lorekeeper',
    npcDesc: 'Guardian of forgotten ley-line knowledge who inscribes power into elemental staves.',
    weaponNames: [
      'Leyrite Twig', 'Verdant Cane', 'Earthchannel Staff',
      'Glyphwood Rod', 'Runebark Staff', 'Leygate Conductor',
      'Aether Spire', 'Ruinbind Staff', 'Leyspire of Ages',
      'Timeless Convergence Staff',
    ],
    bpDropMobs: [9901001, 9901010, 9901020, 9901030, 9901050, 9901080, 9901100, 9901120, 9901140, 9901160],
    bpDropChance: 200_000, // 2% — custom maps have fewer mob varieties
  },
  {
    job: 'necromancer',
    label: 'Necromancer',
    atkKey: 'atkNecro',
    weaponType: 'staff',  // equip type 1372 (shares mage staff range, different IDs)
    weaponBase: 1372200,
    bpBase: 4032260,
    npcId: 9999038,
    npcName: 'Ossifer Krell',
    npcDesc: 'A skeletal artificer preserved in the Shadow Crypts who forges weapons from bone and shadow.',
    weaponNames: [
      'Bone Shard Wand', 'Grave Hollow Staff', 'Ashbone Rod',
      'Soul Splint Staff', 'Wailing Wand', 'Boneweave Staff',
      'Deathwhisper Rod', 'Voidmarrow Staff', 'Soulreaper Staff',
      'Lich Eternal Staff',
    ],
    bpDropMobs: [9901001, 8140000, 8140500, 8142000, 8143000, 8140001, 8142001, 8143001, 8140010, 8143010],
    bpDropChance: 200_000,
  },
];

// ── Weapon XML template generator ────────────────────────────────────────────

function weaponXml(itemId, name, attack, level, weaponTypePrefix) {
  const twoHanded = ['1302', '1382', '1372', '1452', '1492'].some(p => String(itemId).startsWith(p));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<imgdir name="${itemId}.img">
  <imgdir name="info">
    <int name="islot" value="0"/>
    <int name="vslot" value="0"/>
    <int name="attack" value="${attack}"/>
    <int name="attackSpeed" value="4"/>
    <int name="reqLevel" value="${level}"/>
    <int name="reqSTR" value="0"/>
    <int name="reqDEX" value="0"/>
    <int name="reqINT" value="0"/>
    <int name="reqLUK" value="0"/>
    <int name="twoHanded" value="${twoHanded ? 1 : 0}"/>
    <int name="price" value="0"/>
    <int name="notSale" value="1"/>
    <int name="only" value="0"/>
    <int name="quest" value="0"/>
    <int name="maxStar" value="5"/>
    <string name="iSlot" value="Wp"/>
    <string name="vSlot" value="Wp"/>
  </imgdir>
  <imgdir name="0">
    <imgdir name="0"/>
  </imgdir>
</imgdir>`;
}

// ── Blueprint (Etc item) XML template ─────────────────────────────────────────

function blueprintXml(bpId, weaponName, jobLabel, tier, level) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<imgdir name="${bpId}.img">
  <imgdir name="info">
    <int name="slotMax" value="10"/>
    <int name="price" value="0"/>
    <int name="notSale" value="1"/>
    <int name="quest" value="0"/>
    <int name="cash" value="0"/>
  </imgdir>
</imgdir>`;
}

// ── Deploy weapon WZ XML files ────────────────────────────────────────────────

export function deployBlueprintWeapons() {
  const results = [];
  for (const jobDef of BLUEPRINT_JOBS) {
    const wzTypeDir = join(WZ_ROOT, 'Character.wz', 'Weapon');
    if (!existsSync(wzTypeDir)) mkdirSync(wzTypeDir, { recursive: true });

    for (let i = 0; i < 10; i++) {
      const tier     = BLUEPRINT_TIERS[i];
      const itemId   = jobDef.weaponBase + i;
      const name     = jobDef.weaponNames[i];
      const attack   = tier[jobDef.atkKey];
      const level    = tier.level;
      const outPath  = join(wzTypeDir, `${itemId}.img.xml`);
      const xml      = weaponXml(itemId, name, attack, level, jobDef.weaponType);
      writeFileSync(outPath, xml, 'utf8');
      results.push({ itemId, name, attack, level, path: outPath });
    }
  }
  return { deployed: results.length, results };
}

// ── Deploy blueprint Etc WZ XML files ─────────────────────────────────────────

export function deployBlueprintItems() {
  const results = [];
  const etcDir = join(WZ_ROOT, 'Item.wz', 'Etc');
  if (!existsSync(etcDir)) mkdirSync(etcDir, { recursive: true });

  for (const jobDef of BLUEPRINT_JOBS) {
    for (let i = 0; i < 10; i++) {
      const tier     = BLUEPRINT_TIERS[i];
      const bpId     = jobDef.bpBase + i;
      const name     = jobDef.weaponNames[i];
      const outPath  = join(etcDir, `${bpId}.img.xml`);
      const xml      = blueprintXml(bpId, name, jobDef.label, i + 1, tier.level);
      writeFileSync(outPath, xml, 'utf8');
      results.push({ bpId, name, path: outPath });
    }
  }
  return { deployed: results.length, results };
}

// ── Deploy String.wz Eqp entries for weapons ─────────────────────────────────

export function deployBlueprintStrings() {
  const eqpPath = join(WZ_ROOT, 'String.wz', 'Eqp.img.xml');
  if (!existsSync(eqpPath)) return { ok: false, error: 'Eqp.img.xml not found at ' + eqpPath };

  let xml = readFileSync(eqpPath, 'utf8');
  const newEntries = [];

  for (const jobDef of BLUEPRINT_JOBS) {
    for (let i = 0; i < 10; i++) {
      const itemId = jobDef.weaponBase + i;
      const name   = jobDef.weaponNames[i];
      const tier   = BLUEPRINT_TIERS[i];
      const desc   = `A ${jobDef.label} weapon crafted from blueprints. Requires level ${tier.level}.`;
      if (!xml.includes(`name="${itemId}"`)) {
        newEntries.push(
          `    <imgdir name="${itemId}">\n` +
          `      <string name="name" value="${name}"/>\n` +
          `      <string name="desc" value="${desc}"/>\n` +
          `    </imgdir>`
        );
      }
    }
  }

  if (newEntries.length === 0) return { ok: true, added: 0, note: 'All weapon strings already present' };

  // Insert before closing </imgdir> of the Weapon section or top-level </imgdir>
  const insertMarker = '</imgdir>\n</imgdir>';
  const insertBefore = xml.lastIndexOf('</imgdir>');
  xml = xml.slice(0, insertBefore) + newEntries.join('\n') + '\n' + xml.slice(insertBefore);
  writeFileSync(eqpPath, xml, 'utf8');
  return { ok: true, added: newEntries.length };
}

// ── Deploy String.wz Etc entries for blueprints ───────────────────────────────

export function deployBlueprintEtcStrings() {
  const etcStringPath = join(WZ_ROOT, 'String.wz', 'Etc.img.xml');
  if (!existsSync(etcStringPath)) return { ok: false, error: 'Etc.img.xml not found at ' + etcStringPath };

  let xml = readFileSync(etcStringPath, 'utf8');
  const newEntries = [];

  for (const jobDef of BLUEPRINT_JOBS) {
    for (let i = 0; i < 10; i++) {
      const bpId   = jobDef.bpBase + i;
      const name   = `${jobDef.weaponNames[i]} Blueprint`;
      const tier   = BLUEPRINT_TIERS[i];
      const desc   = `A crafting blueprint for a Tier ${i + 1} ${jobDef.label} weapon (lv${tier.level}). Bring this and ${(tier.meso / 1000).toFixed(0)}k mesos to a blacksmith.`;
      if (!xml.includes(`name="${bpId}"`)) {
        newEntries.push(
          `    <imgdir name="${bpId}">\n` +
          `      <string name="name" value="${name}"/>\n` +
          `      <string name="desc" value="${desc}"/>\n` +
          `    </imgdir>`
        );
      }
    }
  }

  if (newEntries.length === 0) return { ok: true, added: 0, note: 'All blueprint strings already present' };

  const insertBefore = xml.lastIndexOf('</imgdir>');
  xml = xml.slice(0, insertBefore) + newEntries.join('\n') + '\n' + xml.slice(insertBefore);
  writeFileSync(etcStringPath, xml, 'utf8');
  return { ok: true, added: newEntries.length };
}

// ── Deploy String.wz NPC entries for blacksmiths ─────────────────────────────

export function deployBlacksmithNpcStrings() {
  const npcStringPath = join(WZ_ROOT, 'String.wz', 'Npc.img.xml');
  if (!existsSync(npcStringPath)) return { ok: false, error: 'Npc.img.xml not found at ' + npcStringPath };

  let xml = readFileSync(npcStringPath, 'utf8');
  const newEntries = [];

  for (const jobDef of BLUEPRINT_JOBS) {
    if (!xml.includes(`name="${jobDef.npcId}"`)) {
      newEntries.push(
        `  <imgdir name="${jobDef.npcId}">\n` +
        `    <string name="name" value="${jobDef.npcName}"/>\n` +
        `    <string name="func" value="Blacksmith"/>\n` +
        `    <string name="desc" value="${jobDef.npcDesc}"/>\n` +
        `  </imgdir>`
      );
    }
  }

  if (newEntries.length === 0) return { ok: true, added: 0, note: 'All blacksmith NPC strings already present' };

  const insertBefore = xml.lastIndexOf('</imgdir>');
  xml = xml.slice(0, insertBefore) + newEntries.join('\n') + '\n' + xml.slice(insertBefore);
  writeFileSync(npcStringPath, xml, 'utf8');
  return { ok: true, added: newEntries.length };
}

// ── Reusable Blacksmith NPC script generator ──────────────────────────────────
//
// Exported so any module can generate a crafting NPC script for any weapon set.
// This is the canonical template for ALL blueprint crafting NPCs on the server.
//
// @param {object} config
//   npcId    {number} — NPC ID (for the script header comment)
//   npcName  {string} — Display name used in dialogue
//   npcDesc  {string} — Personality description for the opening line
//   label    {string} — Job/class label ("Warrior", "Necromancer", etc.)
//   weapons  {Array}  — One entry per craftable weapon:
//     { bpId, weaponId, name, tier, level, atk, meso,
//       material: { itemId, name, qty } | null }
//
// @returns {string} Complete NPC JavaScript source ready to write to scripts/npc/
//
export function generateBlacksmithNpcScript(config) {
  const { npcId, npcName, npcDesc, label, weapons } = config;

  // Serialise weapon data as inline JS object literal (no JSON.parse needed in script)
  const weaponDataLines = weapons.map(w => {
    const matStr = w.material
      ? `{ itemId: ${w.material.itemId}, name: "${w.material.name}", qty: ${w.material.qty} }`
      : 'null';
    return (
      `{ bpId: ${w.bpId}, weaponId: ${w.weaponId}, name: "${w.name}", ` +
      `tier: ${w.tier}, level: ${w.level}, atk: ${w.atk}, meso: ${w.meso}, mat: ${matStr} }`
    );
  }).join(',\n    ');

  // Inline opening text so we don't embed JS template literals inside a template literal
  const openingText = npcDesc
    ? `*${npcName}: ${npcDesc}*\\r\\n\\r\\nShow me a #bBlueprint#k and the required materials — I'll forge the weapon.\\r\\n\\r\\n`
    : `*${npcName} eyes your equipment with a craftsman's precision.*\\r\\n\\r\\nBring a #bBlueprint#k and the required materials and I will forge a weapon worthy of a ${label}.\\r\\n\\r\\n`;

  return `/**
 * @NPC:     ${npcName} (${npcId})
 * @Purpose: Blueprint weapon crafting — ${label} class
 * @Handles: Tiers 1-10, levels 10-100
 * @Recipe:  Blueprint + crafting materials + mesos → crafted weapon
 * @Generated: generateBlacksmithNpcScript() — blueprint-crafting.js
 */

var status = -1;
var selectedIdx = -1;

var WEAPONS = [
    ${weaponDataLines}
];

function start() {
    status = -1;
    action(1, 0, 0);
}

function action(mode, type, selection) {
    if (mode == -1) { cm.dispose(); return; }
    if (mode == 0 && status == 0) { cm.dispose(); return; }
    if (mode == 1) status++;
    else status--;

    if (status == 0) {
        // Build crafting menu — mark entries green if craftable, grey if missing materials
        var menu = "${openingText}";
        for (var i = 0; i < WEAPONS.length; i++) {
            var w = WEAPONS[i];
            var hasBp  = cm.haveItem(w.bpId);
            var hasMat = w.mat == null || cm.haveItem(w.mat.itemId, w.mat.qty);
            var canCraft = hasBp && hasMat && cm.getMeso() >= w.meso;
            var mark = canCraft ? "#b" : (hasBp ? "#i" : "#d");
            var matLine = w.mat ? " + " + w.mat.qty + "x " + w.mat.name : "";
            menu += "#L" + i + "#" + mark + "T" + w.tier + " " + w.name
                 + " (lv" + w.level + ", +" + w.atk + " atk)"
                 + " — " + (w.meso/1000) + "k" + matLine
                 + "#k#l\\r\\n";
        }
        cm.sendSimple(menu);

    } else if (status == 1) {
        selectedIdx = selection;
        var w = WEAPONS[selectedIdx];

        // --- Validate all requirements ---
        if (!cm.haveItem(w.bpId)) {
            cm.sendOk("You are missing the #b" + w.name + " Blueprint#k.\\r\\nFind it as a drop from the relevant monsters first.");
            cm.dispose();
            return;
        }
        if (w.mat != null && !cm.haveItem(w.mat.itemId, w.mat.qty)) {
            var have = cm.itemQuantity ? cm.itemQuantity(w.mat.itemId) : "?";
            cm.sendOk("You need #b" + w.mat.qty + "x " + w.mat.name + "#k to forge this weapon.\\r\\nYou currently have: " + have + "/" + w.mat.qty + ".");
            cm.dispose();
            return;
        }
        if (cm.getMeso() < w.meso) {
            cm.sendOk("The forge fee for #b" + w.name + "#k is #b" + w.meso + " mesos#k.\\r\\nYou have " + cm.getMeso() + " — come back with enough.");
            cm.dispose();
            return;
        }

        // Confirmation with full recipe
        var recipe = "Blueprint: 1x " + w.name + " Blueprint\\r\\n";
        if (w.mat != null) recipe += "Materials: " + w.mat.qty + "x " + w.mat.name + "\\r\\n";
        recipe += "Forge fee: " + (w.meso/1000) + "k mesos";
        cm.sendYesNo("I can forge #b" + w.name + "#k (lv" + w.level + ", +" + w.atk + " atk).\\r\\n\\r\\nRecipe:\\r\\n" + recipe + "\\r\\n\\r\\nProceed?");

    } else if (status == 2) {
        if (mode == 1) {
            var w = WEAPONS[selectedIdx];
            cm.gainItem(w.bpId, -1);
            if (w.mat != null) cm.gainItem(w.mat.itemId, -w.mat.qty);
            cm.gainMeso(-w.meso);
            cm.gainItem(w.weaponId, 1);
            cm.sendOk("*The forge ignites. The blueprint dissolves into the metal.*\\r\\n\\r\\nYour #b" + w.name + "#k is ready. It was forged to last — treat it accordingly.");
        } else {
            cm.sendOk("Gather what you need and return. I don't rush good work.");
        }
        cm.dispose();
    }
}
`;
}

// ── Deploy NPC scripts for all blacksmiths ────────────────────────────────────
// opts.force=true  — overwrite existing scripts (regenerate with latest template)

export function deployBlacksmithNpcs({ force = false } = {}) {
  const npcScriptDir = join(COSMIC_ROOT, 'scripts', 'npc');
  if (!existsSync(npcScriptDir)) return { ok: false, error: 'NPC script dir not found: ' + npcScriptDir };

  const results = [];

  for (const jobDef of BLUEPRINT_JOBS) {
    const outPath = join(npcScriptDir, `${jobDef.npcId}.js`);
    if (existsSync(outPath) && !force) {
      results.push({ npcId: jobDef.npcId, status: 'exists' });
      continue;
    }

    // Build weapon config with per-tier material requirements
    const weapons = jobDef.weaponNames.map((wn, i) => {
      const tier = BLUEPRINT_TIERS[i];
      return {
        bpId:     jobDef.bpBase + i,
        weaponId: jobDef.weaponBase + i,
        name:     wn,
        tier:     i + 1,
        level:    tier.level,
        atk:      tier[jobDef.atkKey],
        meso:     tier.meso,
        material: TIER_MATERIALS[i],
      };
    });

    const script = generateBlacksmithNpcScript({
      npcId:   jobDef.npcId,
      npcName: jobDef.npcName,
      npcDesc: jobDef.npcDesc,
      label:   jobDef.label,
      weapons,
    });

    writeFileSync(outPath, script, 'utf8');
    results.push({ npcId: jobDef.npcId, name: jobDef.npcName, status: force && existsSync(outPath) ? 'updated' : 'created', path: outPath });
  }

  return { deployed: results.length, results };
}

// ── Deploy drop table entries ─────────────────────────────────────────────────

export async function deployBlueprintDrops(addDropFn) {
  const results = [];

  for (const jobDef of BLUEPRINT_JOBS) {
    for (let i = 0; i < 10; i++) {
      const bpId   = jobDef.bpBase + i;
      const mobId  = jobDef.bpDropMobs[i];
      const chance = jobDef.bpDropChance;

      try {
        await addDropFn(mobId, bpId, chance, 1, 1);
        results.push({ ok: true,   mobId, bpId, chance });
      } catch (err) {
        results.push({ ok: false,  mobId, bpId, error: err.message });
      }
    }
  }

  const succeeded = results.filter(r => r.ok).length;
  const failed    = results.filter(r => !r.ok).length;
  return { total: results.length, succeeded, failed, results };
}

// ── Master deploy function ────────────────────────────────────────────────────

export async function deployAll(addDropFn, { force_regen = false } = {}) {
  const weaponsResult     = deployBlueprintWeapons();
  const itemsResult       = deployBlueprintItems();
  const weaponStrings     = deployBlueprintStrings();
  const etcStrings        = deployBlueprintEtcStrings();
  const npcStrings        = deployBlacksmithNpcStrings();
  const npcScripts        = deployBlacksmithNpcs({ force: force_regen });
  const dropsResult       = addDropFn ? await deployBlueprintDrops(addDropFn) : { skipped: true };

  return {
    weapons:      weaponsResult,
    items:        itemsResult,
    weaponStr:    weaponStrings,
    etcStr:       etcStrings,
    npcStr:       npcStrings,
    npcScripts:   npcScripts,
    drops:        dropsResult,
    summary: {
      weaponsDeployed:   weaponsResult.deployed,
      itemsDeployed:     itemsResult.deployed,
      npcScripts:        npcScripts.deployed,
      dropsAdded:        dropsResult.succeeded ?? 0,
    },
  };
}

// ── Status / inventory function ───────────────────────────────────────────────

export function getBlueprintStatus() {
  const wzWeaponDir = join(WZ_ROOT, 'Character.wz', 'Weapon');
  const etcDir      = join(WZ_ROOT, 'Item.wz', 'Etc');
  const npcScriptDir = join(COSMIC_ROOT, 'scripts', 'npc');

  const jobStatus = BLUEPRINT_JOBS.map(jobDef => {
    const weaponsPresent = [];
    const itemsPresent   = [];
    const npcsPresent    = [];

    for (let i = 0; i < 10; i++) {
      const weaponPath = join(wzWeaponDir, `${jobDef.weaponBase + i}.img.xml`);
      const bpPath     = join(etcDir, `${jobDef.bpBase + i}.img.xml`);
      const npcPath    = join(npcScriptDir, `${jobDef.npcId}.js`);
      weaponsPresent.push(existsSync(weaponPath));
      itemsPresent.push(existsSync(bpPath));
      if (i === 0) npcsPresent.push(existsSync(npcPath));
    }

    return {
      job:           jobDef.job,
      label:         jobDef.label,
      npcId:         jobDef.npcId,
      npcName:       jobDef.npcName,
      weaponsReady:  weaponsPresent.filter(Boolean).length,
      itemsReady:    itemsPresent.filter(Boolean).length,
      npcScriptReady: npcsPresent[0],
      weaponRange:   `${jobDef.weaponBase}–${jobDef.weaponBase + 9}`,
      bpRange:       `${jobDef.bpBase}–${jobDef.bpBase + 9}`,
    };
  });

  const totalWeapons = jobStatus.reduce((s, j) => s + j.weaponsReady, 0);
  const totalItems   = jobStatus.reduce((s, j) => s + j.itemsReady, 0);
  const totalNpcs    = jobStatus.filter(j => j.npcScriptReady).length;

  return {
    totalJobs:      BLUEPRINT_JOBS.length,
    totalTiers:     BLUEPRINT_TIERS.length,
    totalWeapons:   70,
    totalBlueprints: 70,
    deployed: {
      weapons:  totalWeapons,
      items:    totalItems,
      npcs:     totalNpcs,
    },
    ready: totalWeapons === 70 && totalItems === 70 && totalNpcs === 7,
    jobs: jobStatus,
  };
}

// ── Data accessor (used by index.js tools) ────────────────────────────────────

export function getBlueprintSystem() {
  return {
    tiers: BLUEPRINT_TIERS,
    jobs:  BLUEPRINT_JOBS.map(j => ({
      job:         j.job,
      label:       j.label,
      weaponBase:  j.weaponBase,
      bpBase:      j.bpBase,
      npcId:       j.npcId,
      npcName:     j.npcName,
      weaponNames: j.weaponNames,
      dropMobs:    j.bpDropMobs,
      dropChance:  j.bpDropChance,
    })),
  };
}
