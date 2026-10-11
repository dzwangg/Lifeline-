// The city-health indicators (shared/indicators.js): each is a metric the models compute, each "today" value is the one in
// the data files, and the models' year 0 reproduces it, so what the panel calls today is today.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INDICATORS, PILLARS, byPillar } from '../shared/indicators.js';
import { HOUSEHOLD_METRICS, LUTI_METRICS, METRICS } from '../shared/schema.js';
import { TOWN } from '../shared/luti/data.js';
import { runCombined } from '../shared/combined.js';
import { zones, assumptions, baselines } from './data.js';

const result = runCombined([], {}, zones, assumptions, baselines), y0 = result.timeline[0].metrics;
const B = k => baselines[k].value;

test('every indicator is a SimResult metric in one pillar, and every pillar has some', () => {
  const metrics = new Set([...METRICS, ...HOUSEHOLD_METRICS, ...LUTI_METRICS]);
  for (const i of INDICATORS) {
    assert.ok(metrics.has(i.key), `${i.key} is a metric`);
    assert.ok(PILLARS.some(p => p.id === i.pillar), `${i.key}: pillar ${i.pillar}`);
    assert.ok(['higher', 'lower', null].includes(i.better), `${i.key}: better`);
    assert.ok(i.why && i.model, `${i.key}: why and model`);
  }
  assert.equal(new Set(INDICATORS.map(i => i.key)).size, INDICATORS.length, 'no duplicates');
  for (const p of byPillar()) assert.ok(p.indicators.length > 0, p.id);
});

test("each indicator's today matches the data files", () => {
  const today = Object.fromEntries(INDICATORS.filter(i => i.today).map(i => [i.key, i.today.value]));
  assert.equal(today.medianRent, B('medianGrossRent'));
  assert.equal(today.housingUnits, B('housingUnits'));
  assert.equal(today.homeValue, B('medianHomeValue'));
  assert.equal(today.avgCommuteMin, B('meanCommuteMin'));
  assert.equal(today.treeCoverPct, B('treeCoverPct'));
  assert.equal(today.households, TOWN.households);
  assert.equal(today.jobs, TOWN.jobs);
  assert.equal(today.rentBurden, TOWN.rentBurdened);
  assert.equal(today.storefrontVacancy, TOWN.downtownStorefrontVacancy);
  assert.ok(Math.abs(today.transitRidership - TOWN.transitRidership) < 100);
  assert.ok(Math.abs(today.priceToIncome - B('medianHomeValue') / TOWN.medianHouseholdIncome) < 0.01);
  assert.ok(Math.abs(today.taxRevenue - TOWN.taxBase * assumptions.propertyTaxRate.value) < 0.01e6);
});

test("the models' year 0 is today", () => {
  const near = (k, want, tol) => assert.ok(Math.abs(y0[k] - want) <= tol, `${k}: year 0 ${y0[k]}, today ${want}`);
  near('medianRent', B('medianGrossRent'), 1);
  near('housingUnits', B('housingUnits'), 1);
  near('homeValue', B('medianHomeValue'), 1);
  near('avgCommuteMin', B('meanCommuteMin'), 0.05);
  near('treeCoverPct', B('treeCoverPct'), 0.05);
  near('households', TOWN.households, 0.01 * TOWN.households); // 300 simulated households, ~71 real ones each
  near('jobs', TOWN.jobs, 1);
  near('rentBurden', TOWN.rentBurdened, 0.01); // the household model's 300 households, calibrated to it
  near('storefrontVacancy', TOWN.downtownStorefrontVacancy, 0.01);
  near('transitRidership', TOWN.transitRidership, 1);
  near('priceToIncome', B('medianHomeValue') / TOWN.medianHouseholdIncome, 0.01);
  near('jobAccess', 1, 1e-9);
  assert.equal(y0.pricedOut, 0);
  assert.equal(y0.affordableHomes, 0);
  assert.ok(y0.commuteCO2 > 5e4 && y0.commuteCO2 < 2e5, `commute CO2 ${y0.commuteCO2} t`);
});
