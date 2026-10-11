import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runModels } from '../shared/combined.js';
import { EFFECTS, KINDS, attribution, effectSeries, leversMissing, order } from '../shared/effects.js';
import { LEVER_LIMITS } from '../shared/luti/levers.js';
import { zones, assumptions, baselines, cards } from './data.js';

const base = new Map(); // years -> the no-policy central run
const baseFor = years => base.get(years) ?? base.set(years, runModels([], {}, zones, assumptions, baselines, { years }).luti).get(years);
const effects = (list, params = {}, starts = {}, years = 10) => effectSeries({ cards: list, params, starts, years, baseLuti: baseFor(years),
  luti: runModels(list, params, zones, assumptions, baselines, { years, starts }).luti });
const shown = row => Object.entries(row).filter(([, v]) => v.n).map(([k]) => k);
// A drafted card that pulls these levers at one end of their limits (shared/luti/levers.js LEVER_LIMITS).
const drafted = (levers, end = 1) => ({ id: `drafted-${levers.join('-')}`, title: 'Drafted', category: 'housing', params: [], zoneRules: [], tradeoffs: { pros: [], cons: [] },
  timing: { delayQuarters: 2, phaseInQuarters: 4 }, levers: levers.map(lever => ({ lever, value: LEVER_LIMITS[lever][end] })) });

test('effects: every lever feeds some kind on the street, and kinds are unique', () => {
  assert.deepEqual(leversMissing(), []);
  assert.equal(new Set(EFFECTS.map(e => e.kind)).size, EFFECTS.length);
});

test('effects: no cards, nothing on the street in any year; year 0 is always empty', () => {
  for (const row of effects([])) assert.deepEqual(shown(row), []);
  const bike = effects([cards.find(c => c.id === 'protected-bike-network')]);
  assert.deepEqual(shown(bike[0]), []);
});

test('effects: every catalog card that pulls a lever or protects land shows something by year 10, and only its own kinds', () => {
  for (const c of cards.filter(x => x.id !== 'stub-card' && (x.levers?.length || x.zoneRules?.some(r => r.protect)))) {
    const params = c.id === 'property-tax-adjustment' ? { [c.id]: { cents_per_100: -10 } } : {}; // its default changes nothing
    const row = effects([c], params)[10], own = Object.keys(attribution([c]));
    assert.ok(shown(row).length, `${c.id} shows nothing`);
    for (const k of shown(row)) assert.ok(own.includes(k), `${c.id} shows ${k}, which none of its levers feed`);
  }
});

test('effects: a drafted card pulling any lever (paired payments together) shows something', () => {
  const groups = [['housing.subsidyPerUnit', 'housing.subsidyCap'], ['assistance.rentHouseholds', 'assistance.rentMonthly'], ['assistance.cashHouseholds', 'assistance.cashMonthly']];
  const paired = new Set(groups.flat());
  for (const l of Object.keys(LEVER_LIMITS).filter(l => !paired.has(l))) groups.push([l]);
  for (const g of groups) {
    const s = effects([drafted(g)]);
    assert.ok(s.some(row => shown(row).length), `${g.join(' + ')} shows nothing in any year`);
  }
});

test('effects: signed kinds show the opposite look for the opposite policy', () => {
  assert.ok(effects([drafted(['transit.serviceMultiplier'], 0)])[10].busStops.i < 0, 'a service cut');
  assert.ok(effects([drafted(['transit.serviceMultiplier'], 1)])[10].busStops.i > 0);
  const tax = cards.find(c => c.id === 'property-tax-adjustment');
  assert.ok(effects([tax], { [tax.id]: { cents_per_100: -10 } })[10].homeSales.i > 0, 'a tax cut sells homes');
  assert.ok(effects([tax], { [tax.id]: { cents_per_100: 10 } })[10].homeSales.i < 0, 'a tax rise puts homes up for sale');
  assert.ok(effects([cards.find(c => c.id === 'parking-minimum-restore')])[10].construction.i < 0, 'parking minimums hold building back');
});

test('effects: a card enacted in a later year shows nothing before it, and flows pile up over the decade', () => {
  const grant = cards.find(c => c.id === 'new-business-startup-grant');
  const late = effects([grant], {}, { [grant.id]: 3 });
  for (let y = 0; y <= 3; y++) assert.deepEqual(shown(late[y]), [], `year ${y}`);
  assert.ok(shown(late[5]).length);
  const s = effects([grant]);
  assert.ok(s[3].grandOpening.n < s[10].grandOpening.n, 'more grand openings by year 10 than year 3');
});

test('effects: a one-time project is under way, then finished', () => {
  const s = effects([drafted(['budget.oneTimeCost'])]);
  assert.equal(s[1].civicWorks.n, 1);
  assert.equal(s[1].civicDone.n, 0);
  assert.equal(s[10].civicWorks.n, 0);
  assert.equal(s[10].civicDone.n, 1);
});

test('effects: attribution names the cards behind each kind, with the year each is enacted', () => {
  const bike = cards.find(c => c.id === 'protected-bike-network'), forest = cards.find(c => c.id === 'protect-remaining-forest');
  const a = attribution([bike, forest], { [forest.id]: 10 });
  assert.deepEqual(a.bikeLanes, [{ id: bike.id, title: bike.title, start: 0 }]);
  assert.deepEqual(a.protect, [{ id: forest.id, title: forest.title, start: 10 }]);
  assert.equal(a.hiring, undefined);
  assert.ok(KINDS.bikeLanes.label);
});

test('order: the same spots in the same order every time, so items stay put as their number grows', () => {
  const spots = Array.from({ length: 50 }, (_, i) => ({ x: i * 13.7, z: (i * 7) % 11 }));
  const a = order(spots), b = order([...spots].reverse());
  assert.deepEqual(a.map(s => [s.x, s.z]), b.map(s => [s.x, s.z]));
  assert.notDeepEqual(a.map(s => s.x), spots.map(s => s.x), 'shuffled, not in input order');
});
