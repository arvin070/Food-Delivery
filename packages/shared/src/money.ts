/**
 * Money helpers.
 *
 * Money is stored in the database as `Decimal(10,2)` and crosses the wire as a
 * decimal **string** (e.g. `"149.50"`) so no precision is lost to JavaScript
 * floats. Arithmetic is done in integer minor units (paise).
 */
export const DEFAULT_CURRENCY = 'INR';

/** `"149.50"` → `14950` */
export function toMinorUnits(amount: string | number): number {
  const n = typeof amount === 'number' ? amount : Number.parseFloat(amount);
  if (!Number.isFinite(n)) throw new TypeError(`Not a valid amount: ${amount}`);
  return Math.round(n * 100);
}

/** `14950` → `"149.50"` */
export function fromMinorUnits(minor: number): string {
  return (Math.round(minor) / 100).toFixed(2);
}

export function formatCurrency(amount: string | number, currency = DEFAULT_CURRENCY): string {
  const n = typeof amount === 'number' ? amount : Number.parseFloat(amount);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}
