// Scenario drivers: what-ifs about the world around Chapel Hill rather than town policies. They apply to the no-policy run
// and the policy run alike, so a policy is still compared with doing nothing under the same conditions. Each has hard
// bounds; anything outside them is clamped (see clampDrivers), never extrapolated.
//
// Inflation is one rate that every nominal series in CH-LUTI follows: market rents, home values, household incomes,
// construction and land costs, and the Town's sales tax, service and transit costs. The model's own growth rates already
// carry the default rate (data/assumptions.json lutiCpi); a scenario's rate shifts each of them by its difference from it,
// one for one. Policy dollar amounts (grants, subsidies, fees) stay as written, so inflation erodes their real value.

import { BASE_YEAR } from './data.js';

export const FED_SEP_2026_09 = {
  label: "the Fed's September 2026 projection",
  // FOMC Summary of Economic Projections, 16 Sep 2026, Table 1, median PCE inflation: 2026, 2027, 2028, 2029, longer run
  path: [3.7, 2.3, 2.1, 2.0, 2.0], firstYear: 2026,
  source: 'Federal Reserve, FOMC Summary of Economic Projections, September 16, 2026, Table 1 (median PCE inflation)',
  url: 'https://www.federalreserve.gov/monetarypolicy/fomcprojtabl20260916.htm',
};

export const DRIVERS = {
  inflation: {
    label: 'Inflation', unit: '%/yr', min: -2, max: 15,
    note: 'One yearly rate, or "fed" for the Fed\'s projection year by year. Recent: CPI-U +3.4% over the 12 months to August 2026 (BLS).',
  },
  uncJobsGrowth: {
    label: 'UNC, hospital and office job growth', unit: '%/yr', min: -5, max: 6,
    note: 'Replaces the model\'s uncertain trend (0.3–1.3%/yr; LEHD LODES +1.3%/yr 2002–2023).',
  },
  regionalGrowth: {
    label: 'Households looking to live in the area', unit: '%/yr', min: -3, max: 6,
    note: 'Replaces the model\'s uncertain trend (Chapel Hill households +0.73%/yr 2010–2020, Census).',
  },
  constructionCost: {
    label: 'Construction costs, change from today', unit: '%', min: -30, max: 60,
    note: 'A one-off shift in building costs, for example from tariffs or a labour shortage.',
  },
};

/** The drivers with every value inside its bounds, plus the changes made. Unknown keys are dropped. */
export function clampDrivers(drivers) {
  const out = {}, notes = [];
  for (const [k, v] of Object.entries(drivers ?? {})) {
    const def = DRIVERS[k];
    if (!def || v == null) continue;
    if (k === 'inflation' && v === 'fed') { out[k] = 'fed'; continue; }
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const c = Math.min(def.max, Math.max(def.min, v));
    if (c !== v) notes.push(`${def.label} was capped at ${c}${def.unit}: the simulator only covers ${def.min} to ${def.max}${def.unit}.`);
    out[k] = c;
  }
  return { drivers: out, notes };
}

/** True when no driver changes anything, so runs can skip the driver arithmetic entirely and match the defaults exactly. */
export const noDrivers = drivers => !drivers || !Object.keys(drivers).some(k => DRIVERS[k] && drivers[k] != null);

/** The yearly inflation rate (a fraction) in sim year y (0 = CH-LUTI's first, BASE_YEAR), for a scenario whose default is
 *  `base`. The Fed's path is by calendar year, from 2026: the sim's first year, 2027, takes the 2027 projection. */
export function inflationAt(drivers, base, y) {
  const v = drivers?.inflation;
  if (v === 'fed') {
    const { path, firstYear } = FED_SEP_2026_09, i = Math.max(0, Math.min(BASE_YEAR + y - firstYear, path.length - 1));
    return path[i] / 100;
  }
  return typeof v === 'number' ? v / 100 : base;
}

/** Cumulative price level at the end of each sim year 0..years (1 at year 0): divide dollars by it for today's dollars. */
export function priceIndex(drivers, base, years = 10) {
  const out = [1];
  for (let y = 0; y < years; y++) out.push(out[y] * (1 + inflationAt(drivers, base, y)));
  return out;
}

/** Plain words for the active drivers, for the dashboard and the narration. */
export function describeDrivers(drivers) {
  return Object.entries(drivers ?? {}).filter(([k, v]) => DRIVERS[k] && v != null).map(([k, v]) =>
    k === 'inflation' && v === 'fed' ? `Inflation: ${FED_SEP_2026_09.label}` : `${DRIVERS[k].label}: ${v > 0 && k !== 'inflation' ? '+' : ''}${v}${DRIVERS[k].unit}`);
}
