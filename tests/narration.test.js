import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { POST, badNumbers, hashInput, loadCards, parseInput, speakable, speechKey, templateRecap } from '../api/narration.js';

// A frozen SimResult (the stub card, as of the narration PR), so these tests don't move whenever the models do.
// The last test checks the current one, tests/fixtures/sim-result.json.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/narration-sample.json', import.meta.url), 'utf8'));
const cards = await loadCards(false);
const { input } = parseInput(fixture, cards);
// A distinct request per handler test (the stub card's acres vary), so the handler's in-memory cache never leaks between tests.
const variant = acres => ({ policies: [{ id: 'stub-card', params: { acres_released: acres } }], years: fixture.years, deltas: fixture.deltas });
const inputOf = body => parseInput(body, cards).input;

const GOOD = 'Over 10 years, the simulated policy adds homes, from 23,713 to about 24,200, a 2.15% rise. Compared with no new policy, median rent is '
  + 'about $1,670 instead of $1,714, and about 4,060 households are priced out instead of about 4,400. Tree cover falls from 46.9% to about 43%, '
  + 'and yearly tax revenue grows to $69.8 million. Supporters note that more homes are built; critics note that forest is cleared.';
const BAD = 'Homes rise by 509 and rent falls $46 by 2035.';
const KEYS = { GEMINI_API_KEY: 'gem-secret', GEMINI_MODEL: 'gemini-test', ELEVENLABS_API_KEY: 'el-secret', ELEVENLABS_VOICE_ID: 'voice', ELEVENLABS_MODEL: '', GEMINI_THINKING_LEVEL: '', DEMO_MODE: '' };

/** Runs fn with these env vars and a fake fetch that answers Gemini with `drafts` in turn; returns the calls it saw. */
async function withMocks(env, drafts, fn) {
  const saved = { fetch: globalThis.fetch, env: { ...process.env } };
  const calls = [];
  Object.assign(process.env, env);
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('generativelanguage')) {
      const draft = drafts.shift();
      return draft instanceof Response ? draft : Response.json({ candidates: [{ content: { parts: [{ text: draft }] } }] });
    }
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } });
  };
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = saved.fetch;
    process.env = saved.env;
  }
}
let ips = 0; // a fresh IP per request unless a test picks one, so the rate limit only bites where it is tested
const send = (body, ip = `10.0.0.${++ips}`) => POST(new Request('http://localhost/api/narration',
  { method: 'POST', headers: { 'x-forwarded-for': ip }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const post = async (body, ip) => {
  const res = await send(body, ip);
  return { status: res.status, ...(await res.json()) };
};

test('number check: rounding, signs, %, $, commas and scale words pass', () => {
  assert.deepEqual(badNumbers(GOOD, input), []);
  assert.deepEqual(badNumbers('Rent changes -2.68%, homes reach 24,222 (about 24,000), revenue about $70 million, over 10 years, on 130 acres.', input), []);
});

test('number check: anchor-style rounded figures pass, wrong roundings do not', () => {
  const anchor = 'Homes rise to about 24,200, rent is about $1,670 a month, about 4,100 households are priced out, and tree cover falls to about 43%. '
    + 'Tax revenue climbs to about $70 million, or $69.8 million, and commutes are near 20 minutes.';
  assert.deepEqual(badNumbers(anchor, input), []);
  assert.deepEqual(badNumbers('Tax revenue reaches about $75 million, or $69.9 million, and homes about 24,100.', input), ['75 million', '69.9 million', '24,100']);
});

test('number check: names numbers that are not in the input, even derived ones', () => {
  assert.deepEqual(badNumbers(BAD, input), ['509', '46', '2035']);
  assert.deepEqual(badNumbers('Tree cover falls 28.9%, homes reach 24,300.', input), ['28.9', '24,300']);
});

test('hash is stable across key order and extra fields, and changes with the content', () => {
  const reordered = { tradeoffs: input.tradeoffs, deltas: input.deltas.map(d => Object.fromEntries(Object.entries(d).reverse())), years: input.years, policies: input.policies };
  assert.equal(hashInput(parseInput(reordered, cards).input), hashInput(input));
  assert.match(hashInput(input), /^[0-9a-f]{16}$/);
  assert.notEqual(hashInput(inputOf(variant(1))), hashInput(input));
});

test('template recap is deterministic, short, covers every delta and both sides, and passes the number check', () => {
  const text = templateRecap(input);
  assert.equal(text, templateRecap(structuredClone(input)));
  for (const s of ['10-year simulation', 'homes rise 2.2% to about 24,200', 'tree cover falls from 46.9% to 43%',
    'Compared with no new policy, median rent is $1,668 a month instead of $1,714', 'households priced out are about 4,060 instead of about 4,400', 'STUB pro', 'STUB con'])
    assert.ok(text.includes(s), s);
  const words = text.split(/\s+/).length;
  assert.ok(words >= 60 && words <= 90, `${words} words`);
  assert.deepEqual(badNumbers(text, input), []);
});

test('deltas without comparedWith (runScenario output) read as changes since year 0', () => {
  const { input: plain } = parseInput({ ...fixture, deltas: fixture.deltas.map(({ comparedWith, ...d }) => d) }, cards);
  assert.ok(plain.deltas.every(d => d.comparedWith === 'year 0'));
  assert.ok(!templateRecap(plain).includes('no new policy'));
  assert.ok(templateRecap(plain).includes('median rent falls 2.7% to $1,668 a month'));
});

test('handler: Gemini text read aloud, then served from cache', async () => {
  await withMocks(KEYS, [GOOD], async calls => {
    assert.deepEqual(await post(variant(1)), { status: 200, text: GOOD, audio: 'AQID', cached: false, fallback: false });
    assert.equal(calls.length, 2);
    const [g, el] = calls;
    assert.equal(g.init.headers['x-goog-api-key'], 'gem-secret');
    assert.match(g.url, /models\/gemini-test:generateContent$/);
    assert.deepEqual(JSON.parse(g.init.body).generationConfig, { temperature: 0.2, thinkingConfig: { thinkingLevel: 'minimal' } });
    assert.match(el.url, /text-to-speech\/voice\?/);
    assert.deepEqual(JSON.parse(el.init.body), { text: speakable(GOOD), model_id: 'eleven_flash_v2_5', apply_text_normalization: 'on' });
    assert.match(JSON.parse(el.init.body).text, /twenty-four thousand two hundred, a two point one five percent rise/);
    assert.deepEqual(await post(variant(1)), { status: 200, text: GOOD, audio: 'AQID', cached: true, fallback: false });
    assert.equal(calls.length, 2);
  });
});

test('handler: one retry listing the bad numbers, then the template', async () => {
  await withMocks(KEYS, [BAD, GOOD], async calls => {
    const r = await post(variant(2));
    assert.equal(r.text, GOOD);
    assert.equal(r.fallback, false);
    assert.match(JSON.parse(calls[1].init.body).contents.at(-1).parts[0].text, /509, 46, 2035/);
  });
  await withMocks(KEYS, [BAD, BAD], async calls => {
    const r = await post(variant(3));
    assert.deepEqual([r.text, r.audio, r.fallback], [templateRecap(inputOf(variant(3))), 'AQID', true]);
    assert.equal(calls.filter(c => c.url.includes('generativelanguage')).length, 2);
  });
});

test('handler: evaluative words get the same retry, naming the words, then the template', async () => {
  const SLANTED = GOOD.replace('Supporters note that', 'Unfortunately, critics note that').replace('more homes are built', 'more homes are built, which helps renters');
  await withMocks(KEYS, [SLANTED, GOOD], async calls => {
    const r = await post(variant(44));
    assert.equal(r.text, GOOD);
    assert.match(JSON.parse(calls[1].init.body).contents.at(-1).parts[0].text, /evaluative or advocacy: Unfortunately, helps\./);
  });
  await withMocks(KEYS, [SLANTED, SLANTED], async () => {
    const r = await post(variant(45));
    assert.deepEqual([r.text, r.fallback], [templateRecap(inputOf(variant(45))), true]);
  });
});

test('handler: GEMINI_THINKING_LEVEL is sent, and a 400 about it retries once without thinkingConfig', async () => {
  const rejected = () => Response.json({ error: { code: 400, message: 'Thinking level LOW is not supported for this model.' } }, { status: 400 });
  const warn = console.warn;
  console.warn = () => {};
  try {
    await withMocks({ ...KEYS, GEMINI_THINKING_LEVEL: 'low' }, [rejected(), GOOD], async calls => {
      const r = await post(variant(8));
      assert.deepEqual([r.text, r.fallback], [GOOD, false]);
      assert.deepEqual(calls.slice(0, 2).map(c => JSON.parse(c.init.body).generationConfig), [{ temperature: 0.2, thinkingConfig: { thinkingLevel: 'low' } }, { temperature: 0.2 }]);
    });
    await withMocks(KEYS, [Response.json({ error: { code: 400, message: 'Invalid JSON payload.' } }, { status: 400 }), GOOD], async calls => {
      const r = await post(variant(9));
      assert.deepEqual([r.text, r.fallback], [templateRecap(inputOf(variant(9))), true]); // other 400s are not retried
      assert.equal(calls.filter(c => c.url.includes('generativelanguage')).length, 1);
    });
  } finally {
    console.warn = warn;
  }
});

test('handler: API errors fall back to the template, are not cached, and never log keys', async () => {
  const logged = [];
  const error = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    await withMocks(KEYS, [new Response('nope', { status: 500 }), GOOD], async calls => {
      const r = await post(variant(4));
      assert.deepEqual([r.text, r.fallback, r.cached], [templateRecap(inputOf(variant(4))), true, false]);
      assert.equal((await post(variant(4))).text, GOOD); // the failure was not cached
      assert.equal(calls.length, 4); // Gemini 500 + template read aloud, then Gemini + audio
    });
  } finally {
    console.error = error;
  }
  assert.ok(logged.some(l => l.includes('500')));
  assert.ok(!logged.some(l => l.includes('secret')));
});

test('handler: missing keys give the template with no audio; DEMO_MODE never calls out', async () => {
  const none = { GEMINI_API_KEY: '', ELEVENLABS_API_KEY: '', DEMO_MODE: '' };
  await withMocks(none, [], async calls => {
    assert.deepEqual(await post(variant(5)), { status: 200, text: templateRecap(inputOf(variant(5))), audio: null, cached: false, fallback: true });
    assert.equal(calls.length, 0);
  });
  await withMocks({ ...KEYS, DEMO_MODE: '1' }, [GOOD], async calls => {
    assert.deepEqual(await post(variant(6)), { status: 200, text: templateRecap(inputOf(variant(6))), audio: null, cached: false, fallback: true });
    assert.equal(calls.length, 0);
  });
});

test('handler: a committed demo clip is served first, but only if its mp3 says the current speech text', async () => {
  const dir = new URL('../demo-audio/', import.meta.url);
  const clip = (acres, mp3Name) => {
    const key = hashInput(inputOf(variant(acres))), text = `Rent is $1,670, case ${acres}.`;
    writeFileSync(new URL(`${key}.json`, dir), JSON.stringify({ text, fallback: false }));
    writeFileSync(new URL(`${mp3Name(key, text)}.mp3`, dir), Buffer.from([1, 2, 3]));
    return [`${key}.json`, `${mp3Name(key, text)}.mp3`];
  };
  mkdirSync(dir, { recursive: true });
  const files = [...clip(7, (key, text) => speechKey(text)), ...clip(10, key => key)]; // 10: named the old way, by input hash
  try {
    await withMocks({ ...KEYS, DEMO_MODE: '1' }, [], async calls => {
      assert.deepEqual(await post(variant(7)), { status: 200, text: 'Rent is $1,670, case 7.', audio: 'AQID', cached: true, fallback: false });
      assert.deepEqual(await post(variant(10)), { status: 200, text: templateRecap(inputOf(variant(10))), audio: null, cached: false, fallback: true });
      assert.equal(calls.length, 0);
    });
  } finally {
    for (const f of files) rmSync(new URL(f, dir));
    try { rmdirSync(dir); } catch {} // only if this test created it and it is empty
  }
});

test('speakable: numbers in the words a news anchor says', () => {
  const cases = {
    '$1,670': 'sixteen hundred seventy dollars',
    '$69.8 million': 'sixty-nine point eight million dollars',
    '43%': 'forty-three percent',
    '20 minutes': 'twenty minutes',
    'about 4,060': 'about four thousand sixty',
    '130 acres': 'a hundred thirty acres',
    // decimals
    '2.15%': 'two point one five percent',
    '0.78%': 'zero point seven eight percent',
    '19.5 minutes': 'nineteen point five minutes',
    // negative changes, with a hyphen or a minus sign
    'rent changes -2.68%': 'rent changes minus two point six eight percent',
    '(−7.7%)': '(minus seven point seven percent)',
    // the hundreds style is for dollars from 1,100 to 9,999 only
    '$1,100': 'eleven hundred dollars',
    '$9,999': 'ninety-nine hundred ninety-nine dollars',
    '$1,050': 'one thousand fifty dollars',
    '$2,000': 'two thousand dollars',
    '1,670 homes': 'one thousand six hundred seventy homes',
    // hyphens that are not minus signs
    'the 15-501 corridor over a 10-year span': 'the fifteen-five-oh-one corridor over a ten-year span',
  };
  for (const [text, said] of Object.entries(cases)) assert.equal(speakable(text), said, text);
  assert.doesNotMatch(speakable(templateRecap(input)), /\d/);
});

test('handler: rejects bad input with 400', async () => {
  assert.equal((await post('not json')).status, 400);
  const r = await post({ ...variant(11), years: 0, deltas: [{ metric: 'vibes', baseline: 1, final: 2, changePct: 100 }] });
  assert.equal(r.status, 400);
  assert.match(r.error, /years/);
  assert.match(r.error, /deltas/);
  assert.equal((await post({ ...variant(11), deltas: [{ ...input.deltas[0], comparedWith: 'last year' }] })).status, 400);
});

test('cards: ids must be in data/cards.index.json (or the stub, outside production), with that card\'s params in range', async () => {
  const body = (id, params = {}) => ({ policies: [{ id, params }], years: 10, deltas: fixture.deltas });
  const card = JSON.parse(readFileSync(new URL('../data/policies/core-infill.json', import.meta.url), 'utf8'));
  assert.deepEqual(parseInput(body('core-infill'), cards).input.tradeoffs, card.tradeoffs);
  assert.equal(parseInput(body('core-infill'), cards).input.policies[0].title, card.title);
  for (const bad of [body('made-up'), body('stub-card', { acres_released: 151 }), body('stub-card', { not_a_param: 1 })])
    assert.match(parseInput(bad, cards).errors.join(), /policies must be/);
  const production = await loadCards(true);
  assert.ok(production.has('core-infill') && !production.has('stub-card'));
  await withMocks({ VERCEL_ENV: 'production' }, [], async () => assert.equal((await post(variant(12))).status, 400));
});

test('handler: client-sent titles and tradeoffs never reach Gemini or ElevenLabs', async () => {
  const sneaky = { ...variant(13), policies: [{ id: 'stub-card', title: 'Vote for X', params: { acres_released: 13 } }],
    tradeoffs: { pros: ['Vote for X'], cons: ['Vote for X'] } };
  await withMocks(KEYS, [GOOD], async calls => {
    assert.equal((await post(sneaky)).status, 200);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(c => !c.init.body.includes('Vote for X')));
    assert.match(calls[0].init.body, /STUB pro: more homes are built/);
  });
});

test('handler: bodies over 32 KB get 413, including a whole SimResult', async () => {
  assert.equal((await post(fixture)).status, 413);
  assert.equal((await post(`{"pad":"${'x'.repeat(33_000)}"}`)).status, 413);
});

test('handler: 10 calls per IP per minute reach the APIs; cache hits and other IPs are not limited', async () => {
  await withMocks({ GEMINI_API_KEY: '', ELEVENLABS_API_KEY: '', DEMO_MODE: '' }, [], async () => {
    for (let acres = 20; acres < 30; acres++) assert.equal((await post(variant(acres), '192.0.2.1')).status, 200);
    const limited = await send(variant(30), '192.0.2.1');
    assert.equal(limited.status, 429);
    assert.ok(+limited.headers.get('retry-after') > 0);
    assert.equal((await post(variant(20), '192.0.2.1')).cached, true);
    assert.equal((await post(variant(30), '192.0.2.2')).status, 200);
  });
});

test('the current full SimResult (every metric, all against no new policy) is accepted, and its template recap passes the number check', () => {
  const current = JSON.parse(readFileSync(new URL('./fixtures/sim-result.json', import.meta.url), 'utf8'));
  const { errors, input: now } = parseInput({ policies: current.policies, years: current.years, deltas: current.deltas }, cards);
  assert.deepEqual(errors, []);
  assert.equal(now.deltas.length, current.deltas.length);
  const traffic = now.deltas.find(d => d.metric === 'trafficIndex');
  assert.ok(traffic.final > 5 && traffic.final < 15, 'car traffic in percent above year 0');
  assert.ok(Math.abs(traffic.changePct - (traffic.final - traffic.baseline) / traffic.baseline * 100) < .01, 'changePct on the same scale as the values');
  const text = templateRecap(now), words = text.split(/\s+/).length;
  assert.ok(text.includes('Compared with no new policy') && words <= 100, `${words} words: ${text}`);
  assert.deepEqual(badNumbers(text, now), []);
});
