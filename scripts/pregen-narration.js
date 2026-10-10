// Writes demo-audio/<input hash>.json (the text) and <speech hash>.mp3 for each SimResult fixture, so /api/narration (and DEMO_MODE) can serve
// them without calling Gemini or ElevenLabs. Reads keys from .env.local. Commit the output.
// Usage: npm run pregen [-- fixture.json ...]   (default: tests/fixtures/sim-result.json)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hashInput, narrate, parseInput, speechKey } from '../api/narration.js';

try { process.loadEnvFile('.env.local'); } catch {}
const files = process.argv.slice(2);
const out = new URL('../demo-audio/', import.meta.url);
mkdirSync(out, { recursive: true });

for (const file of files.length ? files : ['tests/fixtures/sim-result.json']) {
  const { errors, input } = parseInput(JSON.parse(readFileSync(file, 'utf8')));
  if (errors.length) throw new Error(`${file}: ${errors.join('; ')}`);
  const { text, audio, fallback, failed } = await narrate(input);
  if (!audio || failed) throw new Error(`${file}: no clean result (check the keys in .env.local and the log above)`);
  const key = hashInput(input);
  writeFileSync(new URL(`${speechKey(text)}.mp3`, out), Buffer.from(audio, 'base64'));
  writeFileSync(new URL(`${key}.json`, out), JSON.stringify({ text, fallback }, null, 2) + '\n');
  console.log(`${file} -> demo-audio/${key}.json + ${speechKey(text)}.mp3${fallback ? ' (template text)' : ''}`);
}
