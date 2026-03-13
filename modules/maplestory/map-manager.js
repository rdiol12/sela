/**
 * MapleStory Map Manager — Enhanced map creation and management.
 *
 * Extends server-manager.js createMap() with:
 *  1. createLinkedMap() — creates map AND bidirectional portal to parent map
 *  2. listCustomMaps()  — lists all agent-created custom maps
 *  3. addPortalToMap()  — adds a portal to an existing map XML
 *  4. validateMapPortals() — checks a map's portals are properly connected
 *  5. getMapRegistry()  — returns registry of all agent-created maps
 *
 * Wired into modules/maplestory/index.js as:
 *  maple_create_linked_map, maple_list_custom_maps, maple_add_portal, maple_validate_map
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createMap, addMobToMap, addNpcToMap } from './server-manager.js';
import log from '../../lib/logger.js';

const WZ_DIR = process.env.COSMIC_WZ_DIR || join(process.cwd(), 'workspace/Cosmic/wz');

// Known custom map ID ranges (agent-created)
const CUSTOM_MAP_RANGES = [
  { start: 101050000, end: 101050099, label: 'Sage Hall (Ellinia District)' },
  { start: 211090000, end: 211090099, label: 'Frozen Caverns (El Nath Dungeon Zone)' },
  { start: 261090000, end: 261090099, label: 'Shadow Crypts (Magatia Dungeon Zone)' },
  { start: 990100000, end: 990100099, label: "Sage's Spire" },
  { start: 999999000, end: 999999999, label: 'Custom/Test Maps' },
];

// Registry file path for tracking created maps
const MAP_REGISTRY_PATH = join(process.cwd(), 'data/state/custom-maps-registry.json');

// ── Registry Management ──────────────────────────────────────────────────────

function loadRegistry() {
  try {
    if (existsSync(MAP_REGISTRY_PATH)) {
      return JSON.parse(readFileSync(MAP_REGISTRY_PATH, 'utf-8'));
    }
  } catch (e) { /* ignore */ }
  return { maps: [], createdAt: Date.now(), version: 1 };
}

function saveRegistry(registry) {
  registry.updatedAt = Date.now();
  writeFileSync(MAP_REGISTRY_PATH, JSON.stringify(registry, null, 2));
}

function registerMap(mapId, meta) {
  const registry = loadRegistry();
  const existing = registry.maps.findIndex(m => m.id === mapId);
  const entry = { id: mapId, ...meta, registeredAt: Date.now() };
  if (existing >= 0) {
    registry.maps[existing] = { ...registry.maps[existing], ...entry };
  } else {
    registry.maps.push(entry);
  }
  saveRegistry(registry);
  return entry;
}

// ── Portal Management ────────────────────────────────────────────────────────

/**
 * Add a portal to an existing map XML file.
 * @param {string} mapId - Target map ID (e.g. '101050000')
 * @param {object} portal - { name, type, x, y, targetMap, targetPortal }
 */
export function addPortalToMap(mapId, portal) {
  const prefix = `Map${mapId.charAt(0)}`;
  const filePath = join(WZ_DIR, 'Map.wz', 'Map', prefix, `${mapId}.img.xml`);

  if (!existsSync(filePath)) {
    return { success: false, error: `Map ${mapId} not found at ${filePath}` };
  }

  let xml = readFileSync(filePath, 'utf-8');

  // Find portal section
  const portalSectionStart = xml.indexOf('<imgdir name="portal">');
  if (portalSectionStart < 0) {
    return { success: false, error: 'No portal section found in map XML' };
  }

  // Find highest existing portal index
  const portalSection = xml.slice(portalSectionStart);
  const matches = [...portalSection.matchAll(/<imgdir name="(\d+)">/g)];
  const maxIdx = matches.length > 0 ? Math.max(...matches.map(m => parseInt(m[1]))) : -1;
  const newIdx = maxIdx + 1;

  const newPortalXml = `    <imgdir name="${newIdx}">
      <string name="pn" value="${portal.name || 'portal' + newIdx}"/>
      <int name="pt" value="${portal.type !== undefined ? portal.type : 2}"/>
      <int name="x" value="${portal.x || 0}"/>
      <int name="y" value="${portal.y || 0}"/>
      <int name="tm" value="${portal.targetMap || 999999999}"/>
      <string name="tn" value="${portal.targetPortal || ''}"/>
    </imgdir>
`;

  // Insert before closing tag of portal section
  const portalClose = xml.indexOf('</imgdir>', portalSectionStart + 20);
  xml = xml.slice(0, portalClose) + newPortalXml + '  ' + xml.slice(portalClose);
  writeFileSync(filePath, xml, 'utf-8');

  log.info({ mapId, portalName: portal.name, targetMap: portal.targetMap, idx: newIdx }, 'Portal added to map');
  return { success: true, mapId, portalIndex: newIdx, portal, note: 'Restart server to apply' };
}

// ── Linked Map Creation ──────────────────────────────────────────────────────

/**
 * Create a new map WITH bidirectional portal connection to a parent map.
 * @param {string} mapId - New map ID to create
 * @param {object} opts - Same opts as createMap() plus parentMapId, entryPortalName, exitPortalPos
 */
export function createLinkedMap(mapId, opts = {}) {
  const {
    parentMapId,
    entryPortalName = 'in00',      // portal name in new map pointing back to parent
    exitPortalName = null,          // portal name in parent pointing to new map (auto-derived if null)
    exitPortalPos = { x: 0, y: 0 }, // where to place the exit portal in the parent map
    entryPos = { x: -580, y: 200 }, // position of return portal in the new map
    ...mapOpts
  } = opts;

  // 1. Create the new map
  const createResult = createMap(mapId, mapOpts);
  if (!createResult.success) return createResult;

  // 2. Add return portal to new map (pointing back to parent)
  if (parentMapId) {
    const returnPortal = {
      name: entryPortalName,
      type: 2,
      x: entryPos.x,
      y: entryPos.y,
      targetMap: parseInt(parentMapId),
      targetPortal: exitPortalName || (entryPortalName.replace('in', 'out')),
    };
    addPortalToMap(mapId, returnPortal);

    // 3. Add exit portal in the parent map pointing to new map
    const exitPortal = {
      name: exitPortalName || `to_${mapId}`,
      type: 2,
      x: exitPortalPos.x,
      y: exitPortalPos.y,
      targetMap: parseInt(mapId),
      targetPortal: entryPortalName,
    };
    const parentPortalResult = addPortalToMap(parentMapId.toString(), exitPortal);
    createResult.parentPortal = parentPortalResult;
  }

  // 4. Register in custom maps registry
  registerMap(mapId, {
    name: mapOpts.name || mapId,
    streetName: mapOpts.streetName || '',
    parentMapId: parentMapId || null,
    returnMap: mapOpts.returnMap || 999999999,
    bgm: mapOpts.bgm || 'Bgm00/GoPicnic',
    created: new Date().toISOString(),
    mobCount: 0,
    npcCount: 0,
    notes: mapOpts.notes || '',
  });

  log.info({ mapId, parentMapId, name: mapOpts.name }, 'Linked map created');
  return { ...createResult, linked: !!parentMapId };
}

// ── Map Discovery ────────────────────────────────────────────────────────────

/**
 * List all custom maps in known custom ID ranges.
 */
export function listCustomMaps() {
  const found = [];

  for (const range of CUSTOM_MAP_RANGES) {
    const prefix = `Map${range.start.toString().charAt(0)}`;
    const dir = join(WZ_DIR, 'Map.wz', 'Map', prefix);

    if (!existsSync(dir)) continue;

    try {
      const files = readdirSync(dir).filter(f => f.endsWith('.img.xml'));
      for (const file of files) {
        const mapId = parseInt(file.replace('.img.xml', ''));
        if (mapId >= range.start && mapId <= range.end) {
          const filePath = join(dir, file);
          const xml = readFileSync(filePath, 'utf-8');

          // Extract map name from String.wz registration
          const mobCount = (xml.match(/"m"/g) || []).length;
          const npcCount = (xml.match(/"n"/g) || []).length;
          const portalCount = (xml.match(/<imgdir name="portal">/g) || []).length;

          found.push({
            id: file.replace('.img.xml', ''),
            range: range.label,
            sizeBytes: xml.length,
            mobSpawns: mobCount,
            npcSpawns: npcCount,
            hasPortals: portalCount > 0,
          });
        }
      }
    } catch (e) { /* skip unreadable dirs */ }
  }

  // Also load registry data for richer info
  const registry = loadRegistry();
  for (const found_map of found) {
    const reg = registry.maps.find(m => m.id === found_map.id);
    if (reg) {
      found_map.name = reg.name;
      found_map.parentMapId = reg.parentMapId;
      found_map.created = reg.created;
    }
  }

  return {
    total: found.length,
    maps: found,
    ranges: CUSTOM_MAP_RANGES,
    registryCount: registry.maps.length,
  };
}

// ── Map Validation ────────────────────────────────────────────────────────────

/**
 * Validate a map's setup: check portals point to valid maps, spawn points exist.
 */
export function validateMapPortals(mapId) {
  const prefix = `Map${mapId.charAt(0)}`;
  const filePath = join(WZ_DIR, 'Map.wz', 'Map', prefix, `${mapId}.img.xml`);

  if (!existsSync(filePath)) {
    return { success: false, error: `Map ${mapId} not found` };
  }

  const xml = readFileSync(filePath, 'utf-8');
  const issues = [];
  const portals = [];

  // Find the portal section using index-based extraction (avoids nested-imgdir regex issues)
  const portalStart = xml.indexOf('<imgdir name="portal">');
  if (portalStart < 0) {
    issues.push('No portal section found');
    return { mapId, valid: false, issues, portals };
  }

  // Extract all portal property blocks inside the portal section
  // Each portal entry: <imgdir name="N">...</imgdir>
  // We look for <string name="pn"..> inside each entry
  let hasSpawnPoint = false;
  let pos = portalStart + 22; // skip past <imgdir name="portal">

  // Find all portal entries by scanning for <int name="pt"
  const ptPattern = /name="pt" value="(\d+)"/g;
  const pnPattern = /name="pn" value="([^"]+)"/g;
  const tmPattern = /name="tm" value="(\d+)"/g;
  const tnPattern = /name="tn" value="([^"]+)"/g;

  // Extract portal section text up to the matching closing tag
  // Count depth to find the closing </imgdir> of portal section
  let depth = 1;
  let scanPos = portalStart + 22;
  while (depth > 0 && scanPos < xml.length) {
    const nextOpen = xml.indexOf('<imgdir', scanPos);
    const nextClose = xml.indexOf('</imgdir>', scanPos);
    if (nextClose < 0) break;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth++;
      scanPos = nextOpen + 7;
    } else {
      depth--;
      if (depth > 0) scanPos = nextClose + 9;
      else { pos = nextClose; break; }
    }
  }

  const portalSectionText = xml.slice(portalStart, pos);

  // Extract individual portal entries
  const entryPattern = /<imgdir name="(\d+)">([\s\S]*?)<\/imgdir>/g;
  let m;
  while ((m = entryPattern.exec(portalSectionText)) !== null) {
    const entryText = m[2];
    const pn = (entryText.match(/name="pn" value="([^"]+)"/) || [])[1] || '';
    const pt = parseInt((entryText.match(/name="pt" value="(\d+)"/) || [])[1] || '0');
    const tm = parseInt((entryText.match(/name="tm" value="(\d+)"/) || [])[1] || '999999999');
    const tn = (entryText.match(/name="tn" value="([^"]+)"/) || [])[1] || '';

    portals.push({ name: pn, type: pt, targetMap: tm, targetPortal: tn });

    if (pt === 0) hasSpawnPoint = true;  // spawn point

    // Check that target map exists (if not 999999999)
    if (pt === 2 && tm !== 999999999) {
      const targetPrefix = `Map${tm.toString().charAt(0)}`;
      const targetPath = join(WZ_DIR, 'Map.wz', 'Map', targetPrefix, `${tm}.img.xml`);
      if (!existsSync(targetPath)) {
        issues.push(`Portal '${pn}' points to map ${tm} which does not exist`);
      }
    }
  }

  if (!hasSpawnPoint) issues.push('No spawn point (pt=0) found in map');
  if (portals.length === 0) issues.push('No portals defined in map');

  return {
    mapId,
    valid: issues.length === 0,
    issues,
    portals,
    portalCount: portals.length,
    hasSpawnPoint,
  };
}

/**
 * Return the custom map registry.
 */
export function getMapRegistry() {
  return loadRegistry();
}
