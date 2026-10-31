/** Display formatting. Money is always stored as integer kobo. */

const naira = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 });
const nairaPrecise = new Intl.NumberFormat('en-NG', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `₦1,350,000` — the decimals only appear when there are kobo to show. */
export function money(kobo: number): string {
  const negative = kobo < 0;
  const absolute = Math.abs(Math.round(kobo));
  const major = Math.trunc(absolute / 100);
  const minor = absolute % 100;
  const digits = minor === 0 ? naira.format(major) : nairaPrecise.format(absolute / 100);
  return `${negative ? '-' : ''}₦${digits}`;
}

/** `₦1.35m` — for stat cards where the exact naira is noise. */
export function moneyCompact(kobo: number): { value: string; suffix: string | null } {
  const negative = kobo < 0;
  const major = Math.abs(kobo) / 100;
  const sign = negative ? '-' : '';

  if (major >= 1_000_000_000) return { value: `${sign}₦${(major / 1_000_000_000).toFixed(2)}`, suffix: 'bn' };
  if (major >= 1_000_000) return { value: `${sign}₦${(major / 1_000_000).toFixed(2)}`, suffix: 'm' };
  if (major >= 10_000) return { value: `${sign}₦${Math.round(major / 1_000)}`, suffix: 'k' };
  return { value: money(kobo), suffix: null };
}

/** Basis points as a signed percentage: 1850 → `18.5%`, -240 → `-2.4%`. */
export function percent(basisPoints: number, digits = 1): string {
  return `${(basisPoints / 100).toFixed(digits).replace(/\.0+$/, '')}%`;
}

export function signedPercent(basisPoints: number, digits = 1): string {
  const value = basisPoints / 100;
  const fixed = value.toFixed(digits).replace(/\.0+$/, '');
  return `${value > 0 ? '+' : ''}${fixed}%`;
}

/** `1.5` from 1500 milli-units, without a trailing `.0`. */
export function quantity(milli: number): string {
  const value = milli / 1000;
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

export function dateShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function monthLabel(iso: string): string {
  const date = new Date(`${iso.slice(0, 7)}-01T00:00:00`);
  return date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

/** Human labels for the enums that cross the API. */
export const CATEGORY_LABELS: Record<string, string> = {
  equipment: 'Equipment',
  crew: 'Crew',
  logistics: 'Logistics',
  internet: 'Internet',
  other: 'Other',
  overhead: 'Overhead',
};

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  quoted: 'Quoted',
  approved: 'Approved',
  in_production: 'In production',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const EVENT_LABELS: Record<string, string> = {
  corporate: 'Corporate',
  conference: 'Conference',
  concert: 'Concert',
  church: 'Church',
  wedding: 'Wedding',
  government: 'Government',
  product_launch: 'Product launch',
  workshop: 'Workshop',
  other: 'Other',
};

export const BAND_LABELS: Record<string, string> = {
  critical: 'Critical',
  low: 'Low margin',
  acceptable: 'Acceptable',
  good: 'Good',
  excellent: 'Excellent',
};
