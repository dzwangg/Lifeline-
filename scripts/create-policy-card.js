// Turn a resident's idea into a simulator card with Gemini, using /api/policies' generator and checks.
// Usage: put GEMINI_API_KEY in .env.local (GEMINI_MODEL_CARDS picks the model), then npm run create:card -- "Build apartments near the corridor"
// Writes data/policies/<id>.json and data/cards.index.json. Review the card's text before committing it.
import { readdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateCard } from '../api/policies.js';

const data = new URL('../data/', import.meta.url);
const policyDir = new URL('policies/', data);

export async function createCard(idea, env = process.env) {
  if (!env.GEMINI_API_KEY) throw new Error('Set GEMINI_API_KEY in .env.local or your environment.');
  if (!idea?.trim()) throw new Error('Describe the policy you want to create.');
  const { card, unmodeled } = await generateCard(idea, env);
  const names = await readdir(policyDir);
  if (names.includes(`${card.id}.json`)) throw new Error(`A card named ${card.id} already exists. Try a more specific idea.`);
  const path = new URL(`${card.id}.json`, policyDir);
  await writeFile(path, JSON.stringify(card, null, 2) + '\n', { flag: 'wx' });
  const files = [...names.filter(name => name.endsWith('.json')), `${card.id}.json`].sort();
  await writeFile(new URL('cards.index.json', data), JSON.stringify(files.map(name => `policies/${name}`), null, 2) + '\n');
  return { card, unmodeled, path: fileURLToPath(path) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.loadEnvFile('.env.local'); } catch {}
  try {
    let idea = process.argv.slice(2).join(' ').trim();
    if (!idea) {
      const rl = createInterface({ input: stdin, output: stdout });
      try { idea = (await rl.question('What policy would you like to create? ')).trim(); }
      finally { rl.close(); }
    }
    const { card, unmodeled, path } = await createCard(idea);
    console.log(`Created ${card.title}\n${path}`);
    if (unmodeled.length) console.log(`Not modelled, so left out of the card: ${unmodeled.join('; ')}`);
    console.log('The policy will appear in the library after reloading the game. Review the proposal and its tradeoffs before sharing it.');
  } catch (error) {
    console.error(error.message);
    if (error.extra?.problems) console.error(`  ${error.extra.problems.join('\n  ')}`);
    process.exitCode = 1;
  }
}
