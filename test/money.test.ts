import { describe, expect, it } from 'vitest';
import {
  basisPointsOf,
  formatBasisPoints,
  formatKobo,
  MoneyParseError,
  multiplyScaled,
  naira,
  parseKobo,
  parsePercentToBasisPoints,
  parseQuantity,
  percentOf,
  roundDivide,
  vatOn,
} from '../src/worker/domain/money';

describe('parsing money input', () => {
  it('parses plain and grouped naira amounts into kobo', () => {
    expect(parseKobo('200000')).toBe(naira(200_000));
    expect(parseKobo('1,234.56')).toBe(123_456);
    expect(parseKobo('₦2,500,000')).toBe(naira(2_500_000));
    expect(parseKobo('NGN 750.5')).toBe(75_050);
    expect(parseKobo(1.1)).toBe(110);
  });

  it('accepts accounting negatives', () => {
    expect(parseKobo('(1,000)')).toBe(-100_000);
    expect(parseKobo('-500.25')).toBe(-50_025);
  });

  it('rounds half up beyond two decimal places', () => {
    expect(parseKobo('10.005')).toBe(1_001);
    expect(parseKobo('10.004')).toBe(1_000);
  });

  it('rejects junk rather than silently producing zero', () => {
    expect(() => parseKobo('')).toThrow(MoneyParseError);
    expect(() => parseKobo('abc')).toThrow(MoneyParseError);
    expect(() => parseKobo('1.2.3')).toThrow(MoneyParseError);
  });

  it('parses quantities and percentages at their own scale', () => {
    expect(parseQuantity('1.5')).toBe(1_500);
    expect(parseQuantity('0.25')).toBe(250);
    expect(parsePercentToBasisPoints('30')).toBe(3_000);
    expect(parsePercentToBasisPoints('12.5%')).toBe(1_250);
    expect(parsePercentToBasisPoints('7.5')).toBe(750);
  });
});

describe('rounding', () => {
  it('rounds halves away from zero', () => {
    expect(roundDivide(5n, 2n)).toBe(3n);
    expect(roundDivide(-5n, 2n)).toBe(-3n);
    expect(roundDivide(7n, 3n)).toBe(2n);
    expect(roundDivide(8n, 3n)).toBe(3n);
    expect(roundDivide(0n, 7n)).toBe(0n);
  });

  it('refuses division by zero instead of returning Infinity', () => {
    expect(() => roundDivide(1n, 0n)).toThrow();
  });

  it('rounds percentage applications once', () => {
    // 2.5 rounds up, so a 5% contingency on ₦0.50 is ₦0.03 rather than ₦0.02.
    expect(percentOf(50, 500)).toBe(3);
  });
});

describe('scaled multiplication', () => {
  it('multiplies rate by quantity and days without float drift', () => {
    // ₦50,000 x 2 cameras x 3 days
    expect(multiplyScaled(naira(50_000), 2_000, 3_000)).toBe(naira(300_000));
  });

  it('handles fractional quantities and durations exactly', () => {
    // ₦33,333.33 x 1.5 days = ₦49,999.995, which rounds up to ₦50,000.00
    expect(multiplyScaled(3_333_333, 1_000, 1_500)).toBe(5_000_000);
    // 0.1 + 0.2 style drift would show up as 0.30000000000000004 here
    expect(multiplyScaled(100, 3_000, 1_000)).toBe(300);
  });
});

describe('ratios', () => {
  it('computes gross margin in basis points', () => {
    expect(basisPointsOf(naira(150_000), naira(500_000))).toBe(3_000);
    expect(basisPointsOf(0, 0)).toBe(0);
    expect(basisPointsOf(-5_000, 10_000)).toBe(-5_000);
  });

  it('computes VAT separately from revenue', () => {
    expect(vatOn(naira(500_000), 750)).toBe(naira(37_500));
    expect(vatOn(naira(500_000), 0)).toBe(0);
  });
});

describe('formatting', () => {
  it('shows kobo only when they are non-zero', () => {
    expect(formatKobo(naira(1_350_000))).toBe('₦1,350,000');
    expect(formatKobo(naira(1_350_000) + 25)).toBe('₦1,350,000.25');
    expect(formatKobo(naira(1_350_000), { kobo: 'always' })).toBe('₦1,350,000.00');
  });

  it('formats negatives and suppresses the symbol when asked', () => {
    expect(formatKobo(-naira(20_000))).toBe('-₦20,000');
    expect(formatKobo(naira(200_000), { symbol: false })).toBe('200,000');
  });

  it('formats basis points as percentages', () => {
    expect(formatBasisPoints(3_180)).toBe('31.8%');
    expect(formatBasisPoints(3_000)).toBe('30%');
    expect(formatBasisPoints(3_000, 2)).toBe('30%');
  });
});
