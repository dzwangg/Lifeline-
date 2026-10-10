import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homesByYear, simulate } from '../shared/agents.js';
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
