import { Hono } from 'hono';
import { z } from 'zod';
import type { QuotationItemDto, QuotationLayout } from '@shared/types';
import type { AppBindings, Env } from '../env';
import { requireAuth, requireOwner } from '../auth/middleware';
import { audit, newId, nextQuotationReference, nowIso } from '../db/helpers';
import { getSettingsRow } from '../db/settings';
import {
  evaluate,
  findProjectRow,
  lineFigures,
  loadCostLines,
  loadQuotations,
  toQuotationDto,
  type CostLineRow,
  type ProjectRow,
  type QuotationRow,
} from '../db/projects';
import { badRequest, conflict, notFound, readBody } from '../lib/http';
import { lineTotalKobo } from '../domain/pricing';
import { percentOf } from '../domain/money';
import { buildQuotationPdf } from '../pdf/quotation';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const createQuotationSchema = z.object({
  projectId: z.string().trim().min(1, 'Choose a project'),
  layout: z.enum(['detailed', 'package']).default('detailed'),
  clientNotes: z.string().trim().max(4000).default(''),
});

const statusSchema = z.object({
  status: z.enum(['accepted', 'declined']),
});

const issueSchema = z.object({
  validUntil: isoDate.nullish(),
});

// ---------------------------------------------------------------------------
// Client-facing items
//
// The project's net selling price is the authority: cost lines only decide how
// that price is spread across the client's line items. Rates and totals below
// are what the client pays — never what the work cost.
// ---------------------------------------------------------------------------

/** Split `totalKobo` across `weights` proportionally, leaving the drift on the largest. */
function allocateKobo(totalKobo: number, weights: number[]): number[] {
  const sum = weights.reduce((total, weight) => total + weight, 0);
  if (sum <= 0) return weights.map(() => 0);

  const shares = weights.map((weight) => Math.round((totalKobo * weight) / sum));
  const drift = totalKobo - shares.reduce((total, share) => total + share, 0);

  if (drift !== 0) {
    let largest = 0;
    for (let index = 1; index < weights.length; index += 1) {
      if ((weights[index] ?? 0) > (weights[largest] ?? 0)) largest = index;
    }
    shares[largest] = (shares[largest] ?? 0) + drift;
  }

  return shares;
}

function unitLabelFor(line: CostLineRow): string {
  if (line.kind === 'crew') return 'person-day';
  if (line.kind === 'equipment') return 'day';
  return 'unit';
}

/** Quantity the client sees: rental and crew days are folded into the count. */
function clientQuantityMilli(line: CostLineRow): number {
  if (line.kind === 'standard') return line.quantity_milli;
  return Math.round((line.quantity_milli * line.days_milli) / 1_000);
}

function buildClientItems(
  project: ProjectRow,
  lines: readonly CostLineRow[],
  layout: QuotationLayout,
  netPriceKobo: number,
): QuotationItemDto[] {
  const figures = lineFigures(lines);

  if (layout === 'package') {
    return [
      {
        description: project.name,
        quantityMilli: 1_000,
        unitLabel: 'package',
        unitRateKobo: netPriceKobo,
        totalKobo: netPriceKobo,
      },
    ];
  }

  const billable: { line: CostLineRow; totalKobo: number }[] = [];
  figures.forEach((figure, index) => {
    const line = lines[index];
    if (!line || figure.category === 'overhead') return;
    billable.push({ line, totalKobo: lineTotalKobo(figure) });
  });

  if (!billable.length) return [];

  const shares = allocateKobo(
    netPriceKobo,
    billable.map((entry) => Math.max(entry.totalKobo, 0)),
  );

  return billable.map((entry, index) => {
    const totalKobo = shares[index] ?? 0;
    const quantityMilli = clientQuantityMilli(entry.line);
    const unitRateKobo =
      quantityMilli > 0 ? Math.round((totalKobo * 1_000) / quantityMilli) : totalKobo;

    return {
      description: entry.line.description,
      quantityMilli,
      unitLabel: unitLabelFor(entry.line),
      unitRateKobo,
      totalKobo,
    };
  });
}

// ---------------------------------------------------------------------------
// Row access
// ---------------------------------------------------------------------------

async function findQuotationRow(db: D1Database, id: string): Promise<QuotationRow | null> {
  return db.prepare('SELECT * FROM quotations WHERE id = ?').bind(id).first<QuotationRow>();
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Math.max(0, days));
  return date.toISOString().slice(0, 10);
}

async function loadLogo(
  env: Env,
  key: string | null,
): Promise<{ bytes: Uint8Array; type: 'png' | 'jpg' } | null> {
  if (!key) return null;

  const object = await env.FILES.get(key);
  if (!object) return null;

  const lowered = key.toLowerCase();
  if (!lowered.endsWith('.png') && !lowered.endsWith('.jpg') && !lowered.endsWith('.jpeg')) {
    return null;
  }

  return {
    bytes: new Uint8Array(await object.arrayBuffer()),
    type: lowered.endsWith('.png') ? 'png' : 'jpg',
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const quotationRoutes = new Hono<AppBindings>();

quotationRoutes.use('*', requireAuth);

quotationRoutes.get('/', async (c) => {
  const projectId = c.req.query('projectId');
  if (!projectId) throw badRequest('Choose a project');

  const rows = await loadQuotations(c.env.DB, projectId);
  return c.json({ quotations: rows.map(toQuotationDto) });
});

quotationRoutes.get('/:id', async (c) => {
  const row = await findQuotationRow(c.env.DB, c.req.param('id'));
  if (!row) throw notFound('Quotation not found');

  return c.json({ quotation: toQuotationDto(row) });
});

quotationRoutes.post('/', async (c) => {
  const user = c.get('user');
  const input = await readBody(c, createQuotationSchema);

  const project = await findProjectRow(c.env.DB, input.projectId);
  if (!project) throw notFound('Project not found');

  const [settings, lines, existing] = await Promise.all([
    getSettingsRow(c.env.DB),
    loadCostLines(c.env.DB, project.id),
    loadQuotations(c.env.DB, project.id),
  ]);

  if (!lines.length) {
    throw badRequest('Add at least one cost line before raising a quotation');
  }

  // A stored price of zero means "not overridden": the recommended price applies,
  // exactly as it does on the project page.
  const netPriceKobo = evaluate(project, lines, settings).sellingPriceNetKobo;
  if (netPriceKobo <= 0) {
    throw badRequest('Set a selling price on the project before raising a quotation');
  }

  const items = buildClientItems(project, lines, input.layout, netPriceKobo);
  if (!items.length) throw badRequest('There is nothing to show the client yet');

  const subtotalKobo = items.reduce((total, item) => total + item.totalKobo, 0);
  const vatRateBp = settings.vat_enabled === 1 ? project.vat_rate_bp : 0;
  const vatKobo = percentOf(subtotalKobo, vatRateBp);

  const version = existing.reduce((highest, row) => Math.max(highest, row.version), 0) + 1;
  const reference = await nextQuotationReference(c.env.DB, project.reference, version);
  const id = newId();
  const timestamp = nowIso();

  await c.env.DB.prepare(
    `INSERT INTO quotations (
       id, project_id, reference, version, layout, status,
       issued_on, valid_until, client_items_json, client_notes,
       subtotal_kobo, vat_rate_bp, vat_kobo, total_kobo,
       created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'draft', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      project.id,
      reference,
      version,
      input.layout,
      JSON.stringify(items),
      input.clientNotes,
      subtotalKobo,
      vatRateBp,
      vatKobo,
      subtotalKobo + vatKobo,
      user.id,
      timestamp,
      timestamp,
    )
    .run();

  await audit(c.env.DB, {
    actor: user,
    action: 'quotation.created',
    entity: 'quotation',
    entityId: id,
    detail: { reference, version, layout: input.layout },
  });

  const row = await findQuotationRow(c.env.DB, id);
  if (!row) throw notFound('Quotation not found');

  return c.json({ quotation: toQuotationDto(row) }, 201);
});

quotationRoutes.post('/:id/issue', async (c) => {
  const user = c.get('user');
  const input = await readBody(c, issueSchema);
  const id = c.req.param('id');

  const row = await findQuotationRow(c.env.DB, id);
  if (!row) throw notFound('Quotation not found');
  if (row.status !== 'draft') throw conflict('Only a draft can be issued');

  const settings = await getSettingsRow(c.env.DB);
  const timestamp = nowIso();
  const issuedOn = timestamp.slice(0, 10);
  const validUntil = input.validUntil ?? addDays(issuedOn, settings.quotation_validity_days);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE quotations
          SET status = 'issued', issued_on = ?, valid_until = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(issuedOn, validUntil, timestamp, id),
    // Issuing fixes the price: the project becomes "quoted" and its costs lock.
    c.env.DB.prepare(
      `UPDATE projects
          SET status = CASE WHEN status = 'draft' THEN 'quoted' ELSE status END,
              quote_locked_at = COALESCE(quote_locked_at, ?),
              updated_at = ?
        WHERE id = ?`,
    ).bind(timestamp, timestamp, row.project_id),
  ]);

  await audit(c.env.DB, {
    actor: user,
    action: 'quotation.issued',
    entity: 'quotation',
    entityId: id,
    detail: { reference: row.reference, validUntil },
  });

  const updated = await findQuotationRow(c.env.DB, id);
  if (!updated) throw notFound('Quotation not found');

  return c.json({ quotation: toQuotationDto(updated) });
});

quotationRoutes.post('/:id/status', async (c) => {
  const user = c.get('user');
  const input = await readBody(c, statusSchema);
  const id = c.req.param('id');

  const row = await findQuotationRow(c.env.DB, id);
  if (!row) throw notFound('Quotation not found');
  if (row.status !== 'issued') throw conflict('Only an issued quotation can be accepted or declined');

  const timestamp = nowIso();
  const statements = [
    c.env.DB.prepare('UPDATE quotations SET status = ?, updated_at = ? WHERE id = ?').bind(
      input.status,
      timestamp,
      id,
    ),
  ];

  if (input.status === 'accepted') {
    statements.push(
      c.env.DB.prepare(
        `UPDATE projects
            SET status = 'approved', approval_status = 'approved',
                approved_by = COALESCE(approved_by, ?), approved_at = COALESCE(approved_at, ?),
                updated_at = ?
          WHERE id = ?`,
      ).bind(user.id, timestamp, timestamp, row.project_id),
    );
  }

  await c.env.DB.batch(statements);

  await audit(c.env.DB, {
    actor: user,
    action: `quotation.${input.status}`,
    entity: 'quotation',
    entityId: id,
    detail: { reference: row.reference },
  });

  const updated = await findQuotationRow(c.env.DB, id);
  if (!updated) throw notFound('Quotation not found');

  return c.json({ quotation: toQuotationDto(updated) });
});

quotationRoutes.delete('/:id', requireOwner, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const row = await findQuotationRow(c.env.DB, id);
  if (!row) throw notFound('Quotation not found');
  if (row.status !== 'draft') throw conflict('Issued quotations are a matter of record');

  await c.env.DB.prepare('DELETE FROM quotations WHERE id = ?').bind(id).run();

  if (row.pdf_r2_key) {
    await c.env.FILES.delete(row.pdf_r2_key).catch(() => undefined);
  }

  await audit(c.env.DB, {
    actor: user,
    action: 'quotation.deleted',
    entity: 'quotation',
    entityId: id,
    detail: { reference: row.reference },
  });

  return c.body(null, 204);
});

/** Renders the client PDF, stores it in R2 and streams it back. */
quotationRoutes.get('/:id/pdf', async (c) => {
  const id = c.req.param('id');

  const row = await findQuotationRow(c.env.DB, id);
  if (!row) throw notFound('Quotation not found');

  const project = await findProjectRow(c.env.DB, row.project_id);
  if (!project) throw notFound('Project not found');

  const settings = await getSettingsRow(c.env.DB);
  const items = JSON.parse(row.client_items_json) as QuotationItemDto[];
  const logo = await loadLogo(c.env, settings.company_logo_key);
  const timestamp = nowIso();

  const bytes = await buildQuotationPdf({
    company: {
      name: settings.company_name,
      email: settings.company_email,
      phone: settings.company_phone,
      address: settings.company_address,
      bankDetails: settings.bank_details,
      paymentTerms: settings.payment_terms,
    },
    client: {
      name: project.client_name,
      contact: project.client_contact,
      email: project.client_email,
    },
    project: {
      name: project.name,
      reference: project.reference,
      description: project.description,
      eventDate: project.event_date,
      location: project.location,
      productionDays: project.production_days,
    },
    quotation: {
      reference: row.reference,
      issuedOn: row.issued_on ?? timestamp.slice(0, 10),
      validUntil: row.valid_until,
      layout: row.layout,
    },
    items,
    subtotalKobo: row.subtotal_kobo,
    vatRateBp: row.vat_rate_bp,
    vatKobo: row.vat_kobo,
    totalKobo: row.total_kobo,
    depositPercentBp: settings.deposit_percent_bp,
    clientNotes: row.client_notes,
    logo,
  });

  const key = `quotations/${project.id}/${row.id}.pdf`;
  await c.env.FILES.put(key, bytes, {
    httpMetadata: { contentType: 'application/pdf' },
  });

  if (key !== row.pdf_r2_key) {
    await c.env.DB.prepare('UPDATE quotations SET pdf_r2_key = ?, pdf_generated_at = ? WHERE id = ?')
      .bind(key, timestamp, row.id)
      .run();
  }

  const filename = `${row.reference.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`;
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
});
