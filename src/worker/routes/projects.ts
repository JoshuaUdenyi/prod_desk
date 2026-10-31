import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../env';
import { requireAuth, requireOwner } from '../auth/middleware';
import { audit, newId, nextProjectReference, nowIso } from '../db/helpers';
import { getSettingsRow } from '../db/settings';
import {
  evaluate,
  findProjectRow,
  loadProjectDetail,
  loadSummaries,
  listProjectRows,
  type CostLineRow,
  type ProjectRow,
} from '../db/projects';
import { HttpError, readBody } from '../lib/http';
import { percentOf } from '../domain/money';

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const kobo = z.number().int().min(0).max(1_000_000_000_000);
const milli = z.number().int().min(0).max(10_000_000);
const basisPoints = z.number().int().min(0).max(10_000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const eventType = z.enum([
  'corporate',
  'conference',
  'concert',
  'church',
  'wedding',
  'government',
  'product_launch',
  'workshop',
  'other',
]);

const projectStatus = z.enum([
  'draft',
  'quoted',
  'approved',
  'in_production',
  'completed',
  'cancelled',
]);

const marginPreset = z.enum(['budget', 'midrange', 'premium', 'custom']);
const priceBase = z.enum([
  'direct',
  'direct_plus_contingency',
  'direct_plus_contingency_plus_overhead',
]);
const category = z.enum(['equipment', 'crew', 'logistics', 'internet', 'other', 'overhead']);
const directCategory = z.enum(['equipment', 'crew', 'logistics', 'internet', 'other']);
const lineKind = z.enum(['equipment', 'crew', 'standard']);

const createProjectSchema = z.object({
  name: z.string().trim().min(2, 'Enter a project name').max(160),
  clientName: z.string().trim().min(1, 'Enter the client name').max(160),
  clientContact: z.string().trim().max(160).default(''),
  clientEmail: z.string().trim().max(200).default(''),
  eventType: eventType.default('other'),
  location: z.string().trim().max(200).default(''),
  eventDate: isoDate.nullish(),
  productionDays: z.number().int().min(1).max(365).default(1),
  description: z.string().trim().max(4000).default(''),
  targetMarginPreset: marginPreset.default('midrange'),
  targetMarginBp: basisPoints.optional(),
  priceBase: priceBase.default('direct_plus_contingency'),
  contingencyBp: basisPoints.optional(),
  contingencyBase: z.enum(['direct', 'direct_plus_overhead']).optional(),
  overheadMethod: z.enum(['none', 'fixed', 'percent']).optional(),
  overheadFixedKobo: kobo.optional(),
  overheadPercentBp: basisPoints.optional(),
  vatRateBp: basisPoints.optional(),
});

// Patch schemas spell their fields out with no defaults: `.partial()` keeps an
// inner `.default()`, so a PATCH carrying one field would silently reset every
// other field to its default.
const updateProjectSchema = z.object({
  name: z.string().trim().min(2, 'Enter a project name').max(160).optional(),
  clientName: z.string().trim().min(1, 'Enter the client name').max(160).optional(),
  clientContact: z.string().trim().max(160).optional(),
  clientEmail: z.string().trim().max(200).optional(),
  eventType: eventType.optional(),
  location: z.string().trim().max(200).optional(),
  eventDate: isoDate.nullish(),
  productionDays: z.number().int().min(1).max(365).optional(),
  description: z.string().trim().max(4000).optional(),
  targetMarginPreset: marginPreset.optional(),
  targetMarginBp: basisPoints.optional(),
  priceBase: priceBase.optional(),
  contingencyBp: basisPoints.optional(),
  contingencyBase: z.enum(['direct', 'direct_plus_overhead']).optional(),
  overheadMethod: z.enum(['none', 'fixed', 'percent']).optional(),
  overheadFixedKobo: kobo.optional(),
  overheadPercentBp: basisPoints.optional(),
  vatRateBp: basisPoints.optional(),
  status: projectStatus.optional(),
});

const costLineSchema = z.object({
  category,
  kind: lineKind.optional(),
  description: z.string().trim().min(1, 'Describe the line item').max(300),
  quantityMilli: milli.default(1_000),
  unitRateKobo: kobo.default(0),
  daysMilli: milli.default(1_000),
  additionalKobo: z.number().int().min(0).max(1_000_000_000_000).default(0),
  supplier: z.string().trim().max(160).default(''),
  notes: z.string().trim().max(1000).default(''),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

const costLinePatchSchema = z.object({
  category: category.optional(),
  kind: lineKind.optional(),
  description: z.string().trim().min(1, 'Describe the line item').max(300).optional(),
  quantityMilli: milli.optional(),
  unitRateKobo: kobo.optional(),
  daysMilli: milli.optional(),
  additionalKobo: z.number().int().min(0).max(1_000_000_000_000).optional(),
  supplier: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(1000).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

const pricingSchema = z.object({
  targetMarginPreset: marginPreset.optional(),
  targetMarginBp: basisPoints.optional(),
  priceBase: priceBase.optional(),
  /** null clears the override and returns to the recommended price. */
  sellingPriceNetKobo: kobo.nullable().optional(),
  contingencyBp: basisPoints.optional(),
  contingencyBase: z.enum(['direct', 'direct_plus_overhead']).optional(),
  overheadMethod: z.enum(['none', 'fixed', 'percent']).optional(),
  overheadFixedKobo: kobo.optional(),
  overheadPercentBp: basisPoints.optional(),
  vatRateBp: basisPoints.optional(),
});

const approvalSchema = z.object({
  reason: z.string().trim().min(5, 'Give a short reason for approving this price').max(500),
});

const actualSchema = z.object({
  costLineId: z.string().uuid().nullish(),
  category,
  description: z.string().trim().min(1, 'Describe the expense').max(300),
  amountKobo: kobo,
  incurredOn: isoDate.nullish(),
  supplier: z.string().trim().max(160).default(''),
  notes: z.string().trim().max(1000).default(''),
});

const actualPatchSchema = z.object({
  costLineId: z.string().uuid().nullish(),
  category: category.optional(),
  description: z.string().trim().min(1, 'Describe the expense').max(300).optional(),
  amountKobo: kobo.optional(),
  incurredOn: isoDate.nullish(),
  supplier: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(1000).optional(),
});

const paymentSchema = z.object({
  amountKobo: z.number().int().min(1).max(1_000_000_000_000),
  paidOn: isoDate,
  method: z.string().trim().max(80).default(''),
  reference: z.string().trim().max(120).default(''),
  notes: z.string().trim().max(500).default(''),
});

// ---------------------------------------------------------------------------
// Shared loaders
// ---------------------------------------------------------------------------

async function requireProject(db: D1Database, id: string): Promise<ProjectRow> {
  const project = await findProjectRow(db, id);
  if (!project) throw new HttpError(404, 'not_found', 'Project not found');
  return project;
}

/** Project settings snapshot, falling back to company defaults on create. */
function resolveMargin(preset: string, explicit: number | undefined, settings: { margin_budget_bp: number; margin_midrange_bp: number; margin_premium_bp: number }): number {
  if (explicit !== undefined) return explicit;
  switch (preset) {
    case 'budget':
      return settings.margin_budget_bp;
    case 'premium':
      return settings.margin_premium_bp;
    case 'custom':
      return settings.margin_midrange_bp;
    default:
      return settings.margin_midrange_bp;
  }
}

export const projectRoutes = new Hono<AppBindings>();

projectRoutes.use('*', requireAuth);

// ---------------------------------------------------------------------------
// List and create
// ---------------------------------------------------------------------------

projectRoutes.get('/', async (c) => {
  const settings = await getSettingsRow(c.env.DB);

  const rows = await listProjectRows(c.env.DB, {
    from: c.req.query('from') ?? null,
    to: c.req.query('to') ?? null,
    status: (c.req.query('status') as never) ?? null,
  });

  const summaries = await loadSummaries(c.env.DB, rows, settings);
  return c.json({ projects: summaries });
});

projectRoutes.post('/', async (c) => {
  const user = c.get('user');
  const input = await readBody(c, createProjectSchema);
  const settings = await getSettingsRow(c.env.DB);

  const id = newId();
  const reference = await nextProjectReference(c.env.DB);
  const timestamp = nowIso();

  const targetMarginBp = resolveMargin(input.targetMarginPreset, input.targetMarginBp, settings);

  // A new project prices on the recommended figure, so the stored price is
  // consistent with the stored margin from the first render.
  const emptyFinancials = evaluate(
    {
      id,
      reference,
      name: input.name,
      client_name: input.clientName,
      client_contact: input.clientContact,
      client_email: input.clientEmail,
      event_type: input.eventType,
      location: input.location,
      event_date: input.eventDate ?? null,
      production_days: input.productionDays,
      description: input.description,
      status: 'draft',
      target_margin_preset: input.targetMarginPreset,
      target_margin_bp: targetMarginBp,
      price_base: input.priceBase,
      contingency_bp: input.contingencyBp ?? settings.default_contingency_bp,
      contingency_base: input.contingencyBase ?? settings.contingency_base,
      overhead_method: input.overheadMethod ?? settings.overhead_method,
      overhead_fixed_kobo: input.overheadFixedKobo ?? settings.overhead_fixed_kobo,
      overhead_percent_bp: input.overheadPercentBp ?? settings.overhead_percent_bp,
      selling_price_net_kobo: 0,
      vat_rate_bp: input.vatRateBp ?? settings.vat_rate_bp,
      vat_kobo: 0,
      approval_status: 'not_required',
      approval_reason: null,
      approved_by: null,
      approved_at: null,
      quote_locked_at: null,
      created_by: user.id,
      created_at: timestamp,
      updated_at: timestamp,
    },
    [],
    settings,
  );

  const sellingPrice = emptyFinancials.recommendedPriceKobo;
  const vatKobo = percentOf(sellingPrice, input.vatRateBp ?? settings.vat_rate_bp);

  await c.env.DB.prepare(
    `INSERT INTO projects (
       id, reference, name, client_name, client_contact, client_email, event_type,
       location, event_date, production_days, description, status,
       target_margin_preset, target_margin_bp, price_base,
       contingency_bp, contingency_base, overhead_method, overhead_fixed_kobo, overhead_percent_bp,
       selling_price_net_kobo, vat_rate_bp, vat_kobo,
       approval_status, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft',
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_required', ?, ?, ?)`,
  )
    .bind(
      id,
      reference,
      input.name,
      input.clientName,
      input.clientContact,
      input.clientEmail,
      input.eventType,
      input.location,
      input.eventDate ?? null,
      input.productionDays,
      input.description,
      input.targetMarginPreset,
      targetMarginBp,
      input.priceBase,
      input.contingencyBp ?? settings.default_contingency_bp,
      input.contingencyBase ?? settings.contingency_base,
      input.overheadMethod ?? settings.overhead_method,
      input.overheadFixedKobo ?? settings.overhead_fixed_kobo,
      input.overheadPercentBp ?? settings.overhead_percent_bp,
      sellingPrice,
      input.vatRateBp ?? settings.vat_rate_bp,
      vatKobo,
      user.id,
      timestamp,
      timestamp,
    )
    .run();

  await audit(c.env.DB, {
    actor: user,
    action: 'project.created',
    entity: 'project',
    entityId: id,
    detail: { reference, name: input.name },
  });

  const detail = await loadProjectDetail(c.env.DB, id, settings);
  return c.json(detail, 201);
});

// ---------------------------------------------------------------------------
// Single project
// ---------------------------------------------------------------------------

projectRoutes.get('/:id', async (c) => {
  const settings = await getSettingsRow(c.env.DB);
  const detail = await loadProjectDetail(c.env.DB, c.req.param('id'), settings);
  if (!detail) throw new HttpError(404, 'not_found', 'Project not found');
  return c.json(detail);
});

projectRoutes.patch('/:id', async (c) => {
  const user = c.get('user');
  const project = await requireProject(c.env.DB, c.req.param('id'));
  const input = await readBody(c, updateProjectSchema);

  const sets: string[] = [];
  const values: unknown[] = [];

  const assign = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };

  if (input.name !== undefined) assign('name', input.name);
  if (input.clientName !== undefined) assign('client_name', input.clientName);
  if (input.clientContact !== undefined) assign('client_contact', input.clientContact);
  if (input.clientEmail !== undefined) assign('client_email', input.clientEmail);
  if (input.eventType !== undefined) assign('event_type', input.eventType);
  if (input.location !== undefined) assign('location', input.location);
  if (input.eventDate !== undefined) assign('event_date', input.eventDate ?? null);
  if (input.productionDays !== undefined) assign('production_days', input.productionDays);
  if (input.description !== undefined) assign('description', input.description);
  if (input.status !== undefined) assign('status', input.status);
  if (input.targetMarginPreset !== undefined) assign('target_margin_preset', input.targetMarginPreset);
  if (input.targetMarginBp !== undefined) assign('target_margin_bp', input.targetMarginBp);
  if (input.priceBase !== undefined) assign('price_base', input.priceBase);
  if (input.contingencyBp !== undefined) assign('contingency_bp', input.contingencyBp);
  if (input.contingencyBase !== undefined) assign('contingency_base', input.contingencyBase);
  if (input.overheadMethod !== undefined) assign('overhead_method', input.overheadMethod);
  if (input.overheadFixedKobo !== undefined) assign('overhead_fixed_kobo', input.overheadFixedKobo);
  if (input.overheadPercentBp !== undefined) assign('overhead_percent_bp', input.overheadPercentBp);
  if (input.vatRateBp !== undefined) assign('vat_rate_bp', input.vatRateBp);

  if (sets.length === 0) throw new HttpError(400, 'bad_request', 'Nothing to update');

  assign('updated_at', nowIso());

  await c.env.DB.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values, project.id)
    .run();

  await audit(c.env.DB, {
    actor: user,
    action: 'project.updated',
    entity: 'project',
    entityId: project.id,
    detail: input,
  });

  const settings = await getSettingsRow(c.env.DB);
  const detail = await loadProjectDetail(c.env.DB, project.id, settings);
  return c.json(detail);
});

projectRoutes.delete('/:id', requireOwner, async (c) => {
  const user = c.get('user');
  const project = await requireProject(c.env.DB, c.req.param('id'));

  if (project.status === 'completed' && project.quote_locked_at) {
    throw new HttpError(
      409,
      'conflict',
      'Completed projects with an issued quotation are kept for history. Cancel the project instead of deleting it.',
    );
  }

  await c.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(project.id).run();

  await audit(c.env.DB, {
    actor: user,
    action: 'project.deleted',
    entity: 'project',
    entityId: project.id,
    detail: { reference: project.reference },
  });

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Cost lines
// ---------------------------------------------------------------------------

function inferKind(cat: string, kind: string | undefined): 'equipment' | 'crew' | 'standard' {
  if (kind) return kind as 'equipment' | 'crew' | 'standard';
  if (cat === 'equipment') return 'equipment';
  if (cat === 'crew') return 'crew';
  return 'standard';
}

projectRoutes.post('/:id/cost-lines', async (c) => {
  const user = c.get('user');
  const project = await requireProject(c.env.DB, c.req.param('id'));
  const input = await readBody(c, costLineSchema);

  const id = newId();
  const timestamp = nowIso();

  await c.env.DB.prepare(
    `INSERT INTO cost_lines (id, project_id, category, kind, description, quantity_milli,
                             unit_rate_kobo, days_milli, additional_kobo, supplier, notes,
                             sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      project.id,
      input.category,
      inferKind(input.category, input.kind),
      input.description,
      input.quantityMilli,
      input.unitRateKobo,
      input.daysMilli,
      input.additionalKobo,
      input.supplier,
      input.notes,
      input.sortOrder,
      timestamp,
      timestamp,
    )
    .run();

  await c.env.DB.prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
    .bind(timestamp, project.id)
    .run();

  await audit(c.env.DB, {
    actor: user,
    action: 'cost_line.created',
    entity: 'cost_line',
    entityId: id,
    detail: { projectId: project.id, category: input.category, description: input.description },
  });

  const settings = await getSettingsRow(c.env.DB);
  const detail = await loadProjectDetail(c.env.DB, project.id, settings);
  return c.json(detail, 201);
});

projectRoutes.patch('/:id/cost-lines/:lineId', async (c) => {
  const user = c.get('user');
  const project = await requireProject(c.env.DB, c.req.param('id'));
  const lineId = c.req.param('lineId');
  const input = await readBody(c, costLinePatchSchema);

  const existing = await c.env.DB.prepare(
    'SELECT id FROM cost_lines WHERE id = ? AND project_id = ?',
  )
    .bind(lineId, project.id)
    .first<{ id: string }>();
  if (!existing) throw new HttpError(404, 'not_found', 'Line item not found');

  const sets: string[] = [];
  const values: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };

  if (input.category !== undefined) assign('category', input.category);
  if (input.kind !== undefined) assign('kind', inferKind(input.category ?? 'other', input.kind));
  if (input.description !== undefined) assign('description', input.description);
  if (input.quantityMilli !== undefined) assign('quantity_milli', input.quantityMilli);
  if (input.unitRateKobo !== undefined) assign('unit_rate_kobo', input.unitRateKobo);
  if (input.daysMilli !== undefined) assign('days_milli', input.daysMilli);
  if (input.additionalKobo !== undefined) assign('additional_kobo', input.additionalKobo);
  if (input.supplier !== undefined) assign('supplier', input.supplier);
  if (input.notes !== undefined) assign('notes', input.notes);
  if (input.sortOrder !== undefined) assign('sort_order', input.sortOrder);

  if (sets.length === 0) throw new HttpError(400, 'bad_request', 'Nothing to update');
  assign('updated_at', nowIso());

  await c.env.DB.prepare(`UPDATE cost_lines SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values, lineId)
    .run();

  await c.env.DB.prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
    .bind(nowIso(), project.id)
    .run();

  await audit(c.env.DB, {
    actor: user,
    action: 'cost_line.updated',
    entity: 'cost_line',
    entityId: lineId,
    detail: { projectId: project.id, ...input },
  });

  const settings = await getSettingsRow(c.env.DB);
  const detail = await loadProjectDetail(c.env.DB, project.id, settings);
  return c.json(detail);
});

projectRoutes.delete('/:id/cost-lines/:lineId', async (c) => {
  const user = c.get('user');
  const project = await requireProject(c.env.DB, c.req.param('id'));
  const lineId = c.req.param('lineId');

  const result = await c.env.DB.prepare('DELETE FROM cost_lines WHERE id = ? AND project_id = ?')
    .bind(lineId, project.id)
    .run();

  if (!result.meta.changes) throw new HttpError(404, 'not_found', 'Line item not found');

  await c.env.DB.prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
    .bind(nowIso(), project.id)
    .run();

  await audit(c.env.DB, {
    actor: user,
    action: 'cost_line.deleted',
    entity: 'cost_line',
    entityId: lineId,
    detail: { projectId: project.id },
  });

  const settings = await getSettingsRow(c.env.DB);
  const detail = await loadProjectDetail(c.env.DB, project.id, settings);
  return c.json(detail);
});

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

projectRoutes.patch('/:id/pricing', async (c) => {
  const user = c.get('user');
  const project = await requireProject(c.env.DB, c.req.param('id'));
  const input = await readBody(c, pricingSchema);
  const settings = await getSettingsRow(c.env.DB);

  const lines = (await c.env.DB.prepare('SELECT * FROM cost_lines WHERE project_id = ?')
    .bind(project.id)
    .all<CostLineRow>()).results;

  const previous = evaluate(project, lines, settings);
  const wasOverridden =
    project.selling_price_net_kobo > 0 && project.selling_price_net_kobo !== previous.recommendedPriceKobo;

  const nextMarginBp = input.targetMarginBp ?? project.target_margin_bp;
  const nextPriceBase = input.priceBase ?? project.price_base;
  const nextVatRateBp = input.vatRateBp ?? project.vat_rate_bp;

  const draft: ProjectRow = {
    ...project,
    target_margin_preset: input.targetMarginPreset ?? project.target_margin_preset,
    target_margin_bp: nextMarginBp,
    price_base: nextPriceBase,
    contingency_bp: input.contingencyBp ?? project.contingency_bp,
    contingency_base: input.contingencyBase ?? project.contingency_base,
    overhead_method: input.overheadMethod ?? project.overhead_method,
    overhead_fixed_kobo: input.overheadFixedKobo ?? project.overhead_fixed_kobo,
    overhead_percent_bp: input.overheadPercentBp ?? project.overhead_percent_bp,
    vat_rate_bp: nextVatRateBp,
  };

  const recalculated = evaluate(draft, lines, settings);

  let sellingPrice: number;
  if (input.sellingPriceNetKobo === null) {
    sellingPrice = recalculated.recommendedPriceKobo;
  } else if (input.sellingPriceNetKobo !== undefined) {
    sellingPrice = input.sellingPriceNetKobo;
  } else {
    sellingPrice = wasOverridden ? project.selling_price_net_kobo : recalculated.recommendedPriceKobo;
  }

  const finalFinancials = evaluate({ ...draft, selling_price_net_kobo: sellingPrice }, lines, settings);
  const vatKobo = percentOf(sellingPrice, nextVatRateBp);

  // Changing the price invalidates any previous sign-off.
  const priceChanged = sellingPrice !== project.selling_price_net_kobo;
  const approvalStatus = finalFinancials.requiresApproval
    ? priceChanged
      ? 'required'
      : project.approval_status
    : 'not_required';

  await c.env.DB.prepare(
    `UPDATE projects SET
       target_margin_preset = ?, target_margin_bp = ?, price_base = ?,
       contingency_bp = ?, contingency_base = ?, overhead_method = ?,
       overhead_fixed_kobo = ?, overhead_percent_bp = ?,
       selling_price_net_kobo = ?, vat_rate_bp = ?, vat_kobo = ?,
       approval_status = ?, approval_reason = CASE WHEN ? = 'required' THEN NULL ELSE approval_reason END,
       approved_by = CASE WHEN ? = 'required' THEN NULL ELSE approved_by END,
       approved_at = CASE WHEN ? = 'required' THEN NULL ELSE approved_at END,
       updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      draft.target_margin_preset,
      draft.target_margin_bp,
      draft.price_base,
      draft.contingency_bp,
      draft.contingency_base,
      draft.overhead_method,
      draft.overhead_fixed_kobo,
      draft.overhead_percent_bp,
      sellingPrice,
      draft.vat_rate_bp,
      vatKobo,
      approvalStatus,
      approvalStatus,
      approvalStatus,
      approvalStatus,
      nowIso(),
      project.id,
    )
    .run();

  if (priceChanged) {
    await audit(c.env.DB, {
      actor: user,
      action: sellingPrice === recalculated.recommendedPriceKobo ? 'pricing.recalculated' : 'pricing.overridden',
      entity: 'project',
      entityId: project.id,
      detail: {
        previousPriceKobo: project.selling_price_net_kobo,
        newPriceKobo: sellingPrice,
        recommendedKobo: recalculated.recommendedPriceKobo,
        targetMarginBp: nextMarginBp,
      },
    });
  }

  const detail = await loadProjectDetail(c.env.DB, project.id, settings);
  return c.json(detail);
});

projectRoutes.post('/:id/approval', requireOwner, async (c) => {
  const user = c.get('user');
  const project = await requireProject(c.env.DB, c.req.param('id'));
  const input = await readBody(c, approvalSchema);
  const settings = await getSettingsRow(c.env.DB);

  const lines = (await c.env.DB.prepare('SELECT * FROM cost_lines WHERE project_id = ?')
    .bind(project.id)
    .all<CostLineRow>()).results;

  const financials = evaluate(project, lines, settings);

  if (!financials.requiresApproval && project.approval_status !== 'required') {
    throw new HttpError(400, 'not_required', 'This price is already at or above the minimum margin');
  }

  await c.env.DB.prepare(
    `UPDATE projects SET approval_status = 'approved', approval_reason = ?,
            approved_by = ?, approved_at = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(input.reason, user.id, nowIso(), nowIso(), project.id)
    .run();

  await audit(c.env.DB, {
    actor: user,
    action: 'pricing.approved',
    entity: 'project',
    entityId: project.id,
    detail: {
      reason: input.reason,
      marginBp: financials.profit.grossMarginBp,
      minimumBp: settings.min_margin_bp,
      priceKobo: financials.sellingPriceNetKobo,
    },
  });

  const detail = await loadProjectDetail(c.env.DB, project.id, settings);
  return c.json(detail);
});

// ---------------------------------------------------------------------------
// Actual expenses
// ---------------------------------------------------------------------------

projectRoutes.post('/:id/actuals', async (c) => {
  const user = c.get('user');
  const project = await requireProject(c.env.DB, c.req.param('id'));
  const input = await readBody(c, actualSchema);

  if (input.costLineId) {
    const link = await c.env.DB.prepare(
      'SELECT id FROM cost_lines WHERE id = ? AND project_id = ?',
    )
      .bind(input.costLineId, project.id)
      .first<{ id: string }>();
    if (!link) throw new HttpError(400, 'bad_request', 'That line item does not belong to this project');
  }

  const id = newId();
  const timestamp = nowIso();

  await c.env.DB.prepare(
    `INSERT INTO actual_expenses (id, project_id, cost_line_id, category, description,
                                  amount_kobo, incurred_on, supplier, notes, created_by,
                                  created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      project.id,
      input.costLineId ?? null,
      input.category,
      input.description,
      input.amountKobo,
      input.incurredOn ?? null,
      input.supplier,
      input.notes,
      user.id,
      timestamp,
      timestamp,
    )
    .run();

  await audit(c.env.DB, {
    actor: user,
    action: 'actual.created',
    entity: 'actual_expense',
    entityId: id,
    detail: { projectId: project.id, category: input.category, amountKobo: input.amountKobo },
  });

  const settings = await getSettingsRow(c.env.DB);
  const detail = await loadProjectDetail(c.env.DB, project.id, settings);
  return c.json(detail, 201);
});

projectRoutes.patch('/:id/actuals/:actualId', async (c) => {
  const user = c.get('user');
  const project = await requireProject(c.env.DB, c.req.param('id'));
  const actualId = c.req.param('actualId');
  const input = await readBody(c, actualPatchSchema);

  const existing = await c.env.DB.prepare(
    'SELECT * FROM actual_expenses WHERE id = ? AND project_id = ?',
  )
    .bind(actualId, project.id)
    .first<{ id: string; amount_kobo: number; description: string }>();
  if (!existing) throw new HttpError(404, 'not_found', 'Expense not found');

  const sets: string[] = [];
  const values: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };

  if (input.costLineId !== undefined) assign('cost_line_id', input.costLineId ?? null);
  if (input.category !== undefined) assign('category', input.category);
  if (input.description !== undefined) assign('description', input.description);
  if (input.amountKobo !== undefined) assign('amount_kobo', input.amountKobo);
  if (input.incurredOn !== undefined) assign('incurred_on', input.incurredOn ?? null);
  if (input.supplier !== undefined) assign('supplier', input.supplier);
  if (input.notes !== undefined) assign('notes', input.notes);

  if (sets.length === 0) throw new HttpError(400, 'bad_request', 'Nothing to update');
  assign('updated_at', nowIso());

  await c.env.DB.prepare(`UPDATE actual_expenses SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values, actualId)
    .run();

  // Amount changes on actual expenses are audit-worthy (PRD §12).
  await audit(c.env.DB, {
    actor: user,
    action: 'actual.updated',
    entity: 'actual_expense',
    entityId: actualId,
    detail: {
      projectId: project.id,
      previousAmountKobo: existing.amount_kobo,
      newAmountKobo: input.amountKobo ?? existing.amount_kobo,
    },
  });

  const settings = await getSettingsRow(c.env.DB);
  const detail = await loadProjectDetail(c.env.DB, project.id, settings);
  return c.json(detail);
});

projectRoutes.delete('/:id/actuals/:actualId', async (c) => {
  const user = c.get('user');
  const project = await requireProject(c.env.DB, c.req.param('id'));
  const actualId = c.req.param('actualId');

  const result = await c.env.DB.prepare('DELETE FROM actual_expenses WHERE id = ? AND project_id = ?')
    .bind(actualId, project.id)
    .run();
  if (!result.meta.changes) throw new HttpError(404, 'not_found', 'Expense not found');

  await audit(c.env.DB, {
    actor: user,
    action: 'actual.deleted',
    entity: 'actual_expense',
    entityId: actualId,
    detail: { projectId: project.id },
  });

  const settings = await getSettingsRow(c.env.DB);
  const detail = await loadProjectDetail(c.env.DB, project.id, settings);
  return c.json(detail);
});

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

projectRoutes.post('/:id/payments', async (c) => {
  const user = c.get('user');
  const project = await requireProject(c.env.DB, c.req.param('id'));
  const input = await readBody(c, paymentSchema);

  const id = newId();
  await c.env.DB.prepare(
    `INSERT INTO payments (id, project_id, amount_kobo, paid_on, method, reference, notes,
                           created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, project.id, input.amountKobo, input.paidOn, input.method, input.reference, input.notes, user.id, nowIso())
    .run();

  await audit(c.env.DB, {
    actor: user,
    action: 'payment.recorded',
    entity: 'payment',
    entityId: id,
    detail: { projectId: project.id, amountKobo: input.amountKobo },
  });

  const settings = await getSettingsRow(c.env.DB);
  const detail = await loadProjectDetail(c.env.DB, project.id, settings);
  return c.json(detail, 201);
});

projectRoutes.delete('/:id/payments/:paymentId', async (c) => {
  const user = c.get('user');
  const project = await requireProject(c.env.DB, c.req.param('id'));
  const paymentId = c.req.param('paymentId');

  const result = await c.env.DB.prepare('DELETE FROM payments WHERE id = ? AND project_id = ?')
    .bind(paymentId, project.id)
    .run();
  if (!result.meta.changes) throw new HttpError(404, 'not_found', 'Payment not found');

  await audit(c.env.DB, {
    actor: user,
    action: 'payment.deleted',
    entity: 'payment',
    entityId: paymentId,
    detail: { projectId: project.id },
  });

  const settings = await getSettingsRow(c.env.DB);
  const detail = await loadProjectDetail(c.env.DB, project.id, settings);
  return c.json(detail);
});
