/**
 * Lazy Context — Progressive disclosure for agent-loop prompts.
 *
 * Instead of dumping all context upfront, this module:
 * 1. Filters context sections based on signal relevance
 * 2. Provides a load_context tool for on-demand detail expansion
 * 3. Tracks token savings per cycle
 *
 * Part of goal 3225c8de (Progressive Disclosure in Agent Prompts).
 */

import { createLogger } from './logger.js';
import { registerTool } from './tool-bridge.js';
import { getGoalsContext, getGoalsContextCompact, listGoals, getGoal } from './goals.js';
import { formatLearningContext as formatLearningContextSync } from './learning-journal.js';
import { formatReasoningContext } from './reasoning-journal.js';
import { formatPatternInsights } from './outcome-tracker.js';
import { getModuleContextProviders } from './module-loader.js';

const log = createLogger('lazy-context');

// ─── Signal-to-context relevance mapping ──────────────────────────────────────
// Maps signal types to the context sections they need

const SIGNAL_CONTEXT_MAP = {
  // Hattrick signals need the weekly plan context provider
  hattrick_match_prep: ['moduleContext'],
  hattrick_post_match_review: ['moduleContext'],
  hattrick_transfers: ['moduleContext'],
  hattrick_lineup: ['moduleContext'],
  hattrick_planning: ['moduleContext'],
  hattrick_autonomous_bid: ['moduleContext'],
  hattrick_match_today: ['moduleContext'],

  // Reply/pattern signals need pattern insights
  pattern_observed: ['patternInsights'],
  reply_quality: ['patternInsights'],

  // Goal work needs full goal details
  goal_work: ['fullGoals'],
  stale_goal: ['fullGoals'],
  blocked_goal: ['fullGoals'],
  goal_progress: ['fullGoals'],

  // Error signals need error analytics (already conditional)
  error_spike: ['errorAnalytics'],

  // Learning-relevant signals
  followup: ['learningContext'],
};

/**
 * Determine which context sections are relevant for the current signals.
 * @param {Array} signals - Picked signals for this cycle
 * @returns {Set<string>} - Set of relevant section names
 */
export function getRelevantSections(signals) {
  const sections = new Set();

  for (const sig of signals) {
    const mapped = SIGNAL_CONTEXT_MAP[sig.type];
    if (mapped) {
      for (const s of mapped) sections.add(s);
    }

    // High/critical urgency always gets full context
    if (sig.urgency === 'high' || sig.urgency === 'critical') {
      sections.add('fullGoals');
      sections.add('moduleContext');
      sections.add('learningContext');
    }
  }

  return sections;
}

/**
 * Build goals context with progressive disclosure.
 * - If fullGoals section is relevant: full context (with milestones, next step)
 * - Otherwise: compact context (titles + progress only)
 * - For signal-specific goals: inject only the referenced goal's details
 *
 * @param {Array} signals - Current cycle signals
 * @param {boolean} useSonnet - Whether this is a Sonnet cycle
 * @returns {string} Goals context string
 */
export function buildGoalsContextLazy(signals, useSonnet, { excludeProjects = null } = {}) {
  const sections = getRelevantSections(signals);

  if (sections.has('fullGoals') && useSonnet) {
    return getGoalsContext(null, excludeProjects);
  }

  // For non-fullGoals cycles, use compact + inject specific referenced goals
  let base = getGoalsContextCompact(null, excludeProjects);

  // If a goal_work signal references a specific goal, inject its full details
  const goalSignals = signals.filter(s =>
    (s.type === 'goal_work' || s.type === 'stale_goal' || s.type === 'blocked_goal') && s.data?.goalId
  );
  if (goalSignals.length > 0 && useSonnet) {
    const extraGoals = goalSignals
      .map(s => getGoal(s.data.goalId))
      .filter(Boolean)
      .map(g => {
        const nextMs = g.milestones?.find(m => m.status === 'pending');
        return `  → ${g.title}: ${g.description || ''}${nextMs ? `\n    Next milestone: ${nextMs.title}` : ''}`;
      });
    if (extraGoals.length > 0) {
      base += '\n\n## Referenced goal details:\n' + extraGoals.join('\n');
    }
  }

  return base;
}

/**
 * Build module context with signal relevance gating.
 * Only injects module context providers when a related signal is present.
 *
 * @param {Array} signals - Current cycle signals
 * @returns {string[]} Array of context strings to inject
 */
export function buildModuleContextLazy(signals) {
  const sections = getRelevantSections(signals);

  // If no module-related signal, skip all module context providers
  if (!sections.has('moduleContext')) {
    return [];
  }

  const results = [];
  for (const provider of getModuleContextProviders()) {
    try {
      const ctx = provider();
      if (ctx) results.push(ctx);
    } catch {}
  }
  return results;
}

/**
 * Build pattern insights with signal relevance gating.
 * Only includes full insights when reply/pattern signals are present.
 *
 * @param {Array} signals - Current cycle signals
 * @returns {string|null} Pattern insights string or null
 */
export function buildPatternInsightsLazy(signals) {
  const sections = getRelevantSections(signals);

  if (sections.has('patternInsights')) {
    return formatPatternInsights(30);
  }

  // Minimal: last 7 days, compact format
  const compact = formatPatternInsights(7);
  return compact || null;
}

/**
 * Build learning context with relevance gating.
 * Only includes when signals indicate learning is relevant.
 *
 * @param {Array} signals - Current cycle signals
 * @param {boolean} useSonnet - Whether Sonnet cycle
 * @returns {string|null} Learning context or null
 */
export function buildLearningContextLazy(signals, useSonnet) {
  if (!useSonnet) return null;

  const sections = getRelevantSections(signals);

  // Always include for high-urgency cycles, otherwise gate
  if (sections.has('learningContext') || sections.has('fullGoals')) {
    return formatLearningContextSync(5);
  }

  // Skip learning context for cycles that don't need it
  return null;
}

/**
 * Build reasoning journal with staleness check.
 * Only includes if open hypotheses are < 3 days old.
 *
 * @param {Array} signals - Current cycle signals
 * @param {boolean} useSonnet - Whether Sonnet cycle
 * @returns {string|null} Reasoning context or null
 */
export function buildReasoningContextLazy(signals, useSonnet) {
  if (!useSonnet) return null;

  // Always include for high-urgency
  const hasHighUrgency = signals.some(s => s.urgency === 'high' || s.urgency === 'critical');
  if (hasHighUrgency) {
    return formatReasoningContext();
  }

  // For standard cycles, include only if we have recent hypotheses
  try {
    const ctx = formatReasoningContext();
    // If reasoning context is very short (< 100 chars), it's probably empty/stale
    if (ctx && ctx.length > 100) return ctx;
  } catch {}

  return null;
}

// ─── Token savings tracking ─────────────────────────────────────────────────

let totalTokensSaved = 0;
let cycleCount = 0;

/**
 * Record estimated token savings for a cycle.
 * @param {number} savedTokens - Estimated tokens saved
 */
export function recordSavings(savedTokens) {
  totalTokensSaved += savedTokens;
  cycleCount++;
}

/**
 * Get cumulative savings stats.
 * @returns {{ totalTokensSaved: number, cycleCount: number, avgPerCycle: number }}
 */
export function getSavingsStats() {
  return {
    totalTokensSaved,
    cycleCount,
    avgPerCycle: cycleCount > 0 ? Math.round(totalTokensSaved / cycleCount) : 0,
  };
}

// ─── load_context tool registration ──────────────────────────────────────────

/**
 * Register the load_context tool that lets the agent request full context on-demand.
 * This enables the progressive disclosure pattern — agent gets compact context by default,
 * and can expand specific sections when needed.
 */
export function registerContextTools() {
  registerTool({
    name: 'load_context',
    description: 'Load full details for a context section (goals, learning, reasoning, patterns). Use when compact context is insufficient.',
    async execute(params) {
      const { section, goalId } = params || {};

      switch (section) {
        case 'goals':
          return { success: true, result: getGoalsContext() };

        case 'goal': {
          if (!goalId) return { success: false, error: 'goalId required for section=goal' };
          const g = getGoal(goalId);
          if (!g) return { success: false, error: `Goal ${goalId} not found` };
          return {
            success: true,
            result: {
              ...g,
              milestones: g.milestones?.map(m => `[${m.status}] ${m.title}`).join('\n'),
            }
          };
        }

        case 'learning':
          return { success: true, result: formatLearningContextSync(10) || 'No learning entries.' };

        case 'reasoning':
          return { success: true, result: formatReasoningContext() || 'No open hypotheses.' };

        case 'patterns':
          return { success: true, result: formatPatternInsights(30) || 'No pattern data.' };

        case 'modules': {
          const parts = [];
          for (const provider of getModuleContextProviders()) {
            try { const ctx = provider(); if (ctx) parts.push(ctx); } catch {}
          }
          return { success: true, result: parts.join('\n\n') || 'No module context.' };
        }

        default:
          return {
            success: false,
            error: `Unknown section: ${section}. Available: goals, goal, learning, reasoning, patterns, modules`
          };
      }
    }
  });

  log.info('load_context tool registered for progressive disclosure');
}
