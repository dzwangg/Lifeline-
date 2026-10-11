import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runScenario } from '../shared/sim.js';
import { runCombined } from '../shared/combined.js';
import { validateSimResult } from '../shared/schema.js';
import { stub, zones, assumptions, baselines, cards } from './data.js';

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
  assert.deepEqual(fixture, runCombined([stub], {}, zones, assumptions, baselines));
});

const card = id => cards.find(c => c.id === id);
const lastStates = r => r.timeline.at(-1).zoneStates;

test('a protect rule keeps matching zones in their state, whichever card would convert them', () => {
  const protect = card('protect-remaining-forest'), edge = card('edge-subdivisions');
  assert.deepEqual(final(run(null, [protect])), final(run(null, [])), 'alone it changes nothing: no-policy converts no forest');
  const open = runScenario([edge], {}, zones, assumptions, baselines), shut = runScenario([edge, protect], {}, zones, assumptions, baselines);
  assert.ok(Object.values(lastStates(open)).includes('low_res'));
  assert.deepEqual(lastStates(shut), runScenario([], {}, zones, assumptions, baselines).timeline[0].zoneStates);
  const someWoods = { ...protect, zoneRules: [{ where: 'tag:corridor', protect: 'forest' }] }; // only part: the rest still converts
  const part = lastStates(runScenario([edge, someWoods], {}, zones, assumptions, baselines));
  for (const z of zones) if (z.tags.includes('corridor')) assert.equal(part[z.id], 'forest', z.id);
  assert.ok(zones.some(z => part[z.id] === 'low_res'));
});

test('parking lots are zones a card can turn into homes; they never carry the woods\' tags', () => {
  const lots = zones.filter(z => z.state === 'parking');
  assert.ok(lots.length > 100 && lots.some(z => z.tags.includes('near_campus')) && lots.some(z => z.tags.includes('downtown')));
  for (const z of lots) assert.ok(z.tags.includes('parking') && !z.tags.some(t => t === 'map_edge' || t === 'corridor' || t.startsWith('wood-')), z.id);
  const homes = { ...stub, params: [], zoneRules: [{ where: 'tag:near_campus', from: 'parking', to: 'mid_res', ratePerYear: 1 }] };
  const r = runScenario([homes], {}, zones, assumptions, baselines);
  for (const z of lots) assert.equal(lastStates(r)[z.id], z.tags.includes('near_campus') ? 'mid_res' : 'parking', z.id);
  const acres = lots.filter(z => z.tags.includes('near_campus')).reduce((s, z) => s + z.areaAcres, 0);
  assert.equal(final(r).housingUnits, Math.round(baselines.housingUnits.value + 15 * acres));
  assert.ok(final(r).treeCoverPct > final(run(null, [])).treeCoverPct, 'a parking lot has less canopy than mid-rise homes');
});
