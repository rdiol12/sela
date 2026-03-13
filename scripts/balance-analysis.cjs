/**
 * Balance analysis script for Momentum Burst shard combinations.
 *
 * Parses the 30 combo definitions from SCMomentumBurstSubsystem.cpp,
 * runs balance validation, and exports a detailed report.
 */
const fs = require('fs');
const path = require('path');

const CPP_PATH = path.join(__dirname, '..', 'workspace', 'shattered-crown', 'ShatteredCrown',
  'Source', 'ShatteredCrown', 'Private', 'Combat', 'SCMomentumBurstSubsystem.cpp');
const REPORT_PATH = path.join(__dirname, '..', 'workspace', 'shattered-crown', 'Assets', 'balance-report.json');

const SHARD_NAMES = {
  1: 'Time', 2: 'Shield', 3: 'Nature', 4: 'Water', 5: 'Fire', 6: 'Shadow',
  'Time': 1, 'Shield': 2, 'Nature': 3, 'Water': 4, 'Fire': 5, 'Shadow': 6,
};

// ── Parse combo definitions from C++ source ────────────────────────────────

function parseComboDefinitions(cppSource) {
  const combos = [];
  // Match AddCombination(ESCShardType::X, ESCShardType::Y, TEXT("Name"), TEXT("Desc"), ESCDamageType::Z, dmg, radius, duration, TEXT("tag"), cost);
  const regex = /AddCombination\(\s*ESCShardType::(\w+)\s*,\s*ESCShardType::(\w+)\s*,\s*TEXT\("([^"]+)"\)\s*,\s*TEXT\("([^"]+)"\)\s*,\s*ESCDamageType::(\w+)\s*,\s*([\d.]+)f?\s*,\s*([\d.]+)f?\s*,\s*([\d.]+)f?\s*,\s*TEXT\("([^"]*)"\)\s*,\s*([\d.]+)f?\s*\)/g;

  let match;
  while ((match = regex.exec(cppSource)) !== null) {
    combos.push({
      firstShard: match[1],
      secondShard: match[2],
      name: match[3],
      description: match[4],
      damageType: match[5],
      damageMultiplier: parseFloat(match[6]),
      effectRadius: parseFloat(match[7]),
      effectDuration: parseFloat(match[8]),
      statusEffect: match[9],
      corruptionCost: parseFloat(match[10]),
    });
  }

  return combos;
}

// ── Balance validation rules ───────────────────────────────────────────────

const THRESHOLDS = {
  minDamage: 1.0,
  maxDamage: 5.0,
  maxShardDeviationPct: 0.30,
  expectedCostPerPower: 0.5,
  maxPowerSpread: 15.0,
  maxTheoreticalDPSCap: 50.0,
  burstDuration: 8.0,
  chainBonusPerCombo: 0.15,
  maxChainBonus: 2.0,
};

function calculateEffectivePower(dmg, radius, duration) {
  const radiusFactor = radius > 0 ? Math.pow(radius / 500, 2) : 0;
  const durationFactor = duration > 0 ? duration / 3.0 : 0;
  return dmg * (1 + radiusFactor * 0.5) * (1 + durationFactor * 0.3);
}

function validateCombo(combo) {
  const warnings = [];
  const power = calculateEffectivePower(combo.damageMultiplier, combo.effectRadius, combo.effectDuration);

  if (combo.damageMultiplier < THRESHOLDS.minDamage) {
    warnings.push(`Damage ${combo.damageMultiplier}x below minimum ${THRESHOLDS.minDamage}x`);
  }
  if (combo.damageMultiplier > THRESHOLDS.maxDamage) {
    warnings.push(`Damage ${combo.damageMultiplier}x exceeds maximum ${THRESHOLDS.maxDamage}x`);
  }
  if (combo.damageMultiplier > 1.5 && combo.corruptionCost < 1.0) {
    warnings.push('High damage combo with near-zero corruption cost');
  }
  if (power > 0 && combo.corruptionCost > 0) {
    const costRatio = combo.corruptionCost / power;
    if (costRatio < THRESHOLDS.expectedCostPerPower * 0.5) {
      warnings.push(`Undercosted: cost/power ${costRatio.toFixed(2)} (expected ~${THRESHOLDS.expectedCostPerPower})`);
    }
    if (costRatio > THRESHOLDS.expectedCostPerPower * 3.0) {
      warnings.push(`Overcosted: cost/power ${costRatio.toFixed(2)} (expected ~${THRESHOLDS.expectedCostPerPower})`);
    }
  }
  if (combo.effectRadius > 600 && combo.damageMultiplier > 3.0) {
    warnings.push('Very high AoE damage density — may trivialize encounters');
  }
  if (combo.effectDuration > 5.0 && combo.damageMultiplier > 2.5) {
    warnings.push('Long duration + high damage — sustained DPS may be excessive');
  }

  return {
    ...combo,
    effectivePower: Math.round(power * 100) / 100,
    passed: warnings.filter(w => w.includes('exceeds maximum')).length === 0,
    warnings,
  };
}

// ── Per-shard analysis ─────────────────────────────────────────────────────

function perShardAnalysis(combos) {
  const shards = ['Time', 'Shield', 'Nature', 'Water', 'Fire', 'Shadow'];
  const summaries = {};

  for (const shard of shards) {
    const asPrimary = combos.filter(c => c.firstShard === shard);
    const asChain = combos.filter(c => c.secondShard === shard);

    summaries[shard] = {
      avgDamagePrimary: asPrimary.length > 0 ? asPrimary.reduce((s, c) => s + c.damageMultiplier, 0) / asPrimary.length : 0,
      avgDamageChain: asChain.length > 0 ? asChain.reduce((s, c) => s + c.damageMultiplier, 0) / asChain.length : 0,
      avgCostPrimary: asPrimary.length > 0 ? asPrimary.reduce((s, c) => s + c.corruptionCost, 0) / asPrimary.length : 0,
      aoeCount: asPrimary.filter(c => c.effectRadius > 0).length,
      durationCount: asPrimary.filter(c => c.effectDuration > 0).length,
      maxDamage: asPrimary.length > 0 ? Math.max(...asPrimary.map(c => c.damageMultiplier)) : 0,
      minDamage: asPrimary.length > 0 ? Math.min(...asPrimary.map(c => c.damageMultiplier)) : 0,
      comboCount: asPrimary.length,
    };
    summaries[shard].efficiency = summaries[shard].avgCostPrimary > 0
      ? Math.round(summaries[shard].avgDamagePrimary / summaries[shard].avgCostPrimary * 100) / 100
      : 0;
  }

  return summaries;
}

// ── Burst sequence simulation ──────────────────────────────────────────────

function simulateBurst(combos, sequence) {
  let totalDamage = 0;
  let chainBonus = 0;

  for (let i = 1; i < sequence.length; i++) {
    const first = sequence[i - 1];
    const second = sequence[i];
    if (first === second) continue;

    const combo = combos.find(c => c.firstShard === first && c.secondShard === second);
    if (combo) {
      totalDamage += combo.damageMultiplier + chainBonus;
      chainBonus = Math.min(chainBonus + THRESHOLDS.chainBonusPerCombo, THRESHOLDS.maxChainBonus);
    }
  }

  return Math.round(totalDamage * 100) / 100;
}

function findOptimalBurst(combos) {
  const shards = ['Time', 'Shield', 'Nature', 'Water', 'Fire', 'Shadow'];
  let bestDamage = 0;
  let bestSequence = [];

  // Greedy: for each starting shard, pick highest damage next combo × 8 steps
  for (const start of shards) {
    const seq = [start];
    let current = start;

    for (let step = 0; step < 7; step++) {
      let bestNext = null, bestDmg = -1;
      for (const combo of combos) {
        if (combo.firstShard === current && combo.secondShard !== current) {
          if (combo.damageMultiplier > bestDmg) {
            bestDmg = combo.damageMultiplier;
            bestNext = combo.secondShard;
          }
        }
      }
      if (bestNext === null) break;
      seq.push(bestNext);
      current = bestNext;
    }

    const seqDamage = simulateBurst(combos, seq);
    if (seqDamage > bestDamage) {
      bestDamage = seqDamage;
      bestSequence = seq;
    }
  }

  return { sequence: bestSequence, totalDamage: bestDamage };
}

// ── Domination check ───────────────────────────────────────────────────────

function findDominations(combos) {
  const dominated = [];
  for (let i = 0; i < combos.length; i++) {
    for (let j = 0; j < combos.length; j++) {
      if (i === j) continue;
      const a = combos[i], b = combos[j];
      if (a.damageMultiplier >= b.damageMultiplier &&
          a.effectRadius >= b.effectRadius &&
          a.effectDuration >= b.effectDuration &&
          a.corruptionCost <= b.corruptionCost &&
          (a.damageMultiplier > b.damageMultiplier || a.effectRadius > b.effectRadius ||
           a.effectDuration > b.effectDuration || a.corruptionCost < b.corruptionCost)) {
        dominated.push({ dominated: b.name, by: a.name });
      }
    }
  }
  return dominated;
}

// ── Main ───────────────────────────────────────────────────────────────────

console.log('Shattered Crown — Shard Combo Balance Analysis');
console.log('================================================\n');

if (!fs.existsSync(CPP_PATH)) {
  console.log('Source not found at', CPP_PATH);
  console.log('Using fallback balance data...\n');
}

// Try to parse from C++, fall back to known values
let combos = [];
if (fs.existsSync(CPP_PATH)) {
  const src = fs.readFileSync(CPP_PATH, 'utf-8');
  combos = parseComboDefinitions(src);
  console.log(`Parsed ${combos.length} combos from C++ source\n`);
}

if (combos.length === 0) {
  console.log('No combos parsed from source — using hardcoded reference data\n');
  // Reference data from the explored code
  const ref = [
    ['Time','Shield','Chrono Barrier','Temporal','1.8','400','3.0','2.0'],
    ['Time','Nature','Temporal Growth','Nature','2.5','600','4.0','3.0'],
    ['Time','Water','Stasis Tide','Ice','2.2','500','3.5','3.0'],
    ['Time','Fire','Delayed Detonation','Fire','3.0','800','2.0','4.0'],
    ['Time','Shadow','Temporal Clones','Shadow','1.8','0','4.0','4.0'],
    ['Shield','Time','Aegis of Ages','Temporal','2.2','350','5.0','2.0'],
    ['Shield','Nature','Ironbark Fortress','Nature','1.5','300','6.0','2.0'],
    ['Shield','Water','Tidal Ward','Water','2.0','450','4.0','3.0'],
    ['Shield','Fire','Molten Aegis','Fire','2.0','400','5.0','3.0'],
    ['Shield','Shadow','Mirror Guard','Shadow','1.5','0','5.0','3.0'],
    ['Nature','Time','Ancient Bloom','Temporal','2.8','700','0.0','4.0'],
    ['Nature','Shield','Living Armor','Nature','1.0','0','8.0','3.0'],
    ['Nature','Water','Toxic Deluge','Poison','2.0','600','5.0','3.0'],
    ['Nature','Fire','Burning Thorns','Fire','2.8','300','3.5','3.0'],
    ['Nature','Shadow','Phantom Canopy','Shadow','1.5','500','5.0','3.0'],
    ['Water','Time','Frozen Moment','Ice','2.0','400','4.0','3.0'],
    ['Water','Shield','Pressure Wave','Physical','3.0','200','0.0','3.0'],
    ['Water','Nature','Healing Rain','Nature','1.5','800','6.0','4.0'],
    ['Water','Fire','Steam Eruption','Fire','2.5','700','3.0','4.0'],
    ['Water','Shadow','Abyssal Current','Shadow','2.0','500','4.0','4.0'],
    ['Fire','Time','Entropy Blaze','Temporal','2.2','300','5.0','3.0'],
    ['Fire','Shield','Supernova Guard','Fire','4.0','600','0.0','5.0'],
    ['Fire','Nature','Wildfire Spread','Fire','2.5','500','3.0','3.0'],
    ['Fire','Water','Obsidian Storm','Physical','2.8','600','0.0','4.0'],
    ['Fire','Shadow','Phantom Pyre','Shadow','1.5','0','3.0','3.0'],
    ['Shadow','Time','Deja Vu Strike','Shadow','3.5','0','0.0','4.0'],
    ['Shadow','Shield','Void Carapace','Shadow','2.0','200','5.0','4.0'],
    ['Shadow','Nature','Nightmare Garden','Shadow','2.2','500','4.0','4.0'],
    ['Shadow','Water','Ink Tide','Water','1.8','600','5.0','3.0'],
    ['Shadow','Fire','Darkflame Burst','Fire','2.5','500','0.0','4.0'],
  ];
  combos = ref.map(r => ({
    firstShard: r[0], secondShard: r[1], name: r[2], description: '',
    damageType: r[3], damageMultiplier: parseFloat(r[4]),
    effectRadius: parseFloat(r[5]), effectDuration: parseFloat(r[6]),
    statusEffect: '', corruptionCost: parseFloat(r[7]),
  }));
}

// Validate all combos
const validated = combos.map(validateCombo);
const passed = validated.filter(v => v.passed).length;
const withWarnings = validated.filter(v => v.warnings.length > 0).length;

// Per-shard analysis
const shardSummaries = perShardAnalysis(combos);

// Global metrics
const allDamages = combos.map(c => c.damageMultiplier);
const avgDamage = allDamages.reduce((s, d) => s + d, 0) / allDamages.length;
const avgCost = combos.reduce((s, c) => s + c.corruptionCost, 0) / combos.length;
const stdDev = Math.sqrt(allDamages.reduce((s, d) => s + Math.pow(d - avgDamage, 2), 0) / allDamages.length);

// Optimal burst
const optimal = findOptimalBurst(combos);
const theoreticalDPS = optimal.totalDamage / THRESHOLDS.burstDuration;

// Domination check
const dominations = findDominations(combos);

// Print report
console.log('── GLOBAL METRICS ──');
console.log(`  Total combos: ${combos.length}`);
console.log(`  Passed: ${passed}/${combos.length}`);
console.log(`  With warnings: ${withWarnings}`);
console.log(`  Avg damage: ${avgDamage.toFixed(2)}x`);
console.log(`  Avg cost: ${avgCost.toFixed(1)}`);
console.log(`  Damage StdDev: ${stdDev.toFixed(2)}`);
console.log(`  Damage range: ${Math.min(...allDamages).toFixed(1)}x - ${Math.max(...allDamages).toFixed(1)}x`);
console.log();

console.log('── PER-SHARD SUMMARY ──');
for (const [shard, s] of Object.entries(shardSummaries)) {
  console.log(`  ${shard.padEnd(8)}: AvgDmg=${s.avgDamagePrimary.toFixed(2)}x  AvgCost=${s.avgCostPrimary.toFixed(1)}  Eff=${s.efficiency}  AoE=${s.aoeCount}/5  Duration=${s.durationCount}/5  Range=${s.minDamage.toFixed(1)}-${s.maxDamage.toFixed(1)}`);
}
console.log();

console.log('── BURST SIMULATION ──');
console.log(`  Optimal sequence: ${optimal.sequence.join(' → ')}`);
console.log(`  Total burst damage: ${optimal.totalDamage}x`);
console.log(`  Theoretical DPS: ${theoreticalDPS.toFixed(1)}x/s (cap: ${THRESHOLDS.maxTheoreticalDPSCap})`);
console.log();

if (dominations.length > 0) {
  console.log('── DOMINATION WARNINGS ──');
  for (const d of dominations) {
    console.log(`  ${d.dominated} is strictly dominated by ${d.by}`);
  }
  console.log();
}

if (withWarnings > 0) {
  console.log('── COMBO WARNINGS ──');
  for (const v of validated.filter(v => v.warnings.length > 0)) {
    console.log(`  ${v.name} (${v.firstShard}→${v.secondShard}): ${v.damageMultiplier}x, r=${v.effectRadius}, d=${v.effectDuration}s, c=${v.corruptionCost}`);
    for (const w of v.warnings) {
      console.log(`    → ${w}`);
    }
  }
  console.log();
}

// Verdict
let verdict;
if (passed === combos.length && withWarnings === 0) {
  verdict = 'PASS — All 30 combos within balance thresholds';
} else if (passed === combos.length) {
  verdict = `PASS WITH WARNINGS — ${withWarnings} combos have balance notes`;
} else {
  verdict = `FAIL — ${combos.length - passed} combos failed validation`;
}
console.log(`VERDICT: ${verdict}\n`);

// Export report
const report = {
  generatedAt: new Date().toISOString(),
  version: '1.0',
  verdict,
  thresholds: THRESHOLDS,
  globalMetrics: {
    totalCombos: combos.length, passed, withWarnings,
    avgDamage: Math.round(avgDamage * 100) / 100,
    avgCost: Math.round(avgCost * 10) / 10,
    damageStdDev: Math.round(stdDev * 100) / 100,
    damageRange: [Math.min(...allDamages), Math.max(...allDamages)],
  },
  burstSimulation: {
    optimalSequence: optimal.sequence,
    totalBurstDamage: optimal.totalDamage,
    theoreticalDPS: Math.round(theoreticalDPS * 10) / 10,
  },
  shardSummaries,
  combos: validated.map(v => ({
    name: v.name, first: v.firstShard, second: v.secondShard,
    damage: v.damageMultiplier, radius: v.effectRadius,
    duration: v.effectDuration, cost: v.corruptionCost,
    effectivePower: v.effectivePower, passed: v.passed,
    warnings: v.warnings,
  })),
  dominations,
};

fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');
console.log(`Report saved to ${REPORT_PATH}`);
