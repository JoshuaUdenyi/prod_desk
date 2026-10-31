import type {
  ActualExpenseDto,
  ActualsDto,
  CostCategory,
  CostLineDto,
  EventType,
  FinancialsDto,
  MarginBand,
  MarginPreset,
  PaymentDto,
  ProjectDetailDto,
  ProjectDto,
  ProjectStatus,
  ProjectSummaryDto,
  QuotationDto,
  QuotationLayout,
  QuotationStatus,
  Role,
  ApprovalStatus,
  PriceBase,
  VarianceRowDto,
} from '@shared/types';
import {
  compareBudgetToActual,
  evaluateActuals,
  evaluateProject,
  type CategoryTotals,
  type CostLineFigure,
  type MarginThresholds,
  type ProjectFinancials,
} from '../domain/pricing';
import type { SettingsRow } from './settings';
import { toMarginThresholds } from './settings';

export interface ProjectRow {
  id: string;
  reference: string;
  name: string;
  client_name: string;
  client_contact: string;
  client_email: string;
  event_type: EventType;
  location: string;
  event_date: string | null;
  production_days: number;
  description: string;
  status: ProjectStatus;
  target_margin_preset: MarginPreset;
  target_margin_bp: number;
  price_base: PriceBase;
  contingency_bp: number;
  contingency_base: 'direct' | 'direct_plus_overhead';
  overhead_method: 'none' | 'fixed' | 'percent';
  overhead_fixed_kobo: number;
  overhead_percent_bp: number;
  selling_price_net_kobo: number;
  vat_rate_bp: number;
  vat_kobo: number;
  approval_status: ApprovalStatus;
  approval_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  quote_locked_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  approved_by_name?: string | null;
  created_by_name?: string | null;
}

export interface CostLineRow {
  id: string;
  project_id: string;
  category: CostCategory;
  kind: CostLineFigure['kind'];
  description: string;
  quantity_milli: number;
  unit_rate_kobo: number;
  days_milli: number;
  additional_kobo: number;
  supplier: string;
  notes: string;
  sort_order: number;
}

export interface ActualRow {
  id: string;
  project_id: string;
  cost_line_id: string | null;
  category: CostCategory;
  description: string;
  amount_kobo: number;
  incurred_on: string | null;
  supplier: string;
  notes: string;
  created_at: string;
}

export interface PaymentRow {
  id: string;
  project_id: string;
  amount_kobo: number;
  paid_on: string;
  method: string;
  reference: string;
  notes: string;
}

export interface QuotationRow {
  id: string;
  project_id: string;
  reference: string;
  version: number;
  layout: QuotationLayout;
  status: QuotationStatus;
  issued_on: string | null;
  valid_until: string | null;
  client_items_json: string;
  client_notes: string;
  subtotal_kobo: number;
  vat_rate_bp: number;
  vat_kobo: number;
  total_kobo: number;
  pdf_r2_key: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Row -> DTO
// ---------------------------------------------------------------------------

export function toProjectDto(row: ProjectRow): ProjectDto {
  return {
    id: row.id,
    reference: row.reference,
    name: row.name,
    clientName: row.client_name,
    clientContact: row.client_contact,
    clientEmail: row.client_email,
    eventType: row.event_type,
    location: row.location,
    eventDate: row.event_date,
    productionDays: row.production_days,
    description: row.description,
    status: row.status,
    targetMarginPreset: row.target_margin_preset,
    targetMarginBp: row.target_margin_bp,
    priceBase: row.price_base,
    contingencyBp: row.contingency_bp,
    contingencyBase: row.contingency_base,
    overheadMethod: row.overhead_method,
    overheadFixedKobo: row.overhead_fixed_kobo,
    overheadPercentBp: row.overhead_percent_bp,
    sellingPriceNetKobo: row.selling_price_net_kobo,
    vatRateBp: row.vat_rate_bp,
    vatKobo: row.vat_kobo,
    approvalStatus: row.approval_status,
    approvalReason: row.approval_reason,
    approvedByName: row.approved_by_name ?? null,
    approvedAt: row.approved_at,
    quoteLockedAt: row.quote_locked_at,
    createdByName: row.created_by_name ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toCostLineDto(row: CostLineRow, totalKobo: number): CostLineDto {
  return {
    id: row.id,
    projectId: row.project_id,
    category: row.category,
    kind: row.kind,
    description: row.description,
    quantityMilli: row.quantity_milli,
    unitRateKobo: row.unit_rate_kobo,
    daysMilli: row.days_milli,
    additionalKobo: row.additional_kobo,
    supplier: row.supplier,
    notes: row.notes,
    sortOrder: row.sort_order,
    totalKobo,
  };
}

export function toActualDto(row: ActualRow): ActualExpenseDto {
  return {
    id: row.id,
    projectId: row.project_id,
    costLineId: row.cost_line_id,
    category: row.category,
    description: row.description,
    amountKobo: row.amount_kobo,
    incurredOn: row.incurred_on,
    supplier: row.supplier,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export function toPaymentDto(row: PaymentRow): PaymentDto {
  return {
    id: row.id,
    amountKobo: row.amount_kobo,
    paidOn: row.paid_on,
    method: row.method,
    reference: row.reference,
    notes: row.notes,
  };
}

export function toQuotationDto(row: QuotationRow): QuotationDto {
  return {
    id: row.id,
    projectId: row.project_id,
    reference: row.reference,
    version: row.version,
    layout: row.layout,
    status: row.status,
    issuedOn: row.issued_on,
    validUntil: row.valid_until,
    clientItems: JSON.parse(row.client_items_json) as QuotationDto['clientItems'],
    clientNotes: row.client_notes,
    subtotalKobo: row.subtotal_kobo,
    vatRateBp: row.vat_rate_bp,
    vatKobo: row.vat_kobo,
    totalKobo: row.total_kobo,
    pdfUrl: row.pdf_r2_key ? `/api/quotations/${row.id}/pdf` : null,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Engine plumbing
// ---------------------------------------------------------------------------

export function lineFigures(rows: readonly CostLineRow[]): CostLineFigure[] {
  return rows.map((row) => ({
    category: row.category,
    kind: row.kind,
    quantityMilli: row.quantity_milli,
    unitRateKobo: row.unit_rate_kobo,
    daysMilli: row.days_milli,
    additionalKobo: row.additional_kobo,
  }));
}

export function evaluate(project: ProjectRow, lines: readonly CostLineRow[], settings: SettingsRow): ProjectFinancials {
  return evaluateProject({
    lines: lineFigures(lines),
    settings: {
      contingencyBp: project.contingency_bp,
      contingencyBase: project.contingency_base,
      overheadMethod: project.overhead_method,
      overheadFixedKobo: project.overhead_fixed_kobo,
      overheadPercentBp: project.overhead_percent_bp,
      vatRateBp: project.vat_rate_bp,
      taxProvisionBp: settings.tax_provision_bp,
      minMarginBp: settings.min_margin_bp,
      marginThresholds: toMarginThresholds(settings),
    },
    priceBase: project.price_base,
    targetMarginBp: project.target_margin_bp,
    sellingPriceNetKobo: project.selling_price_net_kobo > 0 ? project.selling_price_net_kobo : null,
  });
}

export function toFinancialsDto(financials: ProjectFinancials, minMarginBp: number): FinancialsDto {
  const { breakdown, profit } = financials;

  return {
    directSubtotalKobo: breakdown.directSubtotalKobo,
    contingencyBaseKobo: breakdown.contingencyBaseKobo,
    contingencyKobo: breakdown.contingencyKobo,
    directCostsKobo: breakdown.directCostsKobo,
    manualOverheadKobo: breakdown.manualOverheadKobo,
    allocatedOverheadKobo: breakdown.allocatedOverheadKobo,
    overheadKobo: breakdown.overheadKobo,
    priceBaseKobo: breakdown.priceBaseKobo,
    priceBaseLabel: breakdown.priceBaseLabel,
    categoryTotals: breakdown.categoryTotals,

    recommendedPriceKobo: financials.recommendedPriceKobo,
    sellingPriceNetKobo: financials.sellingPriceNetKobo,
    priceOverridden: financials.priceOverridden,

    grossProfitKobo: profit.grossProfitKobo,
    grossMarginBp: profit.grossMarginBp,
    operatingProfitKobo: profit.operatingProfitKobo,
    operatingMarginBp: profit.operatingMarginBp,
    taxProvisionKobo: profit.taxProvisionKobo,
    netProfitKobo: profit.netProfitKobo,
    netMarginBp: profit.netMarginBp,

    vatRateBp: profit.vatRateBp,
    vatKobo: profit.vatKobo,
    totalPayableKobo: profit.totalPayableKobo,

    band: financials.band,
    requiresApproval: financials.requiresApproval,
    minMarginBp,
    warnings: financials.warnings,
  };
}

// ---------------------------------------------------------------------------
// Actuals and variance
// ---------------------------------------------------------------------------

export function buildActuals(
  project: ProjectRow,
  lines: readonly CostLineRow[],
  actuals: readonly ActualRow[],
  settings: SettingsRow,
  financials: ProjectFinancials,
): ActualsDto {
  const actualDirectCostsKobo = actuals
    .filter((row) => row.category !== 'overhead')
    .reduce((sum, row) => sum + row.amount_kobo, 0);

  const actualOverheadKobo =
    actuals.filter((row) => row.category === 'overhead').reduce((sum, row) => sum + row.amount_kobo, 0) +
    financials.breakdown.allocatedOverheadKobo;

  const thresholds: MarginThresholds = toMarginThresholds(settings);
  const result = evaluateActuals({
    netRevenueKobo: financials.sellingPriceNetKobo,
    actualDirectCostsKobo,
    overheadKobo: actualOverheadKobo,
    taxProvisionBp: settings.tax_provision_bp,
    vatRateBp: project.vat_rate_bp,
    minMarginBp: settings.min_margin_bp,
    marginThresholds: thresholds,
  });

  const actualByCategory: Partial<Record<CostCategory, number>> = {};
  for (const row of actuals) {
    actualByCategory[row.category] = (actualByCategory[row.category] ?? 0) + row.amount_kobo;
  }

  const budget: CategoryTotals = { ...financials.breakdown.categoryTotals };
  const variance: VarianceRowDto[] = compareBudgetToActual(budget, actualByCategory);
  const varianceTotalKobo = variance.reduce((sum, row) => sum + row.varianceKobo, 0);

  return {
    actualDirectCostsKobo,
    actualOverheadKobo,
    actualGrossProfitKobo: result.profit.grossProfitKobo,
    actualMarginBp: result.profit.grossMarginBp,
    actualOperatingProfitKobo: result.profit.operatingProfitKobo,
    actualNetProfitKobo: result.profit.netProfitKobo,
    actualBand: result.band satisfies MarginBand,
    variance,
    varianceTotalKobo,
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const PROJECT_SELECT = `
  SELECT p.*,
         creator.name AS created_by_name,
         approver.name AS approved_by_name
    FROM projects p
    LEFT JOIN users creator ON creator.id = p.created_by
    LEFT JOIN users approver ON approver.id = p.approved_by
`;

export async function findProjectRow(db: D1Database, id: string): Promise<ProjectRow | null> {
  return db.prepare(`${PROJECT_SELECT} WHERE p.id = ?`).bind(id).first<ProjectRow>();
}

export async function loadCostLines(db: D1Database, projectId: string): Promise<CostLineRow[]> {
  const result = await db
    .prepare('SELECT * FROM cost_lines WHERE project_id = ? ORDER BY category, sort_order, created_at')
    .bind(projectId)
    .all<CostLineRow>();
  return result.results;
}

export async function loadActuals(db: D1Database, projectId: string): Promise<ActualRow[]> {
  const result = await db
    .prepare('SELECT * FROM actual_expenses WHERE project_id = ? ORDER BY COALESCE(incurred_on, created_at) DESC')
    .bind(projectId)
    .all<ActualRow>();
  return result.results;
}

export async function loadPayments(db: D1Database, projectId: string): Promise<PaymentRow[]> {
  const result = await db
    .prepare('SELECT * FROM payments WHERE project_id = ? ORDER BY paid_on DESC')
    .bind(projectId)
    .all<PaymentRow>();
  return result.results;
}

export async function loadQuotations(db: D1Database, projectId: string): Promise<QuotationRow[]> {
  const result = await db
    .prepare('SELECT * FROM quotations WHERE project_id = ? ORDER BY version DESC')
    .bind(projectId)
    .all<QuotationRow>();
  return result.results;
}

export async function loadProjectDetail(
  db: D1Database,
  id: string,
  settings: SettingsRow,
): Promise<ProjectDetailDto | null> {
  const project = await findProjectRow(db, id);
  if (!project) return null;

  const [lines, actuals, payments, quotations] = await Promise.all([
    loadCostLines(db, id),
    loadActuals(db, id),
    loadPayments(db, id),
    loadQuotations(db, id),
  ]);

  const financials = evaluate(project, lines, settings);
  const financialsDto = toFinancialsDto(financials, settings.min_margin_bp);
  const actualsDto = buildActuals(project, lines, actuals, settings, financials);

  const paidKobo = payments.reduce((sum, row) => sum + row.amount_kobo, 0);
  const balanceKobo = financialsDto.totalPayableKobo - paidKobo;

  return {
    project: toProjectDto(project),
    // computeCostBreakdown returns totals in the same order as the input lines.
    costLines: lines.map((row, index) =>
      toCostLineDto(row, financials.breakdown.lines[index]?.totalKobo ?? 0),
    ),
    financials: financialsDto,
    actualExpenses: actuals.map(toActualDto),
    actuals: actualsDto,
    payments: payments.map(toPaymentDto),
    paidKobo,
    balanceKobo,
    quotations: quotations.map(toQuotationDto),
  };
}

export interface ProjectFilters {
  from?: string | null;
  to?: string | null;
  status?: ProjectStatus | null;
}

export async function listProjectRows(
  db: D1Database,
  filters: ProjectFilters,
): Promise<ProjectRow[]> {
  const clauses: string[] = [];
  const values: unknown[] = [];

  if (filters.from) {
    clauses.push('COALESCE(p.event_date, p.created_at) >= ?');
    values.push(filters.from);
  }
  if (filters.to) {
    clauses.push('COALESCE(p.event_date, p.created_at) <= ?');
    values.push(filters.to);
  }
  if (filters.status) {
    clauses.push('p.status = ?');
    values.push(filters.status);
  }

  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const result = await db
    .prepare(`${PROJECT_SELECT}${where} ORDER BY COALESCE(p.event_date, p.created_at) DESC`)
    .bind(...values)
    .all<ProjectRow>();

  return result.results;
}

/** Bulk-load cost lines and payments so list views avoid N+1 queries. */
export async function loadSummaries(
  db: D1Database,
  projects: readonly ProjectRow[],
  settings: SettingsRow,
): Promise<ProjectSummaryDto[]> {
  if (projects.length === 0) return [];

  const ids = projects.map((project) => project.id);
  const placeholders = ids.map(() => '?').join(',');

  const [lineResult, paymentResult] = await Promise.all([
    db
      .prepare(`SELECT * FROM cost_lines WHERE project_id IN (${placeholders})`)
      .bind(...ids)
      .all<CostLineRow>(),
    db
      .prepare(
        `SELECT project_id, SUM(amount_kobo) AS paid
           FROM payments WHERE project_id IN (${placeholders})
          GROUP BY project_id`,
      )
      .bind(...ids)
      .all<{ project_id: string; paid: number }>(),
  ]);

  const linesByProject = new Map<string, CostLineRow[]>();
  for (const line of lineResult.results) {
    const bucket = linesByProject.get(line.project_id) ?? [];
    bucket.push(line);
    linesByProject.set(line.project_id, bucket);
  }

  const paidByProject = new Map(paymentResult.results.map((row) => [row.project_id, row.paid]));

  return projects.map((project) => {
    const financials = evaluate(project, linesByProject.get(project.id) ?? [], settings);
    const paidKobo = paidByProject.get(project.id) ?? 0;

    return {
      id: project.id,
      reference: project.reference,
      name: project.name,
      clientName: project.client_name,
      eventType: project.event_type,
      eventDate: project.event_date,
      status: project.status,
      sellingPriceNetKobo: financials.sellingPriceNetKobo,
      vatKobo: financials.profit.vatKobo,
      estimatedCostKobo: financials.breakdown.directCostsKobo,
      estimatedGrossProfitKobo: financials.profit.grossProfitKobo,
      estimatedMarginBp: financials.profit.grossMarginBp,
      band: financials.band,
      approvalStatus: project.approval_status,
      paidKobo,
      balanceKobo: financials.profit.totalPayableKobo - paidKobo,
      updatedAt: project.updated_at,
    };
  });
}

export type { Role };
