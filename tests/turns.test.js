// A game of turns: each decade's cards start in that decade and stay in force. The models run a decade more per turn,
// and a card enacted later never rewrites the decades already played.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runModels } from '../shared/combined.js';
import { runScenario } from '../shared/sim.js';
import { runScenario as runLuti } from '../shared/luti/run.js';
import { createModel } from '../shared/luti/model.js';
import { cardPolicies } from '../shared/luti/levers.js';
import { validateSimResult } from '../shared/schema.js';
import { cards, zones, assumptions, baselines } from './data.js';

const card = id => cards.find(c => c.id === id);
const PARAMS = { 'property-tax-adjustment': { cents_per_100: -4 }, 'edge-subdivisions': { acres_released: 150 } };
const changed = (from, to) => Object.keys(to).filter(id => to[id] !== from[id]);

test('a decade already played stays as it was when the next decade enacts more cards', () => {
  const first = runModels([card('edge-subdivisions'), card('property-tax-adjustment')], PARAMS, zones, assumptions, baselines);
  const game = runModels(['edge-subdivisions', 'property-tax-adjustment', 'bus-frequency-boost', 'core-infill'].map(card), PARAMS, zones, assumptions, baselines,
    { years: 20, starts: { 'bus-frequency-boost': 10, 'core-infill': 10 } });
  assert.equal(game.result.timeline.length, 21);
  assert.deepEqual(game.result.timeline.slice(0, 11), first.result.timeline);
  assert.deepEqual(game.averages.slice(0, 11), first.averages, 'the household model replays the same households');
  assert.deepEqual(validateSimResult({ ...game.result, deltas: [] }), []);
  assert.deepEqual(game.result.policies.filter(p => p.start).map(p => [p.id, p.start]), [['bus-frequency-boost', 10], ['core-infill', 10]]);
});

test('a card enacted in the second decade changes the town only after it', () => {
  const kept = [card('edge-subdivisions')], late = card('bus-frequency-boost'), opts = { years: 20 };
  const without = runModels(kept, PARAMS, zones, assumptions, baselines, opts).result.timeline;
  const withIt = runModels([...kept, late], PARAMS, zones, assumptions, baselines, { ...opts, starts: { [late.id]: 10 } }).result.timeline;
  for (let y = 0; y <= 10; y++) assert.deepEqual(withIt[y].metrics, without[y].metrics, `year ${y}`);
  assert.ok(withIt[20].metrics.transitRidership > without[20].metrics.transitRidership * 1.02, 'more buses, more riders by year 20');
});

test('zone rules count their yearly pace from the year the card is enacted', () => {
  const infill = card('core-infill'), base = runScenario([], {}, zones, assumptions, baselines, 20).timeline;
  const late = runScenario([infill], {}, zones, assumptions, baselines, 20, { [infill.id]: 10 }).timeline;
  const early = runScenario([infill], {}, zones, assumptions, baselines, 10).timeline;
  for (let y = 0; y <= 10; y++) assert.deepEqual(late[y].zoneStates, base[y].zoneStates, `year ${y}`);
  for (let y = 1; y <= 10; y++) assert.deepEqual(changed(late[10].zoneStates, late[10 + y].zoneStates), changed(early[0].zoneStates, early[y].zoneStates), `${y} years in`);
});

test('a protect rule enacted later keeps what was already converted and stops what comes after', () => {
  const edge = card('edge-subdivisions'), protect = card('protect-remaining-forest');
  const open = runScenario([edge], PARAMS, zones, assumptions, baselines, 10).timeline;
  const shut = runScenario([edge, protect], PARAMS, zones, assumptions, baselines, 10, { [protect.id]: 5 }).timeline;
  assert.ok(changed(open[5].zoneStates, open[10].zoneStates).length > 0, 'without it, the edge keeps converting after year 5');
  for (let y = 0; y <= 5; y++) assert.deepEqual(shut[y].zoneStates, open[y].zoneStates, `year ${y}`);
  for (let y = 6; y <= 10; y++) assert.deepEqual(shut[y].zoneStates, shut[5].zoneStates, `year ${y}`);
});

test('CH-LUTI phases a later card in from its decade, and its ranges cover the whole run', () => {
  const bus = card('bus-frequency-boost'), model = createModel(assumptions, baselines), mid = model.midParams();
  const none = model.simulate(mid, [], { seedEvents: false, quarters: 80 }).series;
  const late = model.simulate(mid, cardPolicies([bus], {}, { [bus.id]: 10 }), { seedEvents: false, quarters: 80 }).series;
  assert.equal(late.length, 80);
  // the card's own delay (2 quarters) counts from the start of its decade, quarter 40
  for (let q = 0; q < 42; q++) assert.equal(late[q].serviceLevel, none[q].serviceLevel, `quarter ${q}`);
  assert.ok(late[43].serviceLevel > 1.2);
  const ranges = runLuti(cardPolicies([bus], {}, { [bus.id]: 10 }), assumptions, baselines, { runs: 20, quarters: 80 });
  assert.equal(ranges.years.length, 80);
  assert.equal(ranges.diff.transitRidership.p50.length, 80);
  assert.ok(Math.abs(ranges.diff.transitRidership.p50[39]) < 1e-9 && ranges.diff.transitRidership.p50[79] > 0);
});
