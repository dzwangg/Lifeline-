// Checks every card in data/policies/ against the schema (docs/policy-card-spec.md), then writes
// data/cards.index.json, the list the browser loads cards from. Commit that file with your cards.
// Usage: npm run validate:cards
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { matchesWhere, validateCard } from '../shared/schema.js';

const data = new URL('../data/', import.meta.url), dir = new URL('policies/', data);
const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')).sort() : [];
const zones = JSON.parse(readFileSync(new URL('zones.geojson', data), 'utf8')).features.map(f => f.properties);
const ids = new Map();
let invalid = 0;

for (const file of files) {
  let card, errors;
  try {
    card = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
    errors = validateCard(card);
  } catch (e) {
    errors = [`not valid JSON: ${e.message}`];
  }
  if (!errors.length && ids.has(card.id)) errors.push(`id: "${card.id}" is already used by ${ids.get(card.id)}`);
  const warnings = errors.length ? [] : (card.zoneRules ?? [])
    .filter(r => !zones.some(z => matchesWhere(r.where, z)))
    .map(r => `where "${r.where}" matches no zone in data/zones.geojson, so this rule changes nothing`);
  if (errors.length) invalid++;
  else ids.set(card.id, file);
  console.log(`${errors.length ? '✗' : warnings.length ? '!' : '✓'} data/policies/${file}`);
  for (const e of errors) console.log(`    ${e}`);
  for (const w of warnings) console.log(`    warning: ${w}`);
}

writeFileSync(new URL('cards.index.json', data), JSON.stringify(files.map(f => `policies/${f}`), null, 2) + '\n');
console.log(files.length
  ? `\n${files.length} card${files.length === 1 ? '' : 's'}, ${invalid} invalid. Wrote data/cards.index.json.`
  : 'No cards in data/policies/ yet. Wrote an empty data/cards.index.json.');
if (invalid) process.exitCode = 1;
