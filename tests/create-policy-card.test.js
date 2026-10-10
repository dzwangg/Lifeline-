import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGeneratedCard, generateCard } from '../scripts/create-policy-card.js';
import { stub } from './data.js';

const zones = [{ id: 'zone-01', state: 'forest', tags: ['corridor'], areaAcres: 1, edgeDistM: 10 }];
const assumptions = {
  unitsPerAcre: { value: { forest: 0, mid_res: 20 } },
  canopyMinPct: { value: { mid_res: 0.3 } },
  rentSupplyElasticity: { value: -0.1 },
  commuteDistancePenalty: { value: 3 },
  propertyTaxRate: { value: 0.005 },
};
const baselines = {
  housingUnits: { value: 100 }, medianGrossRent: { value: 1000 },
  meanCommuteMin: { value: 20 }, medianHomeValue: { value: 200000 },
  treeCoverPct: { value: 50 }, mapAreaAcres: { value: 100 },
};
const base = { ...stub, params: [], zoneRules: [{ where: 'tag:corridor', from: 'forest', to: 'mid_res', ratePerYear: 1 }] };
const check = card => checkGeneratedCard(card, zones, assumptions, baselines);

test('accepts a card that changes mapped zones', () => assert.deepEqual(check(base), []));
test('rejects selectors with no matching starting zone', () => {
  assert.match(check({ ...base, zoneRules: [{ ...base.zoneRules[0], where: 'tag:missing' }] }).join('\n'), /no starting zone matches/);
});
test('rejects a default cap that prevents conversion', () => {
  const card = { ...base, params: [{ key: 'acres', label: 'Acres', min: 0, max: 1, default: 0, unit: 'acres' }], zoneRules: [{ ...base.zoneRules[0], capParam: 'acres' }] };
  assert.match(check(card).join('\n'), /default settings change no zones/);
});

test('uses the configured model and explains unavailable models', async () => {
  let requestedUrl;
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  await assert.rejects(generateCard('Build housing near the corridor', {
    apiKey: 'test-key', zones, assumptions, baselines,
    fetchImpl: async url => { requestedUrl = url; return new Response('', { status: 404 }); },
  }), /Gemini model .* is unavailable/);
  assert.ok(requestedUrl.endsWith(`/models/${encodeURIComponent(model)}:generateContent`));
});
