// Pregenerates the demo's clips into demo-audio/, so the deployed demo (and DEMO_MODE) serves them without calling Gemini
// or ElevenLabs: for each scenario in data/demo-scenarios.json, the narration recap and its audio (as npm run pregen
// writes them), and each listed resident's answer and audio to each starter question (api/resident.js clipFiles()).
// Run it once at demo freeze, after all merges, then commit demo-audio/: npm run pregen:demo. Keys come from .env.local.
// Clips already there are skipped, so a run stopped by the free tier (about 20 Gemini requests a day per model) picks up
// where it left off the next day. Gemini calls are spaced out to stay under its per-minute limit.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runCombined } from '../shared/combined.js';
import { hashInput, loadCards, narrate, parseInput, speechKey } from '../api/narration.js';
import { answer, answerKey, clipFiles, facts } from '../api/resident.js';
import { loadData, statementFor } from '../api/resident-bank.js';

const OUT = new URL('../demo-audio/', import.meta.url);
const PACE_MS = 13_000; // ponytail: free tier is about 5 requests a minute; drop it on a paid key

/** Every clip the demo needs: a recap per scenario, then an answer per resident and question. Pure apart from the models. */
export async function jobs() {
  const { scenarios, questions } = JSON.parse(readFileSync(new URL('../data/demo-scenarios.json', import.meta.url), 'utf8'));
  const [d, cards] = await Promise.all([loadData(), loadCards()]);
  const out = [];
  for (const s of scenarios) {
    const params = Object.fromEntries(s.policies.map(p => [p.id, p.params]));
    const { policies, years, deltas } = runCombined(s.policies.map(p => cards.get(p.id)), params, d.zones, d.assumptions, d.baselines);
    const { errors, input } = parseInput({ policies, years, deltas }, cards); // as the panel posts its SimResult
    if (errors.length) throw new Error(`${s.id}: ${errors.join('; ')}`);
    out.push({ kind: 'recap', scenario: s.id, input, json: `${hashInput(input)}.json` });
    for (const id of s.residents) {
      const f = facts(await statementFor(id, s.policies));
      for (const question of questions) out.push({ kind: 'answer', scenario: s.id, resident: id, question, f, json: clipFiles(answerKey(f, question)).json });
    }
  }
  return out;
}

async function main() {
  try { process.loadEnvFile('.env.local'); } catch {}
  for (const k of ['GEMINI_API_KEY', 'GEMINI_MODEL', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID']) if (!process.env[k]) throw new Error(`${k} is not set (put it in .env.local)`);
  mkdirSync(OUT, { recursive: true });
  const all = await jobs(), todo = all.filter(j => !existsSync(new URL(j.json, OUT)));
  console.log(`${all.length - todo.length} of ${all.length} clips already there; ${todo.length} to make`);
  for (const [i, j] of todo.entries()) {
    if (i) await new Promise(done => setTimeout(done, PACE_MS));
    const r = j.kind === 'recap' ? await narrate(j.input) : await answer(j.f, j.question);
    if (r.failed || !r.audio) throw new Error(`stopped at ${j.scenario} ${j.resident ?? 'recap'}: ${r.reason ?? 'Gemini or ElevenLabs failed (see above)'}. `
      + `${i} of ${todo.length} made this run; run it again once the quota resets.`);
    const mp3 = j.kind === 'recap' ? `${speechKey(r.text)}.mp3` : clipFiles(null, r.text, j.f.type).mp3;
    writeFileSync(new URL(mp3, OUT), Buffer.from(r.audio, 'base64'));
    writeFileSync(new URL(j.json, OUT), JSON.stringify({ text: r.text, fallback: r.fallback }, null, 2) + '\n');
    console.log(`${j.scenario} ${j.resident ? `${j.resident}: ${j.question}` : 'recap'} -> demo-audio/${j.json}${r.fallback ? ' (template text)' : ''}`);
  }
  console.log('Done. Commit demo-audio/.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
