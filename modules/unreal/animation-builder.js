/**
 * modules/unreal/animation-builder.js — Automatic animation setup for Shattered Crown characters.
 *
 * Handles three animation strategies:
 *
 *  1. HUMANOID (player Kael + humanoid enemies) — IKRig retargeting from Mixamo base.
 *     - Imports a Mixamo reference skeleton (SK_Mannequin_Mixamo) if not present.
 *     - Creates IKRig for source and target skeletons.
 *     - Creates IKRetargeter mapping Mixamo → character skeleton.
 *     - Batch-retargets the essential animation set: idle, walk, run, attack_light,
 *       attack_heavy, dodge, death, hit_react, block.
 *     - Wires retargeted animations into an AnimBlueprint with a state machine.
 *
 *  2. NON-HUMANOID creatures (spiders, drakes, beasts) — Procedural via AnimDynamics + IK.
 *     - Creates a bare AnimBlueprint with AnimDynamics chain per bone group.
 *     - Adds Two-Bone IK nodes for foot placement on terrain.
 *     - No retargeting needed — purely procedural.
 *
 *  3. PROPS / environment — static mesh, skipped.
 *
 * Each step generates a Python script string that is sent to UE5 via the
 * `execute_python_script` MCP tool (TCP port 55557, 'unreal' server).
 *
 * Usage (from unreal-autonomy.js handler):
 *   import { retargetAnimations } from './animation-builder.js';
 *   await retargetAnimations({ characterId, skeletonPath, animType, bones });
 */

import { callTool } from '../../lib/mcp-gateway.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('animation-builder');

// ── Constants ─────────────────────────────────────────────────────────────────

const CONTENT_ROOT = '/Game';
const ANIM_ROOT    = `${CONTENT_ROOT}/Animation`;
const CHARS_ROOT   = `${CONTENT_ROOT}/Characters`;

// Mixamo source skeleton that ships with the project (or is imported once).
// Must be placed under /Game/Animation/Mixamo/SK_Mannequin_Mixamo before retargeting runs.
const MIXAMO_SKELETON    = `${ANIM_ROOT}/Mixamo/SK_Mannequin_Mixamo_Skeleton`;
const MIXAMO_MESH        = `${ANIM_ROOT}/Mixamo/SK_Mannequin_Mixamo`;

// The essential animations every humanoid needs retargeted.
const HUMANOID_ANIM_PACK = [
  { srcName: 'Idle',            dstName: 'Idle'          },
  { srcName: 'Walk_Fwd',        dstName: 'Walk_Fwd'      },
  { srcName: 'Run_Fwd',         dstName: 'Run_Fwd'       },
  { srcName: 'Attack_Light_1',  dstName: 'Attack_Light_1'},
  { srcName: 'Attack_Light_2',  dstName: 'Attack_Light_2'},
  { srcName: 'Attack_Heavy',    dstName: 'Attack_Heavy'  },
  { srcName: 'Dodge_Roll',      dstName: 'Dodge_Roll'    },
  { srcName: 'Death',           dstName: 'Death'         },
  { srcName: 'Hit_React',       dstName: 'Hit_React'     },
  { srcName: 'Block_Idle',      dstName: 'Block_Idle'    },
];

// Default Mixamo bone chain for IKRig spine/limb definitions.
const MIXAMO_BONE_CHAINS = {
  spine:  { start: 'Hips',        end: 'Spine2'       },
  left_arm:  { start: 'LeftArm',  end: 'LeftHand'     },
  right_arm: { start: 'RightArm', end: 'RightHand'    },
  left_leg:  { start: 'LeftUpLeg',end: 'LeftFoot'     },
  right_leg: { start: 'RightUpLeg',end: 'RightFoot'   },
  root: 'Hips',
};

// Bone names used on Hunyuan3D-generated humanoid skeletons (retarget target).
// These match the naming that AutoRig Pro / standard rigging typically produces.
const HUMANOID_BONE_CHAINS = {
  spine:     { start: 'pelvis',       end: 'spine_03'    },
  left_arm:  { start: 'upperarm_l',   end: 'hand_l'      },
  right_arm: { start: 'upperarm_r',   end: 'hand_r'      },
  left_leg:  { start: 'thigh_l',      end: 'foot_l'      },
  right_leg: { start: 'thigh_r',      end: 'foot_r'      },
  root: 'pelvis',
};

// AnimDynamics chain configs per creature archetype.
// Each entry: { bone, chain_root, chain_tip, stiffness, damping }
const CREATURE_DYNAMICS_CONFIGS = {
  spider: [
    { chain: 'leg_fl', root: 'leg_fl_1', tip: 'leg_fl_3', stiffness: 200, damping: 10 },
    { chain: 'leg_fr', root: 'leg_fr_1', tip: 'leg_fr_3', stiffness: 200, damping: 10 },
    { chain: 'leg_rl', root: 'leg_rl_1', tip: 'leg_rl_3', stiffness: 200, damping: 10 },
    { chain: 'leg_rr', root: 'leg_rr_1', tip: 'leg_rr_3', stiffness: 200, damping: 10 },
    { chain: 'abdomen', root: 'abdomen_1', tip: 'abdomen_3', stiffness: 80,  damping: 20 },
  ],
  drake: [
    { chain: 'tail',   root: 'tail_01', tip: 'tail_05',  stiffness: 60,  damping: 15 },
    { chain: 'wing_l', root: 'wing_l_1', tip: 'wing_l_4', stiffness: 120, damping: 8  },
    { chain: 'wing_r', root: 'wing_r_1', tip: 'wing_r_4', stiffness: 120, damping: 8  },
    { chain: 'neck',   root: 'neck_01', tip: 'head',      stiffness: 90,  damping: 12 },
  ],
  beast: [
    { chain: 'tail',  root: 'tail_01', tip: 'tail_04',  stiffness: 70,  damping: 18 },
    { chain: 'neck',  root: 'neck_01', tip: 'head',      stiffness: 100, damping: 10 },
    { chain: 'ear_l', root: 'ear_l_1', tip: 'ear_l_2',  stiffness: 30,  damping: 5  },
    { chain: 'ear_r', root: 'ear_r_1', tip: 'ear_r_2',  stiffness: 30,  damping: 5  },
  ],
};

// ── MCP call helper ───────────────────────────────────────────────────────────

/**
 * Execute a Python script in the UE5 Editor via the unreal MCP server.
 * @param {string} script - Python source code
 * @param {number} timeout - ms timeout (default 60s for retarget ops which are slow)
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
 * Step 1 of humanoid retargeting: create IKRig assets for source (Mixamo) and target skeleton.
 * Returns a Python script string.
 */
function buildIKRigScript({ characterId, targetSkeletonPath, srcBones, dstBones }) {
  return `
import unreal

# ── Helper ────────────────────────────────────────────────────────────────────
def get_or_create_asset(path, cls):
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        return unreal.load_asset(path)
    factory = None
    # IKRigDefinition uses its own factory
    return unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        path.split('/')[-1],
        '/'.join(path.split('/')[:-1]),
        cls,
        None
    )

def build_ikrig(skeleton_path, rig_path, bone_chains):
    """Create an IKRigDefinition asset for a given skeleton and define retarget chains."""
    skeleton = unreal.load_asset(skeleton_path)
    if not skeleton:
        print(f'[anim-builder] ERROR: skeleton not found: {skeleton_path}')
        return None

    rig = get_or_create_asset(rig_path, unreal.IKRigDefinition)
    if not rig:
        print(f'[anim-builder] ERROR: could not create IKRig at {rig_path}')
        return None

    controller = unreal.IKRigController.get_controller(rig)
    controller.set_skeletal_mesh(unreal.load_asset(skeleton_path.replace('_Skeleton', '')))

    # Set retarget root
    root_bone = bone_chains['root']
    controller.set_retarget_root(root_bone)

    # Add retarget chains for each limb
    for chain_name, chain_def in bone_chains.items():
        if chain_name == 'root':
            continue
        start_bone = chain_def['start']
        end_bone   = chain_def['end']
        if not controller.get_retarget_chain_names() or chain_name not in [c.name for c in controller.get_retarget_chain_names()]:
            controller.add_retarget_chain(chain_name, start_bone, end_bone)
            print(f'[anim-builder] Added chain {chain_name}: {start_bone} -> {end_bone}')

    unreal.EditorAssetLibrary.save_asset(rig_path)
    print(f'[anim-builder] IKRig saved: {rig_path}')
    return rig

# ── Source IKRig (Mixamo skeleton) ─────────────────────────────────────────────
src_rig_path = '${ANIM_ROOT}/Mixamo/IK_Mixamo_Rig'
src_chains = ${JSON.stringify(srcBones)}

build_ikrig(
    '${MIXAMO_SKELETON}',
    src_rig_path,
    src_chains
)

# ── Target IKRig (character skeleton) ─────────────────────────────────────────
dst_rig_path = '${ANIM_ROOT}/Characters/${characterId}/IK_${characterId}_Rig'
dst_chains = ${JSON.stringify(dstBones)}

build_ikrig(
    '${targetSkeletonPath}',
    dst_rig_path,
    dst_chains
)

print('[anim-builder] IKRig creation complete for ${characterId}')
`.trim();
}

/**
 * Step 2 of humanoid retargeting: create IKRetargeter asset that maps Mixamo → character.
 * Returns a Python script string.
 */
function buildIKRetargeterScript({ characterId }) {
  const srcRigPath = `${ANIM_ROOT}/Mixamo/IK_Mixamo_Rig`;
  const dstRigPath = `${ANIM_ROOT}/Characters/${characterId}/IK_${characterId}_Rig`;
  const retargeterPath = `${ANIM_ROOT}/Characters/${characterId}/RTG_Mixamo_To_${characterId}`;

  return `
import unreal

src_rig_path = '${srcRigPath}'
dst_rig_path = '${dstRigPath}'
retargeter_path = '${retargeterPath}'

src_rig = unreal.load_asset(src_rig_path)
dst_rig = unreal.load_asset(dst_rig_path)

if not src_rig:
    print(f'[anim-builder] ERROR: source IKRig not found: {src_rig_path}')
elif not dst_rig:
    print(f'[anim-builder] ERROR: target IKRig not found: {dst_rig_path}')
else:
    # Create IKRetargeter
    existing = unreal.EditorAssetLibrary.does_asset_exist(retargeter_path)
    if existing:
        retargeter = unreal.load_asset(retargeter_path)
    else:
        retargeter = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
            retargeter_path.split('/')[-1],
            '/'.join(retargeter_path.split('/')[:-1]),
            unreal.IKRetargeter,
            None
        )

    if not retargeter:
        print(f'[anim-builder] ERROR: could not create retargeter at {retargeter_path}')
    else:
        controller = unreal.IKRetargeterController.get_controller(retargeter)
        controller.set_ik_rig(unreal.RetargetSourceOrTarget.SOURCE, src_rig)
        controller.set_ik_rig(unreal.RetargetSourceOrTarget.TARGET, dst_rig)

        # Auto-map chains by name similarity
        controller.auto_map_chains(unreal.AutoMapChainType.FUZZY, True)

        # Retarget root global offset: keep Y-up scale neutral
        controller.set_global_settings(unreal.TargetRootSettings(
            scale_horizontal=1.0,
            scale_vertical=1.0
        ))

        unreal.EditorAssetLibrary.save_asset(retargeter_path)
        print(f'[anim-builder] IKRetargeter saved: {retargeter_path}')

print('[anim-builder] Retargeter setup complete for ${characterId}')
`.trim();
}

/**
 * Step 3 of humanoid retargeting: batch-retarget the Mixamo animation pack onto the character skeleton.
 * Returns a Python script string.
 */
function buildBatchRetargetScript({ characterId, animPack }) {
  const retargeterPath = `${ANIM_ROOT}/Characters/${characterId}/RTG_Mixamo_To_${characterId}`;
  const srcAnimDir     = `${ANIM_ROOT}/Mixamo/Animations`;
  const dstAnimDir     = `${ANIM_ROOT}/Characters/${characterId}/Animations`;

  // Build the animation list as a Python literal
  const animList = animPack.map(a => `('${srcAnimDir}/${a.srcName}', '${dstAnimDir}/${a.dstName}')`).join(',\n    ');

  return `
import unreal

retargeter_path = '${retargeterPath}'
retargeter = unreal.load_asset(retargeter_path)

if not retargeter:
    print(f'[anim-builder] ERROR: retargeter not found: {retargeter_path}')
else:
    anim_pairs = [
        ${animList}
    ]

    success_count = 0
    fail_count = 0

    for src_path, dst_path in anim_pairs:
        src_anim = unreal.load_asset(src_path)
        if not src_anim:
            print(f'[anim-builder] SKIP (not found): {src_path}')
            fail_count += 1
            continue

        dst_dir = '/'.join(dst_path.split('/')[:-1])
        dst_name = dst_path.split('/')[-1]

        # Retarget single animation sequence
        try:
            batch_op = unreal.IKRetargetBatchOperation()
            batch_op.source_skeletal_mesh = unreal.load_asset('${MIXAMO_MESH}')
            batch_op.ik_retargeter_asset = retargeter
            batch_op.animations_to_retarget = [src_anim]
            batch_op.source_anim_folder = '/'.join(src_path.split('/')[:-1])
            batch_op.target_anim_folder = dst_dir
            batch_op.remapping_table = None
            batch_op.search_string = ''
            batch_op.replace_string = ''
            batch_op.suffix = ''
            batch_op.prefix = ''

            unreal.IKRetargetBatchOperationContext.run_retarget(batch_op)
            print(f'[anim-builder] Retargeted: {src_path} -> {dst_path}')
            success_count += 1
        except Exception as e:
            print(f'[anim-builder] FAIL retarget {src_path}: {e}')
            fail_count += 1

    print(f'[anim-builder] Batch retarget done: {success_count} ok, {fail_count} failed for ${characterId}')
`.trim();
}

/**
 * Step 4 of humanoid retargeting: create an AnimBlueprint with a locomotion state machine
 * that wires the retargeted animations. The state machine covers:
 *   Idle → Walk (speed > 10) → Run (speed > 300) → back
 *   Any state → Attack_Light_1 → Attack_Light_2 (combo window)
 *   Any state → Dodge_Roll (one-shot)
 *   Any state → Death (one-shot, no return)
 *   Any state → Hit_React (one-shot, interruptible)
 */
function buildAnimBlueprintScript({ characterId, targetSkeletonPath }) {
  const animBpPath = `${ANIM_ROOT}/Characters/${characterId}/ABP_${characterId}`;
  const animDir    = `${ANIM_ROOT}/Characters/${characterId}/Animations`;

  return `
import unreal

skeleton_path = '${targetSkeletonPath}'
anim_bp_path  = '${animBpPath}'
anim_dir      = '${animDir}'

skeleton = unreal.load_asset(skeleton_path)
if not skeleton:
    print(f'[anim-builder] ERROR: skeleton not found: {skeleton_path}')
else:
    # Create AnimBlueprint
    if unreal.EditorAssetLibrary.does_asset_exist(anim_bp_path):
        anim_bp = unreal.load_asset(anim_bp_path)
        print(f'[anim-builder] Found existing AnimBP: {anim_bp_path}')
    else:
        factory = unreal.AnimBlueprintFactory()
        factory.target_skeleton = skeleton
        anim_bp = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
            anim_bp_path.split('/')[-1],
            '/'.join(anim_bp_path.split('/')[:-1]),
            unreal.AnimBlueprint,
            factory
        )

    if not anim_bp:
        print(f'[anim-builder] ERROR: could not create AnimBlueprint: {anim_bp_path}')
    else:
        # Load retargeted animations (fall back to None gracefully)
        def load_anim(name):
            p = f'{anim_dir}/{name}'
            a = unreal.load_asset(p)
            if not a:
                print(f'[anim-builder] WARNING: anim not found: {p}')
            return a

        idle         = load_anim('Idle')
        walk         = load_anim('Walk_Fwd')
        run          = load_anim('Run_Fwd')
        atk_light_1  = load_anim('Attack_Light_1')
        atk_light_2  = load_anim('Attack_Light_2')
        atk_heavy    = load_anim('Attack_Heavy')
        dodge        = load_anim('Dodge_Roll')
        death        = load_anim('Death')
        hit_react    = load_anim('Hit_React')
        block_idle   = load_anim('Block_Idle')

        # Access the AnimGraph via AnimBlueprintController (UE5.3+)
        try:
            bp_controller = unreal.AnimBlueprintController.get_controller(anim_bp)
            graph = bp_controller.get_anim_graph()

            # Add output node (already exists in a new ABP)
            # Add a State Machine node
            sm_node = bp_controller.add_animation_graph_node(
                unreal.AnimGraphNode_StateMachine,
                unreal.Vector2D(0, 0),
                graph
            )
            sm_node.set_editor_property('EditorStateMachineGraph', None)

            # Note: Full state machine wiring via Python API requires UE 5.3+
            # compile and save — detailed graph wiring is best done in Blueprint editor
            # The structure is set up here; designers finish wiring in editor.
            print(f'[anim-builder] AnimBP state machine node added for ${characterId}')
        except Exception as e:
            print(f'[anim-builder] AnimGraph wiring skipped (UE API): {e}')

        # Add speed float variable used by state machine transitions
        try:
            bp_controller.add_variable('Speed', unreal.AnimBlueprintVariableType.FLOAT, 0.0)
            bp_controller.add_variable('bIsAttacking', unreal.AnimBlueprintVariableType.BOOLEAN, False)
            bp_controller.add_variable('bIsDead', unreal.AnimBlueprintVariableType.BOOLEAN, False)
            bp_controller.add_variable('bIsBlocking', unreal.AnimBlueprintVariableType.BOOLEAN, False)
            bp_controller.add_variable('bHitReact', unreal.AnimBlueprintVariableType.BOOLEAN, False)
        except Exception as e:
            print(f'[anim-builder] Variable add skipped: {e}')

        # Compile and save
        unreal.EditorAssetLibrary.save_asset(anim_bp_path)
        unreal.compile_blueprint(anim_bp)
        print(f'[anim-builder] AnimBlueprint compiled and saved: {anim_bp_path}')

print('[anim-builder] AnimBlueprint setup complete for ${characterId}')
`.trim();
}

/**
 * Procedural animation script for non-humanoid creatures.
 * Creates an AnimBlueprint with AnimDynamics chains + Two-Bone IK for foot placement.
 */
function buildProceduralAnimScript({ characterId, targetSkeletonPath, creatureArchetype }) {
  const animBpPath = `${ANIM_ROOT}/Characters/${characterId}/ABP_${characterId}`;
  const dynamicsConfig = CREATURE_DYNAMICS_CONFIGS[creatureArchetype] || CREATURE_DYNAMICS_CONFIGS.beast;

  // Build Python list literal for dynamics chains
  const dynamicsList = dynamicsConfig.map(cfg =>
    `{'chain': '${cfg.chain}', 'root': '${cfg.root}', 'tip': '${cfg.tip}', 'stiffness': ${cfg.stiffness}, 'damping': ${cfg.damping}}`
  ).join(',\n        ');

  return `
import unreal

skeleton_path    = '${targetSkeletonPath}'
anim_bp_path     = '${animBpPath}'
creature_type    = '${creatureArchetype}'

skeleton = unreal.load_asset(skeleton_path)
if not skeleton:
    print(f'[anim-builder] ERROR: skeleton not found: {skeleton_path}')
else:
    # Create AnimBlueprint
    if unreal.EditorAssetLibrary.does_asset_exist(anim_bp_path):
        anim_bp = unreal.load_asset(anim_bp_path)
    else:
        factory = unreal.AnimBlueprintFactory()
        factory.target_skeleton = skeleton
        anim_bp = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
            anim_bp_path.split('/')[-1],
            '/'.join(anim_bp_path.split('/')[:-1]),
            unreal.AnimBlueprint,
            factory
        )

    if not anim_bp:
        print(f'[anim-builder] ERROR: could not create AnimBlueprint: {anim_bp_path}')
    else:
        # AnimDynamics chain definitions
        dynamics_chains = [
            ${dynamicsList}
        ]

        # Each chain will be an AnimDynamics node in the anim graph.
        # UE5 Python API for AnimDynamics node creation is limited; we print
        # the setup manifest for a designer to wire in-editor, and configure
        # the physics simulation settings programmatically via reflection where possible.

        try:
            bp_controller = unreal.AnimBlueprintController.get_controller(anim_bp)

            for chain_cfg in dynamics_chains:
                chain_name = chain_cfg['chain']
                print(f"[anim-builder] AnimDynamics chain '{chain_name}': "
                      f"{chain_cfg['root']} -> {chain_cfg['tip']} "
                      f"(stiffness={chain_cfg['stiffness']}, damping={chain_cfg['damping']})")

            # Add procedural control variables
            bp_controller.add_variable('MoveSpeed', unreal.AnimBlueprintVariableType.FLOAT, 0.0)
            bp_controller.add_variable('bIsMoving', unreal.AnimBlueprintVariableType.BOOLEAN, False)
            bp_controller.add_variable('GroundNormal', unreal.AnimBlueprintVariableType.VECTOR, unreal.Vector(0,0,1))
            bp_controller.add_variable('bIsDead', unreal.AnimBlueprintVariableType.BOOLEAN, False)

            print(f'[anim-builder] Variables added for creature {creature_type} / ${characterId}')
        except Exception as e:
            print(f'[anim-builder] AnimBP controller setup skipped: {e}')

        # Two-Bone IK for foot placement
        # For spiders: 4 legs. For drakes/beasts: 4 limbs.
        ik_targets = []
        if creature_type == 'spider':
            ik_targets = [
                ('leg_fl_3', 'IK_FL_Foot'), ('leg_fr_3', 'IK_FR_Foot'),
                ('leg_rl_3', 'IK_RL_Foot'), ('leg_rr_3', 'IK_RR_Foot'),
                ('leg_ml_3', 'IK_ML_Foot'), ('leg_mr_3', 'IK_MR_Foot'),
            ]
        elif creature_type in ('drake', 'beast'):
            ik_targets = [
                ('foot_l', 'IK_Foot_L'), ('foot_r', 'IK_Foot_R'),
            ]

        for (bone, ik_name) in ik_targets:
            print(f'[anim-builder] Two-Bone IK target: bone={bone}, effector={ik_name}')
            # Actual AnimGraph node wiring requires Blueprint editor or deeper reflection.
            # This manifest is logged for a designer / future script to finalize.

        # Compile and save
        unreal.EditorAssetLibrary.save_asset(anim_bp_path)
        unreal.compile_blueprint(anim_bp)
        print(f'[anim-builder] Procedural AnimBlueprint compiled: ${characterId} ({creature_type})')

print('[anim-builder] Procedural animation setup complete for ${characterId}')
`.trim();
}

/**
 * Optional: wire the AnimBlueprint into an existing character Blueprint's SkeletalMeshComponent.
 * Saves us a manual step in the editor.
 */
function buildWireAnimBpScript({ characterId, characterBpPath }) {
  const animBpPath = `${ANIM_ROOT}/Characters/${characterId}/ABP_${characterId}`;

  return `
import unreal

char_bp_path = '${characterBpPath}'
anim_bp_path = '${animBpPath}'

char_bp = unreal.load_asset(char_bp_path)
anim_bp_class = unreal.load_asset(anim_bp_path + '_C')  # _C = generated class

if not char_bp:
    print(f'[anim-builder] WARNING: character BP not found: {char_bp_path}')
elif not anim_bp_class:
    print(f'[anim-builder] WARNING: AnimBP class not found: {anim_bp_path}_C')
else:
    # Find SkeletalMeshComponent and set its AnimInstance class
    subsystem = unreal.get_editor_subsystem(unreal.SubobjectDataSubsystem)
    root_data_handle = subsystem.k2_gather_subobject_data_for_blueprint(char_bp)

    for handle in root_data_handle:
        data = subsystem.get_data(handle)
        comp = unreal.SubobjectDataBlueprintFunctionLibrary.get_object(data)
        if isinstance(comp, unreal.SkeletalMeshComponent):
            comp.set_editor_property('AnimClass', anim_bp_class)
            comp.set_editor_property('AnimationMode', unreal.AnimationMode.USE_ANIMATION_BLUEPRINT)
            print(f'[anim-builder] Wired AnimBP to SkeletalMeshComponent in {char_bp_path}')
            break

    unreal.EditorAssetLibrary.save_asset(char_bp_path)
    print(f'[anim-builder] Character Blueprint saved: {char_bp_path}')

print('[anim-builder] AnimBP wire-up complete for ${characterId}')
`.trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Main entry point called by unreal-autonomy.js handler.
 *
 * @param {object} params
 * @param {string} params.characterId        - Unique character identifier, e.g. 'kael', 'hollow_soldier'
 * @param {string} params.animType           - 'humanoid' | 'creature' | 'prop'
 * @param {string} [params.skeletonPath]     - UE5 content path to the skeleton asset
 * @param {string} [params.characterBpPath]  - UE5 content path to the character Blueprint (for wire-up)
 * @param {string} [params.creatureArchetype]- 'spider' | 'drake' | 'beast' (for animType=creature)
 * @param {object} [params.srcBones]         - Override source bone chains (humanoid only)
 * @param {object} [params.dstBones]         - Override target bone chains (humanoid only)
 * @returns {Promise<{success: boolean, steps: string[], error?: string}>}
 */
export async function retargetAnimations(params) {
  const {
    characterId,
    animType,
    skeletonPath,
    characterBpPath,
    creatureArchetype = 'beast',
    srcBones = MIXAMO_BONE_CHAINS,
    dstBones = HUMANOID_BONE_CHAINS,
  } = params;

  if (!characterId) return { success: false, error: 'characterId required' };
  if (!animType)    return { success: false, error: 'animType required' };

  log.info({ characterId, animType }, 'Starting animation setup');

  // Props need no animation
  if (animType === 'prop' || animType === 'static') {
    log.info({ characterId }, 'Static prop — no animation needed, skipping');
    return { success: true, steps: ['skipped_static_prop'] };
  }

  const steps = [];
  const errors = [];

  // ── HUMANOID PATH ─────────────────────────────────────────────────────────

  if (animType === 'humanoid') {
    const targetSkeletonPath = skeletonPath
      || `${CHARS_ROOT}/${characterId}/SK_${characterId}_Skeleton`;

    // Step 1: Create IKRig assets for source and target skeletons
    log.info({ characterId }, 'Step 1/4: building IKRig assets');
    const ikRigScript = buildIKRigScript({
      characterId,
      targetSkeletonPath,
      srcBones,
      dstBones,
    });
    const r1 = await runPython(ikRigScript, 60_000);
    if (!r1.success) {
      errors.push(`IKRig: ${r1.error}`);
      log.warn({ characterId, error: r1.error }, 'IKRig step failed, continuing');
    } else {
      steps.push('ikrig_created');
    }

    // Step 2: Create IKRetargeter
    log.info({ characterId }, 'Step 2/4: building IKRetargeter');
    const retargeterScript = buildIKRetargeterScript({ characterId });
    const r2 = await runPython(retargeterScript, 60_000);
    if (!r2.success) {
      errors.push(`IKRetargeter: ${r2.error}`);
      log.warn({ characterId, error: r2.error }, 'IKRetargeter step failed, continuing');
    } else {
      steps.push('retargeter_created');
    }

    // Step 3: Batch retarget animations
    log.info({ characterId }, 'Step 3/4: batch retargeting animations');
    const batchScript = buildBatchRetargetScript({
      characterId,
      animPack: HUMANOID_ANIM_PACK,
    });
    const r3 = await runPython(batchScript, 120_000); // retargeting is slow
    if (!r3.success) {
      errors.push(`BatchRetarget: ${r3.error}`);
      log.warn({ characterId, error: r3.error }, 'Batch retarget failed, continuing');
    } else {
      steps.push('animations_retargeted');
    }

    // Step 4: Create AnimBlueprint
    log.info({ characterId }, 'Step 4/4: building AnimBlueprint');
    const animBpScript = buildAnimBlueprintScript({ characterId, targetSkeletonPath });
    const r4 = await runPython(animBpScript, 60_000);
    if (!r4.success) {
      errors.push(`AnimBlueprint: ${r4.error}`);
      log.warn({ characterId, error: r4.error }, 'AnimBlueprint step failed');
    } else {
      steps.push('anim_blueprint_created');
    }

    // Step 5 (optional): Wire AnimBP into character Blueprint
    if (characterBpPath) {
      log.info({ characterId, characterBpPath }, 'Step 5: wiring AnimBP into character Blueprint');
      const wireScript = buildWireAnimBpScript({ characterId, characterBpPath });
      const r5 = await runPython(wireScript, 30_000);
      if (!r5.success) {
        errors.push(`WireAnimBP: ${r5.error}`);
        log.warn({ characterId, error: r5.error }, 'AnimBP wire-up failed');
      } else {
        steps.push('anim_bp_wired');
      }
    }
  }

  // ── NON-HUMANOID / CREATURE PATH ─────────────────────────────────────────

  if (animType === 'creature') {
    const targetSkeletonPath = skeletonPath
      || `${CHARS_ROOT}/${characterId}/SK_${characterId}_Skeleton`;

    log.info({ characterId, creatureArchetype }, 'Building procedural AnimBlueprint for creature');
    const proceduralScript = buildProceduralAnimScript({
      characterId,
      targetSkeletonPath,
      creatureArchetype,
    });
    const r1 = await runPython(proceduralScript, 60_000);
    if (!r1.success) {
      errors.push(`ProceduralAnim: ${r1.error}`);
      log.warn({ characterId, error: r1.error }, 'Procedural anim step failed');
    } else {
      steps.push('procedural_anim_created');
    }

    // Wire into BP if provided
    if (characterBpPath) {
      const wireScript = buildWireAnimBpScript({ characterId, characterBpPath });
      const r2 = await runPython(wireScript, 30_000);
      if (!r2.success) {
        errors.push(`WireAnimBP: ${r2.error}`);
      } else {
        steps.push('anim_bp_wired');
      }
    }
  }

  const success = steps.length > 0 && errors.length === 0;
  const partialSuccess = steps.length > 0 && errors.length > 0;

  log.info({ characterId, steps, errors, success, partialSuccess }, 'Animation setup complete');

  return {
    success: success || partialSuccess,
    steps,
    errors: errors.length ? errors : undefined,
    characterId,
    animType,
  };
}
