import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesWhere, validateCard } from '../shared/schema.js';
import { stub } from './data.js';

test('the stub card is valid', () => assert.deepEqual(validateCard(stub), []));

test('cards must show both sides', () => {
  for (const side of ['pros', 'cons']) {
    const errors = validateCard({ ...stub, tradeoffs: { ...stub.tradeoffs, [side]: [] } });
    assert.ok(errors.some(e => e.startsWith(`tradeoffs.${side}:`)), errors.join('\n'));
  }
});

test('rejects bad where syntax, unknown zone states, stray capParams and misspelled fields', () => {
  const rule = { ...stub.zoneRules[0], where: 'near:edge', to: 'skyscraper', capParam: 'acres' };
  const errors = validateCard({ ...stub, zoneRules: [rule], tradeof: {} }).map(e => e.split(':')[0]);
  for (const path of ['zoneRules[0].where', 'zoneRules[0].to', 'zoneRules[0].capParam', 'tradeof']) assert.ok(errors.includes(path), path);
});

test('a card needs zone rules or levers; levers name a known lever and a value or one of the card\'s params', () => {
  const { zoneRules, ...noRules } = stub;
  assert.deepEqual(validateCard(noRules), ['(card): needs at least one entry in zoneRules or levers']);
  const card = { ...noRules, levers: [{ lever: 'tax.rateDelta', param: 'acres_released' }], timing: { delayQuarters: 2, phaseInQuarters: 1 }, evidence: [{ claim: 'c', source: 's', url: 'https://example.org' }] };
  assert.deepEqual(validateCard(card), []);
  const bad = {
    ...card,
    levers: [{ lever: 'tax.rate' }, { lever: 'tax.rateDelta', value: 1, param: 'acres_released' }, { lever: 'tax.rateDelta', param: 'acres' },
      { lever: 'tax.rateDelta', value: 1, zones: ['downtown'] }, { lever: 'housing.farMultiplier', value: 1.5, zones: ['uptown'] }],
    timing: { delayQuarters: -1, phaseInQuarters: 1.5 }, evidence: [{ claim: 'c', source: 's', url: 'example.org' }],
  };
  const errors = validateCard(bad).map(e => e.split(':')[0]);
  for (const path of ['levers[0].lever', 'levers[1]', 'levers[2].param', 'levers[3].zones', 'levers[4].zones', 'timing.delayQuarters', 'timing.phaseInQuarters', 'evidence[0].url'])
    assert.ok(errors.includes(path), path);
});

test('a param default must be reachable with its slider step', () => {
  const p = { key: 'spaces', label: 'Spaces', min: 0, max: 1.5, default: 0.5, unit: '' }; // implicit step 0.015 skips 0.5
  assert.ok(validateCard({ ...stub, params: [...stub.params, p] }).some(e => e.startsWith('params[1].default')));
  assert.deepEqual(validateCard({ ...stub, params: [...stub.params, { ...p, step: 0.01 }] }), []);
});

test('a protect rule is { where, protect: <state> }; "all" selects every zone', () => {
  const card = { ...stub, zoneRules: [{ where: 'all', protect: 'forest' }, { where: 'tag:corridor', protect: 'parking' }] };
  assert.deepEqual(validateCard(card), []);
  const bad = { ...stub, zoneRules: [{ where: 'everything', protect: 'forest' }, { where: 'all', protect: 'meadow' }, { where: 'all', protect: 'forest', to: 'low_res' }] };
  const errors = validateCard(bad).map(e => e.split(':')[0]);
  for (const path of ['zoneRules[0].where', 'zoneRules[1].protect', 'zoneRules[2].to']) assert.ok(errors.includes(path), path);
  assert.ok(matchesWhere('all', { id: 'zone-01-01', tags: [] }));
});

test('environment is a category with its own slot, and protect-remaining-forest sits in it beside the housing cards', async () => {
  const { CATEGORIES, SLOTS } = await import('../meridian-city/policy/policies.js');
  const { cards } = await import('./data.js');
  assert.deepEqual(CATEGORIES.find(c => c.id === 'environment')?.slots, 1);
  assert.ok(SLOTS.some(s => s.id === 'environment-1') && SLOTS.some(s => s.id === 'housing-1'));
  assert.deepEqual(validateCard({ ...stub, category: 'environment', icon: 'sprout' }), []);
  assert.equal(cards.find(c => c.id === 'protect-remaining-forest').category, 'environment');
});
