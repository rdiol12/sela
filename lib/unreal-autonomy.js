/**
 * lib/unreal-autonomy.js — Autonomous UE5 game builder loop.
 *
 * Runs on every proactive cycle (every 30min).
 * When UE5 editor is open (port 55557 reachable), pops the next task
 * from the build queue and executes it, then reports via Telegram.
 *
 * Fully autonomous — no user trigger needed after initial setup.
 */

import net from 'net';
import { createLogger } from './logger.js';
import { getState, setState } from './state.js';
import { notify } from './notify.js';

const log = createLogger('unreal-autonomy');
const UE5_PORT = 55557;
const UE5_HOST = '127.0.0.1';
const COOLDOWN_MS = 25 * 60 * 1000; // 25min between auto-builds
const MAX_TASKS_PER_CYCLE = 3;       // Max tasks per proactive cycle

// ── UE5 reachability check ───────────────────────────────────────────────────

function isUE5Open() {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: UE5_HOST, port: UE5_PORT });
    sock.setTimeout(2000);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => resolve(false));
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
  });
}

// ── Character mesh injection ──────────────────────────────────────────────────
// Blueprint types that need a generated 3D mesh + auto-rig
// Maps task.params.bpType → { prompt, animType, creatureArchetype? }
const CHARACTER_MESH_MAP = {
  player_controller: {
    prompt: 'Kael, dark fantasy warrior, worn leather armor with ember-glowing runes, scarred face, athletic build, game-ready character',
    animType: 'humanoid',
  },
  npc: {
    prompt: (params) => `${params.name || 'NPC'}, dark fantasy villager, ${params.description || 'worn clothing, weary expression'}`,
    animType: 'humanoid',
  },
  enemy: {
    prompt: (params) => `${params.name || 'enemy'}, dark fantasy creature, ${params.description || 'menacing undead soldier, cracked armor, glowing eyes'}`,
    animType: (params) => params.creatureArchetype ? 'creature' : 'humanoid',
    creatureArchetype: (params) => params.creatureArchetype || null,
  },
  boss: {
    prompt: (params) => `${params.name || 'boss'}, imposing dark fantasy boss, ${params.description || 'massive armored warrior with corrupted power'}`,
    animType: (params) => params.creatureArchetype ? 'creature' : 'humanoid',
    creatureArchetype: (params) => params.creatureArchetype || null,
  },
};

function injectMeshTaskIfCharacter(q, task) {
  const bpType = task.params?.bpType;
  const meshDef = CHARACTER_MESH_MAP[bpType];
  if (!meshDef) return; // not a character type

  // Don't inject if mesh task already exists for this blueprint
  const meshId = `mesh_${task.id}`;
  if (q.tasks.find(t => t.id === meshId)) return;

  const prompt = typeof meshDef.prompt === 'function' ? meshDef.prompt(task.params) : meshDef.prompt;
  const animType = typeof meshDef.animType === 'function' ? meshDef.animType(task.params) : meshDef.animType;
  const creatureArchetype = typeof meshDef.creatureArchetype === 'function' ? meshDef.creatureArchetype(task.params) : (meshDef.creatureArchetype || null);

  q.tasks.push({
    id: meshId,
    type: 'generate_mesh',
    phase: 'assets',
    priority: (task.priority || 50) - 1, // run just after the blueprint task
    status: 'pending',
    attempts: 0,
    params: {
      prompt,
      characterId: task.id,
      blueprintName: task.params?.name,
      animType,
      ...(creatureArchetype ? { creatureArchetype } : {}),
    },
  });

  log.info({ meshId, prompt: prompt.slice(0, 60) }, 'Injected mesh generation task');

  // Save queue immediately so the new task persists
  import('../modules/unreal/build-manifest.js').then(({ saveQueue }) => saveQueue(q)).catch(() => {});
}

// ── Task executor ─────────────────────────────────────────────────────────────

async function executeTask(task) {
  const { type, params } = task;

  if (type === 'design_game') {
    const { designGame } = await import('../modules/unreal/game-brain.js');
    return designGame(params.brief);
  }

  if (type === 'plan_region') {
    const { planRegion } = await import('../modules/unreal/world-planner.js');
    return planRegion(params.regionId);
  }

  if (type === 'blueprint') {
    const { buildGameplayBlueprint } = await import('../modules/unreal/gameplay-builder.js');
    return buildGameplayBlueprint(params.bpType, params.name, params.path);
  }

  if (type === 'level') {
    const { buildArenaLevel } = await import('../modules/unreal/gameplay-builder.js');
    return buildArenaLevel();
  }

  if (type === 'region_bp') {
    const { buildNextBlueprint } = await import('../modules/unreal/blueprint-builder.js');
    return buildNextBlueprint({ regionId: params.regionId, bpName: params.bpName });
  }

  if (type === 'structure') {
    const { buildRegionStep } = await import('../modules/unreal/level-builder.js');
    return buildRegionStep({ regionId: params.regionId });
  }

  if (type === 'populate_region') {
    const { populateRegionAssets } = await import('../modules/unreal/level-builder.js');
    return populateRegionAssets(params.regionId);
  }

  if (type === 'generate_cpp') {
    const { generateCppFile, compileProject } = await import('../modules/unreal/cpp-generator.js');
    const r = await generateCppFile(params.systemType, params.config || {});
    if (!r.success) return r;
    if (r.skipped) return { success: true, skipped: true, filename: r.filename };
    return compileProject();
  }

  if (type === 'generate_ruleset') {
    const { generateRuleset } = await import('../modules/unreal/ruleset-generator.js');
    return generateRuleset(params.entityId, params.description);
  }

  if (type === 'generate_mesh') {
    // Generate a 3D mesh via asset pipeline (Hunyuan3D → UniRig → import into Blender/UE5)
    const { generateOnDemandForGame } = await import('../modules/asset-pipeline/game-asset.js');
    return generateOnDemandForGame(params);
  }

  if (type === 'retarget_animations') {
    const { retargetAnimations } = await import('../modules/unreal/animation-builder.js');
    return retargetAnimations({
      characterId:       params.characterId,
      animType:          params.animType,          // 'humanoid' | 'creature' | 'prop'
      skeletonPath:      params.skeletonPath,      // optional UE5 content path override
      characterBpPath:   params.characterBpPath,   // optional, wire AnimBP into char BP
      creatureArchetype: params.creatureArchetype, // 'spider' | 'drake' | 'beast'
      srcBones:          params.srcBones,          // optional bone chain override (humanoid)
      dstBones:          params.dstBones,          // optional bone chain override (humanoid)
    });
  }

  // Generic multi-command task: run a list of UE5 MCP commands in sequence
  if (type === 'ue5_command') {
    const { callTool } = await import('./mcp-gateway.js');
    const results = [];
    const errors = [];
    for (const cmd of (params.commands || [])) {
      try {
        const r = await callTool('unreal', cmd.tool, cmd.args || {}, 30_000);
        results.push({ tool: cmd.tool, success: r?.success !== false });
      } catch (err) {
        errors.push({ tool: cmd.tool, error: err.message });
      }
    }
    return { success: errors.length === 0, results, errors };
  }

  return { success: false, error: `Unknown task type: ${type}` };
}

// Tasks that don't require UE5 to be open (pure Claude/filesystem work)
const NO_UE5_TASK_TYPES = new Set([
  'plan_region',
  'design_game',
  'generate_cpp',      // writes C++ files + runs UBT (no editor needed)
  'generate_ruleset',  // writes JSON files via Claude (no editor needed)
]);

// ── Main autonomous cycle ─────────────────────────────────────────────────────

export async function runUnrealAutonomy() {
  try {
    // Check cooldown
    const state = getState('unreal-autonomy');
    if (Date.now() - (state.lastRunAt || 0) < COOLDOWN_MS) return;

    // Load task queue
    const { loadQueue, nextTask, markDone, markFailed, getProgress } =
      await import('../modules/unreal/build-manifest.js');

    const q = loadQueue();
    const progress = getProgress(q);

    if (progress.pending === 0 && progress.failed === 0) {
      log.info('All game tasks complete!');
      return;
    }

    // Check if UE5 is open — needed for most tasks, but not planning
    const ue5Open = await isUE5Open();
    const nextPending = nextTask(q);

    // If UE5 is closed and next task needs it, skip
    if (!ue5Open && nextPending && !NO_UE5_TASK_TYPES.has(nextPending.type)) {
      log.debug('UE5 not open and next task needs it, skipping autonomy cycle');
      return;
    }

    log.info({ progress, ue5Open }, 'Starting unreal autonomy cycle');
    setState('unreal-autonomy', { ...state, lastRunAt: Date.now() });

    const built = [];
    const errors = [];

    for (let i = 0; i < MAX_TASKS_PER_CYCLE; i++) {
      const task = nextTask(q);
      if (!task) break;

      // Skip tasks that need UE5 if it's not open
      if (!ue5Open && !NO_UE5_TASK_TYPES.has(task.type)) {
        log.debug({ id: task.id }, 'Skipping UE5 task — editor not open');
        break;
      }

      log.info({ id: task.id, type: task.type, phase: task.phase }, 'Executing task');

      try {
        const result = await executeTask(task);
        if (result?.success !== false) {
          markDone(q, task.id);
          built.push(task.id);
          log.info({ id: task.id }, 'Task completed');
          // After a character blueprint completes, inject a mesh generation task
          injectMeshTaskIfCharacter(q, task);
        } else {
          markFailed(q, task.id, result?.error || 'unknown error');
          errors.push({ id: task.id, error: result?.error });
          log.warn({ id: task.id, error: result?.error }, 'Task failed');
        }
      } catch (err) {
        markFailed(q, task.id, err.message);
        errors.push({ id: task.id, error: err.message });
        log.error({ id: task.id, err: err.message }, 'Task exception');
      }

      // Small delay between tasks
      await new Promise(r => setTimeout(r, 3000));
    }

    const newProgress = getProgress(q);

    // Telegram report
    if (built.length > 0 || errors.length > 0) {
      const { getActiveGame } = await import('../modules/unreal/game-config.js');
      const gameName = getActiveGame().displayName || 'Game';
      const lines = [`🎮 *${gameName} Auto-Build* — ${newProgress.pct}% complete`];
      lines.push(`Progress: ${newProgress.done}/${newProgress.total} tasks done`);
      if (built.length) lines.push(`✅ Built: ${built.join(', ')}`);
      if (errors.length) lines.push(`❌ Failed: ${errors.map(e => e.id).join(', ')}`);
      if (newProgress.pending === 0) lines.push('🎉 All tasks complete! Add PlayerStart in UE5 → press Alt+P to play!');
      else lines.push(`Next: ${nextTask(q)?.id || 'none'}`);
      await notify(lines.join('\n'));
    }

  } catch (err) {
    log.error({ err: err.message }, 'unreal autonomy cycle failed');
  }
}

// ── Status report ─────────────────────────────────────────────────────────────

export async function getAutonomyStatus() {
  try {
    const { loadQueue, getProgress, nextTask } = await import('../modules/unreal/build-manifest.js');
    const q = loadQueue();
    const progress = getProgress(q);
    const next = nextTask(q);
    const ue5Open = await isUE5Open();
    return { progress, next: next?.id, ue5Open };
  } catch (err) {
    return { error: err.message };
  }
}
