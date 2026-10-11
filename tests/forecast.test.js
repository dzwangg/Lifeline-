import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectYear, yearStatus, scenarioKey, latestOnly, ORIGIN_YEAR } from '../meridian-city/forecast/cursor.js';

const demo = JSON.parse(readFileSync(new URL('../data/forecast/demo/hiring-subsidy.json', import.meta.url)));

test('the play cursor selects precomputed annual states and never computes', () => {
  assert.deepEqual(selectYear(demo, { step: 0, years: 0 }), { year: ORIGIN_YEAR, index: -1, status: 'nowcast', beyond: false, frac: 0 });
  const c = selectYear(demo, { step: 2, years: 2.4 });
  assert.equal(c.year, 2028);
  assert.equal(c.index, demo.years.indexOf(2028));
  assert.ok(Math.abs(c.frac - 0.4) < 1e-9);
  const beyond = selectYear(demo, { step: 9, years: 9 }); // 5-year horizon, clock runs 10 steps
  assert.equal(beyond.beyond, true);
  assert.equal(beyond.year, demo.years.at(-1));
});

test('scrubbing to the same step returns identical values (replay is deterministic)', () => {
  const m = demo.metrics.find(x => x.id === 'workplace_jobs');
  const a = m.series[selectYear(demo, { step: 3, years: 3 }).index];
  const b = m.series[selectYear(demo, { step: 3, years: 3.99 }).index];
  assert.deepEqual(a, b);
});

test('years are labelled observed / nowcast / projected', () => {
  assert.equal(yearStatus(demo, 2023), 'observed');
  assert.equal(yearStatus(demo, 2025), 'nowcast');
  assert.equal(yearStatus(demo, 2029), 'projected');
});

test('scenario keys ignore key order but change on edits', () => {
  assert.equal(scenarioKey({ a: 1, b: { c: 2, d: 3 } }), scenarioKey({ b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(scenarioKey({ a: 1 }), scenarioKey({ a: 2 }));
});

test('a stale job response never overwrites a newer scenario', async () => {
  const resolvers = [];
  const run = latestOnly(() => new Promise(r => resolvers.push(r)));
  const first = run('old'), second = run('new');
  resolvers[1]('new result');
  resolvers[0]('old result'); // the older job finishes last
  assert.deepEqual(await second, { stale: false, value: 'new result' });
  assert.deepEqual(await first, { stale: true });
});

test('demo results carry labels, paired deltas and zero deltas for the unchanged scenario', () => {
  const base = JSON.parse(readFileSync(new URL('../data/forecast/demo/current-policies.json', import.meta.url)));
  assert.match(base.label, /assumption-based/);
  for (const m of base.metrics) for (const r of m.series) assert.equal(r.delta.p50, 0, m.id);
});
