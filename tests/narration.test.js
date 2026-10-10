import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { POST, badNumbers, hashInput, parseInput, templateRecap } from '../api/narration.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/sim-result.json', import.meta.url), 'utf8'));
const { input } = parseInput(fixture);
// A distinct input per handler test, so the handler's in-memory cache never leaks between tests.
const variant = tag => ({ ...input, tradeoffs: { ...input.tradeoffs, pros: [`More homes are built, case ${tag}.`] } });

const GOOD = 'Over 10 years, the simulated policy adds homes, from 23,713 to about 24,200, a 2.15% rise. Median rent dips to about $1,480. '
  + 'Tree cover falls from 13.7% to 9.75%, a drop of nearly 29%. Commutes stay near 20 minutes, and yearly tax revenue grows to $69.8 million. '
  + 'Supporters note that more homes are built; critics note that forest is cleared.';
const BAD = 'Homes rise by 509 and rent falls $3 by 2035.';
const KEYS = { GEMINI_API_KEY: 'gem-secret', GEMINI_MODEL: 'gemini-test', ELEVENLABS_API_KEY: 'el-secret', ELEVENLABS_VOICE_ID: 'voice', ELEVENLABS_MODEL: '', DEMO_MODE: '' };

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
const post = async body => {
  const res = await POST(new Request('http://localhost/api/narration', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));
  return { status: res.status, ...(await res.json()) };
};

test('number check: rounding, signs, %, $, commas and scale words pass', () => {
  assert.deepEqual(badNumbers(GOOD, input), []);
  assert.deepEqual(badNumbers('Rent changes -0.22%, homes reach 24,222 (about 24,000), revenue about $70 million, over 10 years, on 130 acres.', input), []);
});

test('number check: names numbers that are not in the input, even derived ones', () => {
  assert.deepEqual(badNumbers(BAD, input), ['509', '3', '2035']);
  assert.deepEqual(badNumbers('Tree cover falls 28.9%, homes reach 24,300.', input), ['28.9', '24,300']);
});

test('hash is stable across key order and extra fields, and changes with the content', () => {
  const reordered = { tradeoffs: input.tradeoffs, deltas: input.deltas.map(d => Object.fromEntries(Object.entries(d).reverse())), years: input.years, policies: input.policies };
  assert.equal(hashInput(parseInput(reordered).input), hashInput(input));
  assert.match(hashInput(input), /^[0-9a-f]{16}$/);
  assert.notEqual(hashInput(variant('a')), hashInput(input));
});

test('template recap is deterministic, covers every delta and both sides, and passes the number check', () => {
  const text = templateRecap(input);
  assert.equal(text, templateRecap(structuredClone(input)));
  for (const s of ['10 years', '23,713', '24,222', '$1,483', '13.7%', '$69.8 million', 'STUB pro', 'STUB con']) assert.ok(text.includes(s), s);
  assert.deepEqual(badNumbers(text, input), []);
});

test('handler: Gemini text read aloud, then served from cache', async () => {
  await withMocks(KEYS, [GOOD], async calls => {
    assert.deepEqual(await post(variant('a')), { status: 200, text: GOOD, audio: 'AQID', cached: false, fallback: false });
    assert.equal(calls.length, 2);
    const [g, el] = calls;
    assert.equal(g.init.headers['x-goog-api-key'], 'gem-secret');
    assert.match(g.url, /models\/gemini-test:generateContent$/);
    assert.equal(JSON.parse(g.init.body).generationConfig.temperature, 0.2);
    assert.match(el.url, /text-to-speech\/voice\?/);
    assert.equal(JSON.parse(el.init.body).model_id, 'eleven_flash_v2_5');
    assert.deepEqual(await post(variant('a')), { status: 200, text: GOOD, audio: 'AQID', cached: true, fallback: false });
    assert.equal(calls.length, 2);
  });
});

test('handler: one retry listing the bad numbers, then the template', async () => {
  await withMocks(KEYS, [BAD, GOOD], async calls => {
    const r = await post(variant('b'));
    assert.equal(r.text, GOOD);
    assert.equal(r.fallback, false);
    assert.match(JSON.parse(calls[1].init.body).contents.at(-1).parts[0].text, /509, 3, 2035/);
  });
  await withMocks(KEYS, [BAD, BAD], async calls => {
    const r = await post(variant('c'));
    assert.deepEqual([r.text, r.audio, r.fallback], [templateRecap(variant('c')), 'AQID', true]);
    assert.equal(calls.filter(c => c.url.includes('generativelanguage')).length, 2);
  });
});

test('handler: API errors fall back to the template, are not cached, and never log keys', async () => {
  const logged = [];
  const error = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    await withMocks(KEYS, [new Response('nope', { status: 500 }), GOOD], async calls => {
      const r = await post(variant('d'));
      assert.deepEqual([r.text, r.fallback, r.cached], [templateRecap(variant('d')), true, false]);
      assert.equal((await post(variant('d'))).text, GOOD); // the failure was not cached
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
    assert.deepEqual(await post(variant('e')), { status: 200, text: templateRecap(variant('e')), audio: null, cached: false, fallback: true });
    assert.equal(calls.length, 0);
  });
  await withMocks({ ...KEYS, DEMO_MODE: '1' }, [GOOD], async calls => {
    assert.deepEqual(await post(variant('f')), { status: 200, text: templateRecap(variant('f')), audio: null, cached: false, fallback: true });
    assert.equal(calls.length, 0);
  });
});

test('handler: a committed demo clip is served first', async () => {
  const dir = new URL('../demo-audio/', import.meta.url), key = hashInput(variant('g'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL(`${key}.mp3`, dir), Buffer.from([1, 2, 3]));
  writeFileSync(new URL(`${key}.json`, dir), JSON.stringify({ text: 'Clip text.', fallback: false }));
  try {
    await withMocks({ ...KEYS, DEMO_MODE: '1' }, [], async calls => {
      assert.deepEqual(await post(variant('g')), { status: 200, text: 'Clip text.', audio: 'AQID', cached: true, fallback: false });
      assert.equal(calls.length, 0);
    });
  } finally {
    rmSync(new URL(`${key}.mp3`, dir));
    rmSync(new URL(`${key}.json`, dir));
    try { rmdirSync(dir); } catch {} // only if this test created it and it is empty
  }
});

test('handler: rejects bad input with 400', async () => {
  assert.equal((await post('not json')).status, 400);
  const r = await post({ ...input, years: 0, deltas: [{ metric: 'vibes', baseline: 1, final: 2, changePct: 100 }] });
  assert.equal(r.status, 400);
  assert.match(r.error, /years/);
  assert.match(r.error, /deltas/);
  assert.equal((await post({ ...input, tradeoffs: { pros: [], cons: ['x'] } })).status, 400);
});
