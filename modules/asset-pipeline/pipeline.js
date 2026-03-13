/**
 * modules/asset-pipeline/pipeline.js — Core 3D asset generation logic.
 *
 * Reads asset-manifest.json, generates assets in Blender via MCP,
 * exports to FBX, and updates manifest status.
 *
 * Moved from lib/asset-pipeline.js into the module system.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { callTool } from '../../lib/mcp-gateway.js';
import { createLogger } from '../../lib/logger.js';
import { getAssetMaterialSet, getRegionDefaults, getMaterialForAsset } from './region-materials.js';

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

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return `(${r.toFixed(3)}, ${g.toFixed(3)}, ${b.toFixed(3)}, 1.0)`;
}

// ── PolyHaven texture category mapping ────────────────────────────────────────
const POLYHAVEN_TEXTURE_MAP = {
  // Verified IDs from PolyHaven catalog (Mar 2026)
  stone:   ['cliff_side', 'castle_wall_slates', 'broken_wall', 'dry_riverbed_rock', 'castle_wall_varriation'],
  wood:    ['bark_brown_02', 'bark_brown_01', 'bark_willow', 'dark_wood', 'brown_planks_03'],
  metal:   ['rusty_metal', 'painted_metal_02', 'corrugated_iron'],
  ground:  ['brown_mud_03', 'brown_mud_02', 'brown_mud', 'aerial_grass_rock', 'coast_sand_rocks_02'],
  fabric:  ['fabric_pattern_05', 'leather_white', 'fabric_satin'],
  crystal: ['aerial_rocks_04', 'clean_pebbles'],
  lava:    ['aerial_rocks_02', 'dry_riverbed_rock'],
  water:   ['aerial_rocks_04', 'coral_ground_02'],
  moss:    ['aerial_grass_rock', 'brown_mud_03'],
};

/**
 * Guess PolyHaven texture category from asset id/name.
 */
export function guessTextureCategory(asset) {
  const id = (asset.id || '').toLowerCase();
  if (/crystal|shard|gem|void/.test(id)) return 'crystal';
  if (/lava|magma|ember|forge|fire/.test(id)) return 'lava';
  if (/wood|door|crate|barrel|bridge|ladder/.test(id)) return 'wood';
  if (/metal|iron|chain|sword|shield|anvil/.test(id)) return 'metal';
  if (/banner|tent|cloth|canopy|rope/.test(id)) return 'fabric';
  if (/moss|vine|fungi|mushroom|spore/.test(id)) return 'moss';
  if (/water|pool|coral|sunken|jellyfish/.test(id)) return 'water';
  if (/ground|floor|path|road/.test(id)) return 'ground';
  return 'stone'; // default — stone works for most fantasy assets
}

export { POLYHAVEN_TEXTURE_MAP };

function buildAssetCode(asset, region, regionId, manifest) {
  const primary = region.palette[0] || '#808080';
  const secondary = region.palette[1] || '#404040';
  const accent = region.palette[2] || '#FFFFFF';
  const dark = region.palette[3] || '#1A1A1A';

  const id = (asset.id || '').toLowerCase();
  const assetType = detectAssetType(asset);

  // Use master PBR material library (region-materials.js) for region-aware parameters
  const matSet = getAssetMaterialSet(asset.id, regionId, [primary, secondary, accent, dark]);
  const roughness = matSet.primary.roughness;
  const metallic = matSet.primary.metallic;
  const bumpStr = matSet.primary.bumpStrength;

  // Legacy type detection kept for geometry decisions (not materials)
  const isOrganic = /tree|rock|stone|moss|vine|mushroom|coral|bone|rubble|terrain|ground/.test(id);
  const isCrystal = /crystal|shard|gem|void|magic|glow/.test(id);
  const isMetal = /metal|iron|chain|sword|shield|anvil|forge|armor/.test(id);

  return `
import bpy
import bmesh
import math
import random
from mathutils import Vector, Matrix, noise

ASSET_NAME = "${asset.id}"
POLY_BUDGET = 12000
SEED = ${Math.floor(Math.random() * 99999)}
random.seed(SEED)

# ══════════════════════════════════════════════════════════════════
# UTILITY FUNCTIONS
# ══════════════════════════════════════════════════════════════════

def safe_boolean(target, cutter, operation='DIFFERENCE'):
    """Apply boolean with EXACT→FAST fallback."""
    try:
        mod = target.modifiers.new(name="Bool", type='BOOLEAN')
        mod.operation = operation
        mod.object = cutter
        mod.solver = 'EXACT'
        bpy.context.view_layer.objects.active = target
        bpy.ops.object.modifier_apply(modifier="Bool")
        bpy.data.objects.remove(cutter, do_unlink=True)
        return True
    except Exception as e:
        for m in list(target.modifiers):
            if 'Bool' in m.name:
                target.modifiers.remove(m)
        try:
            mod = target.modifiers.new(name="Bool2", type='BOOLEAN')
            mod.operation = operation
            mod.object = cutter
            mod.solver = 'FAST'
            bpy.ops.object.modifier_apply(modifier="Bool2")
            bpy.data.objects.remove(cutter, do_unlink=True)
            return True
        except:
            for m in list(target.modifiers):
                if 'Bool' in m.name:
                    target.modifiers.remove(m)
            try:
                bpy.data.objects.remove(cutter, do_unlink=True)
            except:
                pass
            return False

def enforce_poly_budget(obj, budget=POLY_BUDGET):
    """Decimate object if over poly budget."""
    if obj.type != 'MESH':
        return
    fc = len(obj.data.polygons)
    if fc > budget:
        dec = obj.modifiers.new(name="Budget", type='DECIMATE')
        dec.ratio = budget / fc
        bpy.context.view_layer.objects.active = obj
        try:
            bpy.ops.object.modifier_apply(modifier="Budget")
        except:
            obj.modifiers.remove(dec)

def apply_weathering(obj):
    """Apply vertex color weathering: R=edge_wear, G=cavity, B=height, A=grime."""
    if obj.type != 'MESH' or len(obj.data.polygons) < 10:
        return
    mesh = obj.data
    if not mesh.vertex_colors:
        mesh.vertex_colors.new(name="Weathering")
    vc = mesh.vertex_colors["Weathering"]
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    # Compute bounds for height gradient
    zmin = min(v.co.z for v in bm.verts)
    zmax = max(v.co.z for v in bm.verts)
    zrange = max(zmax - zmin, 0.01)
    # Compute edge sharpness per vertex (average face-angle at connected edges)
    edge_sharp = {}
    for v in bm.verts:
        angles = []
        for e in v.link_edges:
            if len(e.link_faces) == 2:
                a = e.link_faces[0].normal.angle(e.link_faces[1].normal, 0)
                angles.append(a)
        edge_sharp[v.index] = (sum(angles) / len(angles)) / math.pi if angles else 0
    bm.free()
    # Paint vertex colors
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            vi = mesh.loops[li].vertex_index
            v = mesh.vertices[vi]
            r = min(1.0, edge_sharp.get(vi, 0) * 3)  # edge wear
            g = max(0, 1.0 - abs(v.normal.z))  # cavity (non-upward faces)
            b = (v.co.z - zmin) / zrange  # height gradient
            a = noise.fractal(Vector(v.co) * 3.0, 1.0, 2.0, 2)  # grime noise
            a = max(0, min(1, a * 0.5 + 0.5))
            vc.data[li].color = (r, g, b, a)

def finalize_all():
    """Smooth shade, apply modifiers, enforce budgets, apply transforms."""
    bpy.ops.object.select_all(action='SELECT')
    mesh_count = max(1, len([o for o in bpy.context.scene.objects if o.type == 'MESH']))
    per_obj_budget = POLY_BUDGET // mesh_count
    for obj in list(bpy.context.scene.objects):
        if obj.type != 'MESH':
            continue
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.shade_smooth()
        # Apply all modifiers
        for mod in list(obj.modifiers):
            try:
                bpy.ops.object.modifier_apply(modifier=mod.name)
            except:
                obj.modifiers.remove(mod)
        enforce_poly_budget(obj, per_obj_budget)
        apply_weathering(obj)
        # UV unwrap for PolyHaven image-based textures
        try:
            bpy.context.view_layer.objects.active = obj
            obj.select_set(True)
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.uv.smart_project(angle_limit=66, island_margin=0.02, scale_to_bounds=True)
            bpy.ops.object.mode_set(mode='OBJECT')
        except Exception as e:
            try:
                bpy.ops.object.mode_set(mode='OBJECT')
            except:
                pass
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    total = sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type == 'MESH')
    print(f"Finalized: {total} total faces across {mesh_count} objects")

# ══════════════════════════════════════════════════════════════════
# PBR MATERIAL LIBRARY
# ══════════════════════════════════════════════════════════════════

def make_pbr(name, base_color, roughness=0.7, metallic=0.0, bump_strength=0.3, noise_scale=8.0):
    """PBR material with noise roughness variation, Voronoi+Noise bump, color variation, vertex color weathering."""
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial'); out.location = (900, 0)
    bsdf = nodes.new('ShaderNodeBsdfPrincipled'); bsdf.location = (600, 0)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    tc = nodes.new('ShaderNodeTexCoord'); tc.location = (-1000, 0)
    # Noise for color variation + roughness
    n1 = nodes.new('ShaderNodeTexNoise'); n1.location = (-600, 200)
    n1.inputs['Scale'].default_value = noise_scale; n1.inputs['Detail'].default_value = 8.0
    links.new(tc.outputs['Object'], n1.inputs['Vector'])
    # Color variation
    mc = nodes.new('ShaderNodeMix'); mc.data_type = 'RGBA'; mc.location = (-200, 200)
    mc.inputs[6].default_value = base_color
    darker = tuple(max(0, c * 0.6) for c in base_color[:3]) + (1.0,)
    mc.inputs[7].default_value = darker
    links.new(n1.outputs['Fac'], mc.inputs['Factor'])
    # Vertex color weathering: edge wear brightens, cavity darkens
    vc = nodes.new('ShaderNodeVertexColor'); vc.layer_name = "Weathering"; vc.location = (-600, -150)
    sep = nodes.new('ShaderNodeSeparateColor'); sep.location = (-400, -150)
    links.new(vc.outputs['Color'], sep.inputs['Color'])
    # Edge wear: brightens edges (Red channel)
    ew = nodes.new('ShaderNodeMix'); ew.data_type = 'RGBA'; ew.location = (0, 200)
    links.new(mc.outputs[2], ew.inputs[6])
    bright = tuple(min(1, c * 1.5 + 0.15) for c in base_color[:3]) + (1.0,)
    ew.inputs[7].default_value = bright
    links.new(sep.outputs['Red'], ew.inputs['Factor'])
    # Cavity darkening (Green channel) — darkens crevices
    cav = nodes.new('ShaderNodeMix'); cav.data_type = 'RGBA'; cav.location = (200, 200)
    links.new(ew.outputs[2], cav.inputs[6])
    cavity_dark = tuple(c * 0.3 for c in base_color[:3]) + (1.0,)
    cav.inputs[7].default_value = cavity_dark
    cav_fac = nodes.new('ShaderNodeMath'); cav_fac.operation = 'MULTIPLY'; cav_fac.location = (0, -100)
    cav_fac.inputs[1].default_value = 0.4
    links.new(sep.outputs['Green'], cav_fac.inputs[0])
    links.new(cav_fac.outputs[0], cav.inputs['Factor'])
    links.new(cav.outputs[2], bsdf.inputs['Base Color'])
    # Bump: Voronoi cracks + fine noise
    vo = nodes.new('ShaderNodeTexVoronoi'); vo.location = (-600, -500)
    vo.inputs['Scale'].default_value = noise_scale * 2.5
    links.new(tc.outputs['Object'], vo.inputs['Vector'])
    n2 = nodes.new('ShaderNodeTexNoise'); n2.location = (-600, -700)
    n2.inputs['Scale'].default_value = noise_scale * 5; n2.inputs['Detail'].default_value = 12.0
    links.new(tc.outputs['Object'], n2.inputs['Vector'])
    ba = nodes.new('ShaderNodeMath'); ba.operation = 'ADD'; ba.location = (-300, -600)
    links.new(vo.outputs['Distance'], ba.inputs[0]); links.new(n2.outputs['Fac'], ba.inputs[1])
    bp = nodes.new('ShaderNodeBump'); bp.location = (300, -500); bp.inputs['Strength'].default_value = bump_strength
    links.new(ba.outputs[0], bp.inputs['Height']); links.new(bp.outputs['Normal'], bsdf.inputs['Normal'])
    # Roughness variation
    rr = nodes.new('ShaderNodeMapRange'); rr.location = (-200, -100)
    rr.inputs['To Min'].default_value = max(0.1, roughness - 0.2)
    rr.inputs['To Max'].default_value = min(1.0, roughness + 0.2)
    links.new(n1.outputs['Fac'], rr.inputs['Value']); links.new(rr.outputs['Result'], bsdf.inputs['Roughness'])
    return mat

def make_emissive(name, color_rgba, strength=5.0):
    """Crystal/emissive material with refraction, internal veins, and glow shimmer."""
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes; links = mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color_rgba
    bsdf.inputs["Roughness"].default_value = 0.05
    bsdf.inputs["Emission Color"].default_value = color_rgba
    bsdf.inputs["Emission Strength"].default_value = strength
    # Refraction for crystal look
    try:
        bsdf.inputs["IOR"].default_value = 1.45
        bsdf.inputs["Transmission Weight"].default_value = 0.7
        bsdf.inputs["Coat Weight"].default_value = 0.3
        bsdf.inputs["Coat Roughness"].default_value = 0.02
    except:
        pass
    if hasattr(mat, 'use_screen_refraction'):
        mat.use_screen_refraction = True
    # Internal vein noise for crystal depth
    tc = nodes.new('ShaderNodeTexCoord')
    n = nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 15.0
    n.inputs['Detail'].default_value = 8.0; n.inputs['Distortion'].default_value = 2.0
    links.new(tc.outputs['Object'], n.inputs['Vector'])
    # Emission shimmer
    r = nodes.new('ShaderNodeMapRange')
    r.inputs['To Min'].default_value = strength * 0.3; r.inputs['To Max'].default_value = strength * 1.5
    links.new(n.outputs['Fac'], r.inputs['Value']); links.new(r.outputs['Result'], bsdf.inputs['Emission Strength'])
    return mat

# Create materials
mat_primary = make_pbr("${asset.id}_Primary", ${hexToRgb(primary)}, roughness=${roughness}, metallic=${metallic}, bump_strength=${bumpStr}, noise_scale=${matSet.primary.noiseScale})
mat_secondary = make_pbr("${asset.id}_Secondary", ${hexToRgb(secondary)}, roughness=${matSet.secondary.roughness}, bump_strength=${matSet.secondary.bumpStrength})
mat_accent = make_pbr("${asset.id}_Accent", ${hexToRgb(accent)}, roughness=${matSet.accent.roughness}, metallic=${matSet.accent.metallic})
mat_dark = make_pbr("${asset.id}_Dark", ${hexToRgb(dark)}, roughness=${matSet.dark.roughness}, bump_strength=${matSet.dark.bumpStrength})

# ══════════════════════════════════════════════════════════════════
# GEOMETRY BUILDERS (bmesh-based, high quality)
# ══════════════════════════════════════════════════════════════════

def build_rock(location=(0,0,0), scale=1.5, seed=SEED, shape='boulder'):
    """Natural rock via multi-pass fractal noise displacement on icosphere."""
    random.seed(seed)
    mesh = bpy.data.meshes.new("Rock")
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=scale)
    # Pass 1: Large-scale shape (not a sphere)
    for v in bm.verts:
        co = v.co.copy()
        o1 = noise.fractal(co * 0.8, 1.0, 2.0, 3, noise_basis='BLENDER')
        o2 = noise.fractal(co * 2.5, 0.5, 2.0, 5, noise_basis='VORONOI_F2F1')
        o3 = noise.fractal(co * 8.0, 0.15, 2.0, 2, noise_basis='BLENDER')
        bias = Vector((random.uniform(-0.2, 0.2), random.uniform(-0.2, 0.2), -0.1))
        v.co = co + co.normalized() * (o1 * 0.4 + o2 * 0.15 + o3 * 0.04) + bias * o1
    # Shape variants
    if shape == 'slab':
        for v in bm.verts: v.co.z *= 0.3
    elif shape == 'spire':
        for v in bm.verts:
            h = max(0, v.co.z) / scale
            v.co.x *= (1.0 - h * 0.6); v.co.y *= (1.0 - h * 0.6)
            v.co.z *= 2.0
    elif shape == 'cliff':
        for v in bm.verts:
            if v.co.y > 0: v.co.y *= 0.2
    # Flatten bottom
    for v in bm.verts:
        if v.co.z < -scale * 0.3:
            v.co.z = -scale * 0.3 + random.uniform(-0.03, 0.03)
    bm.to_mesh(mesh); bm.free()
    obj = bpy.data.objects.new("Rock", mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.data.materials.append(mat_primary)
    return obj

def build_tree(location=(0,0,0), seed=SEED, height=6.0, trunk_radius=0.25,
               depth=4, angle=35, ratio=0.7, dead=False, corrupted=False, segments=6):
    """L-system recursive tree with proper branching topology."""
    random.seed(seed)
    mesh = bpy.data.meshes.new("TreeMesh"); bm = bmesh.new()
    leaf_positions = []
    def branch(start, direction, length, radius, d):
        if d <= 0 or radius < 0.005:
            if not dead: leaf_positions.append(start + direction * length)
            return
        curve_off = Vector((random.uniform(-0.1,0.1)*length, random.uniform(-0.1,0.1)*length, random.uniform(-0.02,0.05)*length))
        end = start + direction * length + curve_off
        up = Vector((0,0,1))
        if abs(direction.dot(up)) > 0.99: up = Vector((1,0,0))
        right = direction.cross(up).normalized()
        fwd = right.cross(direction).normalized()
        end_r = radius * 0.75
        sr, er = [], []
        for i in range(segments):
            a = 2*math.pi*i/segments
            os = (right*math.cos(a) + fwd*math.sin(a))
            sr.append(bm.verts.new(start + os*radius))
            er.append(bm.verts.new(end + os*end_r))
        for i in range(segments):
            j = (i+1)%segments
            try: bm.faces.new([sr[i], sr[j], er[j], er[i]])
            except: pass
        nc = random.randint(2,3) if d > 1 else random.randint(1,2)
        for c in range(nc):
            ca = math.radians(angle + random.uniform(-10,10))
            ta = math.radians((360/nc)*c + random.uniform(-15,15))
            ax = right*math.cos(ta) + fwd*math.sin(ta)
            rm = Matrix.Rotation(ca, 3, ax)
            cd = (rm @ direction).normalized()
            if dead: cd.z -= 0.15*(4-d)
            else: cd.z += 0.05
            if corrupted and random.random() < 0.3:
                cd += Vector((random.uniform(-0.5,0.5), random.uniform(-0.5,0.5), random.uniform(-0.3,0.3)))
            cd.normalize()
            bs = start.lerp(end, random.uniform(0.5,0.95))
            branch(bs, cd, length*ratio*random.uniform(0.8,1.2), end_r*random.uniform(0.5,0.7), d-1)
    trunk_dir = Vector((0,0,1))
    if corrupted: trunk_dir += Vector((random.uniform(-0.15,0.15), random.uniform(-0.15,0.15), 0)); trunk_dir.normalize()
    branch(Vector(location), trunk_dir, height*0.4, trunk_radius, depth)
    bm.to_mesh(mesh); bm.free()
    tree = bpy.data.objects.new("Tree", mesh)
    bpy.context.collection.objects.link(tree)
    tree.data.materials.append(mat_secondary)
    # Leaf clusters at branch tips
    if not dead and leaf_positions:
        for i, pos in enumerate(leaf_positions[:25]):
            lm = bpy.data.meshes.new(f"Leaf_{i}"); lb = bmesh.new()
            for j in range(random.randint(3,5)):
                sz = random.uniform(0.15,0.35)
                off = Vector((random.uniform(-0.2,0.2), random.uniform(-0.2,0.2), random.uniform(-0.1,0.15)))
                v1=lb.verts.new(pos+off+Vector((0,0,sz/2))); v2=lb.verts.new(pos+off+Vector((sz/2,0,0)))
                v3=lb.verts.new(pos+off+Vector((0,0,-sz/2))); v4=lb.verts.new(pos+off+Vector((-sz/2,0,0)))
                try: lb.faces.new([v1,v2,v3,v4])
                except: pass
            lb.to_mesh(lm); lb.free()
            lo = bpy.data.objects.new(f"LeafCluster_{i}", lm)
            bpy.context.collection.objects.link(lo)
            lo.data.materials.append(mat_primary)
    return tree

def build_column(location=(0,0,0), height=4.0, radius=0.3, segments=12, fluted=True):
    """Gothic column with base, fluted shaft, and capital via profile revolution."""
    mesh = bpy.data.meshes.new("Column"); bm = bmesh.new()
    profile = [(0.00,1.6),(0.02,1.6),(0.04,1.3),(0.06,1.4),(0.08,1.0),
               (0.85,0.95),(0.87,1.15),(0.89,1.1),(0.92,1.5),(0.95,1.6),(1.0,1.55)]
    all_rings = []
    for hf, rm in profile:
        ring = []
        for i in range(segments):
            a = 2*math.pi*i/segments
            r = radius * rm
            ring.append(bm.verts.new((math.cos(a)*r + location[0], math.sin(a)*r + location[1], hf*height + location[2])))
        if all_rings:
            prev = all_rings[-1]
            for i in range(segments):
                j = (i+1) % segments
                try: bm.faces.new([prev[i], prev[j], ring[j], ring[i]])
                except: pass
        all_rings.append(ring)
    # Cap top
    if all_rings:
        try: bm.faces.new(list(reversed(all_rings[-1])))
        except: pass
        try: bm.faces.new(all_rings[0])
        except: pass
    # Fluting — push alternating shaft verts inward
    if fluted:
        bm.verts.ensure_lookup_table()
        for v in bm.verts:
            rh = (v.co.z - location[2]) / height
            if 0.08 < rh < 0.85:
                ang = math.atan2(v.co.y - location[1], v.co.x - location[0])
                si = int((ang + math.pi) / (2*math.pi) * segments)
                if si % 2 == 0:
                    d = Vector((v.co.x-location[0], v.co.y-location[1], 0)).normalized()
                    v.co -= d * radius * 0.08
    bm.to_mesh(mesh); bm.free()
    obj = bpy.data.objects.new("Column", mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat_primary)
    return obj

def build_arch(location=(0,0,0), width=3.0, height=4.0, thickness=0.5, depth=0.6):
    """Gothic pointed arch — two pillars + arch curve, with bmesh."""
    mesh = bpy.data.meshes.new("Arch"); bm = bmesh.new()
    hw = width / 2; segs = 12
    # Build 2D arch profile (left pillar → arch curve → right pillar)
    pts = []
    pts.append(Vector((-hw - thickness/2, 0)))
    pts.append(Vector((-hw - thickness/2, height * 0.6)))
    # Left arc
    for i in range(segs+1):
        t = i / segs
        a = math.pi - math.pi*0.6*t
        x = hw * math.cos(a) * 0.3 - hw * 0.3
        y = height*0.6 + hw*1.2*math.sin(a)
        pts.append(Vector((x, y)))
    # Right arc
    for i in range(segs, -1, -1):
        t = i / segs
        a = math.pi*0.6*t
        x = hw * math.cos(a) * 0.3 + hw * 0.3
        y = height*0.6 + hw*1.2*math.sin(a)
        pts.append(Vector((x, y)))
    pts.append(Vector((hw + thickness/2, height * 0.6)))
    pts.append(Vector((hw + thickness/2, 0)))
    # Extrude into 3D
    front, back = [], []
    for p in pts:
        front.append(bm.verts.new((p.x+location[0], p.y+location[2], location[1]+depth/2)))
        back.append(bm.verts.new((p.x+location[0], p.y+location[2], location[1]-depth/2)))
    n = len(pts)
    for i in range(n):
        j = (i+1) % n
        try: bm.faces.new([front[i], front[j], back[j], back[i]])
        except: pass
    try: bm.faces.new(front)
    except: pass
    try: bm.faces.new(list(reversed(back)))
    except: pass
    bm.to_mesh(mesh); bm.free()
    obj = bpy.data.objects.new("Arch", mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat_primary)
    return obj

def build_crystal(location=(0,0,0), scale=1.0, seed=SEED, cluster=True):
    """Faceted crystal cluster with internal glow veins."""
    random.seed(seed)
    crystals = []
    count = random.randint(3, 6) if cluster else 1
    for i in range(count):
        h = scale * random.uniform(0.8, 2.0)
        r = scale * random.uniform(0.1, 0.25)
        mesh = bpy.data.meshes.new(f"Crystal_{i}"); bm = bmesh.new()
        faces_per_ring = 6
        # Base ring
        base = [bm.verts.new((math.cos(2*math.pi*j/faces_per_ring)*r, math.sin(2*math.pi*j/faces_per_ring)*r, 0)) for j in range(faces_per_ring)]
        # Middle ring (wider)
        mid_h = h * random.uniform(0.3, 0.5)
        mid_r = r * random.uniform(1.1, 1.4)
        mid = [bm.verts.new((math.cos(2*math.pi*j/faces_per_ring)*mid_r + random.uniform(-0.02,0.02)*scale,
                              math.sin(2*math.pi*j/faces_per_ring)*mid_r + random.uniform(-0.02,0.02)*scale,
                              mid_h)) for j in range(faces_per_ring)]
        # Tip (single point, slightly off-center)
        tip = bm.verts.new((random.uniform(-0.03,0.03)*scale, random.uniform(-0.03,0.03)*scale, h))
        # Connect base→mid
        for j in range(faces_per_ring):
            k = (j+1) % faces_per_ring
            try: bm.faces.new([base[j], base[k], mid[k], mid[j]])
            except: pass
        # Connect mid→tip
        for j in range(faces_per_ring):
            k = (j+1) % faces_per_ring
            try: bm.faces.new([mid[j], mid[k], tip])
            except: pass
        # Cap bottom
        try: bm.faces.new(list(reversed(base)))
        except: pass
        bm.to_mesh(mesh); bm.free()
        off = Vector((random.uniform(-0.3,0.3)*scale, random.uniform(-0.3,0.3)*scale, 0)) if i > 0 else Vector((0,0,0))
        obj = bpy.data.objects.new(f"Crystal_{i}", mesh)
        bpy.context.collection.objects.link(obj)
        obj.location = Vector(location) + off
        tilt = random.uniform(-0.3, 0.3)
        obj.rotation_euler = (tilt, random.uniform(-0.3, 0.3), random.uniform(0, 6.28))
        obj.data.materials.append(mat_accent)
        crystals.append(obj)
    return crystals

def build_mushroom(location=(0,0,0), scale=1.0, seed=SEED, bioluminescent=False):
    """Organic mushroom with gill detail under cap."""
    random.seed(seed)
    # Stem via bmesh
    sm = bpy.data.meshes.new("Stem"); sb = bmesh.new()
    segs, rings = 8, 6
    stem_h = scale * random.uniform(1.5, 2.5)
    for ri in range(rings):
        t = ri / (rings-1)
        r = scale * (0.12 + 0.04 * math.sin(t * math.pi))  # slight bulge
        z = t * stem_h
        for si in range(segs):
            a = 2*math.pi*si/segs
            sb.verts.new((math.cos(a)*r + location[0], math.sin(a)*r + location[1], z + location[2]))
    sb.verts.ensure_lookup_table()
    for ri in range(rings-1):
        for si in range(segs):
            sj = (si+1)%segs
            i0 = ri*segs+si; i1 = ri*segs+sj; i2 = (ri+1)*segs+sj; i3 = (ri+1)*segs+si
            try: sb.faces.new([sb.verts[i0], sb.verts[i1], sb.verts[i2], sb.verts[i3]])
            except: pass
    sb.to_mesh(sm); sb.free()
    stem = bpy.data.objects.new("Stem", sm)
    bpy.context.collection.objects.link(stem)
    stem.data.materials.append(mat_secondary)
    # Cap via bmesh hemisphere + noise
    cm = bpy.data.meshes.new("Cap"); cb = bmesh.new()
    cap_r = scale * random.uniform(0.6, 1.0)
    bmesh.ops.create_uvsphere(cb, u_segments=16, v_segments=8, radius=cap_r)
    # Remove bottom half + noise deform top
    cb.verts.ensure_lookup_table()
    to_del = [v for v in cb.verts if v.co.z < -cap_r * 0.1]
    bmesh.ops.delete(cb, geom=to_del, context='VERTS')
    # Flatten underside + noise on top
    for v in cb.verts:
        if v.co.z < cap_r * 0.15:
            v.co.z = cap_r * 0.05
        else:
            n_off = noise.fractal(v.co * 2.0, 0.3, 2.0, 3)
            v.co += v.co.normalized() * n_off * 0.1
    cb.to_mesh(cm); cb.free()
    cap = bpy.data.objects.new("Cap", cm)
    bpy.context.collection.objects.link(cap)
    cap.location = (location[0], location[1], location[2] + stem_h)
    mat_cap = make_emissive("CapGlow", ${hexToRgb(accent)}, 3.0) if bioluminescent else mat_primary
    cap.data.materials.append(mat_cap)
    return [stem, cap]

def build_vine(start=(0,0,0), end=(0,0,3), twists=3, thickness=0.04, seed=SEED):
    """Spiraling vine/tendril using bezier curve with bevel."""
    random.seed(seed)
    cd = bpy.data.curves.new("Vine", 'CURVE')
    cd.dimensions = '3D'; cd.resolution_u = 12
    cd.bevel_depth = thickness; cd.bevel_resolution = 3
    sp = cd.splines.new('BEZIER')
    np = 12; sp.bezier_points.add(np-1)
    sv, ev = Vector(start), Vector(end)
    for i, bp in enumerate(sp.bezier_points):
        t = i / (np-1)
        pos = sv.lerp(ev, t)
        spiral_r = 0.2 * math.sin(t * math.pi)
        pos.x += math.cos(t * twists * 2*math.pi) * spiral_r
        pos.y += math.sin(t * twists * 2*math.pi) * spiral_r
        pos += Vector((random.uniform(-0.05,0.05), random.uniform(-0.05,0.05), 0))
        bp.co = pos; bp.handle_type = 'AUTO'
    obj = bpy.data.objects.new("Vine", cd)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat_primary)
    return obj

def build_campfire(location=(0,0,0), scale=1.0):
    """Campfire with individually modeled logs, rock ring, and fire emitter."""
    objs = []
    # Rock ring (8 bmesh rocks in a circle)
    for i in range(8):
        a = 2*math.pi*i/8
        r_pos = Vector((math.cos(a)*0.6*scale + location[0], math.sin(a)*0.6*scale + location[1], location[2]+0.1))
        rock = build_rock(location=r_pos, scale=0.15*scale, seed=SEED+i, shape='boulder')
        rock.data.materials.clear(); rock.data.materials.append(mat_dark)
        objs.append(rock)
    # Logs (3 crossed cylinders with bmesh bark texture)
    for i in range(3):
        a = math.pi * i / 3
        lm = bpy.data.meshes.new(f"Log_{i}"); lb = bmesh.new()
        bmesh.ops.create_cone(lb, segments=8, radius1=0.06*scale, radius2=0.05*scale, depth=0.8*scale, cap_ends=True)
        # Bark noise
        for v in lb.verts:
            n_off = noise.fractal(v.co * 5.0, 0.3, 2.0, 3)
            v.co += v.co.normalized() * n_off * 0.01
        lb.to_mesh(lm); lb.free()
        lo = bpy.data.objects.new(f"Log_{i}", lm)
        bpy.context.collection.objects.link(lo)
        lo.location = (location[0], location[1], location[2] + 0.15*scale)
        lo.rotation_euler = (0.3 + random.uniform(-0.1,0.1), 0, a)
        lo.data.materials.append(mat_secondary)
        objs.append(lo)
    # Fire emitter (small emissive ico)
    fm = bpy.data.meshes.new("Fire"); fb = bmesh.new()
    bmesh.ops.create_icosphere(fb, subdivisions=2, radius=0.2*scale)
    for v in fb.verts:
        if v.co.z < 0: v.co.z *= 0.3  # flatten bottom
        v.co.z += 0.25 * scale
        n_off = noise.fractal(v.co * 3.0, 0.5, 2.0, 3)
        v.co += v.co.normalized() * n_off * 0.08
    fb.to_mesh(fm); fb.free()
    fire = bpy.data.objects.new("Fire", fm)
    bpy.context.collection.objects.link(fire)
    fire.location = location
    fire.data.materials.append(make_emissive("FireGlow", (1.0, 0.4, 0.05, 1.0), 12.0))
    objs.append(fire)
    return objs

def build_container(location=(0,0,0), scale=1.0, kind='chest'):
    """Chest/crate/barrel with plank detail, iron bands, etc."""
    if kind == 'barrel':
        # Barrel: cylinder + inset rings
        mesh = bpy.data.meshes.new("Barrel"); bm = bmesh.new()
        segs, rings = 12, 8
        h = scale * 1.0; r = scale * 0.35
        for ri in range(rings):
            t = ri / (rings-1); z = t * h
            bulge = 1.0 + 0.08 * math.sin(t * math.pi)  # barrel curve
            for si in range(segs):
                a = 2*math.pi*si/segs
                bm.verts.new((math.cos(a)*r*bulge+location[0], math.sin(a)*r*bulge+location[1], z+location[2]))
        bm.verts.ensure_lookup_table()
        for ri in range(rings-1):
            for si in range(segs):
                sj = (si+1)%segs
                i0=ri*segs+si; i1=ri*segs+sj; i2=(ri+1)*segs+sj; i3=(ri+1)*segs+si
                try: bm.faces.new([bm.verts[i0], bm.verts[i1], bm.verts[i2], bm.verts[i3]])
                except: pass
        bm.to_mesh(mesh); bm.free()
        obj = bpy.data.objects.new("Barrel", mesh)
        bpy.context.collection.objects.link(obj)
        obj.data.materials.append(mat_secondary)
        # Iron bands (torus rings)
        for bh in [0.2, 0.5, 0.8]:
            bpy.ops.mesh.primitive_torus_add(major_radius=r*1.05*scale, minor_radius=0.015*scale,
                location=(location[0], location[1], location[2]+bh*h))
            band = bpy.context.object; band.name = f"Band_{int(bh*10)}"
            band.data.materials.append(mat_dark)
        return obj
    elif kind == 'crate':
        # Crate: cube with plank insets via bmesh
        mesh = bpy.data.meshes.new("Crate"); bm = bmesh.new()
        sz = scale * 0.5
        bmesh.ops.create_cube(bm, size=sz*2)
        # Inset each face for plank lines
        for f in list(bm.faces):
            try:
                result = bmesh.ops.inset_individual(bm, faces=[f], thickness=0.02*scale, depth=0.005*scale)
            except: pass
        # Noise deform for aged wood
        for v in bm.verts:
            n_off = noise.fractal(v.co * 4.0, 0.2, 2.0, 2)
            v.co += v.co.normalized() * n_off * 0.01
        bm.to_mesh(mesh); bm.free()
        obj = bpy.data.objects.new("Crate", mesh)
        bpy.context.collection.objects.link(obj)
        obj.location = location
        obj.data.materials.append(mat_secondary)
        return obj
    else:
        # Chest: box with lid + iron bands
        mesh = bpy.data.meshes.new("Chest"); bm = bmesh.new()
        w, d, h = 0.6*scale, 0.4*scale, 0.35*scale
        # Bottom box
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co.x *= w; v.co.y *= d; v.co.z *= h
            v.co.z += h  # lift above ground
        # Inset top face for lid line
        top_faces = [f for f in bm.faces if f.normal.z > 0.9]
        for f in top_faces:
            try: bmesh.ops.inset_individual(bm, faces=[f], thickness=0.02*scale, depth=0.01*scale)
            except: pass
        bm.to_mesh(mesh); bm.free()
        obj = bpy.data.objects.new("Chest", mesh)
        bpy.context.collection.objects.link(obj)
        obj.location = location
        obj.data.materials.append(mat_secondary)
        # Lock (small metallic cube)
        bpy.ops.mesh.primitive_cube_add(size=0.06*scale, location=(location[0]+w*0.9, location[1], location[2]+h*1.8))
        lock = bpy.context.object; lock.name = "Lock"
        lock.data.materials.append(mat_dark)
        return obj

def build_wall(location=(0,0,0), width=4.0, height=3.0, thickness=0.5):
    """Stone wall with block pattern via bmesh insets."""
    mesh = bpy.data.meshes.new("Wall"); bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= width/2; v.co.y *= thickness/2; v.co.z *= height/2
        v.co.z += height/2
    # Subdivide front face for stone blocks
    front = [f for f in bm.faces if f.normal.y > 0.9]
    for f in front:
        try:
            bmesh.ops.subdivide_edges(bm, edges=f.edges[:], cuts=3)
        except: pass
    # Inset subdivided faces for block lines
    bm.faces.ensure_lookup_table()
    for f in list(bm.faces):
        if f.normal.y > 0.9 and len(f.verts) == 4:
            try: bmesh.ops.inset_individual(bm, faces=[f], thickness=0.03, depth=0.02)
            except: pass
    # Stone noise
    for v in bm.verts:
        n_off = noise.fractal(v.co * 3.0, 0.15, 2.0, 2)
        v.co += v.co.normalized() * n_off * 0.02
    bm.to_mesh(mesh); bm.free()
    obj = bpy.data.objects.new("Wall", mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.data.materials.append(mat_primary)
    return obj

def build_door(location=(0,0,0), width=1.2, height=2.5, planks=5):
    """Medieval door with planks, iron bands, studs, and hinges."""
    objs = []
    pw = width / planks
    for i in range(planks):
        pm = bpy.data.meshes.new(f"Plank_{i}"); pb = bmesh.new()
        bmesh.ops.create_cube(pb, size=1.0)
        for v in pb.verts:
            v.co.x *= pw * 0.47; v.co.y *= 0.04; v.co.z *= height/2
            v.co.z += height/2
            # Wood grain noise
            n_off = noise.fractal(Vector((v.co.x, v.co.z*0.3, 0)) * 5.0, 0.1, 2.0, 3)
            v.co.y += n_off * 0.005
        pb.to_mesh(pm); pb.free()
        po = bpy.data.objects.new(f"Plank_{i}", pm)
        bpy.context.collection.objects.link(po)
        po.location = (location[0] - width/2 + pw*(i+0.5), location[1], location[2])
        po.data.materials.append(mat_secondary)
        objs.append(po)
    # Iron bands (3 horizontal)
    for bh in [0.25, 0.5, 0.75]:
        bpy.ops.mesh.primitive_cube_add(size=1, location=(location[0], location[1]+0.05, location[2]+height*bh))
        band = bpy.context.object; band.scale = (width/2, 0.008, 0.04)
        band.name = f"IronBand_{int(bh*100)}"
        band.data.materials.append(mat_dark)
        objs.append(band)
    # Studs
    for bh in [0.25, 0.5, 0.75]:
        for sx in [-width*0.35, -width*0.1, width*0.1, width*0.35]:
            bpy.ops.mesh.primitive_uv_sphere_add(radius=0.02, segments=6, ring_count=4,
                location=(location[0]+sx, location[1]+0.06, location[2]+height*bh))
            stud = bpy.context.object; stud.name = "Stud"
            stud.data.materials.append(mat_dark)
    # Hinges (2)
    for hz in [0.3, 0.7]:
        bpy.ops.mesh.primitive_cylinder_add(radius=0.03, depth=0.06,
            location=(location[0]-width/2+0.05, location[1]+0.05, location[2]+height*hz),
            rotation=(1.5708, 0, 0))
        hinge = bpy.context.object; hinge.name = "Hinge"
        hinge.data.materials.append(mat_dark)
    return objs

def build_generic_prop(location=(0,0,0), scale=1.0, description=""):
    """Fallback: beveled cube with noise deformation — better than raw primitive."""
    mesh = bpy.data.meshes.new("Prop"); bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=scale)
    # Subdivide for detail
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=2)
    # Noise deform
    for v in bm.verts:
        n_off = noise.fractal(v.co * 3.0, 0.3, 2.0, 3)
        v.co += v.co.normalized() * n_off * 0.05 * scale
    # Flatten bottom
    for v in bm.verts:
        if v.co.z < -scale * 0.3:
            v.co.z = -scale * 0.3
    bm.to_mesh(mesh); bm.free()
    obj = bpy.data.objects.new("Prop", mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.data.materials.append(mat_primary)
    # Bevel modifier for clean edges
    bev = obj.modifiers.new(name="Bevel", type='BEVEL')
    bev.width = 0.02 * scale; bev.segments = 2; bev.limit_method = 'ANGLE'; bev.angle_limit = 0.785
    return obj

# ══════════════════════════════════════════════════════════════════
# ASSET CONSTRUCTION: ${asset.name}
# ${asset.description}
# ══════════════════════════════════════════════════════════════════

try:
    ${getAssetGeometryCode_v2(asset, region)}

    finalize_all()
    print(f"Asset '${asset.name}' created — " + str(sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type=='MESH')) + " total faces")

except Exception as e:
    print(f"ERROR generating ${asset.id}: {e}")
    import traceback; traceback.print_exc()

# ── Animation ──
${getAssetAnimationCode(asset)}
`;
}

// ── Asset Type Detection ─────────────────────────────────────────────────────

function detectAssetType(asset) {
  const id = (asset.id || '').toLowerCase();
  const desc = (asset.description || '').toLowerCase();

  if (/tree|oak|pine|willow|birch|dead_tree|charred/.test(id)) return 'tree';
  if (/rock|boulder|stone|rubble|pillar|spire|cliff/.test(id)) return 'rock';
  if (/crystal|shard|gem|void/.test(id)) return 'crystal';
  if (/mushroom|fungi|spore/.test(id)) return 'mushroom';
  if (/campfire|fire_pit|fire_ring|bonfire/.test(id)) return 'campfire';
  if (/chest|crate|barrel|box/.test(id)) return 'container';
  if (/door|gate|portcullis/.test(id)) return 'door';
  if (/arch|gateway|bridge/.test(id)) return 'arch';
  if (/wall|battlement|fence/.test(id)) return 'wall';
  if (/column|pilaster|post/.test(id)) return 'column';
  if (/vine|tendril|root|moss|hanging/.test(id)) return 'vine';
  if (/altar|shrine|wayshrine/.test(id)) return 'shrine';
  if (/torch|sconce|lantern|lamp/.test(id)) return 'light';
  if (/banner|flag|cloth/.test(id)) return 'banner';
  if (/weapon|rack|sword|shield|anvil/.test(id)) return 'prop';
  if (/lava|magma|pool|vent/.test(id)) return 'lava';
  if (/bone|skull|skeleton/.test(id)) return 'bones';
  if (/stall|market|shop/.test(id)) return 'stall';
  if (/signpost|sign/.test(id)) return 'signpost';
  if (/ladder|steps|stairs/.test(id)) return 'ladder';

  // Fallback: try description
  if (/organic|natural|grown/.test(desc)) return 'rock';
  if (/building|structure|ruin/.test(desc)) return 'arch';
  return 'prop';
}

// ── Geometry Code v2: dispatches to bmesh builder functions ──────────────────

function getAssetGeometryCode_v2(asset, region) {
  const id = (asset.id || '').toLowerCase();
  const type = detectAssetType(asset);
  const desc = asset.description || asset.name || '';

  // Size heuristics from description
  const sizeMatch = desc.match(/(\d+(?:\.\d+)?)\s*m/);
  const size = sizeMatch ? parseFloat(sizeMatch[1]) : null;

  switch (type) {
    case 'tree': {
      const dead = /dead|charred|burnt|withered|skeletal/.test(id);
      const corrupted = /corrupt|twisted|dark|void|taint/.test(id);
      const height = size || (dead ? 5.0 : 7.0);
      return `build_tree(location=(0,0,0), seed=SEED, height=${height}, trunk_radius=0.25, depth=4, angle=35, ratio=0.7, dead=${dead ? 'True' : 'False'}, corrupted=${corrupted ? 'True' : 'False'})`;
    }

    case 'rock': {
      const shape = /spire|stalac/.test(id) ? 'spire' : /slab|flat/.test(id) ? 'slab' : /cliff|face/.test(id) ? 'cliff' : 'boulder';
      const scale = size || 1.5;
      // Multiple rocks for formations
      if (/formation|cluster|pile|stream_rocks/.test(id)) {
        return `
for i in range(random.randint(3, 6)):
    off = Vector((random.uniform(-1.5, 1.5), random.uniform(-1.5, 1.5), 0))
    build_rock(location=off, scale=${scale} * random.uniform(0.4, 1.0), seed=SEED+i, shape='${shape}')`;
      }
      return `build_rock(location=(0,0,0), scale=${scale}, seed=SEED, shape='${shape}')`;
    }

    case 'crystal':
      return `build_crystal(location=(0,0,0), scale=${size || 1.0}, seed=SEED, cluster=${/cluster|formation|pile/.test(id) ? 'True' : 'False'})`;

    case 'mushroom': {
      const bio = /bio|glow|luminesc/.test(id) || /bio|glow|luminesc/.test(desc);
      return `build_mushroom(location=(0,0,0), scale=${size ? size / 2 : 1.0}, seed=SEED, bioluminescent=${bio ? 'True' : 'False'})`;
    }

    case 'campfire':
      return `build_campfire(location=(0,0,0), scale=${size || 1.0})`;

    case 'container': {
      const kind = /barrel/.test(id) ? 'barrel' : /crate/.test(id) ? 'crate' : 'chest';
      return `build_container(location=(0,0,0), scale=${size || 1.0}, kind='${kind}')`;
    }

    case 'door':
      return `build_door(location=(0,0,0), width=${size ? size * 0.5 : 1.2}, height=${size || 2.5})`;

    case 'arch':
      return `build_arch(location=(0,0,0), width=${size ? size * 0.7 : 3.0}, height=${size || 4.0})`;

    case 'wall':
      return `build_wall(location=(0,0,0), width=${size || 4.0}, height=${size ? size * 0.75 : 3.0})`;

    case 'column':
      return `build_column(location=(0,0,0), height=${size || 4.0}, radius=0.3)`;

    case 'vine':
      return `
for i in range(random.randint(3, 6)):
    sx = random.uniform(-0.5, 0.5); sy = random.uniform(-0.5, 0.5)
    build_vine(start=(sx, sy, ${size || 3.0}), end=(sx+random.uniform(-0.3,0.3), sy+random.uniform(-0.3,0.3), 0), twists=random.randint(2,4), thickness=random.uniform(0.02,0.06), seed=SEED+i)`;

    case 'shrine': {
      // Shrine = platform + column + crystal cluster
      return `
# Platform
build_rock(location=(0,0,0), scale=1.2, seed=SEED, shape='slab')
# Central pillar
build_column(location=(0,0,0.3), height=${size || 2.0}, radius=0.2)
# Crystal on top
build_crystal(location=(0,0,${(size || 2.0) + 0.5}), scale=0.4, seed=SEED+1, cluster=True)`;
    }

    case 'light': {
      // Torch/lantern = pole + flame emitter
      return `
# Pole/bracket
bpy.ops.mesh.primitive_cylinder_add(radius=0.03, depth=${size || 1.5}, location=(0, 0, ${(size || 1.5) / 2}))
pole = bpy.context.object; pole.name = "Pole"; pole.data.materials.append(mat_dark)
# Flame
fm = bpy.data.meshes.new("Flame"); fb = bmesh.new()
bmesh.ops.create_icosphere(fb, subdivisions=2, radius=0.1)
for v in fb.verts:
    v.co.z = max(v.co.z, -0.02)
    n_off = noise.fractal(v.co * 5.0, 0.4, 2.0, 3)
    v.co += v.co.normalized() * n_off * 0.03
fb.to_mesh(fm); fb.free()
flame = bpy.data.objects.new("Flame", fm)
bpy.context.collection.objects.link(flame)
flame.location = (0, 0, ${size || 1.5})
flame.data.materials.append(make_emissive("FlameGlow", (1.0, 0.5, 0.1, 1.0), 10.0))`;
    }

    case 'banner': {
      return `
# Pole
bpy.ops.mesh.primitive_cylinder_add(radius=0.03, depth=${size || 3.0}, location=(0, 0, ${(size || 3.0) / 2}))
pole = bpy.context.object; pole.name = "Pole"; pole.data.materials.append(mat_dark)
# Cloth — grid mesh with drape deformation
cm = bpy.data.meshes.new("Cloth"); cb = bmesh.new()
cols, rows = 8, 12
cw, ch = 0.8, ${(size || 3.0) * 0.6}
for r in range(rows):
    for c in range(cols):
        x = c / (cols-1) * cw
        z = ${size || 3.0} - 0.3 - r / (rows-1) * ch
        # Drape: sine wave + noise
        y = 0.05 + 0.08 * math.sin(r/rows * math.pi) + 0.03 * math.sin(c/cols * 2 * math.pi)
        y += noise.fractal(Vector((x, z, 0)) * 2.0, 0.1, 2.0, 2) * 0.03
        cb.verts.new((x, y, z))
cb.verts.ensure_lookup_table()
for r in range(rows-1):
    for c in range(cols-1):
        i0 = r*cols+c; i1 = r*cols+c+1; i2 = (r+1)*cols+c+1; i3 = (r+1)*cols+c
        try: cb.faces.new([cb.verts[i0], cb.verts[i1], cb.verts[i2], cb.verts[i3]])
        except: pass
cb.to_mesh(cm); cb.free()
cloth = bpy.data.objects.new("Cloth", cm)
bpy.context.collection.objects.link(cloth)
cloth.data.materials.append(mat_accent)`;
    }

    case 'lava': {
      return `
# Lava pool: flat disc with emissive material + rock rim
# Rim rocks
for i in range(10):
    a = 2*math.pi*i/10
    build_rock(location=(math.cos(a)*1.2, math.sin(a)*1.2, 0), scale=0.25, seed=SEED+i, shape='boulder')
# Lava surface
bpy.ops.mesh.primitive_circle_add(radius=1.0, vertices=32, fill_type='NGON', location=(0,0,0.05))
lava = bpy.context.object; lava.name = "LavaSurface"
lava.data.materials.append(make_emissive("LavaGlow", (1.0, 0.3, 0.0, 1.0), 8.0))`;
    }

    case 'bones': {
      return `
# Bone pile: scattered bmesh bones + skulls
random.seed(SEED)
# Ground mound
mound = build_rock(location=(0,0,0), scale=0.4, seed=SEED, shape='slab')
mound.data.materials.clear(); mound.data.materials.append(mat_dark)
# Long bones
for i in range(8):
    a = random.uniform(0, 6.28); d = random.uniform(0.1, 0.6); l = random.uniform(0.3, 0.7)
    bm_b = bpy.data.meshes.new(f"Bone_{i}"); bb = bmesh.new()
    bmesh.ops.create_cone(bb, segments=6, radius1=0.035, radius2=0.015, depth=l, cap_ends=True)
    for v in bb.verts:
        n_off = noise.fractal(v.co * 8.0, 0.1, 2.0, 2)
        v.co += v.co.normalized() * n_off * 0.005
    bb.to_mesh(bm_b); bb.free()
    bo = bpy.data.objects.new(f"Bone_{i}", bm_b)
    bpy.context.collection.objects.link(bo)
    bo.location = (math.cos(a)*d, math.sin(a)*d, 0.1)
    bo.rotation_euler = (random.uniform(-0.3,0.3), random.uniform(-0.3,0.3), a)
    bo.data.materials.append(mat_primary)
# Skulls (deformed ico spheres)
for i in range(3):
    sm = bpy.data.meshes.new(f"Skull_{i}"); sb = bmesh.new()
    bmesh.ops.create_icosphere(sb, subdivisions=2, radius=0.12)
    for v in sb.verts:
        v.co.y *= 0.75; v.co.z *= 0.85  # Slightly elongated
    sb.to_mesh(sm); sb.free()
    skull = bpy.data.objects.new(f"Skull_{i}", sm)
    bpy.context.collection.objects.link(skull)
    skull.location = (random.uniform(-0.4,0.4), random.uniform(-0.4,0.4), 0.15)
    skull.data.materials.append(mat_primary)`;
    }

    case 'stall': {
      return `
# Market stall: posts + counter + canopy cloth
# 4 posts
for px, py in [(-0.8,-0.5),(0.8,-0.5),(-0.8,0.5),(0.8,0.5)]:
    bpy.ops.mesh.primitive_cylinder_add(radius=0.04, depth=2.5, location=(px, py, 1.25))
    p = bpy.context.object; p.name = "Post"; p.data.materials.append(mat_secondary)
# Counter
build_rock(location=(0, -0.3, 0.8), scale=0.3, seed=SEED, shape='slab')
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.3, 0.8))
counter = bpy.context.object; counter.scale = (0.8, 0.3, 0.05)
counter.name = "Counter"; counter.data.materials.append(mat_secondary)
# Canopy (cloth grid)
cm = bpy.data.meshes.new("Canopy"); cb = bmesh.new()
for r in range(6):
    for c in range(8):
        x = -0.8 + c/7 * 1.6; y = -0.5 + r/5 * 1.0
        z = 2.5 + 0.1 * math.sin(c/7*math.pi) * math.sin(r/5*math.pi)
        z += noise.fractal(Vector((x,y,0))*2, 0.05, 2, 2) * 0.05
        cb.verts.new((x, y, z))
cb.verts.ensure_lookup_table()
for r in range(5):
    for c in range(7):
        i0=r*8+c; i1=r*8+c+1; i2=(r+1)*8+c+1; i3=(r+1)*8+c
        try: cb.faces.new([cb.verts[i0], cb.verts[i1], cb.verts[i2], cb.verts[i3]])
        except: pass
cb.to_mesh(cm); cb.free()
canopy = bpy.data.objects.new("Canopy", cm)
bpy.context.collection.objects.link(canopy)
canopy.data.materials.append(mat_accent)`;
    }

    case 'signpost': {
      return `
# Signpost: wooden post + angled sign boards
bpy.ops.mesh.primitive_cylinder_add(radius=0.05, depth=2.5, location=(0, 0, 1.25))
post = bpy.context.object; post.name = "Post"; post.data.materials.append(mat_secondary)
# Sign boards
for i, (h, rot) in enumerate([(2.0, 0.3), (1.6, -0.4), (1.2, 0.15)]):
    sm = bpy.data.meshes.new(f"Sign_{i}"); sb = bmesh.new()
    bmesh.ops.create_cube(sb, size=1.0)
    for v in sb.verts:
        v.co.x *= 0.4; v.co.y *= 0.02; v.co.z *= 0.12
        n_off = noise.fractal(v.co * 5.0, 0.05, 2.0, 2)
        v.co += v.co.normalized() * n_off * 0.005
    sb.to_mesh(sm); sb.free()
    sign = bpy.data.objects.new(f"Sign_{i}", sm)
    bpy.context.collection.objects.link(sign)
    sign.location = (0.25, 0, h); sign.rotation_euler = (0, 0, rot)
    sign.data.materials.append(mat_secondary)`;
    }

    case 'ladder': {
      return `
# Ladder: two rails + rungs + rope bindings
for sx in [-0.2, 0.2]:
    rm = bpy.data.meshes.new("Rail"); rb = bmesh.new()
    bmesh.ops.create_cube(rb, size=1.0)
    for v in rb.verts:
        v.co.x *= 0.03; v.co.y *= 0.03; v.co.z *= ${(size || 3.0) / 2}
        n_off = noise.fractal(v.co * 4.0, 0.05, 2.0, 2)
        v.co += v.co.normalized() * n_off * 0.003
    rb.to_mesh(rm); rb.free()
    rail = bpy.data.objects.new("Rail", rm)
    bpy.context.collection.objects.link(rail)
    rail.location = (sx, 0, ${(size || 3.0) / 2})
    rail.data.materials.append(mat_secondary)
# Rungs
for i in range(8):
    z = 0.2 + i * ${((size || 3.0) - 0.4) / 8}
    rm = bpy.data.meshes.new(f"Rung_{i}"); rb = bmesh.new()
    bmesh.ops.create_cylinder(rb, segments=6, radius=0.02, depth=0.4)
    rb.to_mesh(rm); rb.free()
    rung = bpy.data.objects.new(f"Rung_{i}", rm)
    bpy.context.collection.objects.link(rung)
    rung.location = (0, 0, z); rung.rotation_euler = (0, 1.5708, 0)
    rung.data.materials.append(mat_secondary)`;
    }

    default:
      return `build_generic_prop(location=(0,0,0), scale=${size || 1.0}, description="${desc.replace(/"/g, '\\"').slice(0, 100)}")`;
  }
}

// ── Legacy getAssetGeometryCode — REMOVED (replaced by v2 above) ────────────
// The old function had 3000+ lines of hardcoded primitives.
// Now dispatches to bmesh builder functions defined in the Python template.

// ── Legacy geometry code removed — was 3000+ lines of hardcoded primitives ──
// All geometry now built by bmesh builder functions in Python template above.
// Keeping this comment as a marker for the removal point.

// ── (Legacy 3000-line getAssetGeometryCode removed — now uses bmesh builders above) ──

// ── Animation Code Per Asset Type ─────────────────────────────────────────────
// Returns Blender Python code to keyframe-animate the asset (30fps, looping).
// Called after geometry creation, before FBX export.

const STATIC_TYPES = ['rock', 'stone', 'pillar', 'spire'];

function hasAnimation(asset) {
  return !STATIC_TYPES.some(t => asset.id.includes(t));
}

function getAssetAnimationCode(asset) {
  const LOOP = 60; // 2-second loop at 30fps

  // ── Fire / flame flicker (campfire, torch, sconce) ──
  if (asset.id.includes('campfire') || asset.id.includes('fire_pit') || asset.id.includes('fire_ring')) {
    return `
# Animation: fire flicker — scale pulse + emission cycle
import random
random.seed(7)
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

fire_obj = bpy.data.objects.get("${asset.id}_fire")
if fire_obj:
    fire_obj.animation_data_create()
    for f in range(1, ${LOOP + 1}, 2):
        sx = 0.85 + random.uniform(0, 0.3)
        sy = 0.85 + random.uniform(0, 0.3)
        sz = 0.8 + random.uniform(0, 0.5)
        fire_obj.scale = (sx, sy, sz)
        fire_obj.keyframe_insert(data_path='scale', frame=f)
        fire_obj.location.z = 0.35 + random.uniform(0, 0.1)
        fire_obj.keyframe_insert(data_path='location', frame=f)

# Pulse emission on fire material
mat_fire = bpy.data.materials.get("${asset.id}_FireGlow")
if mat_fire and mat_fire.use_nodes:
    bsdf = mat_fire.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            inp.default_value = 8.0 + random.uniform(0, 6)
            inp.keyframe_insert("default_value", frame=f)
print("Campfire animation applied")
`;
  }

  if (asset.id.includes('torch') || asset.id.includes('sconce')) {
    return `
# Animation: torch flame sway + flicker
import random
random.seed(11)
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

for name in ["${asset.id}_flame_core", "${asset.id}_flame_base"]:
    obj = bpy.data.objects.get(name)
    if obj:
        obj.animation_data_create()
        base_z = obj.location.z
        base_y = obj.location.y
        for f in range(1, ${LOOP + 1}, 2):
            obj.scale = (0.8 + random.uniform(0, 0.4), 0.8 + random.uniform(0, 0.4), 0.7 + random.uniform(0, 0.6))
            obj.keyframe_insert(data_path='scale', frame=f)
            obj.location.z = base_z + random.uniform(-0.01, 0.02)
            obj.location.y = base_y + random.uniform(-0.01, 0.01)
            obj.keyframe_insert(data_path='location', frame=f)

mat_flame = bpy.data.materials.get("${asset.id}_FlameGlow")
if mat_flame and mat_flame.use_nodes:
    bsdf = mat_flame.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            inp.default_value = 12.0 + random.uniform(0, 8)
            inp.keyframe_insert("default_value", frame=f)
print("Torch animation applied")
`;
  }

  // ── Banner cloth wave ──
  if (asset.id.includes('banner')) {
    return `
# Animation: banner cloth sway in wind
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

cloth = bpy.data.objects.get("${asset.id}_cloth")
if cloth:
    cloth.animation_data_create()
    for f in range(1, ${LOOP + 1}, 4):
        t = f / ${LOOP}
        cloth.rotation_euler.z = math.sin(t * math.pi * 4) * 0.08
        cloth.rotation_euler.y = math.sin(t * math.pi * 2 + 0.5) * 0.04
        cloth.keyframe_insert(data_path='rotation_euler', frame=f)

# Tattered edges flutter
for i in range(4):
    tear = bpy.data.objects.get(f"${asset.id}_tear_{i}")
    if tear:
        tear.animation_data_create()
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            tear.rotation_euler.z = math.sin(t * math.pi * 6 + i) * 0.15
            tear.keyframe_insert(data_path='rotation_euler', frame=f)
print("Banner animation applied")
`;
  }

  // ── Signpost creak sway ──
  if (asset.id.includes('signpost') || asset.id.includes('sign_post')) {
    return `
# Animation: signpost gentle creak in wind
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

for i in range(6):
    sign = bpy.data.objects.get(f"${asset.id}_sign_{i}")
    if sign:
        sign.animation_data_create()
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            sign.rotation_euler.x = math.sin(t * math.pi * 2 + i * 0.5) * 0.03
            sign.rotation_euler.z += math.sin(t * math.pi * 3 + i) * 0.005
            sign.keyframe_insert(data_path='rotation_euler', frame=f)
print("Signpost animation applied")
`;
  }

  // ── Tree wind sway ──
  if (asset.id.includes('tree') || asset.id.includes('oak') || asset.id.includes('mist_tree')) {
    const isDead = asset.id.includes('dead') || asset.id.includes('charred');
    return `
# Animation: ${isDead ? 'dead tree creak' : 'tree wind sway'}
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

trunk = bpy.data.objects.get("${asset.id}_trunk")
if trunk:
    trunk.animation_data_create()
    for f in range(1, ${LOOP + 1}, 4):
        t = f / ${LOOP}
        trunk.rotation_euler.x = math.sin(t * math.pi * 2) * ${isDead ? '0.01' : '0.015'}
        trunk.rotation_euler.y = math.cos(t * math.pi * 2 + 0.7) * ${isDead ? '0.008' : '0.01'}
        trunk.keyframe_insert(data_path='rotation_euler', frame=f)

${isDead ? '' : `canopy = bpy.data.objects.get("${asset.id}_canopy")
if canopy:
    canopy.animation_data_create()
    base_x = canopy.location.x
    base_y = canopy.location.y
    for f in range(1, ${LOOP + 1}, 4):
        t = f / ${LOOP}
        canopy.location.x = base_x + math.sin(t * math.pi * 2) * 0.08
        canopy.location.y = base_y + math.cos(t * math.pi * 2 + 1) * 0.05
        canopy.keyframe_insert(data_path='location', frame=f)
`}
print("Tree animation applied")
`;
  }

  // ── Lava / magma pool surface churn ──
  if (asset.id.includes('lava') || asset.id.includes('magma') || asset.id.includes('pool')) {
    return `
# Animation: lava surface churning + emission pulse
import random
random.seed(13)
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

surface = bpy.data.objects.get("${asset.id}_surface")
if surface:
    surface.animation_data_create()
    for f in range(1, ${LOOP + 1}, 3):
        t = f / ${LOOP}
        surface.rotation_euler.z = t * math.pi * 2  # slow rotation
        surface.keyframe_insert(data_path='rotation_euler', frame=f)
        surface.scale.z = 1.0 + math.sin(t * math.pi * 4) * 0.05
        surface.keyframe_insert(data_path='scale', frame=f)

mat_lava = bpy.data.materials.get("${asset.id}_LavaGlow")
if mat_lava and mat_lava.use_nodes:
    bsdf = mat_lava.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            inp.default_value = 10.0 + math.sin(t * math.pi * 6) * 4.0
            inp.keyframe_insert("default_value", frame=f)
print("Lava animation applied")
`;
  }

  // ── VerdantReach: Giant Mushroom — bioluminescent breathing + spore drift ──
  if (asset.id === 'verd_giant_mushroom') {
    return `
# Animation: giant mushroom cap pulse + spot glow cycle + moss shimmer
import random
random.seed(21)
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Cap breathing pulse (slow, organic)
cap = bpy.data.objects.get("${asset.id}_cap")
if cap:
    cap.animation_data_create()
    for f in range(1, ${LOOP + 1}, 3):
        t = f / ${LOOP}
        s = 1.0 + math.sin(t * math.pi * 2) * 0.04
        cap.scale = (s, s, 0.35 * (1.0 + math.sin(t * math.pi * 2) * 0.06))
        cap.keyframe_insert(data_path='scale', frame=f)

# Cap glow emission pulse
mat_cap = bpy.data.materials.get("${asset.id}_CapGlow")
if mat_cap and mat_cap.use_nodes:
    bsdf = mat_cap.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 6.0 + math.sin(t * math.pi * 4) * 3.0
            inp.keyframe_insert("default_value", frame=f)

# Purple spots individual glow with phase offset
mat_spots = bpy.data.materials.get("${asset.id}_SpotGlow")
if mat_spots and mat_spots.use_nodes:
    bsdf_s = mat_spots.node_tree.nodes.get("Principled BSDF")
    if bsdf_s:
        inp_s = bsdf_s.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp_s.default_value = 5.0 + math.sin(t * math.pi * 6) * 3.0
            inp_s.keyframe_insert("default_value", frame=f)

# Spots scale pulse with individual phase
for i in range(8):
    spot = bpy.data.objects.get(f"${asset.id}_spot_{i}")
    if spot:
        spot.animation_data_create()
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            s = 1.0 + math.sin(t * math.pi * 3 + i * 0.6) * 0.12
            spot.scale = (s, s, 0.25 * s)
            spot.keyframe_insert(data_path='scale', frame=f)
print("VerdantReach giant mushroom animation applied")
`;
  }

  // ── VerdantReach: Corruption Tree — living sway + corruption pulse ──
  if (asset.id === 'verd_corruption_tree') {
    return `
# Animation: corruption tree — trunk creak + canopy sway + corruption tendril glow
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

trunk = bpy.data.objects.get("${asset.id}_trunk")
if trunk:
    trunk.animation_data_create()
    for f in range(1, ${LOOP + 1}, 4):
        t = f / ${LOOP}
        trunk.rotation_euler.x = math.sin(t * math.pi * 2) * 0.012
        trunk.rotation_euler.y = math.cos(t * math.pi * 2 + 0.7) * 0.008
        trunk.keyframe_insert(data_path='rotation_euler', frame=f)

canopy = bpy.data.objects.get("${asset.id}_canopy")
if canopy:
    canopy.animation_data_create()
    base_x = canopy.location.x
    base_y = canopy.location.y
    for f in range(1, ${LOOP + 1}, 4):
        t = f / ${LOOP}
        canopy.location.x = base_x + math.sin(t * math.pi * 2) * 0.1
        canopy.location.y = base_y + math.cos(t * math.pi * 2 + 1) * 0.06
        canopy.keyframe_insert(data_path='location', frame=f)

# Corruption glow pulse (ominous)
mat_c = bpy.data.materials.get("${asset.id}_Corruption")
if mat_c and mat_c.use_nodes:
    bsdf = mat_c.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 2.5 + math.sin(t * math.pi * 3) * 2.0
            inp.keyframe_insert("default_value", frame=f)
print("VerdantReach corruption tree animation applied")
`;
  }

  // ── VerdantReach: Vine Bridge — gentle sway + flower glow ──
  if (asset.id === 'verd_vine_bridge') {
    return `
# Animation: vine bridge gentle sway + flower glow pulse
import random
random.seed(42)
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Deck gentle rocking
deck = bpy.data.objects.get("${asset.id}_deck")
if deck:
    deck.animation_data_create()
    for f in range(1, ${LOOP + 1}, 4):
        t = f / ${LOOP}
        deck.rotation_euler.x = math.sin(t * math.pi * 2) * 0.015
        deck.rotation_euler.z = math.sin(t * math.pi * 1.5 + 0.5) * 0.008
        deck.keyframe_insert(data_path='rotation_euler', frame=f)

# Flower glow cycle
mat_fl = bpy.data.materials.get("${asset.id}_FlowerGlow")
if mat_fl and mat_fl.use_nodes:
    bsdf = mat_fl.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 4.0 + math.sin(t * math.pi * 4) * 2.5
            inp.keyframe_insert("default_value", frame=f)

# Individual flowers bob
for i in range(6):
    flower = bpy.data.objects.get(f"${asset.id}_flower_{i}")
    if flower:
        flower.animation_data_create()
        base_z = flower.location.z
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            flower.location.z = base_z + math.sin(t * math.pi * 3 + i * 0.8) * 0.03
            flower.keyframe_insert(data_path='location', frame=f)
print("VerdantReach vine bridge animation applied")
`;
  }

  // ── VerdantReach: Spore Pod — spore drift + pod breathing ──
  if (asset.id === 'verd_spore_pod') {
    return `
# Animation: spore pod breathing + spores drifting upward + glow pulse
import random
random.seed(55)
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Pod body organic breathing
pod = bpy.data.objects.get("${asset.id}_pod")
if pod:
    pod.animation_data_create()
    for f in range(1, ${LOOP + 1}, 3):
        t = f / ${LOOP}
        s = 1.0 + math.sin(t * math.pi * 2) * 0.04
        pod.scale = (s, 0.9*s, 1.1 * (1.0 + math.sin(t * math.pi * 2 + 0.5) * 0.03))
        pod.keyframe_insert(data_path='scale', frame=f)

# Spores drifting upward (slow rise + slight wobble)
for i in range(8):
    spore = bpy.data.objects.get(f"${asset.id}_spore_{i}")
    if spore:
        spore.animation_data_create()
        base_x = spore.location.x
        base_y = spore.location.y
        base_z = spore.location.z
        for f in range(1, ${LOOP + 1}, 2):
            t = f / ${LOOP}
            spore.location.z = base_z + t * 0.3
            spore.location.x = base_x + math.sin(t * math.pi * 4 + i * 0.7) * 0.05
            spore.location.y = base_y + math.cos(t * math.pi * 3 + i * 0.5) * 0.04
            spore.keyframe_insert(data_path='location', frame=f)

# Spore glow emission pulse
mat_sp = bpy.data.materials.get("${asset.id}_SporeGlow")
if mat_sp and mat_sp.use_nodes:
    bsdf = mat_sp.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 8.0 + math.sin(t * math.pi * 6) * 4.0
            inp.keyframe_insert("default_value", frame=f)
print("VerdantReach spore pod animation applied")
`;
  }

  // ── VerdantReach: Root Shrine — crystal glow + root growth pulse ──
  if (asset.id === 'verd_root_shrine') {
    return `
# Animation: root shrine crystal glow + root creep pulse
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Crystal shard glow pulse
crystal = bpy.data.objects.get("${asset.id}_crystal")
if crystal:
    crystal.animation_data_create()
    for f in range(1, ${LOOP + 1}, 4):
        t = f / ${LOOP}
        s = 1.0 + math.sin(t * math.pi * 2) * 0.06
        crystal.scale = (0.2 * s, 0.2 * s, 0.6 * s)
        crystal.keyframe_insert(data_path='scale', frame=f)

mat_cr = bpy.data.materials.get("${asset.id}_CrystalGlow")
if mat_cr and mat_cr.use_nodes:
    bsdf = mat_cr.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 8.0 + math.sin(t * math.pi * 4) * 5.0
            inp.keyframe_insert("default_value", frame=f)

# Roots slow creep pulse (subtle scale throb)
for i in range(8):
    root = bpy.data.objects.get(f"${asset.id}_root_{i}")
    if root:
        root.animation_data_create()
        base_sx = root.scale.x
        base_sy = root.scale.y
        for f in range(1, ${LOOP + 1}, 6):
            t = f / ${LOOP}
            s = 1.0 + math.sin(t * math.pi * 2 + i * 0.5) * 0.04
            root.scale.x = base_sx * s
            root.scale.y = base_sy * s
            root.keyframe_insert(data_path='scale', frame=f)
print("VerdantReach root shrine animation applied")
`;
  }

  // ── VerdantReach: Hanging Moss — gentle sway + tip glow pulse ──
  if (asset.id === 'verd_hanging_moss') {
    return `
# Animation: hanging moss strands gentle sway + bioluminescent tip glow
import random
random.seed(63)
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Strands gentle pendulum sway
for i in range(7):
    strand = bpy.data.objects.get(f"${asset.id}_strand_{i}")
    if strand:
        strand.animation_data_create()
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            strand.rotation_euler.x = math.sin(t * math.pi * 2 + i * 0.6) * 0.06
            strand.rotation_euler.y = math.cos(t * math.pi * 1.5 + i * 0.4) * 0.04
            strand.keyframe_insert(data_path='rotation_euler', frame=f)
    # Tips follow strand sway
    tip = bpy.data.objects.get(f"${asset.id}_tip_{i}")
    if tip:
        tip.animation_data_create()
        base_z = tip.location.z
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            tip.location.z = base_z + math.sin(t * math.pi * 2 + i * 0.6) * 0.02
            tip.keyframe_insert(data_path='location', frame=f)

# Tip glow emission pulse
mat_tip = bpy.data.materials.get("${asset.id}_TipGlow")
if mat_tip and mat_tip.use_nodes:
    bsdf = mat_tip.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 5.0 + math.sin(t * math.pi * 4) * 3.0
            inp.keyframe_insert("default_value", frame=f)
print("VerdantReach hanging moss animation applied")
`;
  }

  // ── SunkenHalls: Broken Pillar — subtle barnacle shimmer + coral glow ──
  if (asset.id === 'sunk_broken_pillar') {
    return `
# Animation: broken pillar coral glow pulse
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

mat_co = bpy.data.materials.get("${asset.id}_CoralGlow")
if mat_co and mat_co.use_nodes:
    bsdf = mat_co.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 2.0 + math.sin(t * math.pi * 4) * 1.5
            inp.keyframe_insert("default_value", frame=f)
print("SunkenHalls broken pillar animation applied")
`;
  }

  // ── SunkenHalls: Crystal Coral Cluster — tip glow cycle + branch sway ──
  if (asset.id === 'sunk_coral_formation') {
    return `
# Animation: crystal coral tip glow pulse + subtle branch sway
import random
random.seed(83)
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Branch gentle sway (underwater current)
for i in range(7):
    branch = bpy.data.objects.get(f"${asset.id}_branch_{i}")
    if branch:
        branch.animation_data_create()
        base_rx = branch.rotation_euler.x
        base_ry = branch.rotation_euler.y
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            branch.rotation_euler.x = base_rx + math.sin(t * math.pi * 2 + i * 0.5) * 0.03
            branch.rotation_euler.y = base_ry + math.cos(t * math.pi * 1.5 + i * 0.3) * 0.02
            branch.keyframe_insert(data_path='rotation_euler', frame=f)

# Tip glow cycle with phase offset per tip
mat_tip = bpy.data.materials.get("${asset.id}_TipGlow")
if mat_tip and mat_tip.use_nodes:
    bsdf = mat_tip.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 6.0 + math.sin(t * math.pi * 6) * 4.0
            inp.keyframe_insert("default_value", frame=f)

# Coral body glow (slower pulse)
mat_co = bpy.data.materials.get("${asset.id}_CoralGlow")
if mat_co and mat_co.use_nodes:
    bsdf_co = mat_co.node_tree.nodes.get("Principled BSDF")
    if bsdf_co:
        inp_co = bsdf_co.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            inp_co.default_value = 4.0 + math.sin(t * math.pi * 3) * 2.0
            inp_co.keyframe_insert("default_value", frame=f)
print("SunkenHalls crystal coral animation applied")
`;
  }

  // ── SunkenHalls: Sunken Chest — gold shimmer + seaweed sway ──
  if (asset.id === 'sunk_sunken_chest') {
    return `
# Animation: sunken chest gold shimmer + seaweed sway
import random
random.seed(91)
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Gold coins shimmer (emission pulse)
mat_gold = bpy.data.materials.get("${asset.id}_Gold")
if mat_gold and mat_gold.use_nodes:
    bsdf = mat_gold.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            inp.default_value = 0.5 + math.sin(t * math.pi * 4) * 0.5
            inp.keyframe_insert("default_value", frame=f)

# Seaweed gentle underwater sway
for i in range(3):
    weed = bpy.data.objects.get(f"${asset.id}_seaweed_{i}")
    if weed:
        weed.animation_data_create()
        base_rx = weed.rotation_euler.x
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            weed.rotation_euler.x = base_rx + math.sin(t * math.pi * 2 + i * 0.8) * 0.08
            weed.keyframe_insert(data_path='rotation_euler', frame=f)
print("SunkenHalls sunken chest animation applied")
`;
  }

  // ── SunkenHalls: Ancient Door — rune glow pulse + seal rotation ──
  if (asset.id === 'sunk_ancient_door') {
    return `
# Animation: ancient door rune glow pulse + central seal slow rotation
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Rune glow pulse (rhythmic, tidal)
mat_rune = bpy.data.materials.get("${asset.id}_RuneGlow")
if mat_rune and mat_rune.use_nodes:
    bsdf = mat_rune.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 6.0 + math.sin(t * math.pi * 4) * 4.0
            inp.keyframe_insert("default_value", frame=f)

# Central seal slow rotation
seal = bpy.data.objects.get("${asset.id}_seal")
if seal:
    seal.animation_data_create()
    for f in range(1, ${LOOP + 1}, 4):
        t = f / ${LOOP}
        seal.rotation_euler.y = t * math.pi * 2 * 0.5
        seal.keyframe_insert(data_path='rotation_euler', frame=f)
print("SunkenHalls ancient door animation applied")
`;
  }

  // ── SunkenHalls: Jellyfish Lamp — jelly bob + tentacle sway + glow pulse ──
  if (asset.id === 'sunk_jellyfish_lamp') {
    return `
# Animation: jellyfish lamp — bell bob + tentacle sway + teal glow cycle
import random
random.seed(103)
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Jellyfish bell gentle bob inside sphere
bell = bpy.data.objects.get("${asset.id}_bell")
if bell:
    bell.animation_data_create()
    base_z = bell.location.z
    for f in range(1, ${LOOP + 1}, 3):
        t = f / ${LOOP}
        bell.location.z = base_z + math.sin(t * math.pi * 2) * 0.02
        s = 1.0 + math.sin(t * math.pi * 3) * 0.05
        bell.scale = (s, s, 0.6 * s)
        bell.keyframe_insert(data_path='location', frame=f)
        bell.keyframe_insert(data_path='scale', frame=f)

# Tentacles gentle drift
for i in range(5):
    tentacle = bpy.data.objects.get(f"${asset.id}_tentacle_{i}")
    if tentacle:
        tentacle.animation_data_create()
        base_x = tentacle.location.x
        base_y = tentacle.location.y
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            tentacle.location.x = base_x + math.sin(t * math.pi * 2 + i * 0.7) * 0.01
            tentacle.location.y = base_y + math.cos(t * math.pi * 1.5 + i * 0.5) * 0.008
            tentacle.keyframe_insert(data_path='location', frame=f)

# Jelly glow pulse
mat_jelly = bpy.data.materials.get("${asset.id}_JellyGlow")
if mat_jelly and mat_jelly.use_nodes:
    bsdf = mat_jelly.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 8.0 + math.sin(t * math.pi * 4) * 4.0
            inp.keyframe_insert("default_value", frame=f)
print("SunkenHalls jellyfish lamp animation applied")
`;
  }

  // ── SunkenHalls: Floor Tile — water pool ripple + subtle shimmer ──
  if (asset.id === 'sunk_floor_tile') {
    return `
# Animation: flooded floor tile — water pool shimmer
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Water pool emission shimmer
mat_water = bpy.data.materials.get("${asset.id}_WaterPool")
if mat_water and mat_water.use_nodes:
    bsdf = mat_water.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 1.0 + math.sin(t * math.pi * 6) * 0.8
            inp.keyframe_insert("default_value", frame=f)

# Pool surface subtle scale ripple
for i in range(3):
    pool = bpy.data.objects.get(f"${asset.id}_pool_{i}")
    if pool:
        pool.animation_data_create()
        base_sx = pool.scale.x
        base_sy = pool.scale.y
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            s = 1.0 + math.sin(t * math.pi * 3 + i * 1.2) * 0.04
            pool.scale.x = base_sx * s
            pool.scale.y = base_sy * s
            pool.keyframe_insert(data_path='scale', frame=f)
print("SunkenHalls floor tile animation applied")
`;
  }

  // ── EmberPeaks: Obsidian Spire — internal vein glow pulse ──
  if (asset.id === 'ember_obsidian_spire') {
    return `
# Animation: obsidian spire internal glow pulse
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

mat_glow = bpy.data.materials.get("${asset.id}_InternalGlow")
if mat_glow and mat_glow.use_nodes:
    bsdf = mat_glow.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 5.0 + math.sin(t * math.pi * 3) * 3.0
            inp.keyframe_insert("default_value", frame=f)
print("EmberPeaks obsidian spire animation applied")
`;
  }

  // ── EmberPeaks: Lava Bridge — lava surface churn + glow pulse ──
  if (asset.id === 'ember_lava_bridge') {
    return `
# Animation: lava bridge — lava surface glow cycle
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

lava = bpy.data.objects.get("${asset.id}_lava")
if lava:
    lava.animation_data_create()
    for f in range(1, ${LOOP + 1}, 4):
        t = f / ${LOOP}
        lava.scale.z = 1.0 + math.sin(t * math.pi * 4) * 0.03
        lava.keyframe_insert(data_path='scale', frame=f)

mat_lava = bpy.data.materials.get("${asset.id}_LavaGlow")
if mat_lava and mat_lava.use_nodes:
    bsdf = mat_lava.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 10.0 + math.sin(t * math.pi * 6) * 5.0
            inp.keyframe_insert("default_value", frame=f)
print("EmberPeaks lava bridge animation applied")
`;
  }

  // ── EmberPeaks: Forge Ruins — crucible glow + chain sway ──
  if (asset.id === 'ember_forge_ruin') {
    return `
# Animation: forge ruins — crucible molten glow pulse + chain sway
import random
random.seed(140)
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Molten crucible glow pulse
mat_mol = bpy.data.materials.get("${asset.id}_MoltenGlow")
if mat_mol and mat_mol.use_nodes:
    bsdf = mat_mol.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 12.0 + math.sin(t * math.pi * 4) * 6.0
            inp.keyframe_insert("default_value", frame=f)

# Melt surface gentle churn
melt = bpy.data.objects.get("${asset.id}_melt")
if melt:
    melt.animation_data_create()
    for f in range(1, ${LOOP + 1}, 4):
        t = f / ${LOOP}
        melt.rotation_euler.z = t * math.pi * 2
        melt.keyframe_insert(data_path='rotation_euler', frame=f)

# Chains gentle sway
for i in range(4):
    for j in range(5):
        link = bpy.data.objects.get(f"${asset.id}_chain_{i}_{j}")
        if link:
            link.animation_data_create()
            for f in range(1, ${LOOP + 1}, 6):
                t = f / ${LOOP}
                link.rotation_euler.z = math.sin(t * math.pi * 2 + i * 0.5 + j * 0.2) * 0.05
                link.keyframe_insert(data_path='rotation_euler', frame=f)
print("EmberPeaks forge ruins animation applied")
`;
  }

  // ── EmberPeaks: Magma Vent — particle rise + magma glow pulse ──
  if (asset.id === 'ember_magma_vent') {
    return `
# Animation: magma vent — particles rising + glow pulse cycle
import random
random.seed(152)
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Magma particles drift upward
for i in range(8):
    particle = bpy.data.objects.get(f"${asset.id}_particle_{i}")
    if particle:
        particle.animation_data_create()
        base_x = particle.location.x
        base_y = particle.location.y
        base_z = particle.location.z
        for f in range(1, ${LOOP + 1}, 2):
            t = f / ${LOOP}
            particle.location.z = base_z + t * 0.5
            particle.location.x = base_x + math.sin(t * math.pi * 4 + i * 0.8) * 0.06
            particle.location.y = base_y + math.cos(t * math.pi * 3 + i * 0.6) * 0.05
            s = 1.0 - t * 0.5
            particle.scale = (s, s, s)
            particle.keyframe_insert(data_path='location', frame=f)
            particle.keyframe_insert(data_path='scale', frame=f)

# Magma vent glow pulse (intense)
mat_mg = bpy.data.materials.get("${asset.id}_MagmaGlow")
if mat_mg and mat_mg.use_nodes:
    bsdf = mat_mg.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 15.0 + math.sin(t * math.pi * 6) * 8.0
            inp.keyframe_insert("default_value", frame=f)
print("EmberPeaks magma vent animation applied")
`;
  }

  // ── EmberPeaks: Dragon Skull — ember eye glow flicker ──
  if (asset.id === 'ember_charred_bones') {
    return `
# Animation: dragon skull — ember eye glow flicker
import random
random.seed(161)
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Ember eye glow flickering
mat_eye = bpy.data.materials.get("${asset.id}_EmberEye")
if mat_eye and mat_eye.use_nodes:
    bsdf = mat_eye.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 2):
            t = f / ${LOOP}
            inp.default_value = 4.0 + math.sin(t * math.pi * 6) * 3.0 + random.uniform(-0.5, 0.5)
            inp.keyframe_insert("default_value", frame=f)

# Ember eye spheres subtle pulse
for side in [-1, 1]:
    eye = bpy.data.objects.get(f"${asset.id}_ember_eye_{side}")
    if eye:
        eye.animation_data_create()
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            s = 1.0 + math.sin(t * math.pi * 4 + side) * 0.1
            eye.scale = (s, s, s)
            eye.keyframe_insert(data_path='scale', frame=f)
print("EmberPeaks dragon skull animation applied")
`;
  }

  // ── EmberPeaks: Heat Crystal — crystal glow pulse cycle ──
  if (asset.id === 'ember_heat_crystal') {
    return `
# Animation: heat crystal cluster glow pulse
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

mat_cr = bpy.data.materials.get("${asset.id}_CrystalGlow")
if mat_cr and mat_cr.use_nodes:
    bsdf = mat_cr.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 6.0 + math.sin(t * math.pi * 4) * 4.0
            inp.keyframe_insert("default_value", frame=f)

# Individual shard scale pulse
for i in range(6):
    shard = bpy.data.objects.get(f"${asset.id}_shard_{i}")
    if shard:
        shard.animation_data_create()
        base_sx = shard.scale.x
        base_sy = shard.scale.y
        base_sz = shard.scale.z
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            s = 1.0 + math.sin(t * math.pi * 3 + i * 0.7) * 0.06
            shard.scale = (base_sx * s, base_sy * s, base_sz * s)
            shard.keyframe_insert(data_path='scale', frame=f)

# Main crystal pulse
main = bpy.data.objects.get("${asset.id}_main_crystal")
if main:
    main.animation_data_create()
    for f in range(1, ${LOOP + 1}, 4):
        t = f / ${LOOP}
        s = 1.0 + math.sin(t * math.pi * 2) * 0.04
        main.scale = (s, s, s)
        main.keyframe_insert(data_path='scale', frame=f)
print("EmberPeaks heat crystal animation applied")
`;
  }

  // ── Aethermere: Void Crystal — rotation + core glow pulse + particle drift ──
  if (asset.id === 'aeth_void_crystal') {
    return `
# Animation: void crystal slow rotation + core glow pulse + particle trail drift
import random
random.seed(200)
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Upper and lower crystal slow rotation
for name in ["${asset.id}_upper", "${asset.id}_lower"]:
    obj = bpy.data.objects.get(name)
    if obj:
        obj.animation_data_create()
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            obj.rotation_euler.z = t * math.pi * 2 * 0.3
            obj.keyframe_insert(data_path='rotation_euler', frame=f)

# Core glow pulse
mat_vc = bpy.data.materials.get("${asset.id}_VoidCore")
if mat_vc and mat_vc.use_nodes:
    bsdf = mat_vc.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 6.0 + math.sin(t * math.pi * 4) * 4.0
            inp.keyframe_insert("default_value", frame=f)

# Vein glow pulse (brighter)
mat_vn = bpy.data.materials.get("${asset.id}_VeinGlow")
if mat_vn and mat_vn.use_nodes:
    bsdf_v = mat_vn.node_tree.nodes.get("Principled BSDF")
    if bsdf_v:
        inp_v = bsdf_v.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp_v.default_value = 10.0 + math.sin(t * math.pi * 6) * 5.0
            inp_v.keyframe_insert("default_value", frame=f)

# Particle trail drift downward
for i in range(8):
    p = bpy.data.objects.get(f"${asset.id}_particle_{i}")
    if p:
        p.animation_data_create()
        base_z = p.location.z
        base_x = p.location.x
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            p.location.z = base_z - t * 0.2
            p.location.x = base_x + math.sin(t * math.pi * 4 + i) * 0.04
            s = 1.0 - t * 0.3
            p.scale = (s, s, s)
            p.keyframe_insert(data_path='location', frame=f)
            p.keyframe_insert(data_path='scale', frame=f)
print("Aethermere void crystal animation applied")
`;
  }

  // ── Aethermere: Reality Fracture — chunk float bob + void energy pulse ──
  if (asset.id === 'aeth_broken_reality') {
    return `
# Animation: reality fracture — floating chunks bob + void energy glow pulse
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Stone chunks gentle floating bob
for i in range(5):
    chunk = bpy.data.objects.get(f"${asset.id}_chunk_{i}")
    if chunk:
        chunk.animation_data_create()
        base_z = chunk.location.z
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            chunk.location.z = base_z + math.sin(t * math.pi * 2 + i * 0.8) * 0.08
            chunk.rotation_euler.x = chunk.rotation_euler.x + math.sin(t * math.pi * 1.5 + i) * 0.003
            chunk.keyframe_insert(data_path='location', frame=f)
            chunk.keyframe_insert(data_path='rotation_euler', frame=f)

# Void energy pulse
mat_ve = bpy.data.materials.get("${asset.id}_VoidEnergy")
if mat_ve and mat_ve.use_nodes:
    bsdf = mat_ve.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 8.0 + math.sin(t * math.pi * 5) * 4.0
            inp.keyframe_insert("default_value", frame=f)
print("Aethermere reality fracture animation applied")
`;
  }

  // ── Aethermere: Spirit Lantern — flame flicker + wisp orbit + glow pulse ──
  if (asset.id === 'aeth_spirit_lantern') {
    return `
# Animation: spirit lantern — flame flicker + wisp orbit + glow pulse
import random
random.seed(220)
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Spirit flame flicker
flame = bpy.data.objects.get("${asset.id}_flame")
if flame:
    flame.animation_data_create()
    for f in range(1, ${LOOP + 1}, 2):
        t = f / ${LOOP}
        sx = 1.0 + math.sin(t * math.pi * 6) * 0.15 + random.uniform(-0.05, 0.05)
        sy = 1.0 + math.sin(t * math.pi * 5 + 0.5) * 0.12
        sz = 1.4 * (1.0 + math.sin(t * math.pi * 4) * 0.1)
        flame.scale = (sx, sy, sz)
        flame.keyframe_insert(data_path='scale', frame=f)

# Spirit flame glow pulse
mat_fl = bpy.data.materials.get("${asset.id}_SpiritFlame")
if mat_fl and mat_fl.use_nodes:
    bsdf = mat_fl.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 2):
            inp.default_value = 10.0 + random.uniform(-2, 4)
            inp.keyframe_insert("default_value", frame=f)

# Wisps orbiting around lantern
for i in range(4):
    wisp = bpy.data.objects.get(f"${asset.id}_wisp_{i}")
    if wisp:
        wisp.animation_data_create()
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            a = t * math.pi * 2 + i * 1.57
            wisp.location.x = math.cos(a) * 0.08
            wisp.location.y = math.sin(a) * 0.08
            wisp.location.z = 1.5 + math.sin(t * math.pi * 3 + i) * 0.02
            wisp.keyframe_insert(data_path='location', frame=f)
print("Aethermere spirit lantern animation applied")
`;
  }

  // ── Aethermere: Cosmic Arch — portal swirl + rune glow + shard float ──
  if (asset.id === 'aeth_cosmic_arch') {
    return `
# Animation: cosmic arch — portal rotation + rune glow pulse + shard float
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Portal slow rotation
portal = bpy.data.objects.get("${asset.id}_portal")
if portal:
    portal.animation_data_create()
    for f in range(1, ${LOOP + 1}, 4):
        t = f / ${LOOP}
        portal.rotation_euler.y = t * math.pi * 2 * 0.2
        portal.keyframe_insert(data_path='rotation_euler', frame=f)

# Portal glow pulse
mat_pg = bpy.data.materials.get("${asset.id}_PortalGlow")
if mat_pg and mat_pg.use_nodes:
    bsdf = mat_pg.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 12.0 + math.sin(t * math.pi * 4) * 6.0
            inp.keyframe_insert("default_value", frame=f)

# Rune glow pulse
mat_rn = bpy.data.materials.get("${asset.id}_RuneGlow")
if mat_rn and mat_rn.use_nodes:
    bsdf_r = mat_rn.node_tree.nodes.get("Principled BSDF")
    if bsdf_r:
        inp_r = bsdf_r.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp_r.default_value = 6.0 + math.sin(t * math.pi * 6) * 4.0
            inp_r.keyframe_insert("default_value", frame=f)

# Floating shards gentle bob
for i in range(4):
    shard = bpy.data.objects.get(f"${asset.id}_shard_{i}")
    if shard:
        shard.animation_data_create()
        base_z = shard.location.z
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            shard.location.z = base_z + math.sin(t * math.pi * 2 + i * 0.9) * 0.1
            shard.keyframe_insert(data_path='location', frame=f)
print("Aethermere cosmic arch animation applied")
`;
  }

  // ── Aethermere: Ethereal Tree — leaf shimmer + trunk sway + particle drift ──
  if (asset.id === 'aeth_mist_tree') {
    return `
# Animation: ethereal tree — crystal leaf glow cycle + trunk sway + shimmer drift
import random
random.seed(240)
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Trunk gentle ethereal sway
trunk = bpy.data.objects.get("${asset.id}_trunk")
if trunk:
    trunk.animation_data_create()
    for f in range(1, ${LOOP + 1}, 4):
        t = f / ${LOOP}
        trunk.rotation_euler.x = math.sin(t * math.pi * 2) * 0.01
        trunk.rotation_euler.y = math.cos(t * math.pi * 2 + 0.7) * 0.008
        trunk.keyframe_insert(data_path='rotation_euler', frame=f)

# Crystal leaf glow pulse
mat_lf = bpy.data.materials.get("${asset.id}_CrystalLeaf")
if mat_lf and mat_lf.use_nodes:
    bsdf = mat_lf.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 4.0 + math.sin(t * math.pi * 4) * 2.5
            inp.keyframe_insert("default_value", frame=f)

# Leaf clusters gentle bob
for i in range(6):
    leaf = bpy.data.objects.get(f"${asset.id}_leaf_{i}")
    if leaf:
        leaf.animation_data_create()
        base_z = leaf.location.z
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            leaf.location.z = base_z + math.sin(t * math.pi * 2 + i * 0.6) * 0.05
            leaf.keyframe_insert(data_path='location', frame=f)

# Shimmer particles drift
mat_sh = bpy.data.materials.get("${asset.id}_Shimmer")
if mat_sh and mat_sh.use_nodes:
    bsdf_sh = mat_sh.node_tree.nodes.get("Principled BSDF")
    if bsdf_sh:
        inp_sh = bsdf_sh.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp_sh.default_value = 8.0 + math.sin(t * math.pi * 6) * 4.0
            inp_sh.keyframe_insert("default_value", frame=f)
print("Aethermere ethereal tree animation applied")
`;
  }

  // ── Aethermere: Floating Steps — step bob + void particle trail ──
  if (asset.id === 'aeth_floating_steps') {
    return `
# Animation: floating steps — individual bob at different phases + void particles
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Each step bobs independently
for i in range(6):
    step = bpy.data.objects.get(f"${asset.id}_step_{i}")
    if step:
        step.animation_data_create()
        base_z = step.location.z
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            step.location.z = base_z + math.sin(t * math.pi * 2 + i * 0.7) * 0.06
            step.keyframe_insert(data_path='location', frame=f)

# Void particles gentle drift
mat_vp = bpy.data.materials.get("${asset.id}_VoidParticle")
if mat_vp and mat_vp.use_nodes:
    bsdf = mat_vp.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 6.0 + math.sin(t * math.pi * 5) * 3.0
            inp.keyframe_insert("default_value", frame=f)
print("Aethermere floating steps animation applied")
`;
  }

  // ── TheWilds: Oak Tree — canopy sway + leaf rustle ──
  if (asset.id === 'wild_oak_tree') {
    return `
# Animation: oak tree — trunk sway + canopy bob
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

trunk = bpy.data.objects.get("${asset.id}_trunk")
if trunk:
    trunk.animation_data_create()
    for f in range(1, ${LOOP + 1}, 4):
        t = f / ${LOOP}
        trunk.rotation_euler.x = math.sin(t * math.pi * 2) * 0.008
        trunk.rotation_euler.y = math.cos(t * math.pi * 2 + 0.7) * 0.006
        trunk.keyframe_insert(data_path='rotation_euler', frame=f)

for i in range(8):
    c = bpy.data.objects.get(f"${asset.id}_canopy_{i}")
    if c:
        c.animation_data_create()
        base_x = c.location.x
        base_y = c.location.y
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            c.location.x = base_x + math.sin(t * math.pi * 2 + i * 0.5) * 0.06
            c.location.y = base_y + math.cos(t * math.pi * 1.5 + i * 0.3) * 0.04
            c.keyframe_insert(data_path='location', frame=f)
print("TheWilds oak tree animation applied")
`;
  }

  // ── TheWilds: Stream Rocks — water surface shimmer ──
  if (asset.id === 'wild_stream_rocks') {
    return `
# Animation: stream rocks — water surface subtle ripple
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

water = bpy.data.objects.get("${asset.id}_water")
if water:
    water.animation_data_create()
    for f in range(1, ${LOOP + 1}, 4):
        t = f / ${LOOP}
        water.scale.x = 1.0 + math.sin(t * math.pi * 4) * 0.01
        water.scale.y = 1.0 + math.cos(t * math.pi * 3) * 0.01
        water.keyframe_insert(data_path='scale', frame=f)
print("TheWilds stream rocks animation applied")
`;
  }

  // ── TheWilds: Deer Skull — herb sway ──
  if (asset.id === 'wild_deer_skull') {
    return `
# Animation: deer skull — herbs gentle sway in breeze
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

for i in range(4):
    herb = bpy.data.objects.get(f"${asset.id}_herb_{i}")
    if herb:
        herb.animation_data_create()
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            herb.rotation_euler.x = math.sin(t * math.pi * 2 + i * 0.7) * 0.08
            herb.rotation_euler.z = math.cos(t * math.pi * 1.5 + i * 0.5) * 0.05
            herb.keyframe_insert(data_path='rotation_euler', frame=f)
print("TheWilds deer skull animation applied")
`;
  }

  // ── TheWilds: Fallen Log — moss breathing ──
  if (asset.id === 'wild_fallen_log') {
    return `
# Animation: fallen log — moss patches gentle breathing
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

for i in range(6):
    moss = bpy.data.objects.get(f"${asset.id}_moss_{i}")
    if moss:
        moss.animation_data_create()
        for f in range(1, ${LOOP + 1}, 6):
            t = f / ${LOOP}
            s = 1.0 + math.sin(t * math.pi * 2 + i * 0.8) * 0.05
            moss.scale = (1.5*s, 1.2*s, 0.3*s)
            moss.keyframe_insert(data_path='scale', frame=f)
print("TheWilds fallen log animation applied")
`;
  }

  // ── TheWilds: Hunter Camp — tent flutter + fire glow ──
  if (asset.id === 'wild_hunter_camp') {
    return `
# Animation: hunter camp — tent panels flutter in breeze
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

for name in ["${asset.id}_tent_left", "${asset.id}_tent_right"]:
    tent = bpy.data.objects.get(name)
    if tent:
        tent.animation_data_create()
        base_rx = tent.rotation_euler.x
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            tent.rotation_euler.x = base_rx + math.sin(t * math.pi * 3) * 0.03
            tent.keyframe_insert(data_path='rotation_euler', frame=f)
print("TheWilds hunter camp animation applied")
`;
  }

  // ── TheWilds: Standing Stone — carving glow pulse + aura shimmer ──
  if (asset.id === 'wild_standing_stone') {
    return `
# Animation: standing stone — carving glow pulse + aura shimmer
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Carving glow pulse
mat_cv = bpy.data.materials.get("${asset.id}_CarvingGlow")
if mat_cv and mat_cv.use_nodes:
    bsdf = mat_cv.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 3.0 + math.sin(t * math.pi * 4) * 2.5
            inp.keyframe_insert("default_value", frame=f)

# Aura gentle scale breathing
aura = bpy.data.objects.get("${asset.id}_aura")
if aura:
    aura.animation_data_create()
    for f in range(1, ${LOOP + 1}, 4):
        t = f / ${LOOP}
        s = 1.0 + math.sin(t * math.pi * 2) * 0.08
        aura.scale = (s * 0.6, s * 0.6, s * 0.6)
        aura.keyframe_insert(data_path='scale', frame=f)

mat_au = bpy.data.materials.get("${asset.id}_AuraGlow")
if mat_au and mat_au.use_nodes:
    bsdf_a = mat_au.node_tree.nodes.get("Principled BSDF")
    if bsdf_a:
        inp_a = bsdf_a.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp_a.default_value = 2.0 + math.sin(t * math.pi * 3) * 1.5
            inp_a.keyframe_insert("default_value", frame=f)
print("TheWilds standing stone animation applied")
`;
  }

  // ── Mushroom spore pulse (glow breathing, generic) ──
  if (asset.id.includes('mushroom') || asset.id.includes('fungi')) {
    return `
# Animation: mushroom cap breathing + glow pulse
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

cap = bpy.data.objects.get("${asset.id}_cap")
if cap:
    cap.animation_data_create()
    for f in range(1, ${LOOP + 1}, 4):
        t = f / ${LOOP}
        s = 1.0 + math.sin(t * math.pi * 2) * 0.03
        cap.scale = (s, s, 0.4 * s)
        cap.keyframe_insert(data_path='scale', frame=f)

mat_glow = bpy.data.materials.get("${asset.id}_Glow")
if mat_glow and mat_glow.use_nodes:
    bsdf = mat_glow.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 3.0 + math.sin(t * math.pi * 4) * 3.0
            inp.keyframe_insert("default_value", frame=f)

for i in range(6):
    spot = bpy.data.objects.get(f"${asset.id}_spot_{i}")
    if spot:
        spot.animation_data_create()
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            s = 1.0 + math.sin(t * math.pi * 3 + i * 0.8) * 0.15
            spot.scale = (s, s, 0.3 * s)
            spot.keyframe_insert(data_path='scale', frame=f)
print("Mushroom animation applied")
`;
  }

  // ── Gate / portcullis raise-lower cycle ──
  if (asset.id.includes('gate') || asset.id.includes('portcullis')) {
    return `
# Animation: portcullis raise/lower cycle + winch rotation
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = 120  # 4 seconds for full cycle

# Collect portcullis bar objects
bars = [o for o in bpy.data.objects if "${asset.id}_vbar" in o.name or "${asset.id}_hbar" in o.name or "${asset.id}_tip" in o.name]
for bar in bars:
    bar.animation_data_create()
    base_z = bar.location.z
    # Rest at frame 1
    bar.location.z = base_z
    bar.keyframe_insert(data_path='location', frame=1)
    # Raised at frame 45
    bar.location.z = base_z + 4.0
    bar.keyframe_insert(data_path='location', frame=45)
    # Hold raised until frame 75
    bar.keyframe_insert(data_path='location', frame=75)
    # Lower back at frame 120
    bar.location.z = base_z
    bar.keyframe_insert(data_path='location', frame=120)

# Winch rotation during raise
winch = bpy.data.objects.get("${asset.id}_winch")
if winch:
    winch.animation_data_create()
    winch.rotation_euler.x = 0
    winch.keyframe_insert(data_path='rotation_euler', frame=1)
    winch.rotation_euler.x = math.pi * 6
    winch.keyframe_insert(data_path='rotation_euler', frame=45)
    winch.keyframe_insert(data_path='rotation_euler', frame=75)
    winch.rotation_euler.x = 0
    winch.keyframe_insert(data_path='rotation_euler', frame=120)

# Chain links jiggle
for x_sign in [-1, 1]:
    x = x_sign * 2
    for j in range(6):
        link = bpy.data.objects.get(f"${asset.id}_chain_{x}_{j}")
        if link:
            link.animation_data_create()
            base_z = link.location.z
            link.location.z = base_z
            link.keyframe_insert(data_path='location', frame=1)
            link.location.z = base_z + 3.5
            link.keyframe_insert(data_path='location', frame=45)
            link.keyframe_insert(data_path='location', frame=75)
            link.location.z = base_z
            link.keyframe_insert(data_path='location', frame=120)
print("Gate animation applied")
`;
  }

  // ── Altar / shrine / wayshrine glow pulse ──
  if (asset.id.includes('altar') || asset.id.includes('shrine') || asset.id.includes('wayshrine')) {
    return `
# Animation: crystal glow pulse
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

crystal = bpy.data.objects.get("${asset.id}_crystal")
if crystal:
    crystal.animation_data_create()
    for f in range(1, ${LOOP + 1}, 4):
        t = f / ${LOOP}
        s = 1.0 + math.sin(t * math.pi * 2) * 0.05
        crystal.scale = (s * 0.3, s * 0.3, s * 0.8)
        crystal.keyframe_insert(data_path='scale', frame=f)

mat_crystal = bpy.data.materials.get("${asset.id}_CrystalGlow")
if mat_crystal and mat_crystal.use_nodes:
    bsdf = mat_crystal.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 3.0 + math.sin(t * math.pi * 4) * 4.0
            inp.keyframe_insert("default_value", frame=f)
print("Shrine animation applied")
`;
  }

  // ── Market stall canopy flutter ──
  if (asset.id.includes('stall') || asset.id.includes('market')) {
    return `
# Animation: canopy flutter in breeze
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

canopy = bpy.data.objects.get("${asset.id}_canopy")
if canopy:
    canopy.animation_data_create()
    for f in range(1, ${LOOP + 1}, 4):
        t = f / ${LOOP}
        canopy.rotation_euler.x = 0.15 + math.sin(t * math.pi * 3) * 0.04
        canopy.rotation_euler.y = math.sin(t * math.pi * 2 + 0.5) * 0.02
        canopy.keyframe_insert(data_path='rotation_euler', frame=f)
print("Market stall animation applied")
`;
  }

  // ── Weapon rack idle wobble ──
  if (asset.id.includes('weapon_rack') || asset.id.includes('rack')) {
    return `
# Animation: weapons subtle idle sway
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

for i in range(3):
    blade = bpy.data.objects.get(f"${asset.id}_sword_blade_{i}")
    if blade:
        blade.animation_data_create()
        for f in range(1, ${LOOP + 1}, 6):
            t = f / ${LOOP}
            blade.rotation_euler.x = math.sin(t * math.pi * 2 + i * 0.7) * 0.015
            blade.keyframe_insert(data_path='rotation_euler', frame=f)

shield = bpy.data.objects.get("${asset.id}_shield")
if shield:
    shield.animation_data_create()
    for f in range(1, ${LOOP + 1}, 6):
        t = f / ${LOOP}
        shield.rotation_euler.z = math.sin(t * math.pi * 1.5) * 0.008
        shield.keyframe_insert(data_path='rotation_euler', frame=f)
print("Weapon rack animation applied")
`;
  }

  // ── Barrel idle settle ──
  if (asset.id.includes('barrel')) {
    return `
# Animation: barrel subtle wobble settle
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

body = bpy.data.objects.get("${asset.id}_body")
if body:
    body.animation_data_create()
    for f in range(1, ${LOOP + 1}, 8):
        t = f / ${LOOP}
        body.rotation_euler.x = math.sin(t * math.pi * 2) * 0.005
        body.rotation_euler.y = math.cos(t * math.pi * 2 + 1) * 0.005
        body.keyframe_insert(data_path='rotation_euler', frame=f)
print("Barrel animation applied")
`;
  }

  // ── Battlement moss growth ──
  if (asset.id.includes('battlement')) {
    return `
# Animation: subtle moss growth + iron band weathering shimmer
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Iron bands subtle gleam
for h in [5, 20]:
    band = bpy.data.objects.get(f"${asset.id}_ironband_{h}")
    if band:
        band.animation_data_create()
        for f in range(1, ${LOOP + 1}, 8):
            t = f / ${LOOP}
            band.scale.y = 0.015 + math.sin(t * math.pi * 2) * 0.002
            band.keyframe_insert(data_path='scale', frame=f)
print("Battlement animation applied")
`;
  }

  // ── Wall moss sway ──
  if (asset.id.includes('wall') && !asset.id.includes('battle')) {
    return `
# Animation: moss patches gentle breathing
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

for i in range(3):
    moss = bpy.data.objects.get(f"${asset.id}_moss_{i}")
    if moss:
        moss.animation_data_create()
        for f in range(1, ${LOOP + 1}, 6):
            t = f / ${LOOP}
            s = 1.0 + math.sin(t * math.pi * 2 + i * 1.2) * 0.08
            moss.scale = (1.5*s, 0.5*s, 0.8*s)
            moss.keyframe_insert(data_path='scale', frame=f)
print("Wall animation applied")
`;
  }

  // ── Bone pile ember glow (for dead tree ember cracks) ──
  if (asset.id.includes('bone')) {
    return `
# Animation: subtle skull rattle
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

for i in range(3):
    skull = bpy.data.objects.get(f"${asset.id}_skull_{i}")
    if skull:
        skull.animation_data_create()
        for f in range(1, ${LOOP + 1}, 8):
            t = f / ${LOOP}
            skull.rotation_euler.z = math.sin(t * math.pi * 2 + i) * 0.02
            skull.keyframe_insert(data_path='rotation_euler', frame=f)
print("Bone pile animation applied")
`;
  }

  // ── Arch / archway (dust settle, no animation needed but add rubble shift) ──
  if (asset.id.includes('arch') || asset.id.includes('gateway')) {
    return `
# Animation: lintel creak + rubble settle
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

lintel = bpy.data.objects.get("${asset.id}_lintel")
if lintel:
    lintel.animation_data_create()
    for f in range(1, ${LOOP + 1}, 8):
        t = f / ${LOOP}
        lintel.rotation_euler.y = 0.15 + math.sin(t * math.pi * 2) * 0.003
        lintel.keyframe_insert(data_path='rotation_euler', frame=f)
print("Arch animation applied")
`;
  }

  // ── Anvil spark glow pulse ──
  if (asset.id.includes('anvil')) {
    return `
# Animation: spark marks pulse
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

mat_spark = bpy.data.materials.get("${asset.id}_SparkMark")
if mat_spark and mat_spark.use_nodes:
    bsdf = mat_spark.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 1.5 + math.sin(t * math.pi * 6) * 2.5
            inp.keyframe_insert("default_value", frame=f)
print("Anvil animation applied")
`;
  }

  // ── Shared: Health Crystal Pickup — red crystal glow pulse + gentle float ──
  if (asset.id === 'shared_health_pickup') {
    return `
# Animation: health crystal glow pulse + gentle floating bob
import random
random.seed(151)
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Crystal glow pulse
mat_cr = bpy.data.materials.get("${asset.id}_CrystalGlow")
if mat_cr and mat_cr.use_nodes:
    bsdf = mat_cr.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 4.0 + math.sin(t * math.pi * 4) * 3.0
            inp.keyframe_insert("default_value", frame=f)

# Crystal gentle float
crystal = bpy.data.objects.get("${asset.id}_crystal")
if crystal:
    crystal.animation_data_create()
    base_z = crystal.location.z
    for f in range(1, ${LOOP + 1}, 3):
        t = f / ${LOOP}
        crystal.location.z = base_z + math.sin(t * math.pi * 2) * 0.02
        crystal.keyframe_insert(data_path='location', frame=f)

# Side shards subtle bob
for i in range(3):
    shard = bpy.data.objects.get(f"${asset.id}_shard_{i}")
    if shard:
        shard.animation_data_create()
        base_z = shard.location.z
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            shard.location.z = base_z + math.sin(t * math.pi * 2 + i * 0.8) * 0.015
            shard.keyframe_insert(data_path='location', frame=f)

# Glow disc pulse
mat_gd = bpy.data.materials.get("${asset.id}_GlowDisc")
if mat_gd and mat_gd.use_nodes:
    bsdf_gd = mat_gd.node_tree.nodes.get("Principled BSDF")
    if bsdf_gd:
        inp_gd = bsdf_gd.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp_gd.default_value = 2.0 + math.sin(t * math.pi * 4 + 0.5) * 2.0
            inp_gd.keyframe_insert("default_value", frame=f)
print("Health pickup animation applied")
`;
  }

  // ── Shared: Shard Fragment — rotation + float + particle trail ──
  if (asset.id === 'shared_shard_fragment') {
    return `
# Animation: shard fragment rotation + floating bob + particle trail shimmer
import random
random.seed(161)
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Main shard rotation (continuous spin)
for name in ["${asset.id}_top", "${asset.id}_bottom"]:
    obj = bpy.data.objects.get(name)
    if obj:
        obj.animation_data_create()
        base_z = obj.location.z
        for f in range(1, ${LOOP + 1}, 2):
            t = f / ${LOOP}
            obj.rotation_euler.z = t * math.pi * 4  # two full rotations per loop
            obj.keyframe_insert(data_path='rotation_euler', frame=f)
            obj.location.z = base_z + math.sin(t * math.pi * 2) * 0.03
            obj.keyframe_insert(data_path='location', frame=f)

# Shard glow pulse
mat_sh = bpy.data.materials.get("${asset.id}_ShardGlow")
if mat_sh and mat_sh.use_nodes:
    bsdf = mat_sh.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 3.0 + math.sin(t * math.pi * 6) * 3.0
            inp.keyframe_insert("default_value", frame=f)

# Particle trail shimmer (fade in/out)
mat_pt = bpy.data.materials.get("${asset.id}_ParticleGlow")
if mat_pt and mat_pt.use_nodes:
    bsdf_pt = mat_pt.node_tree.nodes.get("Principled BSDF")
    if bsdf_pt:
        inp_pt = bsdf_pt.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp_pt.default_value = 5.0 + math.sin(t * math.pi * 8) * 4.0
            inp_pt.keyframe_insert("default_value", frame=f)

# Particles gentle drift
for i in range(6):
    p = bpy.data.objects.get(f"${asset.id}_particle_{i}")
    if p:
        p.animation_data_create()
        base_z = p.location.z
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            p.location.z = base_z + math.sin(t * math.pi * 2 + i * 0.9) * 0.02
            p.keyframe_insert(data_path='location', frame=f)
print("Shard fragment animation applied")
`;
  }

  // ── Shared: Common Chest — lid subtle wobble (idle) ──
  if (asset.id === 'shared_chest_common') {
    return `
# Animation: treasure chest lid subtle wobble + lock ring sway
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Lock ring gentle sway
lock_ring = bpy.data.objects.get("${asset.id}_lock_ring")
if lock_ring:
    lock_ring.animation_data_create()
    for f in range(1, ${LOOP + 1}, 6):
        t = f / ${LOOP}
        lock_ring.rotation_euler.z = math.sin(t * math.pi * 2) * 0.03
        lock_ring.keyframe_insert(data_path='rotation_euler', frame=f)
print("Chest animation applied")
`;
  }

  // ── Shared: Wayshrine Base — rune glow pulse + crystal hover ──
  if (asset.id === 'shared_wayshrine_base') {
    return `
# Animation: wayshrine rune glow pulse + crystal gentle hover + glyph shimmer
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Crystal gentle hover
crystal = bpy.data.objects.get("${asset.id}_crystal")
if crystal:
    crystal.animation_data_create()
    base_z = crystal.location.z
    for f in range(1, ${LOOP + 1}, 3):
        t = f / ${LOOP}
        crystal.location.z = base_z + math.sin(t * math.pi * 2) * 0.04
        crystal.keyframe_insert(data_path='location', frame=f)
        s = 1.0 + math.sin(t * math.pi * 4) * 0.05
        crystal.scale = (s, s, s)
        crystal.keyframe_insert(data_path='scale', frame=f)

# Crystal glow pulse
mat_cr = bpy.data.materials.get("${asset.id}_CrystalGlow")
if mat_cr and mat_cr.use_nodes:
    bsdf = mat_cr.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        inp = bsdf.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp.default_value = 4.0 + math.sin(t * math.pi * 4) * 3.0
            inp.keyframe_insert("default_value", frame=f)

# Rune ring glow breathing
mat_rn = bpy.data.materials.get("${asset.id}_RuneGlow")
if mat_rn and mat_rn.use_nodes:
    bsdf_r = mat_rn.node_tree.nodes.get("Principled BSDF")
    if bsdf_r:
        inp_r = bsdf_r.inputs["Emission Strength"]
        for f in range(1, ${LOOP + 1}, 3):
            t = f / ${LOOP}
            inp_r.default_value = 2.5 + math.sin(t * math.pi * 2) * 2.5
            inp_r.keyframe_insert("default_value", frame=f)

# Glyphs subtle scale pulse (staggered)
for i in range(8):
    glyph = bpy.data.objects.get(f"${asset.id}_glyph_{i}")
    if glyph:
        glyph.animation_data_create()
        for f in range(1, ${LOOP + 1}, 4):
            t = f / ${LOOP}
            s = 1.0 + math.sin(t * math.pi * 2 + i * 0.785) * 0.1
            glyph.scale = (1.5*s, 0.3*s, 0.15*s)
            glyph.keyframe_insert(data_path='scale', frame=f)
print("Wayshrine base animation applied")
`;
  }

  // ── Shared: Wooden Crate — static with very subtle settle ──
  if (asset.id === 'shared_crate') {
    return `
# Animation: crate static — minor idle settle
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

body = bpy.data.objects.get("${asset.id}_body")
if body:
    body.animation_data_create()
    for f in range(1, ${LOOP + 1}, 10):
        t = f / ${LOOP}
        body.rotation_euler.z = math.sin(t * math.pi * 2) * 0.002
        body.keyframe_insert(data_path='rotation_euler', frame=f)
print("Crate animation applied")
`;
  }

  // ── Shared: Wooden Ladder — slight rope sway ──
  if (asset.id === 'shared_ladder') {
    return `
# Animation: ladder rope bindings gentle sway
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = ${LOOP}

# Rails subtle sway
for name in ["${asset.id}_rail_left", "${asset.id}_rail_right"]:
    rail = bpy.data.objects.get(name)
    if rail:
        rail.animation_data_create()
        for f in range(1, ${LOOP + 1}, 6):
            t = f / ${LOOP}
            rail.rotation_euler.x = math.sin(t * math.pi * 2) * 0.003
            rail.keyframe_insert(data_path='rotation_euler', frame=f)
print("Ladder animation applied")
`;
  }

  // ── Rock / stone / pillar — no meaningful animation ──
  if (asset.id.includes('rock') || asset.id.includes('stone') || asset.id.includes('pillar') || asset.id.includes('spire')) {
    return `
# Static asset — no animation
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = 1
print("Static rock — no animation")
`;
  }

  // Default: no animation
  return `
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = 1
print("No animation for this asset type")
`;
}

// ── Generator Availability ────────────────────────────────────────────────────

let _generatorCache = null;
let _generatorCacheTs = 0;
const GENERATOR_CACHE_TTL = 10 * 60 * 1000; // 10 min
const HYPER3D_FREE_TRIAL_KEY = 'k9TcfFoEhNd9cCPP2guHAHHHkctZHIRhZDywZ1euGUXwihbYLpOjQhofby80NJez';

export async function ensureHyper3dKey() {
  try {
    await callTool('blender-mcp', 'execute_blender_code', {
      code: `
import bpy
key = bpy.context.scene.blendermcp_hyper3d_api_key
if not key:
    bpy.context.scene.blendermcp_hyper3d_api_key = "${HYPER3D_FREE_TRIAL_KEY}"
    print("Set free trial key")
else:
    print("Key already set")
`,
    }, 10_000);
  } catch { /* addon not loaded */ }
}

async function ensureSketchfabKey() {
  const key = process.env.SKETCHFAB_API_KEY;
  if (!key) return;
  try {
    await callTool('blender-mcp', 'execute_blender_code', {
      code: `
import bpy
s = bpy.context.scene
if not s.blendermcp_sketchfab_api_key:
    s.blendermcp_sketchfab_api_key = "${key}"
    s.blendermcp_use_sketchfab = True
    print("Sketchfab key set from env")
else:
    print("Sketchfab key already set")
`,
    }, 10_000);
  } catch { /* addon not loaded */ }
}

export async function checkGeneratorAvailability() {
  if (_generatorCache && Date.now() - _generatorCacheTs < GENERATOR_CACHE_TTL) {
    return _generatorCache;
  }
  const status = { tripo3d: false, hunyuan3d: false, hyper3d: false, sketchfab: false };

  // Tripo3D: just check if API key is set (no Blender addon needed)
  status.tripo3d = !!getTripoApiKey();

  // Ensure keys are set before checking
  await ensureHyper3dKey();
  await ensureSketchfabKey();

  try {
    const r = await callTool('blender-mcp', 'get_hunyuan3d_status', {}, 15_000);
    status.hunyuan3d = r && !r.toLowerCase().includes('disabled') && !r.toLowerCase().includes('not enabled');
  } catch { /* unavailable */ }

  try {
    const r = await callTool('blender-mcp', 'get_hyper3d_status', {}, 15_000);
    status.hyper3d = r && !r.toLowerCase().includes('disabled') && !r.toLowerCase().includes('not enabled');
  } catch { /* unavailable */ }

  try {
    const r = await callTool('blender-mcp', 'get_sketchfab_status', {}, 15_000);
    status.sketchfab = r && !r.toLowerCase().includes('disabled') && !r.toLowerCase().includes('not enabled');
  } catch { /* unavailable */ }

  _generatorCache = status;
  _generatorCacheTs = Date.now();
  log.info({ ...status }, 'Generator availability check');
  return status;
}

// ── AI Prompt Builder (shared by Hunyuan3D & Hyper3D) ────────────────────────

function buildAIPrompt(asset, region) {
  const id = (asset.id || '').toLowerCase();

  // Art style anchor — specific references that AI generators understand
  const styleAnchor = 'Dark Souls meets Hades art style, stylized dark fantasy';

  // Surface detail keywords per asset type
  let surfaceDetails = '';
  if (/rock|stone|wall|ruin|altar|pillar/.test(id)) {
    surfaceDetails = 'weathered stone, cracks, moss in crevices, chipped edges';
  } else if (/wood|door|crate|barrel|bridge|stall/.test(id)) {
    surfaceDetails = 'worn wood grain, nail holes, peeling paint, rope-bound';
  } else if (/metal|iron|chain|sword|shield|anvil|forge/.test(id)) {
    surfaceDetails = 'hammered metal, rust spots, forge scale, dark patina';
  } else if (/crystal|shard|gem|void/.test(id)) {
    surfaceDetails = 'translucent crystal facets, internal light veins, prismatic';
  } else if (/tree|vine|moss|mushroom|fungi/.test(id)) {
    surfaceDetails = 'organic bark texture, bioluminescent spots, twisted growth';
  } else if (/lava|magma|ember|fire/.test(id)) {
    surfaceDetails = 'cracked obsidian, glowing orange fissures, cooled magma crust';
  } else if (/bone|skull|skeleton/.test(id)) {
    surfaceDetails = 'aged bone texture, yellowed cracks, dark staining';
  } else {
    surfaceDetails = 'detailed PBR surface, worn and weathered';
  }

  // Palette colors as hex for specificity
  const paletteHex = (region.palette || []).slice(0, 3);
  const colorGuide = paletteHex.length > 0
    ? `Colors: ${paletteHex[0]}, ${paletteHex[1] || paletteHex[0]}, accent ${paletteHex[2] || '#FFF'}.`
    : '';

  const regionCtx = region.theme ? `Setting: ${region.theme}.` : '';

  // Clean description (strip dimensions)
  const desc = (asset.description || asset.name)
    .replace(/\d+(\.\d+)?\s*m\s*(tall|wide|long|diameter|spread)\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const mats = (region.keyMaterials || []).slice(0, 2).join(', ');
  const matStr = mats ? `Materials: ${mats}.` : '';

  return `${styleAnchor}. ${desc}. ${surfaceDetails}. ${colorGuide} ${regionCtx} ${matStr} Game-ready PBR, under 15K tris.`
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}

function extractBboxFromDescription(description) {
  const w = description.match(/(\d+(?:\.\d+)?)\s*m\s*(?:wide|long|diameter|spread)/i);
  const h = description.match(/(\d+(?:\.\d+)?)\s*m\s*(?:tall|high)/i);
  const width = w ? parseFloat(w[1]) : 1;
  const height = h ? parseFloat(h[1]) : 1;
  const depth = Math.max(width * 0.3, 0.5);
  return [width, depth, height];
}

// ── Hyper3D Generation (async poll) ──────────────────────────────────────────

const HYPER3D_POLL_INTERVAL = 10_000;
const HYPER3D_MAX_POLL_TIME = 5 * 60_000;

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseHyper3dSubmitResponse(text) {
  if (!text) return null;
  const subKey = text.match(/subscription_key[:\s"']*([a-zA-Z0-9_-]+)/i);
  const reqId = text.match(/request_id[:\s"']*([a-zA-Z0-9_-]+)/i);
  const taskUuid = text.match(/task_uuid[:\s"']*([a-zA-Z0-9_-]+)/i);
  if (subKey) return { subscription_key: subKey[1], task_uuid: taskUuid?.[1] };
  if (reqId) return { request_id: reqId[1] };
  return null;
}

function parseHyper3dPollResponse(text) {
  if (!text) return { done: false, failed: false, status: 'unknown' };
  const lower = text.toLowerCase();
  if (lower.includes('"done"') || lower.includes('completed') || lower.includes('status: done')) {
    return { done: true, status: 'done' };
  }
  if (lower.includes('failed') || lower.includes('canceled') || lower.includes('error')) {
    return { failed: true, status: 'failed' };
  }
  return { done: false, failed: false, status: 'in_progress' };
}

async function generateViaHyper3d(asset, region, regionId) {
  const prompt = buildAIPrompt(asset, region);
  const bbox = extractBboxFromDescription(asset.description || '');

  log.info({ assetId: asset.id, prompt, bbox }, 'Hyper3D: submitting generation');

  const genResult = await callTool('blender-mcp', 'generate_hyper3d_model_via_text', {
    text_prompt: prompt,
    bbox_condition: bbox,
  }, 120_000);

  const parsed = parseHyper3dSubmitResponse(genResult);
  if (!parsed) throw new Error(`Hyper3D submit failed: ${genResult?.slice(0, 200)}`);

  log.info({ assetId: asset.id, ...parsed }, 'Hyper3D: job submitted, polling');

  // Poll until done
  const pollStart = Date.now();
  while (Date.now() - pollStart < HYPER3D_MAX_POLL_TIME) {
    await sleep(HYPER3D_POLL_INTERVAL);

    const pollArgs = parsed.subscription_key
      ? { subscription_key: parsed.subscription_key }
      : { request_id: parsed.request_id };

    const pollResult = await callTool('blender-mcp', 'poll_rodin_job_status', pollArgs, 30_000);
    const pollStatus = parseHyper3dPollResponse(pollResult);

    log.info({ assetId: asset.id, status: pollStatus.status, elapsed: Date.now() - pollStart }, 'Hyper3D: poll');

    if (pollStatus.done) break;
    if (pollStatus.failed) throw new Error(`Hyper3D generation failed: ${pollResult?.slice(0, 200)}`);
  }

  if (Date.now() - pollStart >= HYPER3D_MAX_POLL_TIME) {
    throw new Error('Hyper3D generation timed out (5 min)');
  }

  // Import into Blender
  const importArgs = { name: asset.id };
  if (parsed.task_uuid) importArgs.task_uuid = parsed.task_uuid;
  if (parsed.request_id) importArgs.request_id = parsed.request_id;

  await callTool('blender-mcp', 'import_generated_asset', importArgs, 60_000);
  log.info({ assetId: asset.id }, 'Hyper3D: model imported into Blender');

  return { method: 'hyper3d', prompt };
}

// ── Tripo3D Generation (300 free credits/month, REST API) ────────────────────

const TRIPO_API_BASE = 'https://api.tripo3d.ai/v2/openapi';
const TRIPO_POLL_INTERVAL = 8_000; // 8s between polls
const TRIPO_MAX_POLL_TIME = 5 * 60_000; // 5 min max

function getTripoApiKey() {
  return process.env.TRIPO_API_KEY || '';
}

async function tripoFetch(path, opts = {}) {
  const key = getTripoApiKey();
  if (!key) throw new Error('TRIPO_API_KEY not set in .env');

  const url = `${TRIPO_API_BASE}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      ...opts.headers,
    },
  });

  const json = await res.json();
  if (json.code !== 0) throw new Error(`Tripo API error: ${JSON.stringify(json)}`);
  return json.data;
}

async function generateViaTripo(asset, region, regionId) {
  const prompt = buildAIPrompt(asset, region);

  log.info({ assetId: asset.id, prompt }, 'Tripo3D: submitting text-to-model task');

  // 1. Create task
  const taskData = await tripoFetch('/task', {
    method: 'POST',
    body: JSON.stringify({
      type: 'text_to_model',
      prompt,
      model_version: 'v2.5',
    }),
  });

  const taskId = taskData.task_id;
  if (!taskId) throw new Error(`Tripo3D: no task_id in response: ${JSON.stringify(taskData)}`);

  log.info({ assetId: asset.id, taskId }, 'Tripo3D: task created, polling');

  // 2. Poll until done
  const pollStart = Date.now();
  let result = null;
  while (Date.now() - pollStart < TRIPO_MAX_POLL_TIME) {
    await sleep(TRIPO_POLL_INTERVAL);

    const poll = await tripoFetch(`/task/${taskId}`);
    log.info({ assetId: asset.id, status: poll.status, elapsed: Date.now() - pollStart }, 'Tripo3D: poll');

    if (poll.status === 'success') {
      result = poll;
      break;
    }
    if (poll.status === 'failed' || poll.status === 'cancelled') {
      throw new Error(`Tripo3D generation failed: ${poll.status}`);
    }
  }

  if (!result) throw new Error('Tripo3D generation timed out (5 min)');

  // 3. Download GLB to local file
  const modelUrl = result.output?.pbr_model || result.output?.model;
  if (!modelUrl) throw new Error('Tripo3D: no model URL in result');

  const glbDir = join(ASSETS_DIR, 'Meshes', regionId);
  if (!existsSync(glbDir)) mkdirSync(glbDir, { recursive: true });
  const glbPath = join(glbDir, `${asset.id}.glb`).replace(/\\/g, '/');

  log.info({ assetId: asset.id, modelUrl }, 'Tripo3D: downloading GLB');

  const dlRes = await fetch(modelUrl);
  if (!dlRes.ok) throw new Error(`Tripo3D download failed: ${dlRes.status}`);
  const buffer = Buffer.from(await dlRes.arrayBuffer());
  writeFileSync(glbPath, buffer);

  log.info({ assetId: asset.id, glbPath, bytes: buffer.length }, 'Tripo3D: GLB saved');

  // 4. Import GLB into Blender
  await callTool('blender-mcp', 'execute_blender_code', {
    code: `
import bpy
bpy.ops.import_scene.gltf(filepath="${glbPath}")
print(f"Imported GLB: {len([o for o in bpy.data.objects if o.type == 'MESH'])} meshes")
`,
  }, 30_000);

  log.info({ assetId: asset.id }, 'Tripo3D: model imported into Blender');
  return { method: 'tripo3d', prompt, taskId };
}

// ── Hunyuan3D Generation (free, 20/day) ──────────────────────────────────────

function parseHunyuanSubmitResponse(text) {
  if (!text) return null;
  const match = text.match(/job_id[:\s"']*([a-zA-Z0-9_-]+)/i) || text.match(/(job_[a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function parseHunyuanPollResponse(text) {
  if (!text) return { done: false, failed: false, status: 'unknown', zipUrl: null };
  const lower = text.toLowerCase();
  if (lower.includes('"done"') || lower.includes('status: done') || lower.includes("'done'")) {
    // Extract the ResultFile3Ds / zip URL
    const zipMatch = text.match(/ResultFile3Ds[:\s"']*([^\s"']+\.zip)/i)
      || text.match(/(https?:\/\/[^\s"']+\.zip)/i)
      || text.match(/([^\s"']+\.zip)/i);
    return { done: true, status: 'done', zipUrl: zipMatch?.[1] || null };
  }
  if (lower.includes('fail') || lower.includes('error') || lower.includes('cancel')) {
    return { failed: true, status: 'failed', zipUrl: null };
  }
  return { done: false, failed: false, status: 'in_progress', zipUrl: null };
}

async function generateViaHunyuan3d(asset, region, regionId) {
  const prompt = buildAIPrompt(asset, region);

  log.info({ assetId: asset.id, prompt }, 'Hunyuan3D: submitting generation');

  const genResult = await callTool('blender-mcp', 'generate_hunyuan3d_model', {
    text_prompt: prompt,
  }, 120_000);

  const jobId = parseHunyuanSubmitResponse(genResult);
  if (!jobId) throw new Error(`Hunyuan3D submit failed: ${genResult?.slice(0, 200)}`);

  log.info({ assetId: asset.id, jobId }, 'Hunyuan3D: job submitted, polling');

  // Poll until done
  const pollStart = Date.now();
  let zipUrl = null;
  while (Date.now() - pollStart < HYPER3D_MAX_POLL_TIME) {
    await sleep(HYPER3D_POLL_INTERVAL);

    const pollResult = await callTool('blender-mcp', 'poll_hunyuan_job_status', {
      job_id: jobId,
    }, 30_000);

    const pollStatus = parseHunyuanPollResponse(pollResult);
    log.info({ assetId: asset.id, status: pollStatus.status, elapsed: Date.now() - pollStart }, 'Hunyuan3D: poll');

    if (pollStatus.done) {
      zipUrl = pollStatus.zipUrl;
      break;
    }
    if (pollStatus.failed) throw new Error(`Hunyuan3D generation failed: ${pollResult?.slice(0, 200)}`);
  }

  if (!zipUrl) {
    throw new Error('Hunyuan3D: generation completed but no zip URL found');
  }

  // Import into Blender
  await callTool('blender-mcp', 'import_generated_asset_hunyuan', {
    name: asset.id,
    zip_file_url: zipUrl,
  }, 60_000);

  log.info({ assetId: asset.id }, 'Hunyuan3D: model imported into Blender');
  return { method: 'hunyuan3d', prompt };
}

// ── Sketchfab Fallback ───────────────────────────────────────────────────────

function parseSketchfabFirstUid(text) {
  if (!text) return null;
  const match = text.match(/UID:\s*([a-f0-9]+)/i) || text.match(/uid[:\s"']*([a-f0-9]{20,})/i);
  return match ? match[1] : null;
}

function buildSketchfabQuery(asset, region) {
  // Map region styles to search keywords Sketchfab actually understands
  const REGION_STYLE = {
    CrossroadsHub: 'medieval fantasy village',
    AshenWilds: 'dark fantasy scorched wasteland',
    Ironhold: 'medieval fortress military',
    VerdantReach: 'fantasy jungle forest magical',
    SunkenHalls: 'underwater ruins ancient',
    EmberPeaks: 'volcanic fantasy lava forge',
    Aethermere: 'ethereal void crystal magical',
    TheWilds: 'forest nature medieval',
    Shared: 'fantasy game prop',
    Characters: 'fantasy character',
    Weapons: 'medieval fantasy weapon',
    Enemies: 'fantasy creature monster',
    Effects: 'fantasy magic effect',
  };

  // Clean asset name: remove region prefixes and special naming
  let name = asset.name
    .replace(/^(cross|ash|iron|verd|sunk|ember|aeth|wild|shared|char|wpn|boss|enemy|fx)_/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();

  // Use the description keywords if name is too short
  const desc = asset.description || '';
  const descKeywords = desc
    .replace(/\d+(\.\d+)?\s*m\s*(tall|wide|long|diameter)/gi, '') // strip dimensions
    .replace(/[.!,]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !/^(with|from|that|this|near|have|each|very)$/i.test(w))
    .slice(0, 4)
    .join(' ');

  const style = REGION_STYLE[region] || 'fantasy game';
  const typeHint = asset.type === 'hero' ? 'detailed' : asset.type === 'environment' ? 'environment' : '';

  // Build query: asset name + key description words + style
  return `${name} ${descKeywords} ${style} ${typeHint}`.replace(/\s+/g, ' ').trim().slice(0, 80);
}

async function generateViaSketchfab(asset, region, regionId) {
  const query = buildSketchfabQuery(asset, regionId);

  const searchResult = await callTool('blender-mcp', 'search_sketchfab_models', {
    query,
    downloadable: true,
    count: 5,
  }, 30_000);

  const uid = parseSketchfabFirstUid(searchResult);
  if (!uid) throw new Error(`No Sketchfab results for "${query}"`);

  const sizeMatch = (asset.description || '').match(/(\d+(?:\.\d+)?)\s*m\s*(?:tall|high|wide|long)/i);
  const targetSize = sizeMatch ? parseFloat(sizeMatch[1]) : 2.0;

  await callTool('blender-mcp', 'download_sketchfab_model', {
    uid,
    target_size: targetSize,
  }, 120_000);

  log.info({ assetId: asset.id, uid, targetSize }, 'Sketchfab: model downloaded');
  return { method: 'sketchfab', uid, targetSize };
}

// ── Shared Helpers ───────────────────────────────────────────────────────────

export async function clearBlenderScene() {
  await callTool('blender-mcp', 'execute_blender_code', {
    code: `
import bpy
# Select all objects except lights (preserve HDRI/3-point lighting setup)
bpy.ops.object.select_all(action='DESELECT')
for obj in bpy.data.objects:
    if obj.type != 'LIGHT':
        obj.select_set(True)
bpy.ops.object.delete()
for block in bpy.data.meshes:
    if block.users == 0: bpy.data.meshes.remove(block)
for block in bpy.data.materials:
    if block.users == 0: bpy.data.materials.remove(block)
print("Scene cleared (lights preserved)")
`,
  }, 15_000);
}

// ── HDRI Environment Lighting ─────────────────────────────────────────────────

// Verified PolyHaven HDRI IDs — moody/dark outdoor scenes for dark fantasy
const DARK_FANTASY_HDRIS = [
  'moonless_golf',
  'dikhololo_night',
  'kloppenheim_02',
  'cobblestone_street_night',
];

let _hdriApplied = false;

async function applyHdriLighting() {
  if (_hdriApplied) return;

  try {
    const phStatus = await callTool('blender-mcp', 'get_polyhaven_status', {}, 10_000);
    if (!phStatus || phStatus.toLowerCase().includes('disabled') || phStatus.toLowerCase().includes('not available')) {
      log.info('PolyHaven not available for HDRI, using fallback lighting');
      await applyFallbackLighting();
      return;
    }

    const hdriId = DARK_FANTASY_HDRIS[Math.floor(Math.random() * DARK_FANTASY_HDRIS.length)];
    log.info({ hdriId }, 'Downloading PolyHaven HDRI for environment lighting');

    const dlResult = await callTool('blender-mcp', 'download_polyhaven_asset', {
      asset_id: hdriId,
      asset_type: 'hdris',
      resolution: '1k',
      file_format: 'hdr',
    }, 60_000);

    if (!dlResult || dlResult.toLowerCase().includes('error')) {
      log.warn({ hdriId, result: dlResult?.slice(0, 200) }, 'HDRI download failed, using fallback');
      await applyFallbackLighting();
      return;
    }

    _hdriApplied = true;
    log.info({ hdriId }, 'HDRI environment lighting applied');
  } catch (err) {
    log.warn({ err: err.message }, 'HDRI lighting failed, using fallback');
    await applyFallbackLighting();
  }
}

async function applyFallbackLighting() {
  await callTool('blender-mcp', 'execute_blender_code', {
    code: `
import bpy, math

# ═══ World: dark fantasy gradient (deep blue-black → dark purple) ═══
world = bpy.context.scene.world
if world is None:
    world = bpy.data.worlds.new("World")
    bpy.context.scene.world = world
world.use_nodes = True
wnt = world.node_tree
for n in list(wnt.nodes):
    wnt.nodes.remove(n)

tc = wnt.nodes.new('ShaderNodeTexCoord'); tc.location = (-800, 0)
sep = wnt.nodes.new('ShaderNodeSeparateXYZ'); sep.location = (-600, 0)
wnt.links.new(tc.outputs['Generated'], sep.inputs['Vector'])

# Smooth power curve for organic gradient transition
pw = wnt.nodes.new('ShaderNodeMath'); pw.location = (-400, 0)
pw.operation = 'POWER'; pw.inputs[1].default_value = 1.4
wnt.links.new(sep.outputs['Z'], pw.inputs[0])

ramp = wnt.nodes.new('ShaderNodeValToRGB'); ramp.location = (-200, 0)
ramp.color_ramp.interpolation = 'B_SPLINE'
ramp.color_ramp.elements[0].position = 0.0
ramp.color_ramp.elements[0].color = (0.008, 0.010, 0.022, 1.0)
e_mid = ramp.color_ramp.elements.new(0.3)
e_mid.color = (0.025, 0.028, 0.050, 1.0)
ramp.color_ramp.elements[1].position = 0.7
ramp.color_ramp.elements[1].color = (0.055, 0.05, 0.075, 1.0)

wnt.links.new(pw.outputs['Value'], ramp.inputs['Fac'])
bg = wnt.nodes.new('ShaderNodeBackground'); bg.location = (100, 0)
bg.inputs['Strength'].default_value = 0.6
wnt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
out = wnt.nodes.new('ShaderNodeOutputWorld'); out.location = (300, 0)
wnt.links.new(bg.outputs['Background'], out.inputs['Surface'])

# ═══ Key Light: warm, large area (main illumination) ═══
bpy.ops.object.light_add(type='AREA', location=(4.5, -3.5, 6.5))
key = bpy.context.object; key.name = "KeyLight"
key.data.energy = 250; key.data.color = (1.0, 0.93, 0.85); key.data.size = 5.0
if hasattr(key.data, 'shape'):
    key.data.shape = 'RECTANGLE'; key.data.size_y = 2.5
key.rotation_euler = (math.radians(55), math.radians(5), math.radians(30))
if hasattr(key.data, 'use_contact_shadow'):
    key.data.use_contact_shadow = True
    if hasattr(key.data, 'contact_shadow_distance'):
        key.data.contact_shadow_distance = 0.3

# ═══ Fill Light: cool blue, opposite side (shadow fill) ═══
bpy.ops.object.light_add(type='AREA', location=(-5.5, 3.5, 4))
fill = bpy.context.object; fill.name = "FillLight"
fill.data.energy = 100; fill.data.color = (0.78, 0.85, 1.0); fill.data.size = 7.0
fill.rotation_euler = (math.radians(45), math.radians(-10), math.radians(150))

# ═══ Rim Light: strong backlight edge definition ═══
bpy.ops.object.light_add(type='AREA', location=(1, 6, 5.5))
rim = bpy.context.object; rim.name = "RimLight"
rim.data.energy = 180; rim.data.color = (0.90, 0.88, 1.0); rim.data.size = 3.5
rim.rotation_euler = (math.radians(25), 0, math.radians(175))

# ═══ Low accent: subtle colored kick light ═══
bpy.ops.object.light_add(type='AREA', location=(-3, -4, 1.5))
acc = bpy.context.object; acc.name = "AccentLight"
acc.data.energy = 35; acc.data.color = (0.65, 0.78, 1.0); acc.data.size = 2.0
acc.rotation_euler = (math.radians(75), math.radians(15), math.radians(-45))

# ═══ EEVEE Configuration ═══
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
eevee = scene.eevee

if hasattr(eevee, 'taa_render_samples'):
    eevee.taa_render_samples = 192; eevee.taa_samples = 48
if hasattr(eevee, 'use_ssr'):
    eevee.use_ssr = True; eevee.use_ssr_refraction = True
    eevee.ssr_quality = 0.75; eevee.ssr_max_roughness = 0.6; eevee.ssr_thickness = 0.1
if hasattr(eevee, 'use_gtao'):
    eevee.use_gtao = True; eevee.gtao_distance = 0.4; eevee.gtao_factor = 1.5
if hasattr(eevee, 'use_bloom'):
    eevee.use_bloom = True; eevee.bloom_threshold = 0.7; eevee.bloom_intensity = 0.06; eevee.bloom_radius = 6.5
if hasattr(eevee, 'use_soft_shadows'):
    eevee.use_soft_shadows = True
if hasattr(eevee, 'shadow_cube_size'):
    eevee.shadow_cube_size = '2048'
if hasattr(eevee, 'shadow_cascade_size'):
    eevee.shadow_cascade_size = '2048'

try:
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = 0.15
    scene.view_settings.gamma = 1.05
except:
    try:
        scene.view_settings.view_transform = 'Filmic'
        scene.view_settings.look = 'High Contrast'
    except: pass

print("Pipeline lighting v2: 4-point area + EEVEE configured")
`,
  }, 15_000);
  _hdriApplied = true;
}

async function exportAssetFbx(assetId, regionId) {
  const outputPath = join(ASSETS_DIR, 'Meshes', regionId, `${assetId}.fbx`).replace(/\\/g, '/');

  await callTool('blender-mcp', 'execute_blender_code', {
    code: `
import bpy
bpy.ops.object.select_all(action='DESELECT')
for obj in bpy.data.objects:
    if obj.type in ('MESH', 'EMPTY', 'ARMATURE'):
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj

has_anim = any(obj.animation_data and obj.animation_data.action for obj in bpy.data.objects)
mat_anim = any(
    mat.node_tree and mat.node_tree.animation_data and mat.node_tree.animation_data.action
    for mat in bpy.data.materials if mat.use_nodes and mat.node_tree
)

bpy.ops.export_scene.fbx(
    filepath="${outputPath}",
    use_selection=True,
    apply_scale_options='FBX_SCALE_ALL',
    axis_forward='-Y',
    axis_up='Z',
    use_mesh_modifiers=True,
    mesh_smooth_type='FACE',
    add_leaf_bones=False,
    bake_anim=has_anim or mat_anim,
    bake_anim_use_all_actions=True,
    bake_anim_force_startend_keying=True,
    bake_anim_step=1.0,
    bake_anim_simplify_factor=0.0,
)
anim_str = "with animation" if (has_anim or mat_anim) else "static"
print(f"Exported {anim_str} to ${outputPath}")
`,
  }, 30_000);

  return outputPath;
}

// ── Post-Import Adjustments for AI Models ────────────────────────────────────

async function postImportAdjustments(asset) {
  await callTool('blender-mcp', 'execute_blender_code', {
    code: `
import bpy, mathutils

# ── 1. Rename + cleanup ──────────────────────────────────────────────
for i, obj in enumerate(bpy.data.objects):
    if obj.type == 'MESH':
        obj.name = f"${asset.id}_part_{i}"

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

all_meshes = [o for o in bpy.data.objects if o.type == 'MESH']
if all_meshes:
    avg = sum((o.location for o in all_meshes), mathutils.Vector()) / len(all_meshes)
    for o in all_meshes:
        o.location -= avg

# ── 2. Smooth shading + auto-smooth ─────────────────────────────────
for obj in all_meshes:
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.object.shade_smooth()
    if hasattr(obj.data, 'use_auto_smooth'):
        obj.data.use_auto_smooth = True
        obj.data.auto_smooth_angle = 1.22

# ── 3. PBR material upgrade ──────────────────────────────────────────
for obj in all_meshes:
    for slot in obj.material_slots:
        mat = slot.material
        if mat is None:
            mat = bpy.data.materials.new(name=f"${asset.id}_auto_pbr")
            mat.use_nodes = True
            bsdf = mat.node_tree.nodes.get("Principled BSDF")
            if bsdf:
                bsdf.inputs["Base Color"].default_value = (0.50, 0.47, 0.42, 1.0)
                bsdf.inputs["Roughness"].default_value = 0.70
                bsdf.inputs["Metallic"].default_value = 0.0
            slot.material = mat
        elif not mat.use_nodes:
            old_color = mat.diffuse_color[:] if hasattr(mat, 'diffuse_color') else (0.5, 0.5, 0.5, 1.0)
            mat.use_nodes = True
            bsdf = mat.node_tree.nodes.get("Principled BSDF")
            if bsdf:
                bsdf.inputs["Base Color"].default_value = old_color
                bsdf.inputs["Roughness"].default_value = 0.65
        else:
            bsdf = mat.node_tree.nodes.get("Principled BSDF")
            if bsdf:
                rough = bsdf.inputs["Roughness"].default_value
                if rough < 0.08:
                    bsdf.inputs["Roughness"].default_value = 0.35
                elif rough > 0.95:
                    bsdf.inputs["Roughness"].default_value = 0.85

# ── 4. PBR enhancement: noise roughness + voronoi bump ──────────────
for obj in all_meshes:
    for slot in obj.material_slots:
        mat = slot.material
        if mat is None or not mat.use_nodes:
            continue
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links
        bsdf = nodes.get("Principled BSDF")
        if bsdf is None:
            continue
        if any(n.name == 'sela_roughness_noise' for n in nodes):
            continue

        base_rough = bsdf.inputs["Roughness"].default_value

        tex_coord = nodes.new('ShaderNodeTexCoord')
        tex_coord.location = (-800, -300)

        # Noise roughness variation (±0.12)
        noise = nodes.new('ShaderNodeTexNoise')
        noise.name = 'sela_roughness_noise'
        noise.location = (-550, -300)
        noise.inputs['Scale'].default_value = 15.0
        noise.inputs['Detail'].default_value = 8.0
        noise.inputs['Roughness'].default_value = 0.55
        links.new(tex_coord.outputs['Object'], noise.inputs['Vector'])

        ramp = nodes.new('ShaderNodeMapRange')
        ramp.location = (-300, -300)
        ramp.inputs['From Min'].default_value = 0.0
        ramp.inputs['From Max'].default_value = 1.0
        ramp.inputs['To Min'].default_value = max(0.1, base_rough - 0.12)
        ramp.inputs['To Max'].default_value = min(1.0, base_rough + 0.12)
        links.new(noise.outputs['Fac'], ramp.inputs['Value'])

        for link in list(links):
            if link.to_socket == bsdf.inputs['Roughness']:
                links.remove(link)
        links.new(ramp.outputs['Result'], bsdf.inputs['Roughness'])

        # Voronoi micro-bump
        voronoi = nodes.new('ShaderNodeTexVoronoi')
        voronoi.location = (-550, -600)
        voronoi.inputs['Scale'].default_value = 25.0
        links.new(tex_coord.outputs['Object'], voronoi.inputs['Vector'])

        bump_node = nodes.new('ShaderNodeBump')
        bump_node.location = (-250, -600)
        bump_node.inputs['Strength'].default_value = 0.12
        links.new(voronoi.outputs['Distance'], bump_node.inputs['Height'])

        if bsdf.inputs['Normal'].is_linked:
            old_normal = bsdf.inputs['Normal'].links[0].from_socket
            links.new(old_normal, bump_node.inputs['Normal'])
        for link in list(links):
            if link.to_socket == bsdf.inputs['Normal']:
                links.remove(link)
        links.new(bump_node.outputs['Normal'], bsdf.inputs['Normal'])

# ── 5. Edge wear: darken edges for depth (Pointiness→ColorRamp→MixRGB) ──
for obj in all_meshes:
    for slot in obj.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes:
            continue
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links
        bsdf = nodes.get("Principled BSDF")
        if not bsdf or any(n.name == 'sela_edge_wear' for n in nodes):
            continue
        # Get current base color connection or value
        bc_input = bsdf.inputs["Base Color"]
        if bc_input.is_linked:
            bc_source = bc_input.links[0].from_socket
        else:
            bc_val = bc_input.default_value[:]
            # Create RGB node with the color value
            rgb = nodes.new('ShaderNodeRGB'); rgb.location = (-800, 200)
            rgb.outputs['Color'].default_value = bc_val
            bc_source = rgb.outputs['Color']
        try:
            geo = nodes.new('ShaderNodeNewGeometry'); geo.location = (-800, 400)
            geo.name = 'sela_edge_wear'
            cr = nodes.new('ShaderNodeValToRGB'); cr.location = (-550, 400)
            cr.color_ramp.elements[0].position = 0.45; cr.color_ramp.elements[0].color = (0.0, 0.0, 0.0, 1.0)
            cr.color_ramp.elements[1].position = 0.55; cr.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1.0)
            links.new(geo.outputs['Pointiness'], cr.inputs['Fac'])
            darken = nodes.new('ShaderNodeMixRGB'); darken.location = (-300, 300)
            darken.blend_type = 'MULTIPLY'
            darken.inputs['Fac'].default_value = 0.15
            for lk in list(links):
                if lk.to_socket == bc_input:
                    links.remove(lk)
            links.new(bc_source, darken.inputs[1])
            links.new(cr.outputs['Color'], darken.inputs[2])
            links.new(darken.outputs['Color'], bc_input)
        except Exception:
            pass  # Pointiness may not be available on all mesh types

print("PBR v2: roughness variation + bump + edge wear")

# ── 6. Subdivision for low-poly AI models ────────────────────────────
for obj in all_meshes:
    pc = len(obj.data.polygons)
    if pc < 400 and not any(m.type == 'SUBSURF' for m in obj.modifiers):
        mod = obj.modifiers.new(name="SubDiv", type='SUBSURF')
        mod.levels = 1; mod.render_levels = 2

print(f"Post-import v2 done for ${asset.id}: {len(all_meshes)} meshes")
`,
  }, 45_000);
}

// ── PolyHaven PBR Texture Application ─────────────────────────────────────────

async function applyPolyHavenTexture(asset) {
  try {
    const phStatus = await callTool('blender-mcp', 'get_polyhaven_status', {}, 10_000);
    if (!phStatus || phStatus.toLowerCase().includes('disabled') || phStatus.toLowerCase().includes('not available')) {
      log.info({ assetId: asset.id }, 'PolyHaven not available, skipping texture');
      return false;
    }

    const category = guessTextureCategory(asset);
    const textureIds = POLYHAVEN_TEXTURE_MAP[category];
    if (!textureIds || textureIds.length === 0) {
      log.info({ assetId: asset.id, category }, 'No PolyHaven textures mapped for category');
      return false;
    }

    // Pick random texture from category for variety
    const textureId = textureIds[Math.floor(Math.random() * textureIds.length)];

    log.info({ assetId: asset.id, textureId, category }, 'PolyHaven: downloading texture');
    const dlResult = await callTool('blender-mcp', 'download_polyhaven_asset', {
      asset_id: textureId,
      asset_type: 'textures',
      resolution: '1k',
    }, 60_000);

    if (!dlResult || dlResult.toLowerCase().includes('error') || dlResult.toLowerCase().includes('failed')) {
      log.warn({ assetId: asset.id, textureId, result: dlResult?.slice(0, 200) }, 'PolyHaven: texture download failed');
      return false;
    }

    // Get mesh names from Blender scene
    const objNameResult = await callTool('blender-mcp', 'execute_blender_code', {
      code: `
import bpy
meshes = [o.name for o in bpy.data.objects if o.type == 'MESH']
print('MESH_NAMES:' + '|'.join(meshes))
`,
    }, 10_000);

    const meshLine = (objNameResult || '').split('\n').find(l => l.includes('MESH_NAMES:'));
    const meshNames = meshLine ? meshLine.replace(/.*MESH_NAMES:/, '').split('|').filter(Boolean) : [];

    if (meshNames.length === 0) {
      log.warn({ assetId: asset.id }, 'PolyHaven: no meshes found to texture');
      return false;
    }

    // Apply texture material to ALL meshes in scene
    // Use direct Python assignment (set_texture MCP tool has Blender 4.x compat issue)
    const objList = meshNames.map(n => `"${n}"`).join(', ');
    await callTool('blender-mcp', 'execute_blender_code', {
      code: `
import bpy
tex_mat = bpy.data.materials.get('${textureId}')
if not tex_mat:
    # Try finding material containing the texture ID name
    for m in bpy.data.materials:
        if '${textureId}' in m.name.lower():
            tex_mat = m
            break
if tex_mat:
    tex_mat.use_fake_user = True
    for obj_name in [${objList}]:
        obj = bpy.data.objects.get(obj_name)
        if obj and obj.type == 'MESH':
            # Preserve emissive materials (crystals, fire, magic)
            has_emissive = False
            for mat_slot in obj.data.materials:
                if mat_slot and mat_slot.use_nodes:
                    for node in mat_slot.node_tree.nodes:
                        if node.type == 'BSDF_PRINCIPLED':
                            em = node.inputs.get('Emission Strength') or node.inputs.get('Emission')
                            if em and hasattr(em, 'default_value') and em.default_value > 0.5:
                                has_emissive = True; break
                        elif node.type == 'EMISSION':
                            has_emissive = True; break
                if has_emissive: break
            if has_emissive:
                print(f"Skipped {obj_name} (has emissive material)")
                continue
            obj.data.materials.clear()
            obj.data.materials.append(tex_mat)
            # Ensure UV map exists for image texture mapping
            if not obj.data.uv_layers:
                bpy.context.view_layer.objects.active = obj
                obj.select_set(True)
                bpy.ops.object.mode_set(mode='EDIT')
                bpy.ops.mesh.select_all(action='SELECT')
                bpy.ops.uv.smart_project(angle_limit=66, island_margin=0.02, scale_to_bounds=True)
                bpy.ops.object.mode_set(mode='OBJECT')
            print(f"Applied ${textureId} to {obj_name}")
    print("Texture assignment done")
else:
    print("ERROR: material ${textureId} not found in scene")
    print("Available materials: " + str([m.name for m in bpy.data.materials]))
`,
    }, 20_000);

    log.info({ assetId: asset.id, textureId, category, appliedTo: meshNames.length }, 'PolyHaven: texture applied');
    return true;
  } catch (err) {
    log.warn({ assetId: asset.id, err: err.message }, 'PolyHaven texture step failed (non-fatal)');
    return false;
  }
}

// ── Viewport Screenshot QA ────────────────────────────────────────────────────

async function captureViewportScreenshot(asset, regionId) {
  try {
    // Try a proper EEVEE render with auto-camera first
    const renderPath = join(ASSETS_DIR, 'Previews', regionId, `${asset.id}_preview.png`).replace(/\\/g, '/');

    const result = await callTool('blender-mcp', 'execute_blender_code', {
      code: `
import bpy, math, os
from mathutils import Vector

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
if not meshes:
    print("NO_MESHES")
else:
    # Bounding box calculation
    coords = []
    for obj in meshes:
        for corner in obj.bound_box:
            coords.append(obj.matrix_world @ Vector(corner))
    bb_min = Vector((min(c[0] for c in coords), min(c[1] for c in coords), min(c[2] for c in coords)))
    bb_max = Vector((max(c[0] for c in coords), max(c[1] for c in coords), max(c[2] for c in coords)))
    center = (bb_min + bb_max) / 2
    bb_size = bb_max - bb_min
    max_dim = max(bb_size.x, bb_size.y, bb_size.z, 0.5)

    # Look slightly above center
    look_at = center.copy()
    look_at.z += bb_size.z * 0.08

    # Camera setup — 3/4 hero angle, tight framing
    if max_dim > 4.0:
        _lens = 50; _dm = 2.0
    elif max_dim > 1.5:
        _lens = 65; _dm = 1.8
    else:
        _lens = 85; _dm = 1.6
    cam_data = bpy.data.cameras.new("Preview_Cam")
    cam_data.lens = _lens
    cam_data.clip_start = 0.01; cam_data.clip_end = 500
    cam_obj = bpy.data.objects.new("Preview_Cam", cam_data)
    bpy.context.collection.objects.link(cam_obj)

    dist = max_dim * _dm
    ah = math.radians(35); av = math.radians(25)
    cam_obj.location = (
        look_at.x + dist * math.cos(ah) * math.cos(av),
        look_at.y - dist * math.sin(ah) * math.cos(av),
        look_at.z + dist * math.sin(av)
    )
    direction = look_at - cam_obj.location
    cam_obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam_obj

    # DOF
    cam_data.dof.use_dof = True
    bpy.ops.object.empty_add(location=look_at)
    ft = bpy.context.object; ft.name = "Preview_DOF"; ft.hide_render = True
    cam_data.dof.focus_object = ft
    cam_data.dof.aperture_fstop = 5.6; cam_data.dof.aperture_blades = 6

    # Render
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 1024; scene.render.resolution_y = 1024
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = 'PNG'
    if hasattr(scene.render.image_settings, 'compression'):
        scene.render.image_settings.compression = 15

    output_path = "${renderPath}"
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    scene.render.filepath = output_path
    bpy.ops.render.render(write_still=True)

    # Cleanup camera
    bpy.data.objects.remove(cam_obj, do_unlink=True)
    bpy.data.cameras.remove(cam_data)
    bpy.data.objects.remove(ft, do_unlink=True)

    sz = os.path.getsize(output_path)
    print(f"PREVIEW_OK:{output_path}:{sz}")
`,
    }, 90_000);

    const rendered = result && result.includes('PREVIEW_OK');
    log.info({
      assetId: asset.id,
      regionId,
      rendered,
    }, rendered ? 'EEVEE preview rendered' : 'EEVEE preview failed, trying viewport');

    if (!rendered) {
      // Fallback to viewport screenshot
      await callTool('blender-mcp', 'get_viewport_screenshot', { max_size: 800 }, 15_000);
    }
    return true;
  } catch (err) {
    log.warn({ assetId: asset.id, err: err.message }, 'Preview capture failed (non-fatal)');
    return false;
  }
}

// ── Simple Animation for AI Models ───────────────────────────────────────────

async function applySimpleAnimation(asset) {
  if (STATIC_TYPES.some(t => asset.id.includes(t))) return;

  let animCode;

  if (/crystal|shard|void|lantern/.test(asset.id)) {
    animCode = `
# Slow glow pulse for crystalline/magical objects
import math
for obj in [o for o in bpy.data.objects if o.type == 'MESH'][:3]:
    obj.animation_data_create()
    base = obj.scale.copy()
    for f in range(1, 61, 4):
        t = f / 60
        s = 1.0 + math.sin(t * math.pi * 2) * 0.03
        obj.scale = (base.x * s, base.y * s, base.z * s)
        obj.keyframe_insert(data_path='scale', frame=f)
`;
  } else if (/fire|torch|campfire|flame|ember|lava|magma/.test(asset.id)) {
    animCode = `
# Flicker for fire-related objects
import random
random.seed(7)
for obj in [o for o in bpy.data.objects if o.type == 'MESH'][:3]:
    obj.animation_data_create()
    base = obj.scale.copy()
    for f in range(1, 61, 2):
        obj.scale = (base.x * (0.9 + random.uniform(0, 0.2)),
                     base.y * (0.9 + random.uniform(0, 0.2)),
                     base.z * (0.85 + random.uniform(0, 0.3)))
        obj.keyframe_insert(data_path='scale', frame=f)
`;
  } else if (/banner|cloth|canopy|tent/.test(asset.id)) {
    animCode = `
# Cloth sway
import math
for obj in [o for o in bpy.data.objects if o.type == 'MESH'][:2]:
    obj.animation_data_create()
    for f in range(1, 61, 4):
        t = f / 60
        obj.rotation_euler.z = math.sin(t * math.pi * 4) * 0.06
        obj.rotation_euler.y = math.sin(t * math.pi * 2 + 0.5) * 0.03
        obj.keyframe_insert(data_path='rotation_euler', frame=f)
`;
  } else if (/tree|oak|mushroom|fungi|vine|moss/.test(asset.id)) {
    animCode = `
# Gentle wind sway
import math
root = next((o for o in bpy.data.objects if o.type == 'MESH'), None)
if root:
    root.animation_data_create()
    for f in range(1, 61, 4):
        t = f / 60
        root.rotation_euler.x = math.sin(t * math.pi * 2) * 0.015
        root.rotation_euler.y = math.cos(t * math.pi * 2 + 0.5) * 0.01
        root.keyframe_insert(data_path='rotation_euler', frame=f)
`;
  } else {
    animCode = `
# Subtle idle breathing
import math
root = next((o for o in bpy.data.objects if o.type == 'MESH'), None)
if root:
    root.animation_data_create()
    for f in range(1, 61, 4):
        t = f / 60
        root.rotation_euler.x = math.sin(t * math.pi * 2) * 0.008
        root.keyframe_insert(data_path='rotation_euler', frame=f)
`;
  }

  await callTool('blender-mcp', 'execute_blender_code', {
    code: `
import bpy
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = 60
bpy.context.scene.render.fps = 30
${animCode}
print("Simple animation applied for AI model")
`,
  }, 30_000);
}

// ── Asset Lookup (for regeneration) ──────────────────────────────────────────

export function getAssetById(assetId) {
  const manifest = loadManifest();
  for (const [regionId, region] of Object.entries(manifest.regions)) {
    for (const asset of region.assets) {
      if (asset.id === assetId) return { regionId, region, asset };
    }
  }
  return null;
}

export function getRegenerateQueue() {
  const manifest = loadManifest();
  const queue = [];
  for (const [regionId, region] of Object.entries(manifest.regions)) {
    for (const asset of region.assets) {
      if (asset.status === 'completed' && (!asset.generationMethod || asset.generationMethod === 'procedural')) {
        queue.push({ regionId, asset });
      }
    }
  }
  return queue;
}

// ── Main Generation (strategy pattern) ───────────────────────────────────────

/**
 * Generate one asset. Priority: Hunyuan3D (free) → Hyper3D → Sketchfab → procedural.
 * @param {Object} [opts] - Options
 * @param {string} [opts.assetId] - Specific asset ID to generate (for regeneration)
 */
export async function generateOneAsset(opts = {}) {
  const next = opts.assetId
    ? getAssetById(opts.assetId)
    : getNextPendingAsset();

  if (!next) {
    log.info('No pending assets in manifest');
    return { success: false, error: 'no_pending_assets' };
  }

  const { regionId, region, asset } = next;
  const manifest = loadManifest();

  log.info({ assetId: asset.id, region: regionId, name: asset.name }, 'Starting asset generation');
  updateAssetStatus(asset.id, 'in_progress', { startedAt: Date.now() });

  try {
    // 1. Clear scene
    await clearBlenderScene();

    // 1b. Set up environment lighting (HDRI or 3-point fallback)
    await applyHdriLighting();

    // 2. Check available generators
    const avail = await checkGeneratorAvailability();

    // 3. Try strategies: Tripo3D (free) → Hunyuan3D → Hyper3D → Sketchfab → procedural
    let genResult = null;
    let method = 'procedural';

    if (avail.tripo3d) {
      try {
        genResult = await generateViaTripo(asset, region, regionId);
        method = 'tripo3d';
      } catch (err) {
        log.warn({ assetId: asset.id, err: err.message }, 'Tripo3D failed, trying next');
      }
    }

    if (!genResult && avail.hunyuan3d) {
      try {
        genResult = await generateViaHunyuan3d(asset, region, regionId);
        method = 'hunyuan3d';
      } catch (err) {
        log.warn({ assetId: asset.id, err: err.message }, 'Hunyuan3D failed, trying next');
      }
    }

    if (!genResult && avail.hyper3d) {
      try {
        genResult = await generateViaHyper3d(asset, region, regionId);
        method = 'hyper3d';
      } catch (err) {
        log.warn({ assetId: asset.id, err: err.message }, 'Hyper3D failed, trying fallback');
      }
    }

    if (!genResult && avail.sketchfab) {
      try {
        genResult = await generateViaSketchfab(asset, region, regionId);
        method = 'sketchfab';
      } catch (err) {
        log.warn({ assetId: asset.id, err: err.message }, 'Sketchfab failed, using procedural');
      }
    }

    // Claude sculpting — universal AI fallback before bare procedural
    if (!genResult) {
      try {
        const { generateViaClaudeSculpt } = await import('./claude-sculpt.js');
        const sculptPrompt = buildAIPrompt(asset, region);
        const result = await generateViaClaudeSculpt(sculptPrompt, asset.id, {
          model: 'sonnet',
          maxRetries: 2,
          style: 'dark fantasy, stylized, game-ready',
          palette: region?.palette,
        });
        genResult = result;
        method = 'claude-sculpt';
        log.info({ assetId: asset.id, costUsd: result.costUsd, faces: result.faces }, 'Claude sculpt succeeded');
      } catch (err) {
        log.warn({ assetId: asset.id, err: err.message }, 'Claude sculpt failed, using procedural');
      }
    }

    if (!genResult) {
      // Procedural fallback (last resort)
      const blenderCode = buildAssetCode(asset, region, regionId, manifest);
      await callTool('blender-mcp', 'execute_blender_code', { code: blenderCode }, 60_000);
      method = 'procedural';
    }

    log.info({ assetId: asset.id, method }, 'Generation method used');

    // 4. Post-import adjustments for AI models
    if (method !== 'procedural') {
      await postImportAdjustments(asset);
      await applySimpleAnimation(asset);
    }
    // (Procedural code already has animation baked into buildAssetCode)

    // 4b. Apply PolyHaven PBR texture (both AI and procedural benefit)
    let textureApplied = false;
    try {
      textureApplied = await applyPolyHavenTexture(asset);
    } catch (err) {
      log.warn({ assetId: asset.id, err: err.message }, 'PolyHaven texture step failed (continuing)');
    }

    // 4c. Capture viewport screenshot for quality tracking
    await captureViewportScreenshot(asset, regionId);

    // 5. Export FBX
    const outputPath = await exportAssetFbx(asset.id, regionId);

    // 6. Update manifest
    const animated = hasAnimation(asset);
    updateAssetStatus(asset.id, 'completed', {
      completedAt: Date.now(),
      outputPath: `Meshes/${regionId}/${asset.id}.fbx`,
      animated,
      animationType: animated ? 'loop_60f_30fps' : 'static',
      generationMethod: method,
      textureApplied,
      textureCategory: textureApplied ? guessTextureCategory(asset) : null,
      ...(genResult?.prompt && { prompt: genResult.prompt }),
    });

    log.info({ assetId: asset.id, outputPath, method, animated }, 'Asset generation complete');
    return { success: true, assetId: asset.id, outputPath, method, animated };

  } catch (err) {
    log.error({ assetId: asset.id, err: err.message }, 'Asset generation failed');
    updateAssetStatus(asset.id, 'failed', {
      failedAt: Date.now(),
      error: err.message,
    });
    return { success: false, assetId: asset.id, error: err.message };
  }
}

/**
 * Regenerate one previously-completed procedural asset with AI generation.
 */
export async function regenerateOneAsset() {
  const queue = getRegenerateQueue();
  if (queue.length === 0) return { success: false, error: 'no_procedural_assets_to_regenerate' };

  const { asset } = queue[0];
  log.info({ assetId: asset.id, queueSize: queue.length }, 'Regenerating procedural asset with AI');

  updateAssetStatus(asset.id, 'pending', {
    previousMethod: asset.generationMethod || 'procedural',
    regenerating: true,
  });

  return generateOneAsset({ assetId: asset.id });
}

// ── Batch Generation ─────────────────────────────────────────────────────────

/**
 * Generate multiple assets in a single cycle. Processes up to `count` pending
 * assets sequentially (each one goes through Hyper3D → Sketchfab → procedural).
 */
export async function generateBatchAssets(count = 3) {
  const results = { completed: [], failed: [], skipped: 0 };
  for (let i = 0; i < count; i++) {
    const next = getNextPendingAsset();
    if (!next) { results.skipped = count - i; break; }
    try {
      const result = await generateOneAsset();
      if (result.success) results.completed.push(result.assetId || next.asset.id);
      else results.failed.push({ id: next.asset.id, error: result.error });
    } catch (err) {
      results.failed.push({ id: next.asset.id, error: err.message });
      log.warn({ err: err.message, asset: next.asset.id }, 'Batch asset generation failed');
    }
  }
  log.info({ completed: results.completed.length, failed: results.failed.length }, 'Batch asset generation done');
  return results;
}

// ── Region-Specific Batch Generation ──────────────────────────────────────────

/**
 * Generate pending assets from a specific region only.
 * Useful for targeting milestone-specific assets (e.g. "Shared" region for ms_9).
 * @param {string} regionId - Region name (e.g. "Shared", "CrossroadsHub")
 * @param {number} [count=6] - Max assets to generate
 */
export async function generateRegionBatch(regionId, count = 6) {
  const manifest = loadManifest();
  const region = manifest.regions[regionId];
  if (!region) {
    return { success: false, error: `Region "${regionId}" not found in manifest` };
  }

  const pendingAssets = region.assets.filter(a => a.status === 'pending');
  if (pendingAssets.length === 0) {
    return { success: true, completed: [], failed: [], skipped: 0, message: `No pending assets in ${regionId}` };
  }

  const toGenerate = pendingAssets.slice(0, count);
  log.info({ regionId, total: pendingAssets.length, generating: toGenerate.length }, 'Starting region batch generation');

  const results = { completed: [], failed: [], skipped: pendingAssets.length - toGenerate.length };
  for (const asset of toGenerate) {
    try {
      const result = await generateOneAsset({ assetId: asset.id });
      if (result.success) results.completed.push(result.assetId || asset.id);
      else results.failed.push({ id: asset.id, error: result.error });
    } catch (err) {
      results.failed.push({ id: asset.id, error: err.message });
      log.warn({ err: err.message, asset: asset.id }, 'Region batch asset generation failed');
    }
  }

  log.info({ regionId, completed: results.completed.length, failed: results.failed.length }, 'Region batch generation done');
  return results;
}

// ── Status & Brief Builders ───────────────────────────────────────────────────

export function getStatusReport() {
  const progress = getProgress();
  const next = getNextPendingAsset();
  return {
    ...progress,
    percent: progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0,
    nextAsset: next ? `${next.asset.name} (${next.regionId})` : 'none',
  };
}

export function manifestExists() {
  return existsSync(MANIFEST_PATH);
}

export function buildAssetGenerationBrief(signal) {
  const d = signal.data;
  return {
    title: `3D Asset Generation — ${d.pct}% complete`,
    content: `3D asset pipeline: ${d.completed}/${d.total} assets done (${d.pending} pending, ${d.failed} failed).
Next: "${d.nextAssetName}" in region ${d.nextRegion}.

**ACTION REQUIRED — GENERATE ASSETS NOW via Blender MCP.**

**Strategy (try in order):**
1. \`generate_hyper3d_model_via_text\` — best quality, AI-generated mesh + materials
2. \`generate_asset_batch\` or \`generate_asset\` — uses built-in pipeline (enhanced PBR materials, modifiers, smooth shading already built in)

**After generating geometry, ENHANCE with PolyHaven textures:**
1. \`search_polyhaven_assets\` — search for matching PBR texture (e.g. type="textures", categories="rock" for stone assets, "wood" for wooden, "metal" for metallic)
2. \`download_polyhaven_asset\` — download at 1k resolution
3. \`set_texture\` — apply to the generated object

This adds real PBR textures (diffuse + roughness + normal maps) on top of geometry — massive quality boost.

**If using execute_blender_code directly**, the pipeline already applies:
- PBR materials with noise-driven roughness variation + Voronoi bump mapping
- Subdivision Surface (level 2) for organic assets, Bevel for hard-surface
- Displacement modifier for rocks/terrain/organic shapes
- Smooth shading on all meshes
- Auto-decimate to keep under 15K faces

Generate 3-6 assets this cycle. Export each as FBX to workspace/shattered-crown/Assets/Meshes/{region}/`,
    reasoning: `3D pipeline has ${d.pending} pending assets. Built-in PBR materials + modifiers are active. Add PolyHaven textures for best quality.`,
  };
}

export function buildAssetRegenerationBrief(signal) {
  const d = signal.data;
  return {
    title: `Asset Quality Upgrade — ${d.procedural} old-style assets to upgrade`,
    content: `${d.total} assets exist but ${d.procedural} were made with flat-colored primitives (old pipeline, no PBR, no modifiers).

**ACTION REQUIRED — UPGRADE ASSET QUALITY:**
1. Pick a hero asset (wayshrine, gate, boss arena) — they matter most
2. Clear Blender scene, regenerate with \`generate_asset\` (now has PBR materials + modifiers built in)
3. Then apply a PolyHaven PBR texture: \`search_polyhaven_assets\` → \`download_polyhaven_asset\` → \`set_texture\`
4. Take a \`get_viewport_screenshot\` to verify quality
5. Export FBX, overwriting the old file

The new pipeline has: noise-driven roughness, Voronoi bump mapping, subdivision/bevel modifiers, smooth shading, auto-decimate. Much better than the old flat-color output.`,
    reasoning: `${d.procedural} assets still use old flat materials. Regenerate with enhanced PBR pipeline + PolyHaven textures.`,
  };
}
