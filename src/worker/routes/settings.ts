import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { requireAuth, requireOwner } from '../auth/middleware';
import { audit, nowIso } from '../db/helpers';
import { getSettingsRow, toSettingsDto } from '../db/settings';
import { validateThresholds } from '../domain/pricing';
import { HttpError, readBody } from '../lib/http';

const text = (max: number) => z.string().trim().max(max);
const bp = z.number().int().min(0).max(10_000);

const settingsSchema = z.object({
  companyName: text(160).optional(),
  companyEmail: text(200).optional(),
  companyPhone: text(60).optional(),
  companyAddress: text(400).optional(),
  bankDetails: text(1000).optional(),
  paymentTerms: text(1000).optional(),
  currency: z.string().trim().length(3).optional(),
  marginBudgetBp: bp.optional(),
  marginMidrangeBp: bp.optional(),
  marginPremiumBp: bp.optional(),
  minMarginBp: bp.optional(),
  bandCriticalBelowBp: bp.optional(),
  bandLowBelowBp: bp.optional(),
  bandAcceptableBelowBp: bp.optional(),
  bandGoodUpToBp: bp.optional(),
  defaultContingencyBp: z.number().int().min(0).max(5_000).optional(),
  contingencyBase: z.enum(['direct', 'direct_plus_overhead']).optional(),
  overheadMethod: z.enum(['none', 'fixed', 'percent']).optional(),
  overheadFixedKobo: z.number().int().min(0).max(1_000_000_000_000).optional(),
  overheadPercentBp: bp.optional(),
  vatEnabled: z.boolean().optional(),
  vatRateBp: bp.optional(),
  taxProvisionBp: bp.optional(),
  quotationValidityDays: z.number().int().min(1).max(365).optional(),
  depositPercentBp: bp.optional(),
});

const COLUMNS: Record<keyof z.infer<typeof settingsSchema>, string> = {
  companyName: 'company_name',
  companyEmail: 'company_email',
  companyPhone: 'company_phone',
  companyAddress: 'company_address',
  bankDetails: 'bank_details',
  paymentTerms: 'payment_terms',
  currency: 'currency',
  marginBudgetBp: 'margin_budget_bp',
  marginMidrangeBp: 'margin_midrange_bp',
  marginPremiumBp: 'margin_premium_bp',
  minMarginBp: 'min_margin_bp',
  bandCriticalBelowBp: 'band_critical_below_bp',
  bandLowBelowBp: 'band_low_below_bp',
  bandAcceptableBelowBp: 'band_acceptable_below_bp',
  bandGoodUpToBp: 'band_good_up_to_bp',
  defaultContingencyBp: 'default_contingency_bp',
  contingencyBase: 'contingency_base',
  overheadMethod: 'overhead_method',
  overheadFixedKobo: 'overhead_fixed_kobo',
  overheadPercentBp: 'overhead_percent_bp',
  vatEnabled: 'vat_enabled',
  vatRateBp: 'vat_rate_bp',
  taxProvisionBp: 'tax_provision_bp',
  quotationValidityDays: 'quotation_validity_days',
  depositPercentBp: 'deposit_percent_bp',
};

export const settingsRoutes = new Hono<AppBindings>();

settingsRoutes.get('/', requireAuth, async (c) => {
  const row = await getSettingsRow(c.env.DB);
  return c.json({ settings: toSettingsDto(row) });
});

settingsRoutes.put('/', requireAuth, requireOwner, async (c) => {
  const user = c.get('user');
  const input = await readBody(c, settingsSchema);
  const current = await getSettingsRow(c.env.DB);

  const nextThresholds = {
    criticalBelowBp: input.bandCriticalBelowBp ?? current.band_critical_below_bp,
    lowBelowBp: input.bandLowBelowBp ?? current.band_low_below_bp,
    acceptableBelowBp: input.bandAcceptableBelowBp ?? current.band_acceptable_below_bp,
    goodUpToBp: input.bandGoodUpToBp ?? current.band_good_up_to_bp,
  };

  try {
    validateThresholds(nextThresholds);
  } catch {
    throw new HttpError(
      400,
      'bad_request',
      'Margin bands must increase: critical < low < acceptable <= good',
      { bandLowBelowBp: 'Bands must increase in order' },
    );
  }

  const sets: string[] = [];
  const values: unknown[] = [];

  for (const [key, column] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
    const value = input[key];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
  }

  if (sets.length === 0) throw new HttpError(400, 'bad_request', 'Nothing to update');

  sets.push('updated_at = ?');
  values.push(nowIso());

  await c.env.DB.prepare(`UPDATE settings SET ${sets.join(', ')} WHERE id = 1`)
    .bind(...values)
    .run();

  await audit(c.env.DB, {
    actor: user,
    action: 'settings.updated',
    entity: 'settings',
    entityId: '1',
    detail: input,
  });

  const updated = await getSettingsRow(c.env.DB);
  return c.json({ settings: toSettingsDto(updated) });
});

/** Branding upload. Stored in R2 and served back by /api/files/logo. */
settingsRoutes.post('/logo', requireAuth, requireOwner, async (c) => {
  const user = c.get('user');
  const form = await c.req.formData();
  const file = form.get('logo');

  if (!(file instanceof File)) {
    throw new HttpError(400, 'bad_request', 'Choose an image file to upload');
  }

  const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
  if (!allowed.includes(file.type)) {
    throw new HttpError(400, 'bad_request', 'Logo must be a PNG, JPEG, WebP or SVG file');
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new HttpError(400, 'bad_request', 'Logo must be smaller than 2 MB');
  }

  const extension = file.type === 'image/png' ? 'png'
    : file.type === 'image/jpeg' ? 'jpg'
    : file.type === 'image/webp' ? 'webp'
    : 'svg';
  const key = `branding/logo.${extension}`;

  await c.env.FILES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  await c.env.DB.prepare('UPDATE settings SET company_logo_key = ?, updated_at = ? WHERE id = 1')
    .bind(key, nowIso())
    .run();

  await audit(c.env.DB, { actor: user, action: 'settings.logo_uploaded', entity: 'settings', entityId: '1' });

  return c.json({ ok: true, logoUrl: '/api/files/logo' });
});

/** Serve the company logo (or any future branding asset) from R2. */
export const fileRoutes = new Hono<AppBindings>();

fileRoutes.get('/logo', requireAuth, async (c) => {
  const row = await getSettingsRow(c.env.DB);
  if (!row.company_logo_key) throw new HttpError(404, 'not_found', 'No logo uploaded');

  const object = await c.env.FILES.get(row.company_logo_key);
  if (!object) throw new HttpError(404, 'not_found', 'Logo file missing from storage');

  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': 'private, max-age=300',
    },
  });
});

/** Audit trail viewer for the owner. */
export const auditRoutes = new Hono<AppBindings>();

auditRoutes.get('/', requireAuth, requireOwner, async (c) => {
  const limit = Math.min(Number.parseInt(c.req.query('limit') ?? '100', 10) || 100, 500);

  const result = await c.env.DB.prepare(
    `SELECT id, actor_email, action, entity, entity_id, detail_json, created_at
       FROM audit_log ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(limit)
    .all<{
      id: string;
      actor_email: string | null;
      action: string;
      entity: string;
      entity_id: string | null;
      detail_json: string;
      created_at: string;
    }>();

  return c.json({
    entries: result.results.map((row) => ({
      id: row.id,
      actorEmail: row.actor_email,
      action: row.action,
      entity: row.entity,
      entityId: row.entity_id,
      detail: JSON.parse(row.detail_json) as unknown,
      createdAt: row.created_at,
    })),
  });
});
