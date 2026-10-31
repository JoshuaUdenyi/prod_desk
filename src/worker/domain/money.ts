/**
 * Decimal-safe money arithmetic.
 *
 * All monetary values are integers in minor units (kobo, 1/100 of a naira).
 * JavaScript floats are never used for money: products and percentages are
 * evaluated in BigInt and rounded half-up once, at the boundary where a
 * rounded value is actually required.
 *
 * Quantities and durations are stored as integers scaled by 1,000 ("milli"),
 * so 1.5 rental days is 1_500. That keeps fractional quantities out of the
 * float path entirely.
 */

export const KOBO = 100n;
export const QTY_SCALE = 1_000n;
export const BASIS_POINTS = 10_000n;

export class MoneyParseError extends Error {
  constructor(input: string, reason: string) {
    super(`Cannot parse "${input}" as money: ${reason}`);
    this.name = 'MoneyParseError';
  }
}

/** Largest value we allow through the Number boundary (~9.0e12 naira). */
const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;

const CURRENCY_PREFIX = /^(?:₦|NGN|N\s?)(?=\d)/i;

/**
 * Parse a decimal string (or integer) into an integer scaled by `scaleDigits`.
 *
 * Accepts grouping commas, underscores, spaces, a leading currency symbol and
 * surrounding parentheses for negatives. Rounds half-up when the input carries
 * more decimal places than the scale allows.
 */
export function parseScaled(input: string | number, scaleDigits: number): number {
  const text = String(input).trim();
  if (text === '') throw new MoneyParseError(text, 'empty value');

  let body = text.replace(/[\s,_]/g, '').replace(CURRENCY_PREFIX, '');
  let negative = false;
  if (body.startsWith('(') && body.endsWith(')')) {
    negative = true;
    body = body.slice(1, -1);
  }

  const match = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(body);
  if (!match) throw new MoneyParseError(text, 'not a decimal number');

  const sign = match[1] === '-' || negative ? -1n : 1n;
  const whole = match[2] ?? '';
  const fraction = match[3] ?? '';
  if (whole === '' && fraction === '') throw new MoneyParseError(text, 'no digits');

  const scale = 10n ** BigInt(scaleDigits);
  const padded = (fraction + '0'.repeat(scaleDigits + 1)).slice(0, scaleDigits);
  const roundingDigit = fraction.charAt(scaleDigits);

  let value = BigInt(whole || '0') * scale + BigInt(padded || '0');
  if (roundingDigit !== '' && Number(roundingDigit) >= 5) value += 1n;
  value *= sign;

  return toSafeNumber(value, text);
}

/** Naira input -> integer kobo. */
export function parseKobo(input: string | number): number {
  return parseScaled(input, 2);
}

/** Quantity/days input -> integer milli-units (3 decimal places). */
export function parseQuantity(input: string | number): number {
  return parseScaled(input, 3);
}

/** Percentage input ("30", "12.5", "7.5%") -> basis points (1% = 100 bp). */
export function parsePercentToBasisPoints(input: string | number): number {
  const cleaned = String(input).trim().replace(/%$/, '');
  return parseScaled(cleaned, 2);
}

/**
 * Divide with half-up rounding, sign-correctly. The only rounding operation in
 * the codebase; everything else composes it.
 */
export function roundDivide(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('Division by zero in money arithmetic');

  const negative = numerator < 0n !== denominator < 0n;
  const absN = numerator < 0n ? -numerator : numerator;
  const absD = denominator < 0n ? -denominator : denominator;

  // floor((2n + d) / 2d) rounds halves away from zero.
  const magnitude = (absN * 2n + absD) / (2n * absD);
  return negative ? -magnitude : magnitude;
}

/** rate (kobo) x quantity (milli) x days (milli), rounded once to kobo. */
export function multiplyScaled(rateKobo: number, quantityMilli: number, daysMilli = 1_000): number {
  const product = BigInt(rateKobo) * BigInt(quantityMilli) * BigInt(daysMilli);
  const divisor = QTY_SCALE * QTY_SCALE;
  return toSafeNumber(roundDivide(product, divisor), `${rateKobo} x ${quantityMilli} x ${daysMilli}`);
}

/** `basisPoints` percent of an amount, rounded half-up. */
export function percentOf(amountKobo: number, basisPoints: number): number {
  const product = BigInt(amountKobo) * BigInt(basisPoints);
  return toSafeNumber(roundDivide(product, BASIS_POINTS), `percentOf(${amountKobo}, ${basisPoints})`);
}

/** `a` as a percentage of `b`, expressed in basis points. */
export function basisPointsOf(part: number, whole: number): number {
  if (whole === 0) return 0;
  return toSafeNumber(
    roundDivide(BigInt(part) * BASIS_POINTS, BigInt(whole)),
    `bp(${part}/${whole})`,
  );
}

/** Apply VAT to a net amount. VAT is always tracked separately from revenue. */
export function vatOn(netKobo: number, vatRateBp: number): number {
  return percentOf(netKobo, vatRateBp);
}

function toSafeNumber(value: bigint, context: string): number {
  if (value > BigInt(MAX_SAFE_MINOR) || value < BigInt(-MAX_SAFE_MINOR)) {
    throw new RangeError(`Money value out of safe range (${context}): ${value.toString()}`);
  }
  return Number(value);
}

const nairaFormatter = new Intl.NumberFormat('en-NG', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export interface FormatOptions {
  /** "auto" (default) shows kobo only when non-zero. */
  kobo?: 'auto' | 'always' | 'never';
  /** Omit the ₦ symbol for tables where the unit is stated in a header. */
  symbol?: boolean;
}

/** Format integer kobo as a display string, e.g. ₦1,350,000.00 */
export function formatKobo(kobo: number, options: FormatOptions = {}): string {
  const koboMode = options.kobo ?? 'auto';
  const negative = kobo < 0;
  const absolute = Math.abs(kobo);
  const naira = Math.trunc(absolute / 100);
  const minor = absolute % 100;

  const showMinor = koboMode === 'always' || (koboMode === 'auto' && minor !== 0);
  const whole = new Intl.NumberFormat('en-NG').format(naira);
  const fraction = showMinor ? `.${String(minor).padStart(2, '0')}` : '';
  const prefix = options.symbol === false ? '' : '₦';

  return `${negative ? '-' : ''}${prefix}${whole}${fraction}`;
}

/** Format basis points as a percentage, e.g. 3180 -> "31.8%". */
export function formatBasisPoints(bp: number, digits = 1): string {
  const value = bp / 100;
  const fixed = value.toFixed(digits);
  return `${fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')}%`;
}

/** Test helper: kobo from whole naira, for readable fixtures. */
export function naira(amount: number): number {
  return Math.round(amount * 100);
}
