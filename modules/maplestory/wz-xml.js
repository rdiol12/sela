/**
 * modules/maplestory/wz-xml.js — WZ XML data tools for MapleStory Cosmic.
 *
 * Provides high-level read/search/edit operations on the WZ XML data files
 * used by the Cosmic v83 server. Covers: mobs, maps, skills, items, NPCs,
 * string lookups, and more.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('maplestory:wz');

const WZ_DIR = join(process.cwd(), 'workspace', 'Cosmic', 'wz');

// ── Name Lookup Cache ────────────────────────────────────────────────────────

const nameCache = { mob: null, npc: null, map: null, skill: null, item: null, eqp: null };

function loadNameMap(type) {
  if (nameCache[type]) return nameCache[type];
  const fileMap = {
    mob: 'Mob.img.xml', npc: 'Npc.img.xml', map: 'Map.img.xml',
    skill: 'Skill.img.xml', item: 'Consume.img.xml', eqp: 'Eqp.img.xml',
  };
  const file = join(WZ_DIR, 'String.wz', fileMap[type]);
  if (!existsSync(file)) return {};
  const xml = readFileSync(file, 'utf-8');
  const map = {};

  if (type === 'map') {
    // Map.img.xml: <imgdir name="region"><imgdir name="mapId"><string name="streetName"..><string name="mapName"..>
    const entryRe = /<imgdir name="(\d+)">\s*(?:<string name="streetName" value="([^"]*)"\/>\s*)?(?:<string name="mapName" value="([^"]*)"\/>\s*)?/g;
    let m;
    while ((m = entryRe.exec(xml)) !== null) {
      const id = m[1];
      const street = m[2] || '';
      const mapName = m[3] || '';
      if (street || mapName) {
        map[id] = street && mapName ? `${street} - ${mapName}` : (street || mapName);
      }
    }
  } else {
    // Standard: <imgdir name="ID"><string name="name" value="Name"/>
    const re = /<imgdir name="(\d+)">\s*<string name="name" value="([^"]*)"\/>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
      map[m[1]] = m[2];
    }
  }
  nameCache[type] = map;
  return map;
}

/**
 * Look up a name by ID and type.
 */
export function lookupName(type, id) {
  const names = loadNameMap(type);
  return names[String(id)] || null;
}

/**
 * Search names by partial match.
 */
export function searchNames(type, query, limit = 20) {
  const names = loadNameMap(type);
  const q = query.toLowerCase();
  const results = [];
  for (const [id, name] of Object.entries(names)) {
    if (name.toLowerCase().includes(q)) {
      results.push({ id, name });
      if (results.length >= limit) break;
    }
  }
  return results;
}

// ── Generic XML Property Reader ──────────────────────────────────────────────

/**
 * Extract the content of a named imgdir section from XML.
 * Uses bracket counting to handle nested </imgdir> correctly.
 */
function extractSection(xml, sectionName) {
  const tag = `<imgdir name="${sectionName}">`;
  const startIdx = xml.indexOf(tag);
  if (startIdx === -1) return null;
  const contentStart = startIdx + tag.length;

  let depth = 1;
  let i = contentStart;
  while (i < xml.length && depth > 0) {
    const nextOpen = xml.indexOf('<imgdir ', i);
    const nextClose = xml.indexOf('</imgdir>', i);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + 8;
    } else {
      depth--;
      if (depth === 0) return xml.substring(contentStart, nextClose);
      i = nextClose + 9;
    }
  }
  return null;
}

/**
 * Parse a WZ XML file and extract properties at a given path.
 * Returns an object with all properties found.
 */
export function readWzXml(filePath) {
  if (!existsSync(filePath)) return null;
  const xml = readFileSync(filePath, 'utf-8');
  return parseWzXmlProperties(xml);
}

/**
 * Parse WZ XML into a structured JS object.
 * Only extracts immediate (non-nested) properties from the given XML fragment.
 */
function parseWzXmlProperties(xml) {
  const result = {};
  const propRe = /<(int|string|float|double|short|long) name="([^"]*)" value="([^"]*)"\s*\/>/g;
  let m;
  while ((m = propRe.exec(xml)) !== null) {
    const [, type, name, value] = m;
    if (type === 'int' || type === 'short' || type === 'long') result[name] = parseInt(value);
    else if (type === 'float' || type === 'double') result[name] = parseFloat(value);
    else result[name] = value;
  }
  const vecRe = /<vector name="([^"]*)" x="([^"]*)" y="([^"]*)"\s*\/>/g;
  while ((m = vecRe.exec(xml)) !== null) {
    result[m[1]] = { x: parseInt(m[2]), y: parseInt(m[3]) };
  }
  return result;
}

/**
 * Get a specific section from a WZ XML file.
 * @param {string} filePath - Full path to the XML file
 * @param {string} sectionPath - Dot-separated path like "info" or "skill.1000000.level.1"
 */
export function getWzSection(filePath, sectionPath) {
  if (!existsSync(filePath)) return null;
  const xml = readFileSync(filePath, 'utf-8');
  const parts = sectionPath.split('.');
  let current = xml;

  for (const part of parts) {
    const re = new RegExp(`<imgdir name="${part}">([\\s\\S]*?)<\\/imgdir>(?=\\s*(?:<imgdir|<\\/imgdir>|$))`, 'g');
    const match = re.exec(current);
    if (!match) return null;
    current = match[1];
  }

  return parseWzXmlProperties(current);
}

// ── Mob Tools ────────────────────────────────────────────────────────────────

/**
 * Get mob stats by ID.
 */
export function getMobStats(mobId) {
  const padded = String(mobId).padStart(7, '0');
  const file = join(WZ_DIR, 'Mob.wz', `${padded}.img.xml`);
  if (!existsSync(file)) return null;
  const xml = readFileSync(file, 'utf-8');

  const infoXml = extractSection(xml, 'info');
  if (!infoXml) return null;

  const stats = parseWzXmlProperties(infoXml);
  stats.mobId = mobId;
  stats.name = lookupName('mob', mobId);
  return stats;
}

/**
 * Edit mob stats.
 */
export function setMobStats(mobId, changes) {
  const padded = String(mobId).padStart(7, '0');
  const file = join(WZ_DIR, 'Mob.wz', `${padded}.img.xml`);
  if (!existsSync(file)) throw new Error(`Mob ${mobId} not found`);

  let xml = readFileSync(file, 'utf-8');
  for (const [key, value] of Object.entries(changes)) {
    const re = new RegExp(`(<(?:int|float|string|short) name="${key}" value=")([^"]*)(")`, 'g');
    const newXml = xml.replace(re, `$1${value}$3`);
    if (newXml === xml) {
      log.warn({ mobId, key }, 'Mob stat key not found, skipping');
    }
    xml = newXml;
  }
  writeFileSync(file, xml, 'utf-8');
  log.info({ mobId, changes }, 'Mob stats updated');
  return { success: true, mobId, changes, note: 'Restart server to apply' };
}

/**
 * Search mobs by name.
 */
export function searchMobs(query, limit = 20) {
  const results = searchNames('mob', query, limit);
  return results.map(r => {
    const stats = getMobStats(r.id);
    return {
      ...r,
      level: stats?.level,
      hp: stats?.maxHP,
      exp: stats?.exp,
      attack: stats?.PADamage,
    };
  });
}

// ── Skill Tools ──────────────────────────────────────────────────────────────

/**
 * Get skill data by skill ID.
 */
export function getSkillData(skillId) {
  const jobId = Math.floor(skillId / 10000);
  const file = join(WZ_DIR, 'Skill.wz', `${jobId}.img.xml`);
  if (!existsSync(file)) return null;

  const xml = readFileSync(file, 'utf-8');
  // First get the "skill" container, then the specific skill within it
  const skillSection = extractSection(xml, 'skill');
  if (!skillSection) return null;

  const skillXml = extractSection(skillSection, String(skillId));
  if (!skillXml) return null;

  const data = { skillId, name: lookupName('skill', skillId) };

  // Get levels using extractSection for the level container
  data.levels = {};
  const levelXml = extractSection(skillXml, 'level');
  if (levelXml) {
    const levelRe = /<imgdir name="(\d+)">([\s\S]*?)<\/imgdir>/g;
    let m;
    while ((m = levelRe.exec(levelXml)) !== null) {
      data.levels[m[1]] = parseWzXmlProperties(m[2]);
    }
  }

  return data;
}

/**
 * Edit a skill's level data.
 */
export function setSkillLevelData(skillId, level, changes) {
  const jobId = Math.floor(skillId / 10000);
  const file = join(WZ_DIR, 'Skill.wz', `${jobId}.img.xml`);
  if (!existsSync(file)) throw new Error(`Skill file for job ${jobId} not found`);

  let xml = readFileSync(file, 'utf-8');

  for (const [key, value] of Object.entries(changes)) {
    // Find within the specific skill > level > level number section
    // Use a targeted approach: find the skill, then the level, then the property
    const pattern = `(name="${skillId}">[\\s\\S]*?name="level">[\\s\\S]*?name="${level}">[\\s\\S]*?name="${key}" value=")([^"]*)(")`;
    const re = new RegExp(pattern);
    const newXml = xml.replace(re, `$1${value}$3`);
    if (newXml === xml) {
      log.warn({ skillId, level, key }, 'Skill property not found');
    }
    xml = newXml;
  }

  writeFileSync(file, xml, 'utf-8');
  log.info({ skillId, level, changes }, 'Skill data updated');
  return { success: true, skillId, level, changes, note: 'Restart server to apply' };
}

/**
 * List all skills for a job.
 */
export function listJobSkills(jobId) {
  const file = join(WZ_DIR, 'Skill.wz', `${jobId}.img.xml`);
  if (!existsSync(file)) return null;

  const xml = readFileSync(file, 'utf-8');
  const skillSection = extractSection(xml, 'skill');
  if (!skillSection) return [];

  // Only match direct children (skill IDs are 7 digits like 1001004)
  const skills = [];
  const re = /<imgdir name="(\d{5,})">/g;
  let m;
  while ((m = re.exec(skillSection)) !== null) {
    skills.push({ skillId: m[1], name: lookupName('skill', m[1]) });
  }
  return skills;
}

// ── Map Tools ────────────────────────────────────────────────────────────────

/**
 * Get map info by ID.
 */
export function getMapInfo(mapId) {
  const padded = String(mapId).padStart(9, '0');
  const prefix = `Map${padded.charAt(0)}`;
  const file = join(WZ_DIR, 'Map.wz', 'Map', prefix, `${padded}.img.xml`);
  if (!existsSync(file)) return null;

  const xml = readFileSync(file, 'utf-8');
  const infoXml = extractSection(xml, 'info');
  const info = infoXml ? parseWzXmlProperties(infoXml) : {};
  info.mapId = mapId;
  info.name = lookupName('map', mapId);

  const lifeXml = extractSection(xml, 'life');
  if (lifeXml) {
    info.npcSpawns = (lifeXml.match(/value="n"/g) || []).length;
    info.mobSpawns = (lifeXml.match(/value="m"/g) || []).length;
  }

  const portalXml = extractSection(xml, 'portal');
  if (portalXml) {
    info.portalCount = (portalXml.match(/<imgdir name="\d+"/g) || []).length;
  }

  return info;
}

/**
 * List all life spawns (NPCs + mobs) on a map.
 */
export function getMapLife(mapId) {
  const padded = String(mapId).padStart(9, '0');
  const prefix = `Map${padded.charAt(0)}`;
  const file = join(WZ_DIR, 'Map.wz', 'Map', prefix, `${padded}.img.xml`);
  if (!existsSync(file)) return null;

  const xml = readFileSync(file, 'utf-8');
  const lifeXml = extractSection(xml, 'life');
  if (!lifeXml) return [];

  const life = [];
  // Each life entry is a simple imgdir with only scalar properties (no nesting)
  const entryRe = /<imgdir name="(\d+)">([\s\S]*?)<\/imgdir>/g;
  let m;
  while ((m = entryRe.exec(lifeXml)) !== null) {
    const props = parseWzXmlProperties(m[2]);
    const type = props.type === 'n' ? 'npc' : props.type === 'm' ? 'mob' : props.type;
    const name = type === 'npc' ? lookupName('npc', props.id) : type === 'mob' ? lookupName('mob', props.id) : null;
    life.push({ index: m[1], type, id: props.id, name, x: props.x, y: props.y });
  }
  return life;
}

/**
 * Get map portals.
 */
export function getMapPortals(mapId) {
  const padded = String(mapId).padStart(9, '0');
  const prefix = `Map${padded.charAt(0)}`;
  const file = join(WZ_DIR, 'Map.wz', 'Map', prefix, `${padded}.img.xml`);
  if (!existsSync(file)) return null;

  const xml = readFileSync(file, 'utf-8');
  const portalXml = extractSection(xml, 'portal');
  if (!portalXml) return [];

  const portals = [];
  const entryRe = /<imgdir name="(\d+)">([\s\S]*?)<\/imgdir>/g;
  let m;
  while ((m = entryRe.exec(portalXml)) !== null) {
    const props = parseWzXmlProperties(m[2]);
    portals.push({
      index: m[1], pn: props.pn, pt: props.pt,
      x: props.x, y: props.y, tm: props.tm, tn: props.tn,
      targetMapName: props.tm ? lookupName('map', props.tm) : null,
    });
  }
  return portals;
}

/**
 * Search maps by name.
 */
export function searchMaps(query, limit = 20) {
  return searchNames('map', query, limit);
}

// ── Item Tools ───────────────────────────────────────────────────────────────

/**
 * Get item data by ID.
 */
export function getItemData(itemId) {
  const id = String(itemId).padStart(8, '0');
  const prefix = id.substring(0, 4);

  const dirs = ['Consume', 'Etc', 'Install', 'Cash', 'Special', 'Pet'];
  for (const dir of dirs) {
    const file = join(WZ_DIR, 'Item.wz', dir, `${prefix}.img.xml`);
    if (!existsSync(file)) continue;

    const xml = readFileSync(file, 'utf-8');
    const itemXml = extractSection(xml, id);
    if (!itemXml) continue;

    const data = { itemId, category: dir };
    const infoXml = extractSection(itemXml, 'info');
    if (infoXml) data.info = parseWzXmlProperties(infoXml);
    const specXml = extractSection(itemXml, 'spec');
    if (specXml) data.spec = parseWzXmlProperties(specXml);

    data.name = lookupName('item', itemId);
    return data;
  }
  return null;
}

/**
 * Edit item properties.
 */
export function setItemData(itemId, section, changes) {
  const id = String(itemId).padStart(8, '0');
  const prefix = id.substring(0, 4);

  const dirs = ['Consume', 'Etc', 'Install', 'Cash', 'Special', 'Pet'];
  for (const dir of dirs) {
    const file = join(WZ_DIR, 'Item.wz', dir, `${prefix}.img.xml`);
    if (!existsSync(file)) continue;

    let xml = readFileSync(file, 'utf-8');
    if (!xml.includes(`name="${id}"`)) continue;

    for (const [key, value] of Object.entries(changes)) {
      const pattern = `(name="${id}">[\\s\\S]*?name="${section}">[\\s\\S]*?name="${key}" value=")([^"]*)(")`;
      const re = new RegExp(pattern);
      xml = xml.replace(re, `$1${value}$3`);
    }
    writeFileSync(file, xml, 'utf-8');
    log.info({ itemId, section, changes }, 'Item data updated');
    return { success: true, itemId, section, changes, note: 'Restart server to apply' };
  }
  throw new Error(`Item ${itemId} not found`);
}

// ── Equipment Tools ──────────────────────────────────────────────────────────

/**
 * Get equipment stats by ID.
 */
export function getEquipData(equipId) {
  const id = String(equipId).padStart(8, '0');
  const prefix = id.substring(0, 4);

  // Equipment is in Character.wz, organized by type
  const typeDirs = readdirSync(join(WZ_DIR, 'Character.wz')).filter(d =>
    !d.endsWith('.img.xml') && existsSync(join(WZ_DIR, 'Character.wz', d))
  );

  for (const dir of typeDirs) {
    const file = join(WZ_DIR, 'Character.wz', dir, `${id}.img.xml`);
    if (!existsSync(file)) continue;

    const xml = readFileSync(file, 'utf-8');
    const infoMatch = xml.match(/<imgdir name="info">([\s\S]*?)<\/imgdir>/);
    if (!infoMatch) continue;

    const stats = parseWzXmlProperties(infoMatch[1]);
    stats.equipId = equipId;
    stats.type = dir;
    stats.name = lookupName('eqp', equipId);
    return stats;
  }
  return null;
}

// ── NPC Info Tools ───────────────────────────────────────────────────────────

/**
 * Search NPCs by name.
 */
export function searchNpcs(query, limit = 20) {
  return searchNames('npc', query, limit);
}

/**
 * Get all NPC names (for browsing).
 */
export function listNpcNames(offset = 0, limit = 50) {
  const names = loadNameMap('npc');
  const entries = Object.entries(names).slice(offset, offset + limit);
  return {
    total: Object.keys(names).length,
    offset,
    npcs: entries.map(([id, name]) => ({ id, name })),
  };
}

// ── Generic WZ XML Edit ──────────────────────────────────────────────────────

/**
 * Set a property value in any WZ XML file.
 * @param {string} wzPath - Relative path like "Mob.wz/0100100.img.xml"
 * @param {string} propPath - Property path like "info.maxHP"
 * @param {string|number} value - New value
 */
export function setWzProperty(wzPath, propPath, value) {
  const file = join(WZ_DIR, wzPath);
  if (!existsSync(file)) throw new Error(`File not found: ${wzPath}`);

  let xml = readFileSync(file, 'utf-8');
  const parts = propPath.split('.');
  const propName = parts.pop();

  // Build regex that navigates through nested imgdirs
  let pattern = '';
  for (const part of parts) {
    pattern += `name="${part}">[\\s\\S]*?`;
  }
  pattern += `(name="${propName}" value=")([^"]*)(")`;

  const re = new RegExp(pattern);
  const newXml = xml.replace(re, `$1${value}$3`);

  if (newXml === xml) {
    throw new Error(`Property ${propPath} not found in ${wzPath}`);
  }

  writeFileSync(file, newXml, 'utf-8');
  log.info({ wzPath, propPath, value }, 'WZ property updated');
  return { success: true, wzPath, propPath, value, note: 'Restart server to apply' };
}

/**
 * Add a new property to a WZ XML file section.
 */
export function addWzProperty(wzPath, sectionPath, type, name, value) {
  const file = join(WZ_DIR, wzPath);
  if (!existsSync(file)) throw new Error(`File not found: ${wzPath}`);

  let xml = readFileSync(file, 'utf-8');

  // Find the section to add to
  let pattern = '';
  for (const part of sectionPath.split('.')) {
    pattern += `<imgdir name="${part}">[\\s\\S]*?`;
  }

  // Find the closing </imgdir> of the deepest section
  const sectionRe = new RegExp(`(${pattern})(</imgdir>)`);
  const propLine = `    <${type} name="${name}" value="${value}"/>\n    `;
  const newXml = xml.replace(sectionRe, `$1${propLine}$2`);

  if (newXml === xml) {
    throw new Error(`Section ${sectionPath} not found in ${wzPath}`);
  }

  writeFileSync(file, newXml, 'utf-8');
  log.info({ wzPath, sectionPath, type, name, value }, 'WZ property added');
  return { success: true, note: 'Restart server to apply' };
}

// ── Stat Summary ─────────────────────────────────────────────────────────────

/**
 * Get summary stats about the WZ data.
 */
export function getWzStats() {
  const count = (dir) => {
    try {
      return readdirSync(join(WZ_DIR, dir)).filter(f => f.endsWith('.img.xml')).length;
    } catch { return 0; }
  };

  const countRecursive = (dir) => {
    let total = 0;
    const scan = (d) => {
      try {
        for (const entry of readdirSync(d, { withFileTypes: true })) {
          if (entry.isDirectory()) scan(join(d, entry.name));
          else if (entry.name.endsWith('.img.xml')) total++;
        }
      } catch {}
    };
    scan(join(WZ_DIR, dir));
    return total;
  };

  return {
    mobs: count('Mob.wz'),
    npcs: count('Npc.wz'),
    maps: countRecursive('Map.wz'),
    skills: count('Skill.wz'),
    items: countRecursive('Item.wz'),
    equipment: countRecursive('Character.wz'),
    effects: countRecursive('Effect.wz'),
    sounds: countRecursive('Sound.wz'),
  };
}
