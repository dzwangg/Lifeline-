import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../shared/agents.js';
import { assumptions, baselines } from './data.js';

test('household model is deterministic', () => {
  assert.deepEqual(simulate(509, assumptions, baselines), simulate(509, assumptions, baselines));
  assert.notDeepEqual(simulate(509, assumptions, baselines, 1).agents, simulate(509, assumptions, baselines, 2).agents);
});

test('year 0 is calibrated to the ACS median rent and mean commute', () => {
  for (const newHomes of [0, 2000]) {
    const [y0] = simulate(newHomes, assumptions, baselines).years;
    assert.equal(y0.medianRent, baselines.medianGrossRent.value);
    assert.equal(y0.commute, baselines.meanCommuteMin.value);
  }
});
