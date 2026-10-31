import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, ChevronRight, FolderKanban, Plus, Receipt } from 'lucide-react';
import type { DashboardDto, ProjectSummaryDto } from '@shared/types';
import { PageHeader } from '../components/shell';
import { Donut, TrendChart } from '../components/charts';
import {
  BandPill,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Pill,
  Skeleton,
  StatusPill,
} from '../components/ui';
import { api, ApiError } from '../lib/api';
import { BAND_LABELS, STATUS_LABELS, dateShort, money, moneyCompact, percent } from '../lib/format';

type RangeKey = 'month' | 'quarter' | 'year' | 'all';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'month', label: 'This month' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All time' },
];

function rangeFor(key: RangeKey): { from: string | null; to: string | null } {
  const now = new Date();
  const iso = (date: Date) => date.toISOString().slice(0, 10);

  if (key === 'all') return { from: null, to: null };

  if (key === 'month') {
    return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
  }

  if (key === 'quarter') {
    const quarterStart = Math.floor(now.getMonth() / 3) * 3;
    return {
      from: iso(new Date(now.getFullYear(), quarterStart, 1)),
      to: iso(new Date(now.getFullYear(), quarterStart + 3, 0)),
    };
  }

  return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(new Date(now.getFullYear(), 11, 31)) };
}

/** Month-by-month revenue and cost, built from the project summaries we already have. */
function buildTrend(projects: ProjectSummaryDto[]): { label: string; revenue: number; cost: number }[] {
  const buckets = new Map<string, { label: string; revenue: number; cost: number }>();

  for (const project of projects) {
    const stamp = project.eventDate ?? project.updatedAt;
    const date = new Date(stamp.length <= 10 ? `${stamp}T00:00:00` : stamp);
    if (Number.isNaN(date.getTime())) continue;

    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const bucket = buckets.get(key) ?? {
      label: date.toLocaleDateString('en-GB', { month: 'short' }),
      revenue: 0,
      cost: 0,
    };

    bucket.revenue += project.sellingPriceNetKobo;
    bucket.cost += project.estimatedCostKobo;
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-6)
    .map(([, value]) => value);
}

export function DashboardPage() {
  const [range, setRange] = useState<RangeKey>('all');
  const [data, setData] = useState<DashboardDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const result = await api.dashboard(rangeFor(range));
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'Could not load the dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [range]);

  const trend = useMemo(() => (data ? buildTrend(data.projects) : []), [data]);
  const attention = useMemo(
    () =>
      (data?.projects ?? [])
        .filter(
          (project) =>
            project.band === 'critical' ||
            project.band === 'low' ||
            project.approvalStatus === 'required',
        )
        .slice(0, 4),
    [data],
  );

  const metrics = data?.metrics;
  const revenue = moneyCompact(metrics?.quotedRevenueKobo ?? 0);
  const gross = moneyCompact(metrics?.estimatedGrossProfitKobo ?? 0);
  const net = moneyCompact(metrics?.estimatedNetProfitKobo ?? 0);
  const outstanding = moneyCompact(metrics?.outstandingBalanceKobo ?? 0);
  const actualNet = moneyCompact(metrics?.actualNetProfitKobo ?? 0);

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Where the money is across every production."
        actions={
          <>
            <div className="hidden items-center gap-1 rounded-full border border-line bg-raised p-1 sm:flex">
              {RANGES.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setRange(option.key)}
                  className={
                    option.key === range
                      ? 'rounded-full bg-accent-soft px-3 py-1.5 text-[11px] font-medium text-accent'
                      : 'rounded-full px-3 py-1.5 text-[11px] text-muted transition-colors hover:text-ink'
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
            <Link to="/projects?new=1">
              <Button variant="primary" icon={<Plus className="size-4" aria-hidden />}>
                Create project
              </Button>
            </Link>
          </>
        }
      />

      {error ? (
        <Card className="mb-4 flex items-center gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-xs text-danger">
          <AlertTriangle className="size-4" aria-hidden />
          {error}
        </Card>
      ) : null}

      {/* Bento row one: the three numbers the owner looks at first */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {loading && !data ? (
          <>
            <Skeleton className="h-[116px]" />
            <Skeleton className="h-[116px]" />
            <Skeleton className="h-[116px]" />
          </>
        ) : (
          <>
            <StatBlock label="Quoted revenue" value={revenue} hint="Net of VAT, across all quotes" />
            <StatBlock
              label="Estimated gross profit"
              value={gross}
              hint="Before overhead, tax and VAT"
              tone={metrics && metrics.estimatedGrossProfitKobo < 0 ? 'danger' : 'default'}
            />
            <StatBlock
              label="Outstanding balance"
              value={outstanding}
              hint="Invoiced but not yet paid"
              tone={metrics && metrics.outstandingBalanceKobo > 0 ? 'warning' : 'default'}
            />
          </>
        )}
      </div>

      {/* Row two: the rest of the scoreboard, in the kit's tighter cards */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat label="Projects" value={String(metrics?.projectCount ?? 0)} hint={`${metrics?.activeProjects ?? 0} active`} />
        <MiniStat label="Completed revenue" value={moneyCompact(metrics?.completedRevenueKobo ?? 0).value} hint="Delivered and paid" />
        <MiniStat label="Estimated net profit" value={net.value} suffix={net.suffix} hint="After overhead and tax" />
        <MiniStat label="Actual net profit" value={actualNet.value} suffix={actualNet.suffix} hint="From real expenses" />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <CardHeader
            title="Revenue vs estimated cost"
            hint="Grouped by month of the event, last six months"
            action={<Pill tone="accent">Bento</Pill>}
          />
          <div className="mt-4">
            <TrendChart
              data={trend.map((point) => ({ label: point.label, value: point.revenue }))}
              formatValue={(value) => money(value * 100)}
            />
          </div>
          <div className="mt-1 flex items-center gap-4 text-[11px] text-faint">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-accent" aria-hidden /> Revenue
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-line-strong" aria-hidden /> Costs shown in the table
            </span>
          </div>
        </Card>

        <Card className="p-5">
          <CardHeader title="Needs attention" hint="Thin margins or awaiting approval" />
          <div className="mt-3 space-y-1">
            {attention.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs text-faint">
                Nothing needs a decision right now.
              </p>
            ) : (
              attention.map((project) => (
                <Link
                  key={project.id}
                  to={`/projects/${project.id}`}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-raised"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                    <AlertTriangle className="size-3.5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{project.name}</span>
                    <span className="block truncate text-[11px] text-faint">
                      {percent(project.estimatedMarginBp)} margin · {money(project.sellingPriceNetKobo)}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
                </Link>
              ))
            )}
          </div>

          <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
            <Donut
              value={metrics?.completedRevenueKobo ?? 0}
              total={metrics?.quotedRevenueKobo ?? 0}
              label="Share of quoted revenue that has been delivered"
              size={64}
            />
            <div>
              <p className="text-[11px] text-muted">Delivered vs quoted</p>
              <p className="tabular text-sm font-semibold text-ink">
                {money(metrics?.completedRevenueKobo ?? 0)}
              </p>
              <p className="text-[11px] text-faint">of {money(metrics?.quotedRevenueKobo ?? 0)} quoted</p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="mt-3 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <CardHeader title="Projects" hint="Status and profitability at a glance" />
          <Link to="/projects" className="flex items-center gap-1 text-[11px] text-accent hover:underline">
            View all <ArrowUpRight className="size-3" aria-hidden />
          </Link>
        </div>

        {data && data.projects.length === 0 ? (
          <EmptyState
            icon={<FolderKanban className="size-5" aria-hidden />}
            title="No projects yet"
            description="Create your first production to start costing it."
            action={
              <Link to="/projects?new=1">
                <Button variant="primary" icon={<Plus className="size-4" aria-hidden />}>
                  Create project
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-y border-line text-[10px] tracking-wide text-faint uppercase">
                  <th className="px-5 py-2.5 font-medium">Project</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Margin</th>
                  <th className="px-3 py-2.5 text-right font-medium">Price</th>
                  <th className="px-3 py-2.5 text-right font-medium">Balance</th>
                  <th className="px-5 py-2.5 font-medium">Event</th>
                </tr>
              </thead>
              <tbody>
                {(data?.projects ?? []).slice(0, 8).map((project) => (
                  <tr key={project.id} className="border-b border-line/60 transition-colors hover:bg-raised">
                    <td className="px-5 py-3">
                      <Link to={`/projects/${project.id}`} className="block">
                        <span className="block text-[13px] font-medium text-ink">{project.name}</span>
                        <span className="block text-[11px] text-faint">
                          {project.clientName} · {project.reference}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill status={project.status} label={STATUS_LABELS[project.status] ?? project.status} />
                    </td>
                    <td className="px-3 py-3">
                      <BandPill band={project.band} label={BAND_LABELS[project.band] ?? project.band} />
                    </td>
                    <td className="tabular px-3 py-3 text-right text-[13px] text-ink">
                      {money(project.sellingPriceNetKobo)}
                    </td>
                    <td className="tabular px-3 py-3 text-right text-[13px] text-muted">
                      {money(project.balanceKobo)}
                    </td>
                    <td className="px-5 py-3 text-[12px] text-muted">{dateShort(project.eventDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function StatBlock({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: { value: string; suffix: string | null };
  hint: string;
  tone?: 'default' | 'warning' | 'danger';
}) {
  const toneClass = { default: 'text-ink', warning: 'text-warning', danger: 'text-danger' }[tone];

  return (
    <Card className="p-5">
      <p className="text-xs text-muted">{label}</p>
      <p className={`tabular mt-2 text-[30px] leading-none font-semibold tracking-tight ${toneClass}`}>
        {value.value}
        {value.suffix ? <span className="ml-0.5 text-sm font-medium text-muted">{value.suffix}</span> : null}
      </p>
      <p className="mt-3 text-[11px] text-faint">{hint}</p>
    </Card>
  );
}

function MiniStat({ label, value, suffix, hint }: { label: string; value: string; suffix?: string | null; hint: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1.5">
        <Receipt className="size-3 text-faint" aria-hidden />
        <p className="text-[11px] text-muted">{label}</p>
      </div>
      <p className="tabular mt-1.5 text-lg font-semibold text-ink">
        {value}
        {suffix ? <span className="ml-0.5 text-[11px] font-medium text-muted">{suffix}</span> : null}
      </p>
      <p className="mt-0.5 text-[10px] text-faint">{hint}</p>
    </Card>
  );
}
