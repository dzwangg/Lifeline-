import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderSources } from '../scripts/make-sources.js';

test('meridian-city/sources.html is current (npm run sources to refresh)', () => {
  assert.equal(readFileSync(new URL('../meridian-city/sources.html', import.meta.url), 'utf8'), renderSources());
});
