/**
 * modules/hattrick/economy-modeling.js — Financial crisis scenario analysis.
 *
 * Builds 4-scenario financial projections:
 * 1. Status quo (no changes)
 * 2. Salary cuts (10-30% wage reduction)
 * 3. Player sales (liquidate 3-5 young players)
 * 4. Hybrid (modest cuts + 1-2 sales)
 *
 * Calculates cash runway, break-even points, and 2-week action plan.
 */

/**
 * Financial projection for a single week
 */
export function projectWeek(week, state) {
  const {
    startCash,
    weeklyIncome,
    weeklyExpenses,
    salaryMultiplier = 1.0,
    playerSalesThisWeek = 0
  } = state;

  const adjustedExpenses = weeklyExpenses * salaryMultiplier;
  const weeklyProfit = weeklyIncome + playerSalesThisWeek - adjustedExpenses;
  const endCash = startCash + weeklyProfit;

  return {
    week,
    startCash,
    weeklyIncome,
    weeklyExpenses: adjustedExpenses,
    playerSalesThisWeek,
    weeklyProfit,
    endCash,
    positiveFlow: weeklyProfit > 0
  };
}

/**
 * Project cash position over N weeks
 */
export function projectWeeks(weeks, initialCash, weeklyIncome, weeklyExpenses, config = {}) {
  const { salaryMultiplier = 1.0, playerSalesWeek = {} } = config;

  let cash = initialCash;
  const projections = [];

  for (let w = 1; w <= weeks; w++) {
    const playerSales = playerSalesWeek[w] || 0;
    const adjustedExpenses = weeklyExpenses * salaryMultiplier;
    const profit = weeklyIncome + playerSales - adjustedExpenses;

    cash += profit;

    projections.push({
      week: w,
      startCash: cash - profit,
      income: weeklyIncome,
      expenses: adjustedExpenses,
      playerSales,
      profit,
      endCash: cash,
      positiveFlow: profit > 0,
      criticallyLow: cash < 200000
    });
  }

  return projections;
}

/**
 * Calculate cash runway: how many weeks until cash <= threshold
 */
export function calculateRunway(initialCash, weeklyIncome, weeklyExpenses, threshold = 100000) {
  let cash = initialCash;
  let weeks = 0;
  const maxWeeks = 52; // prevent infinite loop

  while (cash > threshold && weeks < maxWeeks) {
    cash += (weeklyIncome - weeklyExpenses);
    weeks++;
  }

  return {
    weeks,
    finalCash: cash,
    isRunning: cash > threshold,
    urgency: weeks <= 2 ? 'CRITICAL' : weeks <= 4 ? 'HIGH' : 'MEDIUM'
  };
}

/**
 * Build 4-scenario model
 *
 * @param {object} baselineEconomy - Current economy state { cash, weeklyIncome, weeklyExpenses }
 * @returns {object} 4 scenarios with projections and analysis
 */
export function buildScenarios(baselineEconomy) {
  const { cash: initialCash, weeklyIncome, weeklyExpenses } = baselineEconomy;

  // Scenario 1: Status Quo (no changes)
  const statusQuo = {
    name: 'Status Quo (No Changes)',
    description: 'Maintain current salary structure and operations',
    salaryMultiplier: 1.0,
    playerSalesWeek: {},
    projections: projectWeeks(4, initialCash, weeklyIncome, weeklyExpenses, { salaryMultiplier: 1.0 }),
    runway: calculateRunway(initialCash, weeklyIncome, weeklyExpenses, 100000)
  };

  // Scenario 2: Salary Cuts (10% wage reduction)
  const salaryCuts = {
    name: 'Salary Cuts (10% reduction)',
    description: 'Reduce player salaries by 10% (training intensity 80%, some players demoted)',
    salaryMultiplier: 0.9,
    playerSalesWeek: {},
    projections: projectWeeks(4, initialCash, weeklyIncome, weeklyExpenses * 0.9, { salaryMultiplier: 0.9 }),
    runway: calculateRunway(initialCash, weeklyIncome, weeklyExpenses * 0.9, 100000)
  };

  // Scenario 3: Player Sales (liquidate young fringe players, 2 weeks)
  // Estimate: selling 3-5 young players for 100-150K each
  const playerSales = {
    name: 'Player Sales (Liquidation)',
    description: 'Sell 5 young fringe players (estimated 500K total) across weeks 1-2',
    salaryMultiplier: 1.0,
    playerSalesWeek: { 1: 250000, 2: 250000 }, // 5 players × ~50K avg
    projections: projectWeeks(4, initialCash, weeklyIncome, weeklyExpenses, { salaryMultiplier: 1.0, playerSalesWeek: { 1: 250000, 2: 250000 } }),
    runway: calculateRunway(initialCash + 500000, weeklyIncome, weeklyExpenses, 100000)
  };

  // Scenario 4: Hybrid (5% salary cut + 2 player sales)
  const hybrid = {
    name: 'Hybrid (5% cuts + 2 sales)',
    description: 'Combine modest wage reduction (5%) with selling 2 mid-level players (~200K)',
    salaryMultiplier: 0.95,
    playerSalesWeek: { 1: 100000, 2: 100000 },
    projections: projectWeeks(4, initialCash, weeklyIncome, weeklyExpenses * 0.95, { salaryMultiplier: 0.95, playerSalesWeek: { 1: 100000, 2: 100000 } }),
    runway: calculateRunway(initialCash + 200000, weeklyIncome, weeklyExpenses * 0.95, 100000)
  };

  return {
    baseline: baselineEconomy,
    scenarios: [statusQuo, salaryCuts, playerSales, hybrid],
    analysis: analyzeScenarios([statusQuo, salaryCuts, playerSales, hybrid])
  };
}

/**
 * Comparative analysis of scenarios
 */
export function analyzeScenarios(scenarios) {
  const analysis = {
    recommendations: [],
    warnings: [],
    bestCase: null,
    worstCase: null,
    breakeven: null
  };

  // Find best and worst case
  let bestWeek4 = -Infinity;
  let worstWeek4 = Infinity;
  let bestScenario = null;
  let worstScenario = null;

  for (const scenario of scenarios) {
    const week4 = scenario.projections[3]?.endCash || 0;
    if (week4 > bestWeek4) {
      bestWeek4 = week4;
      bestScenario = scenario;
    }
    if (week4 < worstWeek4) {
      worstWeek4 = week4;
      worstScenario = scenario;
    }
  }

  analysis.bestCase = bestScenario;
  analysis.worstCase = worstScenario;

  // Identify critical scenarios
  for (const scenario of scenarios) {
    if (scenario.runway.urgency === 'CRITICAL') {
      analysis.warnings.push(`⚠️ ${scenario.name}: CRITICAL runway (${scenario.runway.weeks} weeks until 100K floor)`);
    }

    if (scenario.projections.some(w => w.criticallyLow)) {
      analysis.warnings.push(`⚠️ ${scenario.name}: Cash drops below 200K in weeks 1-4`);
    }

    // Recommendations
    if (scenario.runway.weeks > 8 && scenario.projections[3].endCash > 2000000) {
      analysis.recommendations.push(`✅ ${scenario.name}: Sustainable (${scenario.runway.weeks}+ week runway, strong ending)`);
    }
  }

  return analysis;
}

/**
 * Build 2-week action plan
 *
 * @param {object} scenarios - Output from buildScenarios()
 * @returns {object} Prioritized action items
 */
export function build2WeekActionPlan(scenarios) {
  const { baseline, analysis } = scenarios;
  const currentRunway = calculateRunway(baseline.cash, baseline.weeklyIncome, baseline.weeklyExpenses);

  const plan = {
    urgency: currentRunway.urgency,
    timeframe: '2 weeks (14 days)',
    currentRunway: `${currentRunway.weeks} weeks at status quo`,
    actions: [],
    weeklyMilestones: []
  };

  // Week 1 actions
  if (currentRunway.urgency === 'CRITICAL' || currentRunway.weeks <= 2) {
    plan.actions.push({
      priority: 'IMMEDIATE',
      week: 1,
      action: 'Identify 3-5 fringe players for sale',
      details: 'Target young reserves (age 17-20, skill 3-5), no starters. Estimate 40-70K each.'
    });
    plan.actions.push({
      priority: 'IMMEDIATE',
      week: 1,
      action: 'Prepare salary reduction plan (5-10%)',
      details: 'Identify players with lowest experience/importance. Plan staff salary freeze.'
    });
  } else {
    plan.actions.push({
      priority: 'SCHEDULED',
      week: 1,
      action: 'Monitor weekly cash flow',
      details: 'Watch for negative weeks. If profit drops, activate contingency plans.'
    });
  }

  // Week 2 actions
  plan.actions.push({
    priority: 'STANDARD',
    week: 2,
    action: 'Execute first wave of sales (if needed)',
    details: 'Sell 2-3 identified fringe players on the market.'
  });

  plan.actions.push({
    priority: 'STANDARD',
    week: 2,
    action: 'Review training intensity',
    details: 'If costs are high, reduce training from 20% to 10% stamina gain (saves ~30K/week).'
  });

  // Milestones
  plan.weeklyMilestones = [
    {
      week: 1,
      milestone: 'Identify cost-cutting targets',
      metric: 'List 5+ players for potential sale, estimated savings from salary cuts'
    },
    {
      week: 2,
      milestone: 'Execute first action',
      metric: 'Sell 1-2 players OR implement 5% salary reduction'
    }
  ];

  return plan;
}

/**
 * Format scenario report for display
 */
export function formatScenarioReport(scenarios) {
  const { baseline, scenarios: scenarioList, analysis } = scenarios;

  let report = `# Hattrick Financial Crisis Modeling Report\n\n`;
  report += `**Generated**: ${new Date().toISOString().split('T')[0]}\n\n`;

  report += `## Current Baseline\n`;
  report += `- **Cash on hand**: ${baseline.cash?.toLocaleString('en-US')} NIS\n`;
  report += `- **Weekly income**: ${baseline.weeklyIncome?.toLocaleString('en-US')} NIS\n`;
  report += `- **Weekly expenses**: ${baseline.weeklyExpenses?.toLocaleString('en-US')} NIS\n`;
  report += `- **Weekly profit**: ${(baseline.weeklyIncome - baseline.weeklyExpenses)?.toLocaleString('en-US')} NIS\n\n`;

  report += `## Scenario Projections (4 weeks)\n\n`;

  for (const scenario of scenarioList) {
    report += `### ${scenario.name}\n`;
    report += `${scenario.description}\n\n`;

    report += `| Week | Start Cash | Profit | End Cash | Status |\n`;
    report += `|------|-----------|---------|----------|--------|\n`;

    for (const week of scenario.projections) {
      const status = week.criticallyLow ? '🔴 LOW' : week.positiveFlow ? '✅ Positive' : '⚠️ Negative';
      report += `| ${week.week} | ${week.startCash.toLocaleString('en-US')} | ${week.profit.toLocaleString('en-US')} | ${week.endCash.toLocaleString('en-US')} | ${status} |\n`;
    }

    report += `\n**Runway**: ${scenario.runway.weeks} weeks | **Week 4 Cash**: ${scenario.projections[3].endCash.toLocaleString('en-US')} NIS\n\n`;
  }

  report += `## Analysis & Warnings\n\n`;
  if (analysis.recommendations.length > 0) {
    report += `### Recommendations\n`;
    for (const rec of analysis.recommendations) {
      report += `${rec}\n`;
    }
    report += `\n`;
  }

  if (analysis.warnings.length > 0) {
    report += `### ⚠️ Warnings\n`;
    for (const warn of analysis.warnings) {
      report += `${warn}\n`;
    }
    report += `\n`;
  }

  report += `### Best Case\n`;
  report += `**${analysis.bestCase?.name}**: Ends week 4 with ${analysis.bestCase?.projections[3].endCash.toLocaleString('en-US')} NIS\n\n`;

  report += `### Worst Case\n`;
  report += `**${analysis.worstCase?.name}**: Ends week 4 with ${analysis.worstCase?.projections[3].endCash.toLocaleString('en-US')} NIS\n\n`;

  return report;
}

/**
 * Format action plan for display
 */
export function formatActionPlan(plan) {
  let report = `# 2-Week Financial Action Plan\n\n`;
  report += `**Urgency**: ${plan.urgency}\n`;
  report += `**Timeframe**: ${plan.timeframe}\n`;
  report += `**Current Runway**: ${plan.currentRunway}\n\n`;

  report += `## Actions\n\n`;
  for (const action of plan.actions) {
    report += `### Week ${action.week} - ${action.priority}\n`;
    report += `**${action.action}**\n`;
    report += `${action.details}\n\n`;
  }

  report += `## Weekly Milestones\n\n`;
  for (const milestone of plan.weeklyMilestones) {
    report += `### Week ${milestone.week}\n`;
    report += `**${milestone.milestone}**\n`;
    report += `Metric: ${milestone.metric}\n\n`;
  }

  return report;
}
