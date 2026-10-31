/**
 * Costing, pricing and profit engine (PRD §4, §5, §6).
 *
 * Every rule in this file is mirrored to the UI and exercised in test/pricing.test.ts.
 * The client never computes authoritative figures: the Worker calls these
 * functions and the numbers it returns are what get persisted and displayed.
 *
 * Accounting decisions worth knowing:
 *  - VAT is never revenue. Net revenue and VAT are tracked separately.
 *  - Gross profit uses direct project costs (including the contingency
 *    allowance). Operating profit then removes operating overhead. Estimated
 *    net profit then removes a configurable tax provision. Those three measures
 *    are never conflated.
 *  - Contingency has exactly one source: the configured percentage. Manual
 *    contingency lines are deliberately not supported, so the allowance cannot
 *    be counted twice.
 *  - Operating overhead has two sources that are summed, not duplicated:
 *    manual "overhead" cost lines plus the configured allocation (fixed amount
 *    or percentage of direct costs).
 */

import {
  basisPointsOf,
  multiplyScaled,
  percentOf,
  roundDivide,
  vatOn,
} from './money';

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const DIRECT_CATEGORIES = [
  'equipment',
  'crew',
  'logistics',
  'internet',
  'other',
] as const;
export type DirectCategory = (typeof DIRECT_CATEGORIES)[number];

export const ALL_CATEGORIES = [...DIRECT_CATEGORIES, 'overhead'] as const;
export type CostCategory = (typeof ALL_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<CostCategory, string> = {
  equipment: 'Equipment rental',
  crew: 'Crew',
  logistics: 'Logistics',
  internet: 'Internet & streaming',
  other: 'Other production costs',
  overhead: 'Overhead',
};

export const LINE_KINDS = ['equipment', 'crew', 'standard'] as const;
export type LineKind = (typeof LINE_KINDS)[number];

// ---------------------------------------------------------------------------
// Line items
// ---------------------------------------------------------------------------

export interface CostLineFigure {
  category: CostCategory;
  kind: LineKind;
  /** Quantity (equipment units, crew count, or generic count), milli-scaled. */
  quantityMilli: number;
  /** Rental rate / rate per person / unit rate, in kobo. */
  unitRateKobo: number;
  /** Rental days or crew days, milli-scaled. Ignored by "standard" lines. */
  daysMilli: number;
  /** Additional charges, allowances or overtime, in kobo. */
  additionalKobo: number;
}

/**
 * Line total per PRD §4:
 *   equipment = quantity x rental rate x rental days + additional charges
 *   crew      = people x rate per person x days + allowances/overtime
 *   standard  = quantity x unit rate (+ optional additional charges)
 */
export function lineTotalKobo(line: CostLineFigure): number {
  const base =
    line.kind === 'standard'
      ? multiplyScaled(line.unitRateKobo, line.quantityMilli)
      : multiplyScaled(line.unitRateKobo, line.quantityMilli, line.daysMilli);

  return base + line.additionalKobo;
}

export interface CostLineResult {
  index: number;
  category: CostCategory;
  totalKobo: number;
}

// ---------------------------------------------------------------------------
// Settings used by the engine
// ---------------------------------------------------------------------------

export interface CostingSettings {
  /** Contingency percentage of the eligible base, in basis points. */
  contingencyBp: number;
  /** What contingency is calculated on. Shown in the UI and in warnings. */
  contingencyBase: 'direct' | 'direct_plus_overhead';
  overheadMethod: 'none' | 'fixed' | 'percent';
  overheadFixedKobo: number;
  /** Percentage of direct costs when overheadMethod is "percent". */
  overheadPercentBp: number;
}

export type PriceBase =
  | 'direct'
  | 'direct_plus_contingency'
  | 'direct_plus_contingency_plus_overhead';

export const PRICE_BASE_LABELS: Record<PriceBase, string> = {
  direct: 'Direct costs (excluding contingency)',
  direct_plus_contingency: 'Direct costs including contingency',
  direct_plus_contingency_plus_overhead:
    'Direct costs including contingency and allocated overhead',
};

// ---------------------------------------------------------------------------
// Cost breakdown
// ---------------------------------------------------------------------------

export interface CategoryTotals {
  equipment: number;
  crew: number;
  logistics: number;
  internet: number;
  other: number;
  overhead: number;
}

export interface CostBreakdown {
  lines: CostLineResult[];
  categoryTotals: CategoryTotals;
  /** Sum of equipment..other. Contingency and overhead excluded. */
  directSubtotalKobo: number;
  manualOverheadKobo: number;
  allocatedOverheadKobo: number;
  overheadKobo: number;
  contingencyBaseKobo: number;
  contingencyKobo: number;
  /** Direct subtotal + contingency. The "project cost" figure used for margin. */
  directCostsKobo: number;
  priceBase: PriceBase;
  priceBaseKobo: number;
  priceBaseLabel: string;
}

export function computeCostBreakdown(
  lines: readonly CostLineFigure[],
  settings: CostingSettings,
  priceBase: PriceBase = 'direct_plus_contingency',
): CostBreakdown {
  const categoryTotals: CategoryTotals = {
    equipment: 0,
    crew: 0,
    logistics: 0,
    internet: 0,
    other: 0,
    overhead: 0,
  };

  const results: CostLineResult[] = lines.map((line, index) => {
    const totalKobo = lineTotalKobo(line);
    categoryTotals[line.category] += totalKobo;
    return { index, category: line.category, totalKobo };
  });

  const directSubtotalKobo = DIRECT_CATEGORIES.reduce(
    (sum, category) => sum + categoryTotals[category],
    0,
  );

  const manualOverheadKobo = categoryTotals.overhead;

  const allocatedOverheadKobo =
    settings.overheadMethod === 'fixed'
      ? settings.overheadFixedKobo
      : settings.overheadMethod === 'percent'
        ? percentOf(directSubtotalKobo, settings.overheadPercentBp)
        : 0;

  const overheadKobo = manualOverheadKobo + allocatedOverheadKobo;

  const contingencyBaseKobo =
    settings.contingencyBase === 'direct_plus_overhead'
      ? directSubtotalKobo + overheadKobo
      : directSubtotalKobo;

  const contingencyKobo = percentOf(contingencyBaseKobo, settings.contingencyBp);
  const directCostsKobo = directSubtotalKobo + contingencyKobo;

  const priceBaseKobo =
    priceBase === 'direct'
      ? directSubtotalKobo
      : priceBase === 'direct_plus_contingency'
        ? directCostsKobo
        : directCostsKobo + overheadKobo;

  return {
    lines: results,
    categoryTotals,
    directSubtotalKobo,
    manualOverheadKobo,
    allocatedOverheadKobo,
    overheadKobo,
    contingencyBaseKobo,
    contingencyKobo,
    directCostsKobo,
    priceBase,
    priceBaseKobo,
    priceBaseLabel: PRICE_BASE_LABELS[priceBase],
  };
}

// ---------------------------------------------------------------------------
// Target-margin pricing
// ---------------------------------------------------------------------------

/**
 * Recommended selling price (excluding VAT) = cost base / (1 - target margin).
 * A 100% margin is undefined, and a negative margin is meaningless, so both are
 * rejected rather than silently producing a nonsense price.
 */
export function recommendedPriceKobo(costBaseKobo: number, targetMarginBp: number): number {
  if (targetMarginBp < 0) {
    throw new RangeError('Target margin cannot be negative');
  }
  if (targetMarginBp >= 10_000) {
    throw new RangeError('Target margin must be below 100%');
  }
  if (costBaseKobo <= 0) return 0;

  const denominator = 10_000 - targetMarginBp;
  return Number(roundDivide(BigInt(costBaseKobo) * 10_000n, BigInt(denominator)));
}

// ---------------------------------------------------------------------------
// Margin bands and approval
// ---------------------------------------------------------------------------

export type MarginBand = 'critical' | 'low' | 'acceptable' | 'good' | 'excellent';

export interface MarginThresholds {
  /** Below this is critical. Default 15%. */
  criticalBelowBp: number;
  /** Below this is low. Default 25%. */
  lowBelowBp: number;
  /** Below this is acceptable. Default 35%. */
  acceptableBelowBp: number;
  /** At or below this is good; above is excellent. Default 40%. */
  goodUpToBp: number;
}

export const DEFAULT_MARGIN_THRESHOLDS: MarginThresholds = {
  criticalBelowBp: 1_500,
  lowBelowBp: 2_500,
  acceptableBelowBp: 3_500,
  goodUpToBp: 4_000,
};

export function validateThresholds(thresholds: MarginThresholds): void {
  const ordered =
    thresholds.criticalBelowBp < thresholds.lowBelowBp &&
    thresholds.lowBelowBp < thresholds.acceptableBelowBp &&
    thresholds.acceptableBelowBp <= thresholds.goodUpToBp;

  if (!ordered) {
    throw new RangeError('Margin thresholds must be strictly increasing');
  }
}

export function marginBand(
  marginBp: number,
  thresholds: MarginThresholds = DEFAULT_MARGIN_THRESHOLDS,
): MarginBand {
  if (marginBp < thresholds.criticalBelowBp) return 'critical';
  if (marginBp < thresholds.lowBelowBp) return 'low';
  if (marginBp < thresholds.acceptableBelowBp) return 'acceptable';
  if (marginBp <= thresholds.goodUpToBp) return 'good';
  return 'excellent';
}

/** Below the configured minimum margin an owner approval is required. */
export function requiresApproval(marginBp: number, minMarginBp: number): boolean {
  return marginBp < minMarginBp;
}

// ---------------------------------------------------------------------------
// Profit measures
// ---------------------------------------------------------------------------

export interface ProfitInput {
  /** Selling price excluding VAT. */
  netRevenueKobo: number;
  directCostsKobo: number;
  overheadKobo: number;
  /** Other operating expenses beyond the overhead allocation. */
  otherOperatingKobo?: number;
  /** Provision on operating profit, in basis points. */
  taxProvisionBp: number;
  vatRateBp: number;
}

export interface ProfitResult {
  netRevenueKobo: number;
  directCostsKobo: number;
  grossProfitKobo: number;
  grossMarginBp: number;
  overheadKobo: number;
  otherOperatingKobo: number;
  operatingProfitKobo: number;
  operatingMarginBp: number;
  taxProvisionKobo: number;
  netProfitKobo: number;
  netMarginBp: number;
  vatRateBp: number;
  vatKobo: number;
  totalPayableKobo: number;
}

export function computeProfit(input: ProfitInput): ProfitResult {
  const otherOperatingKobo = input.otherOperatingKobo ?? 0;

  const grossProfitKobo = input.netRevenueKobo - input.directCostsKobo;
  const operatingProfitKobo = grossProfitKobo - input.overheadKobo - otherOperatingKobo;

  // A loss carries no tax provision: provisions apply to positive profit only.
  const taxProvisionKobo =
    operatingProfitKobo > 0 ? percentOf(operatingProfitKobo, input.taxProvisionBp) : 0;

  const netProfitKobo = operatingProfitKobo - taxProvisionKobo;
  const vatKobo = vatOn(input.netRevenueKobo, input.vatRateBp);

  return {
    netRevenueKobo: input.netRevenueKobo,
    directCostsKobo: input.directCostsKobo,
    grossProfitKobo,
    grossMarginBp: basisPointsOf(grossProfitKobo, input.netRevenueKobo),
    overheadKobo: input.overheadKobo,
    otherOperatingKobo,
    operatingProfitKobo,
    operatingMarginBp: basisPointsOf(operatingProfitKobo, input.netRevenueKobo),
    taxProvisionKobo,
    netProfitKobo,
    netMarginBp: basisPointsOf(netProfitKobo, input.netRevenueKobo),
    vatRateBp: input.vatRateBp,
    vatKobo,
    totalPayableKobo: input.netRevenueKobo + vatKobo,
  };
}

// ---------------------------------------------------------------------------
// Full project evaluation
// ---------------------------------------------------------------------------

export interface ProjectEvaluationSettings extends CostingSettings {
  vatRateBp: number;
  taxProvisionBp: number;
  minMarginBp: number;
  marginThresholds: MarginThresholds;
}

export interface ProjectEvaluationInput {
  lines: readonly CostLineFigure[];
  settings: ProjectEvaluationSettings;
  priceBase: PriceBase;
  targetMarginBp: number;
  /** When present, the user has overridden the recommended price. */
  sellingPriceNetKobo?: number | null;
}

export interface ProjectFinancials {
  breakdown: CostBreakdown;
  targetMarginBp: number;
  recommendedPriceKobo: number;
  sellingPriceNetKobo: number;
  priceOverridden: boolean;
  effectiveMarginBp: number;
  band: MarginBand;
  requiresApproval: boolean;
  profit: ProfitResult;
  warnings: string[];
}

export function evaluateProject(input: ProjectEvaluationInput): ProjectFinancials {
  const { settings } = input;
  const breakdown = computeCostBreakdown(input.lines, settings, input.priceBase);

  const recommended = recommendedPriceKobo(breakdown.priceBaseKobo, input.targetMarginBp);

  const priceOverridden =
    input.sellingPriceNetKobo != null && input.sellingPriceNetKobo !== recommended;
  const sellingPriceNetKobo = input.sellingPriceNetKobo ?? recommended;

  const profit = computeProfit({
    netRevenueKobo: sellingPriceNetKobo,
    directCostsKobo: breakdown.directCostsKobo,
    overheadKobo: breakdown.overheadKobo,
    taxProvisionBp: settings.taxProvisionBp,
    vatRateBp: settings.vatRateBp,
  });

  const warnings: string[] = [];

  if (breakdown.priceBase === 'direct_plus_contingency_plus_overhead') {
    warnings.push(
      'The recommended price includes operating overhead. Gross margin on this price therefore overstates the margin on direct project costs.',
    );
  }

  if (settings.contingencyBase === 'direct_plus_overhead') {
    warnings.push(
      'Contingency is calculated on direct costs plus overhead. The base is shown on the cost summary.',
    );
  }

  if (priceOverridden && sellingPriceNetKobo < breakdown.directCostsKobo) {
    warnings.push('The selling price is below total direct costs, so this project will make a loss.');
  }

  return {
    breakdown,
    targetMarginBp: input.targetMarginBp,
    recommendedPriceKobo: recommended,
    sellingPriceNetKobo,
    priceOverridden,
    effectiveMarginBp: profit.grossMarginBp,
    band: marginBand(profit.grossMarginBp, settings.marginThresholds),
    requiresApproval: requiresApproval(profit.grossMarginBp, settings.minMarginBp),
    profit,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Budget vs actual (PRD §6)
// ---------------------------------------------------------------------------

export type VarianceStatus = 'over' | 'under' | 'on_budget';

export interface CategoryComparison {
  category: CostCategory;
  budgetKobo: number;
  actualKobo: number;
  /** Positive means over budget. */
  varianceKobo: number;
  varianceBp: number;
  status: VarianceStatus;
}

export function compareBudgetToActual(
  budget: CategoryTotals,
  actual: Partial<Record<CostCategory, number>>,
): CategoryComparison[] {
  return ALL_CATEGORIES.map((category) => {
    const budgetKobo = budget[category];
    const actualKobo = actual[category] ?? 0;
    const varianceKobo = actualKobo - budgetKobo;

    return {
      category,
      budgetKobo,
      actualKobo,
      varianceKobo,
      varianceBp: budgetKobo === 0 ? 0 : basisPointsOf(varianceKobo, budgetKobo),
      status: varianceKobo === 0 ? 'on_budget' : varianceKobo > 0 ? 'over' : 'under',
    };
  });
}

/**
 * Actual results replace the estimate with what was really spent. Contingency
 * is a budget allowance, so it does not appear in actual direct costs.
 */
export function evaluateActuals(input: {
  netRevenueKobo: number;
  actualDirectCostsKobo: number;
  overheadKobo: number;
  taxProvisionBp: number;
  vatRateBp: number;
  minMarginBp: number;
  marginThresholds: MarginThresholds;
}): { profit: ProfitResult; band: MarginBand; requiresApproval: boolean } {
  const profit = computeProfit({
    netRevenueKobo: input.netRevenueKobo,
    directCostsKobo: input.actualDirectCostsKobo,
    overheadKobo: input.overheadKobo,
    taxProvisionBp: input.taxProvisionBp,
    vatRateBp: input.vatRateBp,
  });

  return {
    profit,
    band: marginBand(profit.grossMarginBp, input.marginThresholds),
    requiresApproval: requiresApproval(profit.grossMarginBp, input.minMarginBp),
  };
}
