/**
 * modules/asset-pipeline/claude-sculpt.js — Claude-as-3D-sculptor.
 *
 * Calls Claude to write Blender Python code that builds 3D models.
 * Used when all external AI generators (Hyper3D, Tripo, Sketchfab) are unavailable.
 */

import { chatOneShot } from '../../lib/claude.js';
import { callTool } from '../../lib/mcp-gateway.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('claude-sculpt');

// ── System Prompt ────────────────────────────────────────────────────────────

const SCULPT_SYSTEM_PROMPT = `You are a Blender Python expert. You write complete, self-contained scripts that create 3D models in Blender 5.x.

## CRITICAL RULES
1. Output ONLY a Python code block (\`\`\`python ... \`\`\`). No explanations before or after.
2. The script must be fully self-contained. Import everything at the top.
3. The variable ASSET_NAME will be pre-defined before your code runs — use it to name objects.
4. Do NOT print SCULPT_OK yourself — the wrapper handles validation automatically.

## Imports You Can Use
import bpy, bmesh, math, random
from mathutils import Vector, Matrix, Euler, noise

## Helper — always define this at the top
def make_mat(name, color, roughness=0.7, metallic=0.0, emission=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 3.0
    return mat

## Geometry Techniques (choose based on subject)

### Organic shapes (creatures, rocks, trees)
- Create base: bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
- Noise displacement: for v in bm.verts: v.co += v.normal * noise.fractal(v.co * scale, 1.0, 2.0, 4) * strength
- Convert: bm.to_mesh(mesh); bm.free()
- Add Subdivision Surface modifier (levels=1, render_levels=2)

### Wings / membranes / fins
- Build as a bmesh GRID (not separate planes): bmesh.ops.create_grid(bm, x_segments=8, y_segments=5, size=2.0)
- Shape by moving verts: outer edge verts spread into fan, curve downward for droop
- Add Subdivision Surface (2 levels) for smooth membrane
- For bat-wings: create 3-4 spar bones (tapered cones) and a grid membrane between them
- Use Solidify modifier (thickness=0.02) so wings aren't paper-thin

### Characters / humanoids / soldiers
- Torso: scaled cube or cylinder, slightly tapered
- Head: UV sphere, add helmet/armor as separate objects
- Limbs: tapered cylinders positioned at body, NOT extruded (simpler and more reliable)
- Hands: small cubes or spheres (don't model fingers — stylized is fine)
- Armor plates: slightly larger scaled duplicates of body parts with metallic material
- Weapons: cylinders + cubes with boolean DIFFERENCE for blade edges
- Mirror modifier (use_axis=(True, False, False)) for symmetry on the main body
- Assemble by positioning objects, not by complex mesh operations

### Hard-surface (weapons, buildings, vehicles, furniture)
- Start with cubes/cylinders
- Boolean modifier (DIFFERENCE) for cutouts, windows, details
- Bevel modifier (width=0.02, segments=2) for edge definition
- Array modifier for repeated elements (teeth, spikes, bricks, windows)

### Crystals / magical objects
- Elongated icosphere with random vertex displacement
- Emissive material (Emission Strength 2-5)
- Cluster by duplicating + rotating

## Blender 5.x Compatibility
- SceneEEVEE has NO use_ssr, use_gtao, use_bloom attributes — do NOT set these
- Use try/except for ANY eevee/scene attribute that might not exist
- shade_smooth: select object first, make active, then bpy.ops.object.shade_smooth()
- Always call bm.verts.ensure_lookup_table() before indexing bm.verts[i]

## Important constraints
- Keep total polygon count under 15000 faces
- Center the model at world origin, bottom at Z=0 (resting on ground)
- Call bpy.ops.object.shade_smooth() on each mesh object
- Name the MAIN object using ASSET_NAME (sub-parts can use ASSET_NAME + suffix)
- Wrap risky operations (modifier_apply, boolean) in try/except
- Do NOT use bpy.ops.sculpt or bpy.ops.gpencil (require special context)
- For vertex colors use mesh.color_attributes.new() not mesh.vertex_colors.new()
- Do NOT call bpy.ops.object.select_all inside a bmesh block — finish bmesh first

## Quality checklist
- 3+ different materials per model (body, accent, detail colors)
- Noise displacement on organic surfaces (strength 0.05-0.2)
- Subdivision Surface on curved objects
- Multiple separate objects assembled into a coherent model
- Detail objects (spikes, horns, plates, gems, eyes) to break up silhouette
- Slight random variation in repeated elements (size ±10%, rotation ±5°)`;

// ── Code Extraction ─────────────────────────────────────────────────────────

function extractPythonCode(reply) {
  // Try fenced Python block
  const pyFenced = reply.match(/```python\n([\s\S]*?)```/);
  if (pyFenced) return pyFenced[1].trim();

  // Try any fenced block
  const anyFenced = reply.match(/```\n?([\s\S]*?)```/);
  if (anyFenced) return anyFenced[1].trim();

  // If reply starts with import, treat as bare code
  const trimmed = reply.trim();
  if (trimmed.startsWith('import bpy') || trimmed.startsWith('import bmesh')) {
    return trimmed;
  }

  throw new Error('Claude response did not contain extractable Python code');
}

// ── Safety Wrapper ──────────────────────────────────────────────────────────

function wrapWithSafety(code, name) {
  // Strip any SCULPT_OK prints the model code may include (wrapper handles this)
  const cleaned = code.replace(/print\s*\(\s*f?['"]\s*SCULPT_OK.*/g, '# (validation handled by wrapper)');
  const indented = cleaned.split('\n').map(line => '    ' + line).join('\n');

  // Sanitize name for Python string (escape quotes/backslashes)
  const safeName = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  return `
import bpy
import traceback

ASSET_NAME = "${safeName}"
_sculpt_error = None

try:
${indented}
except Exception as e:
    _sculpt_error = str(e)
    print(f"SCULPT_ERROR:{ASSET_NAME}:{e}")
    traceback.print_exc()

# ── Validation (runs after user code) ──
if _sculpt_error is None:
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    if meshes:
        total_faces = sum(len(o.data.polygons) for o in meshes)
        print(f"SCULPT_OK:{ASSET_NAME}:{total_faces}")
    else:
        print(f"SCULPT_ERROR:{ASSET_NAME}:No meshes created")
`;
}

// ── Core Generation ─────────────────────────────────────────────────────────

/**
 * Generate a 3D model by asking Claude to write Blender Python code.
 *
 * @param {string} prompt - What to create ("a fire-breathing dragon")
 * @param {string} name - Sanitized object name
 * @param {object} [opts]
 * @param {string} [opts.style] - Style hint ("dark fantasy", "stylized")
 * @param {string} [opts.model] - Claude model ('sonnet'|'opus'|'haiku')
 * @param {number} [opts.maxRetries] - Max retries on failure (default 2)
 * @returns {Promise<{ method: string, costUsd: number, codeLength: number }>}
 */
export async function generateViaClaudeSculpt(prompt, name, opts = {}) {
  const model = opts.model || 'sonnet';
  const maxRetries = opts.maxRetries ?? 2;
  const style = opts.style || 'detailed, game-ready, stylized';

  let lastError = null;
  let totalCost = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Build user prompt
    let userPrompt = `ASSET_NAME = "${name}"\nCreate a 3D model of: ${prompt}\nStyle: ${style}`;

    if (opts.palette && opts.palette.length > 0) {
      userPrompt += `\nColor palette: ${opts.palette.join(', ')}`;
    }

    if (attempt > 0 && lastError) {
      userPrompt += `\n\n## PREVIOUS ATTEMPT FAILED\nBlender error: ${lastError}\nFix the error and regenerate the COMPLETE script. Do not reference the old script — write it fresh.`;
    }

    const fullPrompt = SCULPT_SYSTEM_PROMPT + '\n\n' + userPrompt;

    log.info({ prompt, name, model, attempt }, 'Claude sculpt: generating code');

    let reply, costUsd;
    try {
      const result = await chatOneShot(fullPrompt, null, model);
      reply = result.reply;
      costUsd = result.costUsd || 0;
      totalCost += costUsd;
    } catch (err) {
      log.error({ err: err.message, attempt }, 'Claude sculpt: chatOneShot failed');
      lastError = `Claude API error: ${err.message}`;
      continue;
    }

    // Extract Python code
    let code;
    try {
      code = extractPythonCode(reply);
    } catch (err) {
      log.warn({ attempt, replyLen: reply?.length }, 'Claude sculpt: code extraction failed');
      lastError = 'Could not extract Python code from Claude response';
      continue;
    }

    // Wrap and execute
    const wrapped = wrapWithSafety(code, name);

    log.info({ name, attempt, codeLength: code.length }, 'Claude sculpt: executing in Blender');

    let execResult;
    try {
      execResult = await callTool('blender-mcp', 'execute_blender_code', {
        code: wrapped,
      }, 90_000); // 90s — complex sculpting can take time
    } catch (err) {
      log.warn({ attempt, err: err.message }, 'Claude sculpt: Blender execution threw');
      lastError = `Blender execution error: ${err.message}`;
      continue;
    }

    // Check result
    if (execResult && execResult.includes('SCULPT_OK')) {
      const faceMatch = execResult.match(/SCULPT_OK:[^:]+:(\d+)/);
      const faces = faceMatch ? parseInt(faceMatch[1]) : 0;

      log.info({ name, faces, costUsd: totalCost, attempt, codeLength: code.length },
        'Claude sculpt: SUCCESS');

      return {
        method: 'claude-sculpt',
        costUsd: totalCost,
        codeLength: code.length,
        faces,
      };
    }

    // Extract error for retry
    const errMatch = execResult?.match(/SCULPT_ERROR:[^:]+:(.*)/);
    lastError = errMatch?.[1]?.trim() || execResult?.slice(0, 400) || 'Unknown Blender error';
    log.warn({ attempt, lastError: lastError.slice(0, 200), name }, 'Claude sculpt: attempt failed');
  }

  throw new Error(`Claude sculpt failed after ${maxRetries + 1} attempts: ${lastError}`);
}
