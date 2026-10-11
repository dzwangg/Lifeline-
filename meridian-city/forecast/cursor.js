// Pure helpers shared by the forecast panels: which annual state the shared sim clock points at, and how to
// recognise stale job responses. No DOM, so node --test covers them (tests/forecast.test.js).

export const ORIGIN_YEAR = 2026; // clock step 0 = the 2026 nowcast origin; step k = calendar year 2026 + k

/**
 * The annual state the display cursor selects. Play only moves this cursor: it never re-runs a forecast.
 * @param {object|null} result forecast payload (years: [2027, ...])
 * @param {{ years: number, step: number, before?: boolean }} clock state from sim/clock.js
 * @returns {{ year: number, index: number, status: string, beyond: boolean, frac: number }}
 *   index -1 means the origin (2026 nowcast); status is observed | nowcast | projected.
 */
export function selectYear(result, clock) {
  const step = Math.max(0, Math.floor(clock?.step ?? 0));
  const year = ORIGIN_YEAR + step;
  const frac = Math.max(0, Math.min(1, (clock?.years ?? step) - step));
  if (!result || clock?.before || step === 0) return { year: ORIGIN_YEAR, index: -1, status: 'nowcast', beyond: false, frac };
  const last = result.years.length - 1;
  const index = Math.min(result.years.indexOf(year) === -1 ? last : result.years.indexOf(year), last);
  return { year: result.years[index], index, status: 'projected', beyond: year > result.years[last], frac };
}

/** Status label for any calendar year of a result's timeline. */
export function yearStatus(result, year) {
  const t = result?.time_status;
  if (!t) return 'projected';
  if (year <= t.last_observed) return 'observed';
  if (t.nowcast.includes(year)) return 'nowcast';
  return 'projected';
}

/** Stable key of a scenario object (key order independent), used to mark results stale after edits. */
export function scenarioKey(scenario) {
  const norm = v => Array.isArray(v) ? v.map(norm)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, norm(v[k])])) : v;
  return JSON.stringify(norm(scenario));
}

/**
 * Wraps an async job runner so only the newest request may deliver a result. An older response that arrives
 * late is dropped (resolves to { stale: true }), so it can never overwrite a newer scenario's numbers.
 */
export function latestOnly(run) {
  let ticket = 0;
  return async (...args) => {
    const mine = ++ticket;
    const value = await run(...args);
    return mine === ticket ? { stale: false, value } : { stale: true };
  };
}

/** Linear interpolation between two annual values, for visual tweening only (not a monthly prediction). */
export const tween = (a, b, f) => (a == null || b == null ? b ?? a : a + (b - a) * f);
