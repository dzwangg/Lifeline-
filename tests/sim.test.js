import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runScenario } from '../shared/sim.js';
import { runWithHouseholds } from '../shared/agents.js';
import { validateSimResult } from '../shared/schema.js';
import { stub, zones, assumptions, baselines } from './data.js';

const run = (acres, cards = [stub], z = zones, a = assumptions) =>
  runScenario(cards, acres == null ? {} : { [stub.id]: { acres_released: acres } }, z, a, baselines);
const final = r => r.timeline.at(-1).metrics;

test('zero cap leaves the baseline unchanged', () => {
  const r = run(0);
  const base = runScenario([], {}, zones, assumptions, baselines).timeline[0];
  assert.equal(base.metrics.medianRent, baselines.medianGrossRent.value);
  assert.equal(base.metrics.housingUnits, baselines.housingUnits.value);
  for (const t of r.timeline) assert.deepEqual([t.metrics, t.zoneStates], [base.metrics, base.zoneStates]);
});

test('a larger cap means more homes, less tree cover and lower rent', () => {
  const small = final(run(20)), big = final(run(120));
  assert.ok(big.housingUnits > small.housingUnits);
  assert.ok(big.treeCoverPct < small.treeCoverPct);
  assert.ok(big.medianRent < small.medianRent);
});

test('effects only build up over the years', () => {
  const t = run(120).timeline.map(y => y.metrics);
  for (let i = 1; i < t.length; i++) {
    assert.ok(t[i].housingUnits >= t[i - 1].housingUnits, `units, year ${i}`);
    assert.ok(t[i].treeCoverPct <= t[i - 1].treeCoverPct, `trees, year ${i}`);
    assert.ok(t[i].medianRent <= t[i - 1].medianRent, `rent, year ${i}`);
  }
  assert.ok(t.at(-1).housingUnits > t[0].housingUnits);
});

test('output passes the SimResult schema', () => {
  assert.deepEqual(validateSimResult(run(40)), []);
  assert.deepEqual(validateSimResult(runScenario([], {}, zones, assumptions, baselines)), []);
});

test('deterministic, whatever order the zones and cards come in', () => {
  const other = { ...stub, id: 'stub-card-2', zoneRules: [{ ...stub.zoneRules[0], where: 'tag:corridor', to: 'mid_res' }] };
  assert.deepEqual(run(60, [stub, other]), run(60, [stub, other]));
  assert.deepEqual(run(60, [other, stub], [...zones].reverse()), run(60, [stub, other]));
});

test('stacked effects are clamped to a sane range', () => {
  const extreme = { ...assumptions, rentSupplyElasticity: { ...assumptions.rentSupplyElasticity, value: -1000 } };
  assert.equal(final(run(250, [stub], zones, extreme)).medianRent, baselines.medianGrossRent.value / 2);
});

test('tests/fixtures/sim-result.json is current (npm run fixture to refresh)', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/sim-result.json', import.meta.url), 'utf8'));
  assert.deepEqual(fixture, runWithHouseholds([stub], {}, zones, assumptions, baselines));
});
