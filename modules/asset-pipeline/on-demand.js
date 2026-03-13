/**
 * modules/asset-pipeline/on-demand.js — Freeform on-demand 3D generation.
 *
 * Registered tool: create_3d
 * User says "make me a dragon" on WhatsApp → generates 3D model → renders PNG → sends back.
 * Strategy: Hyper3D AI → Sketchfab search → error.
 */

import { callTool } from '../../lib/mcp-gateway.js';
import { registerTool } from '../../lib/tool-bridge.js';
import { mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import config from '../../lib/config.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('on-demand-3d');
import { clearBlenderScene, ensureHyper3dKey, checkGeneratorAvailability, sleep } from './pipeline.js';

// ── Constants ────────────────────────────────────────────────────────────────

const RENDER_DIR = join(config.workspaceDir, '3d-renders');
const POLL_INTERVAL = 10_000;  // 10s
const MAX_POLL_TIME = 5 * 60_000;  // 5 min
const OVERALL_TIMEOUT = 5.5 * 60_000;  // 5.5 min absolute max

// Ensure render directory exists
try { mkdirSync(RENDER_DIR, { recursive: true }); } catch {}

// ── Tool Registration ────────────────────────────────────────────────────────

registerTool({
  name: 'create_3d',
  description: 'Generate a 3D model from any text description, render it in Blender, and save a PNG image. Returns { success, renderPath, method, prompt }. After calling, use [SEND_FILE: <renderPath>] to send the rendered image to the user on WhatsApp. Params: prompt (string, required) — describe what to create, e.g. "a dragon", "medieval house", "glowing crystal sword".',
  async execute(params) {
    return generateOnDemand(params);
  },
}, { rateLimit: 30_000 });

// ── Prompt Builder ───────────────────────────────────────────────────────────

function buildFreeformPrompt(userText) {
  let prompt = userText
    .replace(/^(make|create|generate|build|show|render|design|model)\s+(me\s+)?(a|an|the)?\s*/i, '')
    .trim();
  if (!prompt) prompt = userText.trim();
  return `${prompt}, high quality 3D model, detailed PBR textures, game-ready asset`.slice(0, 300);
}

function sanitizeName(prompt) {
  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30) || 'model';
}

// ── Studio Scene Setup ───────────────────────────────────────────────────────

async function setupStudioScene() {
  await callTool('blender-mcp', 'execute_blender_code', {
    code: `
import bpy
import math

# ═══ World: smooth 3-stop gradient (dark floor → mid → bright top) ═══
world = bpy.data.worlds.get('World') or bpy.data.worlds.new('World')
bpy.context.scene.world = world
world.use_nodes = True
wnt = world.node_tree
for n in list(wnt.nodes):
    wnt.nodes.remove(n)

tc = wnt.nodes.new('ShaderNodeTexCoord'); tc.location = (-800, 0)
sep = wnt.nodes.new('ShaderNodeSeparateXYZ'); sep.location = (-600, 0)
wnt.links.new(tc.outputs['Generated'], sep.inputs['Vector'])

# Power curve for smoother gradient transition
pow_node = wnt.nodes.new('ShaderNodeMath'); pow_node.location = (-400, 0)
pow_node.operation = 'POWER'
pow_node.inputs[1].default_value = 1.5
wnt.links.new(sep.outputs['Z'], pow_node.inputs[0])

ramp = wnt.nodes.new('ShaderNodeValToRGB'); ramp.location = (-200, 0)
ramp.color_ramp.interpolation = 'B_SPLINE'
ramp.color_ramp.elements[0].position = 0.0
ramp.color_ramp.elements[0].color = (0.012, 0.015, 0.025, 1.0)
e1 = ramp.color_ramp.elements.new(0.35)
e1.color = (0.04, 0.045, 0.065, 1.0)
ramp.color_ramp.elements[1].position = 0.75
ramp.color_ramp.elements[1].color = (0.10, 0.11, 0.14, 1.0)
wnt.links.new(pow_node.outputs['Value'], ramp.inputs['Fac'])

bg = wnt.nodes.new('ShaderNodeBackground'); bg.location = (100, 0)
bg.inputs['Strength'].default_value = 0.8
wnt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
out = wnt.nodes.new('ShaderNodeOutputWorld'); out.location = (300, 0)
wnt.links.new(bg.outputs['Background'], out.inputs['Surface'])

# ═══ Key Light: large soft area (warm, high angle) ═══
bpy.ops.object.light_add(type='AREA', location=(4.5, -3.5, 6.5))
key = bpy.context.object; key.name = "Studio_Key"
key.data.energy = 250; key.data.color = (1.0, 0.95, 0.88)
key.data.size = 5.0
if hasattr(key.data, 'shape'):
    key.data.shape = 'RECTANGLE'; key.data.size_y = 2.5
key.rotation_euler = (math.radians(55), math.radians(5), math.radians(30))
if hasattr(key.data, 'use_contact_shadow'):
    key.data.use_contact_shadow = True
    if hasattr(key.data, 'contact_shadow_distance'):
        key.data.contact_shadow_distance = 0.3

# ═══ Fill Light: cool, very soft (opposite side) ═══
bpy.ops.object.light_add(type='AREA', location=(-5.5, 3.5, 4))
fill = bpy.context.object; fill.name = "Studio_Fill"
fill.data.energy = 100; fill.data.color = (0.82, 0.88, 1.0); fill.data.size = 7.0
fill.rotation_euler = (math.radians(45), math.radians(-10), math.radians(150))

# ═══ Rim Light: dramatic backlight edge highlight ═══
bpy.ops.object.light_add(type='AREA', location=(1, 6, 5.5))
rim = bpy.context.object; rim.name = "Studio_Rim"
rim.data.energy = 180; rim.data.color = (0.92, 0.90, 1.0); rim.data.size = 3.5
rim.rotation_euler = (math.radians(25), 0, math.radians(175))

# ═══ Accent Light: subtle colored kick from below/side ═══
bpy.ops.object.light_add(type='AREA', location=(-3, -4, 1.5))
accent = bpy.context.object; accent.name = "Studio_Accent"
accent.data.energy = 40; accent.data.color = (0.75, 0.85, 1.0); accent.data.size = 2.0
accent.rotation_euler = (math.radians(75), math.radians(15), math.radians(-45))

# ═══ Ground plane with reflective gradient (product-shot look) ═══
bpy.ops.mesh.primitive_plane_add(size=25, location=(0, 0, -0.01))
ground = bpy.context.object; ground.name = "Studio_Ground"
mat = bpy.data.materials.new("Studio_Ground_Mat")
mat.use_nodes = True
nodes = mat.node_tree.nodes; links = mat.node_tree.links
for n in list(nodes):
    nodes.remove(n)

# Gradient: center reflective fading to dark edges
bsdf = nodes.new('ShaderNodeBsdfPrincipled'); bsdf.location = (300, 0)
output = nodes.new('ShaderNodeOutputMaterial'); output.location = (600, 0)
links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])

tc2 = nodes.new('ShaderNodeTexCoord'); tc2.location = (-600, 0)
sep2 = nodes.new('ShaderNodeSeparateXYZ'); sep2.location = (-400, 0)
links.new(tc2.outputs['Object'], sep2.inputs['Vector'])

# Distance from center for vignette
pow_x = nodes.new('ShaderNodeMath'); pow_x.location = (-200, 100); pow_x.operation = 'POWER'; pow_x.inputs[1].default_value = 2.0
pow_y = nodes.new('ShaderNodeMath'); pow_y.location = (-200, -100); pow_y.operation = 'POWER'; pow_y.inputs[1].default_value = 2.0
links.new(sep2.outputs['X'], pow_x.inputs[0])
links.new(sep2.outputs['Y'], pow_y.inputs[0])
add = nodes.new('ShaderNodeMath'); add.location = (-50, 0); add.operation = 'ADD'
links.new(pow_x.outputs['Value'], add.inputs[0])
links.new(pow_y.outputs['Value'], add.inputs[1])

gramp = nodes.new('ShaderNodeMapRange'); gramp.location = (100, -200)
gramp.inputs['From Min'].default_value = 0.0
gramp.inputs['From Max'].default_value = 4.0
gramp.inputs['To Min'].default_value = 0.03
gramp.inputs['To Max'].default_value = 0.015
links.new(add.outputs['Value'], gramp.inputs['Value'])
links.new(gramp.outputs['Result'], bsdf.inputs['Base Color'])

bsdf.inputs['Roughness'].default_value = 0.35
bsdf.inputs['Metallic'].default_value = 0.0
if 'Specular IOR Level' in bsdf.inputs:
    bsdf.inputs['Specular IOR Level'].default_value = 0.6
elif 'Specular' in bsdf.inputs:
    bsdf.inputs['Specular'].default_value = 0.6

ground.data.materials.append(mat)

# ═══ EEVEE Configuration ═══
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
eevee = scene.eevee

# High-quality sampling
if hasattr(eevee, 'taa_render_samples'):
    eevee.taa_render_samples = 192
    eevee.taa_samples = 48

# Screen Space Reflections (essential for ground reflection)
if hasattr(eevee, 'use_ssr'):
    eevee.use_ssr = True
    eevee.use_ssr_refraction = True
    eevee.ssr_quality = 0.75
    eevee.ssr_max_roughness = 0.6
    eevee.ssr_thickness = 0.1

# Ambient Occlusion — contact darkening
if hasattr(eevee, 'use_gtao'):
    eevee.use_gtao = True
    eevee.gtao_distance = 0.4
    eevee.gtao_factor = 1.5

# Bloom — subtle glow on bright areas
if hasattr(eevee, 'use_bloom'):
    eevee.use_bloom = True
    eevee.bloom_threshold = 0.7
    eevee.bloom_knee = 0.5
    eevee.bloom_radius = 6.5
    eevee.bloom_intensity = 0.06

# High-res shadows
if hasattr(eevee, 'shadow_cube_size'):
    eevee.shadow_cube_size = '2048'
if hasattr(eevee, 'shadow_cascade_size'):
    eevee.shadow_cascade_size = '2048'
if hasattr(eevee, 'use_soft_shadows'):
    eevee.use_soft_shadows = True

# Color Management — AgX with punchy contrast
try:
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = 0.2
    scene.view_settings.gamma = 1.05
except:
    try:
        scene.view_settings.view_transform = 'Filmic'
        scene.view_settings.look = 'High Contrast'
    except:
        pass

print("Studio scene v2 + EEVEE configured")
`,
  }, 15_000);
}

// ── Hyper3D Freeform Generation ──────────────────────────────────────────────

function parseSubmitResponse(text) {
  if (!text) return null;
  const subKey = text.match(/subscription_key[:\s"']*([a-zA-Z0-9_-]+)/i);
  const reqId = text.match(/request_id[:\s"']*([a-zA-Z0-9_-]+)/i);
  const taskUuid = text.match(/task_uuid[:\s"']*([a-zA-Z0-9_-]+)/i);
  if (subKey) return { subscription_key: subKey[1], task_uuid: taskUuid?.[1] };
  if (reqId) return { request_id: reqId[1] };
  return null;
}

function parsePollResponse(text) {
  if (!text) return { done: false, failed: false };
  const lower = text.toLowerCase();
  if (lower.includes('"done"') || lower.includes('completed') || lower.includes('status: done')) {
    return { done: true };
  }
  if (lower.includes('failed') || lower.includes('canceled') || lower.includes('error')) {
    return { failed: true };
  }
  return { done: false, failed: false };
}

async function generateFreeformHyper3d(prompt, name) {
  await ensureHyper3dKey();

  log.info({ prompt, name }, 'OnDemand: Hyper3D submitting');
  const genResult = await callTool('blender-mcp', 'generate_hyper3d_model_via_text', {
    text_prompt: prompt,
  }, 120_000);

  const parsed = parseSubmitResponse(genResult);
  if (!parsed) throw new Error(`Hyper3D submit failed: ${genResult?.slice(0, 200)}`);

  log.info({ name, ...parsed }, 'OnDemand: Hyper3D job submitted, polling');

  const pollStart = Date.now();
  while (Date.now() - pollStart < MAX_POLL_TIME) {
    await sleep(POLL_INTERVAL);

    const pollArgs = parsed.subscription_key
      ? { subscription_key: parsed.subscription_key }
      : { request_id: parsed.request_id };

    const pollResult = await callTool('blender-mcp', 'poll_rodin_job_status', pollArgs, 30_000);
    const status = parsePollResponse(pollResult);

    log.info({ name, done: status.done, failed: status.failed, elapsed: Date.now() - pollStart }, 'OnDemand: Hyper3D poll');

    if (status.done) break;
    if (status.failed) throw new Error(`Hyper3D generation failed: ${pollResult?.slice(0, 200)}`);
  }

  if (Date.now() - pollStart >= MAX_POLL_TIME) {
    throw new Error('Hyper3D generation timed out (5 min)');
  }

  // Import into Blender
  const importArgs = { name };
  if (parsed.task_uuid) importArgs.task_uuid = parsed.task_uuid;
  if (parsed.request_id) importArgs.request_id = parsed.request_id;

  await callTool('blender-mcp', 'import_generated_asset', importArgs, 60_000);
  log.info({ name }, 'OnDemand: Hyper3D model imported');
  return 'hyper3d';
}

// ── Sketchfab Freeform Generation ────────────────────────────────────────────

async function generateFreeformSketchfab(prompt, name) {
  log.info({ prompt, name }, 'OnDemand: Sketchfab searching');

  const searchResult = await callTool('blender-mcp', 'search_sketchfab_models', {
    query: prompt,
    downloadable: true,
    count: 5,
  }, 30_000);

  const uidMatch = searchResult?.match(/UID:\s*([a-f0-9]+)/i) || searchResult?.match(/uid[:\s"']*([a-f0-9]{20,})/i);
  const uid = uidMatch?.[1];
  if (!uid) throw new Error(`No Sketchfab results for "${prompt}"`);

  await callTool('blender-mcp', 'download_sketchfab_model', {
    uid,
    target_size: 1.0,
  }, 120_000);

  log.info({ name, uid }, 'OnDemand: Sketchfab model downloaded');
  return 'sketchfab';
}

// ── PolyHaven Model Search ────────────────────────────────────────────────────

// Keywords that map well to PolyHaven's catalog of 409 CC0 models
const POLYHAVEN_KEYWORDS = {
  rock: 'rocks', boulder: 'rocks', stone: 'rocks', cliff: 'rocks', mountain: 'rocks',
  tree: 'trees', plant: 'plants', flower: 'flowers', bush: 'plants', grass: 'grass',
  chair: 'seating', bench: 'seating', sofa: 'seating', stool: 'seating',
  table: 'table', desk: 'table',
  lamp: 'lighting', lantern: 'lighting', light: 'lighting',
  book: 'books', shelf: 'shelves',
  vase: 'vases', pot: 'vases',
  building: 'buildings', house: 'buildings', structure: 'structures',
  camera: 'props', tool: 'tools', drill: 'tools',
  ship: 'ships', boat: 'ships',
  food: 'food', fruit: 'food',
  container: 'containers', box: 'containers', crate: 'containers',
  sword: 'props', katana: 'props', weapon: 'props',
};

async function generateFreeformPolyHaven(prompt, name) {
  const words = prompt.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);

  // Find a matching category from the prompt
  let matchedCategory = null;
  for (const word of words) {
    if (POLYHAVEN_KEYWORDS[word]) {
      matchedCategory = POLYHAVEN_KEYWORDS[word];
      break;
    }
  }

  if (!matchedCategory) {
    throw new Error(`No PolyHaven category matches "${prompt}"`);
  }

  log.info({ prompt, matchedCategory, name }, 'OnDemand: searching PolyHaven models');

  const searchResult = await callTool('blender-mcp', 'search_polyhaven_assets', {
    asset_type: 'models',
    categories: matchedCategory,
  }, 15_000);

  if (!searchResult || searchResult.includes('Found 0')) {
    throw new Error(`No PolyHaven models in category "${matchedCategory}"`);
  }

  // Parse first model ID from results (format: "Name (ID: some_id)")
  const idMatch = searchResult.match(/\(ID:\s*([a-zA-Z0-9_]+)\)/);
  if (!idMatch) {
    throw new Error(`Could not parse PolyHaven model ID from results`);
  }

  const modelId = idMatch[1];
  log.info({ modelId, matchedCategory, name }, 'OnDemand: downloading PolyHaven model');

  const dlResult = await callTool('blender-mcp', 'download_polyhaven_asset', {
    asset_id: modelId,
    asset_type: 'models',
    resolution: '1k',
    file_format: 'gltf',
  }, 60_000);

  if (!dlResult || dlResult.toLowerCase().includes('error') || dlResult.toLowerCase().includes('failed')) {
    throw new Error(`PolyHaven download failed: ${dlResult?.slice(0, 200)}`);
  }

  log.info({ name, modelId }, 'OnDemand: PolyHaven model imported');
  return 'polyhaven';
}

// ── Post-Import Cleanup + Material Enhancement ──────────────────────────────

async function postImportCleanup(name) {
  await callTool('blender-mcp', 'execute_blender_code', {
    code: `
import bpy, mathutils

meshes = [o for o in bpy.data.objects if o.type == 'MESH' and not o.name.startswith('Studio_')]
if not meshes:
    print("No meshes to cleanup")
else:
    # ── Center at origin ──
    bpy.ops.object.select_all(action='DESELECT')
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    # Center average location to world origin
    avg = sum((o.location for o in meshes), mathutils.Vector()) / len(meshes)
    for o in meshes:
        o.location -= avg

    # ── Smooth shade ──
    for obj in meshes:
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.ops.object.shade_smooth()
        if hasattr(obj.data, 'use_auto_smooth'):
            obj.data.use_auto_smooth = True
            obj.data.auto_smooth_angle = 1.22  # ~70 degrees

    # ── Rename ──
    for i, obj in enumerate(meshes):
        if len(meshes) == 1:
            obj.name = "${name}"
        else:
            obj.name = f"${name}_part_{i}"

    # ── Material Enhancement ──
    for obj in meshes:
        for slot in obj.material_slots:
            mat = slot.material
            if mat is None:
                # No material → assign neutral PBR
                mat = bpy.data.materials.new(name=f"${name}_pbr")
                mat.use_nodes = True
                bsdf = mat.node_tree.nodes.get("Principled BSDF")
                if bsdf:
                    bsdf.inputs["Base Color"].default_value = (0.5, 0.48, 0.44, 1.0)
                    bsdf.inputs["Roughness"].default_value = 0.65
                    bsdf.inputs["Metallic"].default_value = 0.0
                slot.material = mat
                continue
            if not mat.use_nodes:
                old_color = mat.diffuse_color[:] if hasattr(mat, 'diffuse_color') else (0.5, 0.5, 0.5, 1.0)
                mat.use_nodes = True
                bsdf = mat.node_tree.nodes.get("Principled BSDF")
                if bsdf:
                    bsdf.inputs["Base Color"].default_value = old_color
                    bsdf.inputs["Roughness"].default_value = 0.65
                continue

            # Existing nodes → enhance
            bsdf = mat.node_tree.nodes.get("Principled BSDF")
            if not bsdf:
                continue
            nodes = mat.node_tree.nodes
            links = mat.node_tree.links

            # Prevent perfectly smooth (mirror) or perfectly rough (clay)
            rough = bsdf.inputs["Roughness"].default_value
            if rough < 0.08:
                bsdf.inputs["Roughness"].default_value = 0.35
            elif rough > 0.95:
                bsdf.inputs["Roughness"].default_value = 0.85

            # Add micro-surface variation if not already enhanced
            if any(n.name == 'sela_enhance' for n in nodes):
                continue

            # Noise roughness variation (±0.12)
            base_rough = bsdf.inputs["Roughness"].default_value
            tc = nodes.new('ShaderNodeTexCoord'); tc.location = (-800, -300)
            noise = nodes.new('ShaderNodeTexNoise'); noise.name = 'sela_enhance'
            noise.location = (-550, -300)
            noise.inputs['Scale'].default_value = 15.0
            noise.inputs['Detail'].default_value = 8.0
            noise.inputs['Roughness'].default_value = 0.55
            links.new(tc.outputs['Object'], noise.inputs['Vector'])
            rng = nodes.new('ShaderNodeMapRange'); rng.location = (-300, -300)
            rng.inputs['From Min'].default_value = 0.0
            rng.inputs['From Max'].default_value = 1.0
            rng.inputs['To Min'].default_value = max(0.1, base_rough - 0.12)
            rng.inputs['To Max'].default_value = min(1.0, base_rough + 0.12)
            links.new(noise.outputs['Fac'], rng.inputs['Value'])
            for lk in list(links):
                if lk.to_socket == bsdf.inputs['Roughness']:
                    links.remove(lk)
            links.new(rng.outputs['Result'], bsdf.inputs['Roughness'])

            # Voronoi micro-bump for surface detail
            vor = nodes.new('ShaderNodeTexVoronoi'); vor.location = (-550, -600)
            vor.inputs['Scale'].default_value = 25.0
            links.new(tc.outputs['Object'], vor.inputs['Vector'])
            bump = nodes.new('ShaderNodeBump'); bump.location = (-250, -600)
            bump.inputs['Strength'].default_value = 0.12
            links.new(vor.outputs['Distance'], bump.inputs['Height'])
            if bsdf.inputs['Normal'].is_linked:
                old_norm = bsdf.inputs['Normal'].links[0].from_socket
                links.new(old_norm, bump.inputs['Normal'])
            for lk in list(links):
                if lk.to_socket == bsdf.inputs['Normal']:
                    links.remove(lk)
            links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])

    # ── Subdivision for very low-poly models ──
    for obj in meshes:
        pc = len(obj.data.polygons)
        if pc < 400 and not any(m.type == 'SUBSURF' for m in obj.modifiers):
            mod = obj.modifiers.new(name="SubDiv", type='SUBSURF')
            mod.levels = 1; mod.render_levels = 2

    print(f"Cleanup v2 done: {len(meshes)} meshes, materials enhanced")
`,
  }, 30_000);
}

// ── Camera Framing + EEVEE Render ────────────────────────────────────────────

async function frameCameraAndRender(filename) {
  const absPath = resolve(RENDER_DIR, filename).replace(/\\/g, '/');

  const result = await callTool('blender-mcp', 'execute_blender_code', {
    code: `
import bpy
import math
import os
from mathutils import Vector

# ═══ Gather meshes + bounding box ═══
meshes = [o for o in bpy.data.objects if o.type == 'MESH' and not o.name.startswith('Studio_')]
if not meshes:
    raise Exception("No meshes in scene to render")

coords = []
for obj in meshes:
    for corner in obj.bound_box:
        coords.append(obj.matrix_world @ Vector(corner))

bb_min = Vector((min(c[0] for c in coords), min(c[1] for c in coords), min(c[2] for c in coords)))
bb_max = Vector((max(c[0] for c in coords), max(c[1] for c in coords), max(c[2] for c in coords)))
bb_size = bb_max - bb_min
center = (bb_min + bb_max) / 2
max_dim = max(bb_size.x, bb_size.y, bb_size.z, 0.5)
height = bb_size.z

# Aim slightly above center (more visually pleasing)
look_at = center.copy()
look_at.z += height * 0.1

# ═══ Dynamic lens + distance ═══
# Tight framing: longer lens compresses perspective, looks more professional
if max_dim > 4.0:
    lens = 50; dist_mult = 2.0
elif max_dim > 1.5:
    lens = 65; dist_mult = 1.8
else:
    lens = 85; dist_mult = 1.6

# ═══ Camera with 3/4 hero angle ═══
cam_data = bpy.data.cameras.new("OnDemand_Cam")
cam_data.lens = lens
cam_data.clip_start = 0.01
cam_data.clip_end = 500
cam_obj = bpy.data.objects.new("OnDemand_Cam", cam_data)
bpy.context.collection.objects.link(cam_obj)

# 3/4 view: slightly offset for dynamic composition
dist = max_dim * dist_mult
angle_h = math.radians(35)   # horizontal orbit angle
angle_v = math.radians(25)   # elevation angle

cam_obj.location = (
    look_at.x + dist * math.cos(angle_h) * math.cos(angle_v),
    look_at.y - dist * math.sin(angle_h) * math.cos(angle_v),
    look_at.z + dist * math.sin(angle_v)
)

direction = look_at - cam_obj.location
rot_quat = direction.to_track_quat('-Z', 'Y')
cam_obj.rotation_euler = rot_quat.to_euler()
bpy.context.scene.camera = cam_obj

# ═══ Depth of Field — gentle, cinematic ═══
cam_data.dof.use_dof = True
bpy.ops.object.empty_add(location=look_at)
focus_target = bpy.context.object
focus_target.name = "DOF_Target"
focus_target.hide_render = True
cam_data.dof.focus_object = focus_target
cam_data.dof.aperture_fstop = 5.6 if max_dim > 1.0 else 3.5
cam_data.dof.aperture_blades = 6

# ═══ Compositor Pipeline — Blender 5.x safe ═══
scene = bpy.context.scene
scene.use_nodes = True
try:
    tree = scene.node_tree
    if tree:
        for node in list(tree.nodes):
            tree.nodes.remove(node)

        rl = tree.nodes.new('CompositorNodeRLayers'); rl.location = (-500, 300)

        # Glare: subtle fog glow on bright areas
        glare = tree.nodes.new('CompositorNodeGlare'); glare.location = (-200, 300)
        glare.glare_type = 'FOG_GLOW'; glare.quality = 'HIGH'
        glare.mix = -0.95; glare.threshold = 0.7; glare.size = 7
        tree.links.new(rl.outputs['Image'], glare.inputs['Image'])

        # Color balance: warm highlights, cool shadows
        cb = tree.nodes.new('CompositorNodeColorBalance'); cb.location = (100, 300)
        cb.correction_method = 'LIFT_GAMMA_GAIN'
        cb.lift = (0.96, 0.97, 1.03, 1.0)
        cb.gamma = (1.0, 1.0, 1.0, 1.0)
        cb.gain = (1.03, 1.01, 0.98, 1.0)
        tree.links.new(glare.outputs['Image'], cb.inputs['Image'])

        # Vignette: darken edges for focus
        vig_mask = tree.nodes.new('CompositorNodeEllipseMask'); vig_mask.location = (100, 0)
        vig_mask.width = 0.85; vig_mask.height = 0.85
        vig_blur = tree.nodes.new('CompositorNodeBlur'); vig_blur.location = (300, 0)
        vig_blur.size_x = 200; vig_blur.size_y = 200
        tree.links.new(vig_mask.outputs['Mask'], vig_blur.inputs['Image'])
        vig_mix = tree.nodes.new('CompositorNodeMixRGB'); vig_mix.location = (400, 300)
        vig_mix.blend_type = 'MULTIPLY'
        tree.links.new(cb.outputs['Image'], vig_mix.inputs[1])
        tree.links.new(vig_blur.outputs['Image'], vig_mix.inputs[2])
        vig_mix.inputs['Fac'].default_value = 0.3  # subtle vignette

        comp_out = tree.nodes.new('CompositorNodeComposite'); comp_out.location = (650, 300)
        tree.links.new(vig_mix.outputs['Image'], comp_out.inputs['Image'])
except Exception as e:
    print(f"Compositor skipped (non-fatal): {e}")

# ═══ Render settings ═══
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 1280
scene.render.resolution_y = 1280
scene.render.film_transparent = False
scene.render.image_settings.file_format = 'PNG'
if hasattr(scene.render.image_settings, 'compression'):
    scene.render.image_settings.compression = 15

output_path = "${absPath}"
os.makedirs(os.path.dirname(output_path), exist_ok=True)
scene.render.filepath = output_path

bpy.ops.render.render(write_still=True)
size = os.path.getsize(output_path)
print(f"RENDER_OK:{output_path}:{size}")
`,
  }, 120_000);  // 2 min — high quality render

  if (!result || !result.includes('RENDER_OK')) {
    log.warn({ filename, result: result?.slice(0, 200) }, 'OnDemand: EEVEE render failed, trying viewport');
    await callTool('blender-mcp', 'get_viewport_screenshot', { max_size: 1024 }, 15_000);
    throw new Error('EEVEE render failed; viewport screenshot captured but cannot be saved as file');
  }

  return absPath;
}

// ── Main Orchestrator ────────────────────────────────────────────────────────

async function generateOnDemand(params) {
  const userPrompt = (params?.prompt || '').trim();
  if (!userPrompt) {
    return { success: false, error: 'Missing prompt — describe what to create, e.g. "a dragon"' };
  }

  const name = sanitizeName(userPrompt);
  const filename = `${name}_${Date.now()}.png`;
  const aiPrompt = buildFreeformPrompt(userPrompt);

  log.info({ userPrompt, aiPrompt, name, filename }, 'OnDemand: starting generation');

  const timeoutPromise = sleep(OVERALL_TIMEOUT).then(() => {
    throw new Error('On-demand generation timed out (5.5 min)');
  });

  try {
    const result = await Promise.race([
      _doGenerate(name, aiPrompt, filename, userPrompt),
      timeoutPromise,
    ]);
    return result;
  } catch (err) {
    log.error({ err: err.message, userPrompt }, 'OnDemand: generation failed');
    return {
      success: false,
      error: `Could not generate 3D model for "${userPrompt}": ${err.message}. Try again in a few minutes.`,
    };
  }
}

async function _doGenerate(name, aiPrompt, filename, userPrompt) {
  // Step 1: Clear scene
  await clearBlenderScene();

  // Step 2: Setup studio lighting
  await setupStudioScene();

  // Step 3: Generate model — fallback chain
  let method;
  const errors = [];

  // Tier 1: PolyHaven models (free, instant, CC0 — limited catalog)
  try {
    method = await generateFreeformPolyHaven(userPrompt, name);
  } catch (err) {
    errors.push(`PolyHaven: ${err.message}`);
    log.info({ err: err.message }, 'OnDemand: PolyHaven no match, continuing');
  }

  // Tier 2: Sketchfab (1M+ free models, best quality)
  if (!method) {
    const avail = await checkGeneratorAvailability();
    if (avail.sketchfab) {
      try {
        method = await generateFreeformSketchfab(userPrompt, name);
      } catch (err) {
        errors.push(`Sketchfab: ${err.message}`);
        log.warn({ err: err.message }, 'OnDemand: Sketchfab failed');
      }
    }
  }

  // Tier 3: Hyper3D (if available)
  if (!method) {
    const avail = await checkGeneratorAvailability();
    if (avail.hyper3d) {
      try {
        method = await generateFreeformHyper3d(aiPrompt, name);
      } catch (err) {
        errors.push(`Hyper3D: ${err.message}`);
        log.warn({ err: err.message }, 'OnDemand: Hyper3D failed');
      }
    }
  }

  // Tier 4: Claude sculpting (universal — Claude writes Blender Python)
  if (!method) {
    try {
      const { generateViaClaudeSculpt } = await import('./claude-sculpt.js');
      const result = await generateViaClaudeSculpt(userPrompt, name, {
        model: 'sonnet',
        maxRetries: 1, // 1 retry for on-demand (speed matters)
      });
      method = result.method;
      log.info({ costUsd: result.costUsd, faces: result.faces }, 'OnDemand: Claude sculpt succeeded');
    } catch (err) {
      errors.push(`Claude-sculpt: ${err.message}`);
      log.warn({ err: err.message }, 'OnDemand: Claude sculpt failed');
    }
  }

  if (!method) {
    throw new Error(errors.join('; ') || 'All 3D generators failed');
  }

  // Step 4: Post-import cleanup
  await postImportCleanup(name);

  // Step 5: Frame camera and render
  await frameCameraAndRender(filename);

  // Return path relative to workspace (for [SEND_FILE:] marker)
  const renderPath = `3d-renders/${filename}`;

  log.info({ renderPath, method, userPrompt }, 'OnDemand: generation complete');

  return {
    success: true,
    renderPath,
    method,
    prompt: aiPrompt,
  };
}
