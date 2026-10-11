// Spending guards, with Gemini mocked: per-IP limits in production, the daily call cap, output caps, cost logging.
// Its own file (so its own process): VERCEL_ENV is set before the API modules read it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.VERCEL_ENV = 'production';
const { AI_PAUSED, POST: narration, callCost, clearGeminiPauses, dailyCap, geminiUsage, resetGeminiUsage } = await import('../api/narration.js');
const { POST: policies } = await import('../api/policies.js');
const { POST: resident } = await import('../api/resident.js');
const { cards } = await import('./data.js');

const sample = JSON.parse(readFileSync(new URL('./fixtures/narration-sample.json', import.meta.url), 'utf8'));
const ENV = { GEMINI_API_KEY: 'gem-secret', GEMINI_MODEL: '', GEMINI_MODEL_NARRATION: '', GEMINI_MODEL_CHAT: '', GEMINI_MODEL_CARDS: '',
  GEMINI_FALLBACK_MODELS: '', GEMINI_THINKING_LEVEL: '', GEMINI_DAILY_CALL_CAP: '', DEMO_MODE: '', CARD_SIGNING_KEY: 'k',
  ELEVENLABS_API_KEY: '', ELEVENLABS_VOICE_ID: '' };
const RECAP = 'The simulated policy changes homes and rents compared with no new policy. Some note more homes; others note lost forest.';
const card = { ...structuredClone(cards.find(c => c.id === 'corridor-midrise')), id: 'corridor-apartments' };
const USAGE = { promptTokenCount: 2000, candidatesTokenCount: 400, thoughtsTokenCount: 100 };

/** Env vars, and a fake Gemini that answers each call with `reply(body)`; fn gets the calls' { model, body }. */
async function withGemini(env, reply, fn) {
  const saved = { fetch: globalThis.fetch, env: { ...process.env }, log: console.log };
  const calls = [];
  Object.assign(process.env, ENV, env);
  console.log = () => {};
  resetGeminiUsage();
  clearGeminiPauses();
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body), model = String(url).match(/models\/([^:]+):/)[1];
    calls.push({ model, body });
    const r = reply(body, calls.length);
    return r instanceof Response ? r : Response.json({ candidates: [{ content: { parts: [{ text: r }] }, finishReason: 'STOP' }], usageMetadata: USAGE });
  };
  try {
    await fn(calls);
  } finally {
    Object.assign(globalThis, { fetch: saved.fetch });
    process.env = saved.env;
    console.log = saved.log;
  }
}
let ips = 0;
const req = (body, ip = `10.9.0.${++ips}`) => new Request('http://localhost/api', { method: 'POST', headers: { 'x-forwarded-for': ip }, body: JSON.stringify(body) });
const recap = (acres, ip) => narration(req({ policies: [{ id: 'corridor-midrise', params: { acres_released: acres } }], years: sample.years, deltas: sample.deltas }, ip));
const draft = (idea, ip) => policies(req({ idea }, ip));
const ask = (question, ip) => resident(req({ resident: 'uma', policies: [], question }, ip), {}); // {}: Vercel's context, not env
const cardReply = () => JSON.stringify({ card, unmodeled: [], unsupportedReason: null });

test('production: 5 recaps, 20 questions and 10 drafts per IP per 10 minutes; cache hits are free', async () => {
  await withGemini({}, body => (body.generationConfig.responseSchema ? cardReply() : body.generationConfig.maxOutputTokens === 200 ? 'I live here and my costs change a little.' : RECAP), async () => {
    for (let i = 1; i <= 5; i++) assert.equal((await recap(i, '192.0.2.1')).status, 200);
    const limited = await recap(6, '192.0.2.1');
    assert.equal(limited.status, 429);
    assert.ok(+limited.headers.get('retry-after') > 60, 'a 10-minute window');
    assert.equal((await recap(1, '192.0.2.1')).status, 200, 'a cached recap is served past the limit');

    for (let i = 1; i <= 20; i++) assert.equal((await ask(`question number ${i}?`, '192.0.2.2')).status, 200);
    assert.equal((await ask('question number 21?', '192.0.2.2')).status, 429);

    for (let i = 1; i <= 10; i++) assert.equal((await draft(`apartments by the corridor, take ${i}`, '192.0.2.3')).status, 200);
    assert.equal((await draft('apartments by the corridor, take 11', '192.0.2.3')).status, 429);
    assert.equal((await draft('apartments by the corridor, take 1', '192.0.2.3')).status, 200, 'a cached draft is served past the limit');
  });
});

test('daily cap: past GEMINI_DAILY_CALL_CAP calls, nothing reaches Gemini and replies say AI responses are paused', async () => {
  await withGemini({ GEMINI_DAILY_CALL_CAP: '2' }, () => RECAP, async calls => {
    assert.equal((await (await recap(20)).json()).fallback, false);
    assert.equal((await (await recap(21)).json()).fallback, false);
    const paused = await (await recap(22)).json();
    assert.deepEqual([paused.fallback, paused.reason], [true, AI_PAUSED]);
    assert.equal(calls.length, 2);
    assert.equal((await (await recap(22)).json()).cached, false, 'a paused recap is not cached, so it gets Gemini tomorrow');
    const res = await draft('apartments near the edge woods');
    assert.deepEqual([res.status, (await res.json()).error], [503, AI_PAUSED]);
    const asked = await (await ask('how are my costs?')).json();
    assert.deepEqual([asked.fallback, asked.reason], [true, AI_PAUSED]);
    assert.equal(calls.length, 2);
    const usage = geminiUsage();
    assert.deepEqual([usage.calls, usage.byModel], [2, { 'gemini-3.5-flash-lite': 2 }]);
    assert.equal(usage.day, new Date().toISOString().slice(0, 10));
  });
  await withGemini({ GEMINI_DAILY_CALL_CAP: '0' }, () => RECAP, async calls => {
    assert.equal((await (await recap(23)).json()).reason, AI_PAUSED, '0 turns Gemini off');
    assert.equal(calls.length, 0);
  });
});

test('daily cap: a GEMINI_DAILY_CALL_CAP that is not a nonnegative integer warns and uses 300; blank is 300 quietly', () => {
  const warn = console.warn, warned = [];
  console.warn = line => warned.push(line);
  try {
    assert.equal(dailyCap('300/day'), 300);
    assert.equal(dailyCap(''), 300);
    assert.equal(dailyCap('-1'), 300);
    assert.equal(dailyCap('25'), 25);
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(warned, ['gemini: GEMINI_DAILY_CALL_CAP "300/day" is not a nonnegative integer; using 300',
    'gemini: GEMINI_DAILY_CALL_CAP "-1" is not a nonnegative integer; using 300']);
});

test('output caps: 250 tokens for recaps, 200 for answers, 1200 for cards; a reply cut off at the cap is not used', async () => {
  await withGemini({}, body => (body.generationConfig.responseSchema ? cardReply() : RECAP), async calls => {
    await recap(30);
    await ask('what changes for me?');
    await draft('apartments along the corridor woods');
    assert.deepEqual(calls.map(c => [c.model, c.body.generationConfig.maxOutputTokens, c.body.generationConfig.thinkingConfig.thinkingLevel]),
      [['gemini-3.5-flash-lite', 250, 'minimal'], ['gemini-3.5-flash-lite', 200, 'minimal'], ['gemini-3-flash-preview', 1200, 'minimal']]);
  });
  const cut = () => Response.json({ candidates: [{ content: { parts: [{ text: 'The simulated policy changes homes and' }] }, finishReason: 'MAX_TOKENS' }], usageMetadata: USAGE });
  await withGemini({}, cut, async calls => {
    const error = console.error, warn = console.warn, warned = [];
    console.error = () => {};
    console.warn = line => warned.push(line);
    try {
      const r = await (await recap(31)).json();
      assert.equal(r.fallback, true);
      assert.doesNotMatch(r.text, /changes homes and$/);
      assert.equal(calls.length, 1, 'no retry on a cut-off reply');
      assert.deepEqual(warned, ['gemini: narration reply cut off at 250 tokens; it ended: …The simulated policy changes homes and']);
    } finally {
      console.error = error;
      console.warn = warn;
    }
  });
});

test('a model that rejects minimal thinking is retried at low, not at its pricier default', async () => {
  const rejected = () => Response.json({ error: { code: 400, message: 'Thinking level MINIMAL is not supported for this model.' } }, { status: 400 });
  await withGemini({}, (_, n) => (n === 1 ? rejected() : RECAP), async calls => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      assert.equal((await (await recap(40)).json()).fallback, false);
    } finally {
      console.warn = warn;
    }
    assert.deepEqual(calls.map(c => c.body.generationConfig.thinkingConfig?.thinkingLevel), ['minimal', 'low']);
  });
});

test('each call logs its tokens and estimated cost at the published price', async () => {
  assert.equal(callCost('gemini-3.5-flash-lite', USAGE), (2000 * 0.30 + 500 * 2.50) / 1e6);
  assert.equal(callCost('gemini-3-flash-preview', USAGE), (2000 * 0.50 + 500 * 3.00) / 1e6);
  assert.equal(callCost('gemini-unknown', USAGE), null);
  const lines = [];
  await withGemini({}, () => RECAP, async () => {
    console.log = line => lines.push(line);
    await recap(50);
  });
  assert.deepEqual(lines, ['gemini: narration gemini-3.5-flash-lite 2000 in, 400 out, 100 thinking, ~$0.00185; today 1 calls, ~$0.0019']);
});

test('prompts carry only what each feature uses: headline deltas plus the two others that moved most; a few resident years', async () => {
  await withGemini({}, body => (body.generationConfig.maxOutputTokens === 200 ? 'I live here and my costs change a little.' : RECAP), async calls => {
    await recap(60);
    await ask('What was my rent in year 3?');
    const [narrationPrompt, chatPrompt] = calls.map(c => c.body.contents[0].parts[0].text);
    const sent = JSON.parse(narrationPrompt.slice(narrationPrompt.indexOf('{'), narrationPrompt.indexOf('\n\nWhat the metrics mean')));
    const headline = ['medianRent', 'pricedOut', 'housingUnits', 'treeCoverPct', 'avgCommuteMin', 'netFiscal'];
    const others = sent.deltas.map(d => d.metric).filter(m => !headline.includes(m));
    assert.equal(others.length, 2);
    for (const { metric } of sample.deltas.filter(d => headline.includes(d.metric))) assert.ok(sent.deltas.some(d => d.metric === metric), metric);
    assert.ok(!narrationPrompt.includes('trafficIndex =') || others.includes('trafficIndex'), 'meanings only for metrics sent');
    const facts = JSON.parse(chatPrompt.slice(chatPrompt.indexOf('{'), chatPrompt.lastIndexOf('}') + 1));
    assert.deepEqual(facts.withPolicy.byYear.map(y => y.t), [0, 3, 5, 10]);
    await ask('Will I manage a few years from now?');
    const all = calls.at(-1).body.contents[0].parts[0].text;
    assert.equal(JSON.parse(all.slice(all.indexOf('{'), all.lastIndexOf('}') + 1)).withPolicy.byYear.length, 11, 'a time it cannot place sends every year');
  });
});
