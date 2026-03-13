/**
 * blender-knowledge.js
 *
 * Reusable Blender Python patterns the agent can inject when executing
 * execute_blender_code via BlenderMCP. Import these snippets into prompts
 * or stitch them into generated code.
 *
 * Usage (in agent-brain / skill code):
 *   const { getBlenderPreamble, PATTERNS } = require('./blender-knowledge');
 *   const code = getBlenderPreamble() + '\n' + yourCode;
 */

'use strict';

// ── Preamble ──────────────────────────────────────────────────────────────────
// Always inject this at the top of any execute_blender_code call that creates
// or modifies geometry. Provides helpers used by all patterns below.
const PREAMBLE = `
import bpy, math, mathutils, random

def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for col in list(bpy.data.collections): bpy.data.collections.remove(col)

def active_set(obj):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)

def apply_smooth(obj, angle_deg=70):
    active_set(obj)
    bpy.ops.object.shade_smooth()
    obj.data.use_auto_smooth = True
    obj.data.auto_smooth_angle = math.radians(angle_deg)

def add_subsurf(obj, levels=1, render=2):
    mod = obj.modifiers.new("SubDiv", 'SUBSURF')
    mod.levels = levels
    mod.render_levels = render
    return mod

def add_bevel(obj, amount=0.02, segments=2):
    mod = obj.modifiers.new("Bevel", 'BEVEL')
    mod.width = amount
    mod.segments = segments
    return mod
`;

// ── Material Patterns ─────────────────────────────────────────────────────────
const MATERIALS = {

  // Generic PBR surface. color = (r,g,b,a), roughness 0-1, metallic 0-1.
  pbr: (name, color = [0.5, 0.5, 0.5, 1], roughness = 0.7, metallic = 0.0) => `
def make_pbr(name, color, roughness=${roughness}, metallic=${metallic}):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat
mat_${name} = make_pbr("${name}", ${JSON.stringify(color)})
`,

  // Stone/rock material — rough, bump-mapped, warm grey.
  stone: (name = 'stone') => `
def make_stone(name):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.52, 0.48, 0.44, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.88
    bsdf.inputs["Metallic"].default_value = 0.0
    # Noise bump
    tex = nodes.new('ShaderNodeTexNoise')
    tex.inputs['Scale'].default_value = 12.0
    tex.inputs['Detail'].default_value = 8.0
    tex.inputs['Roughness'].default_value = 0.7
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.4
    links.new(tex.outputs['Fac'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return mat
mat_${name} = make_stone("${name}")
`,

  // Metal material — polished or worn.
  metal: (name = 'metal', worn = false) => `
def make_metal(name, worn=${worn}):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.70, 0.65, 0.55, 1.0)
    bsdf.inputs["Metallic"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = 0.55 if worn else 0.15
    if worn:
        noise = nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 20.0
        ramp = nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].position = 0.4
        links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
        links.new(ramp.outputs['Color'], bsdf.inputs['Roughness'])
    return mat
mat_${name} = make_metal("${name}")
`,

  // Emissive / magical glow.
  emissive: (name = 'glow', color = [0.2, 0.6, 1.0, 1], strength = 5) => `
def make_emissive(name, color, strength):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Emission Color"].default_value = color
    bsdf.inputs["Emission Strength"].default_value = strength
    bsdf.inputs["Roughness"].default_value = 0.2
    return mat
mat_${name} = make_emissive("${name}", ${JSON.stringify(color)}, ${strength})
`,

  // Wood — warm grain, moderate roughness.
  wood: (name = 'wood') => `
def make_wood(name):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.75
    # Wave texture for grain
    wave = nodes.new('ShaderNodeTexWave')
    wave.wave_type = 'RINGS'
    wave.inputs['Scale'].default_value = 6.0
    wave.inputs['Distortion'].default_value = 2.5
    wave.inputs['Detail'].default_value = 6.0
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (0.35, 0.22, 0.12, 1.0)
    ramp.color_ramp.elements[1].color = (0.60, 0.40, 0.22, 1.0)
    links.new(wave.outputs['Color'], ramp.inputs['Fac'])
    links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    return mat
mat_${name} = make_wood("${name}")
`,
};

// ── Lighting Presets ──────────────────────────────────────────────────────────
const LIGHTING = {

  // Three-point studio: key, fill, rim.
  studio: `
def setup_studio_lights():
    for obj in bpy.data.objects:
        if obj.type == 'LIGHT': bpy.data.objects.remove(obj)
    lights = [
        ("Key",  (5, -5, 8),  'AREA', 800, (1.0, 0.98, 0.95)),
        ("Fill", (-8, 2, 4),  'AREA', 200, (0.85, 0.90, 1.0)),
        ("Rim",  (0, 8, 6),   'SPOT', 400, (1.0, 0.95, 0.80)),
    ]
    for name, loc, ltype, energy, col in lights:
        bpy.ops.object.light_add(type=ltype, location=loc)
        l = bpy.context.object
        l.name = name
        l.data.energy = energy
        l.data.color = col[:3]
    # Face key light toward origin
    bpy.data.objects["Key"].rotation_euler = (-0.8, 0, 0.8)
setup_studio_lights()
`,

  // Fantasy/dungeon: warm torchlight + cool ambient.
  fantasy: `
def setup_fantasy_lights():
    for obj in bpy.data.objects:
        if obj.type == 'LIGHT': bpy.data.objects.remove(obj)
    # Warm torch point
    bpy.ops.object.light_add(type='POINT', location=(3, -2, 4))
    key = bpy.context.object; key.name = "Torch"
    key.data.energy = 600; key.data.color = (1.0, 0.65, 0.25)
    key.data.shadow_soft_size = 0.5
    # Cool fill
    bpy.ops.object.light_add(type='AREA', location=(-5, 5, 6))
    fill = bpy.context.object; fill.name = "AmbFill"
    fill.data.energy = 120; fill.data.color = (0.4, 0.5, 0.8)
    fill.data.size = 6.0
    # World: dark dungeon
    world = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg: bg.inputs["Strength"].default_value = 0.05
setup_fantasy_lights()
`,

  // Outdoor: bright sun + sky blue ambient.
  outdoor: `
def setup_outdoor_lights():
    for obj in bpy.data.objects:
        if obj.type == 'LIGHT': bpy.data.objects.remove(obj)
    bpy.ops.object.light_add(type='SUN', location=(0, 0, 20))
    sun = bpy.context.object; sun.name = "Sun"
    sun.data.energy = 3.0
    sun.data.color = (1.0, 0.97, 0.88)
    sun.rotation_euler = (0.6, 0, -0.8)
    world = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.35, 0.55, 0.9, 1.0)
        bg.inputs["Strength"].default_value = 0.8
setup_outdoor_lights()
`,
};

// ── Modifier Patterns ─────────────────────────────────────────────────────────
const MODIFIERS = {

  // Make a low-poly mesh look smooth and rounded.
  smoothRounded: `
# Apply to active object: bevel edges + subdivision + smooth shading
obj = bpy.context.active_object
if obj and obj.type == 'MESH':
    bev = obj.modifiers.new("Bevel", 'BEVEL')
    bev.width = 0.03; bev.segments = 2; bev.limit_method = 'ANGLE'; bev.angle_limit = 0.78
    sub = obj.modifiers.new("SubDiv", 'SUBSURF')
    sub.levels = 2; sub.render_levels = 3
    bpy.ops.object.shade_smooth()
    obj.data.use_auto_smooth = True
    obj.data.auto_smooth_angle = math.radians(70)
`,

  // Solidify a flat plane into a thick panel.
  solidify: (thickness = 0.05) => `
obj = bpy.context.active_object
if obj and obj.type == 'MESH':
    sol = obj.modifiers.new("Solidify", 'SOLIDIFY')
    sol.thickness = ${thickness}
    sol.offset = -1.0
`,

  // Decimate for performance (reduce poly count).
  decimate: (ratio = 0.5) => `
obj = bpy.context.active_object
if obj and obj.type == 'MESH':
    dec = obj.modifiers.new("Decimate", 'DECIMATE')
    dec.ratio = ${ratio}
`,
};

// ── Camera Presets ────────────────────────────────────────────────────────────
const CAMERA = {

  // Set up a camera looking at origin from a good angle.
  hero: `
bpy.ops.object.camera_add(location=(7, -7, 5))
cam = bpy.context.object
cam.name = "HeroCam"
cam.data.lens = 50
cam.rotation_euler = (math.radians(60), 0, math.radians(45))
bpy.context.scene.camera = cam
`,
};

// ── Compositor: quick filmic grade ───────────────────────────────────────────
const COMPOSITOR = `
# Enable compositor + add glare + slight vignette
bpy.context.scene.use_nodes = True
tree = bpy.context.scene.node_tree
rl = tree.nodes.get("Render Layers") or tree.nodes.new("CompositorNodeRLayers")
comp = tree.nodes.get("Composite") or tree.nodes.new("CompositorNodeComposite")

glare = tree.nodes.new("CompositorNodeGlare")
glare.glare_type = 'FOG_GLOW'
glare.threshold = 0.8
glare.size = 7
glare.mix = 0.05

lens = tree.nodes.new("CompositorNodeLensdist")
lens.inputs["Distort"].default_value = -0.02

tree.links.new(rl.outputs["Image"], glare.inputs["Image"])
tree.links.new(glare.outputs["Image"], lens.inputs["Image"])
tree.links.new(lens.outputs["Image"], comp.inputs["Image"])
`;

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Returns the preamble Python snippet to inject at the top of any Blender code.
 */
function getBlenderPreamble() {
  return PREAMBLE;
}

/**
 * Build a complete Blender script for a quick hero render setup.
 * @param {'studio'|'fantasy'|'outdoor'} lightPreset
 */
function buildRenderSetup(lightPreset = 'studio') {
  const light = LIGHTING[lightPreset] || LIGHTING.studio;
  return [PREAMBLE, light, CAMERA.hero].join('\n');
}

/**
 * Get a quick hint string for the agent brain to inject into prompts.
 * Describes available Blender aesthetic capabilities.
 */
function getBlenderCapabilitiesHint() {
  return `
## Blender Aesthetic Capabilities
When generating or modifying 3D assets via execute_blender_code, you have access to:

**Materials** (lib/blender-knowledge.js):
- make_pbr(name, color, roughness, metallic) — generic PBR
- make_stone(name) — rough bump-mapped stone
- make_metal(name, worn) — metallic with optional wear
- make_emissive(name, color, strength) — glowing/magical
- make_wood(name) — procedural wood grain

**Lighting presets**:
- setup_studio_lights() — three-point: key/fill/rim
- setup_fantasy_lights() — warm torch + cool ambient
- setup_outdoor_lights() — sun + blue sky world

**Modifiers**:
- Bevel + SubDiv + smooth shading → rounded, polished look
- Solidify → thick panels from flat planes
- Decimate → reduce poly count for perf

**Always** call apply_smooth(obj) on any mesh you create.
**Always** assign a material — bare grey mesh looks bad.
**For game assets**: roughness 0.6-0.85, no perfect mirrors (metallic+roughness<0.1).
`.trim();
}

module.exports = {
  PREAMBLE,
  MATERIALS,
  LIGHTING,
  MODIFIERS,
  CAMERA,
  COMPOSITOR,
  getBlenderPreamble,
  buildRenderSetup,
  getBlenderCapabilitiesHint,
};
