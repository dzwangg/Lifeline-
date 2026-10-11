// /api/ask with Gemini mocked: the guardrails that run before Gemini, what is done with each kind of reply, and the limits
// applied after it (lever limits, the budget ceiling, slider ranges, driver bounds).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POST, clampCard, preCheck, settle } from '../api/ask.js';
import { loadContext } from '../api/policies.js';
import { cards } from './data.js';

const ctx = await loadContext();
const byId = id => structuredClone(cards.find(c => c.id === id));
const busCard = byId('bus-frequency-boost');
// a library card at a new default, so it isn't a redraft of the library's own. Gemini cites evidence by number now, so the
// copy drops the library's evidence and the con that quotes a number from it.
const { evidence: _, ...busBody } = busCard;
const buses = { ...busBody, id: 'twice-the-buses', params: [{ ...busCard.params[0], default: 1.5 }], tradeoffs: { ...busCard.tradeoffs, cons: busCard.tradeoffs.cons.slice(0, 1) } };
const directed = (card, direction = 'increase') => ({ ...card, levers: card.levers.map(l => ({ ...l, direction })) });
const ENV = { GEMINI_API_KEY: 'gem-secret', GEMINI_MODEL: 'gemini-test', GEMINI_MODEL_CARDS: '', GEMINI_FALLBACK_MODELS: '', GEMINI_THINKING_LEVEL: '', DEMO_MODE: '', CARD_SIGNING_KEY: 'sign-secret' };

/** Runs fn with a fake fetch that answers Gemini with `replies` in turn; fn gets the number of Gemini calls so far. */
async function withGemini(replies, fn, env = ENV) {
  const saved = { fetch: globalThis.fetch, env: { ...process.env } };
  let calls = 0;
  Object.assign(process.env, env);
  globalThis.fetch = async url => {
    assert.match(String(url), /generativelanguage/, 'only Gemini is called');
    calls++;
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(replies.shift()) }] } }] });
  };
  try { await fn(() => calls); } finally { globalThis.fetch = saved.fetch; process.env = saved.env; }
}
let ips = 0;
const askCity = (prompt, extra = {}) => POST(new Request('http://localhost/api/ask',
  { method: 'POST', headers: { 'x-forwarded-for': `10.9.0.${++ips}` }, body: JSON.stringify({ prompt, ...extra }) }));

test('places outside Chapel Hill: acting on one is refused before Gemini; naming one in passing is not', () => {
  for (const p of ['Unlock the Durham area', 'Expand the map to Carrboro', 'Build 500 homes in Durham', 'run a bus line to RTP', 'annex the town of Hillsborough'])
    assert.equal(preCheck(p)?.refusal?.kind, 'outside_area', p);
  assert.equal(preCheck('Like Durham did, cut parking minimums downtown'), null);
});

test('forcing people, or decreeing a number the simulator computes, is refused before Gemini', () => {
  for (const p of ['Force 20000 residents to emigrate out of Chapel Hill', 'make 20,000 people leave', 'evict all the students', 'deport immigrants'])
    assert.equal(preCheck(p)?.refusal?.kind, 'coercive', p);
  for (const p of ['Set rent to $900 everywhere', 'make the population exactly 80000', 'freeze rents at 1500'])
    assert.equal(preCheck(p)?.refusal?.kind, 'sets_outcome', p);
  for (const p of ['Cap rent increases for existing tenants at 3% a year', 'limit rent growth to 2% a year', 'cap rent hikes at 5%'])
    assert.equal(preCheck(p), null, `${p}: a policy, for Gemini`);
});

test('plain what-ifs need no Gemini call, and stay inside their bounds', () => {
  assert.deepEqual(preCheck('What if inflation is 6%?').drivers, { inflation: 6 });
  assert.deepEqual(preCheck("Use the Fed's inflation projection").drivers, { inflation: 'fed' });
  assert.deepEqual(preCheck('what happens if UNC shrinks 2%').drivers, { uncJobsGrowth: -2 });
  assert.deepEqual(preCheck('construction costs rise 20%').drivers, { constructionCost: 20 });
  const capped = preCheck('inflation hits 90%');
  assert.deepEqual(capped.drivers, { inflation: 15 });
  assert.match(capped.notes[0], /capped at 15/);
  assert.deepEqual(preCheck('reset the what-ifs').drivers, {});
  assert.equal(preCheck('What if inflation is 6% and we double the buses?'), null, 'mixed prompts go to Gemini');
});

test('a what-if is answered with no Gemini key; anything needing Gemini says it is off', async () => {
  await withGemini([], async calls => {
    const ok = await (await askCity('what if inflation is 5%')).json();
    assert.equal(ok.kind, 'scenario');
    const off = await askCity('Make buses come every 8 minutes');
    assert.equal(off.status, 503);
    assert.equal(calls(), 0);
  }, { ...ENV, GEMINI_API_KEY: '' });
});

test('policy: a drafted card is checked, signed and returned; lever values past the limits are capped first', async () => {
  const card = directed(buses);
  await withGemini([{ intent: 'policy', card, unmodeled: ['night service'], reply: 'Drafted more frequent buses.' }], async calls => {
    const r = await (await askCity('Make the buses come more often')).json();
    assert.equal(r.kind, 'policy');
    assert.match(r.card.id, /^twice-the-buses-[0-9a-f]{4}$/);
    assert.match(r.signature, /^[0-9a-f]{64}$/);
    assert.deepEqual(r.unmodeled, ['night service']);
    assert.equal(calls(), 1);
  });
  const huge = { ...buses, params: [{ ...buses.params[0], max: 10, default: 8 }] };
  const { card: capped, notes } = clampCard(huge);
  assert.deepEqual([capped.params[0].max, capped.params[0].default], [3, 3]);
  assert.match(notes[0], /Capped bus service hours at 3/);
});

test('policy: a card past half the general fund a year is refused as impossible_scale', () => {
  const grants = directed({ ...byId('small-business-support-grant'), id: 'huge-grants', summary: 'Pays every storefront business a yearly grant.',
    tradeoffs: { pros: ['Shops get money directly.'], cons: ['The Town pays for it every year.'] },
    levers: [{ lever: 'budget.annualCost', value: 50e6 }, { lever: 'business.supportGrants', value: 20e6 }] });
  const { result } = settle({ intent: 'policy', card: grants, unmodeled: [], reply: 'x' }, 'give every shop money', ctx, []);
  assert.equal(result.kind, 'refuse');
  assert.equal(result.refusal.kind, 'impossible_scale');
});

test('a refusal from Gemini passes through with its kind; an unknown kind becomes not_modeled', () => {
  const r = settle({ intent: 'refuse', refusal: { kind: 'beyond_powers', reason: 'North Carolina bars local rent control.', alternative: 'Try adding homes.' }, unmodeled: [], reply: '' }, 'rent control', ctx, []).result;
  assert.deepEqual([r.kind, r.refusal.kind], ['refuse', 'beyond_powers']);
  assert.equal(settle({ intent: 'refuse', refusal: { kind: 'whatever', reason: 'No.' }, unmodeled: [], reply: '' }, 'x', ctx, []).result.refusal.kind, 'not_modeled');
});

test('adjust: only applied cards and their params, clamped to the slider range', () => {
  const active = [{ id: 'bus-frequency-boost', title: 'More frequent buses', params: [{ key: 'service', label: 'Bus service', min: 1, max: 1.5, value: 1.25 }] }];
  const { result } = settle({ intent: 'adjust', adjust: [{ cardId: 'bus-frequency-boost', param: 'service', value: 4 }, { cardId: 'not-applied', param: 'x', value: 1 }], unmodeled: [], reply: 'More buses.' }, 'max out the buses', ctx, active);
  assert.deepEqual(result.adjust, [{ cardId: 'bus-frequency-boost', param: 'service', value: 1.5 }]);
  assert.match(result.notes[0], /only goes from 1 to 1.5/);
  assert.deepEqual(settle({ intent: 'adjust', adjust: [{ cardId: 'nope', param: 'x', value: 1 }], unmodeled: [], reply: '' }, 'x', ctx, active).errors.length, 1);
});

test('scenario and mixed replies: drivers are bounded and unknown ones dropped; an outside place gets a note', () => {
  const { result } = settle({ intent: 'scenario', drivers: [{ name: 'inflation', value: '40' }, { name: 'uncJobsGrowth', value: '2' }, { name: 'bogus', value: '9' }], unmodeled: [], reply: 'Set.' }, 'inflation 40% and UNC grows 2% like Durham', ctx, []);
  assert.deepEqual(result.drivers, { inflation: 15, uncJobsGrowth: 2 });
  assert.ok(result.notes.some(n => /nothing in Durham changes/.test(n)));
  const fed = settle({ intent: 'scenario', drivers: [{ name: 'inflation', value: 'fed' }], unmodeled: [], reply: 'Set.' }, 'fed path', ctx, []).result;
  assert.deepEqual(fed.drivers, { inflation: 'fed' });
});

test('a bad first reply gets one retry with the problems; an evaluative reply text is replaced', async () => {
  await withGemini([{ intent: 'policy', card: null, unmodeled: [], reply: '' }, { intent: 'policy', card: directed(buses), unmodeled: [], reply: 'Great news, buses for all!' }], async calls => {
    const r = await (await askCity('better buses please')).json();
    assert.equal(r.kind, 'policy');
    assert.equal(calls(), 2);
    assert.doesNotMatch(r.reply, /great/i);
  });
});

test('requests are validated: prompt length and the shape of active cards', async () => {
  assert.equal((await askCity('')).status, 400);
  assert.equal((await askCity('x'.repeat(1001))).status, 400);
  assert.equal((await askCity('hi', { active: [{ id: 3 }] })).status, 400);
});

test('a per-home construction subsidy without its yearly budget is sent back, since it would do nothing', async () => {
  const { limitErrors } = await import('../api/policies.js');
  assert.match(limitErrors({ params: [], levers: [{ lever: 'housing.subsidyPerUnit', value: 50000 }] }).join(), /does nothing without housing\.subsidyCap/);
  assert.deepEqual(limitErrors({ params: [], levers: [{ lever: 'housing.subsidyPerUnit', value: 50000 }, { lever: 'housing.subsidyCap', value: 2e6 }] }), []);
});

test('the budget ceiling counts a one-time cost once, in the year it is paid', async () => {
  const { peakCost } = await import('../api/ask.js');
  const library = { id: 'library', title: 'Library', summary: 'A library.', params: [], timing: { delayQuarters: 2, phaseInQuarters: 1 },
    levers: [{ lever: 'budget.oneTimeCost', value: 30e6 }, { lever: 'budget.annualCost', value: 2e6 }], decider: { body: 'Town Council', how: [] }, tradeoffs: { pros: ['x'], cons: ['y'] } };
  // year 0: the $30M build plus half a year of the $2M running cost, which starts two quarters in
  assert.ok(Math.abs(peakCost(library, ctx) - 31e6) < 1, `peak ${peakCost(library, ctx)}`);
});

test('what-if values written as text are read as numbers, and an unparseable reply is retried', async () => {
  const { result } = settle({ intent: 'scenario', drivers: { uncJobsGrowth: '0', inflation: '3%', regionalGrowth: 'lots' }, unmodeled: [], reply: 'Set.' }, 'UNC stops growing, 3% inflation', ctx, []);
  assert.deepEqual(result.drivers, { uncJobsGrowth: 0, inflation: 3 });
  assert.deepEqual(settle({ intent: 'scenario', drivers: { inflation: 'fed' }, unmodeled: [], reply: 'Set.' }, 'fed', ctx, []).result.drivers, { inflation: 'fed' });
  const pairs = settle({ intent: 'scenario', drivers: [{ name: 'uncJobsGrowth', value: '0' }, { name: 'inflation', value: 'fed' }], unmodeled: [], reply: 'Set.' }, 'x', ctx, []);
  assert.deepEqual(pairs.result.drivers, { uncJobsGrowth: 0, inflation: 'fed' }, 'the { name, value } list Gemini returns');
  await withGemini([null, { intent: 'scenario', drivers: [{ name: 'uncJobsGrowth', value: '0' }], unmodeled: [], reply: 'Set.' }], async calls => {
    const r = await (await askCity('What if UNC hiring stops cold?')).json();
    assert.deepEqual([r.kind, r.drivers, calls()], ['scenario', { uncJobsGrowth: 0 }, 2]);
  });
});

test('a policy reply without its card falls back to the card-only drafter and keeps the what-ifs', async () => {
  const tax = byId('property-tax-adjustment'), drafted = { ...tax, id: 'tax-cut-three', summary: 'Lowers the property tax rate.', evidence: undefined, params: [{ ...tax.params[0], default: -3 }], levers: tax.levers.map(l => ({ ...l, direction: 'decrease' })) };
  await withGemini([{ intent: 'policy', drivers: [{ name: 'inflation', value: '4' }], unmodeled: [], reply: 'Cut the tax and set inflation to 4%.' },
    { card: drafted, unmodeled: [], unsupportedReason: null }], async calls => {
    const r = await (await askCity('With 4% inflation, cut the property tax by 3 cents')).json();
    assert.equal(r.kind, 'policy');
    assert.match(r.card.id, /^tax-cut-three-/);
    assert.deepEqual(r.drivers, { inflation: 4 });
    assert.equal(calls(), 2);
  });
});

test('a draft identical to a library card applies that card instead of a copy, keeping the what-ifs', () => {
  const copy = directed({ ...busCard, id: 'more-buses-again' });
  const { result } = settle({ intent: 'policy', card: copy, drivers: [{ name: 'inflation', value: '4' }], unmodeled: [], reply: 'x' }, 'more buses and 4% inflation', ctx, []);
  assert.deepEqual([result.kind, result.library, result.card, result.drivers], ['policy', 'bus-frequency-boost', undefined, { inflation: 4 }]);
  assert.match(result.reply, /already in the library: /);
});

test('a reply that states a number nobody gave (a forecast) is replaced; numbers from the prompt or the card pass', () => {
  const card = directed(buses);
  const invented = settle({ intent: 'policy', card, unmodeled: [], reply: 'This will lower rent by 20% and add 500 riders.' }, 'run buses more often', ctx, []).result;
  assert.doesNotMatch(invented.reply, /20%|500/);
  const fine = settle({ intent: 'policy', card, unmodeled: [], reply: 'Drafted bus service at 1.5 times today.' }, 'run buses more often', ctx, []).result;
  assert.equal(fine.reply, 'Drafted bus service at 1.5 times today.');
  const question = settle({ intent: 'question', unmodeled: [], reply: 'Rents would fall 12% within two years.' }, 'what happens to rent if we upzone?', ctx, []).result;
  assert.match(question.reply, /answers that by running it/);
});
