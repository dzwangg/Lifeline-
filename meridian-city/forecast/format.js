// Number formatting for the forecast panels. Percent metrics change in percentage points (30% -> 28% is -2.0 pp).
const MINUS = '−';

export function num(v, digits = 0) {
  if (v == null || Number.isNaN(v)) return '—';
  return Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function money(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return `$${num(a / 1e9, 2)}B`;
  if (a >= 1e6) return `$${num(a / 1e6, a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e4) return `$${num(a / 1e3, 0)}k`;
  return `$${num(a, 0)}`;
}

const countDigits = v => (Math.abs(v) < 10 && v !== Math.round(v) ? 1 : 0);

/** A level in the metric's unit. */
export function level(v, m) {
  if (v == null) return 'unavailable';
  const s = v < 0 ? MINUS : '';
  if (m.kind === 'currency') return s + money(v);
  if (m.kind === 'percent') return `${s}${num(v, 1)}%`;
  return s + num(v, countDigits(v));
}

/** A signed change: percent metrics in percentage points. */
export function change(v, m) {
  if (v == null) return 'unavailable';
  if (Math.abs(v) < 1e-9) return '0';
  const s = v > 0 ? '+' : MINUS;
  if (m.kind === 'currency') return s + money(v);
  if (m.kind === 'percent') return `${s}${num(v, 1)} pp`;
  return s + num(v, countDigits(v));
}

export const interval = (lo, hi, m, fn = change) => `${fn(lo, m)} to ${fn(hi, m)}`;

export const EVIDENCE = {
  persistence: 'Observed 2023 carried forward',
  observed_anchor: 'Observed anchor',
  arithmetic: 'Accounting arithmetic',
  assumption: 'Assumption-based',
  illustrative: 'Illustrative placeholder',
  unavailable: 'Unavailable',
};
