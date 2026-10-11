import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderSources } from '../scripts/make-sources.js';

test('meridian-city/sources.html is current (npm run sources to refresh)', () => {
  assert.equal(readFileSync(new URL('../meridian-city/sources.html', import.meta.url), 'utf8'), renderSources());
});

test('links keep balanced parentheses and lose trailing punctuation', () => {
  const page = renderSources();
  assert.ok(page.includes('href="https://connect.ncdot.gov/resources/safety/Congestion%20Mngmt%20and%20Signing/Capacity%20Analysis%20Assumptions%20and%20Results%20by%20CTP%20Facility%20Type%20(2021).pdf"'));
  assert.ok(!/href="[^"]*[.,;:)]"/.test(page.replace(/\(2021\)\.pdf"/g, '"')), 'no link ends in punctuation or an unopened ")"');
});
