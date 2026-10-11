// Pregenerates the demo's clips into demo-audio/, so the deployed demo (and DEMO_MODE) serves them without calling Gemini
// or ElevenLabs: for each scenario in data/demo-scenarios.json, the narration recap (as npm run pregen writes it), and
// each listed resident's answer to each starter question (api/resident.js clipFiles()). ElevenLabs' free characters are
// few, so only the 3 recaps and the first resident's answers to the first 2 questions in each scenario (9 clips) get
// audio; the rest are text. The texts come first; then the run prints the characters the audio will take and stops if
// they are over MAX_TTS_CHARS (default 10,000, ElevenLabs' free month) before calling ElevenLabs.
// Run it once at demo freeze, after all merges, then commit demo-audio/: npm run pregen:demo. Keys come from .env.local.
// Clips already there are skipped, so a run stopped early picks up where it left off. Free-tier quotas are per model, so
// the calls are shared out across the models the features route to (GEMINI_MODEL_NARRATION, _CHAT and _CARDS; see
// .env.example) in proportion to each one's daily quota, and the run checks that all of it fits in one day before
// calling anything. Each model's calls are spaced out to stay under its per-minute limit.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runCombined } from '../shared/combined.js';
import { hashInput, loadCards, modelFor, narrate, parseInput, speak, speakable, speechKey } from '../api/narration.js';
import { VOICES, answer, answerKey, clipFiles, facts } from '../api/resident.js';
import { loadData, statementFor } from '../api/resident-bank.js';

const OUT = new URL('../demo-audio/', import.meta.url);
const AUDIO_QUESTIONS = 2; // per scenario, the first resident's answers to this many questions get audio
const PACE_MS = 13_000; // per model; ponytail: free tier is about 5 requests a minute; drop it on a paid key
// Free-tier requests a day per model, as measured for .env.example: Flash-Lite 500, other Flash models 20. A clip takes up
// to two calls (a rejected draft is retried once).
const DAILY = model => (/flash-lite/.test(model) ? 500 : 20), CALLS_PER_CLIP = 2;

/**
 * The model each job calls: the distinct models the narration, chat and cards features route to, each taking jobs in
 * proportion to the clips its daily quota covers (the least used, for its quota, goes next). Throws if they can't cover
 * all the jobs in one day.
 */
export function assignModels(jobs, env) {
  const cap = new Map([...new Set(['narration', 'chat', 'cards'].map(f => modelFor(env, f)))].map(m => [m, Math.floor(DAILY(m) / CALLS_PER_CLIP)]));
  const total = [...cap.values()].reduce((a, b) => a + b, 0);
  if (jobs.length > total) throw new Error(`${jobs.length} clips need up to ${jobs.length * CALLS_PER_CLIP} Gemini calls, but ${[...cap.keys()].join(', ')} `
    + `cover ${total} clips a day on the free tier: route the features to more models (GEMINI_MODEL_NARRATION, _CHAT, _CARDS)`);
  const used = new Map([...cap.keys()].map(m => [m, 0]));
  return jobs.map(() => {
    const m = [...cap.keys()].reduce((a, b) => (used.get(b) / cap.get(b) < used.get(a) / cap.get(a) ? b : a));
    used.set(m, used.get(m) + 1);
    return m;
  });
}

/** Every clip the demo needs: a recap per scenario, then an answer per resident and question; audio marks the ones read
 *  aloud. Pure apart from the models. */
export async function jobs() {
  const { scenarios, questions } = JSON.parse(readFileSync(new URL('../data/demo-scenarios.json', import.meta.url), 'utf8'));
  const [d, cards] = await Promise.all([loadData(), loadCards()]);
  const out = [];
  for (const s of scenarios) {
    const params = Object.fromEntries(s.policies.map(p => [p.id, p.params]));
    const { policies, years, deltas } = runCombined(s.policies.map(p => cards.get(p.id)), params, d.zones, d.assumptions, d.baselines);
    const { errors, input } = parseInput({ policies, years, deltas }, cards); // as the panel posts its SimResult
    if (errors.length) throw new Error(`${s.id}: ${errors.join('; ')}`);
    out.push({ kind: 'recap', scenario: s.id, input, json: `${hashInput(input)}.json`, audio: true });
    for (const [r, id] of s.residents.entries()) {
      const f = facts(await statementFor(id, s.policies));
      for (const [q, question] of questions.entries())
        out.push({ kind: 'answer', scenario: s.id, resident: id, question, f, json: clipFiles(answerKey(f, question)).json, audio: r === 0 && q < AUDIO_QUESTIONS });
    }
  }
  return out;
}

/** A clip's audio file, its voice (undefined: the narrator's), its text and the words ElevenLabs is sent for it. */
export const audioOf = (j, text) => ({ text, speech: speakable(text), ...(j.kind === 'recap'
  ? { mp3: `${speechKey(text)}.mp3`, voice: undefined }
  : { mp3: clipFiles(null, text, j.f.type).mp3, voice: VOICES[j.f.type] }) });

async function main() {
  try { process.loadEnvFile('.env.local'); } catch {}
  for (const k of ['GEMINI_API_KEY', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID']) if (!process.env[k]) throw new Error(`${k} is not set (put it in .env.local)`);
  const maxChars = Number(process.env.MAX_TTS_CHARS) || 10_000;
  mkdirSync(OUT, { recursive: true });
  const all = await jobs(), saved = j => existsSync(new URL(j.json, OUT));

  // 1. The texts, from Gemini, without audio. Each is saved as it comes, so a stopped run resumes.
  const todo = all.filter(j => !saved(j)), models = assignModels(todo, process.env);
  console.log(`${all.length - todo.length} of ${all.length} texts already there; ${todo.length} to write`);
  for (const m of new Set(models)) console.log(`  ${models.filter(x => x === m).length} on ${m}`);
  const textOnly = { ...process.env, ELEVENLABS_API_KEY: '' }, last = new Map(); // model -> when it was last called
  for (const [i, j] of todo.entries()) {
    const model = models[i], wait = (last.get(model) ?? -Infinity) + PACE_MS - Date.now();
    if (wait > 0) await new Promise(done => setTimeout(done, wait));
    last.set(model, Date.now());
    const env = { ...textOnly, [j.kind === 'recap' ? 'GEMINI_MODEL_NARRATION' : 'GEMINI_MODEL_CHAT']: model };
    const r = j.kind === 'recap' ? await narrate(j.input, env) : await answer(j.f, j.question, env);
    if (r.failed) throw new Error(`stopped at ${j.scenario} ${j.resident ?? 'recap'}: ${r.reason ?? 'Gemini failed (see above)'}. `
      + `${i} of ${todo.length} written this run; run it again once the quota resets.`);
    writeFileSync(new URL(j.json, OUT), JSON.stringify({ text: r.text, fallback: r.fallback }, null, 2) + '\n');
    console.log(`${j.scenario} ${j.resident ? `${j.resident}: ${j.question}` : 'recap'} -> demo-audio/${j.json}${r.fallback ? ' (template text)' : ''}`);
  }

  // 2. The audio budget: every character ElevenLabs will be sent, before any call.
  const clips = all.filter(j => j.audio).map(j => ({ j, ...audioOf(j, JSON.parse(readFileSync(new URL(j.json, OUT), 'utf8')).text) }))
    .filter(c => !existsSync(new URL(c.mp3, OUT)));
  const chars = clips.reduce((n, c) => n + c.speech.length, 0);
  console.log(`ElevenLabs: ${chars.toLocaleString('en-US')} characters for ${clips.length} clips (MAX_TTS_CHARS ${maxChars.toLocaleString('en-US')})`);
  if (chars > maxChars) throw new Error(`${chars} characters is over MAX_TTS_CHARS (${maxChars}): no audio made. Raise it or shorten the texts.`);

  // 3. The audio.
  for (const c of clips) {
    writeFileSync(new URL(c.mp3, OUT), Buffer.from(await speak(process.env, c.text, c.voice), 'base64'));
    console.log(`audio -> demo-audio/${c.mp3}`);
  }
  console.log('Done. Commit demo-audio/.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
