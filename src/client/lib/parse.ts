/**
 * Input → storage units.
 *
 * Users type naira and percentages; the API takes integer kobo, milli-units and
 * basis points. Parsing happens once, here, so nothing downstream has to guess.
 */

function toNumber(input: string): number | null {
  const cleaned = input.replace(/[₦,\s]/g, '').trim();
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** `1,350.50` → 135050 kobo. */
export function parseNairaToKobo(input: string): number | null {
  const value = toNumber(input);
  return value === null ? null : Math.round(value * 100);
}

/** 135050 → `1,350.50` for a text input. */
export function koboToNairaInput(kobo: number): string {
  return (kobo / 100).toFixed(2).replace(/\.00$/, '');
}

/** `2.5` → 2500 milli-units. */
export function parseQuantityToMilli(input: string): number | null {
  const value = toNumber(input);
  return value === null ? null : Math.round(value * 1000);
}

export function milliToQuantityInput(milli: number): string {
  const value = milli / 1000;
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

/** `18.5` → 1850 basis points. */
export function parsePercentToBp(input: string): number | null {
  const value = toNumber(input);
  return value === null ? null : Math.round(value * 100);
}

export function bpToPercentInput(bp: number): string {
  const value = bp / 100;
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}
