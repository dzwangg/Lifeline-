import { test } from 'node:test';
import assert from 'node:assert/strict';
import { averageRuns, homesByYear, modelZone, simulate } from '../shared/agents.js';
import { runModels } from '../shared/combined.js';
import { runScenario } from '../shared/sim.js';
import { cards, stub, zones, assumptions, baselines } from './data.js';

const ramp = n => ({ homes: Array.from({ length: 11 }, (_, t) => ({ downtown: 0, campus: 0, edge: n * Math.min(t / 5, 1), corridor: 0 })), households: Array(11).fill(0) });
const growth = runModels([], {}, zones, assumptions, baselines).inputs; // CH-LUTI's no-policy homes and households

test('household model is deterministic', () => {
  assert.deepEqual(simulate(ramp(509), assumptions, baselines), simulate(ramp(509), assumptions, baselines));
  assert.notDeepEqual(simulate(ramp(509), assumptions, baselines, 1).agents, simulate(ramp(509), assumptions, baselines, 2).agents);
});

test('year 0 is calibrated to the ACS median rent and mean commute, and the observed 15-501 peak', () => {
  for (const inputs of [null, ramp(2000), growth]) {
    const [y0] = simulate(inputs, assumptions, baselines).years;
    assert.equal(y0.medianRent, baselines.medianGrossRent.value);
    assert.equal(y0.commute, baselines.meanCommuteMin.value);
    assert.ok(Math.abs(y0.roadRatio - assumptions.roadPeakVolume.value / assumptions.roadCapacity.value) < 1e-9);
  }
});

test('the zone rules\' homes go to the household zone of their parcel; corridor parcels are their own zone', () => {
  const result = runScenario([stub], {}, zones, assumptions, baselines), homes = homesByYear(result, zones, assumptions);
  result.timeline.forEach((t, i) => {
    const added = Object.values(homes[i]).reduce((a, b) => a + b);
    assert.ok(Math.abs(added - (t.metrics.housingUnits - result.timeline[0].metrics.housingUnits)) <= 1, `year ${i}`);
  });
  assert.equal(homes[10].downtown, 0); // the stub only builds in map_edge parcels
  assert.ok(homes[10].corridor > 0 && homes[10].edge > 0, 'map_edge parcels by the corridor count as corridor, the rest as edge');
  assert.equal(modelZone({ tags: ['map_edge', 'corridor'] }), 'corridor');
});

test('corridor homes add no 15-501 trip, so they raise the commute less than the same edge homes', () => {
  const at = zone => ({ homes: Array.from({ length: 11 }, (_, t) => ({ downtown: 0, campus: 0, edge: 0, corridor: 0, [zone]: 2000 * Math.min(t / 5, 1) })), households: Array.from({ length: 11 }, (_, t) => 2000 * Math.min(t / 5, 1)) });
  const commute = zone => simulate(at(zone), assumptions, baselines).years[10].commute;
  assert.ok(commute('corridor') < commute('edge'), `${commute('corridor')} vs ${commute('edge')}`);
});

test('newcomers bring the town up to CH-LUTI\'s household count, either side of a half', () => {
  // Plenty of spare homes, so year-1 arrivals are the target alone: households added / agentScale simulated households.
  const units = { ...assumptions.agentUnits, value: { downtown: 200, campus: 200, edge: 200, corridor: 0 } };
  for (const expected of [1.3, 1.7]) {
    const inputs = { homes: Array(11).fill({ downtown: 0, campus: 0, edge: 0, corridor: 0 }), households: Array(11).fill(expected * assumptions.agentScale.value) };
    let arrivals = 0;
    for (let seed = 1; seed <= 400; seed++) arrivals += simulate(inputs, { ...assumptions, agentUnits: units }, baselines, seed).agents.filter(a => a.joined === 1).length;
    assert.ok(Math.abs(arrivals / 400 - expected) < .1, `expected ~${expected}, got ${arrivals / 400}`);
  }
});

test('priced out moves in proportion to rent: 1% higher rents everywhere raise it by about 1-3%, not 10x', () => {
  const up = { ...baselines, medianGrossRent: { ...baselines.medianGrossRent, value: baselines.medianGrossRent.value * 1.01 } };
  const [a, b] = [baselines, up].map(B => averageRuns(growth, assumptions, B)[10]); // the same households, so only rent differs
  const rent = b.medianRent / a.medianRent - 1, out = b.pricedOut / a.pricedOut - 1;
  assert.ok(Math.abs(rent - .01) < .002, `rent ${rent}`);
  assert.ok(out > .005 && out < .03, `priced out ${(out * 100).toFixed(2)}% for rent ${(rent * 100).toFixed(2)}%`);
  // A card: the tax cut raises rent about 1% (and brings more renters); priced out moves at most about 3 times as much, not 10.
  const tax = runModels(cards.filter(c => c.id === 'property-tax-adjustment'), {}, zones, assumptions, baselines).averages[10], none = averageRuns(growth, assumptions, baselines)[10];
  const [dr, dp] = [tax.medianRent / none.medianRent - 1, tax.pricedOut / none.pricedOut - 1];
  assert.ok(dr > .005 && dp > 0 && dp < 3 * dr, `tax card: rent ${(dr * 100).toFixed(2)}%, priced out ${(dp * 100).toFixed(2)}%`);
});

test('only burden that has risen since arrival counts toward leaving', () => {
  // Many new homes in year 1 push vacancy up, so rents fall every year after: no renter's burden rises, so none leaves.
  const glut = { homes: Array.from({ length: 11 }, (_, t) => ({ downtown: 0, campus: 0, edge: t ? 4000 : 0, corridor: 0 })), households: Array(11).fill(0) };
  for (let seed = 1; seed <= 20; seed++) {
    const { years } = simulate(glut, assumptions, baselines, seed);
    assert.ok(years.slice(2).every((y, i) => y.rentIndex < years[i + 1].rentIndex), `seed ${seed}: rents fall`);
    assert.equal(years[10].displaced, 0, `seed ${seed}`);
  }
});
