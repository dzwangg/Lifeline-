// CH-LUTI scenario runner: paired Monte Carlo over the uncertain parameters, policy-vs-baseline comparison, per-policy
// contributions and the "why" trace. Pure: runs the same in the browser, a Worker, or Node.

import { createModel, CAUSES, QUARTERS, YEARS, MODEL, yearsOf } from './model.js';

export { MODEL, YEARS, QUARTERS, CAUSES };

// Metrics the dashboard shows, in order. No metric is marked good or bad: the page shows changes, not verdicts.
export const METRICS = [
  { id: 'rent', label: 'Median market rent', unit: '$/mo', fmt: 'usd' },
  { id: 'housingUnits', label: 'Homes', unit: 'homes', fmt: 'int' },
  { id: 'population', label: 'Population', unit: 'people', fmt: 'int' },
  { id: 'rentBurden', label: 'Renters cost-burdened', unit: '% paying ≥30% of income', fmt: 'pct' },
  { id: 'jobs', label: 'Jobs in Town', unit: 'jobs', fmt: 'int' },
  { id: 'businesses', label: 'Storefront businesses', unit: 'businesses', fmt: 'int' },
  { id: 'storefrontVacancy', label: 'Downtown storefront vacancy', unit: '% of spaces', fmt: 'pct' },
  { id: 'transitRidership', label: 'Bus ridership', unit: 'trips/yr', fmt: 'millions' },
  { id: 'commuteTime', label: 'Average commute', unit: 'minutes', fmt: 'min' },
  { id: 'trafficIndex', label: 'Car traffic', unit: 'vs today', fmt: 'index' },
  { id: 'homeValue', label: 'Median home value', unit: '$', fmt: 'usdk' },
  { id: 'netFiscal', label: 'Town budget impact', unit: '$/yr', fmt: 'usdm', diffOnly: true },
];

// Every variable the trace can name, with a label and format.
export const VARIABLES = {
  ...Object.fromEntries(METRICS.map(m => [m.id, m])),
  households: { label: 'Households', fmt: 'int' },
  landUseHomes: { label: 'Homes built by zone rules', fmt: 'int' },
  treeCoverPct: { label: 'Tree cover', unit: '%', fmt: 'dec' },
  desiredHouseholds: { label: 'Households wanting to live here', fmt: 'int' },
  vacancy: { label: 'Home vacancy', fmt: 'pct' },
  completions: { label: 'Homes completed', unit: 'per yr', fmt: 'int' },
  starts: { label: 'Construction starts', unit: 'homes/yr', fmt: 'int' },
  devMargin: { label: 'Developer profit margin', fmt: 'pct' },
  buildCapacity: { label: 'Buildable capacity', unit: 'homes/yr', fmt: 'int' },
  costPerHome: { label: 'Cost to build a home', fmt: 'usdk' },
  subsidyPerHome: { label: 'Subsidy per home started', fmt: 'usdk' },
  taxRate: { label: 'Property tax rate', unit: '¢ per $100', fmt: 'cents' },
  accessIndex: { label: 'Access to jobs', fmt: 'index' },
  storefrontJobs: { label: 'Storefront jobs', fmt: 'int' },
  hiredJobs: { label: 'Jobs created by hiring subsidy', fmt: 'int' },
  openings: { label: 'Business openings', unit: 'per yr', fmt: 'int' },
  closures: { label: 'Business closures', unit: 'per yr', fmt: 'int' },
  startupOpenings: { label: 'Openings due to start-up grants', unit: 'per yr', fmt: 'dec' },
  vacancyTaxOpenings: { label: 'Openings due to vacancy tax', unit: 'per yr', fmt: 'dec' },
  grantSaves: { label: 'Closures averted by grants', unit: 'per yr', fmt: 'dec' },
  spendingIndex: { label: 'Local spending', fmt: 'index' },
  storefrontSpaces: { label: 'Storefront spaces', fmt: 'int' },
  busShare: { label: 'Residents commuting by bus', fmt: 'pct' },
  carShare: { label: 'Residents commuting by car', fmt: 'pct' },
  busWait: { label: 'Average wait for a bus', unit: 'min', fmt: 'min' },
  carSpeed: { label: 'Peak car speed', unit: 'km/h', fmt: 'dec' },
  bikeStress: { label: 'Cycling stress penalty', unit: 'min', fmt: 'min' },
  serviceLevel: { label: 'Bus service', fmt: 'index' },
  townRevenue: { label: 'Town tax revenue', unit: '$/yr', fmt: 'usdm' },
  propertyTax: { label: 'Property tax revenue', unit: '$/yr', fmt: 'usdm' },
  salesTax: { label: 'Sales tax revenue', unit: '$/yr', fmt: 'usdm' },
  vacancyTaxRevenue: { label: 'Vacancy tax revenue', unit: '$/yr', fmt: 'usdm' },
  assessedValue: { label: 'Taxable property value', fmt: 'usdb' },
  programCost: { label: 'Policy programme costs', unit: '$/yr', fmt: 'usdm' },
  serviceCost: { label: 'Cost of serving added residents', unit: '$/yr', fmt: 'usdm' },
};

// mulberry32, the same family of seeded generator the household model uses
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function triangular(u, a, m, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b), c = (m - lo) / (hi - lo || 1);
  return u < c ? lo + Math.sqrt(u * (hi - lo) * (m - lo)) : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - m));
}
export function sampleParams(ranges, rand) {
  return Object.fromEntries(Object.entries(ranges).map(([k, p]) => [k, triangular(rand(), p.lo, p.mid, p.hi)]));
}
const quantile = (sorted, f) => { const i = (sorted.length - 1) * f, lo = Math.floor(i); return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo); };
function band(runs, key) { // runs: array of series → { p10, p50, p90 } arrays per quarter
  const out = { p10: [], p50: [], p90: [] };
  for (let q = 0; q < runs[0].length; q++) {
    const v = runs.map(r => r[q][key]).sort((a, b) => a - b);
    out.p10.push(quantile(v, .1)); out.p50.push(quantile(v, .5)); out.p90.push(quantile(v, .9));
  }
  return out;
}

/**
 * Runs a policy package against the no-policy baseline. Each draw of the parameters is used for both runs (paired), so the
 * difference isolates the policy rather than parameter noise. landUse: the land-use sim's homes, in the policy runs only.
 * quarters: how long each run is (a decade more per turn of a game).
 * @param {ReturnType<typeof import('./levers.js').cardPolicies>} policies
 * @param {import('../types').Assumptions} assumptions @param {import('../types').Baselines} baselines
 */
export function runScenario(policies, assumptions, baselines, { runs = 200, seed = 2026, landUse = null, quarters = QUARTERS } = {}) {
  const { simulate, ranges, midParams } = createModel(assumptions, baselines);
  const rand = rng(seed);
  const base = [], pol = [], diff = [];
  for (let r = 0; r < runs; r++) {
    const params = sampleParams(ranges, rand);
    const b = simulate(params, [], { seedEvents: false, quarters }).series;
    const p = policies.length || landUse ? simulate(params, policies, { seedEvents: false, landUse, quarters }).series : b;
    base.push(b); pol.push(p);
    diff.push(p.map((row, q) => Object.fromEntries(Object.keys(VARIABLES).map(k => [k, row[k] - b[q][k]]))));
  }
  const keys = Object.keys(VARIABLES);
  const mid = midParams();
  const midBase = simulate(mid, [], { quarters }), midPolicy = policies.length || landUse ? simulate(mid, policies, { landUse, quarters }) : midBase;
  // each card on its own, at central parameters, to show who did what
  const perPolicy = policies.length > 1 ? policies.map(p => {
    const s = simulate(mid, [p], { seedEvents: false, quarters }).series;
    return { id: p.id, title: p.title, diff: s.map((row, q) => Object.fromEntries(keys.map(k => [k, row[k] - midBase.series[q][k]]))) };
  }) : policies.map(p => ({ id: p.id, title: p.title, diff: midPolicy.series.map((row, q) => Object.fromEntries(keys.map(k => [k, row[k] - midBase.series[q][k]]))) }));
  return {
    model: MODEL, runs, seed, years: yearsOf(quarters), policies: policies.map(p => p.id),
    baseline: Object.fromEntries(keys.map(k => [k, band(base, k)])),
    policy: Object.fromEntries(keys.map(k => [k, band(pol, k)])),
    diff: Object.fromEntries(keys.map(k => [k, band(diff, k)])),
    mid: { baseline: midBase, policy: midPolicy, params: mid },
    perPolicy,
  };
}

// The causal chain behind a metric's change at quarter q, from the central run: a tree of { id, delta, children }.
// Branches whose change is negligible are pruned, so what is left is the path the effect actually travelled.
export function explain(result, metric, q, depth = 4) {
  const b = result.mid.baseline.series[q], p = result.mid.policy.series[q];
  const seen = new Set();
  const rel = k => { const d = p[k] - b[k]; return Math.abs(b[k]) > 1e-9 ? d / Math.abs(b[k]) : d; };
  function node(k, level) {
    seen.add(k);
    const kids = [];
    if (level < depth) for (const c of CAUSES[k] ?? []) if (!seen.has(c) && Math.abs(rel(c)) > 2e-3) kids.push(node(c, level + 1)); // each variable appears once
    return { id: k, base: b[k], policy: p[k], delta: p[k] - b[k], rel: rel(k), children: kids };
  }
  return node(metric, 0);
}
