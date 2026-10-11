// A resident's money and its Nessie link, from /api/resident-bank, for the resident card (sim-plate.js). One request per
// resident and scenario, kept for the session. The server links the resident to Capital One's Nessie sandbox on its first
// ledger write and finds that same customer again after (api/resident-bank.js linkResident); the key stays there.
// Failures are never silent: each entry says where it is (loading, ready, error), a reply that says asking again may help
// (retryAfter) is asked again on its own, up to AUTO_RETRIES times, and the card always offers Retry while unlinked.
import { scenario, cardsReady } from './scenario.js';

const AUTO_RETRIES = 3;
let known = null; // ids of the cards the server prices (data/cards.index.json, and the stub where the page shows it)
cardsReady.then(cards => { known = new Set(cards.map(c => c.id)); });

/** The scenario's cards as the bank takes them, and the titles of any it leaves out (a drafted card it can't price). */
export function bankPolicies(s = scenario.get()) {
  const priced = s.cards.filter(c => known?.has(c.id));
  return { policies: priced.map(c => ({ id: c.id, params: s.params[c.id] ?? {} })), left: s.cards.filter(c => !priced.includes(c)).map(c => c.title ?? c.id) };
}

const entries = new Map(); // `${resident id}|${policies}` -> entry
const listeners = new Set();
const notify = () => listeners.forEach(fn => fn());

/**
 * The bank entry for resident `id` under these policies, fetched the first time it is asked for:
 * { status: 'loading' | 'ready' | 'error', reply, error, retryIn (seconds until the next automatic try, or null), busy }.
 * reply: the endpoint's ({ policy, noPolicy, change, link, ledger, ... }); it stays while a retry is under way.
 */
export function bankFor(id, policies) {
  const key = `${id}|${JSON.stringify(policies)}`;
  let e = entries.get(key);
  if (!e) {
    entries.set(key, e = { id, policies, status: 'loading', reply: null, error: null, retryIn: null, busy: false, attempts: 0, timer: 0 });
    load(e);
  }
  return e;
}
/** Asks again now, and allows the automatic retries again. */
export function retryBank(e) { clearTimeout(e.timer); e.attempts = 0; load(e); }
export function onBank(fn) { listeners.add(fn); return () => listeners.delete(fn); }

async function load(e) {
  e.busy = true; e.retryIn = null;
  if (!e.reply) e.status = 'loading';
  notify();
  try {
    const res = await fetch('/api/resident-bank', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resident: e.id, policies: e.policies, ledger: true }) });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(body?.error ?? `the bank answered HTTP ${res.status}`);
      // a limit or a server fault may pass; a bad request or a resident the run doesn't have won't
      err.retryAfter = res.status === 429 ? +res.headers.get('retry-after') || 10 : res.status >= 500 ? 2 ** e.attempts * 2 : 0;
      throw err;
    }
    Object.assign(e, { status: 'ready', reply: body, error: null });
    schedule(e, body.link?.status === 'linked' && body.ledger?.source === 'nessie' ? 0 : body.retryAfter);
  } catch (err) {
    Object.assign(e, { status: e.reply ? 'ready' : 'error', error: err.message || 'the bank could not be reached' });
    schedule(e, err.retryAfter ?? 2 ** e.attempts * 2); // a network failure: try again shortly
  }
  e.busy = false;
  notify();
}
function schedule(e, seconds) {
  if (!seconds || e.attempts >= AUTO_RETRIES) return;
  e.attempts++;
  e.retryIn = seconds;
  e.timer = setTimeout(() => load(e), seconds * 1000);
}
