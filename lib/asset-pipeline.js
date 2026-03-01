/**
 * Asset Pipeline — Autonomous 3D asset generation for The Shattered Crown.
 *
 * Reads asset-manifest.json, picks the next pending asset, generates it
 * in Blender via MCP, exports to FBX, and updates the manifest status.
 *
 * Called by agent-loop when the "asset_generation" signal fires.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { callTool } from './mcp-gateway.js';
import { createLogger } from './logger.js';
import config from './config.js';

const log = createLogger('asset-pipeline');

const MANIFEST_PATH = join(process.cwd(), 'workspace', 'shattered-crown', 'Assets', 'asset-manifest.json');
const ASSETS_DIR = join(process.cwd(), 'workspace', 'shattered-crown', 'Assets');

// ── Manifest I/O ──────────────────────────────────────────────────────────────

function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
}

function saveManifest(manifest) {
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

// ── Queries ───────────────────────────────────────────────────────────────────

export function getNextPendingAsset() {
  const manifest = loadManifest();
  for (const [regionId, region] of Object.entries(manifest.regions)) {
    for (const asset of region.assets) {
      if (asset.status === 'pending') {
        return { regionId, region, asset };
      }
    }
  }
  return null;
}

export function getProgress() {
  const manifest = loadManifest();
  let total = 0, completed = 0, inProgress = 0, failed = 0;
  for (const region of Object.values(manifest.regions)) {
    for (const asset of region.assets) {
      total++;
      if (asset.status === 'completed') completed++;
      else if (asset.status === 'in_progress') inProgress++;
      else if (asset.status === 'failed') failed++;
    }
  }
  return { total, completed, inProgress, failed, pending: total - completed - inProgress - failed };
}

function updateAssetStatus(assetId, status, extra = {}) {
  const manifest = loadManifest();
  for (const region of Object.values(manifest.regions)) {
    for (const asset of region.assets) {
      if (asset.id === assetId) {
        asset.status = status;
        Object.assign(asset, extra);
        saveManifest(manifest);
        return true;
      }
    }
  }
  return false;
}

// ── Blender Generation ────────────────────────────────────────────────────────

function buildBlenderPrompt(asset, region, regionId, manifest) {
  const artDir = manifest.artDirection;
  const palette = region.palette.join(', ');

  return `
You are creating a 3D game asset for a dark fantasy game called "The Shattered Crown".

ASSET: ${asset.name}
DESCRIPTION: ${asset.description}
TYPE: ${asset.type} (poly budget: ${artDir.polyBudget[asset.type] || '1000-5000 tris'})
REGION: ${regionId} — ${region.theme}
COLOR PALETTE: ${palette}
STYLE: ${artDir.style}

INSTRUCTIONS:
1. First, clear the scene (delete default cube/light/camera)
2. Create the asset using Blender primitives, modifiers, and sculpting
3. Use the region's color palette for materials
4. Add proper UV mapping
5. Keep within the poly budget
6. Place the asset at world origin (0, 0, 0)
7. Name the root object "${asset.id}"
8. Apply all transforms

Create this asset step by step. Start by clearing the scene, then build the geometry.
`.trim();
}

/**
 * Generate one asset in Blender.
 * Returns { success, assetId, outputPath, error? }
 */
export async function generateOneAsset() {
  const next = getNextPendingAsset();
  if (!next) {
    log.info('No pending assets in manifest');
    return { success: false, error: 'no_pending_assets' };
  }

  const { regionId, region, asset } = next;
  const manifest = loadManifest();

  log.info({ assetId: asset.id, region: regionId, name: asset.name }, 'Starting asset generation');
  updateAssetStatus(asset.id, 'in_progress', { startedAt: Date.now() });

  try {
    // Step 1: Clear the Blender scene
    await callTool('blender', 'execute_blender_code', {
      code: `
import bpy
# Delete all objects
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()
# Remove orphaned data
for block in bpy.data.meshes:
    if block.users == 0:
        bpy.data.meshes.remove(block)
for block in bpy.data.materials:
    if block.users == 0:
        bpy.data.materials.remove(block)
print("Scene cleared")
`,
    });

    // Step 2: Generate the asset geometry via Blender Python
    const blenderCode = buildAssetCode(asset, region, regionId, manifest);
    const result = await callTool('blender', 'execute_blender_code', {
      code: blenderCode,
    }, 60_000);

    log.info({ assetId: asset.id, resultLen: result?.length }, 'Blender code executed');

    // Step 3: Export to FBX
    const categoryDir = asset.type === 'foliage' ? 'Meshes' : 'Meshes';
    const outputPath = join(ASSETS_DIR, categoryDir, regionId, `${asset.id}.fbx`).replace(/\\/g, '/');

    await callTool('blender', 'execute_blender_code', {
      code: `
import bpy
# Select all mesh objects
bpy.ops.object.select_all(action='DESELECT')
for obj in bpy.data.objects:
    if obj.type == 'MESH':
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj

# Export FBX
bpy.ops.export_scene.fbx(
    filepath="${outputPath}",
    use_selection=True,
    apply_scale_options='FBX_SCALE_ALL',
    axis_forward='-Y',
    axis_up='Z',
    use_mesh_modifiers=True,
    mesh_smooth_type='FACE',
    add_leaf_bones=False,
)
print("Exported to ${outputPath}")
`,
    }, 30_000);

    // Step 4: Update manifest
    updateAssetStatus(asset.id, 'completed', {
      completedAt: Date.now(),
      outputPath: `${categoryDir}/${regionId}/${asset.id}.fbx`,
    });

    log.info({ assetId: asset.id, outputPath }, 'Asset generation complete');
    return { success: true, assetId: asset.id, outputPath };

  } catch (err) {
    log.error({ assetId: asset.id, err: err.message }, 'Asset generation failed');
    updateAssetStatus(asset.id, 'failed', {
      failedAt: Date.now(),
      error: err.message,
    });
    return { success: false, assetId: asset.id, error: err.message };
  }
}

// ── Asset Code Builders ───────────────────────────────────────────────────────

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return `(${r.toFixed(3)}, ${g.toFixed(3)}, ${b.toFixed(3)}, 1.0)`;
}

function buildAssetCode(asset, region, regionId, manifest) {
  const primary = region.palette[0] || '#808080';
  const secondary = region.palette[1] || '#404040';
  const accent = region.palette[2] || '#FFFFFF';
  const dark = region.palette[3] || '#1A1A1A';

  // Generate procedural Blender Python based on asset type
  // This creates reasonable placeholder geometry that can be refined later
  return `
import bpy
import math

# ── Materials ──
def make_mat(name, color_rgba):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color_rgba
    bsdf.inputs["Roughness"].default_value = 0.7
    return mat

mat_primary = make_mat("${asset.id}_Primary", ${hexToRgb(primary)})
mat_secondary = make_mat("${asset.id}_Secondary", ${hexToRgb(secondary)})
mat_accent = make_mat("${asset.id}_Accent", ${hexToRgb(accent)})
mat_dark = make_mat("${asset.id}_Dark", ${hexToRgb(dark)})

# ── Asset: ${asset.name} ──
# ${asset.description}

${getAssetGeometryCode(asset)}

# ── Finalize ──
# Select all, rename root
bpy.ops.object.select_all(action='SELECT')
# Set origin to geometry center
for obj in bpy.context.selected_objects:
    if obj.type == 'MESH':
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')

# Apply all transforms
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

print("Asset '${asset.name}' created successfully")
`;
}

function getAssetGeometryCode(asset) {
  // Generate reasonable procedural geometry based on the asset type/id
  const type = asset.type;

  if (asset.id.includes('tree') || asset.id.includes('oak') || asset.id.includes('mist_tree')) {
    return `
# Tree trunk
bpy.ops.mesh.primitive_cylinder_add(radius=0.3, depth=5, location=(0, 0, 2.5))
trunk = bpy.context.object
trunk.name = "${asset.id}_trunk"
trunk.data.materials.append(mat_secondary)

# Add taper modifier via simple scale on top vertices
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='DESELECT')
bpy.ops.object.mode_set(mode='OBJECT')

# Canopy (use ico sphere)
bpy.ops.mesh.primitive_ico_sphere_add(radius=2.5, subdivisions=2, location=(0, 0, 5.5))
canopy = bpy.context.object
canopy.name = "${asset.id}_canopy"
canopy.data.materials.append(mat_primary)
canopy.scale = (1.0, 1.0, 0.7)

# Branches — simple cylinders
for angle in [0, 1.2, 2.5, 3.8, 5.0]:
    x = math.cos(angle) * 1.2
    y = math.sin(angle) * 1.2
    bpy.ops.mesh.primitive_cylinder_add(radius=0.08, depth=2, location=(x*0.5, y*0.5, 3.5), rotation=(0.4*math.cos(angle), 0.4*math.sin(angle), angle))
    branch = bpy.context.object
    branch.name = f"${asset.id}_branch_{int(angle*10)}"
    branch.data.materials.append(mat_secondary)
`;
  }

  if (asset.id.includes('rock') || asset.id.includes('stone') || asset.id.includes('pillar') || asset.id.includes('spire')) {
    return `
# Rock/Stone formation
bpy.ops.mesh.primitive_ico_sphere_add(radius=1.5, subdivisions=2, location=(0, 0, 1.5))
rock = bpy.context.object
rock.name = "${asset.id}"
rock.data.materials.append(mat_primary)

# Displace for organic rock shape
mod = rock.modifiers.new(name="Displace", type='DISPLACE')
tex = bpy.data.textures.new("${asset.id}_noise", type='VORONOI')
mod.texture = tex
mod.strength = 0.5

# Subsurf for smoother shape
mod2 = rock.modifiers.new(name="Subsurf", type='SUBSURF')
mod2.levels = 1

# Scale for variety
rock.scale = (1.2, 0.9, 1.5)
`;
  }

  if (asset.id.includes('chest') || asset.id.includes('crate') || asset.id.includes('barrel')) {
    return `
# Container base
bpy.ops.mesh.primitive_cube_add(size=0.8, location=(0, 0, 0.4))
body = bpy.context.object
body.name = "${asset.id}_body"
body.data.materials.append(mat_secondary)
body.scale = (1, 0.7, 0.6)

# Lid
bpy.ops.mesh.primitive_cube_add(size=0.8, location=(0, 0, 0.72))
lid = bpy.context.object
lid.name = "${asset.id}_lid"
lid.data.materials.append(mat_secondary)
lid.scale = (1.02, 0.72, 0.15)

# Metal bands
for z in [0.2, 0.5]:
    bpy.ops.mesh.primitive_cube_add(size=0.82, location=(0, 0, z))
    band = bpy.context.object
    band.name = f"${asset.id}_band_{int(z*10)}"
    band.data.materials.append(mat_dark)
    band.scale = (1.03, 0.73, 0.03)
`;
  }

  if (asset.id.includes('altar') || asset.id.includes('shrine') || asset.id.includes('wayshrine')) {
    return `
# Base platform
bpy.ops.mesh.primitive_cylinder_add(radius=1, depth=0.3, location=(0, 0, 0.15))
base = bpy.context.object
base.name = "${asset.id}_base"
base.data.materials.append(mat_primary)

# Pillar
bpy.ops.mesh.primitive_cylinder_add(radius=0.25, depth=1.5, location=(0, 0, 1.0))
pillar = bpy.context.object
pillar.name = "${asset.id}_pillar"
pillar.data.materials.append(mat_primary)

# Crystal on top
bpy.ops.mesh.primitive_cone_add(radius1=0.3, radius2=0.0, depth=0.8, location=(0, 0, 2.2))
crystal = bpy.context.object
crystal.name = "${asset.id}_crystal"
crystal.data.materials.append(mat_accent)

# Emissive crystal material
mat_crystal = bpy.data.materials.new(name="${asset.id}_CrystalGlow")
mat_crystal.use_nodes = True
bsdf = mat_crystal.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Emission Color"].default_value = ${hexToRgb(asset.id.includes('void') || asset.id.includes('aeth') ? '#7B2FBE' : '#FF6B2B')}
bsdf.inputs["Emission Strength"].default_value = 5.0
crystal.data.materials.clear()
crystal.data.materials.append(mat_crystal)
`;
  }

  if (asset.id.includes('mushroom') || asset.id.includes('fungi')) {
    return `
# Stem
bpy.ops.mesh.primitive_cylinder_add(radius=0.4, depth=3, location=(0, 0, 1.5))
stem = bpy.context.object
stem.name = "${asset.id}_stem"
stem.data.materials.append(mat_secondary)

# Cap
bpy.ops.mesh.primitive_uv_sphere_add(radius=1.5, location=(0, 0, 3.5))
cap = bpy.context.object
cap.name = "${asset.id}_cap"
cap.scale = (1.0, 1.0, 0.5)
cap.data.materials.append(mat_accent)

# Emissive cap
mat_glow = bpy.data.materials.new(name="${asset.id}_Glow")
mat_glow.use_nodes = True
bsdf = mat_glow.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.0, 1.0, 0.66, 1.0)
bsdf.inputs["Emission Color"].default_value = (0.0, 1.0, 0.66, 1.0)
bsdf.inputs["Emission Strength"].default_value = 3.0
cap.data.materials.clear()
cap.data.materials.append(mat_glow)
`;
  }

  if (asset.id.includes('gate') || asset.id.includes('arch') || asset.id.includes('door')) {
    return `
# Left pillar
bpy.ops.mesh.primitive_cube_add(size=1, location=(-2, 0, 2.5))
left = bpy.context.object
left.name = "${asset.id}_left"
left.scale = (0.5, 0.5, 2.5)
left.data.materials.append(mat_primary)

# Right pillar
bpy.ops.mesh.primitive_cube_add(size=1, location=(2, 0, 2.5))
right = bpy.context.object
right.name = "${asset.id}_right"
right.scale = (0.5, 0.5, 2.5)
right.data.materials.append(mat_primary)

# Arch top
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 5.3))
top = bpy.context.object
top.name = "${asset.id}_top"
top.scale = (2.5, 0.5, 0.3)
top.data.materials.append(mat_primary)

# Door/Gate fill
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 2.5))
door = bpy.context.object
door.name = "${asset.id}_door"
door.scale = (1.8, 0.1, 2.3)
door.data.materials.append(mat_dark)
`;
  }

  // Default: simple prop placeholder
  return `
# Generic prop placeholder
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.5))
obj = bpy.context.object
obj.name = "${asset.id}"
obj.data.materials.append(mat_primary)

# Add bevel for softer edges
mod = obj.modifiers.new(name="Bevel", type='BEVEL')
mod.width = 0.05
mod.segments = 2
`;
}

// ── Status Report ─────────────────────────────────────────────────────────────

export function getStatusReport() {
  const progress = getProgress();
  const next = getNextPendingAsset();
  return {
    ...progress,
    percent: Math.round((progress.completed / progress.total) * 100),
    nextAsset: next ? `${next.asset.name} (${next.regionId})` : 'none',
  };
}
