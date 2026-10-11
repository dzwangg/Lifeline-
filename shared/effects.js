// What each policy looks like on the street, year by year. Every lever a card can pull (shared/luti/levers.js LEVERS) and
// every protect rule feeds one or more effect kinds, so every card, catalogued or drafted, shows on the map. A kind's
// intensity i (0 to 1, or -1 to 1 for a signed kind) is read where the year ends (quarter 4y - 1):
//   'lever'     what the town builds or charges, from the cards' lever schedule (painted bike lanes, meters, a civic project);
//   'measured'  what people and businesses do, as CH-LUTI's central run with the policies against the same run without
//               them (shops reopening, homes selling, cyclists); for flows,
//               the change summed so far, so a decade of extra building shows as more and more sites.
// n = round(|i| x max) is how many of the kind's items stand on the map. Year 0 has none. Pure: no DOM; the sim worker
// (meridian-city/sim/sim-worker.js) computes it with each forecast and the map's effects layer draws it.
import { LEVERS, buildSchedule, cardPolicies } from './luti/levers.js';
import { ZONE_IDS } from './luti/data.js';

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const at = (luti, q) => luti?.series?.[q] ?? null;
const maxOver = v => (typeof v === 'object' ? Math.max(...Object.values(v)) : v);
const gap = (f, rel = false) => ({ P, B }) => (P && B ? (rel ? (P[f] - B[f]) / Math.max(Math.abs(B[f]), 1e-9) : P[f] - B[f]) : 0);
// the change summed over every quarter so far: what has piled up (homes started, shops opened) by the year's end
const sumSoFar = (f) => ({ luti, base, q }) => { let s = 0; for (let k = 0; k <= q; k++) s += (at(luti, k)?.[f] ?? 0) - (at(base, k)?.[f] ?? 0); return s; };

/**
 * The effect kinds. levers: what feeds a kind (and names its cards in the map's tooltips). value(ctx) is the raw amount,
 * scale the amount that shows every item (i = value / scale), max how many items that is, signed whether a negative
 * amount shows the opposite look. label names an item; neg labels the opposite look.
 */
export const EFFECTS = [
  { kind: 'bikeLanes', label: 'Protected bike lane', levers: ['transport.protectedBikeKm'], source: 'lever',
    value: ({ L }) => L['transport.protectedBikeKm'], scale: 18, max: 1 }, // max 1: the painted share of the map's bike routes
  { kind: 'cyclists', label: 'Cyclist', levers: ['transport.protectedBikeKm'], source: 'measured', value: gap('bikeShare'), scale: .006, max: 60 },
  { kind: 'bikeRacks', label: 'Bike rack', levers: ['transport.protectedBikeKm'], source: 'measured', value: gap('bikeShare'), scale: .006, max: 24 },
  { kind: 'busStops', label: 'New bus stop', neg: 'Bus service cut', levers: ['transit.serviceMultiplier'], source: 'measured',
    value: gap('serviceLevel', true), scale: .4, max: 14, signed: true },
  { kind: 'buses', label: 'Bus at a stop', levers: ['transit.serviceMultiplier'], source: 'measured', value: gap('serviceLevel', true), scale: .4, max: 1 },
  { kind: 'busLanes', label: 'Bus lane', levers: ['transit.busSpeedMultiplier'], source: 'lever', value: ({ L }) => L['transit.busSpeedMultiplier'] - 1, scale: .5, max: 1 },
  { kind: 'parking', label: 'Parking meter', neg: 'Free parking', levers: ['transport.parkingPriceDelta'], source: 'lever',
    value: ({ L }) => L['transport.parkingPriceDelta'], scale: 15, max: 30, signed: true },
  { kind: 'parkingLots', label: 'Parking lot for new homes', levers: ['housing.parkingMinimum'], source: 'lever',
    value: ({ L }) => maxOver(L['housing.parkingMinimum']), scale: 2, max: 12 },
  { kind: 'construction', label: 'Construction site', neg: 'Permit pending', levers: ['housing.subsidyPerUnit', 'housing.subsidyCap', 'housing.impactFee', 'housing.approvalMonths', 'housing.farMultiplier', 'housing.parkingMinimum'],
    source: 'measured', value: sumSoFar('starts'), scale: 1200, max: 14, signed: true },
  { kind: 'fastTrack', label: 'Fast-track permit', levers: ['housing.approvalMonths'], source: 'lever', value: ({ L }) => -L['housing.approvalMonths'], scale: 6, max: 6 },
  { kind: 'upzone', label: 'Taller buildings allowed', levers: ['housing.farMultiplier'], source: 'lever', value: ({ L }) => maxOver(L['housing.farMultiplier']) - 1, scale: 1, max: 10 },
  { kind: 'affordable', label: 'Affordable homes', levers: ['housing.inclusionaryPct'], source: 'measured', value: gap('affordableHomes'), scale: 400, max: 20 },
  { kind: 'civicWorks', label: 'Town project under way', levers: ['budget.annualCost', 'budget.oneTimeCost', 'housing.planningCost'], source: 'lever',
    value: ({ L, recentOnce }) => L['budget.annualCost'] + recentOnce, scale: 1, max: 1 }, // any spending shows the crane
  { kind: 'civicDone', label: 'Town project finished', levers: ['budget.oneTimeCost', 'housing.planningCost'], source: 'lever',
    value: ({ L, pastOnce, recentOnce }) => (pastOnce > 0 && !recentOnce && !L['budget.annualCost'] ? 1 : 0), scale: 1, max: 1 },
  { kind: 'hiring', label: 'Now hiring', levers: ['employment.hiringSubsidy'], source: 'measured', value: gap('hiredJobs'), scale: 190, max: 20 },
  { kind: 'shops', label: 'Shop reopened', neg: 'Storefront for lease', levers: ['business.supportGrants', 'business.startupGrants', 'tax.storefrontVacancyTax', 'tax.rateDelta'],
    source: 'measured', value: c => -gap('storefrontVacancy')(c), scale: .045, max: 20, signed: true },
  { kind: 'grandOpening', label: 'Grand opening', levers: ['business.startupGrants', 'tax.storefrontVacancyTax'], source: 'measured',
    value: c => sumSoFar('startupOpenings')(c) + sumSoFar('vacancyTaxOpenings')(c), scale: 220, max: 12 },
  { kind: 'homeSales', label: 'Home sold', neg: 'Home for sale', levers: ['tax.rateDelta'], source: 'measured', value: gap('homeValue', true), scale: .05, max: 20, signed: true },
  { kind: 'aid', label: 'Community aid office', levers: ['assistance.rentHouseholds', 'assistance.rentMonthly', 'assistance.cashHouseholds', 'assistance.cashMonthly'], source: 'lever',
    value: ({ L }) => (L['assistance.rentPaid'] > 0 ? L['assistance.rentHouseholds'] : 0) + (L['assistance.cashPaid'] > 0 ? L['assistance.cashHouseholds'] : 0), scale: 600, max: 12 },
  { kind: 'training', label: 'Job training centre', levers: ['workforce.trainees'], source: 'lever', value: ({ L }) => L['workforce.trainees'], scale: 250, max: 10 },
  { kind: 'protect', label: 'Protected forest', levers: [], rules: 'protect', source: 'lever', value: ({ protect }) => protect, scale: 1, max: 40 },
];
export const KINDS = Object.fromEntries(EFFECTS.map(e => [e.kind, e]));

/**
 * Each effect kind, every year of the forecast: [{ [kind]: { i, n } }], index y. luti and baseLuti are CH-LUTI's central
 * runs with and without the cards (shared/combined.js runModels' luti), on the same years and drivers.
 * @param {{ cards: object[], params?: object, starts?: object, luti: object, baseLuti: object, years: number }} o
 */
export function effectSeries({ cards, params = {}, starts = {}, luti, baseLuti, years }) {
  // A kind shows only for the cards that pull its levers: CH-LUTI's knock-on changes (a bus boost nudging home values) stay
  // in the numbers, so the map credits each thing on the street to a card that caused it (attribution()).
  const caused = attribution(cards, starts);
  const schedule = buildSchedule(cardPolicies(cards, params, starts), ZONE_IDS);
  // one-time spending (a planning study, a building project), summed over the quarters so far
  const spent = [];
  for (let q = 0; q < 4 * years; q++) { const L = schedule(q); spent.push((spent[q - 1] ?? 0) + L['budget.oneTimeCost'] + L['housing.planningCost']); }
  const protectFrom = Math.min(Infinity, ...cards.filter(c => c.zoneRules?.some(r => r.protect)).map(c => starts[c.id] ?? 0));
  const out = [];
  for (let y = 0; y <= years; y++) {
    const row = {};
    if (y === 0) { for (const e of EFFECTS) row[e.kind] = { i: 0, n: 0 }; out.push(row); continue; }
    const q = 4 * y - 1, L = schedule(q);
    const recentOnce = spent[q] - (spent[q - 8] ?? 0); // a one-time project is under way for two years, then finished
    const ctx = { L, P: at(luti, q), B: at(baseLuti, q), luti, base: baseLuti, q, recentOnce, pastOnce: spent[q], protect: y > protectFrom ? 1 : 0 };
    for (const e of EFFECTS) {
      const v = caused[e.kind] ? e.value(ctx) || 0 : 0, i = clamp(v / e.scale, e.signed ? -1 : 0, 1);
      row[e.kind] = { i: Math.round(i * 1e4) / 1e4, n: Math.round(Math.abs(i) * e.max) };
    }
    out.push(row);
  }
  return out;
}

/** Each effect kind's cards: those whose levers (or protect rules) feed it, with the year each is enacted. */
export function attribution(cards, starts = {}) {
  const out = {};
  for (const e of EFFECTS) {
    const by = cards.filter(c => (e.rules === 'protect' ? c.zoneRules?.some(r => r.protect) : c.levers?.some(l => e.levers.includes(l.lever))));
    if (by.length) out[e.kind] = by.map(c => ({ id: c.id, title: c.title, start: starts[c.id] ?? 0 }));
  }
  return out;
}

/** A stable 0-1 hash of a place, for ranking candidate spots (the same mixer as world/palette.js hash). */
export function rank(x, z, seed = 0) {
  let h = Math.imul(Math.round(x * 10) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(Math.round(z * 10) + seed * 7919, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/** Candidates in their showing order: by rank, so the first n are the same spots in every year and forecast. */
export const order = (candidates, seed = 0) => candidates.map(c => ({ ...c, rank: rank(c.x, c.z, seed) })).sort((a, b) => a.rank - b.rank);

// Every lever feeds some kind (tests/effects.test.js checks this stays true as levers are added).
export const leversShown = () => new Set(EFFECTS.flatMap(e => e.levers));
export const leversMissing = () => Object.keys(LEVERS).filter(l => !leversShown().has(l));
