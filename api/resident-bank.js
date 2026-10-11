// POST /api/resident-bank: one resident's money, year by year, with the active policy cards and with no new policy, kept as a
// ledger in Capital One's Nessie sandbox bank. Body (at most 4 KB):
//   { resident: <id in data/residents.json> } or { you: { rent, income, zone, mode } }, plus
//   policies: 0-10 of { id, params } (cards in data/cards.index.json), ledger?: true to write the ledger, account?: (you only)
// Reply: { resident, policies, policy, noPolicy, change, ledger, account? }. policy and noPolicy are budgets (see budget()): per
// year while the household is in town, a month's paycheck, housing, commute and other spending, and at the year's end the
// savings (never below zero) and the bills left unpaid once they are gone. change sums the policy's monthly changes over the
// years (changeOf()), so the panel can say "$1,400 more over 10 years".
// The money comes from the household model (shared/agents.js, seed 7) and CH-LUTI, run here per scenario and cached:
// paychecks from income less federal, NC and payroll tax, rent from its rent (owners: a fixed mortgage plus Town property
// tax), commute costs from its commute minutes, other spending from the BLS Consumer Expenditure Survey by income, starting
// savings from the Survey of Consumer Finances; data/resident-finance.json holds those values and their sources. "You" follows the same CH-LUTI paths from the visitor's
// self-reported year-0 numbers, which are kept nowhere but their own Nessie ledger.
//
// Nessie (NESSIE_API_KEY, server-side only). A ledger is the last year's month in checking (paycheck deposit, housing bill,
// commute and basket purchases), the savings path in savings (opening deposit, then each year's saving or drawdown) and,
// once savings are gone, what a household that borrows borrows or pays back each year in its loan account; all tagged
// with a hash of the budget. Nessie's sandbox never posts entries to the balance and can't delete purchases, so ledgers are
// append-only, and the reply's totals are summed from what Nessie returns.
// Showcase residents: scripts/seed-nessie.js (npm run seed:nessie, at demo freeze) makes each one's customer and accounts
// (ids in data/resident-bank.json) and writes their ledgers for the demo's scenarios, one process, one write at a time.
// This endpoint never writes to them: with ledger: true it reads a scenario's ledger back, and computes it here if Nessie
// lacks it. So no two server instances can race to write the same entries. "You" is the one live writer: it gets a customer
// on its first ledger write and writes only to that customer's accounts, whose ids (signed with the key) the reply hands
// back for later requests. Ledgers are cached, so a scenario costs Nessie calls once per instance; without ledger: true no
// call is made (the panel asks only once a scenario settles, never per slider move).
// No key, DEMO_MODE=1, a rate limit or a Nessie error: the reply's ledger is the same entries computed here, with
// source: "local" and a note saying why.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runModels } from '../shared/combined.js';
import { simulate } from '../shared/agents.js';
import { BASE_YEAR } from '../shared/luti/data.js';
import { PARAMS } from '../shared/luti/params.js';
import { clientIp, hashInput, loadCards, policiesError, rateLimiter, validPolicies } from './narration.js';

const NESSIE = 'https://api.nessieisreal.com';
const SEED = 7; // the map's household run (meridian-city/sim/scenario.js)
const ZONES = ['downtown', 'campus', 'edge']; // household zones with households in them
const MODES = ['car', 'bus', 'bike', 'walk', 'none'];
const ADDRESS = { street_number: '405', street_name: 'Martin Luther King Jr Blvd', city: 'Chapel Hill', state: 'NC', zip: '27514' }; // Town Hall
const MAX_BODY = 4096;

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const readJson = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8').then(JSON.parse);
const values = entries => Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, v.value]));

let data; // per instance: these files only change with a deploy
/** The model inputs, the showcase residents (by id) and the committed Nessie ids. */
export const loadData = () => data ??= Promise.all(['data/zones.geojson', 'data/assumptions.json', 'data/baselines.json',
  'data/resident-finance.json', 'data/residents.json', 'data/resident-bank.json'].map(p => readJson(p).catch(() => null)))
  .then(([fc, assumptions, baselines, finance, { residents }, bank]) => ({
    zones: fc.features.map(f => ({ ...f.properties, geometry: f.geometry })), assumptions, baselines,
    F: values(finance), A: values(assumptions), residents: new Map(residents.map(r => [r.id, r])),
    bank: bank ?? { merchants: {}, residents: {} },
  }));

const lru = (map, key, value, cap) => { map.set(key, value); if (map.size > cap) map.delete(map.keys().next().value); return value; };

const runs = new Map(); // scenario hash -> { agents, inputs, luti }; ponytail: per instance, about 200 ms a miss
/** The household model's seed-7 run and CH-LUTI's central run for these (validated) policies. */
function scenarioRun(policies, cards, d) {
  const key = hashInput([...policies].sort((a, b) => (a.id < b.id ? -1 : 1)));
  if (runs.has(key)) return runs.get(key);
  const picked = policies.map(p => cards.get(p.id)), params = Object.fromEntries(policies.map(p => [p.id, p.params]));
  const { inputs, luti } = runModels(picked, params, d.zones, d.assumptions, d.baselines);
  return lru(runs, key, { agents: simulate(inputs, d.assumptions, d.baselines, SEED).agents, inputs, luti }, 50);
}
const isCached = (policies) => runs.has(hashInput([...policies].sort((a, b) => (a.id < b.id ? -1 : 1))));
/** Whether statementFor(…, policies) runs on cached models (these policies and no policy), costing no model run. */
export const scenarioCached = policies => isCached(policies) && isCached([]);

const Y0 = BASE_YEAR - 1; // year 0's calendar year: CH-LUTI's year 1 is BASE_YEAR
// Costs, fares and tax thresholds grow with CH-LUTI's regional rent inflation, so spending keeps pace with rents.
const grow = t => (1 + PARAMS.rentDrift.mid) ** t, inYear0 = year => grow(Y0 - year); // inYear0(2024): 2024 dollars -> year 0's
const table = v => Object.entries(v).map(([k, x]) => [+k, x]).sort((a, b) => a[0] - b[0]);

/** A year's federal and North Carolina income tax and payroll tax on these wages, at year 0's (2026) law. */
export function taxes(wages, filing, F) {
  const taxable = Math.max(0, wages - F.federalStandardDeduction[filing]);
  const brackets = table(filing === 'joint' ? F.federalBracketsJoint : F.federalBracketsSingle);
  const federal = brackets.reduce((s, [lo, rate], i) => s + rate * Math.max(0, Math.min(taxable, brackets[i + 1]?.[0] ?? Infinity) - lo), 0);
  const nc = F.ncIncomeTaxRate * Math.max(0, wages - F.ncStandardDeduction[filing]);
  return federal + nc + F.socialSecurityTax.rate * Math.min(wages, F.socialSecurityTax.wageBase) + F.medicareTaxRate * wages;
}
// A value at each CE quintile's average income (2024 dollars), interpolated, and flat beyond the end quintiles.
const interpolate = (points, x) => {
  const pts = table(points), i = pts.findIndex(([at]) => at > x);
  return i === 0 ? pts[0][1] : i === -1 ? pts.at(-1)[1] : pts[i - 1][1] + (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]) * (pts[i][1] - pts[i - 1][1]);
};
/** Yearly spending other than housing and the commute for a year-0 income, as a household of that income in the CE spends,
 *  in year-0 dollars (see ceTotalSpending in data/resident-finance.json). */
export function spendingAt(income, filing, F) {
  const share = Object.fromEntries(Object.keys(F.ceTotalSpending).map(at => {
    const base = F.ceTotalSpending[at] - F.ceInsurancePensions[at];
    return [at, (base - F.ceShelter[at] - F.commuteShareOfDriving * F.ceTransport[at]) / base];
  }));
  return (income - taxes(income, filing, F)) * (1 - F.personalSavingRate) * interpolate(share, income / inYear0(2024));
}
/** Savings at the start of year 0 for a year-0 income: the SCF median for its income quintile, in year-0 dollars. */
export const savingsAt = (income, F) => table(F.startingSavings).findLast(([lo]) => income / inYear0(2024) >= lo)[1] * inYear0(2022);

/**
 * One run's money for a household, from year 0 while it is in town: yearly gross income, then a month's take-home pay,
 * housing (rent, or mortgage plus property tax), commute and other spending (basket), what is left (net), and at the
 * year's end the savings, which never go below zero. Once they are gone, a household that borrows (who.borrows: students,
 * and renters whose year-0 rent burden is above agentBurdenLine) covers the gap with loans or family support, which are
 * not modelled in detail: borrowed is what it owes. Any other household falls behind on bills instead (behind). Later
 * surpluses pay those back first. Other spending is set by year-0 income and grows with rent inflation.
 * @param {{ income: number, housing: number, commuteMin: number }[]} years the household's years in town
 * @param {{ filing: 'single' | 'joint', mode: string, durham: boolean, borrows: boolean }} who
 */
export function budget(years, who, { F, A }) {
  const income0 = years[0].income, trips = 2 * F.workDaysPerMonth, perMin = A.lutiSpeedKmh.car / 1.609344 / 60 * F.carCostPerMile;
  const bus = who.durham ? Math.min(trips * F.busFare.durham, F.busMonthlyCap.durham) : trips * F.busFare.town;
  const basket0 = spendingAt(income0, who.filing, F) / 12, start = Math.round(savingsAt(income0, F));
  let position = start; // savings, or minus what is owed (borrowed or unpaid) once they are gone
  return {
    start, borrows: who.borrows,
    years: years.map(({ income, housing, commuteMin }, t) => {
      const commute = who.mode === 'car' ? commuteMin * trips * perMin * grow(t) : who.mode === 'bus' ? bus * grow(t) : 0;
      const month = { pay: Math.round((income - taxes(income / grow(t), who.filing, F) * grow(t)) / 12), housing: Math.round(housing),
        commute: Math.round(commute), basket: Math.round(basket0 * grow(t)) };
      const net = month.pay - month.housing - month.commute - month.basket;
      position += 12 * net;
      const owed = Math.max(0, -position);
      return { t, income: Math.round(income), ...month, net, savings: Math.max(0, position), borrowed: who.borrows ? owed : 0, behind: who.borrows ? 0 : owed };
    }),
  };
}
const withFlags = (b, left) => ({ ...b, left, savingsOut: b.years.find(y => y.borrowed > 0 || y.behind > 0)?.t ?? null });
/** The policy's change against no new policy: month by month summed over the years the household is in town in both runs,
 *  and what it has borrowed by the last of those years ("borrows $1,200 less over 10 years"). */
export function changeOf(policy, noPolicy) {
  const both = policy.years.filter(y => noPolicy.years[y.t]), last = both.at(-1);
  return { throughYear: last?.t ?? null, ...Object.fromEntries(['pay', 'housing', 'commute', 'basket', 'net']
    .map(k => [k, both.reduce((s, y) => s + 12 * (y[k] - noPolicy.years[y.t][k]), 0)])),
  borrowed: last ? last.borrowed - noPolicy.years[last.t].borrowed : 0 };
}

const yearOf = (luti, t) => (t ? luti.series[4 * t - 1] : luti.start);
/** A showcase resident's years in town in one run: the agent's own history (owners: housing per ownerFixedShare). */
function residentYears(r, run, d) {
  const a = run.agents[r.agent], out = [];
  for (let t = 0; t < a.hist.length && a.hist[t]?.here; t++) {
    const h = a.hist[t], L = yearOf(run.luti, t);
    const housing = a.renter ? h.rent
      : d.F.ownerFixedShare * a.rentBase + L.homeValue * a.rentBase / d.baselines.medianGrossRent.value * L.taxRate / 1e4 / 12;
    out.push({ income: h.income, housing, commuteMin: h.commute });
  }
  const borrows = r.type === 'student' || (a.renter && a.burden0 > d.A.agentBurdenLine);
  return withFlags(budget(out, { filing: r.filing, mode: r.mode, durham: a.work === 'durham', borrows }, d), a.left);
}
/** The visitor's years: their year-0 rent follows CH-LUTI's rent for their zone, income grows as CH-LUTI's does, and the
 *  commute takes as long as their zone's average one in the seed-7 run. They never leave. */
function youYears(you, run, d) {
  const out = [];
  for (let t = 0; t <= 10; t++) {
    const commuters = run.agents.filter(a => a.zone === you.zone && a.work !== 'remote' && a.hist[t]?.here);
    out.push({ income: you.income * (1 + d.A.lutiIncomeGrowth) ** t, housing: you.rent * (run.inputs.rent?.[t]?.[you.zone] ?? 1),
      commuteMin: commuters.reduce((s, a) => s + a.hist[t].commute, 0) / commuters.length });
  }
  return withFlags(budget(out, { filing: 'single', mode: you.mode, durham: false, borrows: you.rent * 12 > d.A.agentBurdenLine * you.income }, d), null);
}

const withChange = (policy, noPolicy) => ({ policy, noPolicy, change: changeOf(policy, noPolicy) });
/** The statement for a showcase resident id or a visitor profile, with and without the (validated) policies. */
export async function statementFor(who, policies) {
  const [d, cards] = await Promise.all([loadData(), loadCards()]);
  const r = typeof who === 'string' ? d.residents.get(who) : null;
  const years = run => (r ? residentYears(r, run, d) : youYears(who, run, d));
  const a = r && scenarioRun([], cards, d).agents[r.agent];
  return {
    resident: r ? { id: r.id, name: r.name, type: r.type, zone: a.zone, work: a.work, mode: r.mode, tenure: a.renter ? 'renter' : 'owner' }
      : { id: 'you', name: 'You', type: 'you', zone: who.zone, work: null, mode: who.mode, tenure: 'renter' },
    policies: policies.map(({ id, params }) => ({ id, title: cards.get(id).title, params })),
    ...withChange(years(scenarioRun(policies, cards, d)), years(scenarioRun([], cards, d))),
  };
}

const dateOf = t => `${BASE_YEAR - 1 + t}-12-01`; // CH-LUTI's year 1 is BASE_YEAR, so year 0 ends the year before
/** The Nessie entries for a budget: the last year's month in checking, the savings path in savings. tag marks them as this ledger's. */
export function ledgerEntries(b, { tenure, mode, type }, merchants, tag = hashInput(b).slice(0, 8)) {
  const student = type === 'student';
  const y = b.years.at(-1), on = dateOf(y.t), say = text => `[${tag}] ${text}`, done = { medium: 'balance', status: 'completed' };
  const money = v => `$${Math.abs(v).toLocaleString('en-US')}`;
  return [
    { account: 'checking', kind: 'deposits', body: { ...done, transaction_date: on, amount: y.pay, description: say(`Year ${y.t} paycheck, a month's take-home`) } },
    { account: 'checking', kind: 'bills', body: { status: 'recurring', payee: tenure === 'owner' ? 'Mortgage and Town property tax' : 'Rent',
      nickname: say(`Year ${y.t} ${tenure === 'owner' ? 'mortgage and property tax' : 'rent'}`), payment_date: on, recurring_date: 1, payment_amount: y.housing } },
    y.commute > 0 && { account: 'checking', kind: 'purchases', body: { ...done, merchant_id: merchants.commute, purchase_date: on, amount: y.commute, description: say(`Year ${y.t} commute by ${mode}`) } },
    { account: 'checking', kind: 'purchases', body: { ...done, merchant_id: merchants.basket, purchase_date: on, amount: y.basket, description: say(`Year ${y.t} groceries, utilities and other spending`) } },
    { account: 'savings', kind: 'deposits', body: { ...done, transaction_date: `${BASE_YEAR - 1}-01-01`, amount: b.start, description: say('Opening savings') } },
    // each year's change in savings, which stop at zero: past that, the shortfall is borrowed or bills falling behind
    ...b.years.map((x, i) => [x, x.savings - (i ? b.years[i - 1].savings : b.start)]).filter(([, change]) => change).map(([x, change]) => ({
      account: 'savings', kind: change > 0 ? 'deposits' : 'withdrawals', body: { ...done, transaction_date: dateOf(x.t), amount: Math.abs(change),
        description: say(`Year ${x.t}: ${change > 0 ? 'saved' : 'drew down'} ${money(change)}${x.behind ? `; savings gone, ${money(x.behind)} behind on bills` : ''}`) } })),
    // what is borrowed each year (a loan) or paid back (a payment), in the loan account
    ...b.years.map((x, i) => [x, x.borrowed - (i ? b.years[i - 1].borrowed : 0)]).filter(([, change]) => change).map(([x, change]) => (change > 0
      ? { account: 'loan', kind: 'loans', body: { type: student ? 'student' : 'personal', status: 'approved', amount: change, monthly_payment: 0,
        credit_score: 0, // Nessie requires one; none is modelled
        description: say(`Year ${x.t}: borrowed ${money(change)}, the gap covered by ${student ? 'student loans' : 'loans'} or family support; ${money(x.borrowed)} owed`) } }
      : { account: 'loan', kind: 'deposits', body: { ...done, transaction_date: dateOf(x.t), amount: -change, description: say(`Year ${x.t}: paid back ${money(change)}; ${money(x.borrowed)} owed`) } })),
  ].filter(Boolean);
}
const labelOf = e => e.body.description ?? e.body.nickname;

/** One Nessie call. The key goes in the query string, as Nessie wants, and never into an error message or the log. */
async function nessie(env, method, path, body) {
  const res = await fetch(`${NESSIE}${path}?key=${encodeURIComponent(env.NESSIE_API_KEY)}`, {
    method, headers: body ? { 'content-type': 'application/json' } : {}, body: body && JSON.stringify(body), signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Nessie ${method} ${path.replace(/\/[0-9a-f-]{16,}/g, '/:id')}: HTTP ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
const created = r => r?.objectCreated ?? r; // Nessie: 201 { code, message, objectCreated }
const inBatches = async (items, f, n = 6) => { // ponytail: 6 in flight; Nessie's own limits are undocumented
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(...await Promise.all(items.slice(i, i + n).map(f)));
  return out;
};

// Nessie's sandbox records transactions but never posts them to the balance, and it can't delete purchases or withdrawals,
// so the ledger is append-only: each scenario's entries carry its tag, and the accounts keep every scenario written so far.
const KINDS = ['checking/deposits', 'checking/bills', 'checking/purchases', 'savings/deposits', 'savings/withdrawals', 'loan/loans', 'loan/deposits']; // all ledgerEntries writes
const keyOf = e => `${e.account}/${e.kind}/${labelOf(e)}`;
/** What the accounts hold of `entries`, matched by their tagged labels: held (by keyOf) and the entries missing. Reads only. */
export async function readLedger(env, accounts, entries) {
  const tag = labelOf(entries[0]).slice(0, 10), held = new Map();
  await inBatches(KINDS, async k => {
    const [account, kind] = k.split('/');
    for (const x of await nessie(env, 'GET', `/accounts/${accounts[account]}/${kind}`)) {
      const label = x.description ?? x.nickname;
      if (label?.startsWith(tag)) held.set(`${account}/${kind}/${label}`, x);
    }
  });
  return { held, missing: entries.filter(e => !held.has(keyOf(e))) };
}
// What Nessie holds, read back: its ids and amounts, not ours.
const fromNessie = (entries, held, written) => {
  const rows = entries.map(e => ({ ...view(e), id: held.get(keyOf(e))._id, amount: amountOf(held.get(keyOf(e))) }));
  return { source: 'nessie', written, totals: totals(rows), entries: rows };
};
/** Posts whichever of `entries` the accounts lack (all, the first time; none, once written, even from a cold start). */
export async function writeLedger(env, accounts, entries) {
  const { held, missing } = await readLedger(env, accounts, entries);
  await inBatches(missing, async e => held.set(keyOf(e), created(await nessie(env, 'POST', `/accounts/${accounts[e.account]}/${e.kind}`, e.body))));
  return fromNessie(entries, held, missing.length);
}
const amountOf = x => x.amount ?? x.payment_amount;
const view = e => ({ id: null, account: e.account, kind: e.kind, amount: amountOf(e.body), date: e.body.transaction_date ?? e.body.purchase_date ?? e.body.payment_date ?? null, label: labelOf(e) });
/** The month left over in checking, the savings balance at the end and what is owed on the loan, summed from the entries. */
const totals = rows => ({
  ...Object.fromEntries(['checking', 'savings'].map(a => [a, rows.filter(r => r.account === a).reduce((s, r) => s + (r.kind === 'deposits' ? r.amount : -r.amount), 0)])),
  loan: rows.filter(r => r.account === 'loan').reduce((s, r) => s + (r.kind === 'loans' ? r.amount : -r.amount), 0),
});
const localLedger = (entries, note) => { const rows = entries.map(view); return { source: 'local', note, totals: totals(rows), entries: rows }; };

// Nessie has no loan account type, so loans and family support sit on a Credit Card account, as Nessie loans.
const ACCOUNTS = { checking: ['Checking', 'checking'], savings: ['Savings', 'savings'], loan: ['Credit Card', 'loans and family support'] };
/**
 * A customer with a checking, a savings and a loan account: whichever of them `have` lacks is made. save(ids) runs after
 * each one is made, with every id so far, so a failure partway (say, one account request of three) keeps what was made,
 * and a rerun makes only the rest.
 */
async function createCustomer(env, first_name, last_name, have = {}, save = async () => {}) {
  const ids = { ...have };
  if (!ids.customer) {
    ids.customer = created(await nessie(env, 'POST', '/customers', { first_name, last_name, address: ADDRESS }))._id;
    await save({ ...ids });
  }
  const made = await Promise.allSettled(Object.entries(ACCOUNTS).filter(([key]) => !ids[key]).map(async ([key, [type, what]]) => {
    ids[key] = created(await nessie(env, 'POST', `/customers/${ids.customer}/accounts`, { type, nickname: `${first_name} ${what}`, rewards: 0, balance: 0 }))._id;
    await save({ ...ids });
  }));
  const failed = made.find(m => m.status === 'rejected');
  if (failed) throw failed.reason; // once every request has finished, so each one that worked is saved
  return ids;
}

/**
 * Creates what `bank` lacks: the two merchants purchases need, and each showcase resident's customer and accounts. Calls
 * save(bank) after each id Nessie returns, so a failure partway keeps everything made, and a rerun makes only what is
 * missing. Idempotent: what bank holds is never recreated.
 */
export async function seedBank(env, bank, residents, save = async () => {}) {
  const merchants = { commute: ['Commute costs', 'transportation'], basket: ['Household basket', 'groceries'] };
  for (const [key, [name, category]] of Object.entries(merchants)) if (!bank.merchants[key]) {
    bank.merchants[key] = created(await nessie(env, 'POST', '/merchants', { name, category, address: ADDRESS, geocode: { lat: 35.9132, lng: -79.0558 } }))._id;
    await save(bank);
  }
  for (const r of residents) if (!['customer', ...Object.keys(ACCOUNTS)].every(k => bank.residents[r.id]?.[k])) { // what exists is kept
    await createCustomer(env, r.name, 'Meridian (simulated)', bank.residents[r.id], async ids => { bank.residents[r.id] = ids; await save(bank); });
  }
  return bank;
}

/**
 * Writes each showcase resident's ledger for each of these policy sets to its seeded accounts (npm run seed:nessie, at demo
 * freeze), one at a time: the only writer of showcase ledgers. Entries already there are skipped (writeLedger), so a rerun
 * after a failure writes only the rest. Returns how many entries were written.
 */
export async function seedLedgers(env, bank, residents, policySets) {
  let written = 0;
  for (const policies of policySets) for (const r of residents) {
    const s = await statementFor(r.id, policies);
    written += (await writeLedger(env, bank.residents[r.id], ledgerEntries(s.policy, s.resident, bank.merchants))).written;
  }
  return written;
}

// A visitor's account ids come back from the browser, so they are signed: a visitor can only write to accounts made for them.
const sign = (env, a) => createHmac('sha256', `resident-bank:${env.NESSIE_API_KEY}`).update(`${a.customer}.${a.checking}.${a.savings}.${a.loan}`).digest('hex');
const signed = (env, a) => { const s = Buffer.from(sign(env, a)), t = Buffer.from(String(a.sig)); return s.length === t.length && timingSafeEqual(s, t); };

/** Hand-written check of the body. @returns {{ errors: string[], who?: string | object, policies?: object[], account?: object }} */
export function parseBody(b, cards, residents) {
  if (!isObj(b)) return { errors: ['body must be a JSON object'] };
  const errors = [], ok = (pass, problem) => pass || errors.push(problem);
  const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  const y = b.you;
  ok((typeof b.resident === 'string' && residents.has(b.resident)) !== isObj(y),
    `send resident (one of ${[...residents.keys()].join(', ')}) or you, not both`);
  if (isObj(y)) ok(num(y.rent, 0, 20_000) && num(y.income, 0, 2_000_000) && ZONES.includes(y.zone) && MODES.includes(y.mode),
    `you must be { rent: 0-20000 a month, income: 0-2000000 a year, zone: ${ZONES.join('|')}, mode: ${MODES.join('|')} }`);
  ok(validPolicies(b.policies, cards, 0), policiesError(cards, 0));
  ok(b.ledger === undefined || typeof b.ledger === 'boolean', 'ledger must be true or false');
  const a = b.account;
  ok(a === undefined || (isObj(y) && isObj(a) && ['customer', 'checking', 'savings', 'loan', 'sig'].every(k => typeof a[k] === 'string' && a[k].length <= 64)),
    'account must be { customer, checking, savings, loan, sig } as an earlier reply gave it, with you');
  if (errors.length) return { errors };
  return { errors, who: isObj(y) ? { rent: y.rent, income: y.income, zone: y.zone, mode: y.mode } : b.resident,
    policies: b.policies.map(({ id, params }) => ({ id, params })), account: a && { customer: a.customer, checking: a.checking, savings: a.savings, loan: a.loan, sig: a.sig } };
}

const ledgers = new Map(); // `${checking account}|${entries hash}` -> written ledger: Nessie is called once per scenario
const queues = new Map(); // checking account -> its last write, so two writes to one account never interleave
const computeLimit = rateLimiter(30), ledgerLimit = rateLimiter(6), visitorLimit = rateLimiter(3, 600_000);

export async function POST(request, env = process.env) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return Response.json({ error: `body must be at most ${MAX_BODY} bytes` }, { status: 413 });
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'body must be JSON' }, { status: 400 });
  }
  const [d, cards] = await Promise.all([loadData(), loadCards()]);
  const { errors, who, policies, account } = parseBody(body, cards, d.residents);
  if (errors.length) return Response.json({ error: errors.join('; ') }, { status: 400 });
  const ip = clientIp(request);
  if (!scenarioCached(policies)) {
    const wait = computeLimit(ip);
    if (wait) return Response.json({ error: 'too many new scenarios; try again shortly' }, { status: 429, headers: { 'retry-after': String(wait) } });
  }

  const statement = await statementFor(who, policies);
  const you = typeof who !== 'string';
  const entries = ledgerEntries(statement.policy, statement.resident, d.bank.merchants);
  let accounts = you ? account : d.bank.residents[who], reply = {};
  if (you && account && !(env.NESSIE_API_KEY && signed(env, account))) return Response.json({ error: 'account is not one this server made' }, { status: 400 });
  const key = accounts && `${accounts.checking}|${hashInput(entries)}`;
  if (key && ledgers.has(key)) return Response.json({ ...statement, ledger: { ...ledgers.get(key), cached: true } });

  const note = !body.ledger ? 'Not written to Nessie yet: computed here.'
    : env.DEMO_MODE === '1' ? 'Demo mode: computed here, not written to Nessie.'
    : !env.NESSIE_API_KEY ? 'Nessie is not configured (no NESSIE_API_KEY): computed here.'
    : !you && !accounts ? 'This resident has no Nessie account yet (run npm run seed:nessie): computed here.'
    : (ledgerLimit(ip) || (you && !accounts && visitorLimit(ip))) ? 'Too many ledger writes just now: computed here.' : null;
  if (note) return Response.json({ ...statement, ledger: localLedger(entries, note) });
  try {
    if (!you) { // a showcase resident: written at demo freeze, only read back here
      const { held, missing } = await readLedger(env, accounts, entries);
      const ledger = missing.length ? localLedger(entries, 'Not in Nessie: showcase ledgers are written for the demo\'s scenarios at demo freeze (npm run seed:nessie). Computed here.')
        : fromNessie(entries, held, 0);
      lru(ledgers, key, ledger, 500);
      return Response.json({ ...statement, ledger: { ...ledger, cached: false } });
    }
    if (!accounts) {
      accounts = await createCustomer(env, 'Visitor', 'Prosperia (simulated)');
      reply.account = { ...accounts, sig: sign(env, accounts) };
    }
    const prev = queues.get(accounts.checking) ?? Promise.resolve();
    const job = prev.catch(() => {}).then(() => writeLedger(env, accounts, entries));
    lru(queues, accounts.checking, job, 500);
    const ledger = await job;
    lru(ledgers, `${accounts.checking}|${hashInput(entries)}`, ledger, 500);
    return Response.json({ ...statement, ...reply, ledger: { ...ledger, cached: false } });
  } catch (err) {
    console.error('resident-bank:', err.message);
    return Response.json({ ...statement, ...reply, ledger: localLedger(entries, `Nessie is unavailable (${err.message}): computed here.`) });
  }
}
