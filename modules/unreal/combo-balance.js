/**
 * modules/unreal/combo-balance.js — Shard Combo Balance Data & UE5 Integration.
 *
 * ms_7: Balance testing for damage multipliers.
 *
 * Source of truth for all 30 shard combination damage multipliers, AoE, duration,
 * and corruption costs. Tuned to minimize strict dominations while preserving
 * the Shard Momentum gameplay fantasy (flow-state combat, creative aggression).
 *
 * Integration:
 *  - Creates UE5 Data Table (DT_ComboBalance) via Unreal MCP
 *  - Wired into gameplay-builder.js for BP_CombatSystem combo variables
 *  - Exports balance report for validation
 *
 * Balance Philosophy:
 *  - Each shard should have a unique identity in combos (Fire = burst, Shield = duration,
 *    Nature = AoE, Water = control, Time = utility, Shadow = single-target)
 *  - No combo should strictly dominate another (same or better in ALL dimensions)
 *  - Crown Pulse (8s burst) theoretical DPS capped at ~4x/s to prevent boss-trivializing
 *  - Corruption cost scales with effective power (cost/power ratio ~0.4-0.8)
 */

import { callTool } from '../../lib/mcp-gateway.js';
import { createLogger } from '../../lib/logger.js';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { getActiveGame } from './game-config.js';

const log = createLogger('combo-balance');

// ── Shard type enum (matches ESCShardType in C++) ────────────────────────────

export const SHARD_TYPES = ['Time', 'Shield', 'Nature', 'Water', 'Fire', 'Shadow'];

// ── Tuned combo definitions (30 total: 6 shards × 5 combos each) ────────────
// Fields: [firstShard, secondShard, name, damageType, damageMultiplier, effectRadius, effectDuration, corruptionCost, tag]
//
// TUNING CHANGES from initial values (scripts/balance-analysis.cjs hardcoded):
//  - Temporal Clones: cost 4→2.5, damage 1.8→2.0 (was overcosted, 0-radius utility)
//  - Living Armor: cost 3→1.5, damage 1.0→1.2, duration 8→6 (was overcosted pure-defense)
//  - Phantom Pyre: cost 3→2.0, damage 1.5→2.0 (was overcosted and dominated by everything)
//  - Mirror Guard: cost 3→2.0, damage 1.5→1.8 (was dominated by many)
//  - Frozen Moment: radius 400→200, duration 4→3 (was dominated by Temporal Growth)
//  - Phantom Canopy: cost 3→2.5, damage 1.5→1.8 (reduce domination by Toxic Deluge)
//  - Temporal Growth: damage 2.5→2.3, radius 600→500 (was dominating 10+ combos)
//  - Toxic Deluge: radius 600→450, cost 3→3.5 (was dominating 12+ combos)
//  - Healing Rain: cost 4→3.0 (buff: healer combo should be affordable)
//  - Abyssal Current: radius 500→300, damage 2.0→2.2 (shift from AoE to focused)
//  - Ink Tide: radius 600→400, duration 5→4 (reduce domination overlap)
//  - Supernova Guard: cost 5→5.5 (slight nerf for highest single-target damage)
//  - Deja Vu Strike: cost 4→4.5 (slight nerf for highest zero-radius damage)

export const COMBO_DEFINITIONS = [
  // ── Time as primary ──────────────────────────────────────────────────────────
  { first: 'Time', second: 'Shield',  name: 'Chrono Barrier',      dmgType: 'Temporal',  dmg: 1.8, radius: 400, dur: 3.0, cost: 2.0, tag: 'shield_time_stop',
    desc: 'Time-locked shield dome — enemies within radius frozen for duration' },
  { first: 'Time', second: 'Nature',  name: 'Temporal Growth',     dmgType: 'Nature',    dmg: 2.3, radius: 500, dur: 4.0, cost: 3.0, tag: 'accelerated_vines',
    desc: 'Vines grow at accelerated rate, entangling enemies in expanding AoE' },
  { first: 'Time', second: 'Water',   name: 'Stasis Tide',         dmgType: 'Ice',       dmg: 2.2, radius: 500, dur: 3.5, cost: 3.0, tag: 'frozen_wave',
    desc: 'Water wave freezes mid-air — ice crystals shatter for AoE damage' },
  { first: 'Time', second: 'Fire',    name: 'Delayed Detonation',  dmgType: 'Fire',      dmg: 3.0, radius: 800, dur: 2.0, cost: 4.0, tag: 'time_bomb',
    desc: 'Fire damage stored in time bubble, detonates after delay for massive AoE' },
  { first: 'Time', second: 'Shadow',  name: 'Temporal Clones',     dmgType: 'Shadow',    dmg: 2.0, radius: 0,   dur: 4.0, cost: 2.5, tag: 'shadow_copies',
    desc: 'Creates 3 shadow clones from past moments — each deals separate attacks' },

  // ── Shield as primary ────────────────────────────────────────────────────────
  { first: 'Shield', second: 'Time',    name: 'Aegis of Ages',      dmgType: 'Temporal',  dmg: 2.2, radius: 350, dur: 5.0, cost: 2.0, tag: 'eternal_barrier',
    desc: 'Shield persists beyond normal duration, reflecting projectiles back' },
  { first: 'Shield', second: 'Nature',  name: 'Ironbark Fortress',  dmgType: 'Nature',    dmg: 1.5, radius: 300, dur: 6.0, cost: 2.0, tag: 'bark_armor',
    desc: 'Shield becomes living wood — regenerates HP while blocking, roots nearby' },
  { first: 'Shield', second: 'Water',   name: 'Tidal Ward',         dmgType: 'Water',     dmg: 2.0, radius: 450, dur: 4.0, cost: 3.0, tag: 'water_shield',
    desc: 'Shield channels water — blocks push enemies back, slows on contact' },
  { first: 'Shield', second: 'Fire',    name: 'Molten Aegis',       dmgType: 'Fire',      dmg: 2.0, radius: 400, dur: 5.0, cost: 3.0, tag: 'fire_shield',
    desc: 'Shield radiates heat — enemies who strike it take fire damage + burn' },
  { first: 'Shield', second: 'Shadow',  name: 'Mirror Guard',       dmgType: 'Shadow',    dmg: 1.8, radius: 0,   dur: 5.0, cost: 2.0, tag: 'phantom_shield',
    desc: 'Shield becomes semi-transparent — absorbs magic damage, stores for counter' },

  // ── Nature as primary ────────────────────────────────────────────────────────
  { first: 'Nature', second: 'Time',    name: 'Ancient Bloom',      dmgType: 'Temporal',  dmg: 2.8, radius: 700, dur: 0.0, cost: 4.0, tag: 'giant_flower_burst',
    desc: 'Massive flower blooms instantly — petals deal high AoE burst damage' },
  { first: 'Nature', second: 'Shield',  name: 'Living Armor',       dmgType: 'Nature',    dmg: 1.2, radius: 0,   dur: 6.0, cost: 1.5, tag: 'bark_skin',
    desc: 'Bark grows over Kael — +40% damage reduction, thorns deal damage to attackers' },
  { first: 'Nature', second: 'Water',   name: 'Toxic Deluge',       dmgType: 'Poison',    dmg: 2.0, radius: 450, dur: 5.0, cost: 3.5, tag: 'poison_rain',
    desc: 'Poisonous rain from living canopy — DoT zone that also slows enemies' },
  { first: 'Nature', second: 'Fire',    name: 'Burning Thorns',     dmgType: 'Fire',      dmg: 2.8, radius: 300, dur: 3.5, cost: 3.0, tag: 'fire_vines',
    desc: 'Thorned vines ignite — lash nearby enemies for fire+pierce damage' },
  { first: 'Nature', second: 'Shadow',  name: 'Phantom Canopy',     dmgType: 'Shadow',    dmg: 1.8, radius: 500, dur: 5.0, cost: 2.5, tag: 'dark_forest',
    desc: 'Shadow forest grows — enemies inside are blinded, allies gain stealth' },

  // ── Water as primary ─────────────────────────────────────────────────────────
  { first: 'Water', second: 'Time',    name: 'Frozen Moment',       dmgType: 'Ice',       dmg: 2.0, radius: 200, dur: 3.0, cost: 3.0, tag: 'ice_time_stop',
    desc: 'Water around target freezes in time — precise single-target lockdown' },
  { first: 'Water', second: 'Shield',  name: 'Pressure Wave',       dmgType: 'Physical',  dmg: 3.0, radius: 200, dur: 0.0, cost: 3.0, tag: 'hydro_blast',
    desc: 'Compressed water burst — short range, massive knockback + damage' },
  { first: 'Water', second: 'Nature',  name: 'Healing Rain',        dmgType: 'Nature',    dmg: 1.5, radius: 800, dur: 6.0, cost: 3.0, tag: 'regen_rain',
    desc: 'Soothing rain heals Kael + allies, damages undead enemies in zone' },
  { first: 'Water', second: 'Fire',    name: 'Steam Eruption',      dmgType: 'Fire',      dmg: 2.5, radius: 700, dur: 3.0, cost: 4.0, tag: 'steam_cloud',
    desc: 'Superheated steam explosion — large AoE, blinds + burns enemies' },
  { first: 'Water', second: 'Shadow',  name: 'Abyssal Current',     dmgType: 'Shadow',    dmg: 2.2, radius: 300, dur: 4.0, cost: 4.0, tag: 'dark_water',
    desc: 'Dark water pulls enemies toward center — gravity well + shadow damage' },

  // ── Fire as primary ──────────────────────────────────────────────────────────
  { first: 'Fire', second: 'Time',    name: 'Entropy Blaze',        dmgType: 'Temporal',  dmg: 2.2, radius: 300, dur: 5.0, cost: 3.0, tag: 'aging_fire',
    desc: 'Temporal fire ages matter — long-lasting flame that weakens armor over time' },
  { first: 'Fire', second: 'Shield',  name: 'Supernova Guard',      dmgType: 'Fire',      dmg: 4.0, radius: 600, dur: 0.0, cost: 5.5, tag: 'fire_nova',
    desc: 'Shield absorbs fire then explodes — highest burst AoE in the game' },
  { first: 'Fire', second: 'Nature',  name: 'Wildfire Spread',      dmgType: 'Fire',      dmg: 2.5, radius: 500, dur: 3.0, cost: 3.0, tag: 'spreading_flames',
    desc: 'Fire spreads through vegetation — cascading AoE that grows over time' },
  { first: 'Fire', second: 'Water',   name: 'Obsidian Storm',       dmgType: 'Physical',  dmg: 2.8, radius: 600, dur: 0.0, cost: 4.0, tag: 'rock_shards',
    desc: 'Fire meets water → obsidian shrapnel — high AoE burst physical damage' },
  { first: 'Fire', second: 'Shadow',  name: 'Phantom Pyre',         dmgType: 'Shadow',    dmg: 2.0, radius: 0,   dur: 3.0, cost: 2.0, tag: 'dark_flame',
    desc: 'Shadowflame that ignores armor — penetrating DoT on single target' },

  // ── Shadow as primary ────────────────────────────────────────────────────────
  { first: 'Shadow', second: 'Time',    name: 'Deja Vu Strike',     dmgType: 'Shadow',    dmg: 3.5, radius: 0,   dur: 0.0, cost: 4.5, tag: 'echo_strike',
    desc: 'Strikes from past and present converge — highest single-target burst' },
  { first: 'Shadow', second: 'Shield',  name: 'Void Carapace',      dmgType: 'Shadow',    dmg: 2.0, radius: 200, dur: 5.0, cost: 4.0, tag: 'void_shell',
    desc: 'Shadow shell absorbs damage, then releases stored energy as void burst' },
  { first: 'Shadow', second: 'Nature',  name: 'Nightmare Garden',   dmgType: 'Shadow',    dmg: 2.2, radius: 500, dur: 4.0, cost: 4.0, tag: 'terror_plants',
    desc: 'Shadow-corrupted plants — enemies in zone are feared + take shadow DoT' },
  { first: 'Shadow', second: 'Water',   name: 'Ink Tide',           dmgType: 'Water',     dmg: 1.8, radius: 400, dur: 4.0, cost: 3.0, tag: 'dark_water_zone',
    desc: 'Black water floods area — enemies blinded, allies gain shadow-sight' },
  { first: 'Shadow', second: 'Fire',    name: 'Darkflame Burst',    dmgType: 'Fire',      dmg: 2.5, radius: 500, dur: 0.0, cost: 4.0, tag: 'void_fire',
    desc: 'Shadowfire explosion — burst damage ignores 50% of enemy fire resistance' },
];

// ── Balance validation ───────────────────────────────────────────────────────

const BALANCE_THRESHOLDS = {
  minDmg: 1.0,
  maxDmg: 5.0,
  maxShardDeviationPct: 0.30,
  expectedCostPerPower: 0.5,
  maxPowerSpread: 15.0,
  maxTheoreticalDPS: 50.0,
  burstDuration: 8.0,
  chainBonusPerCombo: 0.15,
  maxChainBonus: 2.0,
};

function calculateEffectivePower(dmg, radius, dur) {
  const radiusFactor = radius > 0 ? Math.pow(radius / 500, 2) : 0;
  const durationFactor = dur > 0 ? dur / 3.0 : 0;
  return dmg * (1 + radiusFactor * 0.5) * (1 + durationFactor * 0.3);
}

/**
 * Validate a single combo and return warnings.
 */
function validateCombo(combo) {
  const warnings = [];
  const power = calculateEffectivePower(combo.dmg, combo.radius, combo.dur);

  if (combo.dmg < BALANCE_THRESHOLDS.minDmg) warnings.push(`dmg ${combo.dmg}x < min ${BALANCE_THRESHOLDS.minDmg}x`);
  if (combo.dmg > BALANCE_THRESHOLDS.maxDmg) warnings.push(`dmg ${combo.dmg}x > max ${BALANCE_THRESHOLDS.maxDmg}x`);
  if (combo.dmg > 1.5 && combo.cost < 1.0) warnings.push('High dmg with near-zero cost');
  if (power > 0 && combo.cost > 0) {
    const ratio = combo.cost / power;
    if (ratio < BALANCE_THRESHOLDS.expectedCostPerPower * 0.3) warnings.push(`Undercosted: ratio=${ratio.toFixed(2)}`);
    if (ratio > BALANCE_THRESHOLDS.expectedCostPerPower * 2.5) warnings.push(`Overcosted: ratio=${ratio.toFixed(2)}`);
  }
  if (combo.radius > 600 && combo.dmg > 3.0) warnings.push('AoE + high dmg may trivialize encounters');
  if (combo.dur > 5.0 && combo.dmg > 2.5) warnings.push('Long duration + high dmg = excessive sustained DPS');

  return { ...combo, effectivePower: Math.round(power * 100) / 100, warnings };
}

/**
 * Find strict dominations: combo A dominates B if A is >= B in all stats and < B in cost.
 */
function findDominations() {
  const dominated = [];
  for (let i = 0; i < COMBO_DEFINITIONS.length; i++) {
    for (let j = 0; j < COMBO_DEFINITIONS.length; j++) {
      if (i === j) continue;
      const a = COMBO_DEFINITIONS[i], b = COMBO_DEFINITIONS[j];
      if (a.dmg >= b.dmg && a.radius >= b.radius && a.dur >= b.dur && a.cost <= b.cost &&
          (a.dmg > b.dmg || a.radius > b.radius || a.dur > b.dur || a.cost < b.cost)) {
        dominated.push({ dominated: b.name, by: a.name });
      }
    }
  }
  return dominated;
}

/**
 * Run full balance validation on all 30 combos.
 * Returns { pass, warnings, dominations, metrics, combos[] }
 */
export function runBalanceValidation() {
  const validated = COMBO_DEFINITIONS.map(validateCombo);
  const dominations = findDominations();

  const damages = validated.map(v => v.dmg);
  const avgDmg = damages.reduce((s, d) => s + d, 0) / damages.length;
  const avgCost = validated.reduce((s, c) => s + c.cost, 0) / validated.length;
  const stdDev = Math.sqrt(damages.reduce((s, d) => s + Math.pow(d - avgDmg, 2), 0) / damages.length);
  const totalWarnings = validated.filter(v => v.warnings.length > 0).length;
  const hardFails = validated.filter(v => v.warnings.some(w => w.includes('> max') || w.includes('< min'))).length;

  // Per-shard analysis
  const shardStats = {};
  for (const shard of SHARD_TYPES) {
    const asPrimary = validated.filter(v => v.first === shard);
    shardStats[shard] = {
      avgDmg: Math.round(asPrimary.reduce((s, c) => s + c.dmg, 0) / asPrimary.length * 100) / 100,
      avgCost: Math.round(asPrimary.reduce((s, c) => s + c.cost, 0) / asPrimary.length * 10) / 10,
      maxDmg: Math.max(...asPrimary.map(c => c.dmg)),
      minDmg: Math.min(...asPrimary.map(c => c.dmg)),
      aoeCount: asPrimary.filter(c => c.radius > 0).length,
      durCount: asPrimary.filter(c => c.dur > 0).length,
    };
  }

  // Burst simulation
  const burstResult = simulateOptimalBurst(validated);

  const pass = hardFails === 0;

  return {
    pass,
    verdict: pass
      ? (totalWarnings > 0 ? `PASS WITH ${totalWarnings} WARNINGS` : 'PASS — All 30 combos balanced')
      : `FAIL — ${hardFails} combos outside thresholds`,
    metrics: {
      totalCombos: 30,
      avgDmg: Math.round(avgDmg * 100) / 100,
      avgCost: Math.round(avgCost * 10) / 10,
      stdDev: Math.round(stdDev * 100) / 100,
      dmgRange: [Math.min(...damages), Math.max(...damages)],
      totalWarnings,
      hardFails,
    },
    shardStats,
    burstSimulation: burstResult,
    dominations: dominations.length,
    dominationDetails: dominations.slice(0, 10), // top 10 only
    combos: validated.map(v => ({
      name: v.name, first: v.first, second: v.second,
      dmg: v.dmg, radius: v.radius, dur: v.dur, cost: v.cost,
      power: v.effectivePower, warnings: v.warnings, desc: v.desc,
    })),
  };
}

function simulateOptimalBurst(combos) {
  let bestDmg = 0, bestSeq = [];

  for (const start of SHARD_TYPES) {
    const seq = [start];
    let current = start;
    for (let step = 0; step < 7; step++) {
      let bestNext = null, bestVal = -1;
      for (const c of combos) {
        if (c.first === current && c.second !== current && c.dmg > bestVal) {
          bestVal = c.dmg;
          bestNext = c.second;
        }
      }
      if (!bestNext) break;
      seq.push(bestNext);
      current = bestNext;
    }

    let totalDmg = 0, chain = 0;
    for (let i = 1; i < seq.length; i++) {
      const c = combos.find(x => x.first === seq[i - 1] && x.second === seq[i]);
      if (c) {
        totalDmg += c.dmg + chain;
        chain = Math.min(chain + BALANCE_THRESHOLDS.chainBonusPerCombo, BALANCE_THRESHOLDS.maxChainBonus);
      }
    }
    if (totalDmg > bestDmg) {
      bestDmg = totalDmg;
      bestSeq = seq;
    }
  }

  return {
    optimalSequence: bestSeq,
    totalBurstDmg: Math.round(bestDmg * 100) / 100,
    dps: Math.round(bestDmg / BALANCE_THRESHOLDS.burstDuration * 10) / 10,
  };
}

// ── UE5 Data Table creation ──────────────────────────────────────────────────

/**
 * Create a UE5 Data Table (DT_ComboBalance) with all 30 combo rows.
 * Also creates an Enum (E_ShardType) and Struct (F_ComboBalanceRow).
 * Returns { success, dataTable, enum, struct }
 */
export async function createComboDataTable() {
  log.info('Creating UE5 combo balance data...');
  const folder = '/Game/Data/Combat';
  const results = { enum: null, struct: null, dataTable: null, errors: [] };

  // 1. Create shard type enum
  try {
    results.enum = await callTool('unreal', 'create_enum', {
      name: 'E_ShardType',
      folder,
      values: SHARD_TYPES,
    }, 15_000);
    log.info('E_ShardType enum created');
  } catch (err) {
    results.errors.push({ step: 'enum', error: err.message });
  }

  // 2. Create combo balance struct
  try {
    results.struct = await callTool('unreal', 'create_struct', {
      name: 'F_ComboBalanceRow',
      folder,
      fields: [
        { name: 'ComboName', type: 'FName' },
        { name: 'FirstShard', type: 'FName' },
        { name: 'SecondShard', type: 'FName' },
        { name: 'DamageMultiplier', type: 'float' },
        { name: 'EffectRadius', type: 'float' },
        { name: 'EffectDuration', type: 'float' },
        { name: 'CorruptionCost', type: 'float' },
        { name: 'DamageType', type: 'FName' },
        { name: 'StatusEffectTag', type: 'FName' },
      ],
    }, 15_000);
    log.info('F_ComboBalanceRow struct created');
  } catch (err) {
    results.errors.push({ step: 'struct', error: err.message });
  }

  // 3. Create the data table with all 30 rows
  try {
    const rows = COMBO_DEFINITIONS.map(c => ({
      key: c.tag,
      label: c.name,
      value: c.dmg,
      count: c.radius,
      notes: `${c.first}→${c.second} | dur=${c.dur}s | cost=${c.cost} | ${c.dmgType} | ${c.desc}`,
    }));

    results.dataTable = await callTool('unreal', 'create_data_table', {
      name: 'DT_ComboBalance',
      folder,
      rows,
    }, 30_000);
    log.info('DT_ComboBalance data table created with 30 rows');
  } catch (err) {
    results.errors.push({ step: 'dataTable', error: err.message });
  }

  return {
    success: results.errors.length === 0,
    ...results,
  };
}

// ── Export balance report to JSON ────────────────────────────────────────────

/**
 * Run validation and export the full balance report as JSON.
 */
export function exportBalanceReport() {
  const validation = runBalanceValidation();
  const game = getActiveGame();

  const reportPath = join(game.assetsPath, 'balance-report.json');
  const dir = dirname(reportPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const report = {
    generatedAt: new Date().toISOString(),
    source: 'modules/unreal/combo-balance.js',
    version: '2.0',
    thresholds: BALANCE_THRESHOLDS,
    ...validation,
  };

  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  log.info({ path: reportPath, verdict: validation.verdict }, 'Balance report exported');

  return { success: true, path: reportPath, ...validation };
}

// ── Combo data getters (for gameplay-builder integration) ────────────────────

/**
 * Get combo balance variables for BP_CombatSystem.
 * Returns array of [varName, type, defaultValue] triples.
 */
export function getCombatSystemVars() {
  return [
    // Shard Momentum variables (from council-systems.md)
    ['ShardMomentum', 'float', 0.0],
    ['MomentumDecayRate', 'float', 8.0],
    ['MomentumPerMelee', 'float', 5.0],
    ['MomentumPerShard', 'float', 10.0],
    ['MomentumPerChargedStrike', 'float', 20.0],
    ['CrownPulseDuration', 'float', 10.0],
    ['CrownPulseDmgBonus', 'float', 0.25],
    ['bIsCrownPulseActive', 'bool', false],
    // Combo chain tracking
    ['ComboChainCount', 'int', 0],
    ['ComboChainBonusPct', 'float', 0.0],
    ['MaxChainBonus', 'float', 2.0],
    ['ChainBonusPerCombo', 'float', 0.15],
    ['ComboWindowSeconds', 'float', 3.0],
    // Resonance thresholds
    ['ResonanceThreshold', 'float', 50.0],
    ['HarmonicThreshold', 'float', 80.0],
    ['CrownPulseThreshold', 'float', 100.0],
    // Global balance
    ['AvgComboDmgMultiplier', 'float', 2.22],
    ['TotalCombosAvailable', 'int', 30],
  ];
}

/**
 * Get combo function definitions for BP_CombatSystem.
 * Returns array of function names to create.
 */
export function getCombatSystemFunctions() {
  return [
    'OnShardAbilityUsed',
    'CheckComboTrigger',
    'ApplyResonanceEffect',
    'UpdateShardMomentum',
    'TriggerCrownPulse',
    'EndCrownPulse',
    'GetComboData',
    'ResetComboChain',
  ];
}
