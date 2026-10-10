// CH-LUTI checks, ported from Kevin's meridian-city/sim/test.mjs: calibration to the base year, determinism, policy directions,
// and whether the behaviour that emerges from the submodels lands inside published ranges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel, QUARTERS } from '../shared/luti/model.js';
import { runScenario, explain } from '../shared/luti/run.js';
import { cardPolicies } from '../shared/luti/levers.js';
import { TOWN } from '../shared/luti/data.js';
import { cards, assumptions, baselines } from './data.js';

const model = createModel(assumptions, baselines), p = model.midParams();
const base = model.simulate(p, []), B = base.series;
const policies = cardPolicies(cards), card = id => policies.find(x => x.id === id);
const at = (run, k, q = QUARTERS - 1) => run.series[q][k];
const rel = (run, k, q = QUARTERS - 1) => (at(run, k, q) - B[q][k]) / Math.abs(B[q][k]);
const near = (got, want, tol, what) => assert.ok(Math.abs(got / want - 1) < tol, `${what}: ${got} vs ${want}`);

test('year 0 is the data: homes, population, rent, commute and property tax from data/baselines.json', () => {
  const S = base.start, A = Object.fromEntries(Object.entries(assumptions).map(([k, v]) => [k, v.value]));
  assert.equal(S.housingUnits, baselines.housingUnits.value);
  assert.equal(S.population, baselines.population.value);
  assert.ok(Math.abs(S.rent - baselines.medianGrossRent.value) < 1e-9, `rent ${S.rent}`);
  assert.equal(S.commuteTime, baselines.meanCommuteMin.value);
  assert.ok(Math.abs(B[0].commuteTime - baselines.meanCommuteMin.value) < 1e-9, 'the first quarter\'s commute is calibrated, not just reported');
  assert.equal(S.propertyTax, baselines.housingUnits.value * baselines.medianHomeValue.value * A.propertyTaxRate);
});

test('the no-policy run reproduces the base year', () => {
  near(B[0].population, baselines.population.value, .005, 'population (data/baselines.json)');
  near(B[0].households, TOWN.households, .005, 'households (ACS)');
  near(B[0].jobs, TOWN.jobs, .005, 'jobs (LODES)');
  const permits = Object.values(TOWN.permitsPerYear);
  near(B[0].starts, permits.reduce((a, b) => a + b) / permits.length, .1, 'starts vs. 2015-25 permits');
  near(B[0].rent, baselines.medianGrossRent.value, .02, 'rent vs. the ACS median gross rent in data/baselines.json');
  assert.ok(Math.abs(B[0].rentBurden - TOWN.rentBurdened) < .01, `rent burden ${B[0].rentBurden} vs ${TOWN.rentBurdened}`);
  near(B[0].propertyTax, B[0].housingUnits * baselines.medianHomeValue.value * assumptions.propertyTaxRate.value, 1e-12, 'property tax = homes × median home value × 50¢');
  near(B[0].transitRidership, TOWN.transitRidership, .01, 'transit ridership (2025)');
  assert.ok(Math.abs(B[0].commuteTime - baselines.meanCommuteMin.value) < 4, `commute ${B[0].commuteTime} min`);
  model.zones.forEach((z, i) => {
    const share = z.modeShare.bus / Object.values(z.modeShare).reduce((a, b) => a + b);
    assert.ok(Math.abs(base.zones[0][i].busShare - share) < .01, `${z.id} bus share`);
  });
  const rentGrowth = (B[39].rent / B[0].rent) ** (4 / 39) - 1, jobGrowth = (B[39].jobs / B[0].jobs) ** (4 / 39) - 1;
  assert.ok(rentGrowth > .015 && rentGrowth < .055, `baseline rent growth ${rentGrowth}/yr (ZORI 2015-2026: 2.2%-5.1%)`);
  assert.ok(jobGrowth > .002 && jobGrowth < .015, `baseline job growth ${jobGrowth}/yr (LODES 2002-23: 1.3%)`);
});

test('the Town commute mode shares sum to 1, with car at 0.75', () => {
  assert.ok(Math.abs(Object.values(TOWN.modeShare).reduce((a, b) => a + b) - 1) < 1e-12);
  assert.equal(Math.round(TOWN.modeShare.car * 100) / 100, .75);
});

test('deterministic, and neutral with no policy', () => {
  assert.deepEqual(model.simulate(p, []).series, B);
  assert.deepEqual(model.simulate(p, [{ id: 'noop', levers: [{ lever: 'business.supportGrants', value: 0 }] }]).series, B);
});

test('emergent behaviour lands inside published ranges', () => {
  const shock = model.simulate(p, [], { shock: { units: .01 } });
  const rentElast = (shock.series[20].rent / B[20].rent - 1) / .01;
  assert.ok(rentElast < -.08 && rentElast > -.7, `rent response to +1% homes (5 yrs): ${rentElast} (Mense 2025: −0.19)`);
  const svc = model.simulate(p, [{ id: 's', levers: [{ lever: 'transit.serviceMultiplier', value: 1.1 }] }]);
  const busElast = Math.log(svc.series[8].busShare / B[8].busShare) / Math.log(1.1);
  assert.ok(busElast > .1 && busElast < 1, `bus share response to +10% service: ${busElast} (TCRP 95: 0.3-1.0 for ridership)`);
  const up = model.simulate({ ...p, rentDrift: p.rentDrift + .01 }, []);
  const supplyElast = Math.log(up.series[39].housingUnits / B[39].housingUnits) / Math.log(up.series[39].rent / B[39].rent);
  assert.ok(supplyElast > .2 && supplyElast < 2.5, `10-yr housing supply elasticity: ${supplyElast} (Saiz 2010: ~0.8 for Raleigh-Durham)`);
});

test('each card moves its own lever\'s outcome the expected way (10 years, central parameters, defaults)', () => {
  const r = Object.fromEntries(policies.map(x => [x.id, model.simulate(p, [x])]));
  assert.ok(rel(r['transit-upzoning'], 'housingUnits') > .01, 'upzoning adds homes');
  assert.ok(rel(r['transit-upzoning'], 'rent') < 0, 'upzoning lowers rent vs. baseline');
  assert.ok(rel(r['housing-construction-subsidy'], 'housingUnits') > 0, 'construction subsidy adds homes');
  assert.ok(rel(r['parking-minimum-reduction'], 'housingUnits') > 0, 'parking reduction adds homes');
  assert.ok(at(r['property-tax-adjustment'], 'propertyTax') < B[39].propertyTax, 'tax cut lowers revenue');
  assert.equal(at(r['property-tax-adjustment'], 'taxRate'), 46, 'at the card\'s rate: 50¢ - 4¢');
  assert.ok(rel(r['small-business-support-grant'], 'businesses') > 0, 'support grants add businesses');
  assert.ok(rel(r['new-business-startup-grant'], 'businesses') > 0, 'start-up grants add businesses');
  assert.ok(rel(r['hiring-subsidy'], 'jobs') > 0, 'hiring subsidy adds jobs');
  assert.ok(at(r['storefront-vacancy-tax'], 'storefrontVacancy') < B[39].storefrontVacancy, 'vacancy tax fills storefronts');
  assert.ok(rel(r['bus-frequency-boost'], 'transitRidership') > .05, 'more buses, more riders');
  assert.ok(rel(r['bus-frequency-boost'], 'trafficIndex') < 0, 'more buses, less car traffic');
  assert.ok(rel(r['protected-bike-network'], 'bikeShare') > 0, 'bike network raises cycling');
  assert.ok(r['transit-upzoning'].events.length > base.events.length, 'upzoning builds more projects');
});

test('a card param sets its lever, clamped to the slider range', () => {
  const tax = id => cardPolicies(cards.filter(c => c.id === 'property-tax-adjustment'), id)[0].levers[0].value;
  assert.equal(tax({}), -4);
  assert.equal(tax({ 'property-tax-adjustment': { cents_per_100: 3 } }), 3);
  assert.equal(tax({ 'property-tax-adjustment': { cents_per_100: -40 } }), -10);
  assert.deepEqual(card('transit-upzoning').levers, [
    { lever: 'housing.farMultiplier', zones: ['downtown', 'north', 'east'], value: 1.6 }, { lever: 'housing.planningCost', value: 300000 }]);
  assert.equal(cardPolicies(cards.filter(c => !c.levers)).length, 0); // land-use cards set no levers
});

test('Monte Carlo: 200 paired runs, ordered bands, same seed same bands, a traceable cause', () => {
  const t0 = performance.now();
  const sc = runScenario([card('transit-upzoning'), card('bus-frequency-boost')], assumptions, baselines, { runs: 200 });
  const ms = performance.now() - t0;
  assert.ok(ms < 3000, `${Math.round(ms)} ms`);
  assert.ok(Object.values(sc.diff).every(b => b.p10.every((v, q) => v <= b.p50[q] + 1e-9 && b.p50[q] <= b.p90[q] + 1e-9)), 'p10 ≤ p50 ≤ p90');
  const again = () => runScenario([card('transit-upzoning')], assumptions, baselines, { runs: 30 }).diff.rent;
  assert.deepEqual(again(), again());
  assert.ok(explain(sc, 'rent', 39).children.length > 0, 'the trace finds a cause for rent');
});

test('homes from the land-use sim join the stock each quarter, and move jobs, traffic and the budget', () => {
  const unitsAdded = Array.from({ length: QUARTERS }, (_, q) => ({ downtown: 0, campus: 25 * (q + 1), north: 0, east: 0, south: 0 }));
  const run = model.simulate(p, [], { landUse: { unitsAdded, treeCoverPct: Array(QUARTERS).fill(45) } });
  assert.equal(run.series[39].landUseHomes, 1000);
  assert.ok(Math.abs(run.zones[0][1].units - base.zones[0][1].units - 25) < 1e-9, 'the first quarter adds its 25 homes to campus');
  assert.ok(run.series[39].housingUnits > B[39].housingUnits + 500, 'most of them add to the stock (some crowd out other building)');
  for (const k of ['jobs', 'trafficIndex', 'netFiscal']) assert.notEqual(run.series[39][k], B[39][k], k);
  assert.equal(run.series[39].treeCoverPct, 45);
  assert.equal(B[39].treeCoverPct, baselines.treeCoverPct.value);
});
