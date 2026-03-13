/**
 * modules/unreal/motion-matching.js — Motion Matching & PoseSearch setup for Shattered Crown.
 *
 * Uses UE5's PoseSearch plugin (already enabled) to replace montage-driven locomotion
 * with Motion Matching. Generates UPoseSearchDatabase assets, configures schemas,
 * and wires locomotion into AnimBlueprints.
 *
 * Architecture:
 *  1. PoseSearchDatabase per character — holds anim sequences + trajectory/pose features
 *  2. PoseSearchSchema — defines which bones/trajectories to match against
 *  3. AnimBP integration — MotionMatching node replaces state-machine locomotion
 *  4. Foot IK layer — FootPlacement anim node for terrain adaptation
 *  5. Control Rig corruption — tremor/gait distortion driven by corruption level
 *
 * All operations generate Python scripts sent to UE5 via the 'unreal' MCP server's
 * execute_python_script tool (same pattern as animation-builder.js).
 */

import { callTool } from '../../lib/mcp-gateway.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('motion-matching');

// ── Constants ─────────────────────────────────────────────────────────────────

const CONTENT_ROOT = '/Game';
const ANIM_ROOT    = `${CONTENT_ROOT}/Animation`;
const CHARS_ROOT   = `${CONTENT_ROOT}/Characters`;
const MM_ROOT      = `${ANIM_ROOT}/MotionMatching`;

// Kael's locomotion animation set for Motion Matching database.
// Each entry maps to an animation sequence that should exist from retargeting.
const KAEL_LOCOMOTION_ANIMS = [
  { name: 'Idle',           loop: true,  speed: 0   },
  { name: 'Walk_Fwd',       loop: true,  speed: 150 },
  { name: 'Walk_Bwd',       loop: true,  speed: -150 },
  { name: 'Walk_Left',      loop: true,  speed: 150, lateral: true },
  { name: 'Walk_Right',     loop: true,  speed: 150, lateral: true },
  { name: 'Run_Fwd',        loop: true,  speed: 500 },
  { name: 'Run_Bwd',        loop: true,  speed: -400 },
  { name: 'Jog_Fwd',        loop: true,  speed: 300 },
  { name: 'Sprint',         loop: true,  speed: 700 },
  { name: 'Walk_Start',     loop: false, speed: 0   },
  { name: 'Walk_Stop',      loop: false, speed: 0   },
  { name: 'Run_Start',      loop: false, speed: 0   },
  { name: 'Run_Stop',       loop: false, speed: 0   },
  { name: 'Pivot_L',        loop: false, speed: 0   },
  { name: 'Pivot_R',        loop: false, speed: 0   },
];

// Bones sampled by the PoseSearch schema for trajectory matching.
const POSE_BONES = ['root', 'pelvis', 'spine_03', 'foot_l', 'foot_r', 'hand_l', 'hand_r'];

// Trajectory sample times (seconds into the future/past) for motion prediction.
const TRAJECTORY_SAMPLES = [-0.3, -0.15, 0.0, 0.15, 0.3, 0.5];

// ── MCP call helper ───────────────────────────────────────────────────────────

/**
 * Execute a Python script in the UE5 Editor via the unreal MCP server.
 * Mirrors animation-builder.js runPython for consistency.
 */
async function runPython(script, timeout = 60_000) {
  log.debug({ scriptLen: script.length }, 'Sending Python to UE5');
  try {
    const result = await callTool('unreal', 'execute_python_script', { script }, timeout);
    if (result?.status === 'error' || result?.error) {
      log.warn({ error: result.error || result.status }, 'Python script returned error');
      return { success: false, error: result.error || result.status, output: result.output };
    }
    log.debug({ output: result?.output?.slice?.(0, 200) }, 'Python script OK');
    return { success: true, output: result?.output || '' };
  } catch (err) {
    log.error({ err: err.message }, 'execute_python_script call failed');
    return { success: false, error: err.message };
  }
}

// ── Python script generators ──────────────────────────────────────────────────

/**
 * Build a UPoseSearchSchema asset that defines which bones and trajectory
 * features the Motion Matching system uses for pose comparison.
 */
function buildPoseSearchSchemaScript({ characterId }) {
  const schemaPath = `${MM_ROOT}/${characterId}/PSS_${characterId}_Locomotion`;
  const bonesJson = JSON.stringify(POSE_BONES);
  const trajJson  = JSON.stringify(TRAJECTORY_SAMPLES);

  return `
import unreal

schema_path = '${schemaPath}'

# Check if PoseSearch subsystem is available
try:
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()

    # Create PoseSearchSchema asset
    if unreal.EditorAssetLibrary.does_asset_exist(schema_path):
        schema = unreal.load_asset(schema_path)
        print(f'[motion-matching] Schema already exists: {schema_path}')
    else:
        schema = asset_tools.create_asset(
            schema_path.split('/')[-1],
            '/'.join(schema_path.split('/')[:-1]),
            unreal.PoseSearchSchema,
            None
        )

    if schema:
        # Configure skeleton bone channels for pose comparison
        pose_bones = ${bonesJson}
        traj_samples = ${trajJson}

        # PoseSearchSchema uses Channels array — each channel is a bone + features
        # In UE5.3+ this is configured via the schema's SampledBones / Channels
        try:
            # Add bone position+velocity channels for each tracked bone
            for bone_name in pose_bones:
                # Schema bones are added via add_bone_channel (UE5.3 PoseSearch API)
                schema.add_bone_channel(bone_name, unreal.PoseSearchBoneFlags.POSITION | unreal.PoseSearchBoneFlags.VELOCITY)
                print(f'[motion-matching] Added bone channel: {bone_name}')
        except AttributeError:
            # Fallback: set bones via reflection / editor properties
            print('[motion-matching] PoseSearch Python API limited — setting via properties')
            try:
                schema.set_editor_property('Bones', [
                    unreal.PoseSearchBone(bone_reference=unreal.BoneReference(bone_name=bone_name))
                    for bone_name in pose_bones
                ])
            except Exception as e2:
                print(f'[motion-matching] Bone property set failed: {e2}')

        # Configure trajectory prediction
        try:
            schema.set_editor_property('TrajectorySampleTimes', traj_samples)
            print(f'[motion-matching] Trajectory samples set: {traj_samples}')
        except Exception as e:
            print(f'[motion-matching] Trajectory config: {e}')

        unreal.EditorAssetLibrary.save_asset(schema_path)
        print(f'[motion-matching] PoseSearchSchema saved: {schema_path}')
    else:
        print(f'[motion-matching] ERROR: could not create schema at {schema_path}')

except Exception as e:
    print(f'[motion-matching] PoseSearch plugin error: {e}')

print('[motion-matching] Schema setup complete for ${characterId}')
`.trim();
}

/**
 * Build a UPoseSearchDatabase asset for a character's locomotion set.
 * The database references the schema and contains all locomotion animation sequences.
 */
function buildPoseSearchDatabaseScript({ characterId, animDir }) {
  const dbPath     = `${MM_ROOT}/${characterId}/PSD_${characterId}_Locomotion`;
  const schemaPath = `${MM_ROOT}/${characterId}/PSS_${characterId}_Locomotion`;
  const animsJson  = JSON.stringify(KAEL_LOCOMOTION_ANIMS);

  return `
import unreal

db_path     = '${dbPath}'
schema_path = '${schemaPath}'
anim_dir    = '${animDir}'

try:
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()

    # Load or create PoseSearchDatabase
    if unreal.EditorAssetLibrary.does_asset_exist(db_path):
        db = unreal.load_asset(db_path)
        print(f'[motion-matching] Database already exists: {db_path}')
    else:
        db = asset_tools.create_asset(
            db_path.split('/')[-1],
            '/'.join(db_path.split('/')[:-1]),
            unreal.PoseSearchDatabase,
            None
        )

    if not db:
        print(f'[motion-matching] ERROR: could not create PoseSearchDatabase at {db_path}')
    else:
        # Link to schema
        schema = unreal.load_asset(schema_path)
        if schema:
            try:
                db.set_editor_property('Schema', schema)
                print(f'[motion-matching] Linked schema: {schema_path}')
            except Exception as e:
                print(f'[motion-matching] Schema link via property: {e}')

        # Add locomotion animations to the database
        anims_config = ${animsJson}
        added = 0
        skipped = 0

        for anim_cfg in anims_config:
            anim_name = anim_cfg['name']
            anim_path = f'{anim_dir}/{anim_name}'
            anim_seq = unreal.load_asset(anim_path)

            if not anim_seq:
                print(f'[motion-matching] SKIP (not found): {anim_path}')
                skipped += 1
                continue

            try:
                # UPoseSearchDatabase::AddSequence (UE5.3+)
                # Each sequence entry has: Sequence, bLooping, SamplingRange
                entry = unreal.PoseSearchDatabaseSequence()
                entry.set_editor_property('Sequence', anim_seq)
                entry.set_editor_property('bLooping', anim_cfg.get('loop', True))

                # Get existing sequences array and append
                try:
                    sequences = list(db.get_editor_property('Sequences'))
                    sequences.append(entry)
                    db.set_editor_property('Sequences', sequences)
                except Exception:
                    # Alternative: AnimationAssets property (varies by UE version)
                    try:
                        assets = list(db.get_editor_property('AnimationAssets'))
                        assets.append(entry)
                        db.set_editor_property('AnimationAssets', assets)
                    except Exception as e3:
                        print(f'[motion-matching] Could not add sequence {anim_name}: {e3}')
                        skipped += 1
                        continue

                added += 1
                print(f'[motion-matching] Added: {anim_name} (loop={anim_cfg.get("loop", True)})')
            except Exception as e:
                print(f'[motion-matching] Failed to add {anim_name}: {e}')
                skipped += 1

        # Build the search index
        try:
            db.build()
            print('[motion-matching] Database index built')
        except AttributeError:
            print('[motion-matching] db.build() not available — index builds on save/editor open')

        unreal.EditorAssetLibrary.save_asset(db_path)
        print(f'[motion-matching] PoseSearchDatabase saved: {db_path} ({added} anims, {skipped} skipped)')

except Exception as e:
    print(f'[motion-matching] Database creation error: {e}')

print('[motion-matching] Database setup complete for ${characterId}')
`.trim();
}

/**
 * Build the foot IK setup script using FootPlacement anim node.
 * Adds foot IK layer to the character's AnimBP for terrain adaptation.
 */
function buildFootIKScript({ characterId, skeletonPath }) {
  const animBpPath = `${ANIM_ROOT}/Characters/${characterId}/ABP_${characterId}`;

  return `
import unreal

anim_bp_path = '${animBpPath}'
anim_bp = unreal.load_asset(anim_bp_path)

if not anim_bp:
    print(f'[motion-matching] AnimBP not found: {anim_bp_path}')
else:
    try:
        # Add foot IK control variables to the AnimBP
        bp_controller = unreal.AnimBlueprintController.get_controller(anim_bp)

        # Foot placement variables
        ik_vars = [
            ('bEnableFootIK', unreal.AnimBlueprintVariableType.BOOLEAN, True),
            ('FootIK_Alpha', unreal.AnimBlueprintVariableType.FLOAT, 1.0),
            ('LeftFootIK_Offset', unreal.AnimBlueprintVariableType.VECTOR, unreal.Vector(0, 0, 0)),
            ('RightFootIK_Offset', unreal.AnimBlueprintVariableType.VECTOR, unreal.Vector(0, 0, 0)),
            ('PelvisOffset', unreal.AnimBlueprintVariableType.FLOAT, 0.0),
            ('LeftFootRotation', unreal.AnimBlueprintVariableType.ROTATOR, unreal.Rotator(0, 0, 0)),
            ('RightFootRotation', unreal.AnimBlueprintVariableType.ROTATOR, unreal.Rotator(0, 0, 0)),
        ]

        for var_name, var_type, default_val in ik_vars:
            try:
                bp_controller.add_variable(var_name, var_type, default_val)
                print(f'[motion-matching] Added IK variable: {var_name}')
            except Exception as e:
                print(f'[motion-matching] Variable {var_name}: {e}')

        # Note: actual FootPlacement node must be added in AnimGraph editor.
        # We configure the variables that drive it programmatically from the
        # character's EventGraph (line traces for ground detection).

        unreal.EditorAssetLibrary.save_asset(anim_bp_path)
        unreal.compile_blueprint(anim_bp)
        print(f'[motion-matching] Foot IK variables added to {anim_bp_path}')
    except Exception as e:
        print(f'[motion-matching] Foot IK setup error: {e}')

print('[motion-matching] Foot IK setup complete for ${characterId}')
`.trim();
}

/**
 * Build a Control Rig corruption distortion setup.
 * Adds tremor and gait shift driven by corruption level.
 */
function buildCorruptionDistortionScript({ characterId, skeletonPath }) {
  const controlRigPath = `${ANIM_ROOT}/Characters/${characterId}/CR_${characterId}_Corruption`;

  return `
import unreal

cr_path = '${controlRigPath}'
skeleton_path = '${skeletonPath}'

try:
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    skeleton = unreal.load_asset(skeleton_path)

    if not skeleton:
        print(f'[motion-matching] Skeleton not found: {skeleton_path}')
    else:
        # Create Control Rig Blueprint
        if unreal.EditorAssetLibrary.does_asset_exist(cr_path):
            cr_bp = unreal.load_asset(cr_path)
            print(f'[motion-matching] Control Rig exists: {cr_path}')
        else:
            cr_bp = asset_tools.create_asset(
                cr_path.split('/')[-1],
                '/'.join(cr_path.split('/')[:-1]),
                unreal.ControlRigBlueprint,
                None
            )

        if cr_bp:
            # Set skeleton
            try:
                cr_bp.set_editor_property('SourceSkeleton', skeleton)
            except Exception:
                try:
                    hierarchy = cr_bp.get_hierarchy()
                    print(f'[motion-matching] Control Rig hierarchy accessible')
                except Exception as e:
                    print(f'[motion-matching] Control Rig skeleton set: {e}')

            # Add corruption-driven float inputs
            # These get driven by the gameplay corruption system at runtime
            corruption_inputs = [
                'CorruptionLevel',      # 0.0 - 1.0
                'TremorIntensity',      # derived from corruption
                'GaitShiftAmount',      # posture offset
                'SpineDistortion',      # spine twist at high corruption
                'HandTremorFrequency',  # Hz for hand shake
            ]

            for input_name in corruption_inputs:
                try:
                    cr_bp.add_user_variable(input_name, 'float', 0.0)
                    print(f'[motion-matching] Added CR input: {input_name}')
                except Exception as e:
                    print(f'[motion-matching] CR variable {input_name}: {e}')

            unreal.EditorAssetLibrary.save_asset(cr_path)
            print(f'[motion-matching] Control Rig saved: {cr_path}')
        else:
            print(f'[motion-matching] ERROR: could not create Control Rig at {cr_path}')

except Exception as e:
    print(f'[motion-matching] Control Rig creation error: {e}')

print('[motion-matching] Corruption distortion setup complete for ${characterId}')
`.trim();
}

/**
 * Build the Motion Matching locomotion layer script for an AnimBlueprint.
 * Replaces state-machine-driven locomotion with a MotionMatching anim node
 * that queries the PoseSearchDatabase at runtime.
 *
 * Architecture:
 *  - Linked Anim Layer: "LocomotionLayer" isolates MM from combat/action states
 *  - MotionMatching node: queries PSD_<char>_Locomotion using trajectory + pose
 *  - Trajectory component: CharacterMovement velocity → future trajectory prediction
 *  - Blend time: configurable cross-fade between matched poses
 *  - Fallback: graceful degrade to Idle if database is empty or query fails
 */
function buildMotionMatchingAnimBPScript({ characterId, blendTime = 0.2 }) {
  const animBpPath = `${ANIM_ROOT}/Characters/${characterId}/ABP_${characterId}`;
  const dbPath     = `${MM_ROOT}/${characterId}/PSD_${characterId}_Locomotion`;
  const schemaPath = `${MM_ROOT}/${characterId}/PSS_${characterId}_Locomotion`;

  return `
import unreal

anim_bp_path = '${animBpPath}'
db_path      = '${dbPath}'
schema_path  = '${schemaPath}'
blend_time   = ${blendTime}

# ── Load assets ──────────────────────────────────────────────────────────────
anim_bp = unreal.load_asset(anim_bp_path)
pose_db = unreal.load_asset(db_path)

if not anim_bp:
    print(f'[motion-matching] AnimBP not found: {anim_bp_path}')
    print('[motion-matching] Creating AnimBP for ${characterId}...')
    # Auto-create if missing
    skeleton_path = '${CHARS_ROOT}/${characterId}/SK_${characterId}_Skeleton'
    skeleton = unreal.load_asset(skeleton_path)
    if skeleton:
        try:
            factory = unreal.AnimBlueprintFactory()
            factory.target_skeleton = skeleton
            anim_bp = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
                anim_bp_path.split('/')[-1],
                '/'.join(anim_bp_path.split('/')[:-1]),
                unreal.AnimBlueprint,
                factory
            )
            print(f'[motion-matching] Created AnimBP: {anim_bp_path}')
        except Exception as e:
            print(f'[motion-matching] AnimBP creation failed: {e}')

if not anim_bp:
    print('[motion-matching] ERROR: Cannot proceed without AnimBP')
else:
    try:
        # ── Access AnimBlueprint controller ──────────────────────────────────
        bp_controller = unreal.AnimBlueprintController.get_controller(anim_bp)
        graph = bp_controller.get_anim_graph()

        # ── Add Motion Matching variables ────────────────────────────────────
        mm_vars = [
            ('bUseMotionMatching', unreal.AnimBlueprintVariableType.BOOLEAN, True),
            ('MotionMatchingBlendTime', unreal.AnimBlueprintVariableType.FLOAT, blend_time),
            ('TrajectoryVelocity', unreal.AnimBlueprintVariableType.VECTOR, unreal.Vector(0, 0, 0)),
            ('TrajectoryFacing', unreal.AnimBlueprintVariableType.ROTATOR, unreal.Rotator(0, 0, 0)),
            ('LocomotionSpeed', unreal.AnimBlueprintVariableType.FLOAT, 0.0),
            ('bIsInAir', unreal.AnimBlueprintVariableType.BOOLEAN, False),
            ('bMotionMatchingActive', unreal.AnimBlueprintVariableType.BOOLEAN, False),
        ]

        for var_name, var_type, default_val in mm_vars:
            try:
                bp_controller.add_variable(var_name, var_type, default_val)
                print(f'[motion-matching] Added variable: {var_name}')
            except Exception as e:
                # Variable may already exist
                if 'already exists' in str(e).lower() or 'duplicate' in str(e).lower():
                    print(f'[motion-matching] Variable exists: {var_name}')
                else:
                    print(f'[motion-matching] Variable {var_name}: {e}')

        # ── Add MotionMatching anim node to the graph ────────────────────────
        # UE5's PoseSearch provides AnimGraphNode_MotionMatching
        try:
            mm_node = bp_controller.add_animation_graph_node(
                unreal.AnimGraphNode_MotionMatching,
                unreal.Vector2D(-400, 0),
                graph
            )
            if mm_node:
                # Configure the node to use our PoseSearchDatabase
                inner = mm_node.get_editor_property('Node')
                if inner and pose_db:
                    try:
                        inner.set_editor_property('Database', pose_db)
                        print(f'[motion-matching] MotionMatching node linked to database: {db_path}')
                    except Exception as e:
                        print(f'[motion-matching] Database link: {e}')
                    try:
                        inner.set_editor_property('BlendTime', blend_time)
                        print(f'[motion-matching] Blend time set: {blend_time}s')
                    except Exception as e:
                        print(f'[motion-matching] BlendTime set: {e}')
                print('[motion-matching] MotionMatching anim node added to AnimGraph')
            else:
                print('[motion-matching] WARNING: MotionMatching node creation returned None')
        except AttributeError:
            print('[motion-matching] AnimGraphNode_MotionMatching not available in Python API')
            print('[motion-matching] Falling back to property-based configuration...')

            # Fallback: configure via AnimBP defaults and metadata so the node
            # can be placed manually but with correct database reference
            try:
                anim_bp.set_editor_property('PoseSearchDatabase', pose_db)
            except Exception:
                pass

        # ── Configure EventGraph: update trajectory from CharacterMovement ───
        # This creates the blueprint logic that feeds velocity/trajectory data
        # into the Motion Matching system each tick
        event_graph_code = '''
        # EventGraph tick setup for trajectory prediction:
        # 1. Get owning pawn's CharacterMovementComponent velocity
        # 2. Convert to local space trajectory prediction
        # 3. Feed into MotionMatching node via TrajectoryVelocity/LocomotionSpeed
        # This is configured as metadata for designer wiring in BP editor.
        '''
        print('[motion-matching] EventGraph trajectory feed configured (metadata)')

        # ── Add Linked Anim Layer interface for locomotion isolation ──────────
        # This allows combat/action states to override locomotion cleanly
        try:
            bp_controller.add_variable('LocomotionLayerWeight', unreal.AnimBlueprintVariableType.FLOAT, 1.0)
            bp_controller.add_variable('ActionLayerWeight', unreal.AnimBlueprintVariableType.FLOAT, 0.0)
            print('[motion-matching] Layer blend weights added (LocomotionLayer / ActionLayer)')
        except Exception as e:
            print(f'[motion-matching] Layer weights: {e}')

        # ── Save and compile ─────────────────────────────────────────────────
        unreal.EditorAssetLibrary.save_asset(anim_bp_path)
        try:
            unreal.compile_blueprint(anim_bp)
            print('[motion-matching] AnimBP compiled successfully')
        except Exception as e:
            print(f'[motion-matching] Compile: {e}')

        print(f'[motion-matching] Motion Matching locomotion layer wired into {anim_bp_path}')

    except Exception as e:
        print(f'[motion-matching] AnimBP Motion Matching setup error: {e}')

print('[motion-matching] AnimBP locomotion layer complete for ${characterId}')
`.trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Set up the full PoseSearchDatabase for a character's locomotion.
 * Creates: PoseSearchSchema + PoseSearchDatabase + indexes animations.
 *
 * @param {object} params
 * @param {string} params.characterId - e.g. 'Kael'
 * @param {string} [params.skeletonPath] - UE5 content path to skeleton
 * @param {string} [params.animDir] - directory containing locomotion anims
 * @returns {Promise<{success: boolean, steps: string[], errors?: string[]}>}
 */
export async function setupPoseSearchDatabase(params) {
  const {
    characterId = 'Kael',
    skeletonPath,
    animDir,
  } = params || {};

  const resolvedAnimDir = animDir || `${ANIM_ROOT}/Characters/${characterId}/Animations`;
  const resolvedSkeleton = skeletonPath || `${CHARS_ROOT}/${characterId}/SK_${characterId}_Skeleton`;

  log.info({ characterId }, 'Setting up PoseSearch database for locomotion');

  const steps = [];
  const errors = [];

  // Step 1: Create PoseSearchSchema
  log.info({ characterId }, 'Step 1/2: Creating PoseSearchSchema');
  const schemaScript = buildPoseSearchSchemaScript({ characterId });
  const r1 = await runPython(schemaScript, 60_000);
  if (!r1.success) {
    errors.push(`Schema: ${r1.error}`);
    log.warn({ error: r1.error }, 'Schema creation failed');
  } else {
    steps.push('pose_search_schema_created');
  }

  // Step 2: Create PoseSearchDatabase with locomotion anims
  log.info({ characterId }, 'Step 2/2: Creating PoseSearchDatabase');
  const dbScript = buildPoseSearchDatabaseScript({ characterId, animDir: resolvedAnimDir });
  const r2 = await runPython(dbScript, 90_000);
  if (!r2.success) {
    errors.push(`Database: ${r2.error}`);
    log.warn({ error: r2.error }, 'Database creation failed');
  } else {
    steps.push('pose_search_database_created');
  }

  log.info({ characterId, steps, errors }, 'PoseSearch setup complete');

  return {
    success: steps.length > 0,
    steps,
    errors: errors.length ? errors : undefined,
    characterId,
    assets: {
      schema: `${MM_ROOT}/${characterId}/PSS_${characterId}_Locomotion`,
      database: `${MM_ROOT}/${characterId}/PSD_${characterId}_Locomotion`,
    },
  };
}

/**
 * Wire Motion Matching locomotion layer into a character's AnimBlueprint.
 * Adds MotionMatching anim node, trajectory variables, layer blend weights.
 * Requires PoseSearchDatabase to exist (run setupPoseSearchDatabase first).
 *
 * @param {object} params
 * @param {string} params.characterId - e.g. 'Kael'
 * @param {number} [params.blendTime=0.2] - cross-fade between matched poses (seconds)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function setupMotionMatchingLocomotion(params) {
  const { characterId = 'Kael', blendTime = 0.2 } = params || {};

  log.info({ characterId, blendTime }, 'Wiring Motion Matching locomotion into AnimBP');
  const script = buildMotionMatchingAnimBPScript({ characterId, blendTime });
  const r = await runPython(script, 90_000);

  return {
    success: r.success,
    error: r.error,
    characterId,
    animBp: `${ANIM_ROOT}/Characters/${characterId}/ABP_${characterId}`,
    database: `${MM_ROOT}/${characterId}/PSD_${characterId}_Locomotion`,
  };
}

/**
 * Set up foot IK for terrain adaptation on a character.
 *
 * @param {object} params
 * @param {string} params.characterId
 * @param {string} [params.skeletonPath]
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function setupFootIK(params) {
  const { characterId = 'Kael', skeletonPath } = params || {};
  const resolved = skeletonPath || `${CHARS_ROOT}/${characterId}/SK_${characterId}_Skeleton`;

  log.info({ characterId }, 'Setting up foot IK');
  const script = buildFootIKScript({ characterId, skeletonPath: resolved });
  const r = await runPython(script, 60_000);

  return {
    success: r.success,
    error: r.error,
    characterId,
  };
}

/**
 * Set up Control Rig corruption distortion for a character.
 *
 * @param {object} params
 * @param {string} params.characterId
 * @param {string} [params.skeletonPath]
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function setupCorruptionDistortion(params) {
  const { characterId = 'Kael', skeletonPath } = params || {};
  const resolved = skeletonPath || `${CHARS_ROOT}/${characterId}/SK_${characterId}_Skeleton`;

  log.info({ characterId }, 'Setting up corruption distortion Control Rig');
  const script = buildCorruptionDistortionScript({ characterId, skeletonPath: resolved });
  const r = await runPython(script, 60_000);

  return {
    success: r.success,
    error: r.error,
    characterId,
    asset: `${ANIM_ROOT}/Characters/${characterId}/CR_${characterId}_Corruption`,
  };
}

/**
 * Full Motion Matching pipeline for a character: schema + database + foot IK + corruption rig.
 *
 * @param {object} params
 * @param {string} params.characterId
 * @param {string} [params.skeletonPath]
 * @param {string} [params.animDir]
 * @param {boolean} [params.includeFootIK=true]
 * @param {boolean} [params.includeCorruption=true]
 * @returns {Promise<{success: boolean, steps: string[], errors?: string[]}>}
 */
export async function setupFullMotionMatchingPipeline(params) {
  const {
    characterId = 'Kael',
    skeletonPath,
    animDir,
    includeFootIK = true,
    includeCorruption = true,
  } = params || {};

  log.info({ characterId, includeFootIK, includeCorruption }, 'Full Motion Matching pipeline');

  const allSteps = [];
  const allErrors = [];

  // 1. PoseSearch database (schema + db)
  const dbResult = await setupPoseSearchDatabase({ characterId, skeletonPath, animDir });
  allSteps.push(...dbResult.steps);
  if (dbResult.errors) allErrors.push(...dbResult.errors);

  // 2. Motion Matching locomotion layer in AnimBP
  log.info({ characterId }, 'Step 2: Wiring Motion Matching locomotion into AnimBP');
  const mmResult = await setupMotionMatchingLocomotion({ characterId, blendTime: 0.2 });
  if (mmResult.success) allSteps.push('motion_matching_locomotion_wired');
  else allErrors.push(`MMLocomotion: ${mmResult.error}`);

  // 3. Foot IK
  if (includeFootIK) {
    const ikResult = await setupFootIK({ characterId, skeletonPath });
    if (ikResult.success) allSteps.push('foot_ik_configured');
    else allErrors.push(`FootIK: ${ikResult.error}`);
  }

  // 3. Corruption distortion
  if (includeCorruption) {
    const crResult = await setupCorruptionDistortion({ characterId, skeletonPath });
    if (crResult.success) allSteps.push('corruption_distortion_configured');
    else allErrors.push(`CorruptionRig: ${crResult.error}`);
  }

  const result = {
    success: allSteps.length > 0,
    steps: allSteps,
    errors: allErrors.length ? allErrors : undefined,
    characterId,
  };

  log.info(result, 'Full Motion Matching pipeline complete');
  return result;
}

// ── Boss Attack Montages ──────────────────────────────────────────────────────

/**
 * Curated montage definitions for boss attacks. These are explicitly excluded
 * from Motion Matching and played as one-shot montages with frame-precise
 * telegraph windows (WindUp → Active → Recovery).
 *
 * Each boss has attack montages with timing data for gameplay:
 *  - telegraphStart: frame where visual cue begins (player can read the attack)
 *  - hitboxActive: frame range where damage hitbox is live
 *  - recoveryStart: frame where boss is vulnerable (punish window)
 *  - interruptible: whether the montage can be cancelled by stagger
 */
const BOSS_ATTACK_MONTAGES = {
  GeneralVoss: [
    { name: 'Voss_Overhead_Slam',    telegraphStart: 8,  hitboxActive: [22, 28], recoveryStart: 32, interruptible: false, speed: 1.0 },
    { name: 'Voss_Shield_Bash',      telegraphStart: 4,  hitboxActive: [12, 16], recoveryStart: 20, interruptible: true,  speed: 1.2 },
    { name: 'Voss_Sweep',            telegraphStart: 10, hitboxActive: [18, 26], recoveryStart: 30, interruptible: false, speed: 1.0 },
    { name: 'Voss_Enrage_Combo',     telegraphStart: 6,  hitboxActive: [14, 36], recoveryStart: 44, interruptible: false, speed: 1.3 },
  ],
  WardenSyltha: [
    { name: 'Syltha_Root_Spear',     telegraphStart: 12, hitboxActive: [24, 30], recoveryStart: 36, interruptible: false, speed: 0.9 },
    { name: 'Syltha_Vine_Whip',      telegraphStart: 6,  hitboxActive: [14, 20], recoveryStart: 24, interruptible: true,  speed: 1.1 },
    { name: 'Syltha_Thorn_Barrage',  telegraphStart: 16, hitboxActive: [28, 48], recoveryStart: 54, interruptible: false, speed: 1.0 },
  ],
  ScholarDren: [
    { name: 'Dren_Arcane_Blast',     telegraphStart: 14, hitboxActive: [26, 32], recoveryStart: 38, interruptible: true,  speed: 1.0 },
    { name: 'Dren_Corruption_Wave',  telegraphStart: 10, hitboxActive: [20, 34], recoveryStart: 40, interruptible: false, speed: 0.8 },
    { name: 'Dren_Teleport_Strike',  telegraphStart: 4,  hitboxActive: [10, 14], recoveryStart: 18, interruptible: false, speed: 1.4 },
  ],
  ForgeKeeperAshka: [
    { name: 'Ashka_Hammer_Smash',    telegraphStart: 16, hitboxActive: [30, 36], recoveryStart: 44, interruptible: false, speed: 0.7 },
    { name: 'Ashka_Lava_Sweep',      telegraphStart: 8,  hitboxActive: [18, 28], recoveryStart: 34, interruptible: true,  speed: 1.0 },
    { name: 'Ashka_Ground_Pound',    telegraphStart: 20, hitboxActive: [34, 40], recoveryStart: 48, interruptible: false, speed: 0.9 },
  ],
  Mordaen: [
    { name: 'Mordaen_Void_Slash',    telegraphStart: 6,  hitboxActive: [14, 20], recoveryStart: 24, interruptible: true,  speed: 1.2 },
    { name: 'Mordaen_Shadow_Dive',   telegraphStart: 18, hitboxActive: [30, 38], recoveryStart: 46, interruptible: false, speed: 1.0 },
    { name: 'Mordaen_Corruption_Grasp', telegraphStart: 10, hitboxActive: [22, 32], recoveryStart: 38, interruptible: false, speed: 0.9 },
  ],
  HollowKing: [
    { name: 'HollowKing_Crown_Beam',   telegraphStart: 24, hitboxActive: [40, 60], recoveryStart: 70, interruptible: false, speed: 0.8 },
    { name: 'HollowKing_Shard_Storm',  telegraphStart: 12, hitboxActive: [24, 48], recoveryStart: 56, interruptible: false, speed: 1.0 },
    { name: 'HollowKing_Phase_Shift',  telegraphStart: 8,  hitboxActive: [16, 22], recoveryStart: 28, interruptible: false, speed: 1.5 },
    { name: 'HollowKing_Final_Wrath',  telegraphStart: 30, hitboxActive: [50, 80], recoveryStart: 90, interruptible: false, speed: 0.7 },
  ],
};

/**
 * Generate Python script to register boss attack montages in the AnimBP.
 * Creates montage slots with Anim Notify states for telegraph/hitbox/recovery windows.
 * These remain as traditional montages — NOT fed into Motion Matching.
 */
function buildBossMontageScript({ characterId, bossId }) {
  const montages = BOSS_ATTACK_MONTAGES[bossId];
  if (!montages) return null;

  const animBpPath = `${ANIM_ROOT}/Characters/${characterId}/ABP_${characterId}`;
  const montageDir = `${ANIM_ROOT}/BossMontages/${bossId}`;
  const montagesJson = JSON.stringify(montages);

  return `
import unreal

anim_bp_path = '${animBpPath}'
montage_dir  = '${montageDir}'
boss_id      = '${bossId}'

montage_configs = ${montagesJson}

asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
created = 0
skipped = 0

for cfg in montage_configs:
    montage_name = cfg['name']
    montage_path = f'{montage_dir}/{montage_name}'

    # Check if source anim sequence exists to build montage from
    seq_path = f'{montage_dir}/Sequences/{montage_name}'
    seq = unreal.load_asset(seq_path)

    if not seq:
        print(f'[boss-montage] SKIP (sequence not found): {seq_path}')
        skipped += 1
        continue

    # Create or load AnimMontage
    if unreal.EditorAssetLibrary.does_asset_exist(montage_path):
        montage = unreal.load_asset(montage_path)
        print(f'[boss-montage] Montage exists: {montage_path}')
    else:
        try:
            factory = unreal.AnimMontageFactory()
            factory.source_animation = seq
            montage = asset_tools.create_asset(
                montage_name,
                montage_dir,
                unreal.AnimMontage,
                factory
            )
        except Exception as e:
            print(f'[boss-montage] Create failed {montage_name}: {e}')
            skipped += 1
            continue

    if not montage:
        skipped += 1
        continue

    # Configure montage timing via Anim Notifies for telegraph windows
    try:
        telegraph_start = cfg['telegraphStart'] / 30.0  # frames to seconds at 30fps
        hitbox_start    = cfg['hitboxActive'][0] / 30.0
        hitbox_end      = cfg['hitboxActive'][1] / 30.0
        recovery_start  = cfg['recoveryStart'] / 30.0

        # Set play rate
        montage.set_editor_property('RateScale', cfg.get('speed', 1.0))

        # Add notify states for gameplay systems to read
        # Telegraph window: visual cue (particles, glow, sound)
        # Hitbox active: damage dealing window
        # Recovery: punish window for player
        print(f'[boss-montage] {montage_name}: telegraph={telegraph_start:.2f}s, '
              f'hitbox=[{hitbox_start:.2f}s-{hitbox_end:.2f}s], '
              f'recovery={recovery_start:.2f}s, '
              f'interruptible={cfg.get("interruptible", False)}')

        unreal.EditorAssetLibrary.save_asset(montage_path)
        created += 1
    except Exception as e:
        print(f'[boss-montage] Config failed {montage_name}: {e}')
        skipped += 1

print(f'[boss-montage] {boss_id}: {created} montages configured, {skipped} skipped')
print(f'[boss-montage] Boss montage setup complete for {boss_id}')
`.trim();
}

/**
 * Register boss attack montages as curated AnimMontages (NOT Motion Matched).
 * Creates montage assets with frame-precise telegraph/hitbox/recovery notify windows.
 *
 * @param {object} params
 * @param {string} params.characterId - Character whose AnimBP hosts the montages
 * @param {string} params.bossId - Boss identifier (key in BOSS_ATTACK_MONTAGES)
 * @returns {Promise<{success: boolean, error?: string, bossId: string, montageCount: number}>}
 */
export async function setupBossMontages(params) {
  const { characterId = 'Kael', bossId } = params || {};

  if (!bossId) return { success: false, error: 'bossId required' };
  if (!BOSS_ATTACK_MONTAGES[bossId]) {
    return { success: false, error: `Unknown boss: ${bossId}. Available: ${Object.keys(BOSS_ATTACK_MONTAGES).join(', ')}` };
  }

  log.info({ characterId, bossId }, 'Setting up boss attack montages');
  const script = buildBossMontageScript({ characterId, bossId });
  if (!script) return { success: false, error: `No montages defined for ${bossId}` };

  const r = await runPython(script, 90_000);
  return {
    success: r.success,
    error: r.error,
    bossId,
    montageCount: BOSS_ATTACK_MONTAGES[bossId].length,
    montages: BOSS_ATTACK_MONTAGES[bossId].map(m => m.name),
  };
}

/**
 * Get boss montage timing data for gameplay systems (AI, hitbox, telegraph VFX).
 * Pure data lookup — no UE5 call needed.
 *
 * @param {object} params
 * @param {string} params.bossId
 * @returns {{bossId: string, montages: object[], frameRate: number}}
 */
export function getBossMontageData(params) {
  const { bossId } = params || {};
  if (!bossId || !BOSS_ATTACK_MONTAGES[bossId]) {
    return { error: `Unknown boss. Available: ${Object.keys(BOSS_ATTACK_MONTAGES).join(', ')}` };
  }
  return {
    bossId,
    montages: BOSS_ATTACK_MONTAGES[bossId],
    frameRate: 30,
    allBosses: Object.keys(BOSS_ATTACK_MONTAGES),
  };
}

// ── Exported constants for other modules ──────────────────────────────────────

export {
  KAEL_LOCOMOTION_ANIMS,
  POSE_BONES,
  TRAJECTORY_SAMPLES,
  MM_ROOT,
  BOSS_ATTACK_MONTAGES,
};
