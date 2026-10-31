import { Hono } from 'hono';
import type { DashboardDto, ProjectSummaryDto } from '@shared/types';
import type { AppBindings } from '../env';
import { requireAuth } from '../auth/middleware';
import { getSettingsRow, toMarginThresholds } from '../db/settings';
import {
  evaluate,
  loadSummaries,
  listProjectRows,
  type ActualRow,
  type CostLineRow,
} from '../db/projects';
import { evaluateActuals } from '../domain/pricing';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Resolve the requested reporting window. Month/quarter/year mean "to date". */
function resolveRange(
  range: string | undefined,
  from: string | null,
  to: string | null,
): { from: string | null; to: string | null } {
  // The client resolves its own window and sends from/to; null bounds mean unbounded.
  if (!range || range === 'custom') return { from, to };

  const now = new Date();
  const end = isoDate(now);
  const start = new Date(now);

  switch (range) {
    case 'all':
      return { from: null, to: null };
    case 'quarter': {
      const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
      start.setMonth(quarterStartMonth, 1);
      return { from: isoDate(start), to: end };
    }
    case 'year':
      return { from: `${now.getFullYear()}-01-01`, to: end };
    case 'month':
    default:
      start.setDate(1);
      return { from: isoDate(start), to: end };
  }
}

export const dashboardRoutes = new Hono<AppBindings>();

dashboardRoutes.use('*', requireAuth);

dashboardRoutes.get('/', async (c) => {
  const settings = await getSettingsRow(c.env.DB);
  const range = resolveRange(c.req.query('range'), c.req.query('from') ?? null, c.req.query('to') ?? null);

  const rows = await listProjectRows(c.env.DB, { from: range.from, to: range.to });
  const summaries = await loadSummaries(c.env.DB, rows, settings);

  // Actual results need the expense rows; load them in bulk for this window.
  const ids = rows.map((row) => row.id);
  const actualsByProject = new Map<string, ActualRow[]>();
  const paidByProject = new Map<string, number>();
  const linesByProject = new Map<string, CostLineRow[]>();

  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');

    const [actualResult, lineResult, paymentResult] = await Promise.all([
      c.env.DB.prepare(`SELECT * FROM actual_expenses WHERE project_id IN (${placeholders})`)
        .bind(...ids)
        .all<ActualRow>(),
      c.env.DB.prepare(`SELECT * FROM cost_lines WHERE project_id IN (${placeholders})`)
        .bind(...ids)
        .all<CostLineRow>(),
      c.env.DB.prepare(
        `SELECT project_id, SUM(amount_kobo) AS paid FROM payments
          WHERE project_id IN (${placeholders}) GROUP BY project_id`,
      )
        .bind(...ids)
        .all<{ project_id: string; paid: number }>(),
    ]);

    for (const row of actualResult.results) {
      const bucket = actualsByProject.get(row.project_id) ?? [];
      bucket.push(row);
      actualsByProject.set(row.project_id, bucket);
    }

    for (const row of lineResult.results) {
      const bucket = linesByProject.get(row.project_id) ?? [];
      bucket.push(row);
      linesByProject.set(row.project_id, bucket);
    }

    for (const row of paymentResult.results) {
      paidByProject.set(row.project_id, row.paid);
    }
  }

  let quotedRevenueKobo = 0;
  let completedRevenueKobo = 0;
  let estimatedGrossProfitKobo = 0;
  let actualGrossProfitKobo = 0;
  let estimatedNetProfitKobo = 0;
  let actualNetProfitKobo = 0;
  let outstandingBalanceKobo = 0;
  let activeProjects = 0;

  for (const project of rows) {
    if (project.status === 'cancelled') continue;

    const lines = linesByProject.get(project.id) ?? [];
    const financials = evaluate(project, lines, settings);

    if (['quoted', 'approved', 'in_production'].includes(project.status)) {
      activeProjects += 1;
      quotedRevenueKobo += financials.sellingPriceNetKobo;
    }
    if (project.status === 'completed') {
      completedRevenueKobo += financials.sellingPriceNetKobo;
    }

    estimatedGrossProfitKobo += financials.profit.grossProfitKobo;
    estimatedNetProfitKobo += financials.profit.netProfitKobo;

    const actualRows = actualsByProject.get(project.id);
    if (actualRows && actualRows.length > 0) {
      const actualDirect = actualRows
        .filter((row) => row.category !== 'overhead')
        .reduce((sum, row) => sum + row.amount_kobo, 0);
      const actualOverhead =
        actualRows.filter((row) => row.category === 'overhead').reduce((sum, row) => sum + row.amount_kobo, 0) +
        financials.breakdown.allocatedOverheadKobo;

      const actual = evaluateActuals({
        netRevenueKobo: financials.sellingPriceNetKobo,
        actualDirectCostsKobo: actualDirect,
        overheadKobo: actualOverhead,
        taxProvisionBp: settings.tax_provision_bp,
        vatRateBp: project.vat_rate_bp,
        minMarginBp: settings.min_margin_bp,
        marginThresholds: toMarginThresholds(settings),
      });

      actualGrossProfitKobo += actual.profit.grossProfitKobo;
      actualNetProfitKobo += actual.profit.netProfitKobo;
    }

    outstandingBalanceKobo += financials.profit.totalPayableKobo - (paidByProject.get(project.id) ?? 0);
  }

  const body: DashboardDto = {
    metrics: {
      projectCount: rows.filter((row) => row.status !== 'cancelled').length,
      activeProjects,
      quotedRevenueKobo,
      completedRevenueKobo,
      estimatedGrossProfitKobo,
      actualGrossProfitKobo,
      estimatedNetProfitKobo,
      actualNetProfitKobo,
      outstandingBalanceKobo,
    },
    projects: summaries satisfies ProjectSummaryDto[],
    range,
  };

  return c.json(body);
});
