// Creates the Nessie merchants and each showcase resident's customer, checking and savings account, once, and keeps their
// ids in data/resident-bank.json (commit it). Rerunning creates only what the file lacks. Reads NESSIE_API_KEY from .env.local.
// Usage: npm run seed:nessie
import { readFileSync, writeFileSync } from 'node:fs';
import { seedBank } from '../api/resident-bank.js';

try { process.loadEnvFile('.env.local'); } catch {}
if (!process.env.NESSIE_API_KEY) throw new Error('NESSIE_API_KEY is not set (put it in .env.local)');
const file = new URL('../data/resident-bank.json', import.meta.url);
let bank;
try { bank = JSON.parse(readFileSync(file, 'utf8')); } catch { bank = { merchants: {}, residents: {} }; }
const { residents } = JSON.parse(readFileSync(new URL('../data/residents.json', import.meta.url), 'utf8'));
await seedBank(process.env, bank, residents, async b => writeFileSync(file, JSON.stringify(b, null, 2) + '\n'));
console.log(`data/resident-bank.json: ${Object.keys(bank.residents).length} residents, merchants ${Object.keys(bank.merchants).join(', ')}`);
