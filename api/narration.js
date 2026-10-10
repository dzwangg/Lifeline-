// POST /api/narration: a short spoken news-style recap of a SimResult (see shared/types.d.ts).
// Body: a SimResult, or just its { policies, years, deltas, tradeoffs }. Reply: { text, audio, cached, fallback }
// where audio is a base64 mp3 or null, and fallback means the text is the deterministic template, not Gemini's.
// Order: in-memory cache, then committed clips in demo-audio/<hash>.{json,mp3}, then Gemini + ElevenLabs.
// DEMO_MODE=1 never calls out. A missing key degrades its own step (no Gemini key: template; no ElevenLabs key: no audio).
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/** @typedef {import('../shared/types').SimResult} SimResult @typedef {Pick<SimResult, 'policies' | 'years' | 'deltas' | 'tradeoffs'>} NarrationInput */

// fmt says a value the way a news anchor would (unit follows it once); pct metrics are already percentages, so the template
// gives from/to rather than a % change. households and pricedOut come from the household model (shared/agents.js).
const about = n => `about ${fmtNum(n, { maximumSignificantDigits: 3 })}`;
const METRICS = {
  housingUnits: { meaning: 'number of homes', label: 'homes', plural: true, fmt: about },
  households: { meaning: 'number of households living in town', label: 'households', plural: true, fmt: about },
  medianRent: { meaning: 'median monthly rent in dollars', label: 'median rent', fmt: n => `$${fmtNum(n, { maximumFractionDigits: 0 })}`, unit: ' a month' },
  avgCommuteMin: { meaning: 'average commute in minutes', label: 'the average commute', fmt: n => fmtNum(n, { maximumFractionDigits: 1 }), unit: ' minutes' },
  pricedOut: { meaning: 'estimated number of households that moved away because rent got too high for them', label: 'households priced out', plural: true, fmt: about },
  treeCoverPct: { meaning: 'share of land covered by trees, in percent', label: 'tree cover', fmt: n => `${fmtNum(n, { maximumFractionDigits: 1 })}%`, pct: true },
  taxRevenue: { meaning: 'yearly property tax revenue in dollars', label: 'tax revenue', fmt: n => `$${fmtNum(n / 1e6, { maximumFractionDigits: 1 })} million` },
};
const fmtNum = (n, opts) => n.toLocaleString('en-US', opts); // Intl rounds the decimal value: 2.15 -> 2.2, where toPrecision gives 2.1
const NO_POLICY = 'no new policy';

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isStr = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max;
const isList = (v, max, each) => Array.isArray(v) && v.length >= 1 && v.length <= max && v.every(each);

/** Hand-written check of the fields the recap uses; the caps keep the prompt small. @returns {{ errors: string[], input?: NarrationInput }} */
export function parseInput(b) {
  if (!isObj(b)) return { errors: ['body must be a JSON object'] };
  const errors = [];
  const ok = (pass, problem) => pass || errors.push(problem);
  ok(isList(b.policies, 10, p => isObj(p) && isStr(p.id, 100) && isStr(p.title, 200) && isObj(p.params)
    && Object.keys(p.params).length <= 20 && Object.entries(p.params).every(([k, v]) => k.length <= 50 && isNum(v))),
    'policies must be 1-10 of { id, title, params: { key: number } }');
  ok(Number.isInteger(b.years) && b.years >= 1 && b.years <= 100, 'years must be a whole number from 1 to 100');
  ok(isList(b.deltas, 10, d => isObj(d) && Object.hasOwn(METRICS, d.metric) && [d.baseline, d.final, d.changePct].every(isNum)
    && [undefined, 'year 0', NO_POLICY].includes(d.comparedWith)),
    `deltas must be 1-10 of { metric: ${Object.keys(METRICS).join('|')}, baseline, final, changePct, comparedWith?: "year 0"|"${NO_POLICY}" }`);
  ok(isObj(b.tradeoffs) && ['pros', 'cons'].every(k => isList(b.tradeoffs[k], 10, s => isStr(s, 300))),
    'tradeoffs.pros and tradeoffs.cons must each be 1-10 non-empty strings');
  if (errors.length) return { errors };
  return { errors, input: {
    policies: b.policies.map(({ id, title, params }) => ({ id, title, params })),
    years: b.years,
    deltas: b.deltas.map(({ metric, baseline, final, changePct, comparedWith = 'year 0' }) => ({ metric, baseline, final, changePct, comparedWith })),
    tradeoffs: { pros: b.tradeoffs.pros, cons: b.tradeoffs.cons },
  } };
}

const stable = v => Array.isArray(v) ? `[${v.map(stable)}]`
  : isObj(v) ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`)}}` : JSON.stringify(v);
/** Cache key and demo clip name: same input, same hash, whatever the key order. */
export const hashInput = input => createHash('sha256').update(stable(input)).digest('hex').slice(0, 16);

// "24,222", "1479.81", "69.8 million". The last significant digit sets the rounding allowed: "24,000" covers 23,500-24,500.
const NUMBER = /(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s*(thousand|million|billion)\b)?/gi;
const SCALE = { thousand: 1e3, million: 1e6, billion: 1e9 };
const numbersIn = text => [...String(text).matchAll(NUMBER)].map(([raw, int, dec = '', scale]) => {
  const digits = int.replace(/,/g, ''), mult = SCALE[scale?.toLowerCase()] ?? 1;
  const unit = dec ? 10 ** -(dec.length - 1) : +digits === 0 ? 1 : 10 ** digits.match(/0*$/)[0].length;
  return { raw, value: parseFloat(digits + dec) * mult, tolerance: unit * mult / 2 };
});
const inputNumbers = v => typeof v === 'number' ? [v] : typeof v === 'string' ? numbersIn(v).map(n => n.value)
  : isObj(v) || Array.isArray(v) ? Object.values(v).flatMap(inputNumbers) : [];

/** Numbers in the text that are not a number in the input, allowing rounding, signs, %, $ and commas. Empty means it passes. */
export function badNumbers(text, input) {
  const allowed = inputNumbers(input).map(Math.abs);
  return numbersIn(text).filter(({ value, tolerance }) => !allowed.some(a => Math.abs(value - a) <= tolerance + 1e-9 * Math.max(1, a)))
    .map(n => n.raw);
}

/** The deterministic recap used whenever Gemini is off, failing, or keeps citing numbers that are not in the input. */
export function templateRecap(input) {
  const list = items => new Intl.ListFormat('en', { type: 'conjunction' }).format(items);
  const clause = ({ metric, baseline, final, changePct, comparedWith }) => {
    const { label, fmt, unit = '', plural, pct } = METRICS[metric];
    const [is, rises, falls] = plural ? ['are', 'rise', 'fall'] : ['is', 'rises', 'falls'];
    if (comparedWith === NO_POLICY) return `${label} ${is} ${fmt(final)}${unit}${changePct === 0 ? ', the same' : ` instead of ${fmt(baseline)}`}`;
    if (changePct === 0) return `${label} ${is} unchanged at ${fmt(final)}${unit}`;
    const verb = changePct > 0 ? rises : falls;
    return pct ? `${label} ${verb} from ${fmt(baseline)} to ${fmt(final)}`
      : `${label} ${verb} ${fmtNum(Math.abs(changePct), { maximumSignificantDigits: 2 })}% to ${fmt(final)}${unit}`;
  };
  const overTime = input.deltas.filter(d => d.comparedWith !== NO_POLICY).map(clause);
  const vsNoPolicy = input.deltas.filter(d => d.comparedWith === NO_POLICY).map(clause);
  // ponytail: first pro and first con only, so real cards (3 of each) stay near 90 words; list them all if length stops mattering.
  return [
    `In a ${input.years}-year simulation of ${list(input.policies.map(p => `“${p.title}”`))}${overTime.length ? `, ${list(overTime)}` : ''}.`,
    vsNoPolicy.length ? `Compared with ${NO_POLICY}, ${list(vsNoPolicy)}.` : '',
    `On the plus side: ${input.tradeoffs.pros[0]}`, `On the downside: ${input.tradeoffs.cons[0]}`,
  ].filter(Boolean).join(' ');
}

const SYSTEM_PROMPT = `You write short news-style recaps of a city policy simulation for residents with no policy background. The recap is read aloud.
Rules:
- Between 60 and 90 words (about 30 seconds spoken), one paragraph, plain everyday language, no jargon, no headings or lists.
- Use ONLY numbers that appear in the input, and only the few that matter most to residents. Never calculate new numbers such as differences, sums or ratios. Write every number as digits.
- Say numbers the way a local news anchor would: commas in large numbers, $ for money, % for percentages, rounded figures (for example "about 12,400" for 12408), and big dollar amounts in millions (for example "about $4.5 million" for 4518230).
- When a delta is compared with no new policy, say so (for example "lower than with no new policy"); don't describe it as a change over time.
- State both the benefits (pros) and the drawbacks (cons) from the input.
- Never recommend, endorse or oppose the policy and never take a side. Report what the simulation shows, as a simulation.`;

const userPrompt = input => `Simulation results (JSON):\n${JSON.stringify(input)}\n\nWhat the metrics mean: ${
  Object.entries(METRICS).map(([k, m]) => `${k} = ${m.meaning}`).join('; ')
}. In each delta, final is the value after the simulated years with this policy, and baseline is what it is compared with: `
  + `the starting value when comparedWith is "year 0", or the value after the same years with no new policy when comparedWith is "${NO_POLICY}". `
  + 'changePct is the percent change from baseline to final.';

// Thinking makes Gemini 3 slow here (12-19s at its default level, 1.5s at "minimal"), but each model accepts different
// levels (gemini-3.8-flash rejects "minimal"), so a 400 about the level retries once with the model's default.
async function gemini(env, contents, thinkingLevel = env.GEMINI_THINKING_LEVEL || 'minimal') {
  const generationConfig = { temperature: 0.2, ...(thinkingLevel && { thinkingConfig: { thinkingLevel } }) };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }, contents, generationConfig }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 400 && thinkingLevel && /thinking/i.test(await res.text())) {
    console.warn(`narration: ${env.GEMINI_MODEL} rejected thinking level "${thinkingLevel}"; retrying with its default`);
    return gemini(env, contents, null);
  }
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const parts = (await res.json()).candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter(p => !p.thought).map(p => p.text ?? '').join('').trim();
  if (!text) throw new Error('Gemini returned no text');
  return text;
}

async function speak(env, text) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(env.ELEVENLABS_VOICE_ID)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'audio/mpeg', 'xi-api-key': env.ELEVENLABS_API_KEY },
    body: JSON.stringify({ text, model_id: env.ELEVENLABS_MODEL || 'eleven_flash_v2_5' }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}

/** Gemini text (one retry naming the bad numbers, then the template) read aloud by ElevenLabs. Never throws. `failed` marks a transient API error. */
export async function narrate(input, env = process.env) {
  let text = null, failed = false;
  if (env.GEMINI_API_KEY && env.GEMINI_MODEL) {
    try {
      const contents = [{ role: 'user', parts: [{ text: userPrompt(input) }] }];
      for (let attempt = 0; attempt < 2 && !text; attempt++) {
        const draft = await gemini(env, contents);
        const bad = badNumbers(draft, input);
        if (!bad.length) text = draft;
        else contents.push({ role: 'model', parts: [{ text: draft }] },
          { role: 'user', parts: [{ text: `These numbers are not in the input: ${bad.join(', ')}. Rewrite the recap using only numbers from the input.` }] });
      }
    } catch (err) {
      failed = true;
      console.error('narration: Gemini failed:', err.message);
    }
  }
  const fallback = !text;
  text ??= templateRecap(input);
  let audio = null;
  if (env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID) {
    try {
      audio = await speak(env, text);
    } catch (err) {
      failed = true;
      console.error('narration: ElevenLabs failed:', err.message);
    }
  }
  return { text, audio, fallback, failed };
}

async function demoClip(key) {
  try {
    const [meta, mp3] = await Promise.all([
      readFile(new URL(`../demo-audio/${key}.json`, import.meta.url), 'utf8'),
      readFile(new URL(`../demo-audio/${key}.mp3`, import.meta.url)),
    ]);
    const { text, fallback } = JSON.parse(meta);
    return { text, audio: mp3.toString('base64'), fallback };
  } catch {
    return null;
  }
}

const cache = new Map(); // ponytail: per-instance and capped at 100 by insertion order; a shared KV if cold starts hurt.

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'body must be JSON' }, { status: 400 });
  }
  const { errors, input } = parseInput(body);
  if (errors.length) return Response.json({ error: errors.join('; ') }, { status: 400 });

  const key = hashInput(input);
  if (cache.has(key)) return Response.json({ ...cache.get(key), cached: true });
  const clip = await demoClip(key);
  if (clip) {
    cache.set(key, clip);
    return Response.json({ ...clip, cached: true });
  }
  if (process.env.DEMO_MODE === '1') return Response.json({ text: templateRecap(input), audio: null, cached: false, fallback: true });

  const { failed, ...result } = await narrate(input);
  if (!failed) {
    cache.set(key, result);
    if (cache.size > 100) cache.delete(cache.keys().next().value);
  }
  return Response.json({ ...result, cached: false });
}
