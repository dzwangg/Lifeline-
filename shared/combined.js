// The full SimResult the panel and the narration pipeline use: the land-use sim, CH-LUTI and the household model, run in
// that order, with each metric taken from one model:
//   land-use sim (shared/sim.js)    tree cover, and the homes its zone rules build
//   CH-LUTI (shared/luti/)          homes: today's 23,713 plus its growth from permit trends, the zone rules' homes and the
//                                   lever cards' homes; median rent and commute; property tax revenue (our formula: homes ×
//                                   median home value × rate, with the tax card's change); jobs, businesses, storefront
//                                   vacancy, home value, town budget, bus ridership, car traffic
//   household model (agents.js)     households and priced out (year-0 households who have left), and the map's households,
//                                   whose rents and commutes follow CH-LUTI's for their zone
// All run at central assumptions; shared/luti/run.js adds CH-LUTI's ranges. Deltas compare year 10 with the same models run
// with no new policy, so the town's growth isn't put down to the policy.
import { runScenario } from './sim.js';
import { averageRuns, homesByYear } from './agents.js';
import { createModel, QUARTERS } from './luti/model.js';
import { cardPolicies } from './luti/levers.js';
import { ZONES as LUTI_ZONES, ZONE_IDS } from './luti/data.js';
import { toLocal } from './geo.js';

/** @typedef {import('./types').PolicyCard} PolicyCard @typedef {import('./types').Zone} Zone @typedef {import('./types').SimResult} SimResult
 *  @typedef {import('./types').Assumptions} Assumptions @typedef {import('./types').Baselines} Baselines */

const round1 = v => Math.round(v * 10) / 10, round2 = v => Math.round(v * 100) / 100, round4 = v => Math.round(v * 1e4) / 1e4;
// Household zone -> the CH-LUTI zones it stands for. East (Blue Hill, Meadowmont) and south (Southern Village) commute over
// 15-501, like the edge and the corridor; north (the MLK corridor) doesn't, so it counts as in town.
const LUTI_OF = { downtown: ['downtown', 'north'], campus: ['campus'], edge: ['east', 'south'], corridor: ['east', 'south'] };
const AGENT_ZONE = { downtown: 'downtown', north: 'downtown', campus: 'campus', east: 'edge', south: 'edge' }; // where CH-LUTI's own homes go
const POINTS = { treeCoverPct: 1, storefrontVacancy: 100, trafficIndex: 100 }; // metrics whose change is also given in points, x this

/**
 * The CH-LUTI zone a parcel's homes feed. Map-edge and corridor parcels are on the 15-501 side, so east or south; the others
 * (the core) are in the zone around them: its zones are a Voronoi split around their rep points, so the nearest rep.
 * @param {Zone} zone
 */
export function lutiZone(zone) {
  const ring = zone.geometry.coordinates[0].slice(0, -1).map(toLocal);
  const [x, z] = ring.reduce(([a, b], [px, pz]) => [a + px / ring.length, b + pz / ring.length], [0, 0]);
  const dist = L => Math.hypot(x - L.rep[0], z - L.rep[1]);
  const options = zone.tags.includes('map_edge') ? LUTI_ZONES.filter(L => L.id === 'east' || L.id === 'south') : LUTI_ZONES;
  return options.reduce((best, L) => (dist(L) < dist(best) ? L : best)).id;
}

// The zone rules' homes by CH-LUTI zone for each year, then for each quarter, spread evenly over the year they are built in;
// tree cover likewise.
function landUseInputs(raw, zones, assumptions) {
  const upa = assumptions.unitsPerAcre.value, where = new Map(zones.map(z => [z.id, lutiZone(z)]));
  const byYear = raw.timeline.map(({ zoneStates }) => {
    const out = Object.fromEntries(ZONE_IDS.map(id => [id, 0]));
    for (const z of zones) if (zoneStates[z.id] !== z.state) out[where.get(z.id)] += (upa[zoneStates[z.id]] - upa[z.state]) * z.areaAcres;
    return out;
  });
  const quarterly = f => Array.from({ length: QUARTERS }, (_, q) => f(Math.floor(q / 4), (q % 4 + 1) / 4));
  const lerp = (a, b, f) => a + (b - a) * f, tree = y => raw.timeline[y].metrics.treeCoverPct;
  return {
    byYear,
    unitsAdded: quarterly((y, f) => Object.fromEntries(ZONE_IDS.map(id => [id, lerp(byYear[y][id], byYear[y + 1][id], f)]))),
    treeCoverPct: quarterly((y, f) => lerp(tree(y), tree(y + 1), f)),
  };
}

const atYear = (run, y) => (y ? run.series[4 * y - 1] : run.start); // year y ends with quarter 4y - 1
const zoneAt = (run, y, i) => (y ? run.zones[4 * y - 1][i] : run.start.zones[i]);
// A household zone's rent or commute in year y as a multiple of year 0's: its CH-LUTI zones, weighted by year-0 households.
const indexOf = (run, key, y, zone) => {
  const ids = LUTI_OF[zone].map(id => ZONE_IDS.indexOf(id)), w = i => run.start.zones[i].households;
  return ids.reduce((s, i) => s + w(i) * zoneAt(run, y, i)[key], 0) / ids.reduce((s, i) => s + w(i) * run.start.zones[i][key], 0);
};

/**
 * Runs the three models. result is the SimResult without deltas (see withDeltas); inputs feed the household model's
 * runs; policies and landUse are CH-LUTI's inputs, for its Monte Carlo ranges (landUse is null when no zone changed).
 * @param {PolicyCard[]} cards @param {Record<string, Record<string, number>>} params @param {Zone[]} zones
 * @param {Assumptions} assumptions @param {Baselines} baselines
 */
export function runModels(cards, params, zones, assumptions, baselines) {
  const raw = runScenario(cards, params, zones, assumptions, baselines), landUse = landUseInputs(raw, zones, assumptions);
  const model = createModel(assumptions, baselines), policies = cardPolicies(cards, params);
  const luti = model.simulate(model.midParams(), policies, { landUse, seedEvents: false });
  // The household model gets every new home: the zone rules' by parcel, CH-LUTI's other homes by its zone.
  const inputs = {
    homes: homesByYear(raw, zones, assumptions).map((rules, y) => {
      const out = { ...rules };
      LUTI_ZONES.forEach((z, i) => { out[AGENT_ZONE[z.id]] += zoneAt(luti, y, i).units - luti.start.zones[i].units - landUse.byYear[y][z.id]; });
      return out;
    }),
    households: raw.timeline.map((_, y) => atYear(luti, y).households - luti.start.households),
    ...Object.fromEntries(['rent', 'commute'].map(key => [key, raw.timeline.map((_, y) => Object.fromEntries(Object.keys(LUTI_OF).map(z => [z, indexOf(luti, key, y, z)])))])),
    traffic: raw.timeline.map((_, y) => atYear(luti, y).trafficIndex),
  };
  const averages = averageRuns(inputs, assumptions, baselines);
  const timeline = raw.timeline.map((t, y) => {
    const L = atYear(luti, y), h = averages[y];
    return {
      ...t,
      metrics: {
        housingUnits: Math.round(L.housingUnits), medianRent: Math.round(L.rent), treeCoverPct: t.metrics.treeCoverPct, avgCommuteMin: round1(L.commuteTime),
        taxRevenue: Math.round(L.propertyTax), households: h.households, pricedOut: h.pricedOut,
        jobs: Math.round(L.jobs), businesses: Math.round(L.businesses), storefrontVacancy: round4(L.storefrontVacancy), homeValue: Math.round(L.homeValue),
        netFiscal: Math.round(L.netFiscal), transitRidership: Math.round(L.transitRidership), trafficIndex: round4(L.trafficIndex),
      },
    };
  });
  const changed = zones.some(z => raw.timeline.at(-1).zoneStates[z.id] !== z.state);
  return { result: { ...raw, timeline }, inputs, averages, policies, landUse: changed ? landUse : null };
}

/**
 * The SimResult with each metric's year-10 change against `none`, the same models run with no new policy. Shares and indexes
 * (tree cover, storefront vacancy, car traffic) also get changePts, the change in percentage points, as the panel shows them.
 * @param {SimResult} result @param {SimResult} none
 */
export function withDeltas(result, none) {
  const last = result.timeline.at(-1).metrics, base = none.timeline.at(-1).metrics;
  return {
    ...result,
    deltas: Object.keys(last).map(metric => ({
      metric, baseline: base[metric], final: last[metric], comparedWith: 'no new policy',
      changePct: base[metric] ? round2((last[metric] - base[metric]) / base[metric] * 100) : 0,
      ...(metric in POINTS && { changePts: round2((last[metric] - base[metric]) * POINTS[metric]) }),
    })),
  };
}

/** The full SimResult for some cards. @returns {SimResult} */
export const runCombined = (cards, params, zones, assumptions, baselines, none = runModels([], {}, zones, assumptions, baselines).result) =>
  withDeltas(runModels(cards, params, zones, assumptions, baselines).result, none);
