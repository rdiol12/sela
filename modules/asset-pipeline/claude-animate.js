/**
 * modules/asset-pipeline/claude-animate.js — Claude-as-Animator.
 *
 * Calls Claude to write Blender Python keyframe code that animates rigged models.
 * Works with any armature — Claude inspects bone names/hierarchy and writes
 * appropriate animation (idle, walk, attack, etc.).
 */

import { chatOneShot } from '../../lib/claude.js';
import { callTool } from '../../lib/mcp-gateway.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('claude-animate');

// ── System Prompt ────────────────────────────────────────────────────────────

const ANIMATE_SYSTEM_PROMPT = `You are a Blender Python animation expert. You write complete keyframe animation scripts for rigged 3D models.

## CRITICAL RULES
1. Output ONLY a Python code block (\`\`\`python ... \`\`\`). No explanations before or after.
2. The script must be fully self-contained. Import everything at the top.
3. These variables will be pre-defined: ARMATURE_NAME, BONE_INFO, ANIM_TYPE, FRAME_COUNT
4. Do NOT print ANIM_OK yourself — the wrapper handles validation.

## How Blender Keyframe Animation Works

\`\`\`python
import bpy
from math import sin, cos, pi, radians

# Get armature and enter pose mode
armature = bpy.data.objects[ARMATURE_NAME]
bpy.context.view_layer.objects.active = armature
bpy.ops.object.mode_set(mode='POSE')

# Set frame range
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = FRAME_COUNT

# Create or get an action
action_name = f"{ARMATURE_NAME}_{ANIM_TYPE}"
if action_name in bpy.data.actions:
    action = bpy.data.actions[action_name]
else:
    action = bpy.data.actions.new(name=action_name)
armature.animation_data_create()
armature.animation_data.action = action

# Keyframe a bone
bone = armature.pose.bones["bone_name"]
bone.rotation_mode = 'XYZ'  # ALWAYS set this first

# At frame 1
bone.rotation_euler = (radians(10), 0, 0)
bone.keyframe_insert(data_path="rotation_euler", frame=1)

# At frame 30
bone.rotation_euler = (radians(-10), 0, 0)
bone.keyframe_insert(data_path="rotation_euler", frame=30)

# For location animation (root motion)
bone.location = (0, 0, 0.1)
bone.keyframe_insert(data_path="location", frame=1)
\`\`\`

## Animation Types and Techniques

### Idle / Breathing
- Subtle chest/torso bone Y-rotation oscillation (±2-5°), period ~60 frames
- Slight head bone sway (±1-3°)
- Use sin() wave: angle = amplitude * sin(2*pi * frame / period)
- Optional slight vertical bob on root/hips bone

### Walk Cycle (looping)
- Alternate leg bones forward/back (±25-35° hip rotation)
- Counter-swing arms (opposite to legs, ±20°)
- Slight torso twist (±5°) synced with legs
- Vertical bob on hips/root bone (up at mid-stride)
- Period: ~30-40 frames per full cycle

### Attack / Swing
- Wind-up phase (frames 1-15): pull arm/weapon back
- Strike phase (frames 15-25): fast forward swing
- Recovery phase (frames 25-40): return to rest
- Use ease-in/ease-out by spacing keyframes (slow at extremes, fast in middle)
- Add torso twist for power feel

### Fly / Hover (winged creatures)
- Wing bones: large rotation oscillation (±30-60°)
- Downstroke faster than upstroke (more keyframes on down)
- Body slight vertical bob (counter to wings)
- Tail gentle wave (phase offset from wings)

### Quadruped Walk
- Diagonal pairs move together (front-left + rear-right)
- Each leg: lift → forward → plant → push back
- Spine undulation wave, slight head bob
- Period: ~30 frames

## Important Rules
- ALWAYS set bone.rotation_mode = 'XYZ' before using rotation_euler
- Access bones via armature.pose.bones["name"] (use exact bone names from BONE_INFO)
- Use rotation_euler for rotations, location for translations
- Make looping animations: last frame should match first frame
- Keep rotations small and realistic (most joints: ±5-45°)
- If bone names are generic (bone_0, bone_1...), infer purpose from hierarchy:
  - Root bone (no parent) = hips/pelvis
  - Its children = spine/legs
  - Long chains = limbs (3 bones = upper/lower/foot)
  - Short branches off spine = arms/wings/tail
- Return to OBJECT mode at the end
- Handle missing bones gracefully with try/except

## Bone Hierarchy Analysis
When given BONE_INFO (JSON with bone names, parents, positions), analyze the skeleton:
1. Find the root bone (parent=None) — this is the center/hips
2. Trace chains downward — legs are chains pointing down from root
3. Trace chains upward — spine/chest/head go up from root
4. Branches off upper spine — arms (or wings if 4+ children)
5. Chain behind root going back — tail

## Blender 5.x Compatibility
- We are running Blender 5.0+. The keyframe insertion API is unchanged:
  bone.keyframe_insert(data_path="rotation_euler", frame=N) still works normally.
- Do NOT try to access action.fcurves directly — Blender 5.x uses layered actions.
  Reading fcurves (if needed): action.layers[0].strips[0].channelbags[0].fcurves
- Do NOT create actions manually. Just call keyframe_insert() and Blender auto-creates everything.
- SceneEEVEE has NO use_ssr, use_gtao, use_bloom — do NOT set these.

## Quality Checklist
- Smooth curves (at least 3-4 keyframes per movement arc)
- Looping: frame 1 pose = frame FRAME_COUNT pose
- All animated bones have rotation_mode = 'XYZ'
- No extreme rotations (keep under ±90° per axis)
- Easing: tighter keyframe spacing at motion extremes`;

// ── Code Extraction ─────────────────────────────────────────────────────────

function extractPythonCode(reply) {
  const pyFenced = reply.match(/```python\n([\s\S]*?)```/);
  if (pyFenced) return pyFenced[1].trim();

  const anyFenced = reply.match(/```\n?([\s\S]*?)```/);
  if (anyFenced) return anyFenced[1].trim();

  const trimmed = reply.trim();
  if (trimmed.startsWith('import bpy') || trimmed.startsWith('import ')) {
    return trimmed;
  }

  throw new Error('Claude response did not contain extractable Python code');
}

// ── Safety Wrapper ──────────────────────────────────────────────────────────

function wrapWithSafety(code, armatureName, animType) {
  const cleaned = code.replace(/print\s*\(\s*f?['"]\s*ANIM_OK.*/g, '# (validation handled by wrapper)');
  const indented = cleaned.split('\n').map(line => '    ' + line).join('\n');
  const safeName = armatureName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const safeType = animType.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  return `
import bpy
import traceback

ARMATURE_NAME = "${safeName}"
ANIM_TYPE = "${safeType}"
_anim_error = None

try:
${indented}
except Exception as e:
    _anim_error = str(e)
    print(f"ANIM_ERROR:{ARMATURE_NAME}:{e}")
    traceback.print_exc()

# ── Ensure we're back in object mode ──
try:
    bpy.ops.object.mode_set(mode='OBJECT')
except:
    pass

# ── Validation ──
if _anim_error is None:
    arm = bpy.data.objects.get("${safeName}")
    if arm and arm.animation_data and arm.animation_data.action:
        action = arm.animation_data.action
        # Blender 5.x layered actions: fcurves are in layers[0].strips[0].channelbags[0].fcurves
        try:
            fcurves = list(action.layers[0].strips[0].channelbags[0].fcurves)
        except (IndexError, AttributeError):
            # Fallback for legacy actions
            try:
                fcurves = list(action.fcurves)
            except:
                fcurves = []
        num_curves = len(fcurves)
        num_keyframes = sum(len(fc.keyframe_points) for fc in fcurves)
        print(f"ANIM_OK:{ARMATURE_NAME}:{num_curves}:{num_keyframes}")
    else:
        print(f"ANIM_ERROR:{ARMATURE_NAME}:No animation data created on armature")
`;
}

// ── Bone Info Gatherer ──────────────────────────────────────────────────────

/**
 * Get bone hierarchy info from a Blender armature via MCP.
 * Returns JSON string with bone names, parents, head/tail positions.
 */
async function getBoneInfo(armatureName) {
  const code = `
import bpy, json

arm = bpy.data.objects.get("${armatureName}")
if not arm or arm.type != 'ARMATURE':
    print("BONE_INFO_ERROR: Armature not found")
else:
    bones = []
    for bone in arm.data.bones:
        bones.append({
            "name": bone.name,
            "parent": bone.parent.name if bone.parent else None,
            "head": [round(v, 4) for v in bone.head_local],
            "tail": [round(v, 4) for v in bone.tail_local],
            "length": round(bone.length, 4),
            "children": [c.name for c in bone.children],
        })
    print("BONE_INFO_JSON:" + json.dumps(bones))
`;

  const result = await callTool('blender-mcp', 'execute_blender_code', { code }, 30_000);
  const match = result?.match(/BONE_INFO_JSON:(.*)/);
  if (!match) throw new Error(`Failed to get bone info: ${result?.slice(0, 200)}`);
  return match[1];
}

// ── Core Animation ──────────────────────────────────────────────────────────

/**
 * Animate a rigged model by asking Claude to write Blender keyframe code.
 *
 * @param {string} armatureName - Name of the armature object in Blender
 * @param {string} animType - Animation type: 'idle', 'walk', 'attack', 'fly', 'custom'
 * @param {object} [opts]
 * @param {string} [opts.description] - Custom animation description
 * @param {number} [opts.frameCount] - Total frames (default 60)
 * @param {string} [opts.model] - Claude model (default 'sonnet')
 * @param {number} [opts.maxRetries] - Max retries (default 2)
 * @returns {Promise<{ method: string, costUsd: number, fcurves: number, keyframes: number }>}
 */
export async function animateViaClaudeAnimator(armatureName, animType, opts = {}) {
  const model = opts.model || 'sonnet';
  const maxRetries = opts.maxRetries ?? 2;
  const frameCount = opts.frameCount || 60;
  const description = opts.description || '';

  // Step 1: Get bone info from Blender
  let boneInfoJson;
  try {
    boneInfoJson = await getBoneInfo(armatureName);
  } catch (err) {
    throw new Error(`Cannot read armature "${armatureName}": ${err.message}`);
  }

  const boneInfo = JSON.parse(boneInfoJson);
  const boneCount = boneInfo.length;
  const rootBone = boneInfo.find(b => !b.parent);

  log.info({ armatureName, animType, boneCount, rootBone: rootBone?.name }, 'Claude animate: starting');

  let lastError = null;
  let totalCost = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let userPrompt = [
      `ARMATURE_NAME = "${armatureName}"`,
      `ANIM_TYPE = "${animType}"`,
      `FRAME_COUNT = ${frameCount}`,
      `BONE_INFO = ${JSON.stringify(boneInfoJson)}`,
      '',
      `The armature has ${boneCount} bones. Root bone: "${rootBone?.name || 'unknown'}".`,
      `Bone names: ${boneInfo.map(b => b.name).join(', ')}`,
      '',
      `Create a ${animType} animation for this rigged character.`,
    ];

    if (description) {
      userPrompt.push(`Additional description: ${description}`);
    }

    if (animType === 'idle') {
      userPrompt.push('Make a subtle breathing/idle loop. Gentle torso sway, slight head movement.');
    } else if (animType === 'walk') {
      userPrompt.push('Make a walk cycle loop. Alternate legs, counter-swing arms, hip bob.');
    } else if (animType === 'attack') {
      userPrompt.push('Make a melee attack: wind-up, strike, recovery. Not looping.');
    } else if (animType === 'fly') {
      userPrompt.push('Make a flying/hovering loop. Wing flaps, body bob, tail sway.');
    }

    if (attempt > 0 && lastError) {
      userPrompt.push(`\n## PREVIOUS ATTEMPT FAILED\nBlender error: ${lastError}\nFix the error and regenerate the COMPLETE script.`);
    }

    const fullPrompt = ANIMATE_SYSTEM_PROMPT + '\n\n' + userPrompt.join('\n');

    log.info({ animType, armatureName, model, attempt }, 'Claude animate: generating code');

    let reply, costUsd;
    try {
      const result = await chatOneShot(fullPrompt, null, model);
      reply = result.reply;
      costUsd = result.costUsd || 0;
      totalCost += costUsd;
    } catch (err) {
      log.error({ err: err.message, attempt }, 'Claude animate: chatOneShot failed');
      lastError = `Claude API error: ${err.message}`;
      continue;
    }

    let code;
    try {
      code = extractPythonCode(reply);
    } catch (err) {
      log.warn({ attempt, replyLen: reply?.length }, 'Claude animate: code extraction failed');
      lastError = 'Could not extract Python code from Claude response';
      continue;
    }

    const wrapped = wrapWithSafety(code, armatureName, animType);

    log.info({ armatureName, attempt, codeLength: code.length }, 'Claude animate: executing in Blender');

    let execResult;
    try {
      execResult = await callTool('blender-mcp', 'execute_blender_code', {
        code: wrapped,
      }, 60_000);
    } catch (err) {
      log.warn({ attempt, err: err.message }, 'Claude animate: Blender execution threw');
      lastError = `Blender execution error: ${err.message}`;
      continue;
    }

    if (execResult && execResult.includes('ANIM_OK')) {
      const match = execResult.match(/ANIM_OK:[^:]+:(\d+):(\d+)/);
      const fcurves = match ? parseInt(match[1]) : 0;
      const keyframes = match ? parseInt(match[2]) : 0;

      log.info({ armatureName, animType, fcurves, keyframes, costUsd: totalCost, attempt },
        'Claude animate: SUCCESS');

      return {
        method: 'claude-animate',
        costUsd: totalCost,
        codeLength: code.length,
        fcurves,
        keyframes,
        frameCount,
      };
    }

    const errMatch = execResult?.match(/ANIM_ERROR:[^:]+:(.*)/);
    lastError = errMatch?.[1]?.trim() || execResult?.slice(0, 400) || 'Unknown Blender error';
    log.warn({ attempt, lastError: lastError.slice(0, 200), armatureName }, 'Claude animate: attempt failed');
  }

  throw new Error(`Claude animate failed after ${maxRetries + 1} attempts: ${lastError}`);
}
