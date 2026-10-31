import type { SettingsDto } from '@shared/types';
import type { CostingSettings, MarginThresholds } from '../domain/pricing';

export interface SettingsRow {
  id: number;
  company_name: string;
  company_logo_key: string | null;
  company_email: string;
  company_phone: string;
  company_address: string;
  bank_details: string;
  payment_terms: string;
  currency: string;
  margin_budget_bp: number;
  margin_midrange_bp: number;
  margin_premium_bp: number;
  min_margin_bp: number;
  band_critical_below_bp: number;
  band_low_below_bp: number;
  band_acceptable_below_bp: number;
  band_good_up_to_bp: number;
  default_contingency_bp: number;
  contingency_base: 'direct' | 'direct_plus_overhead';
  overhead_method: 'none' | 'fixed' | 'percent';
  overhead_fixed_kobo: number;
  overhead_percent_bp: number;
  vat_enabled: number;
  vat_rate_bp: number;
  tax_provision_bp: number;
  quotation_validity_days: number;
  deposit_percent_bp: number;
  updated_at: string;
}

export async function getSettingsRow(db: D1Database): Promise<SettingsRow> {
  const row = await db.prepare('SELECT * FROM settings WHERE id = 1').first<SettingsRow>();
  if (row) return row;

  // The migration seeds this row; recreate it rather than fail a request.
  await db
    .prepare('INSERT OR IGNORE INTO settings (id, company_name, updated_at) VALUES (1, ?, ?)')
    .bind('ProductionDesk', new Date().toISOString())
    .run();

  const created = await db.prepare('SELECT * FROM settings WHERE id = 1').first<SettingsRow>();
  if (!created) throw new Error('Settings row missing and could not be created');
  return created;
}

export function toSettingsDto(row: SettingsRow): SettingsDto {
  return {
    companyName: row.company_name,
    companyLogoUrl: row.company_logo_key ? '/api/files/logo' : null,
    companyEmail: row.company_email,
    companyPhone: row.company_phone,
    companyAddress: row.company_address,
    bankDetails: row.bank_details,
    paymentTerms: row.payment_terms,
    currency: row.currency,
    marginBudgetBp: row.margin_budget_bp,
    marginMidrangeBp: row.margin_midrange_bp,
    marginPremiumBp: row.margin_premium_bp,
    minMarginBp: row.min_margin_bp,
    bandCriticalBelowBp: row.band_critical_below_bp,
    bandLowBelowBp: row.band_low_below_bp,
    bandAcceptableBelowBp: row.band_acceptable_below_bp,
    bandGoodUpToBp: row.band_good_up_to_bp,
    defaultContingencyBp: row.default_contingency_bp,
    contingencyBase: row.contingency_base,
    overheadMethod: row.overhead_method,
    overheadFixedKobo: row.overhead_fixed_kobo,
    overheadPercentBp: row.overhead_percent_bp,
    vatEnabled: row.vat_enabled === 1,
    vatRateBp: row.vat_rate_bp,
    taxProvisionBp: row.tax_provision_bp,
    quotationValidityDays: row.quotation_validity_days,
    depositPercentBp: row.deposit_percent_bp,
    updatedAt: row.updated_at,
  };
}

export function toCostingSettings(row: SettingsRow): CostingSettings {
  return {
    contingencyBp: row.default_contingency_bp,
    contingencyBase: row.contingency_base,
    overheadMethod: row.overhead_method,
    overheadFixedKobo: row.overhead_fixed_kobo,
    overheadPercentBp: row.overhead_percent_bp,
  };
}

export function toMarginThresholds(row: SettingsRow): MarginThresholds {
  return {
    criticalBelowBp: row.band_critical_below_bp,
    lowBelowBp: row.band_low_below_bp,
    acceptableBelowBp: row.band_acceptable_below_bp,
    goodUpToBp: row.band_good_up_to_bp,
  };
}
