// At demo freeze: creates the Nessie merchants and each showcase resident's customer, checking, savings and loan account,
// once, keeping their ids in data/resident-bank.json (commit it), then writes each resident's ledger for no policy and for
// each scenario in data/demo-scenarios.json. This is the only writer of showcase ledgers; /api/resident-bank only reads
// them. Each id is saved as Nessie returns it and written entries are skipped, so a rerun after a failure makes only
// what is missing. Reads NESSIE_API_KEY from .env.local. Usage: npm run seed:nessie
import { readFileSync, writeFileSync } from 'node:fs';
import { seedBank, seedLedgers } from '../api/resident-bank.js';

try { process.loadEnvFile('.env.local'); } catch {}
if (!process.env.NESSIE_API_KEY) throw new Error('NESSIE_API_KEY is not set (put it in .env.local)');
const file = new URL('../data/resident-bank.json', import.meta.url);
let bank;
try { bank = JSON.parse(readFileSync(file, 'utf8')); } catch { bank = { merchants: {}, residents: {} }; }
const { residents } = JSON.parse(readFileSync(new URL('../data/residents.json', import.meta.url), 'utf8'));
await seedBank(process.env, bank, residents, async b => writeFileSync(file, JSON.stringify(b, null, 2) + '\n'));
console.log(`data/resident-bank.json: ${Object.keys(bank.residents).length} residents, merchants ${Object.keys(bank.merchants).join(', ')}`);
const { scenarios } = JSON.parse(readFileSync(new URL('../data/demo-scenarios.json', import.meta.url), 'utf8'));
const written = await seedLedgers(process.env, bank, residents, [[], ...scenarios.map(s => s.policies)]);
console.log(`Ledgers for no policy and ${scenarios.length} demo scenarios: ${written} entries written (the rest were there).`);
