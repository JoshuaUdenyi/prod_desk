import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Download,
  FileText,
  Plus,
  Receipt,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type { CostCategory, CostLineDto, ProjectDetailDto, QuotationDto, VarianceRowDto } from '@shared/types';
import { PageHeader } from '../components/shell';
import {
  BandPill,
  Button,
  Card,
  CardHeader,
  Drawer,
  EmptyState,
  Field,
  IconButton,
  Input,
  Pill,
  ProgressBar,
  Select,
  Skeleton,
  StatusPill,
  Tabs,
  Textarea,
  useToast,
} from '../components/ui';
import { api, ApiError, type ActualInput, type CostLineInput, type PaymentInput } from '../lib/api';
import {
  BAND_LABELS,
  CATEGORY_LABELS,
  EVENT_LABELS,
  STATUS_LABELS,
  dateShort,
  money,
  percent,
  quantity,
  signedPercent,
  today,
} from '../lib/format';
import {
  bpToPercentInput,
  koboToNairaInput,
  milliToQuantityInput,
  parseNairaToKobo,
  parsePercentToBp,
  parseQuantityToMilli,
} from '../lib/parse';

const DIRECT_CATEGORIES: CostCategory[] = ['equipment', 'crew', 'logistics', 'internet', 'other'];
const ALL_CATEGORIES: CostCategory[] = [...DIRECT_CATEGORIES, 'overhead'];

type TabKey = 'costs' | 'quotations' | 'actuals' | 'payments';

export function ProjectPage() {
  const { id = '' } = useParams();
  const [detail, setDetail] = useState<ProjectDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('costs');

  const reload = useCallback(async () => {
    try {
      setDetail(await api.projects.get(id));
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load this project');
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (error && !detail) {
    return (
      <Card className="flex items-center gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-xs text-danger">
        <AlertTriangle className="size-4" aria-hidden />
        {error}
      </Card>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16" />
        <div className="grid gap-3 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  const { project, financials } = detail;

  return (
    <>
      <Link
        to="/projects"
        className="mb-3 inline-flex items-center gap-1.5 text-[11px] text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-3" aria-hidden />
        Projects
      </Link>

      <PageHeader
        title={project.name}
        subtitle={`${project.clientName} · ${project.reference} · ${EVENT_LABELS[project.eventType] ?? project.eventType} · ${dateShort(project.eventDate)}`}
        actions={
          <>
            <StatusPill status={project.status} label={STATUS_LABELS[project.status] ?? project.status} />
            <BandPill band={financials.band} label={BAND_LABELS[financials.band] ?? financials.band} />
          </>
        }
      />

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <Card className="p-4">
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'costs', label: `Cost lines (${detail.costLines.length})` },
                { value: 'quotations', label: `Quotations (${detail.quotations.length})` },
                { value: 'actuals', label: `Actuals (${detail.actualExpenses.length})` },
                { value: 'payments', label: `Payments (${detail.payments.length})` },
              ]}
            />

            <div className="pt-4">
              {tab === 'costs' ? <CostsTab detail={detail} onChange={setDetail} /> : null}
              {tab === 'quotations' ? <QuotationsTab detail={detail} onChange={setDetail} /> : null}
              {tab === 'actuals' ? <ActualsTab detail={detail} onChange={setDetail} /> : null}
              {tab === 'payments' ? <PaymentsTab detail={detail} onChange={setDetail} /> : null}
            </div>
          </Card>
        </div>

        <SummaryPanel detail={detail} onChange={setDetail} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Financial summary — the persistent panel from PRD §10
// ---------------------------------------------------------------------------

function SummaryPanel({ detail, onChange }: { detail: ProjectDetailDto; onChange: (detail: ProjectDetailDto) => void }) {
  const { project, financials } = detail;
  const toast = useToast();
  const [pricingOpen, setPricingOpen] = useState(false);

  const marginTone =
    financials.band === 'critical' || financials.band === 'low' ? 'text-warning' : 'text-positive';

  return (
    <div className="space-y-3 lg:sticky lg:top-6 lg:self-start">
      <Card className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] text-muted">Client pays (incl. VAT)</p>
            <p className="tabular mt-1 text-[26px] leading-none font-semibold tracking-tight text-ink">
              {money(financials.totalPayableKobo)}
            </p>
          </div>
          <BandPill band={financials.band} label={BAND_LABELS[financials.band] ?? financials.band} />
        </div>

        <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-[12px]">
          <Row label="Selling price (net)" value={money(financials.sellingPriceNetKobo)} strong />
          {financials.vatKobo > 0 ? (
            <Row label={`VAT (${percent(financials.vatRateBp)})`} value={money(financials.vatKobo)} />
          ) : null}
          <Row label="Direct costs" value={money(financials.directCostsKobo)} />
          {financials.contingencyKobo > 0 ? (
            <Row label={`Contingency (${percent(project.contingencyBp)})`} value={money(financials.contingencyKobo)} />
          ) : null}
          <Row label="Overhead" value={money(financials.overheadKobo)} />
        </dl>

        <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-[12px]">
          <Row label="Gross profit" value={money(financials.grossProfitKobo)} hint={percent(financials.grossMarginBp)} />
          <Row
            label="Operating profit"
            value={money(financials.operatingProfitKobo)}
            hint={percent(financials.operatingMarginBp)}
          />
          <Row
            label="Net profit"
            value={money(financials.netProfitKobo)}
            hint={percent(financials.netMarginBp)}
            tone={marginTone}
          />
        </dl>

        {financials.warnings.length > 0 ? (
          <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
            {financials.warnings.map((warning) => (
              <li key={warning} className="flex items-start gap-1.5 text-[11px] text-warning">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                {warning}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-4 flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => setPricingOpen(true)}>
            Adjust pricing
          </Button>
          {financials.requiresApproval ? (
            <Button
              size="sm"
              variant="primary"
              icon={<BadgeCheck className="size-3.5" aria-hidden />}
              onClick={() => {
                void (async () => {
                  try {
                    onChange(await api.projects.approve(project.id, 'Approved at current margin'));
                    toast('Price approved');
                  } catch (caught) {
                    toast(caught instanceof ApiError ? caught.message : 'Could not approve', 'error');
                  }
                })();
              }}
            >
              Approve
            </Button>
          ) : null}
        </div>
      </Card>

      <Card className="p-5">
        <CardHeader title="Client balance" hint={`${money(detail.paidKobo)} of ${money(financials.totalPayableKobo)} paid`} />
        <div className="mt-3">
          <ProgressBar
            value={financials.totalPayableKobo > 0 ? (detail.paidKobo / financials.totalPayableKobo) * 100 : 0}
            tone={detail.balanceKobo > 0 ? 'accent' : 'positive'}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px]">
          <span className="text-muted">Outstanding</span>
          <span className="tabular font-semibold text-ink">{money(detail.balanceKobo)}</span>
        </div>
      </Card>

      <PricingDrawer
        open={pricingOpen}
        onClose={() => setPricingOpen(false)}
        detail={detail}
        onChange={onChange}
      />
    </div>
  );
}

function Row({
  label,
  value,
  hint,
  strong = false,
  tone = 'text-ink',
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? 'text-muted' : 'text-muted'}>{label}</dt>
      <dd className={`tabular text-right ${strong ? 'font-semibold' : 'font-medium'} ${tone}`}>
        {value}
        {hint ? <span className="ml-1.5 text-[10px] text-faint">{hint}</span> : null}
      </dd>
    </div>
  );
}

function PricingDrawer({
  open,
  onClose,
  detail,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  detail: ProjectDetailDto;
  onChange: (detail: ProjectDetailDto) => void;
}) {
  const { project, financials } = detail;
  const toast = useToast();
  const [preset, setPreset] = useState(project.targetMarginPreset);
  const [priceBase, setPriceBase] = useState(project.priceBase);
  const [margin, setMargin] = useState(bpToPercentInput(project.targetMarginBp));
  const [override, setOverride] = useState(koboToNairaInput(project.sellingPriceNetKobo));
  const [vat, setVat] = useState(bpToPercentInput(project.vatRateBp));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPreset(project.targetMarginPreset);
    setPriceBase(project.priceBase);
    setMargin(bpToPercentInput(project.targetMarginBp));
    setOverride(koboToNairaInput(project.sellingPriceNetKobo));
    setVat(bpToPercentInput(project.vatRateBp));
  }, [open, project, financials.sellingPriceNetKobo]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const updated = await api.projects.updatePricing(project.id, {
        targetMarginPreset: preset,
        targetMarginBp: parsePercentToBp(margin) ?? project.targetMarginBp,
        priceBase,
        sellingPriceNetKobo: parseNairaToKobo(override),
        vatRateBp: parsePercentToBp(vat) ?? project.vatRateBp,
      });
      onChange(updated);
      toast('Pricing updated');
      onClose();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Could not update pricing', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Pricing"
      description="Margin target drives the recommended price."
      footer={
        <div className="flex justify-between gap-2">
          <Button
            size="sm"
            onClick={() => {
              setOverride(koboToNairaInput(financials.recommendedPriceKobo));
            }}
          >
            Use recommended
          </Button>
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" form="pricing-form" type="submit" loading={busy}>
              Save
            </Button>
          </div>
        </div>
      }
    >
      <form id="pricing-form" onSubmit={save} className="space-y-3.5">
        <Field label="Margin preset" htmlFor="pr-preset">
          <Select id="pr-preset" value={preset} onChange={(event) => setPreset(event.target.value as typeof preset)}>
            <option value="budget">Budget</option>
            <option value="midrange">Mid-range</option>
            <option value="premium">Premium</option>
            <option value="custom">Custom</option>
          </Select>
        </Field>

        <Field label="Target margin" hint="Percent on the chosen price base." htmlFor="pr-margin">
          <Input
            id="pr-margin"
            value={margin}
            onChange={(event) => setMargin(event.target.value)}
            inputMode="decimal"
            placeholder="35"
          />
        </Field>

        <Field label="Price base" hint="What the margin is applied to." htmlFor="pr-base">
          <Select id="pr-base" value={priceBase} onChange={(event) => setPriceBase(event.target.value as typeof priceBase)}>
            <option value="direct">Direct costs</option>
            <option value="direct_plus_contingency">Direct + contingency</option>
            <option value="direct_plus_contingency_plus_overhead">Direct + contingency + overhead</option>
          </Select>
        </Field>

        <Field
          label="Selling price (net of VAT)"
          hint={`Recommended: ${money(financials.recommendedPriceKobo)}`}
          htmlFor="pr-price"
        >
          <Input id="pr-price" value={override} onChange={(event) => setOverride(event.target.value)} inputMode="decimal" />
        </Field>

        <Field label="VAT rate" htmlFor="pr-vat">
          <Input id="pr-vat" value={vat} onChange={(event) => setVat(event.target.value)} inputMode="decimal" />
        </Field>
      </form>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Cost lines
// ---------------------------------------------------------------------------

function CostsTab({ detail, onChange }: { detail: ProjectDetailDto; onChange: (detail: ProjectDetailDto) => void }) {
  const [editing, setEditing] = useState<CostLineDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [category, setCategory] = useState<CostCategory>('equipment');

  const grouped = useMemo(() => {
    const map = new Map<CostCategory, CostLineDto[]>();
    for (const line of detail.costLines) {
      const bucket = map.get(line.category) ?? [];
      bucket.push(line);
      map.set(line.category, bucket);
    }
    return map;
  }, [detail.costLines]);

  return (
    <div className="space-y-3">
      {DIRECT_CATEGORIES.map((key) => {
        const lines = grouped.get(key) ?? [];
        const total = detail.financials.categoryTotals[key] ?? 0;

        return (
          <Card key={key} className="border-line/70 bg-sunken/40 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-[13px] font-medium text-ink">{CATEGORY_LABELS[key]}</h3>
                <span className="tabular text-[11px] text-faint">{money(total)}</span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                icon={<Plus className="size-3.5" aria-hidden />}
                onClick={() => {
                  setCategory(key);
                  setCreating(true);
                }}
              >
                Add line
              </Button>
            </div>

            {lines.length === 0 ? (
              <p className="mt-2 text-[11px] text-faint">No {CATEGORY_LABELS[key]?.toLowerCase()} costs yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line/60">
                {lines.map((line) => (
                  <li key={line.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] text-ink">{line.description}</p>
                      <p className="truncate text-[10px] text-faint">
                        {quantity(line.quantityMilli)} × {money(line.unitRateKobo)}
                        {line.kind !== 'standard' ? ` × ${quantity(line.daysMilli)} days` : ''}
                        {line.supplier ? ` · ${line.supplier}` : ''}
                      </p>
                    </div>
                    <span className="tabular text-[12px] font-medium text-ink">{money(line.totalKobo)}</span>
                    <IconButton
                      label={`Edit ${line.description}`}
                      className="size-7 border-transparent bg-transparent"
                      onClick={() => setEditing(line)}
                    >
                      <FileText className="size-3.5" aria-hidden />
                    </IconButton>
                    <IconButton
                      label={`Delete ${line.description}`}
                      className="size-7 border-transparent bg-transparent hover:text-danger"
                      onClick={() => {
                        void (async () => {
                          try {
                            onChange(await api.projects.removeCostLine(detail.project.id, line.id));
                          } catch {
                            /* the row stays if the delete failed */
                          }
                        })();
                      }}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}

      <CostLineDrawer
        open={creating || editing !== null}
        line={editing}
        category={category}
        projectId={detail.project.id}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={(next) => {
          onChange(next);
          setCreating(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

const EMPTY_LINE = {
  description: '',
  kind: 'standard',
  quantity: '1',
  unitRate: '',
  days: '1',
  additional: '',
  supplier: '',
  notes: '',
};

function CostLineDrawer({
  open,
  line,
  category,
  projectId,
  onClose,
  onSaved,
}: {
  open: boolean;
  line: CostLineDto | null;
  category: CostCategory;
  projectId: string;
  onClose: () => void;
  onSaved: (detail: ProjectDetailDto) => void;
}) {
  const [form, setForm] = useState({ ...EMPTY_LINE, category });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      line
        ? {
            description: line.description,
            kind: line.kind,
            quantity: milliToQuantityInput(line.quantityMilli),
            unitRate: koboToNairaInput(line.unitRateKobo),
            days: milliToQuantityInput(line.daysMilli),
            additional: koboToNairaInput(line.additionalKobo),
            supplier: line.supplier,
            notes: line.notes,
            category: line.category,
          }
        : { ...EMPTY_LINE, category },
    );
  }, [open, line, category]);

  const set = <K extends keyof typeof EMPTY_LINE | 'category'>(key: K, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const payload: CostLineInput = {
      category: form.category as CostCategory,
      kind: form.kind as CostLineInput['kind'],
      description: form.description.trim(),
      quantityMilli: parseQuantityToMilli(form.quantity) ?? 1000,
      unitRateKobo: parseNairaToKobo(form.unitRate) ?? 0,
      daysMilli: parseQuantityToMilli(form.days) ?? 1000,
      additionalKobo: parseNairaToKobo(form.additional) ?? 0,
      supplier: form.supplier.trim(),
      notes: form.notes.trim(),
    };

    try {
      const updated = line
        ? await api.projects.updateCostLine(projectId, line.id, payload)
        : await api.projects.addCostLine(projectId, payload);
      onSaved(updated);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save the line');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={line ? 'Edit cost line' : 'Add cost line'}
      description="Rate × quantity × days, plus any extra charges."
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" form="cost-line-form" type="submit" loading={busy}>
            Save line
          </Button>
        </div>
      }
    >
      <form id="cost-line-form" onSubmit={save} className="space-y-3.5">
        <Field label="Category" htmlFor="cl-category">
          <Select id="cl-category" value={form.category} onChange={(event) => set('category', event.target.value)}>
            {ALL_CATEGORIES.map((key) => (
              <option key={key} value={key}>
                {CATEGORY_LABELS[key]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Description" htmlFor="cl-description">
          <Input
            id="cl-description"
            value={form.description}
            onChange={(event) => set('description', event.target.value)}
            placeholder="Sony FX6 kit"
            required
          />
        </Field>

        <Field label="Line type" hint="Equipment and crew multiply by days." htmlFor="cl-kind">
          <Select id="cl-kind" value={form.kind} onChange={(event) => set('kind', event.target.value)}>
            <option value="standard">Standard</option>
            <option value="equipment">Equipment</option>
            <option value="crew">Crew</option>
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity" htmlFor="cl-qty">
            <Input id="cl-qty" value={form.quantity} onChange={(event) => set('quantity', event.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Unit rate (₦)" htmlFor="cl-rate">
            <Input id="cl-rate" value={form.unitRate} onChange={(event) => set('unitRate', event.target.value)} inputMode="decimal" placeholder="0" />
          </Field>
        </div>

        {form.kind !== 'standard' ? (
          <Field label="Days" htmlFor="cl-days">
            <Input id="cl-days" value={form.days} onChange={(event) => set('days', event.target.value)} inputMode="decimal" />
          </Field>
        ) : null}

        <Field label="Additional charges (₦)" hint="Allowances, overtime, delivery." htmlFor="cl-additional">
          <Input id="cl-additional" value={form.additional} onChange={(event) => set('additional', event.target.value)} inputMode="decimal" placeholder="0" />
        </Field>

        <Field label="Supplier" hint="Internal only — never shown on quotations." htmlFor="cl-supplier">
          <Input id="cl-supplier" value={form.supplier} onChange={(event) => set('supplier', event.target.value)} />
        </Field>

        <Field label="Notes" htmlFor="cl-notes">
          <Textarea id="cl-notes" value={form.notes} onChange={(event) => set('notes', event.target.value)} />
        </Field>

        {error ? (
          <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[11px] text-danger">{error}</p>
        ) : null}
      </form>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Quotations
// ---------------------------------------------------------------------------

const QUOTATION_TONES: Record<string, 'neutral' | 'accent' | 'positive' | 'danger'> = {
  draft: 'neutral',
  issued: 'accent',
  accepted: 'positive',
  declined: 'danger',
  expired: 'neutral',
};

function QuotationsTab({ detail, onChange }: { detail: ProjectDetailDto; onChange: (detail: ProjectDetailDto) => void }) {
  const toast = useToast();
  const [creating, setCreating] = useState(false);

  async function run(action: () => Promise<unknown>, message: string) {
    try {
      await action();
      onChange(await api.projects.get(detail.project.id));
      toast(message);
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'That did not work', 'error');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted">
          Clients see prices only — no supplier rates, overhead or margin.
        </p>
        <Button size="sm" variant="primary" icon={<Plus className="size-3.5" aria-hidden />} onClick={() => setCreating(true)}>
          Raise quotation
        </Button>
      </div>

      {detail.quotations.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-5" aria-hidden />}
          title="No quotations yet"
          description="Raise one when the costs are in and the price looks right."
        />
      ) : (
        <ul className="divide-y divide-line/60">
          {detail.quotations.map((quotation) => (
            <QuotationRow
              key={quotation.id}
              quotation={quotation}
              onIssue={() => run(() => api.quotations.issue(quotation.id), 'Quotation issued')}
              onAccept={() => run(() => api.quotations.setStatus(quotation.id, 'accepted'), 'Marked as accepted')}
              onDecline={() => run(() => api.quotations.setStatus(quotation.id, 'declined'), 'Marked as declined')}
              onDelete={() => run(() => api.quotations.remove(quotation.id), 'Draft deleted')}
            />
          ))}
        </ul>
      )}

      <NewQuotationDrawer
        open={creating}
        projectId={detail.project.id}
        defaultNotes={detail.project.description}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          void run(async () => undefined, 'Quotation created');
        }}
      />
    </div>
  );
}

function QuotationRow({
  quotation,
  onIssue,
  onAccept,
  onDecline,
  onDelete,
}: {
  quotation: QuotationDto;
  onIssue: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[13px] font-medium text-ink">{quotation.reference}</p>
          <Pill tone={QUOTATION_TONES[quotation.status] ?? 'neutral'}>{quotation.status}</Pill>
          <Pill>{quotation.layout}</Pill>
        </div>
        <p className="mt-0.5 text-[11px] text-faint">
          {quotation.clientItems.length} {quotation.clientItems.length === 1 ? 'line' : 'lines'}
          {quotation.issuedOn ? ` · issued ${dateShort(quotation.issuedOn)}` : ' · not yet issued'}
          {quotation.validUntil ? ` · valid until ${dateShort(quotation.validUntil)}` : ''}
        </p>
      </div>

      <span className="tabular text-[13px] font-medium text-ink">{money(quotation.totalKobo)}</span>

      <div className="flex items-center gap-1.5">
        <a
          href={`/api/quotations/${quotation.id}/pdf`}
          target="_blank"
          rel="noreferrer"
          className="grid size-8 place-items-center rounded-full border border-line text-muted transition-colors hover:text-ink"
          title="Open PDF"
          aria-label={`Open PDF for ${quotation.reference}`}
        >
          <Download className="size-3.5" aria-hidden />
        </a>

        {quotation.status === 'draft' ? (
          <>
            <Button size="sm" variant="primary" onClick={onIssue}>
              Issue
            </Button>
            <IconButton label="Delete draft" className="size-8 hover:text-danger" onClick={onDelete}>
              <Trash2 className="size-3.5" aria-hidden />
            </IconButton>
          </>
        ) : null}

        {quotation.status === 'issued' ? (
          <>
            <Button size="sm" onClick={onDecline}>
              Declined
            </Button>
            <Button size="sm" variant="primary" onClick={onAccept}>
              Accepted
            </Button>
          </>
        ) : null}
      </div>
    </li>
  );
}

function NewQuotationDrawer({
  open,
  projectId,
  defaultNotes,
  onClose,
  onCreated,
}: {
  open: boolean;
  projectId: string;
  defaultNotes: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [layout, setLayout] = useState<'detailed' | 'package'>('detailed');
  const [notes, setNotes] = useState(defaultNotes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setNotes(defaultNotes);
      setLayout('detailed');
      setError(null);
    }
  }, [open, defaultNotes]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.quotations.create({ projectId, layout, clientNotes: notes.trim() });
      onCreated();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create the quotation');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Raise quotation"
      description="The project's net price is split across the client's line items."
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" form="quotation-form" type="submit" loading={busy}>
            Create draft
          </Button>
        </div>
      }
    >
      <form id="quotation-form" onSubmit={submit} className="space-y-3.5">
        <Field label="Layout" hint="Package collapses everything into one line." htmlFor="q-layout">
          <Select id="q-layout" value={layout} onChange={(event) => setLayout(event.target.value as 'detailed' | 'package')}>
            <option value="detailed">Detailed — one line per cost</option>
            <option value="package">Package — single price</option>
          </Select>
        </Field>

        <Field label="Notes for the client" htmlFor="q-notes">
          <Textarea id="q-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={5} />
        </Field>

        {error ? (
          <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[11px] text-danger">{error}</p>
        ) : null}
      </form>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Actuals
// ---------------------------------------------------------------------------

const VARIANCE_STATUS: Record<VarianceRowDto['status'], { className: string }> = {
  over: { className: 'text-danger' },
  under: { className: 'text-positive' },
  on_budget: { className: 'text-muted' },
  not_logged: { className: 'text-faint' },
};

/** Reads as a sentence: "A, B and C". */
function joinNames(names: string[]): string {
  const shown = names.slice(0, 4);
  const rest = names.length - shown.length;
  const list =
    shown.length <= 1
      ? (shown[0] ?? '')
      : shown.length === 2
        ? `${shown[0]} and ${shown[1]}`
        : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
  return rest > 0 ? `${list} and ${rest} more` : list;
}

function ActualsTab({ detail, onChange }: { detail: ProjectDetailDto; onChange: (detail: ProjectDetailDto) => void }) {
  const [adding, setAdding] = useState(false);
  const { actuals } = detail;

  // Categories with neither budget nor spend are dead rows — they add nothing to read.
  const visibleRows = actuals.variance.filter((row) => row.budgetKobo > 0 || row.actualKobo > 0);
  const budgetedRows = actuals.variance.filter((row) => row.budgetKobo > 0);
  const loggedRows = budgetedRows.filter((row) => row.status !== 'not_logged');
  const unloggedCount = budgetedRows.length - loggedRows.length;
  // An unlogged category still carries its whole budget as positive variance, which
  // reads like a saving. Comparing only what was logged keeps the figure honest.
  const loggedVarianceKobo = loggedRows.reduce((sum, row) => sum + row.varianceKobo, 0);
  const coveragePct = Math.max(0, Math.min(100, Math.round(actuals.coverageBp / 100)));
  const unloggedNames = actuals.unloggedCategories.map(
    (category) => CATEGORY_LABELS[category] ?? category,
  );

  const overBudget = actuals.coverageBp > 10_000;
  const spentPct = Math.round(actuals.coverageBp / 100);

  const summary = useMemo(() => {
    if (actuals.budgetDirectKobo <= 0) {
      return {
        tone: 'text-muted',
        surface: 'border-line/70',
        icon: <Receipt className="size-4" aria-hidden />,
        title: 'Nothing to compare against',
        body: 'This job has no cost lines, so there is no budget to measure spend against. The actual figures below are still real.',
      };
    }

    const warning = {
      tone: 'text-warning',
      surface: 'border-warning/30 bg-warning-soft',
      icon: <AlertTriangle className="size-4" aria-hidden />,
    };

    if (actuals.verdict === 'empty') {
      return {
        ...warning,
        title: 'Nothing logged yet',
        body: `No expenses are recorded, so actual direct cost reads zero and actual profit looks better than the job will really earn. Log what you have spent to replace the estimate with reality${
          budgetedRows.length > 0
            ? ` — ${budgetedRows.length} budgeted ${
                budgetedRows.length === 1 ? 'category has' : 'categories have'
              } nothing against ${budgetedRows.length === 1 ? 'it' : 'them'} yet`
            : ''
        }.`,
      };
    }

    if (actuals.verdict === 'partial') {
      return {
        ...warning,
        title: overBudget ? 'Over budget, and the picture is incomplete' : 'Incomplete picture',
        body: `${money(actuals.actualDirectCostsKobo)} is logged against a ${money(
          actuals.budgetDirectKobo,
        )} direct-cost budget — ${spentPct}% of it. ${loggedRows.length} of ${
          budgetedRows.length
        } budgeted categories have spend${
          unloggedNames.length > 0
            ? `; ${joinNames(unloggedNames)} ${
                unloggedNames.length === 1 ? 'has' : 'have'
              } nothing logged yet, so an “under” figure there is unspent budget, not a saving`
            : ''
        }. Treat actual profit as provisional.`,
      };
    }

    if (overBudget) {
      return {
        tone: 'text-danger',
        surface: 'border-danger/30 bg-danger-soft',
        icon: <AlertTriangle className="size-4" aria-hidden />,
        title: 'Complete, and over budget',
        body: `All ${budgetedRows.length} budgeted ${
          budgetedRows.length === 1 ? 'category has' : 'categories have'
        } spend logged. Actual direct cost is ${money(
          actuals.actualDirectCostsKobo,
        )} against a ${money(actuals.budgetDirectKobo)} budget — ${Math.round(
          (actuals.coverageBp - 10_000) / 100,
        )}% over.`,
      };
    }

    return {
      tone: 'text-positive',
      surface: 'border-positive/30 bg-positive-soft',
      icon: <BadgeCheck className="size-4" aria-hidden />,
      title: 'Full picture',
      body: `All ${budgetedRows.length} budgeted ${
        budgetedRows.length === 1 ? 'category has' : 'categories have'
      } spend logged, so actual profit is measured against what was really spent.`,
    };
  }, [
    actuals.actualDirectCostsKobo,
    actuals.budgetDirectKobo,
    actuals.coverageBp,
    actuals.verdict,
    budgetedRows.length,
    loggedRows.length,
    overBudget,
    spentPct,
    unloggedNames,
  ]);

  const variance = useMemo(() => {
    if (actuals.verdict === 'empty') {
      return { label: 'Variance to budget', value: '—', tone: 'text-muted', hint: 'No spend logged' };
    }
    if (actuals.verdict === 'partial') {
      return {
        label: 'Variance on logged lines',
        value: money(loggedVarianceKobo),
        tone: loggedVarianceKobo > 0 ? 'text-danger' : loggedVarianceKobo < 0 ? 'text-positive' : 'text-muted',
        hint: `${unloggedCount} ${unloggedCount === 1 ? 'category' : 'categories'} not logged`,
      };
    }
    return {
      label: 'Variance to budget',
      value: money(actuals.varianceTotalKobo),
      tone: actuals.varianceTotalKobo > 0 ? 'text-danger' : 'text-positive',
      hint: actuals.varianceTotalKobo > 0 ? 'Over budget' : 'Under budget',
    };
  }, [actuals.verdict, actuals.varianceTotalKobo, loggedVarianceKobo, unloggedCount]);

  return (
    <div className="space-y-3">
      {/* Lead with what the numbers mean. A grid of figures with no verdict is a puzzle. */}
      <Card className={`border px-3.5 py-3 ${summary.surface}`}>
        <div className="flex items-start gap-2.5">
          <span className={`mt-0.5 shrink-0 ${summary.tone}`}>{summary.icon}</span>
          <div className="min-w-0 flex-1">
            <p className={`text-[12px] font-semibold ${summary.tone}`}>{summary.title}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">{summary.body}</p>

            {actuals.budgetDirectKobo > 0 && actuals.verdict !== 'empty' ? (
              <div className="mt-2.5 space-y-1.5">
                <ProgressBar
                  value={coveragePct}
                  tone={
                    actuals.coverageBp > 10000
                      ? 'danger'
                      : actuals.verdict === 'complete'
                        ? 'positive'
                        : 'warning'
                  }
                />
                <div className="flex items-baseline justify-between gap-3 text-[10px] text-faint">
                  <span className="tabular">
                    {money(actuals.actualDirectCostsKobo)} of {money(actuals.budgetDirectKobo)} budget logged
                  </span>
                  <span className="tabular">
                    {actuals.remainingKobo > 0
                      ? `${money(actuals.remainingKobo)} still unspent`
                      : 'Over the direct-cost budget'}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      <div className="grid gap-2 sm:grid-cols-3">
        <MiniFigure
          label="Actual direct costs"
          value={money(actuals.actualDirectCostsKobo)}
          hint={actuals.verdict === 'empty' ? 'Nothing logged yet' : undefined}
        />
        <MiniFigure
          label="Actual net profit"
          value={money(actuals.actualNetProfitKobo)}
          tone={actuals.actualNetProfitKobo < 0 ? 'text-danger' : 'text-ink'}
          hint={actuals.verdict === 'complete' ? undefined : 'Provisional'}
        />
        <MiniFigure label={variance.label} value={variance.value} tone={variance.tone} hint={variance.hint} />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted">Budget versus what was really spent.</p>
        <Button size="sm" icon={<Plus className="size-3.5" aria-hidden />} onClick={() => setAdding(true)}>
          Add expense
        </Button>
      </div>

      {detail.actualExpenses.length === 0 ? (
        <EmptyState
          icon={<Receipt className="size-5" aria-hidden />}
          title="No expenses recorded"
          description="Log what you actually spent to see real profit."
        />
      ) : (
        <ul className="divide-y divide-line/60">
          {detail.actualExpenses.map((expense) => (
            <li key={expense.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] text-ink">{expense.description}</p>
                <p className="truncate text-[10px] text-faint">
                  {CATEGORY_LABELS[expense.category]} · {dateShort(expense.incurredOn)}
                  {expense.supplier ? ` · ${expense.supplier}` : ''}
                </p>
              </div>
              <span className="tabular text-[12px] font-medium text-ink">{money(expense.amountKobo)}</span>
              <IconButton
                label={`Delete ${expense.description}`}
                className="size-7 border-transparent bg-transparent hover:text-danger"
                onClick={() => {
                  void (async () => {
                    try {
                      onChange(await api.projects.removeActual(detail.project.id, expense.id));
                    } catch {
                      /* leave the row in place */
                    }
                  })();
                }}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      {visibleRows.length > 0 ? (
        <Card className="overflow-hidden border-line/70 bg-sunken/40">
          <div className="border-b border-line/60 px-3 py-2">
            <p className="text-[10px] leading-relaxed text-faint">
              Variance is spend minus budget, so a positive figure is over. “Not logged” rows are
              budget with nothing spent against them yet — that is missing information, not money
              saved.
            </p>
          </div>
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-line text-[10px] tracking-wide text-faint uppercase">
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 text-right font-medium">Budget</th>
                <th className="px-3 py-2 text-right font-medium">Actual</th>
                <th className="px-3 py-2 text-right font-medium">Variance</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const unlogged = row.status === 'not_logged';
                return (
                  <tr key={row.category} className="border-b border-line/50 last:border-0">
                    <td className="px-3 py-2 text-muted">{CATEGORY_LABELS[row.category]}</td>
                    <td className="tabular px-3 py-2 text-right text-muted">{money(row.budgetKobo)}</td>
                    <td className={`tabular px-3 py-2 text-right ${unlogged ? 'text-faint' : 'text-ink'}`}>
                      {unlogged ? '—' : money(row.actualKobo)}
                    </td>
                    <td
                      className={`tabular px-3 py-2 text-right font-medium ${
                        VARIANCE_STATUS[row.status].className
                      }`}
                    >
                      {unlogged ? (
                        <span className="text-[10px] font-normal">Not logged</span>
                      ) : (
                        <>
                          {money(row.varianceKobo)}
                          <span className="ml-1 text-[10px] font-normal text-faint">
                            {signedPercent(row.varianceBp)}
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : null}

      <ActualDrawer
        open={adding}
        projectId={detail.project.id}
        lines={detail.costLines}
        onClose={() => setAdding(false)}
        onSaved={(next) => {
          onChange(next);
          setAdding(false);
        }}
      />
    </div>
  );
}

function ActualDrawer({
  open,
  projectId,
  lines,
  onClose,
  onSaved,
}: {
  open: boolean;
  projectId: string;
  lines: CostLineDto[];
  onClose: () => void;
  onSaved: (detail: ProjectDetailDto) => void;
}) {
  const [category, setCategory] = useState<CostCategory>('equipment');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [incurredOn, setIncurredOn] = useState(today());
  const [supplier, setSupplier] = useState('');
  const [costLineId, setCostLineId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCategory('equipment');
    setDescription('');
    setAmount('');
    setIncurredOn(today());
    setSupplier('');
    setCostLineId('');
    setError(null);
  }, [open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const payload: ActualInput = {
      category,
      description: description.trim(),
      amountKobo: parseNairaToKobo(amount) ?? 0,
      incurredOn,
      supplier: supplier.trim(),
      costLineId: costLineId || null,
    };

    try {
      onSaved(await api.projects.addActual(projectId, payload));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not record the expense');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Record expense"
      description="What it actually cost, not what it was budgeted at."
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" form="actual-form" type="submit" loading={busy}>
            Save expense
          </Button>
        </div>
      }
    >
      <form id="actual-form" onSubmit={submit} className="space-y-3.5">
        <Field label="Category" htmlFor="a-category">
          <Select
            id="a-category"
            value={category}
            onChange={(event) => {
              const next = event.target.value as CostCategory;
              setCategory(next);
              setCostLineId('');
            }}
          >
            {ALL_CATEGORIES.map((key) => (
              <option key={key} value={key}>
                {CATEGORY_LABELS[key]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Description" htmlFor="a-description">
          <Input id="a-description" value={description} onChange={(event) => setDescription(event.target.value)} required />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₦)" htmlFor="a-amount">
            <Input id="a-amount" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required />
          </Field>
          <Field label="Date" htmlFor="a-date">
            <Input id="a-date" type="date" value={incurredOn} onChange={(event) => setIncurredOn(event.target.value)} />
          </Field>
        </div>

        <Field label="Supplier" htmlFor="a-supplier">
          <Input id="a-supplier" value={supplier} onChange={(event) => setSupplier(event.target.value)} />
        </Field>

        <Field label="Against cost line" hint="Optional — links the spend to a budgeted line." htmlFor="a-line">
          <Select id="a-line" value={costLineId} onChange={(event) => setCostLineId(event.target.value)}>
            <option value="">Not linked</option>
            {lines
              .filter((line) => line.category === category)
              .map((line) => (
                <option key={line.id} value={line.id}>
                  {line.description}
                </option>
              ))}
          </Select>
        </Field>

        {error ? (
          <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[11px] text-danger">{error}</p>
        ) : null}
      </form>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

function PaymentsTab({ detail, onChange }: { detail: ProjectDetailDto; onChange: (detail: ProjectDetailDto) => void }) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted">
          {money(detail.paidKobo)} received · {money(detail.balanceKobo)} outstanding
        </p>
        <Button size="sm" icon={<Plus className="size-3.5" aria-hidden />} onClick={() => setAdding(true)}>
          Record payment
        </Button>
      </div>

      {detail.payments.length === 0 ? (
        <EmptyState icon={<Wallet className="size-5" aria-hidden />} title="No payments recorded" />
      ) : (
        <ul className="divide-y divide-line/60">
          {detail.payments.map((payment) => (
            <li key={payment.id} className="flex items-center gap-3 py-2.5">
              <span className="grid size-8 place-items-center rounded-lg bg-positive-soft text-positive">
                <TrendingUp className="size-3.5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] text-ink">{dateShort(payment.paidOn)}</p>
                <p className="truncate text-[10px] text-faint">
                  {[payment.method, payment.reference].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              <span className="tabular text-[12px] font-medium text-positive">{money(payment.amountKobo)}</span>
              <IconButton
                label="Delete payment"
                className="size-7 border-transparent bg-transparent hover:text-danger"
                onClick={() => {
                  void (async () => {
                    try {
                      onChange(await api.projects.removePayment(detail.project.id, payment.id));
                    } catch {
                      /* leave the row in place */
                    }
                  })();
                }}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <PaymentDrawer
        open={adding}
        projectId={detail.project.id}
        onClose={() => setAdding(false)}
        onSaved={(next) => {
          onChange(next);
          setAdding(false);
        }}
      />
    </div>
  );
}

function PaymentDrawer({
  open,
  projectId,
  onClose,
  onSaved,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onSaved: (detail: ProjectDetailDto) => void;
}) {
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(today());
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount('');
    setPaidOn(today());
    setMethod('');
    setReference('');
    setError(null);
  }, [open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const payload: PaymentInput = {
      amountKobo: parseNairaToKobo(amount) ?? 0,
      paidOn,
      method: method.trim(),
      reference: reference.trim(),
    };

    try {
      onSaved(await api.projects.addPayment(projectId, payload));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not record the payment');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Record payment"
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" form="payment-form" type="submit" loading={busy}>
            Save payment
          </Button>
        </div>
      }
    >
      <form id="payment-form" onSubmit={submit} className="space-y-3.5">
        <Field label="Amount (₦)" htmlFor="pay-amount">
          <Input id="pay-amount" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Received on" htmlFor="pay-date">
            <Input id="pay-date" type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />
          </Field>
          <Field label="Method" htmlFor="pay-method">
            <Input id="pay-method" value={method} onChange={(event) => setMethod(event.target.value)} placeholder="Transfer" />
          </Field>
        </div>
        <Field label="Reference" htmlFor="pay-reference">
          <Input id="pay-reference" value={reference} onChange={(event) => setReference(event.target.value)} />
        </Field>

        {error ? (
          <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[11px] text-danger">{error}</p>
        ) : null}
      </form>
    </Drawer>
  );
}

function MiniFigure({
  label,
  value,
  tone = 'text-ink',
  hint,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-line/70 bg-sunken/40 px-3 py-2.5">
      <p className="text-[10px] text-faint">{label}</p>
      <p className={`tabular mt-0.5 text-[15px] font-semibold ${tone}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-[10px] text-faint">{hint}</p> : null}
    </div>
  );
}
