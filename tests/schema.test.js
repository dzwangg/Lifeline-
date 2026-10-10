import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCard } from '../shared/schema.js';
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
