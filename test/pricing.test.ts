import { describe, expect, it } from 'vitest';
import { naira } from '../src/worker/domain/money';
import {
  compareBudgetToActual,
  computeCostBreakdown,
  computeProfit,
  DEFAULT_MARGIN_THRESHOLDS,
  evaluateActuals,
  evaluateProject,
  lineTotalKobo,
  marginBand,
  recommendedPriceKobo,
  requiresApproval,
  summariseCoverage,
  type CostLineFigure,
  type ProjectEvaluationSettings,
} from '../src/worker/domain/pricing';

const baselineSettings: ProjectEvaluationSettings = {
  contingencyBp: 0,
  contingencyBase: 'direct',
  overheadMethod: 'none',
  overheadFixedKobo: 0,
  overheadPercentBp: 0,
  vatRateBp: 750,
  taxProvisionBp: 0,
  minMarginBp: 2_000,
  marginThresholds: DEFAULT_MARGIN_THRESHOLDS,
};

function standardLine(overrides: Partial<CostLineFigure> = {}): CostLineFigure {
  return {
    category: 'other',
    kind: 'standard',
    quantityMilli: 1_000,
    unitRateKobo: 0,
    daysMilli: 1_000,
    additionalKobo: 0,
    ...overrides,
  };
}

describe('line totals (PRD §4)', () => {
  it('calculates equipment as quantity x rate x days + additional charges', () => {
    const total = lineTotalKobo({
      category: 'equipment',
      kind: 'equipment',
      quantityMilli: 2_000, // 2 cameras
      unitRateKobo: naira(50_000),
      daysMilli: 3_000, // 3 rental days
      additionalKobo: naira(20_000), // delivery charge
    });
    expect(total).toBe(naira(320_000));
  });

  it('calculates crew as people x rate x days + allowances', () => {
    const total = lineTotalKobo({
      category: 'crew',
      kind: 'crew',
      quantityMilli: 4_000, // 4 crew
      unitRateKobo: naira(25_000),
      daysMilli: 2_000,
      additionalKobo: naira(30_000), // overtime
    });
    expect(total).toBe(naira(230_000));
  });

  it('calculates other items as quantity x unit rate', () => {
    expect(lineTotalKobo(standardLine({ quantityMilli: 3_000, unitRateKobo: naira(12_500) }))).toBe(
      naira(37_500),
    );
  });
});

describe('recommended price (PRD §5)', () => {
  it('matches the PRD worked example: ₦400,000 at 30% -> ₦571,429', () => {
    const price = recommendedPriceKobo(naira(400_000), 3_000);
    expect(price).toBe(57_142_857); // ₦571,428.57, which the PRD rounds to ₦571,429
    expect(price).toBeGreaterThan(naira(571_428));
    expect(price).toBeLessThan(naira(571_430));
  });

  it('returns zero for a non-positive cost base', () => {
    expect(recommendedPriceKobo(0, 3_000)).toBe(0);
    expect(recommendedPriceKobo(-naira(100), 3_000)).toBe(0);
  });

  it('rejects impossible margins instead of dividing by zero', () => {
    expect(() => recommendedPriceKobo(naira(100), 10_000)).toThrow(RangeError);
    expect(() => recommendedPriceKobo(naira(100), -100)).toThrow(RangeError);
  });
});

describe('cost breakdown', () => {
  const lines: CostLineFigure[] = [
    standardLine({ category: 'equipment', kind: 'equipment', quantityMilli: 2_000, unitRateKobo: naira(50_000), daysMilli: 3_000, additionalKobo: naira(20_000) }),
    standardLine({ category: 'crew', kind: 'crew', quantityMilli: 4_000, unitRateKobo: naira(25_000), daysMilli: 2_000, additionalKobo: naira(30_000) }),
    standardLine({ category: 'logistics', quantityMilli: 1_000, unitRateKobo: naira(50_000) }),
  ];

  it('sums direct categories and keeps overhead out of them', () => {
    const breakdown = computeCostBreakdown(lines, baselineSettings);
    expect(breakdown.categoryTotals.equipment).toBe(naira(320_000));
    expect(breakdown.categoryTotals.crew).toBe(naira(230_000));
    expect(breakdown.categoryTotals.logistics).toBe(naira(50_000));
    expect(breakdown.directSubtotalKobo).toBe(naira(600_000));
    expect(breakdown.overheadKobo).toBe(0);
  });

  it('applies contingency once, on a base it reports', () => {
    const breakdown = computeCostBreakdown(lines, { ...baselineSettings, contingencyBp: 500 });
    expect(breakdown.contingencyBaseKobo).toBe(naira(600_000));
    expect(breakdown.contingencyKobo).toBe(naira(30_000));
    expect(breakdown.directCostsKobo).toBe(naira(630_000));
  });

  it('allocates overhead as a percentage of direct costs', () => {
    const breakdown = computeCostBreakdown(lines, {
      ...baselineSettings,
      overheadMethod: 'percent',
      overheadPercentBp: 1_000,
    });
    expect(breakdown.allocatedOverheadKobo).toBe(naira(60_000));
    expect(breakdown.overheadKobo).toBe(naira(60_000));
    expect(breakdown.directSubtotalKobo).toBe(naira(600_000)); // unchanged
  });

  it('sums manual overhead lines with the allocation', () => {
    const breakdown = computeCostBreakdown(
      [...lines, standardLine({ category: 'overhead', quantityMilli: 1_000, unitRateKobo: naira(15_000) })],
      { ...baselineSettings, overheadMethod: 'fixed', overheadFixedKobo: naira(45_000) },
    );
    expect(breakdown.manualOverheadKobo).toBe(naira(15_000));
    expect(breakdown.allocatedOverheadKobo).toBe(naira(45_000));
    expect(breakdown.overheadKobo).toBe(naira(60_000));
  });

  it('can include overhead in the contingency base', () => {
    const breakdown = computeCostBreakdown(lines, {
      ...baselineSettings,
      contingencyBase: 'direct_plus_overhead',
      contingencyBp: 500,
      overheadMethod: 'fixed',
      overheadFixedKobo: naira(50_000),
    });
    expect(breakdown.contingencyBaseKobo).toBe(naira(650_000));
    expect(breakdown.contingencyKobo).toBe(naira(32_500));
  });

  it('offers three price bases, each labelled explicitly', () => {
    const settings = { ...baselineSettings, contingencyBp: 500, overheadMethod: 'fixed' as const, overheadFixedKobo: naira(50_000) };

    const direct = computeCostBreakdown(lines, settings, 'direct');
    expect(direct.priceBaseKobo).toBe(naira(600_000));

    const withContingency = computeCostBreakdown(lines, settings, 'direct_plus_contingency');
    expect(withContingency.priceBaseKobo).toBe(naira(630_000));

    const withOverhead = computeCostBreakdown(lines, settings, 'direct_plus_contingency_plus_overhead');
    expect(withOverhead.priceBaseKobo).toBe(naira(680_000));
    expect(withOverhead.priceBaseLabel).toMatch(/overhead/i);
  });
});

describe('profit measures stay separate (PRD §5)', () => {
  it('separates gross, operating and estimated net profit', () => {
    const result = computeProfit({
      netRevenueKobo: naira(500_000),
      directCostsKobo: naira(350_000),
      overheadKobo: naira(50_000),
      taxProvisionBp: 1_000,
      vatRateBp: 750,
    });

    expect(result.grossProfitKobo).toBe(naira(150_000));
    expect(result.grossMarginBp).toBe(3_000);
    expect(result.operatingProfitKobo).toBe(naira(100_000));
    expect(result.taxProvisionKobo).toBe(naira(10_000));
    expect(result.netProfitKobo).toBe(naira(90_000));
    expect(result.netMarginBp).toBe(1_800);
  });

  it('never treats VAT as revenue or profit', () => {
    const result = computeProfit({
      netRevenueKobo: naira(500_000),
      directCostsKobo: naira(350_000),
      overheadKobo: 0,
      taxProvisionBp: 0,
      vatRateBp: 750,
    });

    expect(result.netRevenueKobo).toBe(naira(500_000));
    expect(result.grossProfitKobo).toBe(naira(150_000));
    expect(result.vatKobo).toBe(naira(37_500));
    expect(result.totalPayableKobo).toBe(naira(537_500));
  });

  it('does not raise a tax provision on a loss', () => {
    const result = computeProfit({
      netRevenueKobo: naira(300_000),
      directCostsKobo: naira(350_000),
      overheadKobo: naira(10_000),
      taxProvisionBp: 2_500,
      vatRateBp: 750,
    });

    expect(result.grossProfitKobo).toBe(-naira(50_000));
    expect(result.taxProvisionKobo).toBe(0);
    expect(result.netProfitKobo).toBe(-naira(60_000));
  });
});

describe('margin bands and approval (PRD §5)', () => {
  it('maps margins to the PRD bands, including the boundaries', () => {
    expect(marginBand(1_499)).toBe('critical');
    expect(marginBand(1_500)).toBe('low');
    expect(marginBand(2_499)).toBe('low');
    expect(marginBand(2_500)).toBe('acceptable');
    expect(marginBand(3_499)).toBe('acceptable');
    expect(marginBand(3_500)).toBe('good');
    expect(marginBand(4_000)).toBe('good');
    expect(marginBand(4_001)).toBe('excellent');
  });

  it('requires approval strictly below the configured minimum', () => {
    expect(requiresApproval(1_999, 2_000)).toBe(true);
    expect(requiresApproval(2_000, 2_000)).toBe(false);
  });

  it('honours custom thresholds', () => {
    const custom = { criticalBelowBp: 1_000, lowBelowBp: 2_000, acceptableBelowBp: 3_000, goodUpToBp: 4_500 };
    expect(marginBand(1_200, custom)).toBe('low');
    expect(marginBand(4_200, custom)).toBe('good');
    expect(marginBand(4_600, custom)).toBe('excellent');
  });
});

describe('full project evaluation', () => {
  const lines: CostLineFigure[] = [
    standardLine({ category: 'equipment', kind: 'equipment', quantityMilli: 2_000, unitRateKobo: naira(50_000), daysMilli: 3_000, additionalKobo: naira(20_000) }),
    standardLine({ category: 'crew', kind: 'crew', quantityMilli: 4_000, unitRateKobo: naira(25_000), daysMilli: 2_000, additionalKobo: naira(30_000) }),
    standardLine({ category: 'logistics', quantityMilli: 1_000, unitRateKobo: naira(50_000) }),
  ];

  it('recommends a price that yields the target margin', () => {
    const result = evaluateProject({
      lines,
      settings: baselineSettings,
      priceBase: 'direct_plus_contingency',
      targetMarginBp: 3_000,
    });

    expect(result.breakdown.directCostsKobo).toBe(naira(600_000));
    expect(result.recommendedPriceKobo).toBe(85_714_286); // ₦857,142.86 = 600,000 / 0.7
    expect(result.effectiveMarginBp).toBe(3_000);
    expect(result.sellingPriceNetKobo).toBe(result.recommendedPriceKobo);
    expect(result.band).toBe('acceptable');
  });

  it('accepts a manual price override and recalculates margin from it', () => {
    const result = evaluateProject({
      lines,
      settings: baselineSettings,
      priceBase: 'direct_plus_contingency',
      targetMarginBp: 3_000,
      sellingPriceNetKobo: naira(620_000),
    });

    expect(result.priceOverridden).toBe(true);
    expect(result.recommendedPriceKobo).toBe(85_714_286);
    expect(result.sellingPriceNetKobo).toBe(naira(620_000));
    expect(result.profit.grossProfitKobo).toBe(naira(20_000));
    expect(result.effectiveMarginBp).toBe(323); // 3.2%
    expect(result.band).toBe('critical');
    expect(result.requiresApproval).toBe(true);
  });

  it('warns when a price is set below direct costs', () => {
    const result = evaluateProject({
      lines,
      settings: baselineSettings,
      priceBase: 'direct_plus_contingency',
      targetMarginBp: 3_000,
      sellingPriceNetKobo: naira(500_000),
    });

    expect(result.profit.grossProfitKobo).toBe(-naira(100_000));
    expect(result.warnings.join(' ')).toMatch(/below total direct costs/i);
  });

  it('flags when the price base includes overhead', () => {
    const result = evaluateProject({
      lines,
      settings: { ...baselineSettings, overheadMethod: 'fixed', overheadFixedKobo: naira(50_000) },
      priceBase: 'direct_plus_contingency_plus_overhead',
      targetMarginBp: 3_000,
    });

    expect(result.breakdown.priceBaseKobo).toBe(naira(650_000));
    expect(result.warnings.join(' ')).toMatch(/includes operating overhead/i);
  });
});

describe('budget vs actual variance (PRD §6)', () => {
  it('reproduces the PRD variance table', () => {
    const budget = {
      equipment: naira(200_000),
      crew: naira(100_000),
      logistics: naira(50_000),
      internet: 0,
      other: 0,
      overhead: 0,
    };

    const rows = compareBudgetToActual(budget, {
      equipment: naira(220_000),
      crew: naira(95_000),
      logistics: naira(60_000),
    });

    const byCategory = Object.fromEntries(rows.map((row) => [row.category, row]));

    expect(byCategory.equipment?.varianceKobo).toBe(naira(20_000));
    expect(byCategory.equipment?.status).toBe('over');
    expect(byCategory.crew?.varianceKobo).toBe(-naira(5_000));
    expect(byCategory.crew?.status).toBe('under');
    expect(byCategory.logistics?.varianceKobo).toBe(naira(10_000));
    expect(byCategory.logistics?.status).toBe('over');
    expect(byCategory.internet?.status).toBe('on_budget');
  });

  it('computes actual profitability without the contingency allowance', () => {
    const result = evaluateActuals({
      netRevenueKobo: naira(500_000),
      actualDirectCostsKobo: naira(375_000),
      overheadKobo: naira(50_000),
      taxProvisionBp: 1_000,
      vatRateBp: 750,
      minMarginBp: 2_000,
      marginThresholds: DEFAULT_MARGIN_THRESHOLDS,
    });

    expect(result.profit.grossProfitKobo).toBe(naira(125_000));
    expect(result.profit.operatingProfitKobo).toBe(naira(75_000));
    expect(result.profit.netProfitKobo).toBe(naira(67_500));
    expect(result.profit.vatKobo).toBe(naira(37_500));
    expect(result.requiresApproval).toBe(false);
  });
});

describe('summariseCoverage', () => {
  it('reports empty when nothing has been logged', () => {
    const coverage = summariseCoverage({
      budgetKobo: naira(400_000),
      actualKobo: 0,
      budgetedCategories: ['equipment', 'crew'],
      loggedCategories: [],
    });

    expect(coverage.verdict).toBe('empty');
    expect(coverage.coverageBp).toBe(0);
    expect(coverage.remainingKobo).toBe(naira(400_000));
    expect(coverage.unloggedCategories).toEqual(['equipment', 'crew']);
  });

  it('names the categories still missing when the picture is partial', () => {
    const coverage = summariseCoverage({
      budgetKobo: naira(400_000),
      actualKobo: naira(150_000),
      budgetedCategories: ['equipment', 'crew', 'logistics'],
      loggedCategories: ['equipment'],
    });

    expect(coverage.verdict).toBe('partial');
    expect(coverage.coverageBp).toBe(3_750);
    expect(coverage.remainingKobo).toBe(naira(250_000));
    expect(coverage.unloggedCategories).toEqual(['crew', 'logistics']);
  });

  it('treats every budgeted category having spend as complete', () => {
    const coverage = summariseCoverage({
      budgetKobo: naira(400_000),
      actualKobo: naira(410_000),
      budgetedCategories: ['equipment', 'crew'],
      loggedCategories: ['equipment', 'crew'],
    });

    expect(coverage.verdict).toBe('complete');
    expect(coverage.unloggedCategories).toEqual([]);
  });

  it('never reports a negative remainder when spend is over budget', () => {
    const coverage = summariseCoverage({
      budgetKobo: naira(100_000),
      actualKobo: naira(130_000),
      budgetedCategories: ['equipment'],
      loggedCategories: ['equipment'],
    });

    expect(coverage.coverageBp).toBe(13_000);
    expect(coverage.remainingKobo).toBe(0);
  });

  it('ignores logged categories that were never budgeted', () => {
    const coverage = summariseCoverage({
      budgetKobo: naira(200_000),
      actualKobo: naira(20_000),
      budgetedCategories: ['equipment'],
      loggedCategories: ['equipment', 'other'],
    });

    expect(coverage.verdict).toBe('complete');
    expect(coverage.unloggedCategories).toEqual([]);
  });
});
