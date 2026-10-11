// POST /api/narration: a short spoken news-style recap of a SimResult (see shared/types.d.ts).
// Body (at most 16 KB): a SimResult's { policies, years, deltas }. Reply: { text, audio, cached, fallback }
// where audio is a base64 mp3 or null, and fallback means the text is the deterministic template, not Gemini's.
// Abuse limits: no client text reaches Gemini or ElevenLabs. Policy ids must be cards in data/cards.index.json (plus the
// stub card outside production) with in-range params, and titles and tradeoffs are read from the card files here.
// A player card from /api/policies may come in the body as cards: [{ card, signature }]; it is used only when its HMAC
// signature (CARD_SIGNING_KEY) checks out and it still passes validateCard. Otherwise its text is dropped and the reply is the
// template, naming it only as "a proposed policy".
// Calls that would reach Gemini or ElevenLabs are rate-limited per IP.
// Order: in-memory cache, then committed clips (demo-audio/<input hash>.json holds the text, <speech hash>.mp3 its audio),
// then Gemini + ElevenLabs. ElevenLabs gets speakable(text), the numbers in words; the reply's text keeps the digits.
// DEMO_MODE=1 never calls out. A missing key degrades its own step (no Gemini key: template; no ElevenLabs key: no audio).
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateCard } from '../shared/schema.js';

/** @typedef {import('../shared/types').SimResult} SimResult @typedef {Pick<SimResult, 'policies' | 'years' | 'deltas' | 'tradeoffs'>} NarrationInput */

// fmt says a value the way a news anchor would (unit follows it once); pct metrics are already percentages, so the template
// gives from/to rather than a % change. households and pricedOut come from the household model (shared/agents.js).
const about = n => `about ${fmtNum(n, { maximumSignificantDigits: 3 })}`;
const METRICS = {
  housingUnits: { meaning: 'number of homes', label: 'homes', plural: true, fmt: about },
  households: { meaning: 'number of households living in town', label: 'households', plural: true, fmt: about },
  medianRent: { meaning: 'median monthly market rent in dollars (rents rise with inflation over the years)', label: 'median rent', fmt: n => `$${fmtNum(n, { maximumFractionDigits: 0 })}`, unit: ' a month' },
  avgCommuteMin: { meaning: 'average commute in minutes', label: 'the average commute', fmt: n => fmtNum(n, { maximumFractionDigits: 1 }), unit: ' minutes' },
  pricedOut: { meaning: 'estimated number of households living in town at year 0 that moved away because their rent rose faster than their income', label: 'households priced out', plural: true, fmt: about },
  treeCoverPct: { meaning: 'share of land covered by trees, in percent', label: 'tree cover', fmt: n => `${fmtNum(n, { maximumFractionDigits: 1 })}%`, pct: true },
  taxRevenue: { meaning: 'yearly property tax revenue in dollars', label: 'tax revenue', fmt: n => `$${fmtNum(n / 1e6, { maximumFractionDigits: 1 })} million` },
  // From CH-LUTI (shared/combined.js). Gemini gets these too; the template recap keeps to the metrics above (TEMPLATE).
  jobs: { meaning: 'number of jobs located in town', label: 'jobs in town', plural: true, fmt: about },
  businesses: { meaning: 'number of storefront businesses such as shops, restaurants and services', label: 'storefront businesses', plural: true, fmt: about },
  storefrontVacancy: { meaning: 'share of downtown storefronts standing empty, in percent', label: 'downtown storefront vacancy', fmt: n => `${fmtNum(n, { maximumFractionDigits: 1 })}%`, pct: true, toInput: v => Math.round(v * 1000) / 10 },
  homeValue: { meaning: 'median home value in dollars', label: 'the median home value', fmt: n => `$${fmtNum(Math.round(n / 1000) * 1000)}` },
  netFiscal: { meaning: "the Town's yearly budget net of policy costs: tax revenue minus programme costs and the cost of serving added residents, in dollars", label: 'the town budget, net', fmt: n => `$${fmtNum(n / 1e6, { maximumFractionDigits: 1 })} million` },
  transitRidership: { meaning: 'bus trips a year', label: 'bus trips a year', plural: true, fmt: about },
  trafficIndex: { meaning: 'peak car traffic, in percent above year 0', label: 'car traffic', fmt: n => `${fmtNum(n, { maximumFractionDigits: 1 })}% above year 0`, pct: true, toInput: v => Math.round((v - 1) * 1000) / 10 },
};
// The panel's six headline metrics: the template recap covers these, and Gemini is told to focus on them.
const HEADLINE = ['medianRent', 'pricedOut', 'housingUnits', 'treeCoverPct', 'avgCommuteMin', 'netFiscal'];
const TEMPLATE = new Set(HEADLINE);
const fmtNum = (n, opts) => n.toLocaleString('en-US', opts); // Intl rounds the decimal value: 2.15 -> 2.2, where toPrecision gives 2.1
const NO_POLICY = 'no new policy';

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isList = (v, max, each) => Array.isArray(v) && v.length >= 1 && v.length <= max && v.every(each);

const readJson = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8').then(JSON.parse);
let catalog; // per instance: the card files only change with a deploy
/** The cards a recap can describe, by id: data/cards.index.json, plus tests/fixtures/stub-card.json outside production. */
export async function loadCards(production = process.env.VERCEL_ENV === 'production') {
  catalog ??= Promise.all([
    readJson('data/cards.index.json').then(paths => Promise.all(paths.map(p => readJson(`data/${p}`)))),
    readJson('tests/fixtures/stub-card.json'),
  ]);
  const [cards, stub] = await catalog;
  return new Map([...cards, ...(production ? [] : [stub])].map(c => [c.id, c]));
}

/** Hand-written check of the fields the recap uses. Titles and tradeoffs come from `cards`, never the body. @returns {{ errors: string[], input?: NarrationInput }} */
export function parseInput(b, cards) {
  if (!isObj(b)) return { errors: ['body must be a JSON object'] };
  const errors = [];
  const ok = (pass, problem) => pass || errors.push(problem);
  const inRange = (params, card) => isObj(params) && Object.entries(params).every(([k, v]) => {
    if (!card.params) return isNum(v); // an unverified player card: its specs are untrusted, and the template never says params
    const spec = card.params.find(s => s.key === k);
    return spec && isNum(v) && v >= spec.min && v <= spec.max;
  });
  ok(isList(b.policies, 10, p => isObj(p) && cards.has(p.id) && inRange(p.params, cards.get(p.id))),
    `policies must be 1-10 of { id, params } where id is one of ${[...cards.keys()].join(', ')} and params are that card's, within its range`);
  ok(Number.isInteger(b.years) && b.years >= 1 && b.years <= 100, 'years must be a whole number from 1 to 100');
  ok(isList(b.deltas, Object.keys(METRICS).length, d => isObj(d) && Object.hasOwn(METRICS, d.metric) && [d.baseline, d.final, d.changePct].every(isNum)
    && (d.changePts === undefined || isNum(d.changePts)) && [undefined, 'year 0', NO_POLICY].includes(d.comparedWith)),
    `deltas must be 1-${Object.keys(METRICS).length} of { metric: ${Object.keys(METRICS).join('|')}, baseline, final, changePct, changePts?, comparedWith?: "year 0"|"${NO_POLICY}" }`);
  if (errors.length) return { errors };
  const picked = b.policies.map(p => cards.get(p.id));
  const sides = side => [...new Set(picked.flatMap(c => c.tradeoffs[side]))]; // as runScenario merges them
  return { errors, input: {
    policies: b.policies.map(({ id, params }) => ({ id, title: cards.get(id).title, params })),
    years: b.years,
    deltas: b.deltas.map(({ metric, baseline, final, changePct, changePts, comparedWith = 'year 0' }) => {
      // shares and indexes in percent, so the recap can quote them as they are; changePct then follows the converted values
      const as = METRICS[metric].toInput, [b0, f0] = as ? [as(baseline), as(final)] : [baseline, final];
      const pct = as ? (b0 ? Math.round((f0 - b0) / Math.abs(b0) * 1e4) / 100 : 0) : changePct;
      return { metric, baseline: b0, final: f0, changePct: pct, ...(changePts !== undefined && { changePts }), comparedWith };
    }),
    tradeoffs: { pros: sides('pros'), cons: sides('cons') },
  } };
}

const stable = v => Array.isArray(v) ? `[${v.map(stable)}]`
  : isObj(v) ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`)}}` : JSON.stringify(v);
/** Cache key and demo clip name: same input, same hash, whatever the key order. */
export const hashInput = input => createHash('sha256').update(stable(input)).digest('hex').slice(0, 16);

/** HMAC of a player card, so /api/narration can trust card text that came back from the browser. */
export const signCard = (card, key) => createHmac('sha256', key).update(stable(card)).digest('hex');
const signedBy = (card, signature, key) => {
  if (!key || typeof signature !== 'string') return false;
  const want = Buffer.from(signCard(card, key), 'hex'), got = Buffer.from(signature, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
};
const UNVERIFIED = 'a proposed policy';
/**
 * The catalog plus the body's player cards ({ card, signature }[], at most 10). A card with a good signature that still
 * validates joins as is; any other stands in as UNVERIFIED with no tradeoffs, and its id is listed in `unverified`.
 */
export function withPlayerCards(sent, catalog, key = process.env.CARD_SIGNING_KEY) {
  const cards = new Map(catalog), unverified = new Set();
  for (const { card, signature } of Array.isArray(sent) ? sent.slice(0, 10).filter(isObj) : []) {
    if (!isObj(card) || typeof card.id !== 'string' || catalog.has(card.id)) continue;
    if (signedBy(card, signature, key) && !validateCard(card).length) cards.set(card.id, card);
    else {
      unverified.add(card.id);
      cards.set(card.id, { id: card.id, title: UNVERIFIED, params: null, tradeoffs: { pros: [], cons: [] } });
    }
  }
  return { cards, unverified };
}

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

// The prompt's "no evaluative or advocacy language" rule as a check. ponytail: a word list catches the usual slips, not
// every slant; narrate() retries on it, and /api/policies runs it on card text.
const EVALUATIVE = /\b(help(s|ed|ing)?|good news|bad news|(un)?fortunately|great|terrible|disastrous|devastating|thriving|vibrant|crisis|best|worst|should|must|need(s)? to|unfair|fair share|wasteful|reckless|common.?sense|keep families in town)\b/gi;
/** Evaluative or advocacy words in the text. Empty means it passes. */
export const evaluativeWords = text => [...new Set(String(text).match(EVALUATIVE) ?? [])];

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const under100 = n => n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
const under1000 = n => [n >= 100 && `${ONES[Math.floor(n / 100)]} hundred`, (n % 100 || n < 100) && under100(n % 100)].filter(Boolean).join(' ');
/** 4060 -> "four thousand sixty", 130 -> "a hundred thirty" */
const wholeWords = n => n === 0 ? 'zero' : [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand'], [1, '']]
  .filter(([size]) => Math.floor(n / size) % 1000).map(([size, name]) => `${under1000(Math.floor(n / size) % 1000)} ${name}`.trim())
  .join(' ').replace(/^one hundred/, 'a hundred');
// A number not glued to a word or another number: sign, $, digits, decimals, scale word, %.
const SPOKEN = /(?<![\w.,])([-−])?(\$)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s*(thousand|million|billion)\b)?(%)?/g;

/** The recap as ElevenLabs should say it: numbers in the words a news anchor uses ("$1,670" -> "sixteen hundred seventy dollars"). */
export const speakable = text => text
  .replace(/\b15-501\b/g, 'fifteen-five-oh-one') // ponytail: the one road name in the cards; a lookup table if more appear
  .replace(SPOKEN, (m, sign, dollar, int, dec, scale, pct) => {
    const n = +int.replace(/,/g, '');
    // Anchors say "sixteen hundred seventy dollars" for $1,100-$9,999, but "two thousand five dollars", not "twenty hundred five".
    const whole = dollar && !dec && !scale && n >= 1100 && n <= 9999 && n % 1000 >= 100
      ? `${under100(Math.floor(n / 100))} hundred${n % 100 ? ` ${under100(n % 100)}` : ''}` : wholeWords(n);
    const point = dec ? ` point ${[...dec.slice(1)].map(d => ONES[d]).join(' ')}` : '';
    return [sign && 'minus', whole + point, scale, pct && 'percent', dollar && 'dollars'].filter(Boolean).join(' ');
  });

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
  const deltas = input.deltas.filter(d => TEMPLATE.has(d.metric));
  const overTime = deltas.filter(d => d.comparedWith !== NO_POLICY).map(clause);
  const vsNoPolicy = deltas.filter(d => d.comparedWith === NO_POLICY).map(clause);
  // ponytail: first pro and first con only, so real cards (3 of each) stay near 90 words; list them all if length stops mattering.
  return [
    `In a ${input.years}-year simulation of ${list(input.policies.map(p => `“${p.title}”`))}${overTime.length ? `, ${list(overTime)}` : ''}.`,
    vsNoPolicy.length ? `Compared with ${NO_POLICY}, ${list(vsNoPolicy)}.` : '',
    input.tradeoffs.pros[0] && `On the plus side: ${input.tradeoffs.pros[0]}`, input.tradeoffs.cons[0] && `On the downside: ${input.tradeoffs.cons[0]}`,
  ].filter(Boolean).join(' ');
}

const SYSTEM_PROMPT = `You write short news-style recaps of a city policy simulation for residents with no policy background. The recap is read aloud.
Rules:
- Between 60 and 90 words (about 30 seconds spoken), one paragraph, plain everyday language, no jargon, no headings or lists.
- Use ONLY numbers that appear in the input, and only the few that matter most to residents. Never calculate new numbers such as differences, sums or ratios. Write every number as digits.
- Say numbers the way a local news anchor would: commas in large numbers, $ for money, % for percentages, rounded figures (for example "about 12,400" for 12408), and big dollar amounts in millions (for example "about $4.5 million" for 4518230).
- When a delta is compared with no new policy, say so (for example "lower than with no new policy"); don't describe it as a change over time.
- Focus on the six headline metrics: ${HEADLINE.join(', ')}. Mention at most one other metric, and only if it changed notably for this policy (for example jobs for a hiring subsidy).
- For a delta with changePts (shares such as tree cover, storefront vacancy and car traffic), describe the change in percentage points, not changePct.
- households and pricedOut count households, never people: always say "households".
- No evaluative or advocacy language (such as "help", "good news", "unfortunately", "keep families in town"). State each change and what it is compared with, plainly.
- State both the benefits (pros) and the drawbacks (cons), taken only from the input's tradeoffs; add none of your own.
- Never recommend, endorse or oppose the policy and never take a side. Report what the simulation shows, as a simulation.`;

const userPrompt = input => `Simulation results (JSON):\n${JSON.stringify(input)}\n\nWhat the metrics mean: ${
  Object.entries(METRICS).map(([k, m]) => `${k} = ${m.meaning}`).join('; ')
}. In each delta, final is the value after the simulated years with this policy, and baseline is what it is compared with: `
  + `the starting value when comparedWith is "year 0", or the value after the same years with no new policy when comparedWith is "${NO_POLICY}". `
  + 'changePct is the percent change from baseline to final.';

// Each feature has its own model, so one feature's spent daily quota doesn't stop the others: GEMINI_MODEL_NARRATION,
// GEMINI_MODEL_CHAT, GEMINI_MODEL_CARDS, else GEMINI_MODEL, else these. Free-tier quotas are per project and model:
// Flash models get 20 requests a day, Flash-Lite 500 (measured from 429 bodies; Google no longer publishes them). So the
// recaps and chat take gemini-3.5-flash-lite, a Flash-Lite that accepts minimal thinking, and cards the stronger Flash.
const MODELS = { narration: 'gemini-3.5-flash-lite', chat: 'gemini-3.5-flash-lite', cards: 'gemini-3-flash-preview' };
/** The model a feature ('narration', 'chat' or 'cards') calls. */
export const modelFor = (env, feature) => env[`GEMINI_MODEL_${feature.toUpperCase()}`] || env.GEMINI_MODEL || MODELS[feature];
// When a model's daily quota is spent, gemini() tries the next one here once (the first, for a model not listed).
// ponytail: an env list, since the free quotas and models change without notice.
const FALLBACKS = 'gemini-3-flash-preview,gemini-3.5-flash-lite,gemini-3.1-flash-lite';
export const nextModel = (env, model) => {
  const list = (env.GEMINI_FALLBACK_MODELS || FALLBACKS).split(',').map(m => m.trim()).filter(Boolean), i = list.indexOf(model);
  return i < 0 ? list[0] : list[i + 1];
};

// Thinking makes Gemini 3 slow here (12-19s at its default level, 1.5s at "minimal"), but each model accepts different
// levels (gemini-3.8-flash rejects "minimal"), so a 400 about the level retries once with the model's default.
// A 429 for a daily quota (quotaId ...PerDay...) tries nextModel once; any other 429 or error throws, and callers use the template.
// opts: feature, system prompt, extra generationConfig (such as a responseSchema) and timeout; /api/policies passes its own.
export async function gemini(env, contents, opts = {}, thinkingLevel = env.GEMINI_THINKING_LEVEL || 'minimal') {
  const { feature = 'narration', model = modelFor(env, feature), fellBack = false, system = SYSTEM_PROMPT, config = {}, timeout = 20_000 } = opts;
  const generationConfig = { temperature: 0.2, ...config, ...(thinkingLevel && { thinkingConfig: { thinkingLevel } }) };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig }),
    signal: AbortSignal.timeout(timeout),
  });
  if (res.status === 400 && thinkingLevel && /thinking/i.test(await res.text())) {
    console.warn(`gemini: ${model} rejected thinking level "${thinkingLevel}"; retrying with its default`);
    return gemini(env, contents, { ...opts, model }, null);
  }
  if (res.status === 429 && !fellBack && /PerDay/.test(await res.text())) {
    const next = nextModel(env, model);
    if (next) {
      console.warn(`gemini: ${model}'s daily quota is spent; trying ${next}`);
      return gemini(env, contents, { ...opts, model: next, fellBack: true });
    }
  }
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status} (${model})`);
  const parts = (await res.json()).candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter(p => !p.thought).map(p => p.text ?? '').join('').trim();
  if (!text) throw new Error('Gemini returned no text');
  return text;
}

async function speak(env, text) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(env.ELEVENLABS_VOICE_ID)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'audio/mpeg', 'xi-api-key': env.ELEVENLABS_API_KEY },
    body: JSON.stringify({ text: speakable(text), model_id: env.ELEVENLABS_MODEL || 'eleven_flash_v2_5', apply_text_normalization: 'on' }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}

/** Gemini text (one retry naming the bad numbers or evaluative words, then the template) read aloud by ElevenLabs. Never throws. `failed` marks a transient API error. */
export async function narrate(input, env = process.env) {
  let text = null, failed = false;
  if (env.GEMINI_API_KEY) {
    try {
      const contents = [{ role: 'user', parts: [{ text: userPrompt(input) }] }];
      for (let attempt = 0; attempt < 2 && !text; attempt++) {
        const draft = await gemini(env, contents);
        const bad = badNumbers(draft, input), words = evaluativeWords(draft);
        if (!bad.length && !words.length) text = draft;
        else contents.push({ role: 'model', parts: [{ text: draft }] }, { role: 'user', parts: [{ text: [
          bad.length && `These numbers are not in the input: ${bad.join(', ')}. Rewrite the recap using only numbers from the input.`,
          words.length && `These words are evaluative or advocacy: ${words.join(', ')}. Rewrite the recap without them, stating each change plainly.`,
        ].filter(Boolean).join(' ') }] });
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

/** The mp3 is named by the words it says, so a clip recorded before speakable() changed is never reused. */
export const speechKey = text => hashInput(speakable(text));

async function demoClip(key) {
  try {
    const { text, fallback } = JSON.parse(await readFile(new URL(`../demo-audio/${key}.json`, import.meta.url), 'utf8'));
    const mp3 = await readFile(new URL(`../demo-audio/${speechKey(text)}.mp3`, import.meta.url));
    return { text, audio: mp3.toString('base64'), fallback };
  } catch {
    return null;
  }
}

const cache = new Map(); // ponytail: per-instance and capped at 100 by insertion order; a shared KV if cold starts hurt.
// The real body is about 1 KB, plus about 3 KB per player card; a full SimResult (zone maps and all) is about 115 KB.
const MAX_BODY = 32_768;
const RATE_LIMIT = 10; // calls that reach Gemini or ElevenLabs, per IP per minute
// ponytail: per instance, so it resets on cold starts and doesn't add up across instances. The real cap is a Vercel
// Firewall rate-limit rule on /api/narration; this one stops a single client hammering a warm instance.

/** A per-IP limiter: (ip) -> seconds until this IP may call again, or 0 if it is under `limit` a minute (and now counted). */
export function rateLimiter(limit) {
  const hits = new Map(); // ip -> { n, reset }
  return (ip, now = Date.now()) => {
    if (hits.size > 10_000) hits.clear();
    const h = hits.get(ip);
    if (!h || now >= h.reset) {
      hits.set(ip, { n: 1, reset: now + 60_000 });
      return 0;
    }
    return ++h.n > limit ? Math.ceil((h.reset - now) / 1000) : 0;
  };
}
const retryAfter = rateLimiter(RATE_LIMIT);
// Vercel sets x-forwarded-for to the client's IP and overwrites any value the client sends.
export const clientIp = request => request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';

/** The request's JSON body, or an error Response when it is over `max` bytes or not JSON. */
export async function readBody(request, max, hint) {
  const raw = await request.text();
  if (raw.length > max) return { error: Response.json({ error: `body must be at most ${max} bytes: ${hint}` }, { status: 413 }) };
  try {
    return { body: JSON.parse(raw) };
  } catch {
    return { error: Response.json({ error: 'body must be JSON' }, { status: 400 }) };
  }
}

export async function POST(request) {
  const { body, error } = await readBody(request, MAX_BODY, 'send { policies, years, deltas, cards? }');
  if (error) return error;
  const { cards, unverified } = withPlayerCards(body?.cards, await loadCards());
  const { errors, input } = parseInput(body, cards);
  if (errors.length) return Response.json({ error: errors.join('; ') }, { status: 400 });
  if (input.policies.some(p => unverified.has(p.id))) return Response.json({ text: templateRecap(input), audio: null, cached: false, fallback: true });

  const key = hashInput(input);
  if (cache.has(key)) return Response.json({ ...cache.get(key), cached: true });
  const clip = await demoClip(key);
  if (clip) {
    cache.set(key, clip);
    return Response.json({ ...clip, cached: true });
  }
  if (process.env.DEMO_MODE === '1') return Response.json({ text: templateRecap(input), audio: null, cached: false, fallback: true });

  const wait = retryAfter(clientIp(request));
  if (wait) return Response.json({ error: 'too many recaps; try again shortly' }, { status: 429, headers: { 'retry-after': String(wait) } });
  const { failed, ...result } = await narrate(input);
  if (!failed) {
    cache.set(key, result);
    if (cache.size > 100) cache.delete(cache.keys().next().value);
  }
  return Response.json({ ...result, cached: false });
}
