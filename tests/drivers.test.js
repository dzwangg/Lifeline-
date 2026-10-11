// Scenario drivers (inflation and the other what-ifs) and the levers added for prompted policies, in CH-LUTI and the full
// SimResult.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel } from '../shared/luti/model.js';
import { runCombined, runModels } from '../shared/combined.js';
import { clampDrivers, priceIndex, FED_SEP_2026_09 } from '../shared/luti/drivers.js';
import { validateSimResult } from '../shared/schema.js';
import { zones, assumptions, baselines } from './data.js';

const model = createModel(assumptions, baselines), mid = model.midParams(), cpi = assumptions.lutiCpi.value;
const end = (policies = [], drivers = null) => model.simulate(mid, policies, { seedEvents: false, drivers }).series.at(-1);
const base = end();
const lever = (id, value, zones) => [{ id: 't', title: 't', timing: { delayQuarters: 0, phaseInQuarters: 1 }, levers: [{ lever: id, value, ...(zones && { zones }) }] }];

test('no drivers and empty drivers give exactly the same run; the default inflation rate set by hand matches it', () => {
  const json = d => JSON.stringify(model.simulate(mid, [], { seedEvents: false, drivers: d }).series);
  assert.equal(json({}), json(null));
  const same = end([], { inflation: cpi * 100 }); // compounded quarter by quarter, so equal to rounding error
  for (const k of ['rent', 'housingUnits', 'jobs', 'homeValue', 'netFiscal']) assert.ok(Math.abs(same[k] / base[k] - 1) < 1e-9, k);
});

test('inflation moves every nominal series together and leaves real rent about where it was', () => {
  const hot = end([], { inflation: 6 });
  assert.ok(hot.rent > base.rent * 1.3, 'nominal rent rises with inflation');
  assert.ok(hot.homeValue > base.homeValue * 1.3, 'nominal home values too');
  assert.ok(Math.abs(hot.rent / hot.priceIndex / (base.rent / base.priceIndex) - 1) < 0.02, 'real rent moves under 2%');
  assert.ok(Math.abs(hot.rentBurden - base.rentBurden) < 0.01, 'incomes keep pace, so rent burden barely moves');
});

test("the Fed path and the price index follow the FOMC's projection", () => {
  const idx = priceIndex({ inflation: 'fed' }, cpi, 4);
  assert.deepEqual(idx.map(x => +x.toFixed(4)), [1, 1.037, 1.0609, 1.0831, 1.1048]); // 1.037 × 1.023 × 1.021 × 1.020
  assert.equal(FED_SEP_2026_09.path[0], 3.7);
});

test('other drivers: UNC job growth adds jobs; costlier construction slows building; bounds are enforced', () => {
  assert.ok(end([], { uncJobsGrowth: 3 }).jobs > base.jobs * 1.1);
  assert.ok(end([], { constructionCost: 30 }).starts < base.starts * 0.6);
  assert.deepEqual(clampDrivers({ inflation: 99, uncJobsGrowth: -9, nope: 1 }).drivers, { inflation: 15, uncJobsGrowth: -5 });
});

test('new levers move the model the way they should', () => {
  const at = (id, v) => end(lever(id, v));
  assert.ok(at('housing.inclusionaryPct', 15).starts < base.starts, 'an affordable-housing requirement slows building');
  assert.ok(at('housing.inclusionaryPct', 15).affordableHomes > 0, 'and counts the affordable homes it gets');
  assert.ok(at('housing.impactFee', 20000).starts < base.starts, 'impact fees slow building');
  assert.ok(at('housing.impactFee', 20000).impactFeeRevenue > 0, 'and raise money');
  assert.ok(at('housing.approvalMonths', -6).starts > base.starts, 'faster approvals speed building');
  assert.ok(at('transit.busSpeedMultiplier', 1.25).busShare > base.busShare, 'bus lanes draw riders');
  const parking = at('transport.parkingPriceDelta', 8);
  assert.ok(parking.carShare < base.carShare && parking.parkingRevenue > 0, 'a parking charge moves some drivers and raises money');
  assert.ok(parking.parkingRevenue < 20e6, 'only Town-run parking downtown is charged');
  assert.ok(Math.abs(at('budget.annualCost', 2e6).netFiscal - (base.netFiscal - 2e6)) < 1, 'a yearly cost comes off the budget');
});

test('drivers reach the full SimResult, which still validates; no drivers adds no field', () => {
  const plain = runCombined([], {}, zones, assumptions, baselines);
  assert.ok(!('drivers' in plain));
  const hot = runCombined([], {}, zones, assumptions, baselines, undefined, { inflation: 6 });
  assert.deepEqual(validateSimResult(hot), []);
  assert.deepEqual(hot.drivers, { inflation: 6 });
  assert.ok(hot.timeline.at(-1).metrics.medianRent > plain.timeline.at(-1).metrics.medianRent);
  const m = runModels([], {}, zones, assumptions, baselines, { inflation: 6 });
  assert.ok(m.inputs.incomeIndex.at(-1) > 1.5, 'household incomes follow the scenario’s inflation');
});
