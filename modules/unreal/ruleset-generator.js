/**
 * modules/unreal/ruleset-generator.js — Generate JSON gameplay rulesets via Claude.
 *
 * Claude generates entity behavior rulesets (combat rules, NPC behavior, ability rules)
 * as JSON files saved to ShatteredCrown/Content/Data/Rulesets/.
 * These are read at runtime by ULogicInterpreter to drive data-driven gameplay.
 *
 * Ruleset format:
 * {
 *   "id": "entity_id",
 *   "rules": [
 *     {
 *       "trigger": "on_tick|on_hit|on_death|on_spawn|on_enter_range|on_ability_use",
 *       "conditions": [{ "stat": "health", "op": "lt|gt|eq|ne|lte|gte", "value": 0.3 }],
 *       "actions":    [{ "type": "set_state", "value": "flee" }]
 *     }
 *   ]
 * }
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../lib/logger.js';
import { chatOneShot } from '../../lib/claude.js';

const log = createLogger('ruleset-generator');

// ── Paths ─────────────────────────────────────────────────────────────────────

const CONTENT_DIR   = 'C:/Users/rdiol/sela/workspace/shattered-crown/ShatteredCrown/Content';
const RULESETS_DIR  = join(CONTENT_DIR, 'Data', 'Rulesets');

// ── Schema reference included in every prompt ─────────────────────────────────

const SCHEMA_DOC = `
Ruleset JSON schema:
{
  "id": "entity_id",           // must match the entityId passed in
  "rules": [
    {
      "trigger": "on_tick|on_hit|on_death|on_spawn|on_enter_range|on_ability_use",
      "conditions": [           // all must be true; empty = always fire
        { "stat": "<key>", "op": "lt|gt|eq|ne|lte|gte", "value": <number> }
      ],
      "actions": [              // dispatched in order via OnAction delegate
        { "type": "set_state",       "value": "flee|attack|idle|patrol|enrage|dead" },
        { "type": "play_montage",    "value": "AnimMontageAssetName" },
        { "type": "apply_damage",    "value": "15" },
        { "type": "apply_effect",    "value": "GE_StatusEffectName" },
        { "type": "spawn_actor",     "value": "BP_ActorClass" },
        { "type": "set_speed",       "value": "600" },
        { "type": "broadcast_event", "value": "EventName" }
      ]
    }
  ]
}
Notes:
- action "value" is always a string (even for numbers)
- stat keys should be snake_case (health, move_speed, aggro_distance, phase, etc.)
- health stat is normalized 0.0–1.0 (0.2 = 20% health)
- conditions array can be empty (rule fires unconditionally on trigger)
`.trim();

// ── JSON extractor ────────────────────────────────────────────────────────────

function extractJson(text) {
  if (!text || typeof text !== 'string') return null;
  try { return JSON.parse(text.trim()); } catch { /* fall through */ }
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch { /* fall through */ }
  }
  return null;
}

// ── Path helpers ──────────────────────────────────────────────────────────────

/** Returns the full path for a ruleset JSON file. */
export function getRulesetPath(id) {
  return join(RULESETS_DIR, `${id}.json`);
}

function ensureRulesetsDir() {
  if (!existsSync(RULESETS_DIR)) mkdirSync(RULESETS_DIR, { recursive: true });
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildRulesetPrompt(entityId, description) {
  return `Generate a ULogicInterpreter JSON ruleset for The Shattered Crown (dark fantasy action-RPG).

Entity ID: "${entityId}"
Description: ${description}

${SCHEMA_DOC}

Design realistic, game-ready rules. Use multiple triggers (on_spawn, on_tick, on_hit, on_death, etc.)
to cover the full lifecycle of this entity. Include at least 4 rules.

Return ONLY valid JSON — no explanation, no markdown, no code fences.
The "id" field must be exactly: "${entityId}"`;
}

// ── Core generator ────────────────────────────────────────────────────────────

/**
 * Generate a ruleset JSON for the given entity and save it to Content/Data/Rulesets/.
 * Returns { success, path, ruleCount } or { success: false, error }.
 * Skips if file already exists.
 */
export async function generateRuleset(entityId, description) {
  log.info({ entityId }, 'Generating ruleset');

  const outPath = getRulesetPath(entityId);

  if (existsSync(outPath)) {
    log.info({ entityId }, 'Ruleset already exists — skipping');
    return { success: true, skipped: true, path: outPath };
  }

  const prompt = buildRulesetPrompt(entityId, description);
  let parsed;

  try {
    const result = await chatOneShot(prompt, null);
    parsed = extractJson(result.reply);
    if (!parsed?.id || !Array.isArray(parsed?.rules)) {
      throw new Error(`Claude returned invalid ruleset (missing id or rules array)`);
    }
    if (parsed.id !== entityId) {
      // Fix mismatched ID silently
      parsed.id = entityId;
    }
  } catch (err) {
    log.error({ err: err.message, entityId }, 'Claude ruleset generation failed');
    return { success: false, error: err.message };
  }

  ensureRulesetsDir();

  try {
    writeFileSync(outPath, JSON.stringify(parsed, null, 2), 'utf-8');
    log.info({ entityId, rules: parsed.rules.length, path: outPath }, 'Ruleset saved');
    return { success: true, path: outPath, ruleCount: parsed.rules.length };
  } catch (err) {
    log.error({ err: err.message, entityId }, 'Failed to write ruleset file');
    return { success: false, error: err.message };
  }
}

// ── Batch generator ───────────────────────────────────────────────────────────

/** Generate all 5 default rulesets for The Shattered Crown. */
export async function generateAllRulesets() {
  const entities = [
    { entityId: 'combat_base',  description: 'Base combat rules: attack, dodge, take damage, death' },
    { entityId: 'enemy_ash',    description: 'Ash Wilds enemy: patrol, aggro on sight, attack, flee at 20% hp' },
    { entityId: 'boss_ash',     description: 'Ash boss: 3 phases, enrage at 50%, AoE at 25%' },
    { entityId: 'npc_generic',  description: 'Friendly NPC: idle, greet player on approach, give quest, farewell' },
    { entityId: 'ability_base', description: 'Ability rules: activation check, cooldown, resource cost, cancel on stagger' },
  ];

  const results = [];
  for (const { entityId, description } of entities) {
    const r = await generateRuleset(entityId, description);
    results.push({ entityId, ...r });
    if (!r.success && !r.skipped) {
      log.warn({ entityId }, 'Ruleset generation failed, continuing with next');
    }
  }

  return {
    success: results.every(r => r.success),
    results,
    generated: results.filter(r => r.success && !r.skipped).length,
    skipped:   results.filter(r => r.skipped).length,
    failed:    results.filter(r => !r.success).length,
  };
}
