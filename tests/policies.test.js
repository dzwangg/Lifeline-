// /api/policies with Gemini mocked, and player cards in /api/narration. Selector and no-change checks from William Chen's
// tests/create-policy-card.test.js (origin/William, 0f80831).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { POST, checkCard, directionErrors, generateCard, loadContext, tidy } from '../api/policies.js';
import { POST as narrationPOST, signCard } from '../api/narration.js';
import { cards } from './data.js';

const ctx = await loadContext();
const sample = JSON.parse(readFileSync(new URL('./fixtures/narration-sample.json', import.meta.url), 'utf8'));
const byId = id => structuredClone(cards.find(c => c.id === id));
const zoneCard = { ...byId('corridor-midrise'), id: 'corridor-apartments' };
const leverCard = { ...byId('bus-frequency-boost'), id: 'more-buses' };
const directed = (card, direction) => ({ ...card, levers: card.levers.map(l => ({ ...l, direction })) }); // as Gemini replies
const taxCard = (cents, direction) => directed({ ...byId('property-tax-adjustment'), id: 'tax-change',
  params: [{ ...byId('property-tax-adjustment').params[0], default: cents }] }, direction);
const ENV = { GEMINI_API_KEY: 'gem-secret', GEMINI_MODEL: 'gemini-test', GEMINI_MODEL_CARDS: '', GEMINI_FALLBACK_MODELS: '', GEMINI_THINKING_LEVEL: '', DEMO_MODE: '', CARD_SIGNING_KEY: 'sign-secret',
  ELEVENLABS_API_KEY: '', ELEVENLABS_VOICE_ID: '' };
const reply = (card, unmodeled = [], unsupportedReason = null) => JSON.stringify({ card, unmodeled, unsupportedReason });

/** Runs fn with these env vars and a fake fetch that answers Gemini with `drafts` in turn; fn gets the request bodies it saw,
 *  each with the model it went to as `model`. */
async function withGemini(drafts, fn, env = ENV) {
  const saved = { fetch: globalThis.fetch, env: { ...process.env } };
  const bodies = [];
  Object.assign(process.env, env);
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /generativelanguage/, 'only Gemini is called');
    bodies.push({ ...JSON.parse(init.body), model: String(url).match(/models\/([^:]+):/)[1] });
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
  await withGemini([reply(directed(leverCard, 'increase'), ['fare-free rides'])], async () => {
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
      unsupportedReason: 'The simulator has no rent regulation.', unmodeled: ['rent limits'], cached: false });
    assert.equal(bodies.length, 1);
  });
});

test('generate: bad requests, no key, and 5 drafts per IP per minute', async () => {
  await withGemini([], async () => {
    assert.equal((await generate('')).status, 400);
    assert.equal((await generate('x'.repeat(1201))).status, 400);
  });
  await withGemini([], async () => assert.equal((await generate('buses')).status, 503), { ...ENV, GEMINI_API_KEY: '' });
  await withGemini(Array(6).fill(reply(directed(leverCard, 'increase'))), async bodies => {
    for (let i = 0; i < 5; i++) assert.equal((await generate(`buses, take ${i}`, '192.0.2.9')).status, 200); // distinct ideas: no cache hits
    const limited = await generate('buses, take 5', '192.0.2.9');
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.equal(bodies.length, 5);
    assert.equal((await generate('buses, take 6', '192.0.2.10')).status, 200);
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

test('direction: "cut property tax 3 cents" must lower the rate, and a draft that raises it is retried', async () => {
  await withGemini([reply(taxCard(3, 'decrease')), reply(taxCard(-3, 'decrease'))], async bodies => {
    const { card } = await generateCard('cut property tax 3 cents');
    assert.equal(card.params[0].default, -3);
    assert.ok(!('direction' in card.levers[0]), 'the declared direction is dropped from the card');
    assert.equal(bodies.length, 2);
    assert.match(bodies[1].contents.at(-1).parts[0].text,
      /levers\[0\]: the idea asks to decrease property tax rate change, but 3 ¢ per \$100 would increase it \(the default of param cents_per_100\)/);
  });
});

test('direction: "raise property tax 3 cents" passes at +3 in one call, and is retried at -3', async () => {
  await withGemini([reply(taxCard(3, 'increase'))], async bodies => {
    assert.equal((await generateCard('raise property tax 3 cents')).card.params[0].default, 3);
    assert.equal(bodies.length, 1);
  });
  await withGemini([reply(taxCard(-3, 'increase')), reply(taxCard(-3, 'increase'))], async () => {
    await assert.rejects(generateCard('raise property tax 3 cents'), err => /would decrease it/.test(err.extra.problems.join()));
  });
});

test('direction: multipliers compare with 1, caps can only lower, and a missing direction is asked for', () => {
  const card = { params: [] };
  assert.deepEqual(directionErrors([{ lever: 'transit.serviceMultiplier', value: 2, direction: 'increase' }, { lever: 'housing.parkingMinimum', value: 0.5, direction: 'decrease' }], card), []);
  assert.match(directionErrors([{ lever: 'transit.serviceMultiplier', value: 0.8, direction: 'increase' }], card)[0], /would decrease it/);
  assert.match(directionErrors([{ lever: 'transit.serviceMultiplier', value: 1, direction: 'increase' }], card)[0], /leave it unchanged/);
  assert.match(directionErrors([{ lever: 'housing.parkingMinimum', value: 2, direction: 'increase' }], card)[0], /can only lower it/);
  assert.match(directionErrors([{ lever: 'tax.rateDelta', value: -3 }], card)[0], /levers\[0\]\.direction: must be/);
});

test('protect and parking cards: a protect card passes when it blocks a catalog card; parking can become homes', () => {
  const protect = { ...byId('protect-remaining-forest'), id: 'keep-corridor-woods', zoneRules: [{ where: 'tag:corridor', protect: 'forest' }] };
  assert.deepEqual(checkCard(protect, 'protect the corridor woods', ctx), []);
  const idle = { ...protect, zoneRules: [{ where: 'tag:downtown', protect: 'parking' }] }; // no catalog card builds on parking
  assert.match(checkCard(idle, '', ctx).join('\n'), /changes no metric over 10 years, and its protect rules block no other card/);
  assert.match(checkCard({ ...protect, zoneRules: [{ where: 'tag:downtown', protect: 'forest' }] }, '', ctx).join('\n'), /no forest parcel matches tag:downtown/);
  const lots = { ...zoneCard, id: 'campus-lot-homes', zoneRules: [{ where: 'tag:near_campus', from: 'parking', to: 'mid_res', ratePerYear: 0.2, capParam: 'acres_released' }] };
  assert.deepEqual(checkCard(lots, '', ctx), []);
  assert.match(checkCard({ ...lots, zoneRules: [{ ...lots.zoneRules[0], from: 'forest' }] }, '', ctx).join('\n'), /no forest parcel matches tag:near_campus/);
});

test('cards call GEMINI_MODEL_CARDS, else GEMINI_MODEL, else gemini-3-flash-preview', async () => {
  for (const [env, model] of [[{ GEMINI_MODEL_CARDS: 'gemini-cards' }, 'gemini-cards'], [{}, 'gemini-test'], [{ GEMINI_MODEL: '' }, 'gemini-3-flash-preview']])
    await withGemini([reply(zoneCard)], async bodies => {
      await generateCard('apartments');
      assert.equal(bodies[0].model, model);
    }, { ...ENV, ...env });
});

test('cache: an idea asked again, in any case or spacing, is served without Gemini or the rate limit, with a new id and signature', async () => {
  await withGemini([reply(zoneCard)], async bodies => {
    const first = await (await generate('Mid-rise  homes by the corridor woods', '192.0.2.20')).json();
    for (let i = 0; i < 6; i++) await generate(`other idea ${i}`, '192.0.2.20'); // spends this IP's 5 a minute (and the mock's one draft)
    const again = await generate('  mid-rise homes BY the corridor woods ', '192.0.2.20'), body = await again.json();
    assert.equal(again.status, 200);
    assert.deepEqual([first.cached, body.cached], [false, true]);
    assert.notEqual(body.card.id, first.card.id);
    assert.equal(body.card.id.replace(/-[0-9a-f]{4}$/, ''), 'corridor-apartments');
    assert.equal(body.signature, signCard(body.card, 'sign-secret'));
    assert.equal(bodies.filter(b => /mid-rise/i.test(b.contents[0].parts[0].text)).length, 1);
  });
});

test('cache: an unsupported verdict is kept; a draft that failed its checks is not', async () => {
  await withGemini([reply(null, ['rent limits'], 'No rent regulation.')], async bodies => {
    assert.equal((await generate('Rent control please')).status, 422);
    const again = await generate('rent control please');
    assert.deepEqual([again.status, (await again.json()).cached], [422, true]);
    assert.equal(bodies.length, 1);
  });
  const bad = reply({ ...zoneCard, title: 'Great homes' });
  await withGemini([bad, bad, bad, bad], async bodies => {
    assert.equal((await generate('great homes on the edge')).status, 422);
    assert.equal((await generate('great homes on the edge')).status, 422);
    assert.equal(bodies.length, 4, 'two drafts and their retries');
  });
});
