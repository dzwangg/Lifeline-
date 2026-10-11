// The full SimResult the panel and the narration pipeline use: the land-use sim, CH-LUTI and the household model, run in
// that order, with each metric taken from one model:
//   land-use sim (shared/sim.js)    tree cover, and the homes its zone rules build
//   CH-LUTI (shared/luti/)          homes: today's 23,581 plus its growth from permit trends, the zone rules' homes and the
//                                   lever cards' homes; median rent and commute; property tax revenue (our formula: homes ×
//                                   median home value × rate, with the tax card's change); jobs, businesses, storefront
//                                   vacancy, home value, town budget, bus ridership, car traffic
//                                   home price to income, income-restricted homes, car share, job access, commute CO2
//   household model (agents.js)     households, priced out (year-0 households who have left) and rent burden (after any
//                                   rental assistance, cash or job training), and the map's households,
//                                   whose rents and commutes follow CH-LUTI's for their zone
// All run at central assumptions; shared/luti/run.js adds CH-LUTI's ranges. Deltas compare the last year (10, or later in a
// game of turns) with the same models run with no new policy, so the town's growth isn't put down to the policy.
import { runScenario } from './sim.js';
import { averageRuns, homesByYear } from './agents.js';
import { createModel } from './luti/model.js';
import { cardPolicies } from './luti/levers.js';
import { ZONES as LUTI_ZONES, ZONE_IDS, TOWN } from './luti/data.js';
import { toLocal } from './geo.js';
import { noDrivers } from './luti/drivers.js';

/** @typedef {import('./types').PolicyCard} PolicyCard @typedef {import('./types').Zone} Zone @typedef {import('./types').SimResult} SimResult
 *  @typedef {import('./types').Assumptions} Assumptions @typedef {import('./types').Baselines} Baselines */

const round1 = v => Math.round(v * 10) / 10, round2 = v => Math.round(v * 100) / 100, round4 = v => Math.round(v * 1e4) / 1e4;
// Household zone -> the CH-LUTI zones it stands for. East (Blue Hill, Meadowmont) and south (Southern Village) commute over
// 15-501, like the edge and the corridor; north (the MLK corridor) doesn't, so it counts as in town.
const LUTI_OF = { downtown: ['downtown', 'north'], campus: ['campus'], edge: ['east', 'south'], corridor: ['east', 'south'] };
const AGENT_ZONE = { downtown: 'downtown', north: 'downtown', campus: 'campus', east: 'edge', south: 'edge' }; // where CH-LUTI's own homes go
// metrics whose change is also given in points, x this
const POINTS = { treeCoverPct: 1, storefrontVacancy: 100, trafficIndex: 100, rentBurden: 100, carShare: 100, jobAccess: 100 };

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
  const quarterly = f => Array.from({ length: 4 * raw.years }, (_, q) => f(Math.floor(q / 4), (q % 4 + 1) / 4));
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
 * runs; policies and landUse are CH-LUTI's inputs, for its Monte Carlo ranges (landUse is null when no zone changed);
 * luti is CH-LUTI's central run (api/resident-bank.js reads owners' tax rate and home value from it).
 * years: how long to run (a decade more per turn of a game); starts: card id -> the year it is enacted (default 0).
 * @param {PolicyCard[]} cards @param {Record<string, Record<string, number>>} params @param {Zone[]} zones
 * drivers: scenario what-ifs (shared/luti/drivers.js), applied to the run with and without policies alike.
 * @param {Assumptions} assumptions @param {Baselines} baselines @param {{ years?: number, starts?: Record<string, number>, drivers?: object }} [game]
 */
export function runModels(cards, params, zones, assumptions, baselines, { years = 10, starts = {}, drivers = null } = {}) {
  const raw = runScenario(cards, params, zones, assumptions, baselines, years, starts), landUse = landUseInputs(raw, zones, assumptions);
  const model = createModel(assumptions, baselines), policies = cardPolicies(cards, params, starts);
  const luti = model.simulate(model.midParams(), policies, { landUse, seedEvents: false, quarters: 4 * years, drivers });
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
    // with scenario drivers, incomes follow the scenario's inflation (CH-LUTI's index as each year ends, so year y has y full
    // years of growth, as the household model's own rate gives it); without, the household model's own rate
    ...(!noDrivers(drivers) && { incomeIndex: raw.timeline.map((_, y) => (y ? luti.series[4 * y - 1].incomeIndexEnd : 1)) }),
  };
  // help paid to households and job training act on households one by one, so the household model applies them
  const helpAt = y => {
    const L = y ? luti.series[4 * y - 1] : null;
    return { rentHouseholds: L?.rentHelpHouseholds ?? 0, rentMonthly: L?.rentHelpMonthly ?? 0, cashHouseholds: L?.cashHouseholds ?? 0, cashMonthly: L?.cashMonthly ?? 0, trainees: L?.trainees ?? 0,
      // finished income-restricted homes, for renters under 80% of the town's median household income (a stand-in for HUD's
      // area median income, which inclusionary rules use)
      affordable: L?.affordableHomes ?? 0, incomeLimit: 0.8 * TOWN.medianHouseholdIncome };
  };
  const ys = raw.timeline.map((_, y) => y);
  if (ys.some(y => { const h = helpAt(y); return h.rentHouseholds * h.rentMonthly > 0 || h.cashHouseholds * h.cashMonthly > 0 || h.trainees > 0 || h.affordable > 0; })) inputs.help = ys.map(helpAt);
  const averages = averageRuns(inputs, assumptions, baselines);
  const timeline = raw.timeline.map((t, y) => {
    const L = atYear(luti, y), h = averages[y];
    return {
      ...t,
      metrics: {
        housingUnits: Math.round(L.housingUnits), medianRent: Math.round(L.rent), treeCoverPct: t.metrics.treeCoverPct, avgCommuteMin: round1(L.commuteTime),
        taxRevenue: Math.round(L.propertyTax), households: h.households, pricedOut: h.pricedOut, rentBurden: h.rentBurden,
        jobs: Math.round(L.jobs), businesses: Math.round(L.businesses), storefrontVacancy: round4(L.storefrontVacancy), homeValue: Math.round(L.homeValue),
        netFiscal: Math.round(L.netFiscal), transitRidership: Math.round(L.transitRidership), trafficIndex: round4(L.trafficIndex),
        // indicators for the city-health framework (shared/indicators.js)
        priceToIncome: round2(L.homeValue / (TOWN.medianHouseholdIncome * L.incomeIndex)),
        affordableHomes: Math.round(L.affordableHomes), carShare: round4(L.carShare), jobAccess: round4(L.accessIndex), commuteCO2: Math.round(L.commuteCO2),
      },
    };
  });
  const changed = zones.some(z => raw.timeline.at(-1).zoneStates[z.id] !== z.state);
  return { result: { ...raw, timeline, ...(!noDrivers(drivers) && { drivers }) }, inputs, averages, policies, landUse: changed ? landUse : null, luti, drivers };
}

/**
 * The SimResult with each metric's change by the last year against `none`, the same models run with no new policy. Shares and indexes
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
export const runCombined = (cards, params, zones, assumptions, baselines, none, opts = {}) =>
  withDeltas(runModels(cards, params, zones, assumptions, baselines, opts).result, none ?? runModels([], {}, zones, assumptions, baselines, { years: opts.years, drivers: opts.drivers }).result);
