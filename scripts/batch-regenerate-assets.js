/**
 * scripts/batch-regenerate-assets.js
 *
 * Batch regenerates all pending assets in the Shattered Crown manifest
 * using Sketchfab (primary) + Claude sculpt (fallback).
 *
 * Usage: node scripts/batch-regenerate-assets.js [--region CrossroadsHub] [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// Load .env manually (not in PM2 context)
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

import { callTool } from '../lib/mcp-gateway.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('batch-regen');

const MANIFEST_PATH = join(process.cwd(), 'workspace/shattered-crown/Assets/asset-manifest.json');

// ── Region → Sketchfab search style mapping ──
const REGION_STYLE = {
  CrossroadsHub: 'medieval fantasy village',
  AshenWilds: 'dark fantasy scorched burned',
  Ironhold: 'medieval fortress castle military',
  VerdantReach: 'fantasy jungle forest magic',
  SunkenHalls: 'underwater ruins ancient sunken',
  EmberPeaks: 'volcanic lava fantasy forge',
  Aethermere: 'ethereal void crystal magic',
  TheWilds: 'forest nature medieval',
  Shared: 'fantasy game rpg',
  Characters: 'fantasy character rpg',
  Weapons: 'medieval fantasy weapon',
  Enemies: 'fantasy monster creature',
  Effects: 'fantasy magic effect',
};

// ── Size estimation from description ──
function estimateSize(asset) {
  const desc = asset.description || '';
  const sizeMatch = desc.match(/(\d+(?:\.\d+)?)\s*m\s*(?:tall|high|wide|long|diameter)/i);
  if (sizeMatch) return parseFloat(sizeMatch[1]);
  // Defaults by type
  if (asset.type === 'hero') return 2.0;
  if (asset.type === 'environment') return 3.0;
  if (asset.type === 'foliage') return 1.0;
  return 1.5; // prop default
}

// ── Build smart Sketchfab query ──
function buildQuery(asset, regionId) {
  const style = REGION_STYLE[regionId] || 'fantasy game';

  // Clean name
  let name = asset.name
    .replace(/^(Crossroads|Village|Region|Small|Ancient|Giant|Corrupted?|Broken|Rusted?|Fallen)\s+/i, '')
    .trim();

  // Extract key nouns from description
  const desc = asset.description || '';
  const keywords = desc
    .replace(/\d+(\.\d+)?\s*m\s*(tall|wide|long|diameter)/gi, '')
    .replace(/[.!,()]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !/^(with|from|that|this|near|have|each|very|than|also|into|onto)$/i.test(w))
    .slice(0, 3)
    .join(' ');

  return `${name} ${keywords} ${style}`.replace(/\s+/g, ' ').trim().slice(0, 80);
}

// ── Parse UID from search results ──
function parseUid(text) {
  if (!text) return null;
  const match = text.match(/UID:\s*([a-f0-9]+)/i) || text.match(/uid[:\s"']*([a-f0-9]{20,})/i);
  return match ? match[1] : null;
}

// ── Ensure Sketchfab key is set in Blender ──
async function ensureSketchfabKey() {
  const key = process.env.SKETCHFAB_API_KEY;
  if (!key) {
    console.error('SKETCHFAB_API_KEY not set in environment!');
    process.exit(1);
  }
  await callTool('blender-mcp', 'execute_blender_code', {
    code: `
import bpy
s = bpy.context.scene
s.blendermcp_sketchfab_api_key = "${key}"
s.blendermcp_use_sketchfab = True
print("Sketchfab key configured")
`,
  }, 10_000);
}

// ── Clear Blender scene ──
async function clearScene() {
  await callTool('blender-mcp', 'execute_blender_code', {
    code: `
import bpy
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for block in bpy.data.meshes:
    if block.users == 0: bpy.data.meshes.remove(block)
for block in bpy.data.materials:
    if block.users == 0: bpy.data.materials.remove(block)
for block in bpy.data.images:
    if block.users == 0: bpy.data.images.remove(block)
print("Scene cleared")
`,
  }, 15_000);
}

// ── Export FBX ──
async function exportFbx(assetId, regionId) {
  const relPath = `${regionId}/${assetId}.fbx`;
  const fullPath = join(process.cwd(), 'workspace/shattered-crown/Assets', relPath).replace(/\\/g, '/');

  const result = await callTool('blender-mcp', 'execute_blender_code', {
    code: `
import bpy, os
path = "${fullPath}"
os.makedirs(os.path.dirname(path), exist_ok=True)

# Select all meshes
bpy.ops.object.select_all(action='DESELECT')
for obj in bpy.data.objects:
    if obj.type == 'MESH':
        obj.select_set(True)

if any(o.select_get() for o in bpy.data.objects):
    bpy.ops.export_scene.fbx(
        filepath=path,
        use_selection=True,
        apply_scale_options='FBX_SCALE_ALL',
        bake_anim=False,
        path_mode='COPY',
        embed_textures=True,
    )
    print(f"Exported: {path}")
else:
    print("No meshes to export")
`,
  }, 30_000);

  return result?.includes('Exported') ? relPath : null;
}

// ── Main batch loop ──
async function main() {
  const args = process.argv.slice(2);
  const filterRegion = args.includes('--region') ? args[args.indexOf('--region') + 1] : null;
  const dryRun = args.includes('--dry-run');

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));

  // Collect all pending assets
  const pending = [];
  for (const [regionId, region] of Object.entries(manifest.regions || {})) {
    if (filterRegion && regionId !== filterRegion) continue;
    for (const asset of region.assets || []) {
      if (asset.status === 'pending') {
        pending.push({ asset, regionId, region });
      }
    }
  }

  console.log(`\n=== Batch Regeneration: ${pending.length} pending assets ===`);
  if (filterRegion) console.log(`  Filtered to region: ${filterRegion}`);
  if (dryRun) { console.log('  DRY RUN — no downloads\n'); }

  if (!dryRun) {
    console.log('Setting up Sketchfab key...');
    await ensureSketchfabKey();
  }

  let success = 0, failed = 0, sketchfabCount = 0, sculptCount = 0;
  const errors = [];

  for (let i = 0; i < pending.length; i++) {
    const { asset, regionId } = pending[i];
    const query = buildQuery(asset, regionId);
    const targetSize = estimateSize(asset);

    console.log(`\n[${i + 1}/${pending.length}] ${regionId}/${asset.id}: "${asset.name}"`);
    console.log(`  Query: "${query}" | Size: ${targetSize}m`);

    if (dryRun) { success++; continue; }

    try {
      // Clear scene
      await clearScene();

      // Try Sketchfab
      let method = null;
      try {
        const searchResult = await callTool('blender-mcp', 'search_sketchfab_models', {
          query,
          downloadable: true,
          count: 3,
        }, 30_000);

        const uid = parseUid(searchResult);
        if (uid) {
          await callTool('blender-mcp', 'download_sketchfab_model', {
            uid,
            target_size: targetSize,
          }, 120_000);
          method = 'sketchfab';
          sketchfabCount++;
        }
      } catch (err) {
        console.log(`  Sketchfab failed: ${err.message?.slice(0, 80)}`);
      }

      // Fallback: Claude sculpt
      if (!method) {
        try {
          const { generateViaClaudeSculpt } = await import('../modules/asset-pipeline/claude-sculpt.js');
          await generateViaClaudeSculpt(asset.description || asset.name, asset.id, {
            model: 'sonnet',
            maxRetries: 1,
            style: REGION_STYLE[regionId] || 'dark fantasy, stylized',
          });
          method = 'claude-sculpt';
          sculptCount++;
        } catch (err) {
          console.log(`  Claude sculpt failed: ${err.message?.slice(0, 80)}`);
        }
      }

      if (!method) {
        throw new Error('Both Sketchfab and Claude sculpt failed');
      }

      // Export FBX
      const fbxPath = await exportFbx(asset.id, regionId);

      // Update manifest
      asset.status = 'done';
      asset.fbx_path = fbxPath || `${regionId}/${asset.id}.fbx`;
      asset.method = method;
      asset.regeneratedAt = new Date().toISOString();

      // Save manifest after each asset (crash-safe)
      writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

      console.log(`  ✓ ${method} | FBX: ${fbxPath || 'export failed'}`);
      success++;

    } catch (err) {
      console.log(`  ✗ FAILED: ${err.message?.slice(0, 100)}`);
      asset.status = 'failed';
      writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
      failed++;
      errors.push({ id: asset.id, err: err.message });
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`  Success: ${success} (Sketchfab: ${sketchfabCount}, Claude: ${sculptCount})`);
  console.log(`  Failed: ${failed}`);
  if (errors.length) {
    console.log(`  Errors:`);
    errors.forEach(e => console.log(`    ${e.id}: ${e.err?.slice(0, 80)}`));
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
