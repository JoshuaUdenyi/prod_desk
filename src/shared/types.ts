/**
 * Types shared by the Worker API and the React client.
 *
 * Money fields are always integer kobo. Quantity/duration fields are always
 * milli-units. Percentages are always basis points. If a name does not carry a
 * unit suffix, it is not money.
 */

export type Role = 'owner' | 'finance';

export type ProjectStatus =
  | 'draft'
  | 'quoted'
  | 'approved'
  | 'in_production'
  | 'completed'
  | 'cancelled';

export type EventType =
  | 'corporate'
  | 'conference'
  | 'concert'
  | 'church'
  | 'wedding'
  | 'government'
  | 'product_launch'
  | 'workshop'
  | 'other';

export type CostCategory =
  | 'equipment'
  | 'crew'
  | 'logistics'
  | 'internet'
  | 'other'
  | 'overhead';

export type DirectCategory = Exclude<CostCategory, 'overhead'>;

export type LineKind = 'equipment' | 'crew' | 'standard';

export type PriceBase =
  | 'direct'
  | 'direct_plus_contingency'
  | 'direct_plus_contingency_plus_overhead';

export type MarginPreset = 'budget' | 'midrange' | 'premium' | 'custom';

export type MarginBand = 'critical' | 'low' | 'acceptable' | 'good' | 'excellent';

export type ApprovalStatus = 'not_required' | 'required' | 'approved';

export type QuotationStatus = 'draft' | 'issued' | 'accepted' | 'declined' | 'expired';

export type QuotationLayout = 'detailed' | 'package';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface SettingsDto {
  companyName: string;
  companyLogoUrl: string | null;
  companyEmail: string;
  companyPhone: string;
  companyAddress: string;
  bankDetails: string;
  paymentTerms: string;
  currency: string;
  marginBudgetBp: number;
  marginMidrangeBp: number;
  marginPremiumBp: number;
  minMarginBp: number;
  bandCriticalBelowBp: number;
  bandLowBelowBp: number;
  bandAcceptableBelowBp: number;
  bandGoodUpToBp: number;
  defaultContingencyBp: number;
  contingencyBase: 'direct' | 'direct_plus_overhead';
  overheadMethod: 'none' | 'fixed' | 'percent';
  overheadFixedKobo: number;
  overheadPercentBp: number;
  vatEnabled: boolean;
  vatRateBp: number;
  taxProvisionBp: number;
  quotationValidityDays: number;
  depositPercentBp: number;
  updatedAt: string;
}

export type SettingsUpdate = Partial<Omit<SettingsDto, 'companyLogoUrl' | 'updatedAt'>>;

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface ProjectSummaryDto {
  id: string;
  reference: string;
  name: string;
  clientName: string;
  eventType: EventType;
  eventDate: string | null;
  status: ProjectStatus;
  sellingPriceNetKobo: number;
  vatKobo: number;
  estimatedCostKobo: number;
  estimatedGrossProfitKobo: number;
  estimatedMarginBp: number;
  band: MarginBand;
  approvalStatus: ApprovalStatus;
  paidKobo: number;
  balanceKobo: number;
  updatedAt: string;
}

export interface ProjectDto {
  id: string;
  reference: string;
  name: string;
  clientName: string;
  clientContact: string;
  clientEmail: string;
  eventType: EventType;
  location: string;
  eventDate: string | null;
  productionDays: number;
  description: string;
  status: ProjectStatus;
  targetMarginPreset: MarginPreset;
  targetMarginBp: number;
  priceBase: PriceBase;
  contingencyBp: number;
  contingencyBase: 'direct' | 'direct_plus_overhead';
  overheadMethod: 'none' | 'fixed' | 'percent';
  overheadFixedKobo: number;
  overheadPercentBp: number;
  sellingPriceNetKobo: number;
  vatRateBp: number;
  vatKobo: number;
  approvalStatus: ApprovalStatus;
  approvalReason: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  quoteLockedAt: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface CostLineDto {
  id: string;
  projectId: string;
  category: CostCategory;
  kind: LineKind;
  description: string;
  quantityMilli: number;
  unitRateKobo: number;
  daysMilli: number;
  additionalKobo: number;
  supplier: string;
  notes: string;
  sortOrder: number;
  /** Server-computed line total. */
  totalKobo: number;
}

export interface ActualExpenseDto {
  id: string;
  projectId: string;
  costLineId: string | null;
  category: CostCategory;
  description: string;
  amountKobo: number;
  incurredOn: string | null;
  supplier: string;
  notes: string;
  createdAt: string;
}

/** Variance row for the budget-vs-actual view (PRD §6). */
export interface VarianceRowDto {
  category: CostCategory;
  budgetKobo: number;
  actualKobo: number;
  varianceKobo: number;
  varianceBp: number;
  /** Budget still unspent in this category. Never negative. */
  remainingKobo: number;
  /** `not_logged` means the category has a budget but no expense yet. */
  status: 'over' | 'under' | 'on_budget' | 'not_logged';
}

export interface FinancialsDto {
  directSubtotalKobo: number;
  contingencyBaseKobo: number;
  contingencyKobo: number;
  directCostsKobo: number;
  manualOverheadKobo: number;
  allocatedOverheadKobo: number;
  overheadKobo: number;
  priceBaseKobo: number;
  priceBaseLabel: string;
  categoryTotals: Record<CostCategory, number>;

  recommendedPriceKobo: number;
  sellingPriceNetKobo: number;
  priceOverridden: boolean;

  grossProfitKobo: number;
  grossMarginBp: number;
  operatingProfitKobo: number;
  operatingMarginBp: number;
  taxProvisionKobo: number;
  netProfitKobo: number;
  netMarginBp: number;

  vatRateBp: number;
  vatKobo: number;
  totalPayableKobo: number;

  band: MarginBand;
  requiresApproval: boolean;
  minMarginBp: number;
  warnings: string[];
}

export interface ActualsDto {
  actualDirectCostsKobo: number;
  actualOverheadKobo: number;
  actualGrossProfitKobo: number;
  actualMarginBp: number;
  actualOperatingProfitKobo: number;
  actualNetProfitKobo: number;
  actualBand: MarginBand;
  variance: VarianceRowDto[];
  varianceTotalKobo: number;

  /** Direct-cost budget the logged expenses are measured against (excludes contingency). */
  budgetDirectKobo: number;
  /** Share of that budget logged so far, in basis points; above 10,000 means over. */
  coverageBp: number;
  /** Budget not yet logged. Never negative. */
  remainingKobo: number;
  /** Budgeted categories with no expense yet. */
  unloggedCategories: CostCategory[];
  /** Whether the logged expenses are a complete picture of the job's costs. */
  verdict: 'empty' | 'partial' | 'complete';
  /** Actual gross profit less planned gross profit. Positive means better than plan. */
  profitVsPlanKobo: number;
}

export interface PaymentDto {
  id: string;
  amountKobo: number;
  paidOn: string;
  method: string;
  reference: string;
  notes: string;
}

export interface ProjectDetailDto {
  project: ProjectDto;
  costLines: CostLineDto[];
  financials: FinancialsDto;
  actualExpenses: ActualExpenseDto[];
  actuals: ActualsDto;
  payments: PaymentDto[];
  paidKobo: number;
  balanceKobo: number;
  quotations: QuotationDto[];
}

// ---------------------------------------------------------------------------
// Quotations
// ---------------------------------------------------------------------------

export interface QuotationItemDto {
  description: string;
  quantityMilli: number;
  unitLabel: string;
  unitRateKobo: number;
  totalKobo: number;
}

export interface QuotationDto {
  id: string;
  projectId: string;
  reference: string;
  version: number;
  layout: QuotationLayout;
  status: QuotationStatus;
  issuedOn: string | null;
  validUntil: string | null;
  clientItems: QuotationItemDto[];
  clientNotes: string;
  subtotalKobo: number;
  vatRateBp: number;
  vatKobo: number;
  totalKobo: number;
  pdfUrl: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface DashboardMetricsDto {
  projectCount: number;
  activeProjects: number;
  quotedRevenueKobo: number;
  completedRevenueKobo: number;
  estimatedGrossProfitKobo: number;
  actualGrossProfitKobo: number;
  estimatedNetProfitKobo: number;
  actualNetProfitKobo: number;
  outstandingBalanceKobo: number;
  /** Projects with at least one expense logged. Actual profit only covers these. */
  actualsLoggedProjects: number;
  /** Of those, projects with budgeted categories that still have no expense logged. */
  actualsPartialProjects: number;
}

export interface DashboardDto {
  metrics: DashboardMetricsDto;
  projects: ProjectSummaryDto[];
  range: { from: string | null; to: string | null };
}

// ---------------------------------------------------------------------------
// API envelope
// ---------------------------------------------------------------------------

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}
