import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homesByYear, runWithHouseholds, simulate } from '../shared/agents.js';
import { validateSimResult } from '../shared/schema.js';
import { runScenario } from '../shared/sim.js';
import { stub, zones, assumptions, baselines } from './data.js';

const ramp = n => Array.from({ length: 11 }, (_, t) => ({ downtown: 0, campus: 0, edge: n * Math.min(t / 5, 1) }));

test('household model is deterministic', () => {
  assert.deepEqual(simulate(ramp(509), assumptions, baselines), simulate(ramp(509), assumptions, baselines));
  assert.notDeepEqual(simulate(ramp(509), assumptions, baselines, 1).agents, simulate(ramp(509), assumptions, baselines, 2).agents);
});

test('year 0 is calibrated to the ACS median rent and mean commute, and the observed 15-501 peak', () => {
  for (const homes of [null, ramp(2000)]) {
    const [y0] = simulate(homes, assumptions, baselines).years;
    assert.equal(y0.medianRent, baselines.medianGrossRent.value);
    assert.equal(y0.commute, baselines.meanCommuteMin.value);
    assert.ok(Math.abs(y0.roadRatio - assumptions.roadPeakVolume.value / assumptions.roadCapacity.value) < 1e-9);
  }
});

test('the homes fed to the model follow the SimResult timeline', () => {
  const result = runScenario([stub], {}, zones, assumptions, baselines), homes = homesByYear(result, zones, assumptions);
  result.timeline.forEach((t, i) => {
    const added = homes[i].downtown + homes[i].campus + homes[i].edge;
    assert.ok(Math.abs(added - (t.metrics.housingUnits - result.timeline[0].metrics.housingUnits)) <= 1, `year ${i}`);
  });
  assert.equal(homes[10].downtown, 0); // the stub only builds in map_edge parcels
});

test('the full SimResult carries the averaged household numbers, compared as the panel shows them', () => {
  const r = runWithHouseholds([stub], {}, zones, assumptions, baselines), y0 = r.timeline[0].metrics;
  assert.deepEqual(validateSimResult(r), []);
  assert.equal(y0.medianRent, baselines.medianGrossRent.value);
  assert.equal(y0.avgCommuteMin, baselines.meanCommuteMin.value);
  const vs = Object.fromEntries(r.deltas.map(d => [d.metric, d.comparedWith]));
  assert.deepEqual(vs, { housingUnits: 'year 0', medianRent: 'no new policy', treeCoverPct: 'year 0', avgCommuteMin: 'no new policy', taxRevenue: 'year 0', households: 'year 0', pricedOut: 'no new policy' });
});

test('baseline growth adds the expected households on average, either side of a half', () => {
  // No induced demand and plenty of spare homes, so year-1 arrivals are growth alone: 300 households x growth.
  const units = { ...assumptions.agentUnits, value: { downtown: 200, campus: 200, edge: 200 } };
  for (const expected of [1.3, 1.7]) {
    const A = { ...assumptions, agentUnits: units, agentInducedShare: { ...assumptions.agentInducedShare, value: 0 }, agentGrowth: { ...assumptions.agentGrowth, value: expected / 300 } };
    let arrivals = 0;
    for (let seed = 1; seed <= 400; seed++) arrivals += simulate(null, A, baselines, seed).agents.filter(a => a.joined === 1).length;
    assert.ok(Math.abs(arrivals / 400 - expected) < .1, `expected ~${expected}, got ${arrivals / 400}`);
  }
});

test('a renter whose burden dips a little but stays well above arrival still counts as priced out', () => {
  const line = assumptions.agentBurdenLine.value, rise = assumptions.agentBurdenRiseSinceArrival.value, slack = 1e-3; // hist rents are rounded to the dollar
  const dipped = [];
  for (let seed = 1; seed <= 20; seed++) {
    const { agents, years } = simulate(null, assumptions, baselines, seed);
    for (const a of agents) {
      if (a.left === null || a.hist[a.left].burden >= a.hist[a.left - 1].burden) continue;
      dipped.push(a);
      for (const t of [a.left - 1, a.left]) { // the two years running that counted
        assert.ok(a.hist[t].burden > line - slack && a.hist[t].burden - a.burden0 >= rise - slack, `seed ${seed}, household ${a.id}, year ${t}`);
      }
      assert.ok(years[a.left].displaced >= 1);
    }
  }
  assert.ok(dipped.length > 0, 'no renter left in a year their burden dipped; the case is not exercised');
});
