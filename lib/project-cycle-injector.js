/**
 * project-cycle-injector.js — Generic per-cycle context injector for project cycles.
 *
 * Features:
 *   1. Config-driven context injection (rules, council sections, protocol phases)
 *   2. Cycle memory — remembers what happened last cycle per project per goal
 *   3. Previous cycle summary — injects "last cycle you did X" so agent doesn't repeat
 *   4. Approval state tracking — per-goal state machine:
 *      needs_plan → plan_sent → awaiting_approval → approved → executing → done
 *
 * New projects just add a config in data/project-injections/ — no code changes needed.
 */

import { readFileSync, existsSync, statSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { listGoals } from './goals.js';
import { getState, setState } from './state.js';
import { createLogger } from './logger.js';

const log = createLogger('project-injector');
const CONFIGS_DIR = join(process.cwd(), 'data', 'project-injections');

// Cache: project → { config, sections, mtime }
const _cache = new Map();

// ─── Approval State Machine ─────────────────────────────────────────────────

const GOAL_PHASES = ['thinking', 'planning', 'executing', 'validating', 'reporting', 'done'];

const PHASE_INSTRUCTIONS = {
  thinking: 'THINK and research first. Use harepacker-mcp and search tools to understand what exists. Answer: WHAT, WHY, WHERE, WHAT CONNECTS.',
  planning: 'Write a design plan. Decide IDs, names, connections, assets needed. Then move straight to execution.',
  executing: 'EXECUTE the plan. Create files, write XML, deploy content. Use chain_plan or direct tools. Do multiple things per cycle.',
  validating: 'VALIDATE your work. Check connections, String entries, portal links, XML syntax. Fix anything broken.',
  reporting: 'REPORT what was done. Send a summary to Ron via <wa_message>. Mark milestones complete.',
  done: 'Goal complete. Nothing more to do.',
};

/**
 * Load goal phase states for a project. Stored in state as `goal-phases:{project}`.
 * Returns Map<goalId, { phase, lastCycleAction, lastCycleSummary, lastCycleAt }>
 */
function loadGoalStates(project) {
  const raw = getState(`goal-phases:${project}`) || {};
  return new Map(Object.entries(raw));
}

function saveGoalStates(project, stateMap) {
  setState(`goal-phases:${project}`, Object.fromEntries(stateMap));
}

/**
 * Get the phase state for a goal. Auto-creates if missing.
 */
function getGoalState(stateMap, goalId) {
  if (!stateMap.has(goalId)) {
    stateMap.set(goalId, { phase: 'thinking', lastCycleAction: null, lastCycleSummary: null });
  }
  return stateMap.get(goalId);
}

/**
 * Transition goal phase. Forward only (except reset to thinking).
 */
export function transitionGoalPhase(project, goalId, newPhase, extra = {}) {
  const stateMap = loadGoalStates(project);
  const current = getGoalState(stateMap, goalId);
  const oldPhase = current.phase;

  const oldIdx = GOAL_PHASES.indexOf(oldPhase);
  const newIdx = GOAL_PHASES.indexOf(newPhase);
  if (newIdx < 0) return current;
  if (newIdx <= oldIdx && newPhase !== 'thinking') return current;

  current.phase = newPhase;
  Object.assign(current, extra);

  saveGoalStates(project, stateMap);
  log.info({ project, goalId: goalId.slice(0, 8), from: oldPhase, to: newPhase }, 'Goal phase transition');
  return current;
}

/**
 * Record what happened in the last cycle for a goal.
 * Called after each project cycle processes its reply.
 */
export function recordCycleSummary(project, goalId, summary, action = null) {
  const stateMap = loadGoalStates(project);
  const current = getGoalState(stateMap, goalId);
  current.lastCycleSummary = summary;
  current.lastCycleAction = action;
  current.lastCycleAt = Date.now();
  saveGoalStates(project, stateMap);
}

/**
 * Record a general project cycle summary (not goal-specific).
 */
export function recordProjectCycleSummary(project, summary, actions = []) {
  const key = `cycle-summary:${project}`;
  setState(key, {
    summary,
    actions,
    at: Date.now(),
  });
}

/**
 * Get last project cycle summary.
 */
function getLastProjectCycleSummary(project) {
  return getState(`cycle-summary:${project}`) || null;
}

/**
 * Auto-detect goal phase transitions from parsed agent output.
 * Call this after parsing the agent's reply in the project cycle.
 * Fully agentic — no approval gates, just tracks what the agent is doing.
 */
export function detectPhaseTransitions(project, parsed, projectGoals) {
  const stateMap = loadGoalStates(project);

  for (const goal of projectGoals) {
    const gs = getGoalState(stateMap, goal.id);
    const goalTitle = (goal.title || '').toLowerCase();
    const goalWords = goalTitle.split(/\s+/).filter(w => w.length > 3);

    // Match actions to this goal by keyword overlap
    const goalActions = (parsed.actionsTaken || []).filter(a => {
      const al = a.toLowerCase();
      return goalWords.some(w => al.includes(w));
    });

    // Detect thinking → planning: agent did research (used search/read tools, no file writes)
    if (gs.phase === 'thinking' && goalActions.length > 0) {
      const didResearch = goalActions.some(a => /research|search|analyz|stud|investigat|check|read|list/i.test(a));
      const didPlan = goalActions.some(a => /plan|design|brief|propos|layout|decid/i.test(a));
      if (didPlan) {
        transitionGoalPhase(project, goal.id, 'planning');
        gs.phase = 'planning';
      } else if (didResearch) {
        // Stay in thinking but record progress
      }
    }

    // Detect planning → executing: agent started creating content
    if ((gs.phase === 'thinking' || gs.phase === 'planning') && goalActions.length > 0) {
      const didCreate = goalActions.some(a => /creat|deploy|writ|generat|build|implement|add.*xml|add.*script/i.test(a));
      const usedCreateTools = (parsed.toolCalls || []).some(tc => {
        const name = (tc.name || '').toLowerCase();
        return name.includes('deploy') || name.includes('create') || name.includes('write') || name.includes('generate');
      });
      const usedChain = (parsed.chainPlans || []).length > 0;
      if (didCreate || usedCreateTools || usedChain) {
        transitionGoalPhase(project, goal.id, 'executing');
        gs.phase = 'executing';
      }
    }

    // Detect executing → validating: agent started checking/testing
    if (gs.phase === 'executing' && goalActions.length > 0) {
      const didValidate = goalActions.some(a => /validat|test|verif|check|fix|correct|confirm/i.test(a));
      if (didValidate) {
        transitionGoalPhase(project, goal.id, 'validating');
        gs.phase = 'validating';
      }
    }

    // Detect reporting: agent sent summary to Ron
    if ((gs.phase === 'executing' || gs.phase === 'validating') && parsed.waMessages?.length > 0) {
      const sentReport = parsed.waMessages.some(msg => {
        const m = msg.toLowerCase();
        return (m.includes('complete') || m.includes('done') || m.includes('deployed') || m.includes('summary'))
          && goalWords.some(w => m.includes(w));
      });
      if (sentReport) {
        transitionGoalPhase(project, goal.id, 'reporting');
        gs.phase = 'reporting';
      }
    }

    // Detect done: milestone completed or goal at 100%
    const goalDone = (parsed.milestoneCompletes || []).some(mc => mc.goalId === goal.id);
    const goalUpdatedDone = (parsed.goalUpdates || []).some(gu => gu.id === goal.id && (gu.status === 'completed' || gu.progress >= 100));
    if (goalDone || goalUpdatedDone) {
      transitionGoalPhase(project, goal.id, 'done');
      gs.phase = 'done';
    }

    // Record cycle summary for this goal
    if (goalActions.length > 0) {
      recordCycleSummary(project, goal.id, goalActions.join('; ').slice(0, 500), gs.phase);
    }
  }

  // Record overall project cycle summary
  if (parsed.actionsTaken?.length > 0) {
    recordProjectCycleSummary(project, parsed.actionsTaken.map(a => a.slice(0, 200)).join('; ').slice(0, 1000), parsed.actionsTaken);
  }

  saveGoalStates(project, stateMap);
}

// ─── Config Loading & Section Parsing ────────────────────────────────────────

function loadConfig(project) {
  const configPath = join(CONFIGS_DIR, `${project}.json`);
  if (!existsSync(configPath)) return null;

  const mtime = statSync(configPath).mtimeMs;
  const cached = _cache.get(project);
  if (cached && cached.configMtime === mtime) return cached;

  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8'));
    const entry = { config: raw, configMtime: mtime, sections: new Map(), phases: new Map(), filesMtime: new Map() };

    for (const cf of (raw.contextFiles || [])) {
      const filePath = join(process.cwd(), cf.path);
      if (!existsSync(filePath)) continue;
      const fMtime = statSync(filePath).mtimeMs;
      entry.filesMtime.set(cf.path, fMtime);

      const content = readFileSync(filePath, 'utf8').replace(/^---[\s\S]*?---\s*/, '');
      const maxLen = cf.maxPerSection || 3000;

      if (cf.type === 'sections') {
        const parts = content.split(/^## /m);
        for (const part of parts) {
          if (!part.trim()) continue;
          const firstLine = part.split('\n')[0].trim().toLowerCase();
          for (const [key, pattern] of Object.entries(raw.sectionDetectors || {})) {
            if (new RegExp(pattern, 'i').test(firstLine)) {
              entry.sections.set(key, `## ${part}`.slice(0, maxLen));
              break;
            }
          }
        }
      } else if (cf.type === 'phases') {
        const phaseParts = content.split(/^## Phase /m);
        for (const pp of phaseParts) {
          if (!pp.trim()) continue;
          const firstLine = pp.split('\n')[0].trim().toLowerCase();
          for (const [key, pattern] of Object.entries(raw.phaseDetectors || {})) {
            if (new RegExp(pattern, 'i').test(firstLine)) {
              entry.phases.set(key, `## Phase ${pp}`.slice(0, maxLen));
              break;
            }
          }
        }
        const templateMatches = content.matchAll(/### (\w[\w\s]*) (?:Plan )?Template:[\s\S]*?(?=###|$)/gi);
        for (const tm of templateMatches) {
          const tKey = `plan_${tm[1].trim().toLowerCase().replace(/\s+/g, '_')}`;
          entry.phases.set(tKey, tm[0].slice(0, 1500));
        }
        const idReg = content.match(/## ID Registry[\s\S]*$/);
        if (idReg) entry.phases.set('id_registry', idReg[0].slice(0, 2000));
      }
    }

    _cache.set(project, entry);
    log.info({ project, sections: entry.sections.size, phases: entry.phases.size }, 'Project injection config loaded');
    return entry;
  } catch (err) {
    log.warn({ project, err: err.message }, 'Failed to load project injection config');
    return null;
  }
}

function checkStale(project) {
  const cached = _cache.get(project);
  if (!cached) return;
  for (const [path, mtime] of cached.filesMtime) {
    const filePath = join(process.cwd(), path);
    if (existsSync(filePath) && statSync(filePath).mtimeMs !== mtime) {
      _cache.delete(project);
      return;
    }
  }
}

function classifyWork(text, workTypes) {
  const t = (text || '').toLowerCase();
  const types = [];
  for (const [typeName, def] of Object.entries(workTypes || {})) {
    if (new RegExp(`\\b(${def.keywords})\\b`, 'i').test(t)) {
      types.push(typeName);
    }
  }
  return [...new Set(types)];
}

// ─── Main Injection Builder ──────────────────────────────────────────────────

/**
 * Build the per-cycle injection for ANY project.
 */
export function buildProjectInjection(project, signals = [], followups = []) {
  checkStale(project);
  const entry = loadConfig(project);
  if (!entry) return '';

  const cfg = entry.config;
  const goalStates = loadGoalStates(project);

  // Gather active goals for this project
  const projectGoals = listGoals({ status: ['active', 'in_progress'] })
    .filter(g => g.project === project);

  // Filter followups relevant to this project
  const goalIds = new Set(projectGoals.map(g => g.id));
  const projectFollowups = followups.filter(f => {
    if (f.goalId && goalIds.has(f.goalId)) return true;
    const topic = (f.topic || '').toLowerCase();
    return Object.values(cfg.workTypes || {}).some(wt =>
      new RegExp(`\\b(${wt.keywords})\\b`, 'i').test(topic)
    );
  });

  if (projectGoals.length === 0 && projectFollowups.length === 0 && signals.length === 0) {
    return '';
  }

  const parts = [];

  // ── 0. Previous cycle summary (#2 + #4) ──
  const lastCycle = getLastProjectCycleSummary(project);
  if (lastCycle?.summary) {
    const ago = lastCycle.at ? Math.round((Date.now() - lastCycle.at) / 60_000) : '?';
    parts.push(`## Last Cycle (${ago}min ago)\n${lastCycle.summary}`);
  }

  // ── 1. Hard rules (always injected) ──
  if (cfg.rules?.length) {
    parts.push(`## Project Rules (${project})\n${cfg.rules.map(r => `**${r}**`).join('\n')}`);
  }

  // ── 2. Chain templates ──
  if (cfg.chainTemplates && Object.keys(cfg.chainTemplates).length > 0) {
    const lines = Object.entries(cfg.chainTemplates).map(([type, tmpl]) => `- New ${type}: ${tmpl}`);
    parts.push(`### Chain Plan Templates\nUse chain_plan for automated workflows:\n${lines.join('\n')}`);
  }

  // ── 3. Per-goal context with approval state ──
  const neededSections = new Set(cfg.alwaysSections || []);
  const neededPhases = new Set(cfg.alwaysPhases || []);

  for (const goal of projectGoals) {
    const goalText = `${goal.title} ${goal.description || ''} ${(goal.milestones || []).map(m => m.title || m.id).join(' ')}`;
    const workTypes = classifyWork(goalText, cfg.workTypes);

    // Get tracked goal phase (more reliable than milestone-name guessing)
    const gs = getGoalState(goalStates, goal.id);
    const goalPhase = gs.phase;

    // Collect needed sections and phases from work types
    for (const wt of workTypes) {
      const mapping = cfg.workTypes[wt];
      if (mapping) {
        (mapping.sections || []).forEach(s => neededSections.add(s));
        // Inject plan templates if still in early stages
        if (['thinking', 'planning'].includes(goalPhase)) {
          (mapping.phases || []).forEach(p => neededPhases.add(p));
          neededPhases.add(`plan_${wt}`);
        }
      }
    }

    // Phase-specific protocol injection
    if (goalPhase === 'thinking') {
      neededPhases.add('think');
      neededPhases.add('plan');
    } else if (goalPhase === 'planning') {
      neededPhases.add('plan');
      neededPhases.add('execute');
    } else if (goalPhase === 'executing') {
      neededPhases.add('execute');
      neededPhases.add('validate');
    } else if (goalPhase === 'validating' || goalPhase === 'reporting') {
      neededPhases.add('validate');
      neededPhases.add('report');
    }

    // Goal brief with phase state + instruction
    const pendingMs = (goal.milestones || []).filter(m => m.status !== 'completed' && m.status !== 'done' && m.status !== 'skipped');
    const nextMs = pendingMs[0];
    const instruction = PHASE_INSTRUCTIONS[goalPhase] || '';

    let goalBlock = `### Goal: ${goal.title} (${goal.progress || 0}%)
**Phase:** ${goalPhase} | **Work types:** ${workTypes.join(', ') || 'general'}
**Next milestone:** ${nextMs ? (nextMs.title || nextMs.id) : 'none'}
**What to do:** ${instruction}`;

    // Inject last cycle's action for this goal (cycle memory)
    if (gs.lastCycleSummary) {
      const cycleAgo = gs.lastCycleAt ? Math.round((Date.now() - gs.lastCycleAt) / 60_000) : '?';
      goalBlock += `\n**Last cycle (${cycleAgo}min ago):** ${gs.lastCycleSummary}`;
    }

    parts.push(goalBlock);
  }

  // ── 4. Followup context ──
  if (projectFollowups.length > 0) {
    parts.push(`### Pending Followups\n${projectFollowups.map(f => `- ${f.topic}${f.goalId ? ` (goal: ${f.goalId.slice(0, 8)})` : ''}`).join('\n')}`);
    for (const f of projectFollowups) {
      const workTypes = classifyWork(f.topic, cfg.workTypes);
      for (const wt of workTypes) {
        const mapping = cfg.workTypes[wt];
        if (mapping) (mapping.sections || []).forEach(s => neededSections.add(s));
      }
    }
  }

  // ── 5. Inject ONLY needed doc sections ──
  if (neededSections.size > 0 && entry.sections.size > 0) {
    parts.push(`### Reference Docs (for this cycle)`);
    for (const sec of neededSections) {
      if (entry.sections.has(sec)) parts.push(entry.sections.get(sec));
    }
  }

  // ── 6. Inject relevant protocol phases ──
  if (neededPhases.size > 0 && entry.phases.size > 0) {
    parts.push(`### Execution Protocol (relevant phases)`);
    for (const phase of neededPhases) {
      if (entry.phases.has(phase)) parts.push(entry.phases.get(phase));
    }
    if (entry.phases.has('id_registry')) parts.push(entry.phases.get('id_registry'));
  }

  return parts.join('\n\n');
}

/**
 * List all projects that have injection configs.
 */
export function listProjectInjections() {
  if (!existsSync(CONFIGS_DIR)) return [];
  return readdirSync(CONFIGS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}
