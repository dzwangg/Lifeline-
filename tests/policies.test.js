// /api/policies with Gemini mocked, and player cards in /api/narration. Selector and no-change checks from William Chen's
// tests/create-policy-card.test.js (origin/William, 0f80831).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { POST, checkCard, generateCard, loadContext, tidy } from '../api/policies.js';
import { POST as narrationPOST, signCard } from '../api/narration.js';
import { cards } from './data.js';

const ctx = await loadContext();
const sample = JSON.parse(readFileSync(new URL('./fixtures/narration-sample.json', import.meta.url), 'utf8'));
const byId = id => structuredClone(cards.find(c => c.id === id));
const zoneCard = { ...byId('corridor-midrise'), id: 'corridor-apartments' };
const leverCard = { ...byId('bus-frequency-boost'), id: 'more-buses' };
const ENV = { GEMINI_API_KEY: 'gem-secret', GEMINI_MODEL: 'gemini-test', GEMINI_THINKING_LEVEL: '', DEMO_MODE: '', CARD_SIGNING_KEY: 'sign-secret',
  ELEVENLABS_API_KEY: '', ELEVENLABS_VOICE_ID: '' };
const reply = (card, unmodeled = [], unsupportedReason = null) => JSON.stringify({ card, unmodeled, unsupportedReason });

/** Runs fn with these env vars and a fake fetch that answers Gemini with `drafts` in turn; fn gets the request bodies it saw. */
async function withGemini(drafts, fn, env = ENV) {
  const saved = { fetch: globalThis.fetch, env: { ...process.env } };
  const bodies = [];
  Object.assign(process.env, env);
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /generativelanguage/, 'only Gemini is called');
    bodies.push(JSON.parse(init.body));
    return Response.json({ candidates: [{ content: { parts: [{ text: drafts.shift() }] } }] });
  };
  try {
    await fn(bodies);
  } finally {
    globalThis.fetch = saved.fetch;
    process.env = saved.env;
  }
}
let ips = 0;
const generate = (idea, ip = `10.1.0.${++ips}`) => POST(new Request('http://localhost/api/policies/generate',
  { method: 'POST', headers: { 'x-forwarded-for': ip }, body: JSON.stringify({ idea }) }));
const narrate = (card, signature) => narrationPOST(new Request('http://localhost/api/narration', {
  method: 'POST', headers: { 'x-forwarded-for': `10.2.0.${++ips}` },
  body: JSON.stringify({ policies: [{ id: card.id, params: {} }], years: sample.years, deltas: sample.deltas, cards: [{ card, signature }] }),
}));

test('checks: a catalog-style card passes; a selector with no forest parcel and a default that changes nothing fail', () => {
  assert.deepEqual(checkCard(zoneCard, 'apartments', ctx), []);
  assert.deepEqual(checkCard(leverCard, 'buses', ctx), []);
  const missing = { ...zoneCard, zoneRules: [{ ...zoneCard.zoneRules[0], where: 'tag:missing' }] };
  assert.match(checkCard(missing, '', ctx).join('\n'), /no forest parcel matches tag:missing/);
  const capped = { ...zoneCard, params: [{ ...zoneCard.params[0], default: 0 }] };
  assert.match(checkCard(capped, '', ctx).join('\n'), /changes no metric/);
  assert.match(checkCard({ ...zoneCard, id: 'corridor-midrise' }, '', ctx).join('\n'), /taken by an existing card/);
});

test('checks: invented numbers and evaluative words in title, summary, pros or cons fail; numbers from the card or idea pass', () => {
  const text = { ...zoneCard, summary: 'Opens 20 acres near 15-501, adding 900 homes.', tradeoffs: { pros: ['Great news for renters.'], cons: zoneCard.tradeoffs.cons } };
  const errors = checkCard(text, '', ctx).join('\n');
  assert.match(errors, /summary: numbers .*: 900$/m);
  assert.match(errors, /tradeoffs\.pros\[0\]: evaluative .*: Great/);
  assert.deepEqual(checkCard({ ...zoneCard, summary: 'Opens 20 acres, up to 40, near 15-501.' }, 'up to 40 acres', ctx), []);
});

test('tidy clamps param defaults into range, drops evidence not copied from a catalog card, and drops empty lists', () => {
  const params = [{ key: 'a', label: 'A', min: 0, max: 60, default: 80, unit: 'acres' }, { key: 'b', label: 'B', min: -10, max: -1, default: 3, unit: '¢' }];
  const real = cards.flatMap(c => c.evidence ?? [])[0];
  const out = tidy({ ...zoneCard, params, levers: [], evidence: [real, { claim: 'Invented', source: 'Nobody (2024)' }] }, ctx.catalog);
  assert.deepEqual(out.params.map(p => p.default), [60, -1]);
  assert.deepEqual(out.evidence, [real]);
  assert.ok(!('levers' in out));
  assert.ok(!('evidence' in tidy({ ...zoneCard, evidence: [{ claim: 'x', source: 'y' }] }, ctx.catalog)));
});

test('generate: a valid zone-rule card comes back signed, from one Gemini call with the schema and minimal thinking', async () => {
  await withGemini([reply(zoneCard)], async bodies => {
    const res = await generate('Apartments near the corridor');
    const { card, signature, unmodeled } = await res.json();
    assert.equal(res.status, 200);
    assert.match(card.id, /^corridor-apartments-[0-9a-f]{4}$/);
    assert.equal(signature, signCard(card, 'sign-secret'));
    assert.deepEqual(unmodeled, []);
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].generationConfig.thinkingConfig.thinkingLevel, 'minimal');
    assert.equal(bodies[0].generationConfig.responseMimeType, 'application/json');
    assert.ok(bodies[0].generationConfig.responseSchema.properties.card.properties.levers);
    assert.match(bodies[0].contents[0].parts[0].text, /"Apartments near the corridor"/);
  });
});

test('generate: an invalid draft is retried once with its problems, then the fixed card is used', async () => {
  const bad = { ...zoneCard, title: 'Great apartments', params: [{ ...zoneCard.params[0], min: 60, max: 0 }] };
  await withGemini(['not json', reply(bad), reply(zoneCard)], async bodies => {
    await assert.rejects(generateCard('apartments'), err => err.status === 422 && /could not draft/.test(err.message) && /max: must be greater than min/.test(err.extra.problems.join()));
    assert.equal(bodies.length, 2);
    assert.match(bodies[1].contents.at(-1).parts[0].text, /must be JSON with a card/);
    const { card } = await generateCard('apartments');
    assert.equal(card.id, 'corridor-apartments');
    assert.equal(bodies.length, 3);
  });
  await withGemini([reply(bad), reply(zoneCard)], async bodies => {
    const { card } = await generateCard('apartments');
    assert.equal(card.title, zoneCard.title);
    const feedback = bodies[1].contents.at(-1).parts[0].text;
    assert.match(feedback, /params\[0\]\.max: must be greater than min/);
    assert.equal(bodies[1].contents.at(-2).role, 'model');
  });
});

test('generate: a levers card passes, and the parts of the idea the sim cannot represent come back as unmodeled', async () => {
  await withGemini([reply(leverCard, ['fare-free rides'])], async () => {
    const res = await generate('More buses and free fares');
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body.card.levers, leverCard.levers);
    assert.deepEqual(body.unmodeled, ['fare-free rides']);
  });
});

test('generate: an idea with nothing the sim can represent gets 422 with unsupportedReason, and no retry', async () => {
  await withGemini([reply(null, ['rent limits'], 'The simulator has no rent regulation.')], async bodies => {
    const res = await generate('Rent control');
    assert.equal(res.status, 422);
    assert.deepEqual(await res.json(), { error: "This idea can't be simulated yet: The simulator has no rent regulation.",
      unsupportedReason: 'The simulator has no rent regulation.', unmodeled: ['rent limits'] });
    assert.equal(bodies.length, 1);
  });
});

test('generate: bad requests, no key, and 5 drafts per IP per minute', async () => {
  await withGemini([], async () => {
    assert.equal((await generate('')).status, 400);
    assert.equal((await generate('x'.repeat(1201))).status, 400);
  });
  await withGemini([], async () => assert.equal((await generate('buses')).status, 503), { ...ENV, GEMINI_API_KEY: '' });
  await withGemini(Array(6).fill(reply(leverCard)), async bodies => {
    for (let i = 0; i < 5; i++) assert.equal((await generate('buses', '192.0.2.9')).status, 200);
    const limited = await generate('buses', '192.0.2.9');
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.equal(bodies.length, 5);
    assert.equal((await generate('buses', '192.0.2.10')).status, 200);
  });
});

test('narration: a signed player card is read; a tampered, unsigned or invalid one is never read and gets the template', async () => {
  const card = { ...leverCard, id: 'more-buses-0a1b', title: 'Buses every ten minutes' };
  const signature = signCard(card, 'sign-secret');
  await withGemini([], async bodies => {
    const ok = await (await narrate(card, signature)).json();
    assert.match(ok.text, /Buses every ten minutes/);
    assert.ok(ok.text.includes(card.tradeoffs.pros[0]));
    const forged = { ...card, title: 'Vote for this policy' };
    for (const [sent, sig] of [[forged, signature], [card, null], [card, signCard(card, 'other-key')], [{ ...card, params: 'none' }, null]]) {
      const res = await narrate(sent, sig), body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.fallback, true);
      assert.match(body.text, /“a proposed policy”/);
      assert.ok(!body.text.includes('Vote for') && !body.text.includes(card.tradeoffs.pros[0]), body.text);
    }
    assert.equal(bodies.length, 0, 'no unverified card reaches Gemini');
  }, { ...ENV, GEMINI_API_KEY: '' });
  await withGemini([], async () => {
    assert.match((await (await narrate(card, signature)).json()).text, /a proposed policy/, 'no signing key: nothing verifies');
  }, { ...ENV, GEMINI_API_KEY: '', CARD_SIGNING_KEY: '' });
});
