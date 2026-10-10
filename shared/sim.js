// The Meridian simulator: pure and deterministic, no DOM and no rendering. Rules are documented in docs/policy-card-spec.md.
import { matchesWhere } from './schema.js';

/** @typedef {import('./types').PolicyCard} PolicyCard @typedef {import('./types').Zone} Zone @typedef {import('./types').SimResult} SimResult
 *  @typedef {import('./types').Assumptions} Assumptions @typedef {import('./types').Baselines} Baselines */

const MAX_CHANGE = .5; // stacked cards are clamped to +-50% of baseline rent and commute
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = v => Math.round(v * 100) / 100;
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const unique = list => [...new Set(list)];

/**
 * @param {PolicyCard[]} cards active cards
 * @param {Record<string, Record<string, number>>} params card id -> param key -> value; missing values use the card's default
 * @param {Zone[]} zones @param {Assumptions} assumptions @param {Baselines} baselines
 * @returns {SimResult}
 */
export function runScenario(cards, params, zones, assumptions, baselines, years = 10) {
  const A = Object.fromEntries(Object.entries(assumptions).map(([k, v]) => [k, v.value]));
  const B = Object.fromEntries(Object.entries(baselines).map(([k, v]) => [k, v.value]));
  const canopy = s => (s === 'forest' ? 1 : A.canopyMinPct[s]);
  cards = [...cards].sort(byId);
  const order = [...zones].sort((a, b) => a.edgeDistM - b.edgeDistM || byId(a, b)); // closest to the map edge converts first
  const state = Object.fromEntries(zones.map(z => [z.id, z.state]));
  const policies = cards.map(c => ({
    id: c.id, title: c.title,
    params: Object.fromEntries(c.params.map(p => [p.key, clamp(params?.[c.id]?.[p.key] ?? p.default, p.min, p.max)])),
  }));
  // Running totals per card, so each card's percentage effects can be summed and clamped.
  const fx = cards.map(() => ({ units: 0, edgeUnits: 0, canopyAcres: 0, acres: {}, done: [] }));

  const timeline = [];
  for (let year = 0; year <= years; year++) {
    if (year) cards.forEach((card, ci) => card.zoneRules.forEach((rule, ri) => {
      const f = fx[ci], pool = order.filter(z => matchesWhere(rule.where, z));
      const cap = rule.capParam ? policies[ci].params[rule.capParam] : Infinity;
      let quota = Math.round(rule.ratePerYear * year * pool.length) - (f.done[ri] ?? 0);
      for (const z of pool) {
        if (quota <= 0) break;
        const used = f.acres[rule.capParam] ?? 0;
        if (state[z.id] !== rule.from || used + z.areaAcres > cap) continue;
        state[z.id] = rule.to;
        f.acres[rule.capParam] = used + z.areaAcres;
        f.done[ri] = (f.done[ri] ?? 0) + 1;
        quota--;
        const units = (A.unitsPerAcre[rule.to] - A.unitsPerAcre[rule.from]) * z.areaAcres;
        f.units += units;
        if (units > 0 && z.tags.includes('map_edge')) f.edgeUnits += units;
        f.canopyAcres += (canopy(rule.to) - canopy(rule.from)) * z.areaAcres;
      }
    }));
    timeline.push({ year, zoneStates: { ...state }, metrics: metrics(fx, A, B) });
  }

  const first = timeline[0].metrics, last = timeline[years].metrics;
  return {
    scenarioId: policies.map(p => p.id + Object.entries(p.params).map(([k, v]) => `:${k}=${v}`).join('')).join('+') || 'baseline',
    policies,
    years,
    timeline,
    deltas: Object.keys(first).map(metric => ({
      metric, baseline: first[metric], final: last[metric],
      changePct: first[metric] ? round2((last[metric] - first[metric]) / first[metric] * 100) : 0,
    })),
    tradeoffs: { pros: unique(cards.flatMap(c => c.tradeoffs.pros)), cons: unique(cards.flatMap(c => c.tradeoffs.cons)) },
    assumptions: [...flatten(baselines), ...flatten(assumptions)],
  };
}

function metrics(fx, A, B) {
  const sum = f => fx.reduce((s, e) => s + f(e), 0);
  const units = B.housingUnits + sum(e => e.units);
  const rentPct = clamp(sum(e => A.rentSupplyElasticity * e.units / B.housingUnits * 100), -MAX_CHANGE * 100, MAX_CHANGE * 100);
  // Each new home at the map edge adds the penalty to its own commute, so the town mean moves by those homes' share of all homes.
  const commute = clamp(sum(e => A.commuteDistancePenalty * e.edgeUnits / units), -MAX_CHANGE * B.meanCommuteMin, MAX_CHANGE * B.meanCommuteMin);
  return {
    housingUnits: Math.round(units),
    medianRent: round2(B.medianGrossRent * (1 + rentPct / 100)),
    treeCoverPct: round2(clamp(B.treeCoverPct + sum(e => e.canopyAcres) / B.mapAreaAcres * 100, 0, 100)),
    avgCommuteMin: round2(B.meanCommuteMin + commute),
    taxRevenue: Math.round(units * B.medianHomeValue * A.propertyTaxRate),
  };
}

// {unitsPerAcre: {value: {low_res: 4}, source}} -> [{key: 'unitsPerAcre.low_res', value: 4, source}], alternates included.
const flatten = entries => Object.entries(entries).flatMap(([key, { value, source, alternate }]) => [
  ...(typeof value === 'object' && value ? Object.entries(value).map(([k, v]) => ({ key: `${key}.${k}`, value: v, source })) : [{ key, value, source }]),
  ...(alternate ? [{ key: `${key}.alternate`, value: alternate.value, source: alternate.source }] : []),
]).filter(a => typeof a.value === 'number');
