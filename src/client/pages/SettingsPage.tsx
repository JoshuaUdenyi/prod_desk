import { useEffect, useRef, useState } from 'react';
import { ImagePlus, ShieldCheck, UserPlus } from 'lucide-react';
import type { SessionUser, SettingsDto } from '@shared/types';
import { PageHeader } from '../components/shell';
import {
  Button,
  Card,
  CardHeader,
  Checkbox,
  Field,
  Input,
  Pill,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { bpToPercentInput, koboToNairaInput, parseNairaToKobo, parsePercentToBp } from '../lib/parse';
import { initials } from '../lib/format';

/** The form stores everything as text; it is converted once, on save. */
type FormState = Record<string, string> & { overheadMethod: string; contingencyBase: string };

function toForm(settings: SettingsDto): FormState {
  return {
    companyName: settings.companyName,
    companyEmail: settings.companyEmail,
    companyPhone: settings.companyPhone,
    companyAddress: settings.companyAddress,
    bankDetails: settings.bankDetails,
    paymentTerms: settings.paymentTerms,
    marginBudget: bpToPercentInput(settings.marginBudgetBp),
    marginMidrange: bpToPercentInput(settings.marginMidrangeBp),
    marginPremium: bpToPercentInput(settings.marginPremiumBp),
    minMargin: bpToPercentInput(settings.minMarginBp),
    bandCritical: bpToPercentInput(settings.bandCriticalBelowBp),
    bandLow: bpToPercentInput(settings.bandLowBelowBp),
    bandAcceptable: bpToPercentInput(settings.bandAcceptableBelowBp),
    bandGood: bpToPercentInput(settings.bandGoodUpToBp),
    contingency: bpToPercentInput(settings.defaultContingencyBp),
    contingencyBase: settings.contingencyBase,
    overheadMethod: settings.overheadMethod,
    overheadFixed: koboToNairaInput(settings.overheadFixedKobo),
    overheadPercent: bpToPercentInput(settings.overheadPercentBp),
    vatRate: bpToPercentInput(settings.vatRateBp),
    taxProvision: bpToPercentInput(settings.taxProvisionBp),
    validity: String(settings.quotationValidityDays),
    deposit: bpToPercentInput(settings.depositPercentBp),
    vatEnabled: settings.vatEnabled ? 'true' : 'false',
  };
}

export function SettingsPage() {
  const { user } = useSession();
  const toast = useToast();
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { settings: loaded } = await api.settings.get();
        setSettings(loaded);
        setForm(toForm(loaded));
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'Could not load settings');
      }
    })();
  }, []);

  const set = (key: string, value: string) => setForm((current) => (current ? { ...current, [key]: value } : current));

  async function save() {
    if (!form) return;
    setBusy(true);
    setError(null);

    const bp = (key: string, fallback: number) => parsePercentToBp(form[key] ?? '') ?? fallback;

    try {
      const { settings: updated } = await api.settings.update({
        companyName: form.companyName ?? '',
        companyEmail: form.companyEmail ?? '',
        companyPhone: form.companyPhone ?? '',
        companyAddress: form.companyAddress ?? '',
        bankDetails: form.bankDetails ?? '',
        paymentTerms: form.paymentTerms ?? '',
        marginBudgetBp: bp('marginBudget', settings?.marginBudgetBp ?? 0),
        marginMidrangeBp: bp('marginMidrange', settings?.marginMidrangeBp ?? 0),
        marginPremiumBp: bp('marginPremium', settings?.marginPremiumBp ?? 0),
        minMarginBp: bp('minMargin', settings?.minMarginBp ?? 0),
        bandCriticalBelowBp: bp('bandCritical', settings?.bandCriticalBelowBp ?? 0),
        bandLowBelowBp: bp('bandLow', settings?.bandLowBelowBp ?? 0),
        bandAcceptableBelowBp: bp('bandAcceptable', settings?.bandAcceptableBelowBp ?? 0),
        bandGoodUpToBp: bp('bandGood', settings?.bandGoodUpToBp ?? 0),
        defaultContingencyBp: bp('contingency', settings?.defaultContingencyBp ?? 0),
        contingencyBase: (form.contingencyBase as SettingsDto['contingencyBase']) ?? 'direct',
        overheadMethod: (form.overheadMethod as SettingsDto['overheadMethod']) ?? 'none',
        overheadFixedKobo: parseNairaToKobo(form.overheadFixed ?? '') ?? 0,
        overheadPercentBp: bp('overheadPercent', settings?.overheadPercentBp ?? 0),
        vatEnabled: form.vatEnabled === 'true',
        vatRateBp: bp('vatRate', settings?.vatRateBp ?? 0),
        taxProvisionBp: bp('taxProvision', settings?.taxProvisionBp ?? 0),
        quotationValidityDays: Number(form.validity) || 30,
        depositPercentBp: bp('deposit', settings?.depositPercentBp ?? 0),
      });

      setSettings(updated);
      setForm(toForm(updated));
      toast('Settings saved');
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : 'Could not save settings';
      setError(message);
      toast(message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(file: File) {
    try {
      const { logoUrl } = await api.settings.uploadLogo(file);
      setSettings((current) => (current ? { ...current, companyLogoUrl: `${logoUrl}?v=${Date.now()}` } : current));
      toast('Logo updated');
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Could not upload the logo', 'error');
    }
  }

  if (!form || !settings) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Company details, pricing defaults and who can get in."
        actions={
          <Button variant="primary" onClick={save} loading={busy}>
            Save changes
          </Button>
        }
      />

      {error ? (
        <Card className="mb-3 border-danger/30 bg-danger-soft px-4 py-3 text-xs text-danger">{error}</Card>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-5">
          <CardHeader title="Company" hint="Appears on every quotation PDF." />

          <div className="mt-4 flex items-center gap-3">
            <div className="grid size-14 place-items-center overflow-hidden rounded-xl border border-line bg-sunken">
              {settings.companyLogoUrl ? (
                <img src={settings.companyLogoUrl} alt="" className="size-full object-contain" />
              ) : (
                <ImagePlus className="size-5 text-faint" aria-hidden />
              )}
            </div>
            <div>
              <Button size="sm" onClick={() => fileInput.current?.click()}>
                Upload logo
              </Button>
              <p className="mt-1 text-[10px] text-faint">PNG or JPG, under 1 MB.</p>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadLogo(file);
                  event.target.value = '';
                }}
              />
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <Field label="Company name" htmlFor="s-name">
              <Input id="s-name" value={form.companyName ?? ''} onChange={(event) => set('companyName', event.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email" htmlFor="s-email">
                <Input id="s-email" value={form.companyEmail ?? ''} onChange={(event) => set('companyEmail', event.target.value)} />
              </Field>
              <Field label="Phone" htmlFor="s-phone">
                <Input id="s-phone" value={form.companyPhone ?? ''} onChange={(event) => set('companyPhone', event.target.value)} />
              </Field>
            </div>
            <Field label="Address" htmlFor="s-address">
              <Textarea id="s-address" value={form.companyAddress ?? ''} onChange={(event) => set('companyAddress', event.target.value)} rows={2} />
            </Field>
            <Field label="Bank details" htmlFor="s-bank">
              <Textarea id="s-bank" value={form.bankDetails ?? ''} onChange={(event) => set('bankDetails', event.target.value)} rows={3} />
            </Field>
            <Field label="Payment terms" htmlFor="s-terms">
              <Textarea id="s-terms" value={form.paymentTerms ?? ''} onChange={(event) => set('paymentTerms', event.target.value)} rows={2} />
            </Field>
          </div>
        </Card>

        <Card className="p-5">
          <CardHeader title="Margins" hint="Default targets and the warning bands." />

          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Budget %" htmlFor="s-mb">
                <Input id="s-mb" value={form.marginBudget ?? ''} onChange={(event) => set('marginBudget', event.target.value)} inputMode="decimal" />
              </Field>
              <Field label="Mid-range %" htmlFor="s-mm">
                <Input id="s-mm" value={form.marginMidrange ?? ''} onChange={(event) => set('marginMidrange', event.target.value)} inputMode="decimal" />
              </Field>
              <Field label="Premium %" htmlFor="s-mp">
                <Input id="s-mp" value={form.marginPremium ?? ''} onChange={(event) => set('marginPremium', event.target.value)} inputMode="decimal" />
              </Field>
            </div>

            <Field label="Minimum acceptable margin %" hint="Below this, a price needs owner approval." htmlFor="s-min">
              <Input id="s-min" value={form.minMargin ?? ''} onChange={(event) => set('minMargin', event.target.value)} inputMode="decimal" />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Critical below %" htmlFor="s-bc">
                <Input id="s-bc" value={form.bandCritical ?? ''} onChange={(event) => set('bandCritical', event.target.value)} inputMode="decimal" />
              </Field>
              <Field label="Low below %" htmlFor="s-bl">
                <Input id="s-bl" value={form.bandLow ?? ''} onChange={(event) => set('bandLow', event.target.value)} inputMode="decimal" />
              </Field>
              <Field label="Acceptable below %" htmlFor="s-ba">
                <Input id="s-ba" value={form.bandAcceptable ?? ''} onChange={(event) => set('bandAcceptable', event.target.value)} inputMode="decimal" />
              </Field>
              <Field label="Good up to %" htmlFor="s-bg">
                <Input id="s-bg" value={form.bandGood ?? ''} onChange={(event) => set('bandGood', event.target.value)} inputMode="decimal" />
              </Field>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <CardHeader title="Costs and overhead" hint="How contingency and overhead are added to a project." />

          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Default contingency %" htmlFor="s-cont">
                <Input id="s-cont" value={form.contingency ?? ''} onChange={(event) => set('contingency', event.target.value)} inputMode="decimal" />
              </Field>
              <Field label="Contingency applies to" htmlFor="s-contingency-base">
                <Select id="s-contingency-base" value={form.contingencyBase} onChange={(event) => set('contingencyBase', event.target.value)}>
                  <option value="direct">Direct costs</option>
                  <option value="direct_plus_overhead">Direct + overhead</option>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Overhead method" htmlFor="s-overhead">
                <Select id="s-overhead" value={form.overheadMethod} onChange={(event) => set('overheadMethod', event.target.value)}>
                  <option value="none">None</option>
                  <option value="fixed">Fixed per project</option>
                  <option value="percent">Percentage of direct</option>
                </Select>
              </Field>
              {form.overheadMethod === 'percent' ? (
                <Field label="Overhead %" htmlFor="s-overhead-pct">
                  <Input id="s-overhead-pct" value={form.overheadPercent ?? ''} onChange={(event) => set('overheadPercent', event.target.value)} inputMode="decimal" />
                </Field>
              ) : form.overheadMethod === 'fixed' ? (
                <Field label="Overhead (₦)" htmlFor="s-overhead-fixed">
                  <Input id="s-overhead-fixed" value={form.overheadFixed ?? ''} onChange={(event) => set('overheadFixed', event.target.value)} inputMode="decimal" />
                </Field>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="VAT rate %" htmlFor="s-vat">
                <Input id="s-vat" value={form.vatRate ?? ''} onChange={(event) => set('vatRate', event.target.value)} inputMode="decimal" />
              </Field>
              <Field label="Tax provision %" htmlFor="s-tax">
                <Input id="s-tax" value={form.taxProvision ?? ''} onChange={(event) => set('taxProvision', event.target.value)} inputMode="decimal" />
              </Field>
            </div>

            <Checkbox
              label="Add VAT to quotations"
              checked={form.vatEnabled === 'true'}
              onChange={(event) => set('vatEnabled', event.target.checked ? 'true' : 'false')}
            />
          </div>
        </Card>

        <Card className="p-5">
          <CardHeader title="Quotations and deposits" hint="How long a quote holds and what is paid up front." />

          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Validity (days)" htmlFor="s-validity">
                <Input id="s-validity" value={form.validity ?? ''} onChange={(event) => set('validity', event.target.value)} inputMode="numeric" />
              </Field>
              <Field label="Deposit %" htmlFor="s-deposit">
                <Input id="s-deposit" value={form.deposit ?? ''} onChange={(event) => set('deposit', event.target.value)} inputMode="decimal" />
              </Field>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-line bg-sunken px-3 py-2.5">
              <ShieldCheck className="size-4 text-accent" aria-hidden />
              <p className="text-[11px] text-muted">
                Currency is fixed at <span className="font-medium text-ink">NGN (₦)</span> for this release.
              </p>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button onClick={save} loading={busy}>
              Save changes
            </Button>
          </div>
        </Card>
      </div>

      {user?.role === 'owner' ? <TeamCard /> : null}
    </>
  );
}

function TeamCard() {
  const toast = useToast();
  const [users, setUsers] = useState<SessionUser[] | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'owner' | 'finance'>('finance');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const { users: rows } = await api.auth.users();
      setUsers(rows);
    } catch {
      setUsers([]);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  async function addUser(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.auth.createUser({ name: name.trim(), email: email.trim(), password, role });
      setName('');
      setEmail('');
      setPassword('');
      await load();
      toast('User added');
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'Could not add the user', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-3 p-5">
      <CardHeader title="Team" hint="Finance users can cost and quote; only owners change prices below the margin floor." />

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div>
          {users === null ? (
            <Skeleton className="h-24" />
          ) : (
            <ul className="divide-y divide-line/60">
              {users.map((member) => (
                <li key={member.id} className="flex items-center gap-3 py-2.5">
                  <span className="grid size-8 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
                    {initials(member.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] text-ink">{member.name}</p>
                    <p className="truncate text-[10px] text-faint">{member.email}</p>
                  </div>
                  <Pill tone={member.role === 'owner' ? 'accent' : 'neutral'}>{member.role}</Pill>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form onSubmit={addUser} className="space-y-3 rounded-xl border border-line bg-sunken/40 p-4">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
            <UserPlus className="size-3.5" aria-hidden />
            Add a user
          </p>
          <Field label="Name" htmlFor="u-name">
            <Input id="u-name" value={name} onChange={(event) => setName(event.target.value)} required />
          </Field>
          <Field label="Email" htmlFor="u-email">
            <Input id="u-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </Field>
          <Field label="Temporary password" hint="At least 10 characters." htmlFor="u-password">
            <Input id="u-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </Field>
          <Field label="Role" htmlFor="u-role">
            <Select id="u-role" value={role} onChange={(event) => setRole(event.target.value as 'owner' | 'finance')}>
              <option value="finance">Finance</option>
              <option value="owner">Owner</option>
            </Select>
          </Field>
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            Add user
          </Button>
        </form>
      </div>
    </Card>
  );
}
