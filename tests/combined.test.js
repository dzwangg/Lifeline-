import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runModels, withDeltas } from '../shared/combined.js';
import { validateSimResult } from '../shared/schema.js';
import { cards, zones, assumptions, baselines } from './data.js';

const card = id => cards.find(c => c.id === id);
const CUT = { 'property-tax-adjustment': { cents_per_100: -4 } }; // the tax card's default is no change
const models = (...ids) => runModels(ids.map(card), CUT, zones, assumptions, baselines);
const none = models();
const final = r => r.result.timeline.at(-1).metrics;

test('one growth path: with no policy, the homes the household model gets are CH-LUTI\'s, and so are its newcomers', () => {
  none.result.timeline.forEach((t, y) => {
    const fed = Object.values(none.inputs.homes[y]).reduce((a, b) => a + b);
    assert.ok(Math.abs(fed - (t.metrics.housingUnits - baselines.housingUnits.value)) <= 1, `year ${y}: ${fed} homes fed vs ${t.metrics.housingUnits}`);
  });
  assert.ok(final(none).housingUnits > baselines.housingUnits.value * 1.1, 'the town grows with no policy, from permit trends');
  assert.ok(none.inputs.households[10] > 0);
  assert.deepEqual(none.result.timeline[0].metrics.housingUnits, baselines.housingUnits.value);
});

test('every metric comes once, compared with no new policy, in a valid SimResult', () => {
  const r = withDeltas(models('property-tax-adjustment', 'edge-subdivisions').result, none.result);
  assert.deepEqual(validateSimResult(r), []);
  assert.deepEqual(r.deltas.map(d => d.metric), Object.keys(final(none)));
  assert.ok(r.deltas.every(d => d.comparedWith === 'no new policy'));
});

test('property tax revenue reflects both the rate card and new homes', () => {
  const both = final(models('property-tax-adjustment', 'edge-subdivisions')), tax = final(models('property-tax-adjustment')), edge = final(models('edge-subdivisions'));
  const revenue = (homes, cents) => homes * baselines.medianHomeValue.value * cents / 1e4;
  assert.ok(Math.abs(both.taxRevenue - revenue(both.housingUnits, 46)) <= 1e3, 'homes × median home value × 46¢');
  assert.ok(tax.taxRevenue < final(none).taxRevenue && edge.taxRevenue > final(none).taxRevenue && both.taxRevenue > tax.taxRevenue);
  assert.ok(both.netFiscal < final(none).netFiscal, 'the budget line falls with the revenue');
});

test('land-use cards move CH-LUTI\'s jobs, traffic and budget', () => {
  const edge = final(models('edge-subdivisions'));
  for (const k of ['jobs', 'trafficIndex', 'netFiscal', 'housingUnits']) assert.notEqual(edge[k], final(none)[k], k);
  assert.ok(edge.treeCoverPct < final(none).treeCoverPct);
});
