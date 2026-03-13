/**
 * export-cosmic-xml.cjs — Export custom assets to Cosmic-compatible XML format
 * Cosmic uses: <imgdir>, <canvas>, <vector>, <int>, <string>, <float>, <short>
 * NOT the <property> format from export_to_xml
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXE_PATH = 'C:/Users/rdiol/sela/workspace/WzImg-MCP-Server/WzImgMCP/bin/Debug/net8.0-windows/WzImgMCP.exe';
const IMG_DATA_PATH = 'C:/Users/rdiol/sela/workspace/npc-wz-img';
const COSMIC_WZ = 'C:/Users/rdiol/sela/workspace/Cosmic/wz';

let msgId = 1;
const pending = new Map();
let proc, buffer = '';

function sendRequest(method, params) {
  return new Promise((resolve, reject) => {
    const id = msgId++;
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    pending.set(id, { resolve, reject });
    proc.stdin.write(msg + '\n');
  });
}
function callTool(name, args) { return sendRequest('tools/call', { name, arguments: args }); }
function handleData(data) {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message || JSON.stringify(msg.error))) : resolve(msg.result);
      }
    } catch (_) {}
  }
}
function extractResult(res) {
  if (res && res.content && Array.isArray(res.content)) {
    const t = res.content.find(c => c.type === 'text');
    if (t) try { return JSON.parse(t.text); } catch (_) { return t.text; }
  }
  return res;
}
async function safeCall(name, args) {
  try {
    const res = await callTool(name, args);
    return extractResult(res);
  } catch (e) { return { success: false, error: e.message }; }
}

function escapeXml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Recursively build Cosmic-format XML from MCP data
async function buildXml(category, image, nodePath, indent) {
  const res = await safeCall('get_children', {
    category, image, path: nodePath || null, compact: false, limit: 500
  });
  if (!res.success && !res.data) return '';

  const children = (res.data && res.data.children) || [];
  let xml = '';

  for (const child of children) {
    const name = escapeXml(child.name);
    const pad = '  '.repeat(indent);

    switch (child.type) {
      case 'SubProperty':
      case 'Convex': {
        const childPath = nodePath ? `${nodePath}/${child.name}` : child.name;
        const inner = await buildXml(category, image, childPath, indent + 1);
        xml += `${pad}<imgdir name="${name}">\n${inner}${pad}</imgdir>\n`;
        break;
      }
      case 'Canvas': {
        const w = child.value ? child.value.width : 0;
        const h = child.value ? child.value.height : 0;
        if (child.hasChildren) {
          const childPath = nodePath ? `${nodePath}/${child.name}` : child.name;
          const inner = await buildXml(category, image, childPath, indent + 1);
          xml += `${pad}<canvas name="${name}" width="${w}" height="${h}">\n${inner}${pad}</canvas>\n`;
        } else {
          xml += `${pad}<canvas name="${name}" width="${w}" height="${h}"/>\n`;
        }
        break;
      }
      case 'Int':
        xml += `${pad}<int name="${name}" value="${child.value}"/>\n`;
        break;
      case 'Short':
        xml += `${pad}<short name="${name}" value="${child.value}"/>\n`;
        break;
      case 'Long':
        xml += `${pad}<long name="${name}" value="${child.value}"/>\n`;
        break;
      case 'Float':
      case 'Double':
        xml += `${pad}<float name="${name}" value="${child.value}"/>\n`;
        break;
      case 'String':
        xml += `${pad}<string name="${name}" value="${escapeXml(child.value)}"/>\n`;
        break;
      case 'Vector': {
        const x = child.value ? child.value.x : 0;
        const y = child.value ? child.value.y : 0;
        xml += `${pad}<vector name="${name}" x="${x}" y="${y}"/>\n`;
        break;
      }
      case 'UOL':
        xml += `${pad}<uol name="${name}" value="${escapeXml(child.value)}"/>\n`;
        break;
      case 'Sound':
        xml += `${pad}<sound name="${name}"/>\n`;
        break;
      case 'Null':
        xml += `${pad}<null name="${name}"/>\n`;
        break;
      default:
        xml += `${pad}<!-- unknown type: ${child.type} name="${name}" -->\n`;
    }
  }
  return xml;
}

async function exportImage(category, image, outputPath) {
  // Parse first
  let res = await safeCall('parse_image', { category, image });

  const imgName = path.basename(image);
  const body = await buildXml(category, image, '', 1);
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<imgdir name="${escapeXml(imgName)}">\n${body}</imgdir>\n`;

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, xml, 'utf8');
  return true;
}

function getAssetsToExport() {
  const assets = [];

  // NPCs
  const npcDir = path.join(IMG_DATA_PATH, 'npc');
  for (const f of fs.readdirSync(npcDir).filter(f => f.startsWith('999') && f.endsWith('.img'))) {
    assets.push({ category: 'npc', image: f, output: path.join(COSMIC_WZ, 'Npc.wz', `${f}.xml`) });
  }

  // Mobs
  const mobDir = path.join(IMG_DATA_PATH, 'mob');
  for (const f of fs.readdirSync(mobDir).filter(f => f.startsWith('990') && f.endsWith('.img'))) {
    assets.push({ category: 'mob', image: f, output: path.join(COSMIC_WZ, 'Mob.wz', `${f}.xml`) });
  }

  // Items
  assets.push({ category: 'item', image: 'Consume/0200.img', output: path.join(COSMIC_WZ, 'Item.wz/Consume/0200.img.xml') });
  assets.push({ category: 'item', image: 'Consume/0203.img', output: path.join(COSMIC_WZ, 'Item.wz/Consume/0203.img.xml') });
  assets.push({ category: 'item', image: 'Etc/0403.img', output: path.join(COSMIC_WZ, 'Item.wz/Etc/0403.img.xml') });

  // Weapons
  for (const id of ['01302134','01332100','01382081','01442104','01452086','01472101','01482047','01492049']) {
    assets.push({ category: 'character', image: `Weapon/${id}.img`, output: path.join(COSMIC_WZ, `Character.wz/Weapon/${id}.img.xml`) });
  }

  // Equipment
  assets.push({ category: 'character', image: 'Cap/01003074.img', output: path.join(COSMIC_WZ, 'Character.wz/Cap/01003074.img.xml') });
  assets.push({ category: 'character', image: 'Cap/01003075.img', output: path.join(COSMIC_WZ, 'Character.wz/Cap/01003075.img.xml') });
  assets.push({ category: 'character', image: 'Accessory/01142153.img', output: path.join(COSMIC_WZ, 'Character.wz/Accessory/01142153.img.xml') });
  assets.push({ category: 'character', image: 'Accessory/01142154.img', output: path.join(COSMIC_WZ, 'Character.wz/Accessory/01142154.img.xml') });

  // Skills
  for (const job of ['600','610','611','612','700','710','711','712']) {
    assets.push({ category: 'skill', image: `${job}.img`, output: path.join(COSMIC_WZ, `Skill.wz/${job}.img.xml`) });
  }

  return assets;
}

async function run() {
  proc = spawn(EXE_PATH, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  proc.stderr.on('data', d => process.stderr.write(d));
  proc.stdout.on('data', handleData);

  await sendRequest('initialize', {
    protocolVersion: '2024-11-05', capabilities: {},
    clientInfo: { name: 'export-cosmic-xml', version: '1.0' }
  });
  await callTool('init_data_source', { basePath: IMG_DATA_PATH });
  console.log('Initialized data source\n');

  const assets = getAssetsToExport();
  console.log(`Exporting ${assets.length} assets to Cosmic XML format...\n`);

  let exported = 0, errors = 0;
  for (const asset of assets) {
    try {
      await exportImage(asset.category, asset.image, asset.output);
      const rel = path.relative(COSMIC_WZ, asset.output);
      console.log(`  [OK] ${asset.category}/${asset.image} → ${rel}`);
      exported++;
    } catch (e) {
      console.log(`  [ERR] ${asset.category}/${asset.image}: ${e.message.slice(0, 80)}`);
      errors++;
    }
  }

  console.log(`\n========== EXPORT SUMMARY ==========`);
  console.log(`Exported: ${exported}/${assets.length}`);
  console.log(`Errors: ${errors}`);

  proc.stdin.end();
  process.exit(errors > 0 && exported === 0 ? 1 : 0);
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
